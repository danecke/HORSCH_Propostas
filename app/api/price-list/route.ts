import { desc, eq, ne } from "drizzle-orm";
import { unzipSync } from "fflate";
import { getDb } from "../../../db";
import { dealerships, priceListImports, priceListItems } from "../../../db/schema";
import { getAccessProfile, isModuleEnabled, type AccessProfile } from "../../../lib/access";
import { recordAudit } from "../../../lib/audit";

export const dynamic = "force-dynamic";

const MAX_FILE_SIZE = 35 * 1024 * 1024;
const STATES = ["BA", "MA", "PI", "TO", "RS", "SC", "PR", "SP", "MG", "MS", "MT", "DF", "RR", "PA", "GO", "PY", "RO"];
type PriceTier = "final" | "n2" | "n3";

type ParsedPriceRow = {
  partNumber: string;
  description: string;
  family: string;
  unit: string;
  ncm: string;
  vt: string;
  origin: string;
  netPriceCents: number;
  statePrices: Record<string, { netPriceCents?: number; final?: number | null; n2?: number | null; n3?: number | null }>;
};

function errorResponse(message: string, status = 400) {
  return Response.json({ error: message }, { status });
}

function canManage(profile: AccessProfile) {
  return ["general_admin", "global_management"].includes(profile.role);
}

function safeFileName(value: string) {
  const normalized = value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
  const cleaned = normalized.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return (cleaned || "lista-de-precos.xlsx").slice(0, 140);
}

function decode(bytes: Uint8Array) {
  return new TextDecoder().decode(bytes);
}

function xmlUnescape(value: string) {
  return value.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'");
}

function cellText(value: string) {
  return xmlUnescape(value.replace(/<[^>]+>/g, "").trim());
}

function columnIndex(value: string) {
  let result = 0;
  for (const letter of value) result = result * 26 + letter.charCodeAt(0) - 64;
  return result;
}

