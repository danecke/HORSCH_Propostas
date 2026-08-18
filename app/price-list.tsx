"use client";

import type { FormEvent } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";

type PriceListRole = "general_admin" | "global_management" | "factory_manager" | "dealer_manager" | "concession";
export type PriceListAccess = {
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

type PriceListNotification = {
  id: number;
  title: string;
  message: string;
  effectiveAt: string;
  affectedPns: string;
  audience: string;
  createdByName: string;
  createdAt: string;
  readAt: string | null;
};

type NotificationAudienceUser = {
  email: string;
  name: string;
  roleLabel: string;
  dealershipName: string;
};

type NotificationResponse = {
  notifications: PriceListNotification[];
  unreadCount: number;
  audience: NotificationAudienceUser[];
  error?: string;
};

type PriceHistoryEntry = {
  id: number;
  actorName: string;
  actorEmail: string;
  action: string;
  entity: string;
  details: string;
  beforeJson: string;
  afterJson: string;
  createdAt: string;
};

const MAX_UPLOAD_SIZE = 120 * 1024 * 1024;

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

function derivedInputMoney(value: string, factor: number) {
  return value.trim() ? inputMoney(Math.round(parseMoney(value) * factor)) : "—";
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

function localDateValue() {
  const date = new Date();
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
}

function formatEffectiveDate(value: string) {
  const date = new Date(value + "T00:00:00");
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("pt-BR");
}

async function readUploadPayload<T extends { error?: string }>(response: Response): Promise<T> {
  const raw = await response.text();
  if (!raw.trim()) return {} as T;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return {
      error: response.status === 413 || /payload too large/i.test(raw)
        ? "O servidor rejeitou uma parte do arquivo. Tente novamente; o envio será feito em partes menores."
        : `Não foi possível concluir a importação (HTTP ${response.status}).`,
    } as T;
  }
}

function stateName(state: string) {
  return state === "PY" ? "Paraguai" : state === "RO" ? "Rondônia" : state;
}

export function PriceListView({ me, mode = "consult" }: { me: PriceListAccess; mode?: "consult" | "admin" }) {
  const adminMode = mode === "admin";
  const canManage = adminMode && me.permissions.editPriceList && ["general_admin", "global_management"].includes(me.role);
  const [tab, setTab] = useState<"view" | "admin">(canManage ? "view" : "view");
  const [adminSection, setAdminSection] = useState<"maintenance" | "history">("maintenance");
  const [state, setState] = useState("");
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<PriceListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [editing, setEditing] = useState<PriceRow | null>(null);
  const [notificationRefreshKey, setNotificationRefreshKey] = useState(0);
  const [publishEffectiveAt, setPublishEffectiveAt] = useState(localDateValue());

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
    setUploadProgress(0);
    setError("");
    try {
      if (file.size > MAX_UPLOAD_SIZE) throw new Error("A planilha deve ter no máximo 120 MB.");
      const initResponse = await fetch("/api/price-list?upload=init", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fileName: file.name, fileSize: file.size, contentType: file.type }) });
      const initPayload = await readUploadPayload<{ error?: string; uploadId?: string; chunkSize?: number; totalChunks?: number }>(initResponse);
      if (!initResponse.ok || !initPayload.uploadId || !initPayload.chunkSize || !initPayload.totalChunks) throw new Error(initPayload.error || "Não foi possível iniciar a importação.");
      for (let part = 0; part < initPayload.totalChunks; part += 1) {
        const start = part * initPayload.chunkSize;
        const chunk = file.slice(start, Math.min(start + initPayload.chunkSize, file.size));
        const chunkResponse = await fetch(`/api/price-list?upload=chunk&uploadId=${encodeURIComponent(initPayload.uploadId)}&part=${part}&totalChunks=${initPayload.totalChunks}`, { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: chunk });
        const chunkPayload = await readUploadPayload<{ error?: string }>(chunkResponse);
        if (!chunkResponse.ok) throw new Error(chunkPayload.error || `Não foi possível enviar a parte ${part + 1} da planilha.`);
        setUploadProgress(Math.round(((part + 1) / initPayload.totalChunks) * 90));
      }
      const response = await fetch("/api/price-list?upload=complete", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ uploadId: initPayload.uploadId, fileName: file.name, fileSize: file.size, totalChunks: initPayload.totalChunks, effectiveAt: publishEffectiveAt }) });
      const payload = await readUploadPayload<{ error?: string; import?: { rowCount: number }; notification?: { recipientCount: number } | null }>(response);
      if (!response.ok) throw new Error(payload.error || "Não foi possível importar a planilha.");
      setFile(null);
      setUploadProgress(100);
      setPage(1);
      setState("");
      setNotificationRefreshKey((current) => current + 1);
      setNotice(`Lista importada com ${payload.import?.rowCount.toLocaleString("pt-BR") ?? ""} itens${payload.notification ? ` · aviso enviado para ${payload.notification.recipientCount} usuários` : ""}.`);
      await load();
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Não foi possível importar a planilha.");
    } finally {
      setUploading(false);
    }
  }

  async function saveRow(row: PriceRow, draft: { partNumber: string; description: string; family: string; unit: string; ncm: string; vt: string; origin: string; net: string; final: string; effectiveAt: string; justification: string; applyToAllStates: boolean }) {
    const response = await fetch("/api/price-list", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: row.id, state: row.state, applyToAllStates: draft.applyToAllStates, partNumber: draft.partNumber, description: draft.description, family: draft.family, unit: draft.unit, ncm: draft.ncm, vt: draft.vt, origin: draft.origin, netPriceCents: parseMoney(draft.net), finalPriceCents: parseMoney(draft.final), effectiveAt: draft.effectiveAt, justification: draft.justification }) });
    const payload = (await response.json()) as { error?: string; notification?: { recipientCount: number } | null };
    if (!response.ok) throw new Error(payload.error || "Não foi possível salvar o ajuste.");
    setEditing(null);
    setNotificationRefreshKey((current) => current + 1);
    setNotice(`PN ${row.partNumber} atualizado${draft.applyToAllStates ? " para todos os estados" : ` para ${row.state}`}${payload.notification ? ` · aviso enviado para ${payload.notification.recipientCount} usuários` : ""}.`);
    await load();
  }

  async function deleteRow(row: PriceRow) {
    if (!window.confirm(`Excluir o PN ${row.partNumber} da lista vigente? Essa ação remove o item de todas as UFs.`)) return;
    const justification = window.prompt("Informe a justificativa da exclusão (mínimo de 10 caracteres):", "");
    if (!justification || justification.trim().length < 10) return;
    setError("");
    try {
      const response = await fetch("/api/price-list", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: row.id, effectiveAt: publishEffectiveAt, justification }) });
      const payload = (await response.json()) as { error?: string; notification?: { recipientCount: number } | null };
      if (!response.ok) throw new Error(payload.error || "Não foi possível excluir o item.");
      setNotificationRefreshKey((current) => current + 1);
      setNotice(`PN ${row.partNumber} excluído da lista vigente${payload.notification ? ` · aviso enviado para ${payload.notification.recipientCount} usuários` : ""}.`);
      await load();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Não foi possível excluir o item.");
    }
  }

  function exportList() {
    const params = new URLSearchParams({ state: selectedState, export: "xlsx" });
    if (search.trim()) params.set("q", search.trim());
    window.location.assign(`/api/price-list?${params.toString()}`);
  }

  return <div className="content-frame price-list-shell">
    <header className="page-heading price-list-heading">
      <div><span className="eyebrow">{adminMode ? "Base de dados" : "Catálogo comercial"}</span><h1>{adminMode ? "Base de dados — Lista de preços" : "Catálogo de Preços Sugeridos"}</h1><p>{adminMode ? "Importe, ajuste e publique a fonte oficial que será espelhada na Lista de preços." : <>Tabela ativa: <strong>{data?.import?.fileName || "nenhuma lista publicada"}</strong> · Vigência a partir de {data?.import ? formatDate(data.import.importedAt).split(",")[0] : "aguardando importação"}</>}</p></div>
      <div className="price-list-heading-mark"><span>H</span><small>Preço vigente</small></div>
    </header>
    <PriceListNotificationCenter canManage={canManage} refreshKey={notificationRefreshKey} onNotice={setNotice} />
    {!adminMode && canManage && <div className="price-list-tabs" role="tablist" aria-label="Lista de preços"><button type="button" className={tab === "view" ? "active" : ""} onClick={() => setTab("view")}>Consultar lista</button><button type="button" className={tab === "admin" ? "active" : ""} onClick={() => setTab("admin")}>Administração</button></div>}
    {notice && <div className="price-list-notice" role="status">{notice}</div>}
    {canManage && <div className="price-list-admin-tabs" role="tablist" aria-label="Administração da lista de preços"><button type="button" role="tab" aria-selected={adminSection === "maintenance"} className={adminSection === "maintenance" ? "active" : ""} onClick={() => setAdminSection("maintenance")}>Lista e manutenção</button><button type="button" role="tab" aria-selected={adminSection === "history"} className={adminSection === "history" ? "active" : ""} onClick={() => setAdminSection("history")}>Histórico por PN</button></div>}
    {(!canManage || adminSection === "maintenance") && <>
      {(adminMode || tab === "admin") && canManage && <><section className="panel price-list-publish-settings"><div><span className="eyebrow">Vigência da atualização</span><h2>Defina quando a nova lista passa a valer</h2><p>Esta data será registrada no aviso automático enviado após a publicação do Excel.</p></div><label className="field"><span>Vigência a partir de</span><input type="date" value={publishEffectiveAt} onChange={(event) => setPublishEffectiveAt(event.target.value)} /></label></section><AdminPanel file={file} setFile={setFile} uploading={uploading} uploadProgress={uploadProgress} onSubmit={submitUpload} currentImport={data?.import ?? null} /></>}
      {canManage && <section className="panel price-list-maintenance-note"><div><span className="eyebrow">Ajuste pontual</span><h2>Edite um PN sem importar uma nova planilha</h2><p>Use o lápis na linha desejada para alterar preços e dados cadastrais. A justificativa é obrigatória e cada mudança ficará registrada no histórico.</p></div><strong>Aplicação individual ou multiestado</strong></section>}
      <div className="price-list-state-tabs" role="tablist" aria-label="Estados disponíveis">{(data?.states ?? []).map((item) => <button type="button" role="tab" aria-selected={selectedState === item} key={item} className={selectedState === item ? "active" : ""} onClick={() => { setState(item); setPage(1); }}>{item}</button>)}</div>
      <div className="price-list-search-row"><label className="price-list-search-box"><span aria-hidden="true">⌕</span><input aria-label="Pesquisar por PN ou descrição" value={searchInput} onChange={(event) => setSearchInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { setSearch(searchInput); setPage(1); } }} placeholder="Pesquisar por PN (ex: 60027753) ou Descrição (ex: Tubo)..." /></label><button type="button" className="price-list-search-button" onClick={() => { setSearch(searchInput); setPage(1); }}>Buscar</button><button type="button" className="price-list-export-button" onClick={exportList} disabled={!data?.import || !selectedState}>⇩&nbsp; Exportar XLSX</button></div>
      <section className="panel price-list-panel">
        <header className="panel-header price-list-toolbar"><div><span className="eyebrow">{stateLabel}</span><h2>Itens e valores autorizados</h2><p>{(data?.import?.rowCount ?? 0).toLocaleString("pt-BR")} itens na estrutura vigente.</p></div><div className="price-list-toolbar-meta">{summary.visible ? `${summary.visible} itens exibidos` : "Sem itens para exibir"}</div></header>
        {error && <div className="price-list-error">{error}</div>}
        {loading ? <div className="empty-mini">Carregando preços vigentes...</div> : !data?.import ? <EmptyPriceState text={canManage ? "Importe o primeiro arquivo na aba Administração." : "A Fábrica ainda não publicou uma lista de preços vigente."} /> : !data.rows.length ? <EmptyPriceState text="Nenhum item corresponde ao filtro informado." /> : <div className="price-list-table-wrap"><table className="price-list-table"><thead><tr><th>PN (PART NUMBER)</th><th>Descrição</th><th>Família</th><th>Unidade</th><th>NCM</th><th>VT</th><th>Origem</th><th>Netprice</th><th>Cliente final</th><th>Cliente nível 2</th><th>Cliente nível 3</th>{canManage && <th aria-label="Ações" />}</tr></thead><tbody>{data.rows.map((row) => <tr key={row.id}><td><strong>{row.partNumber}</strong></td><td><span>{row.description || "—"}</span></td><td>{row.family || "—"}</td><td>{row.unit || "—"}</td><td>{row.ncm || "—"}</td><td>{row.vt || "—"}</td><td>{row.origin || "—"}</td><td className="price-cell">{money(row.netPriceCents)}</td><td className="price-cell">{money(row.finalPriceCents)}</td><td className="price-cell">{money(row.n2PriceCents)}</td><td className="price-cell">{money(row.n3PriceCents)}</td>{canManage && <td><div className="table-row-actions"><button type="button" className="table-action-button" aria-label={`Editar ${row.partNumber}`} onClick={() => setEditing(row)}>✎</button><button type="button" className="table-action-button danger" aria-label={`Excluir ${row.partNumber}`} onClick={() => void deleteRow(row)}>×</button></div></td>}</tr>)}</tbody></table></div>}
        {data?.total ? <footer className="price-list-pagination"><span>{((page - 1) * (data.pageSize ?? 50) + 1).toLocaleString("pt-BR")}–{Math.min(page * (data.pageSize ?? 50), data.total).toLocaleString("pt-BR")} de {data.total.toLocaleString("pt-BR")} itens</span><div><button type="button" className="outline-button compact" disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>Anterior</button><strong>Página {page} de {totalPages}</strong><button type="button" className="outline-button compact" disabled={page >= totalPages} onClick={() => setPage((current) => Math.min(totalPages, current + 1))}>Próxima</button></div></footer> : null}
      </section>
    </>}
    {canManage && adminSection === "history" && <PriceListHistory refreshKey={notificationRefreshKey} />}
    {editing && <PriceEditor row={editing} onClose={() => setEditing(null)} onSave={saveRow} />}
  </div>;
}

