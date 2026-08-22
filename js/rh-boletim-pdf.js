// ── SIGUC · Recursos Hídricos — Boletim do Tempo / Relatório
// Hidrometeorológico em PDF, no layout do documento real da SEMA/CIGMA
// (previsão regional, aviso, nível dos rios, chuva acumulada, mapas,
// focos de calor, risco de fogo, qualidade do ar, prognóstico).
//
// REAPROVEITA os primitivos de js/agua-relatorio-pdf.js (mesmos que
// js/rh-relatorio-pdf.js já usa) e os BLOCOS de js/rh-relatorio-pdf.js
// (_rhpdfBloco*) para a seção "Nível dos Rios" — nunca uma segunda
// tabela para o mesmo dado. A página precisa carregar, nesta ordem:
// agua-relatorio-pdf.js, rh-relatorio-pdf.js, js/rh-boletim.js (as
// agregações puras), este arquivo.
//
// Cada bloco é OU automático (recalculado na hora, nunca lido de uma
// coluna congelada) OU o que foi digitado/anexado na composição — ver
// cabeçalho de js/rh-boletim.js e da migration 312.

function _rhbolNum(v, casas) {
  if (v == null || v === '') return '—'
  return String(v)
}

async function _rhbolImagem(ctx, url, legenda) {
  if (!url) return
  const dataUrl = await _agpdfBuscarDataURL(url)
  if (!dataUrl) {
    _agpdfParagrafo(ctx, '(imagem não pôde ser carregada para o PDF)', { muted: true })
    return
  }
  const { pdf } = ctx
  const props = pdf.getImageProperties(dataUrl)
  const razao = props.width / props.height
  const maxW = ctx.W - AGPDF_M * 2, maxH = 100
  let w = maxW, h = w / razao
  if (h > maxH) { h = maxH; w = h * razao }
  _agpdfGarantirEspaco(ctx, h + 8)
  const x = AGPDF_M + (maxW - w) / 2
  pdf.addImage(dataUrl, /\.png/i.test(url) ? 'PNG' : 'JPEG', x, ctx.y, w, h)
  ctx.y += h + 3
  if (legenda) _agpdfParagrafo(ctx, legenda, { muted: true })
}

