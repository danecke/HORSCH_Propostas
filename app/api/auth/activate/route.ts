import { eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { users } from "../../../../db/schema";
import {
  createPasswordCredential,
  createSession,
  isPasswordCredentialSupported,
  normalizeEmail,
  safeSecretEqual,
  sessionCookie,
  validatePassword,
} from "../../../../lib/auth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as {
      email?: string;
      name?: string;
      activationCode?: string;
      password?: string;
    };
    const email = normalizeEmail(payload.email ?? "");
    const name = payload.name?.trim() ?? "";
    const password = payload.password ?? "";
    const passwordError = validatePassword(password);
    if (!email || !email.includes("@") || !name || passwordError) {
      return Response.json(
        {
          error:
            passwordError ?? "Informe nome e e-mail corporativo corretamente.",
        },
        { status: 400 },
      );
    }

    const { env } = await import("cloudflare:workers");
    const expectedCode = String(env.ADMIN_BOOTSTRAP_CODE ?? "");
    if (
      !expectedCode ||
      !(await safeSecretEqual(payload.activationCode ?? "", expectedCode))
    ) {
      return Response.json(
        { error: "Código de ativação inválido." },
        { status: 401 },
      );
    }

    const db = await getDb();
    const [record] = await db
      .select()
      .from(users)
      .where(eq(users.email, email))
      .limit(1);
    const credential = await createPasswordCredential(password);

    if (record) {
      if (
        record.role !== "admin" ||
        isPasswordCredentialSupported({
          passwordHash: record.passwordHash,
          passwordSalt: record.passwordSalt,
          passwordIterations: record.passwordIterations,
        })
      ) {
        return Response.json(
          { error: "Este acesso não está disponível para ativação inicial." },
          { status: 409 },
        );
      }
      await db
        .update(users)
        .set({
          name,
          ...credential,
          active: true,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(users.email, email));
    } else {
      const [firstUser] = await db.select({ email: users.email }).from(users).limit(1);
      if (firstUser) {
        return Response.json(
          { error: "Use o e-mail do ADM já cadastrado para ativar o portal." },
          { status: 409 },
        );
      }
      await db.insert(users).values({
        email,
        name,
        role: "admin",
        active: true,
        createdByEmail: email,
        ...credential,
      });
    }

    const session = await createSession(email);
    return Response.json(
      { ok: true },
      {
        headers: {
          "Set-Cookie": sessionCookie(
            session.token,
            new URL(request.url).protocol === "https:",
          ),
        },
      },
    );
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Não foi possível ativar o acesso.",
      },
      { status: 500 },
    );
  }
}
