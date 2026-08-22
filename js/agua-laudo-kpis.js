// ── SIGUC-AC · Qualidade da Água — KPIs de fila de laudo e quarentena ──
// Cálculo em UM lugar só: mesma lição de js/frota-consumo.js e
// js/mapa-recorte.js — nenhuma tela reimplementa "dias desde a coleta"
// ou monta o card na mão. Usado por pages/agua-laudos.html (fila
// status='aguardando_lab') e pages/agua-conferencia.html
// (status='quarentena'). Visual segue o padrão já existente do módulo
// (.adash-card / .adash-num / .adash-delta, css/agua-painel.css — o
// mesmo card do painel de Relatórios/Público), não o .kpi-card
// genérico usado em outros módulos do sistema.
//
// Funções puras: recebem a lista já carregada pela página (formatos
// diferentes em cada uma — vw_agua_coletas_detalhe numa,
// agua_coletas.* com joins na outra) + um labelFn que decide como
// identificar um item na legenda, e devolvem uma STRING html. Quem
// chama decide onde encaixar no DOM.
//
// FONTE DOS NÚMEROS: nunca Fraunces aqui — pedido explícito do
// usuário (achou o serifado "cara de IA"), registrado em CLAUDE.md
// ("Regra do sistema — fonte dos números de KPI"). Todo `.adash-num`
// deste arquivo carrega `AGUA_KPI_FONTE_NUM` inline; o arco de status
// recebe `fonteCentro` no mesmo valor. O resto do módulo (IQA médio,
// cards de js/agua-painel.js) segue Fraunces normalmente — a regra é
// só para números de KPI, não uma revisão do design system inteiro.
const AGUA_KPI_FONTE_NUM = "font-family:var(--font-sans)"

// Redesenho pedido pelo usuário a partir de uma referência visual
// (dashboard "Ultraleads"): arco colorido no lugar da rosca fechada
// (_aguaArcoCategoriasHTML, js/agua-iqa-visual.js), card escuro de
// destaque para o número mais importante (.adash-card-escuro, já
// existia em css/agua-painel.css — reaproveitado, não criado aqui),
// pílula Média/Mediana no card de tempo, e barras com o total de cada
// faixa de dias rotulado acima (aguaIqaBarrasHTML, já existente).
// Nenhum desses três primitivos é redesenhado do zero — a mudança é
// escolher QUAL primitivo já existente no módulo usar em cada card.

function aguaDiasDesdeColeta(dataColeta) {
  const ms = Date.now() - new Date(dataColeta + 'T00:00:00').getTime()
  return Math.max(0, Math.floor(ms / 86400000))
}

function _aguaMediana(nums) {
  if (!nums.length) return 0
  const s = [...nums].sort((a, b) => a - b)
  const meio = Math.floor(s.length / 2)
  return s.length % 2 ? s[meio] : Math.round((s[meio - 1] + s[meio]) / 2)
}

// Faixas de dias de espera/quarentena — mesma leitura em ambas as
// telas (0–7/8–15/16–30/30+), a última faixa é a que hoje "Atrasadas
// (30+ dias)" cobria isoladamente; a distribuição fica mais informativa
// que um único número porque mostra ONDE a fila está concentrada.
const AGUA_KPI_FAIXAS_DIAS = [[0, 7, '0–7'], [8, 15, '8–15'], [16, 30, '16–30'], [31, Infinity, '30+']]

function _aguaKpiStats(lista) {
  const dias = lista.map(c => aguaDiasDesdeColeta(c.data_coleta))
  const total = lista.length
  const media = total ? Math.round(dias.reduce((a, b) => a + b, 0) / total) : 0
  const mediana = _aguaMediana(dias)
  let piorIdx = -1
  dias.forEach((d, i) => { if (piorIdx === -1 || d > dias[piorIdx]) piorIdx = i })
  const faixas = AGUA_KPI_FAIXAS_DIAS.map(([min, max, label]) => ({
    label, n: dias.filter(d => d >= min && d <= max).length,
  }))
  return {
    total, media, mediana, dias, faixas,
    itemMaisAntigo: piorIdx >= 0 ? lista[piorIdx] : null,
    diasMaisAntigo: piorIdx >= 0 ? dias[piorIdx] : null,
  }
}

