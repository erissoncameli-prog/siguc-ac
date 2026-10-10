// ── SIGUC-AC · Biomonitor — Relatório Científico: análises e gráficos ─
// Funções PURAS (sem DOM, sem banco) usadas por js/biomonitor-analise.js.
// Ficam num arquivo próprio para serem testadas isoladamente
// (tests/biomonitor-relatorio-cientifico.test.js).
//
// Regras que este arquivo segura:
//  • Nenhuma taxa é recalculada aqui a partir de ovo/ninho: os números
//    vêm prontos das RPCs (bio_analise_detalhada / bio_analise_complementar,
//    migration 359). Aqui só se faz estatística de APRESENTAÇÃO
//    (intervalo de confiança, quartis da postura, datas da fase).
//  • Sem dado, a função devolve null / lista vazia — nunca zero inventado.
//  • Gráfico novo é SVG com <title> em cada marca, para o teclado e a
//    tabela alternativa de js/grafico-teclado.js lerem o mesmo valor do
//    tooltip (regra do sistema — gráficos acessíveis por teclado).
//  • Cor de espécie: paleta validada no validate_palette.js da skill de
//    dataviz (4 primeiras = espécies em uso; as demais só aparecem com
//    rótulo ao lado). Nunca a cor sozinha identifica a espécie.

const ACC_ESP_COR = {
  tracaja: '#2A9D6F', tartaruga: '#1D6FA8', pitiU: '#C2410C', cabecudo: '#7C3AED',
  cupido: '#A16207', jabuti_pe_elefante: '#4B5563', jabuti_piranga: '#9D174D',
  mucua: '#0E7490', outro: '#6B7280',
}
const ACC_TINTA = '#1F2937'
const ACC_TINTA2 = '#6B7280'
const ACC_GRADE = '#E5E7EB'

function _accEsc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}
function _accNum(v) { return (v == null || isNaN(v)) ? 0 : Number(v) }
function _accFmt(n, dec) {
  if (n == null || isNaN(n)) return '—'
  return Number(n).toLocaleString('pt-BR', { minimumFractionDigits: dec || 0, maximumFractionDigits: dec || 0 })
}
function _accDataBR(iso) {
  if (!iso) return '—'
  const [y, m, d] = String(iso).slice(0, 10).split('-')
  return `${d}/${m}/${y}`
}
function _accDias(a, b) { // b − a, em dias (ISO)
  return Math.round((Date.parse(String(b).slice(0, 10)) - Date.parse(String(a).slice(0, 10))) / 86400000)
}
function _accSomaDias(iso, n) {
  const d = new Date(Date.parse(String(iso).slice(0, 10)) + n * 86400000)
  return d.toISOString().slice(0, 10)
}

// ── Intervalo de confiança de 95% (Wilson) ─────────────────────────
// Para proporção x/n. Devolve percentuais com 1 casa, ou null sem n.
// Wilson e não Wald: com n pequeno ou proporção perto de 0/100% o
// intervalo de Wald sai negativo ou acima de 100.
function accWilson(x, n) {
  x = _accNum(x); n = _accNum(n)
  if (n <= 0) return null
  const z = 1.959964
  const p = x / n
  const den = 1 + z * z / n
  const centro = (p + z * z / (2 * n)) / den
  const meia = (z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))) / den
  const r = v => Math.round(v * 1000) / 10
  return { p: r(p), lo: r(Math.max(0, centro - meia)), hi: r(Math.min(1, centro + meia)), n }
}
function accWilsonTexto(ic) {
  if (!ic) return '—'
  return `${_accFmt(ic.p, 1)}% (IC 95%: ${_accFmt(ic.lo, 1)}–${_accFmt(ic.hi, 1)})`
}

