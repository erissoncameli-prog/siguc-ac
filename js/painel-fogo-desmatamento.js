// ── Painel de Fogo e Desmatamento · dados e gráficos ─────────────
// Fonte única do painel (pages/painel-fogo-desmatamento.html): recorta
// o histórico por TIPO (queimada/desmatamento/ambos), por ESCOPO (Acre
// todo / todas as UCs / UCs de uma esfera / uma UC), por FONTE dos focos
// (FIRMS × BDQueimadas) e por PERÍODO, e desenha os gráficos.
// A página não agrega nem desenha nada — mesma lição de
// js/frota-consumo.js e js/agua-relatorio-dados.js.
//
// Dados (migration 342), todos pré-agregados no banco:
//  - focos_uc_mes  ano × mês × UC (uc_id null = fora de UC). Temporada
//    de fogo 1º/jul a 4/nov — a MESMA definição de vw_focos_linha_tempo.
//  - prodes_resumo_ano  total OFICIAL do estado (área declarada pelo INPE).
//  - prodes_uc_ano  área por UC = interseção calculada no banco.
//  - focos_bdq_uc_mes / focos_bdq_resumo_ano (migration 343)  BDQueimadas/
//    INPE, satélite de referência, ANO CIVIL inteiro. Série à parte da do
//    FIRMS — nunca somadas: satélites e janela diferentes. O painel mostra
//    uma fonte por vez (f.fonte).
//
// Regras que valem para todo gráfico daqui:
//  - fogo e desmatamento NUNCA dividem eixo nem viram um número só: são
//    unidades diferentes (focos × ha) e janelas diferentes (temporada de
//    fogo × ano-PRODES). Cada um tem seu gráfico.
//  - cor segue a ENTIDADE (queimada laranja, desmatamento verde-escuro;
//    dentro de UC verde, fora laranja-claro) — pares já validados contra
//    daltonismo no projeto (ver CLAUDE.md, painel-resumo do mapa).
//  - todo ponto/barra/fatia leva <title> "rótulo — valor", que alimenta o
//    tooltip, o teclado e a tabela de js/grafico-teclado.js.
//
// Funções de dados são puras — testadas em tests/painel-fogo-desmatamento.test.js.

const PFD_COR = {
  queimada: '#EA580C',
  desmatamento: '#166534',
  dentro: '#2F9E5B',
  fora: '#F59E0B',
  grade: '#E5E7EB',
  eixo: '#6B7280',
  texto: '#374151',
  // Esferas: rampa de UM matiz, separada por luminosidade — continua
  // distinguível em qualquer tipo de daltonismo e em impressão P&B.
  federal: '#1E3A8A',
  estadual: '#3B82F6',
  municipal: '#93C5FD',
  // Veredito da tendência (sempre acompanhado do texto, nunca só a cor)
  // Cobertura (saldo desmatado × remanescente) — validado no
  // validate_palette.js da skill de dataviz: CVD ΔE 16,0 (deutan) no pior
  // par, normal 27,1. Âmbar tem contraste baixo (2,1:1): vai sempre com
  // rótulo e valor ao lado. Cinza é NEUTRO (não floresta/rios), não
  // categoria. A floresta NÃO usa o verde-escuro do desmatamento (#166534)
  // nem o verde "dentro de UC": leria como "mais desmatamento".
  floresta: '#0D9488',
  desm2007: '#9A3412',
  desmRecente: '#F59E0B',
  outros: '#CBD5E1',
  subindo: '#B91C1C',
  caindo: '#15803D',
  estavel: '#6B7280',
}
const PFD_ESFERAS = [
  { chave: 'federal', rotulo: 'UCs federais' },
  { chave: 'estadual', rotulo: 'UCs estaduais' },
  { chave: 'municipal', rotulo: 'UCs municipais' },
]
const PFD_MESES = ['', 'jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']

function _pfdNum(n, casas) {
  const v = Number(n) || 0
  return v.toLocaleString('pt-BR', { maximumFractionDigits: casas ?? 0, minimumFractionDigits: casas ?? 0 })
}
function _pfdEsc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}

// ── Filtro ────────────────────────────────────────────────────────
// escopo: '' = Acre todo · 'ucs' = dentro de qualquer UC ·
//         'esf:<federal|estadual|municipal>' = UCs daquela esfera · <uuid> = uma UC ·
//         'mun:<código IBGE>' = um município (tabelas *_mun_*, migration 345)
function _pfdPred(dados, escopo) {
  if (!escopo) return () => true
  if (escopo === 'ucs') return id => id != null
  if (escopo.startsWith('esf:')) {
    const e = escopo.slice(4)
    const ids = new Set((dados.ucs || []).filter(u => u.esfera === e).map(u => u.id))
    return id => ids.has(id)
  }
  return id => id === escopo
}
function pfdEscopoTipo(escopo) {
  if (!escopo) return 'acre'
  if (escopo === 'ucs') return 'ucs'
  if (escopo.startsWith('esf:')) return 'esfera'
  if (escopo.startsWith('mun:')) return 'mun'
  return 'uc'
}
// Linhas e meses da fonte de focos escolhida. Recorte por município lê as
// tabelas por município (cd_ibge); os demais, as por UC (uc_id). As duas
// somam o MESMO total do estado (conferido: 2024 = 47.805 nas duas).
function _pfdFogo(dados, f, porMun) {
  const mun = porMun ?? pfdEscopoTipo(f.escopo) === 'mun'
  return f.fonte === 'bdq'
    ? { linhas: (mun ? dados.bdqMunMes : dados.bdqUcMes) || [], resumo: dados.bdqResumo || [], meses: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], parcialAtual: false }
    : { linhas: (mun ? dados.focosMunMes : dados.focosUcMes) || [], resumo: dados.focosResumo || [], meses: [7, 8, 9, 10, 11], parcialAtual: true }
}
// "Esta linha está no recorte?" — olha cd_ibge (município) ou uc_id (UC).
function _pfdNoLinha(dados, f) {
  if (pfdEscopoTipo(f.escopo) === 'mun') {
    const cd = f.escopo.slice(4)
    return r => r.cd_ibge === cd
  }
  const no = _pfdPred(dados, f.escopo)
  return r => no(r.uc_id)
}
function _pfdAnos(f) {
  const out = []
  for (let a = Number(f.anoIni); a <= Number(f.anoFim); a++) out.push(a)
  return out
}

// ── Fogo ──────────────────────────────────────────────────────────
function pfdFocosPorAno(dados, f) {
  const fg = _pfdFogo(dados, f), no = _pfdNoLinha(dados, f)
  const soma = {}
  for (const r of fg.linhas) {
    if (r.ano < f.anoIni || r.ano > f.anoFim || !no(r)) continue
    soma[r.ano] = (soma[r.ano] || 0) + Number(r.focos)
  }
  const resumo = {}
  for (const r of fg.resumo) resumo[r.ano] = r
  const anoAtual = (f.hoje instanceof Date ? f.hoje : new Date()).getFullYear()
  return _pfdAnos(f).map(ano => ({
    ano,
    n: resumo[ano] ? (soma[ano] || 0) : null,   // null = ano sem registro nenhum
    parcial: fg.parcialAtual && !!resumo[ano] && ano >= anoAtual,
  }))
}

function pfdFocosPorMes(dados, f) {
  const fg = _pfdFogo(dados, f), no = _pfdNoLinha(dados, f)
  const soma = {}
  for (const m of fg.meses) soma[m] = 0
  for (const r of fg.linhas) {
    if (r.ano < f.anoIni || r.ano > f.anoFim || !no(r)) continue
    if (soma[r.mes] != null) soma[r.mes] += Number(r.focos)
  }
  return fg.meses.map(mes => ({ mes, n: soma[mes] }))
}

// ── Desmatamento ──────────────────────────────────────────────────
// Acre todo = número OFICIAL do INPE; UC/município = interseção calculada.
function pfdDesmatPorAno(dados, f) {
  const porAno = {}
  const no = _pfdNoLinha(dados, f)
  const linhas = (pfdEscopoTipo(f.escopo) === 'mun' ? dados.prodesMunAno : dados.prodesUcAno) || []
  if (!f.escopo) {
    for (const r of dados.prodesAno || []) porAno[r.ano] = { ha: Number(r.area_ha), poligonos: Number(r.poligonos) }
  } else {
    const temAno = new Set(linhas.map(r => r.ano))
    for (const a of temAno) porAno[a] = { ha: 0, poligonos: 0 }
    for (const r of linhas) {
      if (!no(r)) continue
      porAno[r.ano].ha += Number(r.area_ha)
      porAno[r.ano].poligonos += Number(r.poligonos)
    }
  }
  return _pfdAnos(f).map(ano => ({
    ano,
    ha: porAno[ano] ? porAno[ano].ha : null,          // null = ano sem PRODES publicado
    poligonos: porAno[ano] ? porAno[ano].poligonos : null,
  }))
}

