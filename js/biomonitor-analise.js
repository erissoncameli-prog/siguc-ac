// ── SIGUC-AC · Biomonitor — Relatório Científico da Temporada ─────
// Motor da página pages/analise-cientifica-biomonitor.html.
// Junta duas fontes:
//   • bio_relatorio_completo (091) — KPIs, taxas, séries observadas;
//   • bio_analise_cientifica (131) — fase da temporada, temperatura/TSD,
//     sinais climáticos.
// E a camada de REFERÊNCIA (js/biomonitor-fundamentacao.js).
// Toda leitura separa DADO OBSERVADO (do sistema) de REFERÊNCIA
// (literatura), e rotula N amostral baixo em vez de simular tendência.
// Depende de: esc(), formatNum() (config.js); Chart.js (carregado sob
// demanda); BIO_ESPECIES_REF, bioEstimativaSexoCoorte, bioReferenciasHTML,
// BIO_CONTEXTO (biomonitor-fundamentacao.js).

const AC_ESP_LABEL = {
  tracaja: 'Tracajá', tartaruga: 'Tartaruga-da-Amazônia', cabecudo: 'Cabeçudo',
  pitiU: 'Pitiú', cupido: 'Cupido', jabuti_pe_elefante: 'Jabuti-pé-de-elefante',
  jabuti_piranga: 'Jabuti-piranga', mucua: 'Muçuã', outro: 'Outra',
}
const AC_ESP_COR = {
  tracaja: '#2A9D6F', tartaruga: '#1A6B8C', cabecudo: '#C9A84C', pitiU: '#7ECEE8',
  cupido: '#D97706', jabuti_pe_elefante: '#6366f1', jabuti_piranga: '#8b5cf6',
  mucua: '#ec4899', outro: '#9CA3AF',
}
const AC_FASE = {
  inicio: { lbl: 'Início', sub: 'Postura / chegada de fêmeas', cor: '#2A9D6F' },
  meio:   { lbl: 'Meio',   sub: 'Incubação / acompanhamento',  cor: '#C9A84C' },
  fim:    { lbl: 'Fim',    sub: 'Eclosão / soltura',           cor: '#1A6B8C' },
}
const AC_FASE_ATUAL_LBL = {
  pre: 'Antes do início', inicio: 'Início da temporada', meio: 'Meio da temporada',
  fim: 'Fim da temporada', encerrada: 'Temporada encerrada',
}

let _acCharts = {}
let _acChartJs = false

function acN(v) { return (v == null || isNaN(v)) ? 0 : Number(v) }
function acFmt(v) { return (typeof formatNum === 'function') ? formatNum(acN(v)) : String(acN(v)) }
function acPct(v) { return (v == null || isNaN(v)) ? '—' : `${Number(v).toFixed(1)}%` }

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

