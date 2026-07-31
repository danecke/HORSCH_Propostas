"use client";

import type { FormEvent, ReactNode } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ChatGPTUser } from "./chatgpt-auth";

type UserRole = "admin" | "factory_manager" | "dealer_manager";
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
  origin: string;
  ncm: string;
  quantity: number;
  unitPriceCents: number;
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
  counterofferCents: number | null;
  decisionNote: string;
  decidedByEmail: string;
  createdByEmail: string;
  createdAt: string;
  updatedAt: string;
  items: ProposalItem[];
};

type Dealership = {
  id: number;
  name: string;
  city: string;
  state: string;
  contactName: string;
  contactEmail: string;
  factoryManagerEmail: string;
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
    createProposal: boolean;
    manageAllAccess: boolean;
    decideProposal: boolean;
  };
};

type DashboardData = {
  proposals: Proposal[];
  dealerships: Dealership[];
  users: AccessUser[];
  me: CurrentAccess;
};

type View = "overview" | "proposals" | "dealerships" | "access";

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
  | "close";

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
    close: <path d="m6 6 12 12M18 6 6 18" />,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

function BrandMark({ className = "" }: { className?: string }) {
  return <svg className={className} viewBox="0 0 73 74" aria-hidden="true"><path fill="currentColor" d="M36.5 1.5C16.9 1.5 1.1 17.4 1.1 37s15.9 35.4 35.4 35.4S71.9 56.5 71.9 37C72 17.4 56.1 1.5 36.5 1.5Zm-.3 38.6-11.9 0c-.6 0-1.1.4-1.2.9l-2.9 10.6c-.3 1-1.2 1.7-2.2 1.7l-2.5 0c-1.2 0-2-1.1-1.7-2.2l3-11.1 1.8-6.4 3.2-11.8c.2-.8 1-1.4 1.9-1.4h3.2c.9 0 1.6.9 1.4 1.8l-2.8 10.4c-.1.5.2 1 .8 1h11.4c.9 0 1.6.9 1.4 1.8l-.8 3.1c-.2 1-.9 1.6-1.8 1.6Zm25.9-4.6-.8 3.1c-.2.9-1 1.5-1.9 1.5H48c-.6 0-1.5.4-1.7.9l-2.9 10.6c-.3 1-1.2 1.7-2.2 1.7h-2.5c-1.2 0-2-1.1-1.7-2.2l3-11.1 1.8-6.4L45 21.8c.2-.8 1-1.4 1.9-1.4h3.2c.9 0 1.6.9 1.4 1.8l-2.8 10.4c-.1.5.2 1 .8 1h11.4c.8.1 1.5 1 1.2 1.9Z" /></svg>;
}

