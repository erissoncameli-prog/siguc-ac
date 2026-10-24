// ── SIGUC — Popup e cor por atributo das camadas enviadas ao mapa ──
// Fase 3 do plano em docs/mapa-ucs/plano-medicao-comparacao.md. Fonte
// única (prefixo `ccf`) para o que as camadas de `camadas_mapa` mostram:
// popup, área/perímetro/comprimento calculados, cor por atributo e itens de
// legenda. A página (`_renderizarCamada`, pages/mapa.html) só chama estas
// funções; o editor do gestor monta o mesmo `style_config` que já era salvo.
// Ideia vista no jurema-webgis (popup declarativo por camada) — sem código dele.
//
// Configuração, dentro de `camadas_mapa.style_config` (jsonb que já existia —
// sem migration):
//   popup:     { titulo: 'Num_Lote', campos: [{ campo, rotulo, prefixo, sufixo, casas }] }
//              campos ausente = mostra todos (menos os técnicos), como sempre.
//   colorirPor: { campo: 'Zona', cores: { 'ZPI': '#009E73', … } }
//
// Regras:
// - Medida calculada sai SEMPRE rotulada "calculada no mapa (não registral)":
//   o número do memorial/CAR é o que vale; o do polígono desenhado é outro.
// - Dado pessoal NUNCA está no GeoJSON (migration 367 tira do servidor);
//   a feição só traz `_siguc_pid`. O popup oferece "Ver dados pessoais",
//   que passa pela RPC `camada_dados_pessoais` (pode_editar('mapa'), CPF
//   mascarado, log LGPD). Sem permissão, só diz que existe e é restrito.
// - Campo técnico de KML/shapefile (altitudeMode, tessellate…) nunca aparece.

const CCF_TECNICOS = new Set(['_siguc_pid', 'altitudemo', 'altitudemode', 'timestamp', 'visibility',
  'tessellate', 'extrude', 'draworder', 'begin', 'end', 'icon', 'styleurl', 'stylehash', 'shape_leng',
  'shape_area', 'shape_len', 'objectid', 'fid', 'geometry1_']);
const CCF_NOME = ['name', 'Name', 'NAME', 'nome', 'Nome', 'NOME'];
// Okabe-Ito (mesma de js/mapa-aparencia.js) + vinho de Paul Tol; cinza = outros
const CCF_PALETA = ['#E69F00', '#56B4E9', '#009E73', '#F0E442', '#0072B2', '#D55E00', '#CC79A7', '#882255'];
const CCF_COR_OUTROS = '#9CA3AF';
const CCF_MAX_CLASSES = 12;

function ccfEsc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function ccfTecnico(k) { return CCF_TECNICOS.has(String(k).toLowerCase()) }

// Chaves presentes nas feições (ordem da 1ª aparição), sem as técnicas.
function ccfCampos(c) {
  const vistos = new Set(), out = []
  for (const f of (c?.geojson?.features || [])) {
    for (const k of Object.keys(f.properties || {})) {
      if (!vistos.has(k) && !ccfTecnico(k)) { vistos.add(k); out.push(k) }
    }
  }
  return out
}

function ccfNomeFeicao(props) {
  for (const k of CCF_NOME) if (props && props[k] != null && props[k] !== '') return String(props[k])
  return ''
}

// Valor formatado: número com casas decimais e separador pt-BR quando o campo
// pede casas ou o valor é numérico; prefixo/sufixo como configurado.
function ccfFormatar(v, cfg = {}) {
  if (v === null || v === undefined || v === '') return ''
  let txt = String(v)
  const n = typeof v === 'number' ? v : (/^-?\d+(?:[.,]\d+)?$/.test(txt.trim()) ? Number(txt.trim().replace(',', '.')) : NaN)
  if (Number.isFinite(n) && (cfg.casas != null || typeof v === 'number')) {
    const casas = cfg.casas != null ? Number(cfg.casas) : (Number.isInteger(n) ? 0 : Math.min(3, (String(n).split('.')[1] || '').length))
    txt = n.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas })
  }
  return `${cfg.prefixo || ''}${txt}${cfg.sufixo || ''}`
}

