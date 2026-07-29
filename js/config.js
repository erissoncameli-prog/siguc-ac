// ── SIGUC-AC · Configuração Supabase ─────────────────────────
// Credenciais carregadas em runtime via /api/env — sem hardcode no fonte.

// env-loader.js pode já estar disponível (carregado antes deste script).
// Se não estiver, define um loader inline para garantir compatibilidade.
if (typeof loadEnv !== 'function') {
  // No app nativo (Capacitor) a WebView roda em https://localhost e o bundle
  // não inclui /api/env — sem isto o app fica "offline" e o login trava.
  // Nesses casos busca a configuração pública (URL + anon key) na produção.
  var _envBase = '';
  try {
    if (window.Capacitor || location.protocol === 'capacitor:' ||
        location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
      _envBase = 'https://siguc-ac.vercel.app';
    }
  } catch (e) { /* location indisponível — mantém caminho relativo */ }
  var _envCacheKey = 'siguc-env-cache-v1';
  window._sigucEnvPromise = window._sigucEnvPromise ||
    // 1º: credenciais embarcadas no build do app nativo (window.__SIGUC_ENV).
    // São públicas (URL + anon key) e permitem login sem NENHUMA chamada de
    // rede — o caminho mais confiável dentro da WebView do Capacitor.
    ((window.__SIGUC_ENV && window.__SIGUC_ENV.supabaseUrl && window.__SIGUC_ENV.supabaseKey)
      ? Promise.resolve(window.__SIGUC_ENV)
      : fetch(_envBase + '/api/env')
        .then(function (r) { if (!r.ok) throw new Error('env ' + r.status); return r.json(); })
        .then(function (cfg) {
          // Cacheia p/ funcionar offline após o 1º acesso (creds são públicas).
          if (cfg && cfg.supabaseUrl && cfg.supabaseKey) {
            try { localStorage.setItem(_envCacheKey, JSON.stringify(cfg)); } catch (e) {}
          }
          return cfg;
        })
        .catch(function () {
          try {
            var c = localStorage.getItem(_envCacheKey);
            if (c) return JSON.parse(c);
          } catch (e) {}
          return { supabaseUrl: '', supabaseKey: '' };
        }));
  window.loadEnv = () => window._sigucEnvPromise;
}

// Observabilidade — opcional (não carregada em todas as páginas)
if (typeof Observability !== 'undefined') Observability.init();

// Monitor de APIs — avisa em qualquer tela quando uma API falha.
// Carregado dinamicamente a partir do caminho deste próprio config.js,
// para funcionar em todas as páginas sem editar uma por uma.
;(function () {
  try {
    if (window.__API_MONITOR_OFF) return;
    var cs = document.currentScript;
    var base = (cs && cs.src) ? cs.src.replace(/config\.js(\?.*)?$/, '') : '../js/';
    var s = document.createElement('script');
    s.src = base + 'api-monitor.js';
    s.async = true;
    (document.head || document.documentElement).appendChild(s);
  } catch (e) { /* silencioso: monitor é não-crítico */ }
})();

const { createClient } = supabase;

let db;
let SUPABASE_URL = '';      // exposto após env load
let SUPABASE_ANON_KEY = ''; // exposto após env load — brigada.html usa para cliente isolado

