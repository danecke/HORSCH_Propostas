import { eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { sessions, users } from "../../../../db/schema";
import { recordAudit } from "../../../../lib/audit";
import { getAccessProfile, MASTER_ADMIN_EMAIL } from "../../../../lib/access";
import {
  createPasswordCredential,
  generateTemporaryPassword,
  validatePassword,
} from "../../../../lib/auth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const actor = await getAccessProfile();
  if (!actor || actor.role !== "general_admin") {
    return Response.json(
      { error: "Somente o ADM Geral pode restaurar senhas." },
      { status: 403 },
    );
  }

  try {
    const payload = (await request.json()) as { email?: string; password?: string };
    const email = payload.email?.trim().toLowerCase() ?? "";
    if (!email) return Response.json({ error: "Informe o usuário." }, { status: 400 });

    const db = await getDb();
    const [target] = await db.select().from(users).where(eq(users.email, email)).limit(1);
    if (!target) return Response.json({ error: "Acesso não encontrado." }, { status: 404 });
    if (email === MASTER_ADMIN_EMAIL && actor.email !== MASTER_ADMIN_EMAIL) {
      return Response.json(
        { error: "O ADM principal só pode ser restaurado pelo próprio ADM principal." },
        { status: 403 },
      );
    }

    const password = payload.password?.trim() || generateTemporaryPassword();
    const passwordError = validatePassword(password);
    if (passwordError) return Response.json({ error: passwordError }, { status: 400 });

    await db.update(users).set({
      ...(await createPasswordCredential(password)),
      updatedAt: new Date().toISOString(),
    }).where(eq(users.email, email));
    await db.delete(sessions).where(eq(sessions.userEmail, email));
    await recordAudit(db, {
      actorEmail: actor.email,
      actorName: actor.name,
      action: "access_password_reset",
      entity: "access",
      details: "Senha restaurada para " + email + ".",
      before: { email, credentialReady: Boolean(target.passwordHash) },
      after: { email, credentialReady: true },
    });

    return Response.json({ ok: true, temporaryPassword: password });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Erro ao restaurar a senha." },
      { status: 500 },
    );
  }
}
