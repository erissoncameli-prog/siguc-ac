// ── SIGUC-AC · Qualidade da Água — dados do relatório por bacia ────
// Fase 5 do módulo (docs/qualidade-agua/plano.md). Fonte única dos
// dados usada pelos DOIS geradores (PDF e PPTX) — nunca duas cópias
// da mesma agregação, mesma lição de js/frota-consumo.js.
//
// NUNCA recalcula IQA/CONAMA: tudo já vem pronto em
// vw_agua_coletas_detalhe (agua_calcular_iqa()/agua_conama_violacoes(),
// migration 249). As funções aqui só agrupam/ordenam/resumem o que a
// view entrega — o mesmo princípio que pages/agua-mapa.html já segue
// ao ler a view direto, sem RPC de agregação nova.
//
// Funções puras (recebem arrays já buscados) ficam separadas das que
// tocam rede — é o que permite testar a agregação sem sessão Supabase
// (mesmo padrão de montarCorpoGaveta em pages/agua-mapa.html).

const AGUA_REL_SEM_BACIA = '__sem_bacia__' // chave interna p/ bacia NULA (ex.: Rio Iquiri, pendente de conferência — ver plano.md)

function aguaRelChaveBacia(bacia) { return bacia || AGUA_REL_SEM_BACIA }
function aguaRelLabelBacia(bacia) { return bacia || 'Sem bacia definida' }

// Rótulos estáticos dos filtros novos (busca por rio/status/faixa/CONAMA)
// — mesmo espírito de AGUA_REL_PARAM_LABEL logo abaixo: não é cálculo,
// só rótulo, compartilhado pela tela e pelos dois geradores.
const AGUA_REL_STATUS_LABEL = { aguardando_lab: 'Aguardando laudo', completo: 'Completo', quarentena: 'Quarentena' }
const AGUA_REL_CONAMA_LABEL = { conforme: 'Conforme', violacao: 'Violação', sem_limites: 'Sem limites cadastrados' }

// Deriva o mesmo "terceiro estado" que pages/agua-mapa.html já trata
// (conama_violacoes NULL não é o mesmo que conforme) — usado tanto pelo
// filtro quanto por quem quiser rotular a coleta em uma palavra só.
function aguaRelConamaStatus(coleta) {
  if (coleta.conama_violacoes == null) return 'sem_limites'
  return coleta.conama_violacoes.length > 0 ? 'violacao' : 'conforme'
}

// Rios distintos presentes numa lista de coletas — usada para popular o
// seletor de rio DEPOIS que uma bacia é escolhida (uma bacia pode ter
// mais de um rio: Purus tem Rio Acre/Rio Iaco/Rio Purus, por exemplo).
function aguaRelRiosDe(coletas) {
  return [...new Set((coletas || []).map(c => c.ponto_rio).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'pt-BR'))
}

// Texto legível dos filtros ativos (além de bacia/campanha) — usado na
// tela E nos dois documentos gerados, pra nenhum dos dois "esconder"
// que o relatório está recortado (não é a bacia inteira).
function aguaRelFiltrosTxt(filtros) {
  if (!filtros) return ''
  const partes = []
  if (filtros.bacia) partes.push(`Bacia: ${filtros.bacia === AGUA_REL_SEM_BACIA ? 'Sem bacia definida' : filtros.bacia}`)
  if (filtros.rio) partes.push(`Rio: ${filtros.rio}`)
  if (filtros.status) partes.push(`Status: ${AGUA_REL_STATUS_LABEL[filtros.status] || filtros.status}`)
  if (filtros.iqaFaixa) partes.push(`Faixa IQA: ${filtros.iqaFaixa}`)
  if (filtros.conamaStatus) partes.push(`CONAMA: ${AGUA_REL_CONAMA_LABEL[filtros.conamaStatus] || filtros.conamaStatus}`)
  return partes.join(' · ')
}

// Mesmos campos/rótulos de pages/agua-laudos.html, agua-conferencia.html
// e agua-mapa.html (rótulo estático, sem cálculo — não é o que a regra
// "cálculo em UM lugar só" cobre). Compartilhado entre os dois geradores
// (PDF e PPTX) para não virar uma quinta cópia.
const AGUA_REL_PARAM_LABEL = {
  temp_ar: 'Temp. ar', temp_amostra: 'Temp. amostra', ph: 'pH', od: 'OD',
  turbidez: 'Turbidez', condutividade_eletrica: 'Condutividade',
  dbo: 'DBO', nitrogenio_total: 'Nitrogênio total', nitrogenio_amoniacal: 'Nitrogênio amoniacal',
  nitratos: 'Nitratos', fosforo_total: 'Fósforo total', ortofosfato_dissolvido: 'Ortofosfato dissolvido',
  solidos_dissolvidos_totais: 'Sólidos dissolvidos', solidos_suspensao_totais: 'Sólidos em suspensão',
  coliformes_termotolerantes: 'Coliformes termotolerantes', coliformes_totais: 'Coliformes totais',
  escherichia_coli: 'Escherichia coli', alcalinidade_total: 'Alcalinidade total',
  carbono_organico_total: 'Carbono orgânico total', cloreto: 'Cloreto',
  condutividade_especifica: 'Condutividade específica', descarga_liquida: 'Descarga líquida',
}

