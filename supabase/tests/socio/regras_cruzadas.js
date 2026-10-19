// ════════════════════════════════════════════════════════════════════════
// Teste cruzado: js/socio-regras.js (app) × funções SQL do banco (362b).
// As duas implementações interpretam a mesma estrutura; este teste gera
// casos aleatórios (semente fixa) — válidos, com saltos, "_nr",
// "especifique", lista, derivadas, coerência e erros estruturais — e exige
// resultado IDÊNTICO: mesmas linhas, mesma normalização, mesmos alertas na
// mesma ordem, mesmo código de erro.
//
//   node regras_cruzadas.js gerar    <casos.jsonl>
//   node regras_cruzadas.js comparar <casos.jsonl> <saida_sql.jsonl>
// (rodar.sh chama os dois passos em volta do psql)
// ════════════════════════════════════════════════════════════════════════
'use strict'
const fs = require('node:fs')
const path = require('node:path')
const R = require(path.join(__dirname, '../../../js/socio-regras.js'))

const EST = {
  domicilio: JSON.parse(fs.readFileSync(path.join(__dirname, 'estrutura-domicilio.json'), 'utf8')),
  pessoa: JSON.parse(fs.readFileSync(path.join(__dirname, 'estrutura-pessoa.json'), 'utf8')),
}
const N = { domicilio: 1500, pessoa: 300 }

// PRNG com semente (mulberry32) — casos reprodutíveis
let s = 20261018
function rnd() { s |= 0; s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296 }
const pick = a => a[Math.floor(rnd() * a.length)]
const chance = p => rnd() < p

function respostaAleatoria(p) {
  const ops = (p.opcoes || []).map(o => o.v)
  if (chance(0.06)) return '_nr'
  switch (p.tipo) {
    case 'unica': return pick(ops)
    case 'multipla': {
      const excl = (p.opcoes || []).filter(o => o.exclusiva).map(o => o.v)
      if (excl.length && chance(0.2)) return [pick(excl)]
      const n = 1 + Math.floor(rnd() * 3)
      const livres = ops.filter(o => !excl.includes(o))
      return [...new Set(Array.from({ length: n }, () => pick(livres)))]
    }
    case 'inteiro': return Math.floor((p.min || 0) + rnd() * Math.min((p.max || 50) - (p.min || 0), 30))
    case 'decimal': return Math.round(rnd() * 600 * 10) / 10
    default: return pick(['texto qualquer', '   ', 'Associação dos Moradores', '', 'ok\n', 'ação é coração'])
  }
}

function linhaAleatoria(ordem, est) {
  const l = { ordem }
  if (chance(0.7)) l.idade = chance(0.9) ? Math.floor(rnd() * 90) : pick([null, '_nr', ''])
  if (chance(0.8)) l.sexo = pick(['mulher', 'homem', 'outro', null, '_nr'])
  if (chance(0.7)) l.escolaridade = pick(['nenhuma', 'fund_inc', 'fund_comp', 'medio', 'superior', 'nao_sabe', '_nr', null])
  if (chance(0.5)) l.nome = pick(['Maria', '  ', 'J. S.', '', 'José da Silva'])
  if (chance(0.4)) l.trabalha = pick([true, false, null])
  if (est.lista && est.lista.marca_entrevistado && chance(0.5)) l.e_entrevistado = ordem === 1 ? chance(0.85) : chance(0.05)
  return l
}

