import React, { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { supabase } from "./lib/supabaseClient.js";
import { GlobalStyle } from "./GlobalStyle.jsx";

export default function Login() {
  const [mode, setMode] = useState("signin"); // signin | signup
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
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
        // Se ha successo, useAuth rileva la sessione e mostra l'app.
      } else {
        const { data, error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        if (data.session) {
          // Conferma email disattivata su Supabase: accesso immediato.
          // useAuth rileva la sessione e mostra l'app.
        } else {
          // Conferma email attiva: serve cliccare il link ricevuto per email.
          setMessage({ type: "info", text: "Account creato. Controlla la tua email e clicca il link di conferma, poi accedi." });
          setMode("signin");
        }
      }
    } catch (err) {
      setMessage({ type: "error", text: traduciErrore(err.message) });
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
          <div style={{ position: "relative" }}>
            <input type={showPassword ? "text" : "password"} required minLength={6}
              autoComplete={mode === "signin" ? "current-password" : "new-password"}
              value={password} onChange={(e) => setPassword(e.target.value)} style={{ width: "100%", paddingRight: 36 }} />
            <button type="button" className="icon-btn" onClick={() => setShowPassword(s => !s)}
              title={showPassword ? "Nascondi password" : "Mostra password"}
              style={{ position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)" }}>
              {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
          {mode === "signup" && <span style={{ fontSize: 11, color: "#4E576A" }}>Almeno 6 caratteri.</span>}
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

// Traduce in italiano i messaggi d'errore più comuni di Supabase Auth.
function traduciErrore(msg) {
  if (!msg) return "Errore imprevisto.";
  const m = msg.toLowerCase();
  if (m.includes("invalid login credentials")) return "Email o password non corretti.";
  if (m.includes("user already registered")) return "Esiste già un account con questa email. Prova ad accedere.";
  if (m.includes("password should be at least")) return "La password deve avere almeno 6 caratteri.";
  if (m.includes("unable to validate email") || m.includes("invalid email")) return "Indirizzo email non valido.";
  if (m.includes("email not confirmed")) return "Devi prima confermare l'email: controlla la tua casella e clicca il link.";
  return msg;
}
