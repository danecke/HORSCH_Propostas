"use client";

import type { Dispatch, FormEvent, SetStateAction } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

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
  analysisRows: number;
  negativeMarginRows: number;
  netReferenceRows: number;
};
type Sale = {
  id: number;
  dealershipId: number | null;
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
  duplicateKey: string; baseSource: string; baseStatus: string; reasonCode: string; historicalMarginBps: number | null; marginVariationBps: number | null; justification: string; justificationStatus: string;
  workflowRoute: "fast_track" | "exception" | "blocked";
  workflowStatus: "awaiting_global" | "awaiting_dealer_consent" | "awaiting_factory_settlement" | "blocked_negative_margin" | "factory_rejected" | "settled";
  autoCheckJson: string;
  settlementDocumentNumber: string;
  needsAnalysis: boolean;
  negativeMargin: boolean;
  needsNetReference: boolean;
  analysisReason: string;
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
  negativeMarginRecords: number;
  netReferenceRecords: number;
};
type Client = { id: number; legalName: string; cnpj: string; state: string; clientType: string; n2: boolean; n3: boolean; status: string };
type ClientForm = { legalName: string; cnpj: string; state: string; clientType: string; n2: boolean; n3: boolean; status: string };
type AdjustmentForm = {
  partNumber: string;
  description: string;
  clientName: string;
  clientCnpj: string;
  invoiceNumber: string;
  state: string;
  dealershipId: string;
  quantity: string;
  costAvgUnit: string;
  saleNetUnit: string;
  invoiceUnit: string;
  netPrice: string;
  reason: string;
};
type StatusBreakdown = { status: string; count: number; liquidTotalCents: number; reimbursementCents: number };
type FactoryDashboard = {
  summary: { salesCents: number; costCents: number; marginBps: number; reimbursementN2Cents: number; reimbursementN3Cents: number; negotiationCents: number; processedRows: number; totalQuantity: number };
  byPartNumber: Array<{ partNumber: string; description: string; rows: number; quantity: number; salesCents: number; reimbursementCents: number; marginBps: number }>;
  marginByProgram: Array<{ key: "N2" | "N3" | "normal"; label: string; rows: number; quantity: number; salesCents: number; costCents: number; reimbursementCents: number; marginBps: number }>;
  salesByMonthAndDealership: Array<{ month: string; dealershipName: string; rows: number; quantity: number; salesCents: number; costCents: number; n2SalesCents: number; n2CostCents: number; n3SalesCents: number; n3CostCents: number; normalSalesCents: number; normalCostCents: number; reimbursementCents: number; n2ReimbursementCents: number; n3ReimbursementCents: number; negotiationCents: number; totalMarginBps: number; n2MarginBps: number; n3MarginBps: number; normalMarginBps: number }>;
  reimbursementByMonth: Array<{ month: string; reimbursementCents: number; n2Cents: number; n3Cents: number; negotiationCents: number; rows: number }>;
};
type FactoryFilters = { dealershipId: string; dateFrom: string; dateTo: string };
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
  canViewFactoryDashboard: boolean;
  factoryDashboard: FactoryDashboard | null;
  statuses: string[];
  n3TolerancePercent?: number;
};

const STATES = ["AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO", "PY"];
const EMPTY_CLIENT: ClientForm = { legalName: "", cnpj: "", state: "", clientType: "", n2: true, n3: false, status: "active" };

function moneyInput(cents: number | null | undefined) {
  return cents === null || cents === undefined
    ? ""
    : (cents / 100).toFixed(2).replace(".", ",");
}

function inputToCents(value: string) {
  const normalized = value.trim().includes(",")
    ? value.trim().replace(/\./g, "").replace(",", ".")
    : value.trim();
  const number = Number(normalized);
  return Number.isFinite(number) ? Math.round(number * 100) : 0;
}

