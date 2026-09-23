// ── Painel de Fogo e Desmatamento · dados e gráficos ─────────────
// Fonte única do painel (pages/painel-fogo-desmatamento.html): recorta
// o histórico por TIPO (queimada/desmatamento/ambos), por ESCOPO (Acre
// todo / todas as UCs / uma UC) e por PERÍODO, e desenha os gráficos.
// A página não agrega nem desenha nada — mesma lição de
// js/frota-consumo.js e js/agua-relatorio-dados.js.
//
// Dados (migration 342), todos pré-agregados no banco:
//  - focos_uc_mes  ano × mês × UC (uc_id null = fora de UC). Temporada
//    de fogo 1º/jul a 4/nov — a MESMA definição de vw_focos_linha_tempo.
//  - prodes_resumo_ano  total OFICIAL do estado (área declarada pelo INPE).
//  - prodes_uc_ano  área por UC = interseção calculada no banco.
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
}
const PFD_MESES = ['', 'jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']

function _pfdNum(n, casas) {
  const v = Number(n) || 0
  return v.toLocaleString('pt-BR', { maximumFractionDigits: casas ?? 0, minimumFractionDigits: casas ?? 0 })
}
function _pfdEsc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}

// ── Filtro ────────────────────────────────────────────────────────
// escopo: '' = Acre todo · 'ucs' = dentro de qualquer UC · <uuid> = uma UC
function _pfdNoEscopo(ucId, escopo) {
  if (!escopo) return true
  if (escopo === 'ucs') return ucId != null
  return ucId === escopo
}
function _pfdAnos(f) {
  const out = []
  for (let a = Number(f.anoIni); a <= Number(f.anoFim); a++) out.push(a)
  return out
}

// ── Fogo ──────────────────────────────────────────────────────────
function pfdFocosPorAno(dados, f) {
  const soma = {}
  for (const r of dados.focosUcMes || []) {
    if (r.ano < f.anoIni || r.ano > f.anoFim || !_pfdNoEscopo(r.uc_id, f.escopo)) continue
    soma[r.ano] = (soma[r.ano] || 0) + Number(r.focos)
  }
  const resumo = {}
  for (const r of dados.focosResumo || []) resumo[r.ano] = r
  const anoAtual = (f.hoje instanceof Date ? f.hoje : new Date()).getFullYear()
  return _pfdAnos(f).map(ano => ({
    ano,
    n: resumo[ano] ? (soma[ano] || 0) : null,   // null = ano sem registro nenhum
    parcial: !!resumo[ano] && ano >= anoAtual,
  }))
}

function pfdFocosPorMes(dados, f) {
  const soma = { 7: 0, 8: 0, 9: 0, 10: 0, 11: 0 }
  for (const r of dados.focosUcMes || []) {
    if (r.ano < f.anoIni || r.ano > f.anoFim || !_pfdNoEscopo(r.uc_id, f.escopo)) continue
    if (soma[r.mes] != null) soma[r.mes] += Number(r.focos)
  }
  return [7, 8, 9, 10, 11].map(mes => ({ mes, n: soma[mes] }))
}

// ── Desmatamento ──────────────────────────────────────────────────
// Acre todo = número OFICIAL do INPE; UC = interseção calculada.
function pfdDesmatPorAno(dados, f) {
  const porAno = {}
  if (!f.escopo) {
    for (const r of dados.prodesAno || []) porAno[r.ano] = { ha: Number(r.area_ha), poligonos: Number(r.poligonos) }
  } else {
    const temAno = new Set((dados.prodesUcAno || []).map(r => r.ano))
    for (const a of temAno) porAno[a] = { ha: 0, poligonos: 0 }
    for (const r of dados.prodesUcAno || []) {
      if (!_pfdNoEscopo(r.uc_id, f.escopo)) continue
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

// ── Ranking de UCs (sempre todas as UCs; a escolhida é destacada) ─
function pfdRankingUC(dados, f, tipo) {
  const valor = {}
  if (tipo === 'queimada') {
    for (const r of dados.focosUcMes || []) {
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
    .map(u => ({ uc_id: u.id, nome: u.nome, valor: valor[u.id] || 0 }))
    .sort((a, b) => b.valor - a.valor || a.nome.localeCompare(b.nome, 'pt-BR'))
}

// ── Dentro × fora (rosca) ─────────────────────────────────────────
// Escopo "uma UC": fatias = esta UC × restante do Acre.
function pfdDentroFora(dados, f, tipo) {
  let dentro = 0, total = 0
  if (tipo === 'queimada') {
    for (const r of dados.focosUcMes || []) {
      if (r.ano < f.anoIni || r.ano > f.anoFim) continue
      total += Number(r.focos)
      const conta = f.escopo && f.escopo !== 'ucs' ? r.uc_id === f.escopo : r.uc_id != null
      if (conta) dentro += Number(r.focos)
    }
  } else {
    for (const r of dados.prodesAno || []) {
      if (r.ano >= f.anoIni && r.ano <= f.anoFim) total += Number(r.area_ha)
    }
    for (const r of dados.prodesUcAno || []) {
      if (r.ano < f.anoIni || r.ano > f.anoFim) continue
      const conta = f.escopo && f.escopo !== 'ucs' ? r.uc_id === f.escopo : true
      if (conta) dentro += Number(r.area_ha)
    }
  }
  const umaUC = f.escopo && f.escopo !== 'ucs'
  return [
    { rotulo: umaUC ? 'Nesta UC' : 'Dentro de UCs', n: dentro, cor: PFD_COR.dentro },
    { rotulo: umaUC ? 'Restante do Acre' : 'Fora de UCs', n: Math.max(0, total - dentro), cor: PFD_COR.fora },
  ]
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
  const rotX = pontos.map((p, i) => (i % passo === 0 || i === pontos.length - 1)
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
  const rotX = pontos.map((p, i) => (i % passo === 0 || i === pontos.length - 1)
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

if (typeof window !== 'undefined') {
  Object.assign(window, {
    PFD_COR, PFD_MESES, pfdFocosPorAno, pfdFocosPorMes, pfdDesmatPorAno, pfdAcumulado,
    pfdRankingUC, pfdDentroFora, pfdKpis, pfdFaixasAnos,
    pfdLinhaHTML, pfdAreaHTML, pfdBarrasHTML, pfdRankingHTML, pfdRoscaHTML,
  })
}