function AdminPanel({ file, setFile, uploading, uploadProgress, onSubmit, currentImport }: { file: File | null; setFile: (file: File | null) => void; uploading: boolean; uploadProgress: number; onSubmit: (event: FormEvent) => void; currentImport: PriceListResponse["import"] }) {
  return (
    <section className="price-list-admin-grid">
      <article className="panel price-list-upload-card">
        <div className="admin-card-icon">↑</div>
        <span className="eyebrow">Atualização central</span>
        <h2>Importar nova lista</h2>
        <p>
          Use o modelo Excel com PN, Descrição, Família, Unidade, NCM, VT, Origem, Netprice 26 e Cliente final por UF.
          Cliente nível 2 = Cliente final × 0,90; Cliente nível 3 = Cliente final × 0,80. Esses dois níveis são calculados automaticamente.
        </p>
        <div className="price-list-template-callout">
          <div>
            <strong>Comece pelo arquivo de exemplo</strong>
            <span>Ele já traz todos os cabeçalhos aceitos e fórmulas demonstrativas dos níveis calculados.</span>
          </div>
          <a className="outline-button" href="/modelos/lista-precos-exemplo.xlsx" download>Baixar Excel de exemplo</a>
        </div>
        <form onSubmit={onSubmit}>
          <label className="file-drop">
            <input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
            <strong>{file ? file.name : "Selecionar arquivo .xlsx"}</strong>
            <small>{file ? ((file.size / (1024 * 1024)).toFixed(1).replace(".", ",") + " MB pronto para importar") : "Até 120 MB · upload dividido em partes"}</small>
          </label>
          {uploading && <div className="price-list-upload-progress" role="status">
            <div className="price-list-upload-progress-label"><span>Enviando planilha em partes...</span><strong>{uploadProgress}%</strong></div>
            <div className="price-list-upload-progress-track"><span style={{ width: String(uploadProgress) + "%" }} /></div>
          </div>}
          <button type="submit" className="primary-button" disabled={!file || uploading}>{uploading ? "Processando planilha..." : "Publicar nova versão"}</button>
        </form>
      </article>
      <article className="panel price-list-admin-info">
        <span className="eyebrow">Versão ativa</span>
        <h2>{currentImport?.fileName || "Nenhuma lista publicada"}</h2>
        {currentImport ? <>
          <div className="admin-info-row"><span>Itens normalizados</span><strong>{currentImport.rowCount.toLocaleString("pt-BR")}</strong></div>
          <div className="admin-info-row"><span>UFs identificadas</span><strong>{currentImport.states.join(" · ")}</strong></div>
          <div className="admin-info-row"><span>Importado por</span><strong>{currentImport.importedByName || "—"}</strong></div>
          <div className="admin-info-row"><span>Data</span><strong>{formatDate(currentImport.importedAt)}</strong></div>
        </> : <p>A lista aparecerá aqui depois da primeira importação.</p>}
        <div className="admin-permission-note"><strong>Acesso restrito</strong><span>Somente ADM Geral e Gestão Global podem importar ou ajustar preços.</span></div>
      </article>
    </section>
  );
}