export function Dashboard({ user }: { user: ChatGPTUser }) {
  const [view, setView] = useState<View>("overview");
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | ProposalStatus>("all");
  const [showNewProposal, setShowNewProposal] = useState(false);
  const [showNewAccess, setShowNewAccess] = useState(false);
  const [preview, setPreview] = useState<Proposal | null>(null);
  const [notice, setNotice] = useState("");

  const loadData = useCallback(async () => {
    try {
      setError("");
      const response = await fetch("/api/proposals", { cache: "no-store" });
      const payload = (await response.json()) as DashboardData & { error?: string };
      if (!response.ok) throw new Error(payload.error || "Não foi possível carregar os dados.");
      setData(payload);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Erro ao carregar dados.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { const timer = window.setTimeout(() => void loadData(), 0); return () => window.clearTimeout(timer); }, [loadData]);
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
  const factoryManagers = data.users.filter((item) => item.role === "factory_manager" && item.active);
  async function refreshed(message: string) { setNotice(message); await loadData(); }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand-lockup"><BrandMark className="brand-mark" /><div><strong>HORSCH</strong><span>Brasil</span></div></div>
        <div className="role-card"><span>Perfil ativo</span><strong>{data.me.roleLabel}</strong><small>{scopeDescription(data.me)}</small></div>
        <nav className="sidebar-nav" aria-label="Navegação principal">
          <NavButton active={view === "overview"} icon="grid" onClick={() => setView("overview")}>Visão geral</NavButton>
          <NavButton active={view === "proposals"} icon="file" onClick={() => setView("proposals")}>Propostas</NavButton>
          <NavButton active={view === "dealerships"} icon="building" onClick={() => setView("dealerships")}>Concessionárias</NavButton>
          <NavButton active={view === "access"} icon="users" onClick={() => setView("access")}>Acessos</NavButton>
        </nav>
        {canCreate && <button className="sidebar-new" onClick={() => setShowNewProposal(true)}><Icon name="plus" size={17} />Nova proposta</button>}
        <div className="sidebar-footer"><div className="user-avatar">{initials(user.displayName)}</div><div className="user-copy"><strong>{user.displayName}</strong><span>{user.email}</span></div><a className="signout-link" href="/signout-with-chatgpt?return_to=/" title="Sair">↗</a></div>
      </aside>

      <section className="workspace">
        <header className="mobile-header"><div className="mobile-lockup"><BrandMark className="mobile-mark" /><strong>HORSCH</strong></div><span className="mobile-role">{data.me.roleLabel}</span></header>
        {notice && <div className="toast" role="status"><Icon name="check" size={17} />{notice}</div>}
        {view === "overview" ? (
          <Overview data={data} onNew={() => setShowNewProposal(true)} onOpen={setPreview} onAll={() => setView("proposals")} />
        ) : view === "proposals" ? (
          <ProposalsView proposals={filteredProposals} allCount={data.proposals.length} search={search} onSearch={setSearch} status={statusFilter} onStatus={setStatusFilter} canCreate={canCreate} onNew={() => setShowNewProposal(true)} onOpen={setPreview} />
        ) : view === "dealerships" ? (
          <DealershipsView dealerships={data.dealerships} proposals={data.proposals} onOpen={setPreview} />
        ) : (
          <AccessView data={data} onNew={() => setShowNewAccess(true)} onChanged={() => refreshed("Acesso atualizado com segurança.")} />
        )}
        <nav className="mobile-nav" aria-label="Navegação móvel">
          <NavButton active={view === "overview"} icon="grid" onClick={() => setView("overview")}>Visão</NavButton>
          <NavButton active={view === "proposals"} icon="file" onClick={() => setView("proposals")}>Propostas</NavButton>
          <NavButton active={view === "dealerships"} icon="building" onClick={() => setView("dealerships")}>Rede</NavButton>
          <NavButton active={view === "access"} icon="users" onClick={() => setView("access")}>Acessos</NavButton>
        </nav>
      </section>

      {showNewProposal && <NewProposalModal userName={data.me.name} role={data.me.role} factoryManagers={factoryManagers} onClose={() => setShowNewProposal(false)} onSaved={async () => { setShowNewProposal(false); await refreshed("Proposta salva com sucesso."); }} />}
      {showNewAccess && <NewAccessModal me={data.me} dealerships={data.dealerships} onClose={() => setShowNewAccess(false)} onSaved={async () => { setShowNewAccess(false); await refreshed("Novo acesso criado com sucesso."); }} />}
      {preview && <ProposalPreview proposal={preview} me={data.me} onClose={() => setPreview(null)} onUpdated={async (status, counterofferCents) => { setPreview({ ...preview, status, counterofferCents: counterofferCents ?? null }); await refreshed("Proposta atualizada com sucesso."); }} />}
    </main>
  );
}

function NavButton({ active, icon, children, onClick }: { active: boolean; icon: IconName; children: ReactNode; onClick: () => void }) {
  return <button className={`nav-button ${active ? "active" : ""}`} onClick={onClick}><Icon name={icon} size={19} /><span>{children}</span></button>;
}

function Overview({ data, onNew, onOpen, onAll }: { data: DashboardData; onNew: () => void; onOpen: (proposal: Proposal) => void; onAll: () => void }) {
  const totalCents = data.proposals.reduce((sum, proposal) => sum + proposal.totalCents, 0);
  const approved = data.proposals.filter((proposal) => proposal.status === "approved").length;
  const decided = data.proposals.filter((proposal) => ["approved", "rejected"].includes(proposal.status)).length;
  const approvalRate = decided ? Math.round((approved / decided) * 100) : 0;
  const pending = data.proposals.filter((proposal) => ["sent", "counteroffer"].includes(proposal.status)).length;
  return <div className="content-frame">
    <header className="page-heading overview-heading"><div><span className="eyebrow">{data.me.roleLabel}</span><h1>Olá, {firstName(data.me.name)}.</h1><p>{scopeDescription(data.me)}</p></div>{data.me.permissions.createProposal && <button className="primary-button" onClick={onNew}><Icon name="plus" size={18} />Nova proposta</button>}</header>
    <section className="metric-grid" aria-label="Indicadores comerciais">
      <MetricCard label="Valor em propostas" value={formatBRL(totalCents)} meta={`${data.proposals.length} propostas visíveis`} icon="money" tone="red" />
      <MetricCard label="Aguardando decisão" value={String(pending)} meta="Enviadas e contrapropostas" icon="clock" tone="amber" />
      <MetricCard label="Taxa de aceite" value={`${approvalRate}%`} meta={`${approved} propostas aceitas`} icon="trend" tone="green" />
      <MetricCard label="Concessionárias" value={String(data.dealerships.length)} meta="Dentro do seu escopo" icon="building" tone="dark" />
    </section>
    <section className="dashboard-grid">
      <article className="panel pipeline-panel"><PanelHeader title="Fluxo de propostas" subtitle="Distribuição por decisão comercial" /><Pipeline proposals={data.proposals} /></article>
      <article className="panel dealers-panel"><PanelHeader title="Carteira de concessionárias" subtitle="Maior valor acumulado" /><div className="dealer-ranking">{data.dealerships.slice(0, 4).map((dealer, index) => <div className="ranking-row" key={dealer.id}><span className="ranking-index">{String(index + 1).padStart(2, "0")}</span><span className="dealer-monogram">{initials(dealer.name)}</span><div><strong>{dealer.name}</strong><small>{dealer.city}{dealer.state ? ` · ${dealer.state}` : ""}</small></div><span className="ranking-value">{formatBRL(dealer.totalCents)}</span></div>)}{!data.dealerships.length && <EmptyMini text="Nenhuma concessionária vinculada." />}</div></article>
    </section>
    <article className="panel proposals-panel"><PanelHeader title="Propostas recentes" subtitle="Últimas movimentações no seu escopo" action={<button className="text-button" onClick={onAll}>Ver todas <Icon name="arrow" size={15} /></button>} /><ProposalTable proposals={data.proposals.slice(0, 7)} onOpen={onOpen} /></article>
  </div>;
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
  ];
  const max = Math.max(1, ...stages.map((stage) => proposals.filter((proposal) => proposal.status === stage.status).length));
  return <div className="pipeline-list">{stages.map((stage) => { const matches = proposals.filter((proposal) => proposal.status === stage.status); const count = matches.length; const value = matches.reduce((sum, proposal) => sum + proposal.totalCents, 0); return <div className="pipeline-row" key={stage.status}><div className="pipeline-label"><span>{stage.label}</span><strong>{count}</strong></div><div className="pipeline-track"><span className={`pipeline-fill ${stage.status}`} style={{ width: `${Math.max(count ? 10 : 0, (count / max) * 100)}%` }} /></div><small>{formatBRL(value)}</small></div>; })}</div>;
}

