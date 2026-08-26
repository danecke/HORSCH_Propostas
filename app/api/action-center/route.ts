import { desc } from "drizzle-orm";
import { getDb } from "../../../db";
import { dealerships, proposals, quoteRequests, reimbursementSales } from "../../../db/schema";
import { getAccessProfile, profileHasDealership } from "../../../lib/access";

export const dynamic = "force-dynamic";

type Module = "quotes" | "proposals" | "reimbursements";

function sla(createdAt: string) {
  const ageHours = Math.max(0, Math.floor((Date.now() - new Date(createdAt).getTime()) / 3_600_000));
  return {
    ageHours,
    sla: ageHours >= 72 ? "red" : ageHours > 24 ? "yellow" : "green",
  } as const;
}

function canSeeDealer(profile: NonNullable<Awaited<ReturnType<typeof getAccessProfile>>>, dealer: typeof dealerships.$inferSelect) {
  if (["general_admin", "global_management"].includes(profile.role)) return true;
  if (profile.role === "factory_manager") {
    return profileHasDealership(profile, dealer.id) || dealer.factoryManagerEmail.toLowerCase() === profile.email;
  }
  return profileHasDealership(profile, dealer.id);
}

export async function GET() {
  const profile = await getAccessProfile();
  if (!profile) return Response.json({ error: "Acesso não autorizado." }, { status: 403 });
  if (!["general_admin", "global_management", "factory_manager", "dealer_manager"].includes(profile.role)) {
    return Response.json({ items: [], counts: { total: 0, green: 0, yellow: 0, red: 0 } });
  }
  try {
    const db = await getDb();
    const [dealerRows, quoteRows, proposalRows, reimbursementRows] = await Promise.all([
      db.select().from(dealerships),
      db.select().from(quoteRequests).orderBy(desc(quoteRequests.updatedAt)),
      db.select().from(proposals).orderBy(desc(proposals.updatedAt)),
      db.select().from(reimbursementSales).orderBy(desc(reimbursementSales.createdAt)),
    ]);
    const dealerById = new Map(dealerRows.map((dealer) => [dealer.id, dealer]));
    const visible = (dealershipId: number | null) => {
      if (!dealershipId) return ["general_admin", "global_management"].includes(profile.role);
      const dealer = dealerById.get(dealershipId);
      return Boolean(dealer && canSeeDealer(profile, dealer));
    };
    const items: Array<{
      id: string;
      module: Module;
      title: string;
      subtitle: string;
      statusLabel: string;
      createdAt: string;
      ageHours: number;
      sla: "green" | "yellow" | "red";
    }> = [];

    for (const quote of quoteRows) {
      const allowed =
        (["general_admin", "global_management"].includes(profile.role) && ["awaiting_quote", "awaiting_cost_review"].includes(quote.status)) ||
        (profile.role === "dealer_manager" && quote.status === "awaiting_dealer_acceptance") ||
        (profile.role === "factory_manager" && quote.status === "awaiting_order");
      if (!allowed || !visible(quote.dealershipId)) continue;
      items.push({ id: quote.id, module: "quotes", title: `Cotação ${quote.id}`, subtitle: `${dealerById.get(quote.dealershipId)?.name || "Concessionária"} · PN ${quote.partNumber}`, statusLabel: "Ação pendente", createdAt: quote.updatedAt, ...sla(quote.updatedAt) });
    }
    for (const proposal of proposalRows) {
      const allowed =
        (["general_admin", "global_management"].includes(profile.role) && ["awaiting_global", "in_analysis", "counteroffer"].includes(proposal.status)) ||
        (profile.role === "dealer_manager" && ["sent", "awaiting_dealer_acceptance"].includes(proposal.status)) ||
        (profile.role === "factory_manager" && ["awaiting_order", "awaiting_order_number"].includes(proposal.status));
      if (!allowed || !visible(proposal.dealershipId)) continue;
      items.push({ id: proposal.id, module: "proposals", title: `Proposta ${proposal.id}`, subtitle: `${dealerById.get(proposal.dealershipId)?.name || "Concessionária"} · ${proposal.customerName || "Cliente não informado"}`, statusLabel: "Ação pendente", createdAt: proposal.updatedAt, ...sla(proposal.updatedAt) });
    }
    for (const line of reimbursementRows) {
      const allowed =
        (["general_admin", "global_management"].includes(profile.role) && line.workflowStatus === "awaiting_global") ||
        (profile.role === "dealer_manager" && line.workflowStatus === "awaiting_dealer_consent") ||
        (profile.role === "factory_manager" && line.workflowStatus === "awaiting_factory_settlement");
      if (!allowed || !visible(line.dealershipId)) continue;
      items.push({ id: String(line.id), module: "reimbursements", title: `Reembolso · linha ${line.id}`, subtitle: `${line.dealershipName || "Concessionária"} · PN ${line.partNumber}`, statusLabel: line.workflowStatus === "awaiting_global" ? "Validação da fábrica" : line.workflowStatus === "awaiting_dealer_consent" ? "Consentimento" : "Liquidação", createdAt: line.createdAt, ...sla(line.createdAt) });
    }
    const priority = { red: 0, yellow: 1, green: 2 } as const;
    items.sort((a, b) => priority[a.sla] - priority[b.sla] || b.ageHours - a.ageHours);
    return Response.json({
      items,
      counts: {
        total: items.length,
        green: items.filter((item) => item.sla === "green").length,
        yellow: items.filter((item) => item.sla === "yellow").length,
        red: items.filter((item) => item.sla === "red").length,
      },
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Não foi possível carregar as pendências." }, { status: 500 });
  }
}