// ── Situação da série (arco de status) ──────────────────────────
// Compartilhada pelas duas telas: quantas coletas estão em cada
// status hoje (status_coleta_agua, migration 248) — a leitura mais
// direta de "como vai a fila de laudos" no todo, não só o recorte que
// cada página lista. Cores por SITUAÇÃO (pendência/ok/alerta), nunca
// as cores de faixa do IQA — categorias diferentes, paleta diferente,
// senão o leitor confundiria "aguardando laudo" com "faixa Regular".
const AGUA_STATUS_ORDEM = ['aguardando_lab', 'completo', 'quarentena']
const AGUA_STATUS_LABEL = { aguardando_lab: 'Aguardando laudo', completo: 'Completo', quarentena: 'Em quarentena' }
const AGUA_STATUS_COR = { aguardando_lab: '#D97706', completo: '#059669', quarentena: '#DC2626' }

function aguaContarPorStatus(linhas) {
  const c = { aguardando_lab: 0, completo: 0, quarentena: 0 }
  ;(linhas || []).forEach(l => { if (c[l.status] != null) c[l.status]++ })
  return c
}

function aguaKpisSituacaoRoscaHTML(counts) {
  const itens = AGUA_STATUS_ORDEM
    .map(s => ({ label: AGUA_STATUS_LABEL[s], n: (counts || {})[s] || 0, cor: AGUA_STATUS_COR[s] }))
    .filter(i => i.n > 0)
  return `<div class="adash-card">
    <div class="adash-card-topo">
      <div><p class="adash-card-tit">Situação da série</p>
        <p class="adash-card-tit-sub">Todas as coletas cadastradas, por status</p></div>
    </div>
    ${_aguaArcoCategoriasHTML(itens, { vazioMsg: 'Nenhuma coleta cadastrada.', ariaLabelPrefix: 'Situação da série de coletas' })}
  </div>`
}

// ── Pílula Média/Mediana ─────────────────────────────────────────
// Guarda o último render de cada KPI row (dados + como redesenhar) só
// para poder trocar o card de tempo sem refazer a consulta ao banco —
// a pílula é preferência de EXIBIÇÃO, não filtro de dado.
let _aguaKpiUltimoRender = null
let _aguaKpiEstatistica = 'media'

function aguaKpisAlternarEstatistica(tipo) {
  if (tipo === _aguaKpiEstatistica || !_aguaKpiUltimoRender) return
  _aguaKpiEstatistica = tipo
  const { containerId, render } = _aguaKpiUltimoRender
  const el = document.getElementById(containerId)
  if (el) el.innerHTML = render()
}

function _aguaKpiPilulasEstatisticaHTML() {
  const opcoes = [['media', 'Média'], ['mediana', 'Mediana']]
  return `<div class="adash-chips" style="margin-bottom:10px">
    ${opcoes.map(([v, rotulo]) => `<button type="button" class="adash-chip ${_aguaKpiEstatistica === v ? 'ativo' : ''}" onclick="aguaKpisAlternarEstatistica('${v}')">${rotulo}</button>`).join('')}
  </div>`
}

// Card escuro de destaque (.adash-card-escuro, já existe em
// css/agua-painel.css — usado pelo "IQA médio do período" do painel de
// Relatórios) para o número mais importante da tela.
function _aguaKpiCardEscuroHTML(titulo, valor, legenda) {
  return `<div class="adash-card adash-card-escuro">
    <div class="adash-card-topo"><p class="adash-card-tit" style="color:#fff">${titulo}</p></div>
    <div class="adash-num-linha"><span class="adash-num" style="${AGUA_KPI_FONTE_NUM}">${valor}</span></div>
    <p class="adash-card-pe">${legenda}</p>
  </div>`
}