function ProposalsView({ proposals, allCount, search, onSearch, status, onStatus, canCreate, onNew, onOpen }: { proposals: Proposal[]; allCount: number; search: string; onSearch: (value: string) => void; status: "all" | ProposalStatus; onStatus: (value: "all" | ProposalStatus) => void; canCreate: boolean; onNew: () => void; onOpen: (proposal: Proposal) => void }) {
  return <div className="content-frame"><header className="page-heading"><div><span className="eyebrow">Operação comercial</span><h1>Propostas</h1><p>{allCount} registros dentro do seu nível de acesso.</p></div>{canCreate && <button className="primary-button" onClick={onNew}><Icon name="plus" size={18} />Nova proposta</button>}</header><article className="panel full-list-panel"><div className="list-toolbar"><label className="search-field"><Icon name="search" size={18} /><input value={search} onChange={(event) => onSearch(event.target.value)} placeholder="Buscar proposta, concessionária ou responsável" /></label><select value={status} onChange={(event) => onStatus(event.target.value as "all" | ProposalStatus)} aria-label="Filtrar por status"><option value="all">Todos os status</option>{STATUS_ORDER.map((item) => <option key={item} value={item}>{STATUS_LABELS[item]}</option>)}</select></div><ProposalTable proposals={proposals} onOpen={onOpen} /></article></div>;
}

function ProposalTable({ proposals, onOpen }: { proposals: Proposal[]; onOpen: (proposal: Proposal) => void }) {
  if (!proposals.length) return <EmptyState title="Nenhuma proposta encontrada" text="Não há propostas neste escopo ou com os filtros selecionados." />;
  return <div className="table-scroll"><table className="data-table"><thead><tr><th>Proposta</th><th>Concessionária</th><th>Emissão</th><th>Responsável</th><th>Status</th><th className="align-right">Valor</th><th aria-label="Abrir" /></tr></thead><tbody>{proposals.map((proposal) => <tr key={proposal.id} onClick={() => onOpen(proposal)}><td><strong className="proposal-id">{proposal.id}</strong><small>{proposal.items.length} {proposal.items.length === 1 ? "item" : "itens"}</small></td><td><strong>{proposal.dealership}</strong><small>{proposal.city}{proposal.state ? ` · ${proposal.state}` : ""}</small></td><td>{formatDate(proposal.issueDate)}</td><td>{proposal.commercialOwner}</td><td><StatusBadge status={proposal.status} /></td><td className="align-right value-cell">{formatBRL(proposal.totalCents)}</td><td><button className="row-action" onClick={(event) => { event.stopPropagation(); onOpen(proposal); }} aria-label={`Abrir ${proposal.id}`}><Icon name="arrow" size={16} /></button></td></tr>)}</tbody></table></div>;
}

