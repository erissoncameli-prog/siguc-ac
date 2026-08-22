// ── SIGUC · Recursos Hídricos — relatório diário em PDF ─────────
// Documento de registro do monitoramento hidrometeorológico do dia:
// por rio, quanto o nível variou, quanto choveu e quais estações
// passaram de alguma cota.
//
// REAPROVEITA os primitivos de js/agua-relatorio-pdf.js
// (_agpdfCarregarLibs/_agpdfNovoDocumento/_agpdfCtx/_agpdfTitulo/
// _agpdfTabela/_agpdfAplicarCabecalhoRodapeGlobal) — nunca uma segunda
// implementação de layout de PDF no projeto, mesma decisão que a ficha
// de coleta tomou. A página precisa carregar `agua-relatorio-pdf.js`
// ANTES deste arquivo (os dois são scripts clássicos, mesmo escopo).
//
// O timbre é o institucional de sempre (logo do Acre à esquerda, SEMA à
// direita, proporção preservada) e o departamento vem de
// `getCabecalhoRelatorio('bacias')` → modulo_unidades → DERHQA.
//
// NADA é recalculado aqui: as linhas vêm da RPC `rh_relatorio_diario`
// (migration 306b), que já agrega por rio e já decide a situação de
// cota comparando com as cotas cadastradas.

function _rhpdfLabelCota(s) {
  return (typeof rhCotaLabel === 'function') ? rhCotaLabel(s) : (s || '—')
}
function _rhpdfNum(v, casas) {
  if (v == null || v === '' || !isFinite(Number(v))) return '—'
  return Number(v).toLocaleString('pt-BR', { minimumFractionDigits: casas || 0, maximumFractionDigits: casas || 0 })
}
function _rhpdfVariacao(v) {
  if (v == null || !isFinite(Number(v))) return '—'
  const n = Number(v)
  return `${n > 0 ? '+' : ''}${_rhpdfNum(n, 0)}`
}

