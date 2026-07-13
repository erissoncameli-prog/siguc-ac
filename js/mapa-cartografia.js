/**
 * mapa-cartografia.js
 * Elementos cartográficos obrigatórios para todos os mapas do SIGUC-AC.
 * ABNT NBR 14166 / padrão ICMBio / IBGE.
 *
 * API pública:
 *   CartografiaInit(mapaLeaflet)          — chame após criar o mapa
 *   CartografiaLegendaAtualizar(itens)    — atualiza legenda dinâmica
 *   CartografiaImprimir(titulo)           — abre janela de impressão
 *   CartografiaRodapeHTML(titulo, notas)  — HTML do rodapé para relatórios/exports
 */

window.CART = (function () {

  // ─── Constantes institucionais ────────────────────────────────
  const DATUM      = 'SIRGAS 2000';
  const PROJECAO   = 'WGS 84 (EPSG:4326)';
  const FONTES     = 'ICMBio · FUNAI · IBGE · SEMA-AC · SICAR/CAR · MapBiomas · INPE/PRODES';
  const ORGAO      = 'SEMA/AC — Secretaria de Meio Ambiente do Acre';
  const SISTEMA    = 'SIGUC-AC';
  const ANO_DADOS  = '2025';          // ano de referência dos dados

  // ─── Estado ───────────────────────────────────────────────────
  let _map   = null;
  let _legCtrl = null;
  let _infoCtrl = null;
  let _imgDataCtrl = null;

  // ─── 1. ESCALA ────────────────────────────────────────────────
  function _adicionarEscala() {
    L.control.scale({
      position: 'bottomleft',
      metric: true,
      imperial: false,
      maxWidth: 120,
      updateWhenIdle: false
    }).addTo(_map);
  }

  // ─── 2. LEGENDA DINÂMICA ─────────────────────────────────────
  function _criarControleLegenada() {
    const Ctrl = L.Control.extend({
      options: { position: 'bottomleft' },
      onAdd() {
        const div = L.DomUtil.create('div', 'cart-legenda');
        div.id = 'cart-legenda-ctrl';
        div.innerHTML = _legendaVazia();
        L.DomEvent.disableClickPropagation(div);
        L.DomEvent.disableScrollPropagation(div);
        return div;
      }
    });
    _legCtrl = new Ctrl();
    _legCtrl.addTo(_map);
    // Aguarda o DOM montar e ativa drag
    requestAnimationFrame(() => _ativarDragLegenda());
  }

  function _ativarDragLegenda() {
    const div = document.getElementById('cart-legenda-ctrl');
    if (!div) return;
    div.style.cursor = 'grab';

    let dragging = false, startX = 0, startY = 0, origLeft = 0, origTop = 0;

    div.addEventListener('mousedown', e => {
      // Ignora cliques em checkboxes/botões dentro do card
      if (e.target.closest('input,button,select')) return;
      dragging = true;
      const r = div.getBoundingClientRect();
      // Converte para posição fixed desacoplando do container Leaflet
      div.style.position = 'fixed';
      div.style.left   = r.left + 'px';
      div.style.top    = r.top  + 'px';
      div.style.bottom = 'auto';
      div.style.right  = 'auto';
      div.style.margin = '0';
      origLeft = r.left;
      origTop  = r.top;
      startX   = e.clientX;
      startY   = e.clientY;
      div.style.cursor = 'grabbing';
      e.preventDefault();
      L.DomEvent.stopPropagation(e);
    });

    document.addEventListener('mousemove', e => {
      if (!dragging) return;
      const nx = origLeft + (e.clientX - startX);
      const ny = origTop  + (e.clientY - startY);
      div.style.left = Math.max(0, Math.min(nx, window.innerWidth  - div.offsetWidth))  + 'px';
      div.style.top  = Math.max(0, Math.min(ny, window.innerHeight - div.offsetHeight)) + 'px';
    });

    document.addEventListener('mouseup', () => {
      if (!dragging) return;
      dragging = false;
      div.style.cursor = 'grab';
    });
  }

  function _legendaVazia() {
    return '<div class="cart-leg-title">Legenda</div>'
         + '<div class="cart-leg-empty">Nenhuma camada ativa</div>';
  }

  // itens: [{ simbolo:'rect'|'circle'|'line', cor:'#hex', label:'texto', dash?:bool }, ...]
  function legendaAtualizar(itens) {
    const el = document.getElementById('cart-legenda-ctrl');
    if (!el) return;
    if (!itens || !itens.length) { el.innerHTML = _legendaVazia(); return; }
    const linhas = itens.map(it => {
      const s = _simboloSVG(it);
      return `<div class="cart-leg-item">${s}<span>${it.label}</span></div>`;
    }).join('');
    el.innerHTML = '<div class="cart-leg-title">Legenda</div>' + linhas;
  }

  function _simboloSVG(it) {
    const c = it.cor || '#888';
    const o = it.opacidade != null ? it.opacidade : 0.7;
    if (it.simbolo === 'circle') {
      return `<svg width="14" height="14" viewBox="0 0 14 14">
        <circle cx="7" cy="7" r="5" fill="${c}" opacity="${o}" stroke="${c}" stroke-width="1.5"/>
      </svg>`;
    }
    if (it.simbolo === 'line') {
      const dash = it.dash ? '4 3' : '0';
      return `<svg width="18" height="10" viewBox="0 0 18 10">
        <line x1="1" y1="5" x2="17" y2="5" stroke="${c}" stroke-width="2.5"
          stroke-dasharray="${dash}" stroke-linecap="round"/>
      </svg>`;
    }
    // rect (polígono)
    const stroke = it.somente_borda ? c : (it.cor_borda || c);
    const fill   = it.somente_borda ? 'none' : c;
    const dash   = it.dash ? '3 2' : '0';
    return `<svg width="16" height="12" viewBox="0 0 16 12">
      <rect x="1" y="1" width="14" height="10" rx="2"
        fill="${fill}" fill-opacity="${o}"
        stroke="${stroke}" stroke-width="1.8" stroke-dasharray="${dash}"/>
    </svg>`;
  }

  // ─── 3. RODAPÉ CARTOGRÁFICO (info strip) ─────────────────────
  function _criarControleInfo() {
    const Ctrl = L.Control.extend({
      options: { position: 'bottomright' },
      onAdd() {
        const div = L.DomUtil.create('div', 'cart-info-strip');
        div.id = 'cart-info-strip';
        div.innerHTML = _infoHTML();
        L.DomEvent.disableClickPropagation(div);
        return div;
      }
    });
    _infoCtrl = new Ctrl();
    _infoCtrl.addTo(_map);
  }

  function _infoHTML() {
    const ano = new Date().getFullYear();
    return `
      <span class="cart-info-sep">📐 ${DATUM} · ${PROJECAO}</span>
      <span class="cart-info-sep">Fontes: ${FONTES}</span>
      <span class="cart-info-sep">Ref.: ${ANO_DADOS} · © ${ano} ${SISTEMA}</span>
    `;
  }

  // ─── 3b. RÓTULO DE DATA DA IMAGEM DE SATÉLITE ─────────────────
  function _criarControleImagemData() {
    const Ctrl = L.Control.extend({
      options: { position: 'topright' },
      onAdd() {
        const div = L.DomUtil.create('div', 'cart-imgdata');
        div.id = 'cart-imgdata-ctrl';
        div.style.display = 'none';
        L.DomEvent.disableClickPropagation(div);
        return div;
      }
    });
    _imgDataCtrl = new Ctrl();
    _imgDataCtrl.addTo(_map);
  }

  // texto: string com a fonte/data da imagem ativa, ou null/'' para ocultar
  function imagemDataAtualizar(texto) {
    const el = document.getElementById('cart-imgdata-ctrl');
    if (!el) return;
    if (!texto) { el.style.display = 'none'; el.innerHTML = ''; return; }
    el.style.display = 'block';
    el.innerHTML = texto;
  }

  // ─── 4. INIT principal ────────────────────────────────────────
  function init(mapaLeaflet) {
    if (!mapaLeaflet) return;
    _map = mapaLeaflet;
    _adicionarEscala();
    _criarControleLegenada();
    _criarControleInfo();
    _criarControleImagemData();
    _injetarEstilos();
  }

  // ─── 5. PRINT ─────────────────────────────────────────────────
  function imprimir(titulo) {
    const tituloFinal = titulo || 'Mapa das Unidades de Conservação — Acre';
    const mapEl = document.getElementById('mapa');
    if (!mapEl) { window.print(); return; }

    // Força Leaflet a renderizar tiles antes de imprimir
    if (_map) _map.invalidateSize();

    // Abre janela de print com snapshot do estado atual
    const printWin = window.open('', '_blank', 'width=1200,height=900');
    if (!printWin) { window.print(); return; }

    const legEl  = document.getElementById('cart-legenda-ctrl');
    const legHTML = legEl ? legEl.outerHTML : '';
    const escala = document.querySelector('.leaflet-control-scale')?.outerHTML || '';
    const rosa   = document.querySelector('.rosa-norte')?.outerHTML || '';
    const ano    = new Date().getFullYear();
    const dataHoje = new Date().toLocaleDateString('pt-BR', { day:'2-digit', month:'long', year:'numeric' });

    printWin.document.write(`<!DOCTYPE html>
<html lang="pt-BR"><head>
<meta charset="UTF-8">
<title>${_esc(tituloFinal)}</title>
<style>
  @page { size: A3 landscape; margin: 12mm; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'DM Sans', Arial, sans-serif; background:#fff; color:#111; }
  .print-wrap { display:flex; flex-direction:column; height:100vh; gap:0; }
  /* Cabeçalho */
  .print-header { display:flex; align-items:center; gap:14px; padding:10px 14px;
    border-bottom:3px solid #1F4E2C; background:#f0fdf4; flex-shrink:0; }
  .print-header-logo { width:38px; height:38px; background:#1F4E2C; border-radius:8px;
    display:flex; align-items:center; justify-content:center; font-size:20px; flex-shrink:0; }
  .print-header-titulo { font-size:17px; font-weight:700; color:#1F4E2C; }
  .print-header-sub { font-size:10px; color:#6b7280; margin-top:2px; }
  .print-header-meta { margin-left:auto; text-align:right; font-size:9px; color:#6b7280; line-height:1.6; }
  /* Área do mapa */
  .print-mapa-area { flex:1; display:flex; gap:0; min-height:0; position:relative; }
  .print-mapa-img { flex:1; background:#e5e7eb; position:relative; overflow:hidden; }
  .print-mapa-img .mapa-placeholder { width:100%; height:100%; display:flex; align-items:center;
    justify-content:center; font-size:13px; color:#9ca3af; }
  /* Rodapé cartográfico */
  .print-footer { display:flex; align-items:center; gap:16px; padding:6px 14px;
    border-top:2px solid #1F4E2C; background:#f0fdf4; flex-shrink:0; font-size:9px; color:#374151; }
  .print-footer-block { display:flex; flex-direction:column; gap:1px; }
  .print-footer-label { font-weight:700; text-transform:uppercase; letter-spacing:.05em; color:#1F4E2C; font-size:8px; }
  .print-footer-sep { width:1px; background:#d1fae5; align-self:stretch; flex-shrink:0; }
  .print-footer-right { margin-left:auto; text-align:right; }
  /* Legenda */
  .print-legenda { width:180px; flex-shrink:0; border-left:1px solid #e5e7eb;
    padding:10px 12px; display:flex; flex-direction:column; gap:6px; background:#fff; }
  .print-leg-titulo { font-size:10px; font-weight:700; color:#1F4E2C;
    text-transform:uppercase; letter-spacing:.06em; padding-bottom:5px;
    border-bottom:1px solid #e5e7eb; margin-bottom:2px; }
  .cart-leg-item { display:flex; align-items:center; gap:5px; font-size:10px; color:#374151; margin-bottom:3px; }
  /* Escala e norte */
  .print-controles { display:flex; align-items:flex-end; gap:8px; margin-top:auto; }
  .leaflet-control-scale-line { border:2px solid #1F4E2C!important; border-top:none!important;
    background:#fff!important; font-size:9px!important; font-weight:700!important; color:#1F4E2C!important;
    white-space:nowrap!important; padding:1px 4px!important; }
</style>
</head><body>
<div class="print-wrap">
  <div class="print-header">
    <div class="print-header-logo">🗺</div>
    <div>
      <div class="print-header-titulo">${_esc(tituloFinal)}</div>
      <div class="print-header-sub">${ORGAO} · ${SISTEMA}</div>
    </div>
    <div class="print-header-meta">
      Emitido em: ${dataHoje}<br>
      Datum: ${DATUM}<br>
      Projeção: ${PROJECAO}
    </div>
  </div>

  <div class="print-mapa-area">
    <div class="print-mapa-img">
      <div class="mapa-placeholder">
        [ Captura do mapa — utilize Ctrl+P após fechar esta prévia ou use a exportação por imagem ]
      </div>
    </div>
    <div class="print-legenda">
      <div class="print-leg-titulo">Legenda</div>
      ${legHTML}
      <div class="print-controles">${escala}${rosa}</div>
    </div>
  </div>

  <div class="print-footer">
    <div class="print-footer-block">
      <span class="print-footer-label">Datum / Projeção</span>
      <span>${DATUM} · ${PROJECAO}</span>
    </div>
    <div class="print-footer-sep"></div>
    <div class="print-footer-block">
      <span class="print-footer-label">Fontes dos dados</span>
      <span>${FONTES}</span>
    </div>
    <div class="print-footer-sep"></div>
    <div class="print-footer-block">
      <span class="print-footer-label">Referência</span>
      <span>Dados: ${ANO_DADOS} · Emissão: ${dataHoje}</span>
    </div>
    <div class="print-footer-right print-footer-block">
      <span class="print-footer-label">${SISTEMA}</span>
      <span>${ORGAO}</span>
    </div>
  </div>
</div>
<script>window.onload=()=>window.print();<\/script>
</body></html>`);
    printWin.document.close();
  }

  // ─── 6. RODAPÉ HTML para relatórios/exports ───────────────────
  function rodapeHTML(titulo, notas) {
    const dataHoje = new Date().toLocaleDateString('pt-BR', { day:'2-digit', month:'long', year:'numeric' });
    return `
<div class="cart-rodape-relatorio">
  <div class="cart-rod-grid">
    <div class="cart-rod-bloco">
      <span class="cart-rod-label">Datum / Projeção</span>
      <span class="cart-rod-valor">${DATUM} · ${PROJECAO}</span>
    </div>
    <div class="cart-rod-bloco">
      <span class="cart-rod-label">Fontes dos dados</span>
      <span class="cart-rod-valor">${FONTES}</span>
    </div>
    <div class="cart-rod-bloco">
      <span class="cart-rod-label">Referência dos dados</span>
      <span class="cart-rod-valor">${ANO_DADOS}</span>
    </div>
    <div class="cart-rod-bloco">
      <span class="cart-rod-label">Data de emissão</span>
      <span class="cart-rod-valor">${dataHoje}</span>
    </div>
    ${notas ? `<div class="cart-rod-bloco cart-rod-full">
      <span class="cart-rod-label">Observações</span>
      <span class="cart-rod-valor">${_esc(notas)}</span>
    </div>` : ''}
  </div>
  <div class="cart-rod-assinatura">
    <strong>${SISTEMA}</strong> · ${ORGAO}
    ${titulo ? ` · ${_esc(titulo)}` : ''}
  </div>
</div>`;
  }

  // ─── 7. ESTILOS CSS (injetados no <head>) ────────────────────
  function _injetarEstilos() {
    if (document.getElementById('cart-styles')) return;
    const s = document.createElement('style');
    s.id = 'cart-styles';
    s.textContent = `
/* ── Legenda cartográfica ── */
.cart-legenda {
  background: rgba(255,255,255,.95);
  border: 1px solid rgba(0,0,0,.15);
  border-radius: 8px;
  padding: 7px 10px 8px;
  min-width: 130px;
  max-width: 210px;
  box-shadow: 0 2px 10px rgba(0,0,0,.22);
  backdrop-filter: blur(3px);
  font-family: 'DM Sans', Arial, sans-serif;
  pointer-events: auto;
}
.cart-leg-title {
  font-size: 9px;
  font-weight: 700;
  color: #1F4E2C;
  text-transform: uppercase;
  letter-spacing: .07em;
  padding-bottom: 5px;
  border-bottom: 1px solid #e5e7eb;
  margin-bottom: 5px;
}
.cart-leg-item {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 10px;
  color: #374151;
  margin-bottom: 3px;
  line-height: 1.3;
}
.cart-leg-item svg { flex-shrink: 0; }
.cart-leg-empty {
  font-size: 10px;
  color: #9ca3af;
  font-style: italic;
}

/* ── Info strip (datum / fontes) ── */
.cart-info-strip {
  background: rgba(255,255,255,.88);
  border: 1px solid rgba(0,0,0,.12);
  border-radius: 6px;
  padding: 4px 9px;
  font-family: 'DM Sans', Arial, sans-serif;
  font-size: 9px;
  color: #374151;
  display: flex;
  flex-direction: column;
  gap: 1px;
  max-width: 260px;
  box-shadow: 0 1px 6px rgba(0,0,0,.15);
  backdrop-filter: blur(3px);
  line-height: 1.5;
}
.cart-info-sep {
  display: block;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* ── Rótulo de data da imagem de satélite ── */
.cart-imgdata {
  background: rgba(17,24,16,.82);
  border: 1px solid rgba(255,255,255,.18);
  border-radius: 99px;
  padding: 5px 12px;
  font-family: 'DM Sans', Arial, sans-serif;
  font-size: 11px;
  font-weight: 600;
  color: #f4efe6;
  box-shadow: 0 2px 10px rgba(0,0,0,.28);
  backdrop-filter: blur(3px);
  white-space: nowrap;
  margin-top: 6px;
}

/* ── Escala Leaflet — estilo refinado ── */
.leaflet-control-scale-line {
  border: 2px solid #1F4E2C !important;
  border-top: none !important;
  background: rgba(255,255,255,.9) !important;
  font-size: 9px !important;
  font-weight: 700 !important;
  color: #1F4E2C !important;
  white-space: nowrap !important;
  font-family: 'DM Sans', Arial, sans-serif !important;
  padding: 1px 4px !important;
  border-radius: 0 0 3px 3px !important;
}

/* ── Rodapé para relatórios ── */
.cart-rodape-relatorio {
  border: 1px solid #d1fae5;
  border-radius: 10px;
  background: #f0fdf4;
  padding: 12px 16px;
  margin-top: 20px;
  font-family: 'DM Sans', Arial, sans-serif;
}
.cart-rod-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 10px 20px;
  margin-bottom: 10px;
}
.cart-rod-full { grid-column: 1 / -1; }
.cart-rod-bloco { display: flex; flex-direction: column; gap: 2px; }
.cart-rod-label {
  font-size: 9px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: .07em;
  color: #2D6A4F;
}
.cart-rod-valor { font-size: 11px; color: #374151; line-height: 1.4; }
.cart-rod-assinatura {
  font-size: 10px;
  color: #2D6A4F;
  border-top: 1px solid #bbf7d0;
  padding-top: 8px;
  text-align: right;
}

/* ── @media print ── */
@media print {
  /* Esconde tudo do layout */
  #sidebar, .topbar, .mapa-topbar, .mapa-layerbar,
  .mapa-painel-wrap, .btn-filtros-mobile, .mapa-backdrop,
  .car-det-panel, .acre-editor, .leaflet-control-zoom,
  .leaflet-control-minimap, .mapa-modo-ctrl,
  .uc-stats-card, #uc-stats-card,
  .leaflet-control-attribution,
  nav, .nav, [class*="sidebar"] { display: none !important; }

  /* Mapa ocupa a página toda */
  body, #app, .page-body, .mapa-wrapper, .mapa-container, #mapa {
    width: 100% !important;
    height: 100vh !important;
    max-height: none !important;
    overflow: visible !important;
    padding: 0 !important;
    margin: 0 !important;
    border: none !important;
    border-radius: 0 !important;
  }

  /* Controles cartográficos ficam visíveis */
  .cart-legenda, .cart-info-strip, .cart-imgdata,
  .leaflet-control-scale, .rosa-norte { display: block !important; }

  /* Título impresso */
  .mapa-print-titulo {
    display: block !important;
    position: fixed;
    top: 6px; left: 10px;
    z-index: 9999;
    background: rgba(255,255,255,.92);
    border-radius: 6px;
    padding: 4px 12px;
    font-size: 13px;
    font-weight: 700;
    color: #1F4E2C;
    font-family: 'DM Sans', Arial, sans-serif;
    border: 1px solid #d1fae5;
  }
  .mapa-print-titulo { display: none; } /* escondido na tela */
}
    `;
    document.head.appendChild(s);
  }

  // ─── Utilitário ───────────────────────────────────────────────
  function _esc(s) { return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

  // ─── Constantes expostas ─────────────────────────────────────
  return {
    init:                init,
    legendaAtualizar:    legendaAtualizar,
    imagemDataAtualizar: imagemDataAtualizar,
    imprimir:            imprimir,
    rodapeHTML:          rodapeHTML,
    DATUM,
    PROJECAO,
    FONTES,
    ORGAO,
    SISTEMA,
    ANO_DADOS,
  };
})();
