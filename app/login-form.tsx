"use client";

import { useState, type FormEvent } from "react";

type Mode = "login" | "activate";

export function LoginForm() {
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [activationCode, setActivationCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (mode === "activate" && password !== confirmation) {
      setError("A confirmação da senha não confere.");
      return;
    }

    setBusy(true);
    setError("");
    try {
      const response = await fetch(
        mode === "login" ? "/api/auth/login" : "/api/auth/activate",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, name, activationCode, password }),
        },
      );
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

  function changeMode(nextMode: Mode) {
    setMode(nextMode);
    setError("");
    setPassword("");
    setConfirmation("");
  }

  return (
    <form className="login-card" onSubmit={(event) => void submit(event)}>
      <span className="eyebrow">Portal comercial</span>
      <h2>{mode === "login" ? "Acesse sua conta" : "Ative o acesso ADM"}</h2>
      <p>
        {mode === "login"
          ? "Entre com o e-mail e a senha cadastrados no portal. Não é necessária uma conta do ChatGPT."
          : "Use o código de ativação fornecido ao administrador para definir a primeira senha do portal."}
      </p>

      <div className="login-fields">
        {mode === "activate" && (
          <label className="field">
            <span>Nome completo</span>
            <input
              autoComplete="name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
            />
          </label>
        )}
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
        {mode === "activate" && (
          <label className="field">
            <span>Código de ativação</span>
            <input
              type="password"
              autoComplete="one-time-code"
              value={activationCode}
              onChange={(event) => setActivationCode(event.target.value)}
              required
            />
          </label>
        )}
        <label className="field">
          <span>{mode === "login" ? "Senha" : "Crie uma senha"}</span>
          <input
            type="password"
            minLength={10}
            maxLength={128}
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
        </label>
        {mode === "activate" && (
          <label className="field">
            <span>Confirme a senha</span>
            <input
              type="password"
              minLength={10}
              maxLength={128}
              autoComplete="new-password"
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              required
            />
          </label>
        )}
      </div>

      {error && <p className="login-error" role="alert">{error}</p>}
      <button className="login-button" type="submit" disabled={busy}>
        <span>{busy ? "Aguarde..." : mode === "login" ? "Entrar" : "Ativar e entrar"}</span>
        <span aria-hidden="true">→</span>
      </button>
      <button
        className="login-mode-button"
        type="button"
        onClick={() => changeMode(mode === "login" ? "activate" : "login")}
      >
        {mode === "login" ? "Primeiro acesso do administrador" : "Voltar para o login"}
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
