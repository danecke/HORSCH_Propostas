import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "../../../db";
import { dealerships, userDealerships, users } from "../../../db/schema";
import { recordAudit } from "../../../lib/audit";
import {
  getAccessProfile,
  canManageLowerRole,
  MASTER_ADMIN_EMAIL,
  normalizeUserRole,
  ROLES,
  type UserRole,
} from "../../../lib/access";
import {
  createPasswordCredential,
  validatePassword,
} from "../../../lib/auth";

export const dynamic = "force-dynamic";

type AccessInput = {
  email?: string;
  name?: string;
  role?: UserRole;
  dealershipId?: number | null;
  dealershipIds?: number[];
  active?: boolean;
  password?: string;
};

function forbidden(message = "Você não tem permissão para gerenciar este acesso.") {
  return Response.json({ error: message }, { status: 403 });
}

async function canManage(
  actor: NonNullable<Awaited<ReturnType<typeof getAccessProfile>>>,
  role: UserRole,
  dealershipIds: number[],
) {
  if (!canManageLowerRole(actor.role, role)) return false;
  if (["general_admin", "global_management"].includes(actor.role)) return true;
  if (actor.role !== "factory_manager" || !dealershipIds.length) return false;

  const db = await getDb();
  const assignments = await db
    .select({ dealershipId: userDealerships.dealershipId })
    .from(userDealerships)
    .where(and(eq(userDealerships.userEmail, actor.email), inArray(userDealerships.dealershipId, dealershipIds)));
  const legacy = await db
    .select({ dealershipId: dealerships.id })
    .from(dealerships)
    .where(and(inArray(dealerships.id, dealershipIds), eq(dealerships.factoryManagerEmail, actor.email)));
  const allowed = new Set([...assignments.map((row) => row.dealershipId), ...legacy.map((row) => row.dealershipId)]);
  return dealershipIds.every((id) => allowed.has(id));
}

function normalizeDealershipIds(payload: AccessInput, fallback: number[] = []) {
  const supplied = Array.isArray(payload.dealershipIds)
    ? payload.dealershipIds
    : payload.dealershipId === undefined
      ? fallback
      : [payload.dealershipId];
  return [...new Set(supplied.map((value) => Math.trunc(Number(value))).filter((value) => value > 0))];
}

async function replaceAssignments(db: Awaited<ReturnType<typeof getDb>>, email: string, dealershipIds: number[], actorEmail: string) {
  await db.delete(userDealerships).where(eq(userDealerships.userEmail, email));
  if (dealershipIds.length) {
    await db.insert(userDealerships).values(dealershipIds.map((dealershipId) => ({ userEmail: email, dealershipId, createdByEmail: actorEmail })));
  }
}

export async function POST(request: Request) {
  const actor = await getAccessProfile();
  if (!actor) return forbidden("Seu acesso ainda não foi liberado ou está inativo.");

  try {
    const payload = (await request.json()) as AccessInput;
    const email = payload.email?.trim().toLowerCase() ?? "";
    const name = payload.name?.trim() ?? "";
    const role: UserRole = payload.role && ROLES.includes(payload.role)
      ? payload.role
      : "concession";
    const dealershipIds = actor.role === "dealer_manager"
      ? actor.dealershipIds
      : normalizeDealershipIds(payload);
    const dealershipId = dealershipIds[0] ?? null;
    if (!email || !email.includes("@") || !name) {
      return Response.json({ error: "Preencha nome e e-mail corretamente." }, { status: 400 });
    }
    if (email === MASTER_ADMIN_EMAIL || role === "general_admin") {
      return Response.json({ error: "O acesso do ADM principal já é administrado pelo sistema." }, { status: 409 });
    }
    if (!["general_admin", "global_management"].includes(actor.role) && !dealershipIds.length) {
      return Response.json({ error: "Selecione ao menos uma concessionária deste usuário." }, { status: 400 });
    }
    const passwordError = validatePassword(payload.password ?? "");
    if (passwordError) {
      return Response.json({ error: passwordError }, { status: 400 });
    }
    if (["factory_manager", "dealer_manager", "concession"].includes(role) && !dealershipIds.length) {
      return Response.json({ error: "Selecione ao menos uma concessionária deste usuário." }, { status: 400 });
    }
    if (!(await canManage(actor, role, dealershipIds))) return forbidden();

    const db = await getDb();
    const [existing] = await db.select().from(users).where(eq(users.email, email)).limit(1);
    if (existing) {
      return Response.json({ error: "Este e-mail já possui um acesso cadastrado." }, { status: 409 });
    }
    await db.insert(users).values({
      email,
      name,
      role,
      dealershipId,
      active: true,
      createdByEmail: actor.email,
      ...(await createPasswordCredential(payload.password!)),
    });
    await replaceAssignments(db, email, dealershipIds, actor.email);
    await recordAudit(db, { actorEmail: actor.email, actorName: actor.name, action: "access_created", entity: "access", details: `Acesso criado para ${name} (${role}).`, after: { email, name, role, dealershipId, dealershipIds, active: true } });
    return Response.json({ ok: true }, { status: 201 });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Erro ao criar acesso." },
      { status: 500 },
    );
  }
}