function DealershipsView({ dealerships, proposals, onOpen }: { dealerships: Dealership[]; proposals: Proposal[]; onOpen: (proposal: Proposal) => void }) {
  return <div className="content-frame"><header className="page-heading"><div><span className="eyebrow">Carteira comercial</span><h1>Concessionárias</h1><p>Parceiros disponíveis dentro do seu nível de permissão.</p></div></header>{!dealerships.length ? <article className="panel"><EmptyState title="Nenhuma concessionária vinculada" text="Crie uma proposta para iniciar a carteira ou solicite a vinculação ao ADM." /></article> : <section className="dealership-grid">{dealerships.map((dealer) => { const latest = proposals.find((proposal) => proposal.dealershipId === dealer.id); return <article className="dealer-card" key={dealer.id}><header><span className="dealer-large-monogram">{initials(dealer.name)}</span><div><h2>{dealer.name}</h2><p>{dealer.city}{dealer.state ? ` · ${dealer.state}` : ""}</p></div></header><dl><div><dt>Propostas</dt><dd>{dealer.proposals}</dd></div><div><dt>Aceitas</dt><dd>{dealer.approved}</dd></div><div><dt>Valor</dt><dd>{formatBRL(dealer.totalCents)}</dd></div></dl><div className="dealer-manager"><span>Gestor Fábrica</span><strong>{dealer.factoryManagerEmail || "Não atribuído"}</strong></div><footer><div><span>Contato</span><strong>{dealer.contactName || dealer.contactEmail || "Não informado"}</strong></div>{latest && <button className="text-button" onClick={() => onOpen(latest)}>Abrir última <Icon name="arrow" size={14} /></button>}</footer></article>; })}</section>}</div>;
}

function AccessView({ data, onNew, onChanged }: { data: DashboardData; onNew: () => void; onChanged: () => Promise<void> }) {
  const [busy, setBusy] = useState("");
  async function toggleAccess(record: AccessUser) {
    setBusy(record.email);
    const response = await fetch("/api/access", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: record.email, active: !record.active }) });
    const payload = (await response.json()) as { error?: string };
    if (!response.ok) window.alert(payload.error || "Não foi possível atualizar o acesso."); else await onChanged();
    setBusy("");
  }
  return <div className="content-frame"><header className="page-heading"><div><span className="eyebrow">Segurança e governança</span><h1>Gestão de acessos</h1><p>{accessDescription(data.me.role)}</p></div><button className="primary-button" onClick={onNew}><Icon name="plus" size={18} />Criar acesso</button></header><section className="permission-summary"><PermissionCard title="ADM" text="Visão total, todos os lançamentos e gestão completa de acessos." active={data.me.role === "admin"} /><PermissionCard title="Gestor Fábrica" text="Carteira atribuída, propostas e acessos das concessionárias atendidas." active={data.me.role === "factory_manager"} /><PermissionCard title="Gestor Concessionária" text="Propostas da própria empresa, decisões e acessos internos." active={data.me.role === "dealer_manager"} /></section><article className="panel access-panel"><PanelHeader title="Usuários no seu escopo" subtitle={`${data.users.length} acessos cadastrados`} /><div className="table-scroll"><table className="data-table access-table"><thead><tr><th>Usuário</th><th>Perfil</th><th>Concessionária</th><th>Status</th><th className="align-right">Ação</th></tr></thead><tbody>{data.users.map((record) => { const dealer = data.dealerships.find((item) => item.id === record.dealershipId); return <tr key={record.email}><td><strong>{record.name}</strong><small>{record.email}</small></td><td><span className="role-badge">{record.roleLabel}</span></td><td>{dealer?.name || "—"}</td><td><span className={`access-status ${record.active ? "active" : "inactive"}`}>{record.active ? "Ativo" : "Inativo"}</span></td><td className="align-right"><button className="outline-button compact" disabled={busy === record.email || record.email === data.me.email} onClick={() => void toggleAccess(record)}>{record.email === data.me.email ? "Seu acesso" : record.active ? "Desativar" : "Ativar"}</button></td></tr>; })}</tbody></table></div></article></div>;
}

