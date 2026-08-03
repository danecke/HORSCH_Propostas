"use client";

import { useState, type FormEvent } from "react";

export function LoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
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

      <div className="login-security">
        <span className="security-icon" aria-hidden="true">✓</span>
        <div>
          <strong>Acesso protegido</strong>
          <small>Senha criptografada e sessão individual para cada usuário.</small>
        </div>
      </div>
    </form>
  );
}
