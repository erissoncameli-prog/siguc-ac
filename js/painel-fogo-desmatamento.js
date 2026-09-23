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
//         'esf:<federal|estadual|municipal>' = UCs daquela esfera · <uuid> = uma UC
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
  return 'uc'
}
// Linhas e meses da fonte de focos escolhida.
function _pfdFogo(dados, f) {
  return f.fonte === 'bdq'
    ? { linhas: dados.bdqUcMes || [], resumo: dados.bdqResumo || [], meses: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], parcialAtual: false }
    : { linhas: dados.focosUcMes || [], resumo: dados.focosResumo || [], meses: [7, 8, 9, 10, 11], parcialAtual: true }
}
function _pfdAnos(f) {
  const out = []
  for (let a = Number(f.anoIni); a <= Number(f.anoFim); a++) out.push(a)
  return out
}

// ── Fogo ──────────────────────────────────────────────────────────
function pfdFocosPorAno(dados, f) {
  const fg = _pfdFogo(dados, f), no = _pfdPred(dados, f.escopo)
  const soma = {}
  for (const r of fg.linhas) {
    if (r.ano < f.anoIni || r.ano > f.anoFim || !no(r.uc_id)) continue
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
  const fg = _pfdFogo(dados, f), no = _pfdPred(dados, f.escopo)
  const soma = {}
  for (const m of fg.meses) soma[m] = 0
  for (const r of fg.linhas) {
    if (r.ano < f.anoIni || r.ano > f.anoFim || !no(r.uc_id)) continue
    if (soma[r.mes] != null) soma[r.mes] += Number(r.focos)
  }
  return fg.meses.map(mes => ({ mes, n: soma[mes] }))
}

// ── Desmatamento ──────────────────────────────────────────────────
// Acre todo = número OFICIAL do INPE; UC = interseção calculada.
function pfdDesmatPorAno(dados, f) {
  const porAno = {}
  const no = _pfdPred(dados, f.escopo)
  if (!f.escopo) {
    for (const r of dados.prodesAno || []) porAno[r.ano] = { ha: Number(r.area_ha), poligonos: Number(r.poligonos) }
  } else {
    const temAno = new Set((dados.prodesUcAno || []).map(r => r.ano))
    for (const a of temAno) porAno[a] = { ha: 0, poligonos: 0 }
    for (const r of dados.prodesUcAno || []) {
      if (!no(r.uc_id)) continue
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
    for (const r of _pfdFogo(dados, f).linhas) {
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

// ── Dentro × fora (rosca) ─────────────────────────────────────────
// Acre todo / todas as UCs: dentro × fora de UCs. Esfera ou uma UC:
// o recorte escolhido × restante do Acre.
function pfdDentroFora(dados, f, tipo) {
  const t = pfdEscopoTipo(f.escopo)
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
  const linhas = tipo === 'queimada' ? _pfdFogo(dados, f).linhas : (dados.prodesUcAno || [])
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
<text x="${cx}" y="${cy + 2}" text-anchor="middle" font-size="18" font-weight="700" fill="#111827" font-family="var(--font-sans, 'DM Sans', sans-serif)">${_pfdCompacto(total)}</text>
<text x="${cx}" y="${cy + 18}" text-anchor="middle" font-size="10" fill="${PFD_COR.eixo}">${_pfdEsc(o.unidade)}</text></svg>`
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

if (typeof window !== 'undefined') {
  Object.assign(window, {
    PFD_COR, PFD_MESES, pfdFocosPorAno, pfdFocosPorMes, pfdDesmatPorAno, pfdAcumulado,
    PFD_ESFERAS, PFD_TEND_MIN_ANOS, pfdEscopoTipo, pfdPorEsfera, pfdTendencia, pfdTendencias,
    pfdTendenciaHTML, pfdTendenciaFrase, pfdTendenciaResumoHTML,
    pfdRankingUC, pfdDentroFora, pfdKpis, pfdFaixasAnos,
    pfdLinhaHTML, pfdAreaHTML, pfdBarrasHTML, pfdRankingHTML, pfdRoscaHTML,
  })
}
