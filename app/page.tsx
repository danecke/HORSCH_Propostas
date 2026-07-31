import { chatGPTSignInPath, getChatGPTUser } from "./chatgpt-auth";
import { Dashboard } from "./dashboard";

export const dynamic = "force-dynamic";

function BrandMark({ className = "" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 73 74"
      role="img"
      aria-label="HORSCH"
    >
      <path
        fill="currentColor"
        d="M36.5 1.5C16.9 1.5 1.1 17.4 1.1 37s15.9 35.4 35.4 35.4S71.9 56.5 71.9 37C72 17.4 56.1 1.5 36.5 1.5Zm-.3 38.6-11.9 0c-.6 0-1.1.4-1.2.9l-2.9 10.6c-.3 1-1.2 1.7-2.2 1.7l-2.5 0c-1.2 0-2-1.1-1.7-2.2l3-11.1 1.8-6.4 3.2-11.8c.2-.8 1-1.4 1.9-1.4h3.2c.9 0 1.6.9 1.4 1.8l-2.8 10.4c-.1.5.2 1 .8 1h11.4c.9 0 1.6.9 1.4 1.8l-.8 3.1c-.2 1-.9 1.6-1.8 1.6Zm25.9-4.6-.8 3.1c-.2.9-1 1.5-1.9 1.5H48c-.6 0-1.5.4-1.7.9l-2.9 10.6c-.3 1-1.2 1.7-2.2 1.7h-2.5c-1.2 0-2-1.1-1.7-2.2l3-11.1 1.8-6.4L45 21.8c.2-.8 1-1.4 1.9-1.4h3.2c.9 0 1.6.9 1.4 1.8l-2.8 10.4c-.1.5.2 1 .8 1h11.4c.8.1 1.5 1 1.2 1.9Z"
      />
    </svg>
  );
}

export default async function Home() {
  const user = await getChatGPTUser();

  if (!user) {
    return (
      <main className="login-page">
        <section className="login-brand-panel">
          <div className="login-brand-lockup">
            <BrandMark className="login-mark" />
            <span>HORSCH</span>
          </div>
          <div className="login-brand-copy">
            <span className="eyebrow light">Gestão comercial integrada</span>
            <h1>Propostas sob controle. Decisões com clareza.</h1>
            <p>
              Centralize negociações, concessionárias, valores e resultados em
              uma visão empresarial única.
            </p>
          </div>
          <div className="login-pipeline" aria-hidden="true">
            <span />
            <span />
            <span />
            <span />
          </div>
        </section>

        <section className="login-access-panel">
          <div className="login-card">
            <div className="login-mobile-brand">
              <BrandMark className="login-mobile-mark" />
              <span>HORSCH</span>
            </div>
            <span className="eyebrow">Portal comercial</span>
            <h2>Acesse sua gestão de propostas</h2>
            <p>
              Entre com sua conta corporativa para acessar informações
              comerciais protegidas.
            </p>
            <a className="login-button" href={chatGPTSignInPath("/")}>
              Entrar com segurança
              <span aria-hidden="true">→</span>
            </a>
            <div className="login-security">
              <span className="security-icon" aria-hidden="true">✓</span>
              <div>
                <strong>Acesso protegido</strong>
                <small>Identidade verificada e dados restritos à sua equipe.</small>
              </div>
            </div>
          </div>
          <small className="login-footer">HORSCH do Brasil · Uso comercial interno</small>
        </section>
      </main>
    );
  }

  return <Dashboard user={user} />;
}
