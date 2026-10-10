// ── SIGUC-AC · Biomonitor — Relatório Científico da Temporada ─────
// Motor da página pages/analise-cientifica-biomonitor.html.
// Fontes:
//   • bio_relatorio_completo (091) — KPIs, séries por espécie/mês/ano;
//   • bio_analise_cientifica (131) — temperatura/TSD, sinais climáticos;
//   • bio_analise_detalhada (132, revista na 359) — ovos, eclosão no
//     padrão da literatura, perdas por causa (fonte vw_ninho_ovos);
//   • bio_analise_praias (133) — praias, dimensões, densidade;
//   • bio_analise_complementar (359) — datas reais dos eventos, funil,
//     praias de proteção, postura, transferência, calendário, completude.
// Camada de REFERÊNCIA: js/biomonitor-fundamentacao.js.
// Estatística de apresentação e gráficos novos: js/biomonitor-analise-ciencia.js.
//
// Regras de leitura (revisão de 10/2026):
//  • Dado observado, referência da literatura e dado estimado aparecem
//    com selo próprio — nunca só no texto.
//  • Sem dado, a seção diz o que falta; nunca um "0" ou "—" mudo.
//  • Taxa de eclosão no padrão da literatura (sucesso de eclosão e de
//    emergência sobre ovos INCUBADOS); a taxa antiga continua, com o
//    nome do que de fato mede.
//  • Fase da temporada pelos eventos de campo, não por terços da janela.
//  • Nenhum gráfico com dois eixos Y.
// Depende de: esc(), formatNum() (config.js); Chart.js (sob demanda);
// biomonitor-fundamentacao.js; biomonitor-analise-ciencia.js;
// grafico-teclado.js (opcional — degrada em silêncio).

const AC_ESP_LABEL = (typeof bioEspNomes === 'function' ? bioEspNomes : m => m)({
  tracaja: 'Tracajá', tartaruga: 'Tartaruga-da-Amazônia', cabecudo: 'Cabeçudo',
  pitiU: 'Iaçá', cupido: 'Cupido', jabuti_pe_elefante: 'Jabuti-pé-de-elefante',
  jabuti_piranga: 'Jabuti-piranga', mucua: 'Muçuã', outro: 'Outra',
})
// Paleta validada para daltonismo (ver js/biomonitor-analise-ciencia.js).
const AC_ESP_COR = (typeof ACC_ESP_COR !== 'undefined') ? ACC_ESP_COR : {
  tracaja: '#2A9D6F', tartaruga: '#1D6FA8', pitiU: '#C2410C', cabecudo: '#7C3AED',
  cupido: '#A16207', jabuti_pe_elefante: '#4B5563', jabuti_piranga: '#9D174D',
  mucua: '#0E7490', outro: '#6B7280',
}
// Usado pelo relatório comparativo (rótulo da fase do calendário).
const AC_FASE_ATUAL_LBL = {
  pre: 'Antes do início', inicio: 'Início da temporada', meio: 'Meio da temporada',
  fim: 'Fim da temporada', encerrada: 'Temporada encerrada',
}
const AC_FASE_BIO_LBL = {
  postura: 'postura', incubacao: 'incubação', eclosao: 'eclosão', soltura: 'soltura',
}

let _acCharts = {}
let _acChartJs = false

function acN(v) { return (v == null || isNaN(v)) ? 0 : Number(v) }
function acFmt(v) { return (typeof formatNum === 'function') ? formatNum(acN(v)) : String(acN(v)) }
function acPct(v) { return (v == null || isNaN(v)) ? '—' : `${Number(v).toFixed(1).replace('.', ',')}%` }
function acNum1(v) { return (v == null || isNaN(v)) ? '—' : Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) }

async function acCarregarChartJS() {
  if (_acChartJs || typeof Chart !== 'undefined') { _acChartJs = true; return }
  await new Promise((res) => {
    const s = document.createElement('script')
    s.src = 'https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js'
    s.onload = () => { _acChartJs = true; res() }
    // Se a CDN falhar, o relatório ainda renderiza (texto/tabelas);
    // acMkChart é no-op quando Chart não está disponível.
    s.onerror = () => res()
    document.head.appendChild(s)
  })
}
function acDestruirCharts() {
  Object.values(_acCharts).forEach(c => { try { c.destroy() } catch (_) {} })
  _acCharts = {}
}

// Chart.js só redimensiona via ResizeObserver, que nem sempre dispara na
// transição para impressão — sem isso o canvas sai cortado no PDF.
let _acPrintBound = false
function acBindPrintResize() {
  if (_acPrintBound) return
  _acPrintBound = true
  const resizeTodos = () => Object.values(_acCharts).forEach(c => { try { c.resize() } catch (_) {} })
  window.addEventListener('beforeprint', resizeTodos)
  window.addEventListener('afterprint', resizeTodos)
  if (window.matchMedia) {
    const mq = window.matchMedia('print')
    const onChange = (e) => { if (e.matches) resizeTodos() }
    if (mq.addEventListener) mq.addEventListener('change', onChange)
    else if (mq.addListener) mq.addListener(onChange)
  }
}
acBindPrintResize()

// ── Selos (observado · referência · estimado) ──────────────────────
const AC_SELO = {
  obs: '<span class="ac-selo ac-selo-obs" title="Dado coletado pelo Biomonitor">Observado</span>',
  ref: '<span class="ac-selo ac-selo-ref" title="Parâmetro da literatura citada ao final">Referência</span>',
  est: '<span class="ac-selo ac-selo-est" title="Valor estimado ou previsto pelo sistema, não medido">Estimado</span>',
}

function acSvg(svg, rotulo) {
  if (!svg) return ''
  return (typeof graficoTecladoEnvolver === 'function')
    ? graficoTecladoEnvolver(svg, { rotulo })
    : svg
}

// ── Numeração automática das seções e índice ─────────────────────────
let _acSecN = 0
let _acIndice = []
function acSecTitle(num, txt, sub) {
  return `<div class="ac-sec-head"><span class="ac-sec-num">${num}</span>
    <div><h2 class="ac-sec-title">${esc(txt)}</h2>${sub ? `<p class="ac-sec-sub">${esc(sub)}</p>` : ''}</div></div>`
}
// Abre uma seção numerada e registra no índice.
function acSec(id, titulo, sub, corpo, extraClasse) {
  _acSecN++
  const num = String(_acSecN).padStart(2, '0')
  if (_acIndice.length) _acIndice[_acIndice.length - 1].itens.push({ id, titulo })
  return `<section class="ac-sec${extraClasse ? ' ' + extraClasse : ''}" id="ac-${id}">
    ${acSecTitle(num, titulo, sub)}${corpo}</section>`
}
function acParte(letra, titulo, secoes) {
  const html = secoes.filter(Boolean).join('')
  if (!html) return ''
  return `<div class="ac-parte" id="ac-parte-${letra.toLowerCase()}">
    <div class="ac-parte-head"><span class="ac-parte-letra">${letra}</span><span class="ac-parte-titulo">${esc(titulo)}</span></div>
    ${html}</div>`
}
// Cada parte chama acAbrirParte antes de montar suas seções, para o
// índice saber em que parte cada seção está.
function acAbrirParte(letra, titulo) {
  _acIndice.push({ letra, titulo, itens: [] })
  return () => {}
}
function acIndiceHTML() {
  return `<nav class="ac-indice no-print" aria-label="Índice do relatório">
    <div class="ac-indice-t">Neste relatório</div>
    ${_acIndice.filter(p => p.itens.length).map(p => `
      <div class="ac-indice-parte"><span class="ac-indice-letra">${p.letra}</span> ${esc(p.titulo)}</div>
      <ul>${p.itens.map(i => `<li><a href="#ac-${i.id}">${esc(i.titulo)}</a></li>`).join('')}</ul>`).join('')}
  </nav>`
}

