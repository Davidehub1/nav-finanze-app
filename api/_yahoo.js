// Recupero prezzi da Yahoo Finance (chiusura di fine mese per i mesi passati,
// prezzo corrente per il mese in corso). Usato sia dalla funzione serverless su
// Vercel (api/prices.js) sia dal dev server Vite (vite.config.js), così la logica
// è identica in sviluppo e in produzione.
//
// Nota importante: i timestamp dei dati mensili di Yahoo sono al confine del mese
// nel fuso orario della borsa, quindi va usato meta.gmtoffset per attribuire ogni
// prezzo al mese giusto (altrimenti risultano sfalsati di un mese).
//
// Conversione valuta: se un titolo quota in una valuta diversa da quella con cui
// l'utente ha impostato l'asset (es. VHYL quota in GBP ma l'asset è in CHF), il
// prezzo viene convertito usando il cambio DELLO STESSO MESE (non quello di oggi),
// altrimenti i valori storici risulterebbero falsati.

// Accetta "VWCE.MI" oppure "VHYL.L:CHF" (simbolo:valuta desiderata).
export function parseSymbols(param) {
  return String(param || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 20)
    .map((entry) => {
      const [symbol, want] = entry.split(":");
      return { symbol: symbol.trim(), want: (want || "").trim().toUpperCase() || null };
    });
}

// Scarica una serie mensile da Yahoo: { currency, current, monthly: { "2026-06": 165.27 } }
async function fetchSeries(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=5y&interval=1mo`;
  const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const j = await r.json();
  const res0 = j && j.chart && j.chart.result && j.chart.result[0];
  if (!res0 || !res0.timestamp) throw new Error("Simbolo non trovato");
  const off = res0.meta.gmtoffset || 0;
  const closes = (res0.indicators && res0.indicators.quote && res0.indicators.quote[0] && res0.indicators.quote[0].close) || [];
  const monthly = {};
  res0.timestamp.forEach((t, i) => {
    const c = closes[i];
    if (c == null) return;
    const d = new Date((t + off) * 1000);
    monthly[`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`] = c;
  });
  return { currency: res0.meta.currency, current: res0.meta.regularMarketPrice, monthly };
}

const round4 = (n) => Math.round(n * 10000) / 10000;

export async function fetchYahooPrices(entries) {
  // Normalizza: accetta anche un semplice array di stringhe.
  const list = entries.map((e) => (typeof e === "string" ? { symbol: e, want: null } : e));

  // 1) Scarica tutte le serie dei titoli.
  const series = {};
  await Promise.all(
    list.map(async ({ symbol }) => {
      try {
        series[symbol] = await fetchSeries(symbol);
      } catch (e) {
        series[symbol] = { error: String((e && e.message) || e) };
      }
    })
  );

  // 2) Individua le conversioni necessarie e scarica i cambi (una volta ciascuno).
  const fxNeeded = new Set();
  for (const { symbol, want } of list) {
    const s = series[symbol];
    if (!s || s.error || !want) continue;
    if (s.currency && s.currency !== want) fxNeeded.add(`${s.currency}${want}=X`);
  }
  const fx = {};
  await Promise.all(
    [...fxNeeded].map(async (pair) => {
      try {
        fx[pair] = await fetchSeries(pair);
      } catch {
        fx[pair] = null;
      }
    })
  );

  // 3) Converte dove serve, usando il cambio dello stesso mese.
  const results = {};
  for (const { symbol, want } of list) {
    const s = series[symbol];
    if (!s || s.error) { results[symbol] = { error: s?.error || "Errore" }; continue; }

    if (!want || !s.currency || s.currency === want) {
      results[symbol] = {
        currency: s.currency,
        current: round4(s.current),
        monthly: Object.fromEntries(Object.entries(s.monthly).map(([k, v]) => [k, round4(v)])),
      };
      continue;
    }

    const pair = `${s.currency}${want}=X`;
    const fxSeries = fx[pair];
    if (!fxSeries || fxSeries.error) {
      // Nessun cambio disponibile: restituisco il prezzo originale segnalando il problema,
      // meglio che convertire con un tasso inventato.
      results[symbol] = {
        currency: s.currency, current: round4(s.current),
        monthly: Object.fromEntries(Object.entries(s.monthly).map(([k, v]) => [k, round4(v)])),
        fxError: `Cambio ${s.currency}→${want} non disponibile`,
      };
      continue;
    }

    const monthly = {};
    for (const [k, v] of Object.entries(s.monthly)) {
      const rate = fxSeries.monthly[k];
      if (rate == null) continue; // niente cambio per quel mese: salto (meglio vuoto che sbagliato)
      monthly[k] = round4(v * rate);
    }
    results[symbol] = {
      currency: want,                       // valuta finale, dopo conversione
      current: round4(s.current * fxSeries.current),
      monthly,
      // dati per il controllo "prezzo originale × cambio = prezzo convertito"
      converted: { from: s.currency, to: want, sourcePrice: round4(s.current), rate: round4(fxSeries.current) },
    };
  }
  return results;
}