// Linhas do popup: [{ rotulo, valor }], só com valor preenchido.
function ccfLinhas(c, props) {
  const pop = c?.style_config?.popup
  props = props || {}
  const titulo = pop?.titulo || null
  if (pop && Array.isArray(pop.campos) && pop.campos.length) {
    return pop.campos
      .filter(x => x && x.campo && !ccfTecnico(x.campo) && x.campo !== titulo)
      .map(x => ({ rotulo: x.rotulo || x.campo, valor: ccfFormatar(props[x.campo], x) }))
      .filter(l => l.valor !== '')
  }
  return Object.keys(props)
    .filter(k => !ccfTecnico(k) && k !== titulo && !CCF_NOME.includes(k))
    .map(k => ({ rotulo: k, valor: ccfFormatar(props[k]) }))
    .filter(l => l.valor !== '')
}

function ccfTitulo(c, props) {
  const campo = c?.style_config?.popup?.titulo
  if (campo && props && props[campo] != null && props[campo] !== '') return String(props[campo])
  return ccfNomeFeicao(props)
}

// Medida da geometria desenhada (turf, geodésica). null se não se aplica.
function ccfMetricas(geom) {
  if (!geom || typeof turf === 'undefined') return null
  try {
    if (geom.type === 'Polygon' || geom.type === 'MultiPolygon') {
      const f = turf.feature(geom)
      const areaHa = turf.area(f) / 10000
      const perimetroM = turf.length(turf.polygonToLine(f), { units: 'kilometers' }) * 1000
      return Number.isFinite(areaHa) && areaHa > 0 ? { areaHa, perimetroM } : null
    }
    if (geom.type === 'LineString' || geom.type === 'MultiLineString') {
      const comprimentoM = turf.length(turf.feature(geom), { units: 'kilometers' }) * 1000
      return comprimentoM > 0 ? { comprimentoM } : null
    }
  } catch (_) { /* geometria inválida: sem medida, nunca quebra o popup */ }
  return null
}

function _ccfMetro(m) {
  return m >= 1000 ? `${(m / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} km`
    : `${m.toLocaleString('pt-BR', { maximumFractionDigits: 0 })} m`
}

// ── Cor por atributo ────────────────────────────────────────────────
// Valores distintos do campo, do mais frequente ao menos; acima de
// CCF_MAX_CLASSES o resto vira "Outros" (cinza) — senão a legenda vira lista.
function ccfValores(c, campo) {
  const cont = new Map()
  for (const f of (c?.geojson?.features || [])) {
    const v = f.properties?.[campo]
    const k = v === null || v === undefined || v === '' ? '(sem valor)' : String(v)
    cont.set(k, (cont.get(k) || 0) + 1)
  }
  return [...cont.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'pt-BR'))
    .map(([valor, n]) => ({ valor, n }))
}

// Cores efetivas: as salvas + paleta na ordem de frequência para o resto.
function ccfCoresClasses(c) {
  const cfg = c?.style_config?.colorirPor
  if (!cfg || !cfg.campo) return null
  const salvas = cfg.cores || {}
  const out = new Map()
  ccfValores(c, cfg.campo).forEach(({ valor }, i) => {
    out.set(valor, salvas[valor] || (i < CCF_MAX_CLASSES ? CCF_PALETA[i % CCF_PALETA.length] : CCF_COR_OUTROS))
  })
  return out
}

function ccfCorDaFeicao(c, props, coresCache) {
  const cfg = c?.style_config?.colorirPor
  if (!cfg || !cfg.campo) return null
  const cores = coresCache || ccfCoresClasses(c)
  const v = props?.[cfg.campo]
  const k = v === null || v === undefined || v === '' ? '(sem valor)' : String(v)
  return cores.get(k) || CCF_COR_OUTROS
}

// Itens de legenda (tela e impressão): um por classe, ou null sem classificação.
function ccfItensLegenda(c, opacidade) {
  const cfg = c?.style_config?.colorirPor
  if (!cfg || !cfg.campo) return null
  const cores = ccfCoresClasses(c)
  const vals = ccfValores(c, cfg.campo)
  const itens = vals.slice(0, CCF_MAX_CLASSES).map(({ valor }) =>
    ({ simbolo: 'rect', cor: cores.get(valor), opacidade, label: `${c.nome} — ${valor}` }))
  if (vals.length > CCF_MAX_CLASSES) itens.push({ simbolo: 'rect', cor: CCF_COR_OUTROS, opacidade, label: `${c.nome} — outros` })
  return itens
}