function caso(i, e) {
  const est = EST[e]
  const resp = {}
  R.perguntas(est).forEach(({ p }) => {
    if (R.foraDeRespostas(p) || chance(0.12)) return
    resp[p.chave] = respostaAleatoria(p)
    const temEsp = (p.opcoes || []).some(o => o.especificar)
    if (temEsp && chance(0.5) && (resp[p.chave] === 'outro' || (Array.isArray(resp[p.chave]) && resp[p.chave].includes('outro'))))
      resp[p.chave + '_outro'] = pick(['cacimba', '  ', 'outra coisa', 'x'.repeat(70)])
  })
  let lin = []
  if (e === 'domicilio') {
    const n = Math.floor(rnd() * 6)
    const ordens = Array.from({ length: n }, (_, k) => k + 1).sort(() => rnd() - 0.5)
    lin = ordens.map(o => linhaAleatoria(o, est))
  }
  // erros estruturais em parte dos casos (~35%)
  const t = i % 20
  if (t === 1) resp.campo_inventado = 'x'
  if (t === 2 && e === 'domicilio') resp.renda_fontes = ['pesca', 'nenhuma']
  if (t === 3) resp[e === 'domicilio' ? 'qtd_moradores' : 'pesca_dias'] = 500
  if (t === 4 && e === 'domicilio') { resp.agua_fonte = 'rio'; resp.agua_fonte_outro = 'x' }
  if (t === 5) resp[e === 'domicilio' ? 'idade_entrevistado' : 'pesca_dias'] = 30.5
  if (t === 6 && e === 'domicilio') resp.moradores = 'não pode estar aqui'
  if (t === 7 && e === 'domicilio') resp.maior_esc = 'superior'          // derivada: o banco recalcula
  if (t === 8 && e === 'domicilio') resp.agua_tratamento = ['filtro', 'cloro', 'ferve']
  if (t === 9 && lin.length) lin.push(Object.assign({}, lin[0]))         // ordem repetida
  if (t === 10 && lin.length) lin[0].cor = 'azul'                        // coluna desconhecida
  if (t === 11 && lin.length) lin[0].sexo = 'indefinido'
  if (t === 12 && lin.length) lin[0].idade = 7.5
  if (t === 13 && lin.length > 1) { lin[0].e_entrevistado = true; lin[1].e_entrevistado = true }
  if (t === 14 && e === 'pessoa') lin = [{ ordem: 1, idade: 3 }]        // pessoa não tem lista
  if (t === 15 && e === 'domicilio') resp.atividades_mulheres = ['nao_ha_mulheres']
  if (t === 16 && e === 'domicilio') resp.qtd_moradores = lin.length || 1
  if (t === 17 && lin.length) lin[0].trabalha = 'sim'
  if (t === 18 && e === 'domicilio') resp.observacoes = 'é'.repeat(401)
  return { id: i, e, resp, lin }
}

function ordenar(v) {
  if (Array.isArray(v)) return v.map(ordenar)
  if (v && typeof v === 'object') return Object.keys(v).sort().reduce((o, k) => (o[k] = ordenar(v[k]), o), {})
  return v
}

function resultadoJs(c) {
  const est = EST[c.e]
  try {
    const nl = R.linhasNormalizar(est, c.lin)
    const norm = R.normalizar(est, c.resp, nl)
    return { linhas: nl, resp: norm, alertas: R.alertas(est, norm, nl), apl: R.aplicaveis(est, norm) }
  } catch (e) {
    return { erro: String(e.message).split(':').slice(0, 2).join(':') }
  }
}

const [, , modo, a1, a2] = process.argv
if (modo === 'gerar') {
  const casos = []
  let i = 0
  for (const e of Object.keys(N)) for (let k = 0; k < N[e]; k++) casos.push(caso(i++, e))
  fs.writeFileSync(a1, casos.map(c => JSON.stringify(c)).join('\n') + '\n')
  console.log('· ' + casos.length + ' casos gerados')
} else if (modo === 'comparar') {
  const casos = fs.readFileSync(a1, 'utf8').trim().split('\n').map(l => JSON.parse(l))
  const sql = {}
  fs.readFileSync(a2, 'utf8').trim().split('\n').forEach(l => { const o = JSON.parse(l); sql[o.id] = o.r })
  let falhas = 0, erros = 0
  const tipos = {}
  casos.forEach(c => {
    const js = resultadoJs(c)
    const db = sql[c.id]
    if (db.erro) db.erro = String(db.erro).split(':').slice(0, 2).join(':')
    if (js.erro) erros++
    else js.alertas.forEach(a => { tipos[a.tipo] = (tipos[a.tipo] || 0) + 1 })
    const a = JSON.stringify(ordenar(js)), b = JSON.stringify(ordenar(db))
    if (a !== b) {
      falhas++
      if (falhas <= 3) console.error('DIVERGÊNCIA no caso ' + c.id + '\n  js : ' + a.slice(0, 700) + '\n  sql: ' + b.slice(0, 700))
    }
  })
  if (falhas) { console.error('FALHOU: ' + falhas + ' de ' + casos.length + ' casos divergem'); process.exit(1) }
  // o teste só vale se os casos de fato exercitam cada regra
  const exigidos = ['pendente', 'outro_sem_texto', 'acima_do_esperado', 'abaixo_do_esperado',
                    'entrevistado_fora_da_1a_linha', 'diverge_da_lista', 'incoerente_com_lista']
  const faltam = exigidos.filter(t => !tipos[t])
  if (faltam.length) { console.error('FALHOU: nenhum caso gerou ' + faltam.join(', ')); process.exit(1) }
  console.log('· regras JS × SQL idênticas em ' + casos.length + ' casos (' + erros + ' com erro esperado; alertas: ' +
              exigidos.map(t => t + ' ' + tipos[t]).join(', ') + ')')
} else {
  console.error('uso: gerar <casos> | comparar <casos> <saida_sql>'); process.exit(2)
}