function formatBRL(cents: number | null | undefined) {
  return (Number(cents ?? 0) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatDate(value: string) {
  return value ? new Date(value).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "—";
}

function formatMonth(value: string) {
  if (!/^\d{4}-\d{2}$/.test(value)) return value || "Sem referência";
  return new Date(`${value}-01T12:00:00Z`).toLocaleDateString("pt-BR", { month: "short", year: "numeric", timeZone: "UTC" });
}

function workflowLabel(status: Sale["workflowStatus"]) {
  return ({
    awaiting_global: "Validação global",
    awaiting_dealer_consent: "Consentimento da concessionária",
    awaiting_factory_settlement: "Liquidação pela fábrica",
    blocked_negative_margin: "Bloqueado · margem negativa",
    factory_rejected: "Recusado pela Fábrica",
    settled: "Liquidado",
  } as const)[status] || status;
}

function formatPercent(basisPoints: number) {
  return (basisPoints / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function statusClass(status: string) {
  if (status.includes("Negociação") || status.includes("Divergência") || status.includes("Duplicada") || status.includes("Rejeitada")) return "danger";
  if (status.includes("Elegível")) return "success";
  if (status.includes("Não Elegível") || status.includes("Encontrado") || status.includes("Cadastro") || status.includes("Pendente") || status.includes("Aprovação Manual") || status.includes("Devolvida")) return "warning";
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

const REQUEST_STEPS = ["Recebida", "Em análise", "Aprovada", "Concluída"] as const;

function requestProgress(status: string) {
  if (status === "paid") return 3;
  if (status === "approved") return 2;
  if (["submitted", "under_review", "rejected"].includes(status)) return 1;
  return 0;
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

function baseSourceLabel(source: string) {
  return ({
    NET_PRICE_REGIONAL: "Preço regional · PN/UF",
    NET_PRICE_NACIONAL: "Preço padrão/nacional",
    NET_PRICE_MANUAL: "NET informado manualmente",
    NET_PRICE_VIGENTE: "NET vigente",
    CUSTO_MEDIO_EXCEPCIONAL: "Custo médio excepcional",
  } as Record<string, string>)[source] ?? source;
}

export function ReimbursementsView({ me, dealerships }: { me: ReimbursementAccess; dealerships: Dealer[] }) {
  const [tab, setTab] = useState<"overview" | "sales" | "import" | "clients">("overview");
  const [data, setData] = useState<DashboardData | null>(null);
  const [clients, setClients] = useState<Client[]>([]);
  const [activeBatchId, setActiveBatchId] = useState(0);
  const [pnFilter, setPnFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [dealerFilter, setDealerFilter] = useState("");
  const [attentionOnly, setAttentionOnly] = useState(false);
  const [factoryFilters, setFactoryFilters] = useState<FactoryFilters>({ dealershipId: "", dateFrom: "", dateTo: "" });
  const [uploadDealerId, setUploadDealerId] = useState("");
  const [uploadDealerIds, setUploadDealerIds] = useState<string[]>([]);
  const [editingClient, setEditingClient] = useState<number | null>(null);
  const [clientForm, setClientForm] = useState<ClientForm>(EMPTY_CLIENT);
  const [adjustingSale, setAdjustingSale] = useState<Sale | null>(null);
  const [adjustmentForm, setAdjustmentForm] = useState<AdjustmentForm | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [toleranceDraft, setToleranceDraft] = useState("");
  const uploadSelectionInitialized = useRef(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const canReview = Boolean(data?.canReview) || ["general_admin", "global_management", "factory_manager"].includes(me.role);
  const canManageClients = Boolean(data?.canManageClients) || ["general_admin", "global_management"].includes(me.role);
  const isAdmin = me.role === "general_admin";
  const dealerScoped = ["dealer_manager", "concession"].includes(me.role);
  const visibleDealerships = data?.dealerships ?? (dealerScoped ? dealerships.filter((dealer) => dealer.id === me.dealershipId) : dealerships);
  const canSelectMultipleDealerships = dealerScoped || visibleDealerships.length > 1;
  const singleScopedDealership = dealerScoped && visibleDealerships.length === 1 ? visibleDealerships[0] : null;
  const effectiveUploadDealerId = canSelectMultipleDealerships ? "" : uploadDealerId;
  const effectiveUploadDealerIds = canSelectMultipleDealerships
    ? uploadDealerIds
    : effectiveUploadDealerId
      ? [effectiveUploadDealerId]
      : [];
  const activeBatch = useMemo(() => data?.imports.find((item) => item.id === activeBatchId) ?? data?.imports[0], [activeBatchId, data?.imports]);
  const load = useCallback(async () => {
    setError("");
    try {
      const params = new URLSearchParams();
      if (activeBatchId) params.set("batchId", String(activeBatchId));
      if (pnFilter.trim()) params.set("pn", pnFilter.trim());
      if (statusFilter !== "all") params.set("status", statusFilter);
      if (dealerFilter) params.set("dealershipId", dealerFilter);
      if (attentionOnly) params.set("attention", "1");
      if (factoryFilters.dealershipId) params.set("factoryDealershipId", factoryFilters.dealershipId);
      if (factoryFilters.dateFrom) params.set("factoryDateFrom", factoryFilters.dateFrom);
      if (factoryFilters.dateTo) params.set("factoryDateTo", factoryFilters.dateTo);
      const response = await fetch(`/api/reimbursements?${params.toString()}`, { cache: "no-store" });
      const payload = await response.json() as DashboardData & { error?: string };
      if (!response.ok) throw new Error(payload.error || "Não foi possível carregar os reembolsos.");
      setData(payload);
      if (isAdmin && typeof payload.n3TolerancePercent === "number")
        setToleranceDraft(String(payload.n3TolerancePercent));
      if (!activeBatchId && payload.activeImportId) setActiveBatchId(payload.activeImportId);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Não foi possível carregar os reembolsos.");
    }
  }, [activeBatchId, attentionOnly, dealerFilter, factoryFilters, isAdmin, pnFilter, statusFilter]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 250);
    return () => window.clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    if (!canSelectMultipleDealerships) {
      uploadSelectionInitialized.current = false;
      return;
    }
    if (!data?.dealerships) return;
    const visibleIds = visibleDealerships.map((dealer) => String(dealer.id));
    if (!uploadSelectionInitialized.current) {
      uploadSelectionInitialized.current = true;
      setUploadDealerIds(visibleIds);
      return;
    }
    setUploadDealerIds((current) => {
      const kept = current.filter((id) => visibleIds.includes(id));
      return kept.length ? kept : visibleIds;
    });
  }, [canSelectMultipleDealerships, data?.dealerships, visibleDealerships]);

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

  async function updateN3Tolerance() {
    const tolerancePercent = Number(toleranceDraft.replace(",", "."));
    if (!Number.isFinite(tolerancePercent) || tolerancePercent < 0 || tolerancePercent > 100) {
      setError("Informe uma tolerância entre 0% e 100%.");
      return;
    }
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/reimbursements", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "update_n3_tolerance", tolerancePercent }),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || "Não foi possível salvar a tolerância.");
      setMessage("Tolerância N3 atualizada para o ADM.");
      await load();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Não foi possível salvar a tolerância.");
    } finally {
      setBusy(false);
    }
  }

  async function uploadSales(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const file = form.get("file");
    if (!(file instanceof File) || !file.size) {
      setError("Selecione a planilha de vendas.");
      return;
    }
    if (file.size > 120 * 1024 * 1024) {
      setError("A planilha deve ter no máximo 120 MB.");
      return;
    }
    if (!/\.(xlsx|csv|tsv)$/i.test(file.name)) {
      setError("Use um arquivo Excel (.xlsx), CSV ou TSV.");
      return;
    }
    const selectedDealerships = visibleDealerships.filter((dealer) =>
      effectiveUploadDealerIds.includes(String(dealer.id)),
    );
    if (canSelectMultipleDealerships && !selectedDealerships.length) {
      setError("Selecione ao menos uma concessionária vinculada ao seu usuário antes de processar a planilha.");
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
          dealershipIds: effectiveUploadDealerIds.length
            ? effectiveUploadDealerIds.map(Number)
            : undefined,
        }),
      });
      const complete = await completeResponse.json() as { import?: { id: number }; error?: string };
      if (!completeResponse.ok) throw new Error(complete.error || "Não foi possível processar a planilha.");

      setUploadProgress(100);
      setMessage("Planilha processada. A solicitação mantém o snapshot da lista de preços e do CPF/CNPJ informado pelo concessionário.");
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

  async function revalidateActiveBatch() {
    if (!activeBatch) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/reimbursements", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: activeBatch.id, action: "revalidate_lines" }),
      });
      const payload = await response.json() as { error?: string; updatedLines?: number };
      if (!response.ok)
        throw new Error(payload.error || "Não foi possível reanalisar a solicitação.");
      setMessage(
        `${payload.updatedLines ?? 0} linha(s) reanalisada(s) com a Lista de Preços ativa, cruzando PN + UF.`,
      );
      await load();
    } catch (revalidationError) {
      setError(
        revalidationError instanceof Error
          ? revalidationError.message
          : "Não foi possível reanalisar a solicitação.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function runLineAction(sale: Sale, action: string) {
    let note = "";
    let netPriceCents: number | undefined;
    if (action === "submit_justification") note = window.prompt("Explique a variação de margem:") ?? "";
    if (action === "question_line") note = window.prompt("O que deve ser questionado nesta linha?") ?? "";
    if (action === "return_line") note = window.prompt("Informe o motivo da devolução:") ?? "";
    if (action === "reject_line") note = window.prompt("Documente o motivo da rejeição desta linha:") ?? "";
    if (action === "global_reject") note = window.prompt("Documente o motivo da recusa pela Fábrica:") ?? "";
    if (["submit_justification", "question_line", "return_line", "reject_line", "global_reject"].includes(action) && note.trim().length < 5) {
      setError("Informe uma observação válida para esta decisão.");
      return;
    }
    if (action === "manual_base_set_net_price") {
      const value = window.prompt("Net Price unitário correto:", "");
      if (!value) return;
      netPriceCents = Math.round(Number(value.replace(",", ".")) * 100);
    }
    setBusy(true);
    try {
      const response = await fetch("/api/reimbursements", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ lineId: sale.id, action, note, netPriceCents }) });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || "Não foi possível atualizar a linha.");
      setMessage("Linha atualizada.");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível atualizar a linha.");
    } finally {
      setBusy(false);
    }
  }

  function openLineAdjustment(sale: Sale) {
    const matchedDealer = visibleDealerships.find(
      (dealer) => dealer.id === sale.dealershipId || dealer.name === sale.dealershipName,
    );
    setAdjustingSale(sale);
    setAdjustmentForm({
      partNumber: sale.partNumber,
      description: sale.description,
      clientName: sale.clientName,
      clientCnpj: sale.clientCnpj,
      invoiceNumber: sale.invoiceNumber,
      state: sale.state,
      dealershipId: matchedDealer ? String(matchedDealer.id) : "",
      quantity: String(sale.quantity),
      costAvgUnit: moneyInput(sale.costAvgUnitCents),
      saleNetUnit: moneyInput(sale.saleNetUnitCents),
      invoiceUnit: moneyInput(sale.invoiceUnitCents),
      netPrice: moneyInput(sale.netPriceUsedCents),
      reason: "",
    });
    setError("");
  }

  async function saveLineAdjustment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!adjustingSale || !adjustmentForm) return;
    if (adjustmentForm.reason.trim().length < 10) {
      setError("Documente o motivo do ajuste com pelo menos 10 caracteres.");
      return;
    }
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/reimbursements", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lineId: adjustingSale.id,
          action: "adjust_line",
          note: adjustmentForm.reason.trim(),
          adjustments: {
            partNumber: adjustmentForm.partNumber,
            description: adjustmentForm.description,
            clientName: adjustmentForm.clientName,
            clientCnpj: adjustmentForm.clientCnpj,
            invoiceNumber: adjustmentForm.invoiceNumber,
            state: adjustmentForm.state,
            dealershipId: Number(adjustmentForm.dealershipId),
            quantity: Number(adjustmentForm.quantity),
            costAvgUnitCents: inputToCents(adjustmentForm.costAvgUnit),
            saleNetUnitCents: inputToCents(adjustmentForm.saleNetUnit),
            invoiceUnitCents: inputToCents(adjustmentForm.invoiceUnit),
            netPriceCents: adjustmentForm.netPrice.trim()
              ? inputToCents(adjustmentForm.netPrice)
              : null,
          },
        }),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok)
        throw new Error(payload.error || "Não foi possível salvar o ajuste.");
      setAdjustingSale(null);
      setAdjustmentForm(null);
      setMessage("Linha ajustada, recalculada e documentada no histórico.");
      await load();
    } catch (adjustmentError) {
      setError(
        adjustmentError instanceof Error
          ? adjustmentError.message
          : "Não foi possível salvar o ajuste.",
      );
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
    if (attentionOnly) params.set("attention", "1");
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
      <header className="reimbursement-command-header">
        <div className="reimbursement-command-copy">
          <div className="reimbursement-command-title">
            <span className="reimbursement-command-mark" aria-hidden="true">R</span>
            <div>
              <span className="eyebrow">Central de performance comercial</span>
              <h1>Reembolsos N2/N3</h1>
            </div>
          </div>
          <p>Uma operação única para importar vendas, conferir exceções e acompanhar o retorno financeiro da rede.</p>
          <div className="reimbursement-command-stats" aria-label="Resumo rápido do módulo">
            <span><small>Perfil</small><strong>{data?.canViewFactoryDashboard ? "Fábrica" : "Concessionária"}</strong></span>
            <span><small>Registros analisados</small><strong>{data?.summary.processedRows ?? 0}</strong></span>
            <span><small>Linhas críticas</small><strong>{data?.summary.attentionRecords ?? 0}</strong></span>
          </div>
        </div>
        <div className="reimbursement-heading-actions">
          <button className="outline-button compact" onClick={() => window.print()}>Exportar PDF</button>
          <button className="primary-button compact" onClick={exportReport}>Exportar Excel</button>
        </div>
      </header>

      <nav className="reimbursement-tabs" aria-label="Seções de reembolsos">
        <button className={tab === "overview" ? "active" : ""} onClick={() => setTab("overview")}><b>01</b><span><strong>Visão gerencial</strong><small>Indicadores e reembolsos</small></span></button>
        <button className={tab === "import" ? "active" : ""} onClick={() => setTab("import")}><b>02</b><span><strong>Importação</strong><small>Nova solicitação</small></span></button>
        <button className={tab === "sales" ? "active" : ""} onClick={() => setTab("sales")}><b>03</b><span><strong>Conferência</strong><small>Análise linha a linha</small></span>{Boolean(data?.summary.attentionRecords) && <em>{data?.summary.attentionRecords}</em>}</button>
        {canManageClients && <button className={tab === "clients" ? "active" : ""} onClick={() => setTab("clients")}><b>04</b><span><strong>Clientes N2/N3</strong><small>Base de elegibilidade</small></span></button>}
      </nav>

      {message && <div className="form-success reimbursement-notice">{message}</div>}
      {error && <div className="form-error reimbursement-notice">{error}</div>}

      {tab === "sales" && data?.imports.length ? (
        <section className="reimbursement-toolbar reimbursement-batch-bar" aria-label="Solicitação ativa">
          <label>
            Solicitação / importação
            <select value={activeBatchId || data.activeImportId} onChange={(event) => setActiveBatchId(Number(event.target.value))}>
              {data.imports.map((item) => <option key={item.id} value={item.id}>{item.fileName} · {formatDate(item.createdAt)} · {statusLabel(item.status)}</option>)}
            </select>
          </label>
          <div className="reimbursement-batch-meta">
            <span>{activeBatch?.rowCount ?? 0} linhas</span>
            <span>{(activeBatch?.totalQuantity ?? 0).toLocaleString("pt-BR")} unidades</span>
            <span>Snapshot da lista vigente</span>
            <span className="request-indicator attention">{activeBatch?.analysisRows ?? 0} para analisar</span>
            <span className="request-indicator negative">{activeBatch?.negativeMarginRows ?? 0} margem negativa</span>
            <span className="request-indicator net">{activeBatch?.netReferenceRows ?? 0} NET necessário</span>
          </div>
          <div className="reimbursement-workflow">
            <span className={`reimbursement-status ${statusClass(activeBatch?.status ?? "")}`}>{statusLabel(activeBatch?.status ?? "")}</span>
            {canReview && activeBatch && <button className="outline-button compact" disabled={busy} onClick={() => void revalidateActiveBatch()} title="Atualiza somente linhas pendentes usando a Lista de Preços ativa">Reanalisar solicitação</button>}
            {workflowButtons}
          </div>
          <div className="reimbursement-request-list">
            <header className="reimbursement-request-list-heading">
              <div><span className="reimbursement-request-list-label">Solicitações enviadas</span><small>Acompanhe o processo e abra somente o que precisar revisar.</small></div>
              <strong>{data.imports.length} solicitações</strong>
            </header>
            <div className="reimbursement-request-cards">
              {data.imports.slice(0, 12).map((item) => (
                <article
                  key={item.id}
                  className={`reimbursement-request-card ${item.id === activeBatch?.id ? "active" : ""}`}
                >
                  <div className="reimbursement-request-identity">
                    <span className="reimbursement-request-symbol" aria-hidden="true">{String(item.id).slice(-2).padStart(2, "0")}</span>
                    <div className="reimbursement-request-card-info">
                      <strong>Solicitação #{item.id}</strong>
                      <small title={item.fileName}>{item.fileName}</small>
                      <span>{formatDate(item.createdAt)} · {item.rowCount} linhas</span>
                    </div>
                  </div>
                  <div className="reimbursement-request-process" aria-label={`Etapa atual: ${statusLabel(item.status)}`}>
                    {REQUEST_STEPS.map((step, index) => {
                      const progress = requestProgress(item.status);
                      return <span key={step} className={index < progress ? "done" : index === progress ? "current" : ""}><i aria-hidden="true" /><small>{step}</small></span>;
                    })}
                  </div>
                  <div className="reimbursement-request-pending" aria-label="Pendências da solicitação">
                    {item.analysisRows > 0 ? <span className="attention">{item.analysisRows} analisar</span> : <span className="clear">Sem pendências</span>}
                    {item.negativeMarginRows > 0 && <span className="negative">{item.negativeMarginRows} margem negativa</span>}
                    {item.netReferenceRows > 0 && <span className="net">{item.netReferenceRows} NET</span>}
                  </div>
                  <span className={`reimbursement-status ${statusClass(item.status)}`}>{statusLabel(item.status)}</span>
                  <button
                    type="button"
                    className="reimbursement-request-open"
                    aria-label={`Abrir detalhes da solicitação ${item.id}`}
                    title="Abrir detalhes"
                    onClick={() => { setActiveBatchId(item.id); setTab("sales"); }}
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.4 12s3.5-6 9.6-6 9.6 6 9.6 6-3.5 6-9.6 6-9.6-6-9.6-6Z" /><circle cx="12" cy="12" r="2.7" /></svg>
                  </button>
                </article>
              ))}
            </div>
          </div>
        </section>
      ) : tab === "sales" && (
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
                <h2>Importação de dados</h2>
                <p>Envie a planilha no padrão HORSCH e transforme cada arquivo em uma solicitação rastreável.</p>
              </div>
            </div>

            <div className="reimbursement-import-steps" aria-label="Passos para importar">
              <div><strong>1</strong><span>Baixe o modelo Excel.</span></div>
              <div><strong>2</strong><span>Preencha as vendas unitárias.</span></div>
              <div><strong>3</strong><span>Crie a solicitação e confira por linha.</span></div>
            </div>

            <div className="reimbursement-template-actions">
              <a className="primary-button compact" href="/modelos/modelo-importacao-reembolsos-n2-n3.xlsx" download>Baixar modelo Excel</a>
              <a className="outline-button compact" href="/modelos/reembolsos-vendas-exemplo.csv" download>Baixar exemplo CSV</a>
            </div>

            <div className="reimbursement-template">
              <strong>Campos obrigatórios</strong>
              <span>PN · Descrição · Quantidade · Custo Médio Líquido Unitário · Valor Venda Líquido Unitário · Valor Venda NF Unitário · Cliente · CPF/CNPJ · NF · Estado</span>
              <small>PN aceita 00180123 ou 180123: os zeros à esquerda são desconsiderados na conferência. CPF/CNPJ deve ter 11 ou 14 dígitos. A primeira aba do Excel precisa ser <b>Vendas</b>. {canSelectMultipleDealerships ? "Selecione as lojas da solicitação; a UF de cada linha define qual cadastro e preço N3 serão consultados." : "Concessionário pode ser informado no arquivo ou selecionado abaixo."}</small>
            </div>

            <div className="form-grid">
              <label className="field full">
                <span>Planilha de vendas *</span>
                <input name="file" type="file" accept=".xlsx,.csv,.tsv" required />
                <small>Formatos aceitos: Excel (.xlsx), CSV e TSV. Tamanho máximo: 120 MB.</small>
              </label>
              {canSelectMultipleDealerships ? (
                <fieldset className="field reimbursement-dealer-checklist">
                  <legend>Concessionárias da solicitação *</legend>
                  <small>Selecione todas as lojas que receberão os dados. Cada linha será encaminhada pela UF da planilha para a concessionária cadastrada naquele estado.</small>
                  <div className="reimbursement-dealer-selection-actions">
                    <button
                      type="button"
                      className="outline-button compact"
                      onClick={() => setUploadDealerIds(visibleDealerships.map((dealer) => String(dealer.id)))}
                    >
                      Selecionar todas
                    </button>
                    <button
                      type="button"
                      className="outline-button compact"
                      onClick={() => setUploadDealerIds([])}
                    >
                      Limpar seleção
                    </button>
                    <span>{effectiveUploadDealerIds.length} de {visibleDealerships.length} selecionadas</span>
                  </div>
                  <div className="reimbursement-dealer-options">
                    {visibleDealerships.map((dealer) => (
                      <label key={dealer.id}>
                        <input
                          type="checkbox"
                          checked={effectiveUploadDealerIds.includes(String(dealer.id))}
                          onChange={(event) =>
                            setUploadDealerIds((current) =>
                              event.target.checked
                                ? [...new Set([...current, String(dealer.id)])]
                                : current.filter((id) => id !== String(dealer.id)),
                            )
                          }
                        />
                        <span>{dealer.name}{dealer.state ? " — " + dealer.state : ""}</span>
                      </label>
                    ))}
                  </div>
                  <small>Exemplo: BA consulta o N3 do PN na UF BA; PI consulta o N3 do mesmo PN na UF PI.</small>
                </fieldset>
              ) : (
                <label className="field">
                  <span>Concessionária</span>
                  <select value={effectiveUploadDealerId} onChange={(event) => setUploadDealerId(event.target.value)} required={dealerScoped}>
                    <option value="">Usar concessionária da planilha</option>
                    {visibleDealerships.map((dealer) => <option value={dealer.id} key={dealer.id}>{dealer.name}</option>)}
                  </select>
                  <small>Quando informado, o UF de cada linha também será conferido com o cadastro da concessionária.</small>
                </label>
              )}
              {isAdmin && (
                <section className="field n3-tolerance-form" aria-label="Configuração administrativa da tolerância N3">
                  <span>Tolerância N3 — ADM</span>
                  <div className="n3-tolerance-input">
                    <input value={toleranceDraft} onChange={(event) => setToleranceDraft(event.target.value)} inputMode="decimal" min="0" max="100" step="0.1" type="number" aria-label="Tolerância N3 em porcentagem" />
                    <span>%</span>
                    <button type="button" className="outline-button compact" disabled={busy} onClick={() => void updateN3Tolerance()}>Salvar</button>
                  </div>
                  <small>Parâmetro administrativo aplicado às próximas solicitações. Não é exibido para outros perfis.</small>
                </section>
              )}
            </div>

            {uploadProgress > 0 && <div className="upload-progress" aria-label={`Upload ${uploadProgress}%`}><span style={{ width: `${uploadProgress}%` }} /><small>{uploadProgress}%</small></div>}
            <button className="primary-button" disabled={busy}>{busy ? "Processando planilha..." : "Processar e criar solicitação"}</button>
          </form>

          <aside className="panel reimbursement-rules">
            <span className="eyebrow">Validações aplicadas</span>
            <h2>Antes de criar a solicitação</h2>
            <div className="n2n3-explainer-grid">
              <article className="n2n3-explainer-card n2">
                <span>N2</span>
                <strong>Análise de margem</strong>
                <p>Compara venda líquida e custo médio líquido. Até 20% de margem entra no programa N2.</p>
              </article>
              <article className="n2n3-explainer-card n3">
                <span>N3</span>
                <strong>Conferência por PN e UF</strong>
                <p>Compara o valor da NF com o N3 vigente da lista de preços para o mesmo PN e Estado.</p>
              </article>
            </div>
            <ul>
              <li>A análise é fragmentada por linha: uma pendência não bloqueia a conferência das demais linhas da solicitação.</li>
              <li>O PN é conferido sem considerar zeros à esquerda; 00180123 e 180123 consultam o mesmo cadastro.</li>
              <li>O cliente é localizado pelo CPF/CNPJ e UF na base de clientes N2/N3.</li>
              <li>Preço: primeiro cruza PN + UF; sem valor regional, utiliza Padrão/Nacional quando disponível.</li>
              <li>N2: margem menor ou igual a 20% e reembolso de 4% sobre a base.</li>
              <li>{isAdmin ? "N3: NF unitária compatível com N3 do PN/UF, com tolerância configurada em " + (data?.n3TolerancePercent ?? (toleranceDraft || "—")) + "%, e reembolso de 7%." : "N3: NF unitária compatível com o valor N3 vigente do PN/UF e reembolso de 7%."}</li>
              <li>Base: Net Price vigente × quantidade; sem Net Price, custo médio líquido × quantidade.</li>
              <li>Margem negativa em N3 gera valor para negociação com a fábrica.</li>
            </ul>
          </aside>
        </section>
      )}

      {tab === "overview" && data && <ExecutiveOverview data={data} isFactoryView={data.canViewFactoryDashboard} dealerships={visibleDealerships} factoryFilters={factoryFilters} onFactoryFiltersChange={setFactoryFilters} />}

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
            {dealerScoped && singleScopedDealership ? (
              <label>Concessionária<input value={singleScopedDealership.name} readOnly aria-readonly="true" /></label>
            ) : (
              <label>Concessionária<select value={dealerFilter} onChange={(event) => setDealerFilter(event.target.value)}><option value="">{dealerScoped ? "Todas as vinculadas" : "Todas"}</option>{visibleDealerships.map((dealer) => <option value={dealer.id} key={dealer.id}>{dealer.name}</option>)}</select></label>
            )}
            <label className="reimbursement-filter-check"><input type="checkbox" checked={attentionOnly} onChange={(event) => setAttentionOnly(event.target.checked)} />Mostrar apenas linhas que exigem análise</label>
          </div>

          <div className="reimbursement-line-analysis-summary" aria-label="Resumo da análise da solicitação">
            <span><strong>{data.summary.attentionRecords}</strong> linhas precisam de análise</span>
            <span><strong>{data.summary.negativeMarginRecords}</strong> com margem negativa</span>
            <span><strong>{data.summary.netReferenceRecords}</strong> precisam de NET de referência</span>
          </div>

          <div className="reimbursement-sales-list" role="table" aria-label="Itens da solicitação">
            <div className="reimbursement-sales-list-head" role="row">
              <span role="columnheader">Item</span>
              <span role="columnheader">Cliente e operação</span>
              <span role="columnheader">Valores da venda</span>
              <span role="columnheader">Análise e reembolso</span>
              <span role="columnheader">Decisão</span>
            </div>
            {data.sales.map((sale) => (
              <article className={`reimbursement-sale-row ${sale.needsAnalysis ? "attention" : ""}`} role="row" key={sale.id}>
                <div className="reimbursement-sale-product" role="cell">
                  <div><span className="reimbursement-sale-index">#{sale.id}</span><strong>{sale.partNumber}</strong></div>
                  <p>{sale.description || "Sem descrição"}</p>
                  <small>{sale.dealershipName || "Concessionária não informada"}</small>
                </div>
                <div className="reimbursement-sale-operation" role="cell">
                  <strong>{sale.clientName || "Cliente não informado"}</strong>
                  <small>{sale.clientCnpj || "CPF/CNPJ não informado"}</small>
                  <div><span>NF {sale.invoiceNumber || "—"}</span><span>{sale.state || "UF —"}</span><span>{sale.quantity} un.</span></div>
                </div>
                <div className="reimbursement-sale-values" role="cell">
                  <div><span>Valor líquido</span><strong>{formatBRL(sale.liquidTotalCents)}</strong></div>
                  <div><span>Custo total</span><b>{formatBRL(sale.costTotalCents)}</b></div>
                  <div><span>Margem</span><b className={sale.negativeMargin ? "negative-value" : ""}>{formatPercent(sale.marginBps)}%</b></div>
                </div>
                <div className="reimbursement-sale-analysis" role="cell">
                  <div className="reimbursement-sale-analysis-top"><span className={`reimbursement-analysis-flag ${sale.workflowRoute === "fast_track" ? "clear" : "attention"}`}>{sale.workflowRoute === "fast_track" ? "Via rápida" : sale.workflowRoute === "blocked" ? "Bloqueada" : "Exceção"}</span><span className={`reimbursement-status ${statusClass(sale.status)}`}>{sale.status}</span></div>
                  <div className="reimbursement-sale-reimbursement"><span>Reembolso</span><strong>{formatBRL(sale.reimbursementCents)}</strong><small>{sale.reimbursementProgram || "Sem programa"}</small></div>
                  {sale.reimbursementProgram === "N3" && (
                    <div className="reimbursement-sale-reference">
                      <span>NF N3 na lista · {sale.state || "UF —"}</span>
                      <strong>{sale.expectedN3Cents !== null ? formatBRL(sale.expectedN3Cents) : "Não encontrada"}</strong>
                      <small>
                        NF informada {formatBRL(sale.invoiceUnitCents)} · {sale.priceDifferenceCents === null ? "sem referência" : `diferença ${signedBRL(sale.priceDifferenceCents)}`}
                      </small>
                    </div>
                  )}
                  <small><strong>{workflowLabel(sale.workflowStatus)}</strong></small>
                  <small>{sale.analysisReason || (sale.expectedN3Cents !== null ? `N3 ${formatBRL(sale.expectedN3Cents)} · Δ ${signedBRL(sale.priceDifferenceCents)}` : "Linha sem pendências")}</small>
                  <small>Base {formatBRL(sale.calculationBaseCents)} · {sale.needsNetReference ? "NET necessário" : sale.netPriceUsedCents === null ? "Custo médio" : `${baseSourceLabel(sale.baseSource)} · ${formatBRL(sale.netPriceUsedCents)}`}</small>
                </div>
                <div className="reimbursement-sale-decision" role="cell">
                  <div className="reimbursement-decision-actions">
                    {canManageClients && (
                      <>
                        {sale.workflowStatus === "awaiting_global" && <button className="reimbursement-line-action accept" disabled={busy} onClick={() => void runLineAction(sale, "global_approve")}><span>✓</span>Aprovar exceção</button>}
                        <button className="reimbursement-line-action adjust" disabled={busy} onClick={() => openLineAdjustment(sale)}><span>✎</span>Ajustar</button>
                        {sale.workflowStatus === "awaiting_global" && <button className="reimbursement-line-action reject" disabled={busy} onClick={() => void runLineAction(sale, "global_reject")}><span>×</span>Recusar</button>}
                      </>
                    )}
                    {me.role === "dealer_manager" && sale.workflowStatus === "awaiting_dealer_consent" && <button className="reimbursement-line-action accept" disabled={busy} onClick={() => void runLineAction(sale, "dealer_consent")}><span>✓</span>De acordo</button>}
                    {["general_admin", "factory_manager"].includes(me.role) && sale.workflowStatus === "awaiting_factory_settlement" && <button className="reimbursement-line-action accept" disabled={busy} onClick={() => void runLineAction(sale, "factory_settle")}><span>✓</span>Liquidar</button>}
                    {sale.workflowStatus === "settled" && <a className="outline-button compact" href={`/api/reimbursements?settlementDocument=${sale.id}`} download>Baixar documento</a>}
                    {sale.status === "Pendente Justificativa" && dealerScoped && <button className="outline-button compact" onClick={() => void runLineAction(sale, "submit_justification")}>Enviar justificativa</button>}
                  </div>
                  <small title={sale.justification}>{sale.justification ? `Registro: ${sale.justification}` : sale.negotiationCents ? `${formatBRL(sale.negotiationCents)} em negociação` : "Aguardando decisão"}</small>
                </div>
              </article>
            ))}
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

      {adjustingSale && adjustmentForm && (
        <div className="reimbursement-adjust-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target && !busy) { setAdjustingSale(null); setAdjustmentForm(null); } }}>
          <aside className="reimbursement-adjust-drawer" role="dialog" aria-modal="true" aria-labelledby="adjust-line-title">
            <div className="reimbursement-adjust-header">
              <div>
                <span className="eyebrow">Conferência por linha</span>
                <h2 id="adjust-line-title">Ajustar linha #{adjustingSale.id}</h2>
                <p>Edite os dados de origem. Margem, elegibilidade e reembolso serão recalculados ao salvar.</p>
              </div>
              <button type="button" className="reimbursement-adjust-close" aria-label="Fechar ajuste" disabled={busy} onClick={() => { setAdjustingSale(null); setAdjustmentForm(null); }}>×</button>
            </div>

            <form className="reimbursement-adjust-form" onSubmit={(event) => void saveLineAdjustment(event)}>
              <section>
                <div className="reimbursement-adjust-section-title"><span>01</span><div><h3>Produto e documento</h3><p>Identificação da venda importada.</p></div></div>
                <div className="reimbursement-adjust-grid">
                  <label><span>PN *</span><input value={adjustmentForm.partNumber} onChange={(event) => setAdjustmentForm({ ...adjustmentForm, partNumber: event.target.value })} required /></label>
                  <label><span>Nota fiscal *</span><input value={adjustmentForm.invoiceNumber} onChange={(event) => setAdjustmentForm({ ...adjustmentForm, invoiceNumber: event.target.value })} required /></label>
                  <label className="full"><span>Descrição *</span><input value={adjustmentForm.description} onChange={(event) => setAdjustmentForm({ ...adjustmentForm, description: event.target.value })} required /></label>
                </div>
              </section>

              <section>
                <div className="reimbursement-adjust-section-title"><span>02</span><div><h3>Cliente e operação</h3><p>O cliente será validado novamente por CPF/CNPJ e UF.</p></div></div>
                <div className="reimbursement-adjust-grid">
                  <label className="full"><span>Cliente *</span><input value={adjustmentForm.clientName} onChange={(event) => setAdjustmentForm({ ...adjustmentForm, clientName: event.target.value })} required /></label>
                  <label><span>CPF/CNPJ *</span><input value={adjustmentForm.clientCnpj} onChange={(event) => setAdjustmentForm({ ...adjustmentForm, clientCnpj: event.target.value })} required /></label>
                  <label><span>UF *</span><select value={adjustmentForm.state} onChange={(event) => setAdjustmentForm({ ...adjustmentForm, state: event.target.value })} required><option value="">Selecione</option>{STATES.map((state) => <option key={state}>{state}</option>)}</select></label>
                  <label className="full"><span>Concessionária *</span><select value={adjustmentForm.dealershipId} onChange={(event) => setAdjustmentForm({ ...adjustmentForm, dealershipId: event.target.value })} required><option value="">Selecione</option>{visibleDealerships.map((dealer) => <option value={dealer.id} key={dealer.id}>{dealer.name}{dealer.state ? ` · ${dealer.state}` : ""}</option>)}</select></label>
                </div>
              </section>

              <section>
                <div className="reimbursement-adjust-section-title"><span>03</span><div><h3>Quantidade e valores</h3><p>Valores unitários em reais.</p></div></div>
                <div className="reimbursement-adjust-grid values">
                  <label><span>Quantidade *</span><input type="number" min="1" step="1" value={adjustmentForm.quantity} onChange={(event) => setAdjustmentForm({ ...adjustmentForm, quantity: event.target.value })} required /></label>
                  <label><span>Custo médio líquido *</span><div className="reimbursement-money-input"><i>R$</i><input inputMode="decimal" value={adjustmentForm.costAvgUnit} onChange={(event) => setAdjustmentForm({ ...adjustmentForm, costAvgUnit: event.target.value })} required /></div></label>
                  <label><span>Venda líquida unitária *</span><div className="reimbursement-money-input"><i>R$</i><input inputMode="decimal" value={adjustmentForm.saleNetUnit} onChange={(event) => setAdjustmentForm({ ...adjustmentForm, saleNetUnit: event.target.value })} required /></div></label>
                  <label><span>Venda NF unitária *</span><div className="reimbursement-money-input"><i>R$</i><input inputMode="decimal" value={adjustmentForm.invoiceUnit} onChange={(event) => setAdjustmentForm({ ...adjustmentForm, invoiceUnit: event.target.value })} required /></div></label>
                  <label className="full"><span>NET de referência</span><div className="reimbursement-money-input"><i>R$</i><input inputMode="decimal" value={adjustmentForm.netPrice} onChange={(event) => setAdjustmentForm({ ...adjustmentForm, netPrice: event.target.value })} placeholder="Deixe vazio para consultar a lista vigente" /></div><small>Quando informado, este NET manual ficará registrado como base do cálculo.</small></label>
                </div>
              </section>

              <section className="reimbursement-adjust-reason">
                <div className="reimbursement-adjust-section-title"><span>04</span><div><h3>Motivo do ajuste</h3><p>Obrigatório para manter a rastreabilidade da decisão.</p></div></div>
                <label><span>Documente o que foi corrigido e por quê *</span><textarea rows={4} minLength={10} value={adjustmentForm.reason} onChange={(event) => setAdjustmentForm({ ...adjustmentForm, reason: event.target.value })} placeholder="Ex.: Valor líquido corrigido conforme a NF anexada pelo concessionário." required /></label>
                <div className="reimbursement-adjust-audit-note"><span>✓</span><p>O sistema salvará o responsável, data, motivo e um comparativo completo entre os valores anteriores e os novos.</p></div>
              </section>

              <div className="reimbursement-adjust-footer">
                <button type="button" className="outline-button" disabled={busy} onClick={() => { setAdjustingSale(null); setAdjustmentForm(null); }}>Cancelar</button>
                <button className="primary-button" disabled={busy}>{busy ? "Salvando..." : "Salvar e recalcular"}</button>
              </div>
            </form>
          </aside>
        </div>
      )}
    </div>
  );
}

