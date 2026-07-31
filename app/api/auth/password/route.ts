import { eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { users } from "../../../../db/schema";
import {
  createPasswordCredential,
  getAuthenticatedUser,
  validatePassword,
  verifyPassword,
} from "../../../../lib/auth";

export const dynamic = "force-dynamic";

export async function PATCH(request: Request) {
  const identity = await getAuthenticatedUser();
  if (!identity) {
    return Response.json({ error: "Sessão expirada." }, { status: 401 });
  }

  try {
    const payload = (await request.json()) as {
      currentPassword?: string;
      newPassword?: string;
    };
    const passwordError = validatePassword(payload.newPassword ?? "");
    if (passwordError) {
      return Response.json({ error: passwordError }, { status: 400 });
    }

    const db = await getDb();
    const [record] = await db
      .select()
      .from(users)
      .where(eq(users.email, identity.email))
      .limit(1);
    if (
      !record ||
      !(await verifyPassword(payload.currentPassword ?? "", {
        passwordHash: record.passwordHash,
        passwordSalt: record.passwordSalt,
        passwordIterations: record.passwordIterations,
      }))
    ) {
      return Response.json(
        { error: "A senha atual está incorreta." },
        { status: 401 },
      );
    }

    await db
      .update(users)
      .set({
        ...(await createPasswordCredential(payload.newPassword!)),
        updatedAt: new Date().toISOString(),
      })
      .where(eq(users.email, identity.email));
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Não foi possível alterar a senha.",
      },
      { status: 500 },
    );
  }
}