function pfdAcumulado(serie, campo) {
  let acc = 0
  return serie.map(p => {
    if (p[campo] == null) return { ...p, acumulado: null }
    acc += p[campo]
    return { ...p, acumulado: acc }
  })
}

// ── Ranking de UCs ────────────────────────────────────────────────
// Todas as UCs (a escolhida fica destacada); com filtro de esfera, só as
// UCs daquela esfera — é o recorte que a pessoa pediu.
function pfdRankingUC(dados, f, tipo) {
  const valor = {}
  const esfera = pfdEscopoTipo(f.escopo) === 'esfera' ? f.escopo.slice(4) : null
  if (tipo === 'queimada') {
    for (const r of _pfdFogo(dados, f, false).linhas) {
      if (!r.uc_id || r.ano < f.anoIni || r.ano > f.anoFim) continue
      valor[r.uc_id] = (valor[r.uc_id] || 0) + Number(r.focos)
    }
  } else {
    for (const r of dados.prodesUcAno || []) {
      if (r.ano < f.anoIni || r.ano > f.anoFim) continue
      valor[r.uc_id] = (valor[r.uc_id] || 0) + Number(r.area_ha)
    }
  }
  return (dados.ucs || [])
    .filter(u => !esfera || u.esfera === esfera)
    .map(u => ({ uc_id: u.id, nome: u.nome, valor: valor[u.id] || 0 }))
    .sort((a, b) => b.valor - a.valor || a.nome.localeCompare(b.nome, 'pt-BR'))
}

// ── Ranking de municípios (o escolhido fica destacado) ────────────
function pfdRankingMun(dados, f, tipo) {
  const valor = {}
  if (tipo === 'queimada') {
    for (const r of _pfdFogo(dados, f, true).linhas) {
      if (!r.cd_ibge || r.ano < f.anoIni || r.ano > f.anoFim) continue
      valor[r.cd_ibge] = (valor[r.cd_ibge] || 0) + Number(r.focos)
    }
  } else {
    for (const r of dados.prodesMunAno || []) {
      if (r.ano < f.anoIni || r.ano > f.anoFim) continue
      valor[r.cd_ibge] = (valor[r.cd_ibge] || 0) + Number(r.area_ha)
    }
  }
  return (dados.municipios || [])
    .map(m => ({ uc_id: 'mun:' + m.cd_ibge, nome: m.nome, valor: valor[m.cd_ibge] || 0 }))
    .sort((a, b) => b.valor - a.valor || a.nome.localeCompare(b.nome, 'pt-BR'))
}

// ── Dentro × fora (rosca) ─────────────────────────────────────────
// Acre todo / todas as UCs: dentro × fora de UCs. Esfera, uma UC ou um
// município: o recorte escolhido × restante do Acre.
function pfdDentroFora(dados, f, tipo) {
  const t = pfdEscopoTipo(f.escopo)
  if (t === 'mun') {
    const no = _pfdNoLinha(dados, f)
    let dentro = 0, total = 0
    if (tipo === 'queimada') {
      for (const r of _pfdFogo(dados, f, true).linhas) {
        if (r.ano < f.anoIni || r.ano > f.anoFim) continue
        total += Number(r.focos)
        if (no(r)) dentro += Number(r.focos)
      }
    } else {
      for (const r of dados.prodesAno || []) if (r.ano >= f.anoIni && r.ano <= f.anoFim) total += Number(r.area_ha)
      for (const r of dados.prodesMunAno || []) if (r.ano >= f.anoIni && r.ano <= f.anoFim && no(r)) dentro += Number(r.area_ha)
    }
    return [
      { rotulo: 'Neste município', n: dentro, cor: PFD_COR.dentro },
      { rotulo: 'Restante do Acre', n: Math.max(0, total - dentro), cor: PFD_COR.fora },
    ]
  }
  const no = t === 'acre' || t === 'ucs' ? (id => id != null) : _pfdPred(dados, f.escopo)
  let dentro = 0, total = 0
  if (tipo === 'queimada') {
    for (const r of _pfdFogo(dados, f).linhas) {
      if (r.ano < f.anoIni || r.ano > f.anoFim) continue
      total += Number(r.focos)
      if (no(r.uc_id)) dentro += Number(r.focos)
    }
  } else {
    for (const r of dados.prodesAno || []) {
      if (r.ano >= f.anoIni && r.ano <= f.anoFim) total += Number(r.area_ha)
    }
    for (const r of dados.prodesUcAno || []) {
      if (r.ano < f.anoIni || r.ano > f.anoFim) continue
      if (no(r.uc_id)) dentro += Number(r.area_ha)
    }
  }
  const rotDentro = t === 'uc' ? 'Nesta UC'
    : t === 'esfera' ? PFD_ESFERAS.find(e => e.chave === f.escopo.slice(4))?.rotulo || 'UCs da esfera'
    : 'Dentro de UCs'
  return [
    { rotulo: rotDentro, n: dentro, cor: PFD_COR.dentro },
    { rotulo: t === 'uc' || t === 'esfera' ? 'Restante do Acre' : 'Fora de UCs', n: Math.max(0, total - dentro), cor: PFD_COR.fora },
  ]
}

// ── Por esfera (rosca, só no escopo "todas as UCs") ───────────────
function pfdPorEsfera(dados, f, tipo) {
  const esferaDe = {}
  for (const u of dados.ucs || []) esferaDe[u.id] = u.esfera
  const soma = { federal: 0, estadual: 0, municipal: 0 }
  const linhas = tipo === 'queimada' ? _pfdFogo(dados, f, false).linhas : (dados.prodesUcAno || [])
  for (const r of linhas) {
    if (!r.uc_id || r.ano < f.anoIni || r.ano > f.anoFim) continue
    const e = esferaDe[r.uc_id]
    if (soma[e] != null) soma[e] += Number(tipo === 'queimada' ? r.focos : r.area_ha)
  }
  return PFD_ESFERAS.map(e => ({ rotulo: e.rotulo, n: soma[e.chave], cor: PFD_COR[e.chave] }))
}

// ── Tendência (Mann-Kendall + inclinação de Sen) ──────────────────
// Padrão para série ambiental: não supõe distribuição normal e um ano
// extremo (a seca de 2022) não arrasta a reta, como faria a regressão
// linear. "Subindo"/"Caindo" só com p < 0,05; senão "sem tendência
// clara" — nunca inventar direção para série que só oscila.
// Ano parcial e ano sem dado ficam FORA da conta.
const PFD_TEND_MIN_ANOS = 5
function _pfdMediana(v) {
  const s = [...v].sort((a, b) => a - b), m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}
function _pfdPhi(z) {   // CDF normal padrão (Abramowitz-Stegun 7.1.26)
  const t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2)
  const erf = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(z * z) / 2)
  return z >= 0 ? (1 + erf) / 2 : (1 - erf) / 2
}
function pfdTendencia(pontos, opt) {
  const min = (opt && opt.minAnos) || PFD_TEND_MIN_ANOS
  const s = (pontos || []).filter(p => p.valor != null && !p.parcial).sort((a, b) => a.ano - b.ano)
  const n = s.length
  if (n < min) return { insuficiente: true, n, minAnos: min }
  let S = 0
  const inclinacoes = []
  for (let i = 0; i < n - 1; i++) {
    for (let j = i + 1; j < n; j++) {
      S += Math.sign(s[j].valor - s[i].valor)
      inclinacoes.push((s[j].valor - s[i].valor) / (s[j].ano - s[i].ano))
    }
  }
  const empates = {}
  for (const p of s) empates[p.valor] = (empates[p.valor] || 0) + 1
  let varS = n * (n - 1) * (2 * n + 5)
  for (const t of Object.values(empates)) if (t > 1) varS -= t * (t - 1) * (2 * t + 5)
  varS /= 18
  const z = varS > 0 ? (S > 0 ? (S - 1) : S < 0 ? (S + 1) : 0) / Math.sqrt(varS) : 0
  const p = varS > 0 ? 2 * (1 - _pfdPhi(Math.abs(z))) : 1
  const inclinacao = _pfdMediana(inclinacoes)
  const intercepto = _pfdMediana(s.map(q => q.valor - inclinacao * q.ano))
  const base = _pfdMediana(s.map(q => q.valor))
  const direcao = p < 0.05 && inclinacao !== 0 ? (inclinacao > 0 ? 'subindo' : 'caindo') : 'estavel'
  return {
    n, S, z, p, inclinacao, intercepto, direcao,
    pctAno: base > 0 ? (inclinacao / base) * 100 : null,
    anoIni: s[0].ano, anoFim: s[n - 1].ano,
  }
}
// Duas leituras: o período todo e os últimos 5 anos FECHADOS (mostra
// virada recente que a tendência longa esconde).
function pfdTendencias(pontos) {
  const fechados = (pontos || []).filter(p => p.valor != null && !p.parcial).sort((a, b) => a.ano - b.ano)
  return {
    total: pfdTendencia(fechados),
    recente: pfdTendencia(fechados.slice(-PFD_TEND_MIN_ANOS)),
  }
}

