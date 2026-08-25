import { desc, eq, inArray, isNull, or } from "drizzle-orm";
import { unzipSync, zipSync } from "fflate";
import { getDb } from "../../../db";
import {
  dealerships,
  priceListImports,
  priceListItems,
  reimbursementApprovals,
  reimbursementClients,
  reimbursementImports,
  reimbursementSettings,
  reimbursementSales,
} from "../../../db/schema";
import {
  getAccessProfile,
  profileHasDealership,
  type AccessProfile,
} from "../../../lib/access";
import { recordAudit } from "../../../lib/audit";
import { ensureReimbursementStorage } from "../../../lib/reimbursement-db";

export const dynamic = "force-dynamic";

const MAX_FILE_SIZE = 120 * 1024 * 1024;
const CHUNK_SIZE = 1 * 1024 * 1024;
const DEFAULT_N3_TOLERANCE_BPS = 500;
const STATES = [
  "AC",
  "AL",
  "AP",
  "AM",
  "BA",
  "CE",
  "DF",
  "ES",
  "GO",
  "MA",
  "MT",
  "MS",
  "MG",
  "PA",
  "PB",
  "PR",
  "PE",
  "PI",
  "RJ",
  "RN",
  "RS",
  "RO",
  "RR",
  "SC",
  "SP",
  "SE",
  "TO",
  "PY",
];
const STATUS_VALUES = [
  "N2 Elegível",
  "N3 Elegível",
  "N3 com Negociação",
  "Não Elegível",
  "Divergência de Preço",
  "NF Duplicada",
  "Produto/Estado/Cliente sem Cadastro",
  "Pendente Justificativa",
  "Aprovação Manual - Base de Cálculo",
  "Devolvida para correção",
  "Rejeitada",
] as const;
type SaleStatus = (typeof STATUS_VALUES)[number];
type ReimbursementSegment = "N2" | "N3" | "normal";
type ParsedSale = {
  sourceRow: number;
  partNumber: string;
  description: string;
  quantity: number;
  costUnitCents: number;
  saleNetUnitCents: number;
  invoiceUnitCents: number;
  clientName: string;
  clientCnpj: string;
  invoiceNumber: string;
  state: string;
  dealershipName: string;
  dealershipCnpj: string;
};

