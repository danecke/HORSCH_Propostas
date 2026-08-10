"use client";

import type { FormEvent, ReactNode } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { AppUser } from "../lib/auth";

type UserRole = "general_admin" | "global_management" | "factory_manager" | "dealer_manager" | "concession";
const PROPOSAL_RESPONSIBLE_ROLES: UserRole[] = ["general_admin", "global_management", "factory_manager"];
type ProposalStatus =
  | "draft"
  | "sent"
  | "counteroffer"
  | "approved"
  | "rejected"
  | "expired";

type ProposalItem = {
  id: number;
  proposalId: string;
  partNumber: string;
  description: string;
  vt: string;
  origin: string;
  ncm: string;
  quantity: number;
  unitPriceCents: number;
  counterofferQuantity: number | null;
  counterofferUnitPriceCents: number | null;
};

type ProposalDocument = {
  id: number;
  proposalId: string;
  category: "invoice" | "proof" | "other";
  fileName: string;
  contentType: string;
  sizeBytes: number;
  uploadedByEmail: string;
  uploadedByName: string;
  createdAt: string;
};

type Proposal = {
  id: string;
  dealershipId: number;
  dealership: string;
  city: string;
  state: string;
  contactName: string;
  contactEmail: string;
  factoryManagerEmail: string;
  commercialOwner: string;
  status: ProposalStatus;
  issueDate: string;
  validUntil: string;
  totalCents: number;
  customerName: string;
  customerSaleValueCents: number | null;
  commercialOwnerEmail: string;
  isActionOwner: boolean;
  counterofferCents: number | null;
  decisionNote: string;
  decidedByEmail: string;
  counterofferPaymentTerms: string;
  counterofferFreightTerms: string;
  counterofferDeliveryTerms: string;
  counterofferSubmittedAt: string | null;
  counterofferReviewedAt: string | null;
  counterofferReviewedByEmail: string;
  counterofferReviewNote: string;
  emailStatus: "not_requested" | "processing" | "sent" | "pending_configuration" | "failed";
  emailSentAt: string | null;
  emailError: string;
  createdByEmail: string;
  createdAt: string;
  updatedAt: string;
  items: ProposalItem[];
  documents: ProposalDocument[];
};

type QuoteStatus = "global_review" | "data_pending" | "returned" | "approved" | "rejected" | "order_pending" | "order_input";
type Quote = {
  id: string; partNumber: string; dealershipId: number; dealership: string; city: string; state: string;
  requestedByEmail: string; requestedByName: string; status: QuoteStatus; statusLabel: string;
  isActionOwner: boolean; actionOwnerRole: string; actionOwnerLabel: string; actionOwnerName: string; actionOwnerEmail: string;
  description: string; vt: string; origin: string; netPriceCents: number | null; targetNetPriceCents: number | null; requestObservation: string; catalogImportedAt: string | null;
  requestedQuantity: number; approvedQuantity: number | null; priceListIncluded: boolean; priceListIncludedAt: string | null; priceListIncludedByEmail: string | null;
  actionNote: string; requestedAt: string; returnedAt: string | null; decidedAt: string | null; decidedByEmail: string;
  factoryActionAt: string | null; updatedAt: string;
};

type Dealership = {
  id: number;
  name: string;
  city: string;
  state: string;
  contactName: string;
  contactEmail: string;
  factoryManagerEmail: string;
  factoryManagerName: string;
  dealerManagerName: string;
  dealerManagerEmail: string;
  proposals: number;
  approved: number;
  totalCents: number;
  lastProposalAt: string;
};

type AccessUser = {
  email: string;
  name: string;
  role: UserRole;
  roleLabel: string;
  dealershipId: number | null;
  active: boolean;
  credentialReady: boolean;
  createdAt: string;
};

type CurrentAccess = {
  email: string;
  name: string;
  role: UserRole;
  roleLabel: string;
  dealershipId: number | null;
  active: boolean;
  permissions: {
    viewAll: boolean;
    viewPriceList: boolean;
    requestQuote: boolean;
    respondQuote: boolean;
    createProposal: boolean;
    editPriceList: boolean;
    publishPriceList: boolean;
    manageDSH: boolean;
    createCampaign: boolean;
    analyzeQuotes: boolean;
    viewOpenQuotes: boolean;
    approveQuoteReturn: boolean;
    placeOrder: boolean;
    manageAllAccess: boolean;
    manageAccess: boolean;
    assignLowerPermission: boolean;
    restoreLowerPassword: boolean;
    decideProposal: boolean;
    deleteAnyProposal: boolean;
    deleteOwnDraft: boolean;
  };
};

type DashboardData = {
  proposals: Proposal[];
  quotes: Quote[];
  dealerships: Dealership[];
  users: AccessUser[];
  proposalResponsibles: AccessUser[];
  me: CurrentAccess;
};

type AuditEntry = { id: number; proposalId: string | null; actorEmail: string; actorName: string; action: string; entity: string; details: string; beforeJson: string; afterJson: string; createdAt: string };
type View = "overview" | "proposals" | "quotes" | "quote-analysis" | "dealerships" | "access" | "history";

const STATUS_LABELS: Record<ProposalStatus, string> = {
  draft: "Rascunho",
  sent: "Enviada",
  counteroffer: "Contraproposta",
  approved: "Aceita",
  rejected: "Recusada",
  expired: "Expirada",
};

const STATUS_ORDER: ProposalStatus[] = [
  "draft",
  "sent",
  "counteroffer",
  "approved",
  "rejected",
  "expired",
];

type IconName =
  | "grid"
  | "file"
  | "building"
  | "users"
  | "plus"
  | "search"
  | "arrow"
  | "trend"
  | "check"
  | "clock"
  | "money"
  | "print"
  | "key"
  | "trash"
  | "close"
  | "eye"
  | "history";