// ── Cobertura: quanto já foi desmatado × quanto resta ─────────────
// Série anual do PRODES começa em 2008; o que veio antes está na camada
// "acumulado até 2007" (dados.cobertura, migration 344). Resíduo é
// desmatamento antigo detectado tarde — conta no ano da detecção, como
// o INPE faz. Floresta que resta = área − desmatado − não floresta − rios
// (o PRODES não publica camada de floresta: é subtração, e a tela diz).
// Estado: números declarados pelo INPE; UC/esfera: interseção calculada.
function pfdCobertura(dados, f) {
  const linhas = dados.cobertura || []
  const t = pfdEscopoTipo(f.escopo)
  // Linha do ESTADO = sem UC e sem município; UC = uc_id; município = cd_ibge.
  const noUc = _pfdPred(dados, f.escopo)
  const cd = t === 'mun' ? f.escopo.slice(4) : null
  const no = t === 'acre' ? (r => r.uc_id == null && r.cd_ibge == null)
    : t === 'mun' ? (r => r.cd_ibge === cd)
    : (r => r.uc_id != null && noUc(r.uc_id))
  let area = 0, d2007 = 0, outros = 0, temArea = false
  const residuo = {}
  for (const r of linhas) {
    if (!no(r)) continue
    const v = Number(r.area_ha) || 0
    if (r.classe === 'area_total') { area += v; temArea = true }
    else if (r.classe === 'd2007') d2007 += v
    else if (r.classe === 'residuo') residuo[r.ano] = (residuo[r.ano] || 0) + v
    else outros += v   // nao_floresta + hidrografia
  }
  if (!temArea || !(area > 0)) return null
  const anual = {}
  const fonteAnual = t === 'acre' ? (dados.prodesAno || [])
    : t === 'mun' ? (dados.prodesMunAno || []).filter(r => r.cd_ibge === cd)
    : (dados.prodesUcAno || []).filter(r => noUc(r.uc_id))
  for (const r of fonteAnual) anual[r.ano] = (anual[r.ano] || 0) + Number(r.area_ha)
  const anosPublicados = (dados.prodesAno || []).map(r => r.ano)
  const ultimo = anosPublicados.length ? Math.max(...anosPublicados) : 2007
  const anoRef = Math.max(2007, Math.min(Number(f.anoFim), ultimo))
  const serie = []
  let recente = 0
  for (let a = 2007; a <= anoRef; a++) {
    if (a > 2007) recente += anual[a] || 0
    recente += residuo[a] || 0
    const desmatado = d2007 + recente
    serie.push({ ano: a, desmatado, recente, resta: Math.max(0, area - desmatado - outros) })
  }
  const fim = serie[serie.length - 1]
  return {
    anoRef, ultimoPublicado: ultimo, antesDoPeriodo: Number(f.anoFim) < 2007,
    area, d2007, recente: fim.recente, outros, desmatado: fim.desmatado, resta: fim.resta,
    pctDesmatado: (fim.desmatado / area) * 100, pctResta: (fim.resta / area) * 100,
    serie,
  }
}

// ── KPIs ──────────────────────────────────────────────────────────
function pfdKpis(dados, f) {
  const focos = pfdFocosPorAno(dados, f)
  const desm = pfdDesmatPorAno(dados, f)
  const comFoco = focos.filter(p => p.n != null)
  const comDesm = desm.filter(p => p.ha != null)
  const pico = comFoco.reduce((m, p) => (!m || p.n > m.n ? p : m), null)
  const picoD = comDesm.reduce((m, p) => (!m || p.ha > m.ha ? p : m), null)
  return {
    focos: comFoco.length ? comFoco.reduce((s, p) => s + p.n, 0) : null,
    anosFoco: comFoco.length,
    anoPicoFoco: pico,
    areaHa: comDesm.length ? comDesm.reduce((s, p) => s + p.ha, 0) : null,
    poligonos: comDesm.length ? comDesm.reduce((s, p) => s + p.poligonos, 0) : null,
    anosDesm: comDesm.length,
    anoPicoDesm: picoD,
    anosSemFoco: focos.filter(p => p.n == null).map(p => p.ano),
    anosSemDesm: desm.filter(p => p.ha == null).map(p => p.ano),
    anoParcial: focos.find(p => p.parcial)?.ano ?? null,
    anoAtualSemFoco: focos.some(p => p.n == null && p.ano === (f.hoje instanceof Date ? f.hoje : new Date()).getFullYear()),
  }
}

// ══════════════════════════════════════════════════════════════════
// Parecer: leitura escrita do recorte, montada por REGRAS a partir dos
// números desta tela + clima (ERA5) + ENSO (migration 346). Nenhuma API
// de IA: cada frase sai de uma comparação medida, e o texto diz o que é
// associação e o que ele NÃO sabe. Nunca inventa causa.
// ══════════════════════════════════════════════════════════════════
const PFD_SECA_DIAS = 122   // jun–set completo
// A série FIRMS (MODIS + VIIRS S-NPP) só tem o VIIRS a partir de 2012, e ele
// detecta muito mais focos pequenos: o Acre passa de 3.418 (2011) a 23.974
// (2012) sem o fogo ter sextuplicado. Comparar anos de um lado e do outro
// dessa virada inventa alta. Tendência e comparações do FIRMS começam aqui;
// o BDQueimadas (um satélite só) não tem essa quebra.
const PFD_FIRMS_VIIRS_DESDE = 2012

// Clima do recorte: município → o próprio; qualquer outro → estado ('AC').
function pfdClimaDoRecorte(dados, f) {
  const t = pfdEscopoTipo(f.escopo)
  const cd = t === 'mun' ? f.escopo.slice(4) : 'AC'
  const porAno = {}
  for (const r of dados.clima || []) {
    if (r.cd_ibge !== cd) continue
    porAno[r.ano] = {
      ano: Number(r.ano),
      chuvaSeca: r.chuva_seca_mm == null ? null : Number(r.chuva_seca_mm),
      diasSecos: r.dias_secos == null ? null : Number(r.dias_secos),
      maiorSeca: r.maior_seq_seca == null ? null : Number(r.maior_seq_seca),
      tmax: r.tmax_seca_c == null ? null : Number(r.tmax_seca_c),
      umidMin: r.umid_min_seca == null ? null : Number(r.umid_min_seca),
      completo: Number(r.dias_na_seca) >= PFD_SECA_DIAS,
    }
  }
  return { fonte: t === 'mun' ? 'municipio' : 'estado', porAno }
}

// ENSO da estação seca (média do ONI jun–set). ≥ 0,5 El Niño; ≤ −0,5 La Niña.
function pfdEnsoDoAno(dados, ano) {
  const v = (dados.enso || []).filter(r => Number(r.ano) === ano && r.mes >= 6 && r.mes <= 9).map(r => Number(r.oni))
  if (v.length < 4) return null
  const oni = v.reduce((a, b) => a + b, 0) / v.length
  const fase = oni >= 0.5 ? 'El Niño' : oni <= -0.5 ? 'La Niña' : 'neutro'
  const forca = Math.abs(oni) >= 1.5 ? 'forte' : Math.abs(oni) >= 1 ? 'moderado' : Math.abs(oni) >= 0.5 ? 'fraco' : ''
  return { oni, fase, forca }
}

