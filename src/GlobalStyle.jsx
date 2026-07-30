export function GlobalStyle() {
  return (
    <style>{`
      html, body { overflow-x: hidden; max-width: 100%; }
      @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600;700&family=Inter:wght@400;500;600;700&display=swap');
      .nav-root {
        --bg-void:#0D1017; --bg-panel:#161B24; --bg-raised:#1E2530; --border-hair:#2A3140;
        --text-primary:#E7EBF3; --text-muted:#7C8797; --text-dim:#4E576A;
        --mint:#4ADE9C; --coral:#FF6B6B; --amber:#F5B841; --blue:#5B8DEF;
        /* Scala tipografica: otto misure per tutta l'app. Prima erano quindici,
           quasi indistinguibili fra loro (10.5 / 11 / 11.5 / 12 / 12.5 …), il che
           faceva sembrare l'interfaccia assemblata invece che disegnata. */
        --fs-micro:11px;  /* etichette maiuscole, intestazioni di tabella, pill */
        --fs-sm:12.5px;   /* testo secondario, titoli delle schede */
        --fs-base:13px;   /* celle, campi, bottoni */
        --fs-md:15px;     /* voci di menu, selettore mese */
        --fs-lg:17px;     /* titoli delle finestre, valori nella vista mese */
        --fs-xl:19px;     /* marchio, titolo di sezione su telefono */
        --fs-2xl:22px;    /* titolo di sezione, cifre del riquadro in alto */
        --fs-hero:28px;   /* patrimonio netto del mese, su telefono */
        font-family: 'Inter', sans-serif;
        background: var(--bg-void);
        color: var(--text-primary);
        min-height: 100vh;
        max-width: 100vw;
        overflow-x: hidden;
        display: flex;
      }
      .nav-root * { box-sizing: border-box; }
      .mono { font-family: 'IBM Plex Mono', monospace; font-variant-numeric: tabular-nums; }
      .nav-sidebar {
        width: 220px; flex-shrink: 0; background: var(--bg-panel);
        border-right: 1px solid var(--border-hair);
        display: flex; flex-direction: column; padding: 20px 14px;
        position: sticky; top: 0; height: 100vh;
      }
      .nav-brand { font-family:'IBM Plex Mono', monospace; font-weight:700; font-size:var(--fs-xl); letter-spacing:0.5px; padding: 6px 10px 4px; color: var(--text-primary); }
      .nav-cursor { display:inline-block; width:9px; height:16px; background:var(--mint); margin-left:3px; vertical-align:-2px; animation: blink 1.1s steps(1) infinite; }
      @media (prefers-reduced-motion: reduce) { .nav-cursor { animation: none; } }
      @keyframes blink { 50% { opacity: 0; } }
      .nav-tagline { font-size:var(--fs-micro); color: var(--text-dim); padding: 0 10px 22px; letter-spacing: 0.3px; }
      .nav-item { display:flex; align-items:center; gap:10px; padding:10px 12px; border-radius:8px; color:var(--text-muted); font-size:var(--fs-md); font-weight:500; cursor:pointer; border:none; background:none; width:100%; text-align:left; margin-bottom:2px; transition: background .12s, color .12s; }
      .nav-item:hover { background: var(--bg-raised); color: var(--text-primary); }
      .nav-item.active { background: var(--bg-raised); color: var(--text-primary); box-shadow: inset 2px 0 0 var(--mint); }
      .nav-main { flex:1; min-width: 0; padding: 28px 36px 60px; max-width: 1180px; }
      .nav-page-title { font-size:var(--fs-2xl); font-weight:700; margin: 0 0 4px; }
      .nav-page-sub { color: var(--text-muted); font-size: var(--fs-base); margin: 0 0 24px; }
      .card { background: var(--bg-panel); border:1px solid var(--border-hair); border-radius:12px; padding:18px 20px; }
      .card-title { font-size:var(--fs-sm); text-transform:uppercase; letter-spacing:0.6px; color:var(--text-muted); font-weight:600; margin:0 0 14px; display:flex; align-items:center; gap:6px; justify-content:space-between; }
      .grid { display:grid; gap:16px; }
      .ticker { display:flex; background:var(--bg-panel); border:1px solid var(--border-hair); border-radius:12px; overflow:hidden; margin-bottom:22px; }
      .ticker-cell { flex:1; padding: 16px 20px; border-right:1px solid var(--border-hair); }
      .ticker-cell:last-child { border-right:none; }
      .ticker-label { font-size:var(--fs-micro); text-transform:uppercase; letter-spacing:0.6px; color:var(--text-dim); margin-bottom:6px; }
      .ticker-value { font-family:'IBM Plex Mono',monospace; font-size:var(--fs-2xl); font-weight:600; font-variant-numeric: tabular-nums; }
      .ticker-delta { font-size:var(--fs-sm); margin-top:4px; display:flex; align-items:center; gap:3px; font-family:'IBM Plex Mono',monospace; }
      select, input, textarea {
        background: var(--bg-raised); border:1px solid var(--border-hair); color:var(--text-primary);
        border-radius:7px; padding:8px 10px; font-size:var(--fs-base); font-family:'Inter',sans-serif; outline:none;
      }
      select:focus, input:focus, textarea:focus { border-color: var(--blue); }
      button.btn { background: var(--bg-raised); border:1px solid var(--border-hair); color:var(--text-primary); border-radius:7px; padding:8px 14px; font-size:var(--fs-base); font-weight:600; cursor:pointer; display:inline-flex; align-items:center; gap:6px; transition: border-color .12s, background .12s; }
      button.btn:hover { border-color: var(--mint); }
      button.btn.primary { background: var(--mint); color:#0D1017; border-color:var(--mint); }
      button.btn.primary:hover { filter: brightness(1.08); }
      button.btn.danger:hover { border-color: var(--coral); color: var(--coral); }
      table.data-table { width:100%; border-collapse:collapse; font-size:var(--fs-base); }
      table.data-table th { text-align:left; font-size:var(--fs-micro); text-transform:uppercase; letter-spacing:0.5px; color:var(--text-dim); font-weight:600; padding:8px 10px; border-bottom:1px solid var(--border-hair); }
      table.data-table td { padding:9px 10px; border-bottom:1px solid rgba(42,49,64,0.5); color:var(--text-primary); }
      table.data-table tr:hover td { background: var(--bg-raised); }
      .pill { display:inline-block; padding:2px 9px; border-radius:100px; font-size:var(--fs-micro); font-weight:600; background:var(--bg-raised); border:1px solid var(--border-hair); color:var(--text-muted); }
      .tabs-row { display:flex; gap:8px; margin-bottom:18px; flex-wrap:wrap; }
      .modal-overlay { position:fixed; inset:0; background:rgba(4,6,10,0.65); display:flex; align-items:center; justify-content:center; z-index:50; padding:20px; }
      .modal { background:var(--bg-panel); border:1px solid var(--border-hair); border-radius:14px; padding:22px 24px; width:100%; max-width:440px; max-height:88vh; overflow-y:auto; }
      .field-label { font-size:var(--fs-micro); color:var(--text-muted); margin-bottom:5px; display:block; font-weight:600; }
      .field { margin-bottom:13px; }
      .field input, .field select, .field textarea { width:100%; }
      .row-2 { display:grid; grid-template-columns:1fr 1fr; gap:10px; }
      ::-webkit-scrollbar { width:9px; height:9px; }
      ::-webkit-scrollbar-thumb { background: var(--border-hair); border-radius:6px; }
      .empty-state { text-align:center; padding:40px 20px; color:var(--text-dim); font-size:var(--fs-base); }
      .icon-btn { background:none; border:none; color:var(--text-dim); cursor:pointer; padding:4px; display:inline-flex; border-radius:6px; }
      /* Al passaggio del mouse l'icona si schiarisce e basta. Il rosso è riservato
         al cestino (.danger): è l'unico gesto che distrugge qualcosa. */
      .icon-btn:hover { color: var(--text-primary); background: var(--bg-raised); }
      .icon-btn.danger:hover { color: var(--coral); background: rgba(255,107,107,0.10); }
      .badge-amort { display:inline-flex; align-items:center; gap:4px; font-size:var(--fs-micro); color: var(--amber); background: rgba(245,184,65,0.12); border:1px solid rgba(245,184,65,0.35); padding:2px 7px; border-radius:100px; font-weight:600; }
      /* Modo riordino: le schede ripiegate in barrette che si spostano col dito.
         touch-action:none serve perché la pagina non scorra mentre trascini. */
      .riordino-barra {
        display:flex; align-items:center; gap:10px; height:46px; padding:0 14px; margin-bottom:8px;
        background:var(--bg-panel); border:1px solid var(--border-hair); border-radius:10px;
        font-size:var(--fs-base); font-weight:600; color:var(--text-primary);
        touch-action:none; user-select:none; cursor:grab;
      }
      .riordino-barra.attiva { border-color:var(--mint); background:var(--bg-raised); box-shadow:0 8px 20px rgba(0,0,0,0.45); cursor:grabbing; }
      .riordino-barra:not(.attiva) { animation: tremolio .28s ease-in-out infinite alternate; }
      @keyframes tremolio { from { transform: rotate(-0.5deg); } to { transform: rotate(0.5deg); } }
      @media (prefers-reduced-motion: reduce) { .riordino-barra:not(.attiva) { animation:none; } }

      .page-header { display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:12px; margin-bottom:4px; }

      /* Intestazione: titolo a sinistra, stato e azioni (icone tenui) a destra */
      .app-header { display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom:14px; }
      .app-header-actions { display:flex; align-items:center; gap:4px; flex-shrink:0; }
      .header-action { color: var(--text-dim); padding:6px; border-radius:7px; }
      .header-action:hover { color: var(--text-primary); background: var(--bg-raised); }
      /* Riga dei controlli di contesto (anno, mese, azioni della sezione) */
      .page-toolbar { display:flex; align-items:center; gap:8px; flex-wrap:wrap; margin-bottom:18px; }
      /* Selettore mese: ‹ mese › */
      .month-stepper { display:flex; align-items:center; gap:6px; }
      .month-stepper-label {
        display:flex; align-items:center; justify-content:center; font-weight:700; font-size:var(--fs-md);
        min-width:104px; padding:8px 10px; white-space:nowrap;
        background: var(--bg-raised); border:1px solid var(--border-hair); border-radius:7px;
      }
      .grid-2col-wide { display:grid; gap:16px; grid-template-columns: 1.4fr 1fr; }
      .grid-2col { display:grid; gap:16px; grid-template-columns: 1fr 1fr; }

      /* ============ MOBILE (telefono) ============ */
      @media (max-width: 760px) {
        .nav-root { flex-direction: column; }
        .nav-sidebar {
          position: fixed; bottom: 0; left: 0; right: 0; top: auto; height: auto; width: 100%;
          flex-direction: row; justify-content: space-around; align-items: stretch;
          padding: 4px 2px calc(4px + env(safe-area-inset-bottom, 0px));
          border-right: none; border-top: 1px solid var(--border-hair); z-index: 40;
        }
        .nav-brand, .nav-tagline { display: none; }
        .nav-item { flex-direction: column; font-size: var(--fs-micro); gap: 3px; padding: 6px 2px; margin-bottom: 0; text-align: center; flex: 1; }
        .nav-item.active { box-shadow: none; background: var(--bg-raised); border-radius: 10px; }
        /* padding-top con safe-area: sull'app installata (PWA) la barra di stato del telefono copre la parte alta */
        .nav-main { max-width: 100%; padding: calc(20px + env(safe-area-inset-top, 0px)) 12px calc(84px + env(safe-area-inset-bottom, 0px)); }
        .nav-page-title { font-size: var(--fs-xl); }
        .ticker { flex-wrap: wrap; }
        .ticker-cell { flex: 1 1 50%; border-right: 1px solid var(--border-hair); }
        .ticker-cell:nth-child(even) { border-right: none; }
        .ticker-cell:nth-child(n+3) { border-top: 1px solid var(--border-hair); }
        .ticker-value { font-size: var(--fs-xl); }
        .grid-2col-wide, .grid-2col { grid-template-columns: 1fr; }
        .row-2 { grid-template-columns: 1fr; }
        .card { padding: 14px 14px; }
        .modal { padding: 18px; }
        .tabs-row .btn { flex: 1 1 auto; justify-content: center; }
        /* Evita lo zoom automatico di iOS Safari sui campi (richiede font-size >= 16px) */
        select, input, textarea { font-size: 16px; }
        table.data-table { font-size: var(--fs-sm); }
        table.data-table th, table.data-table td { padding: 7px 6px; }

        /* Su telefono i controlli riempiono la riga: bersagli grandi, niente
           spazio sprecato ai lati. Lo stepper si adatta a ciò che gli sta
           accanto (anno, azione) invece di forzare un a capo. */
        .page-toolbar { gap: 8px; }
        .month-stepper { flex: 1 1 200px; }
        .month-stepper .btn { flex: 0 0 auto; justify-content: center; padding: 12px 14px; }
        .month-stepper-label { flex: 1; font-size: var(--fs-md); padding: 12px 4px; min-width: 0; }
        .page-toolbar > select, .page-toolbar > .btn { flex: 0 1 auto; }

        /* Mese corrente (Patrimonio): righe grandi e comode al tocco */
        .month-row { display: flex; align-items: center; justify-content: space-between; padding: 12px 4px; border-bottom: 1px solid rgba(42,49,64,0.5); }
        .month-row:last-child { border-bottom: none; }
        .month-row-value { font-size: var(--fs-lg); font-weight: 600; }
        .month-tabs { display: flex; gap: 8px; margin-bottom: 14px; }
        .month-tabs .btn { flex: 1; justify-content: center; }
      }
    `}</style>
  );
}
