import { desc, eq, inArray, isNull, or } from "drizzle-orm";
import { unzipSync, zipSync } from "fflate";
import { getDb } from "../../../db";
import { dealerships, priceListImports, priceListItems, reimbursementApprovals, reimbursementClients, reimbursementImports, reimbursementSales } from "../../../db/schema";
import { getAccessProfile, type AccessProfile } from "../../../lib/access";
import { recordAudit } from "../../../lib/audit";
import { ensureReimbursementStorage } from "../../../lib/reimbursement-db";

export const dynamic = "force-dynamic";

const MAX_FILE_SIZE = 120 * 1024 * 1024;
const CHUNK_SIZE = 1 * 1024 * 1024;
const STATES = ["AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO", "PY"];
const STATUS_VALUES = ["N2 Elegível", "N3 Elegível", "N2 Não Elegível", "N3 Não Elegível", "N3 com Negociação", "Divergência de Preço", "Estado sem Cadastro", "Net Price não Encontrado", "NF Duplicada"] as const;
type SaleStatus = (typeof STATUS_VALUES)[number];
type ParsedSale = { partNumber: string; description: string; quantity: number; costUnitCents: number; saleNetUnitCents: number; invoiceUnitCents: number; clientName: string; clientCnpj: string; invoiceNumber: string; state: string; dealershipName: string };

