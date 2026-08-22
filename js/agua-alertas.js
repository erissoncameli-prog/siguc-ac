// ── SIGUC Qualidade da Água — alertas comparativos (avaliador fino) ──
// Entrega 1 do plano em docs/qualidade-agua/plano-leitura-laudo-e-alertas.md.
//
// ESTE ARQUIVO NÃO DEFINE NENHUM LIMIAR. Toda regra e todo número
// vivem em SQL (migrations 254 e 302/302b): `agua_avaliar_coleta` é a
// autoridade e `vw_agua_baseline_ponto` publica as faixas já na
// unidade natural do parâmetro. Aqui só se chama a RPC, se compara
// número com número e se desenha o aviso — mesma lição de
// `js/frota-consumo.js` e `js/mapa-recorte.js`.
//
// POR QUE EXISTE UM CAMINHO OFFLINE
// O app de campo (`pages/agua-app.html`) é offline-first e não pode
// depender de RPC para avisar — o técnico está na margem do rio. Ele
// cacheia as faixas no IndexedDB e usa `aguaAlertasDoBaseline`, que é
// COMPARAÇÃO PURA (`valor < lim_inf || valor > lim_sup`), sem nenhuma
// conta de escala e sem nenhuma regra própria. Se um dia o critério
// mudar no banco, o app passa a obedecer o critério novo assim que
// sincronizar — não há segunda implementação para esquecer de mudar.
//
// AS TRÊS TELAS QUE CONSOMEM (tocar juntas, regra de duplicação):
//   pages/agua-laudos.html      — lançamento do laudo (mesa)
//   pages/agua-conferencia.html — correção de quarentena (mesa)
//   pages/agua-app.html         — coleta de campo (app, offline)

// Aparência por nível. `bloqueio` só é obedecido pela MESA: no app
// nada bloqueia — "nada pode impedir o trabalho de campo" é regra do
// sistema (aviso de LGPD, GPS divergente, checklist do Frota).
const AGUA_ALERTA_NIVEL = {
  bloqueio:  { cor: 'var(--erro,#DC2626)',   rotulo: 'Impossível' },
  confirmar: { cor: 'var(--alerta,#D97706)', rotulo: 'Confira' },
  informar:  { cor: 'var(--info,#2563A8)',   rotulo: 'Contexto' },
}

// Rótulo humano do grão que sustentou a faixa. A tela é obrigada a
// mostrar de onde veio a referência: "atípico para este ponto
// (mediana 45, n=31)" é acionável; "valor atípico" não é.
const AGUA_ALERTA_BASE_ROTULO = {
  ponto_campanha: 'histórico deste ponto nesta campanha',
  ponto:          'histórico deste ponto',
  rio:            'histórico deste rio',
  serie:          'série histórica completa',
}

// ── Caminho ONLINE — a RPC é a autoridade ────────────────────
// `valores` é um objeto {parametro: número|null}; nulos são
// descartados aqui para não trafegar ruído.
async function aguaAlertasAvaliar(db, { pontoId, ordem, valores, campanhaId = null, coletaId = null }) {
  if (!db || !pontoId || !ordem) return []
  const limpo = {}
  for (const [k, v] of Object.entries(valores || {})) {
    if (v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v))) limpo[k] = Number(v)
  }
  if (!Object.keys(limpo).length) return []
  try {
    const { data, error } = await db.rpc('agua_avaliar_coleta', {
      p_ponto_id: pontoId, p_ordem: ordem, p_valores: limpo,
      p_campanha_id: campanhaId, p_coleta_id: coletaId,
    })
    if (error) throw error
    return Array.isArray(data) ? data : []
  } catch (e) {
    // Sem rede ou sem permissão: silêncio. Alerta é ajuda, não
    // requisito — falhar aqui nunca pode impedir alguém de gravar.
    console.warn('[agua-alertas]', e?.message || e)
    return []
  }
}

