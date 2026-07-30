import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import {
  LineChart, Line, BarChart, Bar, PieChart, Pie, Cell, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from "recharts";
import {
  LayoutDashboard, Receipt, Wallet, Wrench, Tags, Plus, Trash2, X,
  TrendingUp, TrendingDown, ChevronDown, Search, Percent, SplitSquareHorizontal,
  Sparkles, ArrowUpRight, ArrowDownRight, ArrowLeftRight, Pencil, Check, RefreshCw, Undo2, Save, LogOut, User,
  ChevronLeft, ChevronRight, Download, GripVertical
} from "lucide-react";

import { PATRIMONIO_SEED, FX_DEFAULT } from "./lib/seedData.js";
import { loadOrSeedUserData, persistUserData } from "./lib/dataStore.js";
import { useAuth } from "./lib/useAuth.js";
import { supabase } from "./lib/supabaseClient.js";
import Login from "./Login.jsx";
import { GlobalStyle } from "./GlobalStyle.jsx";

/* ============ COSTANTI ============ */
const MONTHS = ["Gen","Feb","Mar","Apr","Mag","Giu","Lug","Ago","Set","Ott","Nov","Dic"];
const YEARS = [2024, 2025, 2026, 2027];

// Categoria delle entrate (non è una spesa) e categoria dei risparmi/investimenti
// (soldi messi da parte, quindi NON spese di consumo). Entrambe sono escluse dai
// totali e dalle ripartizioni delle spese.
const INCOME_CAT = "Entrate";
const SAVINGS_CAT = "Investimenti e risp";
const isSpesa = (primary) => primary !== INCOME_CAT && primary !== SAVINGS_CAT;

// Valuta interna dell'asset (F/E/D) -> codice valuta di mercato.
const CURRENCY_OF = { F: "CHF", E: "EUR", D: "USD" };

// Titolo mostrato nell'intestazione per ogni sezione.
const TAB_TITLES = {
  dashboard: "Dashboard",
  patrimonio: "Patrimonio",
  spese: "Spese",
  strumenti: "Strumenti",
  profilo: "Profilo",
};

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
// Come fmtCHF ma senza la valuta davanti: dentro una tabella l'unità si scrive una
// volta sola nell'intestazione. Serve anche a non mentire — nelle griglie del
// Patrimonio i valori sono nella valuta dell'asset (colonna Cur), non sempre in CHF.
const fmtNum = (n) => {
  if (n === null || n === undefined || isNaN(n)) return "—";
  const sign = n < 0 ? "-" : "";
  return sign + Math.abs(n).toLocaleString("it-CH", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
};
const fmtCHF2 = (n) => {
  if (n === null || n === undefined || isNaN(n)) return "—";
  return n.toLocaleString("it-CH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};
const uid = () => crypto.randomUUID();

// Colore di una cifra nelle griglie del Patrimonio. Un saldo negativo (la carta di
// credito) si deve leggere al volo, senza cercarlo. `pieno` distingue i valori
// registrati in quel mese da quelli riportati dal mese precedente, che restano tenui.
const cellColor = (val, pieno) =>
  val === null || val === undefined ? "#3A4152"
    : val < 0 ? (pieno ? COLORS.coral : "rgba(255,107,107,0.62)")
      : pieno ? "#E7EBF3" : "#7C8797";

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

/* ============ FATTURE GIÀ PAGATE (risconti attivi) ============
   Una fattura pagata tutta in una volta ma di competenza di più mesi (es. 600 CHF
   di palestra il 20.05.2026 per 12 mesi) non è un costo di maggio: le mensilità non
   ancora consumate sono ancora patrimonio, solo sotto forma di servizio prepagato.
   Ogni fattura: { id, desc, amount, paidDate: "2026-05-20", startMonth: "2026-05", months: 12 }.
   Il residuo si ricalcola sempre da qui: non viene mai salvato fra gli asset. */
const FATTURE_ASSET = "Fatture già pagate";
const FATTURE_GROUP = "Altre attività";
const GRUPPI_BASE = ["Investimenti", "Cash/liquidità", "Mezzi di trasporto", FATTURE_GROUP];

const absMonth = (year, monthIdx) => year * 12 + monthIdx;
const parseMonth = (s) => { const [y, m] = s.split("-").map(Number); return absMonth(y, m - 1); };
const meseLabel = (abs) => MONTHS[((abs % 12) + 12) % 12] + " " + String(Math.floor(abs / 12)).slice(2);

// Mensilità già consumate alla FINE del mese indicato: il mese in corso è già
// coperto dall'abbonamento, quindi la sua quota è consumata (a fine maggio di
// 600/12 mesi partiti a maggio restano 550, non 600).
function mesiConsumati(f, year, monthIdx) {
  const passati = absMonth(year, monthIdx) - parseMonth(f.startMonth) + 1;
  return Math.max(0, Math.min(f.months, passati));
}

// Residuo di una singola fattura alla fine del mese indicato. Zero prima del
// pagamento (i soldi erano ancora sul conto) e zero a copertura finita.
function residuoFattura(f, year, monthIdx) {
  if (absMonth(year, monthIdx) < parseMonth(f.paidDate.slice(0, 7))) return 0;
  const rimasti = f.months - mesiConsumati(f, year, monthIdx);
  return Math.round((f.amount * rimasti / f.months) * 100) / 100;
}

// Totale dei residui mese per mese: è la riga che finisce nel Patrimonio.
// Nei mesi senza nulla in sospeso il valore è null (cella vuota) e non zero:
// la riga parla solo quando ha qualcosa da dire.
function residuiAnno(fatture, year) {
  return Array.from({ length: 12 }, (_, i) => {
    const tot = Math.round((fatture || []).reduce((s, f) => s + residuoFattura(f, year, i), 0) * 100) / 100;
    return tot > 0 ? tot : null;
  });
}

// Riga virtuale del Patrimonio: non è un asset salvato, si ricalcola dalle fatture.
// Se in quell'anno non c'è nulla di aperto, la riga (e il suo gruppo) non esiste.
function fattureAsset(fatture, year) {
  if (!fatture?.length) return null;
  const monthly = residuiAnno(fatture, year);
  if (!monthly.some((v) => v > 0)) return null;
  return { group: FATTURE_GROUP, name: FATTURE_ASSET, currency: "F", monthly, fatture: true };
}

// L'anno del patrimonio con, in fondo, la riga delle fatture già pagate. In fondo
// di proposito: così le posizioni degli asset veri restano quelle salvate.
function annoConFatture(yr, fatture, year) {
  const base = yr || { assets: [], netWorth: Array(12).fill(null) };
  const extra = fattureAsset(fatture, year);
  return extra ? { ...base, assets: [...base.assets, extra] } : base;
}

/* ============ TASSI DI CAMBIO ============ */
// I tassi vengono scaricati automaticamente (chiusura dell'ultimo giorno di ogni
// mese) e conservati in fxHistory: { EURCHF: { "2026-06": 0.9224 }, USDCHF: {...} }.
// Ogni mese viene quindi convertito col SUO cambio, non con quello di oggi.
// `fx` resta come ripiego se per quel mese non c'è ancora un tasso scaricato.
const FX_PAIR_OF = { E: "EURCHF", D: "USDCHF" };
const monthKey = (year, monthIdx) => `${year}-${String(monthIdx + 1).padStart(2, "0")}`;

function fxRate(currency, fx, fxHistory, year, monthIdx) {
  const pair = FX_PAIR_OF[currency];
  if (!pair) return 1; // F = CHF
  if (fxHistory && year != null && monthIdx != null) {
    const historical = fxHistory[pair]?.[monthKey(year, monthIdx)];
    if (historical != null) return historical;
  }
  return fx?.[pair] ?? 1;
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
const PRICE_YEARS = ["2024", "2025", "2026", "2027"];

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
  // Ammortamenti e fatture già pagate si calcolano da soli: non dicono nulla su
  // quanto il mese sia stato compilato, quindi restano fuori dal conteggio.
  const trackable = yr.assets.filter(a => !a.ammortamento?.enabled && !a.fatture);
  if (trackable.length === 0) return false;
  return trackable.every(a => {
    if (a.units !== undefined && a.units !== null) {
      const price = prices?.[String(year)]?.[a.name]?.monthly?.[monthIdx];
      return price !== null && price !== undefined;
    }
    return a.monthly[monthIdx] !== null && a.monthly[monthIdx] !== undefined;
  });
}

/* Serie del patrimonio netto "onesta": solo mesi realmente compilati, il resto vuoto.
   Ogni mese è convertito in CHF col cambio di quel mese (vedi fxRate). */
function getStrictNetWorthSeries(yr, fx, year, prices, fxHistory) {
  if (!yr) return Array(12).fill(null);
  return Array.from({ length: 12 }, (_, i) => {
    const refDate = new Date(year, i, 1);
    if (isMonthComplete(yr, i, prices, year)) {
      let sum = 0;
      for (const a of yr.assets) {
        const { value } = getAssetStrictValue(a, i, refDate, prices, year);
        if (value !== null) sum += value * fxRate(a.currency, fx, fxHistory, year, i);
      }
      return Math.round(sum * 100) / 100;
    }
    return yr.netWorth?.[i] ?? null;
  });
}

/* ============ SERIE CONTINUA SU PIÙ ANNI, DIVISA PER GRUPPO ============
   Dashboard e Patrimonio ragionano un anno alla volta, quindi ogni 1° gennaio la
   storia si interrompe. Qui invece i mesi davvero compilati vengono messi in fila
   dal primo anno a oggi, ognuno convertito in CHF col cambio del suo mese, e
   scomposto nei gruppi: si vede il totale (il bordo superiore) e come si è spostato. */
const ASSET_GROUPS = ["Investimenti", "Cash/liquidità", "Mezzi di trasporto", FATTURE_GROUP];
// Nomi corti per legenda e riquadro: su telefono i nomi interi dei gruppi
// occuperebbero due righe di legenda, rubando spazio al grafico.
const GROUP_SHORT = { "Investimenti": "Investimenti", "Cash/liquidità": "Liquidità", "Mezzi di trasporto": "Mezzi", [FATTURE_GROUP]: "Fatture" };
const GROUP_COLORS = { "Investimenti": COLORS.mint, "Cash/liquidità": COLORS.blue, "Mezzi di trasporto": COLORS.amber, [FATTURE_GROUP]: COLORS.violet };

function getCompositionSeries(patrimonio, fatture, fx, prices, fxHistory, soloAnno) {
  const anni = Object.keys(patrimonio || {}).map(Number).filter(y => soloAnno == null || y === soloAnno).sort((a, b) => a - b);
  const out = [];
  for (const y of anni) {
    const yr = annoConFatture(patrimonio[y], fatture, y);
    for (let i = 0; i < 12; i++) {
      if (!isMonthComplete(yr, i, prices, y)) continue;
      const punto = { mese: MONTHS[i] + " " + String(y).slice(2), totale: 0 };
      for (const g of ASSET_GROUPS) punto[g] = 0;
      for (const a of yr.assets) {
        const { value } = getAssetStrictValue(a, i, new Date(y, i, 1), prices, y);
        if (value === null) continue;
        const chf = value * fxRate(a.currency, fx, fxHistory, y, i);
        punto[ASSET_GROUPS.includes(a.group) ? a.group : "Mezzi di trasporto"] += chf;
        punto.totale += chf;
      }
      for (const g of ASSET_GROUPS) punto[g] = Math.round(punto[g] * 100) / 100;
      punto.totale = Math.round(punto.totale * 100) / 100;
      out.push(punto);
    }
  }
  return out;
}

/* ============ MESI DI AUTONOMIA ============
   Quanto puoi vivere con la liquidità che hai, se le entrate si fermassero:
   liquidità del mese diviso la spesa media degli ultimi sei mesi registrati. */
function calcolaAutonomia(yr, monthIdx, year, fx, prices, fxHistory, expenses) {
  let liquidi = 0, trovato = false;
  for (const a of yr.assets) {
    if (a.group !== "Cash/liquidità") continue;
    const { value } = getAssetStrictValue(a, monthIdx, new Date(year, monthIdx, 1), prices, year);
    if (value === null) continue;
    trovato = true;
    liquidi += value * fxRate(a.currency, fx, fxHistory, year, monthIdx);
  }
  if (!trovato) return null;
  const perMese = new Map();
  for (const e of expenses || []) {
    if (!isSpesa(e.primary)) continue;
    const k = e.date.slice(0, 7);
    perMese.set(k, (perMese.get(k) || 0) + e.amount);
  }
  const fine = monthKey(year, monthIdx);
  const ultimi = [...perMese.entries()].filter(([k]) => k <= fine).sort((a, b) => a[0].localeCompare(b[0])).slice(-6);
  if (ultimi.length < 3) return null;
  const media = ultimi.reduce((s, [, v]) => s + v, 0) / ultimi.length;
  if (media <= 0 || liquidi <= 0) return null;
  return { liquidi: Math.round(liquidi), mesi: liquidi / media };
}

/* ============ RIEPILOGO DEL MESE APPENA CHIUSO ============
   L'unica cosa in tutta l'app che si fa avanti da sola. Compare la prima volta che
   apri l'app in un mese nuovo e, una volta letta, non torna fino al mese dopo. */
function riepilogoMese(expenses, patrimonio, fatture, fx, prices, fxHistory, y, m) {
  const pref = monthKey(y, m);
  const prec = new Date(y, m - 1, 1);
  const prefPrec = monthKey(prec.getFullYear(), prec.getMonth());
  let spese = 0, entrate = 0;
  const perCat = {}, perCatPrec = {};
  for (const e of expenses || []) {
    if (e.date.startsWith(pref)) {
      if (e.primary === INCOME_CAT) entrate += e.amount;
      else if (isSpesa(e.primary)) { spese += e.amount; perCat[e.primary] = (perCat[e.primary] || 0) + e.amount; }
    } else if (e.date.startsWith(prefPrec) && isSpesa(e.primary)) {
      perCatPrec[e.primary] = (perCatPrec[e.primary] || 0) + e.amount;
    }
  }
  if (spese === 0 && entrate === 0) return null;
  const serie = (anno) => getStrictNetWorthSeries(annoConFatture(patrimonio[anno], fatture, anno), fx, anno, prices, fxHistory);
  const nw = serie(y)[m];
  const nwPrec = m > 0 ? serie(y)[m - 1] : serie(y - 1)[11];
  const salita = Object.entries(perCat)
    .map(([cat, v]) => ({ cat, delta: v - (perCatPrec[cat] || 0) }))
    .sort((a, b) => b.delta - a.delta)[0];
  return {
    spese, entrate, risparmio: entrate - spese,
    deltaNW: (nw != null && nwPrec != null) ? nw - nwPrec : null,
    salita: salita && salita.delta > 0 ? salita : null,
  };
}

function getCurrentMonthIndex(series) {
  for (let i = 11; i >= 0; i--) if (series[i] !== null && series[i] !== undefined) return i;
  return -1;
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
/* ============ PREZZI AUTOMATICI ============ */
// Trova la valuta con cui è impostato un asset (cerca nel patrimonio di ogni anno).
function currencyOfAsset(patrimonio, assetName) {
  for (const yr of Object.values(patrimonio || {})) {
    const a = (yr.assets || []).find((x) => x.name === assetName);
    if (a) return CURRENCY_OF[a.currency] || null;
  }
  return null;
}
// Simboli Yahoo dei cambi verso CHF, richiesti solo per le valute realmente
// usate dagli asset (così il totale di ogni mese usa il cambio di quel mese).
const FX_SYMBOL = { EURCHF: "EURCHF=X", USDCHF: "USDCHF=X" };
function neededFxSymbols(patrimonio) {
  const pairs = new Set();
  for (const yr of Object.values(patrimonio || {})) {
    for (const a of yr.assets || []) {
      const pair = FX_PAIR_OF[a.currency];
      if (pair) pairs.add(pair);
    }
  }
  return [...pairs].map((p) => FX_SYMBOL[p]);
}

// Costruisce il parametro per /api/prices nel formato "SIMBOLO:VALUTA" (es. "VHYL.L:CHF"),
// così il server converte i prezzi nella valuta dell'asset usando il cambio storico.
// Include anche i cambi verso CHF necessari per i totali del patrimonio.
function buildPricesQuery(tickers, patrimonio) {
  const seen = new Map(); // simbolo -> valuta desiderata
  for (const [assetName, symbol] of Object.entries(tickers || {})) {
    if (!symbol || seen.has(symbol)) continue;
    seen.set(symbol, currencyOfAsset(patrimonio, assetName));
  }
  for (const sym of neededFxSymbols(patrimonio)) {
    if (!seen.has(sym)) seen.set(sym, null); // i cambi non vanno riconvertiti
  }
  if (!seen.size) return "";
  return [...seen.entries()].map(([sym, want]) => (want ? `${sym}:${want}` : sym)).join(",");
}

// Estrae dai risultati i tassi di cambio mensili e li conserva in data.fxHistory.
// Aggiorna anche fxRates (tasso corrente) così resta un ripiego sensato.
function applyFxHistory(data, results) {
  const fxHistory = { ...(data.fxHistory || {}) };
  const fxRates = { ...data.fxRates };
  let changed = false;
  for (const [pair, symbol] of Object.entries(FX_SYMBOL)) {
    const r = results[symbol];
    if (!r || r.error || !r.monthly) continue;
    const prev = fxHistory[pair] || {};
    const next = { ...prev, ...r.monthly };
    if (JSON.stringify(next) !== JSON.stringify(prev)) { fxHistory[pair] = next; changed = true; }
    if (r.current != null && fxRates[pair] !== r.current) { fxRates[pair] = r.current; changed = true; }
  }
  return changed ? { ...data, fxHistory, fxRates } : data;
}

// Dati i risultati di /api/prices (per simbolo: { monthly: {"2026-06":165.27,...} }) e
// la mappa tickers (nomeAsset -> simbolo), riempie prices[anno][nomeAsset].monthly[].
// Ritorna lo stesso oggetto se nulla è cambiato (per non innescare salvataggi inutili).
function applyTrackedPrices(data, results) {
  const entries = Object.entries(data.tickers || {}).filter(([, sym]) => sym);
  if (!entries.length) return data;
  let changed = false;
  const prices = { ...data.prices };
  for (const [assetName, symbol] of entries) {
    const r = results[symbol];
    if (!r || r.error || !r.monthly) continue;
    for (const year of YEARS) {
      const ykey = String(year);
      const yObj = { ...(prices[ykey] || {}) };
      const existing = yObj[assetName] || { start: null, monthly: Array(12).fill(null) };
      const monthly = [...(existing.monthly || Array(12).fill(null))];
      let touched = false;
      for (let m = 0; m < 12; m++) {
        const price = r.monthly[`${year}-${String(m + 1).padStart(2, "0")}`];
        if (price != null && monthly[m] !== price) { monthly[m] = price; touched = true; }
      }
      // "start" = riferimento inizio anno (chiusura di dicembre dell'anno prima, o gennaio)
      const startVal = r.monthly[`${year - 1}-12`] ?? r.monthly[`${year}-01`];
      let start = existing.start;
      if (startVal != null && start !== startVal) { start = startVal; touched = true; }
      if (touched) {
        yObj[assetName] = { ...existing, start, monthly };
        prices[ykey] = yObj;
        changed = true;
      }
    }
  }
  return changed ? { ...data, prices } : data;
}

/* ============ COMPONENTE PRINCIPALE ============ */
const EMPTY_DATA = { expenses: [], patrimonio: {}, categories: {}, movements: [], fxRates: FX_DEFAULT, prices: {}, displayName: "", tickers: {}, fxHistory: {}, budgets: {}, fatture: [], layout: {} };
const MAX_HISTORY = 30;

function FinanceApp({ user }) {
  const [tab, setTab] = useState("dashboard");
  const [loaded, setLoaded] = useState(false);
  const [data, setData] = useState(EMPTY_DATA);
  const [past, setPast] = useState([]);
  const [saveStatus, setSaveStatus] = useState("saved"); // idle | pending | saving | saved
  const [loadError, setLoadError] = useState(null); // se valorizzato, il salvataggio resta disattivato
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
          // Il caricamento è fallito: mostriamo l'app ma NON attiviamo il
          // salvataggio (loaded resta false), altrimenti salveremmo uno stato
          // vuoto sopra ai dati veri, cancellandoli.
          setLoadError(e?.message || "Impossibile caricare i dati.");
        }
      }
    })();
    return () => { cancelled = true; };
  }, [user.id]);

  // Salvataggio automatico. Si attiva solo dopo un caricamento riuscito:
  // salvare senza aver letto i dati significherebbe sovrascriverli con nulla.
  useEffect(() => {
    if (!loaded || loadError) return;
    setSaveStatus("pending");
    const t = setTimeout(() => {
      setSaveStatus("saving");
      persistUserData(user.id, data)
        .then(() => setSaveStatus("saved"))
        .catch((e) => { console.error("Errore nel salvataggio su Supabase:", e?.message || e, e); setSaveStatus("error"); });
    }, 800);
    return () => clearTimeout(t);
  }, [data, loaded, loadError, user.id]);

  const saveNow = useCallback(() => {
    if (!loaded || loadError) return;
    setSaveStatus("saving");
    persistUserData(user.id, data)
      .then(() => setSaveStatus("saved"))
      .catch((e) => { console.error("Errore nel salvataggio su Supabase:", e?.message || e, e); setSaveStatus("error"); });
  }, [data, loaded, loadError, user.id]);

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

  const { expenses, patrimonio, categories, movements, fxRates, prices, displayName, fxHistory, fatture } = data;

  // L'ordine delle schede non passa dalla cronologia: "Annulla" deve restare per i
  // dati veri, non per un riquadro spostato di due posizioni.
  const setLayout = useCallback((patch) => {
    setData(prev => ({ ...prev, layout: { ...(prev.layout || {}), ...patch } }));
  }, []);

  const addFattura = useCallback((f) => {
    applyChange(prev => ({ ...prev, fatture: [...(prev.fatture || []), { ...f, id: uid() }] }));
  }, [applyChange]);
  const deleteFattura = useCallback((id) => {
    applyChange(prev => ({ ...prev, fatture: (prev.fatture || []).filter(f => f.id !== id) }));
  }, [applyChange]);

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
  const setDisplayName = useCallback((name) => {
    applyChange(prev => ({ ...prev, displayName: name }));
  }, [applyChange]);
  const setTickers = useCallback((updater) => {
    applyChange(prev => ({ ...prev, tickers: typeof updater === "function" ? updater(prev.tickers || {}) : updater }));
  }, [applyChange]);
  const setBudgets = useCallback((updater) => {
    applyChange(prev => ({ ...prev, budgets: typeof updater === "function" ? updater(prev.budgets || {}) : updater }));
  }, [applyChange]);

  // Scarica i prezzi degli investimenti configurati (ticker Yahoo) e riempie i
  // prezzi mensili: chiusura di fine mese per i mesi passati, prezzo corrente per
  // il mese in corso. Usato sia in automatico all'apertura sia dal pulsante manuale.
  const refreshTrackedPrices = useCallback(async () => {
    const query = buildPricesQuery(data.tickers, data.patrimonio);
    if (!query) return;
    const res = await fetch(`/api/prices?symbols=${encodeURIComponent(query)}`);
    if (!res.ok) throw new Error("Errore nel recupero dei prezzi");
    const json = await res.json();
    if (json?.results) setData(prev => applyFxHistory(applyTrackedPrices(prev, json.results), json.results));
  }, [data.tickers, data.patrimonio]);

  // Aggiornamento automatico all'apertura (fallisce in silenzio se offline o
  // se /api/prices non è disponibile, es. anteprima senza funzione server).
  useEffect(() => {
    if (!loaded) return;
    refreshTrackedPrices().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);

  // Caricamento non riuscito: meglio dirlo chiaramente che mostrare un'app
  // vuota. Il salvataggio resta disattivato, così i dati sul server non
  // vengono sovrascritti da quello che c'è (nulla) in memoria.
  if (loadError) {
    return (
      <div className="nav-root" style={{ alignItems: "center", justifyContent: "center" }}>
        <GlobalStyle />
        <div className="card" style={{ maxWidth: 380, textAlign: "center" }}>
          <div className="card-title" style={{ justifyContent: "center", color: COLORS.coral }}>Dati non caricati</div>
          <p style={{ fontSize: "var(--fs-base)", color: "#7C8797", lineHeight: 1.6, margin: "0 0 16px" }}>
            Non è stato possibile leggere i tuoi dati (probabilmente manca la connessione).
            I dati sul server sono al sicuro: il salvataggio resta sospeso finché non riesce la lettura.
          </p>
          <button className="btn primary" style={{ width: "100%", justifyContent: "center" }} onClick={() => window.location.reload()}>
            <RefreshCw size={15} />Riprova
          </button>
        </div>
      </div>
    );
  }

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
        <AppHeader title={TAB_TITLES[tab]} past={past} undo={undo} saveStatus={saveStatus} saveNow={saveNow} onLogout={() => supabase.auth.signOut()} />
        {tab === "dashboard" && <Dashboard layout={data.layout} setLayout={setLayout} expenses={expenses} patrimonio={patrimonio} year={year} setYear={setYear} fxRates={fxRates} prices={prices} categories={categories} fxHistory={fxHistory} budgets={data.budgets} fatture={fatture} />}
        {tab === "patrimonio" && <Patrimonio layout={data.layout} setLayout={setLayout} expenses={expenses} patrimonio={patrimonio} year={year} setYear={setYear} updateAsset={updateAsset} deleteAsset={deleteAsset} bulkUpdateMonth={bulkUpdateMonth} fxRates={fxRates} prices={prices} updatePrice={updatePrice} saveNow={saveNow} tickers={data.tickers} setTickers={setTickers} onRefreshPrices={refreshTrackedPrices} fxHistory={fxHistory} fatture={fatture} />}
        {tab === "spese" && <Spese expenses={expenses} categories={categories} addExpenses={addExpenses} deleteExpense={deleteExpense} />}
        {tab === "strumenti" && <Strumenti patrimonio={patrimonio} updateAsset={updateAsset} addAsset={addAsset} categories={categories} addExpenses={addExpenses} movements={movements} addMovement={addMovement} deleteMovement={deleteMovement} prices={prices} fatture={fatture} addFattura={addFattura} deleteFattura={deleteFattura} year={year} />}
        {tab === "profilo" && <Profilo user={user} displayName={displayName} setDisplayName={setDisplayName} categories={categories} setCategories={setCategories} addAsset={addAsset} data={data} budgets={data.budgets} setBudgets={setBudgets} />}
      </main>
    </div>
  );
}