// `b`: linha de rh_boletins. `diario`: retorno de rh_relatorio_diario
// para b.data_referencia. `estacoes`: vw_rh_estacoes_detalhe.
// `focosResumo`: { total, semMunicipio, ranking } de rhBoletimFocosRanking,
// já calculado para os dois períodos (mensal/anual) pela página.
// `chuvaAcumulada`: retorno de rhBoletimChuvaAcumulada (mês corrente).
async function rhBoletimMontarPdf(b, ctxDados, cab, protocolo) {
  await _agpdfCarregarLibs()
  const pdf = _agpdfNovoDocumento()
  const ctx = _agpdfCtx(pdf, cab, protocolo)
  ctx.linhaModulo = RH_BOLETIM_TIPO_LABEL[b.tipo] || 'Recursos Hídricos'

  const logos = {
    gov: cab.logoGoverno ? await _agpdfBuscarDataURL(cab.logoGoverno) : null,
    secr: cab.logoSecr ? await _agpdfBuscarDataURL(cab.logoSecr) : null,
  }

  const dataTxt = rhBoletimDataTxt(b)
  const numeroTxt = rhBoletimNumeroTxt(b)

  ctx.y = 34
  pdf.setFont('DMSans', 'bold'); pdf.setFontSize(9); pdf.setTextColor(...AGPDF_COR.muted2)
  pdf.text((RH_BOLETIM_TIPO_LABEL[b.tipo] || '').toUpperCase(), AGPDF_M, ctx.y)
  ctx.y += 7
  pdf.setFontSize(15); pdf.setTextColor(...AGPDF_COR.texto)
  pdf.text(`${dataTxt} — ${numeroTxt}`, AGPDF_M, ctx.y)
  ctx.y += 9

  // ── Previsão regional ──────────────────────────────────────────
  const previsao = rhBoletimPrevisaoNormalizar(b.previsao_regional)
  if (previsao.some(l => l.condicao || l.temp_max || l.temp_min)) {
    _agpdfTitulo(ctx, 'Previsão regional')
    _agpdfTabela(ctx, {
      head: [['Cidade', 'Temp. máx/mín (°C)', 'UR máx/mín (%)', 'Vento', 'Condição do tempo']],
      body: previsao.map(l => [
        l.cidade, `${_rhbolNum(l.temp_max)}/${_rhbolNum(l.temp_min)}`,
        `${_rhbolNum(l.ur_max)}/${_rhbolNum(l.ur_min)}`, l.vento_dir || '—', l.condicao || '—',
      ]),
    })
    _agpdfParagrafo(ctx, 'Fonte: CENSIPAM.', { muted: true })
  }

  // ── Aviso meteorológico ─────────────────────────────────────────
  if (b.aviso_meteorologico) {
    _agpdfTitulo(ctx, 'Aviso meteorológico')
    _agpdfParagrafo(ctx, b.aviso_meteorologico)
    _agpdfParagrafo(ctx, 'Fonte: INMET.', { muted: true })
  }

  // ── Nível dos rios (automático — rh_relatorio_diario) ───────────
  const diario = ctxDados.diario || []
  if (diario.length) {
    _rhpdfBlocoEmCota(ctx, diario)
    _rhpdfBlocoResumoPorRio(ctx, diario)
  } else {
    _agpdfTitulo(ctx, 'Nível dos rios')
    _agpdfParagrafo(ctx, 'Sem leituras registradas nas plataformas de coleta para esta data.', { muted: true })
  }

  // ── Prognóstico de chuva da semana + mapa ────────────────────────
  if (b.prognostico_chuva_texto || b.mapa_chuva_url) {
    _agpdfTitulo(ctx, 'Prognóstico de chuva e anomalia')
    if (b.prognostico_chuva_texto) _agpdfParagrafo(ctx, b.prognostico_chuva_texto)
    await _rhbolImagem(ctx, b.mapa_chuva_url, 'Fonte: NCEP/GFS (USA).')
  }

  // ── Chuva acumulada por estação (automático) ─────────────────────
  const chuva = ctxDados.chuvaAcumulada || []
  if (chuva.length) {
    _agpdfTitulo(ctx, 'Chuva acumulada no mês — por estação')
    _agpdfTabela(ctx, {
      head: [['Estação', 'Acumulado no mês (mm)']],
      body: chuva.map(c => [c.estacao, _rhpdfNum(c.total_mm, 1)]),
      columnStyles: { 1: { halign: 'right' } },
    })
  }

  // ── Focos de calor (automático — focos_calor + PIP por município) ─
  const focosMensal = ctxDados.focosMensal
  const focosAnual = ctxDados.focosAnual
  if (focosMensal || focosAnual) {
    _agpdfTitulo(ctx, 'Focos de calor')
    if (focosAnual) {
      _agpdfParagrafo(ctx, focosAnual.texto, { bold: false })
      if (focosAnual.resumo.ranking.length) {
        _agpdfTabela(ctx, {
          head: [['Município', 'Focos no ano']],
          body: focosAnual.resumo.ranking.map(r => [r.municipio, String(r.total)]),
          columnStyles: { 1: { halign: 'right' } },
        })
      }
    }
    if (focosMensal) {
      _agpdfParagrafo(ctx, focosMensal.texto)
      if (focosMensal.resumo.ranking.length) {
        _agpdfTabela(ctx, {
          head: [['Município', 'Focos no mês']],
          body: focosMensal.resumo.ranking.map(r => [r.municipio, String(r.total)]),
          columnStyles: { 1: { halign: 'right' } },
        })
      }
    }
    _agpdfParagrafo(ctx, 'Fonte: INPE/BDQueimadas (satélite de referência AQUA Tarde).', { muted: true })
  }

  // ── Risco de fogo — estado e UCs ─────────────────────────────────
  if (b.mapa_risco_fogo_url || b.texto_risco_fogo) {
    _agpdfTitulo(ctx, 'Risco de fogo — estado')
    if (b.texto_risco_fogo) _agpdfParagrafo(ctx, b.texto_risco_fogo)
    await _rhbolImagem(ctx, b.mapa_risco_fogo_url, 'Fonte: INPE/BDQueimadas.')
  }
  if (b.mapa_risco_fogo_ucs_url || b.texto_risco_fogo_ucs) {
    _agpdfTitulo(ctx, 'Risco de fogo — Unidades de Conservação')
    if (b.texto_risco_fogo_ucs) _agpdfParagrafo(ctx, b.texto_risco_fogo_ucs)
    await _rhbolImagem(ctx, b.mapa_risco_fogo_ucs_url, 'Fonte: INPE/BDQueimadas.')
  }

  // ── Qualidade do ar ───────────────────────────────────────────────
  if (b.qualidade_ar_purpleair_url || b.qualidade_ar_purpleair_texto) {
    _agpdfTitulo(ctx, 'Qualidade do ar — Rede PurpleAir')
    if (b.qualidade_ar_purpleair_texto) _agpdfParagrafo(ctx, b.qualidade_ar_purpleair_texto)
    await _rhbolImagem(ctx, b.qualidade_ar_purpleair_url, 'Fonte: PurpleAir/MPAC. Referência: Resolução CONAMA nº 506/2024.')
  }
  if (b.qualidade_ar_sisam_url || b.qualidade_ar_sisam_texto) {
    _agpdfTitulo(ctx, 'Qualidade do ar — SISAM/INPE')
    if (b.qualidade_ar_sisam_texto) _agpdfParagrafo(ctx, b.qualidade_ar_sisam_texto)
    await _rhbolImagem(ctx, b.qualidade_ar_sisam_url, 'Fonte: SISAM/INPE. Referência: Resolução CONAMA nº 506/2024.')
  }

  // ── Prognóstico climático sazonal (só Relatório Hidrometeorológico) ─
  if (b.tipo === 'relatorio_hidrometeorologico' && b.prognostico_sazonal_texto) {
    _agpdfTitulo(ctx, 'Prognóstico climático sazonal')
    _agpdfParagrafo(ctx, b.prognostico_sazonal_texto)
    _agpdfParagrafo(ctx, 'Fonte: CPTEC/INPE, INMET, FUNCEME e CENSIPAM.', { muted: true })
  }

  if (b.observacoes) {
    _agpdfTitulo(ctx, 'Observações')
    _agpdfParagrafo(ctx, b.observacoes)
  }

  _agpdfAplicarCabecalhoRodapeGlobal(ctx, logos)
  return pdf
}