// ── Busca (rede) ─────────────────────────────────────────────────
// Colunas mínimas para popular o seletor de bacias — não traz os ~20
// parâmetros de campo/laboratório, que só interessam depois que uma
// bacia é escolhida.
async function aguaRelBuscarResumoBacias(db) {
  const { data, error } = await db.from('vw_agua_coletas_detalhe').select('ponto_id,ponto_bacia')
  if (error) throw error
  return data || []
}

// Todas as coletas de uma bacia (bacia === null busca as coletas SEM
// bacia definida, nunca "todas as bacias" — relatório é sempre de UMA
// bacia, regra do plano).
async function aguaRelBuscarColetasDaBacia(db, bacia) {
  let q = db.from('vw_agua_coletas_detalhe').select('*')
  q = bacia ? q.eq('ponto_bacia', bacia) : q.is('ponto_bacia', null)
  const { data, error } = await q.order('data_coleta')
  if (error) throw error
  return data || []
}

// Todas as coletas do estado, de qualquer bacia — o escopo "Acre todo"
// do painel (pages/agua-relatorios.html). Sem filtro nenhum de bacia;
// quem quiser recortar por bacia depois disso usa `opts.bacia` em
// aguaRelMontar (client-side, sem nova ida ao banco) — é o que permite
// alternar de visão geral para uma bacia sem esperar rede de novo.
async function aguaRelBuscarTodasColetas(db) {
  const { data, error } = await db.from('vw_agua_coletas_detalhe').select('*').order('data_coleta')
  if (error) throw error
  return data || []
}

// ── Agregação (pura, testável sem rede) ─────────────────────────

// Bacias presentes numa lista de coletas, com contagem de pontos —
// usada para popular o seletor. Bacia NULA vira 'Sem bacia definida',
// nunca descartada (ex.: Rio Iquiri, ver "Decisões ainda abertas" no plano).
function aguaRelListarBacias(coletas) {
  const porBacia = {}
  ;(coletas || []).forEach(c => {
    const chave = aguaRelChaveBacia(c.ponto_bacia)
    if (!porBacia[chave]) porBacia[chave] = { bacia: chave, label: aguaRelLabelBacia(c.ponto_bacia), pontos: new Set(), coletas: 0 }
    porBacia[chave].pontos.add(c.ponto_id)
    porBacia[chave].coletas++
  })
  return Object.values(porBacia)
    .map(b => ({ bacia: b.bacia, label: b.label, nPontos: b.pontos.size, nColetas: b.coletas }))
    .sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'))
}

function aguaRelCompararCampanha(a, b) {
  if (a.campanha_ano !== b.campanha_ano) return a.campanha_ano - b.campanha_ano
  return (a.campanha_ordem === 'primeira' ? 0 : 1) - (b.campanha_ordem === 'primeira' ? 0 : 1)
}
function aguaRelLabelCampanha(c) {
  return `${c.campanha_ano} · ${c.campanha_ordem === 'primeira' ? '1ª' : '2ª'} campanha`
}

// Campanhas distintas presentes numa lista de coletas, em ordem
// cronológica — só as que a bacia de fato tem dado (não a lista global
// de agua_campanhas, que inclui campanhas de outras bacias).
function aguaRelCampanhasDe(coletas) {
  const porId = {}
  ;(coletas || []).forEach(c => {
    if (!porId[c.campanha_id]) porId[c.campanha_id] = { campanha_id: c.campanha_id, campanha_ano: c.campanha_ano, campanha_ordem: c.campanha_ordem }
  })
  return Object.values(porId).sort(aguaRelCompararCampanha)
}

