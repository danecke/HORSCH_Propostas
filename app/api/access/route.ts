import { eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { dealerships, users } from "../../../db/schema";
import {
  getAccessProfile,
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
  active?: boolean;
  password?: string;
};

function forbidden(message = "Você não tem permissão para gerenciar este acesso.") {
  return Response.json({ error: message }, { status: 403 });
}

async function canManage(
  actor: NonNullable<Awaited<ReturnType<typeof getAccessProfile>>>,
  role: UserRole,
  dealershipId: number | null,
) {
  if (actor.role === "admin") return true;
  if (!["dealer_manager", "user"].includes(role) || dealershipId === null) return false;
  if (actor.role === "dealer_manager") return actor.dealershipId === dealershipId;
  if (actor.role !== "factory_manager") return false;

  const db = await getDb();
  const [dealer] = await db
    .select({ manager: dealerships.factoryManagerEmail })
    .from(dealerships)
    .where(eq(dealerships.id, dealershipId))
    .limit(1);
  return dealer?.manager.toLowerCase() === actor.email;
}

export async function POST(request: Request) {
  const actor = await getAccessProfile();
  if (!actor) return forbidden("Seu acesso ainda não foi liberado ou está inativo.");

  try {
    const payload = (await request.json()) as AccessInput;
    const email = payload.email?.trim().toLowerCase() ?? "";
    const name = payload.name?.trim() ?? "";
    const role: UserRole = "user";
    const dealershipId =
      actor.role === "dealer_manager"
        ? actor.dealershipId
        : Number(payload.dealershipId) || null;
    if (!email || !email.includes("@") || !name) {
      return Response.json({ error: "Preencha nome e e-mail corretamente." }, { status: 400 });
    }
    if (email === MASTER_ADMIN_EMAIL) {
      return Response.json({ error: "O acesso do ADM principal já é administrado pelo sistema." }, { status: 409 });
    }
    if (actor.role !== "admin" && dealershipId === null) {
      return Response.json({ error: "Selecione a concessionária deste usuário." }, { status: 400 });
    }
    const passwordError = validatePassword(payload.password ?? "");
    if (passwordError) {
      return Response.json({ error: passwordError }, { status: 400 });
    }
    if (!(await canManage(actor, role, dealershipId))) return forbidden();

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

    const currentRole = normalizeUserRole(target.email, target.role) ?? "user";
    const role = payload.role && ROLES.includes(payload.role) ? payload.role : currentRole;
    const dealershipId =
      role === "dealer_manager"
        ? Number(payload.dealershipId ?? target.dealershipId) || null
        : Number(payload.dealershipId ?? target.dealershipId) || null;
    const changesPosition =
      (payload.role !== undefined && payload.role !== currentRole) ||
      (payload.dealershipId !== undefined && dealershipId !== (target.dealershipId ?? null));
    if (changesPosition && actor.role !== "admin") {
      return forbidden("Somente o ADM pode atribuir ou alterar posições.");
    }
    if (email === MASTER_ADMIN_EMAIL && (role !== "admin" || payload.active === false)) {
      return Response.json({ error: "O ADM principal não pode ser reclassificado ou desativado." }, { status: 409 });
    }
    if (email !== MASTER_ADMIN_EMAIL && role === "admin") {
      return forbidden("Nenhum outro usuário pode receber a posição ADM.");
    }
    if (role === "dealer_manager" && dealershipId === null) {
      return Response.json({ error: "Selecione a concessionária deste gestor." }, { status: 400 });
    }
    if (!(await canManage(actor, currentRole, target.dealershipId ?? null))) {
      return forbidden();
    }
    if (!(await canManage(actor, role, dealershipId))) return forbidden();
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
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Erro ao atualizar acesso." },
      { status: 500 },
    );
  }
}
