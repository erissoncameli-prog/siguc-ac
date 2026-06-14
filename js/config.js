// ── SIGUC-AC · Configuração Supabase ─────────────────────────
const SUPABASE_URL = 'https://atqtybcsvepdabsvgaly.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF0cXR5YmNzdmVwZGFic3ZnYWx5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA0MjMzNzgsImV4cCI6MjA5NTk5OTM3OH0.hWx1AB2rK7xdco1Dgagm0XUOBPQbxZVE614SW4SKoLk';

// Observabilidade — opcional (não carregada em todas as páginas)
if (typeof Observability !== 'undefined') Observability.init();

const { createClient } = supabase;
// sessionStorage: sessão encerra ao fechar o navegador (Regra de segurança)
const _dbRaw = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { storage: window.sessionStorage, persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
});
// let (não const): o app de campo Brigadas substitui por um cliente
// isolado com sessão persistente protegida por PIN — ver pages/brigada.html
let db = typeof createInstrumentedDb !== 'undefined' ? createInstrumentedDb(_dbRaw) : _dbRaw;

// ── Estado global ─────────────────────────────────────────────
const appState = { usuario: null, perfil: null };

// ── i18n ──────────────────────────────────────────────────────
const i18n = {
  pt: {
    nav: {
      dashboard: 'Visão Geral', mapa: 'Mapa das UCs', unidades: 'Unidades de Conservação',
      monitoramento: 'Monitoramento', ocorrencias: 'Ocorrências', documentos: 'Documentos',
      relatorios: 'Relatórios', equipe: 'Equipe', usuarios: 'Usuários',
      configuracoes: 'Configurações', sair: 'Sair'
    },
    comum: {
      salvar: 'Salvar', cancelar: 'Cancelar', editar: 'Editar', excluir: 'Excluir',
      novo: 'Novo', buscar: 'Buscar...', carregando: 'Carregando...', sem_dados: 'Nenhum registro encontrado.',
      confirmar: 'Confirmar', sim: 'Sim', nao: 'Não', status: 'Status',
      acoes: 'Ações', voltar: 'Voltar', filtrar: 'Filtrar', exportar: 'Exportar'
    },
    perfis: {
      super_admin: 'Super Admin', gestor: 'Gestor', tecnico: 'Técnico',
      financeiro: 'Financeiro', visualizador: 'Visualizador'
    },
    categorias: {
      PI: 'Parque (PI)', REBIO: 'Reserva Biológica', ESEC: 'Estação Ecológica',
      MONA: 'Monumento Natural', RVS: 'Refúgio de Vida Silvestre',
      FLONA: 'Floresta Nacional', FLOE: 'Floresta Estadual', RESEX: 'Reserva Extrativista',
      RDS: 'Reserva de Des. Sustentável', RPPN: 'RPPN', APA: 'APA', ARIE: 'ARIE'
    },
    grupos: { protecao_integral: 'Proteção Integral', uso_sustentavel: 'Uso Sustentável' },
    status_uc: {
      criada: 'Criada', regularizada: 'Regularizada',
      em_regularizacao: 'Em Regularização', decreto_suspenso: 'Decreto Suspenso', em_revisao: 'Em Revisão'
    },
    severidade: { critica: 'Crítica', alta: 'Alta', media: 'Média', baixa: 'Baixa' },
    tipo_ocorrencia: {
      incendio: 'Incêndio', desmatamento: 'Desmatamento', invasao: 'Invasão',
      caca_pesca_ilegal: 'Caça/Pesca Ilegal', mineracao_ilegal: 'Mineração Ilegal',
      contaminacao: 'Contaminação', especie_invasora: 'Espécie Invasora', outro: 'Outro'
    },
    status_ocorrencia: { aberta: 'Aberta', em_atendimento: 'Em Atendimento', resolvida: 'Resolvida', arquivada: 'Arquivada' }
  }
};

function t(chave) {
  const partes = chave.split('.');
  let val = i18n.pt;
  for (const p of partes) val = val?.[p];
  return val || chave;
}

// ── Helpers ───────────────────────────────────────────────────

function esc(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function formatBRL(valor) {
  if (valor == null) return '—';
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(valor);
}

function formatNum(valor, decimais = 0) {
  if (valor == null) return '—';
  return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: decimais }).format(valor);
}

function formatData(str) {
  if (!str) return '—';
  const d = new Date(str + (str.length === 10 ? 'T12:00:00' : ''));
  return d.toLocaleDateString('pt-BR');
}

function toast(msg, tipo = 'info') {
  const cores = { success: '#059669', error: '#DC2626', warning: '#D97706', info: '#2563EB' };
  const t = document.createElement('div');
  t.style.cssText = `position:fixed;bottom:20px;right:20px;z-index:9999;padding:12px 18px;border-radius:10px;background:${cores[tipo]||cores.info};color:#fff;font-size:13px;font-family:'DM Sans',sans-serif;box-shadow:0 4px 20px rgba(0,0,0,.2);animation:fadeIn .2s ease;max-width:340px;line-height:1.45`;
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3500);
}

async function carregarUsuario() {
  const { data: { session } } = await db.auth.getSession();
  if (!session) return null;
  const { data: u } = await db.from('usuarios').select('*').eq('id', session.user.id).single();
  if (!u || !u.ativo) { await db.auth.signOut(); return null; }
  appState.usuario = u;
  appState.perfil = u.perfil;
  if (window.SessionGuard) SessionGuard.init(u);
  return u;
}

