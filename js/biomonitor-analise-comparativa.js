// ── SIGUC-AC · Biomonitor — Relatório Comparativo entre Temporadas ─
// Modo "dedicado" da mesma página (pages/analise-cientifica-biomonitor.html):
// acionado quando 2+ temporadas são marcadas no seletor. Reaproveita as
// MESMAS 4 RPCs do relatório de temporada única (bio_relatorio_completo,
// bio_analise_cientifica, bio_analise_detalhada, bio_analise_praias),
// chamando-as uma vez por temporada selecionada — nenhuma agregação nova
// no banco.
//
// Cada seção do relatório único ganha uma versão comparativa: tabela
// (métrica × temporada + Δ) e, quando fizer sentido, gráfico. Toda seção
// termina com um parágrafo de ANÁLISE gerado por regras determinísticas
// (motor acCmpFrase/acCmpClassifica) — não é texto livre de IA.
//
// Depende de helpers/estado já globais de js/biomonitor-analise.js:
// esc(), acN(), acFmt(), acPct(), acData(), acSecTitle(), acMkChart(),
// AC_GRID, acCarregarChartJS(), acDestruirCharts(), AC_ESP_LABEL,
// AC_ESP_COR, AC_FASE_ATUAL_LBL — e de db/getCabecalhoRelatorio/bIconsAplicar.

// ── Ponto de entrada — 2+ temporadas marcadas ───────────────────────
window.acAplicarComparativo = async function (temporadaIds, filtros) {
  const el = document.getElementById('ac-conteudo')
  el.innerHTML = '<div class="ac-loading">Compilando o Relatório Comparativo…</div>'
  acDestruirCharts()

  const paramsBase = {
    p_programa_id: filtros.programa || null,
    p_uc_id:       filtros.uc       || null,
    p_praia_id:    filtros.praia    || null,
  }

  const bundles = (await Promise.all(temporadaIds.map(async tid => {
    const params = { ...paramsBase, p_temporada_id: tid }
    const [rRel, rAna, rDet, rPr] = await Promise.all([
      db.rpc('bio_relatorio_completo', { ...params, p_tipo_localizacao: filtros.localizacao || null }),
      db.rpc('bio_analise_cientifica', { ...params, p_ref_date: null }),
      db.rpc('bio_analise_detalhada', params),
      db.rpc('bio_analise_praias', params),
    ])
    const dados = rRel.data || {}
    const ana   = rAna.data || {}
    return {
      id: tid,
      dados, ana,
      det: rDet.data || {},
      pr:  rPr.data  || {},
      kpis: dados.kpis || {},
      temporada: ana.temporada || {},
    }
  })))
    // Mais antiga → mais recente (leitura cronológica esquerda→direita).
    // data_inicio é 'YYYY-MM-DD' — comparável como string, não como número
    // (o bug anterior fazia `string - string` = NaN, e o sort virava no-op,
    // deixando a ordem de clique dos chips — daí a 2026/2027 aparecer à
    // esquerda da 2025/2026).
    .sort((a, b) => {
      const da = acData_ord(a.temporada.data_inicio), db = acData_ord(b.temporada.data_inicio)
      return da < db ? -1 : da > db ? 1 : 0
    })

  await acCarregarChartJS()

  try {
    const capaEl = document.getElementById('ac-capa')
    if (capaEl && typeof getCabecalhoRelatorio === 'function') {
      // Departamento vem de modulo_departamento('biomonitor') — DEBIO,
      // pelo organograma (migration 265/299) — não mais hardcoded aqui.
      const cab = await getCabecalhoRelatorio('biomonitor')
      capaEl.innerHTML = acCmpCapa(bundles, cab)
    }
  } catch (_) { /* capa é opcional */ }

  el.innerHTML = [
    acCmpCabecalho(bundles),
    acCmpSecSumario(bundles),
    acCmpSecCobertura(bundles),
    acCmpSecFenologia(bundles),
    acCmpSecEspecies(bundles),
    acCmpSecTabela('06', 'ovos', 'Ovos e fertilidade', 'Postura, fertilidade e média de ovos por ninho', bundles, AC_CMP_M.ovos),
    acCmpSecTabela('07', 'eclosao', 'Eclosão e mortalidade embrionária', 'Desfecho dos ovos incubados', bundles, AC_CMP_M.eclosao),
    acCmpSecTabela('08', 'perdas', 'Perdas e predação', 'Onde a coorte foi perdida em cada temporada', bundles, AC_CMP_M.perdas),
    acCmpSecTabela('09', 'tempos', 'Tempos do ciclo', 'Incubação e permanência em berçário', bundles, AC_CMP_M.tempos),
    acCmpSecCrescimento(bundles),
    acCmpSecTabela('11', 'temperatura', 'Temperatura e sinais climáticos', 'Substrato e risco de alagamento', bundles, AC_CMP_M.temperatura),
    acCmpSecTabela('12', 'bercario', 'Berçário — entrada, soltura e sobrevivência', 'Manejo pós-eclosão', bundles, AC_CMP_M.bercario),
    acCmpSecSintese(bundles),
    acCmpSecMetodologia(bundles),
  ].join('')

  if (typeof bIconsAplicar === 'function') bIconsAplicar(el)

  acCmpChartFenologia(bundles)
  acCmpChartEspecies(bundles)
  acCmpChartCrescimento(bundles)
  Object.keys(AC_CMP_M).forEach(sec => acCmpChartMetricas(sec, bundles, AC_CMP_M[sec]))
}