function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  const paths: Record<IconName, ReactNode> = {
    grid: <><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /></>,
    file: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" /><path d="M14 2v6h6M8 13h8M8 17h6" /></>,
    building: <><path d="M3 21h18M6 21V7l6-4 6 4v14M9 10h1M14 10h1M9 14h1M14 14h1M10 21v-4h4v4" /></>,
    users: <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></>,
    plus: <path d="M12 5v14M5 12h14" />,
    search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></>,
    arrow: <><path d="M5 12h14M13 6l6 6-6 6" /></>,
    trend: <><path d="m3 17 6-6 4 4 8-8" /><path d="M14 7h7v7" /></>,
    check: <path d="m5 12 4 4L19 6" />,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    money: <><circle cx="12" cy="12" r="9" /><path d="M16 8.5c-.8-.6-2-.9-3.1-.9-1.7 0-2.9.8-2.9 2s1 1.8 3 2.2c2 .4 3 1.1 3 2.3s-1.2 2.2-3 2.2c-1.3 0-2.6-.4-3.5-1.1M13 5v14" /></>,
    print: <><path d="M6 9V3h12v6M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" /><path d="M6 14h12v7H6z" /></>,
    key: <><circle cx="8" cy="15" r="4" /><path d="m11 12 9-9M17 6l3 3M14 9l3 3" /></>,
    trash: <><path d="M4 7h16M9 7V4h6v3M7 7l1 14h8l1-14M10 11v6M14 11v6" /></>,
    close: <path d="m6 6 12 12M18 6 6 18" />,
    eye: <><path d="M2.5 12s3.5-5 9.5-5 9.5 5 9.5 5-3.5 5-9.5 5-9.5-5-9.5-5Z" /><circle cx="12" cy="12" r="2.2" /></>,
    history: <><path d="M3 12a9 9 0 1 0 3-6.7" /><path d="M3 4v5h5M12 7v5l3 2" /></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

function BrandMark({ className = "" }: { className?: string }) {
  return <svg className={className} viewBox="0 0 73 74" aria-hidden="true"><path fill="currentColor" d="M36.5 1.5C16.9 1.5 1.1 17.4 1.1 37s15.9 35.4 35.4 35.4S71.9 56.5 71.9 37C72 17.4 56.1 1.5 36.5 1.5Zm-.3 38.6-11.9 0c-.6 0-1.1.4-1.2.9l-2.9 10.6c-.3 1-1.2 1.7-2.2 1.7l-2.5 0c-1.2 0-2-1.1-1.7-2.2l3-11.1 1.8-6.4 3.2-11.8c.2-.8 1-1.4 1.9-1.4h3.2c.9 0 1.6.9 1.4 1.8l-2.8 10.4c-.1.5.2 1 .8 1h11.4c.9 0 1.6.9 1.4 1.8l-.8 3.1c-.2 1-.9 1.6-1.8 1.6Zm25.9-4.6-.8 3.1c-.2.9-1 1.5-1.9 1.5H48c-.6 0-1.5.4-1.7.9l-2.9 10.6c-.3 1-1.2 1.7-2.2 1.7h-2.5c-1.2 0-2-1.1-1.7-2.2l3-11.1 1.8-6.4L45 21.8c.2-.8 1-1.4 1.9-1.4h3.2c.9 0 1.6.9 1.4 1.8l-2.8 10.4c-.1.5.2 1 .8 1h11.4c.8.1 1.5 1 1.2 1.9Z" /></svg>;
}

function HorschDocumentLogo() {
  return (
    <div className="document-logo" role="img" aria-label="HORSCH">
      <svg
        className="document-logo-svg"
        viewBox="0 0 493 73.8"
        aria-hidden="true"
      >
        <polygon fill="currentColor" points="144,5.4 138.1,27.4 122.3,27.4 128.2,5.4 104.6,5.4 87.4,69 111.1,69 117.2,46.2 133,46.2 126.8,69 150.5,69 167.6,5.4" />
        <path fill="currentColor" d="M207.1,4.1c-21.5,0-37.3,11.6-43,32.9c-5.9,21.7,3.8,32.9,25.3,32.9c21.5,0,37.4-11.2,43.3-32.9C238.4,15.6,228.6,4.1,207.1,4.1z M207.9,37c-1.9,6.8-5.1,17.6-14.4,17.6c-8.5,0-6.6-10.8-4.7-17.6c1.6-5.9,5.4-17.6,14.2-17.6C212,19.4,209.4,31,207.9,37z" />
        <path fill="currentColor" d="M283.6,39c9.4-2.2,16.6-7.1,19.3-16.9c3.3-12.2-4.5-17-19.2-17h-38.2l-17.1,63.6h23.6l6.2-22.3l1.5,3.9l6.8,18.4h26.7l-14.7-28.9L283.6,39z M266.7,32.9h-6.2l3.6-13.6h6.5c4.8,0,9,0.8,7.5,6.6C276.4,32.4,271.5,32.9,266.7,32.9z" />
        <path fill="currentColor" d="M341.5,19.4c6.7,0,12.6,1.3,17.4,3.2l4.4-16.3C357.3,4.9,350.2,4,343.5,4c-14,0-32.5,3.1-37.2,20.6c-6.6,24.7,27.8,17,25.5,25.5c-.9,3.2-6.2,4.4-11.8,4.4c-7.1,0-14.4-1.5-20-4.2l-4.4,16.5c8.3,2.1,15.5,3,24.6,3c13.7,0,31.1-4.3,35.7-21.3c6.6-24.5-27.9-16.7-25.6-25C331.4,19.5,337.8,19.4,341.5,19.4z" />
        <path fill="currentColor" d="M386.2,36.4c2.8-10.4,11.9-16,21.9-16c4,0,7.6,1.1,11.2,2.4l4.5-16.8c-6-1.2-9.7-2-16.2-2c-19.8,0-39.8,10.7-45.5,32c-6.1,22.7,7.3,33.8,27.8,33.8c6,0,12.9-1.3,17.6-2.6l4.5-16.9c-4.7,1.6-9.1,2.5-13.5,2.5C388.8,52.9,383.2,47.4,386.2,36.4z" />
        <polygon fill="currentColor" points="468.7,5.2 462.8,27.1 447,27.1 452.9,5.2 429.2,5.2 412.1,68.8 435.7,68.8 441.9,45.9 457.7,45.9 451.5,68.8 475.2,68.8 492.3,5.2" />
        <path fill="currentColor" d="M36.5,1.5C16.9,1.5,1.1,17.4,1.1,37s15.9,35.4,35.4,35.4S71.9,56.5,71.9,37C72,17.4,56.1,1.5,36.5,1.5z M36.2,40.1H24.3c-.6,0-1.1.4-1.2.9l-2.9,10.6c-.3,1-1.2,1.7-2.2,1.7h-2.5c-1.2,0-2-1.1-1.7-2.2l3-11.1l1.8-6.4l3.2-11.8c.2-.8,1-1.4,1.9-1.4h3.2c.9,0,1.6.9,1.4,1.8l-2.8,10.4c-.1.5.2,1,.8,1h11.4c.9,0,1.6.9,1.4,1.8l-.8,3.1C37.9,39.5,37.1,40.1,36.2,40.1z M62.1,35.5l-.8,3.1c-.2.9-1,1.5-1.9,1.5H48c-.6,0-1.5.4-1.7.9l-2.9,10.6c-.3,1-1.2,1.7-2.2,1.7h-2.5c-1.2,0-2-1.1-1.7-2.2l3-11.1l1.8-6.4L45,21.8c.2-.8,1-1.4,1.9-1.4h3.2c.9,0,1.6.9,1.4,1.8l-2.8,10.4c-.1.5.2,1,.8,1h11.4C61.7,33.7,62.4,34.6,62.1,35.5z" />
      </svg>
    </div>
  );
}

export function Dashboard({ user }: { user: AppUser }) {
  const [view, setView] = useState<View>("overview");
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | ProposalStatus>("all");
  const [showNewProposal, setShowNewProposal] = useState(false);
  const [showNewAccess, setShowNewAccess] = useState(false);
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [editProposal, setEditProposal] = useState<Proposal | null>(null);
  const [preview, setPreview] = useState<Proposal | null>(null);
  const [historyProposalId, setHistoryProposalId] = useState<string | null>(null);
  const [notice, setNotice] = useState("");

  const loadData = useCallback(async () => {
    try {
      setError("");
      const response = await fetch("/api/proposals", { cache: "no-store" });
      const payload = (await response.json()) as DashboardData & { error?: string };
      if (!response.ok) throw new Error(payload.error || "Não foi possível carregar os dados.");
      const quoteResponse = payload.me.role === "concession" ? null : await fetch("/api/quotes", { cache: "no-store" });
      const quotePayload = quoteResponse ? ((await quoteResponse.json()) as { quotes?: Quote[]; error?: string }) : { quotes: [] };
      if (quoteResponse && !quoteResponse.ok) throw new Error(quotePayload.error || "Não foi possível carregar as cotações.");
      setData({ ...payload, quotes: quotePayload.quotes ?? [] });
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Erro ao carregar dados.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { const timer = window.setTimeout(() => void loadData(), 0); return () => window.clearTimeout(timer); }, [loadData]);
  useEffect(() => {
    const interval = window.setInterval(() => void loadData(), 60_000);
    return () => window.clearInterval(interval);
  }, [loadData]);
  useEffect(() => { if (!notice) return; const timer = window.setTimeout(() => setNotice(""), 4200); return () => window.clearTimeout(timer); }, [notice]);

  const filteredProposals = useMemo(() => {
    const term = search.trim().toLocaleLowerCase("pt-BR");
    return (data?.proposals ?? []).filter((proposal) => {
      const matchesStatus = statusFilter === "all" || proposal.status === statusFilter;
      const matchesTerm = !term || [proposal.id, proposal.dealership, proposal.commercialOwner].some((value) => value.toLocaleLowerCase("pt-BR").includes(term));
      return matchesStatus && matchesTerm;
    });
  }, [data, search, statusFilter]);

  if (loading) return <LoadingState />;
  if (error || !data) return <ErrorState message={error || "Acesso não disponível."} retry={loadData} />;
  const canCreate = data.me.permissions.createProposal;
  const concessionOnly = data.me.role === "concession";
  const proposalResponsibles = data.proposalResponsibles.filter((item) => item.active);
  async function refreshed(message: string) { setNotice(message); await loadData(); }
  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.assign("/");
  }

  function openHistory(proposalId: string) {
    setHistoryProposalId(proposalId);
    setView("history");
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand-lockup"><BrandMark className="brand-mark" /><div><strong>HORSCH</strong><span>Brasil</span></div></div>
        <div className="role-card"><span>Perfil ativo</span><strong>{data.me.roleLabel}</strong><small>{scopeDescription(data.me)}</small></div>
        <nav className="sidebar-nav" aria-label="Navegação principal">
          {concessionOnly ? <NavButton active icon="file" onClick={() => setView("overview")}>Lista de preços</NavButton> : <><NavButton active={view === "overview"} icon="grid" onClick={() => setView("overview")}>Visão geral</NavButton><NavButton active={view === "proposals"} icon="file" onClick={() => setView("proposals")}>Propostas</NavButton><NavButton active={view === "quotes"} icon="clock" onClick={() => setView("quotes")}>Cotações</NavButton><NavButton active={view === "dealerships"} icon="building" onClick={() => setView("dealerships")}>Concessionárias</NavButton>{data.me.permissions.manageAccess && <NavButton active={view === "access"} icon="users" onClick={() => setView("access")}>Acessos</NavButton>}</>}
        </nav>
        {canCreate && <button className="sidebar-new" onClick={() => setShowNewProposal(true)}><Icon name="plus" size={17} />Nova proposta</button>}
        <div className="sidebar-account-actions"><button type="button" onClick={() => setShowChangePassword(true)}><Icon name="key" size={15} />Alterar senha</button></div>
        <div className="sidebar-footer"><div className="user-avatar">{initials(user.displayName)}</div><div className="user-copy"><strong>{user.displayName}</strong><span>{user.email}</span></div><button className="signout-link" type="button" onClick={() => void signOut()} title="Sair" aria-label="Sair">↗</button></div>
      </aside>

      <section className="workspace">
        <header className="mobile-header"><div className="mobile-lockup"><BrandMark className="mobile-mark" /><strong>HORSCH</strong></div><span className="mobile-role">{data.me.roleLabel}</span></header>
        {notice && <div className="toast" role="status"><Icon name="check" size={17} />{notice}</div>}
        {view === "history" && <button type="button" className="outline-button compact back-button workspace-back-button" onClick={() => { setView("proposals"); setHistoryProposalId(null); }}>← Voltar às propostas</button>}
        {concessionOnly ? <PriceListView /> : view === "overview" ? (
          <Overview data={data} onNew={() => setShowNewProposal(true)} onOpen={setPreview} onHistory={openHistory} onAll={() => setView("proposals")} />
        ) : view === "proposals" ? (
          <ProposalsView proposals={filteredProposals} allCount={data.proposals.length} search={search} onSearch={setSearch} status={statusFilter} onStatus={setStatusFilter} canCreate={canCreate} onNew={() => setShowNewProposal(true)} onOpen={setPreview} canViewHistory={data.me.role === "general_admin"} onHistory={openHistory} />
        ) : view === "quotes" ? (
          <QuotesView quotes={data.quotes} me={data.me} onChanged={() => refreshed("Cotação atualizada com sucesso.")} />
        ) : view === "dealerships" ? (
          <DealershipsView dealerships={data.dealerships} proposals={data.proposals} onOpen={setPreview} />
        ) : view === "access" ? (
          <AccessView data={data} onNew={() => setShowNewAccess(true)} onChanged={() => refreshed("Acesso atualizado com segurança.")} />
        ) : (
          <HistoryView proposalId={historyProposalId} />
        )}
        <nav className="mobile-nav" aria-label="Navegação móvel">
          {!concessionOnly && <><NavButton active={view === "overview"} icon="grid" onClick={() => setView("overview")}>Visão</NavButton><NavButton active={view === "proposals"} icon="file" onClick={() => setView("proposals")}>Propostas</NavButton><NavButton active={view === "quotes"} icon="clock" onClick={() => setView("quotes")}>Cotações</NavButton><NavButton active={view === "dealerships"} icon="building" onClick={() => setView("dealerships")}>Rede</NavButton>{data.me.permissions.manageAccess && <NavButton active={view === "access"} icon="users" onClick={() => setView("access")}>Acessos</NavButton>}</>}
        </nav>
      </section>

      {showNewProposal && <NewProposalModal userEmail={data.me.email} role={data.me.role} dealerships={data.dealerships} proposalResponsibles={proposalResponsibles} onClose={() => setShowNewProposal(false)} onSaved={async (message) => { setShowNewProposal(false); await refreshed(message); }} />}
      {showNewAccess && <NewAccessModal me={data.me} dealerships={data.dealerships} onClose={() => setShowNewAccess(false)} onSaved={async () => { setShowNewAccess(false); await refreshed("Novo acesso criado com sucesso."); }} />}
      {showChangePassword && <ChangePasswordModal onClose={() => setShowChangePassword(false)} onSaved={() => { setShowChangePassword(false); setNotice("Senha alterada com sucesso."); }} />}
      {editProposal && <NewProposalModal userEmail={data.me.email} role={data.me.role} dealerships={data.dealerships} proposalResponsibles={proposalResponsibles} proposal={editProposal} onClose={() => setEditProposal(null)} onSaved={async (message) => { setEditProposal(null); await refreshed(message); }} />}
      {preview && <ProposalPreview proposal={preview} me={data.me} onClose={() => setPreview(null)} onEdit={() => { setEditProposal(preview); setPreview(null); }} onDeleted={async () => { setPreview(null); await refreshed("Proposta excluída com sucesso."); }} onUpdated={async (status, counterofferCents) => { setPreview({ ...preview, status, counterofferCents: counterofferCents ?? null }); await refreshed("Proposta atualizada com sucesso."); }} />}
    </main>
  );
}

type QuoteInsight = {
  partNumber: string;
  description: string;
  vt: string;
  origin: string;
  netPriceCents: number | null;
  quotes: Quote[];
  requests: number;
  dealerships: number;
  returned: number;
  orders: number;
  approvedQuantity: number;
  rejected: number;
  active: number;
  conversion: number;
  rejectionRate: number;
  averageCycleDays: number | null;
  lastRequest: string;
  priceListIncluded: boolean;
};

function buildQuoteInsights(quotes: Quote[]) {
  const groups = new Map<string, Quote[]>();
  quotes.forEach((quote) => groups.set(quote.partNumber, [...(groups.get(quote.partNumber) ?? []), quote]));
  return Array.from(groups.entries()).map(([partNumber, items]): QuoteInsight => {
    const ordered = items.filter((quote) => quote.status === "order_input");
    const approved = items.filter((quote) => ["order_pending", "order_input"].includes(quote.status));
    const rejected = items.filter((quote) => quote.status === "rejected");
    const decided = items.filter((quote) => ["order_input", "rejected"].includes(quote.status));
    const cycleDays = items.flatMap((quote) => {
      const end = quote.factoryActionAt || quote.decidedAt || quote.returnedAt || quote.updatedAt;
      const days = Math.round((new Date(end).getTime() - new Date(quote.requestedAt).getTime()) / 86400000);
      return Number.isFinite(days) && days >= 0 ? [days] : [];
    });
    const first = items[0];
    return {
      partNumber,
      description: items.find((quote) => quote.description)?.description || "Descrição pendente",
      vt: items.find((quote) => quote.vt)?.vt || "—",
      origin: items.find((quote) => quote.origin)?.origin || "—",
      netPriceCents: items.find((quote) => quote.netPriceCents)?.netPriceCents ?? null,
      quotes: items,
      requests: items.length,
      dealerships: new Set(items.map((quote) => quote.dealershipId)).size,
      returned: items.filter((quote) => ["returned", "approved", "rejected", "order_pending", "order_input"].includes(quote.status)).length,
      orders: ordered.length,
      approvedQuantity: approved.reduce((sum, quote) => sum + (quote.approvedQuantity || 0), 0),
      rejected: rejected.length,
      active: items.filter((quote) => ["global_review", "data_pending", "returned", "order_pending"].includes(quote.status)).length,
      conversion: decided.length ? Math.round((ordered.length / decided.length) * 100) : 0,
      rejectionRate: decided.length ? Math.round((rejected.length / decided.length) * 100) : 0,
      averageCycleDays: cycleDays.length ? Math.round(cycleDays.reduce((sum, days) => sum + days, 0) / cycleDays.length) : null,
      lastRequest: items.map((quote) => quote.requestedAt).sort().at(-1) || first.requestedAt,
      priceListIncluded: items.some((quote) => quote.priceListIncluded),
    };
  }).sort((left, right) => right.requests - left.requests || right.orders - left.orders || right.lastRequest.localeCompare(left.lastRequest));
}

function quoteRecommendation(insight: QuoteInsight) {
  if (insight.approvedQuantity > 5) {
    return { label: "Priorizar lista", tone: "positive", reason: `A quantidade aprovada acumulada é de ${insight.approvedQuantity} unidades, acima do limite de 5.` };
  }
  if (insight.rejected >= 2 && insight.approvedQuantity === 0) {
    return { label: "Não priorizar", tone: "negative", reason: "As negativas superam a demanda convertida até o momento." };
  }
  if (insight.requests >= 2) {
    return { label: "Validar demanda", tone: "attention", reason: "O item se repete, mas ainda precisa de mais conversão para entrar na lista." };
  }
  return { label: "Manter sob cotação", tone: "neutral", reason: "Ainda não há histórico suficiente para uma decisão estrutural." };
}

function QuoteAnalysisView({ quotes, me, onChanged }: { quotes: Quote[]; me: CurrentAccess; onChanged: () => Promise<void> }) {
  const [period, setPeriod] = useState<"all" | "30" | "90">("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedPart, setSelectedPart] = useState("");
  const [selectedParts, setSelectedParts] = useState<string[]>([]);
  const [updatingPart, setUpdatingPart] = useState("");
  const filteredQuotes = useMemo(() => {
    if (period === "all") return quotes;
    const latestRequest = quotes.reduce((latest, quote) => Math.max(latest, new Date(quote.requestedAt).getTime()), 0);
    const limit = latestRequest - Number(period) * 86400000;
    return quotes.filter((quote) => new Date(quote.requestedAt).getTime() >= limit);
  }, [period, quotes]);
  const insights = useMemo(() => buildQuoteInsights(filteredQuotes), [filteredQuotes]);
  const visibleInsights = useMemo(() => {
    const term = searchTerm.trim().toLocaleLowerCase("pt-BR");
    return insights.filter((insight) => !term || [insight.partNumber, insight.description, insight.vt].some((value) => value.toLocaleLowerCase("pt-BR").includes(term)));
  }, [insights, searchTerm]);
  const selectedKey = visibleInsights.some((insight) => insight.partNumber === selectedPart) ? selectedPart : visibleInsights[0]?.partNumber || "";
  const selected = visibleInsights.find((insight) => insight.partNumber === selectedKey) || visibleInsights[0];
  const priorityCount = insights.filter((insight) => quoteRecommendation(insight).tone === "positive" && !insight.priceListIncluded).length;
  const orderCount = filteredQuotes.filter((quote) => quote.status === "order_input").length;
  const pendingCount = filteredQuotes.filter((quote) => ["global_review", "data_pending", "returned", "order_pending"].includes(quote.status)).length;
  const selectedInsights = visibleInsights.filter((insight) => selectedParts.includes(insight.partNumber));
  const canManagePriceList = me.permissions.editPriceList;

  function togglePart(partNumber: string) {
    setSelectedParts((current) => current.includes(partNumber) ? current.filter((item) => item !== partNumber) : [...current, partNumber]);
  }
  function selectRecommended() {
    setSelectedParts(insights.filter((insight) => quoteRecommendation(insight).tone === "positive" && !insight.priceListIncluded).map((insight) => insight.partNumber));
  }
  function downloadPriceList() {
    if (!selectedInsights.length) return;
    const escapeCsv = (value: string | number) => `"${String(value).replace(/"/g, '""')}"`;
    const rows = [
      ["PN", "Descrição", "VT", "Origem", "Net price", "Quantidade aprovada", "Recomendação", "Já incluído na lista"],
      ...selectedInsights.map((insight) => [insight.partNumber, insight.description, insight.vt, insight.origin, insight.netPriceCents ? formatBRL(insight.netPriceCents) : "", insight.approvedQuantity, quoteRecommendation(insight).label, insight.priceListIncluded ? "Sim" : "Não"]),
    ];
    const blob = new Blob(["\ufeff" + rows.map((row) => row.map(escapeCsv).join(";")).join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a"); link.href = url; link.download = "itens-lista-de-precos.csv"; link.click(); URL.revokeObjectURL(url);
  }
  async function togglePriceList(insight: QuoteInsight) {
    if (!canManagePriceList) return;
    setUpdatingPart(insight.partNumber);
    const response = await fetch("/api/quotes", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: insight.quotes[0]?.id, action: "toggle_price_list" }) });
    const payload = (await response.json()) as { error?: string };
    setUpdatingPart("");
    if (!response.ok) return;
    await onChanged();
    if (payload.error) return;
  }

  if (!quotes.length) return <article className="panel"><EmptyState title="Ainda não há dados para analisar" text="As solicitações de cotação aparecerão aqui agrupadas por PN." /></article>;

  return <div className="analysis-page quote-analysis-embedded">
    <header className="analysis-heading"><div><span className="eyebrow">Decisão de portfólio</span><h2>Análise 360º</h2><p>Exporte os itens recomendados e marque os PNs já incluídos na lista de preços.</p></div><div className="analysis-controls"><label><span>Período</span><select value={period} onChange={(event) => setPeriod(event.target.value as "all" | "30" | "90")}><option value="all">Todo o histórico</option><option value="90">Últimos 90 dias</option><option value="30">Últimos 30 dias</option></select></label><label className="analysis-search"><span>Localizar PN</span><input value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} placeholder="PN, descrição ou VT" /></label></div></header>
    <section className="analysis-summary-grid"><MetricCard label="PNs analisados" value={String(insights.length)} meta="Itens distintos no recorte" icon="file" tone="red" /><MetricCard label="Priorizar lista" value={String(priorityCount)} meta="Quantidade aprovada > 5" icon="check" tone="green" /><MetricCard label="Já controlados" value={String(insights.filter((insight) => insight.priceListIncluded).length)} meta="Marcados na lista de preços" icon="history" tone="dark" /><MetricCard label="Unidades aprovadas" value={String(insights.reduce((sum, insight) => sum + insight.approvedQuantity, 0))} meta={`${orderCount} pedidos concluídos`} icon="money" tone="dark" /><MetricCard label="Em andamento" value={String(pendingCount)} meta="Ainda exigem acompanhamento" icon="clock" tone="amber" /></section>
    <section className="analysis-method panel"><div className="analysis-method-icon"><Icon name="trend" size={20} /></div><div><span className="eyebrow">Critério objetivo</span><strong>Recomendar lista quando a quantidade aprovada superar 5 unidades.</strong><p>A decisão usa a soma das quantidades aprovadas nas cotações do PN. O check registra o controle da lista e evita nova extração do mesmo item.</p></div><div className="analysis-bulk-actions"><button className="outline-button compact" type="button" onClick={selectRecommended}>Selecionar recomendados</button><button className="primary-button compact" type="button" disabled={!selectedInsights.length} onClick={downloadPriceList}>Baixar CSV ({selectedInsights.length})</button></div></section>
    <div className="analysis-layout"><section className="panel analysis-ranking"><header className="analysis-section-header"><div><span className="eyebrow">Matriz de decisão</span><h2>Itens para lista de preços</h2><p>Marque os itens para exportar em massa. Clique na linha para ver os detalhes.</p></div><strong>{visibleInsights.length} itens</strong></header><div className="analysis-table-wrap"><table className="analysis-table"><thead><tr><th aria-label="Selecionar" /><th>PN / item</th><th>Aprovada</th><th>Pedidos</th><th>Concessionárias</th><th>Recomendação</th><th>Controle</th></tr></thead><tbody>{visibleInsights.map((insight) => { const recommendation = quoteRecommendation(insight); return <tr key={insight.partNumber} className={selected?.partNumber === insight.partNumber ? "selected" : ""} onClick={() => setSelectedPart(insight.partNumber)}><td><input aria-label={`Selecionar PN ${insight.partNumber}`} type="checkbox" checked={selectedParts.includes(insight.partNumber)} onChange={() => togglePart(insight.partNumber)} onClick={(event) => event.stopPropagation()} /></td><td><strong>{insight.partNumber}</strong><small>{insight.description}</small></td><td><strong>{insight.approvedQuantity} un.</strong><small>limite: 5</small></td><td><strong>{insight.orders}</strong><small>{insight.rejected} negativas</small></td><td><strong>{insight.dealerships}</strong><small>{insight.dealerships === 1 ? "rede local" : "rede HORSCH"}</small></td><td><span className={`analysis-recommendation ${recommendation.tone}`}>{recommendation.label}</span></td><td>{insight.priceListIncluded ? <span className="price-list-check"><Icon name="check" size={14} />Incluído</span> : <span className="price-list-pending">Pendente</span>}</td></tr>; })}</tbody></table>{!visibleInsights.length && <div className="empty-mini">Nenhum PN corresponde ao filtro informado.</div>}</div></section>{selected && <QuoteAnalysisDetail insight={selected} canManagePriceList={canManagePriceList} updating={updatingPart === selected.partNumber} onToggle={() => void togglePriceList(selected)} />}</div>
  </div>;
}

function QuoteAnalysisDetail({ insight, canManagePriceList, updating, onToggle }: { insight: QuoteInsight; canManagePriceList: boolean; updating: boolean; onToggle: () => void }) {
  const recommendation = quoteRecommendation(insight);
  const statusCounts = [
    ["Em análise", insight.quotes.filter((quote) => ["global_review", "data_pending"].includes(quote.status)).length],
    ["Retornadas", insight.quotes.filter((quote) => quote.status === "returned").length],
    ["Em pedido", insight.quotes.filter((quote) => ["order_pending", "order_input"].includes(quote.status)).length],
    ["Encerradas", insight.rejected],
  ] as const;
  return <aside className="panel analysis-detail"><header className="analysis-detail-header"><div><span className="eyebrow">Leitura do item</span><h2>PN {insight.partNumber}</h2><p>{insight.description}</p></div><span className={`analysis-recommendation large ${recommendation.tone}`}>{recommendation.label}</span></header><div className="analysis-item-data"><span className="eyebrow">Dados comerciais</span><dl><div><dt>VT</dt><dd>{insight.vt}</dd></div><div><dt>Origem</dt><dd>{insight.origin}</dd></div><div><dt>Net price</dt><dd>{insight.netPriceCents ? formatBRL(insight.netPriceCents) : "—"}</dd></div></dl></div><div className="analysis-detail-metrics"><div><span>Solicitações</span><strong>{insight.requests}</strong></div><div><span>Aprovada</span><strong>{insight.approvedQuantity} un.</strong></div><div><span>Concessionárias</span><strong>{insight.dealerships}</strong></div><div><span>Conversão</span><strong>{insight.conversion}%</strong></div></div><div className="analysis-list-control"><div><span className="eyebrow">Controle da lista</span><strong>{insight.priceListIncluded ? "PN já incluído" : "PN ainda não marcado"}</strong></div>{canManagePriceList && <button className={insight.priceListIncluded ? "outline-button compact" : "primary-button compact"} type="button" disabled={updating} onClick={onToggle}>{updating ? "Salvando..." : insight.priceListIncluded ? "Desmarcar" : "Marcar incluído"}</button>}</div><section className="analysis-evidence"><header><div><span className="eyebrow">Evidências</span><h3>Base da recomendação</h3></div><span className="analysis-confidence">{insight.approvedQuantity > 5 ? "Critério atendido" : "Abaixo do limite"}</span></header><div className="analysis-evidence-list"><p><Icon name="trend" size={15} /><span><strong>Quantidade:</strong> {insight.approvedQuantity} unidades aprovadas.</span></p><p><Icon name="building" size={15} /><span><strong>Alcance:</strong> {insight.dealerships} {insight.dealerships === 1 ? "concessionária" : "concessionárias"}.</span></p><p><Icon name={insight.rejected > 0 ? "clock" : "check"} size={15} /><span><strong>Risco:</strong> {insight.rejected ? `${insight.rejected} negativa(s) para pedido.` : "Sem negativas registradas."}</span></p></div></section><section className="analysis-status-block"><header><span className="eyebrow">Funil</span><strong>Status das cotações</strong></header>{statusCounts.map(([label, count]) => <div className="analysis-status-line" key={label}><span>{label}</span><div><i style={{ width: `${insight.requests ? Math.max((count / insight.requests) * 100, count ? 7 : 0) : 0}%` }} /></div><strong>{count}</strong></div>)}</section><section className="analysis-decision-note"><Icon name="eye" size={16} /><div><strong>Leitura gerencial</strong><p>{recommendation.reason}</p></div></section></aside>;
}

function QuotesView({ quotes, me, onChanged }: { quotes: Quote[]; me: CurrentAccess; onChanged: () => Promise<void> }) {
  const [section, setSection] = useState<"flow" | "analysis">("flow");
  const [pn, setPn] = useState(""); const [quantity, setQuantity] = useState("1"); const [targetNetPrice, setTargetNetPrice] = useState(""); const [observation, setObservation] = useState(""); const [saving, setSaving] = useState(false); const [error, setError] = useState("");
  const returnedQuotes = quotes.filter((quote) => quote.status === "returned");
  const globalView = ["general_admin", "global_management"].includes(me.role);
  async function submit(event: FormEvent) {
    event.preventDefault(); setSaving(true); setError("");
    const response = await fetch("/api/quotes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ partNumber: pn, quantity: Number(quantity), targetNetPriceCents: parseMoneyToCents(targetNetPrice), observation }) });
    const payload = (await response.json()) as { error?: string };
    if (!response.ok) { setError(payload.error || "Não foi possível solicitar a cotação."); setSaving(false); return; }
    setPn(""); setQuantity("1"); setTargetNetPrice(""); setObservation(""); setSaving(false); await onChanged();
  }
  const canRequestQuote = me.role === "dealer_manager";
  return <div className="content-frame quotes-shell"><header className="page-heading quote-page-heading"><div><span className="eyebrow">Peças</span><h1>Cotações</h1></div><div className="quotes-tabs" role="tablist"><button type="button" className={section === "flow" ? "active" : ""} onClick={() => setSection("flow")}>Fluxo</button>{me.permissions.analyzeQuotes && <button type="button" className={section === "analysis" ? "active" : ""} onClick={() => setSection("analysis")}>360º</button>}</div></header>
    {section === "analysis" ? <QuoteAnalysisView quotes={quotes} me={me} onChanged={onChanged} /> : <>
    {me.role === "dealer_manager" && returnedQuotes.length > 0 && <QuoteReturnAlert quotes={returnedQuotes} />}
    {globalView && <QuoteMetrics quotes={quotes} />}
    {canRequestQuote && <form className="panel quote-request-panel" onSubmit={(event) => void submit(event)}><div className="quote-request-copy"><span className="eyebrow">Nova solicitação</span><strong>Solicitar cotação</strong></div><div className="quote-request-fields"><label className="field"><span>PN</span><input value={pn} onChange={(event) => setPn(event.target.value)} placeholder="Ex.: 34061200" required /></label><label className="field"><span>Qtd.</span><input type="number" min="1" value={quantity} onChange={(event) => setQuantity(event.target.value)} required /></label><label className="field"><span>Net price alvo</span><input inputMode="decimal" value={targetNetPrice} onChange={(event) => setTargetNetPrice(event.target.value)} placeholder="R$ 0,00" required /></label><button className="primary-button" disabled={saving}>{saving ? "Enviando..." : "Solicitar"}</button></div><label className="field quote-observation-field"><span>Observação</span><textarea value={observation} onChange={(event) => setObservation(event.target.value)} placeholder="Cliente ou condição da negociação (opcional)" rows={2} /></label>{error && <p className="form-error">{error}</p>}</form>}
    <section className="quote-list">{quotes.length ? quotes.map((quote) => <QuoteCard key={quote.id} quote={quote} me={me} onChanged={onChanged} />) : <article className="panel"><EmptyState title="Nenhuma cotação registrada" text={me.permissions.requestQuote ? "Solicite o primeiro PN para iniciar o fluxo." : "As cotações do seu escopo aparecerão aqui."} /></article>}</section>
    </>}
  </div>;
}
function QuoteReturnAlert({ quotes }: { quotes: Quote[] }) {
  return <section className="quote-return-alert" role="status"><div className="quote-alert-icon"><Icon name="check" size={20} /></div><div className="quote-alert-copy"><span className="eyebrow">Retorno disponível</span><h2>As informações solicitadas já foram retornadas</h2><p>As cotações abaixo estão aguardando sua ação. Confira os dados e aprove ou reprove cada uma.</p><div className="quote-alert-list">{quotes.slice(0, 4).map((quote) => <div key={quote.id}><strong>PN {quote.partNumber}</strong><span>Aguardando sua ação</span></div>)}</div>{quotes.length > 4 && <small>+{quotes.length - 4} retornos disponíveis abaixo.</small>}</div></section>;
}
function QuoteMetrics({ quotes }: { quotes: Quote[] }) {
  const orders = quotes.filter((quote) => quote.status === "order_input").length;
  const rejected = quotes.filter((quote) => quote.status === "rejected").length;
  const decided = quotes.filter((quote) => ["approved", "rejected", "order_pending", "order_input"].includes(quote.status)).length;
  const approved = quotes.filter((quote) => ["approved", "order_pending", "order_input"].includes(quote.status)).length;
  const conversion = quotes.length ? Math.round((orders / quotes.length) * 100) : 0;
  const approval = decided ? Math.round((approved / decided) * 100) : 0;
  const pending = quotes.filter((quote) => ["global_review", "data_pending"].includes(quote.status)).length;
  return <section className="quote-metrics-block"><div className="section-heading"><div><span className="eyebrow">Gestão Global</span><h2>Indicadores de cotações</h2><p>Acompanhe o volume solicitado, a conversão em pedido e os pontos de atenção.</p></div></div><div className="metric-grid quote-metrics"><MetricCard label="PNs solicitados" value={String(quotes.length)} meta="Cotações registradas" icon="file" tone="red" /><MetricCard label="Viraram pedido" value={String(orders)} meta={`${conversion}% do total solicitado`} icon="check" tone="green" /><MetricCard label="Negativa para pedido" value={String(rejected)} meta="Reprovadas pela concessionária" icon="close" tone="amber" /><MetricCard label="Taxa de aprovação" value={`${approval}%`} meta={`${approved} aprovadas ou em pedido`} icon="trend" tone="dark" /><MetricCard label="Em análise" value={String(pending)} meta="Aguardando ação global" icon="clock" tone="amber" /></div></section>;
}
function QuoteCard({ quote, me, onChanged }: { quote: Quote; me: CurrentAccess; onChanged: () => Promise<void> }) {
  const [description, setDescription] = useState(quote.description); const [vt, setVt] = useState(quote.vt); const [origin, setOrigin] = useState(quote.origin); const [price, setPrice] = useState(quote.netPriceCents ? formatMoneyInput(String(quote.netPriceCents / 100).replace(".", ",")) : ""); const [approvedQuantity, setApprovedQuantity] = useState(String(quote.approvedQuantity ?? quote.requestedQuantity ?? 1)); const [note, setNote] = useState(""); const [saving, setSaving] = useState(false); const [error, setError] = useState("");
  const review = quote.isActionOwner && ["general_admin", "global_management"].includes(me.role) && ["global_review", "data_pending"].includes(quote.status); const decide = quote.isActionOwner && ["general_admin", "dealer_manager"].includes(me.role) && quote.status === "returned"; const place = quote.isActionOwner && ["general_admin", "factory_manager"].includes(me.role) && quote.status === "order_pending";
  async function action(name: string) {
    setSaving(true); setError("");
    const response = await fetch("/api/quotes", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: quote.id, action: name, description, vt, origin, netPriceCents: parseMoneyToCents(price), approvedQuantity: Number(approvedQuantity), actionNote: note }) });
    const payload = (await response.json()) as { error?: string };
    if (!response.ok) { setError(payload.error || "Não foi possível atualizar a cotação."); setSaving(false); return; }
    setSaving(false); await onChanged();
  }
  return <article className="panel quote-card"><header className="quote-card-header"><div><span className="eyebrow">{quote.id}</span><h2>PN {quote.partNumber}</h2><p>{quote.dealership + " · " + quote.city + (quote.state ? " · " + quote.state : "")}</p></div><span className={"status-badge quote-status " + quote.status}><i />{quote.statusLabel}</span></header><div className="quote-meta-grid"><div><span>Solicitada por</span><strong>{quote.requestedByName || quote.requestedByEmail}</strong><small>{formatDateTime(quote.requestedAt)}</small></div><div><span>Quantidade</span><strong>{quote.approvedQuantity ?? quote.requestedQuantity} un.</strong><small>{quote.approvedQuantity ? "Aprovada" : "Solicitada"}</small></div><div><span>Net price alvo</span><strong>{quote.targetNetPriceCents ? formatBRL(quote.targetNetPriceCents) : "—"}</strong><small>Definido pela concessionária</small></div>{quote.isActionOwner ? <div><span>Próxima ação</span><strong>{quote.actionOwnerLabel || "Encerrada"}</strong><small>Responsabilidade atribuída a você</small></div> : <div><span>Acompanhamento</span><strong>Somente consulta</strong><small>Sem ação atribuída a este perfil</small></div>}</div>{quote.requestObservation && <div className="quote-request-observation"><span>Contexto da solicitação</span><p>{quote.requestObservation}</p></div>}{quote.description && <div className="quote-return-grid"><div><span>Descrição</span><strong>{quote.description}</strong></div><div><span>VT</span><strong>{quote.vt || "—"}</strong></div><div><span>Origem</span><strong>{quote.origin || "—"}</strong></div><div><span>Net price retornado</span><strong>{quote.netPriceCents ? formatBRL(quote.netPriceCents) : "—"}</strong></div></div>}
    {review && <div className="quote-action-box"><strong>Resposta da Gestão Global</strong><p>Confira os dados, solicite imputação/revisão quando necessário ou retorne a cotação para aprovação da concessionária.</p><div className="quote-edit-grid"><label className="field"><span>Descrição</span><input value={description} onChange={(event) => setDescription(event.target.value)} /></label><label className="field"><span>VT</span><input value={vt} onChange={(event) => setVt(event.target.value)} /></label><label className="field"><span>Origem</span><input value={origin} onChange={(event) => setOrigin(event.target.value)} /></label><label className="field"><span>Net price</span><input value={price} onChange={(event) => setPrice(event.target.value)} /></label></div><label className="field"><span>Observação</span><input value={note} onChange={(event) => setNote(event.target.value)} /></label><div className="quote-action-buttons"><button type="button" className="outline-button" disabled={saving} onClick={() => void action("needs_action")}>Solicitar imputação/revisão</button><button type="button" className="primary-button" disabled={saving} onClick={() => void action("return_quote")}>Enviar para aprovação</button></div></div>}
    {decide && <div className="quote-action-box"><strong>Aprovação da Gestão Concessionária</strong><p>Analise o retorno da Gestão Global. Se reprovar, a cotação será encerrada e continuará visível aos níveis superiores.</p><label className="field"><span>Quantidade aprovada</span><input type="number" min="1" value={approvedQuantity} onChange={(event) => setApprovedQuantity(event.target.value)} /></label><label className="field"><span>Observação</span><input value={note} onChange={(event) => setNote(event.target.value)} /></label><div className="quote-action-buttons"><button type="button" className="outline-button danger-button" disabled={saving} onClick={() => void action("reject")}>Reprovar e encerrar</button><button type="button" className="primary-button" disabled={saving} onClick={() => void action("approve")}>Aprovar e enviar à fábrica</button></div></div>}
    {place && <div className="quote-action-box factory-decision"><strong>Input do pedido</strong><p>Cotação aprovada e aguardando lançamento em carteira.</p><label className="field"><span>Referência do pedido</span><input value={note} onChange={(event) => setNote(event.target.value)} /></label><button type="button" className="primary-button" disabled={saving} onClick={() => void action("place_order")}>Marcar input realizado</button></div>}{error && <p className="form-error">{error}</p>}</article>;
}