// Spearman com postos médios nos empates. null com menos de 8 pares.
function pfdSpearman(xs, ys) {
  const pares = xs.map((x, i) => [x, ys[i]]).filter(([x, y]) => x != null && y != null)
  const n = pares.length
  if (n < 8) return null
  const postos = v => {
    const ord = v.map((x, i) => [x, i]).sort((a, b) => a[0] - b[0])
    const r = new Array(v.length)
    for (let i = 0; i < ord.length;) {
      let j = i
      while (j + 1 < ord.length && ord[j + 1][0] === ord[i][0]) j++
      for (let k = i; k <= j; k++) r[ord[k][1]] = (i + j) / 2 + 1
      i = j + 1
    }
    return r
  }
  const rx = postos(pares.map(p => p[0])), ry = postos(pares.map(p => p[1]))
  const mx = rx.reduce((a, b) => a + b, 0) / n, my = ry.reduce((a, b) => a + b, 0) / n
  let sxy = 0, sxx = 0, syy = 0
  for (let i = 0; i < n; i++) { sxy += (rx[i] - mx) * (ry[i] - my); sxx += (rx[i] - mx) ** 2; syy += (ry[i] - my) ** 2 }
  if (!sxx || !syy) return null
  const rho = sxy / Math.sqrt(sxx * syy)
  // teste t aproximado (n ≥ 8), bicaudal, pela normal
  const tt = rho * Math.sqrt((n - 2) / Math.max(1e-9, 1 - rho * rho))
  const p = 2 * (1 - _pfdPhi(Math.abs(tt)))
  return { rho, n, p }
}
function _pfdForcaRho(r) {
  const a = Math.abs(r.rho)
  return a >= 0.6 ? 'forte' : a >= 0.3 ? 'moderada' : 'fraca'
}
function _pfdPct(a, b) { return b ? ((a - b) / b) * 100 : null }
function _pfdRelMedia(pct, rot) {
  if (pct == null) return ''
  if (Math.abs(pct) < 5) return `perto da ${rot}`
  return `${_pfdNum(Math.abs(pct), 0)}% ${pct > 0 ? 'acima' : 'abaixo'} da ${rot}`
}
function _pfdVar(pct) {
  if (pct == null) return ''
  if (Math.abs(pct) < 5) return 'praticamente igual'
  return `${pct > 0 ? 'alta' : 'queda'} de ${_pfdNum(Math.abs(pct), 0)}%`
}
// posição do valor na série: "a 3ª mais seca de 25"
function _pfdRanking(serie, ano, campo, maiorPrimeiro) {
  const v = serie.filter(s => s[campo] != null && s.completo !== false)
  const alvo = v.find(s => s.ano === ano)
  if (!alvo || v.length < 5) return null
  const ord = [...v].sort((a, b) => maiorPrimeiro ? b[campo] - a[campo] : a[campo] - b[campo])
  return { pos: ord.findIndex(s => s.ano === ano) + 1, de: ord.length }
}

// Monta a leitura. Devolve { blocos: [{titulo, frases[]}], tabela: [...] }
function pfdParecer(dados, f) {
  const hoje = f.hoje instanceof Date ? f.hoje : new Date()
  const mostraFogo = f.tipo !== 'desmatamento', mostraDesm = f.tipo !== 'queimada'
  const focos = pfdFocosPorAno(dados, f)
  const desm = pfdDesmatPorAno(dados, f)
  const clima = pfdClimaDoRecorte(dados, f)
  const n = v => _pfdNum(v, 0)
  const blocos = []

  // Tabela de fatores ano a ano (o que sustenta cada frase).
  const tabela = focos.map(p => {
    const c = clima.porAno[p.ano] || null
    const d = desm.find(q => q.ano === p.ano)
    return { ano: p.ano, focos: p.n, parcial: p.parcial, desmHa: d ? d.ha : null, clima: c, enso: pfdEnsoDoAno(dados, p.ano) }
  })

  const semClima = !tabela.some(t => t.clima && t.clima.completo)
  const nomeClima = clima.fonte === 'municipio' ? 'no município' : 'no Acre (média ponderada dos 22 municípios)'

  if (mostraFogo) {
    const corteViirs = f.fonte !== 'bdq' && f.anoIni < PFD_FIRMS_VIIRS_DESDE
    const fech = focos.filter(p => p.n != null && !p.parcial && (f.fonte === 'bdq' || p.ano >= PFD_FIRMS_VIIRS_DESDE))
    const frases = []
    if (corteViirs) frases.push(`Comparações a partir de ${PFD_FIRMS_VIIRS_DESDE}: antes disso a série FIRMS não tinha o satélite VIIRS, que detecta muito mais focos pequenos — misturar os dois períodos mostraria uma alta que é do satélite, não do fogo. Para olhar antes de ${PFD_FIRMS_VIIRS_DESDE}, use a fonte BDQueimadas.`)
    if (fech.length < 2) {
      frases.push('Período com menos de dois anos fechados de focos — não há comparação a fazer.')
    } else {
      const ult = fech[fech.length - 1], ant = fech[fech.length - 2]
      const media = fech.reduce((a, p) => a + p.n, 0) / fech.length
      const pico = fech.reduce((m, p) => (p.n > m.n ? p : m))
      frases.push(`Em ${ult.ano}, ${n(ult.n)} focos: ${_pfdVar(_pfdPct(ult.n, ant.n))} em relação a ${ant.ano} (${n(ant.n)}), ${_pfdRelMedia(_pfdPct(ult.n, media), `média de ${fech[0].ano} a ${ult.ano}`)} (${n(media)} por ano).`)
      if (pico.ano !== ult.ano) frases.push(`O ano com mais focos no período foi ${pico.ano} (${n(pico.n)}).`)
      else frases.push(`${ult.ano} é o ano com mais focos do período.`)
      const tt = pfdTendencias(fech.map(p => ({ ano: p.ano, valor: p.n })))
      frases.push(`Tendência${corteViirs ? ` desde ${PFD_FIRMS_VIIRS_DESDE}` : ' do período'}: ${pfdTendenciaFrase(tt.total, 'focos')}.`)

      // Clima do último ano fechado
      const c = clima.porAno[ult.ano]
      const serieC = Object.values(clima.porAno)
      if (c && c.completo) {
        const medChuva = _pfdMediana(serieC.filter(s => s.completo && s.chuvaSeca != null).map(s => s.chuvaSeca))
        const rk = _pfdRanking(serieC, ult.ano, 'chuvaSeca', false)
        const pctChuva = _pfdPct(c.chuvaSeca, medChuva)
        const posTxt = !rk ? '' : rk.pos <= Math.ceil(rk.de / 2)
          ? `, a ${rk.pos}ª mais seca de ${rk.de} anos` : `, a ${rk.de - rk.pos + 1}ª mais chuvosa de ${rk.de} anos`
        frases.push(`Clima ${nomeClima}, estação seca de ${ult.ano} (jun–set): ${n(c.chuvaSeca)} mm de chuva (${_pfdRelMedia(pctChuva, `mediana de ${n(medChuva)} mm`)})${posTxt}; ${n(c.diasSecos)} dias sem chuva e maior sequência seca de ${n(c.maiorSeca)} dias.`)
        const e = pfdEnsoDoAno(dados, ult.ano)
        if (e) frases.push(e.fase === 'neutro'
          ? `Oceano Pacífico em fase neutra na estação seca de ${ult.ano} (ONI ${_pfdNum(e.oni, 1)}).`
          : `${e.fase} ${e.forca} na estação seca de ${ult.ano} (ONI ${_pfdNum(e.oni, 1)})${e.fase === 'El Niño' ? ' — fase associada a secas mais severas no sudoeste da Amazônia' : ' — fase que costuma trazer mais chuva à região'}.`)
        // Leitura combinada: direção dos focos × estação seca
        const subiu = ult.n > ant.n * 1.05, caiu = ult.n < ant.n * 0.95
        const cAnt = clima.porAno[ant.ano]
        const maisSeca = cAnt && cAnt.completo && c.chuvaSeca < cAnt.chuvaSeca * 0.9
        const maisUmida = cAnt && cAnt.completo && c.chuvaSeca > cAnt.chuvaSeca * 1.1
        if (subiu && maisSeca) frases.push(`A alta é coerente com uma estação seca mais seca que a de ${ant.ano}: menos chuva deixa a vegetação e o material das derrubadas mais inflamáveis.`)
        else if (subiu && maisUmida) frases.push(`A alta aconteceu mesmo com uma estação seca mais chuvosa que a de ${ant.ano} — o clima não a explica. Ficam como hipóteses a verificar em campo: mais queima de áreas desmatadas ou de pastagem, e mudança no esforço de fiscalização.`)
        else if (caiu && maisUmida) frases.push(`A queda é coerente com uma estação seca mais chuvosa que a de ${ant.ano}.`)
        else if (caiu && maisSeca) frases.push(`A queda aconteceu apesar de uma estação seca mais seca que a de ${ant.ano} — o clima jogou contra, então outros fatores (prevenção, fiscalização, menos área derrubada para queimar) podem ter pesado; o sistema não mede esses fatores.`)
        else if (subiu || caiu) frases.push(`A chuva da estação seca foi parecida com a de ${ant.ano}; a variação dos focos não se explica pelo volume de chuva.`)
      } else if (!semClima) {
        frases.push(`Sem dado de clima completo para a estação seca de ${ult.ano} neste recorte.`)
      }

      // Associação no período
      const noCorte = t => f.fonte === 'bdq' || t.ano >= PFD_FIRMS_VIIRS_DESDE
      const pares = tabela.filter(t => t.focos != null && !t.parcial && noCorte(t) && t.clima && t.clima.completo)
      const rDias = pfdSpearman(pares.map(t => t.clima.diasSecos), pares.map(t => t.focos))
      const rChuva = pfdSpearman(pares.map(t => t.clima.chuvaSeca), pares.map(t => t.focos))
      const r = rDias && rChuva ? (Math.abs(rDias.rho) >= Math.abs(rChuva.rho) ? { ...rDias, var: 'dias sem chuva' } : { ...rChuva, var: 'chuva da estação seca' }) : null
      if (r) {
        if (r.p < 0.05) {
          const sentido = (r.var === 'dias sem chuva') === (r.rho > 0) ? 'anos mais secos tiveram mais focos' : 'anos mais secos tiveram MENOS focos (relação contrária à esperada)'
          frases.push(`No período (${r.n} anos), ${sentido}: correlação ${_pfdForcaRho(r)} entre focos e ${r.var} (Spearman ρ = ${_pfdNum(r.rho, 2)}). É associação, não prova de causa.`)
        } else {
          frases.push(`No período (${r.n} anos), a quantidade de focos não acompanhou de forma clara a seca de cada ano (Spearman ρ = ${_pfdNum(r.rho, 2)}, sem significância) — outros fatores, como o uso do solo, parecem pesar mais.`)
        }
      }
      if (mostraDesm) {
        const pd = tabela.filter(t => t.focos != null && !t.parcial && noCorte(t) && t.desmHa != null)
        const rd = pfdSpearman(pd.map(t => t.desmHa), pd.map(t => t.focos))
        if (rd && rd.p < 0.05) frases.push(`Focos e desmatamento andaram juntos no período (Spearman ρ = ${_pfdNum(rd.rho, 2)}, ${rd.n} anos): na Amazônia, boa parte do fogo é a queima do material derrubado.`)
        else if (rd) frases.push(`Focos e desmatamento não andaram juntos de forma clara no período (Spearman ρ = ${_pfdNum(rd.rho, 2)}, ${rd.n} anos).`)
      }
    }
    const parcial = focos.find(p => p.parcial && p.n != null)
    if (parcial) frases.push(`${parcial.ano} ainda está em curso: ${n(parcial.n)} focos até agora, fora das comparações acima.`)
    blocos.push({ titulo: 'Queimadas', frases })
  }

  if (mostraDesm) {
    const fech = desm.filter(p => p.ha != null)
    const frases = []
    if (fech.length < 2) {
      frases.push('Período com menos de dois anos do PRODES — não há comparação a fazer.')
    } else {
      const ult = fech[fech.length - 1], ant = fech[fech.length - 2]
      const media = fech.reduce((a, p) => a + p.ha, 0) / fech.length
      frases.push(`No ano-PRODES ${ult.ano} (ago/${ult.ano - 1} a jul/${ult.ano}), ${n(ult.ha)} ha desmatados: ${_pfdVar(_pfdPct(ult.ha, ant.ha))} em relação a ${ant.ano}, ${_pfdRelMedia(_pfdPct(ult.ha, media), 'média do período')} (${n(media)} ha/ano).`)
      const tt = pfdTendencias(desm.map(p => ({ ano: p.ano, valor: p.ha })))
      frases.push(`Tendência do período: ${pfdTendenciaFrase(tt.total, 'ha')}.`)
      frases.push('O desmatamento responde sobretudo a fatores que esta base não mede — fiscalização, preço da terra e do gado, crédito, abertura de estradas —; por isso o texto não atribui causa às variações.')
    }
    blocos.push({ titulo: 'Desmatamento', frases })
  }

  const avisos = []
  if (semClima) avisos.push(clima.fonte === 'municipio'
    ? 'Dados de clima deste município ainda em carga (a série de 2001 em diante entra aos poucos, dentro da cota gratuita da fonte) — a leitura climática aparece assim que chegar.'
    : 'Dados de clima do estado ainda em carga: a média do Acre só é calculada quando os 22 municípios estão completos.')
  if (pfdEscopoTipo(f.escopo) !== 'mun' && pfdEscopoTipo(f.escopo) !== 'acre') avisos.push('Para UCs, o clima usado é a média do estado.')
  return { blocos, tabela, avisos, fonteClima: clima.fonte, ano: hoje.getFullYear() }
}