function acData_ord(d) { return d ? String(d) : '9999-99-99' }

// ── Catálogo de métricas comparáveis por seção ──────────────────────
// pol: 'alta' (subir é melhora), 'baixa' (subir é piora), 'neutra' (sem juízo de valor)
const AC_CMP_M = {
  cobertura: [
    { label: 'Praias monitoradas',              get: b => acN(b.pr?.resumo?.total_praias),               pol: 'alta',   dec: 0 },
    { label: 'Praias com ao menos 1 ninho',      get: b => acN(b.pr?.resumo?.praias_com_ninhos),           pol: 'alta',   dec: 0 },
    { label: 'Comprimento monitorado (km)',      get: b => acN(b.pr?.resumo?.comprimento_total_m) / 1000,  pol: 'alta',   dec: 2 },
    { label: 'Área monitorada (ha)',             get: b => acN(b.pr?.resumo?.area_total_ha),               pol: 'alta',   dec: 2 },
  ],
  ovos: [
    { label: 'Ovos na postura',                  get: b => acN(b.kpis.total_ovos_postura),                 pol: 'alta',   dec: 0 },
    { label: 'Ovos íntegros',                    get: b => acN(b.det?.ovos?.total_integros),               pol: 'alta',   dec: 0 },
    { label: 'Média de ovos por ninho',          get: b => b.det?.ovos?.media_postura,                     pol: 'neutra', dec: 1 },
    { label: 'Fertilidade',                      get: b => b.det?.ovos?.taxa_fertilidade_pct,              pol: 'alta',   dec: 1, unidade: '%' },
  ],
  eclosao: [
    { label: 'Filhotes vivos',                   get: b => acN(b.det?.eclosao?.vivos),                     pol: 'alta',   dec: 0 },
    { label: 'Filhotes mortos',                  get: b => acN(b.det?.eclosao?.mortos),                    pol: 'baixa',  dec: 0 },
    { label: 'Ovos não nascidos',                get: b => acN(b.det?.eclosao?.nao_nascidos),              pol: 'baixa',  dec: 0 },
    { label: 'Taxa de eclosão',                  get: b => b.det?.eclosao?.taxa_eclosao_pct,               pol: 'alta',   dec: 1, unidade: '%' },
    { label: 'Mortalidade embrionária',          get: b => b.det?.eclosao?.taxa_mortalidade_embrionaria_pct, pol: 'baixa', dec: 1, unidade: '%' },
  ],
  perdas: [
    { label: 'Ovos perdidos — alagamento',       get: b => acN(b.det?.perdas?.ovos_alagamento),            pol: 'baixa',  dec: 0 },
    { label: 'Ovos perdidos — erosão',           get: b => acN(b.det?.perdas?.ovos_erosao),                pol: 'baixa',  dec: 0 },
    { label: 'Ovos perdidos — ação humana',      get: b => acN(b.det?.perdas?.ovos_humana),                pol: 'baixa',  dec: 0 },
    { label: 'Ovos predados',                    get: b => acN(b.det?.perdas?.ovos_predacao),              pol: 'baixa',  dec: 0 },
    { label: 'Ninhos perdidos',                  get: b => acN(b.det?.perdas?.ninhos_perdidos),            pol: 'baixa',  dec: 0 },
    { label: 'Predação por animais (registros)', get: b => acN(b.kpis.predacao_animais),                   pol: 'baixa',  dec: 0 },
    { label: 'Predação por pessoas (registros)', get: b => acN(b.kpis.predacao_pessoas),                   pol: 'baixa',  dec: 0 },
  ],
  tempos: [
    { label: 'Incubação média',                  get: b => b.det?.incubacao?.media_dias,                   pol: 'neutra', dec: 0, unidade: ' d' },
    { label: 'Desvio observado × previsto',       get: b => b.det?.incubacao?.desvio_medio_dias,            pol: 'neutra', dec: 1, unidade: ' d' },
    { label: 'Permanência média em berçário',    get: b => b.det?.bercario_tempo?.media_dias,              pol: 'neutra', dec: 0, unidade: ' d' },
  ],
  temperatura: [
    { label: 'Temperatura média de substrato',   get: b => b.ana?.temperatura?.media,                      pol: 'neutra', dec: 1, unidade: ' °C' },
    { label: 'Medições de temperatura (N)',      get: b => acN(b.ana?.temperatura?.n_amostras),            pol: 'alta',   dec: 0 },
    { label: 'Ninhos com sinal de alagamento',   get: b => acN(b.ana?.clima?.ninhos_alagados),             pol: 'baixa',  dec: 0 },
    { label: 'Ovos perdidos por alagamento',     get: b => acN(b.ana?.clima?.ovos_perdidos_alagamento),    pol: 'baixa',  dec: 0 },
  ],
  bercario: [
    { label: 'Filhotes que entraram no berçário', get: b => acN(b.kpis.bercario_total_entrada),            pol: 'neutra', dec: 0 },
    { label: 'Filhotes soltos',                  get: b => acN(b.kpis.bercario_total_soltado),             pol: 'alta',   dec: 0 },
    { label: 'Mortalidade no berçário',          get: b => acN(b.kpis.bercario_mortalidade),               pol: 'baixa',  dec: 0 },
    { label: 'Taxa de sobrevivência no berçário', get: b => b.kpis.taxa_sobrevivencia_bercario_pct,        pol: 'alta',   dec: 1, unidade: '%' },
  ],
}