function ExecutiveOverview({ data, isFactoryView, dealerships, factoryFilters, onFactoryFiltersChange }: { data: DashboardData; isFactoryView: boolean; dealerships: Dealer[]; factoryFilters: FactoryFilters; onFactoryFiltersChange: Dispatch<SetStateAction<FactoryFilters>> }) {
  const overviewSummary = isFactoryView && data.factoryDashboard
    ? data.factoryDashboard.summary
    : data.summary;
  const rankingByPart = isFactoryView && data.factoryDashboard
    ? data.factoryDashboard.byPartNumber
    : data.byPartNumber;
  const overviewByDealership = isFactoryView && data.factoryDashboard
    ? [...data.factoryDashboard.salesByMonthAndDealership.reduce((grouped, row) => {
        const current = grouped.get(row.dealershipName) ?? { label: row.dealershipName, rows: 0, quantity: 0, salesCents: 0, reimbursementCents: 0, costCents: 0 };
        current.rows += row.rows;
        current.quantity += row.quantity;
        current.salesCents += row.salesCents;
        current.reimbursementCents += row.reimbursementCents;
        current.costCents += row.costCents;
        grouped.set(row.dealershipName, current);
        return grouped;
      }, new Map<string, { label: string; rows: number; quantity: number; salesCents: number; reimbursementCents: number; costCents: number }>()).values()]
        .map((row) => ({ ...row, marginBps: row.salesCents ? Math.round(((row.salesCents - row.costCents) / row.salesCents) * 10000) : 0 }))
        .sort((left, right) => right.salesCents - left.salesCents)
    : data.byDealership;
  const marginSegments = isFactoryView && data.factoryDashboard
    ? data.factoryDashboard.marginByProgram.map((segment) => ({
        key: segment.key,
        label: segment.key === "normal" ? "Cliente Normal" : `Margem ${segment.key}`,
        description: segment.label,
        rows: segment.rows,
        salesCents: segment.salesCents,
        marginBps: segment.marginBps,
      }))
    : [
        { key: "N2", label: "Margem N2", description: "Clientes nível 2" },
        { key: "N3", label: "Margem N3", description: "Clientes nível 3" },
        { key: "normal", label: "Cliente Normal", description: "Vendas sem programa" },
      ].map((segment) => {
        const rows = data.sales.filter((sale) => sale.status !== "Rejeitada" && (segment.key === "normal" ? !sale.reimbursementProgram : sale.reimbursementProgram === segment.key));
        const salesCents = rows.reduce((sum, sale) => sum + sale.liquidTotalCents, 0);
        const costCents = rows.reduce((sum, sale) => sum + sale.costTotalCents, 0);
        return { ...segment, rows: rows.length, salesCents, marginBps: salesCents ? Math.round(((salesCents - costCents) / salesCents) * 10000) : 0 };
      });
  return (
    <>
      <section className={`reimbursement-view-context ${isFactoryView ? "factory" : "dealership"}`}>
        <div>
          <span className="eyebrow">{isFactoryView ? "Visão da fábrica" : "Visão da concessionária"}</span>
          <h2>{isFactoryView ? "Controle consolidado da carteira" : "Acompanhamento da sua operação"}</h2>
          <p>{isFactoryView ? "Acompanhe indicadores consolidados por concessionária, período, PN e classificação de cliente." : "Acompanhe os indicadores comerciais e financeiros da operação da concessionária."}</p>
        </div>
        <span className="reimbursement-view-badge">{isFactoryView ? "Análise ampliada" : "Escopo da concessionária"}</span>
      </section>

      {isFactoryView && (
        <FactoryFilterBar
          dealerships={dealerships}
          filters={factoryFilters}
          onFiltersChange={onFactoryFiltersChange}
        />
      )}

      <section className="reimbursement-section-heading">
        <div><span className="eyebrow">Resultado do período</span><h2>Indicadores essenciais</h2></div>
        <small>Valores atualizados conforme os filtros selecionados</small>
      </section>

      <section className={`reimbursement-kpi-grid ${isFactoryView ? "factory-view" : "dealer-view"}`}>
        <article className="reimbursement-kpi primary"><div className="reimbursement-kpi-top"><span>Valor líquido vendido</span><i>R$</i></div><strong>{formatBRL(overviewSummary.salesCents)}</strong><small>{overviewSummary.processedRows} registros no filtro atual</small></article>
        <article className="reimbursement-kpi accent"><div className="reimbursement-kpi-top"><span>Reembolso projetado</span><i>↗</i></div><strong>{formatBRL(overviewSummary.reimbursementN2Cents + overviewSummary.reimbursementN3Cents)}</strong><small>N2 + N3 elegíveis</small></article>
        {isFactoryView && <article className="reimbursement-kpi margin"><div className="reimbursement-kpi-top"><span>Margem consolidada</span><i>%</i></div><strong>{formatPercent(overviewSummary.marginBps)}%</strong><small>Vendas líquidas versus custo</small></article>}
        <article className="reimbursement-kpi n2"><div className="reimbursement-kpi-top"><span>Reembolso Nível 2</span><i>N2</i></div><strong>{formatBRL(overviewSummary.reimbursementN2Cents)}</strong><small>Programa N2 · 4%</small></article>
        <article className="reimbursement-kpi n3"><div className="reimbursement-kpi-top"><span>Reembolso Nível 3</span><i>N3</i></div><strong>{formatBRL(overviewSummary.reimbursementN3Cents)}</strong><small>Programa N3 · 7%</small></article>
        <article className="reimbursement-kpi danger"><div className="reimbursement-kpi-top"><span>Negociação fábrica</span><i>!</i></div><strong>{formatBRL(overviewSummary.negotiationCents)}</strong><small>Margem negativa em Nível 3</small></article>
      </section>

      <section className="reimbursement-dashboard-grid">
        <article className="panel">
          <div className="panel-heading"><div><span className="eyebrow">Visão de rede</span><h2>Por concessionário</h2><p>Faturamento, margem e impacto do reembolso por operação.</p></div></div>
          <div className="reimbursement-table-wrap"><table className="reimbursement-table"><thead><tr><th>Concessionário</th><th>Linhas</th><th>Qtd.</th><th>Faturamento</th><th>Reembolso</th><th>Margem</th></tr></thead><tbody>{overviewByDealership.map((row) => <tr key={row.label}><td><strong>{row.label}</strong></td><td>{row.rows}</td><td>{row.quantity}</td><td>{formatBRL(row.salesCents)}</td><td>{formatBRL(row.reimbursementCents)}</td><td>{formatPercent(row.marginBps)}%</td></tr>)}</tbody></table>{!overviewByDealership.length && <div className="empty-mini">Sem dados de concessionárias no período selecionado.</div>}</div>
        </article>
        <article className="panel">
          <div className="panel-heading"><div><span className="eyebrow">Desempenho por item</span><h2>Ranking de vendas por PN</h2><p>Ordenado pelo maior valor líquido vendido no período selecionado.</p></div></div>
          <div className="reimbursement-table-wrap"><table className="reimbursement-table"><thead><tr><th>PN</th><th>Qtd.</th><th>Valor líquido</th><th>Reembolso</th><th>Margem</th></tr></thead><tbody>{rankingByPart.map((row) => <tr key={row.partNumber}><td><strong>{row.partNumber}</strong><small>{row.description}</small></td><td>{row.quantity}</td><td>{formatBRL(row.salesCents)}</td><td>{formatBRL(row.reimbursementCents)}</td><td>{formatPercent(row.marginBps)}%</td></tr>)}</tbody></table>{!rankingByPart.length && <div className="empty-mini">Sem itens no período selecionado.</div>}</div>
        </article>
      </section>

      <section className="reimbursement-section-heading compact">
        <div><span className="eyebrow">Rentabilidade</span><h2>Margem por classificação de cliente</h2></div>
      </section>
      <section className="reimbursement-margin-segments">
        {marginSegments.map((segment) => (
          <article className={`panel reimbursement-margin-segment ${segment.key}`} key={segment.key}>
            <span className="eyebrow">{segment.description}</span>
            <h3>{segment.label}</h3>
            <strong>{formatPercent(segment.marginBps)}%</strong>
            <small>{segment.rows} linhas no recorte atual · margem sobre valor líquido</small>
          </article>
        ))}
      </section>

      {isFactoryView && data.factoryDashboard && <FactoryPerformanceDashboard dashboard={data.factoryDashboard} />}

    </>
  );
}

