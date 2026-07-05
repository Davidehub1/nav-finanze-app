export function GlobalStyle() {
  return (
    <style>{`
      html, body { overflow-x: hidden; max-width: 100%; }
      @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600;700&family=Inter:wght@400;500;600;700&display=swap');
      .nav-root {
        --bg-void:#0D1017; --bg-panel:#161B24; --bg-raised:#1E2530; --border-hair:#2A3140;
        --text-primary:#E7EBF3; --text-muted:#7C8797; --text-dim:#4E576A;
        --mint:#4ADE9C; --coral:#FF6B6B; --amber:#F5B841; --blue:#5B8DEF;
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
      .nav-brand { font-family:'IBM Plex Mono', monospace; font-weight:700; font-size:19px; letter-spacing:0.5px; padding: 6px 10px 4px; color: var(--text-primary); }
      .nav-cursor { display:inline-block; width:9px; height:16px; background:var(--mint); margin-left:3px; vertical-align:-2px; animation: blink 1.1s steps(1) infinite; }
      @media (prefers-reduced-motion: reduce) { .nav-cursor { animation: none; } }
      @keyframes blink { 50% { opacity: 0; } }
      .nav-tagline { font-size:11px; color: var(--text-dim); padding: 0 10px 22px; letter-spacing: 0.3px; }
      .nav-item { display:flex; align-items:center; gap:10px; padding:10px 12px; border-radius:8px; color:var(--text-muted); font-size:14px; font-weight:500; cursor:pointer; border:none; background:none; width:100%; text-align:left; margin-bottom:2px; transition: background .12s, color .12s; }
      .nav-item:hover { background: var(--bg-raised); color: var(--text-primary); }
      .nav-item.active { background: var(--bg-raised); color: var(--text-primary); box-shadow: inset 2px 0 0 var(--mint); }
      .nav-main { flex:1; min-width: 0; padding: 28px 36px 60px; max-width: 1180px; }
      .nav-page-title { font-size:22px; font-weight:700; margin: 0 0 4px; }
      .nav-page-sub { color: var(--text-muted); font-size: 13px; margin: 0 0 24px; }
      .card { background: var(--bg-panel); border:1px solid var(--border-hair); border-radius:12px; padding:18px 20px; }
      .card-title { font-size:12px; text-transform:uppercase; letter-spacing:0.6px; color:var(--text-muted); font-weight:600; margin:0 0 14px; display:flex; align-items:center; gap:6px; justify-content:space-between; }
      .grid { display:grid; gap:16px; }
      .ticker { display:flex; background:var(--bg-panel); border:1px solid var(--border-hair); border-radius:12px; overflow:hidden; margin-bottom:22px; }
      .ticker-cell { flex:1; padding: 16px 20px; border-right:1px solid var(--border-hair); }
      .ticker-cell:last-child { border-right:none; }
      .ticker-label { font-size:10.5px; text-transform:uppercase; letter-spacing:0.6px; color:var(--text-dim); margin-bottom:6px; }
      .ticker-value { font-family:'IBM Plex Mono',monospace; font-size:22px; font-weight:600; font-variant-numeric: tabular-nums; }
      .ticker-delta { font-size:12px; margin-top:4px; display:flex; align-items:center; gap:3px; font-family:'IBM Plex Mono',monospace; }
      select, input, textarea {
        background: var(--bg-raised); border:1px solid var(--border-hair); color:var(--text-primary);
        border-radius:7px; padding:8px 10px; font-size:13px; font-family:'Inter',sans-serif; outline:none;
      }
      select:focus, input:focus, textarea:focus { border-color: var(--blue); }
      button.btn { background: var(--bg-raised); border:1px solid var(--border-hair); color:var(--text-primary); border-radius:7px; padding:8px 14px; font-size:13px; font-weight:600; cursor:pointer; display:inline-flex; align-items:center; gap:6px; transition: border-color .12s, background .12s; }
      button.btn:hover { border-color: var(--mint); }
      button.btn.primary { background: var(--mint); color:#0D1017; border-color:var(--mint); }
      button.btn.primary:hover { filter: brightness(1.08); }
      button.btn.danger:hover { border-color: var(--coral); color: var(--coral); }
      table.data-table { width:100%; border-collapse:collapse; font-size:13px; }
      table.data-table th { text-align:left; font-size:10.5px; text-transform:uppercase; letter-spacing:0.5px; color:var(--text-dim); font-weight:600; padding:8px 10px; border-bottom:1px solid var(--border-hair); }
      table.data-table td { padding:9px 10px; border-bottom:1px solid rgba(42,49,64,0.5); color:var(--text-primary); }
      table.data-table tr:hover td { background: var(--bg-raised); }
      .pill { display:inline-block; padding:2px 9px; border-radius:100px; font-size:11px; font-weight:600; background:var(--bg-raised); border:1px solid var(--border-hair); color:var(--text-muted); }
      .tabs-row { display:flex; gap:8px; margin-bottom:18px; flex-wrap:wrap; }
      .modal-overlay { position:fixed; inset:0; background:rgba(4,6,10,0.65); display:flex; align-items:center; justify-content:center; z-index:50; padding:20px; }
      .modal { background:var(--bg-panel); border:1px solid var(--border-hair); border-radius:14px; padding:22px 24px; width:100%; max-width:440px; max-height:88vh; overflow-y:auto; }
      .field-label { font-size:11.5px; color:var(--text-muted); margin-bottom:5px; display:block; font-weight:600; }
      .field { margin-bottom:13px; }
      .field input, .field select, .field textarea { width:100%; }
      .row-2 { display:grid; grid-template-columns:1fr 1fr; gap:10px; }
      ::-webkit-scrollbar { width:9px; height:9px; }
      ::-webkit-scrollbar-thumb { background: var(--border-hair); border-radius:6px; }
      .empty-state { text-align:center; padding:40px 20px; color:var(--text-dim); font-size:13px; }
      .icon-btn { background:none; border:none; color:var(--text-dim); cursor:pointer; padding:4px; display:inline-flex; }
      .icon-btn:hover { color: var(--coral); }
      .badge-amort { display:inline-flex; align-items:center; gap:4px; font-size:10.5px; color: var(--amber); background: rgba(245,184,65,0.12); border:1px solid rgba(245,184,65,0.35); padding:2px 7px; border-radius:100px; font-weight:600; }
      .page-header { display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:12px; margin-bottom:4px; }
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
        .nav-item { flex-direction: column; font-size: 9.5px; gap: 3px; padding: 7px 2px; margin-bottom: 0; text-align: center; flex: 1; }
        .nav-item.active { box-shadow: none; background: var(--bg-raised); border-radius: 10px; }
        .nav-main { max-width: 100%; padding: 16px 12px calc(84px + env(safe-area-inset-bottom, 0px)); }
        .nav-page-title { font-size: 19px; }
        .ticker { flex-wrap: wrap; }
        .ticker-cell { flex: 1 1 50%; border-right: 1px solid var(--border-hair); }
        .ticker-cell:nth-child(even) { border-right: none; }
        .ticker-cell:nth-child(n+3) { border-top: 1px solid var(--border-hair); }
        .ticker-value { font-size: 18px; }
        .grid-2col-wide, .grid-2col { grid-template-columns: 1fr; }
        .row-2 { grid-template-columns: 1fr; }
        .card { padding: 14px 8px; }
        .modal { padding: 18px; }
        .tabs-row .btn { flex: 1 1 auto; justify-content: center; }
        /* Evita lo zoom automatico di iOS Safari sui campi (richiede font-size >= 16px) */
        select, input, textarea { font-size: 16px; }
        table.data-table { font-size: 12.5px; }
        table.data-table th, table.data-table td { padding: 7px 6px; }

        /* Tabelle mensili (Patrimonio): compattate per stare tutte e 12 senza scroll laterale */
        table.data-table.month-table, table.data-table.price-table, table.data-table.month-table-simple { font-size: 8px; letter-spacing: -0.3px; width: 100%; table-layout: fixed; }
        table.data-table.month-table th, table.data-table.month-table td,
        table.data-table.price-table th, table.data-table.price-table td,
        table.data-table.month-table-simple th, table.data-table.month-table-simple td {
          padding: 3px 0; overflow: hidden; border-right: 1px solid rgba(42,49,64,0.6);
        }
        table.data-table.month-table th:last-child, table.data-table.month-table td:last-child,
        table.data-table.price-table th:last-child, table.data-table.price-table td:last-child,
        table.data-table.month-table-simple th:last-child, table.data-table.month-table-simple td:last-child {
          border-right: none;
        }
        table.data-table.month-table th:first-child, table.data-table.month-table td:first-child,
        table.data-table.price-table th:first-child, table.data-table.price-table td:first-child {
          width: 22px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding-left: 1px;
        }
        table.data-table.month-table th:nth-child(2), table.data-table.month-table td:nth-child(2) { display: none; }
        table.data-table.month-table th:last-child, table.data-table.month-table td:last-child { padding: 3px 0; width: 9px; }
        table.data-table.month-table td:last-child .icon-btn { padding: 0; }
        table.data-table.month-table td:last-child svg, table.data-table.price-table td:last-child svg { width: 11px; height: 11px; }
        table.data-table.month-table .badge-amort { display: none; }
        table.data-table.month-table th > div { font-size: 7.5px; }
        table.data-table.price-table th:nth-last-child(-n+3), table.data-table.price-table td:nth-last-child(-n+3) { display: none; }
      }
    `}</style>
  );
}
