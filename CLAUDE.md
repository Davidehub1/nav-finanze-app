# Analisi spese — contesto del progetto

App personale di Davide per tracciare **spese** e **patrimonio**. Interfaccia in
italiano, uso quotidiano soprattutto **da telefono** (installata come PWA).

## Dove vive

| | |
|---|---|
| Codice | questa cartella, su GitHub: `Davidehub1/nav-finanze-app` |
| Sito | https://nav-finanze-app-davidehub1s-projects.vercel.app |
| Database + login | Supabase (progetto `ptgbiogpgcnrzcqskhsy`) |

**Pubblicazione**: `git push` su `main` → Vercel ripubblica da solo in 1-2 minuti.
Davide non tocca mai il terminale: si fa tutto qui.

Credenziali locali in `.env.local` (non versionato). L'account di test è quello
reale di Davide — **i dati sono veri, non di prova**.

## Come lavorare (convenzioni concordate)

- **Rispondere in italiano**, senza gergo tecnico: Davide non è uno sviluppatore.
  Spiegare cosa cambia per lui, non come è implementato.
- **Verificare sempre dal vivo** prima di pubblicare: `npm run build`, poi provare
  nel browser con i dati veri (login: `davide.falange@icloud.com`). Non dire "fatto"
  senza aver visto funzionare.
- **Testare sia desktop sia mobile** (breakpoint 760px): il mobile è il caso d'uso
  principale.
- Dopo ogni modifica accettata: commit + push (messaggi in inglese, resto in italiano).

## Principi di design emersi dall'uso

1. **Prima i dati, poi le spiegazioni.** Entrando in una sezione si vedono subito i
   numeri: niente sottotitoli descrittivi, niente istruzioni che servono una volta sola.
2. **Le funzioni opzionali non devono costare nulla a chi non le usa.** Esempio: i
   budget per categoria — se non ne imposti nessuno, l'interfaccia è *identica* a
   prima, nemmeno la parola "budget" compare. Quando attivi un budget, appare come
   nota grigia nella riga esistente, ambra solo se superato. Mai avvisi invadenti.
