import { eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { dealerships, users } from "../../../db/schema";
import { recordAudit } from "../../../lib/audit";
import { ensureDealershipModules, getAccessProfile, normalizeUserRole, profileHasDealership } from "../../../lib/access";

export const dynamic = "force-dynamic";

type DealershipInput = {
  id?: number;
  name?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  parentDealershipId?: number | null;
  factoryManagerEmail?: string;
  contactName?: string;
  contactEmail?: string;
};

function forbidden(message = "Você não tem permissão para gerenciar concessionárias.") {
  return Response.json({ error: message }, { status: 403 });
}

function normalizePostalCode(value: unknown) {
  return String(value ?? "").replace(/\D/g, "").slice(0, 8);
}

function normalizeState(value: unknown) {
  return String(value ?? "").trim().toUpperCase().slice(0, 2);
}

function canManage(profile: NonNullable<Awaited<ReturnType<typeof getAccessProfile>>>, dealer: { id: number; factoryManagerEmail: string }) {
  return ["general_admin", "global_management"].includes(profile.role) ||
    (profile.role === "factory_manager" && (profileHasDealership(profile, dealer.id) || dealer.factoryManagerEmail.trim().toLowerCase() === profile.email));
}

async function validateManager(db: Awaited<ReturnType<typeof getDb>>, email: string) {
  const [manager] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  return manager && manager.active && normalizeUserRole(manager.email, manager.role) === "factory_manager" ? manager : null;
}

async function validateParent(
  db: Awaited<ReturnType<typeof getDb>>,
  profile: NonNullable<Awaited<ReturnType<typeof getAccessProfile>>>,
  parentId: number | null,
  currentId?: number,
) {
  if (parentId === null) return { parent: null };
  if (currentId && parentId === currentId) return { error: "A filial não pode ser sua própria matriz." };
  const [parent] = await db.select().from(dealerships).where(eq(dealerships.id, parentId)).limit(1);
  if (!parent) return { error: "Matriz não encontrada." };
  if (parent.parentDealershipId !== null) return { error: "Selecione uma matriz, não outra filial." };
  if (!canManage(profile, parent)) return { error: "A matriz está fora da sua carteira de atuação." };
  return { parent };
}

function inputError(payload: DealershipInput) {
  const name = payload.name?.trim() || "";
  const state = normalizeState(payload.state);
  const postalCode = normalizePostalCode(payload.postalCode);
  if (!name || !state || postalCode.length !== 8) {
    return "Informe nome, UF e CEP válido da concessionária.";
  }
  return "";
}

export async function POST(request: Request) {
  const profile = await getAccessProfile();
  if (!profile || !["general_admin", "global_management", "factory_manager"].includes(profile.role)) return forbidden();
  try {
    const payload = (await request.json()) as DealershipInput;
    const validation = inputError(payload);
    if (validation) return Response.json({ error: validation }, { status: 400 });
    const db = await getDb();
    const managerEmail = profile.role === "factory_manager"
      ? profile.email
      : payload.factoryManagerEmail?.trim().toLowerCase() || "";
    if (!managerEmail) return Response.json({ error: "Atribua um Gestor Fábrica à concessionária." }, { status: 400 });
    const manager = await validateManager(db, managerEmail);
    if (!manager) return Response.json({ error: "Selecione um Gestor Fábrica ativo." }, { status: 400 });
    const parentId = payload.parentDealershipId ? Math.trunc(Number(payload.parentDealershipId)) : null;
    const parentResult = await validateParent(db, profile, parentId);
    if (parentResult.error) return Response.json({ error: parentResult.error }, { status: 400 });
    const [created] = await db.insert(dealerships).values({
      name: payload.name!.trim(),
      city: payload.city?.trim() || "",
      state: normalizeState(payload.state),
      postalCode: normalizePostalCode(payload.postalCode),
      parentDealershipId: parentId,
      contactName: payload.contactName?.trim() || "",
      contactEmail: payload.contactEmail?.trim().toLowerCase() || "",
      factoryManagerEmail: manager.email.toLowerCase(),
    }).returning();
    await ensureDealershipModules(db, created.id, profile.email);
    await recordAudit(db, { actorEmail: profile.email, actorName: profile.name, action: "dealership_created", entity: "dealership", details: `Concessionária ${created.name} cadastrada.`, after: created });
    return Response.json({ dealership: created }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Não foi possível cadastrar a concessionária.";
    return Response.json({ error: message.includes("UNIQUE") ? "Já existe uma concessionária com este nome." : message }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const profile = await getAccessProfile();
  if (!profile || !["general_admin", "global_management", "factory_manager"].includes(profile.role)) return forbidden();
  try {
    const payload = (await request.json()) as DealershipInput;
    const id = Math.trunc(Number(payload.id) || 0);
    if (!id) return Response.json({ error: "Informe a concessionária." }, { status: 400 });
    const validation = inputError(payload);
    if (validation) return Response.json({ error: validation }, { status: 400 });
    const db = await getDb();
    const [current] = await db.select().from(dealerships).where(eq(dealerships.id, id)).limit(1);
    if (!current) return Response.json({ error: "Concessionária não encontrada." }, { status: 404 });
    if (!canManage(profile, current)) return forbidden("A concessionária está fora da sua carteira de atuação.");
    const managerEmail = profile.role === "factory_manager"
      ? profile.email
      : payload.factoryManagerEmail?.trim().toLowerCase() || current.factoryManagerEmail.trim().toLowerCase();
    const manager = await validateManager(db, managerEmail);
    if (!manager) return Response.json({ error: "Selecione um Gestor Fábrica ativo." }, { status: 400 });
    const parentId = payload.parentDealershipId ? Math.trunc(Number(payload.parentDealershipId)) : null;
    const parentResult = await validateParent(db, profile, parentId, id);
    if (parentResult.error) return Response.json({ error: parentResult.error }, { status: 400 });
    const [updated] = await db.update(dealerships).set({
      name: payload.name!.trim(),
      city: payload.city?.trim() || "",
      state: normalizeState(payload.state),
      postalCode: normalizePostalCode(payload.postalCode),
      parentDealershipId: parentId,
      contactName: payload.contactName?.trim() || "",
      contactEmail: payload.contactEmail?.trim().toLowerCase() || "",
      factoryManagerEmail: manager.email.toLowerCase(),
    }).where(eq(dealerships.id, id)).returning();
    await ensureDealershipModules(db, updated.id, profile.email);
    await recordAudit(db, { actorEmail: profile.email, actorName: profile.name, action: "dealership_updated", entity: "dealership", details: `Cadastro da concessionária ${updated.name} atualizado.`, before: current, after: updated });
    return Response.json({ dealership: updated });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Não foi possível atualizar a concessionária.";
    return Response.json({ error: message.includes("UNIQUE") ? "Já existe uma concessionária com este nome." : message }, { status: 500 });
  }
}
