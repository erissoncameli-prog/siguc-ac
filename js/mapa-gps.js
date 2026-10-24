// ── SIGUC — "Minha localização" no Mapa das UCs ─────────────────────
// Fase 5 do plano em docs/mapa-ucs/plano-medicao-comparacao.md. Fonte única
// (prefixo `gps`); a página só chama gpsMontar(mapaL, { ucEm }) em
// iniciarMapa(). Ideia vista no jurema-webgis (Cardeal Map) — sem código dele.
//
// Regras:
// - NADA é gravado nem enviado: a posição fica só no navegador, enquanto o
//   botão estiver ligado. Desligar apaga o ponto e para o acompanhamento.
//   (Os apps de campo têm aviso de LGPD próprio porque GRAVAM a posição;
//   esta tela não grava, por isso não entra no ROPA.)
// - A precisão sempre aparece junto da coordenada, e a ruim é avisada: no
//   computador a posição costuma vir da rede (centenas de metros), não do
//   GPS — sem o aviso, o ponto parece exato.
// - Coordenada no mesmo formato da medição (graus + UTM SIRGAS 2000,
//   medCoordenada/medCoordenadaTexto de js/mapa-medicao.js).
// - Qualquer falha (permissão negada, sem sinal, tempo esgotado, página sem
//   HTTPS) vira texto no painel; nunca exceção, nunca tela travada.

const GPS_PANE = 'gpsPane'
const GPS_COR = '#1D6FB8'
const GPS_PRECISAO_RUIM_M = 100
const GPS_OPCOES = { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }

const _gps = {
  mapa: null, ctrl: null, btn: null, painel: null, ucEm: null,
  ligado: false, acompanhando: false, watchId: null,
  ponto: null, circulo: null, ultima: null, erro: null, buscando: false,
}

