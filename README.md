# NAV_ Finanze

App personale di dashboard finanziaria (spese, patrimonio, movimenti) — Vite + React,
dati su Supabase, installabile come PWA sul telefono.

## Setup

1. **Supabase**
   - Crea un progetto su [supabase.com](https://supabase.com).
   - In *SQL Editor* esegui il contenuto di [`supabase/schema.sql`](supabase/schema.sql).
   - In *Authentication → Providers* verifica che Email sia attivo. Per uso personale
     conviene disattivare "Confirm email" (*Authentication → Settings*) così il primo
     accesso è immediato.
   - In *Project Settings → API* copia `Project URL` e `anon public key`.

2. **Variabili d'ambiente**
   ```
   cp .env.example .env.local
   ```
   e incolla `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY`.

3. **Avvio locale**
   ```
   npm install
   npm run dev
   ```
   Apri l'URL mostrato, registrati con email + password: al primo accesso i dati
   storici (spese, patrimonio, prezzi, categorie) vengono importati automaticamente
   nel tuo account.

## PWA

`npm run build && npm run preview` genera anche service worker e manifest.
Da telefono: apri il sito pubblicato, menu del browser → "Aggiungi a schermata Home".

## Deploy su Vercel

Vedi le istruzioni fornite in chat, oppure in breve:
```
npm install -g vercel
vercel
```
Imposta `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` come variabili d'ambiente
del progetto su Vercel (Project Settings → Environment Variables), poi `vercel --prod`.