// Parecer em HTML: blocos de texto + tabela de fatores (dentro de .table-wrap).
function pfdParecerHTML(par) {
  const n = v => v == null ? '—' : _pfdNum(v, 0)
  const blocos = par.blocos.map(b => `<div class="pfd-par-bloco"><h4>${_pfdEsc(b.titulo)}</h4>
    ${b.frases.map(fr => `<p>${_pfdEsc(fr)}</p>`).join('')}</div>`).join('')
  const linhas = [...par.tabela].reverse().map(t => {
    const c = t.clima && t.clima.completo ? t.clima : null
    const e = t.enso ? (t.enso.fase === 'neutro' ? 'Neutro' : `${t.enso.fase} ${t.enso.forca}`) : '—'
    return `<tr><td>${t.ano}${t.parcial ? ' <small>(parcial)</small>' : ''}</td><td class="num">${n(t.focos)}</td><td class="num">${n(t.desmHa)}</td>
      <td class="num">${c ? n(c.chuvaSeca) : '—'}</td><td class="num">${c ? n(c.diasSecos) : '—'}</td><td class="num">${c ? n(c.maiorSeca) : '—'}</td>
      <td class="num">${c && c.tmax != null ? _pfdNum(c.tmax, 1) : '—'}</td><td>${_pfdEsc(e)}</td></tr>`
  }).join('')
  return `${par.avisos.map(a => `<p class="pfd-aviso">${_pfdEsc(a)}</p>`).join('')}
  <div class="pfd-par">${blocos}</div>
  <details class="pfd-par-fatores"><summary>Fatores ano a ano (a base de cada frase)</summary>
    <div class="table-wrap"><table class="pfd-tabela"><thead><tr><th>Ano</th><th>Focos</th><th>Desmatamento (ha)</th>
      <th>Chuva jun–set (mm)</th><th>Dias sem chuva</th><th>Maior seca (dias)</th><th>Máx. média (°C)</th><th>ENSO</th></tr></thead>
      <tbody>${linhas}</tbody></table></div></details>
  <p class="pfd-par-nota">Texto montado automaticamente, por regras fixas, a partir dos números desta tela, do clima ERA5
    (Open-Meteo, ${par.fonteClima === 'municipio' ? 'ponto central do município' : 'média ponderada dos municípios'}) e do índice ONI (NOAA).
    Descreve associações medidas; não é parecer técnico assinado.</p>`
}

// ══════════════════════════════════════════════════════════════════
// Gráficos (SVG à mão — o projeto não usa lib de gráfico)
// ══════════════════════════════════════════════════════════════════
function _pfdEnvolver(svg, rotulo) {
  return typeof graficoTecladoEnvolver === 'function'
    ? graficoTecladoEnvolver(svg, { rotulo })
    : svg
}
function _pfdTeto(max) {
  if (!(max > 0)) return 1
  const p = Math.pow(10, Math.floor(Math.log10(max)))
  const passos = [1, 2, 2.5, 5, 10]
  for (const s of passos) if (s * p >= max) return s * p
  return 10 * p
}
function _pfdCompacto(v) {
  if (v >= 1e6) return _pfdNum(v / 1e6, 1) + ' mi'
  if (v >= 1e3) return _pfdNum(v / 1e3, v >= 1e4 ? 0 : 1) + ' mil'
  return _pfdNum(v)
}
function _pfdVazio(msg) {
  return `<p class="pfd-vazio">${_pfdEsc(msg)}</p>`
}

