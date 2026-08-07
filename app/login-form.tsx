"use client";

import { useState, type FormEvent } from "react";

export function LoginForm() {
  const [recoveryMode, setRecoveryMode] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [recoveryKey, setRecoveryKey] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        setError(payload.error || "Não foi possível concluir o acesso.");
        return;
      }
      window.location.assign("/");
    } catch {
      setError("Não foi possível conectar ao portal. Tente novamente.");
    } finally {
      setBusy(false);
    }
  }

  async function recover(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    if (newPassword !== confirmation) {
      setError("A confirmação da nova senha não confere.");
      setBusy(false);
      return;
    }
    try {
      const response = await fetch("/api/auth/recover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, recoveryKey, newPassword }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        setError(payload.error || "Não foi possível recuperar o acesso.");
        return;
      }
      window.location.assign("/");
    } catch {
      setError("Não foi possível conectar ao portal. Tente novamente.");
    } finally {
      setBusy(false);
    }
  }

  if (recoveryMode) {
    return (
      <form className="login-card" onSubmit={(event) => void recover(event)}>
        <span className="eyebrow">Recuperação administrativa</span>
        <h2>Recupere seu acesso</h2>
        <p>Use o código administrativo recebido e defina uma nova senha para sua conta de Gestão Global.</p>
        <div className="login-fields">
          <label className="field"><span>E-mail corporativo</span><input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
          <label className="field"><span>Código de recuperação</span><input type="password" autoComplete="one-time-code" value={recoveryKey} onChange={(event) => setRecoveryKey(event.target.value)} required /></label>
          <label className="field"><span>Nova senha</span><input type="password" minLength={10} maxLength={128} autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} required /></label>
          <label className="field"><span>Confirme a nova senha</span><input type="password" minLength={10} maxLength={128} autoComplete="new-password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} required /></label>
        </div>
        {error && <p className="login-error" role="alert">{error}</p>}
        <button className="login-button" type="submit" disabled={busy}><span>{busy ? "Recuperando..." : "Recuperar acesso"}</span><span aria-hidden="true">→</span></button>
        <button type="button" className="login-mode-button" onClick={() => { setRecoveryMode(false); setError(""); }}>Voltar para entrar</button>
        <div className="login-security"><span className="security-icon" aria-hidden="true">✓</span><div><strong>Código de uso único</strong><small>Depois da recuperação, o código não poderá ser reutilizado para esta conta.</small></div></div>
      </form>
    );
  }

  return (
    <form className="login-card" onSubmit={(event) => void submit(event)}>
      <span className="eyebrow">Portal comercial</span>
      <h2>Acesse sua conta</h2>
      <p>
        Entre com o e-mail e a senha cadastrados no portal. Não é necessária uma conta do ChatGPT.
      </p>

      <div className="login-fields">
        <label className="field">
          <span>E-mail corporativo</span>
          <input
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
        </label>
        <label className="field">
          <span>Senha</span>
          <input
            type="password"
            minLength={10}
            maxLength={128}
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
        </label>
      </div>

      {error && <p className="login-error" role="alert">{error}</p>}
      <button className="login-button" type="submit" disabled={busy}>
        <span>{busy ? "Aguarde..." : "Entrar"}</span>
        <span aria-hidden="true">→</span>
      </button>
      <button type="button" className="login-mode-button" onClick={() => { setRecoveryMode(true); setError(""); }}>Não consigo entrar</button>

      <div className="login-security">
        <span className="security-icon" aria-hidden="true">✓</span>
        <div>
          <strong>Acesso protegido</strong>
          <small>Senha criptografada e sessão individual para cada usuário.</small>
        </div>
      </div>
      <details className="test-accesses">
        <summary>Testar com dois usuários demonstrativos</summary>
        <p>Abra duas janelas anônimas ou dois navegadores para acompanhar o mesmo fluxo.</p>
        <div className="test-access-list">
          <button type="button" className="test-access-card" onClick={() => { setEmail("teste.concessionaria@horsch.com"); setPassword("TesteConcessionaria2026!"); setError(""); }}>
            <span><strong>Gestor Concessionária</strong><small>Solicita e aprova/reprova cotações</small></span>
            <em>Preencher acesso</em>
          </button>
          <button type="button" className="test-access-card" onClick={() => { setEmail("teste.gestao.global@horsch.com"); setPassword("TesteGestaoGlobal2026!"); setError(""); }}>
            <span><strong>Gestão Global</strong><small>Recebe e responde cotações</small></span>
            <em>Preencher acesso</em>
          </button>
        </div>
      </details>
    </form>
  );
}