// ── Fase da temporada pelos EVENTOS de campo ──────────────────────
// A versão antiga dividia a janela cadastrada da temporada em terços; a
// temporada 2026/2027 vai de 27/03 a 27/02 e todos os 568 ninhos
// (agosto–setembro) caíam no "meio", cujo cartão dizia "incubação".
// Aqui a fase sai do que aconteceu: 1º/último encontro, 1ª/última
// eclosão, previsão dos ninhos ainda fechados.
const ACC_FASES = [
  { chave: 'postura',   lbl: 'Postura',   sub: 'Encontro e registro dos ninhos' },
  { chave: 'incubacao', lbl: 'Incubação', sub: 'Ninhos fechados, acompanhamento' },
  { chave: 'eclosao',   lbl: 'Eclosão',   sub: 'Abertura dos ninhos e contagem' },
  { chave: 'soltura',   lbl: 'Soltura',   sub: 'Filhotes devolvidos ao rio' },
]
// Postura considerada encerrada 7 dias depois do último encontro.
const ACC_POSTURA_FOLGA_DIAS = 7

function accFaseBiologica(ev, hojeISO) {
  ev = ev || {}
  const hoje = String(hojeISO || new Date().toISOString()).slice(0, 10)
  if (!_accNum(ev.ninhos)) return { atual: null, etapas: [] }
  const abertos = _accNum(ev.ninhos_abertos)
  const pend = _accNum(ev.ninhos_pendentes)
  const posturaAberta = ev.postura_fim && _accDias(ev.postura_fim, hoje) <= ACC_POSTURA_FOLGA_DIAS && !abertos

  let atual
  if (ev.soltura_ini && !pend) atual = 'soltura'
  else if (abertos > 0) atual = pend > 0 ? 'eclosao' : (ev.soltura_ini ? 'soltura' : 'eclosao')
  else if (posturaAberta) atual = 'postura'
  else if (ev.previsao_ini && hoje >= String(ev.previsao_ini).slice(0, 10)) atual = 'eclosao'
  else atual = 'incubacao'

  const ordem = ACC_FASES.map(f => f.chave)
  const idxAtual = ordem.indexOf(atual)
  const per = {
    postura: { ini: ev.postura_ini, fim: ev.postura_fim, previsto: false },
    incubacao: { ini: ev.postura_ini, fim: ev.eclosao_ini || ev.previsao_fim || null, previsto: !ev.eclosao_ini },
    eclosao: abertos > 0
      ? { ini: ev.eclosao_ini, fim: pend > 0 ? (ev.previsao_fim || ev.eclosao_fim) : ev.eclosao_fim, previsto: pend > 0 }
      : { ini: ev.previsao_ini, fim: ev.previsao_fim, previsto: true },
    soltura: { ini: ev.soltura_ini, fim: ev.soltura_fim, previsto: false },
  }
  const etapas = ACC_FASES.map((f, i) => {
    const p = per[f.chave]
    let status
    if (i < idxAtual) status = 'feito'
    else if (i === idxAtual) status = 'atual'
    else status = (p.ini ? 'previsto' : 'sem_dado')
    return { ...f, ini: p.ini || null, fim: p.fim || null, previsto: !!p.previsto, status }
  })
  return { atual, etapas }
}

