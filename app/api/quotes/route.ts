import { desc, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { dealerships, quoteCatalog, quoteRequests, users } from "../../../db/schema";
import { recordAudit } from "../../../lib/audit";
import { getAccessProfile, normalizeUserRole, roleLabel } from "../../../lib/access";
export const dynamic = "force-dynamic";
const DAY = 86400000;
function forbidden() { return Response.json({ error: "Seu perfil não possui acesso às cotações." }, { status: 403 }); }
function actionForStatus(status: string) { return ["global_review", "data_pending"].includes(status) ? "global_management" : status === "returned" ? "dealer_manager" : status === "order_pending" ? "factory_manager" : ""; }
function statusLabel(status: string) { return ({ global_review: "Aguardando Gestão Global", data_pending: "Ação da Gestão Global", returned: "Aguardando aprovação", approved: "Aprovada", rejected: "Reprovada e encerrada", order_pending: "Aguardando Gestor Fábrica", order_input: "Pedido colocado" } as Record<string, string>)[status] || status; }
function canSee(profile: NonNullable<Awaited<ReturnType<typeof getAccessProfile>>>, dealer: { id: number; factoryManagerEmail: string }) {
  if (["general_admin", "global_management"].includes(profile.role)) return true;
  if (profile.role === "factory_manager") return dealer.factoryManagerEmail.toLowerCase() === profile.email.toLowerCase();
  return profile.role === "dealer_manager" && dealer.id === profile.dealershipId;
}
function canAct(profile: NonNullable<Awaited<ReturnType<typeof getAccessProfile>>>, status: string, action: string) {
  if (["return_quote", "needs_action"].includes(action)) return ["general_admin", "global_management"].includes(profile.role);
  if (["approve", "reject"].includes(action)) return ["general_admin", "dealer_manager"].includes(profile.role) && status === "returned";
  return action === "place_order" && ["general_admin", "factory_manager"].includes(profile.role) && status === "order_pending";
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
      const actionNote = quote.actionNote
        .replace(/dados do PN encontrados na base e retornados automaticamente:?/gi, "Informações do PN encontradas e retornadas automaticamente:")
        .replace(/base de dados/gi, "informações disponíveis")
        .replace(/\bbase\b/gi, "informações disponíveis");
      const returnSource = quote.status === "returned" ? (/automaticamente/i.test(quote.actionNote) ? "automatic" : "global") : null;
      return { ...quote, returnSource, actionNote, dealership: dealership.name, city: dealership.city, state: dealership.state, statusLabel: statusLabel(quote.status), actionOwnerRole: ownerRole, actionOwnerLabel: ownerRole ? roleLabel(ownerRole as "global_management" | "factory_manager" | "dealer_manager") : "", actionOwnerName: owner?.name || quote.actionOwnerEmail || "—", requestedByName: requester?.name || quote.requestedByName };
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
    const catalogReady = Boolean(
      catalog &&
        catalog.description.trim() &&
        catalog.vt.trim() &&
        catalog.origin.trim() &&
        catalog.netPriceCents > 0,
    );
    const autoReturned = fresh && catalogReady;
    const allUsers = await db.select().from(users);
    const globalUser = allUsers.find((user) => user.active && normalizeUserRole(user.email, user.role) === "global_management");
    const now = new Date().toISOString();
    const id = "COT-" + Date.now().toString(36).toUpperCase();
    const status = autoReturned ? "returned" : "global_review";
    const actionOwnerRole = autoReturned ? "dealer_manager" : "global_management";
    const actionOwnerEmail = autoReturned ? profile.email : globalUser?.email || "";
    const actionNote = autoReturned
      ? "Informações do PN encontradas e retornadas automaticamente: descrição, VT, origem e net price."
      : catalog
        ? "Informações disponíveis, mas precisam de revisão antes do retorno."
        : "Não foi possível completar o retorno automaticamente. A Gestão Global deve revisar antes de responder.";
    await db.insert(quoteRequests).values({ id, partNumber, dealershipId: profile.dealershipId, requestedByEmail: profile.email, requestedByName: profile.name, status, actionOwnerRole, actionOwnerEmail, description: catalog?.description || "", vt: catalog?.vt || "", origin: catalog?.origin || "", netPriceCents: catalog?.netPriceCents || null, catalogImportedAt: catalog?.importedAt || null, actionNote, requestedAt: now, createdAt: now, updatedAt: now });
    await recordAudit(db, { actorEmail: profile.email, actorName: profile.name, action: autoReturned ? "quote_auto_returned" : "quote_requested", entity: "quote", details: autoReturned ? "Cotação " + id + " retornada automaticamente para aprovação da concessionária após localizar o PN " + partNumber + "." : "Cotação " + id + " solicitada para o PN " + partNumber + ".", after: { id, partNumber, status, dealership: dealer.name, fresh, catalogReady, autoReturned } });
    return Response.json({ id, status, fresh, autoReturned });
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
        patch = { ...patch, status: "order_pending", actionOwnerRole: "factory_manager", actionOwnerEmail: factoryUser.email, decidedAt: now, decidedByEmail: profile.email, actionNote: payload.actionNote?.trim() || "Aprovada; encaminhada ao Gestor Fábrica para input do pedido." };
      } else {
        patch = { ...patch, status: "rejected", actionOwnerRole: "", actionOwnerEmail: "", decidedAt: now, decidedByEmail: profile.email, actionNote: payload.actionNote?.trim() || "Retorno rejeitado pela concessionária." };
      }
    }
    else if (payload.action === "place_order") patch = { ...patch, status: "order_input", actionOwnerRole: "", actionOwnerEmail: "", factoryActionAt: now, actionNote: payload.actionNote?.trim() || "Input do pedido realizado pelo Gestor Fábrica." };
    else return Response.json({ error: "Ação de cotação não reconhecida." }, { status: 400 });
    await db.update(quoteRequests).set(patch).where(eq(quoteRequests.id, payload.id));
    await recordAudit(db, { actorEmail: profile.email, actorName: profile.name, action: "quote_" + payload.action, entity: "quote", details: "Ação " + payload.action + " registrada na cotação " + payload.id + ".", before: { status: record.quote.status }, after: patch });
    return Response.json({ ok: true, status: patch.status });
  } catch (error) { return Response.json({ error: errorMessage(error) }, { status: 500 }); }
}