// Métricas do sumário (topo do relatório) — mistura seções-chave
const AC_CMP_M_SUMARIO = [
  { label: 'Praias monitoradas',        get: b => acN(b.pr?.resumo?.total_praias),   pol: 'alta',  dec: 0 },
  { label: 'Ninhos monitorados',        get: b => acN(b.kpis.total_ninhos),          pol: 'alta',  dec: 0 },
  { label: 'Ninhos perdidos',           get: b => acN(b.kpis.perdidos),              pol: 'baixa', dec: 0 },
  { label: 'Filhotes vivos',            get: b => acN(b.det?.eclosao?.vivos ?? b.kpis.total_filhotes_vivos), pol: 'alta', dec: 0 },
  { label: 'Taxa de eclosão',           get: b => b.kpis.taxa_eclosao_pct,           pol: 'alta',  dec: 1, unidade: '%' },
  { label: 'Taxa de sucesso de nidificação', get: b => b.kpis.taxa_sucesso_nidificacao_pct, pol: 'alta', dec: 1, unidade: '%' },
]

// ── Motor de análise: classificação e frase de variação ─────────────
function acCmpFmtValor(v, m) {
  if (v == null || isNaN(v)) return '—'
  const n = Number(v)
  const casas = m.dec != null ? m.dec : 0
  const txt = casas > 0 ? n.toFixed(casas).replace('.', ',') : acFmt(Math.round(n))
  return `${txt}${m.unidade || ''}`
}

// Classifica a variação percentual em faixas de leitura (sinal, não conclusão estatística)
function acCmpClassifica(deltaPct) {
  const a = Math.abs(deltaPct)
  if (a < 5) return 'estável'
  if (a < 15) return 'leve'
  return 'expressiva'
}

// pol: alta=sobe é bom, baixa=sobe é ruim, neutra=sem juízo
function acCmpCor(deltaPct, pol) {
  if (deltaPct == null || pol === 'neutra' || Math.abs(deltaPct) < 5) return '#6B7280'
  const sobeEBom = pol === 'alta' ? deltaPct > 0 : deltaPct < 0
  return sobeEBom ? '#2A9D6F' : '#DC2626'
}

function acCmpDelta(primeiro, ultimo, pol) {
  const p = acN(primeiro), u = acN(ultimo)
  if (primeiro == null && ultimo == null) return { icone: '—', cor: '#9CA3AF', texto: '—', deltaPct: null }
  const deltaAbs = u - p
  const deltaPct = p !== 0 ? (deltaAbs / Math.abs(p)) * 100 : (u !== 0 ? 100 : 0)
  const icone = deltaAbs > 0 ? '▲' : deltaAbs < 0 ? '▼' : '≈'
  const cor = acCmpCor(deltaPct, pol)
  const txtPct = `${deltaPct > 0 ? '+' : ''}${deltaPct.toFixed(1)}%`
  return { icone, cor, texto: txtPct, deltaPct, deltaAbs }
}