// ── Postura por espécie: quartis + comparação com a referência ───────
// `linhas` = [{especie, qtd, n}] (contagem por número de ovos).
function accPosturaEstat(linhas, refs) {
  refs = refs || {}
  const por = {}
  ;(linhas || []).forEach(l => {
    if (l.qtd == null) return
    const k = l.especie
    ;(por[k] = por[k] || []).push({ v: Number(l.qtd), n: _accNum(l.n) })
  })
  const quantil = (arr, total, q) => {
    // arr ordenado por v, com multiplicidade n; quantil pelo método
    // "posição (N−1)·q com interpolação linear" (tipo 7 do R).
    const pos = (total - 1) * q
    const lo = Math.floor(pos), hi = Math.ceil(pos)
    const em = idx => { let acc = 0; for (const a of arr) { acc += a.n; if (idx < acc) return a.v } return arr[arr.length - 1].v }
    const a = em(lo), b = em(hi)
    return a + (b - a) * (pos - lo)
  }
  return Object.keys(por).map(esp => {
    const arr = por[esp].sort((a, b) => a.v - b.v)
    const total = arr.reduce((s, a) => s + a.n, 0)
    const soma = arr.reduce((s, a) => s + a.v * a.n, 0)
    const ref = refs[esp] || {}
    const faixa = Array.isArray(ref.postura_faixa) ? ref.postura_faixa : null
    return {
      especie: esp, n: total,
      media: Math.round(soma / total * 10) / 10,
      mediana: quantil(arr, total, 0.5),
      q1: quantil(arr, total, 0.25), q3: quantil(arr, total, 0.75),
      min: arr[0].v, max: arr[arr.length - 1].v,
      ref_media: ref.postura_media != null ? ref.postura_media : null,
      ref_faixa: faixa,
      abaixo: faixa ? arr.filter(a => a.v < faixa[0]).reduce((s, a) => s + a.n, 0) : null,
      acima: faixa ? arr.filter(a => a.v > faixa[1]).reduce((s, a) => s + a.n, 0) : null,
    }
  }).sort((a, b) => b.n - a.n)
}

// Gráfico de faixa (bullet): por espécie, faixa da literatura (cinza),
// média da literatura (traço dourado), intervalo interquartil observado
// (barra fina) e média observada (ponto). Escala comum a todas as linhas.
function accPosturaSVG(estat, nomes) {
  estat = (estat || []).filter(e => e.n > 0)
  if (!estat.length) return ''
  nomes = nomes || {}
  const W = 560, padE = 128, padD = 18, linhaH = 46, topo = 14
  const H = topo + estat.length * linhaH + 26
  const maxV = Math.max(...estat.map(e => Math.max(e.max, (e.ref_faixa || [0, 0])[1], e.ref_media || 0)), 1)
  const passo = maxV > 100 ? 20 : maxV > 50 ? 10 : 5
  const escalaMax = Math.ceil(maxV / passo) * passo
  const x = v => padE + (W - padE - padD) * (v / escalaMax)
  const ticks = []
  for (let t = 0; t <= escalaMax; t += passo) ticks.push(t)
  let s = `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Ovos por ninho observados comparados à faixa de referência da literatura" style="font-family:var(--font-sans,system-ui)">`
  ticks.forEach(t => {
    s += `<line x1="${x(t)}" x2="${x(t)}" y1="${topo - 4}" y2="${H - 22}" stroke="${ACC_GRADE}" stroke-width="1"/>`
    s += `<text x="${x(t)}" y="${H - 8}" font-size="10" fill="${ACC_TINTA2}" text-anchor="middle">${t}</text>`
  })
  estat.forEach((e, i) => {
    const y = topo + i * linhaH + 18
    const nome = nomes[e.especie] || e.especie
    s += `<text x="0" y="${y + 4}" font-size="12" font-weight="700" fill="${ACC_TINTA}">${_accEsc(nome)}</text>`
    s += `<text x="0" y="${y + 18}" font-size="10.5" fill="${ACC_TINTA2}">n = ${_accFmt(e.n)} ninhos</text>`
    if (e.ref_faixa) {
      s += `<rect x="${x(e.ref_faixa[0])}" y="${y - 7}" width="${Math.max(2, x(e.ref_faixa[1]) - x(e.ref_faixa[0]))}" height="14" rx="3" fill="#D1D5DB"><title>${_accEsc(nome)} — faixa da literatura: ${e.ref_faixa[0]} a ${e.ref_faixa[1]} ovos</title></rect>`
    }
    if (e.ref_media != null) {
      s += `<rect x="${x(e.ref_media) - 1.5}" y="${y - 11}" width="3" height="22" fill="#A8862F"><title>${_accEsc(nome)} — média da literatura: ${_accFmt(e.ref_media)} ovos</title></rect>`
    }
    s += `<rect x="${x(e.q1)}" y="${y - 2}" width="${Math.max(2, x(e.q3) - x(e.q1))}" height="4" rx="2" fill="${ACC_TINTA}" opacity=".55"><title>${_accEsc(nome)} — metade central observada: ${_accFmt(e.q1, 0)} a ${_accFmt(e.q3, 0)} ovos (mín. ${e.min}, máx. ${e.max})</title></rect>`
    s += `<circle cx="${x(e.media)}" cy="${y}" r="6" fill="${ACC_ESP_COR[e.especie] || ACC_TINTA}" stroke="#fff" stroke-width="2" data-gt-ponto><title>${_accEsc(nome)} — média observada: ${_accFmt(e.media, 1)} ovos por ninho (n = ${e.n}); referência ${e.ref_media != null ? _accFmt(e.ref_media) : '—'}${e.ref_faixa ? ` (${e.ref_faixa[0]}–${e.ref_faixa[1]})` : ''}</title></circle>`
    s += `<text x="${W - padD}" y="${y + 20}" font-size="10.5" fill="${ACC_TINTA2}" text-anchor="end">obs. ${_accFmt(e.media, 1)} · ref. ${e.ref_media != null ? _accFmt(e.ref_media) : '—'}${e.ref_faixa ? ` (${e.ref_faixa[0]}–${e.ref_faixa[1]})` : ''}</text>`
  })
  s += `</svg>`
  return s
}

