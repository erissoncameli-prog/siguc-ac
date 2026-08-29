/* ═══════════════════════════════════════════════════════════════
   Baralho de PIN — comportamento compartilhado pelos 4 apps de campo
   (Brigadas, Biomonitor, Frota, Água). Par de css/pin-baralho.css.

   O QUE FAZ: troca as 4 bolinhas do display de PIN por 4 cartas.
   Cada dígito cai numa carta; quando o PIN fecha, as cartas deslizam
   para o centro e viram um monte que pulsa enquanto o app confere.
   Aprovado, o monte fica verde com o visto; recusado, o baralho se
   abre de volta nas quatro casas e treme.

   POR QUE: a bolinha acende e pronto — ela não diz que o 4º dígito
   fechou o PIN nem que o app está conferindo. Sol na tela e luva no
   dedo, o brigadista digita de novo. O monte usa o PRÓPRIO PIN como
   indicador de espera: sem spinner novo e sem mudar altura de nada
   (a regra de espera do sistema vale igual aqui).

   FONTE ÚNICA: nenhuma página remonta a animação — mesma lição de
   js/frota-consumo.js e js/mapa-recorte.js. Um app entra só com a
   sua cor (`--pin-cor`, no CSS dele) e com o que "conferir o PIN"
   significa ali.

   DEGRADA EM SILÊNCIO: sem este arquivo carregado, `pinBaralhoMontar`
   não existe, o display continua com as bolinhas que o HTML já traz
   e cada app segue funcionando como antes. Por isso todo chamador
   guarda com `typeof pinBaralho... === 'function'`.

   API (todas aceitam o elemento do display; devolvem promessa quando
   têm animação, para o app encadear sem cravar milissegundo):
     pinBaralhoMontar(el)          → troca as bolinhas por cartas
     pinBaralhoPintar(el, str)     → um dígito caiu (ou apagou)
     pinBaralhoFechar(el)          → o PIN fechou: forma o monte
     pinBaralhoAprovar(el)         → verde + visto
     pinBaralhoRecusar(el)         → abre de volta, treme e limpa
     pinBaralhoLimpar(el)          → volta ao estado inicial
   ═══════════════════════════════════════════════════════════════ */

