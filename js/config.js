// ── SIGUC-AC · Configuração Supabase ─────────────────────────
const SUPABASE_URL = 'https://atqtybcsvepdabsvgaly.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF0cXR5YmNzdmVwZGFic3ZnYWx5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA0MjMzNzgsImV4cCI6MjA5NTk5OTM3OH0.hWx1AB2rK7xdco1Dgagm0XUOBPQbxZVE614SW4SKoLk';

// Observabilidade — inicializada antes de qualquer chamada ao banco
Observability.init();

const { createClient } = supabase;
// sessionStorage: sessão encerra ao fechar o navegador (Regra de segurança)
const db = createInstrumentedDb(createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { storage: window.sessionStorage, persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
}));

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
      FLONA: 'Floresta Nacional', RESEX: 'Reserva Extrativista',
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
