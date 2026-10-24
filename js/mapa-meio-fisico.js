// ── SIGUC — Meio físico do Acre no Mapa das UCs ───────────────────
// Fase 4 do plano em docs/mapa-ucs/plano-medicao-comparacao.md. Camadas
// estáticas em data/meio_fisico/<tema>.geojson, geradas SÓ por
// scripts/meio_fisico.py no workflow .github/workflows/meio-fisico.yml
// (IBGE responde 403 nas sessões de desenvolvimento; o runner alcança).
// Nunca editar o GeoJSON à mão: rodar o workflow de novo.
//
// Fonte única (prefixo `mf`). O desenho reaproveita a Fase 3
// (js/mapa-camadas-config.js): popup = ccfPopupHTML, cor por atributo =
// ccfCorDaFeicao/ccfItensLegenda — a mesma configuração `style_config` das
// camadas enviadas, aqui declarada no código para cada tema.
//
// Regras:
// - Escala e fonte SEMPRE escritas no painel e no popup: é mapeamento
//   regional (1:250 mil; clima 1:5 milhões), não serve para decidir a
//   classe de solo de um lote.
// - Pane própria ABAIXO das camadas vetoriais (UC, TI, CAR seguem por cima)
//   e acima das imagens.
// - Arquivo só é baixado quando o tema é ligado (a página não carrega
//   arquivos que ninguém pediu).
// - Rios NÃO estão aqui: o serviço da ANA não devolve geometria; o mapa já
//   mostra a hidrografia do IBGE BC250 por WMS (Cobertura Vegetal).

const MF_BASE = (typeof MF_DATA_URL !== 'undefined' ? MF_DATA_URL : '../data/meio_fisico/')
const MF_PANE = 'meioFisicoPane'

// popup.campos e colorirPor seguem o formato de style_config (ccf).
const MF_TEMAS = {
  geologia: {
    rotulo: 'Geologia', fonte: 'IBGE — Base Contínua de Geologia', escala: '1:250.000', cor: '#8B5E3C',
    colorir: ['nm_unidade', 'nm_tempo_g', 'nm_provincia'],
    popup: { titulo: 'nm_unidade', campos: [
      { campo: 'letra_simb', rotulo: 'Sigla' }, { campo: 'nm_tempo_g', rotulo: 'Tempo geológico' },
      { campo: 'nm_provincia', rotulo: 'Província' }, { campo: 'nm_sub_provincia', rotulo: 'Subprovíncia' },
      { campo: 'nm_lito1', rotulo: 'Litologia principal' }, { campo: 'nm_lito2', rotulo: 'Litologia' }, { campo: 'nm_lito3', rotulo: 'Litologia' }] },
  },
  geomorfologia: {
    rotulo: 'Geomorfologia', fonte: 'IBGE — Base Contínua de Geomorfologia', escala: '1:250.000', cor: '#B7791F',
    colorir: ['nm_unidade', 'nm_dominio', 'nm_regiao', 'compartimento'],
    popup: { titulo: 'nm_unidade', campos: [
      { campo: 'nm_dominio', rotulo: 'Domínio' }, { campo: 'nm_regiao', rotulo: 'Região geomorfológica' },
      { campo: 'compartimento', rotulo: 'Compartimento do relevo' }, { campo: 'letra_simb', rotulo: 'Símbolo' },
      { campo: 'categoria', rotulo: 'Categoria' }, { campo: 'natureza', rotulo: 'Natureza' },
      { campo: 'forma', rotulo: 'Forma' }, { campo: 'legenda', rotulo: 'Descrição' }] },
  },
  pedologia: {
    rotulo: 'Solos (pedologia)', fonte: 'IBGE — Base Contínua de Pedologia', escala: '1:250.000', cor: '#A0522D',
    colorir: ['ordem', 'legenda_2', 'subordem', 'textura'],
    popup: { titulo: 'legenda_2', campos: [
      { campo: 'nom_unidad', rotulo: 'Unidade de mapeamento' }, { campo: 'cod_simbol', rotulo: 'Símbolo' },
      { campo: 'ordem', rotulo: 'Ordem' }, { campo: 'subordem', rotulo: 'Subordem' }, { campo: 'grande_gru', rotulo: 'Grande grupo' },
      { campo: 'textura', rotulo: 'Textura' }, { campo: 'horizonte', rotulo: 'Horizonte' }, { campo: 'relevo', rotulo: 'Relevo' },
      { campo: 'componente', rotulo: 'Componentes da associação' }] },
  },
  vegetacao: {
    rotulo: 'Vegetação', fonte: 'IBGE — Base Contínua de Vegetação', escala: '1:250.000', cor: '#2F7D4A',
    colorir: ['leg_sup', 'legenda_2', 'nm_uantr'],
    popup: { titulo: 'legenda_2', campos: [
      { campo: 'leg_sup', rotulo: 'Cobertura dominante' }, { campo: 'nm_uveg', rotulo: 'Unidade de vegetação' },
      { campo: 'nm_uantr', rotulo: 'Uso antrópico' }, { campo: 'nm_contat', rotulo: 'Contato entre formações' },
      { campo: 'nm_pretet', rotulo: 'Vegetação pretérita' }, { campo: 'legenda_1', rotulo: 'Descrição' }] },
  },
  clima: {
    rotulo: 'Clima', fonte: 'IBGE — Atlas Nacional (climas)', escala: '1:5.000.000', cor: '#3B82B0',
    colorir: ['temperat', 'umida_seca'],
    popup: { titulo: 'temperat', campos: [
      { campo: 'temperat', rotulo: 'Classificação térmica' }, { campo: 'umida_seca', rotulo: 'Umidade / meses secos' }] },
  },
  massas_dagua: {
    rotulo: 'Massas d\'água', fonte: 'ANA — SNIRH (massas d\'água)', escala: null, cor: '#0E7490',
    colorir: ['detipomass', 'dedominial', 'nuareaha'],
    popup: { titulo: 'nmoriginal', campos: [
      { campo: 'nmgenerico', rotulo: 'Tipo (nome)' }, { campo: 'detipomass', rotulo: 'Tipo' },
      { campo: 'dedominial', rotulo: 'Domínio' }, { campo: 'usoprinc', rotulo: 'Uso principal' },
      { campo: 'nuareaha', rotulo: 'Área (cadastro ANA)', sufixo: ' ha', casas: 1 }] },
  },
  bacias_ana: {
    rotulo: 'Micro-regiões hidrográficas', fonte: 'ANA — Divisão hidrográfica nacional', escala: null, cor: '#4F46E5',
    colorir: ['DMI_NM'],
    popup: { titulo: 'DMI_NM', campos: [
      { campo: 'DMI_CD', rotulo: 'Código' },
      { campo: 'DMI_AR_KM2', rotulo: 'Área total da micro-região', sufixo: ' km²', casas: 0 }] },
  },
}

