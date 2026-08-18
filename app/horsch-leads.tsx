"use client";

import { useEffect, useMemo, useState } from "react";

export type LeadStage = "new" | "contacted" | "qualified" | "proposal" | "negotiation" | "won" | "lost";
export type LeadTemperature = "cold" | "warm" | "hot";

export type Lead = {
  id: string;
  dealershipId: number;
  dealership: string;
  customerName: string;
  phone: string;
  email: string;
  machineDomain: string;
  partNumbers: string;
  partsOfInterest: string;
  temperature: LeadTemperature;
  stage: LeadStage;
  negotiatedValueCents: number;
  invoiceNumber: string;
  invoiceValueCents: number;
  sellerName: string;
  sellerEmail: string;
  createdAt: string;
  updatedAt: string;
};

export type LeadGroup = { label: string; total: number; open: number; won: number; lost: number; pipelineCents: number; negotiatedCents: number; wonCents: number; conversionRate: number; byStage: Array<{ label: string; count: number; valueCents: number; wonCents: number }>; byTemperature: Array<{ label: string; count: number; valueCents: number; wonCents: number }> };
export type LeadPartInsight = { partNumber: string; stage: LeadStage; stageLabel: string; customers: string[]; leadCount: number; valueCents: number };
export type LeadCustomerMachineInsight = { customerName: string; machineDomain: string; dealership: string; sellerName: string; stage: LeadStage; partNumbers: string; temperature: LeadTemperature; negotiatedValueCents: number; updatedAt: string };
export type LeadModuleData = { leads: Lead[]; leadDetails: Lead[]; byPartNumberStage: LeadPartInsight[]; customerMachines: LeadCustomerMachineInsight[]; metrics: LeadGroup; byDealership: LeadGroup[]; bySeller: LeadGroup[]; sellers: Array<{ email: string; name: string; dealershipId: number | null }>; canEdit: boolean; metricsOnly: boolean };
type PriceCatalogItem = { partNumber: string; description: string; family: string };
type MachineModel = { id: number; name: string; active: boolean };

type CurrentAccess = { email: string; name: string; role: string };

const STAGE_LABELS: Record<LeadStage, string> = { new: "Novo", contacted: "Contato", qualified: "Qualificado", proposal: "Proposta", negotiation: "Negociação", won: "Fechado", lost: "Perdido" };
const TEMPERATURE_LABELS: Record<LeadTemperature, string> = { cold: "Frio", warm: "Morno", hot: "Quente" };
const STAGE_ORDER: LeadStage[] = ["new", "contacted", "qualified", "proposal", "negotiation", "won", "lost"];
const FALLBACK_MACHINE_MODELS = ["Joker", "Terrano", "Tiger", "Pronto", "Cruiser", "Maestro", "Avatar", "Leeb", "Finer", "Transformer", "Sprinter", "Focus", "Partner", "Express", "Cultro"];

function money(cents: number) {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function date(value: string) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(value));
}

function parseMoney(value: string) {
  const normalized = value.replace(/\s/g, "").replace(/R\$/gi, "").replace(/\./g, "").replace(",", ".");
  const number = Number(normalized);
  return Number.isFinite(number) && number >= 0 ? Math.round(number * 100) : 0;
}