function cents(value: unknown) {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const number = Number(String(value).replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(number) ? Math.round(number * 100) : null;
}

function stateFromHeader(header: string) {
  const match = header.toUpperCase().trim().match(/(?:^|\s)([A-Z]{2})$/);
  return match && STATES.includes(match[1]) ? match[1] : "";
}

function readSharedStrings(files: Record<string, Uint8Array>) {
  const xml = files["xl/sharedStrings.xml"] ? decode(files["xl/sharedStrings.xml"]) : "";
  return [...xml.matchAll(/<si[\s\S]*?<\/si>/g)].map((match) => [...match[0].matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((part) => xmlUnescape(part[1])).join(""));
}

function parseWorkbook(bytes: Uint8Array) {
  const files = unzipSync(bytes) as Record<string, Uint8Array>;
  const sharedStrings = readSharedStrings(files);
  const xml = decode(files["xl/worksheets/sheet1.xml"]);
  const rawRows = [...xml.matchAll(/<row(?:\s[^>]*)?>([\s\S]*?)<\/row>/g)].map((match) => match[1]);
  const rows = rawRows.map((row) => {
    const values: Record<number, string> = {};
    for (const cell of row.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attributes = cell[1];
      const ref = attributes.match(/\br="([A-Z]+)\d+"/i)?.[1];
      if (!ref) continue;
      const type = attributes.match(/\bt="([^"]+)"/)?.[1] ?? "";
      const body = cell[2] ?? "";
      const raw = type === "inlineStr" ? [...body.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((match) => xmlUnescape(match[1])).join("") : cellText(body.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? "");
      values[columnIndex(ref)] = type === "s" && raw ? sharedStrings[Number(raw)] ?? "" : raw;
    }
    return values;
  });
  if (!rows.length) throw new Error("A planilha não possui linhas válidas.");
  const header = rows[0];
  const headers = Object.entries(header).map(([index, value]) => [Number(index), value.trim()] as const);
  const indexOf = (pattern: RegExp) => headers.find((entry) => pattern.test(entry[1].toLocaleLowerCase("pt-BR")))?.[0] ?? 0;
  const pnIndex = indexOf(/^pn$/);
  const descriptionIndex = indexOf(/descri/);
  const familyIndex = indexOf(/famil/);
  const unitIndex = indexOf(/unidade/);
  const ncmIndex = indexOf(/^ncm$/);
  const vtIndex = indexOf(/^vt$/);
  const originIndex = indexOf(/origem/);
  const netIndex = headers.find((entry) => entry[1].toLocaleLowerCase("pt-BR").startsWith("netprice 26"))?.[0] ?? 0;
  if (!pnIndex || !descriptionIndex || !netIndex) throw new Error("A planilha deve conter as colunas PN, Descrição e Netprice 26.");

  const stateColumns = headers.flatMap(([index, value]) => {
    const state = stateFromHeader(value);
    if (!state || index < 8) return [];
    const normalized = value.toLocaleLowerCase("pt-BR");
    const tier: "netPriceCents" | PriceTier = normalized.startsWith("netprice") ? "netPriceCents" : normalized.includes("n2") ? "n2" : normalized.includes("n3") ? "n3" : "final";
    return [{ index, state, tier }];
  });
  const states = [...new Set(stateColumns.map((column) => column.state))].filter((state) => STATES.includes(state));
  const parsed: ParsedPriceRow[] = [];
  for (const row of rows.slice(1)) {
    const partNumber = String(row[pnIndex] ?? "").trim();
    if (!partNumber) continue;
    const statePrices: ParsedPriceRow["statePrices"] = {};
    for (const column of stateColumns) {
      const current = statePrices[column.state] ?? {};
      const value = cents(row[column.index]);
      if (column.tier === "netPriceCents") current.netPriceCents = value ?? undefined;
      else current[column.tier] = value;
      statePrices[column.state] = current;
    }
    parsed.push({
      partNumber,
      description: String(row[descriptionIndex] ?? "").trim(),
      family: String(row[familyIndex] ?? "").trim(),
      unit: String(row[unitIndex] ?? "").trim(),
      ncm: String(row[ncmIndex] ?? "").trim(),
      vt: String(row[vtIndex] ?? "").trim(),
      origin: String(row[originIndex] ?? "").trim(),
      netPriceCents: cents(row[netIndex]) ?? 0,
      statePrices,
    });
  }
  if (!parsed.length) throw new Error("Nenhum item foi encontrado na planilha.");
  return { rows: parsed, states };
}

async function visibleStates(db: Awaited<ReturnType<typeof getDb>>, profile: AccessProfile, available: string[]) {
  if (["general_admin", "global_management"].includes(profile.role)) return available;
  if (profile.role === "factory_manager") {
    const dealers = await db.select({ state: dealerships.state }).from(dealerships).where(eq(dealerships.factoryManagerEmail, profile.email));
    return [...new Set(dealers.map((dealer) => dealer.state.toUpperCase()).filter((state) => available.includes(state)))];
  }
  if (!profile.dealershipId) return [];
  const [dealer] = await db.select({ state: dealerships.state }).from(dealerships).where(eq(dealerships.id, profile.dealershipId)).limit(1);
  return dealer && available.includes(dealer.state.toUpperCase()) ? [dealer.state.toUpperCase()] : [];
}

async function activeImport(db: Awaited<ReturnType<typeof getDb>>) {
  const [record] = await db.select().from(priceListImports).where(eq(priceListImports.isActive, true)).orderBy(desc(priceListImports.importedAt)).limit(1);
  return record ?? null;
}

function importSummary(record: typeof priceListImports.$inferSelect | null) {
  if (!record) return null;
  let states: string[] = [];
  try { states = JSON.parse(record.statesJson) as string[]; } catch { states = []; }
  return { fileName: record.fileName, rowCount: record.rowCount, states, importedByName: record.importedByName, importedAt: record.importedAt };
}

function projectItem(item: typeof priceListItems.$inferSelect, state: string) {
  let prices: ParsedPriceRow["statePrices"] = {};
  try { prices = JSON.parse(item.statePricesJson) as ParsedPriceRow["statePrices"]; } catch { prices = {}; }
  const selected = prices[state] ?? {};
  return {
    id: item.id,
    partNumber: item.partNumber,
    description: item.description,
    family: item.family,
    unit: item.unit,
    ncm: item.ncm,
    vt: item.vt,
    origin: item.origin,
    netPriceCents: selected.netPriceCents ?? item.netPriceCents,
    finalPriceCents: selected.final ?? null,
    n2PriceCents: selected.n2 ?? null,
    n3PriceCents: selected.n3 ?? null,
    state,
  };
}

export async function GET(request: Request) {
  const profile = await getAccessProfile();
  if (!profile) return errorResponse("Acesso não autorizado.", 403);
  try {
    const db = await getDb();
    const record = await activeImport(db);
    if (!record) return Response.json({ import: null, rows: [], total: 0, states: [], selectedState: "", canManage: canManage(profile) });
    const available = JSON.parse(record.statesJson) as string[];
    const states = await visibleStates(db, profile, available);
    if (profile.dealershipId && !(await isModuleEnabled(db, profile.dealershipId, "price_list")) && !canManage(profile)) return errorResponse("O módulo Lista de preços não está habilitado para esta concessionária.", 403);
    const requestedState = new URL(request.url).searchParams.get("state")?.trim().toUpperCase() ?? "";
    const selectedState = states.includes(requestedState) ? requestedState : states[0] ?? "";
    const search = new URL(request.url).searchParams.get("q")?.trim().toLocaleLowerCase("pt-BR") ?? "";
    const page = Math.max(1, Math.trunc(Number(new URL(request.url).searchParams.get("page") ?? 1) || 1));
    const pageSize = Math.min(100, Math.max(10, Math.trunc(Number(new URL(request.url).searchParams.get("pageSize") ?? 50) || 50)));
    const items = await db.select().from(priceListItems).where(eq(priceListItems.importId, record.id));
    const filtered = items.filter((item) => !search || [item.partNumber, item.description, item.family, item.vt].some((value) => value.toLocaleLowerCase("pt-BR").includes(search)));
    const start = (page - 1) * pageSize;
    return Response.json({ import: importSummary(record), rows: selectedState ? filtered.slice(start, start + pageSize).map((item) => projectItem(item, selectedState)) : [], total: filtered.length, page, pageSize, states, selectedState, canManage: canManage(profile) });
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : "Não foi possível carregar a lista de preços.", 500);
  }
}

export async function POST(request: Request) {
  const profile = await getAccessProfile();
  if (!profile) return errorResponse("Acesso não autorizado.", 403);
  if (!canManage(profile)) return errorResponse("Somente Gestão Global e ADM Geral podem importar a lista de preços.", 403);
  let storageKey = "";
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return errorResponse("Selecione o arquivo XLSX da lista de preços.");
    if (!file.size || file.size > MAX_FILE_SIZE) return errorResponse("O arquivo deve ter no máximo 35 MB.");
    if (!file.name.toLowerCase().endsWith(".xlsx")) return errorResponse("Envie uma planilha Excel no formato .xlsx.");
    const bytes = new Uint8Array(await file.arrayBuffer());
    const parsed = parseWorkbook(bytes);
    const db = await getDb();
    const { env } = await import("cloudflare:workers");
    if (!env.BUCKET) return errorResponse("O armazenamento da lista de preços ainda não está configurado.", 503);
    storageKey = `price-list/${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}-${safeFileName(file.name)}`;
    await env.BUCKET.put(storageKey, bytes, { httpMetadata: { contentType: file.type || "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }, customMetadata: { importedBy: profile.email, rowCount: String(parsed.rows.length) } });
    const now = new Date().toISOString();
    const [created] = await db.insert(priceListImports).values({ fileName: file.name.slice(0, 180), storageKey, contentType: file.type || "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", rowCount: parsed.rows.length, statesJson: JSON.stringify(parsed.states), importedByEmail: profile.email, importedByName: profile.name, isActive: false, importedAt: now }).returning({ id: priceListImports.id });
    if (!created) throw new Error("Não foi possível registrar a importação.");
    for (let index = 0; index < parsed.rows.length; index += 60) {
      const chunk = parsed.rows.slice(index, index + 60);
      await db.insert(priceListItems).values(chunk.map((item) => ({ importId: created.id, partNumber: item.partNumber, description: item.description, family: item.family, unit: item.unit, ncm: item.ncm, vt: item.vt, origin: item.origin, netPriceCents: item.netPriceCents, statePricesJson: JSON.stringify(item.statePrices), importedAt: now, updatedAt: now })));
    }
    await db.update(priceListImports).set({ isActive: false }).where(eq(priceListImports.isActive, true));
    await db.update(priceListImports).set({ isActive: true }).where(eq(priceListImports.id, created.id));
    await db.delete(priceListItems).where(ne(priceListItems.importId, created.id));
    await recordAudit(db, { actorEmail: profile.email, actorName: profile.name, action: "price_list_imported", entity: "price_list", details: `Lista de preços importada: ${file.name} (${parsed.rows.length} itens).`, after: { fileName: file.name, rowCount: parsed.rows.length, states: parsed.states } });
    return Response.json({ ok: true, import: { fileName: file.name, rowCount: parsed.rows.length, states: parsed.states, importedAt: now } }, { status: 201 });
  } catch (error) {
    if (storageKey) {
      try { const { env } = await import("cloudflare:workers"); await env.BUCKET?.delete(storageKey); } catch { /* keep the original error */ }
    }
    return errorResponse(error instanceof Error ? error.message : "Não foi possível importar a lista de preços.", 500);
  }
}

export async function PATCH(request: Request) {
  const profile = await getAccessProfile();
  if (!profile) return errorResponse("Acesso não autorizado.", 403);
  if (!canManage(profile)) return errorResponse("Somente Gestão Global e ADM Geral podem alterar a lista de preços.", 403);
  try {
    const payload = (await request.json()) as { id?: number; state?: string; netPriceCents?: number | null; finalPriceCents?: number | null; n2PriceCents?: number | null; n3PriceCents?: number | null };
    const id = Math.trunc(Number(payload.id) || 0);
    const state = String(payload.state ?? "").trim().toUpperCase();
    if (!id || !STATES.includes(state)) return errorResponse("Informe item e UF válidos.");
    const db = await getDb();
    const record = await activeImport(db);
    if (!record) return errorResponse("Importe uma lista de preços antes de editar.", 409);
    const [item] = await db.select().from(priceListItems).where(eq(priceListItems.id, id)).limit(1);
    if (!item || item.importId !== record.id) return errorResponse("Item não encontrado na lista vigente.", 404);
    let statePrices: ParsedPriceRow["statePrices"] = {};
    try { statePrices = JSON.parse(item.statePricesJson) as ParsedPriceRow["statePrices"]; } catch { statePrices = {}; }
    const current = statePrices[state] ?? {};
    const next = { ...current, final: payload.finalPriceCents ?? null, n2: payload.n2PriceCents ?? null, n3: payload.n3PriceCents ?? null, netPriceCents: payload.netPriceCents ?? current.netPriceCents };
    statePrices[state] = next;
    const nextNet = payload.netPriceCents === undefined || payload.netPriceCents === null ? item.netPriceCents : Math.max(0, Math.trunc(Number(payload.netPriceCents) || 0));
    await db.update(priceListItems).set({ netPriceCents: nextNet, statePricesJson: JSON.stringify(statePrices), updatedAt: new Date().toISOString() }).where(eq(priceListItems.id, id));
    await recordAudit(db, { actorEmail: profile.email, actorName: profile.name, action: "price_list_item_updated", entity: "price_list", details: `Item ${item.partNumber} ajustado para ${state}.`, before: { partNumber: item.partNumber, state, statePrices: current }, after: { partNumber: item.partNumber, state, statePrices: next } });
    return Response.json({ ok: true });
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : "Não foi possível alterar o item.", 500);
  }
}
