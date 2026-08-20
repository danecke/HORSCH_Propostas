import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { dealerships, priceListImports, priceListItems, quoteCatalog, quoteOutboxEvents, quotePriceListControl, quoteRequests, users } from "../../../db/schema";
import { recordAudit } from "../../../lib/audit";
import { getAccessProfile, isModuleEnabled, normalizeUserRole, profileHasDealership } from "../../../lib/access";
export const dynamic = "force-dynamic";
const DAY = 86400000;
function forbidden() { return Response.json({ error: "Seu perfil não possui acesso às cotações." }, { status: 403 }); }
function actionForStatus(status: string) { return ["awaiting_quote", "awaiting_cost_review"].includes(status) ? "global_management" : status === "awaiting_dealer_acceptance" ? "dealer_manager" : status === "awaiting_order" ? "factory_manager" : ""; }
function statusLabel(status: string) { return ({ awaiting_quote: "Aguardando Cotação", awaiting_dealer_acceptance: "Aguardando Aceite do Concessionário", awaiting_cost_review: "Aguardando Revisão de Custo", closed: "Encerrada", awaiting_order: "Aguardando Pedido", order_generated: "Pedido Gerado" } as Record<string, string>)[status] || status; }
function deriveOrigin(vt: string) { return vt.trim().toUpperCase().replace(/\s+/g, "").charAt(2) || ""; }
function canManagePriceList(profile: NonNullable<Awaited<ReturnType<typeof getAccessProfile>>>) { return ["general_admin", "global_management"].includes(profile.role); }
function isApprovedForOrder(status: string) { return ["awaiting_order", "order_generated"].includes(status); }
function canSee(profile: NonNullable<Awaited<ReturnType<typeof getAccessProfile>>>, dealer: { id: number; factoryManagerEmail: string }) {
  if (["general_admin", "global_management"].includes(profile.role)) return true;
  if (profile.role === "factory_manager") return profileHasDealership(profile, dealer.id) || dealer.factoryManagerEmail.toLowerCase() === profile.email.toLowerCase();
  return ["dealer_manager", "concession"].includes(profile.role) && profileHasDealership(profile, dealer.id);
}
function canAct(profile: NonNullable<Awaited<ReturnType<typeof getAccessProfile>>>, status: string, action: string, actionOwnerEmail: string) {
  const isAssigned = Boolean(actionOwnerEmail && actionOwnerEmail.trim().toLowerCase() === profile.email.trim().toLowerCase());
  if (["return_quote", "needs_action"].includes(action)) return ["general_admin", "global_management"].includes(profile.role) && (isAssigned || profile.role === "general_admin");
  if (["approve", "reject"].includes(action)) return profile.role === "dealer_manager" && isAssigned && status === "awaiting_dealer_acceptance";
  return action === "place_order" && profile.role === "factory_manager" && isAssigned && status === "awaiting_order";
}
function errorMessage(error: unknown) { const message = error instanceof Error ? error.message : "Erro inesperado."; return message.includes("no such table") ? "A estrutura de cotações ainda está sendo preparada. Tente novamente." : message; }
export async function GET() {
  const profile = await getAccessProfile();
  if (!profile) return forbidden();
  try {
    const db = await getDb();
    const [dealers, allUsers, priceListRows] = await Promise.all([db.select().from(dealerships), db.select().from(users), db.select().from(quotePriceListControl)]);
    const priceList = new Map(priceListRows.map((row) => [row.partNumber, row]));
    const visibleDealers = dealers.filter((dealer) => canSee(profile, dealer));
    const visible = new Set((await Promise.all(visibleDealers.map(async (dealer) =>
      (await isModuleEnabled(db, dealer.id, "quotes")) ? dealer.id : null,
    ))).filter((id): id is number => id !== null));
    const rows = await db.select({ quote: quoteRequests, dealership: dealerships }).from(quoteRequests).innerJoin(dealerships, eq(quoteRequests.dealershipId, dealerships.id)).orderBy(desc(quoteRequests.updatedAt), desc(quoteRequests.createdAt));
    return Response.json({ quotes: rows.filter((row) => visible.has(row.quote.dealershipId)).map(({ quote, dealership }) => {
      const ownerRole = actionForStatus(quote.status);
      const owner = allUsers.find((user) => user.email.toLowerCase() === quote.actionOwnerEmail.toLowerCase());
      const requester = allUsers.find((user) => user.email.toLowerCase() === quote.requestedByEmail.toLowerCase());
      const actionNote = quote.status === "returned"
        ? "Cotação retornada; aguardando ação da Concessionária."
        : quote.actionNote
          .replace(/dados do PN encontrados na base e retornados automaticamente:?/gi, "Informações disponíveis:")
          .replace(/base de dados/gi, "informações disponíveis")
          .replace(/\bbase\b/gi, "informações disponíveis")
          .replace(/retornad[oa]s? automaticamente/gi, "retornadas");
      const listEntry = priceList.get(quote.partNumber);
      const isActionOwner = Boolean(quote.actionOwnerEmail && quote.actionOwnerEmail.trim().toLowerCase() === profile.email.trim().toLowerCase());
      return { ...quote, origin: quote.origin || deriveOrigin(quote.vt), actionNote, dealership: dealership.name, city: dealership.city, state: dealership.state, statusLabel: statusLabel(quote.status), isActionOwner, actionOwnerRole: isActionOwner ? ownerRole : "", actionOwnerLabel: isActionOwner && ownerRole ? ownerRole === "dealer_manager" ? "Concessionária" : ownerRole === "factory_manager" ? "Fábrica" : "Gestão Global / ADM" : "", actionOwnerName: isActionOwner ? (owner?.name || "Você") : "", actionOwnerEmail: isActionOwner ? quote.actionOwnerEmail : "", requestedByName: requester?.name || quote.requestedByName, priceListIncluded: Boolean(listEntry), priceListIncludedAt: listEntry?.includedAt || null, priceListIncludedByEmail: listEntry?.includedByEmail || null };
    }) });
  } catch (error) { return Response.json({ error: errorMessage(error) }, { status: 500 }); }
}
export async function POST(request: Request) {
  const profile = await getAccessProfile();
  if (!profile || !["dealer_manager", "concession"].includes(profile.role)) return forbidden();
  try {
    const payload = (await request.json()) as { partNumber?: string; quantity?: number };
    const partNumber = payload.partNumber?.trim();
    if (!partNumber) return Response.json({ error: "Informe o PN para solicitar a cotação." }, { status: 400 });
    const requestedQuantity = Math.max(1, Math.trunc(Number(payload.quantity) || 1));
    if (!profile.dealershipId) return Response.json({ error: "Usuário sem concessionária vinculada." }, { status: 400 });
    const db = await getDb();
    const [dealer] = await db.select().from(dealerships).where(eq(dealerships.id, profile.dealershipId)).limit(1);
    if (!dealer) return Response.json({ error: "Concessionária não encontrada." }, { status: 404 });
    if (!(await isModuleEnabled(db, dealer.id, "quotes"))) return forbidden("O módulo Cotações não está habilitado para esta concessionária.");
    const [catalog] = await db.select().from(quoteCatalog).where(eq(quoteCatalog.partNumber, partNumber)).limit(1);
    const fresh = Boolean(catalog?.importedAt && Date.now() - new Date(catalog.importedAt).getTime() <= 30 * DAY);
    const catalogReady = Boolean(
      catalog &&
        catalog.description.trim() &&
        catalog.ncm.trim() &&
        catalog.vt.trim() &&
        deriveOrigin(catalog.vt).trim() &&
        catalog.netPriceCents > 0,
    );
    const autoReturned = fresh && catalogReady;
    const allUsers = await db.select().from(users);
    const globalUser = allUsers.find((user) => user.active && ["global_management", "general_admin"].includes(normalizeUserRole(user.email, user.role) || ""));
    const dealerManager = allUsers.find((user) => user.active && normalizeUserRole(user.email, user.role) === "dealer_manager" && user.dealershipId === dealer.id);
    const now = new Date().toISOString();
    const id = "COT-" + Date.now().toString(36).toUpperCase();
    const status = "awaiting_quote";
    const actionOwnerRole = "global_management";
    const actionOwnerEmail = globalUser?.email || "";
    const actionNote = "Solicitação recebida e encaminhada para análise.";
    await db.insert(quoteRequests).values({ id, partNumber, dealershipId: profile.dealershipId, requestedByEmail: profile.email, requestedByName: profile.name, requestedQuantity, targetNetPriceCents: null, requestObservation: "", status, actionOwnerRole, actionOwnerEmail, description: catalog?.description || "", ncm: catalog?.ncm || "", vt: catalog?.vt || "", origin: catalog ? deriveOrigin(catalog.vt) : "", netPriceCents: catalog?.netPriceCents || null, catalogImportedAt: catalog?.importedAt || null, actionNote, requestedAt: now, createdAt: now, updatedAt: now });
    await recordAudit(db, { actorEmail: profile.email, actorName: profile.name, action: "quote_requested", entity: "quote", details: "Cotação " + id + " solicitada para o PN " + partNumber + ".", after: { id, partNumber, status, dealership: dealer.name } });
    return Response.json({ id, status, fresh, autoReturned, requestedQuantity });
  } catch (error) { return Response.json({ error: errorMessage(error) }, { status: 500 }); }
}
export async function PATCH(request: Request) {
  const profile = await getAccessProfile();
  if (!profile) return forbidden();
  try {
    const payload = (await request.json()) as { id?: string; action?: string; partNumber?: string; description?: string; ncm?: string; family?: string; unit?: string; vt?: string; origin?: string; netPriceCents?: number | null; finalPriceCents?: number | null; justification?: string; effectiveAt?: string; horschOrderNumber?: string; actionNote?: string; approvedQuantity?: number };
    if (!payload.id || !payload.action) return Response.json({ error: "Ação de cotação incompleta." }, { status: 400 });
    const db = await getDb();
    const [record] = await db.select({ quote: quoteRequests, dealership: dealerships }).from(quoteRequests).innerJoin(dealerships, eq(quoteRequests.dealershipId, dealerships.id)).where(eq(quoteRequests.id, payload.id)).limit(1);
    if (!record || !canSee(profile, record.dealership)) return Response.json({ error: "Cotação fora do seu escopo." }, { status: 403 });
    if (!(await isModuleEnabled(db, record.dealership.id, "quotes"))) return forbidden("O módulo Cotações não está habilitado para esta concessionária.");
    if (payload.action === "toggle_price_list") {
      if (!canManagePriceList(profile)) return Response.json({ error: "Somente ADM Geral e Gestão Global podem controlar a lista de preços." }, { status: 403 });
      const [existing] = await db.select().from(quotePriceListControl).where(eq(quotePriceListControl.partNumber, record.quote.partNumber)).limit(1);
      if (existing) {
        await db.delete(quotePriceListControl).where(eq(quotePriceListControl.partNumber, record.quote.partNumber));
      } else {
        await db.insert(quotePriceListControl).values({ partNumber: record.quote.partNumber, includedAt: new Date().toISOString(), includedByEmail: profile.email });
      }
      await recordAudit(db, { actorEmail: profile.email, actorName: profile.name, action: existing ? "quote_removed_from_price_list" : "quote_added_to_price_list", entity: "quote", details: "Controle da lista de preços atualizado para o PN " + record.quote.partNumber + ".", before: { included: Boolean(existing) }, after: { included: !existing } });
      return Response.json({ ok: true, included: !existing });
    }
    if (payload.action === "promote_to_price_list") {
      if (!canManagePriceList(profile)) return Response.json({ error: "Somente ADM Geral e Gestão Global podem aprovar inclusão na lista de preços." }, { status: 403 });
      const generatedOrders = (await db.select({ status: quoteRequests.status }).from(quoteRequests).where(eq(quoteRequests.partNumber, record.quote.partNumber))).filter((quote) => quote.status === "order_generated").length;
      if (generatedOrders <= 10) return Response.json({ error: "O PN ainda não atingiu mais de 10 pedidos gerados." }, { status: 409 });
      const payloadEvent = { partNumber: record.quote.partNumber, description: record.quote.description, ncm: record.quote.ncm, vt: record.quote.vt, origin: record.quote.origin || deriveOrigin(record.quote.vt), netPriceCents: record.quote.netPriceCents, generatedOrders, requestedBy: profile.email };
      await db.insert(quoteOutboxEvents).values({ id: crypto.randomUUID(), eventType: "quote.price_list_requested.v1", aggregateId: record.quote.partNumber, payloadJson: JSON.stringify(payloadEvent), idempotencyKey: `price-list:${record.quote.partNumber}:${new Date().toISOString().slice(0, 10)}`, status: "pending", createdAt: new Date().toISOString() }).onConflictDoNothing();
      await recordAudit(db, { actorEmail: profile.email, actorName: profile.name, action: "quote_price_list_event_created", entity: "quote", details: `Evento de inclusão do PN ${record.quote.partNumber} criado para Lista de Preços.`, after: payloadEvent });
      return Response.json({ ok: true, queued: true, generatedOrders });
      const partNumber = String(payload.partNumber ?? record.quote.partNumber).trim();
      const description = String(payload.description ?? record.quote.description).trim();
      const ncm = String(payload.ncm ?? record.quote.ncm).trim();
      const vt = String(payload.vt ?? record.quote.vt).trim();
      const origin = deriveOrigin(vt);
      const netPriceCents = Math.trunc(Number(payload.netPriceCents ?? record.quote.netPriceCents) || 0);
      const justification = String(payload.justification ?? "").trim().replace(/\s+/g, " ");
      if (!partNumber || !description || !ncm || !vt || !origin || netPriceCents <= 0) return Response.json({ error: "Preencha PN, descrição, NCM, VT e net price para incluir o item." }, { status: 400 });
      if (justification.length < 10 || justification.length > 1000) return Response.json({ error: "Informe uma justificativa entre 10 e 1.000 caracteres." }, { status: 400 });
      const samePartQuotes = await db.select({ status: quoteRequests.status }).from(quoteRequests).where(eq(quoteRequests.partNumber, partNumber));
      const approvalCount = samePartQuotes.filter((quote) => isApprovedForOrder(quote.status)).length;
      if (approvalCount <= 10) return Response.json({ error: `O PN ${partNumber} possui ${approvalCount} aprovações. A inclusão automática exige mais de 10.` }, { status: 409 });
      const [activeImport] = await db.select().from(priceListImports).where(eq(priceListImports.isActive, true)).orderBy(desc(priceListImports.importedAt)).limit(1);
      if (!activeImport) return Response.json({ error: "Importe uma lista de preços vigente antes de promover um PN de cotações." }, { status: 409 });
      let availableStates: string[] = [];
      try { availableStates = JSON.parse(activeImport.statesJson) as string[]; } catch { availableStates = []; }
      const importedAt = new Date().toISOString();
      const [existingItem] = await db.select().from(priceListItems).where(and(eq(priceListItems.importId, activeImport.id), eq(priceListItems.partNumber, partNumber))).limit(1);
      let statePrices: Record<string, { netPriceCents?: number; final?: number | null; n2?: number | null; n3?: number | null }> = {};
      if (existingItem) {
        try { statePrices = JSON.parse(existingItem.statePricesJson) as typeof statePrices; } catch { statePrices = {}; }
      }
      for (const state of availableStates) statePrices[state] = { ...(statePrices[state] || {}), netPriceCents, final: statePrices[state]?.final ?? (payload.finalPriceCents ?? null), n2: statePrices[state]?.n2 ?? null, n3: statePrices[state]?.n3 ?? null };
      const itemAfter = { partNumber, description, ncm, vt, origin, netPriceCents, statePrices };
      if (existingItem) {
        await db.update(priceListItems).set({ partNumber, description, ncm, vt, origin, netPriceCents, statePricesJson: JSON.stringify(statePrices), updatedAt: importedAt }).where(eq(priceListItems.id, existingItem.id));
      } else {
        await db.insert(priceListItems).values({ importId: activeImport.id, partNumber, description, family: String(payload.family ?? "").trim(), unit: String(payload.unit ?? "").trim(), ncm, vt, origin, netPriceCents, statePricesJson: JSON.stringify(statePrices), importedAt, updatedAt: importedAt });
      }
      await db.insert(quotePriceListControl).values({ partNumber, includedAt: importedAt, includedByEmail: profile.email }).onConflictDoUpdate({ target: quotePriceListControl.partNumber, set: { includedAt: importedAt, includedByEmail: profile.email } });
      await db.insert(quoteCatalog).values({ partNumber, description, ncm, vt, origin, netPriceCents, importedAt, updatedAt: importedAt }).onConflictDoUpdate({ target: quoteCatalog.partNumber, set: { description, ncm, vt, origin, netPriceCents, importedAt, updatedAt: importedAt } });
      await recordAudit(db, { actorEmail: profile.email, actorName: profile.name, action: "quote_promoted_to_price_list", entity: "price_list", details: `PN ${partNumber} aprovado para inclusão na lista de preços após ${approvalCount} aprovações. Justificativa: ${justification}`, before: existingItem ? { partNumber: existingItem.partNumber, description: existingItem.description, ncm: existingItem.ncm, vt: existingItem.vt, origin: existingItem.origin, netPriceCents: existingItem.netPriceCents } : null, after: { ...itemAfter, approvalCount, justification, effectiveAt: String(payload.effectiveAt ?? "").trim() || importedAt.slice(0, 10) } });
      return Response.json({ ok: true, partNumber, approvalCount, included: true });
    }
    if (!canAct(profile, record.quote.status, payload.action, record.quote.actionOwnerEmail)) return Response.json({ error: "Esta ação está disponível somente para o responsável atual da cotação." }, { status: 403 });
    const now = new Date().toISOString();
    let patch: Partial<typeof quoteRequests.$inferInsert> = { updatedAt: now };
    if (payload.action === "needs_action") patch = { ...patch, status: "awaiting_cost_review", actionOwnerRole: "global_management", actionOwnerEmail: profile.email, actionNote: payload.actionNote?.trim() || "Revisão de custo obrigatória." };
    else if (payload.action === "return_quote") {
      const description = payload.description?.trim() || ""; const ncm = payload.ncm?.trim() || ""; const vt = payload.vt?.trim() || ""; const origin = deriveOrigin(vt); const netPriceCents = Math.trunc(Number(payload.netPriceCents) || 0);
      if (!description || !ncm || !vt || !origin || netPriceCents <= 0) return Response.json({ error: "Preencha descrição, NCM, VT e net price para retornar a cotação. A origem é calculada pelo 3º caractere da VT." }, { status: 400 });
      const allUsers = await db.select().from(users);
      const dealerUser = allUsers.find((user) => user.active && normalizeUserRole(user.email, user.role) === "dealer_manager" && user.dealershipId === record.quote.dealershipId)
        || allUsers.find((user) => user.active && normalizeUserRole(user.email, user.role) === "concession" && user.dealershipId === record.quote.dealershipId);
      await db.insert(quoteCatalog).values({ partNumber: record.quote.partNumber, description, ncm, vt, origin, netPriceCents, importedAt: now, updatedAt: now }).onConflictDoUpdate({ target: quoteCatalog.partNumber, set: { description, ncm, vt, origin, netPriceCents, importedAt: now, updatedAt: now } });
      patch = { ...patch, status: "awaiting_dealer_acceptance", actionOwnerRole: "dealer_manager", actionOwnerEmail: dealerUser?.email || record.quote.requestedByEmail, description, ncm, vt, origin, netPriceCents, catalogImportedAt: now, actionNote: payload.actionNote?.trim() || "Cotação retornada pela Gestão Global.", returnedAt: now };
    } else if (["approve", "reject"].includes(payload.action)) {
      if (payload.action === "approve") {
        const allUsers = await db.select().from(users);
        const assignedFactoryEmail = record.dealership.factoryManagerEmail.trim().toLowerCase();
        const factoryUser = allUsers.find((user) => {
          const role = normalizeUserRole(user.email, user.role);
          return user.active && role === "factory_manager" && (
            user.email.toLowerCase() === assignedFactoryEmail ||
            (!assignedFactoryEmail && user.dealershipId === record.quote.dealershipId)
          );
        });
        if (!factoryUser) return Response.json({ error: "Não há Gestor Fábrica ativo vinculado a esta concessionária." }, { status: 409 });
        const approvedQuantity = Math.max(1, Math.trunc(Number(payload.approvedQuantity) || record.quote.requestedQuantity || 1));
        patch = { ...patch, status: "awaiting_order", actionOwnerRole: "factory_manager", actionOwnerEmail: factoryUser.email, approvedQuantity, decidedAt: now, decidedByEmail: profile.email, actionNote: payload.actionNote?.trim() || "Aprovada; encaminhada à Fábrica." };
      } else {
        patch = { ...patch, status: "closed", actionOwnerRole: "", actionOwnerEmail: "", decidedAt: now, decidedByEmail: profile.email, actionNote: payload.actionNote?.trim() || "Retorno rejeitado pela concessionária." };
      }
    }
    else if (payload.action === "place_order") {
      const horschOrderNumber = payload.horschOrderNumber?.trim() || "";
      if (!horschOrderNumber) return Response.json({ error: "Informe o número do pedido HORSCH para concluir o input." }, { status: 400 });
      patch = { ...patch, status: "order_generated", actionOwnerRole: "", actionOwnerEmail: "", horschOrderNumber, factoryActionAt: now, actionNote: payload.actionNote?.trim() || `Pedido HORSCH ${horschOrderNumber} lançado pela Fábrica.` };
    }
    else return Response.json({ error: "Ação de cotação não reconhecida." }, { status: 400 });
    await db.update(quoteRequests).set(patch).where(eq(quoteRequests.id, payload.id));
    await recordAudit(db, { actorEmail: profile.email, actorName: profile.name, action: "quote_" + payload.action, entity: "quote", details: "Ação " + payload.action + " registrada na cotação " + payload.id + ".", before: { status: record.quote.status }, after: patch });
    return Response.json({ ok: true, status: patch.status });
  } catch (error) { return Response.json({ error: errorMessage(error) }, { status: 500 }); }
}
