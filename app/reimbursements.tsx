"use client";

import type { FormEvent } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";

export type ReimbursementAccess = {
  role: string;
  name: string;
  dealershipId?: number | null;
  permissions?: Record<string, boolean>;
};

type Dealer = { id: number; name: string; state?: string };
type Batch = {
  id: number;
  fileName: string;
  status: string;
  rowCount: number;
  totalQuantity: number;
  totalSalesCents: number;
  totalReimbursementN2Cents: number;
  totalReimbursementN3Cents: number;
  totalNegotiationCents: number;
  createdAt: string;
  decisionNote: string;
};
type Sale = {
  id: number;
  partNumber: string;
  description: string;
  clientName: string;
  clientCnpj: string;
  invoiceNumber: string;
  state: string;
  dealershipName: string;
  quantity: number;
  costAvgUnitCents: number;
  saleNetUnitCents: number;
  invoiceUnitCents: number;
  costTotalCents: number;
  liquidTotalCents: number;
  marginBps: number;
  marginPercent: number;
  netPriceUsedCents: number | null;
  calculationBaseCents: number;
  reimbursementCents: number;
  reimbursementProgram: string;
  status: string;
  negotiationCents: number;
  expectedN3Cents: number | null;
  priceDifferenceCents: number | null;
};
type Summary = {
  salesCents: number;
  costCents: number;
  marginBps: number;
  reimbursementN2Cents: number;
  reimbursementN3Cents: number;
  negotiationCents: number;
  processedRows: number;
  totalQuantity: number;
  eligibleN2Records: number;
  eligibleN3Records: number;
  attentionRecords: number;
  fallbackBaseRecords: number;
};
type Client = { id: number; legalName: string; cnpj: string; state: string; clientType: string; n2: boolean; n3: boolean; status: string };
type ClientForm = { legalName: string; cnpj: string; state: string; clientType: string; n2: boolean; n3: boolean; status: string };
type StatusBreakdown = { status: string; count: number; liquidTotalCents: number; reimbursementCents: number };
type DashboardData = {
  imports: Batch[];
  sales: Sale[];
  summary: Summary;
  byDealership: Array<{ label: string; rows: number; quantity: number; salesCents: number; reimbursementCents: number; marginBps: number }>;
  byPartNumber: Array<{ partNumber: string; description: string; rows: number; quantity: number; salesCents: number; reimbursementCents: number; marginBps: number }>;
  alerts: Array<{ status: string; count: number }>;
  statusBreakdown: StatusBreakdown[];
  approvals: Array<{ action: string; note: string; actorName: string; createdAt: string }>;
  dealerships: Dealer[];
  activeImportId: number;
  canReview: boolean;
  canManageClients: boolean;
  statuses: string[];
};

const STATES = ["AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO", "PY"];
const EMPTY_CLIENT: ClientForm = { legalName: "", cnpj: "", state: "", clientType: "", n2: true, n3: false, status: "active" };