function iniciais(nome) {
  if (!nome) return '?';
  const p = nome.trim().split(' ');
  return (p[0][0] + (p[1]?.[0] || '')).toUpperCase();
}

// Badge helpers
const BADGE_CATEGORIA = {
  PI:'badge-verde', REBIO:'badge-verde', ESEC:'badge-verde', MONA:'badge-verde', RVS:'badge-verde',
  FLONA:'badge-teal', FLOE:'badge-teal', RESEX:'badge-teal', RDS:'badge-teal', RPPN:'badge-blue', APA:'badge-ouro', ARIE:'badge-ouro'
};
const BADGE_SEVERIDADE = { critica:'badge-erro', alta:'badge-erro', media:'badge-ouro', baixa:'badge-verde' };
const BADGE_STATUS_OC = { aberta:'badge-erro', em_atendimento:'badge-ouro', resolvida:'badge-verde', arquivada:'badge-cinza' };
const BADGE_STATUS_UC = { criada:'badge-cinza', regularizada:'badge-verde', em_regularizacao:'badge-ouro', decreto_suspenso:'badge-erro', em_revisao:'badge-blue' };

// ════════════════════════════════════════════════════════════════
// Ícones padronizados (traço Feather/Lucide, 24×24, currentColor)
// ────────────────────────────────────────────────────────────────
// PADRÃO ÚNICO de ícones do projeto. NUNCA usar emoji em elementos de
// UI (botões, chips, navegação, marcadores de lista): use estes SVGs.
// Uso em HTML estático:  <button data-icon="camera">Câmera</button>
//   (bIconsAplicar() injeta o SVG no início do elemento ao carregar)
// Uso em JS dinâmico:    `${bico('clock')} ${texto}`
// Para adicionar um ícone novo: inclua aqui um path no MESMO estilo.
const BICON_PATHS = {
  truck:    '<path d="M10 17h4V5H2v12h3"/><path d="M20 17h2v-3.34a4 4 0 0 0-1.17-2.83L19 9h-5v8h1"/><circle cx="7.5" cy="17.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/>',
  users:    '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  camera:   '<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>',
  image:    '<rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>',
  key:      '<circle cx="7.5" cy="15.5" r="5.5"/><path d="m21 2-9.6 9.6"/><path d="m15.5 7.5 3 3L22 7l-3-3"/>',
  leaf:     '<path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z"/><path d="M2 21c0-3 1.85-5.36 5.08-6"/>',
  qr:       '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3h-3z"/><path d="M20 14v.01"/><path d="M14 20h.01"/><path d="M20 20v.01"/><path d="M17 17h.01"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
  upload:   '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>',
  x:        '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
  check:    '<polyline points="20 6 9 17 4 12"/>',
  help:     '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
  backspace:'<path d="M21 4H8l-7 8 7 8h13a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2z"/><line x1="18" y1="9" x2="12" y2="15"/><line x1="12" y1="9" x2="18" y2="15"/>',
  eye:      '<path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="3"/>',
  trash:    '<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/>',
  logout:   '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>',
  share:    '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>',
  clock:    '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  award:    '<circle cx="12" cy="8" r="6"/><path d="M15.477 12.89 17 22l-5-3-5 3 1.523-9.11"/>',
  shield:   '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><polyline points="9 12 11 14 15 10"/>',
  flame:    '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>',
  binoculo: '<path d="M5.5 21A2.5 2.5 0 0 1 3 18.5V11l2-5h3l1 3h6l1-3h3l2 5v7.5a2.5 2.5 0 0 1-5 0V14H10.5v4.5A2.5 2.5 0 0 1 8 21z"/><path d="M10 9h4"/>',
  clipboard:'<path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/>',
  map:      '<polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/><line x1="8" y1="2" x2="8" y2="18"/><line x1="16" y1="6" x2="16" y2="22"/>',
  pin:      '<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>',
  tree:     '<path d="M12 22v-7"/><path d="M9 9a3 3 0 0 1-3-3 3 3 0 0 1 1-2.2A3 3 0 0 1 12 2a3 3 0 0 1 5 1.8A3 3 0 0 1 18 6a3 3 0 0 1-3 3"/><path d="M9 9a4 4 0 0 0 6 0"/><path d="M9 9a4 4 0 0 1-1 7h8a4 4 0 0 1-1-7"/>',
};

function bico(nome, extraClasse) {
  const p = BICON_PATHS[nome];
  if (!p) return '';
  return `<svg class="bico${extraClasse ? ' ' + extraClasse : ''}" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="vertical-align:-.14em;flex:none">${p}</svg>`;
}

// Substitui [data-icon="nome"] pelo SVG (injeta no início, preservando o texto)
function bIconsAplicar(root) {
  (root || document).querySelectorAll('[data-icon]:not([data-icon-done])').forEach(el => {
    const svg = bico(el.dataset.icon);
    if (!svg) return;
    el.insertAdjacentHTML('afterbegin', svg + (el.textContent.trim() ? ' ' : ''));
    el.setAttribute('data-icon-done', '');
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => bIconsAplicar());
} else {
  bIconsAplicar();
}