// Frase narrativa para uma métrica, comparando a mais antiga × mais recente
function acCmpFrase(m, bundles) {
  const vals = bundles.map(b => m.get(b))
  const primeiro = vals[0], ultimo = vals[vals.length - 1]
  if (primeiro == null && ultimo == null) return null
  const { deltaPct, deltaAbs } = acCmpDelta(primeiro, ultimo, m.pol)
  if (deltaPct == null) return null
  const classe = acCmpClassifica(deltaPct)
  const nomeA = esc(bundles[0].temporada.nome || '—')
  const nomeZ = esc(bundles[bundles.length - 1].temporada.nome || '—')
  const vA = acCmpFmtValor(primeiro, m), vZ = acCmpFmtValor(ultimo, m)
  const direcao = deltaAbs > 0 ? 'aumento' : deltaAbs < 0 ? 'queda' : 'estabilidade'

  let juizo = ''
  if (classe !== 'estável' && m.pol !== 'neutra') {
    const bom = (m.pol === 'alta') === (deltaAbs > 0)
    juizo = bom ? ' — sinal positivo' : ' — ponto de atenção'
  }
  const advQualif = classe === 'estável' ? 'estável' : `${direcao} ${classe}`
  return `<strong>${esc(m.label)}</strong>: de ${vA} (${nomeA}) para ${vZ} (${nomeZ}), ${advQualif} (${deltaPct > 0 ? '+' : ''}${deltaPct.toFixed(1)}%)${juizo}.`
}

// ── Aviso de temporada em andamento (comparação parcial) ────────────
function acCmpAndamento(b) {
  return b.temporada.fase_atual && b.temporada.fase_atual !== 'encerrada'
}
function acCmpAvisoAndamento(bundles) {
  const emAndamento = bundles.filter(acCmpAndamento)
  if (!emAndamento.length) return ''
  const nomes = emAndamento.map(b => `${esc(b.temporada.nome)} (${b.temporada.pct_decorrido != null ? b.temporada.pct_decorrido + '% decorrido' : 'em andamento'})`).join(', ')
  return `<div class="ac-flag ac-flag-warn"><strong>Comparação parcial:</strong> ${nomes} ainda ${emAndamento.length > 1 ? 'estão' : 'está'} em andamento — contagens acumuladas (ninhos, ovos, filhotes) ainda vão crescer até o fim da temporada. Leia variações desses totais com essa ressalva; taxas e médias (%) já são comparáveis diretamente.</div>`
}

// ── Capa e cabeçalho ─────────────────────────────────────────────────
function acCmpCapa(bundles, cab) {
  cab = cab || {}
  const hoje = new Date().toLocaleDateString('pt-BR')
  const img = (url, alt) => url ? `<img src="${esc(url)}" alt="${esc(alt)}" onerror="this.style.display='none'">` : ''
  const gestao = cab.gestao ? ` · Gestão ${esc(cab.gestao)}` : ''
  const contato = [cab.telefone, cab.email, cab.site].filter(Boolean).map(esc).join(' · ')
  const lista = bundles.map(b => `<div>${esc(b.temporada.nome || '—')}${acCmpAndamento(b) ? ' <span class="ac-cmp-badge andamento">em andamento</span>' : ''}</div>`).join('')
  return `
    <div class="ac-capa-logos">${img(cab.logoGoverno, 'Governo do Acre')}${img(cab.logoSecr, 'SEMA-AC')}</div>
    <div class="ac-capa-hier">
      <div class="l1">${esc(cab.governo || 'Governo do Estado do Acre')}${gestao}</div>
      <div class="l2">${esc(cab.secretaria || 'Secretaria de Estado do Meio Ambiente do Acre')} — ${esc(cab.siglaSecr || 'SEMA-AC')}</div>
      <div class="l3">${esc(cab.diretoria || 'Diretoria de Meio Ambiente')} (${esc(cab.siglaDiret || 'DIMA')})</div>
      ${cab.departamento ? `<div class="l3">${esc(cab.departamento)} (${esc(cab.siglaDep || 'DEBIO')})</div>` : ''}
    </div>
    <div class="ac-capa-mid">
      <div class="ac-capa-tipo">Relatório Comparativo</div>
      <h1 class="ac-capa-titulo">Relatório Comparativo entre Temporadas</h1>
      <div class="ac-capa-sub">Biomonitoramento de Quelônios Amazônicos</div>
      <div class="ac-capa-temp-lista">${lista}</div>
      <table class="ac-capa-meta">
        <tr><td>Temporadas comparadas</td><td>${bundles.length}</td></tr>
        <tr><td>Emitido em</td><td>${hoje}</td></tr>
      </table>
    </div>
    <div class="ac-capa-rodape">
      <div>${esc(cab.secretaria || 'SEMA-AC')}${cab.endereco ? ' — ' + esc(cab.endereco) : ''}</div>
      ${contato ? `<div>${contato}</div>` : ''}
      ${cab.avisoLegal ? `<div class="ac-capa-aviso">${esc(cab.avisoLegal)}</div>` : ''}
    </div>`
}