function PermissionCard({ title, text, active }: { title: string; text: string; active: boolean }) {
  return <article className={`permission-card ${active ? "current" : ""}`}><span>{active ? "Seu perfil" : "Nível de acesso"}</span><h2>{title}</h2><p>{text}</p></article>;
}

type FormItem = { partNumber: string; description: string; ncm: string; quantity: number; price: string };
const blankItem = (): FormItem => ({ partNumber: "", description: "", ncm: "", quantity: 1, price: "" });

function NewProposalModal({ userName, role, factoryManagers, onClose, onSaved }: { userName: string; role: UserRole; factoryManagers: AccessUser[]; onClose: () => void; onSaved: () => Promise<void> }) {
  const [dealership, setDealership] = useState(""); const [city, setCity] = useState(""); const [state, setState] = useState(""); const [contactName, setContactName] = useState(""); const [contactEmail, setContactEmail] = useState(""); const [commercialOwner, setCommercialOwner] = useState(userName); const [factoryManagerEmail, setFactoryManagerEmail] = useState(factoryManagers[0]?.email ?? ""); const [validUntil, setValidUntil] = useState(defaultValidity()); const [items, setItems] = useState<FormItem[]>([blankItem()]); const [saving, setSaving] = useState(false); const [error, setError] = useState("");
  const totalCents = items.reduce((sum, item) => sum + item.quantity * parseMoneyToCents(item.price), 0);
  function updateItem(index: number, patch: Partial<FormItem>) { setItems((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item)); }
  async function submit(event: FormEvent, status: "draft" | "sent") { event.preventDefault(); setSaving(true); setError(""); const response = await fetch("/api/proposals", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ dealership, city, state, contactName, contactEmail, commercialOwner, factoryManagerEmail, validUntil, status, items: items.map((item) => ({ ...item, unitPriceCents: parseMoneyToCents(item.price) })) }) }); const payload = (await response.json()) as { error?: string }; if (!response.ok) { setError(payload.error || "Não foi possível salvar a proposta."); setSaving(false); return; } await onSaved(); }
  return <div className="modal-backdrop" role="dialog" aria-modal="true"><form className="proposal-form-modal" onSubmit={(event) => void submit(event, "draft")}><header className="modal-header"><div><span className="eyebrow">Nova negociação</span><h2>Criar proposta comercial</h2><p>A concessionária será vinculada à carteira do gestor responsável.</p></div><button type="button" className="icon-button" onClick={onClose} aria-label="Fechar"><Icon name="close" /></button></header><div className="form-scroll"><section className="form-section"><div className="form-section-title"><span>01</span><div><h3>Concessionária</h3><p>Identificação do parceiro comercial.</p></div></div><div className="form-grid"><label className="field"><span>Concessionária</span><input value={dealership} onChange={(event) => setDealership(event.target.value)} required /></label><label className="field"><span>Cidade</span><input value={city} onChange={(event) => setCity(event.target.value)} /></label><label className="field small"><span>UF</span><input maxLength={2} value={state} onChange={(event) => setState(event.target.value.toUpperCase())} /></label><label className="field"><span>Responsável na concessionária</span><input value={contactName} onChange={(event) => setContactName(event.target.value)} /></label><label className="field"><span>E-mail do contato</span><input type="email" value={contactEmail} onChange={(event) => setContactEmail(event.target.value)} /></label></div></section><section className="form-section"><div className="form-section-title"><span>02</span><div><h3>Dados comerciais</h3><p>Responsável interno e validade.</p></div></div><div className="form-grid two-columns"><label className="field"><span>Responsável Comercial HORSCH</span><input value={commercialOwner} onChange={(event) => setCommercialOwner(event.target.value)} required /></label><label className="field"><span>Válida até</span><input type="date" value={validUntil} onChange={(event) => setValidUntil(event.target.value)} required /></label>{role === "admin" && <label className="field"><span>Gestor Fábrica responsável</span><select value={factoryManagerEmail} onChange={(event) => setFactoryManagerEmail(event.target.value)}><option value="">ADM / não atribuído</option>{factoryManagers.map((manager) => <option key={manager.email} value={manager.email}>{manager.name} · {manager.email}</option>)}</select></label>}</div></section><section className="form-section items-section"><div className="form-section-title"><span>03</span><div><h3>Itens da proposta</h3><p>Valores líquidos em reais.</p></div><button type="button" className="outline-button add-item-button" onClick={() => setItems((current) => [...current, blankItem()])}><Icon name="plus" size={15} />Adicionar item</button></div><div className="items-table-wrap"><table className="items-form-table"><thead><tr><th>PN</th><th>VT / Descrição</th><th>Origem</th><th>NCM</th><th>Qtd.</th><th>Net Price (R$)</th><th /></tr></thead><tbody>{items.map((item, index) => <tr key={index}><td><input value={item.partNumber} onChange={(event) => updateItem(index, { partNumber: event.target.value })} /></td><td><input value={item.description} onChange={(event) => updateItem(index, { description: event.target.value })} /></td><td className="origin-cell">{item.description.length >= 3 ? item.description.charAt(2) : "—"}</td><td><input value={item.ncm} onChange={(event) => updateItem(index, { ncm: event.target.value })} /></td><td><input type="number" min={1} value={item.quantity} onChange={(event) => updateItem(index, { quantity: Math.max(1, Number(event.target.value) || 1) })} /></td><td><input inputMode="decimal" value={item.price} onChange={(event) => updateItem(index, { price: event.target.value })} onBlur={(event) => updateItem(index, { price: formatMoneyInput(event.target.value) })} /></td><td><button type="button" className="remove-item" onClick={() => setItems((current) => current.length === 1 ? [blankItem()] : current.filter((_, itemIndex) => itemIndex !== index))}>×</button></td></tr>)}</tbody></table></div><div className="form-total"><span>Valor total da proposta</span><strong>{formatBRL(totalCents)}</strong></div></section>{error && <p className="form-error">{error}</p>}</div><footer className="modal-actions"><button type="button" className="ghost-button" onClick={onClose}>Cancelar</button><button type="submit" className="outline-button" disabled={saving}>Salvar rascunho</button><button type="button" className="primary-button" disabled={saving} onClick={(event) => void submit(event as unknown as FormEvent, "sent")}>Salvar e enviar</button></footer></form></div>;
}

