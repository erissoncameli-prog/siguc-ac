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
// A rosca de "Situação da série" usa o primitivo genérico
// _aguaRoscaHTML de js/agua-iqa-visual.js (nunca uma segunda cópia do
// desenho) — por isso as duas páginas precisam carregar aquele arquivo
// também, mesmo sem usar IQA nenhum aqui.

function aguaDiasDesdeColeta(dataColeta) {
  const ms = Date.now() - new Date(dataColeta + 'T00:00:00').getTime()
  return Math.max(0, Math.floor(ms / 86400000))
}

function _aguaKpiStats(lista) {
  const dias = lista.map(c => aguaDiasDesdeColeta(c.data_coleta))
  const total = lista.length
  const media = total ? Math.round(dias.reduce((a, b) => a + b, 0) / total) : 0
  let piorIdx = -1
  dias.forEach((d, i) => { if (piorIdx === -1 || d > dias[piorIdx]) piorIdx = i })
  return {
    total, media, dias,
    itemMaisAntigo: piorIdx >= 0 ? lista[piorIdx] : null,
    diasMaisAntigo: piorIdx >= 0 ? dias[piorIdx] : null,
  }
}

// ── Situação da série (rosca de status) ─────────────────────────
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
    ${_aguaRoscaHTML(itens, { vazioMsg: 'Nenhuma coleta cadastrada.', ariaLabelPrefix: 'Situação da série de coletas' })}
  </div>`
}

// Fila de laudos (pages/agua-laudos.html) — o que preocupa é atraso.
const AGUA_LAUDO_LIMIAR_ATRASO = 30

function aguaKpisFilaHTML(lista, labelFn, statusCounts) {
  const s = _aguaKpiStats(lista)
  const atrasadas = s.dias.filter(d => d > AGUA_LAUDO_LIMIAR_ATRASO).length
  const pctAtrasadas = s.total ? Math.round((atrasadas / s.total) * 100) : 0
  return `<div class="adash-kpi-row">
    ${aguaKpisSituacaoRoscaHTML(statusCounts)}
    <div class="adash-card">
      <div class="adash-card-topo"><p class="adash-card-tit">Aguardando laudo</p></div>
      <div class="adash-num-linha"><span class="adash-num">${s.total}</span></div>
      <p class="adash-card-pe">coleta(s) com campo preenchido, sem resultado de laboratório</p>
    </div>
    <div class="adash-card">
      <div class="adash-card-topo"><p class="adash-card-tit">Tempo médio de espera</p></div>
      <div class="adash-num-linha"><span class="adash-num">${s.total ? s.media : '—'}</span>${s.total ? '<span class="adash-delta neutro">dias</span>' : ''}</div>
      <p class="adash-card-pe">da data da coleta até hoje, média da fila atual</p>
    </div>
    <div class="adash-card">
      <div class="adash-card-topo"><p class="adash-card-tit">Atrasadas (${AGUA_LAUDO_LIMIAR_ATRASO}+ dias)</p></div>
      <div class="adash-num-linha"><span class="adash-num">${atrasadas}</span>${s.total ? `<span class="adash-delta ${atrasadas ? 'baixa' : ''}">${pctAtrasadas}%</span>` : ''}</div>
      <p class="adash-card-pe">da fila aguardando há mais de ${AGUA_LAUDO_LIMIAR_ATRASO} dias</p>
    </div>
    <div class="adash-card">
      <div class="adash-card-topo"><p class="adash-card-tit">Mais antiga na fila</p></div>
      <div class="adash-num-linha"><span class="adash-num">${s.itemMaisAntigo ? s.diasMaisAntigo : '—'}</span>${s.itemMaisAntigo ? '<span class="adash-delta neutro">dias</span>' : ''}</div>
      <p class="adash-card-pe">${s.itemMaisAntigo ? esc(labelFn(s.itemMaisAntigo)) : 'Nenhuma coleta aguardando'}</p>
    </div>
  </div>`
}

// Quarentena (pages/agua-conferencia.html) — o que preocupa é volume e
// tempo parado, não um limiar de atraso (a régua daqui não é urgência
// de laboratório, é backlog de conferência humana).
function aguaKpisQuarentenaHTML(lista, totalColetas, labelFn, statusCounts) {
  const s = _aguaKpiStats(lista)
  const pct = totalColetas ? (s.total / totalColetas) * 100 : null
  return `<div class="adash-kpi-row">
    ${aguaKpisSituacaoRoscaHTML(statusCounts)}
    <div class="adash-card">
      <div class="adash-card-topo"><p class="adash-card-tit">Em quarentena</p></div>
      <div class="adash-num-linha"><span class="adash-num">${s.total}</span></div>
      <p class="adash-card-pe">pendente de conferência humana com o laudo físico</p>
    </div>
    <div class="adash-card">
      <div class="adash-card-topo"><p class="adash-card-tit">% da série</p></div>
      <div class="adash-num-linha"><span class="adash-num">${pct != null ? pct.toFixed(1) + '%' : '—'}</span></div>
      <p class="adash-card-pe">${totalColetas ? `${s.total} de ${totalColetas} coleta(s) cadastradas` : 'sem coletas cadastradas'}</p>
    </div>
    <div class="adash-card">
      <div class="adash-card-topo"><p class="adash-card-tit">Tempo médio em quarentena</p></div>
      <div class="adash-num-linha"><span class="adash-num">${s.total ? s.media : '—'}</span>${s.total ? '<span class="adash-delta neutro">dias</span>' : ''}</div>
      <p class="adash-card-pe">desde a data da coleta</p>
    </div>
    <div class="adash-card">
      <div class="adash-card-topo"><p class="adash-card-tit">Mais antiga pendente</p></div>
      <div class="adash-num-linha"><span class="adash-num">${s.itemMaisAntigo ? s.diasMaisAntigo : '—'}</span>${s.itemMaisAntigo ? '<span class="adash-delta neutro">dias</span>' : ''}</div>
      <p class="adash-card-pe">${s.itemMaisAntigo ? esc(labelFn(s.itemMaisAntigo)) : 'Nenhuma coleta em quarentena'}</p>
    </div>
  </div>`
}