// ── Ponto de entrada — chamado por "Gerar relatório" ───────────────
window.acAplicar = async function (filtros) {
  const el = document.getElementById('ac-conteudo')
  el.innerHTML = (typeof skeletonBlocoHTML === 'function')
    ? skeletonBlocoHTML(8)
    : '<div class="ac-loading">Compilando o relatório da temporada…</div>'
  acDestruirCharts()

  const params = {
    p_temporada_id: filtros.temporada || null,
    p_programa_id:  filtros.programa  || null,
    p_uc_id:        filtros.uc        || null,
    p_praia_id:     filtros.praia     || null,
  }

  const [rRel, rAna, rDet, rPr, rComp] = await Promise.all([
    db.rpc('bio_relatorio_completo', { ...params, p_tipo_localizacao: filtros.localizacao || null }),
    db.rpc('bio_analise_cientifica', { ...params, p_ref_date: null }),
    db.rpc('bio_analise_detalhada', params),
    db.rpc('bio_analise_praias', params),
    db.rpc('bio_analise_complementar', params),
  ])

  if (rRel.error && rAna.error) {
    el.innerHTML = `<div class="ac-loading">Não foi possível carregar os dados. Verifique a conexão e clique em <strong>Gerar relatório</strong> de novo.</div>`
    return
  }
  const dados = rRel.data || {}
  const ana = rAna.data || {}
  const det = rDet.data || {}
  const pr = rPr.data || {}
  const comp = rComp.data || {}
  const kpis = dados.kpis || {}
  const hoje = new Date().toISOString().slice(0, 10)
  const posturaEstat = (typeof accPosturaEstat === 'function')
    ? accPosturaEstat(comp.postura || [], window.BIO_ESPECIES_REF || {}) : []
  const fase = (typeof accFaseBiologica === 'function') ? accFaseBiologica(comp.eventos, hoje) : { atual: null, etapas: [] }
  const ctx = { dados, ana, det, pr, comp, kpis, hoje, posturaEstat, fase }

  await acCarregarChartJS()

  try {
    const capaEl = document.getElementById('ac-capa')
    if (capaEl && typeof getCabecalhoRelatorio === 'function') {
      const cab = await getCabecalhoRelatorio('biomonitor')
      capaEl.innerHTML = acCapa(ana, cab, fase)
    }
  } catch (_) { /* capa é opcional — não bloqueia o relatório */ }

  _acSecN = 0
  _acIndice = []
  acAbrirParte('A', 'Temporada')
  const pA = acParte('A', 'Temporada', [acSecSumario(ctx), acSecFase(ctx), acSecCompletude(ctx)])
  acAbrirParte('B', 'Reprodução')
  const pB = acParte('B', 'Reprodução', [acSecEspecies(ctx), acSecFunil(ctx), acSecOvos(ctx), acSecEclosao(ctx),
    acSecPerdas(ctx), acSecTempos(ctx), acSecCalendario(ctx)])
  acAbrirParte('C', 'Praias')
  const pC = acParte('C', 'Praias', [acSecPraias(ctx), acSecProtecao(ctx)])
  acAbrirParte('D', 'Ambiente')
  const pD = acParte('D', 'Ambiente', [acSecTemperatura(ctx), acSecClima(ctx)])
  acAbrirParte('E', 'Manejo e método')
  const pE = acParte('E', 'Manejo e método', [acSecCrescimento(ctx), acSecInteranual(ctx), acSecPerspectivas(ctx),
    acSecFundamentacao(ctx), acSecMetodologia(ctx)])

  el.innerHTML = acCabecalho(ana, fase) +
    `<div class="ac-doc">${acIndiceHTML()}<div class="ac-corpo">${pA}${pB}${pC}${pD}${pE}</div></div>`

  if (typeof bIconsAplicar === 'function') bIconsAplicar(el)

  acChartFenologia(dados)
  acChartPraias(ctx)
  acChartOvos(det)
  acChartEclosao(det)
  acChartPerdas(det)
  acChartTempos(det)
  acChartCrescimento(det)
  acChartTemperatura(ana)
  acChartInteranual(dados)
  acChartClima(ana)
}

// ── Cabeçalho do relatório ─────────────────────────────────────────
function acCabecalho(ana, fase) {
  const t = ana.temporada
  const hoje = new Date().toLocaleDateString('pt-BR')
  const nome = t ? esc(t.nome) : 'Todas as temporadas'
  const janela = (t && t.data_inicio) ? `${acData(t.data_inicio)} a ${acData(t.data_fim)}` : '—'
  const momento = fase && fase.atual ? `Fase de ${AC_FASE_BIO_LBL[fase.atual]}` : 'Sem ninhos registrados'
  return `
  <header class="ac-doc-head">
    <div class="ac-doc-brand">SEMA-AC · DIMA · Biomonitor Quelônios</div>
    <h1 class="ac-doc-title">Relatório Científico da Temporada</h1>
    <div class="ac-doc-meta">
      <span><strong>${nome}</strong></span>
      <span>Janela cadastrada: ${janela}</span>
      <span>${momento}</span>
      <span>Emitido em ${hoje}</span>
    </div>
    <div class="ac-selos-legenda">${AC_SELO.obs} coletado pelo Biomonitor ${AC_SELO.ref} literatura citada ao final ${AC_SELO.est} previsto ou estimado pelo sistema</div>
  </header>`
}

// Capa institucional para impressão — dados de config_sistema.
function acCapa(ana, cab, fase) {
  cab = cab || {}
  const t = ana.temporada
  const hoje = new Date().toLocaleDateString('pt-BR')
  const nome = t ? esc(t.nome) : 'Todas as temporadas'
  const janela = (t && t.data_inicio) ? `${acData(t.data_inicio)} a ${acData(t.data_fim)}` : '—'
  const momento = fase && fase.atual ? `Fase de ${AC_FASE_BIO_LBL[fase.atual]}` : '—'
  const ref = `BIO-QUEL/${(t && t.ano_base) || new Date().getFullYear()}`
  const img = (url, alt) => url ? `<img src="${esc(url)}" alt="${esc(alt)}" onerror="this.style.display='none'">` : ''
  const gestao = cab.gestao ? ` · Gestão ${esc(cab.gestao)}` : ''
  const contato = [cab.telefone, cab.email, cab.site].filter(Boolean).map(esc).join(' · ')
  return `
    <div class="ac-capa-logos">${img(cab.logoGoverno, 'Governo do Acre')}${img(cab.logoSecr, 'SEMA-AC')}</div>
    <div class="ac-capa-hier">
      <div class="l1">${esc(cab.governo || 'Governo do Estado do Acre')}${gestao}</div>
      <div class="l2">${esc(cab.secretaria || 'Secretaria de Estado do Meio Ambiente do Acre')} — ${esc(cab.siglaSecr || 'SEMA-AC')}</div>
      <div class="l3">${esc(cab.diretoria || 'Diretoria de Meio Ambiente')} (${esc(cab.siglaDiret || 'DIMA')})</div>
      ${cab.departamento ? `<div class="l3">${esc(cab.departamento)} (${esc(cab.siglaDep || 'DEBIO')})</div>` : ''}
    </div>
    <div class="ac-capa-mid">
      <div class="ac-capa-tipo">Relatório Científico</div>
      <h1 class="ac-capa-titulo">Relatório Científico da Temporada</h1>
      <div class="ac-capa-sub">Biomonitoramento de Quelônios Amazônicos</div>
      <div class="ac-capa-temp">${nome}</div>
      <table class="ac-capa-meta">
        <tr><td>Janela cadastrada da temporada</td><td>${janela}</td></tr>
        <tr><td>Momento do monitoramento</td><td>${momento}</td></tr>
        <tr><td>Emitido em</td><td>${hoje}</td></tr>
        <tr><td>Referência</td><td>${ref}</td></tr>
      </table>
    </div>
    <div class="ac-capa-rodape">
      <div>${esc(cab.secretaria || 'SEMA-AC')}${cab.endereco ? ' — ' + esc(cab.endereco) : ''}</div>
      ${contato ? `<div>${contato}</div>` : ''}
      ${cab.avisoLegal ? `<div class="ac-capa-aviso">${esc(cab.avisoLegal)}</div>` : ''}
    </div>`
}

function acData(d) {
  if (!d) return '—'
  const [y, m, dd] = String(d).slice(0, 10).split('-')
  return `${dd}/${m}/${y}`
}
function acMini(txt) { return `<div class="ac-mini-title">${esc(txt)}</div>` }
function acKpi(valor, rotulo, cor, selo, nota) {
  return `<div class="ac-kpi" style="--c:${cor}">
    <div class="ac-kpi-v">${valor}</div>
    <div class="ac-kpi-l">${rotulo}${selo ? ' ' + selo : ''}</div>
    ${nota ? `<div class="ac-kpi-nota">${nota}</div>` : ''}</div>`
}
function acTabela(cab, linhas, classe) {
  return `<div class="table-wrap ac-tw"><table class="ac-table${classe ? ' ' + classe : ''}"><thead><tr>${cab}</tr></thead><tbody>${linhas}</tbody></table></div>`
}

// ── A1 · Resumo e principais achados ─────────────────────────────────
function acSecSumario(ctx) {
  const { kpis, det, comp, dados, posturaEstat } = ctx
  const total = acN(kpis.total_ninhos)
  const ec = det.eclosao || {}
  const achados = (typeof accAchados === 'function')
    ? accAchados({ kpis, det, comp, nomes: AC_ESP_LABEL, porEspecie: dados.por_especie, posturaEstat }) : []
  const incubados = acN(ec.ovos_incubados)
  const ev = comp.eventos || {}
  const emerg = incubados > 0
    ? acKpi(acPct(ec.taxa_emergencia_pct), `sucesso de emergência (${acFmt(ec.ninhos_abertos)} ninhos abertos)`, '#2A9D6F', AC_SELO.obs)
    : acKpi('—', 'sucesso de emergência', '#9CA3AF', '', ev.previsao_ini ? `aguardando eclosões (previstas a partir de ${acData(ev.previsao_ini)})` : 'aguardando eclosões')
  const kpiCards = [
    acKpi(acFmt(total), 'ninhos monitorados', '#1D6FA8', AC_SELO.obs),
    acKpi(acFmt((comp.funil || {}).viaveis ?? kpis.total_ovos_viaveis), 'ovos viáveis (postura − perdas)', '#1D6FA8', AC_SELO.obs),
    acKpi(acPct((det.ovos || {}).taxa_fertilidade_pct), 'ovos íntegros no registro', '#A8862F', AC_SELO.obs),
    emerg,
  ].join('')
  const corpo = `
    ${total < 15 && total > 0 ? `<div class="ac-flag ac-flag-warn">Amostra ainda pequena (N = ${acFmt(total)} ninhos). As leituras abaixo são preliminares.</div>` : ''}
    ${achados.length ? `<div class="ac-achados"><div class="ac-achados-t">Principais achados</div><ul>${achados.map(a => `<li>${a}</li>`).join('')}</ul></div>`
      : `<div class="ac-flag">Nenhum ninho registrado nos filtros escolhidos.</div>`}
    <div class="ac-kpis ac-kpis-4">${kpiCards}</div>`
  return acSec('resumo', 'Resumo e principais achados', 'Frases geradas por regras a partir dos números abaixo — nenhuma interpretação automática', corpo)
}

