import React, { useState } from "react";
import { supabase } from "./lib/supabaseClient.js";
import { GlobalStyle } from "./GlobalStyle.jsx";

export default function Login() {
  const [mode, setMode] = useState("signin"); // signin | signup
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState(null); // { type: "error" | "info", text }

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setMessage(null);
    try {
      if (mode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      } else {
        const { data, error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        if (!data.session) {
          setMessage({ type: "info", text: "Account creato. Controlla la tua email per confermare l'accesso, poi accedi." });
          setMode("signin");
        }
      }
    } catch (err) {
      setMessage({ type: "error", text: err.message || "Errore imprevisto." });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="nav-root" style={{ alignItems: "center", justifyContent: "center" }}>
      <GlobalStyle />
      <form className="card" onSubmit={submit} style={{ width: "100%", maxWidth: 360 }}>
        <div className="nav-brand" style={{ padding: 0, marginBottom: 4 }}>NAV_</div>
        <p className="nav-page-sub" style={{ marginBottom: 20 }}>
          {mode === "signin" ? "Accedi al tuo patrimonio" : "Crea il tuo account"}
        </p>

        <div className="field">
          <label className="field-label">Email</label>
          <input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="field">
          <label className="field-label">Password</label>
          <input type="password" required minLength={6} autoComplete={mode === "signin" ? "current-password" : "new-password"}
            value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>

        {message && (
          <div className="pill" style={{
            display: "block", marginBottom: 13, padding: "8px 10px",
            color: message.type === "error" ? "#FF6B6B" : "#4ADE9C",
            borderColor: message.type === "error" ? "#FF6B6B" : "#4ADE9C",
          }}>
            {message.text}
          </div>
        )}

        <button className="btn primary" type="submit" disabled={loading} style={{ width: "100%", justifyContent: "center", marginBottom: 10 }}>
          {loading ? "Attendere…" : mode === "signin" ? "Accedi" : "Registrati"}
        </button>

        <button type="button" className="btn" onClick={() => { setMode(mode === "signin" ? "signup" : "signin"); setMessage(null); }}
          style={{ width: "100%", justifyContent: "center" }}>
          {mode === "signin" ? "Non hai un account? Registrati" : "Hai già un account? Accedi"}
        </button>
      </form>
    </div>
  );
}
