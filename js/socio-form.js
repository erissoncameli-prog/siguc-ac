// ── SIGUC-AC · Diagnóstico Socioeconômico — formulário do app de campo ──
//
// Desenha um bloco do questionário a partir da ESTRUTURA (dado, não código)
// e aplica o que o entrevistador marca ao estado da ficha. Saltos, derivadas
// e pendências vêm de js/socio-regras.js — a mesma linguagem que o banco
// valida (362b). Aqui não há regra de negócio própria: só desenho e coleta.
//
// Estado da ficha usado aqui:
//   est.resp   → respostas cruas ({chave: valor}, '_nr' = Não respondeu,
//                '<chave>_outro' = especifique)
//   est.linhas → lista (moradores, membros…): [{ordem, coluna: valor…}]
//
// Ninguém fica preso: nenhuma pergunta é obrigatória para avançar de bloco;
// o que falta aparece na revisão como pendência, e o banco aceita a ficha
// com pendência (vira alerta para o gestor).

;(function (raiz) {
  'use strict'
  const R = () => raiz.SocioRegras
  const NR = '_nr'

  function e(s) {
    return String(s === undefined || s === null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
  }

  // respostas com derivadas calculadas pela lista (o que o banco vai ver)
  function respEfetivas(estrutura, est) {
    let linhas = []
    try { linhas = R().linhasNormalizar(estrutura, est.linhas || []) } catch (_) { linhas = [] }
    return R().comDerivadas(estrutura, est.resp || {}, linhas)
  }

  function rotuloOpcao(p, v) {
    const o = (p.opcoes || []).find(x => x.v === v)
    return o ? o.r : v
  }

  function perguntaHTML(estrutura, p, resp, est) {
    const k = p.chave
    const v = resp[k]
    const nr = v === NR
    const id = 'sq-' + k
    const num = R().numero(p)
    const cab = `<legend class="sq-texto"><span class="sq-n">${e(num)}</span> ${e(p.texto)}</legend>` +
      (p.ajuda ? `<p class="sq-ajuda">${e(p.ajuda)}</p>` : '')

    if (p.derivada) {
      const txt = v === undefined ? 'sem dado na lista ainda' : (p.opcoes ? rotuloOpcao(p, v) : v)
      return `<fieldset class="sq sq-derivada" data-chave="${e(k)}">${cab}
        <p class="sq-calc"><span class="sq-calc-rot">Calculado pela lista:</span> <strong>${e(txt)}</strong></p></fieldset>`
    }
    if (p.tipo === 'tabela') return `<fieldset class="sq sq-tabela" data-chave="${e(k)}">${cab}${listaHTML(estrutura, est)}</fieldset>`

    let ctl = ''
    const dis = nr ? ' disabled' : ''
    switch (p.tipo) {
      case 'unica':
        ctl = `<div class="sq-opcoes" role="radiogroup" aria-labelledby="${id}-l">` + (p.opcoes || []).map(o =>
          `<label class="sq-op${v === o.v ? ' marcada' : ''}"><input type="radio" name="${e(id)}" data-k="${e(k)}" data-acao="unica" value="${e(o.v)}"${v === o.v ? ' checked' : ''}${dis}><span>${e(o.r)}</span></label>`).join('') + '</div>'
        break
      case 'multipla': {
        const marc = Array.isArray(v) ? v : []
        const cheio = p.max_marcar && marc.length >= p.max_marcar
        ctl = (p.max_marcar ? `<p class="sq-ajuda">Marque até ${p.max_marcar}.</p>` : '<p class="sq-ajuda">Pode marcar mais de uma.</p>') +
          '<div class="sq-opcoes">' + (p.opcoes || []).map(o => {
            const m = marc.includes(o.v)
            const bloq = nr || (cheio && !m)
            return `<label class="sq-op sq-op-caixa${m ? ' marcada' : ''}${o.exclusiva ? ' exclusiva' : ''}"><input type="checkbox" data-k="${e(k)}" data-acao="multipla" value="${e(o.v)}"${m ? ' checked' : ''}${bloq ? ' disabled' : ''}><span>${e(o.r)}</span></label>`
          }).join('') + '</div>'
        break
      }
      case 'inteiro': case 'decimal': {
        const lim = (p.min !== undefined ? `mín. ${p.min}` : '') + (p.min !== undefined && p.max !== undefined ? ' · ' : '') + (p.max !== undefined ? `máx. ${p.max}` : '')
        const bruto = est.bruto && est.bruto[k] !== undefined ? est.bruto[k] : (typeof v === 'number' ? String(v).replace('.', ',') : '')
        ctl = `<input class="sq-num" id="${e(id)}" type="text" inputmode="${p.tipo === 'inteiro' ? 'numeric' : 'decimal'}" autocomplete="off"
                 data-k="${e(k)}" data-acao="numero" data-tipo="${p.tipo}" value="${e(nr ? '' : bruto)}" aria-describedby="${e(id)}-msg"${dis}>
               <p class="sq-lim" id="${e(id)}-msg" data-lim="${e(lim)}">${e(lim)}</p>`
        break
      }
      case 'texto': case 'texto_longo': {
        const max = p.max_len || estrutura.texto_max_len || 2000
        const txt = typeof v === 'string' && !nr ? v : ''
        ctl = p.tipo === 'texto'
          ? `<input class="sq-txt" id="${e(id)}" type="text" maxlength="${max}" data-k="${e(k)}" data-acao="texto" value="${e(txt)}"${dis}>`
          : `<textarea class="sq-txt" id="${e(id)}" rows="4" maxlength="${max}" data-k="${e(k)}" data-acao="texto"${dis}>${e(txt)}</textarea>`
        break
      }
      default:
        ctl = `<p class="sq-ajuda">Tipo de pergunta não suportado neste app (${e(p.tipo)}).</p>`
    }

    // "especifique" de quem marcou Outro
    const temOutro = v === 'outro' || (Array.isArray(v) && v.includes('outro'))
    const opOutro = (p.opcoes || []).find(o => o.v === 'outro' && o.especificar)
    if (temOutro && opOutro && !nr) {
      const max = estrutura.outro_max_len || 120
      ctl += `<label class="sq-outro"><span>Especifique</span><input type="text" maxlength="${max}" data-k="${e(k)}_outro" data-acao="texto" value="${e(resp[k + '_outro'] || '')}"></label>`
    }

    return `<fieldset class="sq${nr ? ' sq-nr' : ''}" data-chave="${e(k)}"><span id="${e(id)}-l" hidden>${e(p.texto)}</span>${cab}${ctl}
      ${p.opcional ? '<p class="sq-ajuda">Opcional.</p>' : ''}
      <button type="button" class="sq-nr-btn" data-k="${e(k)}" data-acao="nr" aria-pressed="${nr}">${nr ? 'Desfazer: não respondeu' : 'Não respondeu'}</button>
    </fieldset>`
  }

  // ── lista (moradores, membros…) ───────────────────────────────────────
  function celulaHTML(c, l, i) {
    const v = l[c.chave]
    const nome = `sl-${i}-${c.chave}`
    const base = `data-acao="celula" data-i="${i}" data-col="${e(c.chave)}"`
    let ctl
    switch (c.tipo) {
      case 'inteiro':
        ctl = `<input id="${nome}" type="text" inputmode="numeric" autocomplete="off" ${base} data-tipo="inteiro" value="${e(typeof v === 'number' ? v : '')}">`
        break
      case 'unica':
        ctl = `<select id="${nome}" ${base}><option value="">—</option>` + (c.opcoes || []).map(o =>
          `<option value="${e(o.v)}"${v === o.v ? ' selected' : ''}>${e(o.r)}</option>`).join('') + '</select>'
        break
      case 'booleano':
        ctl = `<select id="${nome}" ${base} data-tipo="booleano"><option value="">—</option>
          <option value="sim"${v === true ? ' selected' : ''}>Sim</option><option value="nao"${v === false ? ' selected' : ''}>Não</option></select>`
        break
      default:
        ctl = `<input id="${nome}" type="text" maxlength="${c.max_len || 120}" ${base} value="${e(typeof v === 'string' ? v : '')}">`
    }
    return `<label class="sl-cel" for="${nome}"><span>${e(c.rotulo || c.chave)}${c.identificacao ? ' <em class="sl-ident">identificação</em>' : ''}</span>${ctl}</label>`
  }

  function listaHTML(estrutura, est) {
    const lista = estrutura.lista || {}
    const linhas = est.linhas || []
    const max = lista.max_linhas || 30
    const cards = linhas.map((l, i) => `
      <div class="sl-linha" data-i="${i}">
        <div class="sl-cab"><strong>${i + 1}ª pessoa</strong>
          ${lista.marca_entrevistado ? `<label class="sl-entrev"><input type="radio" name="sl-entrev" data-acao="entrevistado" data-i="${i}"${l.e_entrevistado ? ' checked' : ''}> É quem responde</label>` : ''}
          <button type="button" class="sl-rem" data-acao="remover-linha" data-i="${i}" aria-label="Remover a ${i + 1}ª pessoa">Remover</button>
        </div>
        <div class="sl-cels">${(lista.colunas || []).map(c => celulaHTML(c, l, i)).join('')}</div>
      </div>`).join('')
    return `<div class="sl">
      ${lista.marca_entrevistado ? '<p class="sq-ajuda">Comece por quem está respondendo (1ª pessoa).</p>' : ''}
      ${cards || '<p class="sl-vazia">Ninguém na lista ainda.</p>'}
      <button type="button" class="sl-add" data-acao="adicionar-linha"${linhas.length >= max ? ' disabled' : ''}>Adicionar pessoa</button>
      ${linhas.length >= max ? `<p class="sq-ajuda">Limite de ${max} linhas.</p>` : ''}
    </div>`
  }

  // perguntas do bloco que se aplicam agora
  function blocoHTML(estrutura, bloco, est) {
    const resp = respEfetivas(estrutura, est)
    const apl = new Set(R().aplicaveis(estrutura, resp))
    const html = (bloco.perguntas || [])
      .filter(p => p.tipo === 'tabela' || apl.has(p.chave))
      .map(p => perguntaHTML(estrutura, p, resp, est)).join('')
    return html || '<p class="sl-vazia">Nenhuma pergunta deste bloco se aplica a esta entrevista.</p>'
  }

  function numeroDe(txt, tipo) {
    const t = String(txt).trim().replace(/\s/g, '').replace(',', '.')
    if (t === '') return { vazio: true }
    if (!/^-?\d+(\.\d+)?$/.test(t)) return { erro: 'Digite só números' }
    const n = Number(t)
    if (tipo === 'inteiro' && !Number.isInteger(n)) return { erro: 'Número inteiro, sem vírgula' }
    return { n }
  }

  // Aplica um evento do formulário ao estado. Devolve true quando o bloco
  // precisa ser redesenhado (mudou o que aparece), false quando não.
  function aplicar(estrutura, est, alvo) {
    const acao = alvo.dataset.acao
    const k = alvo.dataset.k
    const perg = R().porChave(estrutura)
    est.resp = est.resp || {}
    est.linhas = est.linhas || []
    est.bruto = est.bruto || {}
    switch (acao) {
      case 'unica':
        est.resp[k] = alvo.value
        if (alvo.value !== 'outro') delete est.resp[k + '_outro']
        return true
      case 'multipla': {
        const p = perg[k]
        let marc = Array.isArray(est.resp[k]) ? est.resp[k].slice() : []
        const op = (p.opcoes || []).find(o => o.v === alvo.value) || {}
        if (alvo.checked) {
          marc = op.exclusiva ? [alvo.value] : marc.filter(x => !((p.opcoes || []).find(o => o.v === x) || {}).exclusiva).concat(alvo.value)
        } else marc = marc.filter(x => x !== alvo.value)
        // na ordem das opções, como o entrevistador lê
        marc = (p.opcoes || []).map(o => o.v).filter(x => marc.includes(x))
        if (marc.length) est.resp[k] = marc; else delete est.resp[k]
        if (!marc.includes('outro')) delete est.resp[k + '_outro']
        return true
      }
      case 'numero': {
        const p = perg[k]
        const r = numeroDe(alvo.value, alvo.dataset.tipo)
        const msg = alvo.parentElement && alvo.parentElement.querySelector('.sq-lim')
        est.bruto[k] = alvo.value
        let aviso = ''
        if (r.vazio) { delete est.resp[k]; delete est.bruto[k] }
        else if (r.erro) { delete est.resp[k]; aviso = r.erro }
        else if ((p.min !== undefined && r.n < p.min) || (p.max !== undefined && r.n > p.max)) {
          delete est.resp[k]; aviso = `Fora do intervalo (${p.min ?? '…'} a ${p.max ?? '…'})`
        } else {
          est.resp[k] = r.n; delete est.bruto[k]
          if (p.aviso_min !== undefined && r.n < p.aviso_min) aviso = 'Abaixo do esperado — confira com a pessoa'
          if (p.aviso_max !== undefined && r.n > p.aviso_max) aviso = 'Acima do esperado — confira com a pessoa'
        }
        if (msg) { msg.textContent = aviso || msg.dataset.lim || ''; msg.classList.toggle('sq-erro', !!aviso) }
        alvo.setAttribute('aria-invalid', aviso && !(k in est.resp) ? 'true' : 'false')
        return false
      }
      case 'texto':
        if (alvo.value === '') delete est.resp[k]; else est.resp[k] = alvo.value
        return false
      case 'nr':
        if (est.resp[k] === NR) delete est.resp[k]
        else { est.resp[k] = NR; delete est.resp[k + '_outro']; delete est.bruto[k] }
        return true
      case 'adicionar-linha': {
        const max = (estrutura.lista || {}).max_linhas || 30
        if (est.linhas.length >= max) return false
        const nova = { ordem: est.linhas.length + 1 }
        if ((estrutura.lista || {}).marca_entrevistado && est.linhas.length === 0) nova.e_entrevistado = true
        est.linhas.push(nova)
        return true
      }
      case 'remover-linha': {
        const i = Number(alvo.dataset.i)
        est.linhas.splice(i, 1)
        est.linhas.forEach((l, j) => { l.ordem = j + 1 })
        return true
      }
      case 'entrevistado': {
        const i = Number(alvo.dataset.i)
        est.linhas.forEach((l, j) => { if (j === i) l.e_entrevistado = true; else delete l.e_entrevistado })
        return false
      }
      case 'celula': {
        const l = est.linhas[Number(alvo.dataset.i)]
        if (!l) return false
        const col = alvo.dataset.col
        const v = alvo.value
        if (v === '') delete l[col]
        else if (alvo.dataset.tipo === 'inteiro') {
          const r = numeroDe(v, 'inteiro')
          if (r.n === undefined) delete l[col]; else l[col] = r.n
        } else if (alvo.dataset.tipo === 'booleano') l[col] = v === 'sim'
        else l[col] = v
        return alvo.tagName === 'SELECT'   // seleção pode mudar derivadas e saltos
      }
    }
    return false
  }

  // Conferência final: o que o banco vai receber, já normalizado, e os
  // avisos para a revisão. Erro de formato (ex.: idade fora do intervalo na
  // lista) volta como `erro` — a revisão mostra e não deixa enviar torto.
  function conferir(estrutura, est, opts) {
    try {
      const linhas = R().linhasNormalizar(estrutura, est.linhas || [])
      const resp = R().normalizar(estrutura, est.resp || {}, linhas)
      const alertas = R().alertas(estrutura, resp, linhas, opts || {})
      return { linhas, resp, alertas }
    } catch (err) {
      const m = String(err.message || err).replace(/^socio:[a-z_]+:\s*/, '')
      return { erro: m }
    }
  }

  const api = { blocoHTML, perguntaHTML, listaHTML, aplicar, conferir, respEfetivas, numeroDe }
  if (typeof module !== 'undefined' && module.exports) module.exports = api
  else raiz.SocioForm = api
})(typeof window !== 'undefined' ? window : globalThis)