function PriceListNotificationCenter({ canManage, refreshKey, onNotice }: { canManage: boolean; refreshKey: number; onNotice: (message: string) => void }) {
  const [open, setOpen] = useState(false);
  const [showComposer, setShowComposer] = useState(false);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [notifications, setNotifications] = useState<PriceListNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [audience, setAudience] = useState<NotificationAudienceUser[]>([]);
  const [scope, setScope] = useState<"all" | "selected">("all");
  const [selectedEmails, setSelectedEmails] = useState<string[]>([]);
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [affectedPns, setAffectedPns] = useState("");
  const [effectiveAt, setEffectiveAt] = useState(localDateValue());

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/price-list-notifications" + (canManage ? "?audience=1&refresh=" + refreshKey : "?refresh=" + refreshKey), { cache: "no-store" });
      const payload = (await response.json()) as NotificationResponse;
      if (!response.ok) throw new Error(payload.error || "Não foi possível carregar os avisos.");
      setNotifications(payload.notifications ?? []);
      setUnreadCount(payload.unreadCount ?? 0);
      setAudience(payload.audience ?? []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Não foi possível carregar os avisos.");
    } finally {
      setLoading(false);
    }
  }, [canManage, refreshKey]);

  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);

  async function markRead(id: number) {
    const notification = notifications.find((item) => item.id === id);
    if (!notification || notification.readAt) return;
    const response = await fetch("/api/price-list-notifications", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
    if (!response.ok) return;
    setNotifications((current) => current.map((item) => item.id === id ? { ...item, readAt: new Date().toISOString() } : item));
    setUnreadCount((current) => Math.max(0, current - 1));
  }

  async function markAllRead() {
    if (!unreadCount) return;
    const response = await fetch("/api/price-list-notifications", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ all: true }) });
    if (!response.ok) return;
    const now = new Date().toISOString();
    setNotifications((current) => current.map((item) => item.readAt ? item : { ...item, readAt: now }));
    setUnreadCount(0);
  }

  function toggleRecipient(email: string) {
    setSelectedEmails((current) => current.includes(email) ? current.filter((item) => item !== email) : [...current, email]);
  }

  async function submitNotification(event: FormEvent) {
    event.preventDefault();
    setSending(true);
    setError("");
    try {
      const response = await fetch("/api/price-list-notifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, message, effectiveAt, affectedPns, audience: scope, selectedEmails }),
      });
      const payload = (await response.json()) as { error?: string; notification?: { recipientCount: number } };
      if (!response.ok) throw new Error(payload.error || "Não foi possível enviar o aviso.");
      setTitle("");
      setMessage("");
      setAffectedPns("");
      setSelectedEmails([]);
      setScope("all");
      setShowComposer(false);
      setOpen(true);
      onNotice("Aviso enviado para " + (payload.notification?.recipientCount ?? 0) + " usuários.");
      await load();
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : "Não foi possível enviar o aviso.");
    } finally {
      setSending(false);
    }
  }

  return <section className="price-list-notification-center panel">
    <header className="price-list-notification-header">
      <div className="price-list-notification-title"><span className="admin-card-icon">!</span><div><span className="eyebrow">Comunicação operacional</span><h2>Avisos da lista de preços {unreadCount > 0 && <strong className="notification-badge">{unreadCount}</strong>}</h2><p>Alterações publicadas pelo ADM aparecem aqui para todos os acessos habilitados.</p></div></div>
      <div className="price-list-notification-actions">{canManage && <button type="button" className="primary-button compact" onClick={() => { setOpen(true); setShowComposer((current) => !current); }}>{showComposer ? "Fechar envio" : "Enviar aviso"}</button>}<button type="button" className="outline-button compact" onClick={() => setOpen((current) => !current)}>{open ? "Ocultar avisos" : "Ver avisos"}</button></div>
    </header>
    {open && <div className="price-list-notification-body">
      <div className="price-list-notification-inbox">
        <div className="price-list-notification-inbox-heading"><div><span className="eyebrow">Caixa de entrada</span><strong>{unreadCount ? unreadCount + " não lido(s)" : "Tudo lido"}</strong></div>{unreadCount > 0 && <button type="button" className="text-button" onClick={() => void markAllRead()}>Marcar tudo como lido</button>}</div>
        {error && <div className="price-list-error">{error}</div>}
        {loading ? <div className="empty-mini">Carregando avisos...</div> : !notifications.length ? <div className="empty-mini">Nenhuma alteração foi comunicada ainda.</div> : <div className="price-list-notification-list">{notifications.map((notification) => <article className={notification.readAt ? "price-list-notification-item" : "price-list-notification-item unread"} key={notification.id}><div className="price-list-notification-item-top"><div><strong>{notification.title}</strong>{!notification.readAt && <span className="notification-unread-dot">Novo</span>}</div><span>{formatEffectiveDate(notification.effectiveAt)}</span></div><p>{notification.message}</p>{notification.affectedPns && <small>Escopo: {notification.affectedPns}</small>}<footer><span>Por {notification.createdByName || "ADM"} · enviado em {formatDate(notification.createdAt)}</span>{!notification.readAt && <button type="button" className="text-button" onClick={() => void markRead(notification.id)}>Marcar como lido</button>}</footer></article>)}</div>}
      </div>
      {canManage && showComposer && <form className="price-list-notification-composer" onSubmit={(event) => void submitNotification(event)}><div><span className="eyebrow">Novo aviso</span><h3>Comunicar alteração</h3><p>O envio automático para todos acontece ao importar uma nova lista ou salvar um ajuste de PN. Use este formulário para personalizar o aviso e escolher destinatários.</p></div><label className="field"><span>Título</span><input maxLength={120} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Ex.: Reajuste do PN 60027753" required /></label><label className="field"><span>Mensagem</span><textarea maxLength={2000} value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Explique o que mudou e o que o usuário precisa considerar." required /></label><div className="price-list-notification-form-grid"><label className="field"><span>Vigência a partir de</span><input type="date" value={effectiveAt} onChange={(event) => setEffectiveAt(event.target.value)} required /></label><label className="field"><span>PNs ou escopo da alteração</span><input maxLength={500} value={affectedPns} onChange={(event) => setAffectedPns(event.target.value)} placeholder="Ex.: 60027753 · cliente final · SP" /></label></div><div className="notification-scope"><span className="field-label">Destinatários</span><label className="notification-radio"><input type="radio" checked={scope === "all"} onChange={() => setScope("all")} />Todos com acesso à lista <small>{audience.length} usuários elegíveis</small></label><label className="notification-radio"><input type="radio" checked={scope === "selected"} onChange={() => setScope("selected")} />Usuários selecionados <small>Envio individual ou para um grupo</small></label></div>{scope === "selected" && <div className="notification-recipient-list">{audience.map((user) => <label className="notification-recipient" key={user.email}><input type="checkbox" checked={selectedEmails.includes(user.email)} onChange={() => toggleRecipient(user.email)} /><span><strong>{user.name}</strong><small>{user.roleLabel}{user.dealershipName ? " · " + user.dealershipName : ""} · {user.email}</small></span></label>)}</div>}<div className="notification-composer-footer"><span>{scope === "all" ? "O servidor valida os acessos ativos antes do envio." : selectedEmails.length + " selecionado(s)"}</span><button type="submit" className="primary-button" disabled={sending}>{sending ? "Enviando..." : "Enviar aviso"}</button></div></form>}
    </div>}
  </section>;
}

