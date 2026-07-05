-- ============================================================
-- Schema per NAV_ — versione multi-dispositivo su Supabase
-- Da eseguire in: Supabase Dashboard → SQL Editor → New query
-- ============================================================

-- Profilo utente: tassi di cambio e categorie (un solo utente per riga)
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  fx_eurchf numeric not null default 0.92,
  fx_usdchf numeric not null default 0.80,
  categories jsonb not null default '{}'::jsonb,
  -- fallback storico del patrimonio netto per i mesi non ricostruibili dai singoli asset
  -- (necessario per non perdere i valori mensili già noti prima del tracking per-asset)
  net_worth_fallback jsonb not null default '{}'::jsonb,
  display_name text,
  updated_at timestamptz not null default now()
);

-- Spese
create table expenses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  description text not null,
  amount numeric not null,
  category_primary text not null,
  category_secondary text,
  note text,
  created_at timestamptz not null default now()
);

-- Asset del patrimonio (un asset = una riga, per anno)
create table patrimonio_assets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  year int not null,
  name text not null,
  group_name text not null,          -- 'Investimenti' | 'Cash/liquidità' | 'Mezzi di trasporto'
  currency text not null default 'F', -- F=CHF, E=EUR, D=USD
  monthly numeric[12],                -- valore esplicito per mese (null = non compilato)
  units numeric,                      -- se valorizzato: asset quotato, valore = units * prezzo del mese
  ammortamento jsonb,                 -- { enabled, acquisitionValue, acquisitionDate, annualRate }
  created_at timestamptz not null default now()
);

-- Prezzo per quota degli investimenti (uno storico per anno/asset)
create table asset_prices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  year int not null,
  asset_name text not null,
  start_price numeric,
  monthly numeric[12],
  unique (user_id, year, asset_name)
);

-- Movimenti patrimoniali (acquisti/vendite/giroconti)
create table movements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  tipo_label text not null,
  from_name text,
  to_name text,
  amount numeric,
  qty numeric,
  price numeric,
  note text,
  created_at timestamptz not null default now()
);

-- ============================================================
-- Row Level Security: ognuno vede/modifica SOLO i propri dati
-- ============================================================
alter table profiles enable row level security;
alter table expenses enable row level security;
alter table patrimonio_assets enable row level security;
alter table asset_prices enable row level security;
alter table movements enable row level security;

create policy "profiles: solo il proprio" on profiles
  for all using (auth.uid() = id) with check (auth.uid() = id);

create policy "expenses: solo le proprie" on expenses
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "patrimonio_assets: solo i propri" on patrimonio_assets
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "asset_prices: solo i propri" on asset_prices
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "movements: solo i propri" on movements
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Indici utili
create index idx_expenses_user_date on expenses(user_id, date);
create index idx_patrimonio_user_year on patrimonio_assets(user_id, year);
create index idx_prices_user_year on asset_prices(user_id, year);
create index idx_movements_user_date on movements(user_id, date);