3. **Azioni secondarie discrete**: nell'intestazione sono icone tenui, e compaiono
   solo se hanno senso ("Salva" solo con modifiche non salvate, dato che c'è
   l'autosalvataggio).
4. Su telefono i controlli riempiono la larghezza (niente spazio sprecato ai lati),
   con bersagli comodi al tocco (~46×42px).

## Architettura in breve

- `src/App.jsx` — quasi tutta l'app (grande ma volutamente in un file solo).
- `src/lib/dataStore.js` — lettura/scrittura Supabase.
- `api/prices.js` + `api/_yahoo.js` — funzione serverless che fa da ponte verso
  Yahoo Finance (il browser non può chiamarlo per via del CORS). In sviluppo la
  stessa logica è servita da un middleware in `vite.config.js`.
- `supabase/schema.sql` — schema di riferimento, da tenere allineato al database.

### Regole sui dati (imparate a caro prezzo)

- **Mai cancellare prima di aver scritto con successo.** Il salvataggio usa
  aggiorna-o-inserisci e rimuove solo le righe davvero eliminate. In passato un
  "cancella tutto e reinserisci" fallito a metà ha azzerato 505 spese.
- **Se il caricamento iniziale fallisce, il salvataggio resta bloccato** e si mostra
  la schermata "Dati non caricati": salvare uno stato vuoto sovrascriverebbe tutto.
- Le colonne aggiunte a `profiles` nel tempo: `net_worth_fallback`, `display_name`,
  `tickers`, `fx_history`, `budgets`, `fatture`. Aggiungerne altre richiede un
  `alter table` che deve eseguire Davide (io non ho accesso alla sua console
  Supabase) **prima** di pubblicare: il salvataggio scrive tutte le colonne
  insieme, quindi una colonna mancante blocca ogni salvataggio.

### Convenzioni di calcolo

- `Entrate` e `Investimenti e risp` **non sono spese**: escluse da totali, torta e
  ripartizioni (vedi `isSpesa`).
- Ogni mese è convertito in CHF con il **cambio di quel mese** (`fx_history`),
  scaricato da Yahoo. Non esiste più un tasso manuale.
- Il patrimonio netto mostrato in Dashboard è quello del **mese selezionato** e
  coincide con la riga in fondo alla scheda Patrimonio.
- Le **fatture pagate in una volta ma di competenza di più mesi** (risconti attivi)
  si inseriscono in Strumenti → Fatture: lo stesso modulo genera le rate nelle Spese
  e, nel Patrimonio, la riga calcolata "Fatture già pagate" (gruppo "Altre attività").
  Quella riga **non è un asset salvato**: si ricalcola sempre da `profiles.fatture`
  e viene aggiunta in fondo agli asset dell'anno, così le posizioni salvate — su cui
  si basano `updateAsset`/`deleteAsset` — non cambiano. Il mese del pagamento è già
  consumato (600 su 12 mesi da maggio ⇒ a fine maggio restano 550).
- I prezzi degli investimenti si aggiornano da soli all'apertura, tramite i simboli
  Yahoo in `profiles.tickers` (VWCE.MI, SYBZ.DE, VHYL.L→convertito in CHF, UBSG.SW).

### Le quattro cose "in più" e dove vivono

Sono state aggiunte senza creare schede nuove: la regola concordata è che ogni cosa
entri dentro qualcosa che c'è già, altrimenti la Dashboard diventa un cruscotto.

| Cosa | Dove |
|---|---|
| Curva continua su più anni, divisa per gruppo | scheda "Composizione del patrimonio" (sostituisce "Evoluzione patrimonio"), con bottone "Solo {anno}" |
| Rendimento degli investimenti | riga grigia sotto il titolo del pannello investimenti |
| Mesi di autonomia | intestazione del gruppo "Cash/liquidità" |
| Confronto con lo stesso mese dell'anno prima | riga "Totale spese" della ripartizione (solo sul totale, non per categoria) |
| Riepilogo del mese chiuso | in cima alla Dashboard, una volta al mese; il "già letto" sta in `localStorage`, non nei dati |

Il rendimento misura **solo il movimento dei prezzi** sulle quote attuali: i
versamenti fatti durante l'anno non vanno mescolati, altrimenti sembrerebbe
guadagno del denaro semplicemente aggiunto.

## Stato e cose in sospeso

Funzionante: dashboard, spese, patrimonio (mese corrente + storico), ammortamento,
fatture (rate + risconti attivi), movimenti, categorie, budget opzionali, prezzi e
cambi automatici, export Excel/JSON, PWA.

Da fare quando Davide lo decide: nel Patrimonio ci sono ancora due righe compilate
a mano — "Fatture già pagate" e "Fatture ironamn già pagate" in Cash/liquidità —
che facevano questo lavoro manualmente. Vanno svuotate/cancellate man mano che le
fatture entrano in Strumenti → Fatture, altrimenti gli importi si contano due volte.

Da valutare, in ordine di utilità (analisi fatta confrontando app simili):

1. **Spese ricorrenti** — Davide reinserisce a mano ogni mese abbonamento palestra,
   treno e stipendio. È il risparmio di tempo maggiore.
2. **Rendimento degli investimenti** — oggi vede il valore ma non quanto ha
   guadagnato; i dati per calcolarlo ci sono già.
3. **Import da CSV/Excel** — oggi si esporta soltanto; serve anche per ripristinare
   un backup JSON.
4. **Sezione Movimenti**: mai usata (0 righe). Candidata alla rimozione.

Da non fare: collegamento automatico ai conti bancari (costoso, copre male le banche
svizzere, e richiederebbe di affidare le credenziali a terzi).

Aperto: il foglio "Expenses 25" del file Excel di Davide potrebbe contenere spese
2025 non ancora importate (nell'app ce ne sono 330) — da verificare se glielo chiede.
