import { supabase } from "./supabaseClient.js";
import { EXPENSES_SEED, PATRIMONIO_SEED, CATEGORIES_SEED, PRICES_SEED, FX_DEFAULT } from "./seedData.js";

// Il progetto Supabase di default limita a 1000 le righe per richiesta: per le spese
// (potenzialmente >1000 nel tempo) inseriamo a lotti per non perderne silenziosamente.
const INSERT_BATCH_SIZE = 500;
async function insertInBatches(table, rows) {
  for (let i = 0; i < rows.length; i += INSERT_BATCH_SIZE) {
    const batch = rows.slice(i, i + INSERT_BATCH_SIZE);
    const { error } = await supabase.from(table).insert(batch);
    if (error) throw error;
  }
}

/* ============ Mappatura righe Supabase <-> shape usata dal componente ============ */

function rowsToAppData({ profile, expenses, assets, prices, movements }) {
  const patrimonio = {};
  for (const row of assets) {
    const y = String(row.year);
    if (!patrimonio[y]) {
      patrimonio[y] = { assets: [], netWorth: profile.net_worth_fallback?.[y] || Array(12).fill(null) };
    }
    const asset = {
      group: row.group_name,
      name: row.name,
      currency: row.currency,
      monthly: row.monthly || Array(12).fill(null),
    };
    if (row.units !== null && row.units !== undefined) asset.units = Number(row.units);
    if (row.ammortamento) asset.ammortamento = row.ammortamento;
    patrimonio[y].assets.push(asset);
  }

  const prices2 = {};
  for (const row of prices) {
    const y = String(row.year);
    if (!prices2[y]) prices2[y] = {};
    prices2[y][row.asset_name] = {
      start: row.start_price === null ? null : Number(row.start_price),
      monthly: row.monthly || Array(12).fill(null),
    };
  }

  return {
    expenses: expenses.map((e) => ({
      id: e.id,
      date: e.date,
      desc: e.description,
      amount: Number(e.amount),
      primary: e.category_primary,
      secondary: e.category_secondary || "",
      note: e.note || "",
    })),
    patrimonio,
    categories: profile.categories || {},
    movements: movements.map((m) => ({
      id: m.id,
      date: m.date,
      tipoLabel: m.tipo_label,
      from: m.from_name || undefined,
      to: m.to_name || undefined,
      amount: m.amount === null ? undefined : Number(m.amount),
      qty: m.qty === null ? undefined : Number(m.qty),
      price: m.price === null ? undefined : Number(m.price),
      note: m.note || "",
    })),
    fxRates: { EURCHF: Number(profile.fx_eurchf), USDCHF: Number(profile.fx_usdchf) },
    prices: prices2,
  };
}