// ── Funil de sobrevivência da coorte ─────────────────────────────────
// Etapas com dado viram barra proporcional à postura; etapa ainda sem
// evento (eclosão antes de qualquer ninho aberto) fica tracejada e diz
// por quê — nunca vira zero.
function accFunilEtapas(f, ev) {
  f = f || {}; ev = ev || {}
  const abertos = _accNum(ev.ninhos_abertos)
  const pend = _accNum(ev.ninhos_pendentes)
  const postura = _accNum(f.postura)
  const etapas = [
    { chave: 'postura', lbl: 'Ovos postos', v: postura },
    { chave: 'viaveis', lbl: 'Ovos viáveis (postura − perdas)', v: _accNum(f.viaveis) },
  ]
  if (pend > 0 && abertos > 0) etapas.push({ chave: 'pendente', lbl: `Ainda em incubação (${_accFmt(pend)} ninhos fechados)`, v: _accNum(f.em_incubacao), pendente: true })
  if (abertos > 0) {
    etapas.push({ chave: 'incubados', lbl: `Ovos incubados nos ${_accFmt(abertos)} ninhos abertos`, v: _accNum(f.incubados_abertos) })
    etapas.push({ chave: 'eclodidos', lbl: 'Eclodidos (vivos + mortos)', v: _accNum(f.eclodidos), base: 'incubados' })
    etapas.push({ chave: 'emergidos', lbl: 'Emergidos vivos', v: _accNum(f.emergidos), base: 'incubados' })
    etapas.push(_accNum(f.soltos) > 0
      ? { chave: 'soltos', lbl: 'Soltos no rio', v: _accNum(f.soltos), base: 'incubados' }
      : { chave: 'soltos', lbl: 'Soltos no rio', v: null, motivo: 'nenhuma soltura registrada ainda' })
  } else {
    etapas.push({ chave: 'eclodidos', lbl: 'Eclodidos → emergidos → soltos', v: null, motivo: 'aguardando a abertura dos primeiros ninhos' })
  }
  // percentual em relação à etapa de referência (postura ou incubados)
  const ref = { postura, incubados: _accNum(f.incubados_abertos) }
  etapas.forEach(e => {
    const b = ref[e.base || 'postura']
    e.pct = (e.v != null && b > 0) ? Math.round(1000 * e.v / b) / 10 : null
    e.baseLbl = e.base === 'incubados' ? 'dos incubados' : 'da postura'
  })
  return etapas
}

