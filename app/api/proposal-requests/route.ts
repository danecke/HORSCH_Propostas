import { desc, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { dealerships, proposalRequests, users } from "../../../db/schema";
import { recordAudit } from "../../../lib/audit";
import { getAccessProfile, isModuleEnabled, normalizeUserRole, profileHasDealership } from "../../../lib/access";

export const dynamic = "force-dynamic";

function forbidden() {
  return Response.json({ error: "Seu perfil não possui acesso às solicitações de proposta." }, { status: 403 });
}

function statusLabel(status: string) {
  return ({
    requested: "Aguardando Gestão Global",
    responded: "Retornada pela Gestão Global",
    rejected: "Encerrada",
  } as Record<string, string>)[status] || status;
}

function canSee(profile: NonNullable<Awaited<ReturnType<typeof getAccessProfile>>>, dealer: { id: number; factoryManagerEmail: string }) {
  if (["general_admin", "global_management"].includes(profile.role)) return true;
  if (profile.role === "factory_manager") return profileHasDealership(profile, dealer.id) || dealer.factoryManagerEmail.toLowerCase() === profile.email.toLowerCase();
  return profile.role === "dealer_manager" && profileHasDealership(profile, dealer.id);
}

function errorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "Erro inesperado.";
  return message.includes("no such table") ? "A estrutura de solicitações ainda está sendo preparada. Tente novamente." : message;
}