function acCmpCabecalho(bundles) {
  const hoje = new Date().toLocaleDateString('pt-BR')
  const nomes = bundles.map(b => esc(b.temporada.nome || '—') + (acCmpAndamento(b) ? ' <span class="ac-cmp-badge andamento">em andamento</span>' : '')).join(' · ')
  return `
  <header class="ac-doc-head">
    <div class="ac-doc-brand">SIGUC-AC · SEMA-AC / DIMA · Biomonitor Quelônios</div>
    <h1 class="ac-doc-title">Relatório Comparativo entre Temporadas</h1>
    <div class="ac-doc-meta">
      <span><strong>Temporadas:</strong> ${nomes}</span>
      <span><strong>Emitido em:</strong> ${hoje}</span>
    </div>
    <p class="ac-doc-nota">
      Cada seção compara as temporadas marcadas lado a lado (mais antiga → mais recente) e traz uma
      leitura automática das variações. <em>Δ</em> = variação percentual entre a temporada mais antiga
      e a mais recente do grupo comparado. Leia como sinal, não como conclusão estatística — a robustez
      cresce com mais temporadas monitoradas.
    </p>
  </header>`
}

// ── Tabela comparativa genérica (cabeçalho + linhas + Δ) ────────────
function acCmpTabela(metricas, bundles) {
  const head = `<tr><th>Métrica</th>${bundles.map(b => `<th class="num ac-cmp-th-temp">${esc(b.temporada.nome || '—')}${acCmpAndamento(b) ? '<span class="ac-cmp-th-and">em andamento</span>' : ''}</th>`).join('')}<th class="num">Δ</th></tr>`
  const linhas = metricas.map(m => {
    const vals = bundles.map(b => m.get(b))
    const { icone, cor, texto } = acCmpDelta(vals[0], vals[vals.length - 1], m.pol)
    return `<tr><td>${esc(m.label)}</td>${vals.map(v => `<td class="num">${acCmpFmtValor(v, m)}</td>`).join('')}<td class="num"><span class="ac-cmp-delta" style="--c:${cor}">${icone} ${texto}</span></td></tr>`
  }).join('')
  return `<table class="ac-table"><thead>${head}</thead><tbody>${linhas}</tbody></table>`
}

function acCmpNarrativa(metricas, bundles, max) {
  const frases = metricas.map(m => ({ m, f: acCmpFrase(m, bundles) })).filter(x => x.f)
  if (!frases.length) return ''
  // Prioriza as variações mais expressivas (|Δ%|) para não poluir com "estável" repetido
  const comDelta = frases.map(x => {
    const vals = bundles.map(b => x.m.get(b))
    const { deltaPct } = acCmpDelta(vals[0], vals[vals.length - 1], x.m.pol)
    return { ...x, abs: Math.abs(deltaPct || 0) }
  }).sort((a, b) => b.abs - a.abs)
  const escolhidas = (max ? comDelta.slice(0, max) : comDelta).map(x => x.f)
  return `<p class="ac-prosa">${escolhidas.join(' ')}</p>`
}

// Gráfico de barras agrupadas — só para métricas de mesma escala (contagens, sem %)
function acCmpChartMetricas(secId, bundles, metricas) {
  const canvasId = `ac-cmp-cv-${secId}`
  const contaveis = metricas.filter(m => !m.unidade && (m.dec || 0) === 0)
  if (contaveis.length < 2 || !document.getElementById(canvasId)) return
  const cores = ['#1A6B8C', '#2A9D6F', '#C9A84C', '#D97706', '#7ECEE8', '#8b5cf6']
  acMkChart(canvasId, {
    type: 'bar',
    data: {
      labels: contaveis.map(m => m.label),
      datasets: bundles.map((b, i) => ({
        label: b.temporada.nome || `Temporada ${i + 1}`,
        data: contaveis.map(m => acN(m.get(b))),
        backgroundColor: cores[i % cores.length],
      })),
    },
    options: { responsive: true, maintainAspectRatio: false,
      scales: { y: { beginAtZero: true, grid: { color: AC_GRID }, ticks: { precision: 0 } }, x: { grid: { display: false } } },
      plugins: { legend: { position: 'bottom' } } },
  })
}

// Seção-tabela genérica (usada por Cobertura, Ovos, Eclosão, Perdas, Tempos,
// Temperatura, Berçário). secKey = chave em AC_CMP_M (usada no id do canvas,
// para casar com acCmpChartMetricas — o número da seção é só o rótulo visual).
function acCmpSecTabela(num, secKey, titulo, sub, bundles, metricas) {
  const contaveis = metricas.filter(m => !m.unidade && (m.dec || 0) === 0)
  return `<section class="ac-sec">
    ${acSecTitle(num, titulo, sub)}
    ${acCmpTabela(metricas, bundles)}
    ${contaveis.length >= 2 ? `<div class="ac-chart-wrap"><canvas id="ac-cmp-cv-${secKey}" height="150"></canvas></div>` : ''}
    ${acCmpNarrativa(metricas, bundles, 3)}
  </section>`
}