// ── Popup ────────────────────────────────────────────────────────────
function ccfPopupHTML(c, feature, opts = {}) {
  const props = feature?.properties || {}
  const titulo = ccfTitulo(c, props)
  const linhas = ccfLinhas(c, props)
  const m = ccfMetricas(feature?.geometry)
  let medidas = ''
  if (m && m.areaHa != null) {
    medidas = `<div class="cp-row"><strong>Área calculada:</strong> <span>${m.areaHa.toLocaleString('pt-BR', { maximumFractionDigits: m.areaHa < 100 ? 2 : 1 })} ha</span></div>
      <div class="cp-row"><strong>Perímetro calculado:</strong> <span>${_ccfMetro(m.perimetroM)}</span></div>`
  } else if (m && m.comprimentoM != null) {
    medidas = `<div class="cp-row"><strong>Comprimento calculado:</strong> <span>${_ccfMetro(m.comprimentoM)}</span></div>`
  }
  const pid = props._siguc_pid
  const pessoal = pid
    ? (opts.podeVerPessoais
      ? `<div class="ccf-pessoal" data-ccf-camada="${ccfEsc(c.id)}" data-ccf-pid="${ccfEsc(pid)}">
           <button type="button" class="ccf-btn-pessoal" data-ccf-ver>Ver dados pessoais</button>
           <div class="ccf-nota">O acesso é registrado (LGPD). CPF/CNPJ aparece mascarado.</div>
         </div>`
      : `<div class="ccf-pessoal"><div class="ccf-nota">Esta feição tem dados pessoais (ocupante/detentor), de acesso restrito.</div></div>`)
    : ''
  return `<div class="camada-popup">
    <div class="cp-header" style="background:${ccfEsc(c.cor)}">${ccfEsc(c.nome)}</div>
    <div class="cp-layer">
      ${titulo ? `<div class="cp-layer-nome">${ccfEsc(titulo)}</div>` : ''}
      ${linhas.map(l => `<div class="cp-row"><strong>${ccfEsc(l.rotulo)}:</strong> <span>${ccfEsc(l.valor)}</span></div>`).join('')
        || (medidas || pessoal ? '' : '<div style="color:var(--cinza-400);font-size:11px">Sem informações adicionais</div>')}
      ${medidas ? `<div class="ccf-medidas">${medidas}<div class="ccf-nota">Medidas do desenho no mapa — não registrais.</div></div>` : ''}
      ${pessoal}
    </div>
  </div>`
}

// Clique em "Ver dados pessoais" (delegação no documento — o popup do
// Leaflet é recriado a cada abertura). `cliente` = supabase-js da página.
function ccfInstalarDadosPessoais(cliente) {
  if (window._ccfDadosPessoaisInstalado) return
  window._ccfDadosPessoaisInstalado = true
  document.addEventListener('click', async ev => {
    const btn = ev.target.closest && ev.target.closest('[data-ccf-ver]')
    if (!btn) return
    ev.preventDefault(); ev.stopPropagation()
    const box = btn.closest('.ccf-pessoal')
    btn.disabled = true
    btn.textContent = 'Consultando…'
    const db = typeof cliente === 'function' ? cliente() : cliente
    const { data, error } = await db.rpc('camada_dados_pessoais', { p_camada: box.dataset.ccfCamada, p_pid: box.dataset.ccfPid })
    if (error) {
      box.innerHTML = `<div class="ccf-nota ccf-erro">${ccfEsc(/permiss/i.test(error.message) ? 'Sem permissão para ver estes dados.' : 'Não foi possível consultar agora.')}</div>`
      return
    }
    const lista = Array.isArray(data) ? data : []
    box.innerHTML = (lista.length
      ? lista.map(x => `<div class="cp-row"><strong>${ccfEsc(x.campo)}:</strong> <span>${ccfEsc(x.valor)}</span></div>`).join('')
      : '<div class="ccf-nota">Nenhum dado pessoal registrado para esta feição.</div>')
      + '<div class="ccf-nota">Acesso registrado.</div>'
  }, true)
}