function formatBRL(cents: number | null | undefined) {
  return (Number(cents ?? 0) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatDate(value: string) {
  return value ? new Date(value).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "—";
}

function formatPercent(basisPoints: number) {
  return (basisPoints / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function parseCents(value: string) {
  const clean = value.replace(/R\$\s?/g, "").replace(/\./g, "").replace(",", ".").replace(/[^\d.-]/g, "");
  return Math.max(0, Math.round((Number(clean) || 0) * 100));
}

function statusClass(status: string) {
  if (status.includes("Negociação") || status.includes("Divergência") || status.includes("Duplicada")) return "danger";
  if (status.includes("Elegível")) return "success";
  if (status.includes("Não Elegível") || status.includes("Encontrado") || status.includes("Cadastro")) return "warning";
  return "neutral";
}

function statusLabel(status: string) {
  const labels: Record<string, string> = {
    processed: "Processado",
    submitted: "Enviado para aprovação",
    under_review: "Em análise",
    approved: "Aprovado",
    rejected: "Rejeitado",
    paid: "Pago",
  };
  return labels[status] ?? status;
}

function clientClassification(client: Pick<ClientForm, "n2" | "n3">) {
  if (client.n3) return "Cliente Nível 3";
  if (client.n2) return "Cliente Nível 2";
  return "Não classificado";
}

function signedBRL(cents: number | null) {
  if (cents === null) return "—";
  return `${cents > 0 ? "+" : ""}${formatBRL(cents)}`;
}

export function ReimbursementsView({ me, dealerships }: { me: ReimbursementAccess; dealerships: Dealer[] }) {
  const [tab, setTab] = useState<"overview" | "sales" | "import" | "clients">("overview");
  const [data, setData] = useState<DashboardData | null>(null);
  const [clients, setClients] = useState<Client[]>([]);
  const [activeBatchId, setActiveBatchId] = useState(0);
  const [pnFilter, setPnFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [dealerFilter, setDealerFilter] = useState("");
  const [uploadDealerId, setUploadDealerId] = useState("");
  const [tolerance, setTolerance] = useState("0,01");
  const [editingClient, setEditingClient] = useState<number | null>(null);
  const [clientForm, setClientForm] = useState<ClientForm>(EMPTY_CLIENT);
  const [busy, setBusy] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const canReview = Boolean(data?.canReview) || ["general_admin", "global_management", "factory_manager"].includes(me.role);
  const canManageClients = Boolean(data?.canManageClients) || ["general_admin", "global_management"].includes(me.role);
  const visibleDealerships = dealerships.length ? dealerships : data?.dealerships ?? [];
  const activeBatch = useMemo(() => data?.imports.find((item) => item.id === activeBatchId) ?? data?.imports[0], [activeBatchId, data?.imports]);
  const reimbursementTotal = (data?.summary.reimbursementN2Cents ?? 0) + (data?.summary.reimbursementN3Cents ?? 0);

  const load = useCallback(async () => {
    setError("");
    try {
      const params = new URLSearchParams();
      if (activeBatchId) params.set("batchId", String(activeBatchId));
      if (pnFilter.trim()) params.set("pn", pnFilter.trim());
      if (statusFilter !== "all") params.set("status", statusFilter);
      if (dealerFilter) params.set("dealershipId", dealerFilter);
      const response = await fetch(`/api/reimbursements?${params.toString()}`, { cache: "no-store" });
      const payload = await response.json() as DashboardData & { error?: string };
      if (!response.ok) throw new Error(payload.error || "Não foi possível carregar os reembolsos.");
      setData(payload);
      if (!activeBatchId && payload.activeImportId) setActiveBatchId(payload.activeImportId);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Não foi possível carregar os reembolsos.");
    }
  }, [activeBatchId, dealerFilter, pnFilter, statusFilter]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const loadClients = useCallback(async () => {
    if (!canManageClients) return;
    const response = await fetch("/api/reimbursement-clients", { cache: "no-store" });
    const payload = await response.json() as { clients?: Client[]; error?: string };
    if (!response.ok) throw new Error(payload.error || "Não foi possível carregar os clientes.");
    setClients(payload.clients ?? []);
  }, [canManageClients]);

  useEffect(() => {
    if (tab !== "clients") return;
    const timer = window.setTimeout(() => {
      void loadClients().catch((loadError) => setError(loadError instanceof Error ? loadError.message : "Não foi possível carregar os clientes."));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadClients, tab]);

  async function uploadSales(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const file = form.get("file");
    if (!(file instanceof File) || !file.size) {
      setError("Selecione a planilha de vendas.");
      return;
    }

    setBusy(true);
    setError("");
    setMessage("");
    setUploadProgress(1);
    try {
      const initResponse = await fetch("/api/reimbursements?upload=init", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileName: file.name, fileSize: file.size }),
      });
      const init = await initResponse.json() as { uploadId?: string; chunkSize?: number; totalChunks?: number; error?: string };
      if (!initResponse.ok || !init.uploadId || !init.chunkSize || !init.totalChunks) throw new Error(init.error || "Não foi possível iniciar o upload.");

      for (let part = 0; part < init.totalChunks; part += 1) {
        const chunk = file.slice(part * init.chunkSize, Math.min(file.size, (part + 1) * init.chunkSize));
        const chunkResponse = await fetch(`/api/reimbursements?upload=chunk&uploadId=${init.uploadId}&part=${part}&totalChunks=${init.totalChunks}`, { method: "POST", body: chunk });
        if (!chunkResponse.ok) throw new Error("Falha ao enviar uma parte da planilha.");
        setUploadProgress(Math.round(((part + 1) / (init.totalChunks + 1)) * 92));
      }

      const completeResponse = await fetch("/api/reimbursements?upload=complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          uploadId: init.uploadId,
          fileName: file.name,
          contentType: file.type,
          totalChunks: init.totalChunks,
          dealershipId: uploadDealerId ? Number(uploadDealerId) : undefined,
          toleranceCents: parseCents(tolerance),
        }),
      });
      const complete = await completeResponse.json() as { import?: { id: number }; error?: string };
      if (!completeResponse.ok) throw new Error(complete.error || "Não foi possível processar a planilha.");

      setUploadProgress(100);
      setMessage("Planilha processada. O lote mantém o snapshot da lista de preços e do CPF/CNPJ informado pelo concessionário.");
      setTab("overview");
      if (complete.import?.id) setActiveBatchId(complete.import.id);
      await load();
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Não foi possível processar a planilha.");
    } finally {
      setBusy(false);
    }
  }

  async function runWorkflow(action: string) {
    if (!activeBatch) return;
    const note = action === "reject"
      ? window.prompt("Informe o motivo da rejeição:") ?? ""
      : window.prompt("Observação da decisão (opcional):") ?? "";
    if (action === "reject" && note.trim().length < 5) {
      setError("A rejeição precisa de uma justificativa.");
      return;
    }

    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/reimbursements", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: activeBatch.id, action, note }),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || "Não foi possível atualizar o workflow.");
      setMessage("Workflow atualizado com sucesso.");
      await load();
    } catch (workflowError) {
      setError(workflowError instanceof Error ? workflowError.message : "Não foi possível atualizar o workflow.");
    } finally {
      setBusy(false);
    }
  }

  async function saveClient(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/reimbursement-clients", {
        method: editingClient ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: editingClient ?? undefined, ...clientForm }),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || "Não foi possível salvar o cliente.");
      setMessage(editingClient ? "Cliente atualizado." : "Cliente cadastrado.");
      setEditingClient(null);
      setClientForm(EMPTY_CLIENT);
      await loadClients();
    } catch (clientError) {
      setError(clientError instanceof Error ? clientError.message : "Não foi possível salvar o cliente.");
    } finally {
      setBusy(false);
    }
  }

  async function deactivateClient(id: number) {
    if (!window.confirm("Inativar este cliente? O histórico de reembolsos será preservado.")) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/reimbursement-clients", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || "Não foi possível inativar o cliente.");
      setMessage("Cliente inativado.");
      await loadClients();
    } catch (clientError) {
      setError(clientError instanceof Error ? clientError.message : "Não foi possível inativar o cliente.");
    } finally {
      setBusy(false);
    }
  }

  function exportReport() {
    const params = new URLSearchParams({ export: "xlsx" });
    if (activeBatchId) params.set("batchId", String(activeBatchId));
    if (pnFilter) params.set("pn", pnFilter);
    if (statusFilter !== "all") params.set("status", statusFilter);
    if (dealerFilter) params.set("dealershipId", dealerFilter);
    window.location.assign(`/api/reimbursements?${params.toString()}`);
  }

  const workflowButtons = activeBatch && (activeBatch.status === "processed" || activeBatch.status === "rejected")
    ? <button className="primary-button compact" disabled={busy} onClick={() => void runWorkflow("submit")}>Enviar para aprovação</button>
    : activeBatch?.status === "submitted" && canReview
      ? <><button className="outline-button compact" disabled={busy} onClick={() => void runWorkflow("start_review")}>Iniciar análise</button><button className="primary-button compact" disabled={busy} onClick={() => void runWorkflow("approve")}>Aprovar</button><button className="danger-button compact" disabled={busy} onClick={() => void runWorkflow("reject")}>Rejeitar</button></>
      : activeBatch?.status === "under_review" && canReview
        ? <><button className="primary-button compact" disabled={busy} onClick={() => void runWorkflow("approve")}>Aprovar reembolso</button><button className="danger-button compact" disabled={busy} onClick={() => void runWorkflow("reject")}>Rejeitar</button></>
        : activeBatch?.status === "approved" && canReview
          ? <button className="primary-button compact" disabled={busy} onClick={() => void runWorkflow("mark_paid")}>Marcar como pago</button>
          : null;

  return (
    <div className="content-frame reimbursement-shell">
      <header className="page-heading reimbursement-heading">
        <div>
          <span className="eyebrow">Controle financeiro</span>
          <h1>Reembolsos N2/N3</h1>
          <p>Importe as vendas, valide CPF/CNPJ, acompanhe elegibilidade e conduza o fluxo financeiro com rastreabilidade.</p>
        </div>
        <div className="reimbursement-heading-actions">
          <button className="outline-button compact" onClick={() => window.print()}>Exportar PDF</button>
          <button className="primary-button compact" onClick={exportReport}>Exportar Excel</button>
        </div>
      </header>

      <nav className="reimbursement-tabs" aria-label="Seções de reembolsos">
        <button className={tab === "overview" ? "active" : ""} onClick={() => setTab("overview")}>Visão gerencial</button>
        <button className={tab === "sales" ? "active" : ""} onClick={() => setTab("sales")}>Conferência por venda</button>
        <button className={tab === "import" ? "active" : ""} onClick={() => setTab("import")}>Importar dados</button>
        {canManageClients && <button className={tab === "clients" ? "active" : ""} onClick={() => setTab("clients")}>Clientes N2/N3</button>}
      </nav>

      {message && <div className="form-success reimbursement-notice">{message}</div>}
      {error && <div className="form-error reimbursement-notice">{error}</div>}

      {data?.imports.length ? (
        <section className="reimbursement-toolbar reimbursement-batch-bar" aria-label="Lote ativo">
          <label>
            Lote processado
            <select value={activeBatchId || data.activeImportId} onChange={(event) => setActiveBatchId(Number(event.target.value))}>
              {data.imports.map((item) => <option key={item.id} value={item.id}>{item.fileName} · {formatDate(item.createdAt)} · {statusLabel(item.status)}</option>)}
            </select>
          </label>
          <div className="reimbursement-batch-meta">
            <span>{activeBatch?.rowCount ?? 0} linhas</span>
            <span>{(activeBatch?.totalQuantity ?? 0).toLocaleString("pt-BR")} unidades</span>
            <span>Snapshot da lista vigente</span>
          </div>
          <div className="reimbursement-workflow">
            <span className={`reimbursement-status ${statusClass(activeBatch?.status ?? "")}`}>{statusLabel(activeBatch?.status ?? "")}</span>
            {workflowButtons}
          </div>
        </section>
      ) : (
        <section className="empty-state reimbursement-empty">
          <strong>Nenhuma venda processada ainda.</strong>
          <span>Baixe o modelo, cadastre o CPF/CNPJ do cliente e importe a primeira planilha de vendas.</span>
          <button className="primary-button" onClick={() => setTab("import")}>Ir para importação</button>
        </section>
      )}

      {tab === "import" && (
        <section className="reimbursement-import-layout">
          <form className="panel reimbursement-upload-card" onSubmit={(event) => void uploadSales(event)}>
            <div className="panel-heading">
              <div>
                <span className="eyebrow">Entrada controlada</span>
                <h2>Importar vendas para reembolso</h2>
                <p>Use o modelo abaixo para evitar divergências de coluna, CPF/CNPJ e identificação da concessionária.</p>
              </div>
            </div>

            <div className="reimbursement-import-steps" aria-label="Passos para importar">
              <div><strong>1</strong><span>Baixe o modelo Excel.</span></div>
              <div><strong>2</strong><span>Preencha as vendas unitárias.</span></div>
              <div><strong>3</strong><span>Processe e confira o lote.</span></div>
            </div>

            <div className="reimbursement-template-actions">
              <a className="primary-button compact" href="/modelos/modelo-importacao-reembolsos-n2-n3.xlsx" download>Baixar modelo Excel</a>
              <a className="outline-button compact" href="/modelos/reembolsos-vendas-exemplo.csv" download>Baixar exemplo CSV</a>
            </div>

            <div className="reimbursement-template">
              <strong>Campos obrigatórios</strong>
              <span>PN · Descrição · Quantidade · Custo Médio Líquido Unitário · Valor Venda Líquido Unitário · Valor Venda NF Unitário · Cliente · CPF/CNPJ · NF · Estado</span>
              <small>CPF/CNPJ deve ter 11 ou 14 dígitos. A primeira aba do Excel precisa ser <b>Vendas</b>. Concessionário pode ser informado no arquivo ou selecionado abaixo.</small>
            </div>

            <div className="form-grid">
              <label className="field full">
                <span>Planilha de vendas *</span>
                <input name="file" type="file" accept=".xlsx,.csv,.tsv" required />
                <small>Formatos aceitos: Excel (.xlsx), CSV e TSV. Tamanho máximo: 120 MB.</small>
              </label>
              <label className="field">
                <span>Concessionária</span>
                <select value={uploadDealerId} onChange={(event) => setUploadDealerId(event.target.value)}>
                  <option value="">Usar concessionária da planilha</option>
                  {visibleDealerships.map((dealer) => <option value={dealer.id} key={dealer.id}>{dealer.name}</option>)}
                </select>
              </label>
              <label className="field">
                <span>Tolerância N3 para arredondamento</span>
                <input value={tolerance} onChange={(event) => setTolerance(event.target.value)} inputMode="decimal" placeholder="0,01" />
                <small>Diferença máxima em reais entre NF unitária e o valor N3.</small>
              </label>
            </div>

            {uploadProgress > 0 && <div className="upload-progress" aria-label={`Upload ${uploadProgress}%`}><span style={{ width: `${uploadProgress}%` }} /><small>{uploadProgress}%</small></div>}
            <button className="primary-button" disabled={busy}>{busy ? "Processando planilha..." : "Processar e gerar lote"}</button>
          </form>

          <aside className="panel reimbursement-rules">
            <span className="eyebrow">Validações aplicadas</span>
            <h2>Antes de criar o lote</h2>
            <ul>
              <li>Não há processamento parcial: campos obrigatórios, CPF/CNPJ e UF são conferidos antes da criação do lote.</li>
              <li>O cliente é localizado pelo CPF/CNPJ e UF na base de clientes N2/N3.</li>
              <li>N2: margem menor ou igual a 20% e reembolso de 4% sobre a base.</li>
              <li>N3: NF unitária compatível com N3 do PN/UF e reembolso de 7%.</li>
              <li>Base: Net Price vigente × quantidade; sem Net Price, custo médio líquido × quantidade.</li>
              <li>Margem negativa em N3 gera valor para negociação com a fábrica.</li>
            </ul>
          </aside>
        </section>
      )}

      {tab === "overview" && data && <ExecutiveOverview data={data} reimbursementTotal={reimbursementTotal} activeBatch={activeBatch} />}

      {tab === "sales" && data && (
        <section className="panel reimbursement-detail-panel">
          <div className="panel-heading reimbursement-detail-heading">
            <div>
              <span className="eyebrow">Conferência linha a linha</span>
              <h2>Vendas e reembolsos calculados</h2>
              <p>Filtros por PN, status e concessionária. O cálculo utiliza o snapshot da lista de preços e do cliente no momento do upload.</p>
            </div>
            <div className="reimbursement-heading-actions">
              <button className="outline-button compact" onClick={() => window.print()}>PDF / imprimir</button>
              <button className="primary-button compact" onClick={exportReport}>Exportar Excel</button>
            </div>
          </div>

          <div className="reimbursement-filter-grid">
            <label>PN ou descrição<input value={pnFilter} onChange={(event) => setPnFilter(event.target.value)} placeholder="Buscar PN ou descrição..." /></label>
            <label>Status<select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="all">Todos</option>{data.statuses.map((status) => <option value={status} key={status}>{status}</option>)}</select></label>
            <label>Concessionária<select value={dealerFilter} onChange={(event) => setDealerFilter(event.target.value)}><option value="">Todas</option>{visibleDealerships.map((dealer) => <option value={dealer.id} key={dealer.id}>{dealer.name}</option>)}</select></label>
          </div>

          <div className="reimbursement-table-wrap wide">
            <table className="reimbursement-table reimbursement-detail-table">
              <thead><tr><th>PN</th><th>Descrição</th><th>Cliente / CPF-CNPJ</th><th>NF / UF</th><th>Concessionário</th><th>Qtd.</th><th>Custo total</th><th>Valor líquido</th><th>Margem</th><th>Base usada</th><th>Reembolso</th><th>Status</th><th>Negociação</th></tr></thead>
              <tbody>
                {data.sales.map((sale) => (
                  <tr key={sale.id}>
                    <td><strong>{sale.partNumber}</strong></td>
                    <td>{sale.description || "—"}</td>
                    <td>{sale.clientName || "—"}<small>{sale.clientCnpj || "CPF/CNPJ não informado"}</small></td>
                    <td>{sale.invoiceNumber || "—"}<small>{sale.state || "UF não informada"}</small></td>
                    <td>{sale.dealershipName || "—"}</td>
                    <td>{sale.quantity}</td>
                    <td>{formatBRL(sale.costTotalCents)}</td>
                    <td>{formatBRL(sale.liquidTotalCents)}</td>
                    <td>{formatPercent(sale.marginBps)}%</td>
                    <td><strong>{formatBRL(sale.calculationBaseCents)}</strong><small>{sale.netPriceUsedCents === null ? "Custo médio (fallback)" : `Net Price: ${formatBRL(sale.netPriceUsedCents)}`}</small></td>
                    <td><strong>{formatBRL(sale.reimbursementCents)}</strong><small>{sale.reimbursementProgram || "Sem programa"}</small></td>
                    <td><span className={`reimbursement-status ${statusClass(sale.status)}`}>{sale.status}</span>{sale.expectedN3Cents !== null && <small>N3 ref.: {formatBRL(sale.expectedN3Cents)} · Δ {signedBRL(sale.priceDifferenceCents)}</small>}</td>
                    <td>{formatBRL(sale.negotiationCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!data.sales.length && <div className="empty-mini">Nenhuma venda encontrada para os filtros.</div>}
          </div>
        </section>
      )}

      {tab === "clients" && canManageClients && (
        <section className="reimbursement-client-layout">
          <form className="panel reimbursement-client-form" onSubmit={(event) => void saveClient(event)}>
            <div className="panel-heading">
              <div>
                <span className="eyebrow">Cadastro controlado</span>
                <h2>{editingClient ? "Editar cliente" : "Novo cliente"}</h2>
                <p>A classificação é exclusiva: um cliente pode ser Nível 2, Nível 3 ou não classificado.</p>
              </div>
            </div>

            <div className="form-grid">
              <label className="field full"><span>Razão Social *</span><input value={clientForm.legalName} onChange={(event) => setClientForm({ ...clientForm, legalName: event.target.value })} required /></label>
              <label className="field"><span>CPF/CNPJ *</span><input value={clientForm.cnpj} onChange={(event) => setClientForm({ ...clientForm, cnpj: event.target.value })} placeholder="Somente números ou com máscara" required /></label>
              <label className="field"><span>Estado *</span><select value={clientForm.state} onChange={(event) => setClientForm({ ...clientForm, state: event.target.value })} required><option value="">Selecione</option>{STATES.map((state) => <option key={state}>{state}</option>)}</select></label>
              <label className="field"><span>Tipo de cliente</span><input value={clientForm.clientType} onChange={(event) => setClientForm({ ...clientForm, clientType: event.target.value })} placeholder="Ex.: cooperativa" /></label>
              <label className="field"><span>Classificação de reembolso</span><select value={clientForm.n3 ? "n3" : clientForm.n2 ? "n2" : "none"} onChange={(event) => setClientForm({ ...clientForm, n2: event.target.value === "n2", n3: event.target.value === "n3" })}><option value="n2">Cliente Nível 2</option><option value="n3">Cliente Nível 3</option><option value="none">Não classificado</option></select></label>
              <label className="field"><span>Status</span><select value={clientForm.status} onChange={(event) => setClientForm({ ...clientForm, status: event.target.value })}><option value="active">Ativo</option><option value="inactive">Inativo</option></select></label>
            </div>

            <div className="modal-actions">
              <button type="button" className="outline-button compact" onClick={() => { setEditingClient(null); setClientForm(EMPTY_CLIENT); }}>Limpar</button>
              <button className="primary-button compact" disabled={busy}>{editingClient ? "Salvar alterações" : "Cadastrar cliente"}</button>
            </div>
          </form>

          <section className="panel">
            <div className="panel-heading"><div><span className="eyebrow">Base de referência</span><h2>Clientes cadastrados</h2></div><span className="section-count">{clients.length}</span></div>
            <div className="reimbursement-table-wrap">
              <table className="reimbursement-table">
                <thead><tr><th>Razão Social</th><th>CPF/CNPJ</th><th>UF</th><th>Tipo</th><th>Classificação</th><th>Status</th><th /></tr></thead>
                <tbody>
                  {clients.map((client) => (
                    <tr key={client.id}>
                      <td><strong>{client.legalName}</strong></td>
                      <td>{client.cnpj}</td>
                      <td>{client.state}</td>
                      <td>{client.clientType}</td>
                      <td>{clientClassification(client)}</td>
                      <td><span className={`reimbursement-status ${client.status === "active" ? "success" : "neutral"}`}>{client.status === "active" ? "Ativo" : "Inativo"}</span></td>
                      <td><div className="inline-actions"><button type="button" className="text-button" onClick={() => { setEditingClient(client.id); setClientForm({ legalName: client.legalName, cnpj: client.cnpj, state: client.state, clientType: client.clientType, n2: client.n2, n3: client.n3, status: client.status }); }}>Editar</button>{client.status === "active" && <button type="button" className="text-button danger-text" onClick={() => void deactivateClient(client.id)}>Inativar</button>}</div></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!clients.length && <div className="empty-mini">Cadastre os clientes Nível 2 e Nível 3 antes de processar as vendas.</div>}
            </div>
          </section>
        </section>
      )}
    </div>
  );
}

function ExecutiveOverview({ data, reimbursementTotal, activeBatch }: { data: DashboardData; reimbursementTotal: number; activeBatch?: Batch }) {
  const maxStatus = Math.max(1, ...data.statusBreakdown.map((item) => item.count));
  return (
    <>
      <section className="reimbursement-kpi-grid">
        <article className="reimbursement-kpi primary"><span>Valor líquido vendido</span><strong>{formatBRL(data.summary.salesCents)}</strong><small>{data.summary.processedRows} registros no filtro atual</small></article>
        <article className="reimbursement-kpi accent"><span>Reembolso projetado</span><strong>{formatBRL(reimbursementTotal)}</strong><small>N2 + N3 elegíveis</small></article>
        <article className="reimbursement-kpi"><span>Margem consolidada</span><strong>{formatPercent(data.summary.marginBps)}%</strong><small>Vendas líquidas versus custo</small></article>
        <article className="reimbursement-kpi"><span>Reembolso Nível 2</span><strong>{formatBRL(data.summary.reimbursementN2Cents)}</strong><small>{data.summary.eligibleN2Records} vendas elegíveis · 4%</small></article>
        <article className="reimbursement-kpi"><span>Reembolso Nível 3</span><strong>{formatBRL(data.summary.reimbursementN3Cents)}</strong><small>{data.summary.eligibleN3Records} vendas elegíveis · 7%</small></article>
        <article className="reimbursement-kpi danger"><span>Negociação fábrica</span><strong>{formatBRL(data.summary.negotiationCents)}</strong><small>Margem negativa em Nível 3</small></article>
      </section>

      <section className="reimbursement-insight-grid">
        <article className="panel reimbursement-insight-card">
          <span className="eyebrow">Cobertura do lote</span>
          <h2>{data.summary.totalQuantity.toLocaleString("pt-BR")} unidades vendidas</h2>
          <p>{data.summary.eligibleN2Records + data.summary.eligibleN3Records} vendas elegíveis entre {data.summary.processedRows} registros analisados.</p>
        </article>
        <article className="panel reimbursement-insight-card">
          <span className="eyebrow">Base de cálculo</span>
          <h2>{data.summary.fallbackBaseRecords} linhas com fallback</h2>
          <p>Quando o Net Price não está disponível, o cálculo usa o custo médio líquido unitário do arquivo.</p>
        </article>
        <article className="panel reimbursement-insight-card danger">
          <span className="eyebrow">Atenção necessária</span>
          <h2>{data.summary.attentionRecords} ocorrências</h2>
          <p>{data.summary.attentionRecords ? "Revise divergências, NFs duplicadas, clientes sem cadastro e negociações antes de aprovar." : "Nenhuma pendência financeira no filtro atual."}</p>
        </article>
      </section>

      <section className="reimbursement-dashboard-grid">
        <article className="panel reimbursement-status-panel">
          <div className="panel-heading"><div><span className="eyebrow">Elegibilidade e alertas</span><h2>Distribuição do lote</h2><p>Leitura rápida dos estados das vendas processadas.</p></div></div>
          {data.statusBreakdown.length ? <div className="reimbursement-breakdown">{data.statusBreakdown.map((item) => <div className="reimbursement-breakdown-row" key={item.status}><div><span className={`reimbursement-status ${statusClass(item.status)}`}>{item.status}</span><small>{formatBRL(item.reimbursementCents)} projetados</small></div><div className="reimbursement-bar"><span className={statusClass(item.status)} style={{ width: `${(item.count / maxStatus) * 100}%` }} /></div><strong>{item.count}</strong></div>)}</div> : <div className="empty-mini">Sem registros para o lote atual.</div>}
        </article>
        <article className="panel reimbursement-workflow-panel">
          <div className="panel-heading"><div><span className="eyebrow">Auditoria e aprovação</span><h2>Decisões do lote</h2><p>{activeBatch?.decisionNote || "O histórico registra cada etapa para conferência financeira."}</p></div></div>
          {data.approvals.length ? <div className="approval-timeline">{data.approvals.map((approval, index) => <div key={`${approval.createdAt}-${index}`}><strong>{statusLabel(approval.action)}</strong><span>{approval.actorName} · {formatDate(approval.createdAt)}</span>{approval.note && <small>{approval.note}</small>}</div>)}</div> : <div className="empty-mini">Nenhuma decisão registrada. Envie o lote para iniciar a aprovação.</div>}
        </article>
      </section>

      <section className="reimbursement-dashboard-grid">
        <article className="panel">
          <div className="panel-heading"><div><span className="eyebrow">Visão de rede</span><h2>Por concessionário</h2><p>Faturamento, margem e impacto do reembolso por operação.</p></div></div>
          <div className="reimbursement-table-wrap"><table className="reimbursement-table"><thead><tr><th>Concessionário</th><th>Linhas</th><th>Qtd.</th><th>Faturamento</th><th>Reembolso</th><th>Margem</th></tr></thead><tbody>{data.byDealership.map((row) => <tr key={row.label}><td><strong>{row.label}</strong></td><td>{row.rows}</td><td>{row.quantity}</td><td>{formatBRL(row.salesCents)}</td><td>{formatBRL(row.reimbursementCents)}</td><td>{formatPercent(row.marginBps)}%</td></tr>)}</tbody></table>{!data.byDealership.length && <div className="empty-mini">Sem dados de concessionárias neste lote.</div>}</div>
        </article>
        <article className="panel">
          <div className="panel-heading"><div><span className="eyebrow">Itens críticos</span><h2>Ranking por PN</h2><p>Priorize os itens com maior impacto de reembolso.</p></div></div>
          <div className="reimbursement-table-wrap"><table className="reimbursement-table"><thead><tr><th>PN</th><th>Qtd.</th><th>Faturamento</th><th>Reembolso</th><th>Margem</th></tr></thead><tbody>{data.byPartNumber.map((row) => <tr key={row.partNumber}><td><strong>{row.partNumber}</strong><small>{row.description}</small></td><td>{row.quantity}</td><td>{formatBRL(row.salesCents)}</td><td>{formatBRL(row.reimbursementCents)}</td><td>{formatPercent(row.marginBps)}%</td></tr>)}</tbody></table>{!data.byPartNumber.length && <div className="empty-mini">Sem itens no lote atual.</div>}</div>
        </article>
      </section>

      <ReimbursementVariationPanel sales={data.sales} />
    </>
  );
}

function ReimbursementVariationPanel({ sales }: { sales: Sale[] }) {
  const grouped = new Map<string, { partNumber: string; description: string; quantity: number; prices: number[]; costs: number[]; netPrices: number[] }>();
  for (const sale of sales) {
    const entry = grouped.get(sale.partNumber) ?? { partNumber: sale.partNumber, description: sale.description, quantity: 0, prices: [], costs: [], netPrices: [] };
    entry.quantity += sale.quantity;
    entry.prices.push(sale.saleNetUnitCents);
    entry.costs.push(sale.costAvgUnitCents);
    if (sale.netPriceUsedCents !== null) entry.netPrices.push(sale.netPriceUsedCents);
    grouped.set(sale.partNumber, entry);
  }
  const rows = [...grouped.values()].map((entry) => {
    const average = (values: number[]) => values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : null;
    const price = average(entry.prices);
    const netPrice = average(entry.netPrices);
    return { ...entry, priceDeltaCents: price !== null && netPrice !== null ? price - netPrice : null, costRangeCents: entry.costs.length ? Math.max(...entry.costs) - Math.min(...entry.costs) : 0 };
  }).sort((left, right) => Math.abs(right.priceDeltaCents ?? 0) + right.costRangeCents - (Math.abs(left.priceDeltaCents ?? 0) + left.costRangeCents)).slice(0, 12);

  return (
    <section className="panel reimbursement-variation-panel">
      <div className="panel-heading"><div><span className="eyebrow">Análise comparativa</span><h2>Variação de preços e custos</h2><p>Preço médio líquido versus Net Price da tabela e amplitude do custo médio unitário dentro do lote.</p></div></div>
      <div className="reimbursement-table-wrap"><table className="reimbursement-table"><thead><tr><th>PN</th><th>Qtd.</th><th>Preço venda × Net Price</th><th>Variação de custo unitário</th></tr></thead><tbody>{rows.map((row) => <tr key={row.partNumber}><td><strong>{row.partNumber}</strong><small>{row.description}</small></td><td>{row.quantity}</td><td className={row.priceDeltaCents !== null && row.priceDeltaCents !== 0 ? "variation-value" : ""}>{signedBRL(row.priceDeltaCents)}</td><td>{formatBRL(row.costRangeCents)}</td></tr>)}</tbody></table>{!rows.length && <div className="empty-mini">Sem dados comparáveis no lote atual.</div>}</div>
    </section>
  );
}