function NavButton({ active, icon, children, onClick }: { active: boolean; icon: IconName; children: ReactNode; onClick: () => void }) {
  return <button className={`nav-button ${active ? "active" : ""}`} onClick={onClick}><Icon name={icon} size={19} /><span>{children}</span></button>;
}

function PriceListView() {
  return <div className="content-frame"><header className="page-heading"><div><span className="eyebrow">Consulta autorizada</span><h1>Lista de preços</h1><p>Seu perfil possui acesso exclusivamente consultivo aos preços vigentes.</p></div></header><article className="panel"><div className="empty-state"><span><Icon name="file" size={24} /></span><h3>Lista de preços vigente</h3><p>A consulta da lista de preços está disponível neste ambiente conforme a publicação realizada pela HORSCH.</p></div></article></div>;
}

function Overview({ data, onNew, onOpen, onHistory, onAll }: { data: DashboardData; onNew: () => void; onOpen: (proposal: Proposal) => void; onHistory: (proposalId: string) => void; onAll: () => void }) {
  const totalCents = data.proposals.reduce((sum, proposal) => sum + proposal.totalCents, 0);
  const approved = data.proposals.filter((proposal) => proposal.status === "approved").length;
  const decided = data.proposals.filter((proposal) => ["approved", "rejected"].includes(proposal.status)).length;
  const approvalRate = decided ? Math.round((approved / decided) * 100) : 0;
  const pending = data.proposals.filter((proposal) => ["sent", "counteroffer"].includes(proposal.status)).length;
  const counteroffers = data.proposals.filter((proposal) => proposal.status === "counteroffer");
  return <div className="content-frame">
    <header className="page-heading overview-heading"><div><span className="eyebrow">{data.me.roleLabel}</span><h1>Olá, {firstName(data.me.name)}.</h1><p>{scopeDescription(data.me)}</p></div>{data.me.permissions.createProposal && <button className="primary-button" onClick={onNew}><Icon name="plus" size={18} />Nova proposta</button>}</header>
    <section className="metric-grid" aria-label="Indicadores comerciais">
      <MetricCard label="Valor em propostas" value={formatBRL(totalCents)} meta={`${data.proposals.length} propostas visíveis`} icon="money" tone="red" />
      <MetricCard label="Aguardando decisão" value={String(pending)} meta="Enviadas e contrapropostas" icon="clock" tone="amber" />
      <MetricCard label="Taxa de aceite" value={`${approvalRate}%`} meta={`${approved} propostas aceitas`} icon="trend" tone="green" />
      <MetricCard label="Concessionárias" value={String(data.dealerships.length)} meta="Dentro do seu escopo" icon="building" tone="dark" />
    </section>
    {counteroffers.length > 0 && !["dealer_manager", "concession"].includes(data.me.role) && (
      <CounterofferInbox proposals={counteroffers} onOpen={onOpen} />
    )}
    <section className="dashboard-grid">
      <article className="panel pipeline-panel"><PanelHeader title="Fluxo de propostas" subtitle="Distribuição por decisão comercial" /><Pipeline proposals={data.proposals} /></article>
      <article className="panel dealers-panel"><PanelHeader title="Carteira de concessionárias" subtitle="Maior valor acumulado" /><div className="dealer-ranking">{data.dealerships.slice(0, 4).map((dealer, index) => <div className="ranking-row" key={dealer.id}><span className="ranking-index">{String(index + 1).padStart(2, "0")}</span><span className="dealer-monogram">{initials(dealer.name)}</span><div><strong>{dealer.name}</strong><small>{dealer.city}{dealer.state ? ` · ${dealer.state}` : ""}</small></div><span className="ranking-value">{formatBRL(dealer.totalCents)}</span></div>)}{!data.dealerships.length && <EmptyMini text="Nenhuma concessionária vinculada." />}</div></article>
    </section>
    <article className="panel proposals-panel"><PanelHeader title="Propostas recentes" subtitle="Últimas movimentações no seu escopo" action={<button className="text-button" onClick={onAll}>Ver todas <Icon name="arrow" size={15} /></button>} /><ProposalTable proposals={data.proposals.slice(0, 7)} onOpen={onOpen} canViewHistory={data.me.role === "general_admin"} onHistory={onHistory} /></article>
  </div>;
}