function accFunilSVG(etapas) {
  if (!etapas || !etapas.length) return ''
  const W = 600, barH = 18, linhaH = 44
  // Cada barra é medida contra a SUA base (postura ou ovos incubados dos
  // ninhos abertos): medir tudo contra a postura reduziria as etapas de
  // eclosão a traços enquanto poucos ninhos foram abertos.
  const bases = { postura: Math.max(...etapas.filter(e => (e.base || 'postura') === 'postura').map(e => e.v || 0), 1) }
  const inc = etapas.find(e => e.chave === 'incubados')
  bases.incubados = inc && inc.v ? inc.v : 1
  const sep = etapas.findIndex(e => e.chave === 'incubados')
  const H = etapas.length * linhaH + 4 + (sep > 0 ? 22 : 0)
  // Rampa sequencial de um tom (magnitude): verde do mais escuro ao claro
  const tons = ['#1B5E40', '#23744F', '#2A9D6F', '#52B788', '#7CC9A2', '#A7DCC0']
  let s = `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Funil de sobrevivência da coorte" style="font-family:var(--font-sans,system-ui)">`
  etapas.forEach((e, i) => {
    const y = i * linhaH + 4 + (sep > 0 && i >= sep ? 22 : 0)
    if (sep > 0 && i === sep) {
      s += `<text x="2" y="${y - 8}" font-size="11" font-weight="700" fill="${ACC_TINTA2}" letter-spacing=".04em">NOS NINHOS JÁ ABERTOS — barras medidas sobre os ovos incubados</text>`
    }
    const baseV = e.chave === 'incubados' ? bases.incubados : bases[e.base || 'postura']
    const largura = e.v != null ? Math.max(3, (W - 4) * Math.min(1, e.v / baseV)) : W - 4
    if (e.v == null) {
      s += `<rect x="1" y="${y}" width="${largura}" height="${barH}" rx="4" fill="none" stroke="#9CA3AF" stroke-dasharray="5 4"><title>${_accEsc(e.lbl)}: ${_accEsc(e.motivo || 'sem dado')}</title></rect>`
      s += `<text x="${W - 2}" y="${y + barH + 15}" font-size="12" fill="${ACC_TINTA2}" text-anchor="end">${_accEsc(e.motivo || 'sem dado')}</text>`
    } else {
      const cor = e.pendente ? '#CBD5E1' : tons[Math.min(i, tons.length - 1)]
      const pct = e.pct != null ? ` · ${_accFmt(e.pct, 1)}% ${e.baseLbl}` : ''
      s += `<rect x="1" y="${y}" width="${largura}" height="${barH}" rx="4" fill="${cor}"><title>${_accEsc(e.lbl)}: ${_accFmt(e.v)} ovos${pct}</title></rect>`
      s += `<text x="${W - 2}" y="${y + barH + 15}" font-size="12.5" font-weight="700" fill="${ACC_TINTA}" text-anchor="end">${_accFmt(e.v)}${e.pct != null && e.chave !== 'postura' && e.chave !== 'incubados' ? ` · ${_accFmt(e.pct, 1)}%` : ''}</text>`
    }
    s += `<text x="2" y="${y + barH + 15}" font-size="11.5" fill="${ACC_TINTA2}">${_accEsc(e.lbl)}</text>`
  })
  return s + '</svg>'
}