// ── A2 · Fases pelos eventos de campo ────────────────────────────────
function acSecFase(ctx) {
  const { fase, ana } = ctx
  if (!fase.etapas.length) {
    return acSec('fases', 'Fases da temporada', '', `<div class="ac-flag">Sem ninhos registrados nos filtros escolhidos — não há eventos para situar a temporada.</div>`)
  }
  const etapas = fase.etapas.map(e => {
    const datas = e.ini ? `${acData(e.ini)}${e.fim && e.fim !== e.ini ? ' a ' + acData(e.fim) : ''}` : 'sem registro ainda'
    const rot = { feito: 'Concluída', atual: 'Agora', previsto: 'Prevista', sem_dado: 'Sem dado' }[e.status]
    return `<li class="ac-etapa ac-etapa-${e.status}">
      <span class="ac-etapa-marca" aria-hidden="true"></span>
      <div class="ac-etapa-t"><b>${esc(e.lbl)}</b><span class="ac-etapa-st">${rot}</span></div>
      <div class="ac-etapa-sub">${esc(e.sub)}</div>
      <div class="ac-etapa-d">${datas}${e.previsto && e.ini ? ' ' + AC_SELO.est : ''}</div>
    </li>`
  }).join('')
  const t = ana.temporada
  const corpo = `
    <ol class="ac-etapas">${etapas}</ol>
    <p class="ac-fine">As datas vêm dos registros: 1º e último encontro de ninho, 1ª e última eclosão, e a previsão de eclosão dos ninhos ainda fechados (incubação de referência da espécie, ajustada pela temperatura quando há leitura). ${t && t.data_inicio ? `A janela cadastrada da temporada (${acData(t.data_inicio)} a ${acData(t.data_fim)}) fica só como referência administrativa.` : ''}</p>`
  return acSec('fases', 'Fases da temporada', 'Pelos eventos registrados em campo', corpo)
}

// ── A3 · Completude dos dados ────────────────────────────────────────
function acSecCompletude(ctx) {
  const itens = (typeof accCompletudeItens === 'function') ? accCompletudeItens((ctx.comp || {}).completude) : []
  if (!itens.length) return ''
  const c = ctx.comp.completude || {}
  const linhas = itens.map(i => {
    const p = i.pct == null ? 0 : i.pct
    const cor = p >= 80 ? '#2A9D6F' : p >= 30 ? '#A8862F' : '#B42318'
    return `<tr>
      <td>${esc(i.lbl)}</td>
      <td class="num">${acFmt(i.x)} de ${acFmt(i.base)}</td>
      <td class="ac-barra-cel"><span class="ac-barra" role="img" aria-label="${acPct(i.pct)}"><span style="width:${Math.min(100, p)}%;background:${cor}"></span></span><span class="ac-barra-v">${acPct(i.pct)}</span></td>
      <td class="ac-uso">${esc(i.uso)}</td>
    </tr>`
  }).join('')
  const notas = []
  if (acN(c.gps_estimado) > 0) notas.push(`<strong>${acFmt(c.gps_estimado)} posições são estimadas</strong>: os ninhos foram lançados depois, sem GPS de campo, e cada um recebeu uma posição sorteada dentro do polígono da praia de encontro. Por isso aparecem no mapa, dentro da praia certa, e contam em "Posição no mapa" — mas não em "GPS de campo": a posição exata do ninho na praia não foi medida, e nenhuma métrica espacial deste relatório a usa.`)
  if (acN(c.sem_localizacao) > 0) notas.push(`${acFmt(c.sem_localizacao)} ninho(s) sem posição nenhuma, em praias ainda sem polígono desenhado.`)
  if (acN(c.praias_sem_poligono) > 0) notas.push(`${acFmt(c.praias_sem_poligono)} praia(s) usadas sem polígono cadastrado.`)
  const corpo = `
    <p class="ac-prosa">Quanto cada análise pode ser lida com segurança depende do que foi registrado. Item baixo aqui significa que a seção correspondente é preliminar ou fica vazia.</p>
    ${acTabela('<th>Registro</th><th class="num">Quantidade</th><th>Cobertura</th><th>Usado em</th>', linhas, 'ac-table-completude')}
    ${notas.length ? `<div class="ac-flag ac-flag-info">${notas.map(n => `<div>${n}</div>`).join('')}</div>` : ''}`
  return acSec('completude', 'Completude dos dados', 'O quanto confiar em cada seção', corpo)
}

// ── B1 · Espécies e postura ───────────────────────────────────────────
function acSecEspecies(ctx) {
  const lista = ctx.dados.por_especie || []
  if (!lista.length) return acSec('especies', 'Espécies e postura', '', `<div class="ac-flag">Nenhuma espécie registrada nos filtros atuais.</div>`)
  const estat = ctx.posturaEstat || []
  const cards = lista.map(e => {
    const ref = (window.BIO_ESPECIES_REF || {})[e.especie] || {}
    const cor = AC_ESP_COR[e.especie] || '#6B7280'
    const pe = estat.find(x => x.especie === e.especie)
    const inc = ref.incubacao_dias ? `${ref.incubacao_dias[0]}–${ref.incubacao_dias[1]} d` : '—'
    const piv = ref.temp_pivotal_c ? `${String(ref.temp_pivotal_c).replace('.', ',')} °C${ref.temp_pivotal_aprox ? ' (aprox.)' : ''}` : '—'
    return `<div class="ac-esp-card" style="--c:${cor}">
      <div class="ac-esp-head">
        <span class="ac-esp-nome"><span class="ac-esp-ponto" aria-hidden="true"></span>${esc(AC_ESP_LABEL[e.especie] || e.especie)}</span>
        <span class="ac-esp-sci">${esc(ref.nome_cientifico || '')}</span>
      </div>
      <div class="ac-esp-obs">
        <div><b>${acFmt(e.total)}</b><span>ninhos</span></div>
        <div><b>${acNum1(e.media_ovos_postura)}</b><span>ovos/ninho</span></div>
        <div><b>${pe ? `${acNum1(pe.q1)}–${acNum1(pe.q3)}` : '—'}</b><span>metade central</span></div>
        <div><b>${pe ? `${pe.min}–${pe.max}` : '—'}</b><span>mín.–máx.</span></div>
      </div>
      <div class="ac-esp-ref">
        <div>${AC_SELO.ref}</div>
        <ul>
          <li>Postura típica: <b>${ref.postura_faixa ? `${ref.postura_media} (${ref.postura_faixa[0]}–${ref.postura_faixa[1]})` : '—'}</b> ovos</li>
          <li>Incubação: <b>${inc}</b> · pivotal (TSD): <b>${piv}</b></li>
          <li>Status: <b>${esc(ref.status_nacional || '—')}</b></li>
        </ul>
        ${pe && pe.acima ? `<p class="ac-esp-nota">${acFmt(pe.acima)} ninho(s) acima da faixa de referência — conferir contagem.</p>` : ''}
        ${pe && pe.abaixo ? `<p class="ac-esp-nota">${acFmt(pe.abaixo)} ninho(s) abaixo da faixa de referência.</p>` : ''}
      </div>
    </div>`
  }).join('')
  const svg = (typeof accPosturaSVG === 'function') ? accPosturaSVG(estat, AC_ESP_LABEL) : ''
  const corpo = `
    <div class="ac-esp-grid">${cards}</div>
    ${svg ? `${acMini('Ovos por ninho — observado × literatura')}
      <div class="ac-fig">${acSvg(svg, 'Ovos por ninho observados comparados à literatura')}
      <p class="ac-fine">Ponto = média observada · traço fino = metade central dos ninhos (1º ao 3º quartil) · faixa cinza = intervalo da literatura · traço dourado = média da literatura.</p></div>` : ''}`
  return acSec('especies', 'Espécies e postura', 'Dado observado × parâmetros de referência da literatura', corpo)
}

// ── B2 · Funil da coorte ─────────────────────────────────────────────
function acSecFunil(ctx) {
  const comp = ctx.comp || {}
  if (typeof accFunilEtapas !== 'function' || !acN((comp.funil || {}).postura)) return ''
  const etapas = accFunilEtapas(comp.funil, comp.eventos)
  const corpo = `
    <p class="ac-prosa">Acompanha os mesmos ovos da postura até o rio: quantos se perderam antes da incubação, quantos eclodiram, quantos emergiram vivos e quantos foram soltos. É a medida-síntese de um programa de manejo — mostra em qual etapa a coorte se perde.</p>
    <div class="ac-fig">${acSvg(accFunilSVG(etapas), 'Funil de sobrevivência da coorte')}</div>
    <p class="ac-fine">Percentuais das etapas de eclosão em diante são calculados sobre os ovos incubados dos ninhos já abertos, não sobre a postura inteira — os ninhos ainda fechados não entram no denominador.</p>`
  return acSec('funil', 'Funil de sobrevivência da coorte', 'Dos ovos postos aos filhotes soltos', corpo)
}

