// ── Linha do tempo do Mapa das UCs · dados por ano ───────────────
// Fonte única do que a linha do tempo (pages/mapa.html, modo "Anos")
// mostra para cada ano: de onde vêm os focos, os totais do painel e o
// aviso quando o dado é parcial ou ainda não existe.
//
// Antes os totais eram constantes no código (TL_FOCOS_ANO /
// TL_PRODES_ANO), paradas em 2024 — e o slider, que vai até o ano
// corrente, mostrava 2025/2026 vazios sem explicar por quê. Os totais
// agora vêm do banco (migration 340): focos_resumo_ano (lido de
// vw_focos_linha_tempo, a definição única de "foco da linha do tempo")
// e prodes_resumo_ano (WFS do INPE, atualizado por pg_cron).
//
// Funções puras (sem Leaflet, sem Supabase) — testadas em
// tests/mapa-linha-tempo.test.js.

const TL_ORIGEM_ROTULO = {
  serie_historica: 'série histórica (MODIS + VIIRS S-NPP)',
  firms_diario:    'registro diário FIRMS (MODIS + VIIRS S-NPP)',
}

function _tlFmtDataCurta(iso) {
  if (!iso) return ''
  const [a, m, d] = String(iso).slice(0, 10).split('-')
  return `${d}/${m}/${a}`
}

// Linhas do banco → { ano: linha }. Aceita null/erro (fail-open: sem
// resumo, a tela só mostra "—", nunca quebra).
function tlIndexarPorAno(linhas) {
  const idx = {}
  ;(linhas || []).forEach(l => { if (l && l.ano != null) idx[Number(l.ano)] = l })
  return idx
}

// Descreve um ano para o painel e a linha de status.
//   focos  = linha de focos_resumo_ano (ou undefined)
//   prodes = linha de prodes_resumo_ano (ou undefined)
// Devolve { focosN, desmatN, areaHa, avisos[] } — null = sem dado.
function tlDescreverAno(ano, focos, prodes, hoje) {
  const agora = hoje instanceof Date ? hoje : new Date()
  const anoAtual = agora.getFullYear()
  const avisos = []

  let focosN = null
  if (focos) {
    focosN = Number(focos.focos)
    const origem = TL_ORIGEM_ROTULO[focos.origem] || focos.origem
    const periodo = `${_tlFmtDataCurta(focos.periodo_ini)} a ${_tlFmtDataCurta(focos.periodo_fim)}`
    avisos.push(ano >= anoAtual
      ? `Focos parciais de ${ano} (${periodo}, ${origem})`
      : `Focos de ${periodo} (${origem})`)
  } else {
    avisos.push(`Sem registro de focos para ${ano} no sistema`)
  }

  let desmatN = null, areaHa = null
  if (prodes) {
    desmatN = Number(prodes.poligonos)
    areaHa = Math.round(Number(prodes.area_ha))
  } else if (ano < 2008) {
    avisos.push('PRODES anual disponível a partir de 2008')
  } else {
    avisos.push(`PRODES ${ano} ainda não publicado pelo INPE (o dado anual costuma sair no fim do ano)`)
  }

  return { focosN, desmatN, areaHa, avisos }
}

if (typeof window !== 'undefined') {
  window.tlIndexarPorAno = tlIndexarPorAno
  window.tlDescreverAno = tlDescreverAno
}