// Monta o relatório de uma bacia: recorta pelo intervalo de campanhas
// [campanhaDeId, campanhaAteId] (ids de agua_campanhas; omitido =
// desde o início / até o fim), aplica os filtros de busca opcionais
// (rio, status, faixa do IQA, conformidade CONAMA — todos "E" entre
// si, refinando o que a bacia+período já trouxe, nunca substituindo),
// agrupa por ponto e resume. Puro.
//
// `campanhas` continua vindo do intervalo inteiro (não é recalculada
// pelos filtros de busca) — o eixo temporal do relatório fica estável
// mesmo que um filtro esvazie uma campanha específica; é o mesmo
// espírito do ponto "vazado" em agua-mapa.html: lacuna é informação,
// não redesenha o eixo.
function aguaRelMontar(coletasDaBacia, opts = {}) {
  const todasCampanhas = aguaRelCampanhasDe(coletasDaBacia)
  const idxDe  = opts.campanhaDeId  ? todasCampanhas.findIndex(c => c.campanha_id === opts.campanhaDeId)  : 0
  const idxAteBruto = opts.campanhaAteId ? todasCampanhas.findIndex(c => c.campanha_id === opts.campanhaAteId) : todasCampanhas.length - 1
  const idxAte = idxAteBruto < 0 ? todasCampanhas.length - 1 : idxAteBruto
  const campanhas = todasCampanhas.slice(Math.max(idxDe, 0), idxAte + 1)
  const idsPermitidos = new Set(campanhas.map(c => c.campanha_id))

  let coletas = (coletasDaBacia || []).filter(c => idsPermitidos.has(c.campanha_id))
  if (opts.rio) coletas = coletas.filter(c => c.ponto_rio === opts.rio)
  if (opts.status) coletas = coletas.filter(c => c.status === opts.status)
  if (opts.iqaFaixa) coletas = coletas.filter(c => c.iqa_faixa === opts.iqaFaixa)
  if (opts.conamaStatus) coletas = coletas.filter(c => aguaRelConamaStatus(c) === opts.conamaStatus)
  coletas = coletas.sort((a, b) => aguaRelCompararCampanha(a, b) || (a.ponto_nome || '').localeCompare(b.ponto_nome || '', 'pt-BR'))

  const porPonto = {}
  coletas.forEach(c => {
    if (!porPonto[c.ponto_id]) {
      porPonto[c.ponto_id] = {
        ponto_id: c.ponto_id, nome: c.ponto_nome, codigo_ana: c.codigo_ana,
        municipio: c.ponto_municipio, rio: c.ponto_rio, coletas: [],
      }
    }
    porPonto[c.ponto_id].coletas.push(c)
  })
  const pontos = Object.values(porPonto).sort((a, b) => (a.nome || '').localeCompare(b.nome || '', 'pt-BR'))

  const filtros = { rio: opts.rio || null, status: opts.status || null, iqaFaixa: opts.iqaFaixa || null, conamaStatus: opts.conamaStatus || null }
  return { campanhas, coletas, pontos, resumo: aguaRelResumo(coletas), filtros }
}

function aguaRelResumo(coletas) {
  const comIQA = coletas.filter(c => c.iqa != null)
  const quarentena = coletas.filter(c => c.status === 'quarentena')
  const comConama = coletas.filter(c => c.conama_violacoes != null)
  const conforme = comConama.filter(c => c.conama_violacoes.length === 0)
  const violacoesPorParametro = {}
  comConama.forEach(c => (c.conama_violacoes || []).forEach(p => { violacoesPorParametro[p] = (violacoesPorParametro[p] || 0) + 1 }))
  return {
    totalColetas: coletas.length,
    nPontos: new Set(coletas.map(c => c.ponto_id)).size,
    quarentena: quarentena.length,
    comIQA: comIQA.length,
    iqaMedio: comIQA.length ? comIQA.reduce((s, c) => s + c.iqa, 0) / comIQA.length : null,
    comConama: comConama.length,
    conforme: conforme.length,
    pctConforme: comConama.length ? (conforme.length / comConama.length) * 100 : null,
    violacoesPorParametro,
  }
}

// Série do IQA de UM ponto ao longo das campanhas do relatório (já
// recortadas por aguaRelMontar), para o gráfico do PPTX. Campanha sem
// coleta do ponto entra como `iqa: null` — GAP no gráfico, nunca some
// do eixo (mesmo espírito do ponto "vazado" em agua-mapa.html: lacuna
// de monitoramento é informação, não se esconde).
function aguaRelSerieIQA(ponto, campanhas) {
  const porCampanha = {}
  ponto.coletas.forEach(c => { porCampanha[c.campanha_id] = c })
  return campanhas.map(camp => {
    const c = porCampanha[camp.campanha_id]
    return {
      label: aguaRelLabelCampanha(camp),
      iqa: c?.iqa ?? null,
      // faixa/status vêm DA LINHA do banco (nunca derivados aqui) —
      // é o que permite ao gráfico de linha colorir o ponto pela faixa
      // real e marcar quarentena sem a página classificar nada.
      faixa: c?.iqa_faixa ?? null,
      status: c?.status ?? null,
    }
  })
}

// ── Agregações do painel (pages/agua-relatorios.html) ────────────
// Puras, testáveis sem rede, no mesmo espírito das de cima: SÓ contam
// e somam o que a view já entregou. Nenhuma delas classifica faixa a
// partir de uma média — classificar é papel de agua_iqa_faixa() no
// banco; o painel só mostra o número quando a faixa não vem pronta.

