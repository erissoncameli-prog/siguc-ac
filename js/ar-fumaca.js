/* ── SIGUC Qualidade do Ar — mancha de fumaça/vento por sensor ────
   pages/ar-qualidade.html: uma MANCHA por sensor, ANCORADA à
   geografia (latLngToContainerPoint a cada 'move'/zoom) — nunca um
   campo espalhado pelo mapa inteiro. Perto de sensor acima da
   referência OMS (15 µg/m³, mesma referência de js/ar-qualidade.js),
   mancha CINZA, maior e turbulenta, como fumaça. Perto de sensor
   dentro da referência, mancha AZUL, menor e calma, como ar limpo.

   ⚠ VERSÃO ANTERIOR ERRADA — registrado para não repetir. A primeira
   tentativa era um campo de partículas espalhadas por TODO o canvas
   (mesmo molde de js/agua-rio.js, que faz sentido pra um rio cobrindo
   a tela inteira), com a intensidade calculada por distância inversa
   (IDW) só mudando a cor/turbulência de cada partícula. Resultado:
   partícula nascia em qualquer canto do mapa, longe de qualquer
   sensor — "solto aleatoriamente", sem ler como mancha em lugar
   nenhum. O pedido era uma MANCHA JUNTO DO PONTO, não um campo
   ambiente. Corrigido: cada "puff" pertence a UM sensor, com posição
   de origem (home) fixa relativa ao sensor — nunca nasce solto no
   canvas, nunca viaja para longe dele.

   MOVIMENTO SEM FUGIR DO PONTO: a posição de cada puff é
   `home + oscilação`, nunca `posição += velocidade * dt` acumulada —
   é uma função do tempo (ruído amostrado em t), não uma integração.
   Por construção não pode "escapar": a amplitude da oscilação é o
   teto do deslocamento. Mancha ruim tem amplitude maior (fumaça
   parece se mexer/girar mais) e mais puffs (mais densa); mancha boa
   tem amplitude pequena (brisa leve) e poucos puffs (mais rarefeita).

   SEM CLASSIFICAÇÃO POR FAIXA (mesma decisão de js/ar-qualidade.js):
   só duas cores, no piso binário já usado no resto do sistema — acima
   ou dentro da referência OMS. O tamanho/densidade da mancha escala
   com o quanto passou da referência (saturado em 3×, só efeito
   visual, nunca uma faixa oficial do CONAMA 506/2024 — ainda não
   confirmada).

   CANVAS: sibling do container do Leaflet, pinta por cima de tudo
   (mapa+marcadores) — confirmado com Playwright + Leaflet real que um
   z-index não entra "entre" as panes internas (.leaflet-map-pane tem
   transform próprio, cria stacking context, o mapa inteiro pinta como
   bloco atômico). pointer-events:none mantém clique passando para
   marcador/controles; alpha baixo mantém tudo legível por baixo.

   TOGGLE: botão no mapa, estado em localStorage (preferência de
   EXIBIÇÃO por navegador). BATERIA/ACESSIBILIDADE: só anima com o
   mapa visível e a aba em primeiro plano; com "reduzir movimento",
   desenha um quadro parado. */

