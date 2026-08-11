import { and, desc, eq, inArray, lt } from "drizzle-orm";
import { getDb } from "../../../db";
import { dealershipModuleAccess, dealerships, proposalDocuments, proposalItems, proposals, users } from "../../../db/schema";
import { recordAudit } from "../../../lib/audit";
import {
  canCreateProposal,
  canBeProposalResponsible,
  getAccessProfile,
  ensureDealershipModules,
  isModuleEnabled,
  MODULE_KEYS,
  normalizeUserRole,
  rolePermissions,
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
  invoiceTotalCents?: number | null;
};

type ProposalInput = {
  dealershipId?: number | null;
  dealership?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  parentDealershipId?: number | null;
  contactName?: string;
  contactEmail?: string;
  factoryManagerEmail?: string;
  validUntil?: string;
  customerName?: string;
  customerSaleValueCents?: number | null;
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
  if (["general_admin", "global_management"].includes(profile.role)) return true;
  if (profile.role === "factory_manager") {
    return dealer.factoryManagerEmail.toLowerCase() === profile.email;
  }
  if (["dealer_manager", "concession"].includes(profile.role)) {
    return profile.role === "dealer_manager" && dealer.id === profile.dealershipId;
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

function proposalActionOwnerEmail(
  proposal: { status: string; commercialOwnerEmail: string; createdByEmail: string; dealershipId: number },
  dealer: { id: number; contactEmail: string },
  allUsers: UserRecord[],
) {
  if (proposal.status === "sent") {
    const dealerManager = activeUserWithRole(allUsers, "dealer_manager", (record) => record.dealershipId === dealer.id);
    return (dealerManager?.email || dealer.contactEmail || "").trim().toLowerCase();
  }
  return (proposal.commercialOwnerEmail || proposal.createdByEmail || "").trim().toLowerCase();
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
    invoiceTotalCents: normalizeOptionalCents(item.invoiceTotalCents),
  }));
}

function normalizeOptionalCents(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const cents = Math.trunc(Number(value));
  return Number.isFinite(cents) && cents > 0 ? cents : null;
}