// `linhas`: retorno de rh_relatorio_diario. `dataTxt`: dia em DD/MM/AAAA.
// `estacoes` (opcional): vw_rh_estacoes_detalhe, para o anexo com o
// estado atual de cada estação.
async function rhRelMontarPdfDiario(linhas, dataTxt, cab, protocolo, estacoes) {
  await _agpdfCarregarLibs()
  const pdf = _agpdfNovoDocumento()
  const ctx = _agpdfCtx(pdf, cab, protocolo)
  ctx.linhaModulo = 'Recursos Hídricos'

  const logos = {
    gov: cab.logoGoverno ? await _agpdfBuscarDataURL(cab.logoGoverno) : null,
    secr: cab.logoSecr ? await _agpdfBuscarDataURL(cab.logoSecr) : null,
  }

  const dados = linhas || []
  const emCota = dados.filter(l => Number(l.estacoes_em_cota) > 0)
  const totalEstacoes = dados.reduce((s, l) => s + Number(l.n_estacoes || 0), 0)
  const chuvaTotal = dados.reduce((s, l) => s + Number(l.chuva_total_mm || 0), 0)

  ctx.y = 34
  pdf.setFont('DMSans', 'bold'); pdf.setFontSize(9); pdf.setTextColor(...AGPDF_COR.muted2)
  pdf.text('RELATÓRIO DIÁRIO — MONITORAMENTO HIDROMETEOROLÓGICO', AGPDF_M, ctx.y)
  ctx.y += 7
  pdf.setFontSize(15); pdf.setTextColor(...AGPDF_COR.texto)
  pdf.text(`Situação dos rios — ${dataTxt}`, AGPDF_M, ctx.y)
  ctx.y += 9

  _agpdfParagrafo(ctx,
    `${dados.length} rio(s) monitorado(s) · ${totalEstacoes} estação(ões) com leitura no dia · ` +
    `${_rhpdfNum(chuvaTotal, 1)} mm de chuva acumulada no conjunto.`, { muted: true })

  // A manchete: o que exige decisão hoje. Vem primeiro de propósito —
  // quem lê o relatório de cheia precisa disso na primeira olhada.
  if (emCota.length) {
    _agpdfTitulo(ctx, 'Rios com estação acima de cota')
    _agpdfTabela(ctx, {
      head: [['Rio', 'Estações em cota', 'Pior situação', 'Nível máx. (cm)', 'Variação (cm)', 'Chuva (mm)']],
      body: emCota.map(l => [
        l.rio, String(l.estacoes_em_cota), _rhpdfLabelCota(l.pior_situacao),
        _rhpdfNum(l.nivel_max_cm, 0), _rhpdfVariacao(l.variacao_cm), _rhpdfNum(l.chuva_total_mm, 1),
      ]),
      columnStyles: { 1: { halign: 'center' }, 3: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'right' } },
    })
  } else {
    _agpdfTitulo(ctx, 'Rios com estação acima de cota')
    _agpdfParagrafo(ctx, 'Nenhuma estação acima da cota de atenção neste dia.', { muted: true })
  }

  _agpdfTitulo(ctx, 'Resumo por rio')
  if (dados.length) {
    _agpdfTabela(ctx, {
      head: [['Rio', 'Bacia', 'Est.', 'Nível médio', 'Nível máx.', 'Variação', 'Chuva total', 'Chuva máx.']],
      body: dados.map(l => [
        l.rio, l.bacia || '—', String(l.n_estacoes),
        _rhpdfNum(l.nivel_medio_cm, 0), _rhpdfNum(l.nivel_max_cm, 0), _rhpdfVariacao(l.variacao_cm),
        _rhpdfNum(l.chuva_total_mm, 1), _rhpdfNum(l.chuva_max_mm, 1),
      ]),
      columnStyles: {
        2: { halign: 'center' }, 3: { halign: 'right' }, 4: { halign: 'right' },
        5: { halign: 'right' }, 6: { halign: 'right' }, 7: { halign: 'right' },
      },
    })
  } else {
    _agpdfParagrafo(ctx, 'Nenhuma leitura registrada neste dia.', { muted: true })
  }

  // Detalhe por estação — o que sustenta o número agregado acima.
  const detalhes = dados.flatMap(l => (l.detalhe || []).map(d => ({ rio: l.rio, ...d })))
  if (detalhes.length) {
    _agpdfTitulo(ctx, 'Detalhe por estação')
    _agpdfTabela(ctx, {
      head: [['Estação', 'Rio', 'Nível início', 'Nível fim', 'Variação', 'Amplitude', 'Chuva', 'Situação']],
      body: detalhes.map(d => [
        d.nome, d.rio,
        _rhpdfNum(d.nivel_ini_cm, 0), _rhpdfNum(d.nivel_fim_cm, 0), _rhpdfVariacao(d.variacao_cm),
        _rhpdfNum(d.amplitude_cm, 0), _rhpdfNum(d.chuva_mm, 1), _rhpdfLabelCota(d.situacao),
      ]),
      columnStyles: {
        2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' },
        5: { halign: 'right' }, 6: { halign: 'right' },
      },
    })
  }

  // Anexo: inventário com o estado atual — inclusive as estações SEM
  // leitura no dia, que somem das tabelas acima. Silêncio de estação é
  // informação (pode ser telemetria caída), nunca se esconde.
  const inv = estacoes || []
  if (inv.length) {
    _agpdfTitulo(ctx, 'Estações cadastradas — estado atual')
    _agpdfTabela(ctx, {
      head: [['Estação', 'Código ANA', 'Rio', 'Município', 'Última leitura', 'Nível', 'Var. 24h', 'Situação']],
      body: inv.map(e => [
        e.nome, e.codigo_ana || '—', e.rio || '—', e.municipio || '—',
        e.ultima_leitura ? new Date(e.ultima_leitura).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : 'sem leitura',
        _rhpdfNum(e.nivel_atual_cm, 0), _rhpdfVariacao(e.variacao_24h_cm), _rhpdfLabelCota(e.situacao_cota),
      ]),
      columnStyles: { 5: { halign: 'right' }, 6: { halign: 'right' } },
    })
  }

  _agpdfParagrafo(ctx,
    'Níveis e chuvas conforme as leituras recebidas das estações no período. Cotas de atenção, alerta e ' +
    'inundação são valores cadastrados por estação — a classificação é feita pelo banco, comparando a ' +
    'leitura com essas cotas. Estação sem cota cadastrada aparece como "Sem cota cadastrada", que não ' +
    'significa nível normal.', { muted: true })

  _agpdfAplicarCabecalhoRodapeGlobal(ctx, logos)
  return pdf
}