function EmptyPriceState({ text }: { text: string }) {
  return <div className="price-list-empty"><span>₿</span><strong>Lista de preços indisponível</strong><p>{text}</p></div>;
}

function PriceEditor({ row, onClose, onSave }: { row: PriceRow; onClose: () => void; onSave: (row: PriceRow, draft: { partNumber: string; description: string; family: string; unit: string; ncm: string; vt: string; origin: string; net: string; final: string; effectiveAt: string; justification: string; applyToAllStates: boolean }) => Promise<void> }) {
  const [draft, setDraft] = useState({ partNumber: row.partNumber, description: row.description, family: row.family, unit: row.unit, ncm: row.ncm, vt: row.vt, origin: row.origin, net: inputMoney(row.netPriceCents), final: inputMoney(row.finalPriceCents), effectiveAt: localDateValue(), justification: "", applyToAllStates: false });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try { await onSave(row, draft); } catch (saveError) { setError(saveError instanceof Error ? saveError.message : "Não foi possível salvar."); } finally { setSaving(false); }
  }
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <form className="price-editor-modal" onSubmit={(event) => void submit(event)}>
        <header className="modal-header"><div><span className="eyebrow">Ajuste administrativo · {draft.applyToAllStates ? "todos os estados" : row.state}</span><h2>{row.partNumber}</h2><p>{row.description}</p></div><button type="button" className="icon-button" onClick={onClose} aria-label="Fechar">×</button></header>
        <div className="form-scroll">
          <div className="price-editor-grid">
            <label className="field"><span>PN</span><input value={draft.partNumber} onChange={(event) => setDraft({ ...draft, partNumber: event.target.value })} required /></label>
            <label className="field price-editor-wide"><span>Descrição</span><input value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} /></label>
            <label className="field"><span>Família</span><input value={draft.family} onChange={(event) => setDraft({ ...draft, family: event.target.value })} /></label>
            <label className="field"><span>Unidade</span><input value={draft.unit} onChange={(event) => setDraft({ ...draft, unit: event.target.value })} /></label>
            <label className="field"><span>NCM</span><input value={draft.ncm} onChange={(event) => setDraft({ ...draft, ncm: event.target.value })} /></label>
            <label className="field"><span>VT</span><input value={draft.vt} onChange={(event) => setDraft({ ...draft, vt: event.target.value })} /></label>
            <label className="field"><span>Origem</span><input value={draft.origin} onChange={(event) => setDraft({ ...draft, origin: event.target.value })} /></label>
            <label className="field"><span>Netprice unitário</span><input inputMode="decimal" value={draft.net} onChange={(event) => setDraft({ ...draft, net: event.target.value })} /></label>
            <label className="field"><span>Cliente final</span><input inputMode="decimal" value={draft.final} onChange={(event) => setDraft({ ...draft, final: event.target.value })} /></label>
            <label className="field"><span>Cliente nível 2 · 90%</span><input inputMode="decimal" value={derivedInputMoney(draft.final, 0.9)} readOnly aria-label="Cliente nível 2 calculado automaticamente" /></label>
            <label className="field"><span>Cliente nível 3 · 80%</span><input inputMode="decimal" value={derivedInputMoney(draft.final, 0.8)} readOnly aria-label="Cliente nível 3 calculado automaticamente" /></label>
            <label className="field"><span>Vigência do ajuste</span><input type="date" value={draft.effectiveAt} onChange={(event) => setDraft({ ...draft, effectiveAt: event.target.value })} required /></label>
            <label className="price-editor-scope price-editor-wide"><input type="checkbox" checked={draft.applyToAllStates} onChange={(event) => setDraft({ ...draft, applyToAllStates: event.target.checked })} /><span><strong>Aplicar este ajuste a todos os estados</strong><small>Use o mesmo clique para replicar preços e dados do PN em todas as UFs da lista vigente.</small></span></label>
            <label className="field price-editor-wide"><span>Justificativa da alteração</span><textarea value={draft.justification} onChange={(event) => setDraft({ ...draft, justification: event.target.value })} placeholder="Explique por que o PN ou o preço precisa ser alterado." minLength={10} maxLength={1000} rows={4} required /></label>
          </div>
          {error && <p className="form-error">{error}</p>}
        </div>
        <footer className="modal-actions"><button type="button" className="ghost-button" onClick={onClose}>Cancelar</button><button type="submit" className="primary-button" disabled={saving}>{saving ? "Salvando..." : "Salvar ajuste"}</button></footer>
      </form>
    </div>
  );
}