function FactoryFilterBar({ dealerships, filters, onFiltersChange }: { dealerships: Dealer[]; filters: FactoryFilters; onFiltersChange: Dispatch<SetStateAction<FactoryFilters>> }) {
  return (
    <div className="factory-filter-bar" aria-label="Filtros exclusivos da visão da fábrica">
      <div className="factory-filter-intro"><span>Filtros da fábrica</span><small>Refine toda a visão gerencial</small></div>
      <label>Concessionária<select value={filters.dealershipId} onChange={(event) => onFiltersChange((current) => ({ ...current, dealershipId: event.target.value }))}><option value="">Todas as concessionárias</option>{dealerships.map((dealer) => <option value={dealer.id} key={dealer.id}>{dealer.name}</option>)}</select></label>
      <label>Data inicial<input type="date" value={filters.dateFrom} onChange={(event) => onFiltersChange((current) => ({ ...current, dateFrom: event.target.value }))} /></label>
      <label>Data final<input type="date" value={filters.dateTo} onChange={(event) => onFiltersChange((current) => ({ ...current, dateTo: event.target.value }))} /></label>
      <button className="outline-button compact" type="button" onClick={() => onFiltersChange({ dealershipId: "", dateFrom: "", dateTo: "" })}>Limpar filtros</button>
    </div>
  );
}