function _gpsEsc(s) { return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;') }
function _gpsIco(nome) { return typeof bico === 'function' ? bico(nome) : '' }

function _gpsEstilos() {
  if (document.getElementById('gps-estilos')) return
  const st = document.createElement('style')
  st.id = 'gps-estilos'
  st.textContent = `
.gps-ctrl{display:flex;align-items:flex-start;gap:6px;font-family:'DM Sans',sans-serif;}
.gps-btn{width:32px;height:32px;padding:0;border:0;border-radius:8px;background:#fff;color:#1F4E2C;display:flex;align-items:center;justify-content:center;cursor:pointer;box-shadow:0 1px 5px rgba(0,0,0,.4);}
.gps-btn:hover{background:#f4f6f5;}
.gps-btn[aria-pressed="true"]{background:${GPS_COR};color:#fff;}
.gps-btn[aria-busy="true"] svg{animation:gps-giro 1.1s linear infinite;}
.gps-btn:focus-visible,.gps-acao:focus-visible{outline:2px solid #C9A84C;outline-offset:1px;}
@keyframes gps-giro{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion: reduce){.gps-btn[aria-busy="true"] svg{animation:none;}}
.gps-painel{width:236px;background:rgba(255,255,255,.97);border-radius:8px;box-shadow:0 2px 10px rgba(0,0,0,.3);padding:8px 10px;font-size:12px;line-height:1.4;color:#1f2937;}
.gps-painel[hidden]{display:none;}
.leaflet-top.gps-canto-acima{z-index:1001;}
.gps-titulo{font-weight:700;color:#1F4E2C;margin-bottom:2px;}
.gps-valor{font-weight:600;font-variant-numeric:tabular-nums;white-space:pre-line;}
.gps-linha{margin-top:4px;}
.gps-aviso{margin-top:4px;padding:4px 6px;border-radius:5px;background:#FEF3C7;color:#78350F;font-size:11px;}
.gps-erro{color:#B91C1C;}
.gps-nota{color:#6b7280;font-size:10.5px;margin-top:4px;}
.gps-acoes{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px;}
.gps-acao{min-height:26px;padding:3px 10px;border:1px solid #cbd5d0;border-radius:6px;background:#fff;color:#1F4E2C;font:inherit;font-size:11px;font-weight:600;cursor:pointer;}
.gps-acao[aria-pressed="true"]{background:${GPS_COR};border-color:${GPS_COR};color:#fff;}
.gps-acao:disabled{opacity:.45;cursor:not-allowed;}
@media print{.gps-ctrl{display:none!important;}}
`
  document.head.appendChild(st)
}

// opts.ucEm(lat, lng) → nome da UC ou null (a página entrega o PIP que já
// tem, js/mapa-recorte.js). Sem ele, o painel só não diz a UC.
function gpsMontar(mapa, opts = {}) {
  if (!mapa || typeof L === 'undefined' || _gps.mapa === mapa) return
  _gps.mapa = mapa
  _gps.ucEm = typeof opts.ucEm === 'function' ? opts.ucEm : null
  _gpsEstilos()
  if (!mapa.getPane(GPS_PANE)) {
    mapa.createPane(GPS_PANE)
    mapa.getPane(GPS_PANE).style.zIndex = 645   // junto da medição, abaixo de popups (700)
  }
  const Ctrl = L.Control.extend({
    options: { position: 'topleft' },
    onAdd() {
      const div = L.DomUtil.create('div', 'gps-ctrl')
      div.innerHTML = `<button type="button" class="gps-btn" aria-pressed="false" title="Minha localização" aria-label="Mostrar minha localização">${_gpsIco('navigation')}</button>`
        + `<div class="gps-painel" hidden role="status" aria-live="polite"></div>`
      L.DomEvent.disableClickPropagation(div)
      L.DomEvent.disableScrollPropagation(div)
      div.addEventListener('click', ev => {
        // o painel é redesenhado pelo próprio clique (mesma lição da medição)
        ev.stopPropagation()
        const b = ev.target.closest('button'); if (!b || b.disabled) return
        if (b.classList.contains('gps-btn')) gpsAlternar()
        else if (b.dataset.gps === 'acompanhar') gpsAcompanhar(!_gps.acompanhando)
        else if (b.dataset.gps === 'centralizar') _gpsCentralizar()
        else if (b.dataset.gps === 'copiar') _gpsCopiar(b)
        else if (b.dataset.gps === 'tentar') _gpsPedir()
      })
      return div
    },
  })
  _gps.ctrl = new Ctrl()
  mapa.addControl(_gps.ctrl)
  const c = _gps.ctrl.getContainer()
  _gps.btn = c.querySelector('.gps-btn')
  _gps.painel = c.querySelector('.gps-painel')
}

function gpsLigado() { return _gps.ligado }
function gpsUltimaPosicao() { return _gps.ultima ? { ..._gps.ultima } : null }

function gpsAlternar(ligar = !_gps.ligado) {
  if (!_gps.mapa) return
  if (!ligar) return gpsDesligar()
  _gps.ligado = true
  _gps.btn.setAttribute('aria-pressed', 'true')
  _gpsPedir()
}

function gpsDesligar() {
  gpsAcompanhar(false)
  if (_gps.ponto) _gps.mapa.removeLayer(_gps.ponto)
  if (_gps.circulo) _gps.mapa.removeLayer(_gps.circulo)
  Object.assign(_gps, { ligado: false, ponto: null, circulo: null, ultima: null, erro: null, buscando: false })
  if (_gps.btn) { _gps.btn.setAttribute('aria-pressed', 'false'); _gps.btn.removeAttribute('aria-busy') }
  if (_gps.painel) { _gpsRender(); _gps.painel.innerHTML = '' }
}

function _gpsSuporte() {
  if (!('geolocation' in navigator)) return 'Este navegador não fornece a localização.'
  if (window.isSecureContext === false) return 'A localização só funciona com a página aberta em HTTPS.'
  return null
}

function _gpsPedir() {
  const falta = _gpsSuporte()
  if (falta) { _gps.erro = falta; return _gpsRender() }
  _gps.buscando = true; _gps.erro = null
  _gps.btn.setAttribute('aria-busy', 'true')
  _gpsRender()
  navigator.geolocation.getCurrentPosition(
    pos => { if (_gps.ligado) _gpsRecebeu(pos, true) },
    err => { if (_gps.ligado) _gpsFalhou(err) },
    GPS_OPCOES)
}

function _gpsMensagemErro(err) {
  if (err && err.code === 1) return 'Permissão de localização negada. Libere o acesso à localização nas configurações do navegador e tente de novo.'
  if (err && err.code === 3) return 'A posição demorou demais para chegar. Em local fechado o sinal pode não alcançar — tente de novo perto de uma janela ou ao ar livre.'
  return 'Não foi possível obter a posição agora (sem sinal de GPS ou de rede).'
}

function _gpsFalhou(err) {
  _gps.buscando = false
  _gps.btn.removeAttribute('aria-busy')
  // acompanhando, uma leitura perdida não apaga a última posição boa
  if (_gps.ultima && _gps.acompanhando && err && err.code !== 1) return _gpsRender()
  _gps.erro = _gpsMensagemErro(err)
  if (err && err.code === 1) gpsAcompanhar(false)
  _gpsRender()
}

function _gpsRecebeu(pos, enquadrar) {
  const { latitude: lat, longitude: lng, accuracy } = pos.coords
  _gps.buscando = false; _gps.erro = null
  _gps.btn.removeAttribute('aria-busy')
  let uc = null
  try { uc = _gps.ucEm ? _gps.ucEm(lat, lng) : undefined } catch (_) { uc = undefined }
  _gps.ultima = { lat, lng, precisaoM: accuracy, em: pos.timestamp || Date.now(), uc }
  const ll = [lat, lng]
  if (!_gps.circulo) {
    _gps.circulo = L.circle(ll, { radius: accuracy, pane: GPS_PANE, color: GPS_COR, weight: 1, opacity: 0.6, fillColor: GPS_COR, fillOpacity: 0.12, interactive: false }).addTo(_gps.mapa)
    _gps.ponto = L.circleMarker(ll, { radius: 7, pane: GPS_PANE, color: '#fff', weight: 2.5, fillColor: GPS_COR, fillOpacity: 1, interactive: false }).addTo(_gps.mapa)
  } else {
    _gps.circulo.setLatLng(ll).setRadius(accuracy)
    _gps.ponto.setLatLng(ll)
  }
  if (enquadrar) _gpsCentralizar()
  else if (_gps.acompanhando && !_gps.mapa.getBounds().pad(-0.15).contains(ll)) _gps.mapa.panTo(ll)
  _gpsRender()
}

function _gpsCentralizar() {
  if (!_gps.circulo) return
  const b = _gps.circulo.getBounds()
  _gps.mapa.fitBounds(b, { maxZoom: 16, padding: [40, 40], animate: false })
}

// Acompanhar = watchPosition enquanto ligado. Só reenquadra quando o ponto
// sai da área central: recentrar a cada leitura impediria olhar o entorno.
function gpsAcompanhar(ligar) {
  if (!ligar) {
    if (_gps.watchId !== null && 'geolocation' in navigator) navigator.geolocation.clearWatch(_gps.watchId)
    _gps.watchId = null; _gps.acompanhando = false
    if (_gps.ligado) _gpsRender()
    return
  }
  if (!_gps.ligado || _gpsSuporte()) return
  _gps.acompanhando = true
  _gps.watchId = navigator.geolocation.watchPosition(
    pos => { if (_gps.ligado) _gpsRecebeu(pos, false) },
    err => { if (_gps.ligado) _gpsFalhou(err) },
    GPS_OPCOES)
  _gpsRender()
}

function _gpsCoordTexto(u) {
  if (typeof medCoordenada === 'function' && typeof medCoordenadaTexto === 'function') return medCoordenadaTexto(medCoordenada(u.lat, u.lng))
  return `${u.lat.toFixed(6).replace('.', ',')}, ${u.lng.toFixed(6).replace('.', ',')}`
}

function _gpsPrecisaoTexto(m) {
  return m >= 1000 ? `± ${(m / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} km` : `± ${Math.round(m).toLocaleString('pt-BR')} m`
}

function _gpsRender() {
  const p = _gps.painel; if (!p) return
  // Os cantos do Leaflet têm o mesmo z-index e o de baixo vem depois no DOM:
  // a legenda (canto inferior) cobria o painel aberto. Sobe só o canto do GPS,
  // e só enquanto o painel está aberto.
  const canto = _gps.ctrl && _gps.ctrl.getContainer().parentElement
  if (canto) canto.classList.toggle('gps-canto-acima', _gps.ligado)
  if (!_gps.ligado) { p.hidden = true; return }
  p.hidden = false
  const u = _gps.ultima
  let h = `<div class="gps-titulo">Minha localização</div>`
  if (_gps.erro) {
    h += `<div class="gps-linha gps-erro">${_gpsEsc(_gps.erro)}</div>`
    if (!_gpsSuporte()) h += `<div class="gps-acoes"><button type="button" class="gps-acao" data-gps="tentar">Tentar de novo</button></div>`
  } else if (!u) {
    h += `<div class="gps-linha">Procurando sua posição…</div>`
  }
  if (u && !(_gps.erro && !_gps.acompanhando)) {
    h += `<div class="gps-valor gps-linha" data-gps-coord>${_gpsEsc(_gpsCoordTexto(u))}</div>`
      + `<div class="gps-linha">Precisão: <strong data-gps-precisao>${_gpsPrecisaoTexto(u.precisaoM)}</strong></div>`
    if (u.precisaoM > GPS_PRECISAO_RUIM_M) h += `<div class="gps-aviso">Precisão baixa: a posição provavelmente veio da rede, não do GPS. No celular ao ar livre ela melhora.</div>`
    if (u.uc !== undefined) h += `<div class="gps-linha" data-gps-uc>${u.uc ? `Dentro da UC: <strong>${_gpsEsc(u.uc)}</strong>` : 'Fora das UCs mapeadas'}</div>`
    h += `<div class="gps-nota">Lida às ${new Date(u.em).toLocaleTimeString('pt-BR')}. Nada é gravado: a posição fica só neste navegador.</div>`
      + `<div class="gps-acoes">
          <button type="button" class="gps-acao" data-gps="acompanhar" aria-pressed="${_gps.acompanhando}">${_gps.acompanhando ? 'Acompanhando' : 'Acompanhar'}</button>
          <button type="button" class="gps-acao" data-gps="centralizar">Centralizar</button>
          <button type="button" class="gps-acao" data-gps="copiar">Copiar</button>
        </div>`
  }
  p.innerHTML = h
}

function _gpsCopiar(btn) {
  const u = _gps.ultima; if (!u) return
  const txt = `${_gpsCoordTexto(u)}\nPrecisão ${_gpsPrecisaoTexto(u.precisaoM)}`
  const ok = () => { btn.textContent = 'Copiado'; setTimeout(() => { if (btn.isConnected) btn.textContent = 'Copiar' }, 1500) }
  try { navigator.clipboard.writeText(txt).then(ok, () => {}) } catch (_) { /* sem área de transferência: só não copia */ }
}
