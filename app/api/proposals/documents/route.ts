import { and, eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { dealerships, proposalDocuments, proposals } from "../../../../db/schema";
import { getAccessProfile, type AccessProfile } from "../../../../lib/access";
import { recordAudit } from "../../../../lib/audit";

export const dynamic = "force-dynamic";

const MAX_FILE_SIZE = 8 * 1024 * 1024;
const ALLOWED_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);
const CATEGORY_LABELS: Record<string, string> = {
  invoice: "NF",
  proof: "Comprovante de venda",
  other: "Outro documento",
};

function errorResponse(message: string, status = 400) {
  return Response.json({ error: message }, { status });
}

function canManageDocuments(profile: AccessProfile) {
  return ["general_admin", "global_management", "factory_manager"].includes(profile.role);
}

function proposalIsVisible(profile: AccessProfile, dealer: { id: number; factoryManagerEmail: string }) {
  if (["general_admin", "global_management"].includes(profile.role)) return true;
  if (profile.role === "factory_manager") return dealer.factoryManagerEmail.toLowerCase() === profile.email;
  if (profile.role === "concession") return false;
  return dealer.id === profile.dealershipId;
}

function safeFileName(value: string) {
  const normalized = value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
  const cleaned = normalized.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return (cleaned || "documento").slice(0, 120);
}

function contentDisposition(fileName: string) {
  const encoded = encodeURIComponent(fileName);
  return `inline; filename="${fileName.replace(/"/g, "")}"; filename*=UTF-8''${encoded}`;
}

async function getProposalContext(profile: AccessProfile, proposalId: string) {
  const db = await getDb();
  const [record] = await db
    .select({ proposal: proposals, dealer: dealerships })
    .from(proposals)
    .innerJoin(dealerships, eq(proposals.dealershipId, dealerships.id))
    .where(eq(proposals.id, proposalId))
    .limit(1);
  if (!record) return { db, record: null };
  if (!proposalIsVisible(profile, record.dealer)) return { db, record: null };
  return { db, record };
}

export async function POST(request: Request) {
  const profile = await getAccessProfile();
  if (!profile) return errorResponse("Acesso não autorizado.", 403);
  if (!canManageDocuments(profile)) return errorResponse("Seu perfil não pode anexar documentos.", 403);

  try {
    const form = await request.formData();
    const proposalId = String(form.get("proposalId") ?? "").trim();
    const category = String(form.get("category") ?? "other");
    const file = form.get("file");
    if (!proposalId) return errorResponse("Informe a proposta.");
    if (!(file instanceof File)) return errorResponse("Selecione um documento.");
    if (!ALLOWED_TYPES.has(file.type)) return errorResponse("Formato não permitido. Anexe PDF, JPG, PNG, WEBP ou XLSX.");
    if (!file.size || file.size > MAX_FILE_SIZE) return errorResponse("Cada documento deve ter no máximo 8 MB. Fotos grandes devem ser reduzidas antes do envio.", 413);
    if (!(category in CATEGORY_LABELS)) return errorResponse("Tipo de documento inválido.");

    const { db, record } = await getProposalContext(profile, proposalId);
    if (!record) return errorResponse("Proposta não encontrada ou fora do seu escopo.", 404);
    const { env } = await import("cloudflare:workers");
    if (!env.BUCKET) return errorResponse("O armazenamento de documentos ainda não está configurado.", 503);

    const fileName = safeFileName(file.name);
    const storageKey = `proposals/${proposalId}/${crypto.randomUUID()}-${fileName}`;
    await env.BUCKET.put(storageKey, file.stream(), {
      httpMetadata: { contentType: file.type },
      customMetadata: { proposalId, originalName: file.name, category },
    });
    try {
      const [document] = await db
        .insert(proposalDocuments)
        .values({
          proposalId,
          category,
          fileName: file.name.slice(0, 180),
          contentType: file.type,
          sizeBytes: file.size,
          storageKey,
          uploadedByEmail: profile.email,
          uploadedByName: profile.name,
        })
        .returning({ id: proposalDocuments.id });
      await recordAudit(db, {
        proposalId,
        actorEmail: profile.email,
        actorName: profile.name,
        action: "document_attached",
        entity: "proposal_document",
        details: `${CATEGORY_LABELS[category]} anexado: ${file.name.slice(0, 180)}.`,
        after: { documentId: document.id, category, fileName: file.name, contentType: file.type, sizeBytes: file.size },
      });
      return Response.json({ ok: true, document: { id: document.id, category, fileName: file.name, contentType: file.type, sizeBytes: file.size } }, { status: 201 });
    } catch (error) {
      await env.BUCKET.delete(storageKey);
      throw error;
    }
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : "Não foi possível anexar o documento.", 500);
  }
}

export async function GET(request: Request) {
  const profile = await getAccessProfile();
  if (!profile) return errorResponse("Acesso não autorizado.", 403);
  const url = new URL(request.url);
  const proposalId = url.searchParams.get("proposalId")?.trim() ?? "";
  const documentId = Number(url.searchParams.get("documentId") ?? 0);
  if (!proposalId || !documentId) return errorResponse("Informe o documento.");

  try {
    const { db, record } = await getProposalContext(profile, proposalId);
    if (!record) return errorResponse("Documento não encontrado ou fora do seu escopo.", 404);
    const [document] = await db
      .select()
      .from(proposalDocuments)
      .where(and(eq(proposalDocuments.id, documentId), eq(proposalDocuments.proposalId, proposalId)))
      .limit(1);
    if (!document) return errorResponse("Documento não encontrado.", 404);
    const { env } = await import("cloudflare:workers");
    if (!env.BUCKET) return errorResponse("O armazenamento de documentos ainda não está configurado.", 503);
    const object = await env.BUCKET.get(document.storageKey);
    if (!object) return errorResponse("O arquivo não está disponível no armazenamento.", 404);
    return new Response(object.body, {
      headers: {
        "Content-Type": document.contentType,
        "Content-Length": String(document.sizeBytes),
        "Content-Disposition": contentDisposition(document.fileName),
        "Cache-Control": "private, max-age=300",
      },
    });
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : "Não foi possível abrir o documento.", 500);
  }
}