// ── 01 · Sumário comparativo ─────────────────────────────────────────
function acCmpSecSumario(bundles) {
  const cards = bundles.map((b, i) => {
    const t = b.temporada
    return `<div class="ac-fase-card${acCmpAndamento(b) ? '' : ' atual'}" style="--c:${['#1A6B8C', '#2A9D6F', '#C9A84C', '#D97706'][i % 4]}">
      <div class="ac-fase-top"><span class="ac-fase-lbl">${esc(t.nome || '—')}</span>${acCmpAndamento(b) ? '<span class="ac-fase-badge">EM ANDAMENTO</span>' : ''}</div>
      <div class="ac-fase-sub">${acData(t.data_inicio)} — ${acData(t.data_fim)}</div>
      <div class="ac-fase-grid">
        <div><b>${acFmt(b.kpis.total_ninhos)}</b><span>ninhos</span></div>
        <div><b>${acFmt(b.det?.eclosao?.vivos ?? b.kpis.total_filhotes_vivos)}</b><span>filhotes vivos</span></div>
        <div><b>${acPct(b.kpis.taxa_eclosao_pct)}</b><span>eclosão</span></div>
        <div><b>${acFmt(b.pr?.resumo?.total_praias)}</b><span>praias</span></div>
      </div></div>`
  }).join('')

  return `<section class="ac-sec">
    ${acSecTitle('01', 'Sumário comparativo', `${bundles.length} temporadas — leitura lado a lado`)}
    ${acCmpAvisoAndamento(bundles)}
    <div class="ac-fase-cards">${cards}</div>
    ${acCmpTabela(AC_CMP_M_SUMARIO, bundles)}
    ${acCmpNarrativa(AC_CMP_M_SUMARIO, bundles, 4)}
  </section>`
}

// ── 02 · Cobertura (praias) ──────────────────────────────────────────
function acCmpSecCobertura(bundles) {
  const nomesPorTemp = bundles.map(b => new Set((b.pr?.praias || []).map(p => p.nome)))
  const primeira = nomesPorTemp[0] || new Set()
  const ultima = nomesPorTemp[nomesPorTemp.length - 1] || new Set()
  const novas = [...ultima].filter(n => !primeira.has(n))
  const saíram = [...primeira].filter(n => !ultima.has(n))

  let mudancas = ''
  if (novas.length || saíram.length) {
    mudancas = `<div class="ac-flag ac-flag-info">`
      + (novas.length ? `<div><strong>Praias novas</strong> (não monitoradas em ${esc(bundles[0].temporada.nome)}): ${novas.map(esc).join(', ')}.</div>` : '')
      + (saíram.length ? `<div><strong>Praias sem registro</strong> na temporada mais recente (tinham em ${esc(bundles[0].temporada.nome)}): ${saíram.map(esc).join(', ')}.</div>` : '')
      + `</div>`
  }

  const contaveis = AC_CMP_M.cobertura.filter(m => !m.unidade && (m.dec || 0) === 0)
  return `<section class="ac-sec">
    ${acSecTitle('02', 'Cobertura — praias monitoradas', 'Esforço de amostragem entre temporadas')}
    ${acCmpTabela(AC_CMP_M.cobertura, bundles)}
    ${contaveis.length >= 2 ? `<div class="ac-chart-wrap"><canvas id="ac-cmp-cv-cobertura" height="150"></canvas></div>` : ''}
    ${mudancas}
    ${acCmpNarrativa(AC_CMP_M.cobertura, bundles, 2)}
  </section>`
}

// ── 03 · Fenologia comparada ──────────────────────────────────────────
function acCmpSecFenologia(bundles) {
  const temDados = bundles.some(b => (b.dados.por_mes || []).length)
  return `<section class="ac-sec">
    ${acSecTitle('03', 'Fenologia comparada', 'Curva de ninhos por mês, uma linha por temporada')}
    <p class="ac-prosa">A nidificação segue o pulso de inundação; comparar a curva entre temporadas ajuda a notar antecipação, atraso ou achatamento da janela de postura de um ano para o outro.</p>
    ${temDados ? `<div class="ac-chart-wrap"><canvas id="ac-cmp-cv-feno" height="150"></canvas></div>`
      : `<div class="ac-flag">Sem posturas datadas suficientes para montar a curva comparativa.</div>`}
  </section>`
}
function acCmpChartFenologia(bundles) {
  if (!document.getElementById('ac-cmp-cv-feno')) return
  const meses = new Set()
  bundles.forEach(b => (b.dados.por_mes || []).forEach(x => meses.add(x.mes)))
  const labels = Array.from(meses).sort()
  if (!labels.length) return
  const cores = ['#1A6B8C', '#2A9D6F', '#C9A84C', '#D97706', '#7ECEE8', '#8b5cf6']
  acMkChart('ac-cmp-cv-feno', {
    type: 'line',
    data: {
      labels,
      datasets: bundles.map((b, i) => {
        const porMes = {}
        ;(b.dados.por_mes || []).forEach(x => { porMes[x.mes] = acN(x.ninhos) })
        return {
          label: b.temporada.nome || `Temporada ${i + 1}`,
          data: labels.map(l => porMes[l] ?? null),
          borderColor: cores[i % cores.length], backgroundColor: cores[i % cores.length],
          tension: .3, spanGaps: true,
        }
      }),
    },
    options: { responsive: true, maintainAspectRatio: false,
      scales: { y: { beginAtZero: true, grid: { color: AC_GRID }, title: { display: true, text: 'ninhos' } }, x: { grid: { display: false } } },
      plugins: { legend: { position: 'bottom' } } },
  })
}