function CounterofferInbox({ proposals, onOpen }: { proposals: Proposal[]; onOpen: (proposal: Proposal) => void }) {
  return (
    <section className="counteroffer-inbox" aria-label="Contrapropostas aguardando análise">
      <header>
        <div>
          <span className="eyebrow">Ação necessária</span>
          <h2>Contrapropostas aguardando sua análise</h2>
          <p>Compare os valores enviados pela concessionária antes de decidir.</p>
        </div>
        <strong className="counteroffer-count">{proposals.length}</strong>
      </header>
      <div className="counteroffer-inbox-list">
        {proposals.slice(0, 4).map((proposal) => {
          const originalTotal = proposal.items.reduce(
            (sum, item) => sum + item.quantity * item.unitPriceCents,
            0,
          );
          const proposedTotal = proposal.counterofferCents ?? originalTotal;
          const variation = originalTotal
            ? ((proposedTotal - originalTotal) / originalTotal) * 100
            : 0;
          return (
            <button key={proposal.id} type="button" onClick={() => onOpen(proposal)}>
              <span><strong>{proposal.id}</strong><small>{proposal.dealership}</small></span>
              <span><small>Original</small><strong>{formatBRL(originalTotal)}</strong></span>
              <span><small>Contraproposta</small><strong>{formatBRL(proposedTotal)}</strong></span>
              <span className={variation <= 0 ? "favorable" : "unfavorable"}>
                {variation > 0 ? "+" : ""}{variation.toFixed(1).replace(".", ",")}%
              </span>
              <Icon name="arrow" size={17} />
            </button>
          );
        })}
      </div>
    </section>
  );
}

function MetricCard({ label, value, meta, icon, tone }: { label: string; value: string; meta: string; icon: IconName; tone: string }) {
  return <article className="metric-card"><div className={`metric-icon ${tone}`}><Icon name={icon} size={21} /></div><span>{label}</span><strong>{value}</strong><small>{meta}</small></article>;
}

function PanelHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return <header className="panel-header"><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>{action}</header>;
}

function Pipeline({ proposals }: { proposals: Proposal[] }) {
  const stages: { status: ProposalStatus; label: string }[] = [
    { status: "draft", label: "Rascunhos" },
    { status: "sent", label: "Enviadas" },
    { status: "counteroffer", label: "Contrapropostas" },
    { status: "approved", label: "Aceitas" },
    { status: "expired", label: "Expiradas" },
  ];
  const max = Math.max(1, ...stages.map((stage) => proposals.filter((proposal) => proposal.status === stage.status).length));
  return <div className="pipeline-list">{stages.map((stage) => { const matches = proposals.filter((proposal) => proposal.status === stage.status); const count = matches.length; const value = matches.reduce((sum, proposal) => sum + proposal.totalCents, 0); return <div className="pipeline-row" key={stage.status}><div className="pipeline-label"><span>{stage.label}</span><strong>{count}</strong></div><div className="pipeline-track"><span className={`pipeline-fill ${stage.status}`} style={{ width: `${Math.max(count ? 10 : 0, (count / max) * 100)}%` }} /></div><small>{formatBRL(value)}</small></div>; })}</div>;
}

function ProposalsView({ proposals, allCount, search, onSearch, status, onStatus, canCreate, onNew, onOpen, canViewHistory, onHistory }: { proposals: Proposal[]; allCount: number; search: string; onSearch: (value: string) => void; status: "all" | ProposalStatus; onStatus: (value: "all" | ProposalStatus) => void; canCreate: boolean; onNew: () => void; onOpen: (proposal: Proposal) => void; canViewHistory: boolean; onHistory: (proposalId: string) => void }) {
  return <div className="content-frame"><header className="page-heading"><div><span className="eyebrow">Operação comercial</span><h1>Propostas</h1><p>{allCount} registros dentro do seu nível de acesso.</p></div>{canCreate && <button className="primary-button" onClick={onNew}><Icon name="plus" size={18} />Nova proposta</button>}</header><article className="panel full-list-panel"><div className="list-toolbar"><label className="search-field"><Icon name="search" size={18} /><input value={search} onChange={(event) => onSearch(event.target.value)} placeholder="Buscar proposta, concessionária ou responsável" /></label><select value={status} onChange={(event) => onStatus(event.target.value as "all" | ProposalStatus)} aria-label="Filtrar por status"><option value="all">Todos os status</option>{STATUS_ORDER.map((item) => <option key={item} value={item}>{STATUS_LABELS[item]}</option>)}</select></div><ProposalTable proposals={proposals} onOpen={onOpen} canViewHistory={canViewHistory} onHistory={onHistory} /></article></div>;
}

function ProposalTable({ proposals, onOpen, canViewHistory, onHistory }: { proposals: Proposal[]; onOpen: (proposal: Proposal) => void; canViewHistory: boolean; onHistory: (proposalId: string) => void }) {
  if (!proposals.length) return <EmptyState title="Nenhuma proposta encontrada" text="Não há propostas neste escopo ou com os filtros selecionados." />;
  return <div className="table-scroll"><table className="data-table"><thead><tr><th>Proposta</th><th>Concessionária</th><th>Emissão</th><th>Vigência</th><th>Responsável</th><th>Status</th><th className="align-right">Valor</th><th aria-label="Abrir" /></tr></thead><tbody>{proposals.map((proposal) => <tr key={proposal.id} onClick={() => onOpen(proposal)}><td><div className="proposal-id-line"><strong className="proposal-id">{proposal.id}</strong>{canViewHistory && <button type="button" className="history-row-action" onClick={(event) => { event.stopPropagation(); onHistory(proposal.id); }} aria-label={`Ver histórico de ${proposal.id}`} title="Ver histórico"><Icon name="eye" size={14} /></button>}</div><small>{proposal.items.length} {proposal.items.length === 1 ? "item" : "itens"}</small></td><td><strong>{proposal.dealership}</strong><small>{proposal.city}{proposal.state ? ` · ${proposal.state}` : ""}</small></td><td>{formatDate(proposal.issueDate)}</td><td><strong>{formatDate(proposal.validUntil)}</strong>{proposal.status === "expired" && <small>Expirada automaticamente</small>}</td><td>{proposal.commercialOwner}</td><td><StatusBadge status={proposal.status} /></td><td className="align-right value-cell"><strong>{formatBRL(proposal.totalCents)}</strong>{proposal.status === "counteroffer" && proposal.counterofferCents && <small>Proposto: {formatBRL(proposal.counterofferCents)}</small>}</td><td><button className="row-action" onClick={(event) => { event.stopPropagation(); onOpen(proposal); }} aria-label={`Abrir ${proposal.id}`}><Icon name="arrow" size={16} /></button></td></tr>)}</tbody></table></div>;
}

function DealershipsView({ dealerships, proposals, onOpen }: { dealerships: Dealership[]; proposals: Proposal[]; onOpen: (proposal: Proposal) => void }) {
  return <div className="content-frame"><header className="page-heading"><div><span className="eyebrow">Carteira comercial</span><h1>Concessionárias</h1><p>Parceiros disponíveis dentro do seu nível de permissão.</p></div></header>{!dealerships.length ? <article className="panel"><EmptyState title="Nenhuma concessionária vinculada" text="Crie uma proposta para iniciar a carteira ou solicite a vinculação ao ADM." /></article> : <section className="dealership-grid">{dealerships.map((dealer) => { const latest = proposals.find((proposal) => proposal.dealershipId === dealer.id); return <article className="dealer-card" key={dealer.id}><header><span className="dealer-large-monogram">{initials(dealer.name)}</span><div><h2>{dealer.name}</h2><p>{dealer.city}{dealer.state ? ` · ${dealer.state}` : ""}</p></div></header><dl><div><dt>Propostas</dt><dd>{dealer.proposals}</dd></div><div><dt>Aceitas</dt><dd>{dealer.approved}</dd></div><div><dt>Valor</dt><dd>{formatBRL(dealer.totalCents)}</dd></div></dl><div className="dealer-manager"><span>Gestor Fábrica</span><strong>{dealer.factoryManagerName || "Não atribuído"}</strong><small>{dealer.factoryManagerEmail}</small></div><footer><div><span>Responsável da concessionária</span><strong>{dealer.dealerManagerName || "Não informado"}</strong><small>{dealer.dealerManagerEmail}</small></div>{latest && <button className="text-button" onClick={() => onOpen(latest)}>Abrir última <Icon name="arrow" size={14} /></button>}</footer></article>; })}</section>}</div>;
}