function PriceListHistory({ refreshKey }: { refreshKey: number }) {
  const [entries, setEntries] = useState<PriceHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [pnFilter, setPnFilter] = useState("");
  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const response = await fetch(`/api/price-list?history=1&refresh=${refreshKey}`, { cache: "no-store" });
      const payload = await response.json() as { entries?: PriceHistoryEntry[]; error?: string };
      if (!response.ok) throw new Error(payload.error || "Não foi possível carregar o histórico.");
      setEntries(payload.entries ?? []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Não foi possível carregar o histórico.");
    } finally { setLoading(false); }
  }, [refreshKey]);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);
  const normalizedFilter = pnFilter.trim().toLocaleLowerCase("pt-BR");
  const filteredEntries = entries.filter((entry) => {
    if (!normalizedFilter) return true;
    const before = parseHistoryJson(entry.beforeJson);
    const after = parseHistoryJson(entry.afterJson);
    return String(after.partNumber ?? before.partNumber ?? "").toLocaleLowerCase("pt-BR").includes(normalizedFilter);
  });

  return <section className="panel price-history-panel"><header className="panel-header"><div><span className="eyebrow">Governança dos preços</span><h2>Histórico de ajustes pontuais</h2><p>Filtre por PN para consultar todas as mudanças, justificativas, vigências e valores antes e depois.</p></div><strong>{filteredEntries.length}{entries.length !== filteredEntries.length ? ` de ${entries.length}` : ""} registros</strong></header>{!loading && !error && entries.length > 0 && <form className="price-history-filter" onSubmit={(event) => event.preventDefault()}><label><span>Filtrar por PN</span><input value={pnFilter} onChange={(event) => setPnFilter(event.target.value)} placeholder="Ex.: 60027753" /></label><button type="submit" className="price-list-search-button">Filtrar</button>{pnFilter && <button type="button" className="outline-button compact" onClick={() => setPnFilter("")}>Limpar</button>}</form>}{loading ? <div className="empty-mini">Carregando histórico...</div> : error ? <div className="price-list-error">{error}</div> : !entries.length ? <div className="empty-mini">Nenhum ajuste pontual registrado.</div> : !filteredEntries.length ? <div className="empty-mini">Nenhum histórico encontrado para este PN.</div> : <div className="price-history-list">{filteredEntries.map((entry) => <PriceHistoryRow entry={entry} key={entry.id} />)}</div>}</section>;
}

