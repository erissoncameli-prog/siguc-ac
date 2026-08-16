/* ── SIGUC Qualidade da Água — rio de fundo das telas de bloqueio ──
   Fundo animado das 4 telas com .lock-screen (entrar, criar senha,
   digitar PIN, criar PIN) + resposta ao toque, como tocar na água.

   POR QUE CAMPO DE FLUXO, E NÃO SENÓIDE
   A primeira versão desenhava ondas mudando de fase. Curva que muda de
   forma sem sair do lugar não é lida como correnteza — o olho vê fio
   luminoso se contorcendo. Aqui cada filete é uma PARTÍCULA carregada
   rio abaixo, que nasce no topo, deixa esteira e morre embaixo: o
   padrão viaja, que é o que o cérebro reconhece como água correndo.

   TRÊS COISAS QUE FAZEM PARECER RIO (mexer nelas é mexer no efeito):
   1. Turbulência de ROTACIONAL. A velocidade lateral sai do rotacional
      de um campo de ruído, que é incapaz de criar ou engolir água
      (divergência zero) — por isso os fios se enrolam como num rio em
      vez de se cruzarem sem sentido.
   2. PERFIL DE CANAL. O meio corre rápido, as margens quase param
      (`_canal`). Sem isso a tela vira chuva caindo, não rio.
   3. ESTEIRA. O quadro anterior não é apagado, só perde alpha
      (`destination-out`). É o rastro que dá a sensação de corrente.

   ⚠ A diferença finita do rotacional PRECISA ser dividida por 2*d para
   virar derivada de verdade. Sem isso a deriva lateral fica em ~1 px/s
   contra 46 px/s de descida e a tela vira chuva reta, sem redemoinho —
   foi exatamente o defeito da primeira versão. Ao mexer em `_ESCALA`,
   conferir que `_campo` continua devolvendo vy > 0 em toda a tela: a
   turbulência amassa a descida, nunca a inverte (rio não corre para
   trás). O piso em `_campo` é a trava disso.

   BATERIA: aparelho de campo. O laço só roda na tela que está VISÍVEL
   (IntersectionObserver) e para com o app em segundo plano — as 4 telas
   existem no DOM ao mesmo tempo, mas só uma anima.

   ACESSIBILIDADE: com "reduzir movimento" ligado, desenha um quadro
   parado e não instala o toque — nada se move. */