// ── B3 · Ovos ────────────────────────────────────────────────────────
function acSecOvos(ctx) {
  const o = ctx.det.ovos || {}
  const causas = o.descartes_por_causa || []
  const corpo = `
    <p class="ac-prosa">A postura varia com a espécie e o tamanho da fêmea — de ~4 ovos no muçuã a ~90 na tartaruga-da-Amazônia. Aqui se registra quantos ovos estavam íntegros no momento do registro e quantos foram descartados (quebrados, predados ou retirados) antes da incubação.</p>
    <div class="ac-kpis">
      ${acKpi(acFmt(o.total_postura), 'ovos na postura', '#1D6FA8', AC_SELO.obs)}
      ${acKpi(acFmt(o.total_integros), 'ovos íntegros no registro', '#2A9D6F', AC_SELO.obs)}
      ${acKpi(acPct(o.taxa_fertilidade_pct), 'íntegros ÷ postura', '#A8862F')}
      ${acKpi(acNum1(o.media_postura), 'média de ovos por ninho', '#1D6FA8')}
    </div>
    <p class="ac-fine">“Íntegros ÷ postura” não é fertilidade: um ovo íntegro pode não ter embrião. A fertilidade só se conhece na abertura do ninho.</p>
    ${causas.length ? `${acMini('Ovos descartados por causa registrada')}<div class="ac-chart-wrap"><canvas id="ac-cv-ovos" aria-label="Ovos descartados por causa"></canvas></div>`
      : `<div class="ac-flag ac-flag-info">Sem descartes de ovos registrados nos filtros atuais.</div>`}`
  return acSec('ovos', 'Biologia dos ovos', 'Postura e integridade no registro', corpo)
}

// ── B4 · Eclosão e emergência ──────────────────────────────────────────
function acSecEclosao(ctx) {
  const e = ctx.det.eclosao || {}
  const comp = ctx.comp || {}
  const inc = acN(e.ovos_incubados)
  const ev = comp.eventos || {}
  const intro = `<p class="ac-prosa">Na abertura do ninho cada ovo incubado termina como <strong>filhote vivo</strong>, <strong>filhote morto</strong> (eclodiu e não sobreviveu) ou <strong>ovo não eclodido</strong> (embrião que não completou o desenvolvimento, ou ovo sem embrião). Seguindo o padrão de campo da literatura, o relatório separa o <strong>sucesso de eclosão</strong> (vivos + mortos) do <strong>sucesso de emergência</strong> (só vivos), ambos sobre os ovos incubados <span class="ac-cite">[Miller 1999]</span>. Alagamento, temperatura fora da faixa e fungos (<em>Fusarium</em>) são as causas mais citadas de falha <span class="ac-cite">[ref.]</span>.</p>`
  if (!inc) {
    return acSec('eclosao', 'Eclosão e emergência', 'Desfecho dos ovos incubados', `${intro}
      <div class="ac-flag ac-flag-info">Nenhum ninho aberto ainda.${ev.previsao_ini ? ` As eclosões estão previstas de <strong>${acData(ev.previsao_ini)}</strong> a <strong>${acData(ev.previsao_fim)}</strong> (ver calendário).` : ''} As taxas aparecem aqui assim que os primeiros ninhos forem abertos e registrados.</div>`)
  }
  const ic = (x) => (typeof accWilsonTexto === 'function') ? accWilsonTexto(accWilson(x, inc)) : acPct(100 * x / inc)
  const porEsp = (comp.eclosao_especie || []).map(s => {
    const w = (typeof accWilson === 'function') ? accWilson(s.vivos, s.incubados) : null
    return `<tr><td><span class="ac-esp-ponto" style="--c:${AC_ESP_COR[s.especie] || '#6B7280'}"></span>${esc(AC_ESP_LABEL[s.especie] || s.especie)}</td>
      <td class="num">${acFmt(s.ninhos)}</td><td class="num">${acFmt(s.incubados)}</td>
      <td class="num">${acPct(100 * (acN(s.vivos) + acN(s.mortos)) / acN(s.incubados))}</td>
      <td class="num">${w ? `${acPct(w.p)} <span class="ac-ic">(${acNum1(w.lo)}–${acNum1(w.hi)})</span>` : '—'}</td></tr>`
  }).join('')
  const corpo = `${intro}
    <div class="ac-kpis">
      ${acKpi(acPct(e.taxa_sucesso_eclosao_pct), 'sucesso de eclosão', '#2A9D6F', AC_SELO.obs)}
      ${acKpi(acPct(e.taxa_emergencia_pct), 'sucesso de emergência', '#2A9D6F', AC_SELO.obs)}
      ${acKpi(acPct(e.taxa_ovos_nao_eclodidos_pct), 'ovos não eclodidos', '#6B7280')}
      ${acKpi(acPct(e.taxa_mortalidade_filhote_ninho_pct), 'filhotes mortos no ninho (dos eclodidos)', '#B42318')}
    </div>
    <p class="ac-fine">Base: ${acFmt(inc)} ovos incubados em ${acFmt(e.ninhos_abertos)} ninhos abertos. Emergência com IC 95%: ${ic(e.vivos)}. Para comparar com relatórios anteriores: vivos ÷ ovos abertos = ${acPct(e.taxa_eclosao_pct)}.</p>
    ${porEsp ? `${acMini('Por espécie')}${acTabela('<th>Espécie</th><th class="num">Ninhos abertos</th><th class="num">Ovos incubados</th><th class="num">Eclosão</th><th class="num">Emergência (IC 95%)</th>', porEsp)}` : ''}
    <div class="ac-chart-wrap ac-chart-rosca"><canvas id="ac-cv-ecl" aria-label="Desfecho dos ovos incubados"></canvas></div>`
  return acSec('eclosao', 'Eclosão e emergência', 'Desfecho dos ovos incubados', corpo)
}

// ── B5 · Perdas e predação ───────────────────────────────────────────
function acPerdasLista(p) {
  return [['Predação', p.ovos_predacao, '#C2410C'], ['Ação humana', p.ovos_humana, '#9D174D'],
    ['Alagamento', p.ovos_alagamento, '#1D6FA8'], ['Erosão', p.ovos_erosao, '#A16207'],
    ['Causa natural', p.ovos_natural, '#4B5563']]
}
function acSecPerdas(ctx) {
  const p = ctx.det.perdas || {}
  const pf = ctx.det.predacao_fases || {}
  const inc = pf.incubacao || {}, ec = pf.eclosao || {}, so = pf.soltura || {}
  const lista = acPerdasLista(p)
  const totalPerdas = lista.reduce((s, [, v]) => s + acN(v), 0)
  const corpo = `
    <p class="ac-prosa">Perdas por causa, do registro do ninho até a abertura: <strong>predação</strong>, <strong>ação humana</strong>, <strong>hidrológicas</strong> (alagamento e erosão, ligadas ao pulso de inundação) e <strong>naturais</strong> (ovo quebrado ou inviável sem causa externa). Os números somam os descartes do registro e das visitas — a mesma fonte da seção de ovos.</p>
    <div class="ac-kpis">
      ${lista.map(([l, v, c]) => acKpi(acFmt(v), `ovos — ${l.toLowerCase()}`, c, '')).join('')}
      ${acKpi(acFmt(p.ninhos_perdidos), 'ninhos perdidos inteiros', '#6B7280')}
    </div>
    ${totalPerdas > 0 ? `${acMini('Ovos perdidos por causa')}<div class="ac-chart-wrap"><canvas id="ac-cv-perdas" aria-label="Ovos perdidos por causa"></canvas></div>`
      : `<div class="ac-flag ac-flag-info">Nenhuma perda de ovo registrada nos filtros atuais.</div>`}
    ${acMini('Registros de predação por fase do ciclo')}
    ${acTabela('<th>Fase</th><th class="num">Por animais</th><th class="num">Por pessoas</th><th class="num">Outra / sem predação</th>', `
      <tr><td>Incubação (visitas)</td><td class="num">${acFmt(inc.animais)}</td><td class="num">${acFmt(inc.pessoas)}</td><td class="num">${acFmt(inc.desconhecida)} causa desconhecida</td></tr>
      <tr><td>Eclosão</td><td class="num">${acFmt(ec.por_animais)}</td><td class="num">${acFmt(ec.por_pessoas)}</td><td class="num">—</td></tr>
      <tr><td>Soltura</td><td class="num" colspan="2">${acFmt(so.com)} soltura(s) com predação</td><td class="num">${acFmt(so.sem)} sem</td></tr>`)}`
  return acSec('perdas', 'Perdas e predação', 'Onde e como a coorte é perdida', corpo)
}