function AccessView({ data, onNew, onChanged }: { data: DashboardData; onNew: () => void; onChanged: () => Promise<void> }) {
  const [busy, setBusy] = useState("");
  const [passwordTarget, setPasswordTarget] = useState<AccessUser | null>(null);
  const canAssignRoles = data.me.permissions.assignLowerPermission;

  async function updateAccess(record: AccessUser, patch: Partial<Pick<AccessUser, "role" | "dealershipId" | "active">>) {
    setBusy(record.email);
    const response = await fetch("/api/access", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: record.email, ...patch }),
    });
    const payload = (await response.json()) as { error?: string };
    if (!response.ok) window.alert(payload.error || "Não foi possível atualizar o acesso.");
    else await onChanged();
    setBusy("");
  }

  return (
    <div className="content-frame">
      <header className="page-heading">
        <div><span className="eyebrow">Segurança e governança</span><h1>Gestão de acessos</h1><p>{accessDescription(data.me.role)}</p></div>
        {data.me.permissions.manageAccess && <button className="primary-button" onClick={onNew}><Icon name="plus" size={18} />Criar acesso</button>}
      </header>
      <section className="permission-summary">
        <PermissionCard title="ADM Geral" text="Acesso completo, incluindo usuários, permissões, preços, DSH, campanhas e auditoria." active={data.me.role === "general_admin"} />
        <PermissionCard title="Gestão Global" text="Cotações, propostas, preços, DSH, campanhas, análises e gestão dos níveis abaixo." active={data.me.role === "global_management"} />
        <PermissionCard title="Gestor Fábrica" text="Propostas, cotações abertas, DSH, pedidos e acessos dos níveis abaixo na sua carteira." active={data.me.role === "factory_manager"} />
        <PermissionCard title="Gestor Concessionária" text="Solicita cotações, responde propostas, aprova retornos, faz DSH e consulta preços." active={data.me.role === "dealer_manager"} />
        <PermissionCard title="Concessão" text="Acesso exclusivamente consultivo à lista de preços vigente." active={data.me.role === "concession"} />
      </section>
      <article className="panel access-panel">
        <PanelHeader title="Usuários no seu escopo" subtitle={`${data.users.length} acessos cadastrados`} />
        <div className="table-scroll">
          <table className="data-table access-table">
            <thead><tr><th>Usuário</th><th>Posição</th><th>Concessionária</th><th>Status</th><th className="align-right">Ação</th></tr></thead>
            <tbody>
              {data.users.map((record) => {
                const isPrimaryAdmin = record.email === "mateus.mazieiro@horsch.com";
                const canEditPosition = canAssignRoles && !isPrimaryAdmin && record.email !== data.me.email;
                return (
                  <tr key={record.email}>
                    <td><strong>{record.name}</strong><small>{record.email}</small></td>
                    <td>
                      {canEditPosition ? (
                        <select
                          value={record.role}
                          disabled={busy === record.email}
                          onChange={(event) => void updateAccess(record, { role: event.target.value as UserRole })}
                          aria-label={`Posição de ${record.name}`}
                        >
                          {data.me.role === "general_admin" && <><option value="global_management">Gestão Global</option><option value="factory_manager">Gestor Fábrica</option></>}
                          {data.me.role === "global_management" && <option value="factory_manager">Gestor Fábrica</option>}
                          {data.me.role !== "general_admin" && <option value="dealer_manager">Gestor Concessionária</option>}
                          <option value="concession">Concessão</option>
                        </select>
                      ) : <span className="role-badge">{record.roleLabel}</span>}
                    </td>
                    <td>
                      {canEditPosition ? (
                        <select
                          value={record.dealershipId ?? ""}
                          disabled={busy === record.email}
                          onChange={(event) => void updateAccess(record, { dealershipId: Number(event.target.value) || null })}
                          aria-label={`Concessionária de ${record.name}`}
                        >
                          <option value="">Sem vínculo</option>
                          {data.dealerships.map((dealer) => <option key={dealer.id} value={dealer.id}>{dealer.name}</option>)}
                        </select>
                      ) : data.dealerships.find((item) => item.id === record.dealershipId)?.name || "—"}
                    </td>
                    <td><span className={`access-status ${record.active ? "active" : "inactive"}`}>{record.active ? "Ativo" : "Inativo"}</span></td>
                    <td className="align-right">
                      <div className="access-actions">
                        {data.me.permissions.restoreLowerPassword && <button className="outline-button compact" onClick={() => setPasswordTarget(record)}><Icon name="key" size={14} />Senha</button>}
                        <button
                          className="outline-button compact"
                          disabled={busy === record.email || record.email === data.me.email}
                          onClick={() => void updateAccess(record, { active: !record.active })}
                        >
                          {record.email === data.me.email ? "Seu acesso" : record.active ? "Desativar" : "Ativar"}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </article>
      {passwordTarget && <AdminPasswordModal target={passwordTarget} onClose={() => setPasswordTarget(null)} />}
    </div>
  );
}

function PermissionCard({ title, text, active }: { title: string; text: string; active: boolean }) {
  return <article className={`permission-card ${active ? "current" : ""}`}><span>{active ? "Seu perfil" : "Nível de acesso"}</span><h2>{title}</h2><p>{text}</p></article>;
}

type FormItem = {
  partNumber: string;
  description: string;
  vt: string;
  origin: string;
  ncm: string;
  quantity: number;
  price: string;
};

const blankItem = (): FormItem => ({
  partNumber: "",
  description: "",
  vt: "",
  origin: "",
  ncm: "",
  quantity: 1,
  price: "",
});

type DeliveryResponse = {
  status: "sent" | "pending_configuration" | "failed";
  recipientEmail: string;
  error?: string;
};

function NewProposalModal({
  userEmail,
  role,
  dealerships,
  proposalResponsibles,
  proposal,
  onClose,
  onSaved,
}: {
  userEmail: string;
  role: UserRole;
  dealerships: Dealership[];
  proposalResponsibles: AccessUser[];
  proposal?: Proposal;
  onClose: () => void;
  onSaved: (message: string) => Promise<void>;
}) {
  const [dealershipSelection, setDealershipSelection] = useState(
    proposal ? String(proposal.dealershipId) : dealerships.length ? "" : "new",
  );
  const [dealership, setDealership] = useState(proposal?.dealership ?? "");
  const [city, setCity] = useState(proposal?.city ?? "");
  const [state, setState] = useState(proposal?.state ?? "");
  const [contactName, setContactName] = useState(proposal?.contactName ?? "");
  const [contactEmail, setContactEmail] = useState(proposal?.contactEmail ?? "");
  const [customerName, setCustomerName] = useState(proposal?.customerName ?? "");
  const [customerSaleValue, setCustomerSaleValue] = useState(
    proposal?.customerSaleValueCents ? formatMoneyInput(String(proposal.customerSaleValueCents / 100).replace(".", ",")) : "",
  );
  const [documentCategory, setDocumentCategory] = useState<ProposalDocument["category"]>("invoice");
  const [selectedDocuments, setSelectedDocuments] = useState<File[]>([]);
  const [factoryManagerEmail, setFactoryManagerEmail] = useState(
    proposal?.factoryManagerEmail || (PROPOSAL_RESPONSIBLE_ROLES.includes(role) ? userEmail : ""),
  );
  const [validUntil, setValidUntil] = useState(proposal?.validUntil ?? defaultValidity());
  const [items, setItems] = useState<FormItem[]>(proposal ? proposal.items.map((item) => ({ partNumber: item.partNumber, description: item.description, vt: item.vt, origin: item.origin, ncm: item.ncm, quantity: item.quantity, price: formatMoneyInput(String(item.unitPriceCents / 100).replace(".", ",")) })) : [blankItem()]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const selectedDealer = dealerships.find(
    (record) => String(record.id) === dealershipSelection,
  );
  const isNewDealer = dealershipSelection === "new";
  const totalCents = items.reduce(
    (sum, item) => sum + item.quantity * parseMoneyToCents(item.price),
    0,
  );

  function selectDealership(value: string) {
    setDealershipSelection(value);
    const record = dealerships.find((item) => String(item.id) === value);
    if (!record) {
      setDealership("");
      setCity("");
      setState("");
      setContactName("");
      setContactEmail("");
      setFactoryManagerEmail(
        PROPOSAL_RESPONSIBLE_ROLES.includes(role) ? userEmail : "",
      );
      return;
    }
    setDealership(record.name);
    setCity(record.city);
    setState(record.state);
    setContactName(record.dealerManagerName || record.contactName);
    setContactEmail(record.dealerManagerEmail || record.contactEmail);
    setFactoryManagerEmail(record.factoryManagerEmail);
  }

  function updateItem(index: number, patch: Partial<FormItem>) {
    setItems((current) =>
      current.map((item, itemIndex) =>
        itemIndex === index ? { ...item, ...patch } : item,
      ),
    );
  }

  async function submit(event: FormEvent, status: "draft" | "sent") {
    event.preventDefault();
    if (!dealershipSelection) {
      setError("Selecione uma concessionária ou escolha cadastrar uma nova.");
      return;
    }
    setSaving(true);
    setError("");
    const response = await fetch("/api/proposals", {
      method: proposal ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...(proposal ? { id: proposal.id, action: "edit" } : {}),
        dealershipId: selectedDealer?.id ?? null,
        dealership,
        city,
        state,
        contactName,
        contactEmail,
        customerName,
        customerSaleValueCents: customerSaleValue ? parseMoneyToCents(customerSaleValue) : null,
        factoryManagerEmail,
        validUntil,
        status,
        items: items.map((item) => ({
          ...item,
          unitPriceCents: parseMoneyToCents(item.price),
        })),
      }),
    });
    const payload = (await response.json()) as {
      error?: string;
      id?: string;
      delivery?: DeliveryResponse;
    };
    if (!response.ok) {
      setError(payload.error || "Não foi possível salvar a proposta.");
      setSaving(false);
      return;
    }
    const savedProposalId = proposal?.id || payload.id;
    let documentsMessage = "";
    if (savedProposalId && selectedDocuments.length) {
      const failedDocuments: string[] = [];
      for (const file of selectedDocuments) {
        const formData = new FormData();
        formData.set("proposalId", savedProposalId);
        formData.set("category", documentCategory);
        formData.set("file", file);
        const uploadResponse = await fetch("/api/proposals/documents", { method: "POST", body: formData });
        if (!uploadResponse.ok) {
          const uploadPayload = (await uploadResponse.json()) as { error?: string };
          failedDocuments.push(`${file.name}: ${uploadPayload.error || "falha no anexo"}`);
        }
      }
      if (failedDocuments.length) {
        documentsMessage = ` Porém, ${failedDocuments.length} documento(s) não foram anexados.`;
      }
    }
    const message = proposal
      ? "Proposta editada e salva como rascunho. Faça um novo envio quando estiver pronta."
      : status === "draft"
        ? "Proposta salva como rascunho."
        : payload.delivery?.status === "sent"
          ? `Proposta enviada para ${payload.delivery.recipientEmail}.`
          : payload.delivery?.status === "pending_configuration"
            ? "Proposta salva. O envio por e-mail aguarda a configuração aprovada pelo TI."
            : "Proposta salva como rascunho; o serviço de e-mail não confirmou o envio.";
    await onSaved(`${message}${documentsMessage}`);
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <form
        className="proposal-form-modal"
        onSubmit={(event) => void submit(event, "draft")}
      >
        <header className="modal-header">
          <div>
            <span className="eyebrow">{proposal ? "Edição controlada" : "Nova negociação"}</span>
            <h2>{proposal ? `Editar proposta ${proposal.id}` : "Criar proposta comercial"}</h2>
            <p>{proposal ? "As alterações ficarão registradas no histórico e a proposta voltará para rascunho." : "Responsáveis e destinatários são definidos pela carteira selecionada."}</p>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Fechar">
            <Icon name="close" />
          </button>
        </header>

        <div className="form-scroll">
          <section className="form-section">
            <div className="form-section-title">
              <span>01</span>
              <div><h3>Concessionária e responsáveis</h3><p>Selecione a carteira para preencher os responsáveis automaticamente.</p></div>
            </div>
            <div className="form-grid">
              <label className="field">
                <span>Concessionária</span>
                <select
                  value={dealershipSelection}
                  onChange={(event) => selectDealership(event.target.value)}
                  required
                >
                  <option value="">Selecione uma concessionária</option>
                  {dealerships.map((dealer) => (
                    <option key={dealer.id} value={dealer.id}>{dealer.name}</option>
                  ))}
                  <option value="new">+ Cadastrar nova concessionária</option>
                </select>
              </label>
              {isNewDealer && (
                <>
                  <label className="field"><span>Nome da concessionária</span><input value={dealership} onChange={(event) => setDealership(event.target.value)} required /></label>
                  <label className="field"><span>Cidade</span><input value={city} onChange={(event) => setCity(event.target.value)} /></label>
                  <label className="field small"><span>UF</span><input maxLength={2} value={state} onChange={(event) => setState(event.target.value.toUpperCase())} /></label>
                </>
              )}
            </div>

            {(selectedDealer || isNewDealer) && (
              <div className="responsible-grid">
                <article className="responsible-card">
                  <span>Responsável da concessionária</span>
                  <label className="field"><span>Nome</span><input value={contactName} readOnly={Boolean(selectedDealer?.dealerManagerName)} onChange={(event) => setContactName(event.target.value)} required /></label>
                  <label className="field"><span>E-mail destinatário</span><input type="email" value={contactEmail} readOnly={Boolean(selectedDealer?.dealerManagerEmail)} onChange={(event) => setContactEmail(event.target.value)} required /></label>
                </article>
                <article className="responsible-card">
                  <span>Responsável HORSCH</span>
                  <label className="field">
                    <span>Responsável HORSCH</span>
                    <select value={factoryManagerEmail} onChange={(event) => setFactoryManagerEmail(event.target.value)} required>
                      <option value="">Selecione o responsável</option>
                      {proposalResponsibles.map((manager) => (
                        <option key={manager.email} value={manager.email}>{manager.name} · {manager.roleLabel}</option>
                      ))}
                    </select>
                  </label>
                  <label className="field"><span>Válida até</span><input type="date" value={validUntil} onChange={(event) => setValidUntil(event.target.value)} required /></label>
                </article>
              </div>
            )}
          </section>

          <section className="form-section items-section">
            <div className="form-section-title">
              <span>02</span>
              <div><h3>Itens da proposta</h3><p>Todos os campos comerciais e fiscais são obrigatórios.</p></div>
              <button type="button" className="outline-button add-item-button" onClick={() => setItems((current) => [...current, blankItem()])}><Icon name="plus" size={15} />Adicionar item</button>
            </div>
            <div className="items-table-wrap">
              <table className="items-form-table">
                <thead><tr><th>PN</th><th>Descrição</th><th>VT</th><th>Origem</th><th>NCM</th><th>Qtd.</th><th>Net price (R$)</th><th /></tr></thead>
                <tbody>
                  {items.map((item, index) => (
                    <tr key={index}>
                      <td><input value={item.partNumber} onChange={(event) => updateItem(index, { partNumber: event.target.value })} required /></td>
                      <td><input value={item.description} onChange={(event) => updateItem(index, { description: event.target.value })} required /></td>
                      <td><input value={item.vt} onChange={(event) => updateItem(index, { vt: event.target.value })} required /></td>
                      <td><input value={item.origin} onChange={(event) => updateItem(index, { origin: event.target.value })} required /></td>
                      <td><input value={item.ncm} onChange={(event) => updateItem(index, { ncm: event.target.value })} required /></td>
                      <td><input type="number" min={1} value={item.quantity} onChange={(event) => updateItem(index, { quantity: Math.max(1, Number(event.target.value) || 1) })} required /></td>
                      <td><input inputMode="decimal" value={item.price} onChange={(event) => updateItem(index, { price: event.target.value })} onBlur={(event) => updateItem(index, { price: formatMoneyInput(event.target.value) })} required /></td>
                      <td><button type="button" className="remove-item" aria-label={`Remover item ${index + 1}`} onClick={() => setItems((current) => current.length === 1 ? [blankItem()] : current.filter((_, itemIndex) => itemIndex !== index))}>×</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="form-total"><span>Valor total da proposta</span><strong>{formatBRL(totalCents)}</strong></div>
          </section>
          <section className="form-section sale-documents-section">
            <div className="form-section-title">
              <span>03</span>
              <div><h3>Venda do concessionário ao cliente</h3><p>Preenchimento opcional para registrar o cliente final, o valor fixado e os documentos da venda.</p></div>
            </div>
            <div className="form-grid two-columns">
              <label className="field"><span>Cliente específico (opcional)</span><input value={customerName} onChange={(event) => setCustomerName(event.target.value)} placeholder="Nome do cliente final" /></label>
              <label className="field"><span>Valor fixado para o cliente (opcional)</span><input inputMode="decimal" value={customerSaleValue} onChange={(event) => setCustomerSaleValue(event.target.value)} onBlur={(event) => setCustomerSaleValue(formatMoneyInput(event.target.value))} placeholder="R$ 0,00" /></label>
              <label className="field"><span>Tipo do documento</span><select value={documentCategory} onChange={(event) => setDocumentCategory(event.target.value as ProposalDocument["category"])}><option value="invoice">Nota fiscal (NF)</option><option value="proof">Comprovante de venda</option><option value="other">Outro documento</option></select></label>
              <label className="field"><span>Anexar documentos (opcional)</span><input type="file" multiple accept="application/pdf,image/jpeg,image/png,image/webp,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(event) => setSelectedDocuments(Array.from(event.target.files ?? []))} /></label>
            </div>
            {selectedDocuments.length > 0 && <div className="selected-documents" aria-live="polite"><strong>Arquivos selecionados</strong>{selectedDocuments.map((file) => <span key={`${file.name}-${file.size}`}>{file.name} · {formatFileSize(file.size)}</span>)}</div>}
            {proposal?.documents?.length ? <div className="existing-documents"><strong>Documentos já anexados</strong>{proposal.documents.map((document) => <a key={document.id} href={`/api/proposals/documents?proposalId=${encodeURIComponent(proposal.id)}&documentId=${document.id}`} target="_blank" rel="noreferrer">{documentCategoryLabel(document.category)} · {document.fileName} · {formatFileSize(document.sizeBytes)}</a>)}</div> : null}
          </section>
          {error && <p className="form-error">{error}</p>}
        </div>

        <footer className="modal-actions">
          <button type="button" className="ghost-button" onClick={onClose}>Cancelar</button>
          {!proposal && <button type="submit" className="outline-button" disabled={saving}>{saving ? "Salvando..." : "Salvar rascunho"}</button>}
          {proposal ? <button type="submit" className="primary-button" disabled={saving}>{saving ? "Salvando..." : "Salvar alterações"}</button> : <button type="button" className="primary-button" disabled={saving || !contactEmail} onClick={(event) => void submit(event as unknown as FormEvent, "sent")}>{saving ? "Enviando..." : "Salvar e enviar por e-mail"}</button>}
        </footer>
      </form>
    </div>
  );
}

function NewAccessModal({ me, dealerships, onClose, onSaved }: { me: CurrentAccess; dealerships: Dealership[]; onClose: () => void; onSaved: () => Promise<void> }) {
  const [name, setName] = useState(""); const [email, setEmail] = useState(""); const [password, setPassword] = useState(""); const [role, setRole] = useState<UserRole>(me.role === "general_admin" ? "global_management" : me.role === "global_management" ? "factory_manager" : me.role === "factory_manager" ? "dealer_manager" : "concession"); const [dealershipId, setDealershipId] = useState<number | null>(me.role === "dealer_manager" || me.role === "concession" ? me.dealershipId : null); const [saving, setSaving] = useState(false); const [error, setError] = useState("");
  async function submit(event: FormEvent) { event.preventDefault(); setSaving(true); setError(""); const response = await fetch("/api/access", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, email, password, role, dealershipId }) }); const payload = (await response.json()) as { error?: string }; if (!response.ok) { setError(payload.error || "Não foi possível criar o acesso."); setSaving(false); return; } await onSaved(); }
  const canChooseRole = ["general_admin", "global_management", "factory_manager"].includes(me.role);
  return <div className="modal-backdrop" role="dialog" aria-modal="true"><form className="access-modal" onSubmit={(event) => void submit(event)}><header className="modal-header"><div><span className="eyebrow">Novo acesso</span><h2>Criar acesso por nível</h2><p>Defina o nível e o escopo operacional deste usuário.</p></div><button type="button" className="icon-button" onClick={onClose}><Icon name="close" /></button></header><div className="form-scroll"><div className="access-form-grid"><label className="field"><span>Nome completo</span><input autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} required /></label><label className="field"><span>E-mail corporativo</span><input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label><label className="field"><span>Senha inicial</span><input type="password" minLength={10} maxLength={128} autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} required /></label>{canChooseRole && <label className="field"><span>Nível de permissão</span><select value={role} onChange={(event) => setRole(event.target.value as UserRole)}>{me.role === "general_admin" && <option value="global_management">Gestão Global</option>}{(me.role === "general_admin" || me.role === "global_management") && <option value="factory_manager">Gestor Fábrica</option>}{(me.role === "general_admin" || me.role === "global_management" || me.role === "factory_manager") && <option value="dealer_manager">Gestor Concessionária</option>}<option value="concession">Concessão</option></select></label>}{me.role !== "dealer_manager" && <label className="field"><span>Concessionária inicial {me.role === "factory_manager" ? "(obrigatória)" : "(opcional)"}</span><select required={me.role === "factory_manager"} value={dealershipId ?? ""} onChange={(event) => setDealershipId(Number(event.target.value) || null)}><option value="">Sem vínculo</option>{dealerships.map((dealer) => <option key={dealer.id} value={dealer.id}>{dealer.name}</option>)}</select></label>}</div><div className="access-note"><strong>{canChooseRole ? "Nível selecionado" : "Concessão"}</strong><p>{canChooseRole ? "O nível define a visão, as ações e o escopo dos dados no portal." : "O acesso ficará restrito à concessionária vinculada."}</p></div>{error && <p className="form-error">{error}</p>}</div><footer className="modal-actions"><button type="button" className="ghost-button" onClick={onClose}>Cancelar</button><button type="submit" className="primary-button" disabled={saving}>{saving ? "Criando..." : "Criar acesso"}</button></footer></form></div>;
}

