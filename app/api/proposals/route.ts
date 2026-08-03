import { desc, eq, inArray } from "drizzle-orm";
import { getDb } from "../../../db";
import { dealerships, proposalItems, proposals, users } from "../../../db/schema";
import {
  canCreateProposal,
  getAccessProfile,
  normalizeUserRole,
  roleLabel,
  type AccessProfile,
} from "../../../lib/access";

export const dynamic = "force-dynamic";

const VALID_STATUSES = new Set([
  "draft",
  "sent",
  "counteroffer",
  "approved",
  "rejected",
  "expired",
]);

type ItemInput = {
  partNumber?: string;
  description?: string;
  ncm?: string;
  quantity?: number;
  unitPriceCents?: number;
};

type ProposalInput = {
  dealership?: string;
  city?: string;
  state?: string;
  contactName?: string;
  contactEmail?: string;
  commercialOwner?: string;
  factoryManagerEmail?: string;
  validUntil?: string;
  status?: string;
  items?: ItemInput[];
};

function apiError(error: unknown) {
  const message = error instanceof Error ? error.message : "Erro inesperado";
  const detail =
    error instanceof Error && error.cause instanceof Error ? error.cause.message : "";
  if (`${message}\n${detail}`.includes("no such table")) {
    return "O banco de dados ainda está sendo preparado. Aguarde alguns instantes e tente novamente.";
  }
  return message;
}

function forbidden() {
  return Response.json(
    { error: "Seu acesso ainda não foi liberado ou está inativo." },
    { status: 403 },
  );
}

function dealerIsVisible(
  profile: AccessProfile,
  dealer: { id: number; factoryManagerEmail: string },
) {
  if (profile.role === "admin") return true;
  if (profile.role === "factory_manager") {
    return dealer.factoryManagerEmail.toLowerCase() === profile.email;
  }
  return dealer.id === profile.dealershipId;
}