// ── B6 · Tempos do ciclo ─────────────────────────────────────────────
function acSecTempos(ctx) {
  const inc = ctx.det.incubacao || {}
  const berc = ctx.det.bercario_tempo || {}
  const tr = (ctx.comp || {}).transferencia || {}
  const ref = (window.BIO_CONTEXTO || {}).incubacao_ref_dias || [55, 70]
  const nInc = acN(inc.n), nBerc = acN(berc.n), nTr = acN(tr.n)
  const desvio = inc.desvio_medio_dias
  const pctTr = v => nTr ? acPct(100 * acN(v) / nTr) : '—'
  const transf = nTr ? `${acMini('Do encontro à transferência')}
    <p class="ac-prosa">Ovos de quelônio transferidos depois que o embrião se fixa à casca (primeiras 12 a 24 h) tendem a morrer se forem girados. Por isso o intervalo entre encontrar e transferir o ninho importa — e a hora da transferência precisa ser anotada para medir isso em horas.</p>
    ${acTabela('<th>Intervalo</th><th class="num">Ninhos</th><th class="num">%</th>', `
      <tr><td>No mesmo dia</td><td class="num">${acFmt(tr.mesmo_dia)}</td><td class="num">${pctTr(tr.mesmo_dia)}</td></tr>
      <tr><td>No dia seguinte</td><td class="num">${acFmt(tr.um_dia)}</td><td class="num">${pctTr(tr.um_dia)}</td></tr>
      <tr><td>2 a 3 dias depois</td><td class="num">${acFmt(tr.dois_tres)}</td><td class="num">${pctTr(tr.dois_tres)}</td></tr>
      <tr><td>4 dias ou mais</td><td class="num">${acFmt(tr.quatro_mais)}</td><td class="num">${pctTr(tr.quatro_mais)}</td></tr>
      ${acN(tr.negativo) ? `<tr class="ac-row-alert"><td>Data da transferência anterior ao encontro (erro de registro)</td><td class="num">${acFmt(tr.negativo)}</td><td class="num">${pctTr(tr.negativo)}</td></tr>` : ''}`)}
    <p class="ac-fine">Hora da transferência registrada em ${acFmt(tr.com_hora)} de ${acFmt(nTr)} transferências.</p>` : ''
  const corpo = `
    <p class="ac-prosa">A <strong>duração da incubação</strong> depende da temperatura — a faixa típica é de <strong>${ref[0]}–${ref[1]} dias</strong>; mais calor encurta o desenvolvimento e feminiza a coorte. O <strong>tempo em berçário</strong> prolonga a proteção até um tamanho de soltura mais seguro.</p>
    <div class="ac-kpis">
      ${acKpi(inc.media_dias != null ? `${acNum1(inc.media_dias)} d` : '—', `incubação média observada (N = ${acFmt(nInc)})`, '#1D6FA8', nInc ? AC_SELO.obs : '', nInc ? '' : 'aguardando eclosões')}
      ${acKpi(`${ref[0]}–${ref[1]} d`, 'faixa de referência', '#6B7280', AC_SELO.ref)}
      ${acKpi(desvio != null ? `${desvio > 0 ? '+' : ''}${acNum1(desvio)} d` : '—', 'observado − previsto', desvio != null && Math.abs(desvio) > 5 ? '#B45309' : '#2A9D6F')}
      ${acKpi(berc.media_dias != null ? `${acNum1(berc.media_dias)} d` : '—', `permanência média em berçário (N = ${acFmt(nBerc)})`, '#2A9D6F')}
    </div>
    ${nInc > 0 ? `${acMini('Incubação por ninho — observado × previsto (dias)')}<div class="ac-chart-wrap"><canvas id="ac-cv-incub" aria-label="Incubação observada e prevista por ninho"></canvas></div>` : ''}
    ${nInc > 0 && inc.media_dias != null && (inc.media_dias < ref[0] || inc.media_dias > ref[1]) ? `<div class="ac-flag">A incubação média observada (${acNum1(inc.media_dias)} d) está fora da faixa de referência (${ref[0]}–${ref[1]} d) — verificar datas de encontro/nascimento e condições térmicas.</div>` : ''}
    ${transf}`
  return acSec('tempos', 'Tempos do ciclo', 'Transferência, incubação e berçário', corpo)
}

// ── B7 · Calendário de eclosão previsto ──────────────────────────────
function acSecCalendario(ctx) {
  const cal = (ctx.comp || {}).calendario || []
  if (!cal.length || typeof accCalendarioSVG !== 'function') return ''
  const esp = Array.from(new Set(cal.map(c => c.especie)))
  const ajust = cal.reduce((s, c) => s + acN(c.ajustados), 0)
  const corpo = `
    <p class="ac-prosa">Ninhos ainda fechados, agrupados pela semana em que a eclosão é esperada. Serve para dimensionar equipe nas praias de proteção e no berçário. ${AC_SELO.est}</p>
    <div class="ac-fig">${acSvg(accCalendarioSVG(cal, AC_ESP_LABEL, ctx.hoje), 'Ninhos com eclosão prevista por semana')}
      <div class="ac-legenda">${esp.map(k => `<span><span class="ac-esp-ponto" style="--c:${AC_ESP_COR[k] || '#6B7280'}"></span>${esc(AC_ESP_LABEL[k] || k)}</span>`).join('')}</div></div>
    <p class="ac-fine">Previsão = data de encontro + incubação de referência da espécie${ajust ? `; ${acFmt(ajust)} ninho(s) com a previsão ajustada pela temperatura medida` : '; nenhum ninho tem temperatura suficiente para ajustar a previsão'}. Ninhos encontrados depois da postura tendem a eclodir antes do previsto.</p>`
  return acSec('calendario', 'Calendário de eclosão previsto', 'Por semana, ninhos ainda fechados', corpo)
}

const AC_TIPO_LOC_LBL = {
  dentro_uc: 'Dentro de UC', margem_livre: 'Margem livre',
  terra_indigena: 'Terra Indígena', area_municipal: 'Área municipal', outro: 'Outro',
}

// Separa as praias de DESOVA (origem dos ninhos) das de PROTEÇÃO
// (destino da transferência). Antes as duas entravam na mesma rede, e
// as praias de proteção apareciam com densidade 0, puxando a média.
function acPraiasDesova(pr, comp) {
  const protIds = new Set(((comp || {}).protecao || []).map(p => p.id))
  return ((pr || {}).praias || []).filter(p => !(protIds.has(p.id) && acN(p.ninhos_total) === 0))
}

// ── C1 · Praias de desova ─────────────────────────────────────────────
function acSecPraias(ctx) {
  const pr = ctx.pr
  if (!pr || !pr.praias) return ''
  const lista = acPraiasDesova(pr, ctx.comp)
  const comNinho = lista.filter(p => acN(p.ninhos_total) > 0)
  const al = pr.alertas || {}
  const km = lista.reduce((s, p) => s + acN(p.comprimento_m), 0) / 1000
  const ha = lista.reduce((s, p) => s + acN(p.area_ha), 0)
  const ninhos = lista.reduce((s, p) => s + acN(p.ninhos_total), 0)
  const linhas = comNinho.map(p => {
    const semDim = p.comprimento_m == null || p.area_ha == null
    return `<tr${semDim ? ' class="ac-row-alert"' : ''}>
      <td>${esc(p.nome)}${p.experimental ? ' <span class="ac-tag-exp">exp.</span>' : ''}</td>
      <td>${esc(p.uc_sigla || AC_TIPO_LOC_LBL[p.tipo_localizacao] || '—')}</td>
      <td class="num">${p.comprimento_m != null ? acNum1(p.comprimento_m) + ' m' : '—'}</td>
      <td class="num">${acFmt(p.ninhos_total)}</td>
      <td class="num">${p.densidade_ninhos_km != null ? acNum1(p.densidade_ninhos_km) : '—'}</td>
      <td class="num">${p.densidade_ninhos_ha != null ? acNum1(p.densidade_ninhos_ha) : '—'}</td>
    </tr>`
  }).join('')
  const semNinho = lista.filter(p => acN(p.ninhos_total) === 0 && acN(p.ninhos_recebidos) === 0).map(p => p.nome)
  const alertas = []
  const semDim = (al.praias_sem_dimensoes || []).filter(n => comNinho.some(p => p.nome === n))
  if (semDim.length) alertas.push(`<strong>${semDim.length} praia(s) com ninhos e sem comprimento/área</strong> — sem densidade: ${semDim.map(esc).join(', ')}.`)
  if (semNinho.length) alertas.push(`<strong>${semNinho.length} praia(s) monitorada(s) sem nenhum ninho</strong> no período: ${semNinho.map(esc).join(', ')}.`)
  if ((al.praias_periodo_desalinhado || []).length) alertas.push(`<strong>${al.praias_periodo_desalinhado.length} praia(s) com período de monitoramento fora da temporada</strong>: ${al.praias_periodo_desalinhado.map(esc).join(', ')}.`)
  const corpo = `
    <p class="ac-prosa">Praias onde os ninhos foram <strong>encontrados</strong>. A densidade só é comparável entre praias quando normalizada pelo esforço: ninhos por km de praia e, para bancos de areia curtos e largos, ninhos por hectare do polígono desenhado.</p>
    <div class="ac-kpis">
      ${acKpi(acFmt(comNinho.length), `praias com ninhos (de ${acFmt(lista.length)} monitoradas)`, '#1D6FA8')}
      ${acKpi(`${acNum1(km)} km`, 'comprimento somado', '#2A9D6F')}
      ${acKpi(`${acNum1(ha)} ha`, 'área somada dos polígonos', '#2A9D6F')}
      ${acKpi(km > 0 ? acNum1(ninhos / km) : '—', 'ninhos por km (rede)', '#A8862F')}
    </div>
    ${alertas.length ? `<div class="ac-flag ac-flag-warn">${alertas.map(a => `<div>${a}</div>`).join('')}</div>` : ''}
    ${comNinho.length ? `${acMini('Ninhos por km de praia')}<div class="ac-chart-wrap ac-chart-praias" style="height:${Math.max(180, comNinho.filter(p => p.densidade_ninhos_km != null).length * 22 + 40)}px"><canvas id="ac-cv-praias" aria-label="Ninhos por km em cada praia"></canvas></div>
    ${acTabela('<th>Praia</th><th>Localização</th><th class="num">Compr.</th><th class="num">Ninhos</th><th class="num">Por km</th><th class="num">Por ha</th>', linhas)}` : ''}`
  return acSec('praias', 'Praias de desova', 'Rede amostral e densidade de nidificação', corpo)
}