function formatMoneyInput(value: string) {
  const cents = parseMoney(value);
  return cents ? (cents / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "";
}

function stageClass(stage: LeadStage) {
  return `lead-stage ${stage}`;
}

function splitValues(value: string) {
  return value.split(/[,;\n]+/).map((item) => item.trim()).filter(Boolean);
}

export function HorschLeadsView({ data, me, onChanged }: { data: LeadModuleData; me: CurrentAccess; onChanged: (message: string) => Promise<void> }) {
  const [term, setTerm] = useState("");
  const [editing, setEditing] = useState<Lead | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [priceCatalog, setPriceCatalog] = useState<PriceCatalogItem[]>([]);
  const [machineModels, setMachineModels] = useState<MachineModel[]>([]);
  useEffect(() => {
    let cancelled = false;
    void fetch("/api/price-list?catalog=1", { cache: "no-store" }).then(async (response) => {
      if (!response.ok) return;
      const payload = await response.json() as { catalog?: PriceCatalogItem[] };
      if (!cancelled) setPriceCatalog(payload.catalog ?? []);
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, []);
  useEffect(() => {
    let cancelled = false;
    void fetch("/api/master-data", { cache: "no-store" }).then(async (response) => {
      if (!response.ok) return;
      const payload = await response.json() as { models?: MachineModel[] };
      if (!cancelled) setMachineModels(payload.models ?? []);
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, []);
  const filtered = useMemo(() => {
    const normalized = term.trim().toLocaleLowerCase("pt-BR");
    return data.leads.filter((lead) => !normalized || [lead.customerName, lead.phone, lead.email, lead.machineDomain, lead.partNumbers, lead.partsOfInterest, lead.sellerName].some((value) => value.toLocaleLowerCase("pt-BR").includes(normalized)));
  }, [data.leads, term]);

  return <div className="content-frame leads-shell">
    <header className="page-heading leads-heading">
      <div><span className="eyebrow">Funil comercial</span><h1>Horsch Leads</h1><p>{data.metricsOnly ? "Visão consolidada da rede, sem dados individuais de clientes." : "Registre oportunidades de peças e acompanhe cada avanço."}</p></div>
      {data.canEdit && <button className="primary-button" type="button" onClick={() => { setEditing(null); setShowForm(true); }}>+ Novo lead</button>}
    </header>

    <section className="metric-grid leads-metrics">
      <LeadMetric label="Leads no funil" value={String(data.metrics.total)} meta={`${data.metrics.open} em andamento`} tone="dark" />
      <LeadMetric label="Pipeline aberto" value={money(data.metrics.pipelineCents)} meta="Valor negociado em aberto" tone="red" />
      <LeadMetric label="Fechados" value={String(data.metrics.won)} meta={money(data.metrics.wonCents)} tone="green" />
      <LeadMetric label="Conversão" value={`${data.metrics.conversionRate}%`} meta={`${data.metrics.won} ganhos · ${data.metrics.lost} perdidos`} tone="amber" />
    </section>

    <section className="panel leads-funnel-panel"><header className="panel-header"><div><h2>Funil de vendas</h2><p>Distribuição por etapa e valor negociado.</p></div></header><div className="lead-funnel">{STAGE_ORDER.map((stage) => { const item = data.metrics.byStage.find((entry) => entry.label === STAGE_LABELS[stage]); const count = item?.count ?? 0; const width = data.metrics.total ? Math.max(4, Math.round((count / data.metrics.total) * 100)) : 4; return <div className="lead-funnel-row" key={stage}><div className="lead-funnel-label"><strong>{STAGE_LABELS[stage]}</strong><span>{count} lead{count === 1 ? "" : "s"}</span></div><div className="lead-funnel-track"><span className={`lead-funnel-fill ${stage}`} style={{ width: `${width}%` }} /></div><strong className="lead-funnel-value">{money(item?.valueCents ?? 0)}</strong></div>; })}</div></section>

    <LeadInsights data={data} />

    {data.metricsOnly ? <MetricsOnly data={data} /> : <>
      <section className="panel leads-list-panel"><header className="panel-header"><div><h2>Leads da concessionária</h2><p>Dados preenchidos pelos cargos da concessionária.</p></div><label className="leads-search"><span>Buscar</span><input value={term} onChange={(event) => setTerm(event.target.value)} placeholder="Nome, máquina, peça ou vendedor" /></label></header>{filtered.length ? <div className="lead-list">{filtered.map((lead) => <LeadCard key={lead.id} lead={lead} onEdit={() => { setEditing(lead); setShowForm(true); }} />)}</div> : <div className="leads-empty"><strong>Nenhum lead registrado</strong><span>{term ? "Ajuste a busca ou cadastre uma nova oportunidade." : "Cadastre o primeiro lead para iniciar o funil."}</span></div>}</section>
    </>}
    {showForm && <LeadModalEnhanced lead={editing} me={me} sellers={data.sellers} priceCatalog={priceCatalog} machineModels={machineModels.map((model) => model.name)} onClose={() => { setShowForm(false); setEditing(null); }} onSaved={async (message) => { setShowForm(false); setEditing(null); await onChanged(message); }} />}
  </div>;
}

function LeadMetric({ label, value, meta, tone }: { label: string; value: string; meta: string; tone: string }) {
  return <article className="metric-card lead-metric-card"><span>{label}</span><strong>{value}</strong><small>{meta}</small><i className={`lead-metric-dot ${tone}`} /></article>;
}

function LeadCard({ lead, onEdit }: { lead: Lead; onEdit: () => void }) {
  return <article className="lead-card"><header><div><span className="eyebrow">{lead.id}</span><h3>{lead.customerName}</h3><p>{lead.dealership} · Atualizado em {date(lead.updatedAt)}</p></div><span className={stageClass(lead.stage)}>{STAGE_LABELS[lead.stage]}</span></header><div className="lead-card-grid"><div><span>Contato</span><strong>{lead.phone || lead.email || "—"}</strong><small>{lead.email && lead.phone ? lead.email : ""}</small></div><div><span>Máquinas</span><strong>{lead.machineDomain || "—"}</strong></div><div><span>PNs</span><strong>{lead.partNumbers || "—"}</strong><small>{lead.partsOfInterest || ""}</small></div><div><span>Temperatura</span><strong className={`lead-temperature ${lead.temperature}`}>{TEMPERATURE_LABELS[lead.temperature]}</strong></div><div><span>Valor negociado</span><strong>{money(lead.negotiatedValueCents)}</strong></div><div><span>Vendedor</span><strong>{lead.sellerName || "—"}</strong><small>{lead.stage === "won" ? `NF ${lead.invoiceNumber || "não informada"} · ${money(lead.invoiceValueCents)}` : "Responsável comercial"}</small></div></div><footer><span>NF conferida com o valor negociado no fechamento.</span><button className="outline-button compact" type="button" onClick={onEdit}>Editar</button></footer></article>;
}

function LeadInsights({ data }: { data: LeadModuleData }) {
  const details = data.customerMachines;
  return <section className="lead-insights-grid"><article className="panel lead-insight-panel lead-parts-insight"><header className="panel-header"><div><span className="eyebrow">Rastreamento comercial</span><h2>PNs por etapa</h2><p>Identifique quais peças estão avançando no funil.</p></div></header>{data.byPartNumberStage.length ? <div className="lead-insight-table-wrap"><table className="lead-insight-table"><thead><tr><th>PN</th><th>Etapa</th><th>Clientes</th><th>Leads</th><th>Valor</th></tr></thead><tbody>{data.byPartNumberStage.map((item) => <tr key={`${item.stage}-${item.partNumber}`}><td><strong>{item.partNumber}</strong></td><td><span className={stageClass(item.stage)}>{item.stageLabel}</span></td><td title={item.customers.join(", ")}>{item.customers.slice(0, 2).join(", ")}{item.customers.length > 2 ? ` +${item.customers.length - 2}` : ""}</td><td>{item.leadCount}</td><td>{money(item.valueCents)}</td></tr>)}</tbody></table></div> : <div className="leads-empty"><strong>Nenhum PN estruturado</strong><span>Cadastre os PNs de interesse no lead para acompanhar cada etapa.</span></div>}</article><article className="panel lead-insight-panel lead-customer-insight"><header className="panel-header"><div><span className="eyebrow">Carteira de clientes</span><h2>Clientes e máquinas</h2><p>Relacionamento entre cliente, domínio de máquinas e oportunidade atual.</p></div></header>{details.length ? <div className="lead-insight-table-wrap"><table className="lead-insight-table"><thead><tr><th>Cliente / concessionária</th><th>Máquinas</th><th>PNs</th><th>Etapa</th><th>Vendedor</th></tr></thead><tbody>{details.map((item) => <tr key={`${item.dealership}-${item.customerName}-${item.machineDomain}`}><td><strong>{item.customerName}</strong><small>{item.dealership}</small></td><td>{item.machineDomain || "—"}</td><td>{item.partNumbers || "—"}</td><td><span className={stageClass(item.stage)}>{STAGE_LABELS[item.stage]}</span></td><td>{item.sellerName || "—"}</td></tr>)}</tbody></table></div> : <div className="leads-empty"><strong>Nenhum cliente registrado</strong><span>Os clientes e as máquinas aparecerão conforme os leads forem cadastrados.</span></div>}</article><article className="panel lead-insight-panel lead-seller-insight"><header className="panel-header"><div><span className="eyebrow">Atividade comercial</span><h2>Vendedores mais engajados</h2><p>Ranking por volume de leads trabalhados e resultados.</p></div></header>{data.bySeller.length ? <div className="lead-seller-ranking">{data.bySeller.slice(0, 8).map((item, index) => <div className="lead-seller-row" key={item.label}><span className="lead-seller-rank">{String(index + 1).padStart(2, "0")}</span><div><strong>{item.label}</strong><small>{item.open} em andamento · {item.won} fechados · {item.conversionRate}% conversão</small></div><b>{item.total}</b></div>)}</div> : <div className="leads-empty"><strong>Nenhum vendedor com leads</strong><span>O ranking será formado pelos leads cadastrados.</span></div>}</article></section>;
}

function MetricsOnly({ data }: { data: LeadModuleData }) {
  return <div className="lead-report-grid"><section className="panel lead-report-panel"><header className="panel-header"><div><h2>Temperatura dos negócios</h2><p>Prioridade comercial da rede.</p></div></header><div className="lead-report-list">{data.metrics.byTemperature.map((item) => <div key={item.label}><span className={`lead-temperature ${item.label.toLowerCase()}`}>{item.label}</span><strong>{item.count}</strong><small>{money(item.valueCents)}</small></div>)}</div></section><section className="panel lead-report-panel"><header className="panel-header"><div><h2>Por concessionária</h2><p>Volume, fechamentos e pipeline.</p></div></header><div className="lead-report-list">{data.byDealership.length ? data.byDealership.map((item) => <div key={item.label}><span>{item.label}</span><strong>{item.total}</strong><small>{item.won} fechados · {money(item.pipelineCents)} aberto</small></div>) : <div className="leads-empty">Sem dados para o módulo.</div>}</div></section><section className="panel lead-report-panel"><header className="panel-header"><div><h2>Por vendedor</h2><p>Resultado atribuído ao responsável.</p></div></header><div className="lead-report-list">{data.bySeller.length ? data.bySeller.map((item) => <div key={item.label}><span>{item.label}</span><strong>{item.total}</strong><small>{item.won} fechados · {money(item.wonCents)}</small></div>) : <div className="leads-empty">Sem vendedores registrados.</div>}</div></section></div>;
}

function LeadModalEnhanced({ lead, me, sellers, priceCatalog, machineModels, onClose, onSaved }: { lead: Lead | null; me: CurrentAccess; sellers: LeadModuleData["sellers"]; priceCatalog: PriceCatalogItem[]; machineModels: string[]; onClose: () => void; onSaved: (message: string) => Promise<void> }) {
  const sellerOptions = sellers.length ? sellers : [{ email: me.email, name: me.name, dealershipId: null }];
  const machineOptions = machineModels.length ? machineModels : FALLBACK_MACHINE_MODELS;
  const existingMachine = lead?.machineDomain ?? "";
  const [customerName, setCustomerName] = useState(lead?.customerName ?? "");
  const [phone, setPhone] = useState(lead?.phone ?? "");
  const [email, setEmail] = useState(lead?.email ?? "");
  const [machineModel, setMachineModel] = useState(machineOptions.includes(existingMachine) ? existingMachine : "");
  const [manualMachineModel, setManualMachineModel] = useState(machineOptions.includes(existingMachine) ? "" : existingMachine);
  const [useManualMachine, setUseManualMachine] = useState(Boolean(existingMachine && !machineOptions.includes(existingMachine)));
  const [partSearch, setPartSearch] = useState("");
  const [selectedPartNumbers, setSelectedPartNumbers] = useState<string[]>([]);
  const [manualPartNumber, setManualPartNumber] = useState(lead?.partNumbers ?? "");
  const [selectedFamilies, setSelectedFamilies] = useState<string[]>(() => splitValues(lead?.partsOfInterest ?? ""));
  const [manualFamily, setManualFamily] = useState("");
  const [temperature, setTemperature] = useState<LeadTemperature>(lead?.temperature ?? "warm");
  const [stage, setStage] = useState<LeadStage>(lead?.stage ?? "new");
  const [negotiatedValue, setNegotiatedValue] = useState(lead?.negotiatedValueCents ? formatMoneyInput(String(lead.negotiatedValueCents / 100)) : "");
  const [invoiceNumber, setInvoiceNumber] = useState(lead?.invoiceNumber ?? "");
  const [invoiceValue, setInvoiceValue] = useState(lead?.invoiceValueCents ? formatMoneyInput(String(lead.invoiceValueCents / 100)) : "");
  const [sellerName, setSellerName] = useState(lead?.sellerName || me.name);
  const [sellerEmail, setSellerEmail] = useState(lead?.sellerEmail || me.email);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const familyOptions = useMemo(() => Array.from(new Set(priceCatalog.map((item) => item.family.trim()).filter(Boolean))).sort((left, right) => left.localeCompare(right, "pt-BR")), [priceCatalog]);
  const partMatches = useMemo(() => {
    const normalized = partSearch.trim().toLocaleLowerCase("pt-BR");
    if (!normalized) return priceCatalog.slice(0, 10);
    return priceCatalog.filter((item) => [item.partNumber, item.description].some((value) => value.toLocaleLowerCase("pt-BR").includes(normalized))).slice(0, 12);
  }, [partSearch, priceCatalog]);
  function chooseSeller(value: string) { setSellerName(value); const option = sellerOptions.find((item) => item.name === value); if (option) setSellerEmail(option.email); }
  function togglePartNumber(value: string) { setSelectedPartNumbers((current) => current.includes(value) ? current.filter((item) => item !== value) : [...current, value]); }
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setSaving(true); setError("");
    const resolvedMachineModel = useManualMachine ? manualMachineModel.trim() : machineModel;
    const resolvedPartNumbers = [...selectedPartNumbers, ...splitValues(manualPartNumber)].filter((value, index, values) => values.indexOf(value) === index).join(", ");
    const resolvedFamilies = [...selectedFamilies, ...splitValues(manualFamily)].filter((value, index, values) => values.indexOf(value) === index).join(", ");
    const response = await fetch("/api/leads", { method: lead ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...(lead ? { id: lead.id } : {}), customerName, phone, email, machineDomain: resolvedMachineModel, partNumbers: resolvedPartNumbers, partsOfInterest: resolvedFamilies, temperature, stage, negotiatedValueCents: parseMoney(negotiatedValue), invoiceNumber, invoiceValueCents: parseMoney(invoiceValue), sellerName, sellerEmail }) });
    const payload = await response.json() as { error?: string };
    if (!response.ok) { setError(payload.error || "Não foi possível salvar o lead."); setSaving(false); return; }
    await onSaved(lead ? "Lead atualizado com sucesso." : "Lead cadastrado no funil.");
  }
  return <div className="modal-backdrop" role="dialog" aria-modal="true"><form className="lead-modal" onSubmit={(event) => void submit(event)}><header className="modal-header"><div><span className="eyebrow">Horsch Leads</span><h2>{lead ? "Editar lead" : "Novo lead"}</h2><p>Use as listas oficiais para manter modelos, famílias e PNs padronizados.</p></div><button type="button" className="icon-button" onClick={onClose} aria-label="Fechar">×</button></header><div className="form-scroll"><div className="lead-form-grid"><label className="field"><span>Nome do cliente</span><input value={customerName} onChange={(event) => setCustomerName(event.target.value)} required autoFocus /></label><label className="field"><span>Telefone</span><input value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="(00) 00000-0000" /></label><label className="field"><span>E-mail</span><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="cliente@email.com" /></label><label className="field"><span>Vendedor</span><input list="lead-sellers" value={sellerName} onChange={(event) => chooseSeller(event.target.value)} required /><datalist id="lead-sellers">{sellerOptions.map((item) => <option key={item.email} value={item.name}>{item.email}</option>)}</datalist></label><div className="field"><span>Modelo da máquina</span>{useManualMachine ? <><input value={manualMachineModel} onChange={(event) => setManualMachineModel(event.target.value)} placeholder="Digite o modelo não encontrado" autoFocus /><button type="button" className="text-button lead-picker-reset" onClick={() => { setUseManualMachine(false); setManualMachineModel(""); }}>Voltar para a lista</button></> : <select value={machineModel} onChange={(event) => { if (event.target.value === "__manual") { setUseManualMachine(true); setMachineModel(""); } else setMachineModel(event.target.value); }}><option value="">Selecione o modelo</option>{machineOptions.map((model) => <option key={model} value={model}>{model}</option>)}<option value="__manual">Não encontrei o modelo — digitar</option></select>}</div><div className="field lead-pn-field"><span>PNs de interesse da lista de preços</span><input value={partSearch} onChange={(event) => setPartSearch(event.target.value)} placeholder="Pesquisar PN ou descrição" />{partMatches.length ? <div className="lead-pn-options">{partMatches.map((item) => <button type="button" key={item.partNumber} className={selectedPartNumbers.includes(item.partNumber) ? "active" : ""} onClick={() => togglePartNumber(item.partNumber)}><strong>{item.partNumber}</strong><small>{item.description || "Descrição não informada"}</small></button>)}</div> : <small className="field-hint">Nenhum PN da lista foi localizado.</small>}{selectedPartNumbers.length > 0 && <div className="lead-selected-values">{selectedPartNumbers.map((item) => <span key={item}>{item}</span>)}</div>}{(manualPartNumber || (partSearch.trim() && !partMatches.length)) && <label className="field lead-manual-field"><span>PN não encontrado na lista — digitar manualmente</span><input value={manualPartNumber} onChange={(event) => setManualPartNumber(event.target.value)} placeholder="PN manual ou vários separados por vírgula" /></label>}</div><label className="field"><span>Temperatura</span><select value={temperature} onChange={(event) => setTemperature(event.target.value as LeadTemperature)}>{Object.entries(TEMPERATURE_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label><label className="field"><span>Etapa do funil</span><select value={stage} onChange={(event) => setStage(event.target.value as LeadStage)}>{STAGE_ORDER.map((value) => <option value={value} key={value}>{STAGE_LABELS[value]}</option>)}</select></label><label className="field"><span>Valor negociado</span><input inputMode="decimal" value={negotiatedValue} onChange={(event) => setNegotiatedValue(event.target.value)} onBlur={(event) => setNegotiatedValue(formatMoneyInput(event.target.value))} placeholder="R$ 0,00" /></label>{stage === "won" && <label className="field"><span>Valor da NF</span><input inputMode="decimal" value={invoiceValue} onChange={(event) => setInvoiceValue(event.target.value)} onBlur={(event) => setInvoiceValue(formatMoneyInput(event.target.value))} placeholder="R$ 0,00" required /><small className="field-hint">Deve ser igual ao valor negociado.</small></label>}<div className="field lead-parts-field"><span>Família de peças</span>{familyOptions.length ? <select multiple size={Math.min(7, Math.max(4, familyOptions.length))} value={selectedFamilies.filter((item) => familyOptions.includes(item))} onChange={(event) => setSelectedFamilies(Array.from(event.target.selectedOptions, (option) => option.value))}>{familyOptions.map((family) => <option value={family} key={family}>{family}</option>)}</select> : <small className="field-hint">Carregando as famílias disponíveis na lista de preços...</small>}<small className="field-hint">Use Ctrl ou Command para selecionar mais de uma família.</small><input value={manualFamily} onChange={(event) => setManualFamily(event.target.value)} placeholder="Família não encontrada — digitar manualmente" /></div>{stage === "won" && <label className="field"><span>NF do fechamento</span><input value={invoiceNumber} onChange={(event) => setInvoiceNumber(event.target.value)} placeholder="Número da nota fiscal" required /></label>}</div>{error && <p className="form-error">{error}</p>}</div><footer className="modal-actions"><button type="button" className="ghost-button" onClick={onClose}>Cancelar</button><button type="submit" className="primary-button" disabled={saving}>{saving ? "Salvando..." : lead ? "Salvar alterações" : "Cadastrar lead"}</button></footer></form></div>;
}

export function LeadModal({ lead, me, sellers, onClose, onSaved }: { lead: Lead | null; me: CurrentAccess; sellers: LeadModuleData["sellers"]; onClose: () => void; onSaved: (message: string) => Promise<void> }) {
  const sellerOptions = sellers.length ? sellers : [{ email: me.email, name: me.name, dealershipId: null }];
  const [customerName, setCustomerName] = useState(lead?.customerName ?? "");
  const [phone, setPhone] = useState(lead?.phone ?? "");
  const [email, setEmail] = useState(lead?.email ?? "");
  const [machineDomain, setMachineDomain] = useState(lead?.machineDomain ?? "");
  const [partNumbers, setPartNumbers] = useState(lead?.partNumbers ?? "");
 const [partsOfInterest, setPartsOfInterest] = useState(lead?.partsOfInterest ?? "");
  const [temperature, setTemperature] = useState<LeadTemperature>(lead?.temperature ?? "warm");
  const [stage, setStage] = useState<LeadStage>(lead?.stage ?? "new");
  const [negotiatedValue, setNegotiatedValue] = useState(lead?.negotiatedValueCents ? formatMoneyInput(String(lead.negotiatedValueCents / 100)) : "");
  const [invoiceNumber, setInvoiceNumber] = useState(lead?.invoiceNumber ?? "");
  const [invoiceValue, setInvoiceValue] = useState(lead?.invoiceValueCents ? formatMoneyInput(String(lead.invoiceValueCents / 100)) : "");
  const [sellerName, setSellerName] = useState(lead?.sellerName || me.name);
  const [sellerEmail, setSellerEmail] = useState(lead?.sellerEmail || me.email);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function chooseSeller(value: string) { setSellerName(value); const option = sellerOptions.find((item) => item.name === value); if (option) setSellerEmail(option.email); }
  async function submit(event: React.FormEvent) { event.preventDefault(); setSaving(true); setError(""); const response = await fetch("/api/leads", { method: lead ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...(lead ? { id: lead.id } : {}), customerName, phone, email, machineDomain, partNumbers, partsOfInterest, temperature, stage, negotiatedValueCents: parseMoney(negotiatedValue), invoiceNumber, invoiceValueCents: parseMoney(invoiceValue), sellerName, sellerEmail }) }); const payload = await response.json() as { error?: string }; if (!response.ok) { setError(payload.error || "Não foi possível salvar o lead."); setSaving(false); return; } await onSaved(lead ? "Lead atualizado com sucesso." : "Lead cadastrado no funil."); }

  return <div className="modal-backdrop" role="dialog" aria-modal="true"><form className="lead-modal" onSubmit={(event) => void submit(event)}><header className="modal-header"><div><span className="eyebrow">Horsch Leads</span><h2>{lead ? "Editar lead" : "Novo lead"}</h2><p>Preencha os dados essenciais da oportunidade.</p></div><button type="button" className="icon-button" onClick={onClose} aria-label="Fechar">×</button></header><div className="form-scroll"><div className="lead-form-grid"><label className="field"><span>Nome do cliente</span><input value={customerName} onChange={(event) => setCustomerName(event.target.value)} required autoFocus /></label><label className="field"><span>Telefone</span><input value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="(00) 00000-0000" /></label><label className="field"><span>E-mail</span><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="cliente@email.com" /></label><label className="field"><span>Vendedor</span><input list="lead-sellers" value={sellerName} onChange={(event) => chooseSeller(event.target.value)} required /><datalist id="lead-sellers">{sellerOptions.map((item) => <option key={item.email} value={item.name}>{item.email}</option>)}</datalist></label><label className="field"><span>Máquinas no domínio</span><input value={machineDomain} onChange={(event) => setMachineDomain(event.target.value)} placeholder="Ex.: 4600, 12.000 ha, Sprinter" /></label><label className="field lead-pn-field"><span>PNs de interesse</span><textarea value={partNumbers} onChange={(event) => setPartNumbers(event.target.value)} placeholder="Ex.: 34061200, 34061201" rows={2} /></label><label className="field"><span>Temperatura</span><select value={temperature} onChange={(event) => setTemperature(event.target.value as LeadTemperature)}>{Object.entries(TEMPERATURE_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label><label className="field"><span>Etapa do funil</span><select value={stage} onChange={(event) => setStage(event.target.value as LeadStage)}>{STAGE_ORDER.map((value) => <option value={value} key={value}>{STAGE_LABELS[value]}</option>)}</select></label><label className="field"><span>Valor negociado</span><input inputMode="decimal" value={negotiatedValue} onChange={(event) => setNegotiatedValue(event.target.value)} onBlur={(event) => setNegotiatedValue(formatMoneyInput(event.target.value))} placeholder="R$ 0,00" /></label>{stage === "won" && <label className="field"><span>Valor da NF</span><input inputMode="decimal" value={invoiceValue} onChange={(event) => setInvoiceValue(event.target.value)} onBlur={(event) => setInvoiceValue(formatMoneyInput(event.target.value))} placeholder="R$ 0,00" required /><small className="field-hint">Deve ser igual ao valor negociado.</small></label>}<label className="field lead-parts-field"><span>Peças de interesse</span><textarea value={partsOfInterest} onChange={(event) => setPartsOfInterest(event.target.value)} placeholder="Famílias ou descrição das peças procuradas" rows={3} /></label>{stage === "won" && <label className="field"><span>NF do fechamento</span><input value={invoiceNumber} onChange={(event) => setInvoiceNumber(event.target.value)} placeholder="Número da nota fiscal" required /></label>}</div>{error && <p className="form-error">{error}</p>}</div><footer className="modal-actions"><button type="button" className="ghost-button" onClick={onClose}>Cancelar</button><button type="submit" className="primary-button" disabled={saving}>{saving ? "Salvando..." : lead ? "Salvar alterações" : "Cadastrar lead"}</button></footer></form></div>;
}