// O serviço da ANA não publica a escala (descrição vazia, conferido no
// workflow): diz isso em vez de inventar um número.
function _mfEscala(t) { return t.escala ? `escala ${t.escala}` : 'escala não informada pelo serviço' }

function _mfUnidade(n) { return `${n.toLocaleString('pt-BR')} ${n === 1 ? 'polígono' : 'polígonos'}` }

const _mf = { mapa: null, cache: {}, camadas: {}, aoMudar: null, pref: {} }

function _mfPrefCarregar() {
  try { _mf.pref = JSON.parse(localStorage.getItem('siguc_meio_fisico') || '{}') || {} } catch (_) { _mf.pref = {} }
  _mf.pref.ativos = Array.isArray(_mf.pref.ativos) ? _mf.pref.ativos.filter(t => MF_TEMAS[t]) : []
  _mf.pref.colorir = _mf.pref.colorir || {}
  _mf.pref.opacidade = _mf.pref.opacidade || {}
}
function _mfPrefSalvar() {
  try { localStorage.setItem('siguc_meio_fisico', JSON.stringify({ ativos: Object.keys(_mf.camadas), colorir: _mf.pref.colorir, opacidade: _mf.pref.opacidade })) } catch (_) {}
}

// opts.aoMudar(): chamado a cada ligar/desligar/recolorir (a página
// atualiza legenda e contadores por ele).
function mfMontar(mapa, opts = {}) {
  if (!mapa || typeof L === 'undefined' || _mf.mapa === mapa) return
  _mf.mapa = mapa
  _mf.aoMudar = opts.aoMudar || null
  if (!mapa.getPane(MF_PANE)) {
    mapa.createPane(MF_PANE)
    mapa.getPane(MF_PANE).style.zIndex = 350 // tilePane 200 / comparação 250 < aqui < overlayPane 400
  }
  _mfPrefCarregar()
  _mf.pref.ativos.forEach(t => mfAlternar(t, true))
}

async function _mfCarregar(tema) {
  if (_mf.cache[tema]) return _mf.cache[tema]
  const r = await fetch(MF_BASE + tema + '.geojson')
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  _mf.cache[tema] = await r.json()
  return _mf.cache[tema]
}

