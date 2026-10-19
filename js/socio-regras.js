// ── SIGUC-AC · Diagnóstico Socioeconômico — regras do questionário ─────
//
// Espelho, no aparelho, do interpretador do banco (migration
// 362b_socio_interpretador.sql). O questionário é DADO
// (socio_questionarios.estrutura); aqui e lá ele é lido com a MESMA
// linguagem: salto ('=', '!=', 'in', 'contem', 'nao_contem', {"todas"}),
// lista (estrutura.lista), derivadas e coerência.
//
// Por que duas implementações: o app precisa esconder perguntas e cobrar
// pendências SEM rede; o banco precisa validar o que chega. Para não
// divergirem, supabase/tests/socio/regras_cruzadas.js roda os mesmos casos
// nas duas e compara resultado a resultado. Regra nova entra nos DOIS
// arquivos e no teste.
//
// Valores especiais em respostas:
//   "_nr"            → Não respondeu
//   ausente          → não se aplica (salto) ou em branco (vira pendência)
//   "<chave>_outro"  → texto do "especifique"
//
// Funções puras: sem DOM, sem rede. Rodam no navegador (window.SocioRegras)
// e no Node (module.exports), para o teste cruzado.

;(function (raiz) {
  'use strict'

  const NR = '_nr'

  function erro(msg) { const e = new Error(msg); e.socio = true; return e }

  function perguntas(estrutura) {
    const lista = []
    ;((estrutura && estrutura.blocos) || []).forEach(b => (b.perguntas || []).forEach(p => lista.push({ bloco: b.id, p })))
    return lista
  }

  function porChave(estrutura) {
    const m = {}
    perguntas(estrutura).forEach(({ p }) => { m[p.chave] = p })
    return m
  }

  // a pergunta de lista só marca ONDE a lista aparece; não mora em respostas
  function foraDeRespostas(p) { return p.tipo === 'tabela' }

  // length() do Postgres conta caracteres (pontos de código), não UTF-16
  function tamanho(s) { return Array.from(s).length }

  // btrim() do Postgres tira só espaços (não \n nem \t)
  function btrim(s) { return s.replace(/^ +| +$/g, '') }

  function temOutro(v) { return v === 'outro' || (Array.isArray(v) && v.includes('outro')) }

  // igualdade de valores primitivos como a do jsonb
  function igual(a, b) { return typeof a === typeof b && a === b }

  function cond(c, resp, aplicaveis) {
    if (c && Array.isArray(c.todas)) return c.todas.every(x => cond(x, resp, aplicaveis))
    if (!aplicaveis.has(c.se)) return false   // referência fora de aplicação → dependente também
    const v = resp[c.se]
    switch (c.op) {
      case '=':          return typeof v === 'string' && v === c.valor
      case '!=':         return !(typeof v === 'string' && v === c.valor)
      case 'in':         return typeof v === 'string' && Array.isArray(c.valor) && c.valor.includes(v)
      case 'contem':     return Array.isArray(v) && v.includes(c.valor)
      case 'nao_contem': return !(Array.isArray(v) && v.includes(c.valor))
      default: throw erro('socio:estrutura_invalida: operador de salto desconhecido')
    }
  }

  // chaves de resposta que se aplicam, na ordem do questionário
  function aplicaveis(estrutura, resp) {
    const apl = new Set()
    const ordem = []
    perguntas(estrutura).forEach(({ p }) => {
      if (foraDeRespostas(p)) return
      if (!p.mostrar_se || cond(p.mostrar_se, resp, apl)) { apl.add(p.chave); ordem.push(p.chave) }
    })
    return ordem
  }

  // uma linha da lista atende ao filtro {coluna, op, valor}? Ausente: só '!='
  function linhaCasa(onde, linha) {
    const v = linha[onde.coluna]
    if (v === undefined || v === null) {
      if (onde.op === '!=') return true
      if (onde.op === '=' || onde.op === 'in' || onde.op === 'entre') return false
    } else {
      switch (onde.op) {
        case '=':     return igual(v, onde.valor)
        case '!=':    return !igual(v, onde.valor)
        case 'in':    return Array.isArray(onde.valor) && onde.valor.some(x => igual(x, v))
        case 'entre': return typeof v === 'number' && v >= onde.valor[0] && v <= onde.valor[1]
      }
    }
    throw erro('socio:estrutura_invalida: filtro de lista desconhecido')
  }

  // Mesma semântica de fn_socio_linhas_normalizar: linhas completas (com as
  // colunas de identificação), sem valores vazios, ordenadas por `ordem`.
  function linhasNormalizar(estrutura, linhas) {
    const ls = linhas === undefined || linhas === null ? [] : linhas
    if (!Array.isArray(ls)) throw erro('socio:linha_invalida: lista mal formada')
    if (ls.length === 0) return []
    const lista = estrutura.lista
    if (!lista) throw erro('socio:linha_invalida: este questionário não tem lista')
    if (ls.length > (lista.max_linhas || 30)) throw erro('socio:linha_invalida: linhas demais')
    const cols = {}
    ;(lista.colunas || []).forEach(c => { cols[c.chave] = c })
    const vistas = new Set()
    let entrevistados = 0
    const out = []
    ls.forEach(m => {
      if (!m || typeof m !== 'object' || Array.isArray(m) || typeof m.ordem !== 'number')
        throw erro('socio:linha_invalida: ordem ausente')
      const ord = m.ordem
      if (!Number.isInteger(ord) || ord < 1 || ord > 1000 || vistas.has(ord))
        throw erro('socio:linha_invalida: ordem ausente ou repetida')
      vistas.add(ord)
      const row = { ordem: ord }
      Object.keys(m).forEach(k => {
        if (k === 'ordem') return
        const v = m[k]
        if (k === 'e_entrevistado') {
          if (!lista.marca_entrevistado || typeof v !== 'boolean') throw erro('socio:linha_invalida: e_entrevistado inválido')
          if (v === true) { entrevistados++; row[k] = true }
          return
        }
        const c = cols[k]
        if (!c) throw erro('socio:linha_invalida: coluna desconhecida ' + k)
        if (v === null || v === '') return
        if (v === NR) { row[k] = v; return }
        switch (c.tipo) {
          case 'unica':
            if (typeof v !== 'string' || !(c.opcoes || []).some(o => o.v === v)) throw erro('socio:linha_invalida: ' + k + ' fora das opções')
            break
          case 'inteiro':
            if (typeof v !== 'number' || !isFinite(v)) throw erro('socio:linha_invalida: ' + k + ' deve ser número')
            if (!Number.isInteger(v) || (c.min !== undefined && v < c.min) || (c.max !== undefined && v > c.max))
              throw erro('socio:linha_invalida: ' + k + ' fora do intervalo')
            break
          case 'texto':
            if (typeof v !== 'string' || tamanho(v) > (c.max_len || 120)) throw erro('socio:linha_invalida: ' + k + ' texto inválido')
            if (btrim(v) === '') return
            break
          case 'booleano':
            if (typeof v !== 'boolean') throw erro('socio:linha_invalida: ' + k + ' deve ser sim/não')
            break
          default:
            throw erro('socio:estrutura_invalida: tipo de coluna ' + c.tipo + ' em ' + k)
        }
        row[k] = v
      })
      out.push(row)
    })
    if (entrevistados > 1) throw erro('socio:linha_invalida: mais de uma linha marcada como entrevistado')
    return out.sort((a, b) => a.ordem - b.ordem)
  }

  // separa as colunas de identificação (vão para a tabela restrita)
  function linhasSeparar(estrutura, linhasNorm) {
    const ident = new Set(((estrutura.lista || {}).colunas || []).filter(c => c.identificacao).map(c => c.chave))
    const publicas = [], identificacao = []
    linhasNorm.forEach(l => {
      const pub = {}, id = { ordem: l.ordem }
      let tem = false
      Object.keys(l).forEach(k => {
        if (ident.has(k)) { id[k] = l[k]; tem = true } else pub[k] = l[k]
      })
      publicas.push(pub)
      if (tem) identificacao.push(id)
    })
    return { publicas, identificacao }
  }

  // valor de uma pergunta derivada; undefined = sem valor
  function derivada(estrutura, p, linhas) {
    const d = p.derivada
    const ls = linhas || []
    switch (d.tipo) {
      case 'total_linhas': return ls.length
      case 'existe_linha':
        return ls.some(l => linhaCasa(d.onde, l)) ? (d.sim !== undefined ? d.sim : 'sim') : (d.nao !== undefined ? d.nao : 'nao')
      case 'maior_nivel': {
        const col = (((estrutura.lista || {}).colunas) || []).find(c => c.chave === d.coluna)
        const escala = (p.opcoes || []).map(o => o.v)
        let melhor = -1
        ls.forEach(l => {
          const o = col && (col.opcoes || []).find(x => igual(x.v, l[d.coluna]))
          const i = o && o.nivel !== undefined && o.nivel !== null ? escala.indexOf(o.nivel) : -1
          if (i > melhor) melhor = i
        })
        return melhor >= 0 ? escala[melhor] : undefined
      }
      default: throw erro('socio:estrutura_invalida: derivada desconhecida em ' + p.chave)
    }
  }

  function comDerivadas(estrutura, resp, linhas) {
    const out = Object.assign({}, resp)
    perguntas(estrutura).forEach(({ p }) => {
      if (!p.derivada) return
      const v = derivada(estrutura, p, linhas)
      if (v === undefined || v === null) delete out[p.chave]; else out[p.chave] = v
    })
    return out
  }

  // Mesma semântica de fn_socio_normalizar_respostas. `linhas` = normalizadas.
  function normalizar(estrutura, respostas, linhas) {
    const perg = porChave(estrutura)
    const maxLen = estrutura.texto_max_len || 2000
    const outLen = estrutura.outro_max_len || 120
    if (respostas !== undefined && respostas !== null && (typeof respostas !== 'object' || Array.isArray(respostas)))
      throw erro('socio:resposta_invalida: respostas deve ser um objeto')
    const resp = comDerivadas(estrutura, respostas || {}, linhas)
    const apl = aplicaveis(estrutura, resp)

    Object.keys(resp).forEach(k => {
      const base = k.replace(/_outro$/, '')
      const conhecida = perg[k] || (k.endsWith('_outro') && perg[base] &&
        (perg[base].opcoes || []).some(o => o.especificar))
      if (!conhecida) throw erro('socio:resposta_invalida: chave desconhecida ' + k)
      if (perg[k] && foraDeRespostas(perg[k])) throw erro('socio:resposta_invalida: ' + k + ' não pertence a respostas')
    })

    const out = {}
    apl.forEach(k => {
      if (!(k in resp)) return
      const p = perg[k]
      const v = resp[k]
      if (v === NR) { out[k] = v; return }
      const opcoes = (p.opcoes || []).map(o => o.v)
      switch (p.tipo) {
        case 'unica':
          if (typeof v !== 'string' || !opcoes.includes(v)) throw erro('socio:resposta_invalida: ' + k + ' fora das opções')
          break
        case 'multipla': {
          if (!Array.isArray(v) || !v.length || !v.every(x => typeof x === 'string' && opcoes.includes(x)) ||
              new Set(v).size !== v.length) throw erro('socio:resposta_invalida: ' + k + ' fora das opções')
          const excl = (p.opcoes || []).filter(o => o.exclusiva).map(o => o.v)
          if (v.length > 1 && v.some(x => excl.includes(x))) throw erro('socio:resposta_invalida: ' + k + ' tem opção exclusiva junto com outras')
          if (p.max_marcar && v.length > p.max_marcar) throw erro('socio:resposta_invalida: ' + k + ' passa do limite de ' + p.max_marcar + ' opções')
          break
        }
        case 'inteiro': case 'decimal':
          if (typeof v !== 'number' || !isFinite(v)) throw erro('socio:resposta_invalida: ' + k + ' deve ser número')
          if ((p.tipo === 'inteiro' && !Number.isInteger(v)) ||
              (p.min !== undefined && v < p.min) || (p.max !== undefined && v > p.max))
            throw erro('socio:resposta_invalida: ' + k + ' fora do intervalo')
          break
        case 'texto': case 'texto_longo':
          if (typeof v !== 'string' || tamanho(v) > (p.max_len || maxLen)) throw erro('socio:resposta_invalida: ' + k + ' texto inválido')
          if (btrim(v) === '') return
          break
        default:
          throw erro('socio:estrutura_invalida: tipo ' + p.tipo + ' em ' + k)
      }
      out[k] = v
      const ko = k + '_outro'
      if (ko in resp) {
        if (typeof resp[ko] !== 'string' || tamanho(resp[ko]) > outLen) throw erro('socio:resposta_invalida: ' + ko + ' inválido')
        if (!temOutro(v)) throw erro('socio:resposta_invalida: ' + ko + ' sem a opção Outro marcada')
        if (btrim(resp[ko]) !== '') out[ko] = resp[ko]
      }
    })
    return out
  }

  function nDe(p) { return p && p.n !== undefined ? p.n : null }

  // Mesma saída de fn_socio_calcular_alertas. `respostas` já normalizada.
  function alertas(estrutura, respostas, linhas, opts) {
    opts = opts || {}
    const al = []
    if (!respostas || Object.keys(respostas).length === 0) return al   // recusa
    const ls = linhas || []
    const apl = new Set(aplicaveis(estrutura, respostas))
    const perg = porChave(estrutura)
    perguntas(estrutura).forEach(({ p }) => {
      if (!apl.has(p.chave) || p.opcional || p.derivada) return
      const v = respostas[p.chave]
      if (v === undefined) { al.push({ tipo: 'pendente', chave: p.chave, n: nDe(p) }); return }
      if (temOutro(v) && !((p.chave + '_outro') in respostas)) al.push({ tipo: 'outro_sem_texto', chave: p.chave, n: nDe(p) })
      if (typeof v === 'number') {
        if (p.aviso_min !== undefined && v < p.aviso_min) al.push({ tipo: 'abaixo_do_esperado', chave: p.chave, n: nDe(p) })
        if (p.aviso_max !== undefined && v > p.aviso_max) al.push({ tipo: 'acima_do_esperado', chave: p.chave, n: nDe(p) })
      }
    })
    const tab = perguntas(estrutura).find(({ p }) => p.tipo === 'tabela')
    if (tab) {
      const lista = estrutura.lista || {}
      if (ls.length === 0) {
        if ((lista.minimo !== undefined && lista.minimo !== null ? lista.minimo : 1) >= 1)
          al.push({ tipo: 'pendente', chave: tab.p.chave, n: nDe(tab.p) })
      } else if (lista.marca_entrevistado && !ls.some(l => l.ordem === 1 && l.e_entrevistado === true)) {
        al.push({ tipo: 'entrevistado_fora_da_1a_linha', chave: tab.p.chave, n: nDe(tab.p) })
      }
    }
    ;(estrutura.coerencia || []).forEach(c => {
      const v = respostas[c.chave]
      if (c.tipo === 'igual_total_linhas') {
        if (typeof v === 'number' && v !== ls.length)
          al.push({ tipo: 'diverge_da_lista', chave: c.chave, n: nDe(perg[c.chave]), informado: v, listados: ls.length })
      } else if (c.tipo === 'nega_linha') {
        if ((igual(v, c.valor) || (Array.isArray(v) && v.includes(c.valor))) && ls.some(l => linhaCasa(c.onde, l)))
          al.push({ tipo: 'incoerente_com_lista', chave: c.chave, n: nDe(perg[c.chave]) })
      }
    })
    if (opts.usou_carencia) al.push({ tipo: 'enviada_na_carencia' })
    if (opts.comunidade_nova) al.push({ tipo: 'comunidade_nova' })
    return al
  }

  // número exibido da pergunta: rótulo livre ("0.6", "32.1") ou o n
  function numero(p) { return p ? String(p.rotulo || p.n) : '' }

  // Texto curto para a tela de revisão (o técnico lê isto em campo)
  function descreverAlerta(a, estrutura) {
    const p = a.chave && porChave(estrutura)[a.chave]
    const q = p ? 'P' + numero(p) : (a.n !== null && a.n !== undefined ? 'P' + a.n : '')
    switch (a.tipo) {
      case 'pendente': return q + ' em branco' + (p ? ' — ' + p.texto : '')
      case 'outro_sem_texto': return q + ': marcou "Outro" sem especificar'
      case 'abaixo_do_esperado': return q + ': valor abaixo do esperado — confira'
      case 'acima_do_esperado': return q + ': valor acima do esperado — confira'
      case 'entrevistado_fora_da_1a_linha': return q + ': o entrevistado deve ser a 1ª linha'
      case 'diverge_da_lista': return q + ' diz ' + a.informado + ', mas a lista tem ' + a.listados
      case 'incoerente_com_lista': return q + ': a resposta contradiz a lista'
      case 'enviada_na_carencia': return 'Enviada depois do fim do acesso (carência)'
      case 'comunidade_nova': return 'Comunidade nova — o gestor vai cadastrar'
      default: return a.tipo
    }
  }

  // Código legível gerado no aparelho:  <PREFIXO>-<AAMMDD>-<DISP>-<NN>
  // PREFIXO = código do instrumento; 'TRE' = ficha do modo treino.
  function gerarCodigo(prefixo, data, dispositivo, seq) {
    const d = data instanceof Date ? data : new Date(data + 'T12:00:00')
    const aa = String(d.getFullYear()).slice(2)
    const mm = String(d.getMonth() + 1).padStart(2, '0')
    const dd = String(d.getDate()).padStart(2, '0')
    return [prefixo, aa + mm + dd, dispositivo, String(seq).padStart(2, '0')].join('-')
  }

  const api = { NR, perguntas, porChave, foraDeRespostas, cond, aplicaveis, linhaCasa, linhasNormalizar,
                linhasSeparar, derivada, comDerivadas, normalizar, alertas, numero, descreverAlerta, gerarCodigo }
  if (typeof module !== 'undefined' && module.exports) module.exports = api
  else raiz.SocioRegras = api
})(typeof window !== 'undefined' ? window : globalThis)
