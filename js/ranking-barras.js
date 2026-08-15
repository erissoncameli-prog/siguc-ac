// ── Ranking em barras horizontais — molde único, reutilizado por
// relatórios/dashboards que rankeiam entidades por UMA métrica (nome à
// esquerda, barra proporcional ao maior valor, número à direita).
// Tabelas com várias colunas (financeiro, breakdown por natureza etc.)
// NÃO usam este componente — viram mini-barra dentro da própria coluna,
// direto na página, para não perder as demais colunas.

// Mesmo degradê já usado nos gráficos de fauna de relatorios-brigadas.html
// (initFaunaBrigada) — reaproveitado aqui em vez de inventar uma cor nova.
function rankBarraCorVerde(t) {
  const r = Math.round(10 + t * (82 - 10))
  const g = Math.round(26 + t * (166 - 26))
  const b = Math.round(15 + t * (106 - 15))
  return `rgb(${r},${g},${b})`
}

function rankBarrasHTML(itens, opts) {
  opts = opts || {}
  const cor = opts.cor || rankBarraCorVerde
  if (!itens || !itens.length) return `<p class="chart-empty" style="padding:12px">${opts.vazio || 'Sem dados'}</p>`
  const max = Math.max(...itens.map(i => Number(i.valor) || 0), 1)
  return itens.map(i => {
    const t = (Number(i.valor) || 0) / max
    return `<div class="rank-barra-row">
      <div class="rank-barra-label" title="${esc(i.label)}">
        ${esc(i.label)}
        ${i.sub ? `<div class="rank-barra-sub">${esc(i.sub)}</div>` : ''}
      </div>
      <div class="rank-barra-track"><div class="rank-barra-fill" style="width:${Math.round(t * 100)}%;background:${cor(t)}"></div></div>
      <div class="rank-barra-valor">${i.valorFmt != null ? i.valorFmt : i.valor}</div>
    </div>`
  }).join('')
}