// ── Caminho OFFLINE — aplica os números cacheados ────────────
// `baseline` é o que `aguaAlertasBaixarBaseline` guardou: um mapa
// {parametro: {lim_inf, lim_sup, mediana, usual_inf, usual_sup, base, n}}
// já filtrado pelo ponto e pela ordem. Comparação pura, sem regra.
function aguaAlertasDoBaseline(baseline, valores) {
  const out = []
  if (!baseline) return out
  for (const [par, bruto] of Object.entries(valores || {})) {
    const v = Number(bruto)
    if (bruto === null || bruto === undefined || bruto === '' || !Number.isFinite(v)) continue
    const b = baseline[par]
    if (!b || b.lim_inf == null || b.lim_sup == null) continue
    if (v >= b.lim_inf && v <= b.lim_sup) continue
    const acima = v > b.lim_sup
    out.push({
      parametro: par, tipo: 'atipico', nivel: 'confirmar',
      mensagem: `${acima ? 'Acima' : 'Abaixo'} da faixa histórica deste ponto `
        + `(usual ${aguaAlertaNum(b.usual_inf)} a ${aguaAlertaNum(b.usual_sup)}; mediana ${aguaAlertaNum(b.mediana)}).`,
      base: b.base, n: b.n, referencia: b,
    })
  }
  return out
}

// Baixa as faixas de um ponto para uso offline. Poucos KB por ponto
// (22 parâmetros × 2 ordens) — cabe folgado no IndexedDB do aparelho.
async function aguaAlertasBaixarBaseline(db, pontoIds = null) {
  if (!db) return {}
  let q = db.from('vw_agua_baseline_ponto')
    .select('ponto_id,parametro,ordem,base,n,mediana,usual_inf,usual_sup,lim_inf,lim_sup')
  if (pontoIds?.length) q = q.in('ponto_id', pontoIds)
  const { data, error } = await q
  if (error) { console.warn('[agua-alertas] baseline', error.message); return {} }
  // Indexado por ponto → ordem → parâmetro, que é como o app consulta.
  const mapa = {}
  for (const r of data || []) {
    mapa[r.ponto_id] ??= {}
    mapa[r.ponto_id][r.ordem] ??= {}
    mapa[r.ponto_id][r.ordem][r.parametro] = {
      base: r.base, n: r.n, mediana: r.mediana,
      usual_inf: r.usual_inf, usual_sup: r.usual_sup,
      lim_inf: r.lim_inf, lim_sup: r.lim_sup,
    }
  }
  return mapa
}

// ── Consulta sobre a lista de alertas ────────────────────────
const aguaAlertasPorParametro = (alertas, par) => (alertas || []).filter(a => a.parametro === par)
const aguaAlertasBloqueios    = (alertas) => (alertas || []).filter(a => a.nivel === 'bloqueio')
const aguaAlertasAConfirmar   = (alertas) => (alertas || []).filter(a => a.nivel === 'confirmar')

// O alerta mais grave de um parâmetro — é ele que colore o campo.
function aguaAlertaDoCampo(alertas, par) {
  const ordem = { bloqueio: 0, confirmar: 1, informar: 2 }
  return aguaAlertasPorParametro(alertas, par)
    .sort((a, b) => (ordem[a.nivel] ?? 9) - (ordem[b.nivel] ?? 9))[0] || null
}

// Número com vírgula decimal, espelhando `agua_num_br()` no banco —
// aqui só para o caminho offline, que não passa pelo servidor.
function aguaAlertaNum(v) {
  if (v == null) return '—'
  const n = Number(v)
  if (!Number.isFinite(n)) return '—'
  const casas = Math.abs(n) >= 100 ? 2 : Math.abs(n) >= 1 ? 3 : 4
  return n.toFixed(casas).replace(/0+$/, '').replace(/[.,]$/, '').replace('.', ',')
}