function errorResponse(message: string, status = 400) { return Response.json({ error: message }, { status }); }
function isManager(profile: AccessProfile) { return ["general_admin", "global_management", "factory_manager"].includes(profile.role); }
function isClientManager(profile: AccessProfile) { return ["general_admin", "global_management"].includes(profile.role); }
function isValidUploadId(value: unknown) { return typeof value === "string" && /^[a-f0-9-]{36}$/i.test(value); }
function normalize(value: unknown) { return String(value ?? "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").trim().replace(/\s+/g, " ").toLocaleLowerCase("pt-BR"); }
function normalizeCnpj(value: unknown) { return String(value ?? "").replace(/\D/g, ""); }
function safeFileName(value: string) { return (value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "vendas-reembolso.xlsx").slice(0, 140); }
function cents(value: unknown) {
  if (value === null || value === undefined || String(value).trim() === "") return 0;
  const raw = String(value).trim().replace(/R\$/gi, "").replace(/\s/g, "");
  const normalizedValue = raw.includes(",") ? raw.replace(/\./g, "").replace(",", ".") : raw.replace(/[^\d.-]/g, "");
  const number = Number(normalizedValue);
  return Number.isFinite(number) ? Math.round(number * 100) : 0;
}
function quantity(value: unknown) { const number = Number(String(value ?? "").replace(",", ".").replace(/[^\d.-]/g, "")); return Number.isFinite(number) ? Math.max(0, Math.round(number)) : 0; }
function decode(bytes: Uint8Array) { return new TextDecoder().decode(bytes); }
function xmlUnescape(value: string) { return value.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'"); }
function columnIndex(value: string) { let result = 0; for (const letter of value) result = result * 26 + letter.charCodeAt(0) - 64; return result; }
function cellText(value: string) { return xmlUnescape(value.replace(/<[^>]+>/g, "").trim()); }
function sharedStrings(files: Record<string, Uint8Array>) { const xml = decode(files["xl/sharedStrings.xml"] ?? new Uint8Array()); return [...xml.matchAll(/<si[\s\S]*?<\/si>/g)].map((match) => [...match[0].matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((part) => xmlUnescape(part[1])).join("")); }
function worksheetPath(files: Record<string, Uint8Array>) {
  const workbook = decode(files["xl/workbook.xml"] ?? new Uint8Array());
  const relationships = decode(files["xl/_rels/workbook.xml.rels"] ?? new Uint8Array());
  const firstSheet = workbook.match(/<sheet\b[^>]*r:id="([^"]+)"[^>]*>/i)?.[1];
  const relationship = firstSheet ? [...relationships.matchAll(/<Relationship\b([^>]*?)\/?>(?:<\/Relationship>)?/gi)].map((match) => match[1]).find((attributes) => attributes.match(/\bId="([^"]+)"/i)?.[1] === firstSheet) : "";
  const target = relationship?.match(/\bTarget="([^"]+)"/i)?.[1];
  if (target) { const path = target.replace(/^\/+/, "").replace(/^\.\//, ""); const candidate = path.startsWith("xl/") ? path : `xl/${path}`; if (files[candidate]) return candidate; }
  return files["xl/worksheets/sheet1.xml"] ? "xl/worksheets/sheet1.xml" : "";
}
function parseXlsx(bytes: Uint8Array): string[][] {
  const files = unzipSync(bytes) as Record<string, Uint8Array>;
  const path = worksheetPath(files);
  if (!path) throw new Error("Não foi possível localizar a primeira aba do Excel.");
  const strings = sharedStrings(files);
  return [...decode(files[path]).matchAll(/<row(?:\s[^>]*)?>([\s\S]*?)<\/row>/g)].map((row) => {
    const values: Record<number, string> = {};
    for (const cell of row[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const ref = cell[1].match(/\br="([A-Z]+)\d+"/i)?.[1]; if (!ref) continue;
      const type = cell[1].match(/\bt="([^"]+)"/)?.[1] ?? "";
      const body = cell[2] ?? "";
      const raw = type === "inlineStr" ? [...body.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((match) => xmlUnescape(match[1])).join("") : cellText(body.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? "");
      values[columnIndex(ref)] = type === "s" && raw ? strings[Number(raw)] ?? "" : raw;
    }
    const max = Math.max(-1, ...Object.keys(values).map(Number));
    return Array.from({ length: max + 1 }, (_, index) => values[index] ?? "");
  });
}
function parseDelimited(bytes: Uint8Array): string[][] {
  const text = decode(bytes).replace(/^\uFEFF/, "");
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const delimiter = firstLine.includes("\t") ? "\t" : firstLine.split(";").length > firstLine.split(",").length ? ";" : ",";
  const rows: string[][] = []; let row: string[] = []; let value = ""; let quoted = false;
  for (let index = 0; index < text.length; index += 1) { const character = text[index]; const next = text[index + 1]; if (character === '"' && quoted && next === '"') { value += '"'; index += 1; } else if (character === '"') quoted = !quoted; else if (character === delimiter && !quoted) { row.push(value); value = ""; } else if ((character === "\n" || character === "\r") && !quoted) { if (character === "\r" && next === "\n") index += 1; row.push(value); value = ""; if (row.some((cell) => cell.trim())) rows.push(row); row = []; } else value += character; }
  row.push(value); if (row.some((cell) => cell.trim())) rows.push(row); return rows;
}
function headerIndex(headers: string[], patterns: RegExp[]) { return headers.findIndex((header) => patterns.some((pattern) => pattern.test(normalize(header)))); }
function stateCode(value: unknown) { const cleaned = normalize(value).toUpperCase(); const names: Record<string, string> = { RONDONIA: "RO", ACRE: "AC", AMAZONAS: "AM", RORAIMA: "RR", PARA: "PA", AMAPA: "AP", TOCANTINS: "TO", MARANHAO: "MA", PIAUI: "PI", CEARA: "CE", RIOGRANDEDONORTE: "RN", PARAIBA: "PB", PERNAMBUCO: "PE", ALAGOAS: "AL", SERGIPE: "SE", BAHIA: "BA", MINASGERAIS: "MG", ESPIRITOSANTO: "ES", RIODEJANEIRO: "RJ", SAOPAULO: "SP", PARANA: "PR", SANTACATARINA: "SC", RIOGRANDEDOSUL: "RS", MATOGROSSODOSUL: "MS", MATOGROSSO: "MT", GOIAS: "GO", DISTRITOFEDERAL: "DF", PARAGUAI: "PY" }; return cleaned.length === 2 && STATES.includes(cleaned) ? cleaned : names[cleaned.replace(/\s/g, "")] ?? ""; }
function parseSales(bytes: Uint8Array, fileName: string): ParsedSale[] {
  const rows = fileName.toLowerCase().endsWith(".xlsx") ? parseXlsx(bytes) : parseDelimited(bytes);
  if (!rows.length) throw new Error("A planilha está vazia.");
  const headers = rows[0];
  const indexes = {
    partNumber: headerIndex(headers, [/^pn$/, /part.?number/, /codigo.*peca/]),
    description: headerIndex(headers, [/descri/]),
    quantity: headerIndex(headers, [/quant/, /^qtd/]),
    cost: headerIndex(headers, [/custo.*medio/, /custo.*liquido/]),
    saleNet: headerIndex(headers, [/valor.*venda.*liquido/, /venda.*liquido/]),
    invoice: headerIndex(headers, [/valor.*venda.*nf/, /venda.*nf/]),
    client: headerIndex(headers, [/^cliente$/, /razao.*social/]),
    cnpj: headerIndex(headers, [/cnpj/]),
    nf: headerIndex(headers, [/^nf$/, /nota.*fiscal/, /invoice/]),
    state: headerIndex(headers, [/estado/, /^uf$/]),
    dealership: headerIndex(headers, [/concession/, /dealer/]),
  };
  const required = ["partNumber", "quantity", "cost", "saleNet", "invoice", "client", "nf", "state"] as const;
  const missing = required.filter((key) => indexes[key] < 0);
  if (missing.length) throw new Error(`A planilha não possui as colunas obrigatórias: ${missing.join(", ")}.`);
  return rows.slice(1).map((row) => ({
    partNumber: String(row[indexes.partNumber] ?? "").trim(), description: String(row[indexes.description] ?? "").trim(), quantity: quantity(row[indexes.quantity]), costUnitCents: cents(row[indexes.cost]), saleNetUnitCents: cents(row[indexes.saleNet]), invoiceUnitCents: cents(row[indexes.invoice]), clientName: String(row[indexes.client] ?? "").trim(), clientCnpj: indexes.cnpj >= 0 ? normalizeCnpj(row[indexes.cnpj]) : "", invoiceNumber: String(row[indexes.nf] ?? "").trim(), state: stateCode(row[indexes.state]), dealershipName: indexes.dealership >= 0 ? String(row[indexes.dealership] ?? "").trim() : "",
  })).filter((row) => row.partNumber && row.quantity > 0 && row.invoiceNumber);
}
function parseJson<T>(value: string, fallback: T): T { try { return JSON.parse(value) as T; } catch { return fallback; } }
function dateNow() { return new Date().toISOString(); }
function priceForState(item: typeof priceListItems.$inferSelect, state: string) { const statePrices = parseJson<Record<string, { netPriceCents?: number; n3?: number }>>(item.statePricesJson, {}); const selected = statePrices[state] ?? {}; return { net: selected.netPriceCents ?? item.netPriceCents ?? null, n3: selected.n3 ?? null }; }
function isAllowedDealer(profile: AccessProfile, dealer: typeof dealerships.$inferSelect) { return ["general_admin", "global_management"].includes(profile.role) || (profile.role === "factory_manager" ? dealer.factoryManagerEmail.toLowerCase() === profile.email.toLowerCase() : dealer.id === profile.dealershipId); }
function moneyLabel(value: number) { return (value / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function excelColumn(index: number) { let value = ""; let current = index + 1; while (current > 0) { const remainder = (current - 1) % 26; value = String.fromCharCode(65 + remainder) + value; current = Math.floor((current - 1) / 26); } return value; }
function xmlEscape(value: string) { return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;"); }
function exportXlsx(rows: Array<Record<string, unknown>>) {
  const headers = ["PN", "Descrição", "Cliente", "CNPJ", "NF", "Estado", "Concessionário", "Quantidade", "Custo Total", "Valor Líquido Total", "Margem %", "Net Price utilizado", "Base de cálculo", "Reembolso", "Status", "Valor para negociação"];
  const values = rows.map((row) => [row.partNumber, row.description, row.clientName, row.clientCnpj, row.invoiceNumber, row.state, row.dealershipName, row.quantity, moneyLabel(Number(row.costTotalCents) || 0), moneyLabel(Number(row.liquidTotalCents) || 0), `${(Number(row.marginBps) / 100).toFixed(2)}%`, row.netPriceUsedCents === null ? "" : moneyLabel(Number(row.netPriceUsedCents) || 0), moneyLabel(Number(row.calculationBaseCents) || 0), moneyLabel(Number(row.reimbursementCents) || 0), row.status, moneyLabel(Number(row.negotiationCents) || 0)]);
  const sheetRows = [headers, ...values].map((row, rowIndex) => `<row r="${rowIndex + 1}">${row.map((value, columnIndex) => `<c r="${excelColumn(columnIndex)}${rowIndex + 1}" t="inlineStr"><is><t>${xmlEscape(String(value ?? ""))}</t></is></c>`).join("")}</row>`).join("");
  const files = { "[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`, "_rels/.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`, "xl/workbook.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Reembolsos" sheetId="1" r:id="rId1"/></sheets></workbook>`, "xl/_rels/workbook.xml.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`, "xl/worksheets/sheet1.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetRows}</sheetData></worksheet>` };
  const bytes = zipSync(Object.fromEntries(Object.entries(files).map(([name, content]) => [name, new TextEncoder().encode(content)])));
  return new Response(new Blob([bytes.buffer as ArrayBuffer]), { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": "attachment; filename=relatorio-reembolsos.xlsx", "Cache-Control": "no-store" } });
}

async function visibleDealers(db: Awaited<ReturnType<typeof getDb>>, profile: AccessProfile) { const all = await db.select().from(dealerships).orderBy(dealerships.name); return all.filter((dealer) => isAllowedDealer(profile, dealer)); }

function serializeSale(row: typeof reimbursementSales.$inferSelect) { return { ...row, marginPercent: row.marginBps / 100 }; }

export async function GET(request: Request) {
  const profile = await getAccessProfile(); if (!profile) return errorResponse("Acesso não autorizado.", 403);
  try {
    const db = await ensureReimbursementStorage();
    const dealers = await visibleDealers(db, profile); const dealerIds = dealers.map((dealer) => dealer.id);
    const imports = dealerIds.length ? await db.select().from(reimbursementImports).where(isManager(profile) ? or(inArray(reimbursementImports.dealershipId, dealerIds), isNull(reimbursementImports.dealershipId)) : inArray(reimbursementImports.dealershipId, dealerIds)).orderBy(desc(reimbursementImports.createdAt)).limit(40) : [];
    const params = new URL(request.url).searchParams; const requestedImportId = Number(params.get("batchId") ?? 0); const activeImportId = requestedImportId && imports.some((item) => item.id === requestedImportId) ? requestedImportId : imports[0]?.id ?? 0;
    const allSales = dealerIds.length ? await db.select().from(reimbursementSales).where(isManager(profile) ? or(inArray(reimbursementSales.dealershipId, dealerIds), isNull(reimbursementSales.dealershipId)) : inArray(reimbursementSales.dealershipId, dealerIds)).orderBy(desc(reimbursementSales.createdAt), desc(reimbursementSales.id)) : [];
    const pnFilter = normalize(params.get("pn")); const statusFilter = params.get("status")?.trim() ?? "all"; const dealershipFilter = Number(params.get("dealershipId") ?? 0);
    const filtered = allSales.filter((sale) => (!activeImportId || sale.importId === activeImportId) && (!pnFilter || normalize(sale.partNumber).includes(pnFilter) || normalize(sale.description).includes(pnFilter)) && (statusFilter === "all" || sale.status === statusFilter) && (!dealershipFilter || sale.dealershipId === dealershipFilter));
    const base = filtered.reduce((sum, sale) => ({ quantity: sum.quantity + sale.quantity, sales: sum.sales + sale.liquidTotalCents, cost: sum.cost + sale.costTotalCents, n2: sum.n2 + (sale.reimbursementProgram === "N2" ? sale.reimbursementCents : 0), n3: sum.n3 + (sale.reimbursementProgram === "N3" ? sale.reimbursementCents : 0), negotiation: sum.negotiation + sale.negotiationCents }), { quantity: 0, sales: 0, cost: 0, n2: 0, n3: 0, negotiation: 0 });
    const rowsByDealer = new Map<string, { label: string; rows: number; quantity: number; salesCents: number; reimbursementCents: number; marginBps: number }>();
    const rowsByPart = new Map<string, { partNumber: string; description: string; quantity: number; salesCents: number; reimbursementCents: number; marginBps: number; rows: number }>();
    for (const sale of filtered) { const dealer = sale.dealershipName || "Não identificado"; const dealerEntry = rowsByDealer.get(dealer) ?? { label: dealer, rows: 0, quantity: 0, salesCents: 0, reimbursementCents: 0, marginBps: 0 }; dealerEntry.rows += 1; dealerEntry.quantity += sale.quantity; dealerEntry.salesCents += sale.liquidTotalCents; dealerEntry.reimbursementCents += sale.reimbursementCents; dealerEntry.marginBps += sale.marginBps; rowsByDealer.set(dealer, dealerEntry); const partEntry = rowsByPart.get(sale.partNumber) ?? { partNumber: sale.partNumber, description: sale.description, quantity: 0, salesCents: 0, reimbursementCents: 0, marginBps: 0, rows: 0 }; partEntry.rows += 1; partEntry.quantity += sale.quantity; partEntry.salesCents += sale.liquidTotalCents; partEntry.reimbursementCents += sale.reimbursementCents; partEntry.marginBps += sale.marginBps; rowsByPart.set(sale.partNumber, partEntry); }
    const alerts = STATUS_VALUES.map((status) => ({ status, count: filtered.filter((sale) => sale.status === status).length })).filter((item) => item.count > 0).sort((left, right) => right.count - left.count);
    if (params.get("export") === "xlsx") return exportXlsx(filtered.map(serializeSale));
    const approvals = activeImportId ? await db.select().from(reimbursementApprovals).where(eq(reimbursementApprovals.importId, activeImportId)).orderBy(desc(reimbursementApprovals.createdAt)) : [];
    return Response.json({ imports: imports.map((item) => ({ ...item, createdAt: item.createdAt, totalSalesCents: item.totalSalesCents })), sales: filtered.slice(0, 1000).map(serializeSale), summary: { salesCents: base.sales, costCents: base.cost, marginBps: base.sales ? Math.round(((base.sales - base.cost) / base.sales) * 10000) : 0, reimbursementN2Cents: base.n2, reimbursementN3Cents: base.n3, negotiationCents: base.negotiation, processedRows: filtered.length, totalQuantity: base.quantity }, byDealership: [...rowsByDealer.values()].map((item) => ({ ...item, marginBps: item.rows ? Math.round(item.marginBps / item.rows) : 0 })).sort((left, right) => right.salesCents - left.salesCents), byPartNumber: [...rowsByPart.values()].map((item) => ({ ...item, marginBps: item.rows ? Math.round(item.marginBps / item.rows) : 0 })).sort((left, right) => right.reimbursementCents - left.reimbursementCents).slice(0, 30), alerts, approvals, dealerships: dealers.map((dealer) => ({ id: dealer.id, name: dealer.name, state: dealer.state })), activeImportId, canReview: isManager(profile), canManageClients: isClientManager(profile), canSubmit: true, statuses: STATUS_VALUES });
  } catch (error) { return errorResponse(error instanceof Error ? error.message : "Não foi possível carregar os reembolsos.", 500); }
}

export async function POST(request: Request) {
  const profile = await getAccessProfile(); if (!profile) return errorResponse("Acesso não autorizado.", 403);
  let uploadId = ""; let totalChunks = 0;
  try {
    const { env } = await import("cloudflare:workers"); if (!env.BUCKET) return errorResponse("O armazenamento de arquivos ainda não está configurado.", 503);
    const action = new URL(request.url).searchParams.get("upload");
    if (action === "init") { const body = await request.json() as { fileName?: string; fileSize?: number }; const fileName = String(body.fileName ?? "").trim(); const fileSize = Math.trunc(Number(body.fileSize) || 0); if (!/\.(xlsx|csv|tsv)$/i.test(fileName)) return errorResponse("Envie um arquivo .xlsx, .csv ou .tsv."); if (!fileSize || fileSize > MAX_FILE_SIZE) return errorResponse("A planilha deve ter no máximo 120 MB."); return Response.json({ uploadId: crypto.randomUUID(), chunkSize: CHUNK_SIZE, totalChunks: Math.ceil(fileSize / CHUNK_SIZE) }); }
    if (action === "chunk") { const params = new URL(request.url).searchParams; uploadId = params.get("uploadId") ?? ""; const part = Math.trunc(Number(params.get("part") ?? -1)); totalChunks = Math.trunc(Number(params.get("totalChunks") ?? 0)); if (!isValidUploadId(uploadId) || part < 0 || !totalChunks || part >= totalChunks) return errorResponse("Parte de upload inválida."); await env.BUCKET.put(`reimbursements/incoming/${uploadId}/${part}`, await request.arrayBuffer(), { httpMetadata: { contentType: request.headers.get("content-type") || "application/octet-stream" } }); return Response.json({ ok: true, part }); }
    if (action !== "complete") return errorResponse("Ação de upload não reconhecida.");
    const body = await request.json() as { uploadId?: string; fileName?: string; contentType?: string; totalChunks?: number; dealershipId?: number; toleranceCents?: number };
    uploadId = String(body.uploadId ?? ""); totalChunks = Math.trunc(Number(body.totalChunks) || 0); if (!isValidUploadId(uploadId) || !totalChunks) return errorResponse("Upload incompleto.");
    const parts = await Promise.all(Array.from({ length: totalChunks }, async (_, part) => { const object = await env.BUCKET.get(`reimbursements/incoming/${uploadId}/${part}`); if (!object) throw new Error(`A parte ${part + 1} da planilha não foi encontrada.`); return new Uint8Array(await object.arrayBuffer()); }));
    const length = parts.reduce((sum, part) => sum + part.length, 0); const bytes = new Uint8Array(length); let offset = 0; for (const part of parts) { bytes.set(part, offset); offset += part.length; }
    const db = await ensureReimbursementStorage(); const allDealers = await visibleDealers(db, profile); const requestedDealer = Number(body.dealershipId ?? 0); const fallbackDealer = requestedDealer && allDealers.find((dealer) => dealer.id === requestedDealer) ? allDealers.find((dealer) => dealer.id === requestedDealer) : profile.dealershipId ? allDealers.find((dealer) => dealer.id === profile.dealershipId) : null;
    const parsed = parseSales(bytes, String(body.fileName ?? "vendas.xlsx")); if (!parsed.length) return errorResponse("Nenhuma venda válida foi encontrada na planilha.");
    const [activePriceList] = await db.select().from(priceListImports).where(eq(priceListImports.isActive, true)).orderBy(desc(priceListImports.importedAt)).limit(1);
    const priceItems = activePriceList ? await db.select().from(priceListItems).where(eq(priceListItems.importId, activePriceList.id)) : [];
    const priceByPn = new Map(priceItems.map((item) => [normalize(item.partNumber), item])); const clients = await db.select().from(reimbursementClients).where(eq(reimbursementClients.status, "active")); const oldSales = allDealers.length ? await db.select({ invoiceNumber: reimbursementSales.invoiceNumber, dealershipId: reimbursementSales.dealershipId }).from(reimbursementSales).where(inArray(reimbursementSales.dealershipId, allDealers.map((dealer) => dealer.id))) : []; const seen = new Map<string, number>(); for (const row of parsed) { const dealer = fallbackDealer ?? allDealers.find((item) => normalize(item.name) === normalize(row.dealershipName)); const key = `${dealer?.id ?? 0}|${normalize(row.invoiceNumber)}`; seen.set(key, (seen.get(key) ?? 0) + 1); }
    const existing = new Set(oldSales.map((row) => `${row.dealershipId ?? 0}|${normalize(row.invoiceNumber)}`)); const tolerance = Math.max(0, Math.min(1000, Math.trunc(Number(body.toleranceCents ?? 1) || 0))); const now = dateNow(); const rowsToInsert: Array<typeof reimbursementSales.$inferInsert> = []; const summary = { quantity: 0, sales: 0, cost: 0, n2: 0, n3: 0, negotiation: 0 }; let importDealerId = fallbackDealer?.id ?? null; if (!fallbackDealer) { const dealerNames = [...new Set(parsed.map((row) => normalize(row.dealershipName)).filter(Boolean))]; if (dealerNames.length === 1) importDealerId = allDealers.find((dealer) => normalize(dealer.name) === dealerNames[0])?.id ?? null; }
    for (const row of parsed) {
      const dealer = fallbackDealer ?? allDealers.find((item) => normalize(item.name) === normalize(row.dealershipName)); const dealerId = dealer?.id ?? null; if (profile.dealershipId && dealerId !== profile.dealershipId) continue; importDealerId = importDealerId ?? dealerId; const client = clients.find((item) => (row.clientCnpj && normalizeCnpj(item.cnpj) === row.clientCnpj && item.state === row.state) || (normalize(item.legalName) === normalize(row.clientName) && item.state === row.state)); const priceItem = priceByPn.get(normalize(row.partNumber)); const price = priceItem && row.state ? priceForState(priceItem, row.state) : { net: null, n3: null }; const costTotal = row.quantity * row.costUnitCents; const liquidTotal = row.quantity * row.saleNetUnitCents; const marginBps = liquidTotal ? Math.round(((liquidTotal - costTotal) / liquidTotal) * 10000) : costTotal > 0 ? -10000 : 0; const key = `${dealerId ?? 0}|${normalize(row.invoiceNumber)}`; const duplicate = Boolean(row.invoiceNumber && ((seen.get(key) ?? 0) > 1 || existing.has(key))); const program = client?.n3 ? "N3" : client?.n2 ? "N2" : ""; const base = (price.net ?? row.costUnitCents) * row.quantity; const difference = price.n3 === null ? null : row.invoiceUnitCents - price.n3; let status: SaleStatus = "N2 Não Elegível"; let reimbursement = 0; let negotiation = 0;
      if (duplicate) status = "NF Duplicada"; else if (!client || !row.state) status = "Estado sem Cadastro"; else if (program === "N3") { if (price.n3 === null) status = "Net Price não Encontrado"; else if (Math.abs(row.invoiceUnitCents - price.n3) > tolerance) status = "Divergência de Preço"; else { status = marginBps < 0 ? "N3 com Negociação" : "N3 Elegível"; reimbursement = Math.round(base * 0.07); negotiation = marginBps < 0 ? Math.max(0, costTotal - liquidTotal) : 0; } } else if (program === "N2" && marginBps <= 2000) { status = price.net === null ? "Net Price não Encontrado" : "N2 Elegível"; reimbursement = Math.round(base * 0.04); } else if (program === "N3") status = "N3 Não Elegível";
      summary.quantity += row.quantity; summary.sales += liquidTotal; summary.cost += costTotal; if (program === "N2") summary.n2 += reimbursement; if (program === "N3") summary.n3 += reimbursement; summary.negotiation += negotiation;
      rowsToInsert.push({ importId: 0, dealershipId: dealerId, clientId: client?.id ?? null, priceListImportId: activePriceList?.id ?? null, partNumber: row.partNumber, description: row.description, quantity: row.quantity, costAvgUnitCents: row.costUnitCents, saleNetUnitCents: row.saleNetUnitCents, invoiceUnitCents: row.invoiceUnitCents, clientName: row.clientName, clientCnpj: client?.cnpj ?? row.clientCnpj, invoiceNumber: row.invoiceNumber, state: row.state, dealershipName: row.dealershipName || dealer?.name || "", marginBps, costTotalCents: costTotal, liquidTotalCents: liquidTotal, netPriceUsedCents: price.net, calculationBaseCents: base, reimbursementCents: reimbursement, reimbursementProgram: program, status, negotiationCents: negotiation, expectedN3Cents: price.n3, priceDifferenceCents: difference, createdAt: now });
    }
    if (!rowsToInsert.length) return errorResponse("Nenhuma venda pertence ao escopo da concessionária selecionada."); const storageKey = `reimbursements/${now.slice(0, 10)}/${crypto.randomUUID()}-${safeFileName(String(body.fileName ?? "vendas.xlsx"))}`; await env.BUCKET.put(storageKey, bytes, { httpMetadata: { contentType: body.contentType || "application/octet-stream" } }); const [created] = await db.insert(reimbursementImports).values({ fileName: String(body.fileName ?? "vendas.xlsx"), storageKey, contentType: String(body.contentType ?? ""), dealershipId: importDealerId, priceListImportId: activePriceList?.id ?? null, rowCount: rowsToInsert.length, totalQuantity: summary.quantity, totalSalesCents: summary.sales, totalCostCents: summary.cost, totalReimbursementN2Cents: summary.n2, totalReimbursementN3Cents: summary.n3, totalNegotiationCents: summary.negotiation, toleranceCents: tolerance, status: "processed", uploadedByEmail: profile.email, uploadedByName: profile.name, createdAt: now, updatedAt: now }).returning(); if (!created) throw new Error("Não foi possível criar o lote de reembolso."); await db.insert(reimbursementSales).values(rowsToInsert.map((row) => ({ ...row, importId: created.id }))).onConflictDoNothing(); await recordAudit(db, { actorEmail: profile.email, actorName: profile.name, action: "reimbursement_import_processed", entity: "reimbursement_import", details: `Importação ${created.id} processada com ${rowsToInsert.length} vendas.`, after: { importId: created.id, rowCount: rowsToInsert.length, status: created.status, reimbursementN2Cents: summary.n2, reimbursementN3Cents: summary.n3 } }); await Promise.all(Array.from({ length: totalChunks }, (_, part) => env.BUCKET.delete(`reimbursements/incoming/${uploadId}/${part}`))); return Response.json({ ok: true, import: { id: created.id, rowCount: created.rowCount, totalQuantity: created.totalQuantity } });
  } catch (error) { return errorResponse(error instanceof Error ? error.message : "Não foi possível processar a planilha de vendas.", 500); }
}

export async function PATCH(request: Request) {
  const profile = await getAccessProfile(); if (!profile) return errorResponse("Acesso não autorizado.", 403);
  try { const body = await request.json() as { id?: number; action?: string; note?: string }; const id = Math.trunc(Number(body.id) || 0); const action = String(body.action ?? "").trim(); const note = String(body.note ?? "").trim(); if (!id || !action) return errorResponse("Informe lote e ação."); const db = await ensureReimbursementStorage(); const [batch] = await db.select().from(reimbursementImports).where(eq(reimbursementImports.id, id)).limit(1); if (!batch) return errorResponse("Lote de reembolso não encontrado.", 404); const dealers = await visibleDealers(db, profile); if (batch.dealershipId && !dealers.some((dealer) => dealer.id === batch.dealershipId)) return errorResponse("Lote fora do escopo do usuário.", 403); const transitions: Record<string, { from: string[]; to: string; manager: boolean }> = { submit: { from: ["processed", "rejected"], to: "submitted", manager: false }, start_review: { from: ["submitted"], to: "under_review", manager: true }, approve: { from: ["submitted", "under_review"], to: "approved", manager: true }, reject: { from: ["submitted", "under_review"], to: "rejected", manager: true }, mark_paid: { from: ["approved"], to: "paid", manager: true } }; const transition = transitions[action]; if (!transition || !transition.from.includes(batch.status)) return errorResponse("Essa ação não está disponível para o status atual do lote."); if (transition.manager && !isManager(profile)) return errorResponse("Somente Gestão Global, ADM e Gestor Fábrica podem analisar reembolsos.", 403); if (action === "reject" && note.length < 5) return errorResponse("Informe o motivo da rejeição."); const now = dateNow(); await db.update(reimbursementImports).set({ status: transition.to, decisionNote: note || batch.decisionNote, decidedByEmail: profile.email, decidedAt: transition.manager ? now : batch.decidedAt, updatedAt: now }).where(eq(reimbursementImports.id, id)); await db.insert(reimbursementApprovals).values({ importId: id, action, note, actorEmail: profile.email, actorName: profile.name, createdAt: now }); await recordAudit(db, { actorEmail: profile.email, actorName: profile.name, action: `reimbursement_${action}`, entity: "reimbursement_import", details: `Lote ${id}: ${transition.to}.`, before: { status: batch.status }, after: { status: transition.to, note } }); return Response.json({ ok: true, status: transition.to }); } catch (error) { return errorResponse(error instanceof Error ? error.message : "Não foi possível atualizar o workflow do reembolso.", 500); }
}
