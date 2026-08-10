import { desc, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { dealerships, leads, users } from "../../../db/schema";
import { recordAudit } from "../../../lib/audit";
import { getAccessProfile, isModuleEnabled, normalizeUserRole } from "../../../lib/access";

export const dynamic = "force-dynamic";

const STAGES = ["new", "contacted", "qualified", "proposal", "negotiation", "won", "lost"] as const;
const TEMPERATURES = ["cold", "warm", "hot"] as const;
type Stage = (typeof STAGES)[number];
type Temperature = (typeof TEMPERATURES)[number];

function forbidden(message = "Seu perfil não possui acesso ao Horsch Leads.") {
  return Response.json({ error: message }, { status: 403 });
}

function isFactoryRole(role: string) {
  return ["general_admin", "global_management", "factory_manager"].includes(role);
}

function canSeeDealer(profile: NonNullable<Awaited<ReturnType<typeof getAccessProfile>>>, dealer: { id: number; factoryManagerEmail: string }) {
  if (["general_admin", "global_management"].includes(profile.role)) return true;
  if (profile.role === "factory_manager") return dealer.factoryManagerEmail.trim().toLowerCase() === profile.email.trim().toLowerCase();
  return ["dealer_manager", "concession"].includes(profile.role) && dealer.id === profile.dealershipId;
}

function normalizeCents(value: unknown) {
  if (value === null || value === undefined || value === "") return 0;
  const cents = Math.trunc(Number(value));
  return Number.isFinite(cents) && cents >= 0 ? cents : 0;
}

function normalizeStage(value: unknown): Stage {
  return STAGES.includes(String(value) as Stage) ? String(value) as Stage : "new";
}

function normalizeTemperature(value: unknown): Temperature {
  return TEMPERATURES.includes(String(value) as Temperature) ? String(value) as Temperature : "warm";
}

function metrics(rows: Array<{ lead: typeof leads.$inferSelect; dealership: typeof dealerships.$inferSelect }>) {
  const values = rows.map((row) => row.lead);
  const won = values.filter((lead) => lead.stage === "won");
  const lost = values.filter((lead) => lead.stage === "lost");
  const closed = won.length + lost.length;
  const sum = (items: typeof values) => items.reduce((total, lead) => total + lead.negotiatedValueCents, 0);
  const group = (key: "stage" | "temperature", labeler: (value: string) => string) => {
    const counts = new Map<string, { label: string; count: number; valueCents: number; wonCents: number }>();
    for (const lead of values) {
      const value = lead[key];
      const current = counts.get(value) ?? { label: labeler(value), count: 0, valueCents: 0, wonCents: 0 };
      current.count += 1;
      current.valueCents += lead.negotiatedValueCents;
      if (lead.stage === "won") current.wonCents += lead.negotiatedValueCents;
      counts.set(value, current);
    }
    return [...counts.values()].sort((a, b) => b.count - a.count);
  };
  return {
    total: values.length,
    open: values.filter((lead) => !["won", "lost"].includes(lead.stage)).length,
    won: won.length,
    lost: lost.length,
    pipelineCents: sum(values.filter((lead) => !["won", "lost"].includes(lead.stage))),
    negotiatedCents: sum(values),
    wonCents: sum(won),
    conversionRate: closed ? Math.round((won.length / closed) * 100) : 0,
    byStage: group("stage", (value) => ({ new: "Novo", contacted: "Contato", qualified: "Qualificado", proposal: "Proposta", negotiation: "Negociação", won: "Fechado", lost: "Perdido" } as Record<string, string>)[value] || value),
    byTemperature: group("temperature", (value) => ({ cold: "Frio", warm: "Morno", hot: "Quente" } as Record<string, string>)[value] || value),
  };
}

function serialize(rows: Array<{ lead: typeof leads.$inferSelect; dealership: typeof dealerships.$inferSelect }>) {
  return rows.map(({ lead, dealership }) => ({ ...lead, dealership: dealership.name, city: dealership.city, state: dealership.state }));
}

export async function GET() {
  const profile = await getAccessProfile();
  if (!profile) return forbidden("Seu acesso ainda não foi liberado ou está inativo.");
  try {
    const db = await getDb();
    const allDealers = await db.select().from(dealerships).orderBy(dealerships.name);
    const visibleDealers = allDealers.filter((dealer) => canSeeDealer(profile, dealer));
    const enabledDealers = [] as typeof allDealers;
    for (const dealer of visibleDealers) {
      if (await isModuleEnabled(db, dealer.id, "leads")) enabledDealers.push(dealer);
    }
    if (!enabledDealers.length && !isFactoryRole(profile)) return forbidden("O módulo Horsch Leads não está habilitado para sua concessionária.");
    const enabledIds = new Set(enabledDealers.map((dealer) => dealer.id));
    const rows = await db.select({ lead: leads, dealership: dealerships }).from(leads).innerJoin(dealerships, eq(leads.dealershipId, dealerships.id)).orderBy(desc(leads.updatedAt), desc(leads.createdAt));
    const scoped = rows.filter((row) => enabledIds.has(row.lead.dealershipId));
    const allUsers = await db.select().from(users);
    const byDealership = [...new Map(scoped.map((row) => [row.lead.dealershipId, row])).values()].map((row) => {
      const groupRows = scoped.filter((item) => item.lead.dealershipId === row.lead.dealershipId);
      return { label: row.dealership.name, ...metrics(groupRows) };
    }).sort((a, b) => b.total - a.total);
    const bySellerMap = new Map<string, typeof scoped>();
    for (const row of scoped) bySellerMap.set(row.lead.sellerName || "Sem vendedor", [...(bySellerMap.get(row.lead.sellerName || "Sem vendedor") ?? []), row]);
    const bySeller = [...bySellerMap.entries()].map(([label, groupRows]) => ({ label, ...metrics(groupRows) })).sort((a, b) => b.total - a.total);
    const sellers = allUsers.filter((user) => user.active && ["dealer_manager", "concession"].includes(normalizeUserRole(user.email, user.role) || "") && enabledIds.has(user.dealershipId || -1)).map((user) => ({ email: user.email, name: user.name || user.email, dealershipId: user.dealershipId }));
    const canEdit = ["dealer_manager", "concession"].includes(profile.role);
    return Response.json({
      leads: canEdit ? serialize(scoped) : [],
      metrics: metrics(scoped),
      byDealership,
      bySeller,
      sellers,
      canEdit,
      metricsOnly: isFactoryRole(profile),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Não foi possível carregar os leads.";
    return Response.json({ error: message.includes("no such table") ? "O módulo Horsch Leads ainda está sendo preparado. Tente novamente em instantes." : message }, { status: 500 });
  }
}

function payloadValues(payload: Record<string, unknown>, fallback?: typeof leads.$inferSelect) {
  const stage = normalizeStage(payload.stage ?? fallback?.stage);
  const temperature = normalizeTemperature(payload.temperature ?? fallback?.temperature);
  const customerName = String(payload.customerName ?? fallback?.customerName ?? "").trim();
  const sellerName = String(payload.sellerName ?? fallback?.sellerName ?? "").trim();
  const invoiceNumber = String(payload.invoiceNumber ?? fallback?.invoiceNumber ?? "").trim();
  return { customerName, phone: String(payload.phone ?? fallback?.phone ?? "").trim(), email: String(payload.email ?? fallback?.email ?? "").trim(), machineDomain: String(payload.machineDomain ?? fallback?.machineDomain ?? "").trim(), partsOfInterest: String(payload.partsOfInterest ?? fallback?.partsOfInterest ?? "").trim(), temperature, stage, negotiatedValueCents: normalizeCents(payload.negotiatedValueCents ?? fallback?.negotiatedValueCents), invoiceNumber, sellerName, sellerEmail: String(payload.sellerEmail ?? fallback?.sellerEmail ?? "").trim() };
}

function validateLead(values: ReturnType<typeof payloadValues>) {
  if (!values.customerName) return "Informe o nome do cliente.";
  if (!values.phone && !values.email) return "Informe telefone ou e-mail do cliente.";
  if (!values.sellerName) return "Informe o vendedor responsável.";
  if (values.stage === "won" && !values.invoiceNumber) return "Informe a NF para marcar o lead como fechado.";
  return "";
}

export async function POST(request: Request) {
  const profile = await getAccessProfile();
  if (!profile || !["dealer_manager", "concession"].includes(profile.role)) return forbidden("Somente cargos da concessionária podem cadastrar leads.");
  if (!profile.dealershipId) return Response.json({ error: "Usuário sem concessionária vinculada." }, { status: 400 });
  try {
    const payload = await request.json() as Record<string, unknown>;
    const values = payloadValues(payload);
    const error = validateLead(values);
    if (error) return Response.json({ error }, { status: 400 });
    const db = await getDb();
    const [dealer] = await db.select().from(dealerships).where(eq(dealerships.id, profile.dealershipId)).limit(1);
    if (!dealer || !(await isModuleEnabled(db, dealer.id, "leads"))) return forbidden("O módulo Horsch Leads não está habilitado para sua concessionária.");
    const now = new Date().toISOString();
    const id = "LEAD-" + Date.now().toString(36).toUpperCase();
    await db.insert(leads).values({ id, dealershipId: dealer.id, createdByEmail: profile.email, createdByName: profile.name, ...values, sellerEmail: values.sellerEmail || profile.email, closedAt: values.stage === "won" ? now : null, createdAt: now, updatedAt: now });
    await recordAudit(db, { actorEmail: profile.email, actorName: profile.name, action: "lead_created", entity: "lead", details: `Lead ${id} cadastrado para ${dealer.name}.`, after: { id, dealershipId: dealer.id, stage: values.stage, temperature: values.temperature } });
    return Response.json({ ok: true, id });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Não foi possível cadastrar o lead." }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const profile = await getAccessProfile();
  if (!profile || !["dealer_manager", "concession"].includes(profile.role)) return forbidden("Somente cargos da concessionária podem editar leads.");
  try {
    const payload = await request.json() as Record<string, unknown>;
    const id = String(payload.id ?? "").trim();
    if (!id) return Response.json({ error: "Lead não informado." }, { status: 400 });
    const db = await getDb();
    const [row] = await db.select({ lead: leads, dealership: dealerships }).from(leads).innerJoin(dealerships, eq(leads.dealershipId, dealerships.id)).where(eq(leads.id, id)).limit(1);
    if (!row || row.lead.dealershipId !== profile.dealershipId) return forbidden("Este lead está fora do escopo da sua concessionária.");
    if (!(await isModuleEnabled(db, row.lead.dealershipId, "leads"))) return forbidden("O módulo Horsch Leads não está habilitado para sua concessionária.");
    const values = payloadValues(payload, row.lead);
    const error = validateLead(values);
    if (error) return Response.json({ error }, { status: 400 });
    const now = new Date().toISOString();
    await db.update(leads).set({ ...values, closedAt: values.stage === "won" ? (row.lead.closedAt || now) : null, updatedAt: now }).where(eq(leads.id, id));
    await recordAudit(db, { actorEmail: profile.email, actorName: profile.name, action: "lead_updated", entity: "lead", details: `Lead ${id} atualizado.`, before: { stage: row.lead.stage, temperature: row.lead.temperature }, after: { stage: values.stage, temperature: values.temperature, invoiceNumber: values.invoiceNumber } });
    return Response.json({ ok: true, id });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Não foi possível atualizar o lead." }, { status: 500 });
  }
}