// ── Editor (gestor) ──────────────────────────────────────────────────
// HTML da seção "Popup e cor por atributo" dentro do ⚙ da camada. Muda o
// style_config em memória (ccfEditar) e redesenha; salvar é o botão
// "Salvar estilo" que já existe (grava style_config inteiro).
function ccfEditorHTML(c) {
  const sc = c.style_config || {}
  const campos = ccfCampos(c)
  if (!campos.length) return ''
  const pop = sc.popup || {}
  const conf = new Map((pop.campos || []).map(x => [x.campo, x]))
  const todos = !(pop.campos && pop.campos.length)
  const id = ccfEsc(c.id)
  const opt = (v, sel) => `<option value="${ccfEsc(v)}"${v === sel ? ' selected' : ''}>${ccfEsc(v)}</option>`
  const cor = sc.colorirPor || {}
  const coresAtuais = ccfCoresClasses(c)
  const vals = cor.campo ? ccfValores(c, cor.campo) : []
  return `<div class="camada-expand-section ccf-editor" data-ccf-editor="${id}">
    <div class="camada-expand-section-title">Popup</div>
    <label class="ccf-lbl">Título
      <select data-ccf-acao="titulo"><option value="">(nome da feição)</option>${campos.map(k => opt(k, pop.titulo)).join('')}</select></label>
    <div class="ccf-campos">
      <div class="ccf-campos-cab"><span>Mostrar</span><span>Rótulo</span><span>Sufixo</span><span>Casas</span></div>
      ${campos.map(k => {
        const x = conf.get(k) || {}
        const on = todos || conf.has(k)
        return `<div class="ccf-campo" data-ccf-campo="${ccfEsc(k)}">
          <label class="ccf-chk" title="${ccfEsc(k)}"><input type="checkbox" data-ccf-acao="mostrar"${on ? ' checked' : ''}><span>${ccfEsc(k)}</span></label>
          <input type="text" data-ccf-acao="rotulo" value="${ccfEsc(x.rotulo || '')}" placeholder="${ccfEsc(k)}" aria-label="Rótulo de ${ccfEsc(k)}">
          <input type="text" data-ccf-acao="sufixo" value="${ccfEsc(x.sufixo || '')}" placeholder="ex.: ha" aria-label="Sufixo de ${ccfEsc(k)}">
          <input type="number" min="0" max="6" data-ccf-acao="casas" value="${x.casas ?? ''}" aria-label="Casas decimais de ${ccfEsc(k)}">
        </div>`
      }).join('')}
    </div>
    <div class="camada-expand-section-title" style="margin-top:8px">Colorir por atributo</div>
    <label class="ccf-lbl">Campo
      <select data-ccf-acao="colorir"><option value="">(cor única / sub-camadas)</option>${campos.map(k => opt(k, cor.campo)).join('')}</select></label>
    ${cor.campo ? `<div class="ccf-classes">${vals.slice(0, CCF_MAX_CLASSES).map(({ valor, n }) => `
      <label class="ccf-classe"><input type="color" data-ccf-acao="cor" data-ccf-valor="${ccfEsc(valor)}" value="${coresAtuais.get(valor)}" class="camada-color-mini" aria-label="Cor de ${ccfEsc(valor)}">
        <span>${ccfEsc(valor)}</span><span class="ccf-n">${n}</span></label>`).join('')}
      ${vals.length > CCF_MAX_CLASSES ? `<div class="ccf-nota">${vals.length - CCF_MAX_CLASSES} valor(es) a mais ficam em cinza ("outros").</div>` : ''}</div>` : ''}
  </div>`
}