function NewAccessModal({ me, dealerships, onClose, onSaved }: { me: CurrentAccess; dealerships: Dealership[]; onClose: () => void; onSaved: () => Promise<void> }) {
  const allowedRoles: UserRole[] = me.role === "admin" ? ["admin", "factory_manager", "dealer_manager"] : ["dealer_manager"];
  const [name, setName] = useState(""); const [email, setEmail] = useState(""); const [role, setRole] = useState<UserRole>(allowedRoles[0]); const [dealershipId, setDealershipId] = useState<number | null>(me.role === "dealer_manager" ? me.dealershipId : dealerships[0]?.id ?? null); const [saving, setSaving] = useState(false); const [error, setError] = useState("");
  async function submit(event: FormEvent) { event.preventDefault(); setSaving(true); setError(""); const response = await fetch("/api/access", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, email, role, dealershipId }) }); const payload = (await response.json()) as { error?: string }; if (!response.ok) { setError(payload.error || "Não foi possível criar o acesso."); setSaving(false); return; } await onSaved(); }
  return <div className="modal-backdrop" role="dialog" aria-modal="true"><form className="access-modal" onSubmit={(event) => void submit(event)}><header className="modal-header"><div><span className="eyebrow">Novo usuário</span><h2>Criar acesso</h2><p>O usuário entrará com a conta corporativa informada.</p></div><button type="button" className="icon-button" onClick={onClose}><Icon name="close" /></button></header><div className="form-scroll"><div className="access-form-grid"><label className="field"><span>Nome completo</span><input value={name} onChange={(event) => setName(event.target.value)} required /></label><label className="field"><span>E-mail corporativo</span><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label><label className="field"><span>Perfil de permissão</span><select value={role} onChange={(event) => setRole(event.target.value as UserRole)}>{allowedRoles.map((item) => <option key={item} value={item}>{roleName(item)}</option>)}</select></label>{role === "dealer_manager" && <label className="field"><span>Concessionária</span><select value={dealershipId ?? ""} onChange={(event) => setDealershipId(Number(event.target.value) || null)} required disabled={me.role === "dealer_manager"}><option value="">Selecione</option>{dealerships.map((dealer) => <option key={dealer.id} value={dealer.id}>{dealer.name}</option>)}</select></label>}</div><div className="access-note"><strong>{roleName(role)}</strong><p>{roleExplanation(role)}</p></div>{error && <p className="form-error">{error}</p>}</div><footer className="modal-actions"><button type="button" className="ghost-button" onClick={onClose}>Cancelar</button><button type="submit" className="primary-button" disabled={saving}>{saving ? "Criando..." : "Criar acesso"}</button></footer></form></div>;
}