// ── 04 · Espécies comparadas ──────────────────────────────────────────
function acCmpSecEspecies(bundles) {
  const especies = new Set()
  bundles.forEach(b => (b.dados.por_especie || []).forEach(e => especies.add(e.especie)))
  if (!especies.size) return `<section class="ac-sec">${acSecTitle('04', 'Espécies comparadas')}<div class="ac-flag">Nenhuma espécie registrada nas temporadas comparadas.</div></section>`

  const linhas = Array.from(especies).map(esp => {
    const porTemp = bundles.map(b => (b.dados.por_especie || []).find(e => e.especie === esp) || {})
    const vals = porTemp.map(e => acN(e.total))
    const { icone, cor, texto } = acCmpDelta(vals[0], vals[vals.length - 1], 'neutra')
    return `<tr><td>${esc(AC_ESP_LABEL[esp] || esp)}</td>
      ${porTemp.map(e => `<td class="num">${acFmt(e.total)} <span style="color:var(--cinza-400);font-size:10px">(${acPct(e.taxa_eclosao_pct)})</span></td>`).join('')}
      <td class="num"><span class="ac-cmp-delta" style="--c:${cor}">${icone} ${texto}</span></td></tr>`
  }).join('')

  return `<section class="ac-sec">
    ${acSecTitle('04', 'Espécies comparadas', 'Ninhos por espécie e taxa de eclosão (entre parênteses), por temporada')}
    <table class="ac-table"><thead><tr><th>Espécie</th>${bundles.map(b => `<th class="num ac-cmp-th-temp">${esc(b.temporada.nome || '—')}</th>`).join('')}<th class="num">Δ ninhos</th></tr></thead>
    <tbody>${linhas}</tbody></table>
    <div class="ac-chart-wrap"><canvas id="ac-cmp-cv-esp" height="160"></canvas></div>
  </section>`
}
function acCmpChartEspecies(bundles) {
  if (!document.getElementById('ac-cmp-cv-esp')) return
  const especies = new Set()
  bundles.forEach(b => (b.dados.por_especie || []).forEach(e => especies.add(e.especie)))
  const labels = Array.from(especies)
  if (!labels.length) return
  const cores = ['#1A6B8C', '#2A9D6F', '#C9A84C', '#D97706', '#7ECEE8', '#8b5cf6']
  acMkChart('ac-cmp-cv-esp', {
    type: 'bar',
    data: {
      labels: labels.map(k => AC_ESP_LABEL[k] || k),
      datasets: bundles.map((b, i) => ({
        label: b.temporada.nome || `Temporada ${i + 1}`,
        data: labels.map(k => acN((b.dados.por_especie || []).find(e => e.especie === k)?.total)),
        backgroundColor: cores[i % cores.length],
      })),
    },
    options: { responsive: true, maintainAspectRatio: false,
      scales: { y: { beginAtZero: true, grid: { color: AC_GRID }, ticks: { precision: 0 } }, x: { grid: { display: false } } },
      plugins: { legend: { position: 'bottom' } } },
  })
}

// ── 10 · Crescimento em berçário comparado ────────────────────────────
function acCmpSecCrescimento(bundles) {
  const nb = bundles.map(b => acN(b.det?.crescimento?.n_biometrias))
  const temDados = nb.some(n => n > 0)
  const linhas = bundles.map((b, i) => `<tr><td>${esc(b.temporada.nome || '—')}</td><td class="num">${acFmt(nb[i])}</td></tr>`).join('')
  return `<section class="ac-sec">
    ${acSecTitle('10', 'Crescimento em berçário comparado', 'Curva comprimento × idade, uma cor por temporada')}
    <table class="ac-table"><thead><tr><th>Temporada</th><th class="num">Biometrias registradas (N)</th></tr></thead><tbody>${linhas}</tbody></table>
    ${temDados ? `<div class="ac-chart-wrap" style="height:220px"><canvas id="ac-cmp-cv-cresc"></canvas></div>`
      : `<div class="ac-flag ac-flag-warn">Nenhuma das temporadas comparadas tem biometria de berçário registrada — sem dado para a curva de crescimento.</div>`}
  </section>`
}
function acCmpChartCrescimento(bundles) {
  if (!document.getElementById('ac-cmp-cv-cresc')) return
  const cores = ['#1A6B8C', '#2A9D6F', '#C9A84C', '#D97706', '#7ECEE8', '#8b5cf6']
  const ds = bundles.map((b, i) => {
    const serie = (b.det?.crescimento?.serie || [])
      .filter(p => p.idade_dias != null && p.comp != null)
      .map(p => ({ x: acN(p.idade_dias), y: acN(p.comp) }))
      .sort((a, c) => a.x - c.x)
    return { label: b.temporada.nome || `Temporada ${i + 1}`, data: serie,
      borderColor: cores[i % cores.length], backgroundColor: cores[i % cores.length], showLine: true, tension: .3 }
  }).filter(d => d.data.length)
  if (!ds.length) return
  acMkChart('ac-cmp-cv-cresc', {
    type: 'scatter',
    data: { datasets: ds },
    options: { responsive: true, maintainAspectRatio: false,
      scales: { x: { title: { display: true, text: 'idade (dias desde a eclosão)' }, grid: { color: AC_GRID } },
        y: { title: { display: true, text: 'comprimento (cm)' }, grid: { color: AC_GRID } } },
      plugins: { legend: { position: 'bottom' } } },
  })
}