// ── Desenho ──────────────────────────────────────────────────
// Dica curta, sob o campo. Devolve '' quando não há alerta — o
// chamador pode jogar direto no innerHTML.
function aguaAlertaHintHTML(alerta) {
  if (!alerta) return ''
  const cfg = AGUA_ALERTA_NIVEL[alerta.nivel] || AGUA_ALERTA_NIVEL.informar
  const base = alerta.base ? ` <span style="opacity:.75">(${AGUA_ALERTA_BASE_ROTULO[alerta.base] || alerta.base}, n=${alerta.n})</span>` : ''
  return `<span style="color:${cfg.cor}">${aguaAlertaEsc(alerta.mensagem)}${base}</span>`
}

// Resumo agrupado, para o topo de um modal ou antes de salvar.
function aguaAlertasResumoHTML(alertas, { titulo = 'Confira antes de salvar' } = {}) {
  if (!alertas?.length) return ''
  const linhas = alertas.map(a => {
    const cfg = AGUA_ALERTA_NIVEL[a.nivel] || AGUA_ALERTA_NIVEL.informar
    return `<li style="margin:2px 0"><strong style="color:${cfg.cor}">${cfg.rotulo}</strong> · `
      + `${aguaAlertaEsc(AGUA_ALERTA_PARAM_ROTULO[a.parametro] || a.parametro)}: ${aguaAlertaEsc(a.mensagem)}</li>`
  }).join('')
  const grave = alertas.some(a => a.nivel === 'bloqueio')
  return `<div style="background:${grave ? '#FEF2F2' : '#FFFBEB'};border:1px solid ${grave ? '#FECACA' : '#FDE68A'};
      border-radius:8px;padding:10px 12px;font-size:12.5px;color:#374151;margin-bottom:12px">
    <div style="font-weight:600;margin-bottom:4px">${aguaAlertaEsc(titulo)}</div>
    <ul style="margin:0;padding-left:18px">${linhas}</ul>
    <div style="margin-top:6px;opacity:.8">Conformidade com o padrão CONAMA é leitura separada — não aparece aqui.</div>
  </div>`
}

// Texto do confirm() antes de salvar na mesa. Devolve null quando não
// há nada a confirmar.
function aguaAlertasTextoConfirmacao(alertas) {
  const lista = aguaAlertasAConfirmar(alertas)
  if (!lista.length) return null
  return 'Estes valores pedem conferência com o laudo físico:\n\n'
    + lista.map(a => `• ${AGUA_ALERTA_PARAM_ROTULO[a.parametro] || a.parametro}: ${a.mensagem}`).join('\n')
    + '\n\nConfirma que estão corretos como no laudo?'
}

// Rótulos dos parâmetros. Duplicam os que já existem espalhados
// (CONAMA_PARAM_LABEL, AGUA_REL_PARAM_LABEL) porque este arquivo é
// carregado também pelo app de campo, que não tem os outros — unificar
// os três é limpeza para outra entrega, registrada aqui de propósito.
const AGUA_ALERTA_PARAM_ROTULO = {
  temp_ar: 'Temp. ar', temp_amostra: 'Temp. amostra', ph: 'pH', od: 'OD',
  turbidez: 'Turbidez', condutividade_eletrica: 'Condutividade (campo)',
  condutividade_especifica: 'Condutividade (lab.)', dbo: 'DBO',
  nitrogenio_total: 'Nitrogênio total', nitrogenio_amoniacal: 'Nitrogênio amoniacal',
  nitratos: 'Nitratos', fosforo_total: 'Fósforo total',
  ortofosfato_dissolvido: 'Ortofosfato dissolvido',
  solidos_dissolvidos_totais: 'Sólidos dissolvidos totais',
  solidos_suspensao_totais: 'Sólidos em suspensão totais',
  coliformes_termotolerantes: 'Coliformes termotolerantes',
  coliformes_totais: 'Coliformes totais', escherichia_coli: 'E. coli',
  alcalinidade_total: 'Alcalinidade total', carbono_organico_total: 'Carbono orgânico total',
  cloreto: 'Cloreto', descarga_liquida: 'Descarga líquida',
}

// `esc` global existe na mesa (js/config.js) mas não no app de campo
// em toda ordem de carga — shim local, mesmo padrão de
// pages/privacidade.html.
function aguaAlertaEsc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}
