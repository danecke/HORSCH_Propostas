"use client";

import type { FormEvent } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";

type PriceListRole = "general_admin" | "global_management" | "factory_manager" | "dealer_manager" | "concession";
type PriceListAccess = {
  role: PriceListRole;
  name: string;
  dealershipId: number | null;
  permissions: { editPriceList: boolean };
};
type PriceRow = {
  id: number;
  partNumber: string;
  description: string;
  family: string;
  unit: string;
  ncm: string;
  vt: string;
  origin: string;
  netPriceCents: number;
  finalPriceCents: number | null;
  n2PriceCents: number | null;
  n3PriceCents: number | null;
  state: string;
};
type PriceListResponse = {
  import: { fileName: string; rowCount: number; states: string[]; importedByName: string; importedAt: string } | null;
  rows: PriceRow[];
  total: number;
  page: number;
  pageSize: number;
  states: string[];
  selectedState: string;
  canManage: boolean;
  error?: string;
};

function money(cents: number | null | undefined) {
  if (cents === null || cents === undefined) return "—";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2 }).format(cents / 100);
}

function inputMoney(cents: number | null | undefined) {
  if (cents === null || cents === undefined) return "";
  return (cents / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function parseMoney(value: string) {
  const normalized = value.replace(/[^\d,.-]/g, "").replace(/\./g, "").replace(",", ".");
  const number = Number(normalized);
  return Number.isFinite(number) ? Math.max(0, Math.round(number * 100)) : 0;
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

function stateName(state: string) {
  return state === "PY" ? "Paraguai" : state === "RO" ? "Rondônia" : state;
}

export function PriceListView({ me }: { me: PriceListAccess }) {
  const canManage = me.permissions.editPriceList && ["general_admin", "global_management"].includes(me.role);
  const [tab, setTab] = useState<"view" | "admin">(canManage ? "view" : "view");
  const [state, setState] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<PriceListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [editing, setEditing] = useState<PriceRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    const params = new URLSearchParams({ page: String(page), pageSize: "50" });
    if (state) params.set("state", state);
    if (search.trim()) params.set("q", search.trim());
    try {
      const response = await fetch(`/api/price-list?${params.toString()}`, { cache: "no-store" });
      const payload = (await response.json()) as PriceListResponse;
      if (!response.ok) throw new Error(payload.error || "Não foi possível carregar a lista de preços.");
      setData(payload);
      if (!state && payload.selectedState) setState(payload.selectedState);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Não foi possível carregar a lista de preços.");
    } finally {
      setLoading(false);
    }
  }, [page, search, state]);

  useEffect(() => { const timer = window.setTimeout(() => void load(), 160); return () => window.clearTimeout(timer); }, [load]);
  useEffect(() => { if (!notice) return; const timer = window.setTimeout(() => setNotice(""), 4500); return () => window.clearTimeout(timer); }, [notice]);

  const totalPages = Math.max(1, Math.ceil((data?.total ?? 0) / (data?.pageSize ?? 50)));
  const selectedState = data?.selectedState || state;
  const stateLabel = selectedState ? `${stateName(selectedState)} (${selectedState})` : "Estado não vinculado";
  const summary = useMemo(() => {
    const rows = data?.rows ?? [];
    return { visible: rows.length, withFinal: rows.filter((row) => row.finalPriceCents !== null).length, withN2: rows.filter((row) => row.n2PriceCents !== null).length };
  }, [data]);

  async function submitUpload(event: FormEvent) {
    event.preventDefault();
    if (!file) return;
    setUploading(true);
    setError("");
    const form = new FormData();
    form.set("file", file);
    try {
      const response = await fetch("/api/price-list", { method: "POST", body: form });
      const payload = (await response.json()) as { error?: string; import?: { rowCount: number } };
      if (!response.ok) throw new Error(payload.error || "Não foi possível importar a planilha.");
      setFile(null);
      setPage(1);
      setState("");
      setNotice(`Lista importada com ${payload.import?.rowCount.toLocaleString("pt-BR") ?? ""} itens.`);
      await load();
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Não foi possível importar a planilha.");
    } finally {
      setUploading(false);
    }
  }

  async function saveRow(row: PriceRow, draft: { net: string; final: string; n2: string; n3: string }) {
    const response = await fetch("/api/price-list", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: row.id, state: row.state, netPriceCents: parseMoney(draft.net), finalPriceCents: parseMoney(draft.final), n2PriceCents: parseMoney(draft.n2), n3PriceCents: parseMoney(draft.n3) }) });
    const payload = (await response.json()) as { error?: string };
    if (!response.ok) throw new Error(payload.error || "Não foi possível salvar o ajuste.");
    setEditing(null);
    setNotice(`PN ${row.partNumber} atualizado para ${row.state}.`);
    await load();
  }

  return <div className="content-frame price-list-shell">
    <header className="page-heading price-list-heading">
      <div><span className="eyebrow">Catálogo comercial</span><h1>Lista de preços</h1><p>{canManage ? "Consulte a rede por UF e mantenha a versão vigente sob controle central." : `Consulta autorizada para ${stateLabel}.`}</p></div>
      <div className="price-list-heading-mark"><span>H</span><small>Preço vigente</small></div>
    </header>
    {canManage && <div className="price-list-tabs" role="tablist" aria-label="Lista de preços"><button type="button" className={tab === "view" ? "active" : ""} onClick={() => setTab("view")}>Consultar lista</button><button type="button" className={tab === "admin" ? "active" : ""} onClick={() => setTab("admin")}>Administração</button></div>}
    {notice && <div className="price-list-notice" role="status">{notice}</div>}
    {tab === "admin" && canManage ? <AdminPanel file={file} setFile={setFile} uploading={uploading} onSubmit={submitUpload} currentImport={data?.import ?? null} /> : <>
      <section className="price-list-summary-grid">
        <div className="price-list-summary-card"><span>Versão vigente</span><strong>{data?.import ? formatDate(data.import.importedAt) : "Aguardando importação"}</strong><small>{data?.import?.fileName || "Nenhum arquivo importado"}</small></div>
        <div className="price-list-summary-card"><span>Estado de consulta</span><strong>{stateLabel}</strong><small>{data?.states.length ? `${data.states.length} UF${data.states.length === 1 ? "" : "s"} autorizada${data.states.length === 1 ? "" : "s"}` : "Aguardando vínculo"}</small></div>
        <div className="price-list-summary-card"><span>Itens na versão</span><strong>{(data?.import?.rowCount ?? 0).toLocaleString("pt-BR")}</strong><small>{summary.visible ? `${summary.visible} exibidos nesta página` : "Sem itens para exibir"}</small></div>
      </section>
      <section className="panel price-list-panel">
        <header className="panel-header price-list-toolbar"><div><span className="eyebrow">{stateLabel}</span><h2>Itens e valores autorizados</h2><p>Os preços são exibidos de acordo com a UF de atuação cadastrada.</p></div><div className="price-list-filters">{(data?.states.length ?? 0) > 1 && <label><span>UF</span><select value={selectedState} onChange={(event) => { setState(event.target.value); setPage(1); }}>{data?.states.map((item) => <option key={item} value={item}>{stateName(item)} ({item})</option>)}</select></label>}<label className="price-list-search"><span>Buscar PN ou descrição</span><input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Ex.: 60027753" /></label></div></header>
        {error && <div className="price-list-error">{error}</div>}
        {loading ? <div className="empty-mini">Carregando preços vigentes...</div> : !data?.import ? <EmptyPriceState text={canManage ? "Importe o primeiro arquivo na aba Administração." : "A Fábrica ainda não publicou uma lista de preços vigente."} /> : !data.rows.length ? <EmptyPriceState text="Nenhum item corresponde ao filtro informado." /> : <div className="price-list-table-wrap"><table className="price-list-table"><thead><tr><th>PN</th><th>Descrição</th><th>Família</th><th>Un.</th><th>VT</th><th>Netprice</th><th>Cliente final</th><th>N2</th><th>N3</th>{canManage && <th aria-label="Ações" />}</tr></thead><tbody>{data.rows.map((row) => <tr key={row.id}><td><strong>{row.partNumber}</strong><small>{row.ncm || "NCM não informado"}</small></td><td>{row.description || "—"}</td><td>{row.family || "—"}</td><td>{row.unit || "—"}</td><td>{row.vt || "—"}</td><td className="price-cell">{money(row.netPriceCents)}</td><td className="price-cell">{money(row.finalPriceCents)}</td><td className="price-cell">{money(row.n2PriceCents)}</td><td className="price-cell">{money(row.n3PriceCents)}</td>{canManage && <td><button type="button" className="table-action-button" onClick={() => setEditing(row)}>Ajustar</button></td>}</tr>)}</tbody></table></div>}
        {data?.total ? <footer className="price-list-pagination"><span>{((page - 1) * (data.pageSize ?? 50) + 1).toLocaleString("pt-BR")}–{Math.min(page * (data.pageSize ?? 50), data.total).toLocaleString("pt-BR")} de {data.total.toLocaleString("pt-BR")} itens</span><div><button type="button" className="outline-button compact" disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>Anterior</button><strong>Página {page} de {totalPages}</strong><button type="button" className="outline-button compact" disabled={page >= totalPages} onClick={() => setPage((current) => Math.min(totalPages, current + 1))}>Próxima</button></div></footer> : null}
      </section>
    </>}
    {editing && <PriceEditor row={editing} onClose={() => setEditing(null)} onSave={saveRow} />}
  </div>;
}