// Aplica uma edição do editor ao style_config da camada (em memória).
function ccfEditar(c, acao, el) {
  const sc = c.style_config || (c.style_config = {})
  const linha = el.closest('[data-ccf-campo]')
  const campos = ccfCampos(c)
  const garantirLista = () => {
    const pop = sc.popup || (sc.popup = {})
    if (!Array.isArray(pop.campos) || !pop.campos.length) pop.campos = campos.map(k => ({ campo: k }))
    return pop
  }
  if (acao === 'titulo') { (sc.popup || (sc.popup = {})).titulo = el.value || undefined; return }
  if (acao === 'colorir') { sc.colorirPor = el.value ? { campo: el.value, cores: {} } : undefined; return }
  if (acao === 'cor') { (sc.colorirPor.cores || (sc.colorirPor.cores = {}))[el.dataset.ccfValor] = el.value; return }
  if (!linha) return
  const campo = linha.dataset.ccfCampo
  const pop = garantirLista()
  let item = pop.campos.find(x => x.campo === campo)
  if (acao === 'mostrar') {
    if (el.checked && !item) {
      // reentra na posição original do campo
      const ordem = new Map(campos.map((k, i) => [k, i]))
      pop.campos.push({ campo }); pop.campos.sort((a, b) => (ordem.get(a.campo) ?? 0) - (ordem.get(b.campo) ?? 0))
    } else if (!el.checked) pop.campos = pop.campos.filter(x => x.campo !== campo)
    return
  }
  if (!item) { item = { campo }; pop.campos.push(item) }
  if (acao === 'rotulo') item.rotulo = el.value.trim() || undefined
  if (acao === 'sufixo') item.sufixo = el.value || undefined
  if (acao === 'casas') item.casas = el.value === '' ? undefined : Math.max(0, Math.min(6, parseInt(el.value, 10) || 0))
}

function ccfEstilos() {
  if (document.getElementById('ccf-estilos')) return
  const st = document.createElement('style')
  st.id = 'ccf-estilos'
  st.textContent = `
.ccf-medidas{margin-top:6px;padding-top:6px;border-top:1px dashed #d1d5db;}
.ccf-nota{font-size:10.5px;color:#6b7280;margin-top:3px;}
.ccf-erro{color:#B91C1C;}
.ccf-pessoal{margin-top:8px;padding:6px 8px;border-radius:6px;background:#FEF3C7;}
.ccf-btn-pessoal{min-height:26px;padding:3px 10px;border:1px solid #92400E;border-radius:6px;background:#fff;color:#78350F;font:600 11px 'DM Sans',sans-serif;cursor:pointer;}
.ccf-btn-pessoal:focus-visible,.ccf-editor select:focus-visible,.ccf-editor input:focus-visible{outline:2px solid #C9A84C;outline-offset:1px;}
.ccf-btn-pessoal:disabled{opacity:.6;cursor:progress;}
.ccf-lbl{display:flex;align-items:center;gap:6px;font-size:11px;color:var(--cinza-600,#4b5563);margin:4px 0;}
.ccf-lbl select{flex:1;min-width:0;min-height:26px;font-size:11px;border:1px solid var(--borda,#d1d5db);border-radius:5px;background:#fff;}
.ccf-campos{display:flex;flex-direction:column;gap:3px;margin-top:4px;}
.ccf-campos-cab,.ccf-campo{display:grid;grid-template-columns:minmax(0,1.4fr) minmax(0,1.2fr) 52px 44px;gap:4px;align-items:center;}
.ccf-campos-cab span{font-size:9.5px;text-transform:uppercase;letter-spacing:.04em;color:var(--cinza-400,#9ca3af);}
.ccf-campo input[type=text],.ccf-campo input[type=number]{min-width:0;min-height:24px;font-size:11px;padding:2px 4px;border:1px solid var(--borda,#d1d5db);border-radius:4px;}
.ccf-chk{display:flex;align-items:center;gap:4px;font-size:11px;min-width:0;min-height:24px;cursor:pointer;}
.ccf-chk span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.ccf-chk input{width:13px;height:13px;flex-shrink:0;}
.ccf-classes{display:flex;flex-direction:column;gap:3px;margin-top:4px;}
.ccf-classe{display:flex;align-items:center;gap:6px;font-size:11px;min-height:24px;}
.ccf-classe span:nth-child(2){flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.ccf-n{color:var(--cinza-400,#9ca3af);font-variant-numeric:tabular-nums;}
`
  document.head.appendChild(st)
}