(function () {
  'use strict'

  var TAMANHO_PADRAO = 4
  var GIRO = [-7, -2.4, 2.4, 7]       // graus de cada carta no monte
  var MS_REVELA = 520                  // dígito visível antes de virar ponto
  var SELO = '<svg class="pin-selo" viewBox="0 0 24 24" aria-hidden="true">' +
             '<path d="M5 12.5l4.2 4.2L19 7"/></svg>'

  // Lido a cada uso (e não uma vez no load): o usuário pode ligar
  // "reduzir movimento" com o app aberto.
  function reduzMovimento() {
    try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches }
    catch (e) { return false }
  }
  function dur(ms) { return reduzMovimento() ? 0 : ms }
  function espera(ms) { return new Promise(function (r) { setTimeout(r, ms) }) }

  function vibrar(padrao) {
    try { if (navigator.vibrate) navigator.vibrate(padrao) } catch (e) {}
  }

  function ehBaralho(el) { return !!(el && el.classList && el.classList.contains('pin-baralho')) }
  function cartas(el) { return Array.prototype.slice.call(el.querySelectorAll('.pin-carta')) }

  // Timers ficam presos ao elemento para que limpar() cancele tudo —
  // senão a revelação de um dígito antigo repinta uma carta já
  // apagada (acontece de verdade quando se apaga rápido).
  function agendar(el, fn, ms) {
    if (!el._pinTimers) el._pinTimers = []
    var id = setTimeout(fn, ms)
    el._pinTimers.push(id)
    return id
  }
  function cancelarTimers(el) {
    (el._pinTimers || []).forEach(clearTimeout)
    el._pinTimers = []
  }

  // ── Montagem ────────────────────────────────────────────────────
  function montar(el, opts) {
    if (!el) return false
    if (ehBaralho(el)) { limpar(el); return true }   // idempotente
    var n = (opts && opts.tamanho) || TAMANHO_PADRAO
    el.innerHTML = ''
    for (var i = 0; i < n; i++) {
      var c = document.createElement('span')
      c.className = 'pin-carta'
      c.innerHTML = '<span class="pin-glifo"></span>'
      el.appendChild(c)
    }
    el.classList.add('pin-baralho')
    el._pinTimers = []
    el._pinLen = 0
    aplicar(el, '')
    return true
  }

  // Filete de luz que dá uma volta na borda quando o dígito cai
  // (css/pin-baralho.css). A classe é retirada no fim para que o
  // MESMO dígito digitado de novo — apagou e repetiu — volte a
  // disparar: animação só reinicia se a classe sair e entrar.
  function varrerBorda(carta) {
    carta.classList.remove('varrendo')
    // Força o reflow: sem ler o layout entre o remove e o add, o
    // navegador agrupa os dois e a animação não recomeça.
    void carta.offsetWidth
    carta.classList.add('varrendo')
  }

  // ── Pintura por dígito ──────────────────────────────────────────
  function aplicar(el, str) {
    cartas(el).forEach(function (c, i) {
      var preenchida = i < str.length
      c.classList.toggle('cheia', preenchida)
      c.classList.toggle('mira', i === str.length)
      var g = c.querySelector('.pin-glifo')
      // Casa vazia não guarda a marca de "acabou de receber dígito" —
      // a animação é de uma passada só, então visualmente não muda
      // nada, mas deixar a classe pendurada é estado velho esperando
      // para confundir quem for mexer aqui depois.
      if (!preenchida) { c.classList.remove('varrendo'); c.dataset.pinD = ''; g.textContent = ''; return }
      if (c.dataset.pinD === str[i]) return          // já mostrada, não repinta
      c.dataset.pinD = str[i]
      g.textContent = str[i]
      varrerBorda(c)
      // Visível por meio segundo, depois vira ponto: dá para conferir
      // o que se digitou sem deixar o PIN legível de longe.
      agendar(el, function () {
        if (c.classList.contains('cheia') && c.dataset.pinD === str[i]) {
          g.innerHTML = '<span class="pin-ponto"></span>'
        }
      }, MS_REVELA)
    })
  }

  function pintar(el, str) {
    if (!ehBaralho(el)) return false
    str = str || ''
    // O app zerou o buffer (erro, cancelamento) enquanto o monte
    // estava formado: desfaz tudo em vez de só apagar os dígitos.
    if (!str.length && (el.classList.contains('pin-empilhando') || el.classList.contains('pin-conferindo'))) {
      limpar(el); return true
    }
    if (str.length > (el._pinLen || 0)) vibrar(10)   // retorno tátil por tecla
    el._pinLen = str.length
    aplicar(el, str)
    return true
  }

  // ── O PIN fechou: as cartas viram um monte ──────────────────────
  function fechar(el) {
    if (!ehBaralho(el)) return Promise.resolve(false)
    var cs = cartas(el)
    if (!cs.length) return Promise.resolve(false)

    // Cancela a revelação pendente do último dígito: com o PIN
    // conferido rápido (hash local, é o caso normal), o timer de meio
    // segundo chegava DEPOIS do visto e trocava o selo verde por um
    // ponto. Fechado o baralho, não há mais dígito a mascarar.
    cancelarTimers(el)

    var r = cs.map(function (c) { return c.getBoundingClientRect() })
    var topo = cs[cs.length - 1]
    el.classList.add('pin-empilhando')
    topo.classList.add('pin-topo')

    // Display escondido (rect zerado) não tem geometria para calcular
    // o deslocamento — pula a cascata e vai direto ao estado de
    // conferência, em vez de empilhar tudo na esquerda.
    if (r[0].width > 0) {
      var meio = (r[0].left + r[r.length - 1].right) / 2
      cs.forEach(function (c, i) {
        var dx = meio - (r[i].left + r[i].width / 2)
        c.style.transitionDelay = dur(i * 40) + 'ms'
        c.style.zIndex = String(i + 1)
        c.style.transform = 'translateX(' + dx + 'px) rotate(' + GIRO[i % GIRO.length] + 'deg)'
      })
    }
    vibrar(25)

    return espera(dur(360)).then(function () {
      if (!ehBaralho(el)) return false
      el.classList.add('pin-conferindo')
      var g = topo.querySelector('.pin-glifo')
      if (g) g.innerHTML = ''
      return true
    })
  }

  // ── Aprovado ────────────────────────────────────────────────────
  function aprovar(el) {
    if (!ehBaralho(el)) return Promise.resolve(false)
    var cs = cartas(el)
    var topo = el.querySelector('.pin-carta.pin-topo') || cs[cs.length - 1]
    el.classList.remove('pin-conferindo')
    if (topo) {
      topo.classList.add('pin-aprovada')
      var g = topo.querySelector('.pin-glifo')
      if (g) g.innerHTML = SELO
    }
    vibrar([18, 60, 18])
    return espera(dur(560)).then(function () { return true })
  }

  // ── Recusado ────────────────────────────────────────────────────
  function recusar(el) {
    if (!ehBaralho(el)) return Promise.resolve(false)
    var cs = cartas(el)
    el.classList.remove('pin-conferindo', 'pin-empilhando')
    cs.forEach(function (c, i) {
      c.style.transitionDelay = dur(i * 30) + 'ms'
      c.style.transform = ''
      c.style.zIndex = ''
      c.classList.remove('pin-topo')
    })
    vibrar([40, 70, 40])

    return espera(dur(260)).then(function () {
      if (!ehBaralho(el)) return false
      el.classList.add('pin-recusado')
      cs.forEach(function (c) { c.classList.add('pin-recusada') })
      return espera(dur(560))
    }).then(function () {
      if (ehBaralho(el)) limpar(el)
      return true
    })
  }

  // ── Volta ao estado inicial ─────────────────────────────────────
  function limpar(el) {
    if (!ehBaralho(el)) return false
    cancelarTimers(el)
    el.classList.remove('pin-empilhando', 'pin-conferindo', 'pin-recusado')
    cartas(el).forEach(function (c) {
      c.classList.remove('pin-topo', 'pin-aprovada', 'pin-recusada', 'varrendo')
      c.style.transform = ''
      c.style.transitionDelay = ''
      c.style.zIndex = ''
      c.dataset.pinD = ''
      var g = c.querySelector('.pin-glifo')
      if (g) g.innerHTML = ''
    })
    el._pinLen = 0
    aplicar(el, '')
    return true
  }

  window.pinBaralhoMontar  = montar
  window.pinBaralhoPintar  = pintar
  window.pinBaralhoFechar  = fechar
  window.pinBaralhoAprovar = aprovar
  window.pinBaralhoRecusar = recusar
  window.pinBaralhoLimpar  = limpar
})()
