// Funzione serverless (Vercel): fa da ponte verso Yahoo Finance, perché il
// browser non può chiamarlo direttamente (blocco CORS). L'app chiama
// /api/prices?symbols=VWCE.MI,SYBZ.DE e riceve i prezzi mensili + quello corrente.
import { fetchYahooPrices, parseSymbols } from "./_yahoo.js";

export default async function handler(req, res) {
  const symbols = parseSymbols(req.query.symbols || req.query.symbol);
  if (!symbols.length) {
    res.status(400).json({ error: "Nessun simbolo richiesto" });
    return;
  }
  try {
    const results = await fetchYahooPrices(symbols);
    res.setHeader("Cache-Control", "s-maxage=600, stale-while-revalidate=1800");
    res.status(200).json({ results });
  } catch (e) {
    res.status(502).json({ error: "Errore nel recupero prezzi" });
  }
}
