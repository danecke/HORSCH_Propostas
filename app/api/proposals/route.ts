import { and, desc, eq, inArray, lt } from "drizzle-orm";
import { getDb } from "../../../db";
import { dealerships, proposalItems, proposals, users } from "../../../db/schema";
import {
  canCreateProposal,
  getAccessProfile,
  normalizeUserRole,
  roleLabel,
  type AccessProfile,
} from "../../../lib/access";
import {
  sendProposalEmail,
  type ProposalEmailResult,
} from "../../../lib/proposal-email";

export const dynamic = "force-dynamic";

const VALID_STATUSES = new Set([
  "draft",
  "sent",
  "counteroffer",
  "approved",
  "rejected",
  "expired",
]);

const EXPIRABLE_STATUSES = ["draft", "sent", "counteroffer"];

type ItemInput = {
  partNumber?: string;
  description?: string;
  vt?: string;
  origin?: string;
  ncm?: string;
  quantity?: number;
  unitPriceCents?: number;
};

type ProposalInput = {
  dealershipId?: number | null;
  dealership?: string;
  city?: string;
  state?: string;
  contactName?: string;
  contactEmail?: string;
  factoryManagerEmail?: string;
  validUntil?: string;
  status?: string;
  items?: ItemInput[];
};

type CounterofferItemInput = {
  id?: number;
  quantity?: number;
  unitPriceCents?: number;
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
  if (profile.role === "dealer_manager") {
    return dealer.id === profile.dealershipId;
  }
  return false;
}

type UserRecord = typeof users.$inferSelect;

function activeUserWithRole(
  records: UserRecord[],
  role: "factory_manager" | "dealer_manager",
  predicate: (record: UserRecord) => boolean,
) {
  return records.find(
    (record) =>
      record.active && normalizeUserRole(record.email, record.role) === role && predicate(record),
  );
}

function normalizeItems(items: ItemInput[]) {
  return items.map((item) => ({
    partNumber: item.partNumber?.trim() ?? "",
    description: item.description?.trim() ?? "",
    vt: item.vt?.trim() ?? "",
    origin: item.origin?.trim() ?? "",
    ncm: item.ncm?.trim() ?? "",
    quantity: Math.max(1, Math.trunc(Number(item.quantity) || 1)),
    unitPriceCents: Math.max(0, Math.trunc(Number(item.unitPriceCents) || 0)),
  }));
}

function itemValidationError(items: ReturnType<typeof normalizeItems>) {
  if (!items.length) return "Adicione ao menos um item à proposta.";
  const incomplete = items.find(
    (item) =>
      !item.partNumber ||
      !item.description ||
      !item.vt ||
      !item.origin ||
      !item.ncm ||
      !item.unitPriceCents,
  );
  if (incomplete) {
    return "Preencha PN, descrição, VT, origem, NCM e net price em todos os itens.";
  }
  return "";
}

function deliveryDatabasePatch(delivery: ProposalEmailResult) {
  return {
    status: delivery.status === "sent" ? "sent" : "draft",
    emailStatus: delivery.status,
    emailSentAt: delivery.status === "sent" ? new Date().toISOString() : null,
    emailError: delivery.error ?? "",
    updatedAt: new Date().toISOString(),
  };
}

