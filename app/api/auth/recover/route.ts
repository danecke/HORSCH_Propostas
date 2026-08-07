import { and, eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { auditLogs, sessions, users } from "../../../../db/schema";
import {
  createPasswordCredential,
  createSession,
  normalizeEmail,
  safeSecretEqual,
  sessionCookie,
  validatePassword,
} from "../../../../lib/auth";
import { normalizeUserRole } from "../../../../lib/access";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as { email?: string; recoveryKey?: string; newPassword?: string };
    const email = normalizeEmail(payload.email ?? "");
    const recoveryKey = payload.recoveryKey?.trim() ?? "";
    const newPassword = payload.newPassword ?? "";
    const passwordError = validatePassword(newPassword);
    if (!email || !recoveryKey || passwordError) {
      return Response.json({ error: passwordError || "Preencha o e-mail e o código de recuperação." }, { status: 400 });
    }

    const { env } = await import("cloudflare:workers");
    const configuredKey = env.PORTAL_ACCOUNT_RECOVERY_KEY;
    if (!configuredKey || !(await safeSecretEqual(recoveryKey, configuredKey))) {
      return Response.json({ error: "Código de recuperação inválido." }, { status: 401 });
    }
    const recoveryKeyFingerprint = await fingerprint(recoveryKey);

    const db = await getDb();
    const [target] = await db.select().from(users).where(eq(users.email, email)).limit(1);
    const targetRole = target ? normalizeUserRole(target.email, target.role) : null;
    if (!target?.active || !targetRole || !["general_admin", "global_management"].includes(targetRole)) {
      return Response.json({ error: "Esta conta não pode usar este fluxo de recuperação." }, { status: 403 });
    }

    const previousRecoveries = await db.select({ afterJson: auditLogs.afterJson }).from(auditLogs).where(and(
      eq(auditLogs.actorEmail, email),
      eq(auditLogs.action, "account_password_recovered"),
      eq(auditLogs.entity, "auth"),
    )).limit(20);
    const alreadyUsed = previousRecoveries.some((entry) => {
      try {
        return JSON.parse(entry.afterJson).recoveryKeyFingerprint === recoveryKeyFingerprint;
      } catch {
        return false;
      }
    });
    if (alreadyUsed) {
      return Response.json({ error: "Este código já foi utilizado. Solicite um novo código administrativo." }, { status: 409 });
    }

    await db.update(users).set({ ...(await createPasswordCredential(newPassword)), updatedAt: new Date().toISOString() }).where(eq(users.email, email));
    await db.delete(sessions).where(eq(sessions.userEmail, email));
    await db.insert(auditLogs).values({
      actorEmail: email,
      actorName: target.name,
      action: "account_password_recovered",
      entity: "auth",
      details: "Recuperação de acesso concluída pelo fluxo administrativo.",
      beforeJson: JSON.stringify({ credentialReady: Boolean(target.passwordHash) }),
      afterJson: JSON.stringify({ credentialReady: true, role: targetRole, recoveryKeyFingerprint }),
    });

    const session = await createSession(email);
    return Response.json({ ok: true }, { headers: { "Set-Cookie": sessionCookie(session.token, new URL(request.url).protocol === "https:") } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Não foi possível recuperar o acesso." }, { status: 500 });
  }
}

async function fingerprint(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
