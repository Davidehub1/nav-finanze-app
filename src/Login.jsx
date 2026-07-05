import React, { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { supabase } from "./lib/supabaseClient.js";
import { GlobalStyle } from "./GlobalStyle.jsx";

export default function Login() {
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
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
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
        <p className="nav-page-sub" style={{ marginBottom: 20 }}>Accedi al tuo patrimonio</p>

        <div className="field">
          <label className="field-label">Email</label>
          <input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="field">
          <label className="field-label">Password</label>
          <div style={{ position: "relative" }}>
            <input type={showPassword ? "text" : "password"} required minLength={6} autoComplete="current-password"
              value={password} onChange={(e) => setPassword(e.target.value)} style={{ width: "100%", paddingRight: 36 }} />
            <button type="button" className="icon-btn" onClick={() => setShowPassword(s => !s)}
              title={showPassword ? "Nascondi password" : "Mostra password"}
              style={{ position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)" }}>
              {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
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

        <button className="btn primary" type="submit" disabled={loading} style={{ width: "100%", justifyContent: "center" }}>
          {loading ? "Attendere…" : "Accedi"}
        </button>
      </form>
    </div>
  );
}
