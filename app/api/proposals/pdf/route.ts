import { eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { dealerships, proposalItems, proposals } from "../../../../db/schema";
import { getAccessProfile, isModuleEnabled, profileHasDealership, type AccessProfile } from "../../../../lib/access";

export const dynamic = "force-dynamic";

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function visible(profile: AccessProfile, dealer: { id: number; factoryManagerEmail: string }) {
  if (["general_admin", "global_management"].includes(profile.role)) return true;
  if (profile.role === "factory_manager") return profileHasDealership(profile, dealer.id) || dealer.factoryManagerEmail.toLowerCase() === profile.email;
  return profile.role === "dealer_manager" && profileHasDealership(profile, dealer.id);
}

function formatBRL(cents: number | null | undefined) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format((Number(cents) || 0) / 100);
}

function formatDate(value: string) {
  if (!value) return "—";
  const [year, month, day] = value.split("-");
  return year && month && day ? day + "/" + month + "/" + year : value;
}

export async function GET(request: Request) {
  const profile = await getAccessProfile();
  if (!profile) return new Response("Acesso não disponível.", { status: 401 });
  const proposalId = new URL(request.url).searchParams.get("proposalId")?.trim() ?? "";
  if (!proposalId) return new Response("Informe a proposta.", { status: 400 });
  const db = await getDb();
  const [record] = await db
    .select({ proposal: proposals, dealer: dealerships })
    .from(proposals)
    .innerJoin(dealerships, eq(proposals.dealershipId, dealerships.id))
    .where(eq(proposals.id, proposalId))
    .limit(1);
  if (!record || !visible(profile, record.dealer) || !(await isModuleEnabled(db, record.dealer.id, "proposals"))) {
    return new Response("Proposta não encontrada.", { status: 404 });
  }
  const items = await db.select().from(proposalItems).where(eq(proposalItems.proposalId, proposalId));
  const rows = items.map((item) => `<tr><td>${escapeHtml(item.partNumber)}</td><td>${escapeHtml(item.description)}</td><td>${escapeHtml(item.vt)}</td><td>${escapeHtml(item.origin)}</td><td>${escapeHtml(item.ncm)}</td><td class="center">${item.quantity}</td><td class="right">${formatBRL(item.unitPriceCents)}</td><td class="right">${item.invoiceUnitPriceCents ? formatBRL(item.invoiceUnitPriceCents) : "—"}</td></tr>`).join("");
  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Proposta ${escapeHtml(proposalId)} · HORSCH</title><style>
    @page{size:A4;margin:16mm}*{box-sizing:border-box}body{font-family:Arial,Helvetica,sans-serif;color:#142d4d;margin:0;font-size:11px}header{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #e52b2f;padding-bottom:12px;margin-bottom:18px}.brand{font-size:29px;font-weight:800;letter-spacing:1.5px}.brand small{display:block;color:#e52b2f;font-size:9px;letter-spacing:2px;margin-top:3px}.title{text-align:right}.title h1{margin:0;font-size:20px;text-transform:uppercase}.title p{margin:5px 0 0;color:#64748b}.stats,.customer{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:12px}.card{background:#f1f4f7;border-left:3px solid #e52b2f;padding:10px}.card span{display:block;color:#64748b;font-size:9px;text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px}.card strong{font-size:12px}.section-title{display:flex;justify-content:space-between;align-items:end;border-bottom:1px solid #cad3dd;margin-top:22px;padding-bottom:6px}.section-title h2{font-size:13px;margin:0;text-transform:uppercase}.section-title span{font-size:9px;color:#64748b}table{width:100%;border-collapse:collapse;margin-top:8px}th{background:#142d4d;color:white;text-align:left;font-size:9px;text-transform:uppercase;padding:8px 6px}td{border-bottom:1px solid #d9e0e7;padding:8px 6px;color:#253b54}td.center{text-align:center}td.right{text-align:right;white-space:nowrap}.total{display:flex;justify-content:space-between;align-items:center;margin:16px 0 0 auto;background:#e52b2f;color:white;padding:12px 14px;max-width:270px}.total strong{font-size:17px}.terms{margin-top:24px;border-top:1px solid #d9e0e7;padding-top:12px;color:#526273}.signatures{display:grid;grid-template-columns:1fr 1fr;gap:40px;margin-top:58px}.signature{border-top:1px solid #142d4d;padding-top:7px;text-align:center;font-size:10px}.footer{display:flex;justify-content:space-between;border-top:1px solid #d9e0e7;margin-top:34px;padding-top:9px;color:#64748b;font-size:9px}@media print{.no-print{display:none}}</style></head><body>
    <header><div class="brand">HORSCH<small>DO BRASIL</small></div><div class="title"><h1>Proposta comercial</h1><p>Documento oficial · ${escapeHtml(proposalId)}</p></div></header>
    <section class="stats"><div class="card"><span>Número da proposta</span><strong>${escapeHtml(record.proposal.id)}</strong></div><div class="card"><span>Data de solicitação</span><strong>${formatDate(record.proposal.issueDate)}</strong></div><div class="card"><span>Validade da oferta</span><strong>${formatDate(record.proposal.offerValidUntil || record.proposal.validUntil)}</strong></div></section>
    <section class="customer"><div class="card"><span>Concessionária</span><strong>${escapeHtml(record.dealer.name)}</strong></div><div class="card"><span>Cliente final</span><strong>${escapeHtml(record.proposal.customerName || "—")}</strong></div><div class="card"><span>Responsável HORSCH</span><strong>${escapeHtml(record.proposal.commercialOwner || "—")}</strong></div></section>
    <div class="section-title"><h2>Itens da proposta</h2><span>Valores unitários em reais</span></div><table><thead><tr><th>PN</th><th>Descrição</th><th>VT</th><th>Origem</th><th>NCM</th><th>Qtd.</th><th>Netprice</th><th>NF unit.</th></tr></thead><tbody>${rows}</tbody></table>
    <div class="total"><span>Valor total de Netprice</span><strong>${formatBRL(record.proposal.totalCents)}</strong></div>
    <div class="terms"><strong>Condições comerciais</strong><p>Valores líquidos em reais, conforme oferta oficial registrada no portal. Este documento deve ser utilizado exclusivamente para a negociação identificada pelo número da proposta.</p></div>
    <div class="signatures"><div class="signature">${escapeHtml(record.proposal.commercialOwner || "Gestão Global HORSCH")}<br>Responsável HORSCH</div><div class="signature">${escapeHtml(record.proposal.contactName || "Gestor do Concessionário")}<br>Responsável / Concessionária</div></div>
    <div class="footer"><span>HORSCH do Brasil · Curitiba · Paraná</span><span>Documento confidencial · Uso comercial</span></div></body></html>`;
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Content-Disposition": "inline; filename=proposta-" + proposalId + ".html" } });
}