// Objeto no formato de `camadas_mapa`, para as funções ccf* lerem igual.
function _mfCamada(tema, gj) {
  const t = MF_TEMAS[tema]
  const campo = _mf.pref.colorir[tema] || t.colorir[0]
  const colorirPor = campo ? { campo, cores: {} } : undefined
  // Campo numérico (área) vira degradê em escala log: poucas lagoas grandes
  // e centenas pequenas — na linear, quase tudo sairia da mesma cor.
  if (colorirPor && typeof ccfFaixaNumerica === 'function' && ccfFaixaNumerica({ geojson: gj }, campo)) {
    colorirPor.modo = 'degrade'; colorirPor.escala = 'log'
  }
  return {
    id: 'mf-' + tema, nome: t.rotulo, cor: t.cor, geojson: gj,
    style_config: { popup: t.popup, colorirPor },
  }
}

function mfOpacidade(tema) { return _mf.pref.opacidade[tema] ?? 0.45 }

function _mfDesenhar(tema) {
  const reg = _mf.camadas[tema]; if (!reg) return
  if (reg.layer) _mf.mapa.removeLayer(reg.layer)
  const c = reg.camada
  const cores = ccfCoresClasses(c)
  const op = mfOpacidade(tema)
  const t = MF_TEMAS[tema]
  reg.layer = L.geoJSON(c.geojson, {
    pane: MF_PANE,
    style: f => { const cor = cores ? ccfCorDaFeicao(c, f.properties, cores) : t.cor; return { color: cor, weight: 0.6, opacity: 0.9, fillColor: cor, fillOpacity: op } },
    onEachFeature: (f, layer) => layer.bindPopup(() =>
      ccfPopupHTML(c, f, {}) + `<div class="mf-fonte">${ccfEsc(t.fonte)} · ${ccfEsc(_mfEscala(t))}. Mapeamento regional — não substitui levantamento de campo.</div>`,
      { className: 'camada-popup-wrap', maxWidth: 360 }),
  }).addTo(_mf.mapa)
}

async function mfAlternar(tema, ligar) {
  if (!MF_TEMAS[tema] || !_mf.mapa) return
  if (!ligar) {
    const reg = _mf.camadas[tema]
    if (reg && reg.layer) _mf.mapa.removeLayer(reg.layer)
    delete _mf.camadas[tema]
    _mfPrefSalvar(); _mfStatus(tema, ''); _mf.aoMudar && _mf.aoMudar()
    return
  }
  if (_mf.camadas[tema]) return
  _mf.camadas[tema] = { camada: null, layer: null }
  _mfStatus(tema, 'Carregando…')
  try {
    const gj = await _mfCarregar(tema)
    if (!_mf.camadas[tema]) return // desligado enquanto baixava
    _mf.camadas[tema].camada = _mfCamada(tema, gj)
    _mfDesenhar(tema)
    _mfStatus(tema, _mfUnidade((gj.features || []).length))
  } catch (e) {
    delete _mf.camadas[tema]
    _mfStatus(tema, 'Não foi possível carregar o arquivo.', true)
    const chk = document.querySelector(`[data-mf-tema="${tema}"] [data-mf-acao="ligar"]`)
    if (chk) chk.checked = false
  }
  _mfPrefSalvar(); _mf.aoMudar && _mf.aoMudar()
}

function mfColorirPor(tema, campo) {
  _mf.pref.colorir[tema] = campo
  const reg = _mf.camadas[tema]
  if (reg && reg.camada) { reg.camada = _mfCamada(tema, reg.camada.geojson); _mfDesenhar(tema) }
  _mfPrefSalvar(); _mf.aoMudar && _mf.aoMudar()
}

function mfDefinirOpacidade(tema, v) {
  _mf.pref.opacidade[tema] = v
  const reg = _mf.camadas[tema]
  if (reg && reg.layer) reg.layer.setStyle({ fillOpacity: v })
  _mfPrefSalvar()
}

function mfAtivos() { return Object.keys(_mf.camadas).filter(t => _mf.camadas[t].camada) }

// Legenda (tela e impressão): uma linha por classe de cada tema ligado.
function mfItensLegenda() {
  const itens = []
  mfAtivos().forEach(t => {
    const c = _mf.camadas[t].camada
    const porClasse = ccfItensLegenda(c, mfOpacidade(t))
    if (porClasse) itens.push(...porClasse)
    else itens.push({ simbolo: 'rect', cor: MF_TEMAS[t].cor, opacidade: mfOpacidade(t), label: MF_TEMAS[t].rotulo })
  })
  return itens
}

function _mfStatus(tema, txt, erro) {
  const el = document.querySelector(`[data-mf-tema="${tema}"] .mf-status`)
  if (el) { el.textContent = txt; el.classList.toggle('mf-erro', !!erro) }
}

