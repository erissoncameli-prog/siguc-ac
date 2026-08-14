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
// desde o início / até o fim), agrupa por ponto e resume. Puro.
function aguaRelMontar(coletasDaBacia, opts = {}) {
  const todasCampanhas = aguaRelCampanhasDe(coletasDaBacia)
  const idxDe  = opts.campanhaDeId  ? todasCampanhas.findIndex(c => c.campanha_id === opts.campanhaDeId)  : 0
  const idxAteBruto = opts.campanhaAteId ? todasCampanhas.findIndex(c => c.campanha_id === opts.campanhaAteId) : todasCampanhas.length - 1
  const idxAte = idxAteBruto < 0 ? todasCampanhas.length - 1 : idxAteBruto
  const campanhas = todasCampanhas.slice(Math.max(idxDe, 0), idxAte + 1)
  const idsPermitidos = new Set(campanhas.map(c => c.campanha_id))

  const coletas = (coletasDaBacia || [])
    .filter(c => idsPermitidos.has(c.campanha_id))
    .sort((a, b) => aguaRelCompararCampanha(a, b) || (a.ponto_nome || '').localeCompare(b.ponto_nome || '', 'pt-BR'))

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

  return { campanhas, coletas, pontos, resumo: aguaRelResumo(coletas) }
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
  return campanhas.map(camp => ({
    label: aguaRelLabelCampanha(camp),
    iqa: porCampanha[camp.campanha_id]?.iqa ?? null,
  }))
}