// Linha (série no tempo). pontos: [{rotulo, valor|null, parcial}]
function pfdLinhaHTML(pontos, o) {
  const validos = pontos.filter(p => p.valor != null)
  if (!validos.length) return _pfdVazio(o.vazio || 'Sem dados no período.')
  const W = 640, H = 240, m = { t: 16, r: 16, b: 32, l: 52 }
  const iw = W - m.l - m.r, ih = H - m.t - m.b
  const teto = _pfdTeto(Math.max(...validos.map(p => p.valor)))
  const x = i => m.l + (pontos.length === 1 ? iw / 2 : (i * iw) / (pontos.length - 1))
  const y = v => m.t + ih - (v / teto) * ih
  const grade = [0, 0.25, 0.5, 0.75, 1].map(k => {
    const yy = m.t + ih - k * ih
    return `<line x1="${m.l}" x2="${W - m.r}" y1="${yy}" y2="${yy}" stroke="${PFD_COR.grade}" stroke-width="1"/>
<text x="${m.l - 8}" y="${yy + 4}" text-anchor="end" font-size="11" fill="${PFD_COR.eixo}">${_pfdCompacto(teto * k)}</text>`
  }).join('')
  // Segmentos só entre anos consecutivos com dado: ano sem registro
  // quebra a linha em vez de fingir continuidade.
  let caminho = '', aberto = false
  pontos.forEach((p, i) => {
    if (p.valor == null) { aberto = false; return }
    caminho += `${aberto ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.valor).toFixed(1)} `
    aberto = true
  })
  const passo = Math.max(1, Math.ceil(pontos.length / 12))
  const rotX = pontos.map((p, i) => ((pontos.length - 1 - i) % passo === 0)
    ? `<text x="${x(i)}" y="${H - 10}" text-anchor="middle" font-size="11" fill="${PFD_COR.eixo}">${_pfdEsc(p.rotulo)}</text>` : '').join('')
  const marcas = pontos.map((p, i) => p.valor == null ? '' :
    `<circle cx="${x(i)}" cy="${y(p.valor)}" r="4.5" fill="${p.parcial ? '#fff' : o.cor}" stroke="${o.cor}" stroke-width="2"><title>${_pfdEsc(p.rotulo)} — ${_pfdNum(p.valor, o.casas)} ${_pfdEsc(o.unidade)}${p.parcial ? ' (parcial)' : ''}</title></circle>`).join('')
  const svg = `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="${_pfdEsc(o.rotulo)}">
${grade}<path d="${caminho}" fill="none" stroke="${o.cor}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
${marcas}${rotX}</svg>`
  return _pfdEnvolver(svg, o.rotulo)
}

// Área (acumulado). Mesmo eixo X da linha; preenchimento translúcido.
function pfdAreaHTML(pontos, o) {
  const validos = pontos.filter(p => p.valor != null)
  if (!validos.length) return _pfdVazio(o.vazio || 'Sem dados no período.')
  const W = 640, H = 240, m = { t: 16, r: 16, b: 32, l: 60 }
  const iw = W - m.l - m.r, ih = H - m.t - m.b
  const teto = _pfdTeto(Math.max(...validos.map(p => p.valor)))
  const x = i => m.l + (pontos.length === 1 ? iw / 2 : (i * iw) / (pontos.length - 1))
  const y = v => m.t + ih - (v / teto) * ih
  const grade = [0, 0.25, 0.5, 0.75, 1].map(k => {
    const yy = m.t + ih - k * ih
    return `<line x1="${m.l}" x2="${W - m.r}" y1="${yy}" y2="${yy}" stroke="${PFD_COR.grade}" stroke-width="1"/>
<text x="${m.l - 8}" y="${yy + 4}" text-anchor="end" font-size="11" fill="${PFD_COR.eixo}">${_pfdCompacto(teto * k)}</text>`
  }).join('')
  const idx = pontos.map((p, i) => (p.valor == null ? null : i)).filter(i => i != null)
  const topo = idx.map((i, k) => `${k ? 'L' : 'M'}${x(i).toFixed(1)},${y(pontos[i].valor).toFixed(1)}`).join(' ')
  const base = m.t + ih
  const area = `${topo} L${x(idx[idx.length - 1]).toFixed(1)},${base} L${x(idx[0]).toFixed(1)},${base} Z`
  const passo = Math.max(1, Math.ceil(pontos.length / 12))
  const rotX = pontos.map((p, i) => ((pontos.length - 1 - i) % passo === 0)
    ? `<text x="${x(i)}" y="${H - 10}" text-anchor="middle" font-size="11" fill="${PFD_COR.eixo}">${_pfdEsc(p.rotulo)}</text>` : '').join('')
  const marcas = idx.map(i => `<circle cx="${x(i)}" cy="${y(pontos[i].valor)}" r="4" fill="${o.cor}" stroke="#fff" stroke-width="2"><title>${_pfdEsc(pontos[i].rotulo)} — ${_pfdNum(pontos[i].valor)} ${_pfdEsc(o.unidade)}</title></circle>`).join('')
  const svg = `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="${_pfdEsc(o.rotulo)}">
${grade}<path d="${area}" fill="${o.cor}" fill-opacity=".18"/>
<path d="${topo}" fill="none" stroke="${o.cor}" stroke-width="2" stroke-linejoin="round"/>
${marcas}${rotX}</svg>`
  return _pfdEnvolver(svg, o.rotulo)
}

// Barras verticais (por ano ou por mês).
// Lista de anos em faixas: [2008..2022, 2025] → "2008–2022 e 2025".
function pfdFaixasAnos(anos) {
  const l = [...new Set(anos)].sort((a, b) => a - b)
  const partes = []
  for (let i = 0; i < l.length; i++) {
    let j = i
    while (j + 1 < l.length && l[j + 1] === l[j] + 1) j++
    partes.push(j - i >= 2 ? `${l[i]}–${l[j]}` : l.slice(i, j + 1).join(', '))
    i = j
  }
  return partes.length > 1 ? partes.slice(0, -1).join(', ') + ' e ' + partes[partes.length - 1] : (partes[0] || '')
}

function pfdBarrasHTML(pontos, o) {
  const validos = pontos.filter(p => p.valor != null)
  if (!validos.length || !validos.some(p => p.valor > 0)) return _pfdVazio(o.vazio || 'Sem dados no período.')
  const W = 640, H = 240, m = { t: 22, r: 12, b: 32, l: 52 }
  const iw = W - m.l - m.r, ih = H - m.t - m.b
  const teto = _pfdTeto(Math.max(...validos.map(p => p.valor)))
  const faixa = iw / pontos.length
  const larg = Math.max(6, Math.min(56, faixa - 6))   // 2px+ de vão entre barras
  const grade = [0, 0.5, 1].map(k => {
    const yy = m.t + ih - k * ih
    return `<line x1="${m.l}" x2="${W - m.r}" y1="${yy}" y2="${yy}" stroke="${PFD_COR.grade}" stroke-width="1"/>
<text x="${m.l - 8}" y="${yy + 4}" text-anchor="end" font-size="11" fill="${PFD_COR.eixo}">${_pfdCompacto(teto * k)}</text>`
  }).join('')
  const rotulosVisiveis = pontos.length <= 8
  // Eixo com muitos anos: rótulo a cada N barras, contado a partir do
  // ÚLTIMO (o ano mais recente sempre tem rótulo), senão os anos se atropelam.
  const passo = Math.max(1, Math.ceil(pontos.length / 10))
  const barras = pontos.map((p, i) => {
    const cx = m.l + faixa * i + faixa / 2
    const rot = ((pontos.length - 1 - i) % passo) ? '' : `<text x="${cx}" y="${H - 10}" text-anchor="middle" font-size="11" fill="${PFD_COR.eixo}">${_pfdEsc(p.rotulo)}</text>`
    if (p.valor == null) return rot
    const h = Math.max(p.valor > 0 ? 2 : 0, (p.valor / teto) * ih)
    const yy = m.t + ih - h
    const r = Math.min(4, larg / 2, h)
    // cantos arredondados só no topo (ponta do dado), base reta na linha zero
    const d = `M${cx - larg / 2},${m.t + ih} V${yy + r} Q${cx - larg / 2},${yy} ${cx - larg / 2 + r},${yy} H${cx + larg / 2 - r} Q${cx + larg / 2},${yy} ${cx + larg / 2},${yy + r} V${m.t + ih} Z`
    const valor = rotulosVisiveis ? `<text x="${cx}" y="${yy - 6}" text-anchor="middle" font-size="11" font-weight="600" fill="${PFD_COR.texto}">${_pfdCompacto(p.valor)}</text>` : ''
    return `<path d="${d}" fill="${o.cor}"><title>${_pfdEsc(p.rotuloLongo || p.rotulo)} — ${_pfdNum(p.valor, o.casas)} ${_pfdEsc(o.unidade)}</title></path>${valor}${rot}`
  }).join('')
  const svg = `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="${_pfdEsc(o.rotulo)}">${grade}${barras}</svg>`
  return _pfdEnvolver(svg, o.rotulo)
}

