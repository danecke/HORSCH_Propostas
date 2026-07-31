import { eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { users } from "../../../../db/schema";
import {
  createSession,
  normalizeEmail,
  sessionCookie,
  verifyPassword,
} from "../../../../lib/auth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as { email?: string; password?: string };
    const email = normalizeEmail(payload.email ?? "");
    const password = payload.password ?? "";
    if (!email || !password) {
      return Response.json(
        { error: "Informe seu e-mail e sua senha." },
        { status: 400 },
      );
    }

    const db = await getDb();
    const [record] = await db
      .select()
      .from(users)
      .where(eq(users.email, email))
      .limit(1);
    const valid =
      Boolean(record?.active) &&
      Boolean(record) &&
      (await verifyPassword(password, {
        passwordHash: record!.passwordHash,
        passwordSalt: record!.passwordSalt,
        passwordIterations: record!.passwordIterations,
      }));
    if (!valid) {
      return Response.json(
        { error: "E-mail ou senha inválidos." },
        { status: 401 },
      );
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
          error instanceof Error ? error.message : "Não foi possível entrar.",
      },
      { status: 500 },
    );
  }
}