export async function GET() {
  const profile = await getAccessProfile();
  if (!profile) return forbidden();

  try {
    const db = await getDb();
    const allDealers = await db.select().from(dealerships).orderBy(dealerships.name);
    const visibleDealers = allDealers.filter((dealer) => dealerIsVisible(profile, dealer));
    const visibleDealerIds = new Set(visibleDealers.map((dealer) => dealer.id));

    const allRows = await db
      .select({
        id: proposals.id,
        dealershipId: proposals.dealershipId,
        dealership: dealerships.name,
        city: dealerships.city,
        state: dealerships.state,
        contactName: proposals.contactName,
        contactEmail: dealerships.contactEmail,
        factoryManagerEmail: dealerships.factoryManagerEmail,
        commercialOwner: proposals.commercialOwner,
        status: proposals.status,
        issueDate: proposals.issueDate,
        validUntil: proposals.validUntil,
        totalCents: proposals.totalCents,
        counterofferCents: proposals.counterofferCents,
        decisionNote: proposals.decisionNote,
        decidedByEmail: proposals.decidedByEmail,
        createdByEmail: proposals.createdByEmail,
        createdAt: proposals.createdAt,
        updatedAt: proposals.updatedAt,
      })
      .from(proposals)
      .innerJoin(dealerships, eq(proposals.dealershipId, dealerships.id))
      .orderBy(desc(proposals.createdAt), desc(proposals.id));
    const rows = allRows.filter((row) => visibleDealerIds.has(row.dealershipId));

    const itemRows = rows.length
      ? await db
          .select()
          .from(proposalItems)
          .where(inArray(proposalItems.proposalId, rows.map((row) => row.id)))
      : [];
    const itemsByProposal = new Map<string, typeof itemRows>();
    for (const item of itemRows) {
      const current = itemsByProposal.get(item.proposalId) ?? [];
      current.push(item);
      itemsByProposal.set(item.proposalId, current);
    }

    const proposalData = rows.map((row) => ({
      ...row,
      items: itemsByProposal.get(row.id) ?? [],
    }));
    const dealershipData = visibleDealers.map((dealer) => {
      const dealerProposals = rows.filter((row) => row.dealershipId === dealer.id);
      return {
        ...dealer,
        proposals: dealerProposals.length,
        approved: dealerProposals.filter((row) => row.status === "approved").length,
        totalCents: dealerProposals.reduce((sum, row) => sum + row.totalCents, 0),
        lastProposalAt: dealerProposals[0]?.createdAt ?? dealer.createdAt,
      };
    });

    const allUsers = await db.select().from(users).orderBy(users.name, users.email);
    const visibleUsers = allUsers.filter((record) => {
      if (profile.role === "admin") return true;
      if (record.email === profile.email) return true;
      if (profile.role === "dealer_manager") {
        return record.role === "dealer_manager" && record.dealershipId === profile.dealershipId;
      }
      return (
        record.role === "dealer_manager" &&
        record.dealershipId !== null &&
        visibleDealerIds.has(record.dealershipId)
      );
    });

    return Response.json({
      proposals: proposalData,
      dealerships: dealershipData.sort((a, b) => b.totalCents - a.totalCents),
      users: visibleUsers.map((record) => {
        const role = normalizeUserRole(record.email, record.role) ?? "user";
        return {
          email: record.email,
          name: record.name,
          role,
          roleLabel: roleLabel(role),
          dealershipId: record.dealershipId,
          active: record.active,
          credentialReady: Boolean(record.passwordHash),
          createdAt: record.createdAt,
        };
      }),
      me: {
        ...profile,
        roleLabel: roleLabel(profile.role),
        permissions: {
          viewAll: profile.role === "admin",
          createProposal: canCreateProposal(profile),
          manageAllAccess: profile.role === "admin",
          decideProposal: profile.role === "dealer_manager",
          deleteAnyProposal: profile.role === "admin",
          deleteOwnDraft: profile.role === "factory_manager",
        },
      },
    });
  } catch (error) {
    return Response.json({ error: apiError(error) }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const profile = await getAccessProfile();
  if (!profile) return forbidden();
  if (!canCreateProposal(profile)) {
    return Response.json({ error: "Seu perfil não pode criar propostas." }, { status: 403 });
  }

  try {
    const payload = (await request.json()) as ProposalInput;
    const dealershipName = payload.dealership?.trim() ?? "";
    const commercialOwner = payload.commercialOwner?.trim() || profile.name;
    const requestedStatus = payload.status === "sent" ? "sent" : "draft";
    const validItems = (payload.items ?? [])
      .map((item) => ({
        partNumber: item.partNumber?.trim() ?? "",
        description: item.description?.trim() ?? "",
        ncm: item.ncm?.trim() ?? "",
        quantity: Math.max(1, Math.trunc(Number(item.quantity) || 1)),
        unitPriceCents: Math.max(0, Math.trunc(Number(item.unitPriceCents) || 0)),
      }))
      .filter((item) => item.partNumber || item.description);

    if (!dealershipName) {
      return Response.json({ error: "Informe a concessionária." }, { status: 400 });
    }
    if (!validItems.length) {
      return Response.json({ error: "Adicione ao menos um item à proposta." }, { status: 400 });
    }

    const db = await getDb();
    const [existingDealer] = await db
      .select()
      .from(dealerships)
      .where(eq(dealerships.name, dealershipName))
      .limit(1);

    const assignedManager =
      profile.role === "factory_manager"
        ? profile.email
        : payload.factoryManagerEmail?.trim().toLowerCase() ?? "";
    if (
      existingDealer &&
      profile.role === "factory_manager" &&
      existingDealer.factoryManagerEmail.toLowerCase() !== profile.email
    ) {
      return Response.json(
        { error: "Esta concessionária pertence à carteira de outro gestor." },
        { status: 403 },
      );
    }

    let dealershipId = existingDealer?.id;
    if (!dealershipId) {
      const [createdDealer] = await db
        .insert(dealerships)
        .values({
          name: dealershipName,
          city: payload.city?.trim() ?? "",
          state: payload.state?.trim().toUpperCase().slice(0, 2) ?? "",
          contactName: payload.contactName?.trim() ?? "",
          contactEmail: payload.contactEmail?.trim().toLowerCase() ?? "",
          factoryManagerEmail: assignedManager,
        })
        .returning();
      dealershipId = createdDealer.id;
    } else if (
      profile.role === "admin" &&
      assignedManager &&
      assignedManager !== existingDealer?.factoryManagerEmail
    ) {
      await db
        .update(dealerships)
        .set({ factoryManagerEmail: assignedManager })
        .where(eq(dealerships.id, dealershipId));
    }

    const now = new Date();
    const defaultValidity = new Date(now);
    defaultValidity.setDate(defaultValidity.getDate() + 30);
    const id = proposalNumber(now);
    const totalCents = validItems.reduce(
      (sum, item) => sum + item.quantity * item.unitPriceCents,
      0,
    );
    await db.insert(proposals).values({
      id,
      dealershipId,
      contactName: payload.contactName?.trim() ?? "",
      commercialOwner,
      status: requestedStatus,
      issueDate: now.toISOString().slice(0, 10),
      validUntil: payload.validUntil || defaultValidity.toISOString().slice(0, 10),
      totalCents,
      createdByEmail: profile.email,
      createdByName: profile.name,
    });
    await db.insert(proposalItems).values(
      validItems.map((item) => ({
        proposalId: id,
        partNumber: item.partNumber,
        description: item.description,
        origin: item.description.length >= 3 ? item.description.charAt(2) : "",
        ncm: item.ncm,
        quantity: item.quantity,
        unitPriceCents: item.unitPriceCents,
      })),
    );
    return Response.json({ id }, { status: 201 });
  } catch (error) {
    return Response.json({ error: apiError(error) }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const profile = await getAccessProfile();
  if (!profile) return forbidden();

  try {
    const payload = (await request.json()) as {
      id?: string;
      status?: string;
      counterofferCents?: number;
      decisionNote?: string;
    };
    if (!payload.id || !VALID_STATUSES.has(payload.status ?? "")) {
      return Response.json({ error: "Proposta ou status inválido." }, { status: 400 });
    }
    const db = await getDb();
    const [record] = await db
      .select({ proposal: proposals, dealer: dealerships })
      .from(proposals)
      .innerJoin(dealerships, eq(proposals.dealershipId, dealerships.id))
      .where(eq(proposals.id, payload.id))
      .limit(1);
    if (!record) {
      return Response.json({ error: "Proposta não encontrada." }, { status: 404 });
    }
    if (!dealerIsVisible(profile, record.dealer)) return forbidden();

    const nextStatus = payload.status!;
    if (profile.role === "dealer_manager") {
      if (!["approved", "rejected", "counteroffer"].includes(nextStatus)) {
        return Response.json(
          { error: "A concessionária pode aceitar, recusar ou enviar contraproposta." },
          { status: 403 },
        );
      }
      if (!["sent", "counteroffer"].includes(record.proposal.status)) {
        return Response.json(
          { error: "Esta proposta não está aberta para decisão." },
          { status: 409 },
        );
      }
    }
    const counterofferCents =
      nextStatus === "counteroffer"
        ? Math.max(0, Math.trunc(Number(payload.counterofferCents) || 0))
        : null;
    if (nextStatus === "counteroffer" && !counterofferCents) {
      return Response.json(
        { error: "Informe o valor da contraproposta." },
        { status: 400 },
      );
    }

    await db
      .update(proposals)
      .set({
        status: nextStatus,
        counterofferCents,
        decisionNote: payload.decisionNote?.trim() ?? "",
        decidedByEmail: profile.role === "dealer_manager" ? profile.email : "",
        updatedAt: new Date().toISOString(),
      })
      .where(eq(proposals.id, payload.id));
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ error: apiError(error) }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const profile = await getAccessProfile();
  if (!profile) return forbidden();

  try {
    const payload = (await request.json()) as { id?: string };
    if (!payload.id) {
      return Response.json({ error: "Informe a proposta." }, { status: 400 });
    }

    const db = await getDb();
    const [record] = await db
      .select({ proposal: proposals, dealer: dealerships })
      .from(proposals)
      .innerJoin(dealerships, eq(proposals.dealershipId, dealerships.id))
      .where(eq(proposals.id, payload.id))
      .limit(1);
    if (!record) {
      return Response.json({ error: "Proposta não encontrada." }, { status: 404 });
    }
    if (!dealerIsVisible(profile, record.dealer)) return forbidden();

    const canDelete =
      profile.role === "admin" ||
      (profile.role === "factory_manager" &&
        record.proposal.status === "draft" &&
        record.proposal.createdByEmail.toLowerCase() === profile.email);
    if (!canDelete) {
      return Response.json(
        {
          error:
            "Somente o ADM pode excluir propostas enviadas. O Gestor Fábrica pode excluir apenas os próprios rascunhos.",
        },
        { status: 403 },
      );
    }

    await db.batch([
      db.delete(proposalItems).where(eq(proposalItems.proposalId, payload.id)),
      db.delete(proposals).where(eq(proposals.id, payload.id)),
    ]);
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ error: apiError(error) }, { status: 500 });
  }
}

function proposalNumber(date: Date) {
  const stamp = date.toISOString().replace(/[-:T.Z]/g, "").slice(0, 12);
  return `HBR-${stamp}-${crypto.randomUUID().slice(0, 4).toUpperCase()}`;
}