// Uma linha por campanha do recorte, em ordem cronológica — base do
// eixo temporal do painel e da variação vs. campanha anterior.
// Campanha sem coleta no recorte continua na lista (nColetas 0,
// iqaMedio null): lacuna de monitoramento é informação, mesmo
// princípio do ponto "vazado" em agua-mapa.html.
function aguaRelPorCampanha(rel) {
  const porId = {}
  ;(rel.coletas || []).forEach(c => {
    if (!porId[c.campanha_id]) porId[c.campanha_id] = []
    porId[c.campanha_id].push(c)
  })
  return (rel.campanhas || []).map(camp => {
    const coletas = porId[camp.campanha_id] || []
    const resumo = aguaRelResumo(coletas)
    return {
      campanha_id: camp.campanha_id,
      label: aguaRelLabelCampanha(camp),
      labelCurto: `${camp.campanha_ano}·${camp.campanha_ordem === 'primeira' ? '1ª' : '2ª'}`,
      nColetas: resumo.totalColetas,
      nPontos: resumo.nPontos,
      iqaMedio: resumo.iqaMedio,
      pctConforme: resumo.pctConforme,
      quarentena: resumo.quarentena,
    }
  })
}

// IQA médio de cada ponto no recorte, do maior para o menor (ponto sem
// nenhuma coleta com IQA vai para o fim, com iqaMedio null — nunca
// sumindo da lista). `quarentena` marca que a média inclui coleta
// ainda em conferência, para a barra sair esmaecida.
function aguaRelIqaPorPonto(rel) {
  return (rel.pontos || []).map(p => {
    const comIQA = p.coletas.filter(c => c.iqa != null)
    return {
      ponto_id: p.ponto_id, nome: p.nome, codigo_ana: p.codigo_ana,
      rio: p.rio, municipio: p.municipio,
      nColetas: p.coletas.length,
      comIQA: comIQA.length,
      iqaMedio: comIQA.length ? comIQA.reduce((s, c) => s + c.iqa, 0) / comIQA.length : null,
      quarentena: p.coletas.some(c => c.status === 'quarentena'),
    }
  }).sort((a, b) => {
    if (a.iqaMedio == null && b.iqaMedio == null) return (a.nome || '').localeCompare(b.nome || '', 'pt-BR')
    if (a.iqaMedio == null) return 1
    if (b.iqaMedio == null) return -1
    return b.iqaMedio - a.iqaMedio
  })
}

// Contagem de coletas por faixa do IQA — a faixa vem pronta da view
// (iqa_faixa), nunca derivada aqui. `semIQA` conta as coletas sem
// índice (aguardando laudo ou piso de peso da agua_calcular_iqa).
function aguaRelDistribuicaoFaixas(coletas) {
  const contagem = {}
  let semIQA = 0
  ;(coletas || []).forEach(c => {
    if (c.iqa == null || !c.iqa_faixa) { semIQA++; return }
    contagem[c.iqa_faixa] = (contagem[c.iqa_faixa] || 0) + 1
  })
  const total = (coletas || []).length - semIQA
  let predominante = null, maior = 0
  Object.entries(contagem).forEach(([f, n]) => { if (n > maior) { maior = n; predominante = f } })
  return { contagem, semIQA, comIQA: total, predominante, nPredominante: maior }
}

// Variação do IQA médio entre as DUAS últimas campanhas com índice do
// recorte (o chip "vs. campanha anterior" do painel). Devolve null
// quando não há duas campanhas comparáveis — melhor não mostrar chip
// nenhum do que inventar uma tendência com uma medição só.
function aguaRelVariacaoIQA(porCampanha) {
  const comIQA = (porCampanha || []).filter(c => c.iqaMedio != null)
  if (comIQA.length < 2) return null
  const atual = comIQA[comIQA.length - 1], anterior = comIQA[comIQA.length - 2]
  return {
    atual: atual.iqaMedio, anterior: anterior.iqaMedio,
    delta: atual.iqaMedio - anterior.iqaMedio,
    labelAtual: atual.label, labelAnterior: anterior.label,
  }
}

// Ranking dos parâmetros que mais violaram o limite CONAMA no recorte
// (violacoesPorParametro já vem de aguaRelResumo — só ordena e rotula).
function aguaRelViolacoesRanking(resumo, limite) {
  return Object.entries(resumo.violacoesPorParametro || {})
    .map(([p, n]) => ({ parametro: p, label: AGUA_REL_PARAM_LABEL[p] || p, n }))
    .sort((a, b) => b.n - a.n || a.label.localeCompare(b.label, 'pt-BR'))
    .slice(0, limite || 6)
}
