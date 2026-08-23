/* ── SIGUC Qualidade do Ar — camada de fumaça/vento sobre o mapa ──
   pages/ar-qualidade.html: um campo animado sobre o Leaflet, ANCORADO
   À GEOGRAFIA (acompanha pan/zoom via latLngToContainerPoint a cada
   'move', não é decoração fixa de tela) — perto de sensor acima da
   referência da OMS (15 µg/m³, mesma referência já usada no resto do
   sistema), partículas densas e escuras se comportam como fumaça
   (giram, se demoram); perto de sensor dentro da referência, traços
   claros e esparsos correm em linha, como vento limpo. Entre os dois,
   transição contínua por distância inversa aos sensores vizinhos
   (nunca um degrau no limite exato de um sensor).

   REAPROVEITA as três lições de js/agua-rio.js (rio de fundo das
   telas de bloqueio da Água) — nunca uma segunda implementação de
   campo de partículas do zero:
     1. Partícula ADVECTADA (nasce, deixa esteira, morre) — nunca
        senoide parada.
     2. Turbulência de ROTACIONAL, aqui MODULADA pela intensidade
        local: perto de zero nas áreas limpas (fluxo quase laminar =
        vento), alta nas áreas ruins (giro = fumaça).
     3. ESTEIRA por `destination-out`, nunca `clearRect`.

   SEM CLASSIFICAÇÃO POR FAIXA (mesma decisão de js/ar-qualidade.js):
   a intensidade visual usa só a referência OMS como piso (0) e um TETO
   DE RENDERIZAÇÃO em 3× essa referência (45 µg/m³) só para saturar a
   escala visual — não é uma faixa oficial do CONAMA 506/2024 (ainda
   não confirmada), é só o ponto em que o desenho já está no máximo de
   "fumaça" que ele sabe desenhar. O número exibido na lista/mapa
   continua sendo a fonte de verdade, isto é ilustração.

   CANVAS: sibling simples do container do Leaflet (não dentro de um
   .leaflet-pane, que é transformado no drag). Pinta ACIMA de tudo,
   inclusive marcadores — testado com Playwright + Leaflet real
   (`elementFromPoint` E cor de pixel no ponto do marcador): um
   z-index explícito num filho comum do container não entra "entre"
   as panes internas do Leaflet, porque `.leaflet-map-pane` recebe
   `transform` para o pan e isso cria stacking context PRÓPRIO — todo
   o mapa (tiles+overlays+marcadores) pinta como um bloco atômico
   diante de um irmão externo, mesma família de armadilha já
   documentada em "Regra do sistema — painéis na tela cheia do mapa".
   Por isso: nunca tentar de novo "z-index entre tilePane e
   markerPane" a partir de fora do map-pane — ou entra pela pane
   (overlayPane, coordenadas em layerPoint) ou fica por cima de tudo,
   como aqui. `pointer-events:none` garante que clique/arrasto passa
   direto para marcador e controles por baixo; alpha baixo mantém os
   marcadores legíveis através do efeito.

   TOGGLE: botão próprio no mapa (mesmo padrão do "Configurar camadas"
   de js/agua-painel.js), estado em localStorage — preferência de
   EXIBIÇÃO por navegador, não dado do banco.

   BATERIA/ACESSIBILIDADE: só anima com o mapa visível
   (IntersectionObserver) e a aba em primeiro plano; com "reduzir
   movimento", desenha um quadro parado e não anima. */

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
  var TETO_RENDER = 45     // 3× a referência — satura a intensidade VISUAL, não é faixa oficial
  var RAIO_INFLUENCIA = 130 // px de tela — alcance de cada sensor no campo
  var E = 1.6              // passo da diferença finita, px

  function _severidade(pm25) {
    if (pm25 == null || !isFinite(pm25)) return 0
    return Math.max(0, Math.min(1, (Number(pm25) - OMS_LIMITE) / (TETO_RENDER - OMS_LIMITE)))
  }

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

    var ruido = _criarRuido(20260822)
    var w = 0, h = 0, dpr = 1, t = 0, raf = null, ultimo = 0
    var parts = []
    var pontos = []   // [{x,y,severidade}] — posições em TELA, recalculadas em 'move'
    var visivel = false
    var ligado = _lerPreferencia()

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

    function _quantos() {
      var n = Math.round((w * h) / 900)
      if ((navigator.hardwareConcurrency || 8) <= 4) n = Math.round(n * 0.6)
      return Math.max(60, Math.min(420, n))
    }

    var _ultimosSensores = []
    function _atualizarPontos(sensores) {
      if (sensores) _ultimosSensores = sensores
      pontos = _ultimosSensores
        .filter(function (s) { return s.lat != null && s.lng != null })
        .map(function (s) {
          var pt = mapa.latLngToContainerPoint([s.lat, s.lng])
          return { x: pt.x, y: pt.y, sev: _severidade(s.pm25_bruto) }
        })
    }

    // Intensidade local por distância inversa (IDW) aos sensores em tela.
    function _intensidade(x, y) {
      var soma = 0, pesos = 0
      for (var i = 0; i < pontos.length; i++) {
        var p = pontos[i]
        var dx = x - p.x, dy = y - p.y
        var d2 = dx * dx + dy * dy
        if (d2 > RAIO_INFLUENCIA * RAIO_INFLUENCIA * 6) continue
        var peso = 1 / (1 + d2 / (RAIO_INFLUENCIA * RAIO_INFLUENCIA))
        soma += peso * p.sev
        pesos += peso
      }
      return pesos > 0 ? soma / pesos : 0
    }

    var _v = { x: 0, y: 0 }
    var _ventoAng = 0.5   // rad — direção base do "vento limpo", constante
    function _campo(x, y, sev) {
      var escala = 0.006, d = E * escala, iv = 1 / (2 * d)
      var sx = x * escala, sy = y * escala - t * 0.05
      var curlX = (ruido(sx, sy + d) - ruido(sx, sy - d)) * iv
      var curlY = -(ruido(sx + d, sy) - ruido(sx - d, sy)) * iv

      // Vento base: laminar, na direção fixa. Some quase por completo
      // onde a fumaça é densa (fumaça se demora, não é varrida na hora).
      var ventoForca = 26 * (1 - sev * 0.85)
      _v.x = Math.cos(_ventoAng) * ventoForca
      _v.y = Math.sin(_ventoAng) * ventoForca

      // Turbulência: cresce com a severidade — é o que faz a área ruim
      // GIRAR em vez de só correr reto.
      var curlForca = 10 + sev * 46
      _v.x += curlX * curlForca
      _v.y += curlY * curlForca
      return _v
    }

    function _nascer(p) {
      p.x = Math.random() * w
      p.y = Math.random() * h
      p.px = p.x; p.py = p.y
      p.vida = 0
      p.maxVida = 4 + Math.random() * 7
      p.larg = 0.8 + Math.random() * 2.2
      p.novo = true
      return p
    }
    function _semear() {
      parts.length = 0
      for (var i = 0, n = _quantos(); i < n; i++) parts.push(_nascer({}))
    }

    function _passo(dt) {
      ctx.globalCompositeOperation = 'destination-out'
      ctx.fillStyle = 'rgba(0,0,0,0.055)'
      ctx.fillRect(0, 0, w, h)

      ctx.globalCompositeOperation = 'source-over'
      ctx.lineCap = 'round'

      for (var i = 0; i < parts.length; i++) {
        var p = parts[i]
        p.px = p.x; p.py = p.y
        var sev = _intensidade(p.x, p.y)
        var v = _campo(p.x, p.y, sev)
        p.x += v.x * dt
        p.y += v.y * dt
        p.vida += dt

        if (p.y < -20 || p.y > h + 20 || p.x < -20 || p.x > w + 20 || p.vida > p.maxVida) { _nascer(p); continue }
        if (p.novo) { p.novo = false; continue }

        var entra = Math.min(1, p.vida / 0.5)
        var sai = Math.min(1, (p.maxVida - p.vida) / 1.0)
        // Interpola cor/alpha/espessura entre "vento limpo" (fino, claro,
        // fraco) e "fumaça" (mais grosso, acinzentado, mais opaco) pela
        // intensidade LOCAL — a mesma partícula muda de cara ao atravessar
        // de uma área limpa para uma ruim.
        var alpha = (0.05 + sev * 0.30) * entra * sai
        if (alpha <= 0.003) continue
        var largura = p.larg * (0.7 + sev * 1.3)
        var cinza = Math.round(150 - sev * 45)   // vento quase branco-azulado -> fumaça acinzentada
        var corBase = sev < 0.15
          ? 'rgba(214,236,250,' + alpha.toFixed(3) + ')'
          : 'rgba(' + cinza + ',' + Math.round(cinza * 0.94) + ',' + Math.round(cinza * 0.88) + ',' + alpha.toFixed(3) + ')'

        ctx.strokeStyle = corBase
        ctx.lineWidth = largura
        ctx.beginPath()
        ctx.moveTo(p.px, p.py)
        ctx.lineTo(p.x, p.y)
        ctx.stroke()
      }
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
      _semear()
      ctx.clearRect(0, 0, w, h)
      if (REDUZIDO) {
        for (var i = 0; i < 100; i++) { t += 0.016; _passo(0.016) }
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
      _atualizarPontos(sensores)
    }

    // ── Eventos do mapa: recalcula posição dos sensores em tela ────
    // (mesmos lat/lng já carregados — só reprojeta pra pixel, sem
    // buscar dado novo)
    mapa.on('move zoom', function () { _atualizarPontos() })
    mapa.on('resize', function () { _reiniciar() })

    if (typeof IntersectionObserver === 'function') {
      new IntersectionObserver(function (ents) {
        var vis = ents[0].isIntersecting
        if (vis === visivel) return
        visivel = vis
        if (vis) { if (!w || !h) _reiniciar(); else _ligarLoop() } else _pararLoop()
      }, { threshold: 0.01 }).observe(container)
    } else {
      // Sem IntersectionObserver: assume visível e liga direto.
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
        btn.textContent = ctl.ligado() ? 'Efeito: fumaça/vento (ligado)' : 'Efeito: fumaça/vento (desligado)'
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
