// ════════════════════════════════════════════════════════════════
// js/luz-nav.js — indicador de aba ativa em anel/bastão, fonte
// única para as 4 barras de navegação de campo (Brigadas,
// Biomonitor, Frota, Água). Ver "Regra do sistema — anel/bastão da
// barra de navegação" no CLAUDE.md.
//
// Regra que segura tudo: sempre um ANEL numa aba ou um BASTÃO reto
// entre duas. Nunca uma curva, nunca uma ponta solta no ar. Um
// <rect rx> com duas pontas (ax, bx) satisfaz isso por construção —
// quando ax === bx ele É o círculo.
//
// API: luzNavMontar('.pill-nav') — chamada de dentro da função
// central de troca de tela de cada app (mostrarTela/bioMostrarTela/
// montarBarraNav). Idempotente: religa sozinha quando a barra foi
// recriada (só acontece no Frota, troca de modo) e não faz nada
// quando já está no lugar certo. Nenhuma tela nova precisa chamar
// nada além do que a função central de cada app já chama.
//
// Sem o arquivo carregado, a função não existe e a classe .ativa
// continua valendo — a barra funciona exatamente como antes.
// ════════════════════════════════════════════════════════════════
(function () {
  const NS = 'http://www.w3.org/2000/svg'
  const SEL_BADGE = '.pill-badge, .bio-pill-badge, .fm-badge'
  const registros = new Map() // seletor da nav -> estado

  function reduzido() {
    return matchMedia('(prefers-reduced-motion: reduce)').matches
  }

  function easeOut(t) { return 1 - Math.pow(1 - t, 3) }

  // Badge visível (Fila com pendência, Config com update disponível
  // etc.) puxa a cor para o alerta — ver "Uma exceção que vale a
  // pena" na proposta. Detecção genérica: cobre os 3 nomes de badge
  // que os 4 apps usam, sem nenhuma tela precisar declarar nada.
  function temPendencia(btn) {
    if (!btn) return false
    const b = btn.querySelector(SEL_BADGE)
    if (!b) return false
    if (b.hidden) return false
    if (getComputedStyle(b).display === 'none') return false
    return true
  }

  function criarEstado(seletor) {
    const estado = {
      seletor, nav: null, svg: null, grad: null, p0: null, p1: null,
      halo: null, nucleo: null, obsInterno: null,
      ax: 0, bx: 0, av: 0, bv: 0, alvo: 0, partida: 0, cy: 0, R: 25,
      corA: '#52B788', corB: '#52B788', ultimoAtivo: null,
      rodando: false, ultimoTs: 0, arrastando: false,
    }

    function corVar(prop, fallback) {
      const v = getComputedStyle(estado.nav).getPropertyValue(prop).trim()
      return v || fallback
    }
    function corAtivo(btn) {
      return temPendencia(btn) ? corVar('--luz-cor-alerta', '#E0A227') : corVar('--luz-cor', '#52B788')
    }

    function montarSvg() {
      const svg = document.createElementNS(NS, 'svg')
      svg.setAttribute('class', 'luz-nav-svg')
      svg.setAttribute('aria-hidden', 'true')
      const uid = 'ln' + Math.random().toString(36).slice(2, 9)
      const defs = document.createElementNS(NS, 'defs')
      const grad = document.createElementNS(NS, 'linearGradient')
      grad.setAttribute('id', uid)
      grad.setAttribute('gradientUnits', 'userSpaceOnUse')
      const p0 = document.createElementNS(NS, 'stop'); p0.setAttribute('offset', '0')
      const p1 = document.createElementNS(NS, 'stop'); p1.setAttribute('offset', '1')
      grad.append(p0, p1)
      defs.appendChild(grad)
      const halo = document.createElementNS(NS, 'rect')
      const nucleo = document.createElementNS(NS, 'rect')
      halo.setAttribute('class', 'luz-nav-halo')
      nucleo.setAttribute('class', 'luz-nav-nucleo')
      halo.setAttribute('fill', 'none'); nucleo.setAttribute('fill', 'none')
      halo.setAttribute('stroke', `url(#${uid})`)
      nucleo.setAttribute('stroke', `url(#${uid})`)
      svg.append(defs, halo, nucleo)
      estado.svg = svg; estado.grad = grad; estado.p0 = p0; estado.p1 = p1
      estado.halo = halo; estado.nucleo = nucleo
    }

    // Geometria do botão-alvo, no referencial da barra. R vem do
    // próprio botão (52px nos 3 apps de mesa alta, 48/54-56px no
    // Frota, 44-48px nas telas estreitas) — nunca um raio fixo,
    // senão o anel corta o botão maior (aba primária do Frota) ou
    // sobra folga no menor.
    function centro(btn) {
      const r = btn.getBoundingClientRect()
      const n = estado.nav.getBoundingClientRect()
      return {
        x: r.left - n.left + r.width / 2,
        y: r.top - n.top + r.height / 2,
        R: Math.max(r.width, r.height) / 2,
      }
    }

    function desenhar() {
      const x0 = Math.min(estado.ax, estado.bx), x1 = Math.max(estado.ax, estado.bx)
      const comp = x1 - x0
      const R = estado.R
      // o traço engrossa conforme o bastão abre (ver a análise: ligado
      // ao ALONGAMENTO, não à velocidade — a velocidade passa por
      // zero no sobrepasso, o comprimento não)
      const esp = 2 + Math.min(1, comp / (R * 4.4)) * 1.9
      const cx = x0 - R, y = estado.cy - R, w = comp + 2 * R, h = 2 * R
      estado.nucleo.setAttribute('x', cx); estado.nucleo.setAttribute('y', y)
      estado.nucleo.setAttribute('width', w); estado.nucleo.setAttribute('height', h)
      estado.nucleo.setAttribute('rx', R); estado.nucleo.setAttribute('ry', R)
      estado.nucleo.setAttribute('stroke-width', esp)
      estado.halo.setAttribute('x', cx); estado.halo.setAttribute('y', y)
      estado.halo.setAttribute('width', w); estado.halo.setAttribute('height', h)
      estado.halo.setAttribute('rx', R); estado.halo.setAttribute('ry', R)
      estado.halo.setAttribute('stroke-width', esp + 3)
      estado.grad.setAttribute('x1', x0); estado.grad.setAttribute('x2', x1 || x0 + 1)
      estado.grad.setAttribute('y1', estado.cy); estado.grad.setAttribute('y2', estado.cy)
      estado.p0.setAttribute('stop-color', estado.ax <= estado.bx ? estado.corA : estado.corB)
      estado.p1.setAttribute('stop-color', estado.ax <= estado.bx ? estado.corB : estado.corA)
    }

    // Duas molas — cabeça (ax) e cauda (bx). A cauda é mole enquanto
    // há percurso a correr e endurece conforme a distância que falta
    // encolhe, NUNCA pela velocidade (que passa por zero no
    // sobrepasso — ver a análise do vídeo). Constantes calibradas
    // por varredura numérica para a nossa geometria (350-420ms,
    // contra os ~600ms das constantes originais do vídeo).
    function passo(ts) {
      if (!estado.ultimoTs) estado.ultimoTs = ts
      const h = Math.min(0.032, (ts - estado.ultimoTs) / 1000)
      estado.ultimoTs = ts

      if (!estado.arrastando) {
        const kH = 700, cH = 36
        estado.av += (-kH * (estado.ax - estado.alvo) - cH * estado.av) * h
        estado.ax += estado.av * h
      }

      const trip = Math.abs(estado.alvo - estado.partida) || 1
      const d = Math.abs(estado.alvo - estado.bx)
      const home = 1 - easeOut(Math.min(1, d / trip))
      const kB = 150 + 520 * home
      const cB = 2 * Math.sqrt(kB) * 0.90
      estado.bv += (-kB * (estado.bx - estado.alvo) - cB * estado.bv) * h
      estado.bx += estado.bv * h

      desenhar()

      const parou = !estado.arrastando &&
        Math.abs(estado.alvo - estado.ax) < 0.4 && Math.abs(estado.av) < 3 &&
        Math.abs(estado.alvo - estado.bx) < 0.4 && Math.abs(estado.bv) < 3
      if (parou) {
        estado.ax = estado.bx = estado.alvo; estado.av = estado.bv = 0
        desenhar(); estado.rodando = false; estado.ultimoTs = 0
        return
      }
      requestAnimationFrame(passo)
    }

    function iniciarLoop() {
      if (!estado.rodando) { estado.rodando = true; estado.ultimoTs = 0; requestAnimationFrame(passo) }
    }

    function irPara(btn, comVoo) {
      if (!btn) { if (estado.svg) estado.svg.style.opacity = '0'; return }
      estado.svg.style.opacity = '1'
      const c = centro(btn)
      estado.cy = c.y; estado.R = c.R
      estado.partida = estado.ax
      estado.alvo = c.x
      estado.corA = estado.corB
      estado.corB = corAtivo(btn)
      if (!comVoo || reduzido()) {
        estado.ax = estado.bx = estado.alvo; estado.av = estado.bv = 0
        estado.corA = estado.corB
        desenhar()
        return
      }
      iniciarLoop()
    }
    estado.irPara = irPara

    function sincronizar() {
      if (!estado.nav) return
      if (estado.nav.hidden) {
        if (estado.svg) estado.svg.style.opacity = '0'
        estado.ultimoAtivo = null
        return
      }
      const ativo = estado.nav.querySelector('button.ativa')
      const comVoo = !!(estado.ultimoAtivo && ativo && estado.ultimoAtivo !== ativo && estado.ultimoAtivo.isConnected)
      irPara(ativo, comVoo)
      estado.ultimoAtivo = ativo
    }

    // ── Arrastar a luz pela barra, com solta imantada ────────────
    // Confirmar contra a barra INTEIRA (não só as abas): se o dedo
    // soltar num botão que nunca vira aba (câmera, coletar), o
    // .click() nele não muda a classe .ativa em lugar nenhum, e a
    // luz volta sozinha pra aba que já estava ativa — sem precisar
    // a função saber quais botões SÃO abas.
    //
    // LIMIAR DE MOVIMENTO — achado testando, não suposto. Um toque
    // comum já É um pointerdown+pointerup (é assim que o navegador
    // gera o click nativo); sem o limiar, TODO toque também disparava
    // este código — .click() sintético na aba mais próxima por cima
    // do click nativo que ia acontecer de qualquer jeito, dois
    // disparos da troca de tela por um toque só. Só vira arrasto de
    // verdade quando o ponteiro anda mais que 6px antes de soltar.
    //
    // setPointerCapture só é chamado DEPOIS de confirmado o arrasto —
    // outro achado testando: chamado já no pointerdown (antes de saber
    // se ia virar arrasto), ele redireciona o ALVO do pointerup (e do
    // click nativo sintetizado a partir dele) para a nav em vez do
    // botão — o clique comum parava de navegar, silenciosamente,
    // porque `ev.target.closest('button')` no listener de clique da
    // página passava a ver a nav como alvo, nunca o botão.
    function instalarArrasto(nav) {
      const LIMIAR = 6
      let baixo = false, arrastando = false, x0 = 0, y0 = 0, pid = null
      nav.addEventListener('pointerdown', ev => {
        if (reduzido()) return
        if (ev.target.closest('button')?.disabled) return
        baixo = true; arrastando = false
        x0 = ev.clientX; y0 = ev.clientY; pid = ev.pointerId
      })
      nav.addEventListener('pointermove', ev => {
        if (!baixo) return
        if (!arrastando) {
          if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < LIMIAR) return
          arrastando = true; estado.arrastando = true
          estado.partida = estado.ax
          try { nav.setPointerCapture(pid) } catch (e) { /* noop */ }
          iniciarLoop()
        }
        mover(ev.clientX)
      })
      function soltar() {
        if (!baixo) return
        baixo = false
        if (!arrastando) return   // só um toque — o click nativo já resolve
        arrastando = false; estado.arrastando = false
        const n = nav.getBoundingClientRect()
        let melhor = null, dist = Infinity
        nav.querySelectorAll('button').forEach(b => {
          const r = b.getBoundingClientRect()
          const cx = r.left - n.left + r.width / 2
          const d = Math.abs(cx - estado.ax)
          if (d < dist) { dist = d; melhor = b }
        })
        if (melhor) {
          melhor.click()
          if (melhor.classList.contains('ativa')) {
            // aba de verdade: o .click() já trocou a classe .ativa —
            // o MutationObserver interno vai entregar essa mutação e
            // voar sozinho pra lá. Chamar irPara aqui TAMBÉM seria a
            // MESMA corrida documentada em religar(): grava
            // ultimoAtivo antes do observer chegar, e quando ele
            // chega vê "nada mudou" e cancela o voo que acabou de
            // começar.
          } else {
            // não é aba (câmera, coletar…): nada vai mudar sozinho —
            // sem mutação pendente, não há corrida nenhuma aqui, e a
            // luz precisa ser mandada de volta explicitamente pra aba
            // que já estava ativa (senão fica parada onde o dedo
            // soltou, fora de qualquer botão).
            const ativoAgora = nav.querySelector('button.ativa')
            irPara(ativoAgora, true)
            estado.ultimoAtivo = ativoAgora
          }
        }
      }
      nav.addEventListener('pointerup', soltar)
      nav.addEventListener('pointercancel', () => { baixo = false; arrastando = false; estado.arrastando = false })
      function mover(x) {
        const n = nav.getBoundingClientRect()
        const raio = estado.R || 25
        estado.alvo = Math.max(raio, Math.min(n.width - raio, x - n.left))
        estado.ax = estado.alvo; estado.av = 0
        desenhar()
      }
    }

    function montarEm(nav) {
      estado.nav = nav
      nav.classList.add('tem-luz')
      montarSvg()
      estado.svg.style.opacity = '0'
      nav.insertBefore(estado.svg, nav.firstChild)
      estado.ultimoAtivo = null
      estado.ax = estado.bx = 0; estado.av = estado.bv = 0

      estado.obsInterno = new MutationObserver(sincronizar)
      estado.obsInterno.observe(nav, { attributes: true, attributeFilter: ['class', 'hidden', 'style'], subtree: true })
      instalarArrasto(nav)
      sincronizar()
    }

    function religar() {
      if (estado.nav && !estado.nav.isConnected) {
        if (estado.obsInterno) { estado.obsInterno.disconnect(); estado.obsInterno = null }
        estado.nav = null; estado.svg = null
      }
      const novo = document.querySelector(seletor)
      // Já montada no nó certo — nada a fazer. A troca de classe que
      // disparou esta chamada (ex.: o próprio clique) já está na fila
      // do MutationObserver interno e vai chegar sozinha, por conta
      // própria, no microtask seguinte. Chamar sincronizar() TAMBÉM
      // aqui é a corrida real que travou o voo na 1ª versão: a chamada
      // explícita roda primeiro (dentro do clique, síncrona) e já
      // grava ultimoAtivo = destino; quando o MutationObserver entrega
      // a MESMA mutação logo depois, ele vê ultimoAtivo === ativo e
      // interpreta como "nada mudou" — voo cancelado antes do 1º
      // quadro. Deixar só o observer decidir resolve.
      if (novo === estado.nav) return
      if (estado.obsInterno) { estado.obsInterno.disconnect(); estado.obsInterno = null }
      if (!novo) { estado.nav = null; estado.svg = null; return }
      montarEm(novo)
    }
    estado.religar = religar

    return estado
  }

  function luzNavMontar(seletor) {
    let estado = registros.get(seletor)
    if (!estado) {
      estado = criarEstado(seletor)
      registros.set(seletor, estado)
    }
    estado.religar()
  }

  // Redimensionamento (troca de breakpoint 380px/330px, rotação):
  // reposiciona sem voar — o botão ativo não mudou, só o tamanho dele.
  window.addEventListener('resize', () => {
    registros.forEach(estado => {
      if (!estado.nav || estado.nav.hidden) return
      const ativo = estado.nav.querySelector('button.ativa')
      if (ativo) estado.irPara(ativo, false)
    })
  })

  window.luzNavMontar = luzNavMontar
})()