function normalizePostalCode(value: unknown) {
  return String(value ?? "").replace(/\D/g, "").slice(0, 8);
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

function invoiceTotalValidationError(items: ReturnType<typeof normalizeItems>) {
  const hasInvoiceTotals = items.some((item) => item.invoiceTotalCents !== null);
  return hasInvoiceTotals && items.some((item) => item.invoiceTotalCents === null)
    ? "Preencha o valor total da NF em todos os itens ou remova a coluna opcional."
    : "";
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
    const [allDealers, allUsers, moduleRows] = await Promise.all([
      db.select().from(dealerships).orderBy(dealerships.name),
      db.select().from(users).orderBy(users.name, users.email),
      db.select().from(dealershipModuleAccess),
    ]);
    const visibleDealers = allDealers.filter((dealer) => dealerIsVisible(profile, dealer));
    const proposalDealerIds = new Set((await Promise.all(visibleDealers.map(async (dealer) =>
      (await isModuleEnabled(db, dealer.id, "proposals")) ? dealer.id : null,
    ))).filter((id): id is number => id !== null));

    const allRows = await db
      .select({
        id: proposals.id,
        dealershipId: proposals.dealershipId,
        dealership: dealerships.name,
        city: dealerships.city,
        state: dealerships.state,
        postalCode: dealerships.postalCode,
        parentDealershipId: dealerships.parentDealershipId,
        contactName: proposals.contactName,
        contactEmail: proposals.contactEmail,
        dealershipContactEmail: dealerships.contactEmail,
        factoryManagerEmail: dealerships.factoryManagerEmail,
        commercialOwner: proposals.commercialOwner,
        commercialOwnerEmail: proposals.commercialOwnerEmail,
        status: proposals.status,
        issueDate: proposals.issueDate,
        validUntil: proposals.validUntil,
        totalCents: proposals.totalCents,
        customerName: proposals.customerName,
        customerSaleValueCents: proposals.customerSaleValueCents,
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
    const rows = allRows.filter((row) => proposalDealerIds.has(row.dealershipId));
    const visibleDealerIds = new Set(visibleDealers.map((dealer) => dealer.id));

    const itemRows = rows.length
      ? await db
          .select()
          .from(proposalItems)
          .where(inArray(proposalItems.proposalId, rows.map((row) => row.id)))
      : [];
    const documentRows = rows.length
      ? await db
          .select({
            id: proposalDocuments.id,
            proposalId: proposalDocuments.proposalId,
            category: proposalDocuments.category,
            fileName: proposalDocuments.fileName,
            contentType: proposalDocuments.contentType,
            sizeBytes: proposalDocuments.sizeBytes,
            uploadedByEmail: proposalDocuments.uploadedByEmail,
            uploadedByName: proposalDocuments.uploadedByName,
            createdAt: proposalDocuments.createdAt,
          })
          .from(proposalDocuments)
          .where(inArray(proposalDocuments.proposalId, rows.map((row) => row.id)))
      : [];
    const itemsByProposal = new Map<string, typeof itemRows>();
    for (const item of itemRows) {
      const current = itemsByProposal.get(item.proposalId) ?? [];
      current.push(item);
      itemsByProposal.set(item.proposalId, current);
    }
    const documentsByProposal = new Map<string, typeof documentRows>();
    for (const document of documentRows) {
      const current = documentsByProposal.get(document.proposalId) ?? [];
      current.push(document);
      documentsByProposal.set(document.proposalId, current);
    }

    const dealerById = new Map(allDealers.map((dealer) => [dealer.id, dealer]));
    const proposalData = rows.map(({ dealershipContactEmail, ...row }) => {
      const actionOwnerEmail = proposalActionOwnerEmail(row, dealerById.get(row.dealershipId) || { id: row.dealershipId, contactEmail: dealershipContactEmail }, allUsers);
      return {
        ...row,
        contactEmail: row.contactEmail || dealershipContactEmail,
        parentDealershipName: row.parentDealershipId ? dealerById.get(row.parentDealershipId)?.name || "" : "",
        isActionOwner: actionOwnerEmail === profile.email.trim().toLowerCase(),
        commercialOwnerEmail: row.commercialOwnerEmail || row.createdByEmail,
        items: itemsByProposal.get(row.id) ?? [],
        documents: documentsByProposal.get(row.id) ?? [],
      };
    });
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
        parentDealershipName: dealer.parentDealershipId ? dealerById.get(dealer.parentDealershipId)?.name || "" : "",
        contactName: dealerManager?.name || dealer.contactName,
        contactEmail: dealerManager?.email || dealer.contactEmail,
        factoryManagerName: factoryManager?.name || "",
        dealerManagerName: dealerManager?.name || dealer.contactName,
        dealerManagerEmail: dealerManager?.email || dealer.contactEmail,
        proposals: dealerProposals.length,
        approved: dealerProposals.filter((row) => row.status === "approved").length,
        totalCents: dealerProposals.reduce((sum, row) => sum + row.totalCents, 0),
        lastProposalAt: dealerProposals[0]?.createdAt ?? dealer.createdAt,
        modules: MODULE_KEYS.map((moduleKey) => ({
          key: moduleKey,
          enabled: moduleRows.find((row) => row.dealershipId === dealer.id && row.moduleKey === moduleKey)?.enabled ?? true,
        })),
      };
    });

    const visibleUsers = allUsers.filter((record) => {
      const recordRole = normalizeUserRole(record.email, record.role) ?? "concession";
      if (profile.role === "general_admin") return true;
      if (profile.role === "global_management") {
        return record.email === profile.email || ["factory_manager", "dealer_manager", "concession"].includes(recordRole);
      }
      if (record.email === profile.email) return true;
      if (profile.role === "dealer_manager") {
        return (
          ["concession", "dealer_manager"].includes(recordRole) &&
          record.dealershipId === profile.dealershipId
        );
      }
      return (
        ["concession", "dealer_manager"].includes(recordRole) &&
        record.dealershipId !== null &&
        visibleDealerIds.has(record.dealershipId)
      );
    });

    return Response.json({
      proposals: proposalData,
      dealerships: dealershipData.sort((a, b) => b.totalCents - a.totalCents),
      users: visibleUsers.map((record) => {
        const role = normalizeUserRole(record.email, record.role) ?? "concession";
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
      proposalResponsibles: allUsers
        .filter((record) => {
          const role = normalizeUserRole(record.email, record.role);
          return record.active && Boolean(role && canBeProposalResponsible(role));
        })
        .map((record) => {
          const role = normalizeUserRole(record.email, record.role)!;
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
        permissions: rolePermissions(profile.role),
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
    const invoiceValidationError = invoiceTotalValidationError(validItems);
    if (invoiceValidationError) {
      return Response.json({ error: invoiceValidationError }, { status: 400 });
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

    const allUsers = await db.select().from(users).orderBy(users.name, users.email);
    const requestedManagerEmail = payload.factoryManagerEmail?.trim().toLowerCase() ?? "";
    const assignedManagerEmail =
      requestedManagerEmail ||
      existingDealer?.factoryManagerEmail.trim().toLowerCase() ||
      (profile.role === "factory_manager" ? profile.email : "");
    const assignedManager = allUsers.find((record) => {
      const role = normalizeUserRole(record.email, record.role);
      return record.active && record.email.toLowerCase() === assignedManagerEmail && role && canBeProposalResponsible(role);
    });
    if (!assignedManager) {
      return Response.json(
        { error: "Selecione um responsável HORSCH ativo com nível ADM Geral, Gestão Global ou Gestor Fábrica." },
        { status: 400 },
      );
    }

    let dealer = existingDealer;
    if (dealer && !(await isModuleEnabled(db, dealer.id, "proposals"))) {
      return Response.json({ error: "O módulo Propostas não está habilitado para esta concessionária." }, { status: 403 });
    }
    if (!dealer) {
      if (normalizeUserRole(assignedManager.email, assignedManager.role) !== "factory_manager") {
        return Response.json({ error: "A nova concessionária deve ser atribuída a um Gestor Fábrica responsável pela carteira." }, { status: 400 });
      }
      const postalCode = normalizePostalCode(payload.postalCode);
      const state = payload.state?.trim().toUpperCase().slice(0, 2) || "";
      if (postalCode.length !== 8 || state.length !== 2) {
        return Response.json({ error: "Cadastre CEP válido e UF de atuação antes de criar a proposta." }, { status: 400 });
      }
      const parentDealershipId = payload.parentDealershipId ? Math.trunc(Number(payload.parentDealershipId)) : null;
      if (parentDealershipId) {
        const [parent] = await db.select().from(dealerships).where(eq(dealerships.id, parentDealershipId)).limit(1);
        if (!parent || parent.parentDealershipId !== null) return Response.json({ error: "Selecione uma matriz válida para a filial." }, { status: 400 });
        if (!dealerIsVisible(profile, parent)) return forbidden();
      }
      const [createdDealer] = await db
        .insert(dealerships)
        .values({
          name: dealershipName,
          city: payload.city?.trim() ?? "",
          state,
          postalCode,
          parentDealershipId,
          contactName: payload.contactName?.trim() ?? "",
          contactEmail: payload.contactEmail?.trim().toLowerCase() ?? "",
          factoryManagerEmail: assignedManagerEmail,
        })
        .returning();
      dealer = createdDealer;
      await ensureDealershipModules(db, dealer.id, profile.email);
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
    const commercialOwner = assignedManager.name || "Equipe Comercial HORSCH";
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
    const id = await proposalNumber(db);
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
      commercialOwnerEmail: assignedManagerEmail,
      status: "draft",
      issueDate,
      validUntil,
      totalCents,
      customerName: payload.customerName?.trim() ?? "",
      customerSaleValueCents: normalizeOptionalCents(payload.customerSaleValueCents),
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
    await recordAudit(db, {
      proposalId: id,
      actorEmail: profile.email,
      actorName: profile.name,
      action: "created",
      entity: "proposal",
      details: requestedStatus === "sent" ? "Proposta criada e enviada." : "Proposta criada como rascunho.",
      after: { id, dealershipId: dealer.id, dealership: dealer.name, commercialOwner, status: requestedStatus, validUntil, totalCents, customerName: payload.customerName?.trim() ?? "", customerSaleValueCents: normalizeOptionalCents(payload.customerSaleValueCents), items: validItems },
    });

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
      action?: "send" | "edit" | "accept_counteroffer" | "return_counteroffer";
      status?: string;
      dealershipId?: number | null;
      contactName?: string;
      contactEmail?: string;
      factoryManagerEmail?: string;
      validUntil?: string;
      customerName?: string;
      customerSaleValueCents?: number | null;
      items?: ItemInput[];
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
    if (!(await isModuleEnabled(db, record.dealer.id, "proposals"))) return forbidden("O módulo Propostas não está habilitado para esta concessionária.");
    const expiredEdit = record.proposal.status === "expired" && payload.action === "edit" && ["general_admin", "global_management"].includes(profile.role);
    if (record.proposal.status === "expired" && !expiredEdit) {
      return expiredProposalResponse(record.proposal.validUntil);
    }

    const allUsers = await db.select().from(users).orderBy(users.name, users.email);
    const isActionOwner = proposalActionOwnerEmail(record.proposal, record.dealer, allUsers) === profile.email.trim().toLowerCase();
    const actionRequired = Boolean(payload.action || payload.status);
    if (actionRequired && !isActionOwner && !expiredEdit) {
      return Response.json({ error: "Esta ação está disponível somente para o responsável atual da proposta." }, { status: 403 });
    }

    if (payload.action === "edit") {
      if (!["general_admin", "global_management", "factory_manager"].includes(profile.role)) return Response.json({ error: "Somente ADM Geral, Gestão Global ou Gestor Fábrica podem editar propostas." }, { status: 403 });
      if (record.proposal.status === "expired" && !["general_admin", "global_management"].includes(profile.role)) return Response.json({ error: "Propostas expiradas podem ser reabertas somente pela Gestão Global ou níveis superiores." }, { status: 403 });
      const editedDealershipId = Math.trunc(Number(payload.dealershipId) || record.dealer.id);
      const [editedDealer] = await db.select().from(dealerships).where(eq(dealerships.id, editedDealershipId)).limit(1);
      if (!editedDealer || !dealerIsVisible(profile, editedDealer)) return forbidden();
      if (!(await isModuleEnabled(db, editedDealer.id, "proposals"))) return forbidden("O módulo Propostas não está habilitado para esta concessionária.");
      const requestedManagerEmail = payload.factoryManagerEmail?.trim().toLowerCase() || editedDealer.factoryManagerEmail.toLowerCase();
      const assignedManager = allUsers.find((candidate) => {
        const role = normalizeUserRole(candidate.email, candidate.role);
        return candidate.active && candidate.email.toLowerCase() === requestedManagerEmail && role && canBeProposalResponsible(role);
      });
      if (!assignedManager) return Response.json({ error: "Selecione um responsável HORSCH ativo com nível ADM Geral, Gestão Global ou Gestor Fábrica." }, { status: 400 });
      const validItems = normalizeItems(payload.items ?? []);
      const validationError = itemValidationError(validItems);
      if (validationError) return Response.json({ error: validationError }, { status: 400 });
      const invoiceValidationError = invoiceTotalValidationError(validItems);
      if (invoiceValidationError) return Response.json({ error: invoiceValidationError }, { status: 400 });
      const validUntil = payload.validUntil?.trim() || record.proposal.validUntil;
      if (validUntil < currentBusinessDate()) return Response.json({ error: "A data de vigência não pode estar vencida." }, { status: 400 });
      const currentItems = await db.select().from(proposalItems).where(eq(proposalItems.proposalId, record.proposal.id));
      const before = { id: record.proposal.id, dealershipId: record.proposal.dealershipId, dealership: record.dealer.name, contactName: record.proposal.contactName, contactEmail: record.proposal.contactEmail, commercialOwner: record.proposal.commercialOwner, status: record.proposal.status, validUntil: record.proposal.validUntil, totalCents: record.proposal.totalCents, customerName: record.proposal.customerName, customerSaleValueCents: record.proposal.customerSaleValueCents, items: currentItems };
      const totalCents = validItems.reduce((sum, item) => sum + item.quantity * item.unitPriceCents, 0);
      const customerName = payload.customerName?.trim() ?? "";
      const customerSaleValueCents = normalizeOptionalCents(payload.customerSaleValueCents);
      const now = new Date().toISOString();
      await db.batch([
        db.update(proposals).set({ dealershipId: editedDealer.id, contactName: payload.contactName?.trim() || editedDealer.contactName, contactEmail: (payload.contactEmail?.trim() || editedDealer.contactEmail).toLowerCase(), commercialOwner: assignedManager.name, commercialOwnerEmail: assignedManager.email.toLowerCase(), status: "draft", validUntil, totalCents, customerName, customerSaleValueCents, counterofferCents: null, decisionNote: "", decidedByEmail: "", counterofferPaymentTerms: "", counterofferFreightTerms: "", counterofferDeliveryTerms: "", counterofferSubmittedAt: null, counterofferReviewedAt: null, counterofferReviewedByEmail: "", counterofferReviewNote: "", emailStatus: "not_requested", emailSentAt: null, emailError: "Proposta editada; reenvio necessário.", updatedAt: now }).where(eq(proposals.id, record.proposal.id)),
        db.delete(proposalItems).where(eq(proposalItems.proposalId, record.proposal.id)),
        db.insert(proposalItems).values(validItems.map((item) => ({ proposalId: record.proposal.id, ...item }))),
      ]);
      await recordAudit(db, { proposalId: record.proposal.id, actorEmail: profile.email, actorName: profile.name, action: "edited", entity: "proposal", details: "Proposta editada; voltou para rascunho e exige novo envio.", before, after: { id: record.proposal.id, dealershipId: editedDealer.id, dealership: editedDealer.name, contactName: payload.contactName?.trim() || editedDealer.contactName, contactEmail: (payload.contactEmail?.trim() || editedDealer.contactEmail).toLowerCase(), commercialOwner: assignedManager.name, status: "draft", validUntil, totalCents, customerName, customerSaleValueCents, items: validItems } });
      return Response.json({ ok: true, status: "draft", totalCents });
    }

    if (payload.action === "send") {
      if (!["general_admin", "global_management", "factory_manager"].includes(profile.role)) return forbidden();
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
      await recordAudit(db, { proposalId: payload.id, actorEmail: profile.email, actorName: profile.name, action: "sent", entity: "proposal", details: delivery.status === "sent" ? `Proposta enviada por e-mail para ${recipientEmail}.` : "Tentativa de envio registrada; e-mail não confirmado.", before: { status: record.proposal.status, emailStatus: record.proposal.emailStatus }, after: { status: delivery.status === "sent" ? "sent" : "draft", emailStatus: delivery.status } });
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
      if (!["general_admin", "global_management", "factory_manager"].includes(profile.role)) return forbidden();
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
    await recordAudit(db, { proposalId: payload.id, actorEmail: profile.email, actorName: profile.name, action: "status_changed", entity: "proposal", details: `Status alterado para ${nextStatus}.`, before: { status: record.proposal.status }, after: { status: nextStatus, decisionNote: payload.decisionNote?.trim() ?? record.proposal.decisionNote } });
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
    if (!(await isModuleEnabled(db, record.dealer.id, "proposals"))) return forbidden("O módulo Propostas não está habilitado para esta concessionária.");

    const canDelete =
      ["general_admin", "global_management"].includes(profile.role) ||
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
    await recordAudit(db, { proposalId: payload.id, actorEmail: profile.email, actorName: profile.name, action: "deleted", entity: "proposal", details: "Proposta excluída definitivamente.", before: { id: record.proposal.id, status: record.proposal.status, totalCents: record.proposal.totalCents } });

    await db.batch([
      db.delete(proposalItems).where(eq(proposalItems.proposalId, payload.id)),
      db.delete(proposals).where(eq(proposals.id, payload.id)),
    ]);
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ error: apiError(error) }, { status: 500 });
  }
}

async function proposalNumber(db: Awaited<ReturnType<typeof getDb>>) {
  const existingProposals = await db
    .select({ id: proposals.id })
    .from(proposals);
  const latestNumber = existingProposals.reduce((latest, proposal) => {
    const match = /^HBR(\d+)$/i.exec(proposal.id);
    return match ? Math.max(latest, Number(match[1])) : latest;
  }, 0);

  return `HBR${String(latestNumber + 1).padStart(3, "0")}`;
}