function AdminPasswordModal({ target, onClose }: { target: AccessUser; onClose: () => void }) {
  const [temporaryPassword, setTemporaryPassword] = useState("");
  const [visible, setVisible] = useState(false);
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function restorePassword() {
    setSaving(true);
    setError("");
    setCopied(false);
    const response = await fetch("/api/access/password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: target.email }),
    });
    const payload = (await response.json()) as { error?: string; temporaryPassword?: string };
    if (!response.ok || !payload.temporaryPassword) {
      setError(payload.error || "Não foi possível restaurar a senha.");
      setSaving(false);
      return;
    }
    setTemporaryPassword(payload.temporaryPassword);
    setVisible(true);
    setSaving(false);
  }

  async function copyPassword() {
    if (!temporaryPassword) return;
    await navigator.clipboard.writeText(temporaryPassword);
    setCopied(true);
  }

  return <div className="modal-backdrop" role="dialog" aria-modal="true">
    <section className="access-modal password-modal">
      <header className="modal-header">
        <div><span className="eyebrow">Controle administrativo</span><h2>Senha de {target.name}</h2><p>O sistema não permite visualizar a senha atual: ela é armazenada somente como proteção criptográfica.</p></div>
        <button type="button" className="icon-button" onClick={onClose} aria-label="Fechar"><Icon name="close" /></button>
      </header>
      <div className="form-scroll">
        <div className="password-recovery-note"><Icon name="key" size={18} /><div><strong>Restaurar acesso</strong><span>Gere uma nova senha temporária. A senha anterior deixa de funcionar e o usuário precisará entrar novamente.</span></div></div>
        {temporaryPassword && <div className="password-result"><span>Nova senha temporária</span><div><input aria-label="Nova senha temporária" readOnly type={visible ? "text" : "password"} value={temporaryPassword} /><button type="button" className="outline-button compact" onClick={() => setVisible((value) => !value)}>{visible ? "Ocultar" : "Ver"}</button><button type="button" className="outline-button compact" onClick={() => void copyPassword()}>{copied ? "Copiada" : "Copiar"}</button></div><small>Copie e envie por um canal seguro. Ela será exibida somente nesta tela.</small></div>}
        {error && <p className="form-error">{error}</p>}
      </div>
      <footer className="modal-actions"><button type="button" className="ghost-button" onClick={onClose}>Fechar</button><button type="button" className="primary-button" disabled={saving} onClick={() => void restorePassword()}>{saving ? "Restaurando..." : temporaryPassword ? "Gerar outra senha" : "Restaurar senha"}</button></footer>
    </section>
  </div>;
}

function ChangePasswordModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (newPassword !== confirmation) {
      setError("A confirmação da nova senha não confere.");
      return;
    }
    setSaving(true);
    setError("");
    const response = await fetch("/api/auth/password", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword, newPassword }),
    });
    const payload = (await response.json()) as { error?: string };
    if (!response.ok) {
      setError(payload.error || "Não foi possível alterar a senha.");
      setSaving(false);
      return;
    }
    onSaved();
  }

  return <div className="modal-backdrop" role="dialog" aria-modal="true"><form className="access-modal password-modal" onSubmit={(event) => void submit(event)}><header className="modal-header"><div><span className="eyebrow">Segurança da conta</span><h2>Alterar senha</h2><p>Use pelo menos 10 caracteres e não compartilhe sua senha.</p></div><button type="button" className="icon-button" onClick={onClose} aria-label="Fechar"><Icon name="close" /></button></header><div className="form-scroll"><div className="password-form-grid"><label className="field"><span>Senha atual</span><input type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} required /></label><label className="field"><span>Nova senha</span><input type="password" minLength={10} maxLength={128} autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} required /></label><label className="field"><span>Confirme a nova senha</span><input type="password" minLength={10} maxLength={128} autoComplete="new-password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} required /></label></div>{error && <p className="form-error">{error}</p>}</div><footer className="modal-actions"><button type="button" className="ghost-button" onClick={onClose}>Cancelar</button><button type="submit" className="primary-button" disabled={saving}>{saving ? "Salvando..." : "Salvar nova senha"}</button></footer></form></div>;
}

/* eslint-disable @typescript-eslint/no-unused-vars */
function ProposalPreviewLegacy({ proposal, me, onClose, onUpdated, onDeleted }: { proposal: Proposal; me: CurrentAccess; onClose: () => void; onUpdated: (status: ProposalStatus, counterofferCents?: number | null) => Promise<void>; onDeleted: () => Promise<void> }) {
  const [status, setStatus] = useState<ProposalStatus>(proposal.status); const [counteroffer, setCounteroffer] = useState(proposal.counterofferCents ? formatMoneyInput(String(proposal.counterofferCents / 100).replace(".", ",")) : ""); const [note, setNote] = useState(proposal.decisionNote); const [updating, setUpdating] = useState(false); const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false); const [deleting, setDeleting] = useState(false);
  async function updateStatus(nextStatus: ProposalStatus) { setUpdating(true); setError(""); const cents = nextStatus === "counteroffer" ? parseMoneyToCents(counteroffer) : null; const response = await fetch("/api/proposals", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: proposal.id, status: nextStatus, counterofferCents: cents, decisionNote: note }) }); const payload = (await response.json()) as { error?: string }; if (!response.ok) { setError(payload.error || "Não foi possível atualizar a proposta."); setUpdating(false); return; } setStatus(nextStatus); await onUpdated(nextStatus, cents); setUpdating(false); }
  async function deleteProposal() { setDeleting(true); setError(""); const response = await fetch("/api/proposals", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: proposal.id }) }); const payload = (await response.json()) as { error?: string }; if (!response.ok) { setError(payload.error || "Não foi possível excluir a proposta."); setDeleting(false); return; } await onDeleted(); }
  const decisionOpen = ["dealer_manager", "concession"].includes(me.role) && ["sent", "counteroffer"].includes(proposal.status);
  const canDelete = me.permissions.deleteAnyProposal || (me.permissions.deleteOwnDraft && proposal.status === "draft" && proposal.createdByEmail === me.email);
  const managerStatuses = STATUS_ORDER.filter((item) => item !== "counteroffer" || proposal.status === "counteroffer");
  return <div className="modal-backdrop preview-backdrop print-overlay" role="dialog" aria-modal="true"><div className="preview-shell"><header className="preview-toolbar no-print"><div><strong>{proposal.id}</strong><span>{["dealer_manager", "concession"].includes(me.role) ? "Análise da concessionária" : "Visualização da proposta"}</span></div><div className="preview-actions">{!decisionOpen && <label>Status<select value={status} disabled={updating} onChange={(event) => void updateStatus(event.target.value as ProposalStatus)}>{managerStatuses.map((item) => <option value={item} key={item}>{STATUS_LABELS[item]}</option>)}</select></label>}<button className="outline-button dark" onClick={() => window.print()}><Icon name="print" size={16} />Imprimir / PDF</button><button className="icon-button dark" onClick={onClose}><Icon name="close" /></button></div></header>{decisionOpen && <section className="decision-panel no-print"><div><span className="eyebrow">Decisão da concessionária</span><h2>Analise e responda à proposta</h2><p>O retorno ficará registrado no histórico comercial.</p></div><label className="field"><span>Observação</span><input value={note} onChange={(event) => setNote(event.target.value)} placeholder="Comentário opcional" /></label><label className="field"><span>Valor da contraproposta</span><input value={counteroffer} onChange={(event) => setCounteroffer(event.target.value)} onBlur={(event) => setCounteroffer(formatMoneyInput(event.target.value))} placeholder="0,00" /></label><div className="decision-actions"><button className="decision-button reject" disabled={updating} onClick={() => void updateStatus("rejected")}>Recusar</button><button className="decision-button counter" disabled={updating} onClick={() => void updateStatus("counteroffer")}>Enviar contraproposta</button><button className="decision-button accept" disabled={updating} onClick={() => void updateStatus("approved")}>Aceitar proposta</button></div>{error && <p className="form-error">{error}</p>}</section>}<article className="proposal-paper"><header className="document-header"><div className="document-title"><h1>Proposta comercial</h1><p>Fornecimento de peças</p></div><HorschDocumentLogo /></header><section className="document-stats"><div><span>Número da proposta</span><strong>{proposal.id}</strong></div><div><span>Data de emissão</span><strong>{formatDate(proposal.issueDate)}</strong></div><div><span>Válida até</span><strong>{formatDate(proposal.validUntil)}</strong></div></section><section className="document-customer"><div><span>Responsável da concessionária</span><strong>{proposal.contactName || "—"}</strong></div><div><span>Concessionária</span><strong>{proposal.dealership}</strong></div></section><p className="document-intro">Apresentamos nossa proposta comercial para o fornecimento dos itens abaixo. Valores e condições permanecem válidos até a data indicada.</p><div className="document-section-title"><h2>Itens da proposta</h2><span>Valores líquidos em reais</span></div><table className="document-items"><thead><tr><th>PN</th><th>VT</th><th>Origem</th><th>NCM</th><th>Quantidade</th><th>Net Price (R$)</th></tr></thead><tbody>{proposal.items.map((item) => <tr key={item.id}><td>{item.partNumber || "—"}</td><td>{item.description || "—"}</td><td>{item.origin || "—"}</td><td>{item.ncm || "—"}</td><td>{item.quantity}</td><td>{formatBRL(item.unitPriceCents)}</td></tr>)}</tbody></table><div className="document-total"><span>Valor total da proposta</span><strong>{formatBRL(proposal.totalCents)}</strong></div>{proposal.counterofferCents && <section className="document-counteroffer"><span>Contraproposta da concessionária</span><strong>{formatBRL(proposal.counterofferCents)}</strong>{proposal.decisionNote && <p>{proposal.decisionNote}</p>}</section>}<section className="document-terms"><strong>Condições comerciais</strong><p>Valores líquidos em reais, sujeitos à disponibilidade de estoque. Tributos e frete seguem as condições vigentes acordadas com a concessionária.</p></section><section className="document-signatures"><div><span className="signature-name">{proposal.commercialOwner}</span><small>Responsável Comercial HORSCH</small></div><div><span /><small>Responsável / Concessionária</small></div></section><footer className="document-footer"><span>HORSCH do Brasil<br />Curitiba · Paraná · Brasil</span><span>Documento confidencial<br />Uso comercial</span></footer></article></div></div>;
}
/* eslint-enable @typescript-eslint/no-unused-vars */