function currentBusinessDate(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

async function expireOverdueProposals(db: Awaited<ReturnType<typeof getDb>>) {
  const now = new Date();
  await db
    .update(proposals)
    .set({
      status: "expired",
      updatedAt: now.toISOString(),
    })
    .where(
      and(
        inArray(proposals.status, EXPIRABLE_STATUSES),
        lt(proposals.validUntil, currentBusinessDate(now)),
      ),
    );
}

function expiredProposalResponse(validUntil: string) {
  return Response.json(
    {
      error: `A vigência desta proposta terminou em ${validUntil}. Propostas expiradas não podem ser movimentadas.`,
    },
    { status: 409 },
  );
}

export async function GET() {
  const profile = await getAccessProfile();
  if (!profile) return forbidden();

  try {
    const db = await getDb();
    await expireOverdueProposals(db);
    const [allDealers, allUsers] = await Promise.all([
      db.select().from(dealerships).orderBy(dealerships.name),
      db.select().from(users).orderBy(users.name, users.email),
    ]);
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
        contactEmail: proposals.contactEmail,
        dealershipContactEmail: dealerships.contactEmail,
        factoryManagerEmail: dealerships.factoryManagerEmail,
        commercialOwner: proposals.commercialOwner,
        status: proposals.status,
        issueDate: proposals.issueDate,
        validUntil: proposals.validUntil,
        totalCents: proposals.totalCents,
        counterofferCents: proposals.counterofferCents,
        decisionNote: proposals.decisionNote,
        decidedByEmail: proposals.decidedByEmail,
        counterofferPaymentTerms: proposals.counterofferPaymentTerms,
        counterofferFreightTerms: proposals.counterofferFreightTerms,
        counterofferDeliveryTerms: proposals.counterofferDeliveryTerms,
        counterofferSubmittedAt: proposals.counterofferSubmittedAt,
        counterofferReviewedAt: proposals.counterofferReviewedAt,
        counterofferReviewedByEmail: proposals.counterofferReviewedByEmail,
        counterofferReviewNote: proposals.counterofferReviewNote,
        emailStatus: proposals.emailStatus,
        emailSentAt: proposals.emailSentAt,
        emailError: proposals.emailError,
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

    const proposalData = rows.map(({ dealershipContactEmail, ...row }) => ({
      ...row,
      contactEmail: row.contactEmail || dealershipContactEmail,
      items: itemsByProposal.get(row.id) ?? [],
    }));
    const dealershipData = visibleDealers.map((dealer) => {
      const dealerProposals = rows.filter((row) => row.dealershipId === dealer.id);
      const factoryManager = activeUserWithRole(
        allUsers,
        "factory_manager",
        (record) => record.email === dealer.factoryManagerEmail.toLowerCase(),
      );
      const dealerManager = activeUserWithRole(
        allUsers,
        "dealer_manager",
        (record) => record.dealershipId === dealer.id,
      );
      return {
        ...dealer,
        contactName: dealerManager?.name || dealer.contactName,
        contactEmail: dealerManager?.email || dealer.contactEmail,
        factoryManagerName: factoryManager?.name || "",
        dealerManagerName: dealerManager?.name || dealer.contactName,
        dealerManagerEmail: dealerManager?.email || dealer.contactEmail,
        proposals: dealerProposals.length,
        approved: dealerProposals.filter((row) => row.status === "approved").length,
        totalCents: dealerProposals.reduce((sum, row) => sum + row.totalCents, 0),
        lastProposalAt: dealerProposals[0]?.createdAt ?? dealer.createdAt,
      };
    });

    const visibleUsers = allUsers.filter((record) => {
      const recordRole = normalizeUserRole(record.email, record.role) ?? "user";
      if (profile.role === "admin") return true;
      if (record.email === profile.email) return true;
      if (profile.role === "dealer_manager") {
        return (
          ["user", "dealer_manager"].includes(recordRole) &&
          record.dealershipId === profile.dealershipId
        );
      }
      return (
        ["user", "dealer_manager"].includes(recordRole) &&
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
          manageAccess: profile.role !== "user",
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
    const requestedStatus = payload.status === "sent" ? "sent" : "draft";
    const validItems = normalizeItems(payload.items ?? []);
    const validationError = itemValidationError(validItems);
    if (validationError) {
      return Response.json({ error: validationError }, { status: 400 });
    }

    const db = await getDb();
    const dealershipIdInput = Math.trunc(Number(payload.dealershipId) || 0);
    const dealershipName = payload.dealership?.trim() ?? "";
    const [existingDealer] = dealershipIdInput
      ? await db.select().from(dealerships).where(eq(dealerships.id, dealershipIdInput)).limit(1)
      : dealershipName
        ? await db.select().from(dealerships).where(eq(dealerships.name, dealershipName)).limit(1)
        : [];

    if (!existingDealer && !dealershipName) {
      return Response.json({ error: "Informe a concessionária." }, { status: 400 });
    }
    if (existingDealer && !dealerIsVisible(profile, existingDealer)) return forbidden();

    const assignedManagerEmail = existingDealer
      ? existingDealer.factoryManagerEmail.toLowerCase() ||
        (profile.role === "factory_manager"
          ? profile.email
          : payload.factoryManagerEmail?.trim().toLowerCase() ?? "")
      : profile.role === "factory_manager"
        ? profile.email
        : payload.factoryManagerEmail?.trim().toLowerCase() ?? "";

    let dealer = existingDealer;
    if (!dealer) {
      const [createdDealer] = await db
        .insert(dealerships)
        .values({
          name: dealershipName,
          city: payload.city?.trim() ?? "",
          state: payload.state?.trim().toUpperCase().slice(0, 2) ?? "",
          contactName: payload.contactName?.trim() ?? "",
          contactEmail: payload.contactEmail?.trim().toLowerCase() ?? "",
          factoryManagerEmail: assignedManagerEmail,
        })
        .returning();
      dealer = createdDealer;
    } else if (
      (!dealer.factoryManagerEmail && assignedManagerEmail) ||
      (!dealer.contactName && payload.contactName?.trim()) ||
      (!dealer.contactEmail && payload.contactEmail?.trim())
    ) {
      const [updatedDealer] = await db
        .update(dealerships)
        .set({
          factoryManagerEmail: dealer.factoryManagerEmail || assignedManagerEmail,
          contactName: dealer.contactName || payload.contactName?.trim() || "",
          contactEmail:
            dealer.contactEmail || payload.contactEmail?.trim().toLowerCase() || "",
        })
        .where(eq(dealerships.id, dealer.id))
        .returning();
      dealer = updatedDealer;
    }

    const allUsers = await db.select().from(users).orderBy(users.name, users.email);
    const factoryManager = activeUserWithRole(
      allUsers,
      "factory_manager",
      (record) => record.email === assignedManagerEmail,
    );
    const dealerManager = activeUserWithRole(
      allUsers,
      "dealer_manager",
      (record) => record.dealershipId === dealer.id,
    );
    const contactName = dealerManager?.name || dealer.contactName || payload.contactName?.trim() || "";
    const contactEmail = (
      dealerManager?.email ||
      dealer.contactEmail ||
      payload.contactEmail ||
      ""
    )
      .trim()
      .toLowerCase();
    const commercialOwner =
      factoryManager?.name ||
      (assignedManagerEmail === profile.email ? profile.name : "Equipe Comercial HORSCH");
    const commercialOwnerEmail = assignedManagerEmail || profile.email;

    if (requestedStatus === "sent" && !contactEmail) {
      return Response.json(
        { error: "Cadastre o e-mail do responsável da concessionária antes de enviar." },
        { status: 400 },
      );
    }

    const now = new Date();
    const issueDate = currentBusinessDate(now);
    const defaultValidity = new Date(`${issueDate}T12:00:00Z`);
    defaultValidity.setUTCDate(defaultValidity.getUTCDate() + 30);
    const id = proposalNumber(now);
    const validUntil = payload.validUntil || defaultValidity.toISOString().slice(0, 10);
    if (validUntil < currentBusinessDate(now)) {
      return Response.json(
        { error: "A data de vigência não pode estar vencida." },
        { status: 400 },
      );
    }
    const totalCents = validItems.reduce(
      (sum, item) => sum + item.quantity * item.unitPriceCents,
      0,
    );
    await db.insert(proposals).values({
      id,
      dealershipId: dealer.id,
      contactName,
      contactEmail,
      commercialOwner,
      status: "draft",
      issueDate,
      validUntil,
      totalCents,
      emailStatus: requestedStatus === "sent" ? "processing" : "not_requested",
      createdByEmail: profile.email,
      createdByName: profile.name,
    });
    await db.insert(proposalItems).values(
      validItems.map((item) => ({
        proposalId: id,
        partNumber: item.partNumber,
        description: item.description,
        vt: item.vt,
        origin: item.origin,
        ncm: item.ncm,
        quantity: item.quantity,
        unitPriceCents: item.unitPriceCents,
      })),
    );

    if (requestedStatus === "draft") {
      return Response.json({ id, status: "draft" }, { status: 201 });
    }

    const delivery = await sendProposalEmail({
      id,
      dealership: dealer.name,
      recipientName: contactName,
      recipientEmail: contactEmail,
      commercialOwner,
      commercialOwnerEmail,
      issueDate,
      validUntil,
      totalCents,
      items: validItems,
      portalUrl: new URL("/", request.url).toString(),
    });
    await db
      .update(proposals)
      .set(deliveryDatabasePatch(delivery))
      .where(eq(proposals.id, id));
    return Response.json(
      { id, status: delivery.status === "sent" ? "sent" : "draft", delivery },
      { status: 201 },
    );
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
      action?: "send" | "accept_counteroffer" | "return_counteroffer";
      status?: string;
      counterofferCents?: number;
      decisionNote?: string;
      counterofferItems?: CounterofferItemInput[];
      counterofferPaymentTerms?: string;
      counterofferFreightTerms?: string;
      counterofferDeliveryTerms?: string;
      counterofferReviewNote?: string;
    };
    if (!payload.id) {
      return Response.json({ error: "Informe a proposta." }, { status: 400 });
    }
    const db = await getDb();
    await expireOverdueProposals(db);
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
    if (record.proposal.status === "expired") {
      return expiredProposalResponse(record.proposal.validUntil);
    }

    if (payload.action === "send") {
      if (!["admin", "factory_manager"].includes(profile.role)) return forbidden();
      const recipientEmail = record.proposal.contactEmail || record.dealer.contactEmail;
      if (!recipientEmail) {
        return Response.json(
          { error: "O responsável da concessionária não possui e-mail cadastrado." },
          { status: 400 },
        );
      }
      const items = await db
        .select()
        .from(proposalItems)
        .where(eq(proposalItems.proposalId, payload.id));
      const delivery = await sendProposalEmail({
        id: record.proposal.id,
        dealership: record.dealer.name,
        recipientName: record.proposal.contactName || record.dealer.contactName,
        recipientEmail,
        commercialOwner: record.proposal.commercialOwner,
        commercialOwnerEmail:
          record.dealer.factoryManagerEmail || record.proposal.createdByEmail,
        issueDate: record.proposal.issueDate,
        validUntil: record.proposal.validUntil,
        totalCents: record.proposal.totalCents,
        items,
        portalUrl: new URL("/", request.url).toString(),
      });
      await db
        .update(proposals)
        .set(deliveryDatabasePatch(delivery))
        .where(eq(proposals.id, payload.id));
      return Response.json({
        ok: delivery.status === "sent",
        status: delivery.status === "sent" ? "sent" : "draft",
        delivery,
      });
    }

    if (
      payload.action === "accept_counteroffer" ||
      payload.action === "return_counteroffer"
    ) {
      if (!["admin", "factory_manager"].includes(profile.role)) return forbidden();
      if (record.proposal.status !== "counteroffer" || !record.proposal.counterofferCents) {
        return Response.json(
          { error: "Esta proposta não possui contraproposta aguardando análise." },
          { status: 409 },
        );
      }
      const accepted = payload.action === "accept_counteroffer";
      await db
        .update(proposals)
        .set({
          status: accepted ? "approved" : "sent",
          totalCents: accepted
            ? record.proposal.counterofferCents
            : record.proposal.totalCents,
          counterofferReviewedAt: new Date().toISOString(),
          counterofferReviewedByEmail: profile.email,
          counterofferReviewNote: payload.counterofferReviewNote?.trim() ?? "",
          updatedAt: new Date().toISOString(),
        })
        .where(eq(proposals.id, payload.id));
      return Response.json({
        ok: true,
        status: accepted ? "approved" : "sent",
        counterofferCents: record.proposal.counterofferCents,
      });
    }

    if (!VALID_STATUSES.has(payload.status ?? "")) {
      return Response.json({ error: "Status inválido." }, { status: 400 });
    }
    const nextStatus = payload.status!;
    if (nextStatus === "expired") {
      return Response.json(
        { error: "O status Expirada é definido automaticamente pela data de vigência." },
        { status: 409 },
      );
    }
    if (nextStatus === "sent" && record.proposal.status !== "sent") {
      return Response.json(
        { error: "Use a ação Enviar por e-mail para registrar o envio da proposta." },
        { status: 409 },
      );
    }
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
    let counterofferCents = record.proposal.counterofferCents;
    if (nextStatus === "counteroffer") {
      const note = payload.decisionNote?.trim() ?? "";
      const paymentTerms = payload.counterofferPaymentTerms?.trim() ?? "";
      const freightTerms = payload.counterofferFreightTerms?.trim() ?? "";
      const deliveryTerms = payload.counterofferDeliveryTerms?.trim() ?? "";
      if (!note) {
        return Response.json(
          { error: "Informe a justificativa da contraproposta." },
          { status: 400 },
        );
      }
      if (!paymentTerms || !freightTerms || !deliveryTerms) {
        return Response.json(
          { error: "Informe pagamento, frete e prazo de entrega da contraproposta." },
          { status: 400 },
        );
      }

      const currentItems = await db
        .select()
        .from(proposalItems)
        .where(eq(proposalItems.proposalId, payload.id));
      const submittedItems = payload.counterofferItems ?? [];
      const submittedById = new Map(
        submittedItems.map((item) => [Math.trunc(Number(item.id) || 0), item]),
      );
      if (
        submittedItems.length !== currentItems.length ||
        currentItems.some((item) => !submittedById.has(item.id))
      ) {
        return Response.json(
          { error: "Revise todos os itens antes de enviar a contraproposta." },
          { status: 400 },
        );
      }

      const normalizedCounterItems = currentItems.map((item) => {
        const submitted = submittedById.get(item.id)!;
        return {
          id: item.id,
          quantity: Math.max(1, Math.trunc(Number(submitted.quantity) || 0)),
          unitPriceCents: Math.max(
            0,
            Math.trunc(Number(submitted.unitPriceCents) || 0),
          ),
        };
      });
      if (normalizedCounterItems.some((item) => !item.unitPriceCents)) {
        return Response.json(
          { error: "Informe quantidade e net price propostos para todos os itens." },
          { status: 400 },
        );
      }

      counterofferCents = normalizedCounterItems.reduce(
        (sum, item) => sum + item.quantity * item.unitPriceCents,
        0,
      );
      await Promise.all(
        normalizedCounterItems.map((item) =>
          db
            .update(proposalItems)
            .set({
              counterofferQuantity: item.quantity,
              counterofferUnitPriceCents: item.unitPriceCents,
            })
            .where(eq(proposalItems.id, item.id)),
        ),
      );
      await db
        .update(proposals)
        .set({
          status: "counteroffer",
          counterofferCents,
          decisionNote: note,
          decidedByEmail: profile.email,
          counterofferPaymentTerms: paymentTerms,
          counterofferFreightTerms: freightTerms,
          counterofferDeliveryTerms: deliveryTerms,
          counterofferSubmittedAt: new Date().toISOString(),
          counterofferReviewedAt: null,
          counterofferReviewedByEmail: "",
          counterofferReviewNote: "",
          updatedAt: new Date().toISOString(),
        })
        .where(eq(proposals.id, payload.id));
      return Response.json({ ok: true, status: "counteroffer", counterofferCents });
    }

    await db
      .update(proposals)
      .set({
        status: nextStatus,
        counterofferCents,
        decisionNote:
          profile.role === "dealer_manager"
            ? payload.decisionNote?.trim() ?? ""
            : record.proposal.decisionNote,
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
    await expireOverdueProposals(db);
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
