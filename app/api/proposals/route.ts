import { desc, eq, inArray } from "drizzle-orm";
import { getChatGPTUser } from "../../chatgpt-auth";
import { getDb } from "../../../db";
import { dealerships, proposalItems, proposals } from "../../../db/schema";

export const dynamic = "force-dynamic";

const VALID_STATUSES = new Set([
  "draft",
  "sent",
  "negotiation",
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
  validUntil?: string;
  status?: string;
  items?: ItemInput[];
};

function apiError(error: unknown) {
  const message = error instanceof Error ? error.message : "Erro inesperado";
  const detail =
    error instanceof Error && error.cause instanceof Error
      ? error.cause.message
      : "";
  const combined = `${message}\n${detail}`;

  if (combined.includes("no such table")) {
    return "O banco de dados ainda está sendo preparado. Aguarde alguns instantes e tente novamente.";
  }
  return message;
}

async function requireApiUser() {
  return getChatGPTUser();
}

export async function GET() {
  const user = await requireApiUser();
  if (!user) return Response.json({ error: "Não autenticado" }, { status: 401 });

  try {
    const db = getDb();
    const rows = await db
      .select({
        id: proposals.id,
        dealershipId: proposals.dealershipId,
        dealership: dealerships.name,
        city: dealerships.city,
        state: dealerships.state,
        contactName: proposals.contactName,
        contactEmail: dealerships.contactEmail,
        commercialOwner: proposals.commercialOwner,
        status: proposals.status,
        issueDate: proposals.issueDate,
        validUntil: proposals.validUntil,
        totalCents: proposals.totalCents,
        createdByEmail: proposals.createdByEmail,
        createdAt: proposals.createdAt,
        updatedAt: proposals.updatedAt,
      })
      .from(proposals)
      .innerJoin(dealerships, eq(proposals.dealershipId, dealerships.id))
      .orderBy(desc(proposals.createdAt), desc(proposals.id));

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

    const dealerMap = new Map<
      number,
      {
        id: number;
        name: string;
        city: string;
        state: string;
        contactName: string;
        contactEmail: string;
        proposals: number;
        approved: number;
        totalCents: number;
        lastProposalAt: string;
      }
    >();

    for (const row of rows) {
      const existing = dealerMap.get(row.dealershipId) ?? {
        id: row.dealershipId,
        name: row.dealership,
        city: row.city,
        state: row.state,
        contactName: row.contactName,
        contactEmail: row.contactEmail,
        proposals: 0,
        approved: 0,
        totalCents: 0,
        lastProposalAt: row.createdAt,
      };
      existing.proposals += 1;
      existing.approved += row.status === "approved" ? 1 : 0;
      existing.totalCents += row.totalCents;
      dealerMap.set(row.dealershipId, existing);
    }

    return Response.json({
      proposals: proposalData,
      dealerships: [...dealerMap.values()].sort(
        (a, b) => b.totalCents - a.totalCents,
      ),
      demoMode:
        rows.length > 0 &&
        rows.every((row) => row.createdByEmail === "demo@horsch.com"),
    });
  } catch (error) {
    return Response.json({ error: apiError(error) }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const user = await requireApiUser();
  if (!user) return Response.json({ error: "Não autenticado" }, { status: 401 });

  try {
    const payload = (await request.json()) as ProposalInput;
    const dealershipName = payload.dealership?.trim() ?? "";
    const commercialOwner =
      payload.commercialOwner?.trim() || user.displayName;
    const status = VALID_STATUSES.has(payload.status ?? "")
      ? payload.status!
      : "draft";
    const validItems = (payload.items ?? [])
      .map((item) => ({
        partNumber: item.partNumber?.trim() ?? "",
        description: item.description?.trim() ?? "",
        ncm: item.ncm?.trim() ?? "",
        quantity: Math.max(1, Math.trunc(Number(item.quantity) || 1)),
        unitPriceCents: Math.max(
          0,
          Math.trunc(Number(item.unitPriceCents) || 0),
        ),
      }))
      .filter((item) => item.partNumber || item.description);

    if (!dealershipName) {
      return Response.json(
        { error: "Informe a concessionária." },
        { status: 400 },
      );
    }
    if (!validItems.length) {
      return Response.json(
        { error: "Adicione ao menos um item à proposta." },
        { status: 400 },
      );
    }

    const db = getDb();
    const [existingDealer] = await db
      .select()
      .from(dealerships)
      .where(eq(dealerships.name, dealershipName))
      .limit(1);

    let dealershipId = existingDealer?.id;
    if (!dealershipId) {
      const [createdDealer] = await db
        .insert(dealerships)
        .values({
          name: dealershipName,
          city: payload.city?.trim() ?? "",
          state: payload.state?.trim().toUpperCase().slice(0, 2) ?? "",
          contactName: payload.contactName?.trim() ?? "",
          contactEmail: payload.contactEmail?.trim() ?? "",
        })
        .returning();
      dealershipId = createdDealer.id;
    }

    const now = new Date();
    const issueDate = now.toISOString().slice(0, 10);
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
      status,
      issueDate,
      validUntil: payload.validUntil || defaultValidity.toISOString().slice(0, 10),
      totalCents,
      createdByEmail: user.email,
      createdByName: user.displayName,
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
  const user = await requireApiUser();
  if (!user) return Response.json({ error: "Não autenticado" }, { status: 401 });

  try {
    const payload = (await request.json()) as { id?: string; status?: string };
    if (!payload.id || !VALID_STATUSES.has(payload.status ?? "")) {
      return Response.json(
        { error: "Proposta ou status inválido." },
        { status: 400 },
      );
    }
    const db = getDb();
    const updated = await db
      .update(proposals)
      .set({ status: payload.status!, updatedAt: new Date().toISOString() })
      .where(eq(proposals.id, payload.id))
      .returning({ id: proposals.id });
    if (!updated.length) {
      return Response.json({ error: "Proposta não encontrada." }, { status: 404 });
    }
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ error: apiError(error) }, { status: 500 });
  }
}

export async function DELETE() {
  const user = await requireApiUser();
  if (!user) return Response.json({ error: "Não autenticado" }, { status: 401 });

  try {
    const db = getDb();
    const demoRows = await db
      .select({ id: proposals.id })
      .from(proposals)
      .where(eq(proposals.createdByEmail, "demo@horsch.com"));
    if (demoRows.length) {
      const ids = demoRows.map((row) => row.id);
      await db.delete(proposalItems).where(inArray(proposalItems.proposalId, ids));
      await db
        .delete(proposals)
        .where(eq(proposals.createdByEmail, "demo@horsch.com"));
    }

    const remaining = await db.select({ id: proposals.id }).from(proposals).limit(1);
    if (!remaining.length) await db.delete(dealerships);
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ error: apiError(error) }, { status: 500 });
  }
}

function proposalNumber(date: Date) {
  const stamp = date
    .toISOString()
    .replace(/[-:T.Z]/g, "")
    .slice(0, 12);
  const suffix = crypto.randomUUID().slice(0, 4).toUpperCase();
  return `HBR-${stamp}-${suffix}`;
}
