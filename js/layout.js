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
  document.body.appendChild(bar);
  requestAnimationFrame(() => requestAnimationFrame(() => { bar.style.width = '42%'; }));
  setTimeout(() => { bar.style.width = '72%'; }, 460);
  window._sigucBar = bar;
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
    configuracoes:{ svg: '<path d="M20 7h-9"/><path d="M14 17H5"/><circle cx="17" cy="17" r="3"/><circle cx="7" cy="7" r="3"/>', cor: '#94a3b8', bg: 'rgba(148,163,184,0.18)' },
  };

  function renderPill(id, size) {
    const p = iconePills[id] || { svg: '<circle cx="12" cy="12" r="4"/>', cor: '#94a3b8', bg: 'rgba(148,163,184,0.18)' };
    const px = size || 28;
    return `<span style="display:inline-flex;align-items:center;justify-content:center;width:${px}px;height:${px}px;border-radius:7px;background:${p.bg};flex-shrink:0"><svg width="${Math.round(px*.5)}" height="${Math.round(px*.5)}" viewBox="0 0 24 24" fill="none" stroke="${p.cor}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${p.svg}</svg></span>`;
  }

  const navGroups = [
    {
      label: 'Principal',
      itens: [
        { id: 'dashboard',  href: '../pages/dashboard.html',  label: t('nav.dashboard') },
        { id: 'mapa',       href: '../pages/mapa.html',       label: t('nav.mapa') },
        { id: 'unidades',   href: '../pages/unidades.html',   label: t('nav.unidades') },
      ]
    },
    {
      label: 'Gestão',
      itens: [
        { id: 'monitoramento', href: '../pages/monitoramento.html', label: t('nav.monitoramento') },
        { id: 'ocorrencias',   href: '../pages/ocorrencias.html',   label: t('nav.ocorrencias') },
        { id: 'documentos',    href: '../pages/documentos.html',    label: t('nav.documentos') },
        { id: 'relatorios',    href: '../pages/relatorios.html',    label: t('nav.relatorios') },
        { id: 'equipe',        href: '../pages/equipe.html',        label: t('nav.equipe') },
      ]
    },
    {
      label: 'Administração',
      perfis: ['super_admin', 'gestor'],
      itens: [
        { id: 'usuarios',      href: '../pages/usuarios.html',      label: t('nav.usuarios') },
        { id: 'configuracoes', href: '../pages/configuracoes.html', label: t('nav.configuracoes') },
      ]
    },
  ];

  const u = appState.usuario;
  const navHtml = navGroups.map(grupo => {
    if (grupo.perfis && u && !grupo.perfis.includes(u.perfil)) return '';
    const itensHtml = grupo.itens.map(item => {
      const ativo = paginaAtiva === item.id ? ' ativo' : '';
      return `<a href="${item.href}" class="nav-item${ativo}">${renderPill(item.id, 26)}<span>${item.label}</span></a>`;
    }).join('');
    return `<div class="nav-section">${grupo.label}</div>${itensHtml}`;
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
    <div class="sidebar-user">
      <div class="sidebar-avatar" id="sidebar-avatar">${avatarInicial}</div>
      <div class="sidebar-user-info">
        <div class="sidebar-user-nome" id="sidebar-nome">${esc(nomeDisplay)}</div>
        <div class="sidebar-user-perfil" id="sidebar-perfil">${esc(perfilDisplay)}</div>
      </div>
    </div>
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

async function fazerLogout() {
  await db.auth.signOut();
  window.location.href = '../index.html';
}