;(function () {
  'use strict'

  var REDUZIDO = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  var CHAVE_LS = 'siguc_ar_fumaca_ligado'

  function _semente(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0
      var t = Math.imul(a ^ a >>> 15, 1 | a)
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t
      return ((t ^ t >>> 14) >>> 0) / 4294967296
    }
  }
  function _criarRuido(seed) {
    var perm = [], i, rnd = _semente(seed)
    for (i = 0; i < 256; i++) perm[i] = i
    for (i = 255; i > 0; i--) { var j = Math.floor(rnd() * (i + 1)), t = perm[i]; perm[i] = perm[j]; perm[j] = t }
    var p = new Uint8Array(512)
    for (i = 0; i < 512; i++) p[i] = perm[i & 255]
    function suav(t) { return t * t * t * (t * (t * 6 - 15) + 10) }
    function inter(t, a, b) { return a + t * (b - a) }
    function grad(h, x, y) { var v = h & 3; return ((v & 1) ? -x : x) + ((v & 2) ? -y : y) }
    return function (x, y) {
      var X = Math.floor(x) & 255, Y = Math.floor(y) & 255
      x -= Math.floor(x); y -= Math.floor(y)
      var u = suav(x), v = suav(y), A = p[X] + Y, B = p[X + 1] + Y
      return inter(v, inter(u, grad(p[A], x, y), grad(p[B], x - 1, y)),
                      inter(u, grad(p[A + 1], x, y - 1), grad(p[B + 1], x - 1, y - 1)))
    }
  }

  var OMS_LIMITE = 15      // µg/m³ — mesma referência de js/ar-qualidade.js
  var TETO_RENDER = 45     // 3× a referência — satura só o TAMANHO/densidade visual

  function _severidade(pm25) {
    if (pm25 == null || !isFinite(pm25)) return 0
    return Math.max(0, Math.min(1, (Number(pm25) - OMS_LIMITE) / (TETO_RENDER - OMS_LIMITE)))
  }
  function _ruim(pm25) { return pm25 != null && isFinite(pm25) && Number(pm25) > OMS_LIMITE }

  function arFumacaInstalar(mapa) {
    if (!mapa || !mapa.getContainer) return null
    var container = mapa.getContainer()
    if (container._fumacaLigada) return container._fumacaCtl
    container._fumacaLigada = true

    var canvas = document.createElement('canvas')
    canvas.className = 'ar-fumaca-canvas'
    canvas.setAttribute('aria-hidden', 'true')
    container.appendChild(canvas)
    var ctx = canvas.getContext('2d')
    if (!ctx) return null

    var ruido = _criarRuido(20260823)
    var w = 0, h = 0, dpr = 1, t = 0, raf = null, ultimo = 0
    var manchas = []   // uma por sensor: { home:{x,y}, ruim, sev, puffs:[...] }
    var visivel = false
    var ligado = _lerPreferencia()
    var _ultimosSensores = []

    function _lerPreferencia() {
      try {
        var v = localStorage.getItem(CHAVE_LS)
        return v == null ? true : v === '1'   // padrão: ligado
      } catch (e) { return true }
    }
    function _salvarPreferencia(v) {
      try { localStorage.setItem(CHAVE_LS, v ? '1' : '0') } catch (e) { /* modo privado */ }
    }

    function _medir() {
      var r = container.getBoundingClientRect()
      w = Math.max(1, Math.round(r.width))
      h = Math.max(1, Math.round(r.height))
      dpr = Math.min(window.devicePixelRatio || 1, 2)
      canvas.width = Math.round(w * dpr)
      canvas.height = Math.round(h * dpr)
      canvas.style.width = w + 'px'
      canvas.style.height = h + 'px'
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }

    // Um punhado de "puffs" (dabs macios) por sensor — a MANCHA é a
    // sobreposição deles, nunca uma partícula solta viajando pelo mapa.
    // `ang`/`dist`/`fase` são fixos na criação (a origem de cada puff em
    // relação ao sensor); só a OSCILAÇÃO em volta disso muda com o tempo.
    function _criarPuffs(ruim, sev) {
      var n = ruim ? (7 + Math.round(sev * 5)) : 3   // mancha ruim é mais densa
      var raioBase = ruim ? (26 + sev * 22) : 16      // e maior
      var puffs = []
      for (var i = 0; i < n; i++) {
        puffs.push({
          ang: Math.random() * Math.PI * 2,
          dist: Math.random() * raioBase,
          fase: Math.random() * Math.PI * 2,
          raio: raioBase * (0.55 + Math.random() * 0.5) * (ruim ? 1 : 0.75),
          seed: Math.random() * 1000,
        })
      }
      return puffs
    }

    var _ultimosSensoresIndex = {}
    function _atualizarSensores(sensores) {
      if (sensores) _ultimosSensores = sensores
      manchas = _ultimosSensores
        .filter(function (s) { return s.lat != null && s.lng != null })
        .map(function (s) {
          var pt = mapa.latLngToContainerPoint([s.lat, s.lng])
          var ruim = _ruim(s.pm25_bruto)
          var sev = _severidade(s.pm25_bruto)
          var chave = String(s.sensor_index)
          // Reaproveita os puffs já existentes do mesmo sensor (só recria
          // se mudou de situação bom/ruim) — evita a mancha "piscar" com
          // formação nova a cada atualização de dado.
          var anterior = _ultimosSensoresIndex[chave]
          var puffs = (anterior && anterior.ruim === ruim) ? anterior.puffs : _criarPuffs(ruim, sev)
          var m = { home: { x: pt.x, y: pt.y }, ruim: ruim, sev: sev, puffs: puffs, nome: s.nome }
          _ultimosSensoresIndex[chave] = m
          return m
        })
    }

    function _passo(dt) {
      ctx.clearRect(0, 0, w, h)   // manchas são estáveis, não um rastro — redesenha inteiro

      for (var i = 0; i < manchas.length; i++) {
        var m = manchas[i]
        // Fora da viewport atual: não desenha (economiza), mas mantém o
        // estado (não recria os puffs quando volta a aparecer).
        if (m.home.x < -80 || m.home.x > w + 80 || m.home.y < -80 || m.home.y > h + 80) continue

        var corBase = m.ruim ? [128, 122, 114] : [96, 165, 250]     // cinza fumaça / azul limpo
        var alphaBase = m.ruim ? (0.16 + m.sev * 0.16) : 0.13
        // Amplitude do balanço: fumaça se mexe mais (lê como turbulência);
        // ar limpo balança pouco (brisa).
        var amplitude = m.ruim ? (5 + m.sev * 9) : 2.2

        for (var j = 0; j < m.puffs.length; j++) {
          var p = m.puffs[j]
          var osc = ruido(p.seed, t * (m.ruim ? 0.35 : 0.18) + p.fase)
          var osc2 = ruido(p.seed + 50, t * (m.ruim ? 0.30 : 0.15))
          var ox = Math.cos(p.ang) * p.dist + osc * amplitude
          var oy = Math.sin(p.ang) * p.dist + osc2 * amplitude
          var x = m.home.x + ox, y = m.home.y + oy
          var raioPulso = p.raio * (1 + osc * 0.08)

          var grad = ctx.createRadialGradient(x, y, 0, x, y, raioPulso)
          grad.addColorStop(0, 'rgba(' + corBase[0] + ',' + corBase[1] + ',' + corBase[2] + ',' + alphaBase.toFixed(3) + ')')
          grad.addColorStop(1, 'rgba(' + corBase[0] + ',' + corBase[1] + ',' + corBase[2] + ',0)')
          ctx.fillStyle = grad
          ctx.beginPath()
          ctx.arc(x, y, raioPulso, 0, Math.PI * 2)
          ctx.fill()
        }
      }
    }

    function _quantidadeVisivel() {
      // Só pra decidir se vale a pena manter o laço rodando.
      return manchas.some(function (m) {
        return m.home.x > -80 && m.home.x < w + 80 && m.home.y > -80 && m.home.y < h + 80
      })
    }

    function _laco(agora) {
      var dt = ultimo ? Math.min((agora - ultimo) / 1000, 0.05) : 0.016
      ultimo = agora
      t += dt
      _passo(dt)
      raf = requestAnimationFrame(_laco)
    }
    function _ligarLoop() {
      if (raf || !visivel || !ligado || REDUZIDO) return
      ultimo = 0
      raf = requestAnimationFrame(_laco)
    }
    function _pararLoop() {
      if (raf) { cancelAnimationFrame(raf); raf = null }
    }

    function _reiniciar() {
      _medir()
      ctx.clearRect(0, 0, w, h)
      if (REDUZIDO) {
        _passo(0.016)   // manchas são estáveis: um quadro já mostra o resultado final
      } else {
        _ligarLoop()
      }
    }

    canvas.hidden = !ligado

    function ligar() {
      ligado = true; _salvarPreferencia(true)
      canvas.hidden = false
      if (!w || !h) _reiniciar(); else _ligarLoop()
    }
    function desligar() {
      ligado = false; _salvarPreferencia(false)
      _pararLoop()
      canvas.hidden = true
    }
    function alternar() { if (ligado) desligar(); else ligar(); return ligado }

    function atualizar(sensores) {
      _atualizarSensores(sensores)
      if (REDUZIDO) _passo(0.016)   // reduzido não roda o laço: redesenha na mão ao atualizar dado
    }

    // ── Eventos do mapa: recalcula posição dos sensores em tela ────
    // (mesmos lat/lng já carregados — só reprojeta pra pixel)
    mapa.on('move zoom', function () { _atualizarSensores() })
    mapa.on('resize', function () { _reiniciar() })

    if (typeof IntersectionObserver === 'function') {
      new IntersectionObserver(function (ents) {
        var vis = ents[0].isIntersecting
        if (vis === visivel) return
        visivel = vis
        if (vis) { if (!w || !h) _reiniciar(); else _ligarLoop() } else _pararLoop()
      }, { threshold: 0.01 }).observe(container)
    } else {
      visivel = true
      _reiniciar()
    }

    document.addEventListener('visibilitychange', function () {
      if (document.hidden) _pararLoop()
      else if (visivel && ligado) _ligarLoop()
    })

    var redim
    window.addEventListener('resize', function () {
      clearTimeout(redim)
      redim = setTimeout(function () { if (visivel) _reiniciar() }, 180)
    })

    var ctl = { ligar: ligar, desligar: desligar, alternar: alternar, atualizar: atualizar, ligado: function () { return ligado } }
    container._fumacaCtl = ctl
    return ctl
  }

  // ── Controle Leaflet (botão liga/desliga) ─────────────────────
  function arFumacaControle(ctl) {
    var Ctrl = L.Control.extend({ options: { position: 'topleft' }, onAdd: function () {
      var div = L.DomUtil.create('div', 'ar-fumaca-ctrl leaflet-bar')
      var btn = L.DomUtil.create('button', 'ar-fumaca-btn', div)
      btn.type = 'button'
      function _rotular() {
        btn.textContent = ctl.ligado() ? 'Manchas fumaça/ar limpo (ligado)' : 'Manchas fumaça/ar limpo (desligado)'
        btn.setAttribute('aria-pressed', ctl.ligado() ? 'true' : 'false')
      }
      _rotular()
      btn.addEventListener('click', function () { ctl.alternar(); _rotular() })
      L.DomEvent.disableClickPropagation(div)
      return div
    } })
    return new Ctrl()
  }

  window.arFumacaInstalar = arFumacaInstalar
  window.arFumacaControle = arFumacaControle
})()