function AdminPanel({ file, setFile, uploading, onSubmit, currentImport }: { file: File | null; setFile: (file: File | null) => void; uploading: boolean; onSubmit: (event: FormEvent) => void; currentImport: PriceListResponse["import"] }) {
  return <section className="price-list-admin-grid"><article className="panel price-list-upload-card"><div className="admin-card-icon">↑</div><span className="eyebrow">Atualização central</span><h2>Importar nova lista</h2><p>Substitua a versão vigente enviando o Excel completo. O sistema separa automaticamente os preços por UF e mantém o arquivo original para rastreabilidade.</p><form onSubmit={onSubmit}><label className="file-drop"><input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(event) => setFile(event.target.files?.[0] ?? null)} /><strong>{file ? file.name : "Selecionar arquivo .xlsx"}</strong><small>{file ? `${(file.size / (1024 * 1024)).toFixed(1).replace(".", ",")} MB pronto para importar` : "Até 35 MB · uma planilha por versão"}</small></label><button type="submit" className="primary-button" disabled={!file || uploading}>{uploading ? "Processando planilha..." : "Publicar nova versão"}</button></form></article><article className="panel price-list-admin-info"><span className="eyebrow">Versão ativa</span><h2>{currentImport?.fileName || "Nenhuma lista publicada"}</h2>{currentImport ? <><div className="admin-info-row"><span>Itens normalizados</span><strong>{currentImport.rowCount.toLocaleString("pt-BR")}</strong></div><div className="admin-info-row"><span>UFs identificadas</span><strong>{currentImport.states.join(" · ")}</strong></div><div className="admin-info-row"><span>Importado por</span><strong>{currentImport.importedByName || "—"}</strong></div><div className="admin-info-row"><span>Data</span><strong>{formatDate(currentImport.importedAt)}</strong></div></> : <p>A lista aparecerá aqui depois da primeira importação.</p>}<div className="admin-permission-note"><strong>Acesso restrito</strong><span>Somente ADM Geral e Gestão Global podem importar ou ajustar preços.</span></div></article></section>;
}