// ── 13 · Síntese comparativa & recomendações ──────────────────────────
function acCmpSecSintese(bundles) {
  const todasMetricas = [...AC_CMP_M_SUMARIO, ...Object.values(AC_CMP_M).flat()]
  const comDelta = todasMetricas
    .filter(m => m.pol !== 'neutra')
    .map(m => {
      const vals = bundles.map(b => m.get(b))
      const d = acCmpDelta(vals[0], vals[vals.length - 1], m.pol)
      return { m, ...d }
    })
    .filter(x => x.deltaPct != null && acCmpClassifica(x.deltaPct) !== 'estável')
    .sort((a, b) => Math.abs(b.deltaPct) - Math.abs(a.deltaPct))
    .slice(0, 6)

  const recs = comDelta.map(x => {
    const bom = (x.m.pol === 'alta') === (x.deltaAbs > 0)
    const titulo = `${bom ? 'Melhora' : 'Atenção'} — ${x.m.label}`
    const desc = acCmpFrase(x.m, bundles)
    return `<div class="ac-rec" style="border-left-color:${bom ? '#2A9D6F' : '#DC2626'}"><div class="ac-rec-t">${esc(titulo)}</div><div class="ac-rec-d">${desc}</div></div>`
  })

  if (!recs.length) {
    recs.push(`<div class="ac-rec"><div class="ac-rec-t">Sem variações expressivas</div><div class="ac-rec-d">As métricas comparadas entre as temporadas selecionadas ficaram dentro da faixa de estabilidade (variação &lt; 5%). Mantenha a validação científica em dia para consolidar a série histórica.</div></div>`)
  }
  recs.push(`<div class="ac-rec"><div class="ac-rec-t">Consolidação da série</div><div class="ac-rec-d">Comparações entre poucas temporadas (N = ${bundles.length}) ainda são indicativas, não conclusivas — a leitura ganha robustez estatística a cada nova temporada monitorada e validada.</div></div>`)

  return `<section class="ac-sec">
    ${acSecTitle('13', 'Síntese comparativa & recomendações', 'Maiores variações entre a temporada mais antiga e a mais recente do grupo comparado')}
    ${acCmpAvisoAndamento(bundles)}
    <div class="ac-recs">${recs.join('')}</div>
  </section>`
}

// ── 14 · Metodologia do comparativo ───────────────────────────────────
function acCmpSecMetodologia(bundles) {
  return `<section class="ac-sec ac-metodo">
    ${acSecTitle('14', 'Metodologia do comparativo')}
    <p class="ac-prosa"><strong>Fonte:</strong> as mesmas rotinas do Relatório Científico de temporada única, executadas uma vez por temporada marcada. Nenhum dado é agregado entre temporadas no banco — a comparação é montada nesta tela.</p>
    <p class="ac-prosa"><strong>Δ (variação):</strong> calculado entre a temporada mais antiga e a mais recente do grupo comparado (por <em>data de início</em> da temporada), não necessariamente entre pares consecutivos quando 3+ temporadas são marcadas. Classificação: <strong>estável</strong> (|Δ| &lt; 5%), <strong>leve</strong> (5–15%), <strong>expressiva</strong> (&gt; 15%). "Sinal positivo"/"ponto de atenção" depende da métrica: para taxas de eclosão e sobrevivência, subir é melhora; para predação, perdas e mortalidade, subir é piora; métricas de tempo/temperatura não recebem juízo de valor.</p>
    <div class="ac-flag ac-flag-info"><strong>Limitações:</strong> temporadas ainda em andamento têm contagens absolutas parciais (sinalizadas com "em andamento" nas tabelas) — comparar o total final de uma temporada encerrada com o acumulado parcial de uma em curso pode subestimar esta última. Taxas e médias (%) não sofrem esse viés do mesmo jeito. As frases de análise são geradas por regras determinísticas a partir dos números do sistema — não é um texto gerado por IA.</div>
  </section>`
}