// ── C2 · Praias de proteção ────────────────────────────────────────────
function acSecProtecao(ctx) {
  const prot = (ctx.comp || {}).protecao || []
  if (!prot.length) return ''
  const linhas = prot.map(p => {
    const w = (typeof accWilson === 'function' && acN(p.incubados) > 0) ? accWilson(p.vivos, p.incubados) : null
    return `<tr>
      <td>${esc(p.nome)}</td>
      <td class="num">${acFmt(p.recebidos)}</td>
      <td class="num">${p.area_m2 != null ? acFmt(p.area_m2) + ' m²' : '—'}</td>
      <td class="num">${p.m2_por_ninho != null ? acNum1(p.m2_por_ninho) : '—'}</td>
      <td class="num">${acFmt(p.abertos)}</td>
      <td class="num">${w ? `${acPct(w.p)} <span class="ac-ic">(${acNum1(w.lo)}–${acNum1(w.hi)})</span>` : '<span class="ac-pend">aguardando</span>'}</td>
    </tr>`
  }).join('')
  const corpo = `
    <p class="ac-prosa">Praias que <strong>receberam</strong> ninhos transferidos. Aqui a métrica que importa é o espaço por ninho: superlotação aquece o substrato e facilita a propagação de fungos entre ninhos vizinhos. Com as eclosões, a coluna de emergência permite comparar as praias de proteção entre si — mesmo rio, mesma temporada.</p>
    ${acTabela('<th>Praia de proteção</th><th class="num">Ninhos recebidos</th><th class="num">Área</th><th class="num">m² por ninho</th><th class="num">Abertos</th><th class="num">Emergência (IC 95%)</th>', linhas)}
    <p class="ac-fine">Área = polígono desenhado no cadastro da praia. IC 95% pelo método de Wilson; intervalos largos indicam poucos ovos na base.</p>`
  return acSec('protecao', 'Praias de proteção', 'Destino das transferências', corpo)
}

// ── D1 · Temperatura e TSD ─────────────────────────────────────────────
function acSecTemperatura(ctx) {
  const tp = ctx.ana.temperatura || {}
  const n = acN(tp.n_amostras)
  const intro = `<p class="ac-prosa">Nos quelônios do gênero <em>Podocnemis</em> o sexo é definido pela temperatura no <strong>terço médio da incubação</strong>: acima da temperatura pivotal da espécie predominam fêmeas; abaixo, machos. O aquecimento tende a <strong>feminizar</strong> as coortes; em <em>P. sextuberculata</em> (iaçá) a faixa de transição é estreita (~1,2 °C).</p>`
  if (!n) {
    return acSec('temperatura', 'Temperatura e razão sexual (TSD)', 'Eixo direto de mudanças climáticas', `${intro}
      <div class="ac-flag ac-flag-warn"><strong>Sem medição de temperatura de substrato.</strong> A leitura de razão sexual depende disso. Recomendação: medir em cada visita, na profundidade da câmara de ovos, e instalar registradores automáticos (data loggers) em uma amostra de ninhos por praia.</div>`)
  }
  const linhas = (tp.por_especie || []).map(te => {
    const est = window.bioEstimativaSexoCoorte(te.especie, acN(te.temp_media))
    const tendLbl = est.tendencia === 'femeas' ? 'tende a fêmeas' : est.tendencia === 'machos' ? 'tende a machos' : est.tendencia === 'equilibrio' ? 'perto do equilíbrio' : 'indefinida'
    return `<tr>
      <td>${esc(AC_ESP_LABEL[te.especie] || te.especie)}</td>
      <td class="num">${te.temp_media != null ? acNum1(te.temp_media) + ' °C' : '—'}</td>
      <td class="num">${est.pivotal != null ? acNum1(est.pivotal) + ' °C' : '—'}${est.aprox ? '*' : ''}</td>
      <td class="num">${te.n}</td>
      <td>${tendLbl}</td>
    </tr>`
  }).join('')
  const corpo = `${intro}
    <p class="ac-prosa">A leitura abaixo é <strong>qualitativa</strong>: compara a média observada com a pivotal da própria espécie, não a temperatura do terço médio.</p>
    <div class="ac-temp-grid">
      <div class="ac-chart-wrap"><canvas id="ac-cv-temp" aria-label="Distribuição da temperatura de substrato"></canvas></div>
      <div class="ac-temp-stats">
        <div class="ac-temp-stat"><b>${acNum1(tp.media)} °C</b><span>média de substrato</span></div>
        <div class="ac-temp-stat"><b>${acNum1(tp.min)}–${acNum1(tp.max)} °C</b><span>faixa observada</span></div>
        <div class="ac-temp-stat"><b>${acFmt(n)}</b><span>medições</span></div>
      </div>
    </div>
    ${linhas ? `${acTabela('<th>Espécie</th><th class="num">Média obs.</th><th class="num">Pivotal da espécie</th><th class="num">N</th><th>Leitura</th>', linhas)}
      <p class="ac-fine">* Pivotal aproximada — sem consenso consolidado para a espécie.</p>` : ''}`
  return acSec('temperatura', 'Temperatura e razão sexual (TSD)', 'Eixo direto de mudanças climáticas', corpo)
}

// ── D2 · Clima e pulso de inundação ─────────────────────────────────────
function acSecClima(ctx) {
  const c = ctx.ana.clima || {}
  const bc = window.BIO_CONTEXTO || {}
  const alag = acN(c.ninhos_alagados)
  const temSerie = (c.serie_mensal || []).some(x => x.temp_media != null)
  const corpo = `
    <div class="ac-kpis">
      ${acKpi(acFmt(alag), 'ninhos com sinal de alagamento', alag ? '#B42318' : '#2A9D6F', AC_SELO.obs)}
      ${acKpi(acFmt(c.ovos_perdidos_alagamento), 'ovos perdidos por alagamento', '#B45309', AC_SELO.obs)}
      ${acKpi(acFmt(c.visitas_alagamento), 'visitas que registraram alagamento', '#1D6FA8')}
    </div>
    <p class="ac-prosa">O sucesso reprodutivo depende da <strong>duração da seca</strong>: os ninhos precisam de cerca de <strong>${bc.exposicao_minima_dias || 55} dias acima d'água</strong>. A antecipação da cheia ou pulsos anômalos de subida alagam ninhos — em <em>P. unifilis</em> o alagamento causa <strong>${bc.flood_mortalidade_unifilis || '10–100%'}</strong> de mortalidade dos ovos conforme a duração; modelos indicam que <strong>+${String(bc.flood_limiar_nivel_m || 1.5).replace('.', ',')} m</strong> no nível do rio já reduzem a exposição abaixo do mínimo em metade da área de nidificação <span class="ac-cite">[ref.]</span>.</p>
    <div class="ac-flag ac-flag-info">Hoje o risco hidrológico é lido pelos sinais de alagamento anotados nas visitas. O cruzamento com a cota do rio entra quando a estação fluviométrica mais próxima estiver integrada ao módulo de Recursos Hídricos.</div>
    ${temSerie ? `${acMini('Temperatura média de substrato por mês')}<div class="ac-chart-wrap"><canvas id="ac-cv-clima" aria-label="Temperatura média de substrato por mês"></canvas></div>` : ''}`
  return acSec('clima', 'Clima e pulso de inundação', 'Risco hidrológico e térmico sobre o recrutamento', corpo)
}

// ── E1 · Crescimento em berçário ──────────────────────────────────────
function acSecCrescimento(ctx) {
  const c = ctx.det.crescimento || {}
  const bc = window.BIO_CONTEXTO || {}
  const nb = acN(c.n_biometrias)
  const idealMin = (bc.tamanho_soltura_ideal_cm || [5, 7])[0]
  const idealMax = (bc.tamanho_soltura_ideal_cm || [5, 7])[1]
  const fund = `<p class="ac-prosa">Filhotes de Podocnemídeos podem <strong>dobrar o tamanho do casco</strong> no primeiro ano, num crescimento do tipo <strong>von Bertalanffy</strong> <span class="ac-cite">[ref.]</span>. O <em>headstarting</em> solta filhotes maiores e menos vulneráveis: na literatura, ~${bc.headstart_casco_mm || 62.7} mm de casco contra ~${bc.soltura_direta_casco_mm || 36.3} mm na soltura direta. Faixa-alvo de soltura adotada: <strong>${idealMin}–${idealMax} cm</strong> de casco.</p>`
  if (nb === 0) {
    return acSec('crescimento', 'Crescimento em berçário', 'Taxa de crescimento e tamanho de soltura', `${fund}
      <div class="ac-flag ac-flag-info">Ainda sem biometria registrada no berçário. A seção é calculada sozinha quando os monitores registrarem biometrias (comprimento e peso) dos lotes no app. Sugestão: uma biometria por lote a cada 15–30 dias.</div>`)
  }
  const taxa = c.taxa_por_lote || []
  const tam = c.tamanho_soltura || []
  const linhasTaxa = taxa.map(t => `<tr>
    <td>${esc(t.bercario_nome || '—')}</td><td>${esc(AC_ESP_LABEL[t.especie] || t.especie || '—')}</td>
    <td class="num">${t.dias} d</td><td class="num">${t.mm_dia != null ? acNum1(t.mm_dia) + ' mm/d' : '—'}</td>
    <td class="num">${t.g_dia != null ? acNum1(t.g_dia) + ' g/d' : '—'}</td></tr>`).join('')
  const linhasTam = tam.map(t => {
    const c2 = acN(t.comp_ultimo)
    const dentro = c2 >= idealMin && c2 <= idealMax
    return `<tr><td>${esc(t.bercario_nome || '—')}</td><td>${esc(AC_ESP_LABEL[t.especie] || t.especie || '—')}</td>
      <td class="num">${t.comp_ultimo != null ? acNum1(t.comp_ultimo) + ' cm' : '—'}</td>
      <td class="num">${t.idade_ultimo != null ? t.idade_ultimo + ' d' : '—'}</td>
      <td>${dentro ? 'na faixa-alvo' : c2 < idealMin ? 'abaixo da faixa-alvo' : 'acima da faixa-alvo'}</td></tr>`
  }).join('')
  const corpo = `${fund}
    ${acMini('Comprimento × idade')}
    <div class="ac-chart-wrap" style="height:240px"><canvas id="ac-cv-cresc" aria-label="Comprimento dos filhotes pela idade"></canvas></div>
    ${linhasTaxa ? `${acMini('Taxa de crescimento por lote')}${acTabela('<th>Berçário</th><th>Espécie</th><th class="num">Intervalo</th><th class="num">Comprimento</th><th class="num">Peso</th>', linhasTaxa)}` : ''}
    ${linhasTam ? `${acMini(`Tamanho na última biometria × faixa-alvo (${idealMin}–${idealMax} cm)`)}${acTabela('<th>Berçário</th><th>Espécie</th><th class="num">Casco</th><th class="num">Idade</th><th>Leitura</th>', linhasTam)}` : ''}`
  return acSec('crescimento', 'Crescimento em berçário', 'Taxa de crescimento e tamanho de soltura', corpo)
}