// ── Calendário de eclosão previsto (ninhos ainda fechados) ─────────────
// `cal` = [{semana, especie, ninhos, ajustados}] (semana = segunda-feira).
function accCalendarioSVG(cal, nomes, hojeISO) {
  cal = (cal || []).filter(c => c.semana)
  if (!cal.length) return ''
  nomes = nomes || {}
  const semanas = Array.from(new Set(cal.map(c => String(c.semana).slice(0, 10)))).sort()
  // completa semanas vazias no meio para o eixo não esconder intervalos
  const todas = []
  for (let d = semanas[0]; d <= semanas[semanas.length - 1]; d = _accSomaDias(d, 7)) todas.push(d)
  const especies = Array.from(new Set(cal.map(c => c.especie)))
  const tot = s => cal.filter(c => String(c.semana).slice(0, 10) === s).reduce((a, c) => a + _accNum(c.ninhos), 0)
  const max = Math.max(...todas.map(tot), 1)
  const W = 600, padB = 34, padT = 18, H = 200
  const passo = (W - 8) / todas.length
  const bw = Math.min(passo, 72)
  const x0base = 4 + ((W - 8) - bw * todas.length) / 2
  const y = v => padT + (H - padT - padB) * (1 - v / max)
  const hoje = String(hojeISO || new Date().toISOString()).slice(0, 10)
  let s = `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Ninhos com eclosão prevista por semana" style="font-family:var(--font-sans,system-ui)">`
  s += `<line x1="0" x2="${W}" y1="${H - padB}" y2="${H - padB}" stroke="${ACC_GRADE}"/>`
  todas.forEach((sem, i) => {
    const x0 = x0base + i * bw + 3, w = Math.max(3, bw - 6)
    let acc = 0
    especies.forEach(esp => {
      const c = cal.find(k => String(k.semana).slice(0, 10) === sem && k.especie === esp)
      if (!c || !_accNum(c.ninhos)) return
      const v0 = acc, v1 = acc + _accNum(c.ninhos)
      acc = v1
      s += `<rect x="${x0}" y="${y(v1)}" width="${w}" height="${Math.max(1, y(v0) - y(v1) - (v0 > 0 ? 2 : 0))}" rx="${v0 === 0 ? 0 : 0}" fill="${ACC_ESP_COR[esp] || ACC_TINTA2}"><title>Semana de ${_accDataBR(sem)} — ${_accEsc(nomes[esp] || esp)}: ${_accFmt(c.ninhos)} ninho(s)${_accNum(c.ajustados) ? ` (${c.ajustados} com previsão ajustada pela temperatura)` : ''}</title></rect>`
    })
    const t = tot(sem)
    if (t) s += `<text x="${x0 + w / 2}" y="${y(t) - 5}" font-size="10.5" font-weight="700" fill="${ACC_TINTA}" text-anchor="middle">${t}</text>`
    const [, m, d] = sem.split('-')
    if (todas.length <= 12 || i % 2 === 0) s += `<text x="${x0 + w / 2}" y="${H - padB + 14}" font-size="10" fill="${ACC_TINTA2}" text-anchor="middle">${d}/${m}</text>`
    if (hoje >= sem && hoje < _accSomaDias(sem, 7)) {
      s += `<text x="${x0 + w / 2}" y="${H - 4}" font-size="10" font-weight="700" fill="#B45309" text-anchor="middle">hoje</text>`
    }
  })
  return s + '</svg>'
}

// ── Completude dos dados — o quanto confiar em cada seção ─────────────
function accCompletudeItens(c) {
  c = c || {}
  const n = _accNum(c.ninhos)
  if (!n) return []
  const it = (lbl, x, base, uso, alvoBaixo) => ({ lbl, x: _accNum(x), base: _accNum(base), pct: base ? Math.round(1000 * _accNum(x) / _accNum(base)) / 10 : null, uso, alvoBaixo: !!alvoBaixo })
  return [
    it('Ninhos validados pela equipe científica', c.validados, n, 'Tudo o relatório'),
    it('Ovos contados (não estimados)', c.ovos_contados, n, 'Postura e funil'),
    it('Hora da desova registrada', c.com_hora_desova, n, 'Janela de transferência'),
    it('Posição por GPS de campo', c.gps_campo, n, 'Análise espacial'),
    it('Ninhos com ao menos 1 visita', c.ninhos_com_visita, n, 'Perdas na incubação'),
    it('Temperatura medida (encontro ou visita)', _accNum(c.com_temp_encontro) + _accNum(c.visitas_com_temp), n, 'Razão sexual (TSD)'),
    it('Transferências com hora registrada', c.transf_com_hora, c.transferidos, 'Tempo até a transferência'),
  ].filter(i => i.base > 0)
}

