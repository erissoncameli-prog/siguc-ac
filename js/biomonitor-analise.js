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

  const [rRel, rAna] = await Promise.all([
    db.rpc('bio_relatorio_completo', { ...params, p_tipo_localizacao: filtros.localizacao || null }),
    db.rpc('bio_analise_cientifica', { ...params, p_ref_date: null }),
  ])

  if (rRel.error && rAna.error) {
    el.innerHTML = `<div class="ac-loading">Não foi possível carregar os dados. Tente novamente.</div>`
    return
  }
  const dados = rRel.data || {}
  const ana = rAna.data || {}
  const kpis = dados.kpis || {}

  await acCarregarChartJS()

  // Capa institucional (só aparece na impressão/PDF)
  try {
    const capaEl = document.getElementById('ac-capa')
    if (capaEl && typeof getCabecalhoRelatorio === 'function') {
      const cab = await getCabecalhoRelatorio()
      capaEl.innerHTML = acCapa(ana, cab)
    }
  } catch (_) { /* capa é opcional — não bloqueia o relatório */ }

  el.innerHTML = [
    acCabecalho(ana, filtros),
    acSecSumario(kpis, ana, dados),
    acSecFase(ana),
    acSecFenologia(dados, ana),
    acSecEspecies(dados),
    acSecTemperatura(ana),
    acSecClima(ana, kpis),
    acSecInteranual(dados),
    acSecPerspectivas(kpis, ana, dados),
    acSecFundamentacao(dados),
    acSecMetodologia(kpis, ana),
  ].join('')

  if (typeof bIconsAplicar === 'function') bIconsAplicar(el)

  // Gráficos — depois do DOM montado
  acChartFenologia(dados, ana)
  acChartFase(ana)
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
      ${cab.departamento ? `<div class="l3">${esc(cab.departamento)} (${esc(cab.siglaDep || 'DEUC')})</div>` : ''}
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

// ── 5 · Temperatura & determinação sexual (TSD) ─────────────────
function acSecTemperatura(ana) {
  const tp = ana.temperatura || {}
  const n = acN(tp.n_amostras)
  if (!n) return `<section class="ac-sec">${acSecTitle('05', 'Temperatura & razão sexual (TSD)')}
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
    ${acSecTitle('05', 'Temperatura & razão sexual (TSD)', 'Eixo direto de mudanças climáticas sobre a estrutura populacional')}
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

// ── 6 · Mudanças climáticas & pulso de inundação ────────────────
function acSecClima(ana, kpis) {
  const c = ana.clima || {}
  const ctx = window.BIO_CONTEXTO || {}
  const alag = acN(c.ninhos_alagados)
  const ovosAlag = acN(c.ovos_perdidos_alagamento)
  return `<section class="ac-sec">
    ${acSecTitle('06', 'Mudanças climáticas & pulso de inundação', 'Risco hidrológico e térmico sobre o recrutamento')}
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

// ── 7 · Comparação interanual & tendências ──────────────────────
function acSecInteranual(dados) {
  const anos = dados.por_ano || []
  const multi = anos.length >= 2
  return `<section class="ac-sec">
    ${acSecTitle('07', 'Comparação interanual & tendências', 'Linha de base sendo construída a cada temporada')}
    ${multi
      ? `<p class="ac-prosa">A série abaixo compara ninhos, filhotes e taxa de eclosão entre os anos monitorados. Tendências estatísticas robustas exigem várias temporadas; leia as variações como sinais, não como conclusões.</p>
         <div class="ac-chart-wrap"><canvas id="ac-cv-inter" height="150"></canvas></div>`
      : `<div class="ac-flag ac-flag-info">Há apenas <strong>${anos.length || 0}</strong> ano(s) de dados no sistema. A estrutura de comparação interanual já está pronta; a série temporal e as tendências passam a ter significância à medida que novas temporadas forem monitoradas. Como referência histórica, o Programa Quelônios da Amazônia (desde ${(window.BIO_CONTEXTO || {}).pqa_criacao || 1979}) já manejou mais de <strong>${acFmt((window.BIO_CONTEXTO || {}).pqa_filhotes_acumulados)}</strong> filhotes soltos na natureza <span class="ac-cite">[ref.]</span>.</div>`}
  </section>`
}

// ── 8 · Perspectivas & recomendações de manejo ──────────────────
function acSecPerspectivas(kpis, ana, dados) {
  const recs = []
  const t = ana.temporada
  const fase = t && t.fase_atual
  const alag = acN((ana.clima || {}).ninhos_alagados)
  const taxaEcl = kpis.taxa_eclosao_pct
  const tempN = acN((ana.temperatura || {}).n_amostras)

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
  recs.push(['Consolidação da série', 'Manter a validação científica dos ninhos em dia para que a comparação interanual ganhe robustez nas próximas temporadas.'])

  return `<section class="ac-sec">
    ${acSecTitle('08', 'Perspectivas & recomendações de manejo')}
    <div class="ac-recs">${recs.map(([t, d]) => `<div class="ac-rec"><div class="ac-rec-t">${esc(t)}</div><div class="ac-rec-d">${esc(d)}</div></div>`).join('')}</div>
  </section>`
}

// ── 9 · Fundamentação e fontes ──────────────────────────────────
function acSecFundamentacao(dados) {
  const espUsadas = new Set((dados.por_especie || []).map(e => e.especie))
  const refIds = new Set()
  espUsadas.forEach(k => ((window.BIO_ESPECIES_REF[k] || {}).refs || []).forEach(r => refIds.add(r)))
  ;['tsd_expansa', 'clima_pulso', 'alagamento', 'pqa', 'javaes'].forEach(r => refIds.add(r))
  return `<section class="ac-sec">
    ${acSecTitle('09', 'Fundamentação & fontes')}
    <ul class="ac-refs">${window.bioReferenciasHTML(Array.from(refIds))}</ul>
  </section>`
}

// ── 10 · Metodologia & limitações ───────────────────────────────
function acSecMetodologia(kpis, ana) {
  const total = acN(kpis.total_ninhos)
  return `<section class="ac-sec ac-metodo">
    ${acSecTitle('10', 'Metodologia & limitações')}
    <p class="ac-prosa"><strong>Fonte dos dados observados:</strong> registros de campo do Biomonitor (ninhos, visitas, eclosões, transferências, berçário) validados no sistema. <strong>Recorte por fase:</strong> a temporada é dividida em terços iguais da janela [início, fim]; cada ninho é classificado pela data de encontro/postura.</p>
    <p class="ac-prosa"><strong>Taxas (protocolo PQRA/TAMAR/ICMBio):</strong> eclosão = vivos ÷ (vivos + mortos + não nascidos); sucesso de nidificação = ninhos eclodidos ÷ total; fertilidade = ovos íntegros ÷ postura; eficiência = vivos ÷ ovos íntegros; incubação = média de (nascimento − encontro).</p>
    <div class="ac-flag ac-flag-info"><strong>Limitações:</strong> N amostral atual = ${acFmt(total)} ninho(s). A leitura de razão sexual (TSD) usa a temperatura média observada, não a do período termossensível, e é apenas indicativa. Comparações interanuais e correlações climáticas ganham significância com mais temporadas e com a integração de dados fluviométricos externos.</p></div>
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
