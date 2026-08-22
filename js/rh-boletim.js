// ── SIGUC · Recursos Hídricos — Boletim do Tempo / Relatório
// Hidrometeorológico: rótulos, agregações puras e montagem do que é
// AUTOMÁTICO no documento. Mesma lição de js/frota-consumo.js e
// js/rh-hidro.js: cálculo em UM lugar, nunca reimplementado na página
// nem duplicado entre tela e gerador de PDF (js/rh-boletim-pdf.js usa
// as MESMAS funções daqui).
//
// O que é automático (não fica gravado no boletim, é recalculado
// sempre que a edição é aberta ou o PDF é gerado):
//   • nível dos rios / PCD por bacia   → rh_relatorio_diario (RPC já existente)
//   • chuva acumulada por estação      → rh_medicoes (rhBoletimChuvaAcumulada)
//   • focos de calor por município     → focos_calor + PIP client-side
//     (rhBoletimFocosClassificar/rhBoletimFocosResumo) — achado ao
//     construir isto: focos_calor.municipio nunca é preenchido na
//     ingestão (0 de 291 linhas em produção), então a classificação
//     por município SEMPRE foi manual em quem montava o boletim
//     original; aqui é PIP contra data/municipios_acre.geojson
//     (js/mapa-recorte.js, geoMunicipioEm — mesmo helper do Mapa das
//     UCs, nunca uma segunda implementação).
// O resto (previsão regional, aviso, mapas, qualidade do ar,
// prognóstico sazonal) é o que a coluna de rh_boletins guarda —
// composto por quem monta a edição.

const RH_BOLETIM_TIPO_LABEL = {
  boletim_tempo: 'Boletim do Tempo',
  relatorio_hidrometeorologico: 'Relatório Hidrometeorológico',
}

// As 6 cidades da Tabela 1 (Previsões regionais) nos dois documentos
// reais fornecidos pela SEMA — uma por regional do estado.
const RH_BOLETIM_CIDADES = [
  'Rio Branco', 'Brasiléia', 'Sena Madureira', 'Tarauacá', 'Cruzeiro do Sul', 'Marechal Thaumaturgo',
]

function rhBoletimNumeroTxt(b) {
  if (!b) return ''
  return b.numero != null ? `Nº${b.numero}` : 'rascunho (sem número)'
}

function rhBoletimDataTxt(b) {
  if (!b?.data_referencia) return ''
  return String(b.data_referencia).split('-').reverse().join('/')
}

// Linha vazia de previsão regional, para uma cidade — molde do que
// `previsao_regional` (jsonb) guarda.
function rhBoletimPrevisaoLinhaVazia(cidade) {
  return { cidade, temp_max: '', temp_min: '', ur_max: '', ur_min: '', vento_dir: '', condicao: '' }
}

// Garante as 6 cidades na ordem certa, preenchendo com o que já existe
// no array salvo (por nome de cidade) e completando o resto vazio —
// nunca perde uma linha que o usuário já preencheu, mesmo que a ordem
// salva tenha sido outra.
function rhBoletimPrevisaoNormalizar(previsaoSalva) {
  const porCidade = {}
  ;(previsaoSalva || []).forEach(l => { if (l?.cidade) porCidade[l.cidade] = l })
  return RH_BOLETIM_CIDADES.map(c => porCidade[c] || rhBoletimPrevisaoLinhaVazia(c))
}

// ── Focos de calor por município (Fase 1) ───────────────────────
// `focos`: linhas de focos_calor (precisa lat/lon). Carimba _municipio
// em cada item (mesmo padrão de geoClassificar) e devolve o ranking.
// Exige geoMunicipiosPreparar() já chamado pela página.
function rhBoletimFocosClassificar(focos) {
  return (focos || []).map(f => {
    const lat = Number(f.lat), lon = Number(f.lon)
    f._municipio = (isFinite(lat) && isFinite(lon) && typeof geoMunicipioEm === 'function')
      ? geoMunicipioEm(lat, lon) : null
    return f
  })
}

// Ranking por município, decrescente. `limite` corta a lista (o
// relatório real só cita os 3 primeiros no texto, mas a tabela do PDF
// pode mostrar mais).
function rhBoletimFocosRanking(focosClassificados, limite) {
  const porMunicipio = {}
  let semMunicipio = 0
  ;(focosClassificados || []).forEach(f => {
    if (!f._municipio) { semMunicipio++; return }
    porMunicipio[f._municipio] = (porMunicipio[f._municipio] || 0) + 1
  })
  const ranking = Object.entries(porMunicipio)
    .map(([municipio, total]) => ({ municipio, total }))
    .sort((a, b) => b.total - a.total || a.municipio.localeCompare(b.municipio, 'pt-BR'))
  return {
    total: (focosClassificados || []).length,
    semMunicipio,
    ranking: limite ? ranking.slice(0, limite) : ranking,
  }
}

// Texto no MESMO molde do relatório real: "houve registro total de N
// focos... O município de X lidera o ranking com total de Y focos,
// seguido do município de Z com W focos e A com B focos."
function rhBoletimFocosTexto(resumo, periodoTxt) {
  if (!resumo || !resumo.total) {
    return `Nenhum foco de calor registrado no período (${periodoTxt}).`
  }
  const top = resumo.ranking.slice(0, 3)
  let liderancaTxt = ''
  if (top.length) {
    liderancaTxt = ` O município de ${top[0].municipio} lidera o ranking com total de ${top[0].total} foco(s)`
    if (top.length > 1) {
      const seguintes = top.slice(1).map(r => `${r.municipio} com ${r.total} foco(s)`)
      liderancaTxt += `, seguido do município de ${seguintes.join(' e ')}`
    }
    liderancaTxt += '.'
  }
  return `Houve registro total de ${resumo.total} foco(s) de calor no período (${periodoTxt})` +
    (resumo.semMunicipio ? `, sendo ${resumo.semMunicipio} sem município identificado` : '') +
    '.' + liderancaTxt
}

// ── Chuva acumulada por estação (bloco "Gráfico 2/3" do original) ──
// `medicoes`: linhas de rh_medicoes (estacao_id, chuva_mm, data_hora)
// já filtradas pelo período desejado (a página faz o .gte/.lte).
// `estacoesPorId`: Map/objeto id → { nome }.
function rhBoletimChuvaAcumulada(medicoes, estacoesPorNome_ou_Id) {
  const porEstacao = {}
  ;(medicoes || []).forEach(m => {
    if (m.chuva_mm == null) return
    const nome = estacoesPorNome_ou_Id?.[m.estacao_id]?.nome || m.estacao_id
    porEstacao[nome] = (porEstacao[nome] || 0) + Number(m.chuva_mm)
  })
  return Object.entries(porEstacao)
    .map(([estacao, total_mm]) => ({ estacao, total_mm: Math.round(total_mm * 10) / 10 }))
    .sort((a, b) => b.total_mm - a.total_mm)
}