/* ============ INTESTAZIONE: titolo della sezione + stato e azioni discrete ============
   Titolo e azioni stanno sulla stessa riga, così i dati veri iniziano subito sotto.
   Le azioni sono icone tenui: "Salva" compare solo se c'è qualcosa da salvare
   (c'è il salvataggio automatico) e "Annulla" solo se c'è qualcosa da annullare. */
function AppHeader({ title, past, undo, saveStatus, saveNow, onLogout }) {
  const stato = {
    idle: null,
    pending: { testo: "modifiche in sospeso", colore: COLORS.amber },
    saving: { testo: "salvataggio…", colore: COLORS.amber },
    saved: { testo: "salvato", colore: "#4E576A" },
    error: { testo: "salvataggio non riuscito", colore: COLORS.coral },
  }[saveStatus];
  const mostraSalva = saveStatus === "pending" || saveStatus === "error";

  return (
    <div className="app-header">
      <h1 className="nav-page-title" style={{ margin: 0 }}>{title}</h1>
      <div className="app-header-actions">
        {stato && <span className="mono" style={{ fontSize: "var(--fs-micro)", color: stato.colore }}>{stato.testo}</span>}
        {mostraSalva && (
          <button className="icon-btn header-action" onClick={saveNow} title="Salva adesso"><Save size={16} /></button>
        )}
        {past.length > 0 && (
          <button className="icon-btn header-action" onClick={undo} title="Annulla l'ultima modifica"><Undo2 size={16} /></button>
        )}
        <button className="icon-btn header-action" onClick={onLogout} title="Esci dall'account"><LogOut size={16} /></button>
      </div>
    </div>
  );
}

