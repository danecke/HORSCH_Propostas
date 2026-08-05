import { eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { dealerships, sessions, users } from "../../../../db/schema";
import { recordAudit } from "../../../../lib/audit";
import {
  canRestorePassword,
  getAccessProfile,
  MASTER_ADMIN_EMAIL,
  normalizeUserRole,
} from "../../../../lib/access";
import {
  createPasswordCredential,
  generateTemporaryPassword,
  validatePassword,
} from "../../../../lib/auth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const actor = await getAccessProfile();
  if (!actor) {
    return Response.json(
      { error: "Seu acesso ainda não foi liberado ou está inativo." },
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
    const targetRole = normalizeUserRole(target.email, target.role) ?? "concession";
    let targetWithinFactory = true;
    if (actor.role === "factory_manager") {
      targetWithinFactory = false;
      if (target.dealershipId !== null) {
        const [dealer] = await db
          .select({ manager: dealerships.factoryManagerEmail })
          .from(dealerships)
          .where(eq(dealerships.id, target.dealershipId))
          .limit(1);
        targetWithinFactory = dealer?.manager.toLowerCase() === actor.email;
      }
    }
    const allowed = actor.role === "general_admin" ||
      (canRestorePassword(actor.role, targetRole) && targetWithinFactory);
    if (!allowed) {
      return Response.json(
        { error: "Você só pode restaurar senhas dos níveis abaixo do seu e dentro do seu escopo." },
        { status: 403 },
      );
    }
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