function ProposalPreview({ proposal, me, onClose, onEdit, onUpdated, onDeleted }: { proposal: Proposal; me: CurrentAccess; onClose: () => void; onEdit: () => void; onUpdated: (status: ProposalStatus, counterofferCents?: number | null) => Promise<void>; onDeleted: () => Promise<void> }) {
  const [status, setStatus] = useState<ProposalStatus>(proposal.status);
  const [counterItems, setCounterItems] = useState(() =>
    proposal.items.map((item) => ({
      id: item.id,
      quantity: item.counterofferQuantity ?? item.quantity,
      price: formatMoneyInput(
        String((item.counterofferUnitPriceCents ?? item.unitPriceCents) / 100).replace(".", ","),
      ),
    })),
  );
  const [note, setNote] = useState(proposal.decisionNote);
  const [paymentTerms, setPaymentTerms] = useState(proposal.counterofferPaymentTerms);
  const [freightTerms, setFreightTerms] = useState(proposal.counterofferFreightTerms);
  const [deliveryTerms, setDeliveryTerms] = useState(proposal.counterofferDeliveryTerms);
  const [reviewNote, setReviewNote] = useState(proposal.counterofferReviewNote);
  const [updating, setUpdating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [sendingEmail, setSendingEmail] = useState(false);
  const [emailStatus, setEmailStatus] = useState(proposal.emailStatus);
  const [error, setError] = useState("");

  const decisionOpen =
    proposal.isActionOwner && me.role === "dealer_manager" && ["sent", "counteroffer"].includes(status);
  const canReviewCounteroffer =
    proposal.isActionOwner && ["general_admin", "global_management", "factory_manager"].includes(me.role) && status === "counteroffer";
  const counterofferTotal = counterItems.reduce(
    (sum, item) => sum + item.quantity * parseMoneyToCents(item.price),
    0,
  );
  const originalTotal = proposal.items.reduce(
    (sum, item) => sum + item.quantity * item.unitPriceCents,
    0,
  );
  const managerStatuses = STATUS_ORDER.filter((item) => {
    if (status === "expired") return item === "expired";
    if (item === "expired") return false;
    if (item === "sent" && status !== "sent") return false;
    return item !== "counteroffer" || status === "counteroffer";
  });
  const canDelete =
    me.permissions.deleteAnyProposal ||
    (me.permissions.deleteOwnDraft &&
      status === "draft" &&
      proposal.createdByEmail === me.email);
  const canEdit = proposal.isActionOwner && ["general_admin", "global_management", "factory_manager"].includes(me.role) && status !== "expired";
  const canManageStatus = proposal.isActionOwner && (me.role === "dealer_manager" || ["general_admin", "global_management", "factory_manager"].includes(me.role));

  function updateCounterItem(
    id: number,
    patch: Partial<{ quantity: number; price: string }>,
  ) {
    setCounterItems((current) =>
      current.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    );
  }

  async function sendByEmail() {
    setSendingEmail(true);
    setError("");
    const response = await fetch("/api/proposals", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: proposal.id, action: "send" }),
    });
    const payload = (await response.json()) as {
      error?: string;
      status?: ProposalStatus;
      delivery?: DeliveryResponse;
    };
    if (!response.ok) {
      setError(payload.error || "Não foi possível enviar a proposta por e-mail.");
      setSendingEmail(false);
      return;
    }
    if (payload.delivery?.status === "sent") {
      setEmailStatus("sent");
      setStatus("sent");
      await onUpdated("sent");
    } else {
      setEmailStatus(payload.delivery?.status ?? "failed");
      setError(
        payload.delivery?.error ||
          "A proposta foi mantida como rascunho porque o envio não foi confirmado.",
      );
    }
    setSendingEmail(false);
  }

  async function updateStatus(nextStatus: ProposalStatus) {
    setUpdating(true);
    setError("");
    const cents = nextStatus === "counteroffer" ? counterofferTotal : null;
    const response = await fetch("/api/proposals", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: proposal.id,
        status: nextStatus,
        counterofferCents: cents,
        decisionNote: note,
        counterofferItems:
          nextStatus === "counteroffer"
            ? counterItems.map((item) => ({
                id: item.id,
                quantity: item.quantity,
                unitPriceCents: parseMoneyToCents(item.price),
              }))
            : undefined,
        counterofferPaymentTerms: paymentTerms,
        counterofferFreightTerms: freightTerms,
        counterofferDeliveryTerms: deliveryTerms,
      }),
    });
    const payload = (await response.json()) as { error?: string };
    if (!response.ok) {
      setError(payload.error || "Não foi possível atualizar a proposta.");
      setUpdating(false);
      return;
    }
    setStatus(nextStatus);
    await onUpdated(nextStatus, cents);
    setUpdating(false);
  }

  async function reviewCounteroffer(
    action: "accept_counteroffer" | "return_counteroffer",
  ) {
    setUpdating(true);
    setError("");
    const response = await fetch("/api/proposals", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: proposal.id,
        action,
        counterofferReviewNote: reviewNote,
      }),
    });
    const payload = (await response.json()) as {
      error?: string;
      status?: ProposalStatus;
      counterofferCents?: number;
    };
    if (!response.ok || !payload.status) {
      setError(payload.error || "Não foi possível concluir a análise.");
      setUpdating(false);
      return;
    }
    setStatus(payload.status);
    await onUpdated(payload.status, payload.counterofferCents ?? proposal.counterofferCents);
    setUpdating(false);
  }

  async function deleteProposal() {
    setDeleting(true);
    setError("");
    const response = await fetch("/api/proposals", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: proposal.id }),
    });
    const payload = (await response.json()) as { error?: string };
    if (!response.ok) {
      setError(payload.error || "Não foi possível excluir a proposta.");
      setDeleting(false);
      return;
    }
    await onDeleted();
  }

  return (
    <div className="modal-backdrop preview-backdrop print-overlay" role="dialog" aria-modal="true">
      <div className="preview-shell">
        <header className="preview-toolbar no-print">
          <div>
            <strong>{proposal.id}</strong>
            <span>
              {me.role === "dealer_manager"
                ? "Análise da concessionária"
                : "Visualização da proposta"}
            </span>
          </div>
          <div className="preview-actions">
            {!decisionOpen && canManageStatus && (
              <label>
                Status
                <select
                  value={status}
                  disabled={updating || status === "expired"}
                  onChange={(event) =>
                    void updateStatus(event.target.value as ProposalStatus)
                  }
                >
                  {managerStatuses.map((item) => (
                    <option value={item} key={item}>{STATUS_LABELS[item]}</option>
                  ))}
                </select>
              </label>
            )}
            {canDelete && (
              <button
                type="button"
                className="outline-button danger-dark"
                onClick={() => setConfirmDelete(true)}
              >
                <Icon name="trash" size={16} />
                Excluir
              </button>
            )}
            {canEdit && <button type="button" className="outline-button dark" onClick={onEdit}>Editar proposta</button>}
            {!decisionOpen && proposal.isActionOwner && status !== "expired" && emailStatus !== "sent" && (
              <button
                type="button"
                className="outline-button dark"
                disabled={sendingEmail}
                onClick={() => void sendByEmail()}
              >
                <Icon name="arrow" size={16} />
                {sendingEmail ? "Enviando..." : "Enviar por e-mail"}
              </button>
            )}
            <button type="button" className="outline-button dark" onClick={() => window.print()}>
              <Icon name="print" size={16} />
              Imprimir / PDF
            </button>
            <button type="button" className="icon-button dark" onClick={onClose} aria-label="Fechar">
              <Icon name="close" />
            </button>
          </div>
        </header>

        {confirmDelete && (
          <section className="delete-confirmation no-print" role="alertdialog" aria-labelledby="delete-title">
            <div>
              <span className="eyebrow">Ação irreversível</span>
              <h2 id="delete-title">Excluir a proposta {proposal.id}?</h2>
              <p>A proposta e todos os seus itens serão removidos definitivamente do painel.</p>
              {error && <p className="form-error">{error}</p>}
            </div>
            <div className="delete-confirmation-actions">
              <button
                type="button"
                className="outline-button"
                disabled={deleting}
                onClick={() => {
                  setConfirmDelete(false);
                  setError("");
                }}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="danger-button"
                disabled={deleting}
                onClick={() => void deleteProposal()}
              >
                {deleting ? "Excluindo..." : "Excluir definitivamente"}
              </button>
            </div>
          </section>
        )}

        {error && !confirmDelete && !decisionOpen && (
          <p className="preview-error no-print">{error}</p>
        )}

        {status === "expired" && (
          <section className="expiry-notice no-print" role="status">
            <Icon name="clock" size={21} />
            <div>
              <strong>Proposta expirada automaticamente</strong>
              <span>A vigência terminou em {formatDate(proposal.validUntil)}. O envio e as decisões comerciais foram bloqueados.</span>
            </div>
          </section>
        )}

        {decisionOpen && (
          <section className="decision-panel no-print">
            <header className="counteroffer-form-heading">
              <div>
                <span className="eyebrow">Decisão da concessionária</span>
                <h2>Monte a contraproposta</h2>
                <p>Altere somente quantidade e net price. PN e dados fiscais permanecem protegidos.</p>
              </div>
              <div className="counteroffer-live-total">
                <span>Total proposto</span>
                <strong>{formatBRL(counterofferTotal)}</strong>
                <small>Original: {formatBRL(originalTotal)}</small>
              </div>
            </header>
            <div className="counteroffer-editor-wrap">
              <table className="counteroffer-editor">
                <thead>
                  <tr><th>PN / descrição</th><th>Qtd. original</th><th>Qtd. proposta</th><th>Net price original</th><th>Net price proposto</th><th>Total proposto</th></tr>
                </thead>
                <tbody>
                  {proposal.items.map((item) => {
                    const counterItem = counterItems.find((record) => record.id === item.id)!;
                    const proposedPrice = parseMoneyToCents(counterItem.price);
                    return (
                      <tr key={item.id}>
                        <td><strong>{item.partNumber}</strong><small>{item.description}</small></td>
                        <td>{item.quantity}</td>
                        <td><input type="number" min={1} value={counterItem.quantity} onChange={(event) => updateCounterItem(item.id, { quantity: Math.max(1, Number(event.target.value) || 1) })} aria-label={`Quantidade proposta para ${item.partNumber}`} /></td>
                        <td>{formatBRL(item.unitPriceCents)}</td>
                        <td><input inputMode="decimal" value={counterItem.price} onChange={(event) => updateCounterItem(item.id, { price: event.target.value })} onBlur={(event) => updateCounterItem(item.id, { price: formatMoneyInput(event.target.value) })} aria-label={`Net price proposto para ${item.partNumber}`} /></td>
                        <td>{formatBRL(counterItem.quantity * proposedPrice)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="counteroffer-conditions">
              <label className="field"><span>Condição de pagamento</span><input value={paymentTerms} onChange={(event) => setPaymentTerms(event.target.value)} placeholder="Ex.: 30/60/90 dias" required /></label>
              <label className="field"><span>Condição de frete</span><select value={freightTerms} onChange={(event) => setFreightTerms(event.target.value)} required><option value="">Selecione</option><option value="Manter condição original">Manter condição original</option><option value="CIF - HORSCH responsável pelo frete">CIF — HORSCH</option><option value="FOB - concessionária responsável pelo frete">FOB — Concessionária</option></select></label>
              <label className="field"><span>Prazo de entrega solicitado</span><input value={deliveryTerms} onChange={(event) => setDeliveryTerms(event.target.value)} placeholder="Ex.: até 15 dias após o pedido" required /></label>
              <label className="field counteroffer-note"><span>Justificativa obrigatória</span><input value={note} onChange={(event) => setNote(event.target.value)} placeholder="Explique o motivo comercial da contraproposta" required /></label>
            </div>
            <div className="decision-actions">
              <button className="decision-button reject" disabled={updating} onClick={() => void updateStatus("rejected")}>Recusar</button>
              <button className="decision-button counter" disabled={updating || !counterofferTotal || !note.trim() || !paymentTerms.trim() || !freightTerms.trim() || !deliveryTerms.trim()} onClick={() => void updateStatus("counteroffer")}>{updating ? "Enviando..." : status === "counteroffer" ? "Atualizar contraproposta" : "Enviar contraproposta"}</button>
              <button className="decision-button accept" disabled={updating} onClick={() => void updateStatus("approved")}>Aceitar proposta</button>
            </div>
            {error && <p className="form-error">{error}</p>}
          </section>
        )}

        {canReviewCounteroffer && (
          <section className="counteroffer-review-panel no-print">
            <div>
              <span className="eyebrow">Análise da fábrica</span>
              <h2>Contraproposta recebida</h2>
              <p>Revise a comparação abaixo. Ao devolver, a proposta volta para a concessionária como aberta.</p>
            </div>
            <label className="field">
              <span>Comentário da análise</span>
              <input value={reviewNote} onChange={(event) => setReviewNote(event.target.value)} placeholder="Opcional para aceite; recomendado ao devolver" />
            </label>
            <div className="counteroffer-review-actions">
              <button type="button" className="outline-button" disabled={updating} onClick={() => void reviewCounteroffer("return_counteroffer")}>Devolver para ajuste</button>
              <button type="button" className="primary-button approve-counteroffer" disabled={updating} onClick={() => void reviewCounteroffer("accept_counteroffer")}>{updating ? "Salvando..." : "Aceitar contraproposta"}</button>
            </div>
            {error && <p className="form-error">{error}</p>}
          </section>
        )}

        {proposal.documents?.length > 0 && (
          <section className="document-attachments no-print">
            <div><span className="eyebrow">Documentação da venda</span><h2>Documentos anexados</h2><p>Arquivos vinculados à venda do concessionário ao cliente.</p></div>
            <div className="document-attachment-list">{proposal.documents.map((document) => <a key={document.id} href={`/api/proposals/documents?proposalId=${encodeURIComponent(proposal.id)}&documentId=${document.id}`} target="_blank" rel="noreferrer"><Icon name="file" size={16} /><span><strong>{document.fileName}</strong><small>{documentCategoryLabel(document.category)} · {formatFileSize(document.sizeBytes)}</small></span><Icon name="arrow" size={15} /></a>)}</div>
          </section>
        )}

        <article className="proposal-paper">
          <header className="document-header">
            <div className="document-title">
              <h1>Proposta comercial</h1>
            </div>
            <div className="document-brand-block">
              <HorschDocumentLogo />
            </div>
          </header>
          <section className="document-stats">
            <div><span>Número da proposta</span><strong>{proposal.id}</strong></div>
            <div><span>Data de emissão</span><strong>{formatDate(proposal.issueDate)}</strong></div>
            <div><span>Válida até</span><strong>{formatDate(proposal.validUntil)}</strong></div>
          </section>
          <section className="document-customer">
            <div><span>Responsável da concessionária</span><strong>{proposal.contactName || "—"}</strong><small>{proposal.contactEmail || "E-mail não cadastrado"}</small></div>
            <div><span>Concessionária</span><strong>{proposal.dealership}</strong></div>
            <div><span>Responsável HORSCH</span><strong>{proposal.commercialOwner}</strong><small>{proposal.factoryManagerEmail || proposal.createdByEmail}</small></div>
          </section>
          {(proposal.customerName || proposal.customerSaleValueCents) && <section className="document-sale-data"><div><span>Cliente específico</span><strong>{proposal.customerName || "—"}</strong></div><div><span>Valor fixado para o cliente</span><strong>{proposal.customerSaleValueCents ? formatBRL(proposal.customerSaleValueCents) : "—"}</strong></div></section>}
          <div className="document-section-title"><h2>Itens da proposta</h2><span>Valores líquidos em reais</span></div>
          <table className="document-items">
            <thead><tr><th>PN</th><th>Descrição</th><th>VT</th><th>Origem</th><th>NCM</th><th>Qtd.</th><th>Net price (R$)</th></tr></thead>
            <tbody>
              {proposal.items.map((item) => (
                <tr key={item.id}>
                  <td>{item.partNumber || "—"}</td>
                  <td>{item.description || "—"}</td>
                  <td>{item.vt || "—"}</td>
                  <td>{item.origin || "—"}</td>
                  <td>{item.ncm || "—"}</td>
                  <td>{item.quantity}</td>
                  <td>{formatBRL(item.unitPriceCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="document-total"><span>Valor total da proposta</span><strong>{formatBRL(proposal.totalCents)}</strong></div>
          {(proposal.counterofferCents || status === "counteroffer") && (
            <section className="document-counteroffer-detail">
              <div className="document-section-title">
                <h2>Contraproposta da concessionária</h2>
                <span>{proposal.counterofferSubmittedAt ? `Enviada em ${formatDateTime(proposal.counterofferSubmittedAt)}` : "Em edição"}</span>
              </div>
              <table className="document-counteroffer-table">
                <thead><tr><th>PN</th><th>Qtd. original</th><th>Qtd. proposta</th><th>Net original</th><th>Net proposto</th><th>Variação</th></tr></thead>
                <tbody>
                  {proposal.items.map((item) => {
                    const edited = counterItems.find((record) => record.id === item.id);
                    const proposedQuantity = edited?.quantity ?? item.counterofferQuantity ?? item.quantity;
                    const proposedPrice = edited ? parseMoneyToCents(edited.price) : item.counterofferUnitPriceCents ?? item.unitPriceCents;
                    const variation = item.unitPriceCents ? ((proposedPrice - item.unitPriceCents) / item.unitPriceCents) * 100 : 0;
                    return <tr key={item.id}><td>{item.partNumber}</td><td>{item.quantity}</td><td>{proposedQuantity}</td><td>{formatBRL(item.unitPriceCents)}</td><td>{formatBRL(proposedPrice)}</td><td>{variation > 0 ? "+" : ""}{variation.toFixed(1).replace(".", ",")}%</td></tr>;
                  })}
                </tbody>
              </table>
              <div className="document-counteroffer-summary">
                <div><span>Original</span><strong>{formatBRL(originalTotal)}</strong></div>
                <div><span>Contraproposta</span><strong>{formatBRL(counterofferTotal || proposal.counterofferCents || 0)}</strong></div>
              </div>
              <dl className="document-counteroffer-terms">
                <div><dt>Pagamento</dt><dd>{paymentTerms || "—"}</dd></div>
                <div><dt>Frete</dt><dd>{freightTerms || "—"}</dd></div>
                <div><dt>Entrega</dt><dd>{deliveryTerms || "—"}</dd></div>
                <div><dt>Justificativa</dt><dd>{note || "—"}</dd></div>
              </dl>
              <p className="document-counteroffer-owner">Enviada por {proposal.decidedByEmail || me.email}</p>
              {proposal.counterofferReviewedAt && (
                <p className="document-counteroffer-review">Analisada por {proposal.counterofferReviewedByEmail} em {formatDateTime(proposal.counterofferReviewedAt)}{proposal.counterofferReviewNote ? ` · ${proposal.counterofferReviewNote}` : ""}</p>
              )}
            </section>
          )}
          <section className="document-terms"><strong>Condições comerciais</strong><p>Valores líquidos em reais, sujeitos à disponibilidade de estoque. Tributos e frete seguem as condições vigentes acordadas com a concessionária.</p></section>
          <section className="document-signatures">
            <div><span className="signature-name">{proposal.commercialOwner}</span><small>Responsável Comercial HORSCH</small></div>
            <div><span /><small>Responsável / Concessionária</small></div>
          </section>
          <footer className="document-footer"><span>HORSCH do Brasil<br />Curitiba · Paraná · Brasil</span><span>Documento confidencial<br />Uso comercial</span></footer>
        </article>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: ProposalStatus }) { return <span className={`status-badge ${status}`}><i />{STATUS_LABELS[status]}</span>; }
type AuditChange = { label: string; before: string; after: string };

const AUDIT_FIELD_LABELS: Record<string, string> = {
  dealership: "Concessionária",
  contactName: "Responsável da concessionária",
  contactEmail: "E-mail do responsável",
  commercialOwner: "Responsável HORSCH",
  status: "Status",
  validUntil: "Validade da proposta",
  totalCents: "Valor total da proposta",
  customerName: "Cliente específico",
  customerSaleValueCents: "Valor fixado para o cliente",
  decisionNote: "Observação",
  emailStatus: "Status do envio",
  items: "Itens da proposta",
};

const AUDIT_IGNORED_FIELDS = new Set(["id", "dealershipId", "documentId", "contentType", "sizeBytes"]);

function HistoryView({ proposalId }: { proposalId: string | null }) {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => { let active = true; void fetch("/api/audit", { cache: "no-store" }).then(async (response) => { const payload = (await response.json()) as { entries?: AuditEntry[]; error?: string }; if (!response.ok) throw new Error(payload.error || "Não foi possível carregar o histórico."); if (active) setEntries(payload.entries ?? []); }).catch((loadError) => { if (active) setError(loadError instanceof Error ? loadError.message : "Erro ao carregar o histórico."); }).finally(() => { if (active) setLoading(false); }); return () => { active = false; }; }, []);
  const visibleEntries = proposalId ? entries.filter((entry) => entry.proposalId === proposalId) : [];
  return <div className="content-frame"><header className="page-heading"><div><span className="eyebrow">Governança e segurança</span><h1>Histórico da proposta</h1><p>{proposalId ? `Registro das ações realizadas em ${proposalId}.` : "Abra o histórico pelo ícone de olho ao lado de uma proposta."}</p></div></header><section className="panel history-panel"><div className="history-intro"><div><strong>Alterações realizadas</strong><span>{proposalId ? `Histórico filtrado da proposta ${proposalId}.` : "Cada registro mostra apenas o campo que mudou e seus novos valores."}</span></div><span className="history-count">{visibleEntries.length} registros</span></div>{loading ? <EmptyMini text="Carregando histórico..." /> : error ? <div className="history-error">{error}</div> : visibleEntries.length === 0 ? <EmptyState title={proposalId ? "Nenhuma ação registrada" : "Nenhuma proposta selecionada"} text={proposalId ? "As próximas ações aparecerão aqui." : "Use o olho ao lado da proposta para abrir seu histórico."} /> : <div className="history-list">{visibleEntries.map((entry) => { const changes = auditChanges(entry); return <article className="history-row" key={entry.id}><div className="history-date"><strong>{formatDateTime(entry.createdAt)}</strong><small>{entry.actorName || entry.actorEmail}</small></div><div className="history-action"><span className={`history-action-tag ${entry.entity}`}>{entry.entity === "proposal" ? "Proposta" : entry.entity === "proposal_document" ? "Documento" : "Acesso"}</span><strong>{auditActionLabel(entry.action)}</strong><small>{entry.proposalId || "Ação geral do portal"}</small></div><div className="history-change-area">{changes.length ? <><strong className="history-change-heading">O que mudou</strong><div className="history-change-list">{changes.map((change) => <div className="history-change" key={change.label}><span>{change.label}</span><div><small>{change.before}</small><b>→</b><strong>{change.after}</strong></div></div>)}</div></> : <p className="history-summary">{entry.details}</p>}</div></article>; })}</div>}</section></div>;
}
function auditActionLabel(action: string) { const labels: Record<string, string> = { created: "Criada", edited: "Editada", sent: "Enviada", status_changed: "Status alterado", deleted: "Excluída", document_attached: "Documento anexado", access_created: "Acesso criado", access_updated: "Acesso atualizado", access_password_reset: "Senha restaurada" }; return labels[action] || action; }
function auditChanges(entry: AuditEntry): AuditChange[] {
  if (["created", "deleted", "document_attached", "access_created"].includes(entry.action)) return [];
  const before = parseAuditSnapshot(entry.beforeJson);
  const after = parseAuditSnapshot(entry.afterJson);
  const keys = Array.from(new Set([...Object.keys(before), ...Object.keys(after)]));
  return keys.filter((key) => !AUDIT_IGNORED_FIELDS.has(key) && !auditValuesEqual(before[key], after[key])).map((key) => ({
    label: AUDIT_FIELD_LABELS[key] || key,
    before: formatAuditValue(key, before[key]),
    after: formatAuditValue(key, after[key]),
  }));
}
function parseAuditSnapshot(value: string): Record<string, unknown> { if (!value) return {}; try { const parsed = JSON.parse(value); return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}; } catch { return {}; } }
function auditValuesEqual(before: unknown, after: unknown) { return JSON.stringify(before) === JSON.stringify(after); }
function formatAuditValue(field: string, value: unknown): string {
  if (value === null || value === undefined || value === "") return "Não informado";
  if (field === "status") return STATUS_LABELS[value as ProposalStatus] || String(value);
  if (["totalCents", "customerSaleValueCents"].includes(field) && typeof value === "number") return formatBRL(value);
  if (field === "validUntil" && typeof value === "string") return formatDate(value);
  if (field === "items" && Array.isArray(value)) return `${value.length} ${value.length === 1 ? "item" : "itens"}`;
  if (field === "emailStatus") return String(value).replaceAll("_", " ");
  return typeof value === "string" ? value : JSON.stringify(value);
}
function LoadingState() { return <div className="center-state"><span className="state-mark">H</span><h1>Preparando o portal comercial</h1><p>Carregando seu perfil e as informações autorizadas.</p></div>; }
function ErrorState({ message, retry }: { message: string; retry: () => Promise<void> }) { return <div className="center-state"><span className="state-mark">!</span><h1>Acesso não disponível</h1><p>{message}</p><div className="state-actions"><button className="primary-button" onClick={() => void retry()}>Tentar novamente</button><Link className="outline-button" href="/">Voltar ao login</Link></div></div>; }
function EmptyState({ title, text }: { title: string; text: string }) { return <div className="empty-state"><span><Icon name="file" size={24} /></span><h3>{title}</h3><p>{text}</p></div>; }
function EmptyMini({ text }: { text: string }) { return <div className="empty-mini">{text}</div>; }
function formatBRL(cents: number) { return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 2 }).format(cents / 100); }
function formatDate(value: string) { if (!value) return "—"; const date = value.length === 10 ? new Date(`${value}T12:00:00`) : new Date(value); return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("pt-BR"); }
function formatDateTime(value: string) { if (!value) return "—"; const date = new Date(value); return Number.isNaN(date.getTime()) ? value : date.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }); }
function initials(value: string) { return value.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part.charAt(0)).join("").toUpperCase() || "HB"; }
function firstName(value: string) { const name = value.trim().split(/\s+/)[0]; return name && !name.includes("@") ? name : "bem-vindo"; }
function defaultValidity() { const date = new Date(); date.setDate(date.getDate() + 30); return date.toISOString().slice(0, 10); }
function parseMoneyToCents(value: string) { const cleaned = String(value).replace(/[^\d,.-]/g, ""); const normalized = cleaned.includes(",") ? cleaned.replace(/\./g, "").replace(",", ".") : cleaned; return Math.max(0, Math.round((Number(normalized) || 0) * 100)); }
function formatMoneyInput(value: string) { const cents = parseMoneyToCents(value); if (!value.trim() && !cents) return ""; return (cents / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function formatFileSize(bytes: number) { if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`; return `${(bytes / (1024 * 1024)).toFixed(1).replace(".", ",")} MB`; }
function documentCategoryLabel(category: ProposalDocument["category"]) { return category === "invoice" ? "Nota fiscal (NF)" : category === "proof" ? "Comprovante de venda" : "Outro documento"; }
function scopeDescription(me: CurrentAccess) { return ["general_admin", "global_management"].includes(me.role) ? "Visão consolidada de toda a operação e dos acessos autorizados." : me.role === "factory_manager" ? "Carteira atribuída, propostas e acessos das concessionárias sob sua gestão." : me.role === "dealer_manager" ? "Propostas e decisões comerciais exclusivamente da sua concessionária." : "Acesso exclusivamente consultivo à lista de preços."; }
function accessDescription(role: UserRole) { return role === "general_admin" ? "Controle total de usuários, permissões e dados do portal." : role === "global_management" ? "Gerencie os níveis abaixo, responda cotações, propostas, preços, DSH, campanhas e análises." : role === "factory_manager" ? "Crie propostas, gerencie DSH, analise cotações abertas, coloque pedidos e administre níveis abaixo." : role === "dealer_manager" ? "Solicite cotações, responda propostas, aprove retornos, faça DSH e consulte preços." : "Seu perfil pode apenas consultar a lista de preços."; }
