// ── SIGUC-AC · Diagnóstico Socioeconômico — pré-visualização ───────────
//
// Desenha, SÓ PARA LEITURA, como o questionário vai aparecer: blocos,
// perguntas numeradas, opções, saltos escritos em português, lista e
// conferências automáticas. Usado no editor de versões da mesa
// (pages/socio-questionarios.html) — quem escreve o JSON vê na hora o que
// o entrevistador vai ver.
//
// Função pura: recebe a estrutura (socio_questionarios.estrutura) e
// devolve HTML. Não valida nada — validar é fn_socio_validar_estrutura
// no banco (fonte única); aqui, estrutura torta é desenhada como dá,
// nunca lança.

;(function (raiz) {
  'use strict'

  const escH = s => String(s === undefined || s === null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

  const TIPO_ROTULO = {
    unica: 'Escolha uma opção', multipla: 'Pode marcar mais de uma', inteiro: 'Número inteiro',
    decimal: 'Número', texto: 'Texto curto', texto_longo: 'Texto livre', tabela: 'Lista',
  }
  const COL_TIPO = { unica: 'escolha', inteiro: 'número', texto: 'texto', booleano: 'sim/não' }
  const UNIDADE = { domicilio: 'Domicílio', pessoa: 'Pessoa', comunidade: 'Comunidade', estabelecimento: 'Estabelecimento' }

  function perguntas(est) {
    const l = []
    ;((est && est.blocos) || []).forEach(b => ((b && b.perguntas) || []).forEach(p => l.push(p)))
    return l
  }
  function porChave(est) { const m = {}; perguntas(est).forEach(p => { if (p && p.chave) m[p.chave] = p }); return m }
  function num(p) { return p ? String(p.rotulo || p.n || '?') : '?' }
  function rotuloOpcao(p, v) {
    const o = p && (p.opcoes || []).find(x => x && x.v === v)
    return o ? o.r : v
  }
  function listaValores(p, vs) {
    return (Array.isArray(vs) ? vs : [vs]).map(v => '“' + escH(rotuloOpcao(p, v)) + '”').join(' ou ')
  }

  // condição de salto em português: "P8 é “Rio”", "P11 inclui “Pesca”"
  function descreverCond(c, perg) {
    if (!c || typeof c !== 'object') return ''
    if (Array.isArray(c.todas)) return c.todas.map(x => descreverCond(x, perg)).join(' e ')
    const p = perg[c.se]
    const q = p ? 'P' + escH(num(p)) : '“' + escH(c.se) + '”'
    switch (c.op) {
      case '=': return q + ' é ' + listaValores(p, c.valor)
      case '!=': return q + ' não é ' + listaValores(p, c.valor)
      case 'in': return q + ' é ' + listaValores(p, c.valor)
      case 'contem': return q + ' inclui ' + listaValores(p, c.valor)
      case 'nao_contem': return q + ' não inclui ' + listaValores(p, c.valor)
      default: return q + ' (condição desconhecida)'
    }
  }

  function descreverOnde(o, est) {
    if (!o || typeof o !== 'object') return ''
    const col = (((est.lista || {}).colunas) || []).find(c => c && c.chave === o.coluna)
    const nome = escH(col ? col.rotulo : o.coluna)
    const val = v => {
      const op = col && (col.opcoes || []).find(x => x && x.v === v)
      return '“' + escH(op ? op.r : v) + '”'
    }
    switch (o.op) {
      case '=': return nome + ' é ' + val(o.valor)
      case '!=': return nome + ' não é ' + val(o.valor)
      case 'in': return nome + ' é ' + (Array.isArray(o.valor) ? o.valor.map(val).join(' ou ') : val(o.valor))
      case 'entre': return nome + ' entre ' + escH((o.valor || [])[0]) + ' e ' + escH((o.valor || [])[1])
      default: return nome
    }
  }

  function descreverDerivada(p, est) {
    const d = p.derivada || {}
    if (d.tipo === 'total_linhas') return 'Calculada: número de linhas da lista'
    if (d.tipo === 'existe_linha') return 'Calculada: há alguém na lista com ' + descreverOnde(d.onde, est) + '?'
    if (d.tipo === 'maior_nivel') {
      const col = (((est.lista || {}).colunas) || []).find(c => c && c.chave === d.coluna)
      return 'Calculada: maior valor de “' + escH(col ? col.rotulo : d.coluna) + '” na lista'
    }
    return 'Calculada'
  }

  function opcoesHTML(p) {
    const ops = Array.isArray(p.opcoes) ? p.opcoes : []
    if (!ops.length) return ''
    const marca = p.tipo === 'multipla' ? 'soc-mk soc-mk-caixa' : 'soc-mk soc-mk-radio'
    return '<ul class="soc-pv-opcoes">' + ops.map(o => {
      o = o || {}
      const tags = []
      if (o.exclusiva) tags.push('<span class="soc-pv-tag">sozinha</span>')
      if (o.especificar) tags.push('<span class="soc-pv-tag">pede especificar</span>')
      return '<li><span class="' + marca + '" aria-hidden="true"></span>' + escH(o.r || o.v) + tags.join('') + '</li>'
    }).join('') + '</ul>'
  }

  function listaHTML(est) {
    const l = est.lista
    if (!l || !Array.isArray(l.colunas)) return '<div class="soc-pv-erro">Falta a definição da lista (“lista” na estrutura).</div>'
    const cab = l.colunas.map(c => {
      c = c || {}
      return '<th scope="col">' + escH(c.rotulo || c.chave) +
        '<span class="soc-pv-col-tipo">' + escH(COL_TIPO[c.tipo] || c.tipo) + (c.identificacao ? ' · identificação' : '') + '</span></th>'
    }).join('')
    const extras = []
    extras.push('até ' + escH(l.max_linhas || 30) + ' linhas')
    if (l.marca_entrevistado) extras.push('o entrevistado é a 1ª linha')
    if ((l.minimo === undefined || l.minimo === null ? 1 : l.minimo) < 1) extras.push('pode ficar vazia')
    return '<div class="table-wrap soc-pv-lista"><table><thead><tr><th scope="col">#</th>' + cab +
      '</tr></thead><tbody><tr><td>1</td>' + l.colunas.map(() => '<td class="soc-pv-vazio">—</td>').join('') +
      '</tr></tbody></table></div><div class="soc-pv-nota">' + extras.join(' · ') + '</div>'
  }

  function perguntaHTML(p, perg, est) {
    if (!p || typeof p !== 'object') return ''
    const meta = []
    if (p.tipo === 'inteiro' || p.tipo === 'decimal') {
      if (p.min !== undefined || p.max !== undefined)
        meta.push('de ' + escH(p.min === undefined ? '…' : p.min) + ' a ' + escH(p.max === undefined ? '…' : p.max))
    }
    if (p.max_marcar) meta.push('até ' + escH(p.max_marcar) + ' opções')
    if (p.opcional) meta.push('opcional')
    const corpo = p.tipo === 'tabela' ? listaHTML(est) : opcoesHTML(p)
    return '<li class="soc-pv-perg' + (p.derivada ? ' soc-pv-derivada' : '') + '">' +
      '<div class="soc-pv-cab"><span class="soc-pv-num">P' + escH(num(p)) + '</span>' +
      '<span class="soc-pv-texto">' + escH(p.texto) + '</span></div>' +
      '<div class="soc-pv-meta"><span>' + escH(TIPO_ROTULO[p.tipo] || p.tipo) + '</span>' +
      meta.map(m => '<span>' + m + '</span>').join('') + '</div>' +
      (p.mostrar_se ? '<div class="soc-pv-salto">Só aparece se ' + descreverCond(p.mostrar_se, perg) + '</div>' : '') +
      (p.derivada ? '<div class="soc-pv-salto">' + descreverDerivada(p, est) + ' — o entrevistador não digita</div>' : '') +
      (p.ajuda ? '<div class="soc-pv-ajuda">' + escH(p.ajuda) + '</div>' : '') +
      corpo + '</li>'
  }

  function coerenciaHTML(est, perg) {
    const cs = Array.isArray(est.coerencia) ? est.coerencia : []
    if (!cs.length) return ''
    return '<section class="soc-pv-bloco"><h4>Conferências automáticas</h4><ul class="soc-pv-coer">' + cs.map(c => {
      c = c || {}
      const p = perg[c.chave]
      const q = p ? 'P' + escH(num(p)) : '“' + escH(c.chave) + '”'
      if (c.tipo === 'igual_total_linhas') return '<li>' + q + ' deve bater com o número de linhas da lista</li>'
      if (c.tipo === 'nega_linha') return '<li>' + q + ' = “' + escH(rotuloOpcao(p, c.valor)) + '” contradiz a lista quando há alguém com ' + descreverOnde(c.onde, est) + '</li>'
      return '<li>' + q + '</li>'
    }).join('') + '</ul><div class="soc-pv-nota">Nada disso impede salvar: vira alerta na revisão e na validação.</div></section>'
  }

  // opts: { aviso, unidadeAnalise }
  function previaHTML(est, opts) {
    opts = opts || {}
    if (!est || typeof est !== 'object' || !Array.isArray(est.blocos)) {
      return '<div class="soc-pv-erro">A estrutura ainda não tem “blocos” para mostrar.</div>'
    }
    const perg = porChave(est)
    const id = est.identificacao || {}
    const ident = [
      'Nome do entrevistado: ' + (id.nome === 'opcional' ? 'opcional' : 'não é registrado'),
      'Localização (GPS): ' + (id.gps === 'opcional' ? 'opcional' : 'não é registrada'),
    ]
    if (opts.unidadeAnalise) ident.unshift('Unidade: ' + escH(UNIDADE[opts.unidadeAnalise] || opts.unidadeAnalise))
    return '<div class="soc-pv">' +
      (opts.aviso ? '<section class="soc-pv-aviso"><h4>Aviso lido ao entrevistado</h4><p>' +
        escH(opts.aviso).replace(/\n/g, '<br>') + '</p></section>' : '') +
      '<div class="soc-pv-ident">' + ident.map(t => '<span>' + t + '</span>').join('') + '</div>' +
      est.blocos.map(b => {
        b = b || {}
        const ps = Array.isArray(b.perguntas) ? b.perguntas : []
        return '<section class="soc-pv-bloco"><h4>' + escH(b.titulo || b.id) + '</h4><ol class="soc-pv-lista-perg">' +
          ps.map(p => perguntaHTML(p, perg, est)).join('') + '</ol></section>'
      }).join('') +
      coerenciaHTML(est, perg) + '</div>'
  }

  function contar(est) {
    const ps = perguntas(est)
    return { blocos: ((est && est.blocos) || []).length, perguntas: ps.filter(p => p && p.tipo !== 'tabela').length,
             temLista: ps.some(p => p && p.tipo === 'tabela') }
  }

  // ponto de partida para um instrumento novo — curto, só para mostrar o formato
  function modelo() {
    return {
      identificacao: { nome: 'opcional', gps: 'opcional' },
      lista: {
        titulo: 'Quem mora no domicílio', max_linhas: 30, minimo: 1, marca_entrevistado: true,
        colunas: [
          { chave: 'idade', rotulo: 'Idade', tipo: 'inteiro', min: 0, max: 120 },
          { chave: 'sexo', rotulo: 'Sexo', tipo: 'unica', opcoes: [{ v: 'mulher', r: 'Mulher' }, { v: 'homem', r: 'Homem' }, { v: 'outro', r: 'Outro' }] },
        ],
      },
      coerencia: [{ tipo: 'igual_total_linhas', chave: 'qtd_moradores' }],
      blocos: [
        { id: 'domicilio', titulo: 'Domicílio', perguntas: [
          { n: 1, chave: 'qtd_moradores', tipo: 'inteiro', texto: 'Quantas pessoas moram neste domicílio?', min: 1, max: 40 },
          { n: 2, chave: 'moradores', tipo: 'tabela', texto: 'Quem mora no domicílio' },
        ] },
        { id: 'agua', titulo: 'Água', perguntas: [
          { n: 3, chave: 'agua_fonte', tipo: 'unica', texto: 'De onde vem a água usada para beber?', opcoes: [
            { v: 'rio', r: 'Rio ou igarapé' }, { v: 'poco', r: 'Poço' }, { v: 'rede', r: 'Rede pública' },
            { v: 'outro', r: 'Outro', especificar: true }] },
          { n: 4, chave: 'agua_trata', tipo: 'unica', texto: 'A água é tratada antes de beber?',
            opcoes: [{ v: 'sim', r: 'Sim' }, { v: 'nao', r: 'Não' }],
            mostrar_se: { se: 'agua_fonte', op: '!=', valor: 'rede' } },
        ] },
      ],
    }
  }

  const api = { previaHTML, descreverCond, contar, modelo, UNIDADE }
  if (typeof module !== 'undefined' && module.exports) module.exports = api
  else raiz.SocioPrevia = api
})(typeof window !== 'undefined' ? window : globalThis)
