import { unzipSync } from "fflate";

export type QuoteImportRow = {
  rowNumber: number;
  requestId: string;
  partNumber: string;
  description: string;
  ncm: string;
  vt: string;
  origin: string;
  netPriceCents: number;
  comments: string;
  dealership: string;
  quantity: number;
};

function decode(bytes: Uint8Array) {
  return new TextDecoder().decode(bytes);
}

function unescapeXml(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function normalizeHeader(value: unknown) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

function columnIndex(value: string) {
  let result = 0;
  for (const letter of value) result = result * 26 + letter.charCodeAt(0) - 64;
  return result;
}

function parseXlsx(bytes: Uint8Array): string[][] {
  const files = unzipSync(bytes) as Record<string, Uint8Array>;
  const workbook = decode(files["xl/workbook.xml"] ?? new Uint8Array());
  const relationships = decode(
    files["xl/_rels/workbook.xml.rels"] ?? new Uint8Array(),
  );
  const firstSheet = workbook.match(/<sheet\b[^>]*r:id="([^"]+)"[^>]*>/i)?.[1];
  const relationship = firstSheet
    ? [...relationships.matchAll(/<Relationship\b([^>]*?)(?:\/>|>)/gi)]
        .map((match) => match[1])
        .find(
          (attributes) =>
            attributes.match(/\bId="([^"]+)"/i)?.[1] === firstSheet,
        )
    : "";
  const target = relationship?.match(/\bTarget="([^"]+)"/i)?.[1];
  const worksheetPath = target
    ? target.replace(/^\/+/, "").replace(/^\.\//, "").startsWith("xl/")
      ? target.replace(/^\/+/, "").replace(/^\.\//, "")
      : `xl/${target.replace(/^\/+/, "").replace(/^\.\//, "")}`
    : "xl/worksheets/sheet1.xml";
  const sheet = decode(
    files[files[worksheetPath] ? worksheetPath : "xl/worksheets/sheet1.xml"] ??
      new Uint8Array(),
  );
  const shared = decode(files["xl/sharedStrings.xml"] ?? new Uint8Array());
  const strings = [...shared.matchAll(/<si[\s\S]*?<\/si>/g)].map((match) =>
    [...match[0].matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)]
      .map((part) => unescapeXml(part[1]))
      .join(""),
  );
  return [...sheet.matchAll(/<row(?:\s[^>]*)?>([\s\S]*?)<\/row>/g)].map(
    (row) => {
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
                .map((part) => unescapeXml(part[1]))
                .join("")
            : unescapeXml(body.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? "");
        values[columnIndex(ref)] =
          type === "s" && raw ? (strings[Number(raw)] ?? "") : raw;
      }
      const max = Math.max(-1, ...Object.keys(values).map(Number));
      return Array.from({ length: max + 1 }, (_, index) => values[index] ?? "");
    },
  );
}

function parseDelimited(bytes: Uint8Array) {
  const text = decode(bytes).replace(/^\uFEFF/, "");
  const delimiter = (text.split(/\r?\n/, 1)[0] ?? "").includes("\t")
    ? "\t"
    : ";";
  const rows: string[][] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const values: string[] = [];
    let current = "";
    let quoted = false;
    for (let index = 0; index < line.length; index += 1) {
      const char = line[index];
      if (char === '"' && line[index + 1] === '"' && quoted) {
        current += '"';
        index += 1;
        continue;
      }
      if (char === '"') {
        quoted = !quoted;
        continue;
      }
      if (char === delimiter && !quoted) {
        values.push(current.trim());
        current = "";
      } else current += char;
    }
    values.push(current.trim());
    rows.push(values);
  }
  return rows;
}

function moneyToCents(value: unknown) {
  const raw = String(value ?? "")
    .trim()
    .replace(/R\$/gi, "")
    .replace(/\s/g, "");
  if (!raw) return 0;
  const normalized = raw.includes(",")
    ? raw.replace(/\./g, "").replace(",", ".")
    : raw.replace(/[^\d.-]/g, "");
  const number = Number(normalized);
  return Number.isFinite(number) ? Math.round(number * 100) : 0;
}

function numberValue(value: unknown) {
  const number = Number(
    String(value ?? "")
      .replace(",", ".")
      .replace(/[^\d.-]/g, ""),
  );
  return Number.isFinite(number) ? Math.max(1, Math.round(number)) : 1;
}

function findIndex(headers: string[], aliases: string[]) {
  const normalized = aliases.map(normalizeHeader);
  return headers.findIndex((header) => normalized.includes(header));
}

export function parseQuoteImport(
  bytes: Uint8Array,
  fileName: string,
): QuoteImportRow[] {
  const rows = /\.xlsx$/i.test(fileName)
    ? parseXlsx(bytes)
    : parseDelimited(bytes);
  if (rows.length < 2)
    throw new Error(
      "A planilha precisa conter cabeçalho e pelo menos uma linha.",
    );
  const headers = rows[0].map(normalizeHeader);
  const indexes = {
    requestId: findIndex(headers, [
      "id",
      "cotacao",
      "idcotacao",
      "numerocotacao",
      "solicitacao",
    ]),
    partNumber: findIndex(headers, [
      "pn",
      "partnumber",
      "partnumberhorsch",
      "material",
      "numerodapeca",
    ]),
    description: findIndex(headers, [
      "descricao",
      "description",
      "descricaodefabrica",
    ]),
    ncm: findIndex(headers, ["ncm"]),
    vt: findIndex(headers, ["vt"]),
    origin: findIndex(headers, ["origem", "origin"]),
    netPrice: findIndex(headers, [
      "netprice",
      "netpricecents",
      "preconet",
      "preconetprice",
      "netpricevigente",
      "netpriceretornado",
    ]),
    comments: findIndex(headers, [
      "comentarios",
      "comentario",
      "comments",
      "observacao",
      "observacoes",
    ]),
    dealership: findIndex(headers, ["concessionaria", "dealership", "dealer"]),
    quantity: findIndex(headers, ["quantidade", "qtd", "quantity"]),
  };
  if (
    indexes.partNumber < 0 ||
    indexes.description < 0 ||
    indexes.vt < 0 ||
    indexes.netPrice < 0
  ) {
    throw new Error(
      "Use as colunas obrigatórias: PN, Descrição, VT e Net Price. NCM, Comentários e Concessionária são opcionais.",
    );
  }
  return rows
    .slice(1)
    .map((row, index) => ({
      rowNumber: index + 2,
      requestId:
        indexes.requestId >= 0
          ? String(row[indexes.requestId] ?? "").trim()
          : "",
      partNumber: String(row[indexes.partNumber] ?? "").trim(),
      description: String(row[indexes.description] ?? "").trim(),
      ncm: indexes.ncm >= 0 ? String(row[indexes.ncm] ?? "").trim() : "",
      vt: String(row[indexes.vt] ?? "").trim(),
      origin:
        indexes.origin >= 0 ? String(row[indexes.origin] ?? "").trim() : "",
      netPriceCents: moneyToCents(row[indexes.netPrice]),
      comments:
        indexes.comments >= 0 ? String(row[indexes.comments] ?? "").trim() : "",
      dealership:
        indexes.dealership >= 0
          ? String(row[indexes.dealership] ?? "").trim()
          : "",
      quantity: indexes.quantity >= 0 ? numberValue(row[indexes.quantity]) : 1,
    }))
    .filter(
      (row) =>
        row.partNumber || row.description || row.vt || row.netPriceCents > 0,
    );
}