/* ============ RIORDINO DELLE SCHEDE ============
   Tieni premuto una scheda: tutto entra in "modo riordino" e le schede si ripiegano
   in barrette col loro nome, che si spostano col dito. Ripiegarle non è un vezzo —
   sul telefono la ripartizione delle spese è alta 600px su uno schermo da 812, e
   trascinarla intera significherebbe combattere con lo scorrimento della pagina.
   Si riaprono nel nuovo ordine premendo "Fine". */

// L'ordine salvato può riferirsi a schede che non esistono più (o non conoscere
// quelle nuove): tiene quelle valide e accoda le altre in fondo, senza mai perderne.
function ordinaSezioni(salvato, disponibili) {
  const noti = (salvato || []).filter((id) => disponibili.includes(id));
  return [...noti, ...disponibili.filter((id) => !noti.includes(id))];
}

const idSezione = (figlio) => String(figlio.key).replace(/^\.\$/, "");
// Mezzo secondo (come iOS) scattava troppo facilmente scorrendo la pagina: qui le
// schede sono grandi e il dito ci si appoggia spesso senza volerle spostare.
const PRESSIONE_MS = 800;

function SezioniRiordinabili({ children, titoli, ordine, onOrdine }) {
  const [riordino, setRiordino] = useState(false);
  const timer = useRef(null);
  const partenza = useRef({ x: 0, y: 0 });

  const figli = React.Children.toArray(children).filter(Boolean);
  const ids = figli.map(idSezione);
  const ord = ordinaSezioni(ordine, ids);
  const perId = Object.fromEntries(figli.map((f) => [idSezione(f), f]));

  const annulla = () => { clearTimeout(timer.current); timer.current = null; };
  const premi = (e) => {
    // Un tocco che parte da un comando è un comando, non l'inizio di un riordino.
    if (riordino || e.target.closest("button, input, select, textarea, a, td, th")) return;
    partenza.current = { x: e.clientX, y: e.clientY };
    annulla();
    timer.current = setTimeout(() => {
      setRiordino(true);
      if (navigator.vibrate) navigator.vibrate(12);
    }, PRESSIONE_MS);
  };
  const muovi = (e) => {
    if (!timer.current) return;
    if (Math.abs(e.clientX - partenza.current.x) > 10 || Math.abs(e.clientY - partenza.current.y) > 10) annulla();
  };

  if (riordino) {
    return <BarreRiordino voci={ord} titoli={titoli} onOrdine={onOrdine} onFine={() => setRiordino(false)} />;
  }

  return (
    <>
      {ord.map((id) => perId[id] && (
        <div key={id} onPointerDown={premi} onPointerMove={muovi} onPointerUp={annulla}
          onPointerCancel={annulla} onPointerLeave={annulla}>
          {perId[id]}
        </div>
      ))}
    </>
  );
}

const ALTEZZA_BARRA = 54; // 46px di barra + 8px di distacco

function BarreRiordino({ voci, titoli, onOrdine, onFine }) {
  const [ordine, setOrdine] = useState(voci);
  const [scostamento, setScostamento] = useState(null); // { id, dy }
  const presa = useRef(null);

  const giu = (e, idx) => {
    // La cattura del puntatore fa sì che il dito continui a comandare la barra
    // anche uscendo dai suoi bordi. Non è indispensabile: se non è disponibile
    // si trascina lo stesso, quindi non deve interrompere il gesto.
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* nessuna cattura */ }
    // L'ordine di lavoro sta nel riferimento, non nello stato: fra un movimento e
    // il disegno successivo possono arrivare altri movimenti, e leggere uno stato
    // non ancora aggiornato farebbe saltare gli spostamenti.
    presa.current = { y: e.clientY, da: idx, id: ordine[idx], lista: [...ordine] };
    setScostamento({ id: ordine[idx], dy: 0 });
  };

  const muovi = (e) => {
    if (!presa.current) return;
    const { lista, da } = presa.current;
    const dy = e.clientY - presa.current.y;
    const a = Math.max(0, Math.min(lista.length - 1, da + Math.round(dy / ALTEZZA_BARRA)));
    if (a !== da) {
      const next = [...lista];
      next.splice(a, 0, next.splice(da, 1)[0]);
      presa.current.lista = next;
      presa.current.y += (a - da) * ALTEZZA_BARRA;
      presa.current.da = a;
      setOrdine(next);
      setScostamento({ id: presa.current.id, dy: e.clientY - presa.current.y });
    } else {
      setScostamento({ id: presa.current.id, dy });
    }
  };

  // L'ordine si salva al rilascio, non a ogni pixel: altrimenti un solo
  // trascinamento riempirebbe la cronologia e farebbe partire decine di salvataggi.
  const su = () => {
    if (!presa.current) return;
    const finale = presa.current.lista;
    presa.current = null;
    setScostamento(null);
    onOrdine(finale);
  };

  return (
    <div>
      <div className="page-toolbar">
        <button className="btn primary" onClick={() => { onOrdine(ordine); onFine(); }}>
          <Check size={15} />Fine
        </button>
      </div>
      {ordine.map((id, i) => {
        const attiva = scostamento?.id === id;
        return (
          <div key={id} className={"riordino-barra" + (attiva ? " attiva" : "")}
            style={attiva ? { transform: `translateY(${scostamento.dy}px)`, position: "relative", zIndex: 2 } : { animationDelay: (i % 3) * 0.07 + "s" }}
            onPointerDown={(e) => giu(e, i)} onPointerMove={muovi} onPointerUp={su} onPointerCancel={su}>
            <GripVertical size={16} style={{ color: "#4E576A", flexShrink: 0 }} />
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{titoli[id] || id}</span>
          </div>
        );
      })}
    </div>
  );
}

/* ============ SIDEBAR ============ */
function Sidebar({ tab, setTab }) {
  const items = [
    { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
    { id: "patrimonio", label: "Patrimonio", icon: Wallet },
    { id: "spese", label: "Spese", icon: Receipt },
    { id: "strumenti", label: "Strumenti", icon: Wrench },
    { id: "profilo", label: "Profilo", icon: User },
  ];
  return (
    <nav className="nav-sidebar">
      <div className="nav-brand">Analisi spese<span className="nav-cursor" /></div>
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
    const aggiorna = () => setIsMobile(mq.matches);
    aggiorna(); // riallinea subito: la larghezza può essere cambiata prima di qui
    mq.addEventListener("change", aggiorna);
    // Rete di sicurezza: alcune situazioni (rotazione del telefono, barra degli
    // indirizzi che si ritrae) cambiano la larghezza senza emettere "change".
    window.addEventListener("resize", aggiorna);
    return () => {
      mq.removeEventListener("change", aggiorna);
      window.removeEventListener("resize", aggiorna);
    };
  }, [breakpoint]);
  return isMobile;
}

/* ============ HELPERS DATI ============ */
function useExpenseStats(expenses, year) {
  return useMemo(() => {
    const yExp = expenses.filter(e => e.date.startsWith(String(year)));
    const byMonth = Array(12).fill(0);
    const byMonthIncome = Array(12).fill(0);
    const byMonthSavings = Array(12).fill(0);
    const byPrimary = {};
    for (const e of yExp) {
      const m = parseInt(e.date.slice(5, 7), 10) - 1;
      if (e.primary === INCOME_CAT) {
        byMonthIncome[m] += e.amount;
      } else if (e.primary === SAVINGS_CAT) {
        // Risparmi/investimenti: soldi messi da parte, non spese di consumo.
        byMonthSavings[m] += e.amount;
      } else {
        byMonth[m] += e.amount;
        byPrimary[e.primary] = (byPrimary[e.primary] || 0) + e.amount;
      }
    }
    const totalSpese = byMonth.reduce((a, b) => a + b, 0);
    const totalEntrate = byMonthIncome.reduce((a, b) => a + b, 0);
    return { yExp, byMonth, byMonthIncome, byMonthSavings, byPrimary, totalSpese, totalEntrate };
  }, [expenses, year]);
}