export async function GET() {
  const profile = await getAccessProfile();
  if (!profile || profile.role === "concession") return forbidden();
  try {
    const db = await getDb();
    const allUsers = await db.select().from(users);
    const rows = await db
      .select({ request: proposalRequests, dealership: dealerships })
      .from(proposalRequests)
      .innerJoin(dealerships, eq(proposalRequests.dealershipId, dealerships.id))
      .orderBy(desc(proposalRequests.updatedAt), desc(proposalRequests.requestedAt));

    const visibleRows = (await Promise.all(rows
      .filter(({ dealership }) => canSee(profile, dealership))
      .map(async (row) => (await isModuleEnabled(db, row.dealership.id, "proposals")) ? row : null)))
      .filter((row): row is (typeof rows)[number] => row !== null);
    return Response.json({
      requests: visibleRows
        .map(({ request, dealership }) => {
          const requester = allUsers.find((user) => user.email.toLowerCase() === request.requestedByEmail.toLowerCase());
          const actionOwner = request.actionOwnerEmail.trim().toLowerCase() === profile.email.trim().toLowerCase();
          return {
            ...request,
            dealership: dealership.name,
            city: dealership.city,
            state: dealership.state,
            requestedByName: requester?.name || request.requestedByName,
            statusLabel: statusLabel(request.status),
            isActionOwner: actionOwner,
            actionOwnerName: actionOwner ? (allUsers.find((user) => user.email.toLowerCase() === request.actionOwnerEmail.toLowerCase())?.name || "Você") : "",
            actionOwnerEmail: actionOwner ? request.actionOwnerEmail : "",
          };
        }),
    });
  } catch (error) {
    return Response.json({ error: errorMessage(error) }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const profile = await getAccessProfile();
  if (!profile || profile.role !== "dealer_manager") return forbidden();
  try {
    const payload = (await request.json()) as {
      partNumber?: string;
      description?: string;
      targetNetPriceCents?: number;
      observation?: string;
    };
    const partNumber = payload.partNumber?.trim() || "";
    const description = payload.description?.trim() || "";
    const targetNetPriceCents = Math.trunc(Number(payload.targetNetPriceCents) || 0);
    if (!partNumber || !description || targetNetPriceCents <= 0) {
      return Response.json({ error: "Informe PN, descrição e net price objetivo." }, { status: 400 });
    }
    if (!profile.dealershipId) return Response.json({ error: "Usuário sem concessionária vinculada." }, { status: 400 });

    const db = await getDb();
    const [dealer] = await db.select().from(dealerships).where(eq(dealerships.id, profile.dealershipId)).limit(1);
    if (!dealer) return Response.json({ error: "Concessionária não encontrada." }, { status: 404 });
    if (!(await isModuleEnabled(db, dealer.id, "proposals"))) return forbidden("O módulo Propostas não está habilitado para esta concessionária.");
    const allUsers = await db.select().from(users);
    const globalUser = allUsers.find((user) => user.active && normalizeUserRole(user.email, user.role) === "global_management");
    if (!globalUser) return Response.json({ error: "Não há Gestão Global ativa para receber a solicitação." }, { status: 409 });

    const now = new Date().toISOString();
    const id = "PROP-REQ-" + Date.now().toString(36).toUpperCase();
    await db.insert(proposalRequests).values({
      id,
      dealershipId: dealer.id,
      requestedByEmail: profile.email,
      requestedByName: profile.name,
      partNumber,
      description,
      targetNetPriceCents,
      observation: payload.observation?.trim() || "",
      status: "requested",
      actionOwnerEmail: globalUser.email,
      requestedAt: now,
      updatedAt: now,
    });
    await recordAudit(db, {
      actorEmail: profile.email,
      actorName: profile.name,
      action: "proposal_request_created",
      entity: "proposal_request",
      details: `Solicitação ${id} enviada à Gestão Global para o PN ${partNumber}.`,
      after: { id, dealership: dealer.name, partNumber, description, targetNetPriceCents, observation: payload.observation?.trim() || "" },
    });
    return Response.json({ id, status: "requested" }, { status: 201 });
  } catch (error) {
    return Response.json({ error: errorMessage(error) }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const profile = await getAccessProfile();
  if (!profile || !["general_admin", "global_management"].includes(profile.role)) return forbidden();
  try {
    const payload = (await request.json()) as {
      id?: string;
      action?: "respond" | "reject";
      responseNetPriceCents?: number;
      responseObservation?: string;
    };
    if (!payload.id || !payload.action) return Response.json({ error: "Informe a ação da solicitação." }, { status: 400 });
    const db = await getDb();
    const [record] = await db
      .select({ request: proposalRequests, dealership: dealerships })
      .from(proposalRequests)
      .innerJoin(dealerships, eq(proposalRequests.dealershipId, dealerships.id))
      .where(eq(proposalRequests.id, payload.id))
      .limit(1);
    if (!record || !canSee(profile, record.dealership)) return forbidden();
    if (!(await isModuleEnabled(db, record.dealership.id, "proposals"))) return forbidden("O módulo Propostas não está habilitado para esta concessionária.");
    if (record.request.actionOwnerEmail.trim().toLowerCase() !== profile.email.trim().toLowerCase()) {
      return Response.json({ error: "Esta solicitação está atribuída a outro responsável." }, { status: 403 });
    }
    if (record.request.status !== "requested") return Response.json({ error: "Esta solicitação já foi encerrada." }, { status: 409 });

    const now = new Date().toISOString();
    if (payload.action === "respond") {
      const responseNetPriceCents = Math.trunc(Number(payload.responseNetPriceCents) || 0);
      if (responseNetPriceCents <= 0) return Response.json({ error: "Informe o net price retornado." }, { status: 400 });
      await db.update(proposalRequests).set({
        status: "responded",
        responseNetPriceCents,
        responseObservation: payload.responseObservation?.trim() || "",
        respondedByEmail: profile.email,
        respondedAt: now,
        updatedAt: now,
        actionOwnerEmail: "",
      }).where(eq(proposalRequests.id, payload.id));
    } else {
      await db.update(proposalRequests).set({
        status: "rejected",
        responseObservation: payload.responseObservation?.trim() || "Solicitação encerrada pela Gestão Global.",
        respondedByEmail: profile.email,
        respondedAt: now,
        updatedAt: now,
        actionOwnerEmail: "",
      }).where(eq(proposalRequests.id, payload.id));
    }
    await recordAudit(db, {
      actorEmail: profile.email,
      actorName: profile.name,
      action: `proposal_request_${payload.action}`,
      entity: "proposal_request",
      details: `Solicitação ${payload.id} atualizada pela Gestão Global.`,
      before: { status: record.request.status },
      after: { status: payload.action === "respond" ? "responded" : "rejected", responseNetPriceCents: payload.responseNetPriceCents || null, responseObservation: payload.responseObservation?.trim() || "" },
    });
    return Response.json({ ok: true, status: payload.action === "respond" ? "responded" : "rejected" });
  } catch (error) {
    return Response.json({ error: errorMessage(error) }, { status: 500 });
  }
}