// ── Principais achados (regras, nenhuma IA) ───────────────────────────
// Cada frase sai de uma comparação com o próprio dado. Devolve HTML
// curto com <strong>; os valores passam por escape.
function accAchados(ctx) {
  ctx = ctx || {}
  const k = ctx.kpis || {}, det = ctx.det || {}, comp = ctx.comp || {}
  const nomes = ctx.nomes || {}
  const out = []
  const total = _accNum(k.total_ninhos)
  if (!total) return out
  const esp = (ctx.porEspecie || []).slice().sort((a, b) => _accNum(b.total) - _accNum(a.total))
  if (esp.length) {
    const p = Math.round(100 * _accNum(esp[0].total) / total)
    out.push(`<strong>${_accFmt(total)} ninhos</strong> de ${esp.length} espécie(s); ${_accEsc(nomes[esp[0].especie] || esp[0].especie)} responde por <strong>${p}%</strong>.`)
  }
  const prot = comp.protecao || []
  const transf = _accNum((comp.transferencia || {}).n)
  if (transf && prot.length) {
    const pct = Math.round(100 * transf / total)
    out.push(`<strong>${pct}% dos ninhos</strong> foram transferidos para ${prot.length} praia(s) de proteção (${prot.map(p => _accEsc(p.nome)).join(' e ')}).`)
  }
  const pe = ctx.posturaEstat || []
  const fora = pe.filter(e => e.ref_faixa && (e.media < e.ref_faixa[0] || e.media > e.ref_faixa[1]))
  if (pe.length && pe.some(e => e.ref_faixa)) {
    out.push(fora.length
      ? `Postura média <strong>fora da faixa de referência</strong> em ${fora.map(e => _accEsc(nomes[e.especie] || e.especie)).join(', ')} — conferir contagem e identificação da espécie.`
      : `Postura média <strong>dentro da faixa de referência</strong> em todas as espécies com referência publicada.`)
  }
  const pd = det.perdas || {}
  const perdas = _accNum(pd.ovos_predacao) + _accNum(pd.ovos_humana) + _accNum(pd.ovos_alagamento) + _accNum(pd.ovos_erosao) + _accNum(pd.ovos_natural)
  if (perdas > 0) {
    const causas = [['predação', pd.ovos_predacao], ['ação humana', pd.ovos_humana], ['alagamento', pd.ovos_alagamento], ['erosão', pd.ovos_erosao], ['causa natural', pd.ovos_natural]]
      .filter(([, v]) => _accNum(v) > 0).sort((a, b) => _accNum(b[1]) - _accNum(a[1]))
    out.push(`<strong>${_accFmt(perdas)} ovos perdidos</strong>; a principal causa é ${causas[0][0]} (${_accFmt(causas[0][1])}).`)
  }
  const ec = det.eclosao || {}
  if (_accNum(ec.ovos_incubados) > 0) {
    const ic = accWilson(ec.vivos, ec.ovos_incubados)
    out.push(`Sucesso de emergência de <strong>${_accFmt(ic.p, 1)}%</strong> nos ${_accFmt(ec.ninhos_abertos)} ninhos já abertos (IC 95%: ${_accFmt(ic.lo, 1)}–${_accFmt(ic.hi, 1)}%).`)
  } else {
    const ev = comp.eventos || {}
    if (ev.previsao_ini) out.push(`Nenhum ninho aberto ainda; as eclosões estão previstas de <strong>${_accDataBR(ev.previsao_ini)}</strong> a <strong>${_accDataBR(ev.previsao_fim)}</strong>.`)
  }
  const c = comp.completude || {}
  const nTemp = _accNum(c.com_temp_encontro) + _accNum(c.visitas_com_temp)
  if (nTemp === 0) out.push(`<strong>Sem temperatura de substrato</strong> registrada: a leitura de razão sexual (TSD) ainda não é possível.`)
  const neg = _accNum((comp.transferencia || {}).negativo)
  if (neg > 0) out.push(`<strong>${_accFmt(neg)} transferência(s)</strong> com data anterior ao encontro do ninho — revisar na validação.`)
  return out
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { accWilson, accFaseBiologica, accPosturaEstat, accFunilEtapas, accCompletudeItens, accAchados }
}
