import { eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { dealerships, users } from "../../../db/schema";
import { getAccessProfile, ROLES, type UserRole } from "../../../lib/access";

export const dynamic = "force-dynamic";

type AccessInput = {
  email?: string;
  name?: string;
  role?: UserRole;
  dealershipId?: number | null;
  active?: boolean;
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
  if (role !== "dealer_manager" || dealershipId === null) return false;
  if (actor.role === "dealer_manager") return actor.dealershipId === dealershipId;

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
    const role = payload.role;
    const dealershipId = role === "dealer_manager" ? Number(payload.dealershipId) || null : null;
    if (!email || !email.includes("@") || !name || !role || !ROLES.includes(role)) {
      return Response.json({ error: "Preencha nome, e-mail e perfil corretamente." }, { status: 400 });
    }
    if (role === "dealer_manager" && dealershipId === null) {
      return Response.json({ error: "Selecione a concessionária deste acesso." }, { status: 400 });
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

    const role = payload.role && ROLES.includes(payload.role) ? payload.role : (target.role as UserRole);
    const dealershipId =
      role === "dealer_manager"
        ? Number(payload.dealershipId ?? target.dealershipId) || null
        : null;
    if (!(await canManage(actor, target.role as UserRole, target.dealershipId ?? null))) {
      return forbidden();
    }
    if (!(await canManage(actor, role, dealershipId))) return forbidden();
    if (email === actor.email && payload.active === false) {
      return Response.json({ error: "Você não pode desativar o próprio acesso." }, { status: 409 });
    }

    if (target.role === "admin" && (payload.active === false || role !== "admin")) {
      const activeAdmins = (await db.select().from(users)).filter(
        (record) => record.role === "admin" && record.active,
      );
      if (activeAdmins.length <= 1) {
        return Response.json({ error: "O sistema precisa manter ao menos um ADM ativo." }, { status: 409 });
      }
    }

    await db
      .update(users)
      .set({
        name: payload.name?.trim() || target.name,
        role,
        dealershipId,
        active: payload.active ?? target.active,
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
