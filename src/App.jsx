import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import {
  LineChart, Line, BarChart, Bar, PieChart, Pie, Cell, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from "recharts";
import {
  LayoutDashboard, Receipt, Wallet, Wrench, Tags, Plus, Trash2, X,
  TrendingUp, TrendingDown, ChevronDown, Search, Percent, SplitSquareHorizontal,
  Sparkles, ArrowUpRight, ArrowDownRight, ArrowLeftRight, Pencil, Check, RefreshCw, Undo2, Save, LogOut, User
} from "lucide-react";

import { PATRIMONIO_SEED, FX_DEFAULT } from "./lib/seedData.js";
import { loadOrSeedUserData, persistUserData } from "./lib/dataStore.js";
import { useAuth } from "./lib/useAuth.js";
import { supabase } from "./lib/supabaseClient.js";
import Login from "./Login.jsx";
import { GlobalStyle } from "./GlobalStyle.jsx";

/* ============ COSTANTI ============ */
const MONTHS = ["Gen","Feb","Mar","Apr","Mag","Giu","Lug","Ago","Set","Ott","Nov","Dic"];
const YEARS = [2024, 2025, 2026];

const COLORS = {
  mint: "#4ADE9C",
  coral: "#FF6B6B",
  amber: "#F5B841",
  blue: "#5B8DEF",
  violet: "#B48EF0",
};
const PIE_COLORS = ["#4ADE9C","#5B8DEF","#F5B841","#FF6B6B","#B48EF0","#4AC0DE","#DE944A","#8FA6C2","#E86FA9","#7FE04A","#DEDC4A","#7C8797"];

const fmtCHF = (n) => {
  if (n === null || n === undefined || isNaN(n)) return "—";
  const sign = n < 0 ? "-" : "";
  return sign + "CHF " + Math.abs(n).toLocaleString("it-CH", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
};
const fmtCHF2 = (n) => {
  if (n === null || n === undefined || isNaN(n)) return "—";
  return n.toLocaleString("it-CH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};
const uid = () => crypto.randomUUID();

/* ============ AMMORTAMENTO: calcolo valore corrente ============ */
function computeAmmortamentoValue(cfg, refDate = new Date()) {
  if (!cfg || !cfg.enabled) return null;
  const [ay, am] = cfg.acquisitionDate.split("-").map(Number);
  const acqDate = new Date(ay, am - 1, 1);
  const months = (refDate.getFullYear() - acqDate.getFullYear()) * 12 + (refDate.getMonth() - acqDate.getMonth());
  if (months < 0) return cfg.acquisitionValue;
  const rate = Math.max(0, Math.min(100, cfg.annualRate)) / 100;
  const value = cfg.acquisitionValue * Math.pow(1 - rate, months / 12);
  return Math.max(0, Math.round(value * 100) / 100);
}

/* ============ TASSI DI CAMBIO (default = ultimi noti dal foglio) ============ */
function fxRate(currency, fx) {
  if (currency === "E") return fx.EURCHF;
  if (currency === "D") return fx.USDCHF;
  return 1; // F = CHF
}

/* ============ Valore di un asset in un dato mese, con "riporto" dall'ultimo mese noto ============ */
function getAssetValueAtMonth(asset, monthIdx, refDate, prices, year) {
  if (asset.ammortamento?.enabled) {
    const d = refDate || new Date(2000 + 24, monthIdx, 1);
    return { value: computeAmmortamentoValue(asset.ammortamento, d), explicit: false, amortized: true };
  }
  if (asset.units !== undefined && asset.units !== null && prices) {
    for (let i = monthIdx; i >= 0; i--) {
      const price = prices?.[String(year)]?.[asset.name]?.monthly?.[i];
      if (price !== null && price !== undefined) return { value: Math.round(asset.units * price * 100) / 100, explicit: i === monthIdx, amortized: false };
    }
    return { value: null, explicit: false, amortized: false };
  }
  for (let i = monthIdx; i >= 0; i--) {
    const v = asset.monthly[i];
    if (v !== null && v !== undefined) return { value: v, explicit: i === monthIdx, amortized: false };
  }
  return { value: null, explicit: false, amortized: false };
}

/* ============ PREZZI PER QUOTA: helper ============ */
const PRICE_YEARS = ["2024", "2025", "2026"];

// Serie continua di tutti i mesi con prezzo registrato, in ordine cronologico, per un dato asset
function getPriceTimeline(prices, assetName) {
  const points = [];
  for (const y of PRICE_YEARS) {
    const p = prices[y]?.[assetName];
    if (!p) continue;
    p.monthly.forEach((v, i) => {
      if (v !== null && v !== undefined) points.push({ label: MONTHS[i] + " " + y.slice(2), value: v, year: y, monthIdx: i });
    });
  }
  return points;
}

function getLatestPrice(prices, assetName) {
  const tl = getPriceTimeline(prices, assetName);
  return tl.length ? tl[tl.length - 1].value : null;
}

// Variazione da inizio anno (rispetto al valore "start" salvato per l'anno) e rispetto al mese precedente
function getPriceChanges(prices, assetName, year) {
  const p = prices[year]?.[assetName];
  if (!p) return { ytd: null, mtd: null, current: null };
  let lastIdx = -1;
  for (let i = 11; i >= 0; i--) if (p.monthly[i] !== null && p.monthly[i] !== undefined) { lastIdx = i; break; }
  if (lastIdx === -1) return { ytd: null, mtd: null, current: null };
  const current = p.monthly[lastIdx];
  const ytd = p.start ? (current / p.start - 1) : null;
  const prevVal = lastIdx > 0 ? p.monthly[lastIdx - 1] : p.start;
  const mtd = prevVal ? (current / prevVal - 1) : null;
  return { ytd, mtd, current, lastIdx };
}

const fmtPct = (v) => v === null || v === undefined || isNaN(v) ? "—" : (v >= 0 ? "+" : "") + (v * 100).toFixed(1) + "%";

/* ============ Valore "stretto": solo se esplicitamente registrato in quel mese (nessun riporto) ============ */
function getAssetStrictValue(asset, monthIdx, refDate, prices, year) {
  if (asset.ammortamento?.enabled) {
    return { value: computeAmmortamentoValue(asset.ammortamento, refDate), explicit: false, amortized: true, computed: true };
  }
  if (asset.units !== undefined && asset.units !== null) {
    const price = prices?.[String(year)]?.[asset.name]?.monthly?.[monthIdx];
    const value = (price === null || price === undefined) ? null : Math.round(asset.units * price * 100) / 100;
    return { value, explicit: false, amortized: false, computed: true };
  }
  const v = asset.monthly[monthIdx];
  return { value: (v === null || v === undefined) ? null : v, explicit: v !== null && v !== undefined, amortized: false, computed: false };
}

function isMonthComplete(yr, monthIdx, prices, year) {
  const trackable = yr.assets.filter(a => !a.ammortamento?.enabled);
  if (trackable.length === 0) return false;
  return trackable.every(a => {
    if (a.units !== undefined && a.units !== null) {
      const price = prices?.[String(year)]?.[a.name]?.monthly?.[monthIdx];
      return price !== null && price !== undefined;
    }
    return a.monthly[monthIdx] !== null && a.monthly[monthIdx] !== undefined;
  });
}

/* Serie del patrimonio netto "onesta": solo mesi realmente compilati, il resto vuoto */
function getStrictNetWorthSeries(yr, fx, year, prices) {
  if (!yr) return Array(12).fill(null);
  return Array.from({ length: 12 }, (_, i) => {
    const refDate = new Date(year, i, 1);
    if (isMonthComplete(yr, i, prices, year)) {
      let sum = 0;
      for (const a of yr.assets) {
        const { value } = getAssetStrictValue(a, i, refDate, prices, year);
        if (value !== null) sum += value * fxRate(a.currency, fx);
      }
      return Math.round(sum * 100) / 100;
    }
    return yr.netWorth?.[i] ?? null;
  });
}

function getCurrentMonthIndex(series) {
  for (let i = 11; i >= 0; i--) if (series[i] !== null && series[i] !== undefined) return i;
  return -1;
}

/* ============ Serie mensile del patrimonio netto totale (calcolata dal vivo, con fallback allo storico) ============ */
function getNetWorthSeries(yr, fx, year) {
  if (!yr) return Array(12).fill(null);
  return Array.from({ length: 12 }, (_, i) => {
    const refDate = new Date(year, i, 1);
    let sum = 0, any = false;
    for (const a of yr.assets) {
      const { value } = getAssetValueAtMonth(a, i, refDate);
      if (value !== null) { sum += value * fxRate(a.currency, fx); any = true; }
    }
    if (any) return Math.round(sum * 100) / 100;
    return yr.netWorth?.[i] ?? null;
  });
}

/* ============ STILE GLOBALE (design system "NAV_") ============ */

/* ============ MIGRAZIONE DATI SALVATI (compatibilità con versioni precedenti dell'app) ============ */
function migratePatrimonio(pat) {
  const out = {};
  for (const y of Object.keys(pat || {})) {
    const yr = pat[y] || { assets: [], netWorth: Array(12).fill(null) };
    const seedAssets = PATRIMONIO_SEED[y]?.assets || [];
    const assets = (yr.assets || []).map(a => {
      let next = a.group === "ETF" ? { ...a, group: "Investimenti" } : a;
      if (next.group === "Investimenti" && (next.units === undefined || next.units === null)) {
        const seedMatch = seedAssets.find(s => s.name === next.name && s.units !== undefined);
        if (seedMatch) next = { ...next, units: seedMatch.units };
      }
      return next;
    });
    out[y] = { ...yr, assets };
  }
  return out;
}
/* ============ COMPONENTE PRINCIPALE ============ */
const EMPTY_DATA = { expenses: [], patrimonio: {}, categories: {}, movements: [], fxRates: FX_DEFAULT, prices: {}, displayName: "" };
const MAX_HISTORY = 30;

function FinanceApp({ user }) {
  const [tab, setTab] = useState("dashboard");
  const [loaded, setLoaded] = useState(false);
  const [data, setData] = useState(EMPTY_DATA);
  const [past, setPast] = useState([]);
  const [saveStatus, setSaveStatus] = useState("saved"); // idle | pending | saving | saved
  const [year, setYear] = useState(2026);

  // Caricamento iniziale da Supabase. Al primissimo accesso non esiste ancora
  // un profilo per l'utente: in quel caso importiamo i dati storici come seed.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const loadedData = await loadOrSeedUserData(user.id);
        if (!cancelled) {
          setData({ ...loadedData, patrimonio: migratePatrimonio(loadedData.patrimonio) });
          setLoaded(true);
        }
      } catch (e) {
        console.error("Errore nel caricamento dati da Supabase:", e);
        if (!cancelled) {
          setSaveStatus("error");
          setLoaded(true);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [user.id]);

  // Salvataggio automatico (con indicatore di stato)
  useEffect(() => {
    if (!loaded) return;
    setSaveStatus("pending");
    const t = setTimeout(() => {
      setSaveStatus("saving");
      persistUserData(user.id, data)
        .then(() => setSaveStatus("saved"))
        .catch((e) => { console.error("Errore nel salvataggio su Supabase:", e); setSaveStatus("error"); });
    }, 800);
    return () => clearTimeout(t);
  }, [data, loaded, user.id]);

  const saveNow = useCallback(() => {
    setSaveStatus("saving");
    persistUserData(user.id, data)
      .then(() => setSaveStatus("saved"))
      .catch((e) => { console.error("Errore nel salvataggio su Supabase:", e); setSaveStatus("error"); });
  }, [data, user.id]);

  // Applica una modifica ai dati registrando lo stato precedente per l'undo
  const applyChange = useCallback((updater) => {
    setData(prev => {
      setPast(p => [...p.slice(-(MAX_HISTORY - 1)), prev]);
      return typeof updater === "function" ? updater(prev) : updater;
    });
  }, []);

  const undo = useCallback(() => {
    setPast(p => {
      if (p.length === 0) return p;
      setData(p[p.length - 1]);
      return p.slice(0, -1);
    });
  }, []);

  const { expenses, patrimonio, categories, movements, fxRates, prices, displayName } = data;

  const addExpenses = useCallback((newOnes) => {
    applyChange(prev => ({ ...prev, expenses: [...newOnes.map(x => ({ ...x, id: uid() })), ...prev.expenses] }));
  }, [applyChange]);
  const deleteExpense = useCallback((id) => {
    applyChange(prev => ({ ...prev, expenses: prev.expenses.filter(e => e.id !== id) }));
  }, [applyChange]);
  const updateAsset = useCallback((year, assetIdx, patch) => {
    applyChange(prev => {
      const yr = { ...prev.patrimonio[year] };
      const assets = [...yr.assets];
      assets[assetIdx] = { ...assets[assetIdx], ...patch };
      yr.assets = assets;
      return { ...prev, patrimonio: { ...prev.patrimonio, [year]: yr } };
    });
  }, [applyChange]);
  const addAsset = useCallback((year, asset) => {
    applyChange(prev => {
      const yr = prev.patrimonio[year] ? { ...prev.patrimonio[year] } : { assets: [], netWorth: Array(12).fill(null) };
      yr.assets = [...yr.assets, asset];
      return { ...prev, patrimonio: { ...prev.patrimonio, [year]: yr } };
    });
  }, [applyChange]);
  const deleteAsset = useCallback((year, assetIdx) => {
    applyChange(prev => {
      const yr = { ...prev.patrimonio[year] };
      yr.assets = yr.assets.filter((_, i) => i !== assetIdx);
      return { ...prev, patrimonio: { ...prev.patrimonio, [year]: yr } };
    });
  }, [applyChange]);
  // Aggiorna in blocco i valori di più asset per un dato mese (es. "chiusura mensile")
  const bulkUpdateMonth = useCallback((year, monthIdx, valuesByIdx) => {
    applyChange(prev => {
      const yr = { ...prev.patrimonio[year] };
      const assets = yr.assets.map((a, i) => {
        if (!(i in valuesByIdx)) return a;
        const monthly = [...a.monthly];
        monthly[monthIdx] = valuesByIdx[i];
        return { ...a, monthly };
      });
      yr.assets = assets;
      return { ...prev, patrimonio: { ...prev.patrimonio, [year]: yr } };
    });
  }, [applyChange]);
  // Registra un movimento patrimoniale (es. acquisto investimento) e applica le variazioni agli asset coinvolti
  const addMovement = useCallback((movement, patches) => {
    applyChange(prev => {
      let pat = prev.patrimonio;
      for (const p of patches) {
        const yr = { ...pat[p.year] };
        const assets = [...yr.assets];
        const monthly = [...assets[p.assetIdx].monthly];
        monthly[p.monthIdx] = p.value;
        assets[p.assetIdx] = { ...assets[p.assetIdx], monthly, ...(p.extra || {}) };
        yr.assets = assets;
        pat = { ...pat, [p.year]: yr };
      }
      return { ...prev, patrimonio: pat, movements: [{ ...movement, id: uid() }, ...prev.movements] };
    });
  }, [applyChange]);
  const deleteMovement = useCallback((id) => {
    applyChange(prev => ({ ...prev, movements: prev.movements.filter(m => m.id !== id) }));
  }, [applyChange]);
  const updatePrice = useCallback((year, assetName, monthIdx, value) => {
    applyChange(prev => {
      const yr = { ...(prev.prices[year] || {}) };
      const p = yr[assetName] || { start: null, monthly: Array(12).fill(null) };
      const monthly = [...p.monthly];
      monthly[monthIdx] = value;
      yr[assetName] = { ...p, monthly };
      return { ...prev, prices: { ...prev.prices, [year]: yr } };
    });
  }, [applyChange]);
  const setCategories = useCallback((updater) => {
    applyChange(prev => ({ ...prev, categories: typeof updater === "function" ? updater(prev.categories) : updater }));
  }, [applyChange]);
  const setFxRates = useCallback((updater) => {
    applyChange(prev => ({ ...prev, fxRates: typeof updater === "function" ? updater(prev.fxRates) : updater }));
  }, [applyChange]);
  const setDisplayName = useCallback((name) => {
    applyChange(prev => ({ ...prev, displayName: name }));
  }, [applyChange]);

  if (!loaded) {
    return (
      <div className="nav-root" style={{ alignItems: "center", justifyContent: "center" }}>
        <GlobalStyle />
        <div className="mono" style={{ color: "#7C8797" }}>caricamento dati<span className="nav-cursor" /></div>
      </div>
    );
  }

  return (
    <div className="nav-root">
      <GlobalStyle />
      <Sidebar tab={tab} setTab={setTab} />
      <main className="nav-main">
        <TopBar past={past} undo={undo} saveStatus={saveStatus} saveNow={saveNow} onLogout={() => supabase.auth.signOut()} />
        {tab === "dashboard" && <Dashboard expenses={expenses} patrimonio={patrimonio} year={year} setYear={setYear} fxRates={fxRates} prices={prices} />}
        {tab === "spese" && <Spese expenses={expenses} categories={categories} addExpenses={addExpenses} deleteExpense={deleteExpense} />}
        {tab === "patrimonio" && <Patrimonio patrimonio={patrimonio} year={year} setYear={setYear} updateAsset={updateAsset} addAsset={addAsset} deleteAsset={deleteAsset} bulkUpdateMonth={bulkUpdateMonth} fxRates={fxRates} setFxRates={setFxRates} prices={prices} updatePrice={updatePrice} saveNow={saveNow} />}
        {tab === "movimenti" && <Movimenti patrimonio={patrimonio} movements={movements} addMovement={addMovement} deleteMovement={deleteMovement} prices={prices} />}
        {tab === "strumenti" && <Strumenti patrimonio={patrimonio} updateAsset={updateAsset} addAsset={addAsset} categories={categories} addExpenses={addExpenses} />}
        {tab === "categorie" && <Categorie categories={categories} setCategories={setCategories} />}
        {tab === "profilo" && <Profilo user={user} displayName={displayName} setDisplayName={setDisplayName} />}
      </main>
    </div>
  );
}

/* ============ TOP BAR: annulla ultima modifica + stato salvataggio ============ */
function TopBar({ past, undo, saveStatus, saveNow, onLogout }) {
  const label = { idle: "", pending: "Modifiche in sospeso…", saving: "Salvataggio…", saved: "Salvato", error: "Errore di salvataggio" }[saveStatus];
  const color = saveStatus === "error" ? COLORS.coral : saveStatus === "saved" ? "#7C8797" : COLORS.amber;
  return (
    <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 14, marginBottom: 6 }}>
      <span className="mono" style={{ fontSize: 11.5, color }}>{label}</span>
      <button className="btn" onClick={saveNow} title="Forza il salvataggio adesso"><Save size={13} />Salva</button>
      <button className="btn" onClick={undo} disabled={past.length === 0} title="Annulla l'ultima modifica"
        style={past.length === 0 ? { opacity: 0.4, cursor: "default" } : {}}>
        <Undo2 size={14} />Annulla
      </button>
      <button className="btn" onClick={onLogout} title="Esci dall'account"><LogOut size={14} />Esci</button>
    </div>
  );
}

/* ============ SIDEBAR ============ */
function Sidebar({ tab, setTab }) {
  const items = [
    { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
    { id: "spese", label: "Spese", icon: Receipt },
    { id: "patrimonio", label: "Patrimonio", icon: Wallet },
    { id: "movimenti", label: "Movimenti", icon: ArrowLeftRight },
    { id: "strumenti", label: "Strumenti", icon: Wrench },
    { id: "categorie", label: "Categorie", icon: Tags },
    { id: "profilo", label: "Profilo", icon: User },
  ];
  return (
    <nav className="nav-sidebar">
      <div className="nav-brand">NAV_<span className="nav-cursor" /></div>
      <div className="nav-tagline">ledger &amp; terminal personale</div>
      {items.map(it => (
        <button key={it.id} className={"nav-item" + (tab === it.id ? " active" : "")} onClick={() => setTab(it.id)}>
          <it.icon size={16} strokeWidth={2} />
          {it.label}
        </button>
      ))}
    </nav>
  );
}

/* ============ RILEVAMENTO MOBILE (per la vista "mese corrente" del Patrimonio) ============ */
function useIsMobile(breakpoint = 760) {
  const [isMobile, setIsMobile] = useState(() => typeof window !== "undefined" && window.innerWidth <= breakpoint);
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${breakpoint}px)`);
    const handler = (e) => setIsMobile(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [breakpoint]);
  return isMobile;
}

/* ============ HELPERS DATI ============ */
function useExpenseStats(expenses, year) {
  return useMemo(() => {
    const yExp = expenses.filter(e => e.date.startsWith(String(year)));
    const byMonth = Array(12).fill(0);
    const byMonthIncome = Array(12).fill(0);
    const byPrimary = {};
    for (const e of yExp) {
      const m = parseInt(e.date.slice(5, 7), 10) - 1;
      if (e.primary === "Entrate") {
        byMonthIncome[m] += e.amount;
      } else {
        byMonth[m] += e.amount;
        byPrimary[e.primary] = (byPrimary[e.primary] || 0) + e.amount;
      }
    }
    const totalSpese = byMonth.reduce((a, b) => a + b, 0);
    const totalEntrate = byMonthIncome.reduce((a, b) => a + b, 0);
    return { yExp, byMonth, byMonthIncome, byPrimary, totalSpese, totalEntrate };
  }, [expenses, year]);
}

function lastKnownNW(series) {
  for (let i = 11; i >= 0; i--) {
    if (series[i] !== null && series[i] !== undefined) return { value: series[i], monthIdx: i };
  }
  return { value: null, monthIdx: -1 };
}

/* ============ DASHBOARD ============ */
function Dashboard({ expenses, patrimonio, year, setYear, fxRates, prices }) {
  const stats = useExpenseStats(expenses, year);
  const netWorthSeries = useMemo(() => getStrictNetWorthSeries(patrimonio[year], fxRates, year, prices), [patrimonio, year, fxRates, prices]);
  const { value: nwNow, monthIdx } = lastKnownNW(netWorthSeries);
  const prevMonthNW = monthIdx > 0 ? netWorthSeries[monthIdx - 1] : null;
  const nwDelta = prevMonthNW !== null && nwNow !== null ? nwNow - prevMonthNW : null;
  const nwDeltaPct = prevMonthNW ? (nwDelta / prevMonthNW) * 100 : null;

  const speseMese = monthIdx >= 0 ? stats.byMonth[monthIdx] : 0;
  const entrateMese = monthIdx >= 0 ? stats.byMonthIncome[monthIdx] : 0;
  const saldoMese = entrateMese - speseMese;

  const nwSeries = MONTHS.map((m, i) => ({ mese: m, patrimonio: netWorthSeries[i] ?? null })).filter(d => d.patrimonio !== null);
  const speseSeries = MONTHS.map((m, i) => ({ mese: m, spese: stats.byMonth[i], entrate: stats.byMonthIncome[i] }));
  const pieData = Object.entries(stats.byPrimary).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ name: k.trim(), value: Math.round(v * 100) / 100 }));

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="nav-page-title">Dashboard</h1>
          <p className="nav-page-sub">Panoramica generale del tuo patrimonio e delle tue spese</p>
        </div>
        <YearSelect year={year} setYear={setYear} />
      </div>

      <div className="ticker">
        <div className="ticker-cell">
          <div className="ticker-label">Patrimonio netto</div>
          <div className="ticker-value mono">{fmtCHF(nwNow)}</div>
          {nwDelta !== null && (
            <div className="ticker-delta" style={{ color: nwDelta >= 0 ? COLORS.mint : COLORS.coral }}>
              {nwDelta >= 0 ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}
              {fmtCHF(Math.abs(nwDelta))} ({nwDeltaPct?.toFixed(1)}%) ultimo mese
            </div>
          )}
        </div>
        <div className="ticker-cell">
          <div className="ticker-label">Entrate ({monthIdx >= 0 ? MONTHS[monthIdx] : "-"})</div>
          <div className="ticker-value mono" style={{ color: COLORS.mint }}>{fmtCHF(entrateMese)}</div>
        </div>
        <div className="ticker-cell">
          <div className="ticker-label">Spese ({monthIdx >= 0 ? MONTHS[monthIdx] : "-"})</div>
          <div className="ticker-value mono" style={{ color: COLORS.coral }}>{fmtCHF(speseMese)}</div>
        </div>
        <div className="ticker-cell">
          <div className="ticker-label">Saldo mensile</div>
          <div className="ticker-value mono" style={{ color: saldoMese >= 0 ? COLORS.mint : COLORS.coral }}>{fmtCHF(saldoMese)}</div>
        </div>
      </div>

      <div className="grid-2col-wide">
        <div className="card">
          <div className="card-title">Evoluzione patrimonio {year}</div>
          <ResponsiveContainer width="100%" height={260}>
            <AreaChart data={nwSeries}>
              <defs>
                <linearGradient id="nwGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={COLORS.mint} stopOpacity={0.35} />
                  <stop offset="100%" stopColor={COLORS.mint} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="#2A3140" vertical={false} />
              <XAxis dataKey="mese" stroke="#7C8797" fontSize={11} />
              <YAxis stroke="#7C8797" fontSize={11} tickFormatter={(v) => (v / 1000) + "k"} />
              <Tooltip contentStyle={{ background: "#1E2530", border: "1px solid #2A3140", borderRadius: 8, fontSize: 12 }} formatter={(v) => fmtCHF(v)} />
              <Area type="monotone" dataKey="patrimonio" stroke={COLORS.mint} fill="url(#nwGrad)" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
        <div className="card">
          <div className="card-title">Spese per categoria {year}</div>
          {pieData.length === 0 ? <div className="empty-state">Nessuna spesa registrata</div> : (
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie data={pieData} dataKey="value" nameKey="name" innerRadius={55} outerRadius={90} paddingAngle={2}>
                  {pieData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                </Pie>
                <Tooltip contentStyle={{ background: "#1E2530", border: "1px solid #2A3140", borderRadius: 8, fontSize: 12 }} formatter={(v) => fmtCHF(v)} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="card-title">Entrate vs spese mensili {year}</div>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={speseSeries}>
            <CartesianGrid stroke="#2A3140" vertical={false} />
            <XAxis dataKey="mese" stroke="#7C8797" fontSize={11} />
            <YAxis stroke="#7C8797" fontSize={11} />
            <Tooltip contentStyle={{ background: "#1E2530", border: "1px solid #2A3140", borderRadius: 8, fontSize: 12 }} formatter={(v) => fmtCHF(v)} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Bar dataKey="entrate" fill={COLORS.mint} radius={[4, 4, 0, 0]} name="Entrate" />
            <Bar dataKey="spese" fill={COLORS.coral} radius={[4, 4, 0, 0]} name="Spese" />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function YearSelect({ year, setYear }) {
  return (
    <select value={year} onChange={(e) => setYear(Number(e.target.value))}>
      {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
    </select>
  );
}

/* ============ SPESE ============ */
function Spese({ expenses, categories, addExpenses, deleteExpense }) {
  const [filterYear, setFilterYear] = useState("Tutti");
  const [filterCat, setFilterCat] = useState("Tutte");
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [page, setPage] = useState(1);
  const PER_PAGE = 40;

  const filtered = useMemo(() => {
    return expenses
      .filter(e => filterYear === "Tutti" || e.date.startsWith(String(filterYear)))
      .filter(e => filterCat === "Tutte" || e.primary === filterCat)
      .filter(e => !search || e.desc.toLowerCase().includes(search.toLowerCase()))
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [expenses, filterYear, filterCat, search]);

  const totale = filtered.reduce((s, e) => s + (e.primary === "Entrate" ? 0 : e.amount), 0);
  const pageData = filtered.slice(0, page * PER_PAGE);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="nav-page-title">Spese</h1>
          <p className="nav-page-sub">{filtered.length} movimenti — totale spese filtrate: {fmtCHF(totale)}</p>
        </div>
        <button className="btn primary" onClick={() => setShowForm(true)}><Plus size={15} />Aggiungi spesa</button>
      </div>

      <div className="tabs-row">
        <select value={filterYear} onChange={(e) => setFilterYear(e.target.value)}>
          <option>Tutti</option>
          {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
        <select value={filterCat} onChange={(e) => setFilterCat(e.target.value)}>
          <option>Tutte</option>
          {Object.keys(categories).map(c => <option key={c} value={c}>{c.trim()}</option>)}
        </select>
        <div style={{ position: "relative", flex: 1, minWidth: 180 }}>
          <Search size={14} style={{ position: "absolute", left: 10, top: 10, color: "#7C8797" }} />
          <input style={{ width: "100%", paddingLeft: 30 }} placeholder="Cerca descrizione…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </div>

      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ maxHeight: 560, overflowY: "auto", overflowX: "auto" }}>
          <table className="data-table">
            <thead>
              <tr><th>Data</th><th>Descrizione</th><th>Categoria</th><th style={{ textAlign: "right" }}>Importo</th><th></th></tr>
            </thead>
            <tbody>
              {pageData.map(e => (
                <tr key={e.id}>
                  <td className="mono" style={{ color: "#7C8797", whiteSpace: "nowrap" }}>{e.date}</td>
                  <td>{e.desc}{e.note ? <span style={{ color: "#4E576A" }}> — {e.note}</span> : null}</td>
                  <td><span className="pill">{e.primary.trim()}{e.secondary ? " / " + e.secondary : ""}</span></td>
                  <td className="mono" style={{ textAlign: "right", color: e.primary === "Entrate" ? COLORS.mint : "#E7EBF3" }}>{e.primary === "Entrate" ? "+" : ""}{fmtCHF2(e.amount)}</td>
                  <td style={{ width: 30 }}><button className="icon-btn" onClick={() => deleteExpense(e.id)}><Trash2 size={14} /></button></td>
                </tr>
              ))}
              {pageData.length === 0 && (
                <tr><td colSpan={5}><div className="empty-state">Nessuna spesa trovata con questi filtri.</div></td></tr>
              )}
            </tbody>
          </table>
        </div>
        {filtered.length > pageData.length && (
          <div style={{ padding: 12, textAlign: "center", borderTop: "1px solid #2A3140" }}>
            <button className="btn" onClick={() => setPage(p => p + 1)}>Mostra altri ({filtered.length - pageData.length} rimanenti)</button>
          </div>
        )}
      </div>

      {showForm && <ExpenseFormModal categories={categories} onClose={() => setShowForm(false)} onSave={(exp) => { addExpenses([exp]); setShowForm(false); }} />}
    </div>
  );
}

function ExpenseFormModal({ categories, onClose, onSave }) {
  const primaries = Object.keys(categories);
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [desc, setDesc] = useState("");
  const [amount, setAmount] = useState("");
  const [primary, setPrimary] = useState(primaries[0] || "");
  const [secondary, setSecondary] = useState((categories[primaries[0]] || [])[0] || "");
  const [note, setNote] = useState("");
  const secondaries = categories[primary] || [];

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16 }}>
          <h3 style={{ margin: 0, fontSize: 16 }}>Nuova spesa</h3>
          <button className="icon-btn" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="field"><label className="field-label">Data</label><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
        <div className="field"><label className="field-label">Descrizione</label><input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="es. spesa migros" /></div>
        <div className="field"><label className="field-label">Importo (CHF)</label><input type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" /></div>
        <div className="row-2">
          <div className="field">
            <label className="field-label">Categoria</label>
            <select value={primary} onChange={(e) => { setPrimary(e.target.value); setSecondary((categories[e.target.value] || [])[0] || ""); }}>
              {primaries.map(p => <option key={p} value={p}>{p.trim()}</option>)}
            </select>
          </div>
          <div className="field">
            <label className="field-label">Sottocategoria</label>
            <select value={secondary} onChange={(e) => setSecondary(e.target.value)}>
              {secondaries.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        </div>
        <div className="field"><label className="field-label">Nota (opzionale)</label><input value={note} onChange={(e) => setNote(e.target.value)} /></div>
        <button className="btn primary" style={{ width: "100%", justifyContent: "center", marginTop: 6 }}
          onClick={() => { if (!desc || !amount) return; onSave({ date, desc, amount: parseFloat(amount), primary, secondary, note }); }}>
          Salva spesa
        </button>
      </div>
    </div>
  );
}

/* ============ PATRIMONIO ============ */
function Patrimonio({ patrimonio, year, setYear, updateAsset, addAsset, deleteAsset, bulkUpdateMonth, fxRates, setFxRates, prices, updatePrice, saveNow }) {
  const [showAssetForm, setShowAssetForm] = useState(false);
  const [showUpdateMonth, setShowUpdateMonth] = useState(false);
  const [editing, setEditing] = useState(null); // { assetIdx, monthIdx }
  const [expanded, setExpanded] = useState(null); // { assetIdx, monthIdx } — cella investimento con dettaglio quote×prezzo aperto
  const isMobile = useIsMobile();
  const [mobileTab, setMobileTab] = useState("corrente"); // corrente | storico
  const [confirmStatus, setConfirmStatus] = useState(null);
  const yr = patrimonio[year] || { assets: [], netWorth: Array(12).fill(null) };
  const groups = ["Investimenti", "Cash/liquidità", "Mezzi di trasporto"];
  const netWorthSeries = useMemo(() => getStrictNetWorthSeries(yr, fxRates, year, prices), [yr, fxRates, year, prices]);
  const currentMonthIdx = useMemo(() => getCurrentMonthIndex(netWorthSeries), [netWorthSeries]);
  const now = new Date();
  const defaultMonthIdx = currentMonthIdx >= 0 ? Math.min(currentMonthIdx + 1, 11) : (year === now.getFullYear() ? now.getMonth() : 0);
  const showStorico = !isMobile || mobileTab === "storico";

  const confirmTimers = useRef([]);
  const confirmMonth = () => {
    confirmTimers.current.forEach(clearTimeout);
    setConfirmStatus("saving");
    saveNow();
    confirmTimers.current = [
      setTimeout(() => setConfirmStatus("saved"), 400),
      setTimeout(() => setConfirmStatus(null), 3000),
    ];
  };

  const saveCell = (assetIdx, monthIdx, raw) => {
    const num = parseFloat(String(raw).replace(",", "."));
    setEditing(null);
    if (isNaN(num)) return;
    const asset = yr.assets[assetIdx];
    const monthly = [...asset.monthly];
    monthly[monthIdx] = Math.round(num * 100) / 100;
    updateAsset(year, assetIdx, { monthly });
  };

  const colStyle = (i) => i === currentMonthIdx ? { background: "rgba(74,222,156,0.10)", boxShadow: "inset 0 0 0 1px rgba(74,222,156,0.35)" } : {};

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="nav-page-title">Patrimonio</h1>
          <p className="nav-page-sub">
            Composizione e andamento mensile dei tuoi asset — clicca una cella per compilarla (per gli investimenti, clicca per vedere quote × prezzo)
            {currentMonthIdx >= 0 && <> · <span style={{ color: COLORS.mint, fontWeight: 600 }}>{MONTHS[currentMonthIdx]} {year}</span> è l'ultimo mese completo</>}
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <YearSelect year={year} setYear={setYear} />
          <button className="btn primary" onClick={() => setShowUpdateMonth(true)}><RefreshCw size={14} />Aggiorna {MONTHS[defaultMonthIdx]}</button>
          <button className="btn" onClick={() => setShowAssetForm(true)}><Plus size={15} />Aggiungi asset</button>
        </div>
      </div>

      {isMobile && (
        <div className="month-tabs">
          <button className={"btn" + (mobileTab === "corrente" ? " primary" : "")} onClick={() => setMobileTab("corrente")}>Mese corrente</button>
          <button className={"btn" + (mobileTab === "storico" ? " primary" : "")} onClick={() => setMobileTab("storico")}>Storico 12 mesi</button>
        </div>
      )}

      {isMobile && mobileTab === "corrente" && (
        <MeseCorrente
          yr={yr} year={year} monthIdx={defaultMonthIdx} groups={groups}
          updateAsset={updateAsset} prices={prices} updatePrice={updatePrice}
          netWorthValue={netWorthSeries[defaultMonthIdx]}
          onConfirm={confirmMonth} confirmStatus={confirmStatus}
        />
      )}

      {showStorico && (<>
      <div className="card" style={{ marginBottom: 16, display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
        <div className="card-title" style={{ margin: 0 }}>Tassi di cambio</div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span style={{ fontSize: 12, color: "#7C8797" }} className="mono">EUR→CHF</span>
          <input type="number" step="0.0001" style={{ width: 90 }} value={fxRates.EURCHF} onChange={(e) => setFxRates(prev => ({ ...prev, EURCHF: parseFloat(e.target.value) || prev.EURCHF }))} />
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span style={{ fontSize: 12, color: "#7C8797" }} className="mono">USD→CHF</span>
          <input type="number" step="0.0001" style={{ width: 90 }} value={fxRates.USDCHF} onChange={(e) => setFxRates(prev => ({ ...prev, USDCHF: parseFloat(e.target.value) || prev.USDCHF }))} />
        </div>
        <span style={{ fontSize: 11.5, color: "#4E576A" }}>Aggiornali a mano quando servono: senza backend non possiamo tirarli in automatico da Google Finance.</span>
      </div>

      {groups.map(g => {
        const items = yr.assets.map((a, i) => ({ ...a, idx: i })).filter(a => a.group === g);
        if (items.length === 0) return null;
        const isInvestGroup = g === "Investimenti";
        const selectedAsset = expanded && isInvestGroup ? items.find(a => a.idx === expanded.assetIdx) : null;
        return (
          <div className="card" key={g} style={{ marginBottom: 16, overflowX: "auto" }}>
            <div className="card-title">{g}</div>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Asset</th><th>Cur</th>
                  {MONTHS.map((m, i) => (
                    <th key={m} style={{ textAlign: "right", ...colStyle(i) }}>
                      {m}{i === currentMonthIdx && <div style={{ fontSize: 9, color: COLORS.mint, fontWeight: 700, letterSpacing: 0.4 }}>ORA</div>}
                    </th>
                  ))}
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {items.map(a => {
                  const isAmort = a.ammortamento?.enabled;
                  const isPriceLinked = a.units !== undefined && a.units !== null;
                  const isComputed = isAmort || isPriceLinked;
                  return (
                    <tr key={a.idx}>
                      <td>{a.name}{isAmort && <span className="badge-amort" style={{ marginLeft: 6 }}><Percent size={10} />amm.</span>}</td>
                      <td className="mono" style={{ color: "#7C8797" }}>{a.currency}</td>
                      {MONTHS.map((m, i) => {
                        const refDate = new Date(year, i, 1);
                        const { value: val, explicit } = getAssetStrictValue(a, i, refDate, prices, year);
                        const isEditing = editing && editing.assetIdx === a.idx && editing.monthIdx === i;
                        const isSelected = expanded && expanded.assetIdx === a.idx && expanded.monthIdx === i;

                        if (isPriceLinked) {
                          return (
                            <td key={i} className="mono" onClick={() => setExpanded(isSelected ? null : { assetIdx: a.idx, monthIdx: i })}
                              style={{ textAlign: "right", cursor: "pointer", color: val === null ? "#3A4152" : "#E7EBF3", ...(isSelected ? { background: "rgba(91,141,239,0.16)", boxShadow: "inset 0 0 0 1px rgba(91,141,239,0.5)" } : colStyle(i)) }}
                              title="Clicca per vedere quote × prezzo di questo mese">
                              {val === null ? "·" : fmtCHF(val)}
                            </td>
                          );
                        }
                        if (isEditing) {
                          return (
                            <td key={i} style={{ padding: 2, ...colStyle(i) }}>
                              <input autoFocus className="mono" style={{ width: 74, textAlign: "right", padding: "4px 6px" }}
                                defaultValue={val ?? ""}
                                onBlur={(e) => saveCell(a.idx, i, e.target.value)}
                                onKeyDown={(e) => { if (e.key === "Enter") saveCell(a.idx, i, e.target.value); if (e.key === "Escape") setEditing(null); }} />
                            </td>
                          );
                        }
                        return (
                          <td key={i} className="mono" onClick={() => !isComputed && setEditing({ assetIdx: a.idx, monthIdx: i })}
                            style={{ textAlign: "right", cursor: isComputed ? "default" : "pointer", color: val === null ? "#3A4152" : explicit || isComputed ? "#E7EBF3" : "#7C8797", ...colStyle(i) }}
                            title={isAmort ? "Calcolato automaticamente dall'ammortamento" : explicit ? "Valore registrato" : "Non ancora compilato — clicca per inserirlo"}>
                            {val === null ? "·" : fmtCHF(val)}
                          </td>
                        );
                      })}
                      <td><button className="icon-btn" onClick={() => deleteAsset(year, a.idx)}><Trash2 size={13} /></button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {selectedAsset && (
              <CellDetailBar
                asset={selectedAsset} monthIdx={expanded.monthIdx} year={year} prices={prices}
                updatePrice={updatePrice} updateAsset={updateAsset} onClose={() => setExpanded(null)}
              />
            )}
          </div>
        );
      })}

      {(() => {
        const investAssets = yr.assets.map((a, i) => ({ ...a, idx: i })).filter(a => a.group === "Investimenti");
        if (investAssets.length === 0) return null;
        return (
          <div className="card" style={{ marginBottom: 16, overflowX: "auto" }}>
            <InvestmentPanel assets={investAssets} year={year} prices={prices} updatePrice={updatePrice} colStyle={colStyle} currentMonthIdx={currentMonthIdx} />
          </div>
        );
      })()}

      <div className="card">
        <div className="card-title">Patrimonio netto totale (CHF) — {year}, calcolato dal vivo sugli asset sopra</div>
        <table className="data-table">
          <thead><tr>{MONTHS.map((m, i) => <th key={m} style={{ textAlign: "right", ...colStyle(i) }}>{m}</th>)}</tr></thead>
          <tbody><tr>{netWorthSeries.map((v, i) => <td key={i} className="mono" style={{ textAlign: "right", fontWeight: 600, ...colStyle(i) }}>{v === null ? "·" : fmtCHF(v)}</td>)}</tr></tbody>
        </table>
      </div>
      </>)}

      {showAssetForm && (
        <AssetFormModal onClose={() => setShowAssetForm(false)} onSave={(asset) => { addAsset(year, asset); setShowAssetForm(false); }} />
      )}
      {showUpdateMonth && (
        <UpdateMonthModal yr={yr} year={year} monthIdx={defaultMonthIdx} onClose={() => setShowUpdateMonth(false)}
          onSave={(valuesByIdx) => { bulkUpdateMonth(year, defaultMonthIdx, valuesByIdx); setShowUpdateMonth(false); }} />
      )}
    </div>
  );
}

/* ============ MESE CORRENTE (mobile): stessa composizione del Patrimonio, ma solo il mese selezionato, righe grandi e comode al tocco ============ */
function MeseCorrente({ yr, year, monthIdx, groups, updateAsset, prices, updatePrice, netWorthValue, onConfirm, confirmStatus }) {
  const [editing, setEditing] = useState(null); // assetIdx
  const [expandedIdx, setExpandedIdx] = useState(null); // assetIdx con dettaglio quote×prezzo aperto

  const saveCell = (assetIdx, raw) => {
    const num = parseFloat(String(raw).replace(",", "."));
    setEditing(null);
    if (isNaN(num)) return;
    const asset = yr.assets[assetIdx];
    const monthly = [...asset.monthly];
    monthly[monthIdx] = Math.round(num * 100) / 100;
    updateAsset(year, assetIdx, { monthly });
  };

  return (
    <div>
      <div className="card" style={{ marginBottom: 16, textAlign: "center" }}>
        <div className="card-title" style={{ justifyContent: "center" }}>Patrimonio netto — {MONTHS[monthIdx]} {year}</div>
        <div className="mono" style={{ fontSize: 28, fontWeight: 700 }}>{netWorthValue === null || netWorthValue === undefined ? "—" : fmtCHF(netWorthValue)}</div>
      </div>

      {groups.map(g => {
        const items = yr.assets.map((a, i) => ({ ...a, idx: i })).filter(a => a.group === g);
        if (items.length === 0) return null;
        return (
          <div className="card" key={g} style={{ marginBottom: 16 }}>
            <div className="card-title">{g}</div>
            {items.map(a => {
              const isAmort = a.ammortamento?.enabled;
              const isPriceLinked = a.units !== undefined && a.units !== null;
              const isComputed = isAmort || isPriceLinked;
              const refDate = new Date(year, monthIdx, 1);
              const { value: val } = getAssetStrictValue(a, monthIdx, refDate, prices, year);
              const isEditing = editing === a.idx;
              const isExpanded = expandedIdx === a.idx;
              return (
                <div key={a.idx}>
                  <div className="month-row"
                    onClick={() => { if (isPriceLinked) setExpandedIdx(isExpanded ? null : a.idx); else if (!isComputed) setEditing(a.idx); }}
                    style={{ cursor: isComputed && !isPriceLinked ? "default" : "pointer" }}>
                    <span>
                      {a.name}
                      {isAmort && <span className="badge-amort" style={{ marginLeft: 6 }}><Percent size={10} />amm.</span>}
                      <span className="pill" style={{ marginLeft: 8 }}>{a.currency}</span>
                    </span>
                    {isEditing ? (
                      <input autoFocus className="mono" style={{ width: 120, textAlign: "right" }}
                        defaultValue={val ?? ""} onClick={(e) => e.stopPropagation()}
                        onBlur={(e) => saveCell(a.idx, e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") saveCell(a.idx, e.target.value); if (e.key === "Escape") setEditing(null); }} />
                    ) : (
                      <span className="month-row-value mono">{val === null ? "·" : fmtCHF(val)}</span>
                    )}
                  </div>
                  {isExpanded && (
                    <CellDetailBar asset={a} monthIdx={monthIdx} year={year} prices={prices}
                      updatePrice={updatePrice} updateAsset={updateAsset} onClose={() => setExpandedIdx(null)} />
                  )}
                </div>
              );
            })}
          </div>
        );
      })}

      <button className="btn primary" style={{ width: "100%", justifyContent: "center", marginBottom: 8 }} onClick={onConfirm}>
        <Check size={15} />Conferma dati di {MONTHS[monthIdx]}
      </button>
      {confirmStatus && (
        <div className="pill" style={{ display: "block", textAlign: "center" }}>
          {confirmStatus === "saving" ? "Salvataggio…" : "✓ Dati salvati nello storico"}
        </div>
      )}
    </div>
  );
}

/* ============ PANNELLO INVESTIMENTI QUOTATI: quote × prezzo, tabella prezzi YTD/MTD, grafico ============ */
function InvestmentPanel({ assets, year, prices, updatePrice, colStyle, currentMonthIdx }) {
  const [selected, setSelected] = useState(assets[0]?.name || null);
  const [editingPrice, setEditingPrice] = useState(null); // { name, monthIdx }

  const savePriceCell = (name, monthIdx, raw) => {
    const num = parseFloat(String(raw).replace(",", "."));
    setEditingPrice(null);
    if (isNaN(num)) return;
    updatePrice(String(year), name, monthIdx, Math.round(num * 10000) / 10000);
  };

  const clearLastPrice = (name, lastIdx) => {
    if (lastIdx === undefined || lastIdx === null || lastIdx < 0) return;
    updatePrice(String(year), name, lastIdx, null);
  };

  const timeline = selected ? getPriceTimeline(prices, selected) : [];

  return (
    <div>
      <div className="card-title">Prezzo per quota — {year} <span style={{ fontWeight: 400, color: "#4E576A", textTransform: "none" }}>(clicca un nome per il grafico, clicca una cella per registrare il prezzo)</span></div>
      <table className="data-table">
        <thead>
          <tr>
            <th>Investimento</th>
            {MONTHS.map((m, i) => <th key={m} style={{ textAlign: "right", ...colStyle(i) }}>{m}</th>)}
            <th style={{ textAlign: "right" }}>YTD</th><th style={{ textAlign: "right" }}>MTD</th><th></th>
          </tr>
        </thead>
        <tbody>
          {assets.map(a => {
            const { ytd, mtd, lastIdx } = getPriceChanges(prices, a.name, String(year));
            return (
              <tr key={a.name}>
                <td onClick={() => setSelected(a.name)} style={{ cursor: "pointer", color: selected === a.name ? COLORS.mint : "#E7EBF3", fontWeight: selected === a.name ? 600 : 400 }}>{a.name}</td>
                {MONTHS.map((m, i) => {
                  const v = prices[String(year)]?.[a.name]?.monthly?.[i] ?? null;
                  const isEditing = editingPrice && editingPrice.name === a.name && editingPrice.monthIdx === i;
                  if (isEditing) {
                    return (
                      <td key={i} style={{ padding: 2, ...colStyle(i) }}>
                        <input autoFocus className="mono" style={{ width: 66, textAlign: "right", padding: "4px 6px" }}
                          defaultValue={v ?? ""}
                          onBlur={(e) => savePriceCell(a.name, i, e.target.value)}
                          onKeyDown={(e) => { if (e.key === "Enter") savePriceCell(a.name, i, e.target.value); if (e.key === "Escape") setEditingPrice(null); }} />
                      </td>
                    );
                  }
                  return (
                    <td key={i} className="mono" onClick={() => setEditingPrice({ name: a.name, monthIdx: i })}
                      style={{ textAlign: "right", cursor: "pointer", color: v === null ? "#3A4152" : "#E7EBF3", ...colStyle(i) }}
                      title="Clicca per registrare/aggiornare il prezzo di questo mese">
                      {v === null ? "·" : fmtCHF2(v)}
                    </td>
                  );
                })}
                <td className="mono" style={{ textAlign: "right", color: ytd === null ? "#4E576A" : ytd >= 0 ? COLORS.mint : COLORS.coral }}>{fmtPct(ytd)}</td>
                <td className="mono" style={{ textAlign: "right", color: mtd === null ? "#4E576A" : mtd >= 0 ? COLORS.mint : COLORS.coral }}>{fmtPct(mtd)}</td>
                <td>
                  {lastIdx !== undefined && lastIdx >= 0 && (
                    <button className="icon-btn" title={`Cancella il prezzo di ${MONTHS[lastIdx]} (ultimo inserito)`} onClick={() => clearLastPrice(a.name, lastIdx)}>
                      <Trash2 size={13} />
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {selected && (
        <div style={{ marginTop: 16 }}>
          <div className="card-title">Andamento prezzo — {selected}</div>
          {timeline.length < 2 ? <div className="empty-state">Non ci sono ancora abbastanza dati di prezzo per un grafico.</div> : (
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={timeline}>
                <CartesianGrid stroke="#2A3140" vertical={false} />
                <XAxis dataKey="label" stroke="#7C8797" fontSize={10.5} />
                <YAxis stroke="#7C8797" fontSize={11} domain={["auto", "auto"]} />
                <Tooltip contentStyle={{ background: "#1E2530", border: "1px solid #2A3140", borderRadius: 8, fontSize: 12 }} formatter={(v) => fmtCHF2(v)} />
                <Line type="monotone" dataKey="value" stroke={COLORS.blue} strokeWidth={2} dot={{ r: 2.5 }} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      )}
    </div>
  );
}

/* Modale per aggiornare in un colpo solo tutte le cifre patrimoniali del mese corrente */
function UpdateMonthModal({ yr, year, monthIdx, onClose, onSave }) {
  const initial = {};
  yr.assets.forEach((a, i) => {
    if (a.ammortamento?.enabled || a.units !== undefined) return;
    const refDate = new Date(year, monthIdx, 1);
    initial[i] = getAssetValueAtMonth(a, monthIdx, refDate).value ?? 0;
  });
  const [values, setValues] = useState(initial);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 480 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
          <h3 style={{ margin: 0, fontSize: 16 }}>Aggiorna cifre di {MONTHS[monthIdx]} {year}</h3>
          <button className="icon-btn" onClick={onClose}><X size={18} /></button>
        </div>
        <p style={{ fontSize: 12.5, color: "#7C8797", marginTop: 0, marginBottom: 16 }}>
          Ogni campo è precompilato con l'ultimo valore noto. Modifica solo quello che è cambiato (es. il saldo del conto) e salva.
        </p>
        <div style={{ maxHeight: 380, overflowY: "auto", paddingRight: 4 }}>
          {yr.assets.map((a, i) => (a.ammortamento?.enabled || a.units !== undefined) ? null : (
            <div className="field" key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
              <label className="field-label" style={{ margin: 0, flex: 1 }}>{a.name} <span style={{ color: "#4E576A" }}>({a.currency})</span></label>
              <input type="number" step="0.01" style={{ width: 130, textAlign: "right" }} className="mono"
                value={values[i]} onChange={(e) => setValues(prev => ({ ...prev, [i]: parseFloat(e.target.value) }))} />
            </div>
          ))}
        </div>
        <button className="btn primary" style={{ width: "100%", justifyContent: "center", marginTop: 14 }}
          onClick={() => onSave(values)}>
          <Check size={14} />Salva cifre di {MONTHS[monthIdx]}
        </button>
      </div>
    </div>
  );
}

/* ============ BARRA DETTAGLIO: mostra e permette di modificare quote × prezzo per la cella selezionata ============ */
function CellDetailBar({ asset, monthIdx, year, prices, updatePrice, updateAsset, onClose }) {
  const priceVal = prices[String(year)]?.[asset.name]?.monthly?.[monthIdx] ?? null;
  const total = priceVal !== null ? Math.round(asset.units * priceVal * 100) / 100 : null;

  return (
    <div style={{ marginTop: 14, padding: "12px 16px", background: "rgba(91,141,239,0.08)", border: "1px solid rgba(91,141,239,0.35)", borderRadius: 10, display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
      <div style={{ fontSize: 12.5, fontWeight: 600, color: COLORS.blue }}>{asset.name} · {MONTHS[monthIdx]} {year}</div>
      <div className="mono" style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
        <span style={{ color: "#7C8797", fontSize: 11 }}>quote</span>
        <input type="number" step="0.0001" style={{ width: 70, textAlign: "right" }}
          defaultValue={asset.units}
          onBlur={(e) => { const n = parseFloat(e.target.value); if (!isNaN(n)) updateAsset(year, asset.idx, { units: n }); }} />
        <span style={{ color: "#4E576A" }}>×</span>
        <span style={{ color: "#7C8797", fontSize: 11 }}>prezzo</span>
        <input type="number" step="0.01" style={{ width: 74, textAlign: "right" }}
          defaultValue={priceVal ?? ""}
          onBlur={(e) => { const n = parseFloat(e.target.value); if (!isNaN(n)) updatePrice(String(year), asset.name, monthIdx, Math.round(n * 10000) / 10000); }} />
        <span style={{ color: "#4E576A" }}>=</span>
        <span style={{ fontWeight: 700, fontSize: 14.5, color: COLORS.mint }}>{total === null ? "—" : fmtCHF2(total)}</span>
      </div>
      <button className="icon-btn" style={{ marginLeft: "auto" }} onClick={onClose}><X size={15} /></button>
    </div>
  );
}

function AssetFormModal({ onClose, onSave }) {
  const [name, setName] = useState("");
  const [group, setGroup] = useState("Cash/liquidità");
  const [currency, setCurrency] = useState("F");
  const [value, setValue] = useState("");

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16 }}>
          <h3 style={{ margin: 0, fontSize: 16 }}>Nuovo asset</h3>
          <button className="icon-btn" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="field"><label className="field-label">Nome</label><input value={name} onChange={(e) => setName(e.target.value)} placeholder="es. Conto risparmio" /></div>
        <div className="row-2">
          <div className="field">
            <label className="field-label">Gruppo</label>
            <select value={group} onChange={(e) => setGroup(e.target.value)}>
              <option>Investimenti</option><option>Cash/liquidità</option><option>Mezzi di trasporto</option>
            </select>
          </div>
          <div className="field">
            <label className="field-label">Valuta</label>
            <select value={currency} onChange={(e) => setCurrency(e.target.value)}>
              <option value="F">CHF</option><option value="E">EUR</option><option value="D">USD</option>
            </select>
          </div>
        </div>
        <div className="field"><label className="field-label">Valore attuale</label><input type="number" step="0.01" value={value} onChange={(e) => setValue(e.target.value)} /></div>
        <button className="btn primary" style={{ width: "100%", justifyContent: "center", marginTop: 6 }}
          onClick={() => { if (!name || !value) return; onSave({ name, group, currency, monthly: Array(12).fill(null).map((_, i) => i === new Date().getMonth() ? parseFloat(value) : null), ammortamento: null }); }}>
          Aggiungi
        </button>
      </div>
    </div>
  );
}

/* ============ MOVIMENTI (giornale patrimoniale: spostamenti tra voci, non spese) ============ */
function Movimenti({ patrimonio, movements, addMovement, deleteMovement, prices }) {
  const [showForm, setShowForm] = useState(false);
  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="nav-page-title">Movimenti</h1>
          <p className="nav-page-sub">Il giornale dei movimenti tra voci del patrimonio: acquisti/vendite di investimenti e giroconti — non tocca le tue spese</p>
        </div>
        <button className="btn primary" onClick={() => setShowForm(true)}><Plus size={15} />Nuovo movimento</button>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <p style={{ fontSize: 13, color: "#7C8797", lineHeight: 1.6, margin: 0 }}>
          Esempio: compri 50 quote di VWCE a 165.90. Registri qui un movimento "Acquisto investimento": l'app toglie automaticamente il controvalore dal conto che scegli come provenienza e lo aggiunge all'ETF, aggiornando le quote possedute — senza creare nessuna voce nelle Spese.
        </p>
      </div>

      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <table className="data-table">
          <thead><tr><th>Data</th><th>Tipo</th><th>Da</th><th>A</th><th style={{ textAlign: "right" }}>Importo</th><th></th></tr></thead>
          <tbody>
            {movements.map(m => (
              <tr key={m.id}>
                <td className="mono" style={{ color: "#7C8797" }}>{m.date}</td>
                <td><span className="pill">{m.tipoLabel}</span></td>
                <td>{m.from}</td>
                <td>{m.to}{m.qty ? <span style={{ color: "#4E576A" }}> ({m.qty} quote @ {fmtCHF2(m.price)})</span> : null}</td>
                <td className="mono" style={{ textAlign: "right" }}>{fmtCHF2(m.amount)}</td>
                <td><button className="icon-btn" onClick={() => deleteMovement(m.id)}><Trash2 size={13} /></button></td>
              </tr>
            ))}
            {movements.length === 0 && <tr><td colSpan={6}><div className="empty-state">Nessun movimento registrato ancora.</div></td></tr>}
          </tbody>
        </table>
      </div>

      {showForm && <MovementFormModal patrimonio={patrimonio} prices={prices} onClose={() => setShowForm(false)} onSave={(mv, patches) => { addMovement(mv, patches); setShowForm(false); }} />}
    </div>
  );
}

function MovementFormModal({ patrimonio, prices, onClose, onSave }) {
  const [tipo, setTipo] = useState("acquisto"); // acquisto | vendita | trasferimento
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const yearOfDate = parseInt(date.slice(0, 4), 10);
  const monthIdx = parseInt(date.slice(5, 7), 10) - 1;
  const yr = patrimonio[yearOfDate] || { assets: [] };
  const etfAssets = yr.assets.map((a, i) => ({ ...a, idx: i })).filter(a => a.group === "Investimenti");
  const cashAssets = yr.assets.map((a, i) => ({ ...a, idx: i })).filter(a => a.group !== "Investimenti");
  const allAssets = yr.assets.map((a, i) => ({ ...a, idx: i }));

  const [investIdx, setInvestIdx] = useState(etfAssets[0]?.idx ?? "");
  const [cashIdx, setCashIdx] = useState(cashAssets[0]?.idx ?? "");
  const [qty, setQty] = useState("");
  const [price, setPrice] = useState("");
  const [fromIdx, setFromIdx] = useState(allAssets[0]?.idx ?? "");
  const [toIdx, setToIdx] = useState(allAssets[1]?.idx ?? "");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");

  const importoCalcolato = qty && price ? Math.round(parseFloat(qty) * parseFloat(price) * 100) / 100 : 0;

  const submit = () => {
    if (tipo === "trasferimento") {
      if (fromIdx === "" || toIdx === "" || !amount) return;
      const fromAsset = yr.assets[fromIdx], toAsset = yr.assets[toIdx];
      const fromVal = getAssetValueAtMonth(fromAsset, monthIdx, new Date(yearOfDate, monthIdx, 1), prices, yearOfDate).value ?? 0;
      const toVal = getAssetValueAtMonth(toAsset, monthIdx, new Date(yearOfDate, monthIdx, 1), prices, yearOfDate).value ?? 0;
      const amt = parseFloat(amount);
      onSave(
        { date, tipoLabel: "Trasferimento", from: fromAsset.name, to: toAsset.name, amount: amt, note },
        [
          { year: yearOfDate, assetIdx: fromIdx, monthIdx, value: Math.round((fromVal - amt) * 100) / 100 },
          { year: yearOfDate, assetIdx: toIdx, monthIdx, value: Math.round((toVal + amt) * 100) / 100 },
        ]
      );
      return;
    }
    // acquisto o vendita di un investimento: aggiorna solo le quote possedute, il valore è quote × prezzo
    if (investIdx === "" || cashIdx === "" || !qty || !price) return;
    const investAsset = yr.assets[investIdx], cashAsset = yr.assets[cashIdx];
    const cashVal = getAssetValueAtMonth(cashAsset, monthIdx, new Date(yearOfDate, monthIdx, 1), prices, yearOfDate).value ?? 0;
    const currentUnits = investAsset.units || 0;
    const sign = tipo === "acquisto" ? 1 : -1;
    onSave(
      {
        date, tipoLabel: tipo === "acquisto" ? "Acquisto investimento" : "Vendita investimento",
        from: tipo === "acquisto" ? cashAsset.name : investAsset.name,
        to: tipo === "acquisto" ? investAsset.name : cashAsset.name,
        amount: importoCalcolato, qty: parseFloat(qty), price: parseFloat(price), note
      },
      [
        { year: yearOfDate, assetIdx: investIdx, monthIdx, value: null, extra: { units: Math.round((currentUnits + sign * parseFloat(qty)) * 10000) / 10000 } },
        { year: yearOfDate, assetIdx: cashIdx, monthIdx, value: Math.round((cashVal - sign * importoCalcolato) * 100) / 100 },
      ]
    );
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16 }}>
          <h3 style={{ margin: 0, fontSize: 16 }}>Nuovo movimento patrimoniale</h3>
          <button className="icon-btn" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="tabs-row" style={{ marginBottom: 14 }}>
          <button className={"btn" + (tipo === "acquisto" ? " primary" : "")} onClick={() => setTipo("acquisto")}>Acquisto</button>
          <button className={"btn" + (tipo === "vendita" ? " primary" : "")} onClick={() => setTipo("vendita")}>Vendita</button>
          <button className={"btn" + (tipo === "trasferimento" ? " primary" : "")} onClick={() => setTipo("trasferimento")}>Giroconto</button>
        </div>
        <div className="field"><label className="field-label">Data</label><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>

        {tipo !== "trasferimento" ? (
          <>
            <div className="field">
              <label className="field-label">Investimento ({tipo === "acquisto" ? "destinazione" : "provenienza"})</label>
              <select value={investIdx} onChange={(e) => setInvestIdx(Number(e.target.value))}>
                {etfAssets.map(a => <option key={a.idx} value={a.idx}>{a.name}</option>)}
              </select>
            </div>
            <div className="row-2">
              <div className="field"><label className="field-label">Quantità (quote)</label><input type="number" step="0.0001" value={qty} onChange={(e) => setQty(e.target.value)} /></div>
              <div className="field"><label className="field-label">Prezzo/quota</label><input type="number" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} /></div>
            </div>
            <div className="field">
              <label className="field-label">Conto {tipo === "acquisto" ? "di provenienza (cash)" : "di destinazione (cash)"}</label>
              <select value={cashIdx} onChange={(e) => setCashIdx(Number(e.target.value))}>
                {cashAssets.map(a => <option key={a.idx} value={a.idx}>{a.name}</option>)}
              </select>
            </div>
            {qty && price && <div className="pill" style={{ marginBottom: 14 }}>Importo: {fmtCHF2(importoCalcolato)} CHF</div>}
          </>
        ) : (
          <>
            <div className="row-2">
              <div className="field">
                <label className="field-label">Da</label>
                <select value={fromIdx} onChange={(e) => setFromIdx(Number(e.target.value))}>
                  {allAssets.map(a => <option key={a.idx} value={a.idx}>{a.name}</option>)}
                </select>
              </div>
              <div className="field">
                <label className="field-label">A</label>
                <select value={toIdx} onChange={(e) => setToIdx(Number(e.target.value))}>
                  {allAssets.map(a => <option key={a.idx} value={a.idx}>{a.name}</option>)}
                </select>
              </div>
            </div>
            <div className="field"><label className="field-label">Importo (CHF)</label><input type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
          </>
        )}
        <div className="field"><label className="field-label">Nota (opzionale)</label><input value={note} onChange={(e) => setNote(e.target.value)} /></div>
        <button className="btn primary" style={{ width: "100%", justifyContent: "center", marginTop: 6 }} onClick={submit}>
          <ArrowLeftRight size={14} />Registra movimento
        </button>
      </div>
    </div>
  );
}

/* ============ STRUMENTI (Ammortamento + Split the bill) ============ */
function Strumenti({ patrimonio, updateAsset, addAsset, categories, addExpenses }) {
  const [sub, setSub] = useState("ammortamento");
  return (
    <div>
      <h1 className="nav-page-title">Strumenti</h1>
      <p className="nav-page-sub">Funzioni avanzate per automatizzare i calcoli del tuo bilancio</p>
      <div className="tabs-row">
        <button className={"btn" + (sub === "ammortamento" ? " primary" : "")} onClick={() => setSub("ammortamento")}><Percent size={14} />Ammortamento</button>
        <button className={"btn" + (sub === "split" ? " primary" : "")} onClick={() => setSub("split")}><SplitSquareHorizontal size={14} />Split the bill</button>
      </div>
      {sub === "ammortamento" && <AmmortamentoTool patrimonio={patrimonio} updateAsset={updateAsset} addAsset={addAsset} />}
      {sub === "split" && <SplitBillTool categories={categories} addExpenses={addExpenses} />}
    </div>
  );
}

function AmmortamentoTool({ patrimonio, updateAsset, addAsset }) {
  const [showForm, setShowForm] = useState(false);
  const year = 2026;
  const yr = patrimonio[year] || { assets: [] };
  const amortAssets = yr.assets.map((a, i) => ({ ...a, idx: i })).filter(a => a.ammortamento?.enabled);

  return (
    <div className="grid" style={{ gridTemplateColumns: "1fr" }}>
      <div className="card">
        <div className="card-title">
          Come funziona
        </div>
        <p style={{ fontSize: 13, color: "#7C8797", lineHeight: 1.6, margin: 0 }}>
          Segna un bene (scooter, bici, materiale sportivo, elettronica…) come <strong style={{ color: "#E7EBF3" }}>ammortizzabile</strong>: indica valore d'acquisto, data e tasso annuo di svalutazione. Da quel momento il valore nel foglio Patrimonio si aggiorna automaticamente mese per mese, senza calcoli manuali.
        </p>
      </div>

      <div className="card">
        <div className="card-title">
          Beni ammortizzabili attivi
          <button className="btn primary" onClick={() => setShowForm(true)} style={{ padding: "5px 11px" }}><Plus size={13} />Nuovo bene</button>
        </div>
        {amortAssets.length === 0 ? <div className="empty-state">Nessun bene ammortizzabile configurato.</div> : (
          <table className="data-table">
            <thead><tr><th>Nome</th><th>Valore iniziale</th><th>Data acquisto</th><th>Tasso/anno</th><th style={{ textAlign: "right" }}>Valore oggi</th></tr></thead>
            <tbody>
              {amortAssets.map(a => (
                <tr key={a.idx}>
                  <td>{a.name}</td>
                  <td className="mono">{fmtCHF(a.ammortamento.acquisitionValue)}</td>
                  <td className="mono" style={{ color: "#7C8797" }}>{a.ammortamento.acquisitionDate}</td>
                  <td className="mono">{a.ammortamento.annualRate}%</td>
                  <td className="mono" style={{ textAlign: "right", fontWeight: 600, color: COLORS.amber }}>{fmtCHF(computeAmmortamentoValue(a.ammortamento))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showForm && (
        <AmmortamentoFormModal onClose={() => setShowForm(false)} onSave={(asset) => { addAsset(year, asset); setShowForm(false); }} />
      )}
    </div>
  );
}

function AmmortamentoFormModal({ onClose, onSave }) {
  const [name, setName] = useState("");
  const [group, setGroup] = useState("Mezzi di trasporto");
  const [acqValue, setAcqValue] = useState("");
  const [acqDate, setAcqDate] = useState(new Date().toISOString().slice(0, 7));
  const [rate, setRate] = useState("15");

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16 }}>
          <h3 style={{ margin: 0, fontSize: 16 }}>Nuovo bene ammortizzabile</h3>
          <button className="icon-btn" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="field"><label className="field-label">Nome</label><input value={name} onChange={(e) => setName(e.target.value)} placeholder="es. Bici da corsa" /></div>
        <div className="field">
          <label className="field-label">Gruppo</label>
          <select value={group} onChange={(e) => setGroup(e.target.value)}>
            <option>Mezzi di trasporto</option><option>Cash/liquidità</option><option>Investimenti</option>
          </select>
        </div>
        <div className="row-2">
          <div className="field"><label className="field-label">Valore d'acquisto (CHF)</label><input type="number" value={acqValue} onChange={(e) => setAcqValue(e.target.value)} /></div>
          <div className="field"><label className="field-label">Data acquisto</label><input type="month" value={acqDate} onChange={(e) => setAcqDate(e.target.value)} /></div>
        </div>
        <div className="field"><label className="field-label">Tasso di svalutazione annuo (%)</label><input type="number" value={rate} onChange={(e) => setRate(e.target.value)} /></div>
        <button className="btn primary" style={{ width: "100%", justifyContent: "center", marginTop: 6 }}
          onClick={() => {
            if (!name || !acqValue) return;
            onSave({
              name, group, currency: "F", monthly: Array(12).fill(null),
              ammortamento: { enabled: true, acquisitionValue: parseFloat(acqValue), acquisitionDate: acqDate, annualRate: parseFloat(rate) }
            });
          }}>
          Crea bene ammortizzabile
        </button>
      </div>
    </div>
  );
}

function SplitBillTool({ categories, addExpenses }) {
  const primaries = Object.keys(categories);
  const [desc, setDesc] = useState("");
  const [total, setTotal] = useState("");
  const [months, setMonths] = useState(12);
  const [startMonth, setStartMonth] = useState(new Date().toISOString().slice(0, 7));
  const [primary, setPrimary] = useState(primaries[0] || "");
  const [secondary, setSecondary] = useState((categories[primaries[0]] || [])[0] || "");
  const [preview, setPreview] = useState(null);

  const secondaries = categories[primary] || [];
  const perRata = total && months ? Math.round((parseFloat(total) / months) * 100) / 100 : 0;

  const generate = () => {
    const [sy, sm] = startMonth.split("-").map(Number);
    const rows = [];
    for (let i = 0; i < months; i++) {
      const d = new Date(sy, sm - 1 + i, 1);
      const dateStr = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-01";
      rows.push({ date: dateStr, desc: `${desc} (rata ${i + 1}/${months})`, amount: perRata, primary, secondary, note: "split the bill" });
    }
    return rows;
  };

  return (
    <div className="grid-2col">
      <div className="card">
        <div className="card-title">Suddividi una spesa su più mesi</div>
        <p style={{ fontSize: 12.5, color: "#7C8797", marginTop: -6, marginBottom: 16 }}>
          Es. l'assicurazione dello scooter: inserisci l'importo annuale e viene ripartito automaticamente su 12 rate mensili.
        </p>
        <div className="field"><label className="field-label">Descrizione</label><input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="es. RC scooter Baloise" /></div>
        <div className="row-2">
          <div className="field"><label className="field-label">Importo totale (CHF)</label><input type="number" value={total} onChange={(e) => setTotal(e.target.value)} /></div>
          <div className="field"><label className="field-label">Numero di rate (mesi)</label><input type="number" min="2" max="24" value={months} onChange={(e) => setMonths(parseInt(e.target.value || "1", 10))} /></div>
        </div>
        <div className="field"><label className="field-label">Mese di partenza</label><input type="month" value={startMonth} onChange={(e) => setStartMonth(e.target.value)} /></div>
        <div className="row-2">
          <div className="field">
            <label className="field-label">Categoria</label>
            <select value={primary} onChange={(e) => { setPrimary(e.target.value); setSecondary((categories[e.target.value] || [])[0] || ""); }}>
              {primaries.map(p => <option key={p} value={p}>{p.trim()}</option>)}
            </select>
          </div>
          <div className="field">
            <label className="field-label">Sottocategoria</label>
            <select value={secondary} onChange={(e) => setSecondary(e.target.value)}>
              {secondaries.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        </div>
        {total && months > 0 && (
          <div className="pill" style={{ marginBottom: 14 }}>≈ {fmtCHF2(perRata)} CHF / mese</div>
        )}
        <button className="btn primary" style={{ width: "100%", justifyContent: "center" }} onClick={() => setPreview(generate())}>
          <Sparkles size={14} />Genera anteprima rate
        </button>
      </div>

      <div className="card">
        <div className="card-title">Anteprima rate</div>
        {!preview ? <div className="empty-state">Compila il modulo e genera l'anteprima.</div> : (
          <>
            <table className="data-table">
              <thead><tr><th>Data</th><th>Descrizione</th><th style={{ textAlign: "right" }}>Importo</th></tr></thead>
              <tbody>
                {preview.map((r, i) => (
                  <tr key={i}><td className="mono" style={{ color: "#7C8797" }}>{r.date}</td><td>{r.desc}</td><td className="mono" style={{ textAlign: "right" }}>{fmtCHF2(r.amount)}</td></tr>
                ))}
              </tbody>
            </table>
            <button className="btn primary" style={{ width: "100%", justifyContent: "center", marginTop: 14 }}
              onClick={() => { addExpenses(preview); setPreview(null); setDesc(""); setTotal(""); }}>
              Conferma e aggiungi {preview.length} spese
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/* ============ CATEGORIE ============ */
function Categorie({ categories, setCategories }) {
  const [newPrimary, setNewPrimary] = useState("");
  const [newSecondary, setNewSecondary] = useState({});

  const addPrimary = () => {
    if (!newPrimary.trim() || categories[newPrimary]) return;
    setCategories(prev => ({ ...prev, [newPrimary]: [] }));
    setNewPrimary("");
  };
  const addSecondary = (p) => {
    const val = (newSecondary[p] || "").trim();
    if (!val) return;
    setCategories(prev => ({ ...prev, [p]: [...prev[p], val] }));
    setNewSecondary(prev => ({ ...prev, [p]: "" }));
  };
  const removeSecondary = (p, s) => setCategories(prev => ({ ...prev, [p]: prev[p].filter(x => x !== s) }));
  const removePrimary = (p) => setCategories(prev => { const c = { ...prev }; delete c[p]; return c; });

  return (
    <div>
      <h1 className="nav-page-title">Categorie</h1>
      <p className="nav-page-sub">Gestisci le categorie primarie e secondarie usate per classificare le spese</p>

      <div className="card" style={{ marginBottom: 18 }}>
        <div className="card-title">Nuova categoria primaria</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input style={{ flex: 1 }} value={newPrimary} onChange={(e) => setNewPrimary(e.target.value)} placeholder="es. Casa" />
          <button className="btn primary" onClick={addPrimary}><Plus size={14} />Aggiungi</button>
        </div>
      </div>

      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))" }}>
        {Object.entries(categories).map(([p, secs]) => (
          <div className="card" key={p}>
            <div className="card-title">
              {p.trim()}
              <button className="icon-btn" onClick={() => removePrimary(p)}><Trash2 size={13} /></button>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
              {secs.map(s => (
                <span key={s} className="pill" style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                  {s}
                  <X size={11} style={{ cursor: "pointer" }} onClick={() => removeSecondary(p, s)} />
                </span>
              ))}
              {secs.length === 0 && <span style={{ fontSize: 12, color: "#4E576A" }}>Nessuna sottocategoria</span>}
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <input style={{ flex: 1 }} placeholder="nuova sottocategoria" value={newSecondary[p] || ""} onChange={(e) => setNewSecondary(prev => ({ ...prev, [p]: e.target.value }))} />
              <button className="btn" onClick={() => addSecondary(p)}><Plus size={13} /></button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ============ PROFILO: nome utente, cambio email e password ============ */
function Profilo({ user, displayName, setDisplayName }) {
  const [name, setName] = useState(displayName || "");
  const [nameStatus, setNameStatus] = useState(null);

  const [email, setEmail] = useState("");
  const [emailStatus, setEmailStatus] = useState(null);
  const [emailLoading, setEmailLoading] = useState(false);

  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [passwordStatus, setPasswordStatus] = useState(null);
  const [passwordLoading, setPasswordLoading] = useState(false);

  const statusStyle = (status) => status && {
    display: "block", marginTop: 10, padding: "8px 10px",
    color: status.type === "error" ? "var(--coral)" : "var(--mint)",
    borderColor: status.type === "error" ? "var(--coral)" : "var(--mint)",
  };

  const saveName = () => {
    setDisplayName(name.trim());
    setNameStatus({ type: "ok", text: "Nome utente salvato." });
  };

  const changeEmail = async () => {
    if (!email.trim()) return;
    setEmailLoading(true);
    setEmailStatus(null);
    try {
      const { error } = await supabase.auth.updateUser({ email: email.trim() });
      if (error) throw error;
      setEmailStatus({ type: "ok", text: "Controlla la tua nuova casella email per confermare il cambio." });
      setEmail("");
    } catch (e) {
      setEmailStatus({ type: "error", text: e.message || "Errore durante il cambio email." });
    } finally {
      setEmailLoading(false);
    }
  };

  const changePassword = async () => {
    if (password.length < 6) {
      setPasswordStatus({ type: "error", text: "La password deve avere almeno 6 caratteri." });
      return;
    }
    if (password !== passwordConfirm) {
      setPasswordStatus({ type: "error", text: "Le due password non coincidono." });
      return;
    }
    setPasswordLoading(true);
    setPasswordStatus(null);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      setPasswordStatus({ type: "ok", text: "Password aggiornata." });
      setPassword("");
      setPasswordConfirm("");
    } catch (e) {
      setPasswordStatus({ type: "error", text: e.message || "Errore durante il cambio password." });
    } finally {
      setPasswordLoading(false);
    }
  };

  return (
    <div>
      <h1 className="nav-page-title">Profilo</h1>
      <p className="nav-page-sub">Gestisci nome utente, email e password del tuo account</p>

      <div className="card" style={{ marginBottom: 18, maxWidth: 420 }}>
        <div className="card-title">Nome utente</div>
        <div className="field">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Il tuo nome" style={{ width: "100%" }} />
        </div>
        <button className="btn primary" onClick={saveName}><Check size={14} />Salva nome</button>
        {nameStatus && <div className="pill" style={statusStyle(nameStatus)}>{nameStatus.text}</div>}
      </div>

      <div className="card" style={{ marginBottom: 18, maxWidth: 420 }}>
        <div className="card-title">Email</div>
        <p style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 12 }}>Email attuale: <strong>{user.email}</strong></p>
        <div className="field">
          <label className="field-label">Nuova email</label>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="nuova@email.com" style={{ width: "100%" }} />
        </div>
        <button className="btn primary" onClick={changeEmail} disabled={emailLoading}>
          {emailLoading ? "Attendere…" : "Cambia email"}
        </button>
        {emailStatus && <div className="pill" style={statusStyle(emailStatus)}>{emailStatus.text}</div>}
      </div>

      <div className="card" style={{ maxWidth: 420 }}>
        <div className="card-title">Password</div>
        <div className="field">
          <label className="field-label">Nuova password</label>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} style={{ width: "100%" }} />
        </div>
        <div className="field">
          <label className="field-label">Conferma nuova password</label>
          <input type="password" value={passwordConfirm} onChange={(e) => setPasswordConfirm(e.target.value)} style={{ width: "100%" }} />
        </div>
        <button className="btn primary" onClick={changePassword} disabled={passwordLoading}>
          {passwordLoading ? "Attendere…" : "Cambia password"}
        </button>
        {passwordStatus && <div className="pill" style={statusStyle(passwordStatus)}>{passwordStatus.text}</div>}
      </div>
    </div>
  );
}

/* ============ APP: gestisce la sessione Supabase e mostra il login se serve ============ */
export default function App() {
  const { session, initializing } = useAuth();

  if (initializing) {
    return (
      <div className="nav-root" style={{ alignItems: "center", justifyContent: "center" }}>
        <GlobalStyle />
        <div className="mono" style={{ color: "#7C8797" }}>caricamento sessione<span className="nav-cursor" /></div>
      </div>
    );
  }

  if (!session) {
    return <Login />;
  }

  return <FinanceApp key={session.user.id} user={session.user} />;
}