export async function PATCH(request: Request) {
  const actor = await getAccessProfile();
  if (!actor) return forbidden("Seu acesso ainda não foi liberado ou está inativo.");

  try {
    const payload = (await request.json()) as AccessInput;
    const email = payload.email?.trim().toLowerCase() ?? "";
    if (!email) return Response.json({ error: "Informe o acesso." }, { status: 400 });
    const db = await getDb();
    const [target] = await db.select().from(users).where(eq(users.email, email)).limit(1);
    if (!target) return Response.json({ error: "Acesso não encontrado." }, { status: 404 });

    const currentRole = normalizeUserRole(target.email, target.role) ?? "concession";
    const role = payload.role && ROLES.includes(payload.role) ? payload.role : currentRole;
    const targetAssignments = await db.select({ dealershipId: userDealerships.dealershipId }).from(userDealerships).where(eq(userDealerships.userEmail, email));
    const currentDealershipIds = [...new Set([
      ...targetAssignments.map((assignment) => assignment.dealershipId),
      ...(target.dealershipId === null ? [] : [target.dealershipId]),
    ])];
    const dealershipIds = normalizeDealershipIds(payload, currentDealershipIds);
    const dealershipId = dealershipIds[0] ?? null;
    const changesPosition =
      (payload.role !== undefined && payload.role !== currentRole) ||
      payload.dealershipIds !== undefined ||
      (payload.dealershipId !== undefined && dealershipId !== (target.dealershipId ?? null));
    if (changesPosition && !(await canManage(actor, currentRole, currentDealershipIds))) {
      return forbidden("Você só pode alterar posições dentro dos níveis abaixo do seu.");
    }
    if (email === MASTER_ADMIN_EMAIL && (role !== "general_admin" || payload.active === false)) {
      return Response.json({ error: "O ADM principal não pode ser reclassificado ou desativado." }, { status: 409 });
    }
    if (email !== MASTER_ADMIN_EMAIL && role === "general_admin") {
      return forbidden("Nenhum outro usuário pode receber a posição ADM Geral.");
    }
    if (["factory_manager", "dealer_manager", "concession"].includes(role) && !dealershipIds.length) {
      return Response.json({ error: "Selecione ao menos uma concessionária deste gestor." }, { status: 400 });
    }
    if (!(await canManage(actor, currentRole, currentDealershipIds))) return forbidden();
    if (!(await canManage(actor, role, dealershipIds))) return forbidden();
    if (email === actor.email && payload.active === false) {
      return Response.json({ error: "Você não pode desativar o próprio acesso." }, { status: 409 });
    }

    if (payload.password) {
      const passwordError = validatePassword(payload.password);
      if (passwordError) {
        return Response.json({ error: passwordError }, { status: 400 });
      }
    }
    const passwordPatch = payload.password
      ? await createPasswordCredential(payload.password)
      : {};

    await db
      .update(users)
      .set({
        name: payload.name?.trim() || target.name,
        role,
        dealershipId,
        active: payload.active ?? target.active,
        ...passwordPatch,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(users.email, email));
    await replaceAssignments(db, email, dealershipIds, actor.email);
    await recordAudit(db, { actorEmail: actor.email, actorName: actor.name, action: "access_updated", entity: "access", details: `Acesso atualizado para ${email}.`, before: { email: target.email, name: target.name, role: currentRole, dealershipId: target.dealershipId, active: target.active }, after: { email, name: payload.name?.trim() || target.name, role, dealershipId, dealershipIds, active: payload.active ?? target.active } });
    if (role === "dealer_manager" && dealershipIds.length) {
      await db
        .update(dealerships)
        .set({
          contactName: payload.name?.trim() || target.name,
          contactEmail: email,
        })
        .where(inArray(dealerships.id, dealershipIds));
    }
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Erro ao atualizar acesso." },
      { status: 500 },
    );
  }
}
