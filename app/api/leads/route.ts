import { desc, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { dealerships, leads, users } from "../../../db/schema";
import { recordAudit } from "../../../lib/audit";
import { getAccessProfile, isModuleEnabled, normalizeUserRole, profileHasDealership } from "../../../lib/access";

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
  if (profile.role === "factory_manager") return profileHasDealership(profile, dealer.id) || dealer.factoryManagerEmail.trim().toLowerCase() === profile.email.trim().toLowerCase();
  return ["dealer_manager", "concession"].includes(profile.role) && profileHasDealership(profile, dealer.id);
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

const STAGE_LABELS: Record<Stage, string> = { new: "Novo", contacted: "Em contato", qualified: "Qualificado", proposal: "Proposta", negotiation: "Negociação", won: "Lead convertido", lost: "Perdido" };

function extractPartNumbers(value: string) {
  return [...new Set((value.match(/\b[A-Z0-9][A-Z0-9._\/-]{3,}\b/gi) ?? []).filter((token) => /\d/.test(token)).map((token) => token.trim().toUpperCase()))];
}

function partNumbersForLead(lead: typeof leads.$inferSelect) {
  const explicit = extractPartNumbers(lead.partNumbers);
  return explicit.length ? explicit : extractPartNumbers(lead.partsOfInterest);
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
    byStage: group("stage", (value) => STAGE_LABELS[value as Stage] || value),
    byTemperature: group("temperature", (value) => ({ cold: "Frio", warm: "Morno", hot: "Quente" } as Record<string, string>)[value] || value),
  };
}

function serialize(rows: Array<{ lead: typeof leads.$inferSelect; dealership: typeof dealerships.$inferSelect }>) {
  return rows.map(({ lead, dealership }) => ({ ...lead, dealership: dealership.name, city: dealership.city, state: dealership.state }));
}

function insights(rows: Array<{ lead: typeof leads.$inferSelect; dealership: typeof dealerships.$inferSelect }>) {
  const partStage = new Map<string, { partNumber: string; stage: Stage; stageLabel: string; customers: Set<string>; leadCount: number; valueCents: number }>();
  const customers = new Map<string, { customerName: string; machineDomain: string; dealership: string; sellerName: string; stage: Stage; partNumbers: string; temperature: Temperature; negotiatedValueCents: number; updatedAt: string }>();
  for (const { lead, dealership } of rows) {
    const partNumbers = partNumbersForLead(lead);
    for (const partNumber of partNumbers) {
      const key = `${lead.stage}:${partNumber}`;
      const current = partStage.get(key) ?? { partNumber, stage: lead.stage as Stage, stageLabel: STAGE_LABELS[lead.stage as Stage], customers: new Set<string>(), leadCount: 0, valueCents: 0 };
      current.customers.add(lead.customerName);
      current.leadCount += 1;
      current.valueCents += lead.negotiatedValueCents;
      partStage.set(key, current);
    }
    const customerKey = `${lead.dealershipId}:${lead.customerName.toLocaleLowerCase("pt-BR")}:${lead.machineDomain.toLocaleLowerCase("pt-BR")}`;
    const currentCustomer = customers.get(customerKey);
    if (!currentCustomer || new Date(lead.updatedAt).getTime() >= new Date(currentCustomer.updatedAt).getTime()) {
      customers.set(customerKey, { customerName: lead.customerName, machineDomain: lead.machineDomain, dealership: dealership.name, sellerName: lead.sellerName, stage: lead.stage as Stage, partNumbers: partNumbers.join(", "), temperature: lead.temperature as Temperature, negotiatedValueCents: lead.negotiatedValueCents, updatedAt: lead.updatedAt });
    }
  }
  return {
    byPartNumberStage: [...partStage.values()].map((item) => ({ ...item, customers: [...item.customers] })).sort((a, b) => STAGE_LABELS[a.stage].localeCompare(STAGE_LABELS[b.stage], "pt-BR") || a.partNumber.localeCompare(b.partNumber)),
    customerMachines: [...customers.values()].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()),
  };
}