(function () {
  'use strict';

  var REDUZIDO = !!(window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  /* ── Ruído de Perlin 2D (sem dependência) ──────────────────── */
  function _semente(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function _criarRuido(seed) {
    var perm = [], i, rnd = _semente(seed);
    for (i = 0; i < 256; i++) perm[i] = i;
    for (i = 255; i > 0; i--) {
      var j = Math.floor(rnd() * (i + 1)), t = perm[i];
      perm[i] = perm[j]; perm[j] = t;
    }
    var p = new Uint8Array(512);
    for (i = 0; i < 512; i++) p[i] = perm[i & 255];
    function suav(t) { return t * t * t * (t * (t * 6 - 15) + 10); }
    function inter(t, a, b) { return a + t * (b - a); }
    function grad(h, x, y) { var v = h & 3; return ((v & 1) ? -x : x) + ((v & 2) ? -y : y); }
    return function (x, y) {
      var X = Math.floor(x) & 255, Y = Math.floor(y) & 255;
      x -= Math.floor(x); y -= Math.floor(y);
      var u = suav(x), v = suav(y), A = p[X] + Y, B = p[X + 1] + Y;
      return inter(v, inter(u, grad(p[A], x, y), grad(p[B], x - 1, y)),
                      inter(u, grad(p[A + 1], x, y - 1), grad(p[B + 1], x - 1, y - 1)));
    };
  }

  /* ── Calibragem da correnteza ──────────────────────────────
     Valores de REFERÊNCIA, medidos numa tela de 274×568: deriva
     lateral média ~16 px/s contra 46 px/s de descida, e vy > 0 em
     toda a tela (nenhum ponto com água subindo).

     ⚠ São proporcionais à tela, nunca absolutos (ver `_calibrar`).
     Com escala fixa em pixels, o redemoinho tem sempre ~139 px: numa
     tela de 274 isso é meia largura (meandro calmo), numa de 430 vira
     rabisco miúdo e o fundo parece ARRANHADO, não água. */
  var _REF_L  = 274;     // largura de referência da calibragem
  var _REF_A  = 568;     // altura de referência
  var _VEL    = 46;      // descida no meio do canal, px/s
  var _CURL   = 30;      // força da turbulência, px/s
  var _AMORT  = 0.22;    // quanto do rotacional entra no eixo vertical
  var _ESCALA = 0.0072;  // tamanho dos redemoinhos (menor = maiores)
  var _APAGA  = 0.058;   // alpha retirado por quadro (comprimento da esteira)
  var _ESPUMA = 0.12;    // fração de filetes claros
  var _E      = 1.6;     // passo da diferença finita, px

  /* ── Toque na água ─────────────────────────────────────────
     A onda não é só um anel desenhado por cima: ela EMPURRA o campo
     de fluxo ao passar (`_campo` soma o empurrão radial), então os
     filetes de água realmente se afastam do dedo. */
  var _ONDA_VEL   = 190;   // px/s que a crista avança
  var _ONDA_VIDA  = 1.15;  // s até sumir
  var _ONDA_CRISTA = 26;   // px de largura da crista
  var _ONDA_FORCA = 190;   // px/s de empurrão no pico
  var _MAX_ONDAS  = 6;     // teto (digitar PIN rápido não acumula)

  function _instalar(tela) {
    if (!tela || tela._rioLigado) return null;
    tela._rioLigado = true;

    var canvas = document.createElement('canvas');
    canvas.className = 'lock-rio';
    canvas.setAttribute('aria-hidden', 'true');
    tela.insertBefore(canvas, tela.firstChild);

    var ctx = canvas.getContext('2d');
    if (!ctx) return null;

    var fluxo = _criarRuido(20240815), luz = _criarRuido(77321);
    var w = 0, h = 0, dpr = 1, t = 0, raf = null, ultimo = 0;
    var parts = [], ondas = [], gotas = [];
    var visivel = false;
    // Efetivos, recalculados a cada medida (ver `_calibrar`)
    var escala = _ESCALA, vel = _VEL, curl = _CURL;

    /* Mantém o desenho na MESMA proporção em qualquer tela.
       - tamanho do redemoinho acompanha a LARGURA: o meandro ocupa
         sempre a mesma fração da tela;
       - velocidade acompanha a ALTURA, de modo que a água leve o mesmo
         tempo (~12 s) para atravessar a tela em qualquer aparelho;
       - curl anda junto da velocidade, senão o formato do redemoinho
         mudaria com o tamanho do telefone. */
    function _calibrar() {
      escala = _ESCALA * (_REF_L / w);
      var k = h / _REF_A;
      vel = _VEL * k;
      curl = _CURL * k;
    }

    function _medir() {
      var r = tela.getBoundingClientRect();
      w = Math.max(1, Math.round(r.width));
      h = Math.max(1, Math.round(r.height));
      // Teto de 2 no dpr: acima disso o custo por pixel não paga em
      // nitidez num fundo desfocado, e aparelho de campo sente.
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      _calibrar();
    }

    // Quantidade de filetes pela área, com teto: tela grande não pode
    // virar conta de partícula sem fim no aparelho do campo.
    function _quantos() {
      // 1 filete por ~330 px² é a densidade da calibragem de referência.
      // Abaixo disso a água vira risco solto sobre o fundo escuro.
      var n = Math.round((w * h) / 330);
      if ((navigator.hardwareConcurrency || 8) <= 4) n = Math.round(n * 0.6);
      return Math.max(200, Math.min(700, n));
    }

    // Margem segura o fluxo: meio rápido, beirada quase parada.
    function _canal(x) {
      var d = (x / w) * 2 - 1;
      return 0.22 + 0.78 * (1 - d * d);
    }

    function _nascer(p, espalhado) {
      p.x = Math.random() * w;
      p.y = espalhado ? Math.random() * h : -8 - Math.random() * 40;
      p.px = p.x; p.py = p.y;
      p.vida = 0;
      // Em segundos. Atravessar a tela leva ~12 s; com vida curta demais
      // o filete morre no meio e nunca chega embaixo.
      p.maxVida = 3.2 + Math.random() * 6.0;
      p.larg = 0.9 + Math.random() * 2.0;
      p.esp = Math.random() < _ESPUMA;
      p.novo = true;
      return p;
    }

    function _semear() {
      parts.length = 0;
      for (var i = 0, n = _quantos(); i < n; i++) parts.push(_nascer({}, true));
    }

    var _v = { x: 0, y: 0 };
    function _campo(x, y) {
      var d = _E * escala, iv = 1 / (2 * d);
      var sx = x * escala, sy = y * escala - t * 0.16;
      _v.x = (fluxo(sx, sy + d) - fluxo(sx, sy - d)) * iv * curl;
      _v.y = -(fluxo(sx + d, sy) - fluxo(sx - d, sy)) * iv * curl * _AMORT
             + vel * _canal(x);
      // Rio não corre para trás: a turbulência amassa a descida,
      // nunca a inverte.
      var piso = vel * 0.10;
      if (_v.y < piso) _v.y = piso;

      // Empurrão das ondas do toque
      for (var i = 0; i < ondas.length; i++) {
        var o = ondas[i];
        var idade = t - o.t0;
        var R = idade * _ONDA_VEL;
        var dx = x - o.x, dy = y - o.y;
        var dist = Math.sqrt(dx * dx + dy * dy);
        var banda = dist - R;
        if (banda < -_ONDA_CRISTA || banda > _ONDA_CRISTA) continue;
        if (dist < 0.001) continue;
        var perfil = Math.cos((banda / _ONDA_CRISTA) * Math.PI / 2);
        var forca = _ONDA_FORCA * perfil * (1 - idade / _ONDA_VIDA);
        _v.x += (dx / dist) * forca;
        _v.y += (dy / dist) * forca;
      }
      return _v;
    }

    /* Respingos: gotas jogadas para fora no instante do toque, com
       queda própria — é o que separa "anel desenhado" de "alguém
       encostou na água". */
    function _respingar(x, y) {
      var n = 7 + Math.floor(Math.random() * 4);
      for (var i = 0; i < n; i++) {
        var ang = Math.random() * Math.PI * 2;
        var spd = 45 + Math.random() * 95;
        gotas.push({
          x: x, y: y,
          vx: Math.cos(ang) * spd,
          vy: Math.sin(ang) * spd * 0.5 - (20 + Math.random() * 45),
          r: 0.8 + Math.random() * 1.5,
          vida: 0,
          maxVida: 0.5 + Math.random() * 0.45
        });
      }
    }

    function tocar(x, y) {
      if (REDUZIDO) return;
      ondas.push({ x: x, y: y, t0: t });
      if (ondas.length > _MAX_ONDAS) ondas.shift();
      _respingar(x, y);
      if (!raf && visivel) _ligar();   // toque acorda a tela parada
    }

    function _passo(dt) {
      // Esteira: tira alpha aos poucos em vez de limpar, mantendo o
      // canvas transparente sobre o gradiente do CSS.
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = 'rgba(0,0,0,' + _APAGA + ')';
      ctx.fillRect(0, 0, w, h);

      ctx.globalCompositeOperation = 'lighter';
      ctx.lineCap = 'round';

      for (var i = 0; i < parts.length; i++) {
        var p = parts[i];
        p.px = p.x; p.py = p.y;
        var v = _campo(p.x, p.y);
        p.x += v.x * dt;
        p.y += v.y * dt;
        p.vida += dt;

        // Saiu pela borda: volta pelo topo, como água que entra no quadro.
        if (p.y > h + 12 || p.x < -20 || p.x > w + 20) { _nascer(p, false); continue; }
        // Morreu de idade no meio do caminho: renasce ESPALHADO. Mandar
        // de volta ao topo amontoava a água na faixa de cima e deixava a
        // metade de baixo vazia — a travessia (~12 s) é mais longa que a
        // vida de um filete, então isso acontece o tempo todo.
        if (p.vida > p.maxVida) { _nascer(p, true); continue; }
        if (p.novo) { p.novo = false; continue; }

        // Luz da superfície: manchas claras descem mais devagar que a água
        var lm = luz(p.x * escala * 0.58, p.y * escala * 0.58 - t * 0.09);
        var brilho = (0.42 + 0.58 * (lm * 0.5 + 0.5)) * 0.85;
        var entra = Math.min(1, p.vida / 0.37);
        var sai   = Math.min(1, (p.maxVida - p.vida) / 0.7);
        var marg  = 0.30 + 0.70 * _canal(p.x);
        // Traço fraco e largo de propósito: é FUNDO de tela de senha.
        // Com alpha alto o filete vira agulha brilhante e disputa a
        // leitura com os dígitos; o volume vem da quantidade, não do
        // brilho de cada um.
        var a = brilho * entra * sai * marg * (p.esp ? 0.18 : 0.070);
        if (a <= 0.002) continue;

        ctx.strokeStyle = p.esp
          ? 'rgba(233,249,255,' + a.toFixed(3) + ')'
          : 'rgba(146,214,250,' + a.toFixed(3) + ')';
        ctx.lineWidth = p.esp ? p.larg * 0.85 : p.larg;
        ctx.beginPath();
        ctx.moveTo(p.px, p.py);
        ctx.lineTo(p.x, p.y);
        ctx.stroke();
      }

      // Anéis do toque
      for (var k = ondas.length - 1; k >= 0; k--) {
        var o = ondas[k];
        var idade = t - o.t0;
        if (idade > _ONDA_VIDA) { ondas.splice(k, 1); continue; }
        var q = idade / _ONDA_VIDA;
        var R = idade * _ONDA_VEL;
        var af = Math.pow(1 - q, 1.7);

        ctx.strokeStyle = 'rgba(198,238,255,' + (0.34 * af).toFixed(3) + ')';
        ctx.lineWidth = 2.2 * (1 - q * 0.55);
        ctx.beginPath();
        ctx.arc(o.x, o.y, R, 0, Math.PI * 2);
        ctx.stroke();

        // Segundo anel, mais lento — dá o "capilar" da água batida
        if (R > 16) {
          ctx.strokeStyle = 'rgba(198,238,255,' + (0.16 * af).toFixed(3) + ')';
          ctx.lineWidth = 1.3;
          ctx.beginPath();
          ctx.arc(o.x, o.y, R * 0.62, 0, Math.PI * 2);
          ctx.stroke();
        }

        // Clarão curto no ponto do dedo
        if (idade < 0.26) {
          var fa = (1 - idade / 0.26) * 0.30;
          var g = ctx.createRadialGradient(o.x, o.y, 0, o.x, o.y, 30);
          g.addColorStop(0, 'rgba(226,246,255,' + fa.toFixed(3) + ')');
          g.addColorStop(1, 'rgba(226,246,255,0)');
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(o.x, o.y, 30, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // Respingos
      for (var m = gotas.length - 1; m >= 0; m--) {
        var d2 = gotas[m];
        d2.vida += dt;
        if (d2.vida > d2.maxVida) { gotas.splice(m, 1); continue; }
        d2.vy += 210 * dt;             // gravidade
        d2.x += d2.vx * dt;
        d2.y += d2.vy * dt;
        var ga = (1 - d2.vida / d2.maxVida) * 0.55;
        ctx.fillStyle = 'rgba(233,249,255,' + ga.toFixed(3) + ')';
        ctx.beginPath();
        ctx.arc(d2.x, d2.y, d2.r, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.globalCompositeOperation = 'source-over';
    }

    function _laco(agora) {
      var dt = ultimo ? Math.min((agora - ultimo) / 1000, 0.05) : 0.016;
      ultimo = agora;
      t += dt;
      _passo(dt);
      // Tela parada e sem toque em curso: solta a CPU até o próximo toque.
      if (REDUZIDO && !ondas.length && !gotas.length) { raf = null; return; }
      raf = requestAnimationFrame(_laco);
    }

    function _ligar() {
      if (raf || !visivel) return;
      ultimo = 0;
      raf = requestAnimationFrame(_laco);
    }
    function _parar() {
      if (raf) { cancelAnimationFrame(raf); raf = null; }
    }

    function _iniciar() {
      _medir();
      _semear();
      ctx.clearRect(0, 0, w, h);
      if (REDUZIDO) {
        // Quadro parado: alguns passos só para a esteira existir.
        for (var i = 0; i < 140; i++) { t += 0.016; _passo(0.016); }
      } else {
        _ligar();
      }
    }

    /* Só anima a tela que está à vista. As 4 telas de bloqueio moram
       no mesmo documento; sem isso, quatro rios rodariam de uma vez. */
    if (typeof IntersectionObserver === 'function') {
      new IntersectionObserver(function (ents) {
        var vis = ents[0].isIntersecting;
        if (vis === visivel) return;
        visivel = vis;
        if (vis) { if (!w || !h) _iniciar(); else if (!REDUZIDO) _ligar(); }
        else _parar();
      }, { threshold: 0.01 }).observe(tela);
    } else {
      visivel = true;
      _iniciar();
    }

    document.addEventListener('visibilitychange', function () {
      if (document.hidden) _parar();
      else if (visivel && !REDUZIDO) _ligar();
    });

    var redim;
    window.addEventListener('resize', function () {
      clearTimeout(redim);
      redim = setTimeout(function () {
        if (!visivel) { w = 0; h = 0; return; }   // remede ao reaparecer
        _parar(); _iniciar();
      }, 180);
    });

    /* Toque: escutado na TELA, não no canvas (que é pointer-events
       none, atrás de tudo). Em captura, para que apertar uma tecla do
       PIN também ondule — cada dígito vira uma gota na água. */
    if (!REDUZIDO) {
      tela.addEventListener('pointerdown', function (ev) {
        var r = tela.getBoundingClientRect();
        tocar(ev.clientX - r.left, ev.clientY - r.top);
      }, { passive: true, capture: true });
    }

    return { tocar: tocar, parar: _parar };
  }

  function _instalarTodas() {
    var telas = document.querySelectorAll('.lock-screen');
    for (var i = 0; i < telas.length; i++) _instalar(telas[i]);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _instalarTodas);
  } else {
    _instalarTodas();
  }

  window.aguaRioInstalar = _instalar;
})();