function errorResponse(message: string, status = 400) {
  return Response.json({ error: message }, { status });
}
function isManager(profile: AccessProfile) {
  return ["general_admin", "global_management", "factory_manager"].includes(
    profile.role,
  );
}
function isClientManager(profile: AccessProfile) {
  return ["general_admin", "global_management"].includes(profile.role);
}
async function getN3ToleranceBps(db: Awaited<ReturnType<typeof getDb>>) {
  const [setting] = await db
    .select()
    .from(reimbursementSettings)
    .where(eq(reimbursementSettings.settingKey, "n3_tolerance_bps"))
    .limit(1);
  if (setting) return Math.max(0, Math.min(10000, setting.numericValue));
  await db.insert(reimbursementSettings).values({
    settingKey: "n3_tolerance_bps",
    numericValue: DEFAULT_N3_TOLERANCE_BPS,
    updatedByEmail: "system",
    updatedAt: dateNow(),
  }).onConflictDoNothing();
  return DEFAULT_N3_TOLERANCE_BPS;
}
function isDealerScoped(profile: AccessProfile) {
  return ["dealer_manager", "concession"].includes(profile.role);
}
function reimbursementSegment(program: string): ReimbursementSegment {
  return program === "N2" ? "N2" : program === "N3" ? "N3" : "normal";
}
function calculatedMarginBps(salesCents: number, costCents: number) {
  return salesCents
    ? Math.round(((salesCents - costCents) / salesCents) * 10000)
    : 0;
}
function isValidUploadId(value: unknown) {
  return typeof value === "string" && /^[a-f0-9-]{36}$/i.test(value);
}
function normalize(value: unknown) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("pt-BR");
}
function normalizePartNumber(value: unknown) {
  const normalized = normalize(value).replace(/\s+/g, "");
  if (!normalized) return "";
  return /^\d+$/.test(normalized)
    ? normalized.replace(/^0+(?=\d)/, "")
    : normalized;
}
function normalizeDocument(value: unknown) {
  return String(value ?? "").replace(/\D/g, "");
}
function isValidDocument(value: string) {
  return value.length === 11 || value.length === 14;
}
function safeFileName(value: string) {
  return (
    value
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "vendas-reembolso.xlsx"
  ).slice(0, 140);
}
function cents(value: unknown) {
  if (value === null || value === undefined || String(value).trim() === "")
    return 0;
  const raw = String(value).trim().replace(/R\$/gi, "").replace(/\s/g, "");
  const normalizedValue = raw.includes(",")
    ? raw.replace(/\./g, "").replace(",", ".")
    : raw.replace(/[^\d.-]/g, "");
  const number = Number(normalizedValue);
  return Number.isFinite(number) ? Math.round(number * 100) : 0;
}
function quantity(value: unknown) {
  const number = Number(
    String(value ?? "")
      .replace(",", ".")
      .replace(/[^\d.-]/g, ""),
  );
  return Number.isFinite(number) ? Math.max(0, Math.round(number)) : 0;
}
function decode(bytes: Uint8Array) {
  return new TextDecoder().decode(bytes);
}
function xmlUnescape(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}
function columnIndex(value: string) {
  let result = 0;
  for (const letter of value) result = result * 26 + letter.charCodeAt(0) - 64;
  return result;
}
function cellText(value: string) {
  return xmlUnescape(value.replace(/<[^>]+>/g, "").trim());
}
function sharedStrings(files: Record<string, Uint8Array>) {
  const xml = decode(files["xl/sharedStrings.xml"] ?? new Uint8Array());
  return [...xml.matchAll(/<si[\s\S]*?<\/si>/g)].map((match) =>
    [...match[0].matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)]
      .map((part) => xmlUnescape(part[1]))
      .join(""),
  );
}
function worksheetPath(files: Record<string, Uint8Array>) {
  const workbook = decode(files["xl/workbook.xml"] ?? new Uint8Array());
  const relationships = decode(
    files["xl/_rels/workbook.xml.rels"] ?? new Uint8Array(),
  );
  const firstSheet = workbook.match(/<sheet\b[^>]*r:id="([^"]+)"[^>]*>/i)?.[1];
  const relationship = firstSheet
    ? [
        ...relationships.matchAll(
          /<Relationship\b([^>]*?)\/?>(?:<\/Relationship>)?/gi,
        ),
      ]
        .map((match) => match[1])
        .find(
          (attributes) =>
            attributes.match(/\bId="([^"]+)"/i)?.[1] === firstSheet,
        )
    : "";
  const target = relationship?.match(/\bTarget="([^"]+)"/i)?.[1];
  if (target) {
    const path = target.replace(/^\/+/, "").replace(/^\.\//, "");
    const candidate = path.startsWith("xl/") ? path : `xl/${path}`;
    if (files[candidate]) return candidate;
  }
  return files["xl/worksheets/sheet1.xml"] ? "xl/worksheets/sheet1.xml" : "";
}
function parseXlsx(bytes: Uint8Array): string[][] {
  const files = unzipSync(bytes) as Record<string, Uint8Array>;
  const path = worksheetPath(files);
  if (!path)
    throw new Error("Não foi possível localizar a primeira aba do Excel.");
  const strings = sharedStrings(files);
  return [
    ...decode(files[path]).matchAll(/<row(?:\s[^>]*)?>([\s\S]*?)<\/row>/g),
  ].map((row) => {
    const values: Record<number, string> = {};
    for (const cell of row[1].matchAll(
      /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g,
    )) {
      const ref = cell[1].match(/\br="([A-Z]+)\d+"/i)?.[1];
      if (!ref) continue;
      const type = cell[1].match(/\bt="([^"]+)"/)?.[1] ?? "";
      const body = cell[2] ?? "";
      const raw =
        type === "inlineStr"
          ? [...body.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)]
              .map((match) => xmlUnescape(match[1]))
              .join("")
          : cellText(body.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? "");
      values[columnIndex(ref)] =
        type === "s" && raw ? (strings[Number(raw)] ?? "") : raw;
    }
    const max = Math.max(-1, ...Object.keys(values).map(Number));
    return Array.from({ length: max + 1 }, (_, index) => values[index] ?? "");
  });
}
function parseDelimited(bytes: Uint8Array): string[][] {
  const text = decode(bytes).replace(/^\uFEFF/, "");
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const delimiter = firstLine.includes("\t")
    ? "\t"
    : firstLine.split(";").length > firstLine.split(",").length
      ? ";"
      : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    const next = text[index + 1];
    if (character === '"' && quoted && next === '"') {
      value += '"';
      index += 1;
    } else if (character === '"') quoted = !quoted;
    else if (character === delimiter && !quoted) {
      row.push(value);
      value = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && next === "\n") index += 1;
      row.push(value);
      value = "";
      if (row.some((cell) => cell.trim())) rows.push(row);
      row = [];
    } else value += character;
  }
  row.push(value);
  if (row.some((cell) => cell.trim())) rows.push(row);
  return rows;
}
function headerIndex(headers: string[], patterns: RegExp[]) {
  return headers.findIndex((header) =>
    patterns.some((pattern) => pattern.test(normalize(header))),
  );
}
function stateCode(value: unknown) {
  const cleaned = normalize(value).toUpperCase();
  const names: Record<string, string> = {
    RONDONIA: "RO",
    ACRE: "AC",
    AMAZONAS: "AM",
    RORAIMA: "RR",
    PARA: "PA",
    AMAPA: "AP",
    TOCANTINS: "TO",
    MARANHAO: "MA",
    PIAUI: "PI",
    CEARA: "CE",
    RIOGRANDEDONORTE: "RN",
    PARAIBA: "PB",
    PERNAMBUCO: "PE",
    ALAGOAS: "AL",
    SERGIPE: "SE",
    BAHIA: "BA",
    MINASGERAIS: "MG",
    ESPIRITOSANTO: "ES",
    RIODEJANEIRO: "RJ",
    SAOPAULO: "SP",
    PARANA: "PR",
    SANTACATARINA: "SC",
    RIOGRANDEDOSUL: "RS",
    MATOGROSSODOSUL: "MS",
    MATOGROSSO: "MT",
    GOIAS: "GO",
    DISTRITOFEDERAL: "DF",
    PARAGUAI: "PY",
  };
  return cleaned.length === 2 && STATES.includes(cleaned)
    ? cleaned
    : (names[cleaned.replace(/\s/g, "")] ?? "");
}
function dealershipHandlesState(
  dealer: typeof dealerships.$inferSelect,
  state: string,
) {
  const registeredStates = String(dealer.state ?? "")
    .split(/[\s,;/|+-]+/)
    .map(stateCode)
    .filter(Boolean);
  return registeredStates.includes(state);
}
function parseSales(bytes: Uint8Array, fileName: string): ParsedSale[] {
  const rows = fileName.toLowerCase().endsWith(".xlsx")
    ? parseXlsx(bytes)
    : parseDelimited(bytes);
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
    document: headerIndex(headers, [
      /^cpf$/,
      /^cnpj$/,
      /cpf.*cnpj/,
      /cnpj.*cpf/,
      /documento/,
    ]),
    nf: headerIndex(headers, [/^nf$/, /nota.*fiscal/, /invoice/]),
    state: headerIndex(headers, [/estado/, /^uf$/]),
    dealership: headerIndex(headers, [/concession/, /dealer/]),
    dealershipCnpj: headerIndex(headers, [
      /cnpj.*concession/,
      /concession.*cnpj/,
      /cnpj.*dealer/,
    ]),
  };
  const labels: Record<keyof typeof indexes, string> = {
    partNumber: "PN",
    description: "Descrição",
    quantity: "Quantidade",
    cost: "Custo Médio Líquido Unitário",
    saleNet: "Valor Venda Líquido Unitário",
    invoice: "Valor Venda NF Unitário",
    client: "Cliente",
    document: "CPF/CNPJ",
    nf: "NF",
    state: "Estado",
    dealership: "Concessionário",
    dealershipCnpj: "CNPJ do Concessionário",
  };
  const required = [
    "partNumber",
    "description",
    "quantity",
    "cost",
    "saleNet",
    "invoice",
    "client",
    "document",
    "nf",
    "state",
  ] as const;
  const missing = required.filter((key) => indexes[key] < 0);
  if (missing.length)
    throw new Error(
      `A planilha não possui as colunas obrigatórias: ${missing.map((key) => labels[key]).join(", ")}. Baixe o modelo Excel para usar os cabeçalhos corretos.`,
    );

  const parsed = rows
    .slice(1)
    .map((row, index) => ({
      sourceRow: index + 2,
      partNumber: String(row[indexes.partNumber] ?? "").trim(),
      description: String(row[indexes.description] ?? "").trim(),
      quantity: quantity(row[indexes.quantity]),
      costUnitCents: cents(row[indexes.cost]),
      saleNetUnitCents: cents(row[indexes.saleNet]),
      invoiceUnitCents: cents(row[indexes.invoice]),
      clientName: String(row[indexes.client] ?? "").trim(),
      clientCnpj: normalizeDocument(row[indexes.document]),
      invoiceNumber: String(row[indexes.nf] ?? "").trim(),
      state: stateCode(row[indexes.state]),
      dealershipName:
        indexes.dealership >= 0
          ? String(row[indexes.dealership] ?? "").trim()
          : "",
      dealershipCnpj:
        indexes.dealershipCnpj >= 0
          ? normalizeDocument(row[indexes.dealershipCnpj])
          : "",
    }))
    .filter((row) =>
      [
        row.partNumber,
        row.description,
        row.quantity,
        row.costUnitCents,
        row.saleNetUnitCents,
        row.invoiceUnitCents,
        row.clientName,
        row.clientCnpj,
        row.invoiceNumber,
        row.state,
        row.dealershipName,
      ].some((value) => String(value ?? "").trim()),
    );

  if (!parsed.length)
    throw new Error("A planilha não possui linhas de venda preenchidas.");
  const errors: string[] = [];
  for (const row of parsed) {
    const issues: string[] = [];
    if (!row.partNumber) issues.push("PN");
    if (!row.description) issues.push("descrição");
    if (!row.quantity) issues.push("quantidade");
    if (!row.costUnitCents) issues.push("custo médio líquido unitário");
    if (!row.saleNetUnitCents) issues.push("valor venda líquido unitário");
    if (!row.invoiceUnitCents) issues.push("valor venda NF unitário");
    if (!row.clientName) issues.push("cliente");
    if (!isValidDocument(row.clientCnpj))
      issues.push("CPF/CNPJ com 11 ou 14 dígitos");
    if (!row.invoiceNumber) issues.push("NF");
    if (!row.state) issues.push("UF válida");
    if (issues.length)
      errors.push(`linha ${row.sourceRow}: ${issues.join(", ")}`);
  }
  if (errors.length)
    throw new Error(
      `Corrija os dados obrigatórios antes de importar: ${errors.slice(0, 8).join("; ")}${errors.length > 8 ? `; e mais ${errors.length - 8} linha(s)` : ""}.`,
    );
  return parsed;
}
function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}
function dateNow() {
  return new Date().toISOString();
}
function priceForState(
  item: typeof priceListItems.$inferSelect,
  state: string,
) {
  const statePrices = parseJson<
    Record<string, { netPriceCents?: number; n3?: number }>
  >(item.statePricesJson, {});
  const stateKey =
    Object.keys(statePrices).find((key) => stateCode(key) === state) ?? state;
  const selected = statePrices[stateKey] ?? {};
  const net = selected.netPriceCents ?? item.netPriceCents ?? null;
  const n3 = selected.n3 ?? null;
  return {
    net: typeof net === "number" && net > 0 ? net : null,
    n3: typeof n3 === "number" && n3 > 0 ? n3 : null,
  };
}
function isAllowedDealer(
  profile: AccessProfile,
  dealer: typeof dealerships.$inferSelect,
) {
  if (["general_admin", "global_management"].includes(profile.role))
    return true;
  if (profile.role === "factory_manager")
    return (
      profileHasDealership(profile, dealer.id) ||
      dealer.factoryManagerEmail.toLowerCase() === profile.email.toLowerCase()
    );
  return (
    isDealerScoped(profile) &&
    (profileHasDealership(profile, dealer.id) ||
      profile.dealershipIds.includes(dealer.parentDealershipId ?? -1))
  );
}
function moneyLabel(value: number) {
  return (value / 100).toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
function excelColumn(index: number) {
  let value = "";
  let current = index + 1;
  while (current > 0) {
    const remainder = (current - 1) % 26;
    value = String.fromCharCode(65 + remainder) + value;
    current = Math.floor((current - 1) / 26);
  }
  return value;
}
function xmlEscape(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
function exportXlsx(rows: Array<Record<string, unknown>>) {
  const headers = [
    "PN",
    "Descrição",
    "Cliente",
    "CPF/CNPJ",
    "NF",
    "Estado",
    "Concessionário",
    "Quantidade",
    "Custo Total",
    "Valor Líquido Total",
    "Margem %",
    "Net Price utilizado",
    "Base de cálculo",
    "Reembolso",
    "Status",
    "Valor para negociação",
  ];
  const values = rows.map((row) => [
    row.partNumber,
    row.description,
    row.clientName,
    row.clientCnpj,
    row.invoiceNumber,
    row.state,
    row.dealershipName,
    row.quantity,
    moneyLabel(Number(row.costTotalCents) || 0),
    moneyLabel(Number(row.liquidTotalCents) || 0),
    `${(Number(row.marginBps) / 100).toFixed(2)}%`,
    row.netPriceUsedCents === null
      ? ""
      : moneyLabel(Number(row.netPriceUsedCents) || 0),
    moneyLabel(Number(row.calculationBaseCents) || 0),
    moneyLabel(Number(row.reimbursementCents) || 0),
    row.status,
    moneyLabel(Number(row.negotiationCents) || 0),
  ]);
  const sheetRows = [headers, ...values]
    .map(
      (row, rowIndex) =>
        `<row r="${rowIndex + 1}">${row.map((value, columnIndex) => `<c r="${excelColumn(columnIndex)}${rowIndex + 1}" t="inlineStr"><is><t>${xmlEscape(String(value ?? ""))}</t></is></c>`).join("")}</row>`,
    )
    .join("");
  const files = {
    "[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`,
    "_rels/.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    "xl/workbook.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Reembolsos" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
    "xl/worksheets/sheet1.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetRows}</sheetData></worksheet>`,
  };
  const bytes = zipSync(
    Object.fromEntries(
      Object.entries(files).map(([name, content]) => [
        name,
        new TextEncoder().encode(content),
      ]),
    ),
  );
  return new Response(new Blob([bytes.buffer as ArrayBuffer]), {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": "attachment; filename=relatorio-reembolsos.xlsx",
      "Cache-Control": "no-store",
    },
  });
}

async function visibleDealers(
  db: Awaited<ReturnType<typeof getDb>>,
  profile: AccessProfile,
) {
  const all = await db.select().from(dealerships).orderBy(dealerships.name);
  return all.filter((dealer) => isAllowedDealer(profile, dealer));
}

function lineIndicators(row: typeof reimbursementSales.$inferSelect) {
  const negativeMargin = row.marginBps < 0;
  const needsNetReference =
    row.netPriceUsedCents === null && row.baseStatus === "MANUAL_REQUIRED";
  if (row.status === "Rejeitada") {
    return {
      needsAnalysis: false,
      negativeMargin,
      needsNetReference: false,
      analysisReason: "Linha rejeitada e documentada",
    };
  }
  const reasons: string[] = [];
  if (negativeMargin) reasons.push("Margem negativa");
  if (needsNetReference) reasons.push("Definir NET de referência");
  if (row.status === "Divergência de Preço") reasons.push("Conferir preço N3");
  if (row.status === "Pendente Justificativa") reasons.push("Justificar variação");
  if (row.status === "Devolvida para correção") reasons.push("Corrigir linha");
  if (row.reasonCode === "NF_DUPLICADA") reasons.push("NF duplicada");
  if (row.reasonCode === "CADASTRO_AUSENTE") reasons.push("Cadastro incompleto");
  const needsAnalysis = reasons.length > 0;
  return {
    needsAnalysis,
    negativeMargin,
    needsNetReference,
    analysisReason: reasons.join(" · "),
  };
}

function serializeSale(row: typeof reimbursementSales.$inferSelect) {
  return { ...row, marginPercent: row.marginBps / 100, ...lineIndicators(row) };
}

async function refreshImportTotals(
  db: Awaited<ReturnType<typeof getDb>>,
  importId: number,
) {
  const lines = await db
    .select()
    .from(reimbursementSales)
    .where(eq(reimbursementSales.importId, importId));
  const activeLines = lines.filter((line) => line.status !== "Rejeitada");
  await db
    .update(reimbursementImports)
    .set({
      rowCount: lines.length,
      totalQuantity: activeLines.reduce((sum, line) => sum + line.quantity, 0),
      totalSalesCents: activeLines.reduce(
        (sum, line) => sum + line.liquidTotalCents,
        0,
      ),
      totalCostCents: activeLines.reduce(
        (sum, line) => sum + line.costTotalCents,
        0,
      ),
      totalReimbursementN2Cents: activeLines.reduce(
        (sum, line) =>
          sum +
          (line.reimbursementProgram === "N2" ? line.reimbursementCents : 0),
        0,
      ),
      totalReimbursementN3Cents: activeLines.reduce(
        (sum, line) =>
          sum +
          (line.reimbursementProgram === "N3" ? line.reimbursementCents : 0),
        0,
      ),
      totalNegotiationCents: activeLines.reduce(
        (sum, line) => sum + line.negotiationCents,
        0,
      ),
      updatedAt: dateNow(),
    })
    .where(eq(reimbursementImports.id, importId));
}

export async function GET(request: Request) {
  const profile = await getAccessProfile();
  if (!profile) return errorResponse("Acesso não autorizado.", 403);
  try {
    const db = await ensureReimbursementStorage();
    const n3ToleranceBps = await getN3ToleranceBps(db);
    const dealers = await visibleDealers(db, profile);
    const dealerIds = dealers.map((dealer) => dealer.id);
    const imports = dealerIds.length
      ? await db
          .select()
          .from(reimbursementImports)
          .where(
            isManager(profile)
              ? or(
                  inArray(reimbursementImports.dealershipId, dealerIds),
                  isNull(reimbursementImports.dealershipId),
                )
              : inArray(reimbursementImports.dealershipId, dealerIds),
          )
          .orderBy(desc(reimbursementImports.createdAt))
          .limit(40)
      : [];
    const params = new URL(request.url).searchParams;
    const requestedImportId = Number(params.get("batchId") ?? 0);
    const activeImportId =
      requestedImportId && imports.some((item) => item.id === requestedImportId)
        ? requestedImportId
        : (imports[0]?.id ?? 0);
    const allSales = dealerIds.length
      ? await db
          .select()
          .from(reimbursementSales)
          .where(
            isManager(profile)
              ? or(
                  inArray(reimbursementSales.dealershipId, dealerIds),
                  isNull(reimbursementSales.dealershipId),
                )
              : inArray(reimbursementSales.dealershipId, dealerIds),
          )
          .orderBy(
            desc(reimbursementSales.createdAt),
            desc(reimbursementSales.id),
          )
      : [];
    const pnFilter = normalize(params.get("pn"));
    const normalizedPnFilter = normalizePartNumber(params.get("pn"));
    const statusFilter = params.get("status")?.trim() ?? "all";
    const dealershipFilter = Number(params.get("dealershipId") ?? 0);
    const attentionOnly = params.get("attention") === "1";
    const factoryDealershipFilter = Number(params.get("factoryDealershipId") ?? 0);
    const factoryDateFrom = params.get("factoryDateFrom")?.trim() ?? "";
    const factoryDateTo = params.get("factoryDateTo")?.trim() ?? "";
    const matchesCommonFilters = (sale: typeof reimbursementSales.$inferSelect) =>
      (!pnFilter ||
        normalizePartNumber(sale.partNumber).includes(normalizedPnFilter) ||
        normalize(sale.description).includes(pnFilter)) &&
      (statusFilter === "all" || sale.status === statusFilter) &&
      (!attentionOnly || lineIndicators(sale).needsAnalysis);
    const matchesFilters = (sale: typeof reimbursementSales.$inferSelect) =>
      matchesCommonFilters(sale) &&
      (!dealershipFilter || sale.dealershipId === dealershipFilter);
    const filtered = allSales.filter(
      (sale) =>
        (!activeImportId || sale.importId === activeImportId) &&
        matchesFilters(sale),
    );
    const analyticalSales = filtered.filter(
      (sale) => sale.status !== "Rejeitada",
    );
    const importIndicators = new Map<
      number,
      { analysisRows: number; negativeMarginRows: number; netReferenceRows: number }
    >();
    for (const sale of allSales) {
      if (sale.status === "Rejeitada") continue;
      const indicators = lineIndicators(sale);
      const current = importIndicators.get(sale.importId) ?? {
        analysisRows: 0,
        negativeMarginRows: 0,
        netReferenceRows: 0,
      };
      if (indicators.needsAnalysis) current.analysisRows += 1;
      if (indicators.negativeMargin) current.negativeMarginRows += 1;
      if (indicators.needsNetReference) current.netReferenceRows += 1;
      importIndicators.set(sale.importId, current);
    }
    const factoryHistorySales = allSales.filter((sale) => {
      if (sale.status === "Rejeitada") return false;
      if (!matchesCommonFilters(sale)) return false;
      if (factoryDealershipFilter && sale.dealershipId !== factoryDealershipFilter)
        return false;
      const saleDate = String(sale.createdAt ?? "").slice(0, 10);
      return (!factoryDateFrom || saleDate >= factoryDateFrom) &&
        (!factoryDateTo || saleDate <= factoryDateTo);
    });
    const base = analyticalSales.reduce(
      (sum, sale) => ({
        quantity: sum.quantity + sale.quantity,
        sales: sum.sales + sale.liquidTotalCents,
        cost: sum.cost + sale.costTotalCents,
        n2:
          sum.n2 +
          (sale.reimbursementProgram === "N2" ? sale.reimbursementCents : 0),
        n3:
          sum.n3 +
          (sale.reimbursementProgram === "N3" ? sale.reimbursementCents : 0),
        negotiation: sum.negotiation + sale.negotiationCents,
      }),
      { quantity: 0, sales: 0, cost: 0, n2: 0, n3: 0, negotiation: 0 },
    );
    const rowsByDealer = new Map<
      string,
      {
        label: string;
        rows: number;
        quantity: number;
        salesCents: number;
        costCents: number;
        reimbursementCents: number;
      }
    >();
    const rowsByPart = new Map<
      string,
      {
        partNumber: string;
        description: string;
        quantity: number;
        salesCents: number;
        costCents: number;
        reimbursementCents: number;
        rows: number;
      }
    >();
    for (const sale of analyticalSales) {
      const dealer = sale.dealershipName || "Não identificado";
      const dealerEntry = rowsByDealer.get(dealer) ?? {
        label: dealer,
        rows: 0,
        quantity: 0,
        salesCents: 0,
        costCents: 0,
        reimbursementCents: 0,
      };
      dealerEntry.rows += 1;
      dealerEntry.quantity += sale.quantity;
      dealerEntry.salesCents += sale.liquidTotalCents;
      dealerEntry.costCents += sale.costTotalCents;
      dealerEntry.reimbursementCents += sale.reimbursementCents;
      rowsByDealer.set(dealer, dealerEntry);
      const partEntry = rowsByPart.get(sale.partNumber) ?? {
        partNumber: sale.partNumber,
        description: sale.description,
        quantity: 0,
        salesCents: 0,
        costCents: 0,
        reimbursementCents: 0,
        rows: 0,
      };
      partEntry.rows += 1;
      partEntry.quantity += sale.quantity;
      partEntry.salesCents += sale.liquidTotalCents;
      partEntry.costCents += sale.costTotalCents;
      partEntry.reimbursementCents += sale.reimbursementCents;
      rowsByPart.set(sale.partNumber, partEntry);
    }
    const factoryMarginByProgram: Record<
      ReimbursementSegment,
      {
        key: ReimbursementSegment;
        label: string;
        rows: number;
        quantity: number;
        salesCents: number;
        costCents: number;
        reimbursementCents: number;
      }
    > = {
      N2: {
        key: "N2",
        label: "Cliente Nível 2",
        rows: 0,
        quantity: 0,
        salesCents: 0,
        costCents: 0,
        reimbursementCents: 0,
      },
      N3: {
        key: "N3",
        label: "Cliente Nível 3",
        rows: 0,
        quantity: 0,
        salesCents: 0,
        costCents: 0,
        reimbursementCents: 0,
      },
      normal: {
        key: "normal",
        label: "Vendas normais",
        rows: 0,
        quantity: 0,
        salesCents: 0,
        costCents: 0,
        reimbursementCents: 0,
      },
    };
    const factorySalesByMonth = new Map<
      string,
      {
        month: string;
        dealershipName: string;
        rows: number;
        quantity: number;
        salesCents: number;
        costCents: number;
        n2SalesCents: number;
        n2CostCents: number;
        n3SalesCents: number;
        n3CostCents: number;
        normalSalesCents: number;
        normalCostCents: number;
        reimbursementCents: number;
        n2ReimbursementCents: number;
        n3ReimbursementCents: number;
        negotiationCents: number;
      }
    >();
    for (const sale of factoryHistorySales) {
      const segment = reimbursementSegment(sale.reimbursementProgram);
      const segmentEntry = factoryMarginByProgram[segment];
      segmentEntry.rows += 1;
      segmentEntry.quantity += sale.quantity;
      segmentEntry.salesCents += sale.liquidTotalCents;
      segmentEntry.costCents += sale.costTotalCents;
      segmentEntry.reimbursementCents += sale.reimbursementCents;
      const dealershipName = sale.dealershipName || "Não identificado";
      const month = sale.createdAt?.slice(0, 7) || "Sem referência";
      const key = `${month}::${dealershipName}`;
      const monthlyEntry = factorySalesByMonth.get(key) ?? {
        month,
        dealershipName,
        rows: 0,
        quantity: 0,
        salesCents: 0,
        costCents: 0,
        n2SalesCents: 0,
        n2CostCents: 0,
        n3SalesCents: 0,
        n3CostCents: 0,
        normalSalesCents: 0,
        normalCostCents: 0,
        reimbursementCents: 0,
        n2ReimbursementCents: 0,
        n3ReimbursementCents: 0,
        negotiationCents: 0,
      };
      monthlyEntry.rows += 1;
      monthlyEntry.quantity += sale.quantity;
      monthlyEntry.salesCents += sale.liquidTotalCents;
      monthlyEntry.costCents += sale.costTotalCents;
      monthlyEntry.reimbursementCents += sale.reimbursementCents;
      monthlyEntry.negotiationCents += sale.negotiationCents;
      if (segment === "N2") {
        monthlyEntry.n2SalesCents += sale.liquidTotalCents;
        monthlyEntry.n2CostCents += sale.costTotalCents;
        monthlyEntry.n2ReimbursementCents += sale.reimbursementCents;
      } else if (segment === "N3") {
        monthlyEntry.n3SalesCents += sale.liquidTotalCents;
        monthlyEntry.n3CostCents += sale.costTotalCents;
        monthlyEntry.n3ReimbursementCents += sale.reimbursementCents;
      } else {
        monthlyEntry.normalSalesCents += sale.liquidTotalCents;
        monthlyEntry.normalCostCents += sale.costTotalCents;
      }
      factorySalesByMonth.set(key, monthlyEntry);
    }
    const factoryReimbursementByMonth = new Map<
      string,
      { month: string; reimbursementCents: number; n2Cents: number; n3Cents: number; negotiationCents: number; rows: number }
    >();
    for (const row of factorySalesByMonth.values()) {
      const current = factoryReimbursementByMonth.get(row.month) ?? {
        month: row.month,
        reimbursementCents: 0,
        n2Cents: 0,
        n3Cents: 0,
        negotiationCents: 0,
        rows: 0,
      };
      current.reimbursementCents += row.reimbursementCents;
      current.n2Cents += row.n2ReimbursementCents;
      current.n3Cents += row.n3ReimbursementCents;
      current.negotiationCents += row.negotiationCents;
      current.rows += row.rows;
      factoryReimbursementByMonth.set(row.month, current);
    }
    const factoryBase = factoryHistorySales.reduce(
      (sum, sale) => ({
        quantity: sum.quantity + sale.quantity,
        sales: sum.sales + sale.liquidTotalCents,
        cost: sum.cost + sale.costTotalCents,
        n2:
          sum.n2 +
          (sale.reimbursementProgram === "N2" ? sale.reimbursementCents : 0),
        n3:
          sum.n3 +
          (sale.reimbursementProgram === "N3" ? sale.reimbursementCents : 0),
        negotiation: sum.negotiation + sale.negotiationCents,
      }),
      { quantity: 0, sales: 0, cost: 0, n2: 0, n3: 0, negotiation: 0 },
    );
    const factoryRowsByPart = new Map<
      string,
      {
        partNumber: string;
        description: string;
        rows: number;
        quantity: number;
        salesCents: number;
        reimbursementCents: number;
        costCents: number;
      }
    >();
    for (const sale of factoryHistorySales) {
      const normalizedPart = normalizePartNumber(sale.partNumber);
      const current = factoryRowsByPart.get(normalizedPart) ?? {
        partNumber: sale.partNumber,
        description: sale.description,
        rows: 0,
        quantity: 0,
        salesCents: 0,
        reimbursementCents: 0,
        costCents: 0,
      };
      current.rows += 1;
      current.quantity += sale.quantity;
      current.salesCents += sale.liquidTotalCents;
      current.reimbursementCents += sale.reimbursementCents;
      current.costCents += sale.costTotalCents;
      factoryRowsByPart.set(normalizedPart, current);
    }
    const statusBreakdown = STATUS_VALUES.map((status) => {
      const rows = filtered.filter((sale) => sale.status === status);
      return {
        status,
        count: rows.length,
        liquidTotalCents: rows.reduce(
          (sum, sale) => sum + sale.liquidTotalCents,
          0,
        ),
        reimbursementCents: rows.reduce(
          (sum, sale) => sum + sale.reimbursementCents,
          0,
        ),
      };
    })
      .filter((item) => item.count > 0)
      .sort((left, right) => right.count - left.count);
    const alerts = statusBreakdown.filter(
      (item) => !["N2 Elegível", "N3 Elegível"].includes(item.status),
    );
    const eligibleN2Records = filtered.filter(
      (sale) => sale.status === "N2 Elegível",
    ).length;
    const eligibleN3Records = filtered.filter(
      (sale) =>
        sale.status === "N3 Elegível" || sale.status === "N3 com Negociação",
    ).length;
    const activeIndicators = filtered.map(lineIndicators);
    const fallbackBaseRecords = filtered.filter(
      (sale) =>
        sale.netPriceUsedCents === null && sale.calculationBaseCents > 0,
    ).length;
    if (params.get("export") === "xlsx")
      return exportXlsx(filtered.map(serializeSale));
    const approvals = activeImportId
      ? await db
          .select()
          .from(reimbursementApprovals)
          .where(eq(reimbursementApprovals.importId, activeImportId))
          .orderBy(desc(reimbursementApprovals.createdAt))
      : [];
    return Response.json({
      imports: imports.map((item) => {
        const serialized = {
          ...item,
          createdAt: item.createdAt,
          totalSalesCents: item.totalSalesCents,
        };
        if (profile.role !== "general_admin") {
          const { toleranceBps: _toleranceBps, ...withoutTolerance } = serialized;
          return {
            ...withoutTolerance,
            ...(importIndicators.get(item.id) ?? {
              analysisRows: 0,
              negativeMarginRows: 0,
              netReferenceRows: 0,
            }),
          };
        }
        return {
          ...serialized,
          ...(importIndicators.get(item.id) ?? {
            analysisRows: 0,
            negativeMarginRows: 0,
            netReferenceRows: 0,
          }),
        };
      }),
      sales: filtered.slice(0, 1000).map(serializeSale),
      summary: {
        salesCents: base.sales,
        costCents: base.cost,
        marginBps: calculatedMarginBps(base.sales, base.cost),
        reimbursementN2Cents: base.n2,
        reimbursementN3Cents: base.n3,
        negotiationCents: base.negotiation,
        processedRows: filtered.length,
        totalQuantity: base.quantity,
        eligibleN2Records,
        eligibleN3Records,
        attentionRecords: activeIndicators.filter((item) => item.needsAnalysis).length,
        fallbackBaseRecords,
        negativeMarginRecords: activeIndicators.filter((item) => item.negativeMargin).length,
        netReferenceRecords: activeIndicators.filter((item) => item.needsNetReference).length,
      },
      ...(profile.role === "general_admin"
        ? { n3TolerancePercent: n3ToleranceBps / 100 }
        : {}),
      byDealership: [...rowsByDealer.values()]
        .map((item) => ({
          ...item,
          marginBps: calculatedMarginBps(item.salesCents, item.costCents),
        }))
        .sort((left, right) => right.salesCents - left.salesCents),
      byPartNumber: [...rowsByPart.values()]
        .map((item) => ({
          ...item,
          marginBps: calculatedMarginBps(item.salesCents, item.costCents),
        }))
        .sort((left, right) => right.salesCents - left.salesCents)
        .slice(0, 30),
      alerts,
      statusBreakdown,
      approvals,
      dealerships: dealers.map((dealer) => ({
        id: dealer.id,
        name: dealer.name,
        state: dealer.state,
      })),
      activeImportId,
      canReview: isManager(profile),
      canManageClients: isClientManager(profile),
      canViewFactoryDashboard: isManager(profile),
      factoryDashboard: isManager(profile)
        ? {
            summary: {
              salesCents: factoryBase.sales,
              costCents: factoryBase.cost,
              marginBps: calculatedMarginBps(factoryBase.sales, factoryBase.cost),
              reimbursementN2Cents: factoryBase.n2,
              reimbursementN3Cents: factoryBase.n3,
              negotiationCents: factoryBase.negotiation,
              processedRows: factoryHistorySales.length,
              totalQuantity: factoryBase.quantity,
            },
            byPartNumber: [...factoryRowsByPart.values()]
              .map((item) => ({
                ...item,
                marginBps: calculatedMarginBps(item.salesCents, item.costCents),
              }))
              .sort((left, right) => right.salesCents - left.salesCents)
              .slice(0, 30),
            marginByProgram: Object.values(factoryMarginByProgram).map(
              (item) => ({
                ...item,
                marginBps: calculatedMarginBps(item.salesCents, item.costCents),
              }),
            ),
            salesByMonthAndDealership: [...factorySalesByMonth.values()]
              .map((item) => ({
                ...item,
                totalMarginBps: calculatedMarginBps(
                  item.salesCents,
                  item.costCents,
                ),
                n2MarginBps: calculatedMarginBps(
                  item.n2SalesCents,
                  item.n2CostCents,
                ),
                n3MarginBps: calculatedMarginBps(
                  item.n3SalesCents,
                  item.n3CostCents,
                ),
                normalMarginBps: calculatedMarginBps(
                  item.normalSalesCents,
                  item.normalCostCents,
                ),
              }))
              .sort(
                (left, right) =>
                  right.month.localeCompare(left.month) ||
                  right.salesCents - left.salesCents,
              )
              .slice(0, 120),
            reimbursementByMonth: [...factoryReimbursementByMonth.values()].sort(
              (left, right) => right.month.localeCompare(left.month),
            ),
          }
        : null,
      canSubmit: true,
      statuses: STATUS_VALUES,
    });
  } catch (error) {
    return errorResponse(
      error instanceof Error
        ? error.message
        : "Não foi possível carregar os reembolsos.",
      500,
    );
  }
}

export async function POST(request: Request) {
  const profile = await getAccessProfile();
  if (!profile) return errorResponse("Acesso não autorizado.", 403);
  let uploadId = "";
  let totalChunks = 0;
  try {
    const { env } = await import("cloudflare:workers");
    if (!env.BUCKET)
      return errorResponse(
        "O armazenamento de arquivos ainda não está configurado.",
        503,
      );
    const action = new URL(request.url).searchParams.get("upload");
    if (action === "init") {
      const body = (await request.json()) as {
        fileName?: string;
        fileSize?: number;
      };
      const fileName = String(body.fileName ?? "").trim();
      const fileSize = Math.trunc(Number(body.fileSize) || 0);
      if (!/\.(xlsx|csv|tsv)$/i.test(fileName))
        return errorResponse("Envie um arquivo .xlsx, .csv ou .tsv.");
      if (!fileSize || fileSize > MAX_FILE_SIZE)
        return errorResponse("A planilha deve ter no máximo 120 MB.");
      return Response.json({
        uploadId: crypto.randomUUID(),
        chunkSize: CHUNK_SIZE,
        totalChunks: Math.ceil(fileSize / CHUNK_SIZE),
      });
    }
    if (action === "chunk") {
      const params = new URL(request.url).searchParams;
      uploadId = params.get("uploadId") ?? "";
      const part = Math.trunc(Number(params.get("part") ?? -1));
      totalChunks = Math.trunc(Number(params.get("totalChunks") ?? 0));
      if (
        !isValidUploadId(uploadId) ||
        part < 0 ||
        !totalChunks ||
        part >= totalChunks
      )
        return errorResponse("Parte de upload inválida.");
      await env.BUCKET.put(
        `reimbursements/incoming/${uploadId}/${part}`,
        await request.arrayBuffer(),
        {
          httpMetadata: {
            contentType:
              request.headers.get("content-type") || "application/octet-stream",
          },
        },
      );
      return Response.json({ ok: true, part });
    }
    if (action !== "complete")
      return errorResponse("Ação de upload não reconhecida.");
    const body = (await request.json()) as {
      uploadId?: string;
      fileName?: string;
      contentType?: string;
      totalChunks?: number;
      dealershipId?: number;
      dealershipIds?: number[];
    };
    uploadId = String(body.uploadId ?? "");
    totalChunks = Math.trunc(Number(body.totalChunks) || 0);
    if (!isValidUploadId(uploadId) || !totalChunks)
      return errorResponse("Upload incompleto.");
    const parts = await Promise.all(
      Array.from({ length: totalChunks }, async (_, part) => {
        const object = await env.BUCKET.get(
          `reimbursements/incoming/${uploadId}/${part}`,
        );
        if (!object)
          throw new Error(
            `A parte ${part + 1} da planilha não foi encontrada.`,
          );
        return new Uint8Array(await object.arrayBuffer());
      }),
    );
    const length = parts.reduce((sum, part) => sum + part.length, 0);
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const part of parts) {
      bytes.set(part, offset);
      offset += part.length;
    }
    const db = await ensureReimbursementStorage();
    const n3ToleranceBps = await getN3ToleranceBps(db);
    const allDealers = await visibleDealers(db, profile);
    const dealerScoped = isDealerScoped(profile);
    const requestedDealerIds = [
      ...(Array.isArray(body.dealershipIds) ? body.dealershipIds : []),
      ...(body.dealershipId ? [body.dealershipId] : []),
    ]
      .map((value) => Math.trunc(Number(value)))
      .filter((value) => value > 0);
    const uniqueRequestedDealerIds = [...new Set(requestedDealerIds)];
    const selectedDealers = allDealers.filter((dealer) =>
      uniqueRequestedDealerIds.includes(dealer.id),
    );
    if (
      uniqueRequestedDealerIds.length &&
      selectedDealers.length !== uniqueRequestedDealerIds.length
    )
      return errorResponse(
        "Uma das concessionárias selecionadas não está vinculada ao seu acesso.",
        403,
      );
    if (dealerScoped && !selectedDealers.length)
      return errorResponse(
        "Selecione ao menos uma concessionária vinculada ao seu usuário para importar vendas.",
        403,
      );
    const fallbackDealer =
      selectedDealers.length === 1
        ? selectedDealers[0]
        : !selectedDealers.length && profile.dealershipId
          ? (allDealers.find((dealer) => dealer.id === profile.dealershipId) ??
            null)
          : null;
    const parsed = parseSales(bytes, String(body.fileName ?? "vendas.xlsx"));
    if (!parsed.length)
      return errorResponse("Nenhuma venda válida foi encontrada na planilha.");
    if (!fallbackDealer && !selectedDealers.length) {
      const unknownDealerships = [
        ...new Set(
          parsed
            .filter(
              (row) =>
                !row.dealershipName ||
                !allDealers.some(
                  (dealer) =>
                    normalize(dealer.name) === normalize(row.dealershipName),
                ),
            )
            .map((row) => row.dealershipName || `linha ${row.sourceRow}`),
        ),
      ];
      if (unknownDealerships.length)
        return errorResponse(
          `Selecione uma concessionária no formulário ou corrija a coluna Concessionário. Não encontramos: ${unknownDealerships.slice(0, 5).join(", ")}.`,
        );
    }
    const [activePriceList] = await db
      .select()
      .from(priceListImports)
      .where(eq(priceListImports.isActive, true))
      .orderBy(desc(priceListImports.importedAt))
      .limit(1);
    const priceItems = activePriceList
      ? await db
          .select()
          .from(priceListItems)
          .where(eq(priceListItems.importId, activePriceList.id))
      : [];
    const priceByPn = new Map(
      priceItems.map((item) => [normalizePartNumber(item.partNumber), item]),
    );
    const clients = await db
      .select()
      .from(reimbursementClients)
      .where(eq(reimbursementClients.status, "active"));
    const oldSales = allDealers.length
      ? await db
          .select()
          .from(reimbursementSales)
          .where(
            inArray(
              reimbursementSales.dealershipId,
              allDealers.map((dealer) => dealer.id),
            ),
          )
      : [];
    const seen = new Map<string, number>();
    for (const row of parsed) {
      const dealer =
        fallbackDealer ??
        selectedDealers.find((item) => dealershipHandlesState(item, row.state)) ??
        allDealers.find(
          (item) => normalize(item.name) === normalize(row.dealershipName),
        );
      const key = `${dealer?.id ?? 0}|${normalize(row.invoiceNumber)}|${normalizePartNumber(row.partNumber)}`;
      seen.set(key, (seen.get(key) ?? 0) + 1);
    }
   const existing = new Set(
      oldSales.flatMap((row) => [
        row.duplicateKey,
        `${row.dealershipId ?? 0}|${normalize(row.invoiceNumber)}|${normalizePartNumber(row.partNumber)}`,
      ]).filter(Boolean),
   );
    const allowedDealerIds = new Set(allDealers.map((dealer) => dealer.id));
    const now = dateNow();
    const rowsToInsert: Array<typeof reimbursementSales.$inferInsert> = [];
    const summary = {
      quantity: 0,
      sales: 0,
      cost: 0,
      n2: 0,
      n3: 0,
      negotiation: 0,
    };
    let importDealerId = fallbackDealer?.id ?? null;
    if (!fallbackDealer && selectedDealers.length === 1)
      importDealerId = selectedDealers[0].id;
    if (!fallbackDealer && !selectedDealers.length) {
      const dealerNames = [
        ...new Set(
          parsed.map((row) => normalize(row.dealershipName)).filter(Boolean),
        ),
      ];
      if (dealerNames.length === 1)
        importDealerId =
          allDealers.find((dealer) => normalize(dealer.name) === dealerNames[0])
            ?.id ?? null;
    }
    const routingErrors: string[] = [];
    for (const row of parsed) {
      const candidates = selectedDealers.length
        ? selectedDealers.filter((item) => dealershipHandlesState(item, row.state))
        : fallbackDealer
          ? dealershipHandlesState(fallbackDealer, row.state)
            ? [fallbackDealer]
            : []
          : allDealers.filter(
              (item) =>
                normalize(item.name) === normalize(row.dealershipName) &&
                dealershipHandlesState(item, row.state),
            );
      const namedCandidate = candidates.find(
        (item) => normalize(item.name) === normalize(row.dealershipName),
      );
      const dealer =
        namedCandidate ??
        (candidates.length === 1 ? candidates[0] : null);
      if (!dealer) {
        const available = selectedDealers.length
          ? selectedDealers
              .map((item) => item.name + " (" + (item.state || "UF não cadastrada") + ")")
              .join(", ")
          : "a concessionária informada";
        routingErrors.push(
          "linha " + row.sourceRow + ": a UF " + row.state + " não está cadastrada para " + available,
        );
        continue;
      }
      const dealerId = dealer?.id ?? null;
      if (dealerScoped && (!dealerId || !allowedDealerIds.has(dealerId))) {
        routingErrors.push(
          "linha " + row.sourceRow + ": a concessionária da UF " + row.state + " não pertence à sua carteira",
        );
        continue;
      }
      importDealerId = importDealerId ?? dealerId;
      const client = clients.find(
        (item) =>
          normalizeDocument(item.cnpj) === row.clientCnpj &&
          item.state === row.state,
      );
      const priceItem = priceByPn.get(normalizePartNumber(row.partNumber));
      const price =
        priceItem && row.state
          ? priceForState(priceItem, row.state)
          : { net: null, n3: null };
      const costTotal = row.quantity * row.costUnitCents;
      const liquidTotal = row.quantity * row.saleNetUnitCents;
      const marginBps = liquidTotal
        ? Math.round(((liquidTotal - costTotal) / liquidTotal) * 10000)
        : costTotal > 0
          ? -10000
          : 0;
      const key = `${dealerId ?? 0}|${normalize(row.invoiceNumber)}|${normalizePartNumber(row.partNumber)}`;
      const duplicate = Boolean(
        row.invoiceNumber && ((seen.get(key) ?? 0) > 1 || existing.has(key)),
      );
      const program = client?.n3 ? "N3" : client?.n2 ? "N2" : "";
      const hasNetPrice = price.net !== null;
      const baseSource = hasNetPrice
        ? "NET_PRICE_VIGENTE"
        : "CUSTO_MEDIO_EXCEPCIONAL";
      const base = (price.net ?? row.costUnitCents) * row.quantity;
      const difference =
        price.n3 === null ? null : row.invoiceUnitCents - price.n3;
      const n3ToleranceCents =
        price.n3 === null ? 0 : Math.round(price.n3 * n3ToleranceBps / 10000);
      let status: SaleStatus = "Não Elegível";
      let reimbursement = 0;
      let negotiation = 0;
      let reasonCode = "";
      const history = oldSales.filter(
        (item) =>
          item.dealershipId === dealerId &&
          normalizePartNumber(item.partNumber) === normalizePartNumber(row.partNumber) &&
          item.liquidTotalCents > 0,
      );
      const historicalMarginBps = history.length
        ? Math.round(
            history.reduce((sum, item) => sum + item.marginBps, 0) /
              history.length,
          )
        : null;
      const marginVariationBps =
        historicalMarginBps === null ? null : marginBps - historicalMarginBps;
      if (duplicate) {
        status = "NF Duplicada";
        reasonCode = "NF_DUPLICADA";
      } else if (!client || !row.state) {
        status = "Produto/Estado/Cliente sem Cadastro";
        reasonCode = "CADASTRO_AUSENTE";
      } else if (!hasNetPrice) {
        status = "Aprovação Manual - Base de Cálculo";
        reasonCode = "NET_PRICE_AUSENTE";
      } else if (program === "N3") {
        if (
          price.n3 === null ||
          Math.abs(row.invoiceUnitCents - price.n3) > n3ToleranceCents
        )
          status = "Divergência de Preço";
        else {
          status = marginBps < 0 ? "N3 com Negociação" : "N3 Elegível";
          reimbursement = marginBps < 0 ? 0 : Math.round(base * 0.07);
          negotiation =
            marginBps < 0 ? Math.max(0, costTotal - liquidTotal) : 0;
        }
      } else if (program === "N2") {
        if (marginBps < 0) {
          status = "Não Elegível";
          reasonCode = "MARGEM_NEGATIVA_N2";
        } else if (marginBps <= 2000) {
          status = "N2 Elegível";
          reimbursement = Math.round(base * 0.04);
        } else status = "Não Elegível";
      }
      if (
        status.endsWith("Elegível") &&
        historicalMarginBps !== null &&
        Math.abs(marginVariationBps ?? 0) > 1000
      ) {
        status = "Pendente Justificativa";
        reasonCode = "VARIACAO_MARGEM";
        reimbursement = 0;
      }
      summary.quantity += row.quantity;
      summary.sales += liquidTotal;
      summary.cost += costTotal;
      if (program === "N2") summary.n2 += reimbursement;
      if (program === "N3") summary.n3 += reimbursement;
      summary.negotiation += negotiation;
      rowsToInsert.push({
        importId: 0,
        dealershipId: dealerId,
        clientId: client?.id ?? null,
        priceListImportId: activePriceList?.id ?? null,
        partNumber: row.partNumber,
        description: row.description,
        quantity: row.quantity,
        costAvgUnitCents: row.costUnitCents,
        saleNetUnitCents: row.saleNetUnitCents,
        invoiceUnitCents: row.invoiceUnitCents,
        clientName: row.clientName,
        clientCnpj: client?.cnpj ?? row.clientCnpj,
        invoiceNumber: row.invoiceNumber,
        state: row.state,
        dealershipName: dealer?.name || row.dealershipName || "",
        marginBps,
        costTotalCents: costTotal,
        liquidTotalCents: liquidTotal,
        netPriceUsedCents: price.net,
        calculationBaseCents: base,
        reimbursementCents: reimbursement,
        reimbursementProgram: program,
        status,
        negotiationCents: negotiation,
        expectedN3Cents: price.n3,
        priceDifferenceCents: difference,
        duplicateKey: key,
        baseSource,
        baseStatus: hasNetPrice ? "" : "MANUAL_REQUIRED",
        reasonCode,
        historicalMarginBps,
        marginVariationBps,
        justification: "",
        justificationStatus: "",
        createdAt: now,
      });
    }
    const importedDealerIds = [
      ...new Set(
        rowsToInsert
          .map((row) => row.dealershipId)
          .filter((dealerId): dealerId is number => typeof dealerId === "number"),
      ),
    ];
    importDealerId = importedDealerIds.length === 1 ? importedDealerIds[0] : null;
    if (routingErrors.length)
      return errorResponse(
        "Corrija o vínculo entre UF e concessionária antes de importar: " +
          routingErrors.slice(0, 8).join("; ") +
          (routingErrors.length > 8
            ? "; e mais " + (routingErrors.length - 8) + " linha(s)"
            : "") +
          ".",
      );
    if (!rowsToInsert.length)
      return errorResponse(
        "Nenhuma venda pertence ao escopo da concessionária selecionada.",
      );
    const storageKey = `reimbursements/${now.slice(0, 10)}/${crypto.randomUUID()}-${safeFileName(String(body.fileName ?? "vendas.xlsx"))}`;
    await env.BUCKET.put(storageKey, bytes, {
      httpMetadata: {
        contentType: body.contentType || "application/octet-stream",
      },
    });
    const [created] = await db
      .insert(reimbursementImports)
      .values({
        fileName: String(body.fileName ?? "vendas.xlsx"),
        storageKey,
        contentType: String(body.contentType ?? ""),
        dealershipId: importDealerId,
        priceListImportId: activePriceList?.id ?? null,
        rowCount: rowsToInsert.length,
        totalQuantity: summary.quantity,
        totalSalesCents: summary.sales,
        totalCostCents: summary.cost,
        totalReimbursementN2Cents: summary.n2,
        totalReimbursementN3Cents: summary.n3,
        totalNegotiationCents: summary.negotiation,
        toleranceCents: 0,
        toleranceBps: n3ToleranceBps,
        status: "processed",
        uploadedByEmail: profile.email,
        uploadedByName: profile.name,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    if (!created)
      throw new Error("Não foi possível criar o lote de reembolso.");
    // Grave cada linha separadamente. Um lote inteiro não pode falhar porque
    // uma referência opcional (cliente/lista de preços) ficou inválida no D1.
    // Nessa situação a linha continua sendo importada com as referências
    // nulas e mantém o status de validação calculado acima.
    for (const [rowIndex, row] of rowsToInsert.entries()) {
      const values = { ...row, importId: created.id };
      try {
        await db
          .insert(reimbursementSales)
          .values(values)
          .onConflictDoNothing();
      } catch (insertError) {
        try {
          await db
            .insert(reimbursementSales)
            .values({
              ...values,
              clientId: null,
              priceListImportId: null,
            })
            .onConflictDoNothing();
        } catch {
          const reason =
            insertError instanceof Error
              ? insertError.message
              : String(insertError);
          throw new Error(
            `Falha ao gravar a linha ${rowIndex + 2} (NF ${row.invoiceNumber}, PN ${row.partNumber}): ${reason}`,
          );
        }
      }
    }
    await recordAudit(db, {
      actorEmail: profile.email,
      actorName: profile.name,
      action: "reimbursement_import_processed",
      entity: "reimbursement_import",
      details: `Importação ${created.id} processada com ${rowsToInsert.length} vendas.`,
      after: {
        importId: created.id,
        dealershipId: importDealerId,
        rowCount: rowsToInsert.length,
        status: created.status,
        reimbursementN2Cents: summary.n2,
        reimbursementN3Cents: summary.n3,
        n3TolerancePercent: n3ToleranceBps / 100,
      },
    });
    await Promise.all(
      Array.from({ length: totalChunks }, (_, part) =>
        env.BUCKET.delete(`reimbursements/incoming/${uploadId}/${part}`),
      ),
    );
    return Response.json({
      ok: true,
      import: {
        id: created.id,
        rowCount: created.rowCount,
        totalQuantity: created.totalQuantity,
      },
    });
  } catch (error) {
    return errorResponse(
      error instanceof Error
        ? error.message
        : "Não foi possível processar a planilha de vendas.",
      500,
    );
  }
}

export async function PATCH(request: Request) {
  const profile = await getAccessProfile();
  if (!profile) return errorResponse("Acesso não autorizado.", 403);
  try {
    const body = (await request.json()) as {
      id?: number;
      lineId?: number;
      action?: string;
      note?: string;
      netPriceCents?: number;
      tolerancePercent?: number;
      adjustments?: {
        partNumber?: string;
        description?: string;
        quantity?: number;
        costAvgUnitCents?: number;
        saleNetUnitCents?: number;
        invoiceUnitCents?: number;
        clientName?: string;
        clientCnpj?: string;
        invoiceNumber?: string;
        state?: string;
        dealershipId?: number;
        netPriceCents?: number | null;
      };
    };
    if (body.action === "update_n3_tolerance") {
      if (profile.role !== "general_admin")
        return errorResponse("Somente o ADM pode alterar a tolerância N3.", 403);
      const tolerancePercent = Number(body.tolerancePercent);
      if (!Number.isFinite(tolerancePercent) || tolerancePercent < 0 || tolerancePercent > 100)
        return errorResponse("Informe uma tolerância entre 0% e 100%.");
      const db = await ensureReimbursementStorage();
      const now = dateNow();
      const numericValue = Math.round(tolerancePercent * 100);
      await db.insert(reimbursementSettings).values({
        settingKey: "n3_tolerance_bps",
        numericValue,
        updatedByEmail: profile.email,
        updatedAt: now,
      }).onConflictDoUpdate({
        target: reimbursementSettings.settingKey,
        set: { numericValue, updatedByEmail: profile.email, updatedAt: now },
      });
      await recordAudit(db, {
        actorEmail: profile.email,
        actorName: profile.name,
        action: "reimbursement_n3_tolerance_updated",
        entity: "reimbursement_settings",
        details: "Tolerância N3 atualizada para " + tolerancePercent + "%.",
        after: { settingKey: "n3_tolerance_bps", numericValue },
      });
      return Response.json({ ok: true, n3TolerancePercent: tolerancePercent });
    }
    if (body.lineId) {
      const lineId = Math.trunc(Number(body.lineId));
      const lineDb = await ensureReimbursementStorage();
      const [sale] = await lineDb
        .select()
        .from(reimbursementSales)
        .where(eq(reimbursementSales.id, lineId))
        .limit(1);
      if (!sale) return errorResponse("Linha não encontrada.", 404);
      const managers = isClientManager(profile);
      const dealerRows = await visibleDealers(lineDb, profile);
      if (
        sale.dealershipId &&
        !dealerRows.some((d) => d.id === sale.dealershipId)
      )
        return errorResponse("Linha fora do escopo.", 403);
      const action = String(body.action ?? "");
      const note = String(body.note ?? "").trim();
      if (action === "adjust_line") {
        if (!managers)
          return errorResponse(
            "Somente ADM e Gestão Global podem ajustar uma linha.",
            403,
          );
        if (note.length < 10)
          return errorResponse(
            "Documente o motivo do ajuste com pelo menos 10 caracteres.",
          );
        const adjustments = body.adjustments;
        if (!adjustments)
          return errorResponse("Informe os dados que serão ajustados.");
        const partNumber = String(adjustments.partNumber ?? "").trim();
        const description = String(adjustments.description ?? "").trim();
        const clientName = String(adjustments.clientName ?? "").trim();
        const clientCnpj = normalizeDocument(adjustments.clientCnpj);
        const invoiceNumber = String(adjustments.invoiceNumber ?? "").trim();
        const state = stateCode(adjustments.state);
        const quantityValue = Math.trunc(Number(adjustments.quantity) || 0);
        const costUnit = Math.trunc(Number(adjustments.costAvgUnitCents) || 0);
        const saleNetUnit = Math.trunc(
          Number(adjustments.saleNetUnitCents) || 0,
        );
        const invoiceUnit = Math.trunc(
          Number(adjustments.invoiceUnitCents) || 0,
        );
        const dealershipId = Math.trunc(
          Number(adjustments.dealershipId) || 0,
        );
        const manualNet =
          adjustments.netPriceCents === null ||
          adjustments.netPriceCents === undefined
            ? null
            : Math.trunc(Number(adjustments.netPriceCents) || 0);
        if (!partNumber || !description || !clientName || !invoiceNumber)
          return errorResponse(
            "Preencha PN, descrição, cliente e nota fiscal.",
          );
        if (!isValidDocument(clientCnpj))
          return errorResponse("Informe um CPF/CNPJ válido com 11 ou 14 dígitos.");
        if (!state) return errorResponse("Selecione uma UF válida.");
        if (
          quantityValue <= 0 ||
          costUnit <= 0 ||
          saleNetUnit <= 0 ||
          invoiceUnit <= 0
        )
          return errorResponse(
            "Quantidade, custo e valores unitários devem ser maiores que zero.",
          );
        const dealer = dealerRows.find((item) => item.id === dealershipId);
        if (!dealer)
          return errorResponse("Selecione uma concessionária do seu escopo.");
        if (!dealershipHandlesState(dealer, state))
          return errorResponse(
            `A concessionária ${dealer.name} não possui a UF ${state} em seu cadastro.`,
          );

        const clients = await lineDb
          .select()
          .from(reimbursementClients)
          .where(eq(reimbursementClients.status, "active"));
        const client = clients.find(
          (item) =>
            normalizeDocument(item.cnpj) === clientCnpj && item.state === state,
        );
        const [activePriceList] = await lineDb
          .select()
          .from(priceListImports)
          .where(eq(priceListImports.isActive, true))
          .orderBy(desc(priceListImports.importedAt))
          .limit(1);
        const priceListId = sale.priceListImportId ?? activePriceList?.id ?? null;
        const priceItems = priceListId
          ? await lineDb
              .select()
              .from(priceListItems)
              .where(eq(priceListItems.importId, priceListId))
          : [];
        const priceItem = priceItems.find(
          (item) =>
            normalizePartNumber(item.partNumber) ===
            normalizePartNumber(partNumber),
        );
        const referencePrice = priceItem
          ? priceForState(priceItem, state)
          : { net: null, n3: null };
        const netPrice = manualNet && manualNet > 0 ? manualNet : referencePrice.net;
        const costTotal = quantityValue * costUnit;
        const liquidTotal = quantityValue * saleNetUnit;
        const marginBps = calculatedMarginBps(liquidTotal, costTotal);
        const calculationBase = (netPrice ?? costUnit) * quantityValue;
        const duplicateKey = `${dealer.id}|${normalize(invoiceNumber)}|${normalizePartNumber(partNumber)}`;
        const allImportSales = await lineDb
          .select()
          .from(reimbursementSales)
          .where(eq(reimbursementSales.importId, sale.importId));
        const duplicate = allImportSales.some(
          (item) =>
            item.id !== sale.id &&
            `${item.dealershipId ?? 0}|${normalize(item.invoiceNumber)}|${normalizePartNumber(item.partNumber)}` ===
              duplicateKey,
        );
        const program = client?.n3 ? "N3" : client?.n2 ? "N2" : "";
        const difference =
          referencePrice.n3 === null
            ? null
            : invoiceUnit - referencePrice.n3;
        const toleranceBps = await getN3ToleranceBps(lineDb);
        const toleranceCents =
          referencePrice.n3 === null
            ? 0
            : Math.round((referencePrice.n3 * toleranceBps) / 10000);
        let status: SaleStatus = "Não Elegível";
        let reimbursement = 0;
        let negotiation = 0;
        let reasonCode = "";
        if (duplicate) {
          status = "NF Duplicada";
          reasonCode = "NF_DUPLICADA";
        } else if (!client || !priceItem) {
          status = "Produto/Estado/Cliente sem Cadastro";
          reasonCode = "CADASTRO_AUSENTE";
        } else if (netPrice === null) {
          status = "Aprovação Manual - Base de Cálculo";
          reasonCode = "NET_PRICE_AUSENTE";
        } else if (program === "N3") {
          if (
            referencePrice.n3 === null ||
            Math.abs(invoiceUnit - referencePrice.n3) > toleranceCents
          ) {
            status = "Divergência de Preço";
            reasonCode = "DIVERGENCIA_PRECO_N3";
          } else {
            status = marginBps < 0 ? "N3 com Negociação" : "N3 Elegível";
            reimbursement =
              marginBps < 0 ? 0 : Math.round(calculationBase * 0.07);
            negotiation = marginBps < 0 ? costTotal - liquidTotal : 0;
          }
        } else if (program === "N2") {
          if (marginBps < 0) {
            reasonCode = "MARGEM_NEGATIVA_N2";
          } else if (marginBps <= 2000) {
            status = "N2 Elegível";
            reimbursement = Math.round(calculationBase * 0.04);
          }
        }
        const historicalRows = allImportSales.filter(
          (item) =>
            item.id !== sale.id &&
            item.dealershipId === dealer.id &&
            normalizePartNumber(item.partNumber) ===
              normalizePartNumber(partNumber) &&
            item.liquidTotalCents > 0,
        );
        const historicalMarginBps = historicalRows.length
          ? Math.round(
              historicalRows.reduce((sum, item) => sum + item.marginBps, 0) /
                historicalRows.length,
            )
          : null;
        const marginVariationBps =
          historicalMarginBps === null
            ? null
            : marginBps - historicalMarginBps;
        if (
          status.endsWith("Elegível") &&
          historicalMarginBps !== null &&
          Math.abs(marginVariationBps ?? 0) > 1000
        ) {
          status = "Pendente Justificativa";
          reasonCode = "VARIACAO_MARGEM";
          reimbursement = 0;
        }
        const before = serializeSale(sale);
        const [updated] = await lineDb
          .update(reimbursementSales)
          .set({
            dealershipId: dealer.id,
            dealershipName: dealer.name,
            clientId: client?.id ?? null,
            priceListImportId: priceListId,
            partNumber,
            description,
            quantity: quantityValue,
            costAvgUnitCents: costUnit,
            saleNetUnitCents: saleNetUnit,
            invoiceUnitCents: invoiceUnit,
            clientName,
            clientCnpj,
            invoiceNumber,
            state,
            marginBps,
            costTotalCents: costTotal,
            liquidTotalCents: liquidTotal,
            netPriceUsedCents: netPrice,
            calculationBaseCents: calculationBase,
            reimbursementCents: reimbursement,
            reimbursementProgram: program,
            status,
            negotiationCents: Math.max(0, negotiation),
            expectedN3Cents: referencePrice.n3,
            priceDifferenceCents: difference,
            duplicateKey,
            baseSource:
              manualNet && manualNet > 0
                ? "NET_PRICE_MANUAL"
                : netPrice
                  ? "NET_PRICE_VIGENTE"
                  : "CUSTO_MEDIO_EXCEPCIONAL",
            baseStatus: netPrice ? "" : "MANUAL_REQUIRED",
            reasonCode,
            historicalMarginBps,
            marginVariationBps,
            justification: note,
            justificationStatus: "adjusted",
          })
          .where(eq(reimbursementSales.id, lineId))
          .returning();
        await recordAudit(lineDb, {
          actorEmail: profile.email,
          actorName: profile.name,
          action: "reimbursement_line_adjusted",
          entity: "reimbursement_sale",
          details: `Linha ${lineId} ajustada. Motivo: ${note}`,
          before,
          after: updated ? serializeSale(updated) : undefined,
        });
      } else if (action === "reject_line") {
        if (!managers)
          return errorResponse(
            "Somente ADM e Gestão Global podem rejeitar uma linha.",
            403,
          );
        if (note.length < 5)
          return errorResponse("Documente o motivo da rejeição.");
        await lineDb
          .update(reimbursementSales)
          .set({
            status: "Rejeitada",
            reimbursementCents: 0,
            negotiationCents: 0,
            justification: note,
            justificationStatus: "rejected",
            reasonCode: "REJEITADA_GESTOR",
          })
          .where(eq(reimbursementSales.id, lineId));
      } else if (action === "submit_justification") {
        if (!isDealerScoped(profile) || note.length < 5)
          return errorResponse("Informe uma justificativa válida.");
        await lineDb
          .update(reimbursementSales)
          .set({ justification: note, justificationStatus: "submitted" })
          .where(eq(reimbursementSales.id, lineId));
      } else if (
        managers &&
        (action === "accept_line" || action === "question_line" || action === "return_line")
      ) {
        if ((action === "question_line" || action === "return_line") && note.length < 5)
          return errorResponse("Informe uma observação para esta decisão.");
        if (action === "accept_line") {
          if (sale.calculationBaseCents <= 0)
            return errorResponse("A linha não possui base de cálculo válida.");
        }
        const accepted = action === "accept_line";
        await lineDb
          .update(reimbursementSales)
          .set({
            status: accepted
              ? sale.reimbursementProgram === "N3"
                ? "N3 Elegível"
                : sale.reimbursementProgram === "N2"
                  ? "N2 Elegível"
                  : "Não Elegível"
              : action === "question_line" ? "Pendente Justificativa" : "Devolvida para correção",
            reimbursementCents: accepted
              ? sale.reimbursementProgram === "N3"
                ? Math.round(sale.calculationBaseCents * 0.07)
                : sale.reimbursementProgram === "N2"
                  ? Math.round(sale.calculationBaseCents * 0.04)
                  : 0
              : 0,
            justification: note,
            justificationStatus: accepted ? "approved" : action === "question_line" ? "questioned" : "returned",
            reasonCode: accepted ? "" : action === "question_line" ? "ANALISE_SOLICITADA" : "DEVOLVIDA_CORRECAO",
          })
          .where(eq(reimbursementSales.id, lineId));
      } else if (
        managers &&
        (action === "manual_base_set_net_price" ||
          action === "manual_base_approve_cost")
      ) {
        const net = Math.trunc(Number(body.netPriceCents) || 0);
        if (action === "manual_base_set_net_price" && net <= 0)
          return errorResponse("Informe um Net Price válido.");
        const base =
          (action === "manual_base_set_net_price"
            ? net
            : sale.costAvgUnitCents) * sale.quantity;
        await lineDb
          .update(reimbursementSales)
          .set({
            netPriceUsedCents:
              action === "manual_base_set_net_price"
                ? net
                : sale.netPriceUsedCents,
            calculationBaseCents: base,
            baseSource:
              action === "manual_base_set_net_price"
                ? "NET_PRICE_MANUAL"
                : "CUSTO_MEDIO_APROVADO",
            baseStatus: "",
            status:
              sale.reimbursementProgram === "N3"
                ? "N3 Elegível"
                : "N2 Elegível",
            reimbursementCents:
              sale.reimbursementProgram === "N3"
                ? Math.round(base * 0.07)
                : Math.round(base * 0.04),
            reasonCode: "",
          })
          .where(eq(reimbursementSales.id, lineId));
      } else if (
        managers &&
        (action === "approve_justification" ||
          action === "reject_justification")
      ) {
        await lineDb
          .update(reimbursementSales)
          .set({
            status:
              action === "approve_justification"
                ? sale.reimbursementProgram === "N3"
                  ? "N3 Elegível"
                  : "N2 Elegível"
                : "Não Elegível",
            reimbursementCents:
              action === "approve_justification"
                ? sale.reimbursementProgram === "N3"
                  ? Math.round(sale.calculationBaseCents * 0.07)
                  : Math.round(sale.calculationBaseCents * 0.04)
                : 0,
            justificationStatus:
              action === "approve_justification" ? "approved" : "rejected",
            reasonCode:
              action === "approve_justification"
                ? ""
                : "JUSTIFICATIVA_REJEITADA",
          })
          .where(eq(reimbursementSales.id, lineId));
      } else return errorResponse("Ação de linha não reconhecida.");
      await lineDb.insert(reimbursementApprovals).values({
        importId: sale.importId,
        lineId,
        action,
        note,
        actorEmail: profile.email,
        actorName: profile.name,
        createdAt: dateNow(),
      });
      await refreshImportTotals(lineDb, sale.importId);
      if (action !== "adjust_line") {
        const [afterSale] = await lineDb
          .select()
          .from(reimbursementSales)
          .where(eq(reimbursementSales.id, lineId))
          .limit(1);
        await recordAudit(lineDb, {
          actorEmail: profile.email,
          actorName: profile.name,
          action: `reimbursement_line_${action}`,
          entity: "reimbursement_sale",
          details: `Decisão aplicada à linha ${lineId}${note ? `. Motivo: ${note}` : "."}`,
          before: serializeSale(sale),
          after: afterSale ? serializeSale(afterSale) : undefined,
        });
      }
      return Response.json({ ok: true });
    }
    const id = Math.trunc(Number(body.id) || 0);
    const action = String(body.action ?? "").trim();
    const note = String(body.note ?? "").trim();
    if (!id || !action) return errorResponse("Informe lote e ação.");
    const db = await ensureReimbursementStorage();
    const [batch] = await db
      .select()
      .from(reimbursementImports)
      .where(eq(reimbursementImports.id, id))
      .limit(1);
    if (!batch) return errorResponse("Lote de reembolso não encontrado.", 404);
    const dealers = await visibleDealers(db, profile);
    if (
      batch.dealershipId &&
      !dealers.some((dealer) => dealer.id === batch.dealershipId)
    )
      return errorResponse("Lote fora do escopo do usuário.", 403);
    const transitions: Record<
      string,
      { from: string[]; to: string; manager: boolean }
    > = {
      submit: {
        from: ["processed", "rejected"],
        to: "submitted",
        manager: false,
      },
      start_review: { from: ["submitted"], to: "under_review", manager: true },
      approve: {
        from: ["submitted", "under_review"],
        to: "approved",
        manager: true,
      },
      reject: {
        from: ["submitted", "under_review"],
        to: "rejected",
        manager: true,
      },
      mark_paid: { from: ["approved"], to: "paid", manager: true },
    };
    const transition = transitions[action];
    if (!transition || !transition.from.includes(batch.status))
      return errorResponse(
        "Essa ação não está disponível para o status atual do lote.",
      );
    if (transition.manager && !isManager(profile))
      return errorResponse(
        "Somente Gestão Global, ADM e Gestor Fábrica podem analisar reembolsos.",
        403,
      );
    if (action === "reject" && note.length < 5)
      return errorResponse("Informe o motivo da rejeição.");
    const now = dateNow();
    await db
      .update(reimbursementImports)
      .set({
        status: transition.to,
        decisionNote: note || batch.decisionNote,
        decidedByEmail: profile.email,
        decidedAt: transition.manager ? now : batch.decidedAt,
        updatedAt: now,
      })
      .where(eq(reimbursementImports.id, id));
    await db.insert(reimbursementApprovals).values({
      importId: id,
      action,
      note,
      actorEmail: profile.email,
      actorName: profile.name,
      createdAt: now,
    });
    await recordAudit(db, {
      actorEmail: profile.email,
      actorName: profile.name,
      action: `reimbursement_${action}`,
      entity: "reimbursement_import",
      details: `Lote ${id}: ${transition.to}.`,
      before: { status: batch.status },
      after: { status: transition.to, note },
    });
    return Response.json({ ok: true, status: transition.to });
  } catch (error) {
    return errorResponse(
      error instanceof Error
        ? error.message
        : "Não foi possível atualizar o workflow do reembolso.",
      500,
    );
  }
}