// Cliente Supabase correto para o contexto atual.
//
// Não dá para usar `db` cegamente: os apps de campo têm cliente
// próprio, com sessão isolada em localStorage. Brigadas e Frota
// REATRIBUEM o global `db` para o deles, então ali `db` já é o certo —
// mas o Biomonitor guarda o seu em `window._bioDB_client` e deixa `db`
// intocado, apontando para a sessão do SIGUC de mesa, que dentro do
// app não existe. Assinar foto ou chamar RPC com o cliente errado
// falha por falta de sessão.
//
// Ordem deliberada, e `db` vem ANTES de `window.db` por um motivo
// concreto: `db` é declarado com `let`, então NÃO é propriedade de
// window. Quando um app faz `db = clientePróprio`, o binding léxico
// muda mas `window.db` continua apontando para o cliente de mesa que
// esta linha 94 publicou. Preferir `window.db` devolveria o cliente
// errado — sem sessão — em Brigadas.
function sigucDb() {
  if (window._bioDB_client) return window._bioDB_client;
  if (typeof db !== 'undefined' && db) return db;
  return window.db || null;
}
// _dbReady resolve assim que env estiver disponível e db inicializado
const _dbReady = loadEnv().then(({ supabaseUrl, supabaseKey }) => {
  if (!supabaseUrl || !supabaseKey) return // env indisponível — db permanece null
  SUPABASE_URL = supabaseUrl;
  SUPABASE_ANON_KEY = supabaseKey;
  // createInstrumentedDb pode não estar disponível (ex: brigada.html não carrega queryLogger.js)
  const wrap = typeof createInstrumentedDb === 'function' ? createInstrumentedDb : x => x;
  db = wrap(createClient(supabaseUrl, supabaseKey, {
    // sessionStorage: sessão encerra ao fechar o navegador (Regra de segurança)
    auth: { storage: window.sessionStorage, persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
  }));
  window.db = db; // expõe o cliente para RPCs públicas read-only (ex.: smoke tests)
});

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

// Gera QR code localmente (lib vendorizada js/qrcode-generator.js) — sem
// depender de API externa (api.qrserver.com ficou instável/bloqueada em
// algumas redes). Retorna data URL PNG pronta pra usar em <img src>.
function gerarQRDataURL(texto, cellSize = 6, margin = 4) {
  const qr = qrcode(0, 'M');
  qr.addData(texto);
  qr.make();
  return qr.createDataURL(cellSize, margin);
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
  await _dbReady;
  const { data: { session } } = await db.auth.getSession();
  if (!session) return null;
  const { data: u } = await db.from('usuarios').select('*').eq('id', session.user.id).single();
  if (!u || !u.ativo) { await db.auth.signOut(); return null; }
  appState.usuario = u;
  appState.perfil = u.perfil;
  if (window.SessionGuard) SessionGuard.init(u);
  _lgpdGate();
  return u;
}

// Gate de ciência da Política de Privacidade e do Termo de Uso
// (migration 212). Carregado dinamicamente daqui, e não por <script>
// em cada página, de propósito: é um controle de conformidade, e
// pendurá-lo em 38 tags significaria que toda página nova nasceria
// sem ele — uma falha invisível. Como carregarUsuario() é o bootstrap
// obrigatório de qualquer tela de mesa, amarrar o gate aqui garante
// cobertura completa e automática.
//
// Os três apps de campo (brigada, biomonitor, frota-app) não chamam
// carregarUsuario e portanto não são bloqueados — ver o cabeçalho de
// js/lgpd.js para o porquê.
//
// Sem await: a página não espera o gate para renderizar; o overlay
// cobre a tela sozinho quando (e se) houver pendência.
function _lgpdGate() {
  const seguir = () => { try { lgpdVerificarAceite() } catch (e) { console.warn('[lgpd]', e) } };
  if (typeof lgpdVerificarAceite === 'function') { seguir(); return; }
  if (document.getElementById('lgpd-js')) return;
  const s = document.createElement('script');
  s.id = 'lgpd-js';
  s.src = '/js/lgpd.js';
  s.onload = seguir;
  s.onerror = () => console.warn('[lgpd] não foi possível carregar /js/lgpd.js');
  document.head.appendChild(s);
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
  wrench:   '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>',
  chat:     '<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>',
  fuel:     '<line x1="3" y1="22" x2="15" y2="22"/><line x1="4" y1="9" x2="14" y2="9"/><path d="M14 22V4a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v18"/><path d="M14 13h2a2 2 0 0 1 2 2v2a2 2 0 0 0 2 2 2 2 0 0 0 2-2V9.83a2 2 0 0 0-.59-1.42L18 5"/>',
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
  hash:     '<line x1="4" y1="9" x2="20" y2="9"/><line x1="4" y1="15" x2="20" y2="15"/><line x1="10" y1="3" x2="8" y2="21"/><line x1="16" y1="3" x2="14" y2="21"/>',
  'bar-chart': '<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>',
  bell:     '<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>',
  award:    '<circle cx="12" cy="8" r="6"/><path d="M15.477 12.89 17 22l-5-3-5 3 1.523-9.11"/>',
  shield:   '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><polyline points="9 12 11 14 15 10"/>',
  flame:    '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>',
  binoculo: '<path d="M5.5 21A2.5 2.5 0 0 1 3 18.5V11l2-5h3l1 3h6l1-3h3l2 5v7.5a2.5 2.5 0 0 1-5 0V14H10.5v4.5A2.5 2.5 0 0 1 8 21z"/><path d="M10 9h4"/>',
  clipboard:'<path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/>',
  map:      '<polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/><line x1="8" y1="2" x2="8" y2="18"/><line x1="16" y1="6" x2="16" y2="22"/>',
  pin:      '<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>',
  tree:     '<path d="M12 22v-7"/><path d="M9 9a3 3 0 0 1-3-3 3 3 0 0 1 1-2.2A3 3 0 0 1 12 2a3 3 0 0 1 5 1.8A3 3 0 0 1 18 6a3 3 0 0 1-3 3"/><path d="M9 9a4 4 0 0 0 6 0"/><path d="M9 9a4 4 0 0 1-1 7h8a4 4 0 0 1-1-7"/>',
  maximize: '<path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/>',
  minimize: '<path d="M8 3v3a2 2 0 0 1-2 2H3"/><path d="M21 8h-3a2 2 0 0 1-2-2V3"/><path d="M3 16h3a2 2 0 0 1 2 2v3"/><path d="M16 21v-3a2 2 0 0 1 2-2h3"/>',
  layers:   '<polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/>',
  sliders:  '<line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/>',
  printer:  '<polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>',
  paw:      '<circle cx="11" cy="4" r="2"/><circle cx="18" cy="8" r="2"/><circle cx="20" cy="16" r="2"/><path d="M9 10a5 5 0 0 1 5 5v3.5a3.5 3.5 0 0 1-6.84 1.045Q6.52 17.48 4.46 16.84A3.5 3.5 0 0 1 5.5 10Z"/>',
  user:     '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  edit:     '<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4z"/>',
  paperclip:'<path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>',
  list:     '<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>',
  'file-text':'<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/>',
  sparkles: '<path d="M12 3l1.9 4.6L18.5 9.5 13.9 11.4 12 16l-1.9-4.6L5.5 9.5l4.6-1.9z"/><path d="M19 14.5l.85 2.05L22 17.5l-2.15.95L19 20.5l-.85-2.05L16 17.5l2.15-.95z"/>',
  search:   '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
  home:     '<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>',
  plus:     '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
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
    // svg é montado a partir de BICON_PATHS (constante interna) por uma chave
    // de catálogo; não há HTML de origem externa/usuário aqui (XSS não aplicável).
    // nosemgrep: typescript.react.security.audit.react-unsanitized-method.react-unsanitized-method
    el.insertAdjacentHTML('afterbegin', svg + (el.textContent.trim() ? ' ' : ''));
    el.setAttribute('data-icon-done', '');
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => bIconsAplicar());
} else {
  bIconsAplicar();
}
