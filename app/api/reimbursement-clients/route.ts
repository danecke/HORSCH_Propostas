import { asc, eq } from "drizzle-orm";
import { reimbursementClients } from "../../../db/schema";
import { getAccessProfile } from "../../../lib/access";
import { recordAudit } from "../../../lib/audit";
import { ensureReimbursementStorage } from "../../../lib/reimbursement-db";

export const dynamic = "force-dynamic";

function errorResponse(message: string, status = 400) {
  return Response.json({ error: message }, { status });
}

function canManageClients(role: string) {
  return role === "general_admin" || role === "global_management";
}

function normalizeDocument(value: unknown) {
  return String(value ?? "").replace(/\D/g, "");
}

function isValidDocument(value: string) {
  return value.length === 11 || value.length === 14;
}

function normalizeState(value: unknown) {
  return String(value ?? "").trim().toUpperCase().slice(0, 2);
}

function parseClientBody(body: Record<string, unknown>) {
  const legalName = String(body.legalName ?? "").trim();
  const cnpj = normalizeDocument(body.cnpj);
  const state = normalizeState(body.state);
  const clientType = String(body.clientType ?? "").trim() || "Não informado";
  const n2 = Boolean(body.n2);
  const n3 = Boolean(body.n3);
  const status = String(body.status ?? "active").trim() === "inactive" ? "inactive" : "active";
  if (!legalName || !isValidDocument(cnpj) || !/^[A-Z]{2}$/.test(state)) {
    return { error: "Informe Razão Social, CPF/CNPJ válido com 11 ou 14 dígitos e UF." };
  }
  if (n2 && n3) {
    return { error: "Selecione apenas uma classificação de reembolso por cliente: N2 ou N3." };
  }
  return { legalName, cnpj, state, clientType, n2, n3, status };
}

export async function GET() {
  const profile = await getAccessProfile();
  if (!profile) return errorResponse("Acesso não autorizado.", 403);
  if (!canManageClients(profile.role)) return errorResponse("Somente ADM e Gestão Global podem consultar o cadastro de clientes.", 403);
  try {
    const db = await ensureReimbursementStorage();
    const clients = await db.select().from(reimbursementClients).orderBy(asc(reimbursementClients.legalName), asc(reimbursementClients.state));
    return Response.json({ clients });
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : "Não foi possível consultar os clientes.", 500);
  }
}

export async function POST(request: Request) {
  const profile = await getAccessProfile();
  if (!profile) return errorResponse("Acesso não autorizado.", 403);
  if (!canManageClients(profile.role)) return errorResponse("Somente ADM e Gestão Global podem cadastrar clientes.", 403);
  try {
    const body = await request.json() as Record<string, unknown>;
    const parsed = parseClientBody(body);
    if ("error" in parsed) return errorResponse(parsed.error ?? "Dados de cliente inválidos.");
    const db = await ensureReimbursementStorage();
    const [duplicate] = await db.select().from(reimbursementClients).where(eq(reimbursementClients.cnpj, parsed.cnpj)).limit(1);
    if (duplicate && duplicate.state === parsed.state) return errorResponse("Já existe um cadastro ativo ou inativo para este CPF/CNPJ e UF.", 409);
    const now = new Date().toISOString();
    const [created] = await db.insert(reimbursementClients).values({ ...parsed, createdByEmail: profile.email, createdAt: now, updatedAt: now }).returning();
    if (!created) return errorResponse("Não foi possível salvar o cliente.", 500);
    await recordAudit(db, { actorEmail: profile.email, actorName: profile.name, action: "reimbursement_client_created", entity: "reimbursement_client", details: `Cliente ${created.legalName} cadastrado para ${created.state}.`, after: created });
    return Response.json({ client: created }, { status: 201 });
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : "Não foi possível cadastrar o cliente.", 500);
  }
}

export async function PATCH(request: Request) {
  const profile = await getAccessProfile();
  if (!profile) return errorResponse("Acesso não autorizado.", 403);
  if (!canManageClients(profile.role)) return errorResponse("Somente ADM e Gestão Global podem editar clientes.", 403);
  try {
    const body = await request.json() as Record<string, unknown>;
    const id = Math.trunc(Number(body.id) || 0);
    if (!id) return errorResponse("Informe o cliente.");
    const parsed = parseClientBody(body);
    if ("error" in parsed) return errorResponse(parsed.error ?? "Dados de cliente inválidos.");
    const db = await ensureReimbursementStorage();
    const [before] = await db.select().from(reimbursementClients).where(eq(reimbursementClients.id, id)).limit(1);
    if (!before) return errorResponse("Cliente não encontrado.", 404);
    const [duplicate] = await db.select().from(reimbursementClients).where(eq(reimbursementClients.cnpj, parsed.cnpj)).limit(1);
    if (duplicate && duplicate.id !== id && duplicate.state === parsed.state) return errorResponse("Já existe outro cadastro para este CPF/CNPJ e UF.", 409);
    const [updated] = await db.update(reimbursementClients).set({ ...parsed, updatedAt: new Date().toISOString() }).where(eq(reimbursementClients.id, id)).returning();
    if (!updated) return errorResponse("Não foi possível editar o cliente.", 500);
    await recordAudit(db, { actorEmail: profile.email, actorName: profile.name, action: "reimbursement_client_updated", entity: "reimbursement_client", details: `Cliente ${updated.legalName} atualizado.`, before, after: updated });
    return Response.json({ client: updated });
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : "Não foi possível editar o cliente.", 500);
  }
}

export async function DELETE(request: Request) {
  const profile = await getAccessProfile();
  if (!profile) return errorResponse("Acesso não autorizado.", 403);
  if (!canManageClients(profile.role)) return errorResponse("Somente ADM e Gestão Global podem inativar clientes.", 403);
  try {
    const body = await request.json() as { id?: number };
    const id = Math.trunc(Number(body.id) || 0);
    if (!id) return errorResponse("Informe o cliente.");
    const db = await ensureReimbursementStorage();
    const [before] = await db.select().from(reimbursementClients).where(eq(reimbursementClients.id, id)).limit(1);
    if (!before) return errorResponse("Cliente não encontrado.", 404);
    const now = new Date().toISOString();
    const [updated] = await db.update(reimbursementClients).set({ status: "inactive", updatedAt: now }).where(eq(reimbursementClients.id, id)).returning();
    await recordAudit(db, { actorEmail: profile.email, actorName: profile.name, action: "reimbursement_client_deactivated", entity: "reimbursement_client", details: `Cliente ${before.legalName} inativado.`, before, after: updated });
    return Response.json({ ok: true, client: updated });
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : "Não foi possível inativar o cliente.", 500);
  }
}
