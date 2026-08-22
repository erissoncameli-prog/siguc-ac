// ── SIGUC-AC · Layout compartilhado ───────────────────────────

(function(){
  if (!document.querySelector('link[href*="sidebar.css"]')) {
    const link = document.createElement('link');
    link.rel = 'stylesheet'; link.href = '../css/sidebar.css';
    document.head.appendChild(link);
  }
})();

// Barra de progresso de navegação
;(function() {
  const bar = document.createElement('div');
  bar.id = 'siguc-progress-bar';
  function _mountBar() {
    if (document.body) {
      document.body.appendChild(bar);
      requestAnimationFrame(() => requestAnimationFrame(() => { bar.style.width = '42%'; }));
      setTimeout(() => { bar.style.width = '72%'; }, 460);
      window._sigucBar = bar;
    } else {
      document.addEventListener('DOMContentLoaded', _mountBar, { once: true });
    }
  }
  _mountBar();
})();

function _sigucBarCompleta() {
  const bar = window._sigucBar || document.getElementById('siguc-progress-bar');
  if (!bar || bar._concluida) return;
  bar._concluida = true;
  bar.style.transition = 'width 0.18s ease';
  bar.style.width = '100%';
  setTimeout(() => { bar.style.transition = 'width 0.18s ease, opacity 0.32s ease'; bar.style.opacity = '0'; }, 210);
}

function fecharSidebarMobile() {
  document.querySelector('.sidebar')?.classList.remove('aberta');
  document.querySelector('.sidebar-overlay')?.classList.remove('ativo');
}