// ── E2 · Comparação interanual ─────────────────────────────────────────
function acSecInteranual(ctx) {
  const anos = ctx.dados.por_ano || []
  const bc = window.BIO_CONTEXTO || {}
  if (anos.length < 2) {
    return acSec('interanual', 'Comparação interanual', 'Linha de base em construção', `<div class="ac-flag ac-flag-info">Há <strong>${anos.length || 0}</strong> ano(s) de dados no sistema. A série ganha significado a cada nova temporada — para comparar temporadas, marque duas ou mais no filtro e gere o Relatório Comparativo. Referência histórica: o Programa Quelônios da Amazônia (desde ${bc.pqa_criacao || 1979}) já soltou mais de <strong>${acFmt(bc.pqa_filhotes_acumulados)}</strong> filhotes <span class="ac-cite">[ref.]</span>.</div>`)
  }
  const linhas = anos.map(a => `<tr><td>${a.ano}</td><td class="num">${acFmt(a.ninhos)}</td><td class="num">${acFmt(a.filhotes)}</td><td class="num">${acPct(a.taxa_eclosao_pct)}</td></tr>`).join('')
  const corpo = `<p class="ac-prosa">Tendência robusta exige várias temporadas; leia as variações como sinais, não como conclusões.</p>
    ${acMini('Ninhos por ano')}<div class="ac-chart-wrap"><canvas id="ac-cv-inter" aria-label="Ninhos por ano"></canvas></div>
    ${acTabela('<th>Ano</th><th class="num">Ninhos</th><th class="num">Filhotes vivos</th><th class="num">Vivos ÷ ovos abertos</th>', linhas)}`
  return acSec('interanual', 'Comparação interanual', 'Linha de base em construção', corpo)
}

// ── E3 · Recomendações ─────────────────────────────────────────────────
function acSecPerspectivas(ctx) {
  const { kpis, ana, det, comp, fase } = ctx
  const recs = []
  const atual = fase && fase.atual
  const alag = acN((ana.clima || {}).ninhos_alagados)
  const c = (comp || {}).completude || {}
  const tr = (comp || {}).transferencia || {}
  const ev = (comp || {}).eventos || {}
  const tempN = acN((ana.temperatura || {}).n_amostras)
  const nBio = acN(((det || {}).crescimento || {}).n_biometrias)
  const ec = (det || {}).eclosao || {}

  if (atual === 'postura') recs.push(['Fase de postura', 'Priorizar a busca e a marcação de ninhos nas praias de maior densidade e anotar a hora da desova e da transferência.'])
  if (atual === 'incubacao') recs.push(['Fase de incubação', 'Visitar os ninhos com registro de temperatura de substrato e agir antes em ninhos com risco de alagamento ou predação.'])
  if (atual === 'eclosao') recs.push(['Fase de eclosão', `Concentrar equipe nas praias de proteção${ev.previsao_ini ? ` (previsões de ${acData(ev.previsao_ini)} a ${acData(ev.previsao_fim)})` : ''}; abrir cada ninho com contagem completa de vivos, mortos e ovos não eclodidos — é o que alimenta as taxas deste relatório.`])
  if (atual === 'soltura') recs.push(['Fase de soltura', 'Padronizar a soltura ao amanhecer e registrar quantidade e predação observada.'])
  if (alag > 0) recs.push(['Risco hidrológico', `Há ${alag} ninho(s) com sinal de alagamento — avaliar transferência para cotas mais altas e acompanhar o nível do rio.`])
  if (tempN < 10) recs.push(['Temperatura', 'Medir a temperatura de substrato nas visitas — é o insumo da leitura de razão sexual e do ajuste da previsão de eclosão, e hoje está escasso.'])
  if (acN(c.ninhos) && acN(c.ninhos_com_visita) / acN(c.ninhos) < 0.3) recs.push(['Visitas de acompanhamento', `Só ${acFmt(c.ninhos_com_visita)} de ${acFmt(c.ninhos)} ninhos têm visita registrada. Sem visita não se mede perda durante a incubação.`])
  if (acN(tr.n) && acN(tr.com_hora) / acN(tr.n) < 0.5) recs.push(['Hora da transferência', 'Anotar a hora em cada transferência — permite medir em horas a janela crítica de manejo do embrião.'])
  if (acN(tr.negativo)) recs.push(['Datas a revisar', `${acFmt(tr.negativo)} transferência(s) com data anterior ao encontro do ninho. Corrigir na tela de Validação.`])
  if (ec.taxa_emergencia_pct != null && ec.taxa_emergencia_pct < 60) recs.push(['Emergência baixa', `Emergência de ${acPct(ec.taxa_emergencia_pct)} — investigar por praia de proteção (densidade, alagamento, fungos).`])
  if (nBio === 0 && acN(kpis.bercario_total_entrada) > 0) recs.push(['Biometria no berçário', 'Registrar biometria (comprimento e peso) dos lotes a cada 15–30 dias; sem ela não há curva de crescimento.'])
  recs.push(['Consolidação da série', 'Manter a validação científica dos ninhos em dia para que a comparação entre temporadas ganhe robustez.'])

  const corpo = `<div class="ac-recs">${recs.map(([t, d]) => `<div class="ac-rec"><div class="ac-rec-t">${esc(t)}</div><div class="ac-rec-d">${esc(d)}</div></div>`).join('')}</div>`
  return acSec('recomendacoes', 'Recomendações de manejo e de coleta', 'Geradas pelas regras a partir dos dados acima', corpo)
}

// ── E4 · Fundamentação ─────────────────────────────────────────────────
function acSecFundamentacao(ctx) {
  const espUsadas = new Set((ctx.dados.por_especie || []).map(e => e.especie))
  const refIds = new Set()
  espUsadas.forEach(k => (((window.BIO_ESPECIES_REF || {})[k] || {}).refs || []).forEach(r => refIds.add(r)))
  ;['tsd_expansa', 'clima_pulso', 'alagamento', 'pqa', 'javaes',
    'crescimento_vb', 'headstart', 'fusariose', 'falha_reprodutiva', 'sucesso_eclosao'].forEach(r => refIds.add(r))
  const corpo = `<ul class="ac-refs">${window.bioReferenciasHTML(Array.from(refIds))}</ul>`
  return acSec('fontes', 'Fundamentação e fontes', '', corpo)
}

// ── E5 · Metodologia ──────────────────────────────────────────────────
function acSecMetodologia(ctx) {
  const total = acN(ctx.kpis.total_ninhos)
  const c = (ctx.comp || {}).completude || {}
  const corpo = `
    <p class="ac-prosa"><strong>Fonte:</strong> registros de campo do Biomonitor (ninhos, visitas, transferências, eclosões, berçário e solturas). <strong>Fases</strong> pelos eventos: postura = do 1º ao último encontro; eclosão = da 1ª abertura até o último ninho previsto; previsão = encontro + incubação de referência da espécie, ajustada pela temperatura quando há duas leituras ou mais.</p>
    <p class="ac-prosa"><strong>Ovos:</strong> viáveis = postura − perdas registradas (no registro e nas visitas). <strong>Ovos incubados</strong> de um ninho aberto = o maior valor entre os viáveis e a contagem feita na abertura (vivos + mortos + não eclodidos). <strong>Sucesso de eclosão</strong> = (vivos + mortos) ÷ incubados. <strong>Sucesso de emergência</strong> = vivos ÷ incubados. <strong>Ovos não eclodidos</strong> = não nascidos ÷ incubados (inclui ovo sem embrião, que o registro não separa). <strong>Filhotes mortos no ninho</strong> = mortos ÷ (vivos + mortos). Ovo descartado no registro não conta como falha de incubação. A taxa antiga “vivos ÷ ovos abertos” segue disponível para comparação.</p>
    <p class="ac-prosa"><strong>Estatística:</strong> intervalos de confiança de 95% pelo método de Wilson. Postura descrita por média, quartis e extremos. Densidade = ninhos encontrados ÷ comprimento ou área do polígono da praia de desova; praias de proteção ficam fora da densidade e são descritas por m² por ninho.</p>
    <div class="ac-flag ac-flag-info"><strong>Limitações:</strong> N = ${acFmt(total)} ninho(s).${acN(c.gps_estimado) ? ` ${acFmt(c.gps_estimado)} posições são estimadas (sorteadas no polígono da praia de encontro) e não entram em análise espacial.` : ''} A leitura de razão sexual usa a temperatura média observada, não a do terço médio, e é só indicativa. Ninhos encontrados dias depois da desova fazem a incubação observada parecer mais curta. Comparações entre temporadas e com o clima ganham significado com mais anos de série.</div>`
  return acSec('metodo', 'Metodologia e limitações', '', corpo, 'ac-metodo')
}

