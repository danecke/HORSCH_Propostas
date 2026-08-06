import { desc, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { dealerships, quoteCatalog, quoteRequests, users } from "../../../db/schema";
import { recordAudit } from "../../../lib/audit";
import { getAccessProfile, normalizeUserRole, roleLabel } from "../../../lib/access";
export const dynamic = "force-dynamic";
const DAY = 86400000;
function forbidden() { return Response.json({ error: "Seu perfil não possui acesso às cotações." }, { status: 403 }); }
function actionForStatus(status: string) { return ["global_review", "data_pending"].includes(status) ? "global_management" : status === "returned" ? "dealer_manager" : status === "order_pending" ? "factory_manager" : ""; }
function statusLabel(status: string) { return ({ global_review: "Em análise global", data_pending: "Ação necessária", returned: "Retorno enviado", approved: "Aprovada", rejected: "Rejeitada", order_pending: "Aguardando input fábrica", order_input: "Input realizado" } as Record<string, string>)[status] || status; }
function canSee(profile: NonNullable<Awaited<ReturnType<typeof getAccessProfile>>>, dealer: { id: number; factoryManagerEmail: string }) {
  if (["general_admin", "global_management"].includes(profile.role)) return true;
  if (profile.role === "factory_manager") return dealer.factoryManagerEmail.toLowerCase() === profile.email.toLowerCase();
  return profile.role === "dealer_manager" && dealer.id === profile.dealershipId;
}
function canAct(profile: NonNullable<Awaited<ReturnType<typeof getAccessProfile>>>, status: string, action: string) {
  if (["return_quote", "needs_action"].includes(action)) return ["general_admin", "global_management"].includes(profile.role);
  if (["approve", "reject"].includes(action)) return profile.role === "dealer_manager" && status === "returned";
  return action === "place_order" && profile.role === "factory_manager" && status === "order_pending";
}
function errorMessage(error: unknown) { const message = error instanceof Error ? error.message : "Erro inesperado."; return message.includes("no such table") ? "A estrutura de cotações ainda está sendo preparada. Tente novamente." : message; }
export async function GET() {
  const profile = await getAccessProfile();
  if (!profile || profile.role === "concession") return forbidden();
  try {
    const db = await getDb();
    const [dealers, allUsers] = await Promise.all([db.select().from(dealerships), db.select().from(users)]);
    const visible = new Set(dealers.filter((dealer) => canSee(profile, dealer)).map((dealer) => dealer.id));
    const rows = await db.select({ quote: quoteRequests, dealership: dealerships }).from(quoteRequests).innerJoin(dealerships, eq(quoteRequests.dealershipId, dealerships.id)).orderBy(desc(quoteRequests.updatedAt), desc(quoteRequests.createdAt));
    return Response.json({ quotes: rows.filter((row) => visible.has(row.quote.dealershipId)).map(({ quote, dealership }) => {
      const ownerRole = actionForStatus(quote.status);
      const owner = allUsers.find((user) => user.email.toLowerCase() === quote.actionOwnerEmail.toLowerCase());
      const requester = allUsers.find((user) => user.email.toLowerCase() === quote.requestedByEmail.toLowerCase());
      return { ...quote, dealership: dealership.name, city: dealership.city, state: dealership.state, statusLabel: statusLabel(quote.status), actionOwnerRole: ownerRole, actionOwnerLabel: ownerRole ? roleLabel(ownerRole as "global_management" | "factory_manager" | "dealer_manager") : "", actionOwnerName: owner?.name || quote.actionOwnerEmail || "—", requestedByName: requester?.name || quote.requestedByName };
    }) });
  } catch (error) { return Response.json({ error: errorMessage(error) }, { status: 500 }); }
}
export async function POST(request: Request) {
  const profile = await getAccessProfile();
  if (!profile || profile.role !== "dealer_manager") return forbidden();
  try {
    const payload = (await request.json()) as { partNumber?: string };
    const partNumber = payload.partNumber?.trim();
    if (!partNumber) return Response.json({ error: "Informe o PN para solicitar a cotação." }, { status: 400 });
    if (!profile.dealershipId) return Response.json({ error: "Usuário sem concessionária vinculada." }, { status: 400 });
    const db = await getDb();
    const [dealer] = await db.select().from(dealerships).where(eq(dealerships.id, profile.dealershipId)).limit(1);
    if (!dealer) return Response.json({ error: "Concessionária não encontrada." }, { status: 404 });
    const [catalog] = await db.select().from(quoteCatalog).where(eq(quoteCatalog.partNumber, partNumber)).limit(1);
    const fresh = Boolean(catalog?.importedAt && Date.now() - new Date(catalog.importedAt).getTime() <= 30 * DAY);
    const allUsers = await db.select().from(users);
    const globalUser = allUsers.find((user) => user.active && normalizeUserRole(user.email, user.role) === "global_management");
    const dealerUser = allUsers.find((user) => user.active && normalizeUserRole(user.email, user.role) === "dealer_manager" && user.dealershipId === profile.dealershipId);
    const now = new Date().toISOString();
    const id = "COT-" + Date.now().toString(36).toUpperCase();
    const status = fresh ? "returned" : "global_review";
    await db.insert(quoteRequests).values({ id, partNumber, dealershipId: profile.dealershipId, requestedByEmail: profile.email, requestedByName: profile.name, status, actionOwnerRole: fresh ? "dealer_manager" : "global_management", actionOwnerEmail: fresh ? (dealerUser?.email || profile.email) : (globalUser?.email || ""), description: catalog?.description || "", vt: catalog?.vt || "", origin: catalog?.origin || "", netPriceCents: fresh ? catalog?.netPriceCents || null : null, catalogImportedAt: catalog?.importedAt || null, actionNote: fresh ? "Dados encontrados na base e imputados nos últimos 30 dias." : catalog ? "Dados encontrados, mas o impute tem mais de 30 dias. A Gestão Global deve revisar." : "PN não localizado na base. A Gestão Global deve imputar ou revisar.", requestedAt: now, returnedAt: fresh ? now : null, createdAt: now, updatedAt: now });
    await recordAudit(db, { actorEmail: profile.email, actorName: profile.name, action: "quote_requested", entity: "quote", details: "Cotação " + id + " solicitada para o PN " + partNumber + ".", after: { id, partNumber, status, dealership: dealer.name, fresh } });
    return Response.json({ id, status, fresh });
  } catch (error) { return Response.json({ error: errorMessage(error) }, { status: 500 }); }
}
export async function PATCH(request: Request) {
  const profile = await getAccessProfile();
  if (!profile || profile.role === "concession") return forbidden();
  try {
    const payload = (await request.json()) as { id?: string; action?: string; description?: string; vt?: string; origin?: string; netPriceCents?: number | null; actionNote?: string };
    if (!payload.id || !payload.action) return Response.json({ error: "Ação de cotação incompleta." }, { status: 400 });
    const db = await getDb();
    const [record] = await db.select({ quote: quoteRequests, dealership: dealerships }).from(quoteRequests).innerJoin(dealerships, eq(quoteRequests.dealershipId, dealerships.id)).where(eq(quoteRequests.id, payload.id)).limit(1);
    if (!record || !canSee(profile, record.dealership)) return Response.json({ error: "Cotação fora do seu escopo." }, { status: 403 });
    if (!canAct(profile, record.quote.status, payload.action)) return Response.json({ error: "Seu perfil não pode executar esta ação nesta etapa." }, { status: 403 });
    const now = new Date().toISOString();
    let patch: Partial<typeof quoteRequests.$inferInsert> = { updatedAt: now };
    if (payload.action === "needs_action") patch = { ...patch, status: "data_pending", actionOwnerRole: "global_management", actionOwnerEmail: profile.email, actionNote: payload.actionNote?.trim() || "Imputar ou revisar os dados do PN." };
    else if (payload.action === "return_quote") {
      const description = payload.description?.trim() || ""; const vt = payload.vt?.trim() || ""; const origin = payload.origin?.trim() || ""; const netPriceCents = Math.trunc(Number(payload.netPriceCents) || 0);
      if (!description || !vt || !origin || netPriceCents <= 0) return Response.json({ error: "Preencha descrição, VT, origem e net price para retornar a cotação." }, { status: 400 });
      const allUsers = await db.select().from(users);
      const dealerUser = allUsers.find((user) => user.active && normalizeUserRole(user.email, user.role) === "dealer_manager" && user.dealershipId === record.quote.dealershipId);
      await db.insert(quoteCatalog).values({ partNumber: record.quote.partNumber, description, vt, origin, netPriceCents, importedAt: now, updatedAt: now }).onConflictDoUpdate({ target: quoteCatalog.partNumber, set: { description, vt, origin, netPriceCents, importedAt: now, updatedAt: now } });
      patch = { ...patch, status: "returned", actionOwnerRole: "dealer_manager", actionOwnerEmail: dealerUser?.email || "", description, vt, origin, netPriceCents, catalogImportedAt: now, actionNote: payload.actionNote?.trim() || "Cotação retornada pela Gestão Global.", returnedAt: now };
    } else if (["approve", "reject"].includes(payload.action)) patch = { ...patch, status: payload.action === "approve" ? "order_pending" : "rejected", actionOwnerRole: payload.action === "approve" ? "factory_manager" : "", actionOwnerEmail: payload.action === "approve" ? record.dealership.factoryManagerEmail : "", decidedAt: now, decidedByEmail: profile.email, actionNote: payload.actionNote?.trim() || (payload.action === "approve" ? "Aprovada; encaminhada ao Gestor Fábrica para input do pedido." : "Retorno rejeitado pela concessionária.") };
    else if (payload.action === "place_order") patch = { ...patch, status: "order_input", actionOwnerRole: "", actionOwnerEmail: "", factoryActionAt: now, actionNote: payload.actionNote?.trim() || "Input do pedido realizado pelo Gestor Fábrica." };
    else return Response.json({ error: "Ação de cotação não reconhecida." }, { status: 400 });
    await db.update(quoteRequests).set(patch).where(eq(quoteRequests.id, payload.id));
    await recordAudit(db, { actorEmail: profile.email, actorName: profile.name, action: "quote_" + payload.action, entity: "quote", details: "Ação " + payload.action + " registrada na cotação " + payload.id + ".", before: { status: record.quote.status }, after: patch });
    return Response.json({ ok: true, status: patch.status });
  } catch (error) { return Response.json({ error: errorMessage(error) }, { status: 500 }); }
}