function gerarLayout(tituloPagina, paginaAtiva) {
  // Modo embutido (?embed=1): usado pelas abas de frota-administrar.html
  // pra mostrar cada página existente dentro de um iframe sem duplicar
  // sidebar/topbar. Sem esse parâmetro, comportamento 100% igual ao de
  // sempre — nenhuma página existente é afetada.
  if (new URLSearchParams(location.search).get('embed') === '1') {
    return `<div class="app-layout app-layout-embed"><div class="main-content"><div class="page-body page-body-embed">`;
  }
  const iconePills = {
    dashboard:    { svg: '<rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/><rect width="7" height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/>', cor: '#60a5fa', bg: 'rgba(96,165,250,0.22)' },
    mapa:         { svg: '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>', cor: '#2dd4bf', bg: 'rgba(45,212,191,0.22)' },
    unidades:     { svg: '<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>', cor: '#34d399', bg: 'rgba(52,211,153,0.22)' },
    monitoramento:{ svg: '<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>', cor: '#a78bfa', bg: 'rgba(167,139,250,0.22)' },
    ocorrencias:  { svg: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/>', cor: '#fb7185', bg: 'rgba(251,113,133,0.22)' },
    documentos:   { svg: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/>', cor: '#fbbf24', bg: 'rgba(251,191,36,0.22)' },
    relatorios:   { svg: '<line x1="18" x2="18" y1="20" y2="10"/><line x1="12" x2="12" y1="20" y2="4"/><line x1="6" x2="6" y1="20" y2="14"/>', cor: '#f97316', bg: 'rgba(249,115,22,0.22)' },
    equipe:       { svg: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>', cor: '#67e8f9', bg: 'rgba(103,232,249,0.22)' },
    usuarios:     { svg: '<circle cx="18" cy="15" r="3"/><circle cx="9" cy="7" r="4"/><path d="M10 15H6a4 4 0 0 0-4 4v2"/><path d="m21.7 16.4-.9-.3"/><path d="m15.2 13.9-.9-.3"/><path d="m16.6 18.7.3-.9"/><path d="m19.1 12.2.3-.9"/>', cor: '#e2e8f0', bg: 'rgba(226,232,240,0.15)' },
    configuracoes:          { svg: '<path d="M20 7h-9"/><path d="M14 17H5"/><circle cx="17" cy="17" r="3"/><circle cx="7" cy="7" r="3"/>', cor: '#94a3b8', bg: 'rgba(148,163,184,0.18)' },
    'estrutura-organizacional': { svg: '<rect x="2" y="7" width="6" height="4" rx="1"/><rect x="9" y="3" width="6" height="4" rx="1"/><rect x="9" y="11" width="6" height="4" rx="1"/><rect x="16" y="7" width="6" height="4" rx="1"/><path d="M5 11v2h14v-2"/><path d="M12 7V5"/>', cor: '#c4b5fd', bg: 'rgba(196,181,253,0.22)' },
    'saude-sistema':            { svg: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>', cor: '#22d3ee', bg: 'rgba(34,211,238,0.22)' },
    'alertas-ambientais':       { svg: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/>', cor: '#fb923c', bg: 'rgba(251,146,60,0.22)' },
    'painel-gestor':            { svg: '<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/><circle cx="18" cy="5" r="3" fill="currentColor"/>', cor: '#818cf8', bg: 'rgba(129,140,248,0.22)' },
    'pesquisas':                { svg: '<path d="M9 2H5a2 2 0 0 0-2 2v4m6-6h10a2 2 0 0 1 2 2v4M9 2v20m0 0h10a2 2 0 0 0 2-2V8M9 22H5a2 2 0 0 1-2-2V8m0 0h18"/>', cor: '#38bdf8', bg: 'rgba(56,189,248,0.22)' },
    'dashboard-executivo':      { svg: '<path d="M3 3v18h18"/><path d="m19 9-5 5-4-4-3 3"/>', cor: '#4ade80', bg: 'rgba(74,222,128,0.22)' },
    'netflora':                 { svg: '<path d="M12 2a10 10 0 0 1 10 10c0 4-2 7-5 9M12 2a10 10 0 0 0-10 10c0 4 2 7 5 9M12 2v20M2 12h20"/>', cor: '#86efac', bg: 'rgba(134,239,172,0.22)' },
    'brigadas':                 { svg: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/><line x1="12" y1="16" x2="12" y2="22"/><line x1="9" y1="19" x2="15" y2="19"/>', cor: '#f87171', bg: 'rgba(248,113,113,0.22)' },
    'brigada-app':              { svg: '<path d="M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7z"/>', cor: '#fb923c', bg: 'rgba(251,146,60,0.22)' },
    'admin-brigadas':           { svg: '<circle cx="12" cy="8" r="4"/><path d="M6 20v-2a6 6 0 0 1 12 0v2"/><line x1="19" y1="11" x2="19" y2="17"/><line x1="16" y1="14" x2="22" y2="14"/>', cor: '#f87171', bg: 'rgba(248,113,113,0.18)' },
    'validacao-campo':          { svg: '<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>', cor: '#4ade80', bg: 'rgba(74,222,128,0.22)' },
    'relatorios-brigadas':      { svg: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/>', cor: '#f87171', bg: 'rgba(248,113,113,0.18)' },
    'biomonitor-app':           { svg: '<circle cx="12" cy="10" r="3"/><path d="M12 2a8 8 0 0 1 8 8c0 5-8 12-8 12S4 15 4 10a8 8 0 0 1 8-8z"/>', cor: '#2A9D6F', bg: 'rgba(42,157,111,0.22)' },
    'biomonitor-validacao':     { svg: '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>', cor: '#7ECEE8', bg: 'rgba(126,206,232,0.22)' },
    'biomonitor-bercarios':     { svg: '<rect x="2" y="7" width="20" height="13" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/><line x1="12" y1="12" x2="12" y2="16"/><line x1="10" y1="14" x2="14" y2="14"/>', cor: '#2A9D6F', bg: 'rgba(42,157,111,0.18)' },
    'relatorios-biomonitor':    { svg: '<line x1="18" x2="18" y1="20" y2="10"/><line x1="12" x2="12" y1="20" y2="4"/><line x1="6" x2="6" y1="20" y2="14"/>', cor: '#1A6B8C', bg: 'rgba(26,107,140,0.22)' },
    'analise-cientifica-biomonitor': { svg: '<path d="M9 2v6l-4 8a2 2 0 0 0 2 3h10a2 2 0 0 0 2-3l-4-8V2"/><path d="M8 2h8"/><path d="M7 16h10"/>', cor: '#C9A84C', bg: 'rgba(201,168,76,0.22)' },
    'admin-biomonitor':         { svg: '<path d="M12 2H2v10l9.29 9.29c.94.94 2.48.94 3.42 0l6.58-6.58c.94-.94.94-2.48 0-3.42L12 2z"/><circle cx="7" cy="7" r="1.5"/>', cor: '#1A6B8C', bg: 'rgba(26,107,140,0.18)' },
    'biomonitor-equipamentos':  { svg: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>', cor: '#2A9D6F', bg: 'rgba(42,157,111,0.18)' },
    'frota-veiculos':           { svg: '<path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2"/><circle cx="7" cy="17" r="2"/><path d="M9 17h6"/><circle cx="17" cy="17" r="2"/>', cor: '#fbbf24', bg: 'rgba(251,191,36,0.22)' },
    'frota-administrar':        { svg: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>', cor: '#fbbf24', bg: 'rgba(251,191,36,0.22)' },
    'frota-viagens':            { svg: '<rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/><path d="m9 16 2 2 4-4"/>', cor: '#60a5fa', bg: 'rgba(96,165,250,0.22)' },
    'frota-solicitar':          { svg: '<path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2"/><circle cx="7" cy="17" r="2"/><path d="M9 17h6"/><circle cx="17" cy="17" r="2"/><line x1="12" y1="6" x2="12" y2="6.01"/>', cor: '#4ade80', bg: 'rgba(74,222,128,0.22)' },
    'frota-manutencao':         { svg: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>', cor: '#a78bfa', bg: 'rgba(167,139,250,0.22)' },
    'frota-tarefas':            { svg: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="m9 12 2 2 4-4"/>', cor: '#67e8f9', bg: 'rgba(103,232,249,0.22)' },
    'frota-abastecimentos':     { svg: '<line x1="3" y1="22" x2="15" y2="22"/><line x1="4" y1="9" x2="14" y2="9"/><path d="M14 22V4a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v18"/><path d="M14 13h2a2 2 0 0 1 2 2v2a2 2 0 0 0 2 2 2 2 0 0 0 2-2V9.83a2 2 0 0 0-.59-1.42L18 5"/>', cor: '#f97316', bg: 'rgba(249,115,22,0.22)' },
    'frota-contratos':          { svg: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>', cor: '#38bdf8', bg: 'rgba(56,189,248,0.22)' },
    'frota-inspecoes':          { svg: '<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>', cor: '#34d399', bg: 'rgba(52,211,153,0.22)' },
    'frota-app':                { svg: '<rect x="5" y="2" width="14" height="20" rx="2" ry="2"/><line x1="12" y1="18" x2="12.01" y2="18"/>', cor: '#2dd4bf', bg: 'rgba(45,212,191,0.22)' },
    'agua-app':                 { svg: '<path d="M12 2s7 8.5 7 13a7 7 0 0 1-14 0c0-4.5 7-13 7-13z"/>', cor: '#0284c7', bg: 'rgba(2,132,199,0.22)' },
    'agua-mapa':                { svg: '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>', cor: '#0ea5e9', bg: 'rgba(14,165,233,0.22)' },
    'agua-pontos':              { svg: '<path d="M12 2s7 8.5 7 13a7 7 0 0 1-14 0c0-4.5 7-13 7-13z"/>', cor: '#38bdf8', bg: 'rgba(56,189,248,0.22)' },
    'agua-laudos':              { svg: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><path d="M12 11s2.5 3 2.5 4.7a2.5 2.5 0 0 1-5 0C9.5 14 12 11 12 11z"/>', cor: '#0ea5e9', bg: 'rgba(14,165,233,0.22)' },
    'agua-conferencia':         { svg: '<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>', cor: '#0891b2', bg: 'rgba(8,145,178,0.22)' },
    'agua-relatorios':          { svg: '<rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>', cor: '#0284c7', bg: 'rgba(2,132,199,0.22)' },
    'rh-estacoes':              { svg: '<path d="M12 2v6"/><circle cx="12" cy="10" r="2"/><path d="M7 21c1.5 0 1.5-1.5 3-1.5s1.5 1.5 3 1.5 1.5-1.5 3-1.5"/><path d="M5 17c1.8 0 1.8-1.5 3.6-1.5S10.4 17 12.2 17s1.8-1.5 3.6-1.5S17.6 17 19.4 17"/><path d="M12 12v2"/>', cor: '#22d3ee', bg: 'rgba(34,211,238,0.22)' },
    'rh-bacias':                { svg: '<path d="M2 6c3 0 3 2 6 2s3-2 6-2 3 2 6 2"/><path d="M2 12c3 0 3 2 6 2s3-2 6-2 3 2 6 2"/><path d="M2 18c3 0 3 2 6 2s3-2 6-2 3 2 6 2"/>', cor: '#0891b2', bg: 'rgba(8,145,178,0.22)' },
  };

  function renderPill(id, size) {
    const p = iconePills[id] || { svg: '<circle cx="12" cy="12" r="4"/>', cor: '#94a3b8', bg: 'rgba(148,163,184,0.18)' };
    const px = size || 28;
    return `<span style="display:inline-flex;align-items:center;justify-content:center;width:${px}px;height:${px}px;border-radius:7px;background:${p.bg};flex-shrink:0"><svg width="${Math.round(px*.5)}" height="${Math.round(px*.5)}" viewBox="0 0 24 24" fill="none" stroke="${p.cor}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${p.svg}</svg></span>`;
  }

  // Cada grupo é um acordeão independente (recolhível/expansível); o
  // `super` opcional agrupa vários grupos sob um rótulo maior — só um
  // divisor visual (não é ele mesmo recolhível), e é o que separa
  // "Diretoria Técnica" de "Administrativo" pedido pelo usuário. Grupos
  // sem `super` (Principal, Sistema) ficam fora dos dois, como blocos
  // fixos no topo e no fim — Principal é transversal a todo perfil, e
  // Sistema é administração DO SOFTWARE, não da SEMA (não confundir com
  // o superbloco "Administrativo", que é área da secretaria).
  const navGroups = [
    {
      id: 'principal', label: 'Principal',
      itens: [
        { id: 'dashboard',           href: '../pages/dashboard.html',           label: t('nav.dashboard') },
        { id: 'dashboard-executivo', href: '../pages/dashboard-executivo.html', label: 'Dashboard Executivo' },
        { id: 'mapa',                href: '../pages/mapa.html',                label: t('nav.mapa') },
        { id: 'unidades',            href: '../pages/unidades.html',            label: t('nav.unidades') },
      ]
    },
    {
      id: 'gestao', label: 'Gestão', super: 'Diretoria Técnica',
      // Gate por `modulo` usando 'monitoramento' como PROXY do grupo
      // inteiro (não uma chave própria de "gestao" — não existe). Os 8
      // itens têm chave 1:1 no catálogo, mas só monitoramento/netflora/
      // alertas-ambientais/equipe foram convertidos e ligados por
      // exige_lotacao nesta sessão (todos DEUC); painel-gestor/
      // pesquisas/ocorrencias/relatorios continuam com RLS antiga, sem
      // checagem de drift feita — usar a chave própria de cada um
      // esconderia/mostraria errado pra quem não foi conferido.
      // 'monitoramento' já está validado (mesmo dono, sem drift), serve
      // de indicador confiável pro grupo todo. Decisão do usuário:
      // esconder o grupo inteiro pra quem não é do DEUC, mesmo sabendo
      // que a leitura das tabelas continua aberta por baixo (só o menu
      // muda, não o RLS) — ver docs/acesso-por-organograma.md §3.1.
      modulo: 'monitoramento',
      itens: [
        { id: 'monitoramento',      href: '../pages/monitoramento.html',      label: t('nav.monitoramento') },
        { id: 'netflora',           href: '../pages/netflora.html',           label: 'Netflora — Inventário' },
        { id: 'alertas-ambientais', href: '../pages/alertas-ambientais.html', label: 'Alertas Ambientais' },
        { id: 'painel-gestor',      href: '../pages/painel-gestor.html',      label: 'Painel do Gestor' },
        { id: 'pesquisas',          href: '../pages/pesquisas.html',          label: 'Pesquisas' },
        { id: 'ocorrencias',        href: '../pages/ocorrencias.html',        label: t('nav.ocorrencias') },
        { id: 'relatorios',         href: '../pages/relatorios.html',         label: t('nav.relatorios') },
        { id: 'equipe',             href: '../pages/equipe.html',             label: t('nav.equipe') },
      ]
    },
    {
      id: 'brigadas', label: 'Brigadas de Incêndio', super: 'Diretoria Técnica',
      // 'brigadas' é a chave já convertida e ligada por exige_lotacao
      // (DEUC) nesta sessão — mesmo raciocínio do grupo Gestão acima.
      // Cobre também `brigada-app`, que não tem chave própria no
      // catálogo (link só abre o app de campo).
      modulo: 'brigadas',
      itens: [
        { id: 'brigada-app',         href: '../pages/brigada.html',             label: 'App de Campo', target: '_blank' },
        { id: 'validacao-campo',     href: '../pages/validacao-campo.html',     label: 'Validação de Campo',
          perfis: ['gestor','tecnico','super_admin','biologo'] },
        { id: 'relatorios-brigadas', href: '../pages/relatorios-brigadas.html', label: 'Relatórios' },
        { id: 'admin-brigadas',      href: '../pages/admin-brigadas.html',      label: 'Administrar',
          perfis: ['super_admin','gestor'] },
      ]
    },
    {
      id: 'biomonitor', label: 'Biomonitor', super: 'Diretoria Técnica',
      // modulo: chave em `modulos` (minhas_permissoes/nivel_efetivo) que
      // governa o grupo inteiro — o catálogo não discrimina item por
      // item dentro do Biomonitor (migration 263), então o gate é do
      // grupo, por cima dos arrays `perfis:` de cada item (que continuam
      // valendo, mais restritivo vence). Ver docs/acesso-por-organograma.md
      // §1.4b/§1.5 — só este grupo tem match exato catálogo×sidebar hoje;
      // validacao-campo/admin-brigadas/frota ficam de fora por divergência
      // catálogo×realidade ainda não resolvida.
      modulo: 'biomonitor',
      itens: [
        { id: 'biomonitor-app',        href: '../pages/biomonitor.html',           label: 'App de Campo', target: '_blank' },
        { id: 'biomonitor-validacao',  href: '../pages/biomonitor-validacao.html', label: 'Validação de Ninhos',
          perfis: ['gestor','tecnico','super_admin'] },
        { id: 'biomonitor-bercarios',  href: '../pages/biomonitor-bercarios.html', label: 'Berçários',
          perfis: ['gestor','tecnico','super_admin'] },
        { id: 'biomonitor-equipamentos', href: '../pages/biomonitor-equipamentos.html', label: 'Equipamentos',
          perfis: ['gestor','tecnico','super_admin'] },
        { id: 'relatorios-biomonitor', href: '../pages/relatorios-biomonitor.html',label: 'Relatórios' },
        { id: 'analise-cientifica-biomonitor', href: '../pages/analise-cientifica-biomonitor.html', label: 'Relatório Científico',
          perfis: ['gestor','tecnico','super_admin'] },
        { id: 'admin-biomonitor',      href: '../pages/admin-biomonitor.html',     label: 'Administrar',
          perfis: ['super_admin','gestor','tecnico'] },
      ]
    },
    {
      // DERHQA — Departamento de Recursos Hídricos e Qualidade
      // Ambiental. O GRUPO é o departamento (o mesmo dono que
      // `modulo_unidades` já aponta para a chave 'agua' desde a
      // migration 265) e cada tema dele é um SUBGRUPO: Qualidade da
      // Água (o que existe hoje), Bacias Hidrográficas e Qualidade do
      // Ar (previstos — declarados sem item; subgrupo sem item não
      // renderiza, então nada aparece até a primeira página nascer).
      // NÃO virou `super:` de propósito: `super` é a MACROÁREA da SEMA
      // (Diretoria Técnica × Administrativo) e o DERHQA está DENTRO da
      // Diretoria Técnica — além de `super` não ser recolhível, e o
      // departamento precisar continuar sendo um acordeão.
      // Sem `modulo:` no grupo, também de propósito: o gate é por
      // SUBGRUPO ('agua'/'bacias'/'ar'); um gate único aqui esconderia
      // o departamento inteiro de quem tem acesso a Bacias mas não à
      // Água.
      id: 'derhqa', label: 'Recursos Hídricos e Qual. Ambiental', super: 'Diretoria Técnica',
      subgrupos: [
        {
          id: 'agua', label: 'Qualidade da Água',
          // Mesmo padrão do grupo Biomonitor: 'agua' é uma chave só no
          // catálogo cobrindo o subgrupo inteiro (Fase 2), e RLS das
          // tabelas de dono (campanhas/coletas/laboratórios/pontos) já
          // é 100% pode_ver/pode_editar — leitura e escrita concordam,
          // então esconder quando sem_acesso é seguro (diferente do
          // cluster DEUC, onde leitura fica aberta e por isso NÃO
          // ganhou esse gate — ver docs/acesso-por-organograma.md §3.1).
          modulo: 'agua',
          itens: [
            { id: 'agua-app',         href: '../pages/agua-app.html',         label: 'App de Campo', target: '_blank' },
            { id: 'agua-mapa',        href: '../pages/agua-mapa.html',        label: 'Mapa' },
            { id: 'agua-pontos',      href: '../pages/agua-pontos.html',      label: 'Pontos e Laboratórios' },
            { id: 'agua-laudos',      href: '../pages/agua-laudos.html',      label: 'Lançar Laudos' },
            { id: 'agua-conferencia', href: '../pages/agua-conferencia.html', label: 'Conferência' },
            { id: 'agua-relatorios',  href: '../pages/agua-relatorios.html',  label: 'Relatórios' },
          ]
        },
        // 'bacias' entrou na Fase B (migration 304 ativou o módulo).
        // 'ar' segue declarado e sem página — ver
        // docs/recursos-hidricos/plano.md (Fase D); subgrupo sem item
        // não renderiza, então nada aparece no menu até a primeira tela.
        {
          id: 'bacias', label: 'Bacias Hidrográficas', modulo: 'bacias',
          itens: [
            { id: 'rh-bacias',   href: '../pages/rh-bacias.html',   label: 'Painel das Bacias' },
            { id: 'rh-estacoes', href: '../pages/rh-estacoes.html', label: 'Plataformas de Coleta' },
          ]
        },
        { id: 'ar',     label: 'Qualidade do Ar',      modulo: 'ar',     itens: [] },
      ]
    },
    {
      id: 'frota', label: 'Frota — Transporte', super: 'Administrativo',
      // Sem filtro no GRUPO — precisa ficar aberto pra quem só tem
      // acesso a Solicitar Viagem/Minhas Tarefas (sem `perfis:` próprio,
      // abertos a qualquer perfil: solicitar viagem é dono-do-registro,
      // frota_viag_insert nunca dependeu de organograma nem de perfil).
      // "App Frota" volta a ter filtro de perfil PRÓPRIO (decisão do
      // usuário, 2026-08-16, revertendo a abertura total de antes) —
      // é o app completo (motorista/gestor também), não só solicitar.
      // Agenda de Viagens/Painel/Administrar mantêm seus arrays de
      // `perfis:` (pré-organograma) MAS ganham `modulo: 'frota'` também
      // — os arrays sozinhos não bastam mais: incluem 'tecnico'/'gestor'
      // em geral, sem olhar lotação, então qualquer tecnico (ex.: um
      // lotado no DEBIO) ou gestor fora do DITLOG continuava vendo os
      // 3, mesmo já sem `editar`/`visualizar` de verdade na RLS depois
      // que exige_lotacao foi ligado em 'frota' (achado testando com
      // Dima, 2026-08-16). Os dois filtros valem juntos (mais
      // restritivo vence) — quem tem lotação E está no array certo.
      itens: [
        { id: 'frota-app',       href: '../pages/frota-app.html',       label: 'App Frota', target: '_blank',
          perfis: ['super_admin','secretario','diretor','chefe_departamento','gestor','gestor_uc','tecnico','assistente_admin','financeiro','visualizador'] },
        { id: 'frota-tarefas',   href: '../pages/frota-tarefas.html',   label: 'Minhas Tarefas' },
        { id: 'frota-solicitar', href: '../pages/frota-solicitar.html', label: 'Solicitar Viagem' },
        { id: 'frota-viagens',   href: '../pages/frota-viagens.html',   label: 'Agenda de Viagens', modulo: 'frota',
          // 'tecnico' entrou por decisão do usuário (2026-08-16): quem é
          // do DITLOG aprova viagem mesmo sendo tecnico, não só gestão.
          // O `modulo: 'frota'` acima é quem impede isso vazar pra
          // tecnico de outro setor — sem lotação no DITLOG, sem_acesso
          // barra antes de chegar no array de perfis.
          perfis: ['super_admin','diretor','chefe_departamento','gestor','assistente_admin','tecnico'] },
        { id: 'frota-dashboard', href: '../pages/frota-dashboard.html', label: 'Painel de Frota', modulo: 'frota',
          perfis: ['super_admin','secretario','diretor','chefe_departamento','gestor','gestor_uc','tecnico','assistente_admin','financeiro'] },
        { id: 'frota-administrar', href: '../pages/frota-administrar.html', label: 'Administrar Frota', modulo: 'frota',
          perfis: ['super_admin','secretario','diretor','chefe_departamento','gestor','gestor_uc','tecnico','assistente_admin','financeiro'] },
      ]
    },
    {
      id: 'sistema', label: 'Sistema',
      perfis: ['super_admin', 'gestor'],
      itens: [
        { id: 'usuarios',                 href: '../pages/usuarios.html',                 label: t('nav.usuarios') },
        { id: 'estrutura-organizacional', href: '../pages/estrutura-organizacional.html', label: 'Estrutura Org.' },
        { id: 'configuracoes',            href: '../pages/configuracoes.html',            label: t('nav.configuracoes') },
        { id: 'saude-sistema',            href: '../pages/saude-sistema.html',            label: 'Saúde do Sistema' },
      ]
    },
  ];

  const u = appState.usuario;

  // Um grupo tem `itens` OU `subgrupos` (acordeão aninhado, usado hoje
  // só pelo DERHQA). Daqui pra baixo, tudo que precisa "os links deste
  // grupo" passa por aqui, para os dois formatos responderem igual.
  const itensDoGrupo = g => (g.subgrupos ? g.subgrupos.flatMap(s => s.itens) : g.itens);

  // Grupo da página atual: nasce sempre aberto, sem depender do que foi
  // salvo — chegar numa página e ver o próprio link escondido seria pior
  // do que a barra comprida que este acordeão resolve. Mesma regra vale
  // para o subgrupo, senão o link ficaria escondido um nível abaixo.
  const grupoAtivoId = (navGroups.find(g => itensDoGrupo(g).some(i => i.id === paginaAtiva)) || {}).id || null;
  const subgrupoAtivoId = (navGroups.flatMap(g => g.subgrupos || [])
    .find(s => s.itens.some(i => i.id === paginaAtiva)) || {}).id || null;

  let estadoGrupos = {};
  try { estadoGrupos = JSON.parse(localStorage.getItem('siguc_nav_grupos') || '{}'); } catch (e) { /* localStorage indisponível */ }

  // appState.permissoes vem de minhas_permissoes (nivel_efetivo), fail-open
  // ({} se a consulta falhar — nunca esconde nada por instabilidade de
  // rede). Só aplica a quem declara `modulo` (nem todo item tem
  // correspondência 1:1 com o catálogo — ver comentário no grupo Biomonitor).
  const semAcesso = modulo => !!modulo && !!appState.permissoes && appState.permissoes[modulo] === 'sem_acesso';

  const renderItens = itens => itens
    .filter(item => !item.perfis || (u && item.perfis.includes(u.perfil)))
    .filter(item => !semAcesso(item.modulo))
    .map(item => {
      const ativo   = paginaAtiva === item.id ? ' ativo' : '';
      const target  = item.target ? ` target="${item.target}" rel="noopener"` : '';
      return `<a href="${item.href}"${target} class="nav-item${ativo}">${renderPill(item.id, 26)}<span>${item.label}</span></a>`;
    }).join('');

  // Subgrupo: mesmo acordeão do grupo, um nível abaixo (mesma classe
  // .nav-grupo + .nav-subgrupo, mesmo toggleNavGrupo, mesma preferência
  // em siguc_nav_grupos — os ids são únicos entre grupos e subgrupos).
  const renderSubgrupo = sub => {
    if (sub.perfis && u && !sub.perfis.includes(u.perfil)) return '';
    if (semAcesso(sub.modulo)) return '';
    const itensHtml = renderItens(sub.itens);
    if (!itensHtml) return '';
    const aberto = sub.id === subgrupoAtivoId ? true : !!estadoGrupos[sub.id];
    return `<div class="nav-grupo nav-subgrupo${aberto ? ' aberto' : ''}" data-grupo="${sub.id}">
      <button type="button" class="nav-section-toggle" onclick="toggleNavGrupo('${sub.id}')" aria-expanded="${aberto}">
        <span class="nav-section">${sub.label}</span>
        <svg class="nav-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
      </button>
      <div class="nav-grupo-corpo"><div class="nav-grupo-corpo-inner">${itensHtml}</div></div>
    </div>`;
  };

  let superAtual;
  const navHtml = navGroups.map(grupo => {
    if (grupo.perfis && u && !grupo.perfis.includes(u.perfil)) return '';
    if (semAcesso(grupo.modulo)) return '';
    const itensHtml = grupo.subgrupos
      ? grupo.subgrupos.map(renderSubgrupo).join('')
      : renderItens(grupo.itens);
    if (!itensHtml) return '';

    let prefixo = '';
    if (grupo.super !== superAtual) {
      superAtual = grupo.super;
      if (superAtual) prefixo = `<div class="nav-super">${esc(superAtual)}</div>`;
    }

    const aberto = grupo.id === grupoAtivoId ? true : !!estadoGrupos[grupo.id];
    return `${prefixo}<div class="nav-grupo${aberto ? ' aberto' : ''}" data-grupo="${grupo.id}">
      <button type="button" class="nav-section-toggle" onclick="toggleNavGrupo('${grupo.id}')" aria-expanded="${aberto}">
        <span class="nav-section">${grupo.label}</span>
        <svg class="nav-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
      </button>
      <div class="nav-grupo-corpo"><div class="nav-grupo-corpo-inner">${itensHtml}</div></div>
    </div>`;
  }).join('');

  const nomeDisplay = u?.nome_completo || 'Usuário';
  const perfilDisplay = t(`perfis.${u?.perfil}`) || u?.perfil || '';
  const avatarInicial = iniciais(nomeDisplay);

  return `
<div class="app-layout">
  <div class="sidebar-overlay" onclick="fecharSidebarMobile()"></div>
  <aside class="sidebar" id="sidebar">
    <div class="sidebar-brand">
      <div class="sidebar-brand-logo-wrap">
        <div style="text-align:center">
          <div style="font-family:'Fraunces',Georgia,serif;font-size:22px;font-weight:700;color:#1F4E2C;letter-spacing:-.02em">SIGUC</div>
          <div style="font-size:9px;color:#6B7280;letter-spacing:.08em;text-transform:uppercase;margin-top:1px">Gestão de UCs · SEMA/AC</div>
        </div>
      </div>
    </div>
    <button type="button" class="sidebar-user" onclick="abrirPerfil()" aria-haspopup="dialog" title="Meu perfil">
      <div class="sidebar-avatar" id="sidebar-avatar">${avatarInicial}</div>
      <div class="sidebar-user-info">
        <div class="sidebar-user-nome" id="sidebar-nome">${esc(nomeDisplay)}</div>
        <div class="sidebar-user-perfil" id="sidebar-perfil">${esc(perfilDisplay)}</div>
      </div>
      <svg class="sidebar-user-chevron" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
    </button>
    <nav class="sidebar-nav" id="sidebar-nav">${navHtml}</nav>
    <div class="sidebar-footer">
      <button class="btn-sair" onclick="fazerLogout()">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
        Sair
      </button>
    </div>
  </aside>
  <div class="main-content">
    <header class="topbar">
      <button class="mobile-menu-btn" onclick="toggleSidebarMobile()">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
      </button>
      <div style="flex:1">
        <div class="topbar-breadcrumb"><span>SIGUC-AC</span><span>›</span><span>${esc(tituloPagina)}</span></div>
        <div class="topbar-title">${esc(tituloPagina)}</div>
      </div>
    </header>
    <div class="page-body">`;
}

function carregarLogosSidebar() {
  _sigucBarCompleta();
  // Avatar da sidebar: iniciais no HTML, foto quando houver (bucket
  // privado, precisa ser assinada). perfil.js é carregado por
  // carregarUsuario() e pode ainda não ter chegado — o guard cobre.
  if (typeof perfilAtualizarAvatarSidebar === 'function') perfilAtualizarAvatarSidebar();
  document.querySelectorAll('a.nav-item[href]').forEach(link => {
    if (link._sigucNav) return;
    link._sigucNav = true;
    link.addEventListener('click', function(e) {
      const href = this.getAttribute('href');
      if (!href || href.startsWith('#') || href.startsWith('javascript:')) return;
      e.preventDefault();
      fecharSidebarMobile();
      document.body.classList.add('siguc-saindo');
      setTimeout(() => { window.location.href = href; }, 160);
    });
  });
}

function toggleSidebarMobile() {
  document.getElementById('sidebar')?.classList.toggle('aberta');
  document.querySelector('.sidebar-overlay')?.classList.toggle('ativo');
}

// Acordeão dos grupos da sidebar — abre/fecha e lembra a escolha entre
// páginas (a navegação aqui é sempre load de página inteira, nunca SPA).
function toggleNavGrupo(id) {
  const el = document.querySelector(`.nav-grupo[data-grupo="${id}"]`);
  if (!el) return;
  const aberto = !el.classList.contains('aberto');
  el.classList.toggle('aberto', aberto);
  el.querySelector('.nav-section-toggle')?.setAttribute('aria-expanded', String(aberto));
  let estado = {};
  try { estado = JSON.parse(localStorage.getItem('siguc_nav_grupos') || '{}'); } catch (e) { /* ignora */ }
  estado[id] = aberto;
  try { localStorage.setItem('siguc_nav_grupos', JSON.stringify(estado)); } catch (e) { /* ignora */ }
}

async function fazerLogout() {
  const u = appState.usuario;
  if (u) {
    try { await db.rpc('registrar_saida_acesso', { p_usuario_id: u.id, p_email: u.email, p_tipo: 'logout' }) } catch {}
  }
  await db.auth.signOut();
  window.location.href = '../index.html';
}

// ── Guard de inatividade de sessão ────────────────────────────

const SessionGuard = {
  _timer: null,
  _avisoTimer: null,
  _avisoEl: null,
  _usuario: null,
  _LIMITE_MS:  30 * 60 * 1000,
  _AVISO_MS:   25 * 60 * 1000,

  init(usuario) {
    this._usuario = usuario;
    this._montarAviso();
    this._resetar();
    ['mousemove','mousedown','keydown','scroll','touchstart','click'].forEach(ev =>
      document.addEventListener(ev, () => this._resetar(), { passive: true })
    );
  },

  _resetar() {
    clearTimeout(this._timer);
    clearTimeout(this._avisoTimer);
    if (this._avisoEl) this._avisoEl.style.display = 'none';
    this._avisoTimer = setTimeout(() => this._mostrarAviso(), this._AVISO_MS);
    this._timer      = setTimeout(() => this._expirar(),      this._LIMITE_MS);
  },

  _montarAviso() {
    if (document.getElementById('session-aviso')) return;
    const el = document.createElement('div');
    el.id = 'session-aviso';
    el.style.cssText = 'display:none;position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.55);align-items:center;justify-content:center;font-family:"DM Sans",sans-serif';
    el.innerHTML = `
      <div style="background:#fff;border-radius:16px;padding:32px 36px;max-width:360px;width:90%;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,.3)">
        <div style="width:48px;height:48px;border-radius:50%;background:#FEF3C7;display:flex;align-items:center;justify-content:center;margin:0 auto 16px">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#D97706" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
        </div>
        <div style="font-size:16px;font-weight:700;color:#111827;margin-bottom:8px">Sessão prestes a expirar</div>
        <div style="font-size:13px;color:#6B7280;margin-bottom:24px">Por inatividade, sua sessão será encerrada em <strong id="session-countdown">5:00</strong>.</div>
        <button onclick="SessionGuard._resetar()" style="width:100%;height:44px;background:#1F4E2C;color:#fff;border:none;border-radius:10px;font-size:14px;font-weight:600;cursor:pointer">
          Continuar conectado
        </button>
      </div>`;
    document.body.appendChild(el);
    this._avisoEl = el;
  },

  _mostrarAviso() {
    if (!this._avisoEl) return;
    this._avisoEl.style.display = 'flex';
    let restante = (this._LIMITE_MS - this._AVISO_MS) / 1000;
    const ct = document.getElementById('session-countdown');
    const tick = setInterval(() => {
      restante--;
      if (!ct || restante <= 0) { clearInterval(tick); return; }
      const m = Math.floor(restante / 60), s = String(restante % 60).padStart(2, '0');
      ct.textContent = `${m}:${s}`;
    }, 1000);
  },

  async _expirar() {
    const u = this._usuario;
    if (u) {
      try { await db.rpc('registrar_saida_acesso', { p_usuario_id: u.id, p_email: u.email, p_tipo: 'sessao_expirada' }) } catch {}
    }
    await db.auth.signOut();
    window.location.href = '../index.html?motivo=inatividade';
  }
};

// ── Auto-reload quando nova versão do SW ativa ─────────────────
;(function () {
  if (!('serviceWorker' in navigator)) return
  let _jaRecarregou = false
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (_jaRecarregou) return
    _jaRecarregou = true
    if (typeof toast === 'function') toast('Nova versão disponível — recarregando…', 'info')
    setTimeout(() => window.location.reload(), 1200)
  })
})()
