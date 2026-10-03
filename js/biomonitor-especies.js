// ── SIGUC-AC · Biomonitor — nomes de espécie (fonte única) ──────
// O nome que aparece na tela vem SEMPRE do catálogo editável
// (especies_quelonio_catalogo, Administrar › Espécies). Antes cada tela e
// relatório tinha sua própria lista fixa: a SEMA renomeou o pitiú para
// Iaçá no catálogo (21/09/2026) e metade do sistema continuou mostrando
// "Pitiú". Mesma lição de js/frota-consumo.js — nunca mais uma lista de
// nomes por página.
//
// Uso:
//   const NOMES = bioEspNomes({ tracaja: 'Tracajá', ... })  // mapa da página
//   await bioEspCarregar(cliente)                           // no init
// `bioEspNomes` devolve o PRÓPRIO objeto, registrado: quando o catálogo
// chega (ou já estava em cache), os nomes são trocados nele, então quem
// já guardou a referência passa a ler o nome certo sem mudar nada.
// O mapa da página é só reserva para o caso de o arquivo/banco faltar.
//
// Lê TODAS as espécies, inclusive as desativadas: ninho antigo de
// espécie desativada continua com nome, nunca com o código cru.
// Cache em localStorage (mesma origem para mesa e app) — o nome certo
// aparece já na primeira pintura, antes da consulta voltar, e offline.

const BIO_ESP_CACHE_CHAVE = 'siguc_bio_especies_catalogo'

// Reserva final, alinhada com o catálogo de produção (03/10/2026).
// 'pitiU' é código histórico: a espécie é o Iaçá (P. sextuberculata).
const BIO_ESP_PADRAO = {
  tracaja:            { nome: 'Tracajá',               sigla: 'TR', nome_cientifico: 'Podocnemis unifilis' },
  tartaruga:          { nome: 'Tartaruga-da-amazônia', sigla: 'TA', nome_cientifico: 'Podocnemis expansa' },
  cabecudo:           { nome: 'Cabeçudo',              sigla: 'R',  nome_cientifico: '' },
  pitiU:              { nome: 'Iaçá',                  sigla: 'IA', nome_cientifico: 'Podocnemis sextuberculata' },
  mucua:              { nome: 'Muçuã',                 sigla: 'MU', nome_cientifico: 'Kinosternon scorpioides' },
  jabuti_pe_elefante: { nome: 'Jabuti-pé-de-elefante', sigla: 'JE', nome_cientifico: 'Chelonoidis denticulatus' },
  jabuti_piranga:     { nome: 'Jabuti-piranga',        sigla: 'JP', nome_cientifico: 'Chelonoidis carbonarius' },
  cupido:             { nome: 'Cupido',                sigla: 'CU', nome_cientifico: 'Podocnemis cayennensis' },
  outro:              { nome: 'Outro',                 sigla: 'OU', nome_cientifico: '' },
}

let _bioEspCatalogo = null          // { codigo: {nome, sigla, nome_cientifico, ativo, ordem} }
const _bioEspMapas = []             // mapas de nome registrados pelas páginas

function _bioEspLerCache() {
  try {
    const bruto = localStorage.getItem(BIO_ESP_CACHE_CHAVE)
    const obj = bruto ? JSON.parse(bruto) : null
    return obj && typeof obj === 'object' ? obj : null
  } catch (_) { return null }
}

function _bioEspAplicarEm(mapa) {
  if (!_bioEspCatalogo) return
  Object.keys(_bioEspCatalogo).forEach(cod => {
    const nome = _bioEspCatalogo[cod]?.nome
    if (nome) mapa[cod] = nome
  })
}

// Recebe linhas do catálogo (codigo, nome_popular, sigla_placa, ...)
// e passa a valer para todo mapa registrado.
function bioEspDefinir(linhas) {
  if (!Array.isArray(linhas) || !linhas.length) return
  const cat = {}
  linhas.forEach(e => {
    if (!e?.codigo) return
    cat[e.codigo] = {
      nome: e.nome_popular || BIO_ESP_PADRAO[e.codigo]?.nome || e.codigo,
      sigla: e.sigla_placa || BIO_ESP_PADRAO[e.codigo]?.sigla || '',
      nome_cientifico: e.nome_cientifico || '',
      ativo: e.ativo !== false,
      ordem: e.ordem ?? 999,
    }
  })
  _bioEspCatalogo = cat
  try { localStorage.setItem(BIO_ESP_CACHE_CHAVE, JSON.stringify(cat)) } catch (_) {}
  _bioEspMapas.forEach(_bioEspAplicarEm)
}

// Registra (e devolve) o mapa de nomes da página.
function bioEspNomes(mapa) {
  const m = mapa || {}
  Object.keys(BIO_ESP_PADRAO).forEach(cod => { if (!(cod in m)) m[cod] = BIO_ESP_PADRAO[cod].nome })
  _bioEspMapas.push(m)
  _bioEspAplicarEm(m)
  return m
}

// Nome de UMA espécie, para quem não tem mapa próprio.
function bioEspecieNome(codigo) {
  if (!codigo) return '—'
  return _bioEspCatalogo?.[codigo]?.nome || BIO_ESP_PADRAO[codigo]?.nome || codigo
}

function bioEspecieSigla(codigo) {
  return _bioEspCatalogo?.[codigo]?.sigla || BIO_ESP_PADRAO[codigo]?.sigla || ''
}

// Busca o catálogo inteiro. Falha de rede/permissão = segue com o cache
// ou com a reserva — nunca quebra a tela por causa do nome.
async function bioEspCarregar(cliente) {
  const c = cliente
    || (typeof window !== 'undefined' && window._bioDB_client)
    || (typeof sigucDb === 'function' ? sigucDb() : null)
  if (!c?.from) return _bioEspCatalogo
  try {
    const { data, error } = await c.from('especies_quelonio_catalogo')
      .select('codigo,nome_popular,nome_cientifico,sigla_placa,ativo,ordem')
      .order('ordem')
    if (!error && data?.length) bioEspDefinir(data)
  } catch (_) {}
  return _bioEspCatalogo
}

// Cache aplicado já no carregamento do arquivo: o nome certo aparece na
// primeira pintura, antes de qualquer consulta.
;(function () {
  const cache = _bioEspLerCache()
  if (cache) _bioEspCatalogo = cache
})()