function ProposalPreview({ proposal, me, onClose, onUpdated }: { proposal: Proposal; me: CurrentAccess; onClose: () => void; onUpdated: (status: ProposalStatus, counterofferCents?: number | null) => Promise<void> }) {
  const [status, setStatus] = useState<ProposalStatus>(proposal.status); const [counteroffer, setCounteroffer] = useState(proposal.counterofferCents ? formatMoneyInput(String(proposal.counterofferCents / 100).replace(".", ",")) : ""); const [note, setNote] = useState(proposal.decisionNote); const [updating, setUpdating] = useState(false); const [error, setError] = useState("");
  async function updateStatus(nextStatus: ProposalStatus) { setUpdating(true); setError(""); const cents = nextStatus === "counteroffer" ? parseMoneyToCents(counteroffer) : null; const response = await fetch("/api/proposals", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: proposal.id, status: nextStatus, counterofferCents: cents, decisionNote: note }) }); const payload = (await response.json()) as { error?: string }; if (!response.ok) { setError(payload.error || "Não foi possível atualizar a proposta."); setUpdating(false); return; } setStatus(nextStatus); await onUpdated(nextStatus, cents); setUpdating(false); }
  const decisionOpen = me.role === "dealer_manager" && ["sent", "counteroffer"].includes(proposal.status);
  const managerStatuses = STATUS_ORDER.filter((item) => item !== "counteroffer" || proposal.status === "counteroffer");
  return <div className="modal-backdrop preview-backdrop print-overlay" role="dialog" aria-modal="true"><div className="preview-shell"><header className="preview-toolbar no-print"><div><strong>{proposal.id}</strong><span>{me.role === "dealer_manager" ? "Análise da concessionária" : "Visualização da proposta"}</span></div><div className="preview-actions">{me.role !== "dealer_manager" && <label>Status<select value={status} disabled={updating} onChange={(event) => void updateStatus(event.target.value as ProposalStatus)}>{managerStatuses.map((item) => <option value={item} key={item}>{STATUS_LABELS[item]}</option>)}</select></label>}<button className="outline-button dark" onClick={() => window.print()}><Icon name="print" size={16} />Imprimir / PDF</button><button className="icon-button dark" onClick={onClose}><Icon name="close" /></button></div></header>{decisionOpen && <section className="decision-panel no-print"><div><span className="eyebrow">Decisão da concessionária</span><h2>Analise e responda à proposta</h2><p>O retorno ficará registrado no histórico comercial.</p></div><label className="field"><span>Observação</span><input value={note} onChange={(event) => setNote(event.target.value)} placeholder="Comentário opcional" /></label><label className="field"><span>Valor da contraproposta</span><input value={counteroffer} onChange={(event) => setCounteroffer(event.target.value)} onBlur={(event) => setCounteroffer(formatMoneyInput(event.target.value))} placeholder="0,00" /></label><div className="decision-actions"><button className="decision-button reject" disabled={updating} onClick={() => void updateStatus("rejected")}>Recusar</button><button className="decision-button counter" disabled={updating} onClick={() => void updateStatus("counteroffer")}>Enviar contraproposta</button><button className="decision-button accept" disabled={updating} onClick={() => void updateStatus("approved")}>Aceitar proposta</button></div>{error && <p className="form-error">{error}</p>}</section>}<article className="proposal-paper"><header className="document-header"><BrandMark className="document-mark" /><div className="document-type"><span>Peças</span><strong>Proposta para concessionária</strong></div><div className="document-title"><h1>Proposta comercial</h1><p>Fornecimento de peças</p></div></header><section className="document-stats"><div><span>Número da proposta</span><strong>{proposal.id}</strong></div><div><span>Data de emissão</span><strong>{formatDate(proposal.issueDate)}</strong></div><div><span>Válida até</span><strong>{formatDate(proposal.validUntil)}</strong></div></section><section className="document-customer"><div><span>Responsável da concessionária</span><strong>{proposal.contactName || "—"}</strong></div><div><span>Concessionária</span><strong>{proposal.dealership}</strong></div></section><p className="document-intro">Apresentamos nossa proposta comercial para o fornecimento dos itens abaixo. Valores e condições permanecem válidos até a data indicada.</p><div className="document-section-title"><h2>Itens da proposta</h2><span>Valores líquidos em reais</span></div><table className="document-items"><thead><tr><th>PN</th><th>VT</th><th>Origem</th><th>NCM</th><th>Quantidade</th><th>Net Price (R$)</th></tr></thead><tbody>{proposal.items.map((item) => <tr key={item.id}><td>{item.partNumber || "—"}</td><td>{item.description || "—"}</td><td>{item.origin || "—"}</td><td>{item.ncm || "—"}</td><td>{item.quantity}</td><td>{formatBRL(item.unitPriceCents)}</td></tr>)}</tbody></table><div className="document-total"><span>Valor total da proposta</span><strong>{formatBRL(proposal.totalCents)}</strong></div>{proposal.counterofferCents && <section className="document-counteroffer"><span>Contraproposta da concessionária</span><strong>{formatBRL(proposal.counterofferCents)}</strong>{proposal.decisionNote && <p>{proposal.decisionNote}</p>}</section>}<section className="document-terms"><strong>Condições comerciais</strong><p>Valores líquidos em reais, sujeitos à disponibilidade de estoque. Tributos e frete seguem as condições vigentes acordadas com a concessionária.</p></section><section className="document-signatures"><div><span className="signature-name">{proposal.commercialOwner}</span><small>Responsável Comercial HORSCH</small></div><div><span /><small>Responsável / Concessionária</small></div></section><footer className="document-footer"><span>HORSCH do Brasil<br />Curitiba · Paraná · Brasil</span><span>Documento confidencial<br />Uso comercial</span></footer></article></div></div>;
}