// ── Gráficos (Chart.js) — um eixo Y por gráfico, sempre ──────────────
function acMkChart(id, cfg) {
  const el = document.getElementById(id)
  if (!el || typeof Chart === 'undefined') return
  cfg.options = cfg.options || {}
  cfg.options.font = { family: "'DM Sans', system-ui, sans-serif" }
  if (typeof Chart !== 'undefined' && Chart.defaults) {
    Chart.defaults.font.family = "'DM Sans', system-ui, sans-serif"
    Chart.defaults.color = '#4B5563'
  }
  _acCharts[id] = new Chart(el.getContext('2d'), cfg)
}
const AC_GRID = 'rgba(0,0,0,.06)'
const AC_BAR = { borderRadius: 4, borderSkipped: 'start', maxBarThickness: 36 }

function acChartFenologia(dados) {
  // A fenologia agora vive no calendário e nas fases; este gráfico só é
  // desenhado se o canvas existir (relatórios antigos/impressos).
  const m = dados.por_mes || []
  if (!m.length) return
  acMkChart('ac-cv-feno', {
    type: 'bar',
    data: { labels: m.map(x => x.mes), datasets: [{ label: 'Ninhos encontrados', data: m.map(x => acN(x.ninhos)), backgroundColor: '#1D6FA8', ...AC_BAR }] },
    options: { responsive: true, maintainAspectRatio: false,
      scales: { y: { beginAtZero: true, grid: { color: AC_GRID }, ticks: { precision: 0 } }, x: { grid: { display: false } } },
      plugins: { legend: { display: false } } },
  })
}

function acChartPraias(ctx) {
  const lista = acPraiasDesova(ctx.pr, ctx.comp).filter(p => p.densidade_ninhos_km != null && acN(p.ninhos_total) > 0)
    .sort((a, b) => acN(b.densidade_ninhos_km) - acN(a.densidade_ninhos_km))
  if (!lista.length) return
  acMkChart('ac-cv-praias', {
    type: 'bar',
    data: { labels: lista.map(p => p.nome), datasets: [{ label: 'Ninhos por km', data: lista.map(p => Number(p.densidade_ninhos_km)), backgroundColor: '#1D6FA8', ...AC_BAR }] },
    options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false,
      scales: { x: { beginAtZero: true, grid: { color: AC_GRID }, title: { display: true, text: 'ninhos por km' } }, y: { grid: { display: false }, ticks: { autoSkip: false, font: { size: 11 } } } },
      plugins: { legend: { display: false } } },
  })
}

function acChartTemperatura(ana) {
  const h = (ana.temperatura || {}).histograma || []
  if (!h.length) return
  // Cor neutra: a pivotal muda por espécie (tracajá 32,0 · tartaruga
  // 32,7 · iaçá 33,7 °C) — pintar faixas fixas de "quente/frio" num
  // histograma de todas as espécies juntas induzia leitura errada.
  acMkChart('ac-cv-temp', {
    type: 'bar',
    data: { labels: h.map(b => b.faixa), datasets: [{ label: 'Medições', data: h.map(b => acN(b.n)), backgroundColor: '#A8862F', ...AC_BAR }] },
    options: { responsive: true, maintainAspectRatio: false,
      scales: { y: { beginAtZero: true, grid: { color: AC_GRID }, ticks: { precision: 0 } }, x: { grid: { display: false } } },
      plugins: { legend: { display: false }, title: { display: true, text: 'Medições de temperatura de substrato por faixa', font: { size: 11 } } } },
  })
}

function acChartInteranual(dados) {
  const a = dados.por_ano || []
  if (a.length < 2) return
  acMkChart('ac-cv-inter', {
    type: 'bar',
    data: { labels: a.map(x => x.ano), datasets: [{ label: 'Ninhos', data: a.map(x => acN(x.ninhos)), backgroundColor: '#1D6FA8', ...AC_BAR }] },
    options: { responsive: true, maintainAspectRatio: false,
      scales: { y: { beginAtZero: true, grid: { color: AC_GRID }, ticks: { precision: 0 } }, x: { grid: { display: false } } },
      plugins: { legend: { display: false } } },
  })
}

function acChartClima(ana) {
  const s = ((ana.clima || {}).serie_mensal || []).filter(x => x.temp_media != null)
  if (!s.length) return
  acMkChart('ac-cv-clima', {
    type: 'line',
    data: { labels: s.map(x => x.mes), datasets: [
      { label: 'Temperatura média de substrato (°C)', data: s.map(x => Number(x.temp_media)), borderColor: '#B45309', backgroundColor: '#B45309', borderWidth: 2, pointRadius: 4, tension: .3 },
    ] },
    options: { responsive: true, maintainAspectRatio: false,
      scales: { y: { grid: { color: AC_GRID }, title: { display: true, text: '°C' } }, x: { grid: { display: false } } },
      plugins: { legend: { display: false } } },
  })
}

const AC_CAUSA_LBL = { natural: 'Natural', predacao: 'Predação', humana: 'Ação humana', alagamento: 'Alagamento', erosao: 'Erosão' }
const AC_CAUSA_COR = { natural: '#4B5563', predacao: '#C2410C', humana: '#9D174D', alagamento: '#1D6FA8', erosao: '#A16207' }
function acChartOvos(det) {
  const c = (((det || {}).ovos) || {}).descartes_por_causa || []
  if (!c.length) return
  acMkChart('ac-cv-ovos', {
    type: 'bar',
    data: { labels: c.map(x => AC_CAUSA_LBL[x.causa] || x.causa), datasets: [{ label: 'Ovos descartados', data: c.map(x => acN(x.qtd)), backgroundColor: c.map(x => AC_CAUSA_COR[x.causa] || '#6B7280'), ...AC_BAR }] },
    options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false,
      scales: { x: { beginAtZero: true, grid: { color: AC_GRID }, ticks: { precision: 0 } }, y: { grid: { display: false } } },
      plugins: { legend: { display: false } } },
  })
}

function acChartEclosao(det) {
  const e = (det || {}).eclosao || {}
  const vals = [acN(e.vivos), acN(e.mortos), acN(e.nao_nascidos)]
  if (vals.reduce((a, b) => a + b, 0) === 0) return
  acMkChart('ac-cv-ecl', {
    type: 'doughnut',
    data: { labels: ['Filhotes vivos', 'Filhotes mortos', 'Ovos não eclodidos'], datasets: [{ data: vals, backgroundColor: ['#2A9D6F', '#B42318', '#9CA3AF'], borderColor: '#fff', borderWidth: 2 }] },
    options: { responsive: true, maintainAspectRatio: false, cutout: '62%', plugins: { legend: { position: 'right' } } },
  })
}

function acChartPerdas(det) {
  const p = (det || {}).perdas || {}
  const lista = acPerdasLista(p).filter(([, v]) => acN(v) > 0)
  if (!lista.length) return
  acMkChart('ac-cv-perdas', {
    type: 'bar',
    data: { labels: lista.map(x => x[0]), datasets: [{ label: 'Ovos perdidos', data: lista.map(x => acN(x[1])), backgroundColor: lista.map(x => x[2]), ...AC_BAR }] },
    options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false,
      scales: { x: { beginAtZero: true, grid: { color: AC_GRID }, ticks: { precision: 0 } }, y: { grid: { display: false } } },
      plugins: { legend: { display: false } } },
  })
}

function acChartTempos(det) {
  const s = ((det || {}).incubacao || {}).serie || []
  if (!s.length) return
  acMkChart('ac-cv-incub', {
    type: 'bar',
    data: { labels: s.map(x => x.numero_ninho || '—'), datasets: [
      { label: 'Observado (dias)', data: s.map(x => acN(x.dias_obs)), backgroundColor: '#1D6FA8', ...AC_BAR },
      { label: 'Previsto (dias)', data: s.map(x => x.dias_prev != null ? acN(x.dias_prev) : null), backgroundColor: '#9CA3AF', ...AC_BAR },
    ] },
    options: { responsive: true, maintainAspectRatio: false,
      scales: { y: { beginAtZero: true, grid: { color: AC_GRID }, title: { display: true, text: 'dias' } }, x: { grid: { display: false } } },
      plugins: { legend: { position: 'bottom' } } },
  })
}

function acChartCrescimento(det) {
  const s = ((det || {}).crescimento || {}).serie || []
  if (!s.length) return
  const grupos = {}
  s.forEach(p => {
    if (p.idade_dias == null || p.comp == null) return
    ;(grupos[p.especie] = grupos[p.especie] || []).push({ x: acN(p.idade_dias), y: acN(p.comp) })
  })
  const ds = Object.keys(grupos).map(k => ({
    label: AC_ESP_LABEL[k] || k,
    data: grupos[k].sort((a, b) => a.x - b.x),
    borderColor: AC_ESP_COR[k] || '#1D6FA8',
    backgroundColor: AC_ESP_COR[k] || '#1D6FA8',
    showLine: true, tension: .3, borderWidth: 2, pointRadius: 4,
  }))
  if (!ds.length) return
  acMkChart('ac-cv-cresc', {
    type: 'scatter',
    data: { datasets: ds },
    options: { responsive: true, maintainAspectRatio: false,
      scales: { x: { title: { display: true, text: 'idade (dias desde a eclosão)' }, grid: { color: AC_GRID } },
        y: { title: { display: true, text: 'comprimento (cm)' }, grid: { color: AC_GRID } } },
      plugins: { legend: { position: 'bottom' } } },
  })
}