function EmptyPriceState({ text }: { text: string }) {
  return <div className="price-list-empty"><span>₿</span><strong>Lista de preços indisponível</strong><p>{text}</p></div>;
}

function PriceEditor({ row, onClose, onSave }: { row: PriceRow; onClose: () => void; onSave: (row: PriceRow, draft: { net: string; final: string; n2: string; n3: string }) => Promise<void> }) {
  const [draft, setDraft] = useState({ net: inputMoney(row.netPriceCents), final: inputMoney(row.finalPriceCents), n2: inputMoney(row.n2PriceCents), n3: inputMoney(row.n3PriceCents) });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try { await onSave(row, draft); } catch (saveError) { setError(saveError instanceof Error ? saveError.message : "Não foi possível salvar."); } finally { setSaving(false); }
  }
  return <div className="modal-backdrop" role="dialog" aria-modal="true"><form className="price-editor-modal" onSubmit={(event) => void submit(event)}><header className="modal-header"><div><span className="eyebrow">Ajuste administrativo · {row.state}</span><h2>{row.partNumber}</h2><p>{row.description}</p></div><button type="button" className="icon-button" onClick={onClose} aria-label="Fechar">×</button></header><div className="form-scroll"><div className="price-editor-grid"><label className="field"><span>Netprice unitário</span><input inputMode="decimal" value={draft.net} onChange={(event) => setDraft({ ...draft, net: event.target.value })} /></label><label className="field"><span>Cliente final</span><input inputMode="decimal" value={draft.final} onChange={(event) => setDraft({ ...draft, final: event.target.value })} /></label><label className="field"><span>Cliente N2</span><input inputMode="decimal" value={draft.n2} onChange={(event) => setDraft({ ...draft, n2: event.target.value })} /></label><label className="field"><span>Cliente N3</span><input inputMode="decimal" value={draft.n3} onChange={(event) => setDraft({ ...draft, n3: event.target.value })} /></label></div>{error && <p className="form-error">{error}</p>}</div><footer className="modal-actions"><button type="button" className="ghost-button" onClick={onClose}>Cancelar</button><button type="submit" className="primary-button" disabled={saving}>{saving ? "Salvando..." : "Salvar ajuste"}</button></footer></form></div>;
}