function PriceHistoryRow({ entry }: { entry: PriceHistoryEntry }) {
  const before = parseHistoryJson(entry.beforeJson);
  const after = parseHistoryJson(entry.afterJson);
  const state = String(after.state ?? before.state ?? "");
  const states = Array.isArray(after.states) ? after.states.map((item) => String(item)).filter(Boolean) : state && state !== "TODOS" ? [state] : [];
  const comparisonState = states[0] ?? state;
  const beforePrices = historyStatePrices(before, comparisonState);
  const afterPrices = historyStatePrices(after, comparisonState);
  const justification = String(after.justification ?? entry.details.split("Justificativa:").slice(1).join("Justificativa:").trim() ?? "");
  const pn = String(after.partNumber ?? before.partNumber ?? "—");
  const action = entry.action === "price_list_item_deleted" ? "PN excluído" : "PN ajustado";
  const scopeLabel = states.length > 1 || state === "TODOS" ? `Todos os estados${states.length ? ` (${states.length})` : ""}` : state ? `UF ${state}` : "Lista vigente";
  const values = [
    ["Netprice", money(historyNumber(beforePrices.netPriceCents)), money(historyNumber(afterPrices.netPriceCents))],
    ["Cliente final", money(historyNumber(beforePrices.final)), money(historyNumber(afterPrices.final))],
  ].filter((item) => item[1] !== item[2]);
  const textChanges = ["description", "family", "unit", "ncm", "vt", "origin"].filter((field) => String(before[field] ?? "") !== String(after[field] ?? ""));
  return <article className="price-history-row"><div className="price-history-row-head"><div><strong>PN {pn}</strong><span>{scopeLabel} · {action}</span></div><div><strong>{formatDate(entry.createdAt)}</strong><small>{entry.actorName || entry.actorEmail}</small></div></div><div className="price-history-row-body"><div className="price-history-values">{values.map(([label, oldValue, newValue]) => <div key={label}><span>{label}</span><small>{oldValue}</small><b>→</b><strong>{newValue}</strong></div>)}{textChanges.length > 0 && <div><span>Dados alterados</span><strong>{textChanges.join(", ")}</strong></div>}{!values.length && !textChanges.length && <div><span>Registro</span><strong>Exclusão do item</strong></div>}</div><p><strong>Justificativa:</strong> {justification || entry.details}</p><small>Vigência: {String(after.effectiveAt ?? "não informada")}</small></div></article>;
}

function parseHistoryJson(value: string): Record<string, unknown> {
  try { const parsed = JSON.parse(value) as unknown; return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {}; } catch { return {}; }
}

function historyStatePrices(snapshot: Record<string, unknown>, state: string) {
  const prices = snapshot.statePrices;
  if (!prices || typeof prices !== "object") return {} as Record<string, unknown>;
  const selected = (prices as Record<string, unknown>)[state];
  return selected && typeof selected === "object" ? selected as Record<string, unknown> : {} as Record<string, unknown>;
}

function historyNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