export async function GET() {
  const profile = await getAccessProfile();
  if (!profile) return forbidden("Seu acesso ainda não foi liberado ou está inativo.");
  try {
    const db = await getDb();
    const allDealers = await db.select().from(dealerships).orderBy(dealerships.name);
    const visibleDealers = allDealers.filter((dealer) => canSeeDealer(profile, dealer));
    const enabledDealers = isFactoryRole(profile.role)
      ? visibleDealers
      : (await Promise.all(visibleDealers.map(async (dealer) => ({ dealer, enabled: await isModuleEnabled(db, dealer.id, "leads") })))).filter((item) => item.enabled).map((item) => item.dealer);
    if (!enabledDealers.length && !isFactoryRole(profile.role)) {
      return Response.json({ leads: [], leadDetails: [], ownerLeads: [], ...insights([]), metrics: metrics([]), byDealership: [], bySeller: [], sellers: [], dealerships: [], canEdit: false, metricsOnly: false, moduleEnabled: false });
    }
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
    const sellers = allUsers.filter((user) => user.active && ["dealer_manager", "concession"].includes(normalizeUserRole(user.email, user.role) || "") && (user.dealershipId === null || enabledIds.has(user.dealershipId))).map((user) => ({ email: user.email, name: user.name || user.email, dealershipId: user.dealershipId }));
    const canEdit = ["dealer_manager", "concession"].includes(profile.role);
    const serialized = serialize(scoped);
    const ownerEmail = profile.email.trim().toLowerCase();
    const ownerRows = scoped.filter(({ lead }) => [lead.sellerEmail, lead.createdByEmail].some((email) => email.trim().toLowerCase() === ownerEmail));
    return Response.json({
      leads: canEdit ? serialized : [],
      leadDetails: serialized,
      ownerLeads: canEdit ? serialize(ownerRows) : [],
      ...insights(scoped),
      metrics: metrics(scoped),
      byDealership,
      bySeller,
      sellers,
      dealerships: enabledDealers.map((dealer) => ({ id: dealer.id, name: dealer.name })),
      canEdit,
      metricsOnly: isFactoryRole(profile.role),
      moduleEnabled: true,
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
  return { customerName, phone: String(payload.phone ?? fallback?.phone ?? "").trim(), email: String(payload.email ?? fallback?.email ?? "").trim(), machineDomain: String(payload.machineDomain ?? fallback?.machineDomain ?? "").trim(), partNumbers: String(payload.partNumbers ?? fallback?.partNumbers ?? "").trim(), partsOfInterest: String(payload.partsOfInterest ?? fallback?.partsOfInterest ?? "").trim(), temperature, stage, negotiatedValueCents: normalizeCents(payload.negotiatedValueCents ?? fallback?.negotiatedValueCents), invoiceNumber, invoiceValueCents: normalizeCents(payload.invoiceValueCents ?? fallback?.invoiceValueCents), sellerName, sellerEmail: String(payload.sellerEmail ?? fallback?.sellerEmail ?? "").trim(), lostReason: String(payload.lostReason ?? fallback?.lostReason ?? "").trim() };
}

function validateLead(values: ReturnType<typeof payloadValues>) {
  if (!values.customerName) return "Informe o nome do cliente.";
  if (!values.phone && !values.email) return "Informe telefone ou e-mail do cliente.";
  if (!values.sellerName) return "Informe o vendedor responsável.";
  if (values.stage === "won" && !values.negotiatedValueCents) return "Informe o valor negociado para marcar o lead como fechado.";
  if (values.stage === "won" && !values.invoiceNumber) return "Informe a NF para marcar o lead como fechado.";
  if (values.stage === "won" && !values.invoiceValueCents) return "Informe o valor da NF para marcar o lead como fechado.";
  if (values.stage === "won" && values.invoiceValueCents !== values.negotiatedValueCents) return "O valor da NF deve ser exatamente igual ao valor negociado. O lead não foi fechado.";
  if (values.stage === "lost" && !values.lostReason) return "Informe o motivo da negativa para encerrar o lead.";
  return "";
}

export async function POST(request: Request) {
  const profile = await getAccessProfile();
  if (!profile || !["dealer_manager", "concession"].includes(profile.role)) return forbidden("Somente cargos da concessionária podem cadastrar leads.");
  try {
    const payload = await request.json() as Record<string, unknown>;
    const values = payloadValues(payload);
    const error = validateLead(values);
    if (error) return Response.json({ error }, { status: 400 });
    const db = await getDb();
    const requestedDealershipId = Math.trunc(Number(payload.dealershipId) || 0);
    const selectedDealershipId = requestedDealershipId || profile.dealershipId || 0;
    if (!selectedDealershipId || !profileHasDealership(profile, selectedDealershipId)) {
      return Response.json({ error: "Selecione uma loja vinculada ao seu acesso." }, { status: 400 });
    }
    const [dealer] = await db.select().from(dealerships).where(eq(dealerships.id, selectedDealershipId)).limit(1);
    if (!dealer || !(await isModuleEnabled(db, dealer.id, "leads"))) return forbidden("O módulo Horsch Leads não está habilitado para sua concessionária.");
    const now = new Date().toISOString();
    const id = "LEAD-" + Date.now().toString(36).toUpperCase();
    await db.insert(leads).values({ id, dealershipId: dealer.id, createdByEmail: profile.email, createdByName: profile.name, ...values, sellerEmail: values.sellerEmail || profile.email, closedAt: ["won", "lost"].includes(values.stage) ? now : null, createdAt: now, updatedAt: now });
    await recordAudit(db, { actorEmail: profile.email, actorName: profile.name, action: "lead_created", entity: "lead", details: `Lead ${id} cadastrado para ${dealer.name}.`, after: { id, dealershipId: dealer.id, stage: values.stage, temperature: values.temperature, lostReason: values.lostReason } });
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
    if (!row || !profileHasDealership(profile, row.lead.dealershipId)) return forbidden("Este lead está fora do escopo da sua concessionária.");
    if (!(await isModuleEnabled(db, row.lead.dealershipId, "leads"))) return forbidden("O módulo Horsch Leads não está habilitado para sua concessionária.");
    if (payload.action === "resolve_rollback") {
      const decision = String(payload.decision ?? "");
      if (!row.lead.rollbackPending)
        return Response.json({ error: "Este lead não possui rollback pendente." }, { status: 409 });
      if (!['contacted', 'lost'].includes(decision))
        return Response.json({ error: "Escolha retornar para Em contato ou encerrar como Perdido." }, { status: 400 });
      const rollbackReason = String(payload.rollbackReason ?? "").trim();
      if (decision === "lost" && rollbackReason.length < 5)
        return Response.json({ error: "Informe o motivo da perda do lead." }, { status: 400 });
      const now = new Date().toISOString();
      await db.update(leads).set({
        stage: decision,
        rollbackPending: false,
        rollbackReason,
        lostReason: decision === "lost" ? rollbackReason : "",
        closedAt: decision === "lost" ? now : null,
        updatedAt: now,
      }).where(eq(leads.id, id));
      await recordAudit(db, {
        actorEmail: profile.email,
        actorName: profile.name,
        action: "lead_conversion_rollback_resolved",
        entity: "lead",
        details: `Rollback do Lead ${id}: ${decision === "contacted" ? "retornado para Em contato" : "encerrado como Perdido"}.`,
        before: { stage: row.lead.stage, rollbackPending: row.lead.rollbackPending },
        after: { stage: decision, rollbackPending: false, rollbackReason },
      });
      return Response.json({ ok: true, stage: decision });
    }
    const values = payloadValues(payload, row.lead);
    const error = validateLead(values);
    if (error) return Response.json({ error }, { status: 400 });
    const now = new Date().toISOString();
    await db.update(leads).set({
      ...values,
      rollbackPending: row.lead.rollbackPending && !["contacted", "lost"].includes(values.stage),
      rollbackReason: ["contacted", "lost"].includes(values.stage) ? "" : row.lead.rollbackReason,
      closedAt: ["won", "lost"].includes(values.stage) ? (row.lead.closedAt || now) : null,
      updatedAt: now,
    }).where(eq(leads.id, id));
    await recordAudit(db, { actorEmail: profile.email, actorName: profile.name, action: "lead_updated", entity: "lead", details: `Lead ${id} atualizado.`, before: { stage: row.lead.stage, temperature: row.lead.temperature, lostReason: row.lead.lostReason }, after: { stage: values.stage, temperature: values.temperature, invoiceNumber: values.invoiceNumber, invoiceValueCents: values.invoiceValueCents, lostReason: values.lostReason } });
    return Response.json({ ok: true, id });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Não foi possível atualizar o lead." }, { status: 500 });
  }
}