/* ============ DASHBOARD ============ */
// Nomi delle schede quando si ripiegano in barrette per il riordino.
const TITOLI_DASHBOARD = {
  riquadri: "Riquadri in alto",
  ripartizione: "Ripartizione spese",
  composizione: "Composizione del patrimonio",
  grafici: "Grafici dell'anno",
};
function Dashboard({ layout, setLayout, expenses, patrimonio, year, setYear, fxRates, prices, categories, fxHistory, budgets, fatture }) {
  const stats = useExpenseStats(expenses, year);

  // Colore fisso per ogni categoria: dipende dalla sua posizione nella lista
  // delle categorie, NON dalla classifica di spesa. Così una categoria ha
  // sempre lo stesso colore, uguale nella torta e nella tabella.
  const colorFor = useMemo(() => {
    const map = {};
    Object.keys(categories || {}).forEach((cat, i) => { map[cat] = PIE_COLORS[i % PIE_COLORS.length]; });
    return (name) => map[name] ?? "#7C8797";
  }, [categories]);
  // Le fatture già pagate entrano nel patrimonio esattamente come nella scheda
  // Patrimonio, così i due numeri restano lo stesso numero.
  const netWorthSeries = useMemo(
    () => getStrictNetWorthSeries(annoConFatture(patrimonio[year], fatture, year), fxRates, year, prices, fxHistory),
    [patrimonio, fatture, year, fxRates, prices, fxHistory]
  );

  // Mese selezionato: vale per tutti i riquadri, patrimonio compreso.
  // Parte dal mese di oggi (o dicembre per gli anni passati).
  const nowMonth = new Date().getMonth();
  const defaultMonth = year === new Date().getFullYear() ? nowMonth : 11;
  const [selMonth, setSelMonth] = useState(defaultMonth);
  useEffect(() => { setSelMonth(year === new Date().getFullYear() ? new Date().getMonth() : 11); }, [year]);

  // Patrimonio netto DEL MESE SELEZIONATO: lo stesso numero che compare nella
  // riga in fondo alla scheda Patrimonio. Vuoto se quel mese non è compilato.
  const nwNow = netWorthSeries[selMonth] ?? null;
  const prevMonthNW = selMonth > 0 ? netWorthSeries[selMonth - 1] ?? null : null;
  const nwDelta = prevMonthNW !== null && nwNow !== null ? nwNow - prevMonthNW : null;
  const nwDeltaPct = prevMonthNW ? (nwDelta / prevMonthNW) * 100 : null;

  const speseMese = stats.byMonth[selMonth];
  const entrateMese = stats.byMonthIncome[selMonth];
  const saldoMese = entrateMese - speseMese;

  const speseSeries = MONTHS.map((m, i) => ({ mese: m, spese: stats.byMonth[i], entrate: stats.byMonthIncome[i] }));
  const pieData = Object.entries(stats.byPrimary).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ name: k.trim(), key: k, value: Math.round(v * 100) / 100 }));

  // Somma dei budget mensili impostati (0 se non ne hai impostato nessuno:
  // in quel caso nell'interfaccia non compare alcun riferimento ai budget).
  const budgetTotale = useMemo(
    () => Object.entries(budgets || {}).reduce((s, [cat, v]) => s + (isSpesa(cat) && v > 0 ? v : 0), 0),
    [budgets]
  );
  // Categorie che hanno un budget: servono per confrontare mele con mele
  // (il totale del mese include anche categorie senza budget).
  const catConBudget = useMemo(
    () => new Set(Object.entries(budgets || {}).filter(([c, v]) => isSpesa(c) && v > 0).map(([c]) => c)),
    [budgets]
  );

  // Ripartizione delle spese per categoria del mese selezionato, con numero
  // di spese, media per spesa e confronto col mese precedente.
  const monthBreakdown = useMemo(() => {
    const cur = {};   // categoria -> { amount, count }
    const prev = {};  // categoria -> amount (mese precedente)
    for (const e of stats.yExp) {
      if (!isSpesa(e.primary)) continue;
      const m = parseInt(e.date.slice(5, 7), 10) - 1;
      if (m === selMonth) {
        cur[e.primary] = cur[e.primary] || { amount: 0, count: 0 };
        cur[e.primary].amount += e.amount;
        cur[e.primary].count += 1;
      } else if (m === selMonth - 1) {
        prev[e.primary] = (prev[e.primary] || 0) + e.amount;
      }
    }
    const rows = Object.entries(cur)
      .map(([cat, { amount, count }]) => ({
        cat, amount, count,
        avg: count ? amount / count : 0,
        delta: amount - (prev[cat] || 0),
      }))
      .sort((a, b) => b.amount - a.amount);
    const total = rows.reduce((s, r) => s + r.amount, 0);
    return { rows, total };
  }, [stats.yExp, selMonth]);

  // Stesso mese, un anno fa: il confronto che conta per le spese stagionali.
  // Sta solo sul totale — su ogni categoria sarebbero due frecce per riga.
  const totaleAnnoPrima = useMemo(() => {
    const pref = monthKey(year - 1, selMonth);
    return expenses.reduce((s, e) => s + (e.date.startsWith(pref) && isSpesa(e.primary) ? e.amount : 0), 0);
  }, [expenses, year, selMonth]);

  // Composizione del patrimonio: di default tutta la storia, con la possibilità di
  // restringersi all'anno scelto. Il bordo superiore dell'area è il patrimonio netto.
  const [soloAnno, setSoloAnno] = useState(false);
  const composizione = useMemo(
    () => getCompositionSeries(patrimonio, fatture, fxRates, prices, fxHistory, soloAnno ? year : null),
    [patrimonio, fatture, fxRates, prices, fxHistory, soloAnno, year]
  );
  const gruppiPresenti = useMemo(
    () => ASSET_GROUPS.filter(g => composizione.some(p => p[g] > 0)),
    [composizione]
  );

  // Riepilogo del mese appena chiuso: una volta letto non torna fino al mese dopo.
  // Il "già letto" sta nel browser, non fra i dati: è una preferenza, non un dato.
  const mesePrec = new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1);
  const chiaveRiepilogo = "riepilogo-" + monthKey(mesePrec.getFullYear(), mesePrec.getMonth());
  const [riepilogoLetto, setRiepilogoLetto] = useState(() => {
    try { return localStorage.getItem(chiaveRiepilogo) === "1"; } catch { return true; }
  });
  const riepilogo = useMemo(
    () => riepilogoLetto ? null : riepilogoMese(expenses, patrimonio, fatture, fxRates, prices, fxHistory, mesePrec.getFullYear(), mesePrec.getMonth()),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [riepilogoLetto, expenses, patrimonio, fatture, fxRates, prices, fxHistory]
  );
  const chiudiRiepilogo = () => {
    try { localStorage.setItem(chiaveRiepilogo, "1"); } catch { /* navigazione privata: pazienza */ }
    setRiepilogoLetto(true);
  };

  return (
    <div>
      {riepilogo && (
        <div className="card" style={{ marginBottom: 16, borderColor: "rgba(74,222,156,0.35)" }}>
          <div className="card-title">
            {MONTHS[mesePrec.getMonth()]} {mesePrec.getFullYear()} è chiuso
            <button className="icon-btn" onClick={chiudiRiepilogo} title="Ho letto"><X size={16} /></button>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "14px 28px", alignItems: "baseline" }}>
            <span>Speso <strong className="mono" style={{ color: COLORS.coral }}>{fmtCHF(riepilogo.spese)}</strong></span>
            <span>Entrate <strong className="mono" style={{ color: COLORS.mint }}>{fmtCHF(riepilogo.entrate)}</strong></span>
            <span>Risparmiato <strong className="mono" style={{ color: riepilogo.risparmio >= 0 ? COLORS.mint : COLORS.coral }}>{fmtCHF(riepilogo.risparmio)}</strong></span>
            {riepilogo.deltaNW !== null && (
              <span>Patrimonio <strong className="mono" style={{ color: riepilogo.deltaNW >= 0 ? COLORS.mint : COLORS.coral }}>
                {riepilogo.deltaNW >= 0 ? "+" : "−"}{fmtCHF(Math.abs(riepilogo.deltaNW))}</strong></span>
            )}
          </div>
          {riepilogo.salita && (
            <div style={{ fontSize: "var(--fs-sm)", color: "#7C8797", marginTop: 12 }}>
              È cresciuto soprattutto <strong style={{ color: "var(--text-primary)" }}>{riepilogo.salita.cat.trim()}</strong>, {fmtCHF(riepilogo.salita.delta)} in più del mese prima.
            </div>
          )}
        </div>
      )}

      {/* Unica riga di controlli: mese (quello che cambi spesso) e anno. */}
      <div className="page-toolbar">
        <MonthStepper month={selMonth} setMonth={setSelMonth} year={year} />
        <YearSelect year={year} setYear={setYear} />
      </div>

      <SezioniRiordinabili titoli={TITOLI_DASHBOARD} ordine={layout?.dashboard} onOrdine={(o) => setLayout({ dashboard: o })}>

      <div key="riquadri" className="ticker">
        <div className="ticker-cell">
          <div className="ticker-label">Patrimonio netto ({MONTHS[selMonth]})</div>
          <div className="ticker-value mono">{fmtCHF(nwNow)}</div>
          {nwDelta !== null ? (
            <div className="ticker-delta" style={{ color: nwDelta >= 0 ? COLORS.mint : COLORS.coral }}>
              {nwDelta >= 0 ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}
              {fmtCHF(Math.abs(nwDelta))} ({nwDeltaPct?.toFixed(1)}%) vs {MONTHS[selMonth - 1]}
            </div>
          ) : nwNow === null ? (
            <div className="ticker-delta" style={{ color: "#4E576A" }}>mese non ancora compilato</div>
          ) : null}
        </div>
        <div className="ticker-cell">
          <div className="ticker-label">Entrate ({MONTHS[selMonth]})</div>
          <div className="ticker-value mono" style={{ color: COLORS.mint }}>{fmtCHF(entrateMese)}</div>
        </div>
        <div className="ticker-cell">
          <div className="ticker-label">Spese ({MONTHS[selMonth]})</div>
          <div className="ticker-value mono" style={{ color: COLORS.coral }}>{fmtCHF(speseMese)}</div>
        </div>
        <div className="ticker-cell">
          <div className="ticker-label">Risparmio ({MONTHS[selMonth]})</div>
          <div className="ticker-value mono" style={{ color: saldoMese >= 0 ? COLORS.mint : COLORS.coral }}>{fmtCHF(saldoMese)}</div>
          <div className="ticker-delta" style={{ color: "#4E576A" }}>entrate − spese del mese</div>
        </div>
      </div>

      <div key="ripartizione" className="card" style={{ marginBottom: 16 }}>
        <div className="card-title" style={{ alignItems: "center" }}>
          <span>Ripartizione spese — {MONTHS[selMonth]} {year}</span>
          <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <button className="icon-btn" onClick={() => setSelMonth(m => Math.max(0, m - 1))} disabled={selMonth === 0}
              style={selMonth === 0 ? { opacity: 0.3, cursor: "default" } : {}} title="Mese precedente"><ChevronLeft size={16} /></button>
            <span className="mono" style={{ fontSize: "var(--fs-sm)", minWidth: 58, textAlign: "center", color: "var(--text-primary)" }}>{MONTHS[selMonth]} {year}</span>
            <button className="icon-btn" onClick={() => setSelMonth(m => Math.min(11, m + 1))} disabled={selMonth === 11}
              style={selMonth === 11 ? { opacity: 0.3, cursor: "default" } : {}} title="Mese successivo"><ChevronRight size={16} /></button>
          </span>
        </div>
        {monthBreakdown.rows.length === 0 ? (
          <div className="empty-state">Nessuna spesa registrata in {MONTHS[selMonth]} {year}</div>
        ) : (
          <div>
            {monthBreakdown.rows.map((r) => {
              const pct = monthBreakdown.total ? (r.amount / monthBreakdown.total) * 100 : 0;
              const col = colorFor(r.cat);
              return (
                <div key={r.cat} style={{ padding: "12px 2px", borderBottom: "1px solid rgba(42,49,64,0.5)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, marginBottom: 7 }}>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 8, fontWeight: 600 }}>
                      <span style={{ width: 10, height: 10, borderRadius: 3, background: col, flexShrink: 0 }} />
                      {r.cat.trim()}
                    </span>
                    <span className="mono" style={{ fontWeight: 700, fontSize: "var(--fs-md)", whiteSpace: "nowrap" }}>{fmtCHF(r.amount)}</span>
                  </div>
                  <div style={{ height: 6, borderRadius: 4, background: "var(--bg-raised)", overflow: "hidden", marginBottom: 6 }}>
                    <div style={{ width: pct + "%", height: "100%", background: col }} />
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: "var(--fs-micro)", color: "#7C8797", flexWrap: "wrap" }}>
                    <span>
                      {Math.round(pct)}% del mese · {r.count} {r.count === 1 ? "spesa" : "spese"} · media {fmtCHF(r.avg)}
                      {/* Budget: compare solo se impostato per questa categoria. Tono neutro
                          sotto al limite, ambra tenue se superato — nessun allarme invadente. */}
                      {budgets?.[r.cat] > 0 && (
                        <span style={{ color: r.amount > budgets[r.cat] ? COLORS.amber : "#7C8797" }}>
                          {" · "}{Math.round((r.amount / budgets[r.cat]) * 100)}% di {fmtCHF(budgets[r.cat])}
                        </span>
                      )}
                    </span>
                    {selMonth > 0 && (
                      <span className="mono" style={{ whiteSpace: "nowrap", color: r.delta > 0 ? COLORS.coral : r.delta < 0 ? COLORS.mint : "#4E576A" }}>
                        {r.delta > 0 ? "▲" : r.delta < 0 ? "▼" : "="} {fmtCHF(Math.abs(r.delta))} vs {MONTHS[selMonth - 1]}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "12px 2px 2px", fontWeight: 700 }}>
              <span>
                Totale spese {MONTHS[selMonth]}
                {budgetTotale > 0 && (() => {
                  // Confronto solo le spese delle categorie che hanno un budget,
                  // altrimenti paragonerei il totale del mese a un budget parziale.
                  const spesoConBudget = monthBreakdown.rows
                    .filter(r => catConBudget.has(r.cat))
                    .reduce((s, r) => s + r.amount, 0);
                  return (
                    <span style={{ fontWeight: 400, fontSize: "var(--fs-micro)", color: spesoConBudget > budgetTotale ? COLORS.amber : "#4E576A" }}>
                      {" "}· budget {fmtCHF(spesoConBudget)}/{fmtCHF(budgetTotale)}
                    </span>
                  );
                })()}
                {/* Le spese sono stagionali: il confronto che conta è lo stesso
                    mese dell'anno prima, non quello appena passato. */}
                {totaleAnnoPrima > 0 && monthBreakdown.total > 0 && (() => {
                  const pct = Math.round((monthBreakdown.total / totaleAnnoPrima - 1) * 100);
                  return (
                    <span style={{ fontWeight: 400, fontSize: "var(--fs-micro)", color: pct > 0 ? COLORS.coral : pct < 0 ? COLORS.mint : "#4E576A" }}>
                      {" "}· {pct > 0 ? "+" : ""}{pct}% su {MONTHS[selMonth]} {String(year - 1).slice(2)}
                    </span>
                  );
                })()}
              </span>
              <span className="mono" style={{ fontSize: "var(--fs-lg)" }}>{fmtCHF(monthBreakdown.total)}</span>
            </div>
          </div>
        )}
      </div>

      {/* Il bordo superiore dell'area è il patrimonio netto; le bande dicono da
          cosa è composto. Di default tutta la storia, senza il muro del capodanno. */}
      <div key="composizione" className="card" style={{ marginBottom: 16 }}>
        <div className="card-title">
          <span>Composizione del patrimonio {soloAnno ? year : "— dal " + (Object.keys(patrimonio).sort()[0] || year)}</span>
          <button className="btn" style={{ padding: "5px 11px" }} onClick={() => setSoloAnno(s => !s)}>
            {soloAnno ? "Tutta la storia" : "Solo " + year}
          </button>
        </div>
        {composizione.length === 0 ? <div className="empty-state">Nessun mese ancora compilato.</div> : (
          <ResponsiveContainer width="100%" height={280}>
            <AreaChart data={composizione}>
              <CartesianGrid stroke="#2A3140" vertical={false} />
              <XAxis dataKey="mese" stroke="#7C8797" fontSize={11} interval="preserveStartEnd" minTickGap={28} />
              <YAxis stroke="#7C8797" fontSize={11} tickFormatter={(v) => (v / 1000) + "k"} />
              <Tooltip content={<TipComposizione />} />
              <Legend wrapperStyle={{ fontSize: "var(--fs-sm)" }} />
              {gruppiPresenti.map(g => (
                <Area key={g} type="monotone" dataKey={g} stackId="1" name={GROUP_SHORT[g] || g}
                  stroke={GROUP_COLORS[g]} fill={GROUP_COLORS[g]} fillOpacity={0.30} strokeWidth={1.5} />
              ))}
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>

      <div key="grafici" className="grid-2col-wide">
        <div className="card">
          <div className="card-title">Entrate vs spese mensili {year}</div>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={speseSeries}>
              <CartesianGrid stroke="#2A3140" vertical={false} />
              <XAxis dataKey="mese" stroke="#7C8797" fontSize={11} />
              <YAxis stroke="#7C8797" fontSize={11} />
              <Tooltip contentStyle={{ background: "#1E2530", border: "1px solid #2A3140", borderRadius: 8, fontSize: "var(--fs-sm)" }} formatter={(v) => fmtCHF(v)} />
              <Legend wrapperStyle={{ fontSize: "var(--fs-sm)" }} />
              <Bar dataKey="entrate" fill={COLORS.mint} radius={[4, 4, 0, 0]} name="Entrate" />
              <Bar dataKey="spese" fill={COLORS.coral} radius={[4, 4, 0, 0]} name="Spese" />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="card">
          <div className="card-title">Spese per categoria {year}</div>
          {pieData.length === 0 ? <div className="empty-state">Nessuna spesa registrata</div> : (
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie data={pieData} dataKey="value" nameKey="name" innerRadius={50} outerRadius={85} paddingAngle={2}>
                  {pieData.map((d) => <Cell key={d.key} fill={colorFor(d.key)} />)}
                </Pie>
                <Tooltip contentStyle={{ background: "#1E2530", border: "1px solid #2A3140", borderRadius: 8, fontSize: "var(--fs-sm)" }} formatter={(v) => fmtCHF(v)} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      </SezioniRiordinabili>
    </div>
  );
}

/* Il riquadro che appare passando sul grafico: le bande dal basso in alto, poi il totale. */
function TipComposizione({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const totale = payload.reduce((s, p) => s + (p.value || 0), 0);
  return (
    <div style={{ background: "#1E2530", border: "1px solid #2A3140", borderRadius: 8, padding: "9px 11px", fontSize: "var(--fs-sm)" }}>
      <div style={{ fontWeight: 700, marginBottom: 6 }}>{label}</div>
      {payload.slice().reverse().map(p => (
        <div key={p.dataKey} style={{ display: "flex", justifyContent: "space-between", gap: 16, color: p.color }}>
          <span>{p.name}</span><span className="mono">{fmtCHF(p.value)}</span>
        </div>
      ))}
      <div style={{ display: "flex", justifyContent: "space-between", gap: 16, marginTop: 6, paddingTop: 6, borderTop: "1px solid #2A3140", fontWeight: 700 }}>
        <span>Patrimonio netto</span><span className="mono">{fmtCHF(totale)}</span>
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

/* Selettore del mese: frecce ‹ › con il mese al centro. Su telefono occupa tutta
   la larghezza disponibile, su schermo grande resta compatto.
   Se riceve anche setYear, a fine anno prosegue sull'anno accanto (Gen ‹ Dic
   dell'anno prima): così si naviga il tempo con un solo controllo. */
function MonthStepper({ month, setMonth, year, setYear }) {
  const primoAnno = YEARS[0], ultimoAnno = YEARS[YEARS.length - 1];
  const puoIndietro = month > 0 || (setYear && year > primoAnno);
  const puoAvanti = month < 11 || (setYear && year < ultimoAnno);

  const indietro = () => {
    if (month > 0) setMonth(m => m - 1);
    else if (setYear && year > primoAnno) { setYear(year - 1); setMonth(11); }
  };
  const avanti = () => {
    if (month < 11) setMonth(m => m + 1);
    else if (setYear && year < ultimoAnno) { setYear(year + 1); setMonth(0); }
  };

  return (
    <div className="month-stepper">
      <button className="btn" onClick={indietro} disabled={!puoIndietro}
        style={!puoIndietro ? { opacity: 0.4, cursor: "default" } : {}} title="Mese precedente">
        <ChevronLeft size={16} />
      </button>
      <span className="mono month-stepper-label">{MONTHS[month]} {year}</span>
      <button className="btn" onClick={avanti} disabled={!puoAvanti}
        style={!puoAvanti ? { opacity: 0.4, cursor: "default" } : {}} title="Mese successivo">
        <ChevronRight size={16} />
      </button>
    </div>
  );
}

/* ============ SPESE ============ */
function Spese({ expenses, categories, addExpenses, deleteExpense }) {
  const [view, setView] = useState("nuova"); // nuova | storico
  const [filterYear, setFilterYear] = useState("Tutti");
  const [filterCat, setFilterCat] = useState("Tutte");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const PER_PAGE = 40;

  const filtered = useMemo(() => {
    return expenses
      .filter(e => filterYear === "Tutti" || e.date.startsWith(String(filterYear)))
      .filter(e => filterCat === "Tutte" || e.primary === filterCat)
      .filter(e => !search || e.desc.toLowerCase().includes(search.toLowerCase()))
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [expenses, filterYear, filterCat, search]);

  const totale = filtered.reduce((s, e) => s + (isSpesa(e.primary) ? e.amount : 0), 0);
  const pageData = filtered.slice(0, page * PER_PAGE);

  if (view === "nuova") {
    return <NuovaSpesaForm categories={categories} onClose={() => setView("storico")} onSave={(exp) => addExpenses([exp])} />;
  }

  return (
    <div>
      <div className="page-toolbar">
        <button className="btn primary" onClick={() => setView("nuova")}><Plus size={15} />Aggiungi spesa</button>
        <span style={{ fontSize: "var(--fs-sm)", color: "#7C8797" }}>
          {filtered.length} voci · <strong style={{ color: "var(--text-primary)" }}>{fmtCHF(totale)}</strong> di spese
        </span>
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
                  <td className="mono" style={{ textAlign: "right", color: e.primary === INCOME_CAT ? COLORS.mint : e.primary === SAVINGS_CAT ? COLORS.blue : "#E7EBF3" }} title={e.primary === SAVINGS_CAT ? "Risparmio/investimento — non conteggiato tra le spese" : undefined}>{e.primary === INCOME_CAT ? "+" : ""}{fmtCHF2(e.amount)}</td>
                  <td style={{ width: 30 }}><button className="icon-btn danger" onClick={() => deleteExpense(e.id)}><Trash2 size={14} /></button></td>
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
    </div>
  );
}

/* ============ NUOVA SPESA: vista di ingresso di default della tab Spese ============ */
function NuovaSpesaForm({ categories, onClose, onSave }) {
  const primaries = Object.keys(categories);
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [desc, setDesc] = useState("");
  const [amount, setAmount] = useState("");
  const [primary, setPrimary] = useState(primaries[0] || "");
  const [secondary, setSecondary] = useState((categories[primaries[0]] || [])[0] || "");
  const [note, setNote] = useState("");
  const [justSaved, setJustSaved] = useState(false);
  const secondaries = categories[primary] || [];

  const save = () => {
    if (!desc || !amount) return;
    onSave({ date, desc, amount: parseFloat(amount), primary, secondary, note });
    setDesc(""); setAmount(""); setNote("");
    setJustSaved(true);
    setTimeout(() => setJustSaved(false), 2000);
  };

  return (
    <div>
      <div className="card" style={{ maxWidth: 420 }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16 }}>
          <h1 className="nav-page-title" style={{ margin: 0 }}>Nuova spesa</h1>
          <button className="icon-btn" onClick={onClose} title="Vai allo storico spese"><X size={18} /></button>
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
        <button className="btn primary" style={{ width: "100%", justifyContent: "center", marginTop: 6 }} onClick={save}>
          <Plus size={14} />Salva spesa
        </button>
        {justSaved && <div className="pill" style={{ display: "block", textAlign: "center", marginTop: 10, color: "var(--mint)", borderColor: "var(--mint)" }}>✓ Spesa salvata</div>}
      </div>
    </div>
  );
}

/* ============ PATRIMONIO ============ */
function Patrimonio({ layout, setLayout, expenses, patrimonio, year, setYear, updateAsset, deleteAsset, bulkUpdateMonth, fxRates, prices, updatePrice, saveNow, tickers, setTickers, onRefreshPrices, fxHistory, fatture }) {
  const [showUpdateMonth, setShowUpdateMonth] = useState(false);
  const [editing, setEditing] = useState(null); // { assetIdx, monthIdx }
  const [expanded, setExpanded] = useState(null); // { assetIdx, monthIdx } — cella investimento con dettaglio quote×prezzo aperto
  const isMobile = useIsMobile();
  const [mobileTab, setMobileTab] = useState("corrente"); // corrente | storico
  const [confirmStatus, setConfirmStatus] = useState(null);
  // `yrReale` sono gli asset salvati; `yr` è la stessa cosa più la riga calcolata
  // delle fatture già pagate, aggiunta in fondo (le posizioni salvate non cambiano).
  const yrReale = patrimonio[year] || { assets: [], netWorth: Array(12).fill(null) };
  const yr = useMemo(() => annoConFatture(patrimonio[year], fatture, year), [patrimonio, fatture, year]);
  const groups = useMemo(() => ordinaSezioni(layout?.patrimonio, GRUPPI_BASE), [layout]);
  const netWorthSeries = useMemo(() => getStrictNetWorthSeries(yr, fxRates, year, prices, fxHistory), [yr, fxRates, year, prices, fxHistory]);
  const currentMonthIdx = useMemo(() => getCurrentMonthIndex(netWorthSeries), [netWorthSeries]);
  const now = new Date();
  const defaultMonthIdx = currentMonthIdx >= 0 ? Math.min(currentMonthIdx + 1, 11) : (year === now.getFullYear() ? now.getMonth() : 0);
  const showStorico = !isMobile || mobileTab === "storico";

  // Mese mostrato nella vista mobile "Mese corrente": scegliibile con le frecce ‹ ›.
  // Parte dal mese di calendario odierno (o dicembre per gli anni passati).
  const meseDiDefault = (y) => {
    const d = new Date();
    return y === d.getFullYear() ? d.getMonth() : 11;
  };
  const [meseCorrenteIdx, setMeseCorrenteIdx] = useState(() => meseDiDefault(year));
  // Cambiando anno dal selettore si riparte da un mese sensato. Non uso un effetto
  // su `year` perché le frecce ‹ › cambiano anch'esse l'anno (attraversandolo) e
  // impostano già il mese giusto: un effetto lo sovrascriverebbe.
  const cambiaAnno = (y) => { setYear(y); setMeseCorrenteIdx(meseDiDefault(y)); };

  // Mesi di autonomia: sta nell'intestazione del gruppo Cash/liquidità, dove i
  // soldi liquidi sono già elencati. Nessun riquadro nuovo.
  const autonomiaDi = useCallback(
    (m) => (m >= 0 ? calcolaAutonomia(yr, m, year, fxRates, prices, fxHistory, expenses) : null),
    [yr, year, fxRates, prices, fxHistory, expenses]
  );
  const autonomiaStorico = autonomiaDi(currentMonthIdx);

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
      {/* Prima si sceglie la vista, poi il contesto temporale e l'azione:
          una sola riga di controlli, nello stesso stile della Dashboard. */}
      {isMobile && (
        <div className="month-tabs">
          <button className={"btn" + (mobileTab === "corrente" ? " primary" : "")} onClick={() => setMobileTab("corrente")}>Mese corrente</button>
          <button className={"btn" + (mobileTab === "storico" ? " primary" : "")} onClick={() => setMobileTab("storico")}>Storico 12 mesi</button>
        </div>
      )}

      {/* Nella vista "mese corrente" il mese mostra già l'anno e le frecce
          attraversano gli anni: il selettore anno separato sarebbe ridondante. */}
      <div className="page-toolbar">
        {showStorico
          ? <YearSelect year={year} setYear={cambiaAnno} />
          : <MonthStepper month={meseCorrenteIdx} setMonth={setMeseCorrenteIdx} year={year} setYear={setYear} />}
        {/* Nella vista "mese corrente" ogni voce si tocca direttamente e c'è già
            "Conferma dati": la compilazione in blocco servirebbe a poco. */}
        {showStorico && (
          <button className="btn" onClick={() => setShowUpdateMonth(true)}>
            <RefreshCw size={14} />Aggiorna {MONTHS[defaultMonthIdx]}
          </button>
        )}
      </div>

      {isMobile && mobileTab === "corrente" && (<>
        <MeseCorrente
          yr={yr} year={year} monthIdx={meseCorrenteIdx} groups={groups}
          updateAsset={updateAsset} prices={prices} updatePrice={updatePrice}
          netWorthValue={netWorthSeries[meseCorrenteIdx]}
          onConfirm={confirmMonth} confirmStatus={confirmStatus}
          fxRates={fxRates} fxHistory={fxHistory} autonomia={autonomiaDi(meseCorrenteIdx)}
          ordineGruppi={layout?.patrimonio} onOrdineGruppi={(o) => setLayout({ patrimonio: o })}
        />
      </>)}

      {showStorico && (<>

      <SezioniRiordinabili titoli={{}} ordine={layout?.patrimonio} onOrdine={(o) => setLayout({ patrimonio: o })}>
      {groups.map(g => {
        const items = yr.assets.map((a, i) => ({ ...a, idx: i })).filter(a => a.group === g);
        if (items.length === 0) return null;
        const isInvestGroup = g === "Investimenti";
        const selectedAsset = expanded && isInvestGroup ? items.find(a => a.idx === expanded.assetIdx) : null;
        return (
          <div className="card" key={g} style={{ marginBottom: 16, overflowX: "auto" }}>
            <GroupTitle gruppo={g} autonomia={autonomiaStorico} />
            <table className="data-table">
              <thead>
                <tr>
                  <th>Asset</th><th>Cur</th>
                  {MONTHS.map((m, i) => (
                    <th key={m} style={{ textAlign: "right", ...colStyle(i) }}>
                      {m}{i === currentMonthIdx && <div style={{ fontSize: "var(--fs-micro)", color: COLORS.mint, fontWeight: 700, letterSpacing: 0.4 }}>ORA</div>}
                    </th>
                  ))}
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {items.map(a => {
                  const isAmort = a.ammortamento?.enabled;
                  const isPriceLinked = a.units !== undefined && a.units !== null;
                  const isFatture = a.fatture === true;
                  const isComputed = isAmort || isPriceLinked || isFatture;
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
                              style={{ textAlign: "right", cursor: "pointer", color: cellColor(val, true), ...(isSelected ? { background: "rgba(91,141,239,0.16)", boxShadow: "inset 0 0 0 1px rgba(91,141,239,0.5)" } : colStyle(i)) }}
                              title="Clicca per vedere quote × prezzo di questo mese">
                              {val === null ? "·" : fmtNum(val)}
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
                            style={{ textAlign: "right", cursor: isComputed ? "default" : "pointer", color: cellColor(val, explicit || isComputed), ...colStyle(i) }}
                            title={isAmort ? "Calcolato automaticamente dall'ammortamento" : isFatture ? "Parte delle fatture pagate non ancora consumata — si aggiorna da sé" : explicit ? "Valore registrato" : "Non ancora compilato — clicca per inserirlo"}>
                            {val === null ? "·" : fmtNum(val)}
                          </td>
                        );
                      })}
                      {/* La riga delle fatture non è un asset salvato: si toglie
                          cancellando la fattura da Strumenti, non da qui. */}
                      <td>{!isFatture && <button className="icon-btn danger" onClick={() => deleteAsset(year, a.idx)}><Trash2 size={13} /></button>}</td>
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
      </SezioniRiordinabili>

      {(() => {
        const investAssets = yr.assets.map((a, i) => ({ ...a, idx: i })).filter(a => a.group === "Investimenti");
        if (investAssets.length === 0) return null;
        return (
          <div className="card" style={{ marginBottom: 16, overflowX: "auto" }}>
            <InvestmentPanel assets={investAssets} year={year} prices={prices} updatePrice={updatePrice} colStyle={colStyle} currentMonthIdx={currentMonthIdx} tickers={tickers} setTickers={setTickers} onRefreshPrices={onRefreshPrices} fxRates={fxRates} fxHistory={fxHistory} />
          </div>
        );
      })()}

      <div className="card">
        <div className="card-title" title="Somma di tutte le voci qui sopra, convertite in CHF col cambio di ogni mese">Patrimonio netto (CHF) — {year}</div>
        <table className="data-table">
          <thead><tr>{MONTHS.map((m, i) => <th key={m} style={{ textAlign: "right", ...colStyle(i) }}>{m}</th>)}</tr></thead>
          <tbody><tr>{netWorthSeries.map((v, i) => <td key={i} className="mono" style={{ textAlign: "right", fontWeight: 600, ...colStyle(i) }}>{v === null ? "·" : fmtNum(v)}</td>)}</tr></tbody>
        </table>
      </div>
      </>)}

      {showUpdateMonth && (
        <UpdateMonthModal yr={yrReale} year={year} monthIdx={defaultMonthIdx} onClose={() => setShowUpdateMonth(false)}
          onSave={(valuesByIdx) => { bulkUpdateMonth(year, defaultMonthIdx, valuesByIdx); setShowUpdateMonth(false); }} />
      )}
    </div>
  );
}

/* Intestazione di un gruppo di asset. Per la liquidità porta con sé i mesi di
   autonomia: il dato compare dove stanno i soldi a cui si riferisce, non in un
   riquadro a parte. */
function GroupTitle({ gruppo, autonomia }) {
  return (
    <div className="card-title">
      <span>{gruppo}</span>
      {gruppo === "Cash/liquidità" && autonomia && (
        <span title="Liquidità di questo mese divisa per la spesa media degli ultimi sei mesi"
          style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0, color: "#4E576A", whiteSpace: "nowrap" }}>
          {fmtCHF(autonomia.liquidi)} · {autonomia.mesi.toFixed(1)} mesi di autonomia
        </span>
      )}
    </div>
  );
}

/* ============ MESE CORRENTE (mobile): stessa composizione del Patrimonio, ma solo il mese selezionato, righe grandi e comode al tocco ============ */
function MeseCorrente({ yr, year, monthIdx, groups, updateAsset, prices, updatePrice, netWorthValue, onConfirm, confirmStatus, fxRates, fxHistory, autonomia, ordineGruppi, onOrdineGruppi }) {
  const [editing, setEditing] = useState(null); // assetIdx
  const [expandedIdx, setExpandedIdx] = useState(null); // assetIdx con dettaglio quote×prezzo aperto
  const investAssets = yr.assets.map((a, i) => ({ ...a, idx: i })).filter(a => a.group === "Investimenti");
  const colStyle = (i) => i === monthIdx ? { background: "rgba(74,222,156,0.10)", boxShadow: "inset 0 0 0 1px rgba(74,222,156,0.35)" } : {};

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
        <div className="mono" style={{ fontSize: "var(--fs-hero)", fontWeight: 700 }}>{netWorthValue === null || netWorthValue === undefined ? "—" : fmtCHF(netWorthValue)}</div>
      </div>

      <SezioniRiordinabili titoli={{}} ordine={ordineGruppi} onOrdine={onOrdineGruppi}>
      {groups.map(g => {
        const items = yr.assets.map((a, i) => ({ ...a, idx: i })).filter(a => a.group === g);
        if (items.length === 0) return null;
        return (
          <div className="card" key={g} style={{ marginBottom: 16 }}>
            <GroupTitle gruppo={g} autonomia={autonomia} />
            {items.map(a => {
              const isAmort = a.ammortamento?.enabled;
              const isPriceLinked = a.units !== undefined && a.units !== null;
              const isComputed = isAmort || isPriceLinked || a.fatture === true;
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
                      <span className="month-row-value mono" style={{ color: cellColor(val, true) }}>{val === null ? "·" : fmtNum(val)}</span>
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
      </SezioniRiordinabili>

      {investAssets.length > 0 && (
        <div className="card" style={{ marginBottom: 16, overflowX: "auto" }}>
          <InvestmentPanel assets={investAssets} year={year} prices={prices} updatePrice={updatePrice} colStyle={colStyle} currentMonthIdx={monthIdx} fxRates={fxRates} fxHistory={fxHistory} />
        </div>
      )}

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
function InvestmentPanel({ assets, year, prices, updatePrice, colStyle, currentMonthIdx, tickers, setTickers, onRefreshPrices, fxRates, fxHistory }) {
  const [selected, setSelected] = useState(assets[0]?.name || null);
  const [editingPrice, setEditingPrice] = useState(null); // { name, monthIdx }
  const [showTickerCfg, setShowTickerCfg] = useState(false);
  const [testResult, setTestResult] = useState({}); // { assetName: { loading|price|currency|error } }
  const [refreshStatus, setRefreshStatus] = useState(null); // null | "loading" | "done" | "error"

  // Quanto hanno prodotto gli investimenti da inizio anno. È il movimento dei
  // PREZZI sulle quote che hai adesso: non si mescola con i versamenti fatti
  // durante l'anno, che farebbero sembrare un guadagno quello che è solo denaro
  // aggiunto. Convertito in CHF col cambio dell'ultimo mese noto.
  const rendimento = useMemo(() => {
    let guadagno = 0, base = 0;
    for (const a of assets) {
      if (a.units === undefined || a.units === null) continue;
      const p = prices[String(year)]?.[a.name];
      if (!p?.start) continue;
      let ultimo = -1;
      for (let i = 11; i >= 0; i--) if (p.monthly?.[i] !== null && p.monthly?.[i] !== undefined) { ultimo = i; break; }
      if (ultimo < 0) continue;
      const cambio = fxRate(a.currency, fxRates, fxHistory, year, ultimo);
      guadagno += a.units * (p.monthly[ultimo] - p.start) * cambio;
      base += a.units * p.start * cambio;
    }
    return base > 0 ? { guadagno: Math.round(guadagno), pct: guadagno / base } : null;
  }, [assets, prices, year, fxRates, fxHistory]);

  const refreshNow = async () => {
    setRefreshStatus("loading");
    try {
      await onRefreshPrices();
      setRefreshStatus("done");
      setTimeout(() => setRefreshStatus(null), 2500);
    } catch {
      setRefreshStatus("error");
    }
  };

  const testTicker = async (assetName, symbol, wantCurrency) => {
    if (!symbol) return;
    setTestResult(prev => ({ ...prev, [assetName]: { loading: true } }));
    try {
      const q = wantCurrency ? `${symbol}:${wantCurrency}` : symbol;
      const res = await fetch(`/api/prices?symbols=${encodeURIComponent(q)}`);
      const json = await res.json();
      const r = json?.results?.[symbol];
      if (!r || r.error) throw new Error(r?.error || "Nessun dato");
      setTestResult(prev => ({
        ...prev,
        [assetName]: { price: r.current, currency: r.currency, converted: r.converted, fxError: r.fxError },
      }));
    } catch (e) {
      setTestResult(prev => ({ ...prev, [assetName]: { error: e.message || "Errore" } }));
    }
  };

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
      <div className="card-title" style={{ alignItems: "center" }}>
        <span title="Clicca un nome per vederne il grafico, clicca una cella per registrare il prezzo">Investimenti — {year}</span>
        {setTickers && (
          <button className="btn" style={{ padding: "5px 11px", flexShrink: 0 }} onClick={() => setShowTickerCfg(s => !s)}>
            <RefreshCw size={13} />Prezzi automatici
          </button>
        )}
      </div>

      {rendimento && (
        <div style={{ fontSize: "var(--fs-sm)", color: "#7C8797", margin: "-8px 0 14px" }}
          title="Movimento dei prezzi sulle quote che hai adesso, da inizio anno. Non comprende i versamenti fatti durante l'anno.">
          Da inizio anno i prezzi ti hanno fatto{" "}
          <strong className="mono" style={{ color: rendimento.guadagno >= 0 ? COLORS.mint : COLORS.coral }}>
            {rendimento.guadagno >= 0 ? "+" : "−"}{fmtCHF(Math.abs(rendimento.guadagno))} ({fmtPct(rendimento.pct)})
          </strong>
        </div>
      )}

      {setTickers && showTickerCfg && (
        <div style={{ border: "1px solid var(--border-hair)", borderRadius: 10, padding: 14, marginBottom: 14, background: "var(--bg-void)" }}>
          <p style={{ fontSize: "var(--fs-sm)", color: "#7C8797", lineHeight: 1.6, margin: "0 0 12px" }}>
            Per ogni investimento indica il simbolo di <strong>Yahoo Finance</strong> (es. <span className="mono">VWCE.MI</span>, <span className="mono">SYBZ.DE</span>).
            I prezzi si aggiorneranno da soli a ogni apertura: chiusura di fine mese per i mesi passati, prezzo attuale per il mese in corso.
            Attenzione alla valuta: dev'essere la stessa con cui hai impostato l'asset.
          </p>
          {assets.map(a => {
            const tr = testResult[a.name];
            const wantCur = CURRENCY_OF[a.currency];
            const mismatch = tr?.currency && wantCur && tr.currency !== wantCur;
            return (
              <div key={a.name} style={{ marginBottom: 10 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span style={{ minWidth: 70, fontWeight: 600, fontSize: "var(--fs-base)" }}>{a.name}</span>
                  <span style={{ fontSize: "var(--fs-micro)", color: "#4E576A" }} className="mono">({wantCur || a.currency})</span>
                  <input className="mono" style={{ width: 120 }} placeholder="es. VWCE.MI"
                    value={tickers?.[a.name] || ""}
                    onChange={(e) => setTickers(prev => ({ ...prev, [a.name]: e.target.value.trim().toUpperCase() }))} />
                  <button className="btn" style={{ padding: "6px 11px" }} onClick={() => testTicker(a.name, tickers?.[a.name], wantCur)} disabled={!tickers?.[a.name]}>prova</button>
                  {tr?.loading && <span style={{ fontSize: "var(--fs-sm)", color: "#7C8797" }}>…</span>}
                  {tr?.price != null && (
                    <span style={{ fontSize: "var(--fs-sm)", color: mismatch ? COLORS.amber : COLORS.mint }} className="mono">
                      {tr.price} {tr.currency}{mismatch ? ` ⚠ atteso ${wantCur}` : " ✓"}
                    </span>
                  )}
                  {tr?.error && <span style={{ fontSize: "var(--fs-sm)", color: COLORS.coral }}>{tr.error}</span>}
                </div>
                {/* Verifica della conversione: prezzo originale × cambio = prezzo convertito */}
                {tr?.converted && (
                  <div className="mono" style={{ fontSize: "var(--fs-micro)", color: "#7C8797", marginTop: 3, marginLeft: 78 }}>
                    {tr.converted.sourcePrice} {tr.converted.from} × {tr.converted.rate} ({tr.converted.from}→{tr.converted.to}) = {tr.price} {tr.converted.to}
                  </div>
                )}
                {tr?.fxError && <div style={{ fontSize: "var(--fs-micro)", color: COLORS.amber, marginTop: 3, marginLeft: 78 }}>{tr.fxError}</div>}
              </div>
            );
          })}
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 12 }}>
            <button className="btn primary" style={{ padding: "8px 14px" }} onClick={refreshNow} disabled={refreshStatus === "loading"}>
              <RefreshCw size={14} />{refreshStatus === "loading" ? "Aggiornamento…" : "Aggiorna prezzi ora"}
            </button>
            {refreshStatus === "done" && <span style={{ fontSize: "var(--fs-sm)", color: COLORS.mint }}>✓ Prezzi aggiornati</span>}
            {refreshStatus === "error" && <span style={{ fontSize: "var(--fs-sm)", color: COLORS.coral }}>Errore. Riprova.</span>}
          </div>
          <p style={{ fontSize: "var(--fs-micro)", color: "#4E576A", margin: "10px 0 0" }}>
            I prezzi vengono presi da Yahoo Finance (fonte non ufficiale): affidabile ma senza garanzie. Le celle sotto restano comunque modificabili a mano.
            Si aggiornano anche da soli a ogni apertura dell'app.
          </p>
        </div>
      )}

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
                    <button className="icon-btn danger" title={`Cancella il prezzo di ${MONTHS[lastIdx]} (ultimo inserito)`} onClick={() => clearLastPrice(a.name, lastIdx)}>
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
                <Tooltip contentStyle={{ background: "#1E2530", border: "1px solid #2A3140", borderRadius: 8, fontSize: "var(--fs-sm)" }} formatter={(v) => fmtCHF2(v)} />
                {/* Nessun pallino sui punti: la linea resta pulita. Il punto compare
                    solo al passaggio del mouse, per leggere il valore del mese. */}
                <Line type="monotone" dataKey="value" stroke={COLORS.blue} strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
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
          <h3 style={{ margin: 0, fontSize: "var(--fs-lg)" }}>Aggiorna cifre di {MONTHS[monthIdx]} {year}</h3>
          <button className="icon-btn" onClick={onClose}><X size={18} /></button>
        </div>
        <p style={{ fontSize: "var(--fs-sm)", color: "#7C8797", marginTop: 0, marginBottom: 16 }}>
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
      <div style={{ fontSize: "var(--fs-sm)", fontWeight: 600, color: COLORS.blue }}>{asset.name} · {MONTHS[monthIdx]} {year}</div>
      <div className="mono" style={{ display: "flex", alignItems: "center", gap: 8, fontSize: "var(--fs-base)" }}>
        <span style={{ color: "#7C8797", fontSize: "var(--fs-micro)" }}>quote</span>
        <input type="number" step="0.0001" style={{ width: 70, textAlign: "right" }}
          defaultValue={asset.units}
          onBlur={(e) => { const n = parseFloat(e.target.value); if (!isNaN(n)) updateAsset(year, asset.idx, { units: n }); }} />
        <span style={{ color: "#4E576A" }}>×</span>
        <span style={{ color: "#7C8797", fontSize: "var(--fs-micro)" }}>prezzo</span>
        <input type="number" step="0.01" style={{ width: 74, textAlign: "right" }}
          defaultValue={priceVal ?? ""}
          onBlur={(e) => { const n = parseFloat(e.target.value); if (!isNaN(n)) updatePrice(String(year), asset.name, monthIdx, Math.round(n * 10000) / 10000); }} />
        <span style={{ color: "#4E576A" }}>=</span>
        <span style={{ fontWeight: 700, fontSize: "var(--fs-md)", color: COLORS.mint }}>{total === null ? "—" : fmtCHF2(total)}</span>
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
          <h3 style={{ margin: 0, fontSize: "var(--fs-lg)" }}>Nuovo asset</h3>
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
      <div className="page-toolbar">
        <button className="btn primary" onClick={() => setShowForm(true)}><Plus size={15} />Nuovo movimento</button>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <p style={{ fontSize: "var(--fs-base)", color: "#7C8797", lineHeight: 1.6, margin: 0 }}>
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
                <td><button className="icon-btn danger" onClick={() => deleteMovement(m.id)}><Trash2 size={13} /></button></td>
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
          <h3 style={{ margin: 0, fontSize: "var(--fs-lg)" }}>Nuovo movimento patrimoniale</h3>
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

/* ============ STRUMENTI (Ammortamento + Split the bill + Movimenti) ============ */
function Strumenti({ patrimonio, updateAsset, addAsset, categories, addExpenses, movements, addMovement, deleteMovement, prices, fatture, addFattura, deleteFattura, year }) {
  const [sub, setSub] = useState("ammortamento");
  return (
    <div>
      <div className="tabs-row">
        <button className={"btn" + (sub === "ammortamento" ? " primary" : "")} onClick={() => setSub("ammortamento")}><Percent size={14} />Ammortamento</button>
        <button className={"btn" + (sub === "fatture" ? " primary" : "")} onClick={() => setSub("fatture")}><SplitSquareHorizontal size={14} />Fatture</button>
        <button className={"btn" + (sub === "movimenti" ? " primary" : "")} onClick={() => setSub("movimenti")}><ArrowLeftRight size={14} />Movimenti</button>
      </div>
      {sub === "ammortamento" && <AmmortamentoTool patrimonio={patrimonio} updateAsset={updateAsset} addAsset={addAsset} />}
      {sub === "fatture" && <FattureTool categories={categories} addExpenses={addExpenses} fatture={fatture} addFattura={addFattura} deleteFattura={deleteFattura} year={year} />}
      {sub === "movimenti" && <Movimenti patrimonio={patrimonio} movements={movements} addMovement={addMovement} deleteMovement={deleteMovement} prices={prices} />}
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
        <p style={{ fontSize: "var(--fs-base)", color: "#7C8797", lineHeight: 1.6, margin: 0 }}>
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
            <thead><tr><th>Nome</th><th>Valore iniziale (CHF)</th><th>Data acquisto</th><th>Tasso/anno</th><th style={{ textAlign: "right" }}>Valore oggi (CHF)</th></tr></thead>
            <tbody>
              {amortAssets.map(a => (
                <tr key={a.idx}>
                  <td>{a.name}</td>
                  <td className="mono">{fmtNum(a.ammortamento.acquisitionValue)}</td>
                  <td className="mono" style={{ color: "#7C8797" }}>{a.ammortamento.acquisitionDate}</td>
                  <td className="mono">{a.ammortamento.annualRate}%</td>
                  <td className="mono" style={{ textAlign: "right", fontWeight: 600, color: COLORS.amber }}>{fmtNum(computeAmmortamentoValue(a.ammortamento))}</td>
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
          <h3 style={{ margin: 0, fontSize: "var(--fs-lg)" }}>Nuovo bene ammortizzabile</h3>
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

/* ============ FATTURE ============
   Una fattura pagata in una volta ma di competenza di più mesi ha due facce, e qui
   si inserisce una volta sola per averle entrambe:
   - nelle Spese, le rate mensili (il costo che compete a ogni mese);
   - nel Patrimonio, la parte non ancora consumata, alla voce "Fatture già pagate".
   Se invece il cash esce davvero mese per mese non c'è nessun residuo: in quel caso
   si tolgono i due spunti e lo strumento genera soltanto le rate, come prima. */
function FattureTool({ categories, addExpenses, fatture, addFattura, deleteFattura, year }) {
  const [showForm, setShowForm] = useState(!(fatture?.length));
  const oggi = new Date();

  const residui = useMemo(() => residuiAnno(fatture, year), [fatture, year]);
  const righe = useMemo(() => (fatture || [])
    .map(f => ({
      ...f,
      quota: Math.round((f.amount / f.months) * 100) / 100,
      residuo: residuoFattura(f, oggi.getFullYear(), oggi.getMonth()),
      periodo: meseLabel(parseMonth(f.startMonth)) + " → " + meseLabel(parseMonth(f.startMonth) + f.months - 1),
    }))
    .sort((a, b) => b.residuo - a.residuo || b.paidDate.localeCompare(a.paidDate)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fatture]);
  const residuoOggi = righe.reduce((s, r) => s + r.residuo, 0);
  const aperte = righe.filter(r => r.residuo > 0).length;

  if (showForm) {
    return (
      <NuovaFatturaForm
        categories={categories}
        onClose={() => setShowForm(false)}
        onSave={({ rate, fattura }) => {
          if (rate?.length) addExpenses(rate);
          if (fattura) addFattura(fattura);
          setShowForm(false);
        }}
      />
    );
  }

  return (
    <div>
      <div className="page-toolbar">
        <button className="btn primary" onClick={() => setShowForm(true)}><Plus size={15} />Nuova fattura</button>
        <span style={{ fontSize: "var(--fs-sm)", color: "#7C8797" }}>
          {aperte} in corso · <strong style={{ color: "var(--text-primary)" }}>{fmtCHF(residuoOggi)}</strong> non ancora consumati
        </span>
      </div>

      <div className="card" style={{ marginBottom: 16, overflowX: "auto" }}>
        <div className="card-title">Fatture già pagate (CHF) — {year}</div>
        <table className="data-table">
          <thead><tr>{MONTHS.map(m => <th key={m} style={{ textAlign: "right" }}>{m}</th>)}</tr></thead>
          <tbody><tr>{residui.map((v, i) => (
            <td key={i} className="mono" style={{ textAlign: "right", fontWeight: 600, color: v > 0 ? "#E7EBF3" : "#3A4152" }}>
              {v > 0 ? fmtNum(v) : "·"}
            </td>
          ))}</tr></tbody>
        </table>
      </div>

      <div className="card" style={{ overflowX: "auto" }}>
        <div className="card-title">Fatture</div>
        {righe.length === 0 ? <div className="empty-state">Nessuna fattura registrata.</div> : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Descrizione</th><th>Pagata il</th><th>Competenza</th>
                <th style={{ textAlign: "right" }}>Al mese (CHF)</th><th style={{ textAlign: "right" }}>Residuo (CHF)</th><th></th>
              </tr>
            </thead>
            <tbody>
              {righe.map(r => (
                <tr key={r.id} style={r.residuo > 0 ? undefined : { opacity: 0.5 }}>
                  <td>{r.desc}</td>
                  <td className="mono" style={{ color: "#7C8797", whiteSpace: "nowrap" }}>{r.paidDate}</td>
                  <td style={{ whiteSpace: "nowrap" }}>{r.periodo}</td>
                  <td className="mono" style={{ textAlign: "right", color: "#7C8797" }}>{fmtCHF2(r.quota)}</td>
                  <td className="mono" style={{ textAlign: "right", fontWeight: 600 }}>{r.residuo > 0 ? fmtNum(r.residuo) : "conclusa"}</td>
                  <td style={{ width: 30 }}>
                    <button className="icon-btn danger" onClick={() => deleteFattura(r.id)} title="Togli dal patrimonio (le spese già inserite restano)"><Trash2 size={14} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

/* Riga con spunta: l'etichetta intera è cliccabile, comoda anche col dito. */
function CheckRow({ checked, onChange, label, hint }) {
  return (
    <label style={{ display: "flex", alignItems: "flex-start", gap: 9, cursor: "pointer", marginBottom: 13 }}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)}
        style={{ width: 17, height: 17, minWidth: 17, margin: "1px 0 0", padding: 0, accentColor: COLORS.mint }} />
      <span style={{ fontSize: "var(--fs-sm)", lineHeight: 1.45 }}>
        {label}
        {hint && <span style={{ display: "block", color: "#7C8797", fontSize: "var(--fs-micro)", marginTop: 2 }}>{hint}</span>}
      </span>
    </label>
  );
}

function NuovaFatturaForm({ categories, onClose, onSave }) {
  const primaries = Object.keys(categories);
  const [desc, setDesc] = useState("");
  const [total, setTotal] = useState("");
  const [months, setMonths] = useState(12);
  const [startMonth, setStartMonth] = useState(new Date().toISOString().slice(0, 7));
  const [unaVolta, setUnaVolta] = useState(true);
  const [paidDate, setPaidDate] = useState(new Date().toISOString().slice(0, 10));
  const [rateGiaInserite, setRateGiaInserite] = useState(false);
  const [primary, setPrimary] = useState(primaries[0] || "");
  const [secondary, setSecondary] = useState((categories[primaries[0]] || [])[0] || "");
  const [preview, setPreview] = useState(null);

  const secondaries = categories[primary] || [];
  const perRata = total && months > 0 ? Math.round((parseFloat(total) / months) * 100) / 100 : 0;

  // Residuo mese per mese di questa sola fattura, dal primo mese coinvolto
  // (pagamento o competenza, il più antico) fino a copertura esaurita.
  const anteprimaResiduo = (f) => {
    const inizio = Math.min(parseMonth(f.paidDate.slice(0, 7)), parseMonth(f.startMonth));
    const fine = parseMonth(f.startMonth) + f.months - 1;
    const out = [];
    for (let k = inizio; k <= fine; k++) {
      out.push({ label: meseLabel(k), value: residuoFattura(f, Math.floor(k / 12), ((k % 12) + 12) % 12) });
    }
    return out;
  };

  const genera = () => {
    const importo = parseFloat(total);
    if (!desc || !importo || !(months > 0)) return;
    const [sy, sm] = startMonth.split("-").map(Number);
    const rate = rateGiaInserite ? [] : Array.from({ length: months }, (_, i) => {
      const d = new Date(sy, sm - 1 + i, 1);
      const dateStr = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-01";
      return { date: dateStr, desc: `${desc} (rata ${i + 1}/${months})`, amount: perRata, primary, secondary, note: "split the bill" };
    });
    const fattura = unaVolta ? { desc, amount: importo, paidDate, startMonth, months } : null;
    setPreview({ rate, fattura, residuo: fattura ? anteprimaResiduo(fattura) : [] });
  };

  return (
    <div className="grid-2col">
      <div className="card">
        <div className="card-title">
          Nuova fattura
          <button className="icon-btn" onClick={onClose} title="Torna all'elenco"><X size={18} /></button>
        </div>
        <div className="field"><label className="field-label">Descrizione</label><input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="es. Abbonamento palestra" /></div>
        <div className="row-2">
          <div className="field"><label className="field-label">Importo totale (CHF)</label><input type="number" step="0.01" value={total} onChange={(e) => setTotal(e.target.value)} placeholder="600" /></div>
          <div className="field"><label className="field-label">Su quanti mesi</label><input type="number" min="2" max="60" value={months} onChange={(e) => setMonths(parseInt(e.target.value || "1", 10))} /></div>
        </div>
        <div className="field"><label className="field-label">Primo mese di competenza</label><input type="month" value={startMonth} onChange={(e) => setStartMonth(e.target.value)} /></div>

        <CheckRow checked={unaVolta} onChange={setUnaVolta}
          label="Pagata tutta in una volta"
          hint="I mesi non ancora consumati restano nel patrimonio come «Fatture già pagate»." />
        {unaVolta && (
          <div className="field"><label className="field-label">Uscita dal conto il</label><input type="date" value={paidDate} onChange={(e) => setPaidDate(e.target.value)} /></div>
        )}

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

        <CheckRow checked={rateGiaInserite} onChange={setRateGiaInserite}
          label="Le rate sono già nelle spese"
          hint="Per una fattura vecchia già divisa a mano: registra solo la parte di patrimonio." />

        {perRata > 0 && <div className="pill" style={{ marginBottom: 14 }}>{fmtCHF2(perRata)} CHF / mese</div>}
        <button className="btn primary" style={{ width: "100%", justifyContent: "center" }} onClick={genera}>
          <Sparkles size={14} />Genera anteprima
        </button>
      </div>

      <div className="card">
        <div className="card-title">Anteprima</div>
        {!preview ? <div className="empty-state">Compila il modulo e genera l'anteprima.</div> : (
          <>
            {preview.residuo.length > 0 && (
              <div style={{ marginBottom: 18, overflowX: "auto" }}>
                <div style={{ fontSize: "var(--fs-micro)", color: "#7C8797", marginBottom: 8 }}>Nel patrimonio, a fine mese (CHF)</div>
                <table className="data-table">
                  <thead><tr>{preview.residuo.map(r => <th key={r.label} style={{ textAlign: "right" }}>{r.label}</th>)}</tr></thead>
                  <tbody><tr>{preview.residuo.map(r => (
                    <td key={r.label} className="mono" style={{ textAlign: "right", color: r.value > 0 ? "#E7EBF3" : "#3A4152" }}>
                      {r.value > 0 ? fmtNum(r.value) : "·"}
                    </td>
                  ))}</tr></tbody>
                </table>
              </div>
            )}
            {preview.rate.length > 0 && (
              <div style={{ overflowX: "auto" }}>
                <div style={{ fontSize: "var(--fs-micro)", color: "#7C8797", marginBottom: 8 }}>Nelle spese</div>
                <table className="data-table">
                  <thead><tr><th>Data</th><th>Descrizione</th><th style={{ textAlign: "right" }}>Importo</th></tr></thead>
                  <tbody>
                    {preview.rate.map((r, i) => (
                      <tr key={i}><td className="mono" style={{ color: "#7C8797", whiteSpace: "nowrap" }}>{r.date}</td><td>{r.desc}</td><td className="mono" style={{ textAlign: "right" }}>{fmtCHF2(r.amount)}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <button className="btn primary" style={{ width: "100%", justifyContent: "center", marginTop: 16 }}
              onClick={() => onSave(preview)}>
              <Check size={14} />
              {preview.rate.length > 0 && preview.fattura ? `Conferma: ${preview.rate.length} spese + patrimonio`
                : preview.rate.length > 0 ? `Conferma e aggiungi ${preview.rate.length} spese`
                : "Conferma"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/* ============ CATEGORIE ============ */
function Categorie({ categories, setCategories, budgets, setBudgets }) {
  const [newPrimary, setNewPrimary] = useState("");
  const [newSecondary, setNewSecondary] = useState({});

  // Budget mensile facoltativo per categoria. Se lasciato vuoto, nell'app non
  // compare nulla di diverso: il budget è del tutto opzionale e discreto.
  const setBudget = (cat, raw) => {
    const v = String(raw).replace(",", ".").trim();
    setBudgets(prev => {
      const next = { ...prev };
      const n = parseFloat(v);
      if (!v || isNaN(n) || n <= 0) delete next[cat];
      else next[cat] = Math.round(n * 100) / 100;
      return next;
    });
  };

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
              <button className="icon-btn danger" onClick={() => removePrimary(p)}><Trash2 size={13} /></button>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
              {secs.map(s => (
                <span key={s} className="pill" style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                  {s}
                  <X size={11} style={{ cursor: "pointer" }} onClick={() => removeSecondary(p, s)} />
                </span>
              ))}
              {secs.length === 0 && <span style={{ fontSize: "var(--fs-sm)", color: "#4E576A" }}>Nessuna sottocategoria</span>}
            </div>
            {setBudgets && isSpesa(p) && (
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                <span style={{ fontSize: "var(--fs-micro)", color: "#4E576A" }}>Budget mensile</span>
                <input type="number" step="10" min="0" placeholder="—" className="mono"
                  style={{ width: 84, textAlign: "right", padding: "5px 8px" }}
                  value={budgets?.[p] ?? ""}
                  onChange={(e) => setBudget(p, e.target.value)} />
                <span style={{ fontSize: "var(--fs-micro)", color: "#4E576A" }}>CHF</span>
              </div>
            )}
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

/* ============ ESPORTAZIONE DATI ============ */
// Scarica un file generato lato client (nessun server coinvolto).
function downloadFile(filename, mime, content) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
// Foglio "Spese": tutte le spese ordinate per data.
function speseAOA(expenses) {
  const header = ["Data", "Descrizione", "Importo", "Categoria", "Sottocategoria", "Nota"];
  const rows = [...expenses]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((e) => [e.date, e.desc, e.amount, e.primary, e.secondary || "", e.note || ""]);
  return [header, ...rows];
}
// Foglio "Patrimonio {anno}": valore in CHF di ogni voce, mese per mese, + patrimonio netto.
function patrimonioAOA(year, data) {
  if (!data.patrimonio[year]?.assets?.length) return null;
  // Come nella scheda Patrimonio: in fondo la riga delle fatture già pagate.
  const yr = annoConFatture(data.patrimonio[year], data.fatture, year);
  const fx = data.fxRates;
  const chf = (a, i) => {
    const { value } = getAssetStrictValue(a, i, new Date(year, i, 1), data.prices, year);
    return (value === null || value === undefined) ? "" : Math.round(value * fxRate(a.currency, fx, data.fxHistory, year, i) * 100) / 100;
  };
  const rows = [["Voce", "Gruppo", "Valuta", ...MONTHS]];
  for (const a of yr.assets) {
    rows.push([a.name, a.group, a.currency, ...MONTHS.map((_, i) => chf(a, i))]);
  }
  const nw = getStrictNetWorthSeries(yr, fx, year, data.prices, data.fxHistory);
  rows.push(["PATRIMONIO NETTO (CHF)", "", "", ...nw.map((v) => (v === null || v === undefined) ? "" : Math.round(v))]);
  return rows;
}
// Foglio "Investimenti {anno}": valore fine mese (CHF) e prezzo per quota degli investimenti.
function investimentiAOA(year, data) {
  const yr = data.patrimonio[year];
  const invest = yr?.assets?.filter((a) => a.group === "Investimenti") || [];
  if (!invest.length) return null;
  const fx = data.fxRates;
  const rows = [];
  rows.push(["VALORE FINE MESE (CHF) = quote × prezzo"]);
  rows.push(["Investimento", "Quote", ...MONTHS]);
  for (const a of invest) {
    const vals = MONTHS.map((_, i) => {
      const { value } = getAssetStrictValue(a, i, new Date(year, i, 1), data.prices, year);
      return (value === null || value === undefined) ? "" : Math.round(value * fxRate(a.currency, fx, data.fxHistory, year, i) * 100) / 100;
    });
    rows.push([a.name, a.units ?? "", ...vals]);
  }
  rows.push([]);
  rows.push(["PREZZO PER QUOTA (valuta dell'investimento)"]);
  rows.push(["Investimento", "Prezzo iniziale", ...MONTHS]);
  for (const a of invest) {
    const p = data.prices?.[String(year)]?.[a.name];
    const prices = MONTHS.map((_, i) => {
      const v = p?.monthly?.[i];
      return (v === null || v === undefined) ? "" : v;
    });
    rows.push([a.name, p?.start ?? "", ...prices]);
  }
  return rows;
}
// Esporta tutto in un unico file Excel (.xlsx) con più fogli. La libreria xlsx
// viene caricata solo al momento dell'esportazione (dynamic import).
async function esportaExcel(data) {
  const mod = await import("xlsx");
  const XLSX = mod.utils ? mod : mod.default;
  const wb = XLSX.utils.book_new();
  // Nome foglio: Excel ammette max 31 caratteri.
  const addSheet = (name, aoa) => aoa && XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), name.slice(0, 31));

  addSheet("Spese", speseAOA(data.expenses));
  for (const y of Object.keys(data.patrimonio).sort()) {
    addSheet(`Patrimonio ${y}`, patrimonioAOA(Number(y), data));
    addSheet(`Investimenti ${y}`, investimentiAOA(Number(y), data));
  }
  const out = XLSX.write(wb, { type: "array", bookType: "xlsx" });
  downloadFile(`analisi-spese-${new Date().toISOString().slice(0, 10)}.xlsx`,
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", out);
}
function esportaBackupJSON(data) {
  const payload = { app: "Analisi spese", exportedAt: new Date().toISOString(), version: 1, data };
  downloadFile(`analisi-spese-backup-${new Date().toISOString().slice(0, 10)}.json`, "application/json", JSON.stringify(payload, null, 2));
}

/* ============ PROFILO: nome utente, cambio email/password, categorie, esporta ============ */
function Profilo({ user, displayName, setDisplayName, categories, setCategories, addAsset, data, budgets, setBudgets }) {
  const [sub, setSub] = useState("account"); // account | categorie | asset | esporta
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState(null);
  const handleExcel = async () => {
    setExporting(true);
    setExportError(null);
    try {
      await esportaExcel(data);
    } catch (e) {
      console.error("Errore esportazione Excel:", e);
      setExportError("Errore durante l'esportazione. Riprova.");
    } finally {
      setExporting(false);
    }
  };
  const [showAssetForm, setShowAssetForm] = useState(false);
  const [assetYear, setAssetYear] = useState(() => {
    const y = new Date().getFullYear();
    return YEARS.includes(y) ? y : YEARS[YEARS.length - 1];
  });
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
      <div className="tabs-row">
        <button className={"btn" + (sub === "account" ? " primary" : "")} onClick={() => setSub("account")}><User size={14} />Account</button>
        <button className={"btn" + (sub === "categorie" ? " primary" : "")} onClick={() => setSub("categorie")}><Tags size={14} />Categorie</button>
        <button className={"btn" + (sub === "asset" ? " primary" : "")} onClick={() => setSub("asset")}><Wallet size={14} />Asset</button>
        <button className={"btn" + (sub === "esporta" ? " primary" : "")} onClick={() => setSub("esporta")}><Download size={14} />Esporta</button>
      </div>
      {sub === "categorie" && <Categorie categories={categories} setCategories={setCategories} budgets={budgets} setBudgets={setBudgets} />}
      {sub === "esporta" && (
        <div className="card" style={{ maxWidth: 460 }}>
          <div className="card-title">Esporta i tuoi dati</div>
          <p style={{ fontSize: "var(--fs-base)", color: "#7C8797", lineHeight: 1.6, margin: "0 0 16px" }}>
            Scarica una copia dei tuoi dati sul dispositivo. I file vengono generati qui sul telefono/computer,
            non passano da nessun server.
          </p>

          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 18 }}>
            <button className="btn primary" style={{ justifyContent: "center" }} onClick={handleExcel} disabled={exporting}>
              <Download size={15} />{exporting ? "Preparazione…" : "Esporta in Excel (.xlsx)"}
            </button>
            <span style={{ fontSize: "var(--fs-micro)", color: "#4E576A" }}>
              Un unico file Excel con più fogli: <strong style={{ color: "#7C8797" }}>Spese</strong>, e per ogni anno
              il <strong style={{ color: "#7C8797" }}>Patrimonio</strong> (valore di ogni voce mese per mese, con patrimonio netto)
              e gli <strong style={{ color: "#7C8797" }}>Investimenti</strong> (valore a fine mese e prezzo per quota).
            </span>
            {exportError && <span style={{ fontSize: "var(--fs-sm)", color: "var(--coral)" }}>{exportError}</span>}
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <button className="btn" style={{ justifyContent: "center" }} onClick={() => esportaBackupJSON(data)}>
              <Save size={15} />Backup completo (JSON)
            </button>
            <span style={{ fontSize: "var(--fs-micro)", color: "#4E576A" }}>Copia integrale di tutto (spese, patrimonio, prezzi, movimenti, categorie): utile come salvataggio di sicurezza, ripristinabile in futuro.</span>
          </div>
        </div>
      )}
      {sub === "asset" && (
        <div className="card" style={{ maxWidth: 420 }}>
          <div className="card-title">Aggiungi un nuovo asset</div>
          <p style={{ fontSize: "var(--fs-base)", color: "#7C8797", lineHeight: 1.6, margin: "0 0 14px" }}>
            Crea una nuova voce di patrimonio (conto, investimento, mezzo di trasporto…). Scegli in quale anno aggiungerla:
            comparirà nel foglio Patrimonio di quell'anno.
          </p>
          <div className="field">
            <label className="field-label">Anno</label>
            <select value={assetYear} onChange={(e) => setAssetYear(Number(e.target.value))} style={{ width: "100%" }}>
              {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
          <button className="btn primary" style={{ width: "100%", justifyContent: "center" }} onClick={() => setShowAssetForm(true)}>
            <Plus size={15} />Aggiungi asset
          </button>
        </div>
      )}
      {showAssetForm && (
        <AssetFormModal onClose={() => setShowAssetForm(false)} onSave={(asset) => { addAsset(assetYear, asset); setShowAssetForm(false); }} />
      )}
      {sub === "account" && (<>

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
        <p style={{ fontSize: "var(--fs-base)", color: "var(--text-muted)", marginBottom: 12 }}>Email attuale: <strong>{user.email}</strong></p>
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
      </>)}
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
