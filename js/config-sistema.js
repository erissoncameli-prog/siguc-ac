// SIGUC-AC · Config Institucional
// Helper global para acessar dados de config_sistema em qualquer página.
// Carregado via <script src="../js/config-sistema.js"> antes de usar.

let _configSistemaCache = null;

async function getConfigSistema() {
  if (_configSistemaCache) return _configSistemaCache;
  const { data } = await db.from('config_sistema').select('dados').eq('id', 1).single();
  _configSistemaCache = data?.dados || {};
  return _configSistemaCache;
}

const CONFIG_SISTEMA_STORAGE_KEY = 'siguc_config_sistema_atualizado';

// Zera o cache desta aba e avisa as OUTRAS abas/páginas já abertas (ex.:
// um relatório aberto numa aba enquanto alguém troca a logo em
// Configurações noutra) — o evento `storage` só dispara nas abas que NÃO
// fizeram a mudança, então a própria aba de Configurações já zera o cache
// direto e as demais recebem o aviso sozinhas, sem polling e sem precisar
// recarregar a página para a logo/dado institucional novo valer.
function invalidarConfigCache() {
  _configSistemaCache = null;
  try { localStorage.setItem(CONFIG_SISTEMA_STORAGE_KEY, String(Date.now())); } catch (e) {}
}

window.addEventListener('storage', ev => {
  if (ev.key === CONFIG_SISTEMA_STORAGE_KEY) _configSistemaCache = null;
});

async function getCabecalhoRelatorio() {
  const cfg = await getConfigSistema();
  return {
    governo:      cfg.governo?.nome      || 'Governo do Estado do Acre',
    gestao:       cfg.governo?.gestao    || '',
    secretaria:   cfg.secretaria?.nome   || 'Secretaria de Estado do Meio Ambiente do Acre',
    siglaSecr:    cfg.secretaria?.sigla  || 'SEMA-AC',
    diretoria:    cfg.diretoria?.nome    || 'Diretoria de Meio Ambiente',
    siglaDiret:   cfg.diretoria?.sigla   || 'DIMA',
    departamento: cfg.departamento?.nome || 'Departamento de Unidades de Conservação',
    siglaDep:     cfg.departamento?.sigla|| 'DEUC',
    endereco:     cfg.secretaria?.endereco || '',
    cep:          cfg.secretaria?.cep      || '',
    telefone:     cfg.secretaria?.telefone || '',
    email:        cfg.secretaria?.email    || '',
    site:         cfg.secretaria?.site     || '',
    logoGoverno:  cfg.logos?.governo_url   || null,
    logoSecr:     cfg.logos?.secretaria_url|| null,
    rodapeTxt:    cfg.rodape_texto || 'Documento gerado automaticamente pelo SIGUC-AC.',
    avisoLegal:   cfg.aviso_legal  || '',
    responsaveis: Array.isArray(cfg.responsaveis_tecnicos) ? cfg.responsaveis_tecnicos : [],
  };
}

async function gerarProtocolo() {
  const { data, error } = await db.rpc('gerar_protocolo_relatorio');
  if (error) {
    const ano = new Date().getFullYear();
    return `SIGUC-${ano}-XXXX`;
  }
  invalidarConfigCache();
  return data;
}