// Ranking horizontal (UCs). A UC escolhida no filtro fica destacada; as
// demais em tom claro do MESMO matiz (cor segue a entidade, não o rank).
function pfdRankingHTML(itens, o) {
  const lista = itens.filter(i => i.valor > 0).slice(0, o.max || 10)
  if (!lista.length) return _pfdVazio(o.vazio || 'Nenhuma UC com registro no período.')
  const linhaH = 30, W = 640, rotW = 230, valW = 90
  const H = lista.length * linhaH + 8
  const teto = lista[0].valor
  const iw = W - rotW - valW
  const barras = lista.map((it, i) => {
    const yy = 4 + i * linhaH
    const w = Math.max(2, (it.valor / teto) * iw)
    const destaque = !o.destaque || o.destaque === it.uc_id
    const nome = it.nome.length > 34 ? it.nome.slice(0, 33) + '…' : it.nome
    return `<text x="${rotW - 10}" y="${yy + 18}" text-anchor="end" font-size="12" fill="${PFD_COR.texto}" font-weight="${o.destaque === it.uc_id ? 700 : 400}">${_pfdEsc(nome)}</text>
<rect x="${rotW}" y="${yy + 6}" width="${w.toFixed(1)}" height="16" rx="4" fill="${o.cor}" fill-opacity="${destaque ? 1 : 0.35}"><title>${_pfdEsc(it.nome)} — ${_pfdNum(it.valor, o.casas)} ${_pfdEsc(o.unidade)}</title></rect>
<text x="${rotW + w + 8}" y="${yy + 18}" font-size="12" font-weight="600" fill="${PFD_COR.texto}">${_pfdCompacto(it.valor)}</text>`
  }).join('')
  const svg = `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="${_pfdEsc(o.rotulo)}">${barras}</svg>`
  return _pfdEnvolver(svg, o.rotulo)
}

// Rosca (2 fatias com vão de 2px + rótulo direto em cada fatia na legenda).
function pfdRoscaHTML(itens, o) {
  const total = itens.reduce((s, i) => s + (Number(i.n) || 0), 0)
  if (!total) return _pfdVazio(o.vazio || 'Sem dados no período.')
  const R = 70, r = 46, cx = 90, cy = 90
  let ang = -Math.PI / 2
  const vao = itens.filter(i => i.n > 0).length > 1 ? 0.02 : 0
  const fatias = itens.map(it => {
    if (!it.n) return ''
    const frac = it.n / total
    const a0 = ang + vao / 2, a1 = ang + frac * 2 * Math.PI - vao / 2
    ang += frac * 2 * Math.PI
    const grande = a1 - a0 > Math.PI ? 1 : 0
    const p = (rr, a) => `${(cx + rr * Math.cos(a)).toFixed(2)},${(cy + rr * Math.sin(a)).toFixed(2)}`
    const d = frac >= 0.9999
      ? `M${cx - R},${cy} A${R},${R} 0 1,1 ${cx + R},${cy} A${R},${R} 0 1,1 ${cx - R},${cy} M${cx - r},${cy} A${r},${r} 0 1,0 ${cx + r},${cy} A${r},${r} 0 1,0 ${cx - r},${cy} Z`
      : `M${p(R, a0)} A${R},${R} 0 ${grande},1 ${p(R, a1)} L${p(r, a1)} A${r},${r} 0 ${grande},0 ${p(r, a0)} Z`
    return `<path d="${d}" fill="${it.cor}" fill-rule="evenodd"><title>${_pfdEsc(it.rotulo)} — ${_pfdNum(it.n, o.casas)} ${_pfdEsc(o.unidade)} (${_pfdNum((it.n / total) * 100, 1)}%)</title></path>`
  }).join('')
  const svg = `<svg viewBox="0 0 180 180" width="180" height="180" role="img" aria-label="${_pfdEsc(o.rotulo)}">${fatias}
<text x="${cx}" y="${cy + 2}" text-anchor="middle" font-size="18" font-weight="700" fill="#111827" font-family="var(--font-sans, 'DM Sans', sans-serif)">${_pfdEsc(o.centro ? o.centro.valor : _pfdCompacto(total))}</text>
<text x="${cx}" y="${cy + 18}" text-anchor="middle" font-size="10" fill="${PFD_COR.eixo}">${_pfdEsc(o.centro ? o.centro.rotulo : o.unidade)}</text></svg>`
  const legenda = itens.map(it => `<li><span class="pfd-dot" style="background:${it.cor}"></span>
<span class="pfd-leg-rot">${_pfdEsc(it.rotulo)}</span>
<span class="pfd-leg-val">${_pfdNum(it.n, o.casas)} <small>${_pfdNum((it.n / total) * 100, 1)}%</small></span></li>`).join('')
  return `<div class="pfd-rosca">${_pfdEnvolver(svg, o.rotulo)}<ul class="pfd-legenda">${legenda}</ul></div>`
}

// Tendência: barras claras (os anos) + reta de Sen do período todo
// (contínua) e dos últimos anos (tracejada). A reta só cobre os anos que
// entraram na conta; o ano parcial aparece vazado, fora dela.
function pfdTendenciaHTML(pontos, tt, o) {
  const validos = pontos.filter(p => p.valor != null)
  if (!validos.length) return _pfdVazio(o.vazio || 'Sem dados no período.')
  // card largo (linha inteira da grade): viewBox largo, senão o SVG
  // escala e o texto do eixo fica do dobro do tamanho dos outros cards
  const W = 1200, H = 260, m = { t: 16, r: 16, b: 32, l: 56 }
  const iw = W - m.l - m.r, ih = H - m.t - m.b
  const reta = t => (t && !t.insuficiente) ? [t.anoIni, t.anoFim].map(a => Math.max(0, t.intercepto + t.inclinacao * a)) : []
  const teto = _pfdTeto(Math.max(...validos.map(p => p.valor), ...reta(tt.total), ...reta(tt.recente)))
  const faixa = iw / pontos.length
  const larg = Math.max(6, Math.min(48, faixa - 8))
  const idxAno = {}
  pontos.forEach((p, i) => { idxAno[p.ano] = i })
  const cx = i => m.l + faixa * i + faixa / 2
  const y = v => m.t + ih - (Math.max(0, v) / teto) * ih
  const grade = [0, 0.5, 1].map(k => {
    const yy = m.t + ih - k * ih
    return `<line x1="${m.l}" x2="${W - m.r}" y1="${yy}" y2="${yy}" stroke="${PFD_COR.grade}" stroke-width="1"/>
<text x="${m.l - 8}" y="${yy + 4}" text-anchor="end" font-size="11" fill="${PFD_COR.eixo}">${_pfdCompacto(teto * k)}</text>`
  }).join('')
  const passo = Math.max(1, Math.ceil(pontos.length / 20))
  const barras = pontos.map((p, i) => {
    const rot = ((pontos.length - 1 - i) % passo) ? '' : `<text x="${cx(i)}" y="${H - 10}" text-anchor="middle" font-size="11" fill="${PFD_COR.eixo}">${_pfdEsc(p.rotulo)}</text>`
    if (p.valor == null) return rot
    const h = Math.max(p.valor > 0 ? 2 : 0, (p.valor / teto) * ih)
    const estilo = p.parcial
      ? `fill="#fff" stroke="${o.cor}" stroke-width="1.5" stroke-dasharray="3 2"`
      : `fill="${o.cor}" fill-opacity=".28"`
    return `<rect data-gt-ponto x="${(cx(i) - larg / 2).toFixed(1)}" y="${(m.t + ih - h).toFixed(1)}" width="${larg.toFixed(1)}" height="${h.toFixed(1)}" rx="2" ${estilo}><title>${_pfdEsc(p.rotulo)} — ${_pfdNum(p.valor, o.casas)} ${_pfdEsc(o.unidade)}${p.parcial ? ' (parcial, fora da tendência)' : ''}</title></rect>${rot}`
  }).join('')
  const linha = (t, tracejada, nome) => {
    if (!t || t.insuficiente || idxAno[t.anoIni] == null || idxAno[t.anoFim] == null) return ''
    const [v0, v1] = reta(t)
    return `<line x1="${cx(idxAno[t.anoIni]).toFixed(1)}" y1="${y(v0).toFixed(1)}" x2="${cx(idxAno[t.anoFim]).toFixed(1)}" y2="${y(v1).toFixed(1)}"
 stroke="${PFD_COR[t.direcao]}" stroke-width="${tracejada ? 2.5 : 3}" stroke-linecap="round"${tracejada ? ' stroke-dasharray="7 5"' : ''}><title>${_pfdEsc(nome)} ${t.anoIni}–${t.anoFim}: ${_pfdEsc(pfdTendenciaFrase(t, o.unidade, o.casas))}</title></line>`
  }
  const svg = `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="${_pfdEsc(o.rotulo)}">${grade}${barras}
${linha(tt.total, false, 'Tendência do período')}${linha(tt.recente, true, 'Tendência recente')}</svg>`
  return _pfdEnvolver(svg, o.rotulo)
}