function FactoryPerformanceDashboard({ dashboard }: { dashboard: FactoryDashboard }) {
  const calendarMonth = new Date().toISOString().slice(0, 7);
  const currentMonth = dashboard.reimbursementByMonth.find((item) => item.month === calendarMonth) ?? dashboard.reimbursementByMonth[0];
  const historyTotal = dashboard.reimbursementByMonth.reduce((sum, item) => sum + item.reimbursementCents, 0);
  const historyN2 = dashboard.reimbursementByMonth.reduce((sum, item) => sum + item.n2Cents, 0);
  const historyN3 = dashboard.reimbursementByMonth.reduce((sum, item) => sum + item.n3Cents, 0);
  const maxReimbursement = Math.max(1, ...dashboard.reimbursementByMonth.map((item) => item.reimbursementCents));
  return (
    <section className="factory-dashboard">
      <div className="factory-dashboard-heading">
        <div>
          <span className="eyebrow">Visão da fábrica</span>
          <h2>Carteira, margem e reembolso</h2>
          <p>Use os filtros para analisar uma concessionária, um período específico ou toda a carteira histórica.</p>
        </div>
      </div>

      <div className="factory-reimbursement-kpis">
        <article className="panel factory-reimbursement-kpi current"><span>Reembolso no mês</span><strong>{formatBRL(currentMonth?.reimbursementCents ?? 0)}</strong><small>{currentMonth ? `${formatMonth(currentMonth.month)}${currentMonth.month === calendarMonth ? " · mês corrente" : " · último mês com dados"}` : "Sem dados no período"}</small></article>
        <article className="panel factory-reimbursement-kpi history"><span>Reembolso histórico</span><strong>{formatBRL(historyTotal)}</strong><small>{dashboard.reimbursementByMonth.length} meses · N2 {formatBRL(historyN2)} · N3 {formatBRL(historyN3)}</small></article>
        <article className="panel factory-reimbursement-kpi negotiation"><span>Negociação com fábrica</span><strong>{formatBRL(dashboard.reimbursementByMonth.reduce((sum, item) => sum + item.negotiationCents, 0))}</strong><small>Margem negativa no recorte</small></article>
      </div>

      <div className="factory-margin-grid">
        {dashboard.marginByProgram.map((segment) => (
          <article className={`panel factory-margin-card ${segment.key}`} key={segment.key}>
            <span className="eyebrow">{segment.label}</span>
            <strong>{formatPercent(segment.marginBps)}%</strong>
            <small>Margem sobre vendas líquidas</small>
            <dl>
              <div><dt>Faturamento</dt><dd>{formatBRL(segment.salesCents)}</dd></div>
              <div><dt>Custo</dt><dd>{formatBRL(segment.costCents)}</dd></div>
              <div><dt>Quantidade</dt><dd>{segment.quantity.toLocaleString("pt-BR")}</dd></div>
              <div><dt>Reembolso</dt><dd>{formatBRL(segment.reimbursementCents)}</dd></div>
            </dl>
          </article>
        ))}
      </div>

      <div className="factory-reimbursement-grid">
        <article className="panel factory-reimbursement-chart">
          <div className="panel-heading"><div><span className="eyebrow">Histórico</span><h2>Reembolso por mês</h2><p>Comparativo mensal no período selecionado.</p></div></div>
          {dashboard.reimbursementByMonth.length ? <div className="factory-reimbursement-bars">{dashboard.reimbursementByMonth.slice(0, 12).map((item) => <div className="factory-reimbursement-bar-row" key={item.month}><div><strong>{formatMonth(item.month)}</strong><small>{item.rows} linhas · N2 {formatBRL(item.n2Cents)} · N3 {formatBRL(item.n3Cents)}</small></div><div className="factory-reimbursement-bar"><span style={{ width: `${Math.max(3, (item.reimbursementCents / maxReimbursement) * 100)}%` }} /></div><b>{formatBRL(item.reimbursementCents)}</b></div>)}</div> : <div className="empty-mini">Sem dados de reembolso no período.</div>}
        </article>
        <article className="panel factory-reimbursement-summary">
          <div className="panel-heading"><div><span className="eyebrow">Composição</span><h2>Como o reembolso se distribui</h2><p>Valores projetados por programa dentro do histórico filtrado.</p></div></div>
          <div className="factory-reimbursement-summary-list">
            <div><span>Nível 2</span><strong>{formatBRL(historyN2)}</strong><small>{historyTotal ? `${((historyN2 / historyTotal) * 100).toFixed(1)}% do histórico` : "Sem base"}</small></div>
            <div><span>Nível 3</span><strong>{formatBRL(historyN3)}</strong><small>{historyTotal ? `${((historyN3 / historyTotal) * 100).toFixed(1)}% do histórico` : "Sem base"}</small></div>
            <div><span>Negociação</span><strong>{formatBRL(dashboard.reimbursementByMonth.reduce((sum, item) => sum + item.negotiationCents, 0))}</strong><small>Valor a tratar com a fábrica</small></div>
          </div>
        </article>
      </div>

      <article className="panel factory-monthly-panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">Detalhamento histórico</span>
            <h2>Vendas por mês e concessionária</h2>
            <p>Margem e reembolso separados por tipo de cliente para apoiar a decisão comercial.</p>
          </div>
          <span className="section-count">{dashboard.salesByMonthAndDealership.length} agrupamentos</span>
        </div>
        <div className="reimbursement-table-wrap">
          <table className="reimbursement-table factory-monthly-table">
            <thead><tr><th>Mês</th><th>Concessionária</th><th>Linhas</th><th>Qtd.</th><th>Faturamento</th><th>Reembolso</th><th>Margem total</th><th>Vendas N2</th><th>Margem N2</th><th>Vendas N3</th><th>Margem N3</th><th>Vendas normais</th><th>Margem normal</th></tr></thead>
            <tbody>
              {dashboard.salesByMonthAndDealership.map((row) => (
                <tr key={`${row.month}-${row.dealershipName}`}>
                  <td><strong>{formatMonth(row.month)}</strong></td>
                  <td>{row.dealershipName}</td>
                  <td>{row.rows}</td>
                  <td>{row.quantity.toLocaleString("pt-BR")}</td>
                  <td>{formatBRL(row.salesCents)}</td>
                  <td>{formatBRL(row.reimbursementCents)}</td>
                  <td>{formatPercent(row.totalMarginBps)}%</td>
                  <td>{formatBRL(row.n2SalesCents)}</td>
                  <td>{formatPercent(row.n2MarginBps)}%</td>
                  <td>{formatBRL(row.n3SalesCents)}</td>
                  <td>{formatPercent(row.n3MarginBps)}%</td>
                  <td>{formatBRL(row.normalSalesCents)}</td>
                  <td>{formatPercent(row.normalMarginBps)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!dashboard.salesByMonthAndDealership.length && <div className="empty-mini">Ainda não há vendas processadas na carteira para montar o histórico mensal.</div>}
        </div>
      </article>
    </section>
  );
}