const _MF_ROTULO_CAMPO = {
  nm_unidade: 'Unidade', nm_tempo_g: 'Tempo geológico', nm_provincia: 'Província', nm_dominio: 'Domínio',
  nm_regiao: 'Região', compartimento: 'Compartimento', ordem: 'Ordem do solo', legenda_2: 'Classe detalhada',
  subordem: 'Subordem', textura: 'Textura', leg_sup: 'Cobertura dominante', nm_uantr: 'Uso antrópico',
  temperat: 'Temperatura', umida_seca: 'Umidade', 
  detipomass: 'Tipo', dedominial: 'Domínio', nuareaha: 'Área (degradê)', DMI_NM: 'Micro-região',
}

// Corpo da aba "Meio Físico" da barra de camadas.
function mfPainelHTML() {
  return Object.entries(MF_TEMAS).map(([k, t]) => {
    const on = !!_mf.camadas[k]
    const campo = _mf.pref.colorir[k] || t.colorir[0]
    const op = Math.round(mfOpacidade(k) * 100)
    return `<div class="mf-tema" data-mf-tema="${k}">
      <label class="mf-cab"><input type="checkbox" data-mf-acao="ligar"${on ? ' checked' : ''}>
        <span class="mf-amostra" style="background:${t.cor}"></span><span class="mf-nome">${ccfEsc(t.rotulo)}</span>
        <span class="mf-status" role="status" aria-live="polite">${on && _mf.camadas[k].camada ? _mfUnidade(_mf.camadas[k].camada.geojson.features.length) : ''}</span></label>
      <div class="mf-meta">${ccfEsc(t.fonte)} · ${ccfEsc(_mfEscala(t))}</div>
      <div class="mf-ctrl">
        <label>Colorir por <select data-mf-acao="colorir">${t.colorir.map(c => `<option value="${c}"${c === campo ? ' selected' : ''}>${ccfEsc(_MF_ROTULO_CAMPO[c] || c)}</option>`).join('')}</select></label>
        <label>Opacidade <input type="range" min="0" max="100" step="5" value="${op}" data-mf-acao="opacidade" aria-label="Opacidade de ${ccfEsc(t.rotulo)}"></label>
      </div>
    </div>`
  }).join('') + `<div class="mf-nota">Mapeamento regional do IBGE e da ANA, recortado pelo limite do Acre. Use para leitura de contexto; não substitui levantamento de campo.</div>`
}

// Delegação no contêiner da aba (o HTML é refeito a cada abertura).
function mfLigarPainel(el) {
  if (!el || el._mfLigado) return
  el._mfLigado = true
  el.addEventListener('change', ev => {
    const t = ev.target, box = t.closest('[data-mf-tema]'); if (!box) return
    const tema = box.dataset.mfTema
    if (t.dataset.mfAcao === 'ligar') mfAlternar(tema, t.checked)
    else if (t.dataset.mfAcao === 'colorir') mfColorirPor(tema, t.value)
  })
  el.addEventListener('input', ev => {
    const t = ev.target
    if (t.dataset.mfAcao !== 'opacidade') return
    mfDefinirOpacidade(t.closest('[data-mf-tema]').dataset.mfTema, Number(t.value) / 100)
  })
}

function mfEstilos() {
  if (document.getElementById('mf-estilos')) return
  const st = document.createElement('style')
  st.id = 'mf-estilos'
  st.textContent = `
.mf-tema{border:1px solid var(--borda,#e5e7eb);border-radius:8px;padding:8px 10px;display:flex;flex-direction:column;gap:4px;}
.mf-cab{display:flex;align-items:center;gap:8px;font-size:12px;font-weight:600;cursor:pointer;min-height:24px;}
.mf-cab input{width:14px;height:14px;accent-color:#1F4E2C;}
.mf-amostra{width:14px;height:14px;border-radius:3px;flex-shrink:0;opacity:.8;}
.mf-nome{flex:1;min-width:0;}
.mf-status{font-size:10.5px;font-weight:500;color:var(--cinza-500,#6b7280);}
.mf-erro{color:#B91C1C;}
.mf-meta{font-size:10.5px;color:var(--cinza-500,#6b7280);}
.mf-ctrl{display:flex;gap:10px;flex-wrap:wrap;font-size:11px;color:var(--cinza-600,#4b5563);}
.mf-ctrl label{display:flex;align-items:center;gap:6px;}
.mf-ctrl select{min-height:26px;font-size:11px;border:1px solid var(--borda,#d1d5db);border-radius:5px;background:#fff;max-width:170px;}
.mf-ctrl input[type=range]{width:90px;accent-color:#1F4E2C;}
.mf-ctrl select:focus-visible,.mf-ctrl input:focus-visible,.mf-cab input:focus-visible{outline:2px solid #C9A84C;outline-offset:1px;}
.mf-nota,.mf-fonte{font-size:10.5px;color:var(--cinza-500,#6b7280);}
.mf-fonte{margin:6px 12px 8px;}
`
  document.head.appendChild(st)
}