// ── Ponto de entrada — chamado por "Gerar relatório" ───────────────
window.acAplicar = async function (filtros) {
  const el = document.getElementById('ac-conteudo')
  el.innerHTML = '<div class="ac-loading">Compilando o relatório da temporada…</div>'
  acDestruirCharts()

  const params = {
    p_temporada_id: filtros.temporada || null,
    p_programa_id:  filtros.programa  || null,
    p_uc_id:        filtros.uc        || null,
    p_praia_id:     filtros.praia     || null,
  }

  const [rRel, rAna, rDet, rPr] = await Promise.all([
    db.rpc('bio_relatorio_completo', { ...params, p_tipo_localizacao: filtros.localizacao || null }),
    db.rpc('bio_analise_cientifica', { ...params, p_ref_date: null }),
    db.rpc('bio_analise_detalhada', params),
    db.rpc('bio_analise_praias', params),
  ])

  if (rRel.error && rAna.error) {
    el.innerHTML = `<div class="ac-loading">Não foi possível carregar os dados. Tente novamente.</div>`
    return
  }
  const dados = rRel.data || {}
  const ana = rAna.data || {}
  const det = rDet.data || {}
  const pr = rPr.data || {}
  const kpis = dados.kpis || {}

  await acCarregarChartJS()

  // Capa institucional (só aparece na impressão/PDF)
  try {
    const capaEl = document.getElementById('ac-capa')
    if (capaEl && typeof getCabecalhoRelatorio === 'function') {
      const cab = await getCabecalhoRelatorio()
      // Biomonitor é vinculado ao Departamento de Biodiversidade, não ao DEUC
      // (config_sistema.departamento é global e compartilhado com o relatório
      // CAR — sobrescrever só aqui, depois de resolvido, evita mudar o CAR).
      cab.departamento = 'Departamento de Biodiversidade'
      cab.siglaDep = 'DEBIO'
      capaEl.innerHTML = acCapa(ana, cab)
    }
  } catch (_) { /* capa é opcional — não bloqueia o relatório */ }

  el.innerHTML = [
    acCabecalho(ana, filtros),
    acSecSumario(kpis, ana, dados),
    acSecFase(ana),
    acSecFenologia(dados, ana),
    acSecEspecies(dados),
    acSecPraias(pr),
    acSecOvos(det),
    acSecEclosao(det),
    acSecPerdas(det),
    acSecTempos(det),
    acSecCrescimento(det, dados),
    acSecTemperatura(ana),
    acSecClima(ana, kpis),
    acSecInteranual(dados),
    acSecPerspectivas(kpis, ana, dados, det),
    acSecFundamentacao(dados),
    acSecMetodologia(kpis, ana, det),
  ].join('')

  if (typeof bIconsAplicar === 'function') bIconsAplicar(el)

  // Gráficos — depois do DOM montado
  acChartFenologia(dados, ana)
  acChartFase(ana)
  acChartPraias(pr)
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
function acCabecalho(ana, filtros) {
  const t = ana.temporada
  const hoje = new Date().toLocaleDateString('pt-BR')
  const nome = t ? esc(t.nome) : 'Todas as temporadas'
  const janela = (t && t.data_inicio) ? `${acData(t.data_inicio)} — ${acData(t.data_fim)}` : '—'
  const faseAtual = t && t.fase_atual ? (AC_FASE_ATUAL_LBL[t.fase_atual] || t.fase_atual) : '—'
  const pct = t && t.pct_decorrido != null ? `${t.pct_decorrido}%` : '—'
  return `
  <header class="ac-doc-head">
    <div class="ac-doc-brand">SIGUC-AC · SEMA-AC / DIMA · Biomonitor Quelônios</div>
    <h1 class="ac-doc-title">Relatório Científico da Temporada</h1>
    <div class="ac-doc-meta">
      <span><strong>Temporada:</strong> ${nome}</span>
      <span><strong>Janela:</strong> ${janela}</span>
      <span><strong>Momento:</strong> ${faseAtual} (${pct} decorrido)</span>
      <span><strong>Emitido em:</strong> ${hoje}</span>
    </div>
    <p class="ac-doc-nota">
      Documento de acompanhamento com leitura por fase (início · meio · fim),
      comparação com parâmetros da literatura e programa federal, e eixo de
      mudanças climáticas. <em>Dado observado</em> = coletado pelo Biomonitor;
      <em>referência</em> = literatura citada ao final.
    </p>
  </header>`
}

// Capa institucional para impressão (ABNT-like). Usa dados de
// config_sistema (getCabecalhoRelatorio) — logos, hierarquia, contato.
function acCapa(ana, cab) {
  cab = cab || {}
  const t = ana.temporada
  const hoje = new Date().toLocaleDateString('pt-BR')
  const nome = t ? esc(t.nome) : 'Todas as temporadas'
  const janela = (t && t.data_inicio) ? `${acData(t.data_inicio)} a ${acData(t.data_fim)}` : '—'
  const faseAtual = (t && t.fase_atual) ? (AC_FASE_ATUAL_LBL[t.fase_atual] || t.fase_atual) : '—'
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
        <tr><td>Período da temporada</td><td>${janela}</td></tr>
        <tr><td>Momento do monitoramento</td><td>${faseAtual}</td></tr>
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
function acSecTitle(num, txt, sub) {
  return `<div class="ac-sec-head"><span class="ac-sec-num">${num}</span>
    <div><h2 class="ac-sec-title">${esc(txt)}</h2>${sub ? `<p class="ac-sec-sub">${esc(sub)}</p>` : ''}</div></div>`
}

// ── 1 · Sumário executivo (narrativa a partir dos números) ──────
function acSecSumario(kpis, ana, dados) {
  const total = acN(kpis.total_ninhos)
  const ecl = acN(kpis.eclodidos)
  const filhotes = acN(kpis.total_filhotes_vivos)
  const taxaEcl = kpis.taxa_eclosao_pct
  const t = ana.temporada
  const faseAtual = t && t.fase_atual
  const esp = (dados.por_especie || []).length
  const nBaixo = total < 15

  // Principal risco: alagamento observado ou predação
  const alag = acN((ana.clima || {}).ninhos_alagados)
  const perdidos = acN(kpis.perdidos)
  let risco
  if (alag > 0) risco = `${alag} ninho(s) com sinal de alagamento — risco climático/hidrológico ativo`
  else if (perdidos > 0) risco = `${perdidos} ninho(s) perdidos (predação/destruição)`
  else risco = 'sem perdas registradas até o momento'

  const frases = []
  frases.push(`Até esta emissão, a temporada acumula <strong>${acFmt(total)} ninho(s)</strong> monitorado(s) de <strong>${esp} espécie(s)</strong>, com <strong>${acFmt(ecl)}</strong> já eclodido(s) e <strong>${acFmt(filhotes)} filhote(s) vivo(s)</strong> contabilizado(s).`)
  if (taxaEcl != null) frases.push(`A taxa de eclosão consolidada é de <strong>${acPct(taxaEcl)}</strong>.`)
  if (faseAtual && AC_FASE_ATUAL_LBL[faseAtual]) frases.push(`O monitoramento encontra-se no <strong>${AC_FASE_ATUAL_LBL[faseAtual].toLowerCase()}</strong>.`)
  frases.push(`Principal ponto de atenção: <strong>${risco}</strong>.`)

  const kpiCards = [
    ['Ninhos', acFmt(total), '#1A6B8C'],
    ['Eclodidos', acFmt(ecl), '#2A9D6F'],
    ['Filhotes vivos', acFmt(filhotes), '#2A9D6F'],
    ['Taxa de eclosão', acPct(taxaEcl), '#C9A84C'],
    ['Ovos na postura', acFmt(kpis.total_ovos_postura), '#1A6B8C'],
    ['Incubação média', kpis.incubacao_media_dias != null ? `${kpis.incubacao_media_dias} d` : '—', '#7ECEE8'],
  ].map(([l, v, c]) => `<div class="ac-kpi" style="--c:${c}">
      <div class="ac-kpi-v">${v}</div><div class="ac-kpi-l">${l}</div></div>`).join('')

  return `<section class="ac-sec">
    ${acSecTitle('01', 'Sumário executivo')}
    ${nBaixo ? `<div class="ac-flag ac-flag-warn">Amostra ainda pequena (N = ${acFmt(total)} ninhos). As leituras abaixo são preliminares e ganham robustez à medida que a temporada avança.</div>` : ''}
    <div class="ac-kpis">${kpiCards}</div>
    <p class="ac-prosa">${frases.join(' ')}</p>
  </section>`
}

// ── 2 · Fase da temporada ───────────────────────────────────────
function acSecFase(ana) {
  const t = ana.temporada
  if (!t) return `<section class="ac-sec">${acSecTitle('02', 'Fase da temporada')}
    <div class="ac-flag">Selecione uma temporada para a leitura por fase (início · meio · fim).</div></section>`

  const barras = ['inicio', 'meio', 'fim'].map(fk => {
    const f = (ana.fases || []).find(x => x.fase === fk) || {}
    const atual = t.fase_atual === fk
    const cfg = AC_FASE[fk]
    return `<div class="ac-fase-card${atual ? ' atual' : ''}" style="--c:${cfg.cor}">
      <div class="ac-fase-top"><span class="ac-fase-lbl">${cfg.lbl}</span>${atual ? '<span class="ac-fase-badge">AGORA</span>' : ''}</div>
      <div class="ac-fase-sub">${cfg.sub}</div>
      <div class="ac-fase-grid">
        <div><b>${acFmt(f.ninhos)}</b><span>ninhos</span></div>
        <div><b>${acFmt(f.eclodidos)}</b><span>eclodidos</span></div>
        <div><b>${acFmt(f.filhotes_vivos)}</b><span>filhotes</span></div>
        <div><b>${acPct(f.taxa_eclosao_pct)}</b><span>eclosão</span></div>
      </div></div>`
  }).join('')

  return `<section class="ac-sec">
    ${acSecTitle('02', 'Fase da temporada', 'Recorte por terços da janela da temporada — acompanhamento início · meio · fim')}
    <div class="ac-fase-linha">
      <div class="ac-fase-prog" style="width:${t.pct_decorrido || 0}%"></div>
      <span class="ac-fase-marco" style="left:33%">meio</span>
      <span class="ac-fase-marco" style="left:66%">fim</span>
      <span class="ac-fase-hoje" style="left:${Math.min(100, t.pct_decorrido || 0)}%" title="hoje">▲</span>
    </div>
    <div class="ac-fase-datas">
      <span>${acData(t.data_inicio)}</span>
      <span>${acData(t.fronteira_meio)}</span>
      <span>${acData(t.fronteira_fim)}</span>
      <span>${acData(t.data_fim)}</span>
    </div>
    <div class="ac-fase-cards">${barras}</div>
    <div class="ac-chart-wrap"><canvas id="ac-cv-fase" height="150"></canvas></div>
  </section>`
}

// ── 3 · Fenologia ───────────────────────────────────────────────
function acSecFenologia(dados, ana) {
  const meses = (dados.por_mes || []).length
  return `<section class="ac-sec">
    ${acSecTitle('03', 'Fenologia da temporada', 'Distribuição temporal de posturas e eclosões')}
    <p class="ac-prosa">A nidificação dos quelônios amazônicos é sincronizada com o <strong>pulso de inundação</strong>: as fêmeas desovam durante a vazante, quando as praias emergem, e a eclosão ocorre antes da subida das águas. Qualquer descolamento entre a curva observada e essa janela climática é um sinal de alerta.</p>
    ${meses === 0 ? `<div class="ac-flag">Ainda sem posturas datadas para montar a curva fenológica.</div>`
      : `<div class="ac-chart-wrap"><canvas id="ac-cv-feno" height="150"></canvas></div>`}
  </section>`
}

// ── 4 · Espécies (observado × referência) ───────────────────────
function acSecEspecies(dados) {
  const lista = dados.por_especie || []
  if (!lista.length) return `<section class="ac-sec">${acSecTitle('04', 'Espécies monitoradas')}
    <div class="ac-flag">Nenhuma espécie registrada nos filtros atuais.</div></section>`

  const cards = lista.map(e => {
    const ref = (window.BIO_ESPECIES_REF || {})[e.especie] || {}
    const cor = AC_ESP_COR[e.especie] || '#9CA3AF'
    const inc = ref.incubacao_dias ? `${ref.incubacao_dias[0]}–${ref.incubacao_dias[1]} d` : '—'
    const post = ref.postura_faixa ? `${ref.postura_media} (${ref.postura_faixa[0]}–${ref.postura_faixa[1]})` : '—'
    const piv = ref.temp_pivotal_c ? `${ref.temp_pivotal_c} °C${ref.temp_pivotal_aprox ? ' (aprox.)' : ''}` : '—'
    return `<div class="ac-esp-card" style="--c:${cor}">
      <div class="ac-esp-head">
        <span class="ac-esp-nome">${esc(AC_ESP_LABEL[e.especie] || e.especie)}</span>
        <span class="ac-esp-sci">${esc(ref.nome_cientifico || '')}</span>
      </div>
      <div class="ac-esp-obs">
        <div><b>${acFmt(e.total)}</b><span>ninhos (obs.)</span></div>
        <div><b>${acFmt(e.filhotes_vivos)}</b><span>filhotes (obs.)</span></div>
        <div><b>${acPct(e.taxa_eclosao_pct)}</b><span>eclosão (obs.)</span></div>
        <div><b>${e.incubacao_media_dias != null ? e.incubacao_media_dias + ' d' : '—'}</b><span>incub. (obs.)</span></div>
      </div>
      <div class="ac-esp-ref">
        <div class="ac-ref-tag">Referência</div>
        <ul>
          <li>Incubação esperada: <b>${inc}</b></li>
          <li>Postura típica: <b>${post}</b> ovos</li>
          <li>Temp. pivotal (TSD): <b>${piv}</b></li>
          <li>Status: <b>${esc(ref.status_nacional || '—')}</b></li>
        </ul>
        ${ref.obs ? `<p class="ac-esp-nota">${esc(ref.obs)}</p>` : ''}
      </div>
    </div>`
  }).join('')

  return `<section class="ac-sec">
    ${acSecTitle('04', 'Espécies monitoradas', 'Dado observado × parâmetros de referência da literatura')}
    <div class="ac-esp-grid">${cards}</div>
  </section>`
}

function acMini(txt) {
  return `<div class="ac-mini-title">${esc(txt)}</div>`
}

const AC_TIPO_LOC_LBL = {
  dentro_uc: 'Dentro de UC', margem_livre: 'Margem livre',
  terra_indigena: 'Terra Indígena', area_municipal: 'Área municipal', outro: 'Outro',
}

// ── 5 · Área de monitoramento (praias) ───────────────────────────
function acSecPraias(pr) {
  if (!pr || !pr.resumo) return ''
  const r = pr.resumo
  const lista = pr.praias || []
  const al = pr.alertas || {}
  const alc = al.contagens || {}
  const kmTotal = (acN(r.comprimento_total_m) / 1000).toFixed(2)
  const haTotal = acN(r.area_total_ha).toFixed(2)

  const linhas = lista.map(p => {
    const km = p.comprimento_m != null ? `${(acN(p.comprimento_m) / 1000).toFixed(2)} km` : '—'
    const ha = p.area_ha != null ? `${acN(p.area_ha).toFixed(2)} ha` : '—'
    const semDim = p.comprimento_m == null || p.area_ha == null
    return `<tr${semDim ? ' class="ac-row-alert"' : ''}>
      <td>${esc(p.nome)}${p.experimental ? ' <span class="ac-tag-exp">exp.</span>' : ''}</td>
      <td>${esc(AC_TIPO_LOC_LBL[p.tipo_localizacao] || p.tipo_localizacao || '—')}</td>
      <td>${esc(p.uc_sigla || p.uc_nome || '—')}</td>
      <td class="num">${km}</td>
      <td class="num">${ha}</td>
      <td class="num">${acFmt(p.ninhos_total)}</td>
      <td class="num">${p.densidade_ninhos_km != null ? p.densidade_ninhos_km : '—'}</td>
      <td class="num">${p.densidade_ninhos_ha != null ? p.densidade_ninhos_ha : '—'}</td>
      <td class="num">${acPct(p.taxa_eclosao_pct)}</td>
    </tr>`
  }).join('')

  const porTipo = (pr.por_tipo || []).map(t =>
    `<tr><td>${esc(AC_TIPO_LOC_LBL[t.tipo] || t.tipo)}</td><td class="num">${acFmt(t.n)}</td><td class="num">${acFmt(t.ninhos)}</td></tr>`
  ).join('')

  const alertas = []
  if ((al.praias_sem_dimensoes || []).length)
    alertas.push(`<strong>${al.praias_sem_dimensoes.length} praia(s) sem comprimento/área cadastrado</strong> — impede o cálculo de densidade: ${al.praias_sem_dimensoes.map(esc).join(', ')}.`)
  if ((al.praias_periodo_desalinhado || []).length)
    alertas.push(`<strong>${al.praias_periodo_desalinhado.length} praia(s) com período de monitoramento desalinhado</strong> da temporada corrente — revisar cadastro: ${al.praias_periodo_desalinhado.map(esc).join(', ')}.`)
  if (acN(alc.sem_periodo) > 0)
    alertas.push(`<strong>${alc.sem_periodo} praia(s) sem período de monitoramento cadastrado.</strong>`)
  if ((al.praias_sem_ninho || []).length)
    alertas.push(`<strong>${al.praias_sem_ninho.length} praia(s) cadastrada(s) sem nenhum ninho registrado</strong> no período — esforço de busca zero ou ausência real: ${al.praias_sem_ninho.map(esc).join(', ')}.`)

  return `<section class="ac-sec">
    ${acSecTitle('05', 'Área de monitoramento — praias', 'Caracterização física da rede amostral e esforço de cobertura')}
    <p class="ac-prosa">A densidade de nidificação só é comparável entre praias quando normalizada pelo <strong>esforço de amostragem</strong> — tradicionalmente ninhos por km de praia monitorada, mas praias muito estreitas ou muito largas distorcem essa métrica; a <strong>densidade por área (ninhos/ha)</strong> complementa a leitura, sobretudo em praias curtas e largas como bancos de areia amazônicos <span class="ac-cite">[ref.]</span>.</p>
    <div class="ac-kpis">
      <div class="ac-kpi" style="--c:#1A6B8C"><div class="ac-kpi-v">${acFmt(r.total_praias)}</div><div class="ac-kpi-l">Praias monitoradas</div></div>
      <div class="ac-kpi" style="--c:#2A9D6F"><div class="ac-kpi-v">${kmTotal} km</div><div class="ac-kpi-l">Comprimento total</div></div>
      <div class="ac-kpi" style="--c:#2A9D6F"><div class="ac-kpi-v">${haTotal} ha</div><div class="ac-kpi-l">Área total</div></div>
      <div class="ac-kpi" style="--c:#C9A84C"><div class="ac-kpi-v">${acFmt(r.praias_com_ninhos)}/${acFmt(r.total_praias)}</div><div class="ac-kpi-l">Praias com registro</div></div>
      <div class="ac-kpi" style="--c:#D97706"><div class="ac-kpi-v">${acFmt(r.praias_experimentais)}</div><div class="ac-kpi-l">Praias experimentais</div></div>
    </div>
    ${alertas.length ? `<div class="ac-flag ac-flag-warn">${alertas.map(a => `<div>${a}</div>`).join('')}</div>` : ''}
    ${lista.length ? `<div class="ac-chart-wrap"><canvas id="ac-cv-praias" height="160"></canvas></div>
    <table class="ac-table"><thead><tr>
      <th>Praia</th><th>Localização</th><th>UC</th><th class="num">Compr.</th><th class="num">Área</th>
      <th class="num">Ninhos</th><th class="num">Dens./km</th><th class="num">Dens./ha</th><th class="num">Eclosão</th>
      </tr></thead><tbody>${linhas}</tbody></table>` : ''}
    ${porTipo ? `${acMini('Rede por tipo de localização')}
      <table class="ac-table"><thead><tr><th>Localização</th><th class="num">Praias</th><th class="num">Ninhos</th></tr></thead>
      <tbody>${porTipo}</tbody></table>` : ''}
  </section>`
}

// ── 6 · Biologia dos ovos ───────────────────────────────────────
function acSecOvos(det) {
  const o = (det && det.ovos) || {}
  const causas = o.descartes_por_causa || []
  return `<section class="ac-sec">
    ${acSecTitle('06', 'Biologia dos ovos', 'Postura, fertilidade e destino dos ovos')}
    <p class="ac-prosa">A postura dos quelônios amazônicos varia com a espécie e o tamanho da fêmea — de ~4 ovos no muçuã a ~90 na tartaruga-da-Amazônia. A <strong>fertilidade</strong> (ovos íntegros ÷ postura) mede o potencial reprodutivo da coorte, e o <strong>descarte</strong> de ovos (natural, por predação ou por ação humana) reduz a base viável antes mesmo da incubação.</p>
    <div class="ac-kpis">
      <div class="ac-kpi" style="--c:#1A6B8C"><div class="ac-kpi-v">${acFmt(o.total_postura)}</div><div class="ac-kpi-l">Ovos na postura</div></div>
      <div class="ac-kpi" style="--c:#2A9D6F"><div class="ac-kpi-v">${acFmt(o.total_integros)}</div><div class="ac-kpi-l">Ovos íntegros</div></div>
      <div class="ac-kpi" style="--c:#C9A84C"><div class="ac-kpi-v">${acPct(o.taxa_fertilidade_pct)}</div><div class="ac-kpi-l">Fertilidade</div></div>
      <div class="ac-kpi" style="--c:#D97706"><div class="ac-kpi-v">${o.media_postura != null ? o.media_postura : '—'}</div><div class="ac-kpi-l">Média de ovos/ninho</div></div>
    </div>
    ${causas.length ? `${acMini('Descartes de ovos por causa')}
      <div class="ac-chart-wrap"><canvas id="ac-cv-ovos" height="150"></canvas></div>`
      : `<div class="ac-flag ac-flag-info">Sem descartes de ovos registrados por causa nos filtros atuais.</div>`}
  </section>`
}

// ── 7 · Eclosão & mortalidade embrionária ───────────────────────
function acSecEclosao(det) {
  const e = (det && det.eclosao) || {}
  const total = acN(e.vivos) + acN(e.mortos) + acN(e.nao_nascidos)
  return `<section class="ac-sec">
    ${acSecTitle('07', 'Eclosão & mortalidade embrionária', 'Desfecho dos ovos incubados')}
    <p class="ac-prosa">Na abertura do ninho, os ovos se resolvem em <strong>filhotes vivos</strong>, <strong>filhotes mortos</strong> ou <strong>ovos não nascidos</strong> (embriões que não completaram o desenvolvimento). A mortalidade embrionária tem causas ambientais e sanitárias: temperatura fora da faixa ótima, <strong>alagamento</strong> dos ninhos e infecções fúngicas — a <strong>fusariose</strong> (<em>Fusarium keratoplasticum</em>) já foi documentada em cascas de <em>P. unifilis</em>, e o alagamento e o reuso de substrato/moldura em berçários favorecem o fungo <span class="ac-cite">[ref.]</span>.</p>
    <div class="ac-kpis">
      <div class="ac-kpi" style="--c:#2A9D6F"><div class="ac-kpi-v">${acFmt(e.vivos)}</div><div class="ac-kpi-l">Filhotes vivos</div></div>
      <div class="ac-kpi" style="--c:#DC2626"><div class="ac-kpi-v">${acFmt(e.mortos)}</div><div class="ac-kpi-l">Filhotes mortos</div></div>
      <div class="ac-kpi" style="--c:#9CA3AF"><div class="ac-kpi-v">${acFmt(e.nao_nascidos)}</div><div class="ac-kpi-l">Ovos não nascidos</div></div>
      <div class="ac-kpi" style="--c:#2A9D6F"><div class="ac-kpi-v">${acPct(e.taxa_eclosao_pct)}</div><div class="ac-kpi-l">Taxa de eclosão</div></div>
      <div class="ac-kpi" style="--c:#D97706"><div class="ac-kpi-v">${acPct(e.taxa_mortalidade_embrionaria_pct)}</div><div class="ac-kpi-l">Mortalidade embrionária</div></div>
    </div>
    ${total > 0 ? `<div class="ac-chart-wrap" style="height:240px"><canvas id="ac-cv-ecl"></canvas></div>`
      : `<div class="ac-flag">Sem eclosões registradas nos filtros atuais.</div>`}
  </section>`
}

// ── 8 · Perdas & predação ───────────────────────────────────────
function acSecPerdas(det) {
  const p = (det && det.perdas) || {}
  const pf = (det && det.predacao_fases) || {}
  const inc = pf.incubacao || {}, ec = pf.eclosao || {}, so = pf.soltura || {}
  const totalPerdas = acN(p.ovos_alagamento) + acN(p.ovos_erosao) + acN(p.ovos_humana) + acN(p.ovos_predacao)
  return `<section class="ac-sec">
    ${acSecTitle('08', 'Perdas & predação', 'Onde e como a coorte é perdida ao longo do ciclo')}
    <p class="ac-prosa">As perdas concentram-se em três frentes: <strong>hidrológicas</strong> (alagamento e erosão, ligadas ao pulso de inundação), <strong>humanas</strong> (coleta) e <strong>predação</strong> por animais. A predação atua em todas as fases — incubação, eclosão e soltura — e é a principal justificativa do manejo (transferência de ninhos e berçário) para elevar o recrutamento.</p>
    <div class="ac-kpis">
      <div class="ac-kpi" style="--c:#1A6B8C"><div class="ac-kpi-v">${acFmt(p.ovos_alagamento)}</div><div class="ac-kpi-l">Ovos perdidos — alagamento</div></div>
      <div class="ac-kpi" style="--c:#C9A84C"><div class="ac-kpi-v">${acFmt(p.ovos_erosao)}</div><div class="ac-kpi-l">Ovos perdidos — erosão</div></div>
      <div class="ac-kpi" style="--c:#DC2626"><div class="ac-kpi-v">${acFmt(p.ovos_humana)}</div><div class="ac-kpi-l">Ovos perdidos — humana</div></div>
      <div class="ac-kpi" style="--c:#D97706"><div class="ac-kpi-v">${acFmt(p.ovos_predacao)}</div><div class="ac-kpi-l">Ovos predados</div></div>
      <div class="ac-kpi" style="--c:#9CA3AF"><div class="ac-kpi-v">${acFmt(p.ninhos_perdidos)}</div><div class="ac-kpi-l">Ninhos perdidos</div></div>
    </div>
    ${totalPerdas > 0 ? `${acMini('Ovos perdidos por causa')}<div class="ac-chart-wrap"><canvas id="ac-cv-perdas" height="140"></canvas></div>` : ''}
    ${acMini('Predação por fase do ciclo (nº de registros)')}
    <table class="ac-table"><thead><tr><th>Fase</th><th class="num">Por animais</th><th class="num">Por pessoas</th><th class="num">Outro/descon.</th></tr></thead>
      <tbody>
        <tr><td>Incubação (visitas)</td><td class="num">${acFmt(inc.animais)}</td><td class="num">${acFmt(inc.pessoas)}</td><td class="num">${acFmt(inc.desconhecida)}</td></tr>
        <tr><td>Eclosão</td><td class="num">${acFmt(ec.por_animais)}</td><td class="num">${acFmt(ec.por_pessoas)}</td><td class="num">—</td></tr>
        <tr><td>Soltura</td><td class="num">${acFmt(so.com)} com predação</td><td class="num">—</td><td class="num">${acFmt(so.sem)} sem</td></tr>
      </tbody></table>
  </section>`
}

// ── 9 · Tempos do ciclo (incubação e berçário) ──────────────────
function acSecTempos(det) {
  const inc = (det && det.incubacao) || {}
  const berc = (det && det.bercario_tempo) || {}
  const ref = (window.BIO_CONTEXTO || {}).incubacao_ref_dias || [55, 70]
  const nInc = acN(inc.n), nBerc = acN(berc.n)
  const desvio = inc.desvio_medio_dias
  return `<section class="ac-sec">
    ${acSecTitle('09', 'Tempos do ciclo', 'Incubação (observado × previsto) e permanência em berçário')}
    <p class="ac-prosa">A <strong>duração da incubação</strong> nos quelônios de rio depende diretamente da temperatura — a faixa típica é de <strong>${ref[0]}–${ref[1]} dias</strong>; temperaturas mais altas encurtam o desenvolvimento (e feminizam a coorte, ver seção de TSD). O <strong>tempo em berçário</strong> (headstarting) prolonga a proteção até um tamanho de soltura mais seguro, com o custo de manejo e de risco sanitário em cativeiro.</p>
    <div class="ac-kpis">
      <div class="ac-kpi" style="--c:#1A6B8C"><div class="ac-kpi-v">${inc.media_dias != null ? inc.media_dias + ' d' : '—'}</div><div class="ac-kpi-l">Incubação média observada (N=${acFmt(nInc)})</div></div>
      <div class="ac-kpi" style="--c:#7ECEE8"><div class="ac-kpi-v">${ref[0]}–${ref[1]} d</div><div class="ac-kpi-l">Faixa de referência (lit.)</div></div>
      <div class="ac-kpi" style="--c:${desvio != null && Math.abs(desvio) > 5 ? '#D97706' : '#2A9D6F'}"><div class="ac-kpi-v">${desvio != null ? (desvio > 0 ? '+' : '') + desvio + ' d' : '—'}</div><div class="ac-kpi-l">Desvio observado × previsto</div></div>
      <div class="ac-kpi" style="--c:#2A9D6F"><div class="ac-kpi-v">${berc.media_dias != null ? berc.media_dias + ' d' : '—'}</div><div class="ac-kpi-l">Permanência média em berçário (N=${acFmt(nBerc)})</div></div>
    </div>
    ${nInc > 0 ? `${acMini('Incubação por ninho — observado × previsto (dias)')}<div class="ac-chart-wrap"><canvas id="ac-cv-incub" height="150"></canvas></div>`
      : `<div class="ac-flag ac-flag-info">Ainda sem ninhos com eclosão datada para a curva de incubação.</div>`}
    ${nInc > 0 && inc.media_dias != null && (inc.media_dias < ref[0] || inc.media_dias > ref[1]) ? `<div class="ac-flag">A incubação média observada (${inc.media_dias} d) está fora da faixa de referência (${ref[0]}–${ref[1]} d) — verificar datas de encontro/nascimento e condições térmicas dos ninhos.</div>` : ''}
  </section>`
}

// ── 10 · Crescimento em berçário ────────────────────────────────
function acSecCrescimento(det) {
  const c = (det && det.crescimento) || {}
  const ctx = window.BIO_CONTEXTO || {}
  const nb = acN(c.n_biometrias)
  const idealMin = (ctx.tamanho_soltura_ideal_cm || [5, 7])[0]
  const idealMax = (ctx.tamanho_soltura_ideal_cm || [5, 7])[1]
  const fundamentacao = `<p class="ac-prosa">O crescimento de filhotes de Podocnemídeos é rápido no primeiro ano — podem <strong>dobrar o tamanho de casco</strong> nesse período — e segue um modelo de <strong>von Bertalanffy</strong> (crescimento acelerado no início, desacelerando com a idade) <span class="ac-cite">[ref.]</span>. O <strong>headstarting</strong> visa soltar filhotes maiores e menos vulneráveis: na literatura, filhotes criados em berçário atingiram ~${ctx.headstart_casco_mm || 62.7} mm de casco contra ~${ctx.soltura_direta_casco_mm || 36.3} mm da soltura direta. A <strong>faixa-alvo de tamanho de soltura</strong> adotada como referência é <strong>${idealMin}–${idealMax} cm</strong> de casco.</p>`

  if (nb === 0) {
    return `<section class="ac-sec">
      ${acSecTitle('10', 'Crescimento em berçário', 'Taxa de crescimento, idade × tamanho e tamanho de soltura')}
      ${fundamentacao}
      <div class="ac-flag ac-flag-warn"><strong>Aguardando dados de biometria.</strong> Não há medições de comprimento/peso registradas no berçário. Esta seção — curva de crescimento no tempo e por idade, taxa de crescimento por lote e tamanho na soltura vs. faixa ideal — passa a ser calculada automaticamente assim que os monitores registrarem <em>ocorrências do tipo biometria</em> no app de campo. Recomendação: padronizar uma biometria por lote a cada 15–30 dias.</div>
      ${acMini('Régua de referência (literatura)')}
      <table class="ac-table"><tbody>
        <tr><td>Crescimento esperado no 1º ano</td><td>dobra o tamanho de casco</td></tr>
        <tr><td>Ganho anual de referência</td><td>~${ctx.crescimento_ref_mm_ano || 56.8} mm de casco/ano</td></tr>
        <tr><td>Casco na soltura — headstarting</td><td>~${ctx.headstart_casco_mm || 62.7} mm</td></tr>
        <tr><td>Casco na soltura — soltura direta</td><td>~${ctx.soltura_direta_casco_mm || 36.3} mm</td></tr>
        <tr><td>Faixa-alvo de soltura (referência)</td><td>${idealMin}–${idealMax} cm de casco</td></tr>
      </tbody></table>
    </section>`
  }

  const taxa = c.taxa_por_lote || []
  const tam = c.tamanho_soltura || []
  const linhasTaxa = taxa.map(t => `<tr>
    <td>${esc(t.bercario_nome || '—')}</td><td>${esc(AC_ESP_LABEL[t.especie] || t.especie || '—')}</td>
    <td class="num">${t.dias}</td><td class="num">${t.mm_dia != null ? t.mm_dia + ' mm/d' : '—'}</td>
    <td class="num">${t.g_dia != null ? t.g_dia + ' g/d' : '—'}</td></tr>`).join('')
  const linhasTam = tam.map(t => {
    const c2 = acN(t.comp_ultimo)
    const dentro = c2 >= idealMin && c2 <= idealMax
    return `<tr><td>${esc(t.bercario_nome || '—')}</td><td>${esc(AC_ESP_LABEL[t.especie] || t.especie || '—')}</td>
      <td class="num">${t.comp_ultimo != null ? t.comp_ultimo + ' cm' : '—'}</td>
      <td class="num">${t.idade_ultimo != null ? t.idade_ultimo + ' d' : '—'}</td>
      <td><span class="ac-tend" style="--c:${dentro ? '#2A9D6F' : '#D97706'}">${dentro ? 'na faixa ideal' : 'abaixo da faixa'}</span></td></tr>`
  }).join('')

  return `<section class="ac-sec">
    ${acSecTitle('10', 'Crescimento em berçário', 'Taxa de crescimento, idade × tamanho e tamanho de soltura')}
    ${fundamentacao}
    ${acMini('Crescimento por idade (comprimento × dias desde a eclosão)')}
    <div class="ac-chart-wrap" style="height:220px"><canvas id="ac-cv-cresc"></canvas></div>
    ${linhasTaxa ? `${acMini('Taxa de crescimento por lote')}
      <table class="ac-table"><thead><tr><th>Berçário</th><th>Espécie</th><th class="num">Intervalo</th><th class="num">Comprimento</th><th class="num">Peso</th></tr></thead>
      <tbody>${linhasTaxa}</tbody></table>` : ''}
    ${linhasTam ? `${acMini('Tamanho na soltura vs. faixa ideal (' + idealMin + '–' + idealMax + ' cm)')}
      <table class="ac-table"><thead><tr><th>Berçário</th><th>Espécie</th><th class="num">Casco (últ. biometria)</th><th class="num">Idade</th><th>Leitura</th></tr></thead>
      <tbody>${linhasTam}</tbody></table>` : ''}
  </section>`
}

// ── 11 · Temperatura & determinação sexual (TSD) ────────────────
function acSecTemperatura(ana) {
  const tp = ana.temperatura || {}
  const n = acN(tp.n_amostras)
  if (!n) return `<section class="ac-sec">${acSecTitle('11', 'Temperatura & razão sexual (TSD)')}
    <p class="ac-prosa">A determinação sexual dos quelônios do gênero <em>Podocnemis</em> depende da temperatura de incubação (TSD): temperaturas mais altas produzem fêmeas; mais baixas, machos. O período termossensível ocorre no terço final da incubação.</p>
    <div class="ac-flag">Sem medições de temperatura de substrato suficientes para a leitura de razão sexual. Reforçar o registro de temperatura nas visitas.</div></section>`

  // Leitura qualitativa por espécie
  const linhas = (tp.por_especie || []).map(te => {
    const est = window.bioEstimativaSexoCoorte(te.especie, acN(te.temp_media))
    const tendCor = est.tendencia === 'femeas' ? '#D97706' : est.tendencia === 'machos' ? '#1A6B8C' : '#2A9D6F'
    const tendLbl = est.tendencia === 'femeas' ? 'tende a fêmeas' : est.tendencia === 'machos' ? 'tende a machos' : est.tendencia === 'equilibrio' ? 'equilíbrio' : 'indefinida'
    return `<tr>
      <td>${esc(AC_ESP_LABEL[te.especie] || te.especie)}</td>
      <td class="num">${te.temp_media != null ? te.temp_media + ' °C' : '—'}</td>
      <td class="num">${est.pivotal} °C${est.aprox ? '*' : ''}</td>
      <td class="num">${te.n}</td>
      <td><span class="ac-tend" style="--c:${tendCor}">${tendLbl}</span></td>
    </tr>`
  }).join('')

  return `<section class="ac-sec">
    ${acSecTitle('11', 'Temperatura & razão sexual (TSD)', 'Eixo direto de mudanças climáticas sobre a estrutura populacional')}
    <p class="ac-prosa">A razão sexual da coorte é definida pela temperatura no <strong>terço final da incubação</strong> (TSD Ia): acima da temperatura pivotal predominam fêmeas; abaixo, machos. O aquecimento tende a <strong>feminizar</strong> as coortes, e em <em>P. sextuberculata</em> a faixa de transição estreita (~1,2 °C) deixa pouca margem. A leitura abaixo é <strong>qualitativa</strong> — usa a temperatura média observada, não a do período termossensível.</p>
    <div class="ac-temp-grid">
      <div class="ac-chart-wrap"><canvas id="ac-cv-temp" height="160"></canvas></div>
      <div class="ac-temp-stats">
        <div class="ac-temp-stat"><b>${tp.media != null ? tp.media + ' °C' : '—'}</b><span>média de substrato</span></div>
        <div class="ac-temp-stat"><b>${tp.min ?? '—'}–${tp.max ?? '—'} °C</b><span>faixa observada</span></div>
        <div class="ac-temp-stat"><b>${acFmt(n)}</b><span>medições</span></div>
      </div>
    </div>
    ${linhas ? `<table class="ac-table"><thead><tr>
      <th>Espécie</th><th class="num">Temp. média obs.</th><th class="num">Pivotal ref.</th><th class="num">N</th><th>Leitura</th>
      </tr></thead><tbody>${linhas}</tbody></table>
      <p class="ac-fine">* Pivotal aproximada — sem consenso consolidado por espécie; ler com cautela.</p>` : ''}
  </section>`
}

// ── 12 · Mudanças climáticas & pulso de inundação ───────────────
function acSecClima(ana, kpis) {
  const c = ana.clima || {}
  const ctx = window.BIO_CONTEXTO || {}
  const alag = acN(c.ninhos_alagados)
  const ovosAlag = acN(c.ovos_perdidos_alagamento)
  return `<section class="ac-sec">
    ${acSecTitle('12', 'Mudanças climáticas & pulso de inundação', 'Risco hidrológico e térmico sobre o recrutamento')}
    <div class="ac-clima-obs">
      <div class="ac-kpi" style="--c:${alag ? '#DC2626' : '#2A9D6F'}"><div class="ac-kpi-v">${acFmt(alag)}</div><div class="ac-kpi-l">Ninhos com sinal de alagamento (obs.)</div></div>
      <div class="ac-kpi" style="--c:#D97706"><div class="ac-kpi-v">${acFmt(ovosAlag)}</div><div class="ac-kpi-l">Ovos perdidos por alagamento (obs.)</div></div>
      <div class="ac-kpi" style="--c:#1A6B8C"><div class="ac-kpi-v">${kpis.temp_media_c != null ? kpis.temp_media_c + ' °C' : '—'}</div><div class="ac-kpi-l">Temp. média de substrato (obs.)</div></div>
    </div>
    <p class="ac-prosa">O sucesso reprodutivo depende da <strong>duração da seca</strong>: os ninhos precisam de cerca de <strong>${ctx.exposicao_minima_dias || 55} dias acima d'água</strong> para completar a incubação. A antecipação da cheia ou pulsos anômalos de subida do rio alagam ninhos e derrubam o recrutamento — em <em>P. unifilis</em>, o alagamento causa <strong>${ctx.flood_mortalidade_unifilis || '10–100%'}</strong> de mortalidade dos ovos conforme a duração. Modelos indicam que um aumento de apenas <strong>+${ctx.flood_limiar_nivel_m || 1.5} m</strong> no nível já reduz o tempo de exposição abaixo do mínimo em metade da área de nidificação <span class="ac-cite">[ref.]</span>.</p>
    <div class="ac-flag ac-flag-info">Recomendação de dado: integrar a série de nível do rio (estação fluviométrica próxima) para cruzar com as datas de postura/eclosão nas próximas versões — hoje o risco climático é lido pelos sinais de alagamento das visitas.</div>
    <div class="ac-chart-wrap"><canvas id="ac-cv-clima" height="140"></canvas></div>
  </section>`
}

// ── 13 · Comparação interanual & tendências ─────────────────────
function acSecInteranual(dados) {
  const anos = dados.por_ano || []
  const multi = anos.length >= 2
  return `<section class="ac-sec">
    ${acSecTitle('13', 'Comparação interanual & tendências', 'Linha de base sendo construída a cada temporada')}
    ${multi
      ? `<p class="ac-prosa">A série abaixo compara ninhos, filhotes e taxa de eclosão entre os anos monitorados. Tendências estatísticas robustas exigem várias temporadas; leia as variações como sinais, não como conclusões.</p>
         <div class="ac-chart-wrap"><canvas id="ac-cv-inter" height="150"></canvas></div>`
      : `<div class="ac-flag ac-flag-info">Há apenas <strong>${anos.length || 0}</strong> ano(s) de dados no sistema. A estrutura de comparação interanual já está pronta; a série temporal e as tendências passam a ter significância à medida que novas temporadas forem monitoradas. Como referência histórica, o Programa Quelônios da Amazônia (desde ${(window.BIO_CONTEXTO || {}).pqa_criacao || 1979}) já manejou mais de <strong>${acFmt((window.BIO_CONTEXTO || {}).pqa_filhotes_acumulados)}</strong> filhotes soltos na natureza <span class="ac-cite">[ref.]</span>.</div>`}
  </section>`
}

// ── 13 · Perspectivas & recomendações de manejo ─────────────────
function acSecPerspectivas(kpis, ana, dados, det) {
  const recs = []
  const t = ana.temporada
  const fase = t && t.fase_atual
  const alag = acN((ana.clima || {}).ninhos_alagados)
  const taxaEcl = kpis.taxa_eclosao_pct
  const tempN = acN((ana.temperatura || {}).n_amostras)
  const nBio = acN(((det || {}).crescimento || {}).n_biometrias)
  const mortEmbr = ((det || {}).eclosao || {}).taxa_mortalidade_embrionaria_pct

  if (fase === 'inicio' || fase === 'pre')
    recs.push(['Fase de postura', 'Priorizar o esforço de busca e marcação de ninhos nas praias de maior densidade histórica; registrar hora de desova para viabilizar a janela crítica de transferência.'])
  if (fase === 'meio')
    recs.push(['Fase de incubação', 'Intensificar visitas de acompanhamento com registro de temperatura de substrato; agir preventivamente em ninhos com risco de alagamento ou predação.'])
  if (fase === 'fim')
    recs.push(['Fase de eclosão', 'Concentrar equipes nas praias em janela de eclosão; padronizar a soltura ao amanhecer e a contagem de filhotes vivos/mortos.'])
  if (alag > 0)
    recs.push(['Risco hidrológico', `Há ${alag} ninho(s) com sinal de alagamento — avaliar transferência para cotas mais altas e acompanhar o nível do rio.`])
  if (tempN < 10)
    recs.push(['Dado de temperatura', 'Reforçar a medição de temperatura de substrato nas visitas — é o insumo do eixo TSD/razão sexual e hoje está escasso.'])
  if (taxaEcl != null && taxaEcl < 60)
    recs.push(['Taxa de eclosão baixa', `Eclosão observada em ${acPct(taxaEcl)} — investigar causas (predação, alagamento, temperatura, manejo) por praia.`])
  if (nBio === 0)
    recs.push(['Biometria de berçário', 'Iniciar o registro de biometria (comprimento/peso) dos lotes no app — sem ele não há curva de crescimento, idade × tamanho nem leitura de tamanho ideal de soltura. Sugestão: 1 biometria por lote a cada 15–30 dias.'])
  if (mortEmbr != null && mortEmbr > 20)
    recs.push(['Mortalidade embrionária', `Mortalidade embrionária em ${acPct(mortEmbr)} — avaliar condições de incubação/berçário (temperatura, alagamento, higiene do substrato) para conter perdas por fungo/manejo.`])
  recs.push(['Consolidação da série', 'Manter a validação científica dos ninhos em dia para que a comparação interanual ganhe robustez nas próximas temporadas.'])

  return `<section class="ac-sec">
    ${acSecTitle('14', 'Perspectivas & recomendações de manejo')}
    <div class="ac-recs">${recs.map(([t, d]) => `<div class="ac-rec"><div class="ac-rec-t">${esc(t)}</div><div class="ac-rec-d">${esc(d)}</div></div>`).join('')}</div>
  </section>`
}

// ── 14 · Fundamentação e fontes ──────────────────────────────────
function acSecFundamentacao(dados) {
  const espUsadas = new Set((dados.por_especie || []).map(e => e.especie))
  const refIds = new Set()
  espUsadas.forEach(k => ((window.BIO_ESPECIES_REF[k] || {}).refs || []).forEach(r => refIds.add(r)))
  ;['tsd_expansa', 'clima_pulso', 'alagamento', 'pqa', 'javaes',
    'crescimento_vb', 'headstart', 'fusariose', 'falha_reprodutiva'].forEach(r => refIds.add(r))
  return `<section class="ac-sec">
    ${acSecTitle('15', 'Fundamentação & fontes')}
    <ul class="ac-refs">${window.bioReferenciasHTML(Array.from(refIds))}</ul>
  </section>`
}

// ── 15 · Metodologia & limitações ───────────────────────────────
function acSecMetodologia(kpis, ana, det) {
  const total = acN(kpis.total_ninhos)
  const nBio = acN(((det || {}).crescimento || {}).n_biometrias)
  return `<section class="ac-sec ac-metodo">
    ${acSecTitle('16', 'Metodologia & limitações')}
    <p class="ac-prosa"><strong>Fonte dos dados observados:</strong> registros de campo do Biomonitor (ninhos, visitas, eclosões, transferências, berçário) validados no sistema. <strong>Recorte por fase:</strong> a temporada é dividida em terços iguais da janela [início, fim]; cada ninho é classificado pela data de encontro/postura.</p>
    <p class="ac-prosa"><strong>Taxas e métricas:</strong> eclosão = vivos ÷ (vivos + mortos + não nascidos); mortalidade embrionária = (mortos + não nascidos) ÷ total incubado; fertilidade = ovos íntegros ÷ postura; incubação = (nascimento − encontro); permanência em berçário = (soltura − entrada); taxa de crescimento = Δcomprimento ÷ Δdias entre a primeira e a última biometria do lote; idade do filhote = data da biometria − data de nascimento.</p>
    <div class="ac-flag ac-flag-info"><strong>Limitações:</strong> N amostral atual = ${acFmt(total)} ninho(s)${nBio === 0 ? '; <strong>0 biometrias</strong> — as análises de crescimento, idade × tamanho e tamanho de soltura ainda dependem do início do registro de biometria no campo' : ''}. A leitura de razão sexual (TSD) usa a temperatura média observada, não a do período termossensível, e é apenas indicativa. A quebra de descartes por causa (evento) pode não coincidir com o total de ovos descartados por ninho, que é reconciliado na sincronização. Comparações interanuais e correlações climáticas ganham significância com mais temporadas e com a integração de dados fluviométricos externos.</p></div>
  </section>`
}

// ── Gráficos ────────────────────────────────────────────────────
function acMkChart(id, cfg) {
  const el = document.getElementById(id)
  if (!el || typeof Chart === 'undefined') return
  _acCharts[id] = new Chart(el.getContext('2d'), cfg)
}
const AC_GRID = 'rgba(0,0,0,.06)'

function acChartFenologia(dados) {
  const m = dados.por_mes || []
  if (!m.length) return
  acMkChart('ac-cv-feno', {
    type: 'line',
    data: {
      labels: m.map(x => x.mes),
      datasets: [
        { label: 'Ninhos', data: m.map(x => acN(x.ninhos)), borderColor: '#1A6B8C', backgroundColor: 'rgba(26,107,140,.12)', fill: true, tension: .3, yAxisID: 'y' },
        { label: 'Filhotes', data: m.map(x => acN(x.filhotes)), borderColor: '#2A9D6F', backgroundColor: 'rgba(42,157,111,.10)', tension: .3, yAxisID: 'y2' },
      ],
    },
    options: { responsive: true, maintainAspectRatio: false,
      scales: { y: { position: 'left', beginAtZero: true, grid: { color: AC_GRID }, title: { display: true, text: 'ninhos' } },
        y2: { position: 'right', beginAtZero: true, grid: { drawOnChartArea: false }, title: { display: true, text: 'filhotes' } },
        x: { grid: { display: false } } },
      plugins: { legend: { position: 'bottom' } } },
  })
}

function acChartFase(ana) {
  const f = ana.fases || []
  if (!f.length) return
  acMkChart('ac-cv-fase', {
    type: 'bar',
    data: {
      labels: f.map(x => AC_FASE[x.fase] ? AC_FASE[x.fase].lbl : x.fase),
      datasets: [
        { label: 'Ninhos', data: f.map(x => acN(x.ninhos)), backgroundColor: '#1A6B8C' },
        { label: 'Eclodidos', data: f.map(x => acN(x.eclodidos)), backgroundColor: '#2A9D6F' },
        { label: 'Filhotes vivos', data: f.map(x => acN(x.filhotes_vivos)), backgroundColor: '#C9A84C' },
      ],
    },
    options: { responsive: true, maintainAspectRatio: false,
      scales: { y: { beginAtZero: true, grid: { color: AC_GRID } }, x: { grid: { display: false } } },
      plugins: { legend: { position: 'bottom' } } },
  })
}

function acChartPraias(pr) {
  const lista = ((pr || {}).praias || []).filter(p => p.densidade_ninhos_km != null || p.densidade_ninhos_ha != null)
  if (!lista.length) return
  acMkChart('ac-cv-praias', {
    type: 'bar',
    data: {
      labels: lista.map(p => p.nome),
      datasets: [
        { label: 'Ninhos / km', data: lista.map(p => p.densidade_ninhos_km != null ? Number(p.densidade_ninhos_km) : null), backgroundColor: '#1A6B8C', yAxisID: 'y' },
        { label: 'Ninhos / ha', data: lista.map(p => p.densidade_ninhos_ha != null ? Number(p.densidade_ninhos_ha) : null), backgroundColor: '#D97706', yAxisID: 'y2' },
      ],
    },
    options: { responsive: true, maintainAspectRatio: false,
      scales: {
        y:  { beginAtZero: true, position: 'left',  grid: { color: AC_GRID }, title: { display: true, text: 'ninhos/km' } },
        y2: { beginAtZero: true, position: 'right', grid: { drawOnChartArea: false }, title: { display: true, text: 'ninhos/ha' } },
        x:  { grid: { display: false } },
      },
      plugins: { legend: { position: 'bottom' } } },
  })
}

function acChartTemperatura(ana) {
  const h = (ana.temperatura || {}).histograma || []
  if (!h.length) return
  // Cor por relação com a pivotal (frio → quente)
  const cores = h.map(b => {
    const hi = b.hi
    if (hi != null && hi <= 31) return '#1A6B8C'
    if (b.lo >= 33) return '#D97706'
    if (b.lo >= 32) return '#C9A84C'
    return '#7ECEE8'
  })
  acMkChart('ac-cv-temp', {
    type: 'bar',
    data: { labels: h.map(b => b.faixa), datasets: [{ label: 'Medições', data: h.map(b => acN(b.n)), backgroundColor: cores }] },
    options: { responsive: true, maintainAspectRatio: false,
      scales: { y: { beginAtZero: true, grid: { color: AC_GRID }, ticks: { precision: 0 } }, x: { grid: { display: false } } },
      plugins: { legend: { display: false }, title: { display: true, text: 'Distribuição da temperatura de substrato (frio ♂ → quente ♀)', font: { size: 11 } } } },
  })
}

function acChartInteranual(dados) {
  const a = dados.por_ano || []
  if (a.length < 2) return
  acMkChart('ac-cv-inter', {
    type: 'bar',
    data: {
      labels: a.map(x => x.ano),
      datasets: [
        { label: 'Ninhos', data: a.map(x => acN(x.ninhos)), backgroundColor: '#1A6B8C', yAxisID: 'y' },
        { label: 'Filhotes', data: a.map(x => acN(x.filhotes)), backgroundColor: '#2A9D6F', yAxisID: 'y' },
        { label: 'Taxa eclosão (%)', data: a.map(x => acN(x.taxa_eclosao_pct)), type: 'line', borderColor: '#D97706', backgroundColor: '#D97706', yAxisID: 'y2', tension: .3 },
      ],
    },
    options: { responsive: true, maintainAspectRatio: false,
      scales: { y: { beginAtZero: true, position: 'left', grid: { color: AC_GRID } },
        y2: { beginAtZero: true, max: 100, position: 'right', grid: { drawOnChartArea: false }, title: { display: true, text: '%' } },
        x: { grid: { display: false } } },
      plugins: { legend: { position: 'bottom' } } },
  })
}

function acChartClima(ana) {
  const s = (ana.clima || {}).serie_mensal || []
  if (!s.length) return
  acMkChart('ac-cv-clima', {
    type: 'line',
    data: { labels: s.map(x => x.mes), datasets: [
      { label: 'Temp. média substrato (°C)', data: s.map(x => x.temp_media != null ? Number(x.temp_media) : null), borderColor: '#D97706', backgroundColor: 'rgba(217,119,6,.10)', fill: true, tension: .3, spanGaps: true },
    ] },
    options: { responsive: true, maintainAspectRatio: false,
      scales: { y: { grid: { color: AC_GRID }, title: { display: true, text: '°C' } }, x: { grid: { display: false } } },
      plugins: { legend: { position: 'bottom' } } },
  })
}

function acChartOvos(det) {
  const c = (((det || {}).ovos) || {}).descartes_por_causa || []
  if (!c.length) return
  const cor = { natural: '#2A9D6F', predacao: '#D97706', humana: '#DC2626' }
  acMkChart('ac-cv-ovos', {
    type: 'bar',
    data: { labels: c.map(x => x.causa), datasets: [{ label: 'Ovos descartados', data: c.map(x => acN(x.qtd)), backgroundColor: c.map(x => cor[x.causa] || '#9CA3AF') }] },
    options: { responsive: true, maintainAspectRatio: false,
      scales: { y: { beginAtZero: true, grid: { color: AC_GRID }, ticks: { precision: 0 } }, x: { grid: { display: false } } },
      plugins: { legend: { display: false } } },
  })
}

function acChartEclosao(det) {
  const e = (det || {}).eclosao || {}
  const vals = [acN(e.vivos), acN(e.mortos), acN(e.nao_nascidos)]
  if (vals.reduce((a, b) => a + b, 0) === 0) return
  acMkChart('ac-cv-ecl', {
    type: 'doughnut',
    data: { labels: ['Filhotes vivos', 'Filhotes mortos', 'Ovos não nascidos'], datasets: [{ data: vals, backgroundColor: ['#2A9D6F', '#DC2626', '#9CA3AF'] }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } } },
  })
}

function acChartPerdas(det) {
  const p = (det || {}).perdas || {}
  const vals = [acN(p.ovos_alagamento), acN(p.ovos_erosao), acN(p.ovos_humana), acN(p.ovos_predacao)]
  if (vals.reduce((a, b) => a + b, 0) === 0) return
  acMkChart('ac-cv-perdas', {
    type: 'bar',
    data: { labels: ['Alagamento', 'Erosão', 'Humana', 'Predação'], datasets: [{ label: 'Ovos perdidos', data: vals, backgroundColor: ['#1A6B8C', '#C9A84C', '#DC2626', '#D97706'] }] },
    options: { responsive: true, maintainAspectRatio: false,
      scales: { y: { beginAtZero: true, grid: { color: AC_GRID }, ticks: { precision: 0 } }, x: { grid: { display: false } } },
      plugins: { legend: { display: false } } },
  })
}

function acChartTempos(det) {
  const s = ((det || {}).incubacao || {}).serie || []
  if (!s.length) return
  acMkChart('ac-cv-incub', {
    type: 'bar',
    data: { labels: s.map(x => x.numero_ninho || '—'), datasets: [
      { label: 'Observado (d)', data: s.map(x => acN(x.dias_obs)), backgroundColor: '#1A6B8C' },
      { label: 'Previsto (d)', data: s.map(x => x.dias_prev != null ? acN(x.dias_prev) : null), backgroundColor: '#7ECEE8' },
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
    borderColor: AC_ESP_COR[k] || '#1A6B8C',
    backgroundColor: AC_ESP_COR[k] || '#1A6B8C',
    showLine: true, tension: .3,
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