function StatusBadge({ status }: { status: ProposalStatus }) { return <span className={`status-badge ${status}`}><i />{STATUS_LABELS[status]}</span>; }
function LoadingState() { return <div className="center-state"><span className="state-mark">H</span><h1>Preparando o portal comercial</h1><p>Carregando seu perfil e as informações autorizadas.</p></div>; }
function ErrorState({ message, retry }: { message: string; retry: () => Promise<void> }) { return <div className="center-state"><span className="state-mark">!</span><h1>Acesso não disponível</h1><p>{message}</p><div className="state-actions"><button className="primary-button" onClick={() => void retry()}>Tentar novamente</button><a className="outline-button" href="/signout-with-chatgpt?return_to=/">Trocar de conta</a></div></div>; }
function EmptyState({ title, text }: { title: string; text: string }) { return <div className="empty-state"><span><Icon name="file" size={24} /></span><h3>{title}</h3><p>{text}</p></div>; }
function EmptyMini({ text }: { text: string }) { return <div className="empty-mini">{text}</div>; }
function formatBRL(cents: number) { return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 2 }).format(cents / 100); }
function formatDate(value: string) { if (!value) return "—"; const date = value.length === 10 ? new Date(`${value}T12:00:00`) : new Date(value); return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("pt-BR"); }
function initials(value: string) { return value.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part.charAt(0)).join("").toUpperCase() || "HB"; }
function firstName(value: string) { const name = value.trim().split(/\s+/)[0]; return name && !name.includes("@") ? name : "bem-vindo"; }
function defaultValidity() { const date = new Date(); date.setDate(date.getDate() + 30); return date.toISOString().slice(0, 10); }
function parseMoneyToCents(value: string) { const cleaned = String(value).replace(/[^\d,.-]/g, ""); const normalized = cleaned.includes(",") ? cleaned.replace(/\./g, "").replace(",", ".") : cleaned; return Math.max(0, Math.round((Number(normalized) || 0) * 100)); }
function formatMoneyInput(value: string) { const cents = parseMoneyToCents(value); if (!value.trim() && !cents) return ""; return (cents / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function roleName(role: UserRole) { return role === "admin" ? "ADM" : role === "factory_manager" ? "Gestor Fábrica" : "Gestor Concessionária"; }
function roleExplanation(role: UserRole) { return role === "admin" ? "Acesso total a propostas, concessionárias e usuários." : role === "factory_manager" ? "Acesso à carteira atribuída, criação de propostas e gestão dos acessos das concessionárias atendidas." : "Acesso apenas à concessionária vinculada, com decisão sobre propostas e criação de acessos internos."; }
function scopeDescription(me: CurrentAccess) { return me.role === "admin" ? "Visão consolidada de toda a operação e de todos os acessos." : me.role === "factory_manager" ? "Carteira atribuída, propostas e acessos das concessionárias sob sua gestão." : "Propostas e usuários vinculados exclusivamente à sua concessionária."; }
function accessDescription(role: UserRole) { return role === "admin" ? "Crie e gerencie qualquer nível de permissão." : role === "factory_manager" ? "Gerencie acessos das concessionárias da sua carteira." : "Crie e gerencie acessos internos da sua concessionária."; }