function pfdTendenciaFrase(t, unidade, casas) {
  if (!t || t.insuficiente) return `período curto demais para indicar tendência (${t ? t.n : 0} ano(s) fechado(s); mínimo ${PFD_TEND_MIN_ANOS})`
  const sinal = t.inclinacao > 0 ? '+' : t.inclinacao < 0 ? '−' : ''
  const ritmo = `${sinal}${_pfdNum(Math.abs(t.inclinacao), casas ?? 0)} ${unidade}/ano${t.pctAno != null ? ` (${sinal}${_pfdNum(Math.abs(t.pctAno), 1)}%/ano)` : ''}`
  if (t.direcao === 'estavel') return `sem tendência clara — os anos oscilam sem direção definida (p = ${_pfdNum(t.p, 2)})`
  return `${t.direcao === 'subindo' ? 'subindo' : 'caindo'} · ${ritmo}`
}

// Veredito em destaque, uma linha por leitura. Seta + palavra + cor:
// a direção nunca depende só da cor.
function pfdTendenciaResumoHTML(tt, unidade, casas) {
  const seta = { subindo: 'M12 19V5M5 12l7-7 7 7', caindo: 'M12 5v14M19 12l-7 7-7-7', estavel: 'M5 12h14' }
  const titulo = { subindo: 'Subindo', caindo: 'Caindo', estavel: 'Sem tendência clara' }
  const linha = (nome, t, tracejada) => {
    const dir = t && !t.insuficiente ? t.direcao : 'estavel'
    const cab = t && !t.insuficiente ? titulo[dir] : 'Dados insuficientes'
    const periodo = t && !t.insuficiente ? ` (${t.anoIni}–${t.anoFim})` : ''
    const frase = pfdTendenciaFrase(t, unidade, casas)
    const detalhe = !t || t.insuficiente ? frase
      : dir === 'estavel' ? `os anos oscilam sem direção definida (p = ${_pfdNum(t.p, 2)})`
      : frase.split(' · ')[1]
    return `<li class="pfd-tend-item" data-direcao="${t && !t.insuficiente ? dir : 'insuficiente'}">
  <span class="pfd-tend-traco${tracejada ? ' tracejado' : ''}" style="--c:${PFD_COR[dir]}"></span>
  <span class="pfd-tend-nome">${_pfdEsc(nome)}${periodo}</span>
  <span class="pfd-tend-veredito" style="color:${PFD_COR[dir]}"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${seta[dir]}"/></svg>${_pfdEsc(cab)}</span>
  <span class="pfd-tend-detalhe">${_pfdEsc(detalhe)}</span></li>`
  }
  return `<ul class="pfd-tend">${linha('Período todo', tt.total, false)}${linha(`Últimos ${PFD_TEND_MIN_ANOS} anos`, tt.recente, true)}</ul>`
}

// Área empilhada 100% da área (estado ou recorte): camadas de baixo para
// cima, topo = área total. Uma coluna invisível por ano carrega o <title>
// com TODAS as camadas daquele ano — é a régua do teclado (data-gt-ponto)
// e do tooltip, sem cobrir a leitura das faixas.
// pontos: [{rotulo, valores:{chave: número}}]; camadas: [{chave, rotulo, cor}]
function pfdEmpilhadaHTML(pontos, camadas, o) {
  if (!pontos.length || !(o.total > 0)) return _pfdVazio(o.vazio || 'Sem dados no período.')
  const W = 640, H = 260, m = { t: 16, r: 16, b: 32, l: 60 }
  const iw = W - m.l - m.r, ih = H - m.t - m.b
  const teto = o.total
  const x = i => m.l + (pontos.length === 1 ? iw / 2 : (i * iw) / (pontos.length - 1))
  const y = v => m.t + ih - (v / teto) * ih
  const grade = [0, 0.25, 0.5, 0.75, 1].map(k => {
    const yy = m.t + ih - k * ih
    return `<line x1="${m.l}" x2="${W - m.r}" y1="${yy}" y2="${yy}" stroke="${PFD_COR.grade}" stroke-width="1"/>
<text x="${m.l - 8}" y="${yy + 4}" text-anchor="end" font-size="11" fill="${PFD_COR.eixo}">${_pfdNum(k * 100)}%</text>`
  }).join('')
  // Um só ano: vira faixa de largura mínima, nunca some.
  const xs = pontos.length === 1 ? [m.l + iw / 2 - 20, m.l + iw / 2 + 20] : null
  const px = i => (xs ? (i === 0 ? xs[0] : xs[1]) : x(i))
  const idx = pontos.length === 1 ? [0, 0] : pontos.map((_, i) => i)
  let base = idx.map(() => 0)
  const faixas = camadas.map(c => {
    const topo = idx.map((i, k) => base[k] + (Number(pontos[i].valores[c.chave]) || 0))
    const cima = idx.map((i, k) => `${k ? 'L' : 'M'}${px(k).toFixed(1)},${y(topo[k]).toFixed(1)}`).join(' ')
    const baixo = idx.map((i, k) => `L${px(idx.length - 1 - k).toFixed(1)},${y(base[idx.length - 1 - k]).toFixed(1)}`).join(' ')
    base = topo
    // borda branca de 2px no topo de cada faixa: o vão entre as camadas
    return `<path d="${cima} ${baixo} Z" fill="${c.cor}"/><path d="${cima}" fill="none" stroke="#fff" stroke-width="2"/>`
  }).join('')
  const passo = Math.max(1, Math.ceil(pontos.length / 10))
  const rotX = pontos.map((p, i) => ((pontos.length - 1 - i) % passo)
    ? '' : `<text x="${px(pontos.length === 1 ? 0 : i) + (pontos.length === 1 ? 20 : 0)}" y="${H - 10}" text-anchor="middle" font-size="11" fill="${PFD_COR.eixo}">${_pfdEsc(p.rotulo)}</text>`).join('')
  const larg = pontos.length === 1 ? 40 : iw / Math.max(1, pontos.length - 1)
  const alvos = pontos.map((p, i) => {
    const cx = pontos.length === 1 ? m.l + iw / 2 : x(i)
    const partes = camadas.map(c => {
      const v = Number(p.valores[c.chave]) || 0
      return `${c.rotulo} ${_pfdNum(v)} ${o.unidade} (${_pfdNum((v / teto) * 100, 1)}%)`
    }).join(' · ')
    return `<rect data-gt-ponto x="${(cx - larg / 2).toFixed(1)}" y="${m.t}" width="${larg.toFixed(1)}" height="${ih}" fill="transparent"><title>${_pfdEsc(p.rotulo)} — ${_pfdEsc(partes)}</title></rect>`
  }).join('')
  const svg = `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="${_pfdEsc(o.rotulo)}">${faixas}${grade}${rotX}${alvos}</svg>`
  const legenda = camadas.slice().reverse().map(c => {
    const ult = Number(pontos[pontos.length - 1].valores[c.chave]) || 0
    return `<li><span class="pfd-dot" style="background:${c.cor}"></span><span class="pfd-leg-rot">${_pfdEsc(c.rotulo)}</span>
<span class="pfd-leg-val">${_pfdNum(ult)} <small>${_pfdNum((ult / teto) * 100, 1)}%</small></span></li>`
  }).join('')
  return `${_pfdEnvolver(svg, o.rotulo)}<ul class="pfd-legenda pfd-legenda-linha">${legenda}</ul>`
}

if (typeof window !== 'undefined') {
  Object.assign(window, {
    PFD_COR, PFD_MESES, pfdFocosPorAno, pfdFocosPorMes, pfdDesmatPorAno, pfdAcumulado,
    PFD_ESFERAS, PFD_TEND_MIN_ANOS, pfdCobertura, pfdEmpilhadaHTML, pfdEscopoTipo, pfdPorEsfera, pfdTendencia, pfdTendencias,
    pfdTendenciaHTML, pfdTendenciaFrase, pfdTendenciaResumoHTML,
    pfdRankingUC, pfdRankingMun, pfdDentroFora, PFD_FIRMS_VIIRS_DESDE, pfdParecer, pfdParecerHTML, pfdSpearman, pfdEnsoDoAno, pfdClimaDoRecorte, pfdKpis, pfdFaixasAnos,
    pfdLinhaHTML, pfdAreaHTML, pfdBarrasHTML, pfdRankingHTML, pfdRoscaHTML,
  })
}
