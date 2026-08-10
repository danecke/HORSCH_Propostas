import { eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { dealerships, dealershipModuleAccess } from "../../../db/schema";
import { recordAudit } from "../../../lib/audit";
import {
  getAccessProfile,
  MODULE_KEYS,
  MODULE_LABELS,
  type ModuleKey,
} from "../../../lib/access";

export const dynamic = "force-dynamic";

function forbidden(message = "Você não tem permissão para configurar módulos.") {
  return Response.json({ error: message }, { status: 403 });
}

function canManage(profile: NonNullable<Awaited<ReturnType<typeof getAccessProfile>>>, dealership: { factoryManagerEmail: string }) {
  return ["general_admin", "global_management"].includes(profile.role) ||
    (profile.role === "factory_manager" && dealership.factoryManagerEmail.trim().toLowerCase() === profile.email.toLowerCase());
}

export async function GET() {
  const profile = await getAccessProfile();
  if (!profile) return forbidden("Seu acesso ainda não foi liberado ou está inativo.");
  const db = await getDb();
  const dealers = await db.select().from(dealerships);
  const rows = await db.select().from(dealershipModuleAccess);
  const visible = dealers.filter((dealer) =>
    ["general_admin", "global_management"].includes(profile.role) ||
    (profile.role === "factory_manager" && dealer.factoryManagerEmail.toLowerCase() === profile.email.toLowerCase()) ||
    dealer.id === profile.dealershipId,
  );
  return Response.json({ modules: visible.map((dealer) => ({
    dealershipId: dealer.id,
    dealership: dealer.name,
    modules: MODULE_KEYS.map((moduleKey) => ({
      key: moduleKey,
      label: MODULE_LABELS[moduleKey],
      enabled: rows.find((row) => row.dealershipId === dealer.id && row.moduleKey === moduleKey)?.enabled ?? true,
    })),
  })) });
}

export async function PATCH(request: Request) {
  const profile = await getAccessProfile();
  if (!profile || !["general_admin", "global_management", "factory_manager"].includes(profile.role)) return forbidden();
  try {
    const payload = (await request.json()) as { dealershipId?: number; moduleKey?: ModuleKey; enabled?: boolean };
    const dealershipId = Math.trunc(Number(payload.dealershipId) || 0);
    const moduleKey = payload.moduleKey;
    if (!dealershipId || !moduleKey || !MODULE_KEYS.includes(moduleKey)) {
      return Response.json({ error: "Informe concessionária e módulo válidos." }, { status: 400 });
    }
    const db = await getDb();
    const [dealer] = await db.select().from(dealerships).where(eq(dealerships.id, dealershipId)).limit(1);
    if (!dealer) return Response.json({ error: "Concessionária não encontrada." }, { status: 404 });
    if (!canManage(profile, dealer)) return forbidden("A concessionária está fora da sua carteira de atuação.");
    const now = new Date().toISOString();
    const enabled = Boolean(payload.enabled);
    await db.insert(dealershipModuleAccess).values({ dealershipId, moduleKey, enabled, updatedByEmail: profile.email, updatedAt: now })
      .onConflictDoUpdate({
        target: [dealershipModuleAccess.dealershipId, dealershipModuleAccess.moduleKey],
        set: { enabled, updatedByEmail: profile.email, updatedAt: now },
      });
    await recordAudit(db, {
      actorEmail: profile.email,
      actorName: profile.name,
      action: enabled ? "module_enabled" : "module_disabled",
      entity: "dealership_module",
      details: `${MODULE_LABELS[moduleKey]} ${enabled ? "habilitado" : "desabilitado"} para ${dealer.name}.`,
      after: { dealershipId, dealership: dealer.name, moduleKey, enabled },
    });
    return Response.json({ ok: true, dealershipId, moduleKey, enabled });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Não foi possível atualizar o módulo." }, { status: 500 });
  }
}