// Il Data API di Supabase limita di default le righe restituite da una query
// (tipicamente 1000): con >1000 spese una singola select le troncherebbe silenziosamente,
// e il salvataggio automatico (che risincronizza da questo stato) cancellerebbe per sempre
// le righe non lette. Per questo leggiamo a pagine finché non ne arrivano più.
const PAGE_SIZE = 1000;
async function fetchAllRows(makeQuery) {
  let all = [];
  let from = 0;
  for (;;) {
    const { data, error } = await makeQuery(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    all = all.concat(data || []);
    if (!data || data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return all;
}

/* ============ Caricamento dati utente ============ */
export async function loadUserData(userId) {
  const profileRes = await supabase.from("profiles").select("*").eq("id", userId).maybeSingle();
  if (profileRes.error) throw profileRes.error;
  if (!profileRes.data) return null; // nessun profilo -> primo accesso, serve il seed

  const [expenses, assets, prices, movements] = await Promise.all([
    fetchAllRows((from, to) =>
      supabase.from("expenses").select("*").eq("user_id", userId).order("date", { ascending: false }).range(from, to)
    ),
    fetchAllRows((from, to) =>
      supabase.from("patrimonio_assets").select("*").eq("user_id", userId).range(from, to)
    ),
    fetchAllRows((from, to) =>
      supabase.from("asset_prices").select("*").eq("user_id", userId).range(from, to)
    ),
    fetchAllRows((from, to) =>
      supabase.from("movements").select("*").eq("user_id", userId).order("date", { ascending: false }).range(from, to)
    ),
  ]);

  return rowsToAppData({ profile: profileRes.data, expenses, assets, prices, movements });
}

/* ============ Import dei dati storici come dati iniziali (primo accesso) ============ */
export async function seedInitialData(userId) {
  const netWorthFallback = {};
  for (const y of Object.keys(PATRIMONIO_SEED)) netWorthFallback[y] = PATRIMONIO_SEED[y].netWorth;

  const { error: profileErr } = await supabase.from("profiles").insert({
    id: userId,
    fx_eurchf: FX_DEFAULT.EURCHF,
    fx_usdchf: FX_DEFAULT.USDCHF,
    categories: CATEGORIES_SEED,
    net_worth_fallback: netWorthFallback,
  });
  if (profileErr) throw profileErr;

  const expenseRows = EXPENSES_SEED.map((x) => ({
    id: crypto.randomUUID(),
    user_id: userId,
    date: x.date,
    description: x.desc,
    amount: x.amount,
    category_primary: x.primary,
    category_secondary: x.secondary || null,
    note: x.note || null,
  }));
  if (expenseRows.length) await insertInBatches("expenses", expenseRows);

  const assetRows = [];
  for (const [year, yr] of Object.entries(PATRIMONIO_SEED)) {
    for (const a of yr.assets) {
      assetRows.push({
        user_id: userId,
        year: Number(year),
        name: a.name,
        group_name: a.group,
        currency: a.currency,
        monthly: a.monthly,
        units: a.units ?? null,
        ammortamento: a.ammortamento ?? null,
      });
    }
  }
  if (assetRows.length) await insertInBatches("patrimonio_assets", assetRows);

  const priceRows = [];
  for (const [year, assets] of Object.entries(PRICES_SEED)) {
    for (const [name, p] of Object.entries(assets)) {
      priceRows.push({
        user_id: userId,
        year: Number(year),
        asset_name: name,
        start_price: p.start ?? null,
        monthly: p.monthly,
      });
    }
  }
  if (priceRows.length) await insertInBatches("asset_prices", priceRows);
}

/* ============ Caricamento con seed, deduplicato per utente ============ */
// In sviluppo React StrictMode invoca due volte l'effetto di caricamento iniziale:
// senza deduplica, due chiamate concorrenti vedrebbero entrambe "nessun profilo" e
// tenterebbero il seed in parallelo, con il rischio che una delle due rilegga i dati
// a metà inserimento (parziali) e li risalvi sovrascrivendo quelli completi.
const inFlightLoads = new Map();
export function loadOrSeedUserData(userId) {
  if (inFlightLoads.has(userId)) return inFlightLoads.get(userId);
  const promise = (async () => {
    let data = await loadUserData(userId);
    if (!data) {
      try {
        await seedInitialData(userId);
      } catch (seedErr) {
        console.warn("Seed iniziale non riuscito, ricarico i dati esistenti:", seedErr);
      }
      data = await loadUserData(userId);
    }
    return data;
  })();
  inFlightLoads.set(userId, promise);
  promise.finally(() => inFlightLoads.delete(userId));
  return promise;
}

/* ============ Salvataggio: sincronizza l'intero stato con Supabase ============ */
export async function persistUserData(userId, data) {
  const netWorthFallback = {};
  for (const [year, yr] of Object.entries(data.patrimonio)) {
    netWorthFallback[year] = yr.netWorth || Array(12).fill(null);
  }

  const { error: profileErr } = await supabase.from("profiles").upsert({
    id: userId,
    fx_eurchf: data.fxRates.EURCHF,
    fx_usdchf: data.fxRates.USDCHF,
    categories: data.categories,
    net_worth_fallback: netWorthFallback,
    updated_at: new Date().toISOString(),
  });
  if (profileErr) throw profileErr;

  const { error: delExpErr } = await supabase.from("expenses").delete().eq("user_id", userId);
  if (delExpErr) throw delExpErr;
  if (data.expenses.length) {
    const rows = data.expenses.map((e) => ({
      id: e.id,
      user_id: userId,
      date: e.date,
      description: e.desc,
      amount: e.amount,
      category_primary: e.primary,
      category_secondary: e.secondary || null,
      note: e.note || null,
    }));
    await insertInBatches("expenses", rows);
  }

  const { error: delMovErr } = await supabase.from("movements").delete().eq("user_id", userId);
  if (delMovErr) throw delMovErr;
  if (data.movements.length) {
    const rows = data.movements.map((m) => ({
      id: m.id,
      user_id: userId,
      date: m.date,
      tipo_label: m.tipoLabel,
      from_name: m.from ?? null,
      to_name: m.to ?? null,
      amount: m.amount ?? null,
      qty: m.qty ?? null,
      price: m.price ?? null,
      note: m.note || null,
    }));
    await insertInBatches("movements", rows);
  }

  const { error: delAssetsErr } = await supabase.from("patrimonio_assets").delete().eq("user_id", userId);
  if (delAssetsErr) throw delAssetsErr;
  const assetRows = [];
  for (const [year, yr] of Object.entries(data.patrimonio)) {
    for (const a of yr.assets) {
      assetRows.push({
        user_id: userId,
        year: Number(year),
        name: a.name,
        group_name: a.group,
        currency: a.currency,
        monthly: a.monthly,
        units: a.units ?? null,
        ammortamento: a.ammortamento ?? null,
      });
    }
  }
  if (assetRows.length) await insertInBatches("patrimonio_assets", assetRows);

  const { error: delPricesErr } = await supabase.from("asset_prices").delete().eq("user_id", userId);
  if (delPricesErr) throw delPricesErr;
  const priceRows = [];
  for (const [year, assets] of Object.entries(data.prices)) {
    for (const [name, p] of Object.entries(assets)) {
      priceRows.push({
        user_id: userId,
        year: Number(year),
        asset_name: name,
        start_price: p.start ?? null,
        monthly: p.monthly,
      });
    }
  }
  if (priceRows.length) await insertInBatches("asset_prices", priceRows);
}