// Fila de laudos (pages/agua-laudos.html).
function aguaKpisFilaHTML(lista, labelFn, statusCounts, containerId) {
  const render = () => aguaKpisFilaHTML(lista, labelFn, statusCounts, containerId)
  if (containerId) _aguaKpiUltimoRender = { containerId, render }

  const s = _aguaKpiStats(lista)
  const valorTempo = _aguaKpiEstatistica === 'mediana' ? s.mediana : s.media
  const maisAntiga = s.itemMaisAntigo
    ? `Mais antiga: ${s.diasMaisAntigo} dia${s.diasMaisAntigo === 1 ? '' : 's'} — ${esc(labelFn(s.itemMaisAntigo))}`
    : 'Nenhuma coleta aguardando'

  return `<div class="adash-kpi-row">
    ${_aguaKpiCardEscuroHTML('Aguardando laudo', s.total, 'coleta(s) com campo preenchido, sem resultado de laboratório')}
    ${aguaKpisSituacaoRoscaHTML(statusCounts)}
    <div class="adash-card">
      <div class="adash-card-topo"><p class="adash-card-tit">Tempo de espera</p></div>
      ${_aguaKpiPilulasEstatisticaHTML()}
      <div class="adash-num-linha"><span class="adash-num" style="${AGUA_KPI_FONTE_NUM}">${s.total ? valorTempo : '—'}</span>${s.total ? '<span class="adash-delta neutro">dias</span>' : ''}</div>
      <p class="adash-card-pe">da data da coleta até hoje, ${_aguaKpiEstatistica === 'mediana' ? 'mediana' : 'média'} da fila atual</p>
    </div>
    <div class="adash-card adash-span2">
      <div class="adash-card-topo">
        <div><p class="adash-card-tit">Distribuição por tempo de espera</p>
          <p class="adash-card-tit-sub">Quantas coletas em cada faixa de dias</p></div>
      </div>
      ${aguaIqaBarrasHTML(s.faixas.map(f => ({ label: f.label, valor: f.n, valorTexto: String(f.n), titulo: `${f.n} coleta(s) entre ${f.label} dias esperando` })),
        { max: Math.max(1, ...s.faixas.map(f => f.n)), height: 170, corBase: '#FDE68A', corTopo: '#B91C1C' })}
      <p class="adash-card-pe">${maisAntiga}</p>
    </div>
  </div>`
}

// Quarentena (pages/agua-conferencia.html) — o que preocupa é volume e
// tempo parado, não um limiar de atraso (a régua daqui não é urgência
// de laboratório, é backlog de conferência humana).
function aguaKpisQuarentenaHTML(lista, totalColetas, labelFn, statusCounts, containerId) {
  const render = () => aguaKpisQuarentenaHTML(lista, totalColetas, labelFn, statusCounts, containerId)
  if (containerId) _aguaKpiUltimoRender = { containerId, render }

  const s = _aguaKpiStats(lista)
  const pct = totalColetas ? (s.total / totalColetas) * 100 : null
  const valorTempo = _aguaKpiEstatistica === 'mediana' ? s.mediana : s.media
  const maisAntiga = s.itemMaisAntigo
    ? `Mais antiga: ${s.diasMaisAntigo} dia${s.diasMaisAntigo === 1 ? '' : 's'} — ${esc(labelFn(s.itemMaisAntigo))}`
    : 'Nenhuma coleta em quarentena'

  return `<div class="adash-kpi-row">
    ${_aguaKpiCardEscuroHTML('Em quarentena', s.total, pct != null ? `${s.total} de ${totalColetas} coleta(s) cadastradas · ${pct.toFixed(1)}% da série` : 'pendente de conferência humana com o laudo físico')}
    ${aguaKpisSituacaoRoscaHTML(statusCounts)}
    <div class="adash-card">
      <div class="adash-card-topo"><p class="adash-card-tit">Tempo em quarentena</p></div>
      ${_aguaKpiPilulasEstatisticaHTML()}
      <div class="adash-num-linha"><span class="adash-num" style="${AGUA_KPI_FONTE_NUM}">${s.total ? valorTempo : '—'}</span>${s.total ? '<span class="adash-delta neutro">dias</span>' : ''}</div>
      <p class="adash-card-pe">desde a data da coleta, ${_aguaKpiEstatistica === 'mediana' ? 'mediana' : 'média'} das pendentes</p>
    </div>
    <div class="adash-card adash-span2">
      <div class="adash-card-topo">
        <div><p class="adash-card-tit">Distribuição por tempo em quarentena</p>
          <p class="adash-card-tit-sub">Quantas coletas em cada faixa de dias</p></div>
      </div>
      ${aguaIqaBarrasHTML(s.faixas.map(f => ({ label: f.label, valor: f.n, valorTexto: String(f.n), titulo: `${f.n} coleta(s) entre ${f.label} dias em quarentena` })),
        { max: Math.max(1, ...s.faixas.map(f => f.n)), height: 170, corBase: '#FDE68A', corTopo: '#B91C1C' })}
      <p class="adash-card-pe">${maisAntiga}</p>
    </div>
  </div>`
}
