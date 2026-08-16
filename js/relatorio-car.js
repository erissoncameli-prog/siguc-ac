// SIGUC-AC · Relatório de Impressão CAR
// Depende de: config-sistema.js, turf.js (já carregado no mapa.html)
// Leaflet já carregado globalmente como `L`

// ── Utilitários ───────────────────────────────────────────────────────────

const _relEsc = s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const _relF2  = n => Number(n||0).toLocaleString('pt-BR',{maximumFractionDigits:2});
const _relF1  = n => Number(n||0).toLocaleString('pt-BR',{maximumFractionDigits:1});
const _relPct = (v,t) => t>0 ? _relF1(v/t*100) : '0,0';
const _relData = () => new Date().toLocaleDateString('pt-BR');

// Traduz códigos de situação do CAR (SICAR) para texto legível
const _SICAR_STATUS = { AT: 'Ativo', PE: 'Pendente', SU: 'Suspenso', CA: 'Cancelado' };
function _traduzStatusCAR(v) {
  if (!v) return '—';
  const k = String(v).trim().toUpperCase();
  return _SICAR_STATUS[k] || String(v); // se já vier legível, mantém
}
// Formata data ISO (YYYY-MM-DD) ou qualquer data para pt-BR
function _relDataBR(v) {
  if (!v || v === '—') return '—';
  const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  const d = new Date(v);
  return isNaN(d.getTime()) ? String(v) : d.toLocaleDateString('pt-BR');
}

function _calcularEscalaLeaflet(zoom, lat) {
  const mPx = 156543.03392 * Math.cos((lat||0) * Math.PI / 180) / Math.pow(2, zoom||10);
  const raw  = Math.round(mPx * 96 / 0.0254);
  const escalas = [500,1000,2000,5000,10000,25000,50000,100000,250000,500000,1000000,2000000];
  const nearest = escalas.reduce((p,c) => Math.abs(c-raw)<Math.abs(p-raw)?c:p);
  return `1:${nearest.toLocaleString('pt-BR')}`;
}

// ── Cartografia ABNT/IBGE: UTM SIRGAS 2000, grid, norte, legenda, inset ────

// Seta de norte cartográfica (Web Mercator é norte-acima, sem rotação)
const _SETA_NORTE = `<svg viewBox="0 0 22 26" width="20" height="24" aria-label="Norte">
  <polygon points="11,1 17,15 11,11 5,15" fill="#0A1A0F"/>
  <polygon points="11,1 11,11 5,15" fill="#4b5563"/>
  <text x="11" y="25" text-anchor="middle" font-size="8" font-weight="700" fill="#0A1A0F" font-family="Arial">N</text>
</svg>`;

const _utmZone   = lon => Math.floor((lon + 180) / 6) + 1;
const _utmDef    = zone => `+proj=utm +zone=${zone} +south +ellps=GRS80 +towgs84=0,0,0 +units=m +no_defs`;
const _epsgUTM   = zone => 31960 + zone; // SIRGAS 2000 / UTM Sul: 18S=31978, 19S=31979, 20S=31980
const _temProj4  = () => typeof proj4 !== 'undefined';
const _toUTM     = (lon, lat, zone) => proj4('EPSG:4326', _utmDef(zone), [lon, lat]);
const _fromUTM   = (e, n, zone)     => proj4(_utmDef(zone), 'EPSG:4326', [e, n]);
function _zonaImovel(d){ return _utmZone((d?.centroide && d.centroide[0]) || -69); }

function _niceStep(span, alvo = 4) {
  const raw = Math.max(span / alvo, 1);
  const pot = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / pot;
  return (n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10) * pot;
}

// Desenha a quadrícula UTM (linhas + rótulos nas bordas) sobre um mapa Leaflet
function _desenharGridUTM(map, zone) {
  if (!_temProj4()) return null;
  const grp = L.layerGroup().addTo(map);
  const b = map.getBounds();
  const cantos = [b.getSouthWest(), b.getNorthWest(), b.getNorthEast(), b.getSouthEast()]
    .map(ll => _toUTM(ll.lng, ll.lat, zone));
  const Es = cantos.map(c => c[0]), Ns = cantos.map(c => c[1]);
  const minE = Math.min(...Es), maxE = Math.max(...Es);
  const minN = Math.min(...Ns), maxN = Math.max(...Ns);
  const step = Math.max(_niceStep(maxE - minE), _niceStep(maxN - minN));
  const NS = 24; // amostras p/ acompanhar a curvatura no Web Mercator
  const estilo = { color: '#475569', weight: 0.5, opacity: 0.65, interactive: false, dashArray: '3 4' };
  const lbl = (latlng, txt, pos) => L.marker(latlng, {
    interactive: false, keyboard: false,
    icon: L.divIcon({ className: 'rel-grid-anchor', html: `<span class="rel-grid-lbl rel-grid-${pos}">${txt}</span>`, iconSize: [0, 0] })
  }).addTo(grp);
  const fmt = m => (m / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 0 });

  // Linhas verticais (Easting constante)
  for (let e = Math.ceil(minE / step) * step; e <= maxE; e += step) {
    const pts = [];
    for (let k = 0; k <= NS; k++) { const n = minN + (maxN - minN) * k / NS; const ll = _fromUTM(e, n, zone); pts.push([ll[1], ll[0]]); }
    L.polyline(pts, estilo).addTo(grp);
    lbl(pts[pts.length - 1], fmt(e), 'topo');
    lbl(pts[0], fmt(e), 'base');
  }
  // Linhas horizontais (Northing constante)
  for (let n = Math.ceil(minN / step) * step; n <= maxN; n += step) {
    const pts = [];
    for (let k = 0; k <= NS; k++) { const e = minE + (maxE - minE) * k / NS; const ll = _fromUTM(e, n, zone); pts.push([ll[1], ll[0]]); }
    L.polyline(pts, estilo).addTo(grp);
    lbl(pts[0], fmt(n), 'esq');
    lbl(pts[pts.length - 1], fmt(n), 'dir');
  }
  return grp;
}

// Legenda com amostras de cor fiéis às camadas
function _legendaHTML(camadas) {
  return (camadas || []).map(c => {
    let sw;
    if (c.kind === 'line') sw = `<span class="rel-leg-sw" style="height:0;width:14px;border-bottom:2px ${c.dash ? 'dashed' : 'solid'} ${c.color}"></span>`;
    else if (c.kind === 'point') sw = `<span class="rel-leg-sw" style="width:8px;height:8px;border-radius:50%;background:${c.color}"></span>`;
    else sw = `<span class="rel-leg-sw" style="width:13px;height:9px;background:${c.color}55;border:1px solid ${c.color}"></span>`;
    return `<span class="rel-leg-item">${sw}${_relEsc(c.label)}</span>`;
  }).join('');
}

// Inset de localização: contorno do Acre (SVG) + ponto do imóvel
let _acreOutline = null;
async function _carregarAcreOutline() {
  if (_acreOutline !== null) return _acreOutline;
  try { const r = await fetch('/data/acre_estado.geojson'); _acreOutline = await r.json(); }
  catch (e) { _acreOutline = false; }
  return _acreOutline;
}
function _insetAcreSVG(centroide) {
  const g = _acreOutline;
  if (!g || !centroide) return '';
  // bbox do Acre
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const rings = [];
  const coletar = geom => {
    const polys = geom.type === 'MultiPolygon' ? geom.coordinates : geom.type === 'Polygon' ? [geom.coordinates] : [];
    polys.forEach(poly => poly.forEach(ring => {
      rings.push(ring);
      ring.forEach(([x, y]) => { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; });
    }));
  };
  (g.features || []).forEach(f => f.geometry && coletar(f.geometry));
  if (!isFinite(minX)) return '';
  const W = 116, H = 78, pad = 4;
  const sx = (W - 2 * pad) / (maxX - minX), sy = (H - 2 * pad) / (maxY - minY);
  const s = Math.min(sx, sy);
  const px = x => pad + (x - minX) * s;
  const py = y => H - pad - (y - minY) * s; // inverte Y
  const polys = rings.map(ring => `<polygon points="${ring.map(([x, y]) => px(x).toFixed(1) + ',' + py(y).toFixed(1)).join(' ')}" fill="#dcfce7" stroke="#166534" stroke-width="0.7"/>`).join('');
  const cx = px(centroide[0]), cy = py(centroide[1]);
  return `<div class="rel-inset-tit">Localização no Acre</div>
    <svg viewBox="0 0 ${W} ${H}" width="100%" height="100%">${polys}
      <circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="3.2" fill="#dc2626" stroke="#fff" stroke-width="1"/>
    </svg>`;
}

// Legendas fiéis às camadas efetivamente desenhadas em cada mapa
const _LEG_LOC = [{ label: 'Imóvel (CAR)', color: '#dc2626', kind: 'fill' }];
const _LEG_DET = [
  { label: 'Limite do imóvel (CAR)', color: '#1F4E2C', kind: 'line', dash: true },
  { label: 'Desmat. autorizado',     color: '#16a34a', kind: 'fill' },
  { label: 'Desmat. irregular',      color: '#f97316', kind: 'fill' },
  { label: 'Desmat. ilegal/a verificar', color: '#dc2626', kind: 'fill' },
  { label: 'Acumulado pré-2008',     color: '#c2410c', kind: 'fill' },
];

// ── Motor de análise de camadas ───────────────────────────────────────────

// Detecta tema jurídico pelo nome da camada (regex case/acento-insensível)
function _temaCamada(nome) {
  const n = (nome || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  if (/nascente/.test(n))                                 return 'nascente';
  if (/curso|hidro|agua|rio|igarap|drenagem/.test(n))     return 'hidro';
  if (/\bapp\b/.test(n))                                  return 'app';
  if (/antropiz/.test(n))                                 return 'antropizado';
  if (/vegetac|floresta/.test(n))                         return 'vegetacao';
  return null;
}

// Alertas legais por tema
const _ALERTAS_TEMA = {
  nascente: 'APP de nascente (raio 50 m) — Art. 4º, IV, Lei 12.651/2012.',
  hidro:    'APP de curso d\'água (margem variável 30–500 m) — Art. 4º, I, Lei 12.651/2012.',
  app:      'Área de Preservação Permanente — Arts. 4º, 7º e 61-A, Lei 12.651/2012.',
};

// Retorna tipo geométrico predominante de uma FeatureCollection
function _tipoGeomCamada(geojson) {
  const feats = geojson?.features || [];
  for (const f of feats) {
    const t = f.geometry?.type || '';
    if (t === 'Point' || t === 'MultiPoint')                    return 'ponto';
    if (t === 'LineString' || t === 'MultiLineString')          return 'linha';
    if (t === 'Polygon' || t === 'MultiPolygon')                return 'poligono';
  }
  return 'poligono';
}

/**
 * Analisa camadas vetoriais contra um polígono de referência.
 * @param {object} poligonoFeature  – Feature GeoJSON do recorte (CAR ou UC)
 * @param {number} areaRefHa        – Área do recorte em ha
 * @param {Array}  camadasSel       – Itens do array global `camadas` selecionados
 * @returns {Array} [{nome, tipo, valor, unidade, pct, tema}]
 */
function _analisarCamadas(poligonoFeature, areaRefHa, camadasSel) {
  if (typeof turf === 'undefined' || !poligonoFeature?.geometry) return [];
  const resultados = [];
  const carBbox = (() => { try { return turf.bbox(poligonoFeature); } catch (_) { return null; } })();
  if (!carBbox) return [];

  for (const cam of (camadasSel || [])) {
    const gj = cam.geojson;
    if (!gj?.features?.length) continue;
    const tipo = _tipoGeomCamada(gj);
    const tema = _temaCamada(cam.nome);
    let valor = 0;

    try {
      if (tipo === 'ponto') {
        // Contagem de pontos dentro do polígono
        for (const f of gj.features) {
          if (!f.geometry) continue;
          const pts = f.geometry.type === 'MultiPoint' ? f.geometry.coordinates.map(c => turf.point(c)) : [f];
          for (const pt of pts) {
            try { if (turf.booleanPointInPolygon(pt, poligonoFeature)) valor++; } catch (_) {}
          }
        }
      } else if (tipo === 'linha') {
        // Comprimento de segmentos cujo midpoint está dentro do polígono
        for (const f of gj.features) {
          if (!f.geometry) continue;
          const linhas = f.geometry.type === 'MultiLineString'
            ? f.geometry.coordinates.map(c => turf.lineString(c))
            : [f];
          for (const linha of linhas) {
            try {
              // Verifica bbox rápido
              const lb = turf.bbox(linha);
              if (lb[2] < carBbox[0] || lb[0] > carBbox[2] || lb[3] < carBbox[1] || lb[1] > carBbox[3]) continue;
              const parts = turf.lineSplit(linha, poligonoFeature);
              for (const seg of (parts?.features || [])) {
                try {
                  const coords = seg.geometry?.coordinates || [];
                  if (coords.length < 2) continue;
                  const mid = coords[Math.floor(coords.length / 2)];
                  if (turf.booleanPointInPolygon(turf.point(mid), poligonoFeature)) {
                    valor += turf.length(seg, { units: 'kilometers' });
                  }
                } catch (_) {}
              }
            } catch (_) {}
          }
        }
      } else {
        // Polígono: interseção de área
        for (const f of gj.features) {
          if (!f.geometry) continue;
          try {
            const fb = turf.bbox(f);
            if (fb[2] < carBbox[0] || fb[0] > carBbox[2] || fb[3] < carBbox[1] || fb[1] > carBbox[3]) continue;
            const inter = turf.intersect(poligonoFeature, f);
            if (inter) valor += turf.area(inter) / 10000;
          } catch (_) {}
        }
      }
    } catch (_) {}

    const unidade = tipo === 'ponto' ? 'feições' : tipo === 'linha' ? 'km' : 'ha';
    const pct     = (tipo !== 'ponto' && areaRefHa > 0) ? valor / areaRefHa * 100 : null;
    resultados.push({ nome: cam.nome, cor: cam.cor || '#6b7280', tipo, valor, unidade, pct, tema });
  }
  return resultados;
}

// HTML da seção "Análise Ambiental por Camadas"
function _htmlSecaoCamadas(analise, tituloSecao) {
  if (!analise || !analise.length) return '';
  const n = tituloSecao || '2. Análise Ambiental por Camadas';
  const f2 = v => Number(v || 0).toLocaleString('pt-BR', { maximumFractionDigits: 2 });
  const f1 = v => Number(v || 0).toLocaleString('pt-BR', { maximumFractionDigits: 1 });
  const tipoLabel = t => t === 'ponto' ? 'Ponto' : t === 'linha' ? 'Linha' : 'Polígono';

  const linhas = analise.map(r => {
    const valStr = r.tipo === 'ponto' ? r.valor.toFixed(0) :
                   r.tipo === 'linha' ? f2(r.valor) + ' km' :
                                        f2(r.valor) + ' ha';
    const pctStr = r.pct != null ? f1(r.pct) + '%' : '—';
    return `<tr>
      <td><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:${_relEsc(r.cor)};margin-right:5px;vertical-align:middle"></span>${_relEsc(r.nome)}</td>
      <td>${tipoLabel(r.tipo)}</td>
      <td style="text-align:right">${valStr}</td>
      <td style="text-align:right">${pctStr}</td>
    </tr>`;
  }).join('');

  const alertas = [...new Set(analise.map(r => _ALERTAS_TEMA[r.tema]).filter(Boolean))];

  return `
  <div class="rel-secao">
    <div class="rel-secao-titulo">${_relEsc(n)}</div>
    <table class="rel-table rel-table-sm">
      <tr><th>Camada</th><th>Tipo</th><th>No recorte</th><th>% da área</th></tr>
      ${linhas}
    </table>
    ${alertas.length ? `
    <div style="margin-top:8px;padding:8px 10px;background:#fffbeb;border-left:3px solid #f59e0b;border-radius:0 6px 6px 0;font-size:8px;color:#78350f">
      <strong>Alertas legais:</strong><br>${alertas.map(a => '• ' + _relEsc(a)).join('<br>')}
    </div>` : ''}
  </div>`;
}

// ── Estado do modal ───────────────────────────────────────────────────────

let _relEscopo = 'atual';  // 'atual' | 'marcados' | 'uc'
let _relModo   = 'detalhado'; // 'sintetico' | 'detalhado'
let _relResponsavel = '__user__'; // '__user__' | índice na lista de responsáveis técnicos
let _relCamadasSel = null; // null = todas visíveis; Set de ids selecionados

// Resolve o responsável técnico escolhido (config) ou o usuário logado
function _resolverResponsavel(cab) {
  const lista = cab?.responsaveis || [];
  if (_relResponsavel !== '__user__' && lista.length) {
    const r = lista[parseInt(_relResponsavel, 10)] || lista[0];
    return { nome: r.nome || '', cargo: r.cargo || '', registro: r.registro || '', orgao: r.orgao || cab.siglaSecr || '', origem: 'tecnico' };
  }
  return {
    nome: appState.usuario?.nome_completo || appState.usuario?.email || 'Usuário',
    cargo: appState.perfil || '', registro: '', orgao: cab?.siglaSecr || '', origem: 'usuario',
  };
}
function _relSetResp(v) { _relResponsavel = v; }
async function _relPopularResponsaveis() {
  const sel = document.getElementById('rel-resp-sel');
  if (!sel) return;
  let cab; try { cab = await getCabecalhoRelatorio(); } catch (_) { return; }
  const u = appState.usuario?.nome_completo || appState.usuario?.email || 'Usuário';
  const opts = [`<option value="__user__">Usuário logado — ${_relEsc(u)}</option>`];
  (cab.responsaveis || []).forEach((r, i) => {
    opts.push(`<option value="${i}">${_relEsc(r.nome)}${r.cargo ? ' — ' + _relEsc(r.cargo) : ''}</option>`);
  });
  sel.innerHTML = opts.join('');
  // Padrão: primeiro responsável técnico cadastrado, se houver
  _relResponsavel = (cab.responsaveis || []).length ? '0' : '__user__';
  sel.value = _relResponsavel;
}

// Bloco de assinatura do responsável técnico
function _htmlAssinatura(cab) {
  const r = cab?.responsavel || {};
  const linha2 = [r.cargo, r.registro].filter(Boolean).join(' · ');
  return `<div class="rel-assinatura">
    <div class="rel-assin-linha"></div>
    <div class="rel-assin-nome">${_relEsc(r.nome || '—')}</div>
    ${linha2 ? `<div class="rel-assin-cargo">${_relEsc(linha2)}</div>` : ''}
    ${r.orgao ? `<div class="rel-assin-org">${_relEsc(r.orgao)}</div>` : ''}
  </div>`;
}

// ── Abrir modal de seleção ─────────────────────────────────────────────────

function abrirModalRelatorio() {
  try {
    if (!_carAbertoCod) {
      toast('Selecione um imóvel CAR no mapa antes de gerar o relatório.','warning');
      return;
    }

    const nMarcados = (_carMarcados instanceof Map) ? _carMarcados.size : 0;
    const dadosLocais = (_carDadosLocais instanceof Map) ? _carDadosLocais.get(_carAbertoCod) : null;
    const nomeImovel = _relEsc(
      dadosLocais?.nom_imovel ||
      _carAbertoFeat?.properties?.cod_imovel || _carAbertoCod
    );

    // UC real = _carUCAtual existe e NÃO começa com "Consulta:"
    const ucReal = _carUCAtual && !String(_carUCAtual).startsWith('Consulta:');

    // Camadas com GeoJSON disponível
    const camadasDisponiveis = (typeof camadas !== 'undefined' ? camadas : [])
      .filter(c => c.geojson?.features?.length);

    // HTML dos checkboxes de camadas
    const htmlCamadas = camadasDisponiveis.length
      ? camadasDisponiveis.map(c => {
          const checked = (!_relCamadasSel || _relCamadasSel.has(c.id)) ? 'checked' : '';
          const tipo = _tipoGeomCamada(c.geojson);
          const icTipo = tipo === 'ponto' ? '●' : tipo === 'linha' ? '━' : '▪';
          return `<label style="display:flex;align-items:center;gap:8px;padding:4px 0;font-size:12px;cursor:pointer">
            <input type="checkbox" id="rel-cam-${c.id}" ${checked} onchange="_relToggleCamada(${c.id})"
              style="accent-color:#52B788;width:14px;height:14px;cursor:pointer">
            <span style="width:12px;height:12px;border-radius:2px;background:${_relEsc(c.cor||'#6b7280')};flex-shrink:0"></span>
            <span>${_relEsc(c.nome)}</span>
            <span style="margin-left:auto;font-size:10px;color:#9ca3af">${icTipo} ${tipo}</span>
          </label>`;
        }).join('')
      : '<div style="font-size:11px;color:#9ca3af">Nenhuma camada vetorial carregada.</div>';

  // Remove modal anterior se existir
  document.getElementById('rel-modal-overlay')?.remove();

  const el = document.createElement('div');
  el.id = 'rel-modal-overlay';
  el.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9999;display:flex;align-items:center;justify-content:center;';
  el.innerHTML = `
  <div id="rel-modal" style="background:#fff;border-radius:12px;width:480px;max-width:95vw;max-height:92vh;overflow-y:auto;box-shadow:0 20px 60px rgba(0,0,0,.25);font-family:'DM Sans',system-ui,sans-serif;">
    <div class="rm-hdr" style="padding:16px 20px;background:linear-gradient(135deg,#0A1A0F,#1F4E2C);position:sticky;top:0;z-index:1">
      <h3 style="font-size:14px;font-weight:700;color:#fff;margin:0;">Gerar Relatório</h3>
      <p style="color:#86efac;font-size:11px;margin:2px 0 0">${nomeImovel} · ${_relEsc(_carAbertoCod)}</p>
    </div>
    <div class="rm-body">
      <div class="rm-label">Escopo do relatório</div>
      <div class="rm-opcao ativo" id="rel-esc-atual" onclick="_relSetEscopo('atual')">
        <span class="rm-ic">🏡</span>
        <div class="rm-tx"><h4>Imóvel atual</h4><p>Laudo apenas para este imóvel CAR.</p></div>
      </div>
      <div class="rm-opcao${nMarcados?'':' disabled'}" id="rel-esc-marc"
           style="${nMarcados?'':'opacity:.45;cursor:not-allowed'}"
           onclick="${nMarcados?"_relSetEscopo('marcados')":''}">
        <span class="rm-ic">📌</span>
        <div class="rm-tx">
          <h4>Todos os imóveis marcados</h4>
          <p>Laudo consolidado — cada imóvel vira uma seção com mapa próprio.</p>
        </div>
        ${nMarcados?`<span class="rm-badge">${nMarcados} marcado${nMarcados>1?'s':''}</span>`:'<span class="rm-badge" style="background:#f3f4f6;color:#9ca3af;border-color:#e5e7eb">0 marcados</span>'}
      </div>
      <div class="rm-opcao${ucReal?'':' disabled'}" id="rel-esc-uc"
           style="${ucReal?'':'opacity:.45;cursor:not-allowed'}"
           onclick="${ucReal?"_relSetEscopo('uc')":''}">
        <span class="rm-ic">🌿</span>
        <div class="rm-tx">
          <h4>Toda a UC selecionada</h4>
          <p>Laudo da unidade inteira — análise por camadas, imóveis sobrepostos e conclusão.</p>
        </div>
        ${ucReal?`<span class="rm-badge" style="background:#dcfce7;color:#166534;border-color:#86efac">${_relEsc(_carUCAtual||'')}</span>`:'<span class="rm-badge" style="background:#f3f4f6;color:#9ca3af;border-color:#e5e7eb">sem UC</span>'}
      </div>
      <hr class="rm-sep">
      <div class="rm-label">Camadas para análise ambiental</div>
      <div style="border:1px solid #e5e7eb;border-radius:8px;padding:8px 12px;max-height:140px;overflow-y:auto">
        ${htmlCamadas}
      </div>
      <div style="font-size:10px;color:#9ca3af;margin-top:4px">Camadas marcadas são analisadas (interseção/contagem) no recorte do relatório.</div>
      <hr class="rm-sep">
      <div class="rm-label">Nível de detalhamento</div>
      <div class="rm-modos">
        <div class="rm-modo" id="rel-modo-sint" onclick="_relSetModo('sintetico')">
          <div class="rm-mi">📋</div><h4>Sintético</h4>
          <p>1–2 páginas por imóvel. KPIs, mapas e conclusão.</p>
        </div>
        <div class="rm-modo ativo" id="rel-modo-det" onclick="_relSetModo('detalhado')">
          <div class="rm-mi">📑</div><h4>Detalhado</h4>
          <p>Laudo técnico completo com tabelas e narrativa jurídica.</p>
        </div>
      </div>
      <hr class="rm-sep">
      <div class="rm-label">Responsável técnico (assinatura)</div>
      <select id="rel-resp-sel" onchange="_relSetResp(this.value)" style="width:100%;padding:8px 10px;border:1px solid #e5e7eb;border-radius:8px;font-size:12px;font-family:inherit;background:#fff">
        <option value="__user__">Usuário logado</option>
      </select>
      <div style="font-size:10px;color:#9ca3af;margin-top:4px">Cadastre responsáveis em Configurações → Relatórios.</div>
    </div>
    <div class="rm-footer" style="position:sticky;bottom:0;background:#fff;border-top:1px solid #e5e7eb;padding:12px 20px;display:flex;gap:8px;justify-content:flex-end">
      <button class="btn btn-secondary" onclick="_fecharModalRelatorio()">Cancelar</button>
      <button class="btn btn-outline"   onclick="_abrirPreviewRelatorio()">Pré-visualizar</button>
      <button class="btn btn-primary"   onclick="_imprimirRelatorio()">Imprimir / PDF</button>
    </div>
  </div>`;
  document.body.appendChild(el);
  _relPopularResponsaveis();
  } catch(err) {
    console.error('[Relatório] Erro ao abrir modal:', err);
    toast('Erro ao abrir relatório: ' + err.message, 'error');
  }
}

function _fecharModalRelatorio() {
  document.getElementById('rel-modal-overlay')?.remove();
}

function _relSetEscopo(v) {
  _relEscopo = v;
  document.getElementById('rel-esc-atual')?.classList.toggle('ativo', v==='atual');
  document.getElementById('rel-esc-marc')?.classList.toggle('ativo', v==='marcados');
  document.getElementById('rel-esc-uc')?.classList.toggle('ativo', v==='uc');
}

function _relToggleCamada(id) {
  if (!_relCamadasSel) {
    // Inicializa com todas visíveis, depois desmarca a clicada
    const todas = (typeof camadas !== 'undefined' ? camadas : []).filter(c => c.geojson?.features?.length).map(c => c.id);
    _relCamadasSel = new Set(todas);
  }
  if (_relCamadasSel.has(id)) _relCamadasSel.delete(id); else _relCamadasSel.add(id);
  const cb = document.getElementById('rel-cam-' + id);
  if (cb) cb.checked = _relCamadasSel.has(id);
}

function _relCamadasSelecionadas() {
  const todas = (typeof camadas !== 'undefined' ? camadas : []).filter(c => c.geojson?.features?.length);
  if (!_relCamadasSel) return todas;
  return todas.filter(c => _relCamadasSel.has(c.id));
}

function _relSetModo(v) {
  _relModo = v;
  document.getElementById('rel-modo-sint')?.classList.toggle('ativo', v==='sintetico');
  document.getElementById('rel-modo-det')?.classList.toggle('ativo', v==='detalhado');
}

// ── Coleta imóveis para o relatório ───────────────────────────────────────

function _relColetarImoveis() {
  if (_relEscopo === 'marcados' && _carMarcados?.size) {
    // Imóveis marcados — usa features do layer CAR
    const cods = [..._carMarcados.keys()];
    return cods.map(cod => {
      const feat = _carFeatures?.find?.(f => f.properties?.cod_imovel === cod);
      return feat || null;
    }).filter(Boolean);
  }
  return _carAbertoFeat ? [_carAbertoFeat] : [];
}

// ── Monta dados de um imóvel (usa caches existentes) ─────────────────────

async function _montarDadosRelatorio(feat) {
  const p       = feat.properties || {};
  const cod     = p.cod_imovel;
  const rawLocal= _carDadosLocais?.get?.(cod);   // null/undefined se fora da planilha
  const local   = rawLocal || {};
  const naPlanilha = !!rawLocal;
  const pr      = _carProdesCache?.get?.(cod);
  const diag    = _carDiagCache?.get?.(cod);

  // Geometria / bbox
  let carPoly, bbox;
  try {
    carPoly = turf.feature(feat.geometry);
    const bb = turf.bbox(carPoly);
    bbox = [bb[0], bb[1], bb[2], bb[3]];
  } catch(e) { bbox = [-73,-11,-66,-7]; }

  // Área declarada — prioriza planilha SICAR, depois WFS, depois cálculo (ponto 1)
  let areaCAR, area_fonte;
  if (local.num_area_i != null && parseFloat(local.num_area_i) > 0) { areaCAR = parseFloat(local.num_area_i); area_fonte = 'SICAR (planilha)'; }
  else if (parseFloat(p.area) > 0)                                  { areaCAR = parseFloat(p.area);          area_fonte = 'SICAR (WFS)'; }
  else                                                             { areaCAR = carPoly ? turf.area(carPoly)/10000 : 0; area_fonte = 'Calculada (geometria)'; }

  const numModulo = parseFloat(local.num_modulo || p.num_modulo || 0);
  const pequenaProp = numModulo > 0 && numModulo <= 4;
  const totalGeral  = pr?.totalGeral || 0;
  const haConsol    = pr?.haConsolidado || 0;

  return {
    // Identificação
    cod_imovel:   cod,
    naPlanilha,                                      // ponto 6
    nom_imovel:   local.nom_imovel  || p.nome || cod,
    nome_compl:   local.nome_compl  || '',
    cpf_cnpj:     local.cpf_cnpj    || p.cpf_cnpj || '—',
    nom_munici:   local.nom_munici  || p.municipio || '—',
    ind_status:   _traduzStatusCAR(local.ind_status || p.condicao),  // ponto 5
    condicao_analise: local.condicao_i || '',        // condição de análise (legível)
    nome_class:   local.nome_class  || '—',
    num_modulo:   numModulo,
    dat_criaca:   _relDataBR(local.dat_criaca),      // ponto 5
    area_ha:      areaCAR,
    area_fonte,                                      // ponto 1
    pequenaPropriedade: pequenaProp,
    rlArt67:      pequenaProp,                        // ponto 2

    // PRODES (pode não estar carregado)
    totalGeral_ha:   totalGeral,
    haConsolidado:   haConsol,
    haPos2008:       Math.max(0, totalGeral - haConsol),  // ponto 3
    haAutorizado:    pr?.haAutorizado  || 0,
    haAVerificar:    (pr?.haAVerificar||0) + (pr?.haIrregular||0),
    anosAnual:       pr?.anosAnual     || [],
    porAno:          pr?.anual?.porAno || {},
    geojsonFeatAnual:pr?.anual?.geojsonFeatures || [],
    geojsonFeatHist: pr?.historico?.geojsonFeatures || [],
    exigenciaRL:     pequenaProp ? 0 : (pr?.exigenciaRL || areaCAR * 0.8),  // ponto 2
    florestaReman:   pr?.florestaRemanescente || Math.max(0, areaCAR - totalGeral),
    deficitRL:       pequenaProp ? 0 : (pr?.deficitRL || 0),                // ponto 2
    asvList:         pr?.asvList       || [],
    asvBase:         pr?.asvBase       || false,

    // Focos
    focosTotal:        pr?.focos?.total || 0,
    focosPorAno:       pr?.focos?.porAno || [],
    focosCorrelAnos:   pr?.focos?.correlacionados?.map?.(r=>r.ano) || [],
    focosMin:          pr?.focos?.anoMin,
    focosMax:          pr?.focos?.anoMax,

    // UC
    emUC:    diag?.emUC   || false,
    ucNome:  _carUCAtual  || null,
    areaUC:  diag?.areaUC || 0,

    // Análise de camadas vetoriais
    camadasAnalise: _analisarCamadas(carPoly, areaCAR, _relCamadasSelecionadas()),

    // Geometria
    geometry: feat.geometry,
    bbox,
    centroide: carPoly ? turf.centroid(carPoly).geometry.coordinates : [-70, -9.5],
    prodesCarregado: !!pr && !pr.erro,
  };
}

// ── Gera HTML de um mapa ABNT ─────────────────────────────────────────────

function _htmlMapaABNT({ id, titulo, altura, fonte, camadas, zona }) {
  const z = zona || 19;
  return `
  <div class="rel-mapa-wrap">
    <div class="rel-mapa-titulo">${_relEsc(titulo)}</div>
    <div id="${id}" class="rel-mapa-div" data-zona="${z}" style="height:${altura||240}px"></div>
    <div class="rel-mapa-rodape">
      <div class="rel-mapa-norte">${_SETA_NORTE}</div>
      <div class="rel-mapa-info"><strong>Escala</strong><span id="${id}__esc">—</span></div>
      <div class="rel-mapa-info"><strong>Sist. de Referência</strong>SIRGAS 2000<br>UTM ${z}S · EPSG:${_epsgUTM(z)}</div>
      <div class="rel-mapa-legenda">${_legendaHTML(camadas)}</div>
      <div class="rel-mapa-fonte">${_relEsc(fonte||'')}<br>Quadrícula UTM (km) · Emitido: ${_relData()}</div>
    </div>
  </div>`;
}

// ── Gera HTML completo do relatório ──────────────────────────────────────

async function _gerarHTMLRelatorio(imoveis, modo, cab, protocolo, dadosUC) {
  // Escopo UC — laudo da unidade inteira
  if (dadosUC) {
    const folhas = _htmlFolhasLaudoUC(dadosUC, cab, protocolo);
    return `<div id="rel-print-root"><link rel="stylesheet" href="../css/relatorio-print.css">${folhas.join('\n')}</div>`;
  }

  const folhas = [];

  // Mapa 0 (consolidado) se múltiplos imóveis
  const multi = imoveis.length > 1;
  let mapaConsolidadoId = null;
  if (multi) {
    mapaConsolidadoId = 'rel-mapa-consolidado';
    // Capa consolidada — primeira folha
    folhas.push(_htmlFolhaCapa(imoveis, cab, protocolo, modo, mapaConsolidadoId));
  }

  // Uma folha de análise por imóvel
  for (let i = 0; i < imoveis.length; i++) {
    const d = imoveis[i];
    if (modo === 'sintetico') {
      folhas.push(_htmlFolhaSintetica(d, cab, protocolo, i+1, imoveis.length, multi));
    } else {
      folhas.push(..._htmlFolhasDetalhadas(d, cab, protocolo, i+1, imoveis.length, multi));
    }
  }

  return `
  <div id="rel-print-root">
    <link rel="stylesheet" href="../css/relatorio-print.css">
    ${folhas.join('\n')}
  </div>`;
}

// ── Capa consolidada (múltiplos imóveis) ──────────────────────────────────

function _htmlFolhaCapa(imoveis, cab, protocolo, modo, mapaId) {
  const data = _relData();
  return `
  <div class="rel-a4">
    ${_htmlCabecalho(cab, protocolo, data)}
    <div class="rel-body">
      <div class="rel-titulo-bloco">
        <div class="rel-tipo-label">Laudo Técnico Consolidado — Imóveis CAR</div>
        <div class="rel-nome-imovel">${imoveis.length} Imóveis — ${_relEsc(imoveis[0]?.nom_munici||'Acre')}</div>
        <div class="rel-cod-imovel">Modo: ${modo==='sintetico'?'Sintético':'Detalhado'} · Gerado em ${data}</div>
      </div>
      <div class="rel-secao">
        <div class="rel-secao-titulo">Imóveis incluídos neste relatório</div>
        <table class="rel-table">
          <tr><th>#</th><th>Nome</th><th>Código CAR</th><th>Município</th><th>Área (ha)</th><th>SICAR</th></tr>
          ${imoveis.map((d,i)=>`<tr>
            <td>${i+1}</td>
            <td>${_relEsc(d.nom_imovel)}${!d.naPlanilha?' <span style="color:#d97706;font-size:7px">⚠ fora da planilha</span>':''}</td>
            <td style="font-family:monospace;font-size:8px">${_relEsc(d.cod_imovel)}</td>
            <td>${_relEsc(d.nom_munici)}</td>
            <td>${_relF2(d.area_ha)}</td>
            <td>${_badgeClassCAR?.(d.nome_class)||d.nome_class}</td>
          </tr>`).join('')}
        </table>
      </div>
      ${_htmlMapaABNT({ id: mapaId, titulo:'Mapa de Localização Geral — Todos os Imóveis', altura:320,
        zona:_zonaImovel(imoveis[0]), fonte:'SICAR/SFB · IBGE · OpenStreetMap',
        camadas:[{label:'Limite dos imóveis (CAR)', color:'#dc2626', kind:'line'}] })}
    </div>
    <div class="rel-pag-rodape">
      <span>${_relEsc(cab.secretaria)} · ${_relEsc(cab.siglaDiret)} · ${_relEsc(cab.siglaDep)}</span>
      <span>Pág. 1 · Prot. ${_relEsc(protocolo)}</span>
    </div>
  </div>`;
}

// ── Cabeçalho ABNT reutilizável ───────────────────────────────────────────

function _htmlCabecalho(cab, protocolo, data, mini=false) {
  if (mini) return `
  <div class="rel-cabecalho-mini">
    <span class="sec">${_relEsc(cab.siglaSecr)} · ${_relEsc(cab.siglaDiret)} · Laudo Técnico · Prot. ${_relEsc(protocolo)} · Pág.</span>
  </div>`;

  const logoGov  = cab.logoGoverno  ? `<img src="${cab.logoGoverno}"  alt="Logo Governo">` : '🌿';
  const logoSecr = cab.logoSecr     ? `<img src="${cab.logoSecr}"     alt="Logo Secretaria">` : '🏛';
  return `
  <div class="rel-cabecalho">
    <div class="rel-logo">${logoGov}</div>
    <div class="rel-inst">
      <div class="gov">${_relEsc(cab.governo)}${cab.gestao?' · '+cab.gestao:''}</div>
      <div class="sec">${_relEsc(cab.secretaria)} — ${_relEsc(cab.siglaSecr)}</div>
      <div class="dir">${_relEsc(cab.diretoria)} · ${_relEsc(cab.departamento)}</div>
    </div>
    <div class="rel-logo-secr-col">
      <div class="rel-logo">${logoSecr}</div>
      <div class="rel-meta">SIGUC-AC<br>Emitido: ${data}<br>Prot. nº ${_relEsc(protocolo)}</div>
    </div>
  </div>`;
}

// ── Badges auxiliares ─────────────────────────────────────────────────────

function _relBadgeSICAR(classe) {
  const map = {
    'Verde':          'background:#dcfce7;color:#166534;border-color:#86efac',
    'Amarelo':        'background:#fef9c3;color:#854d0e;border-color:#fde047',
    'Vermelho':       'background:#fee2e2;color:#991b1b;border-color:#fca5a5',
    'Não Classificado':'background:#f3f4f6;color:#6b7280;border-color:#e5e7eb',
  };
  const s = map[classe] || map['Não Classificado'];
  const emoji = classe==='Verde'?'🟢':classe==='Amarelo'?'🟡':classe==='Vermelho'?'🔴':'⚪';
  return `<span class="rel-badge" style="${s}">${emoji} ${_relEsc(classe)} — SICAR</span>`;
}

// ── Folha SINTÉTICA ───────────────────────────────────────────────────────

function _htmlFolhaSintetica(d, cab, protocolo, idx, total, multi) {
  const data = _relData();
  const mapLocId  = `rel-mapa-loc-${d.cod_imovel.replace(/\W/g,'_')}`;
  const mapDetId  = `rel-mapa-det-${d.cod_imovel.replace(/\W/g,'_')}`;
  const pctDesMat = _relPct(d.totalGeral_ha, d.area_ha);
  const pctIl     = _relPct(d.haAVerificar, d.area_ha);

  // Recomendação automática
  const rec = _gerarRecomendacao(d);

  return `
  <div class="rel-a4">
    ${multi ? _htmlCabecalho(cab, protocolo, data, true) : _htmlCabecalho(cab, protocolo, data)}
    <div class="rel-body">
      ${!multi?`
      <div class="rel-titulo-bloco">
        <div class="rel-tipo-label">Laudo Técnico de Análise Ambiental — CAR</div>
        <div class="rel-nome-imovel">${_relEsc(d.nom_imovel)}</div>
        <div class="rel-cod-imovel">${_relEsc(d.cod_imovel)} · ${_relEsc(d.nom_munici)}/AC · Bioma Amazônia</div>
        <div class="rel-badges">
          ${_relBadgeSICAR(d.nome_class)}
          ${d.pequenaPropriedade?`<span class="rel-badge" style="background:#f5f3ff;color:#6d28d9;border-color:#c4b5fd">⚖️ ${_relF1(d.num_modulo)} módulos fiscais</span>`:''}
        </div>
      </div>`:'<div style="font-weight:700;font-size:13px;padding:8px 0">'+(idx)+'. '+_relEsc(d.nom_imovel)+'</div>'}

      <!-- KPIs -->
      <div class="rel-kpi-grid">
        <div class="rel-kpi kpi-lrnj"><div class="kl">Área declarada</div><div class="kv">${_relF2(d.area_ha)}<span style="font-size:9px"> ha</span></div><div class="ks">Fonte: ${_relEsc(d.area_fonte)}</div></div>
        <div class="rel-kpi ${d.totalGeral_ha>0?'kpi-verm':'kpi-verde'}"><div class="kl">Supressão total detectada</div><div class="kv">${_relF2(d.totalGeral_ha)}<span style="font-size:9px"> ha</span></div><div class="ks">PRODES/INPE · ${pctDesMat}% · inclui consolidado</div></div>
        <div class="rel-kpi ${d.rlArt67||d.deficitRL<=0?'kpi-verde':'kpi-verm'}"><div class="kl">Déficit Reserva Legal</div><div class="kv">${d.rlArt67?'N/A':_relF2(d.deficitRL)}<span style="font-size:9px">${d.rlArt67?'':' ha'}</span></div><div class="ks">${d.rlArt67?'Art. 67 — pequena propr.':'Exig. 80% = '+_relF2(d.exigenciaRL)+' ha'}</div></div>
        <div class="rel-kpi ${d.focosTotal>0?'kpi-lrnj':'kpi-verde'}"><div class="kl">Focos de calor</div><div class="kv">${d.focosTotal}</div><div class="ks">${d.focosMin&&d.focosMax?d.focosMin+'–'+d.focosMax:'—'}</div></div>
      </div>
      <!-- Conformidade -->
      <div class="rel-conf-grid">
        <div class="rel-conf conf-cons"><div class="cl">🟡 Consolidado pré-2008</div><div class="cv">${_relF2(d.haConsolidado)} ha</div><div class="cs">Art. 61-A CF · ${_relPct(d.haConsolidado,d.totalGeral_ha)}%</div></div>
        <div class="rel-conf conf-aut" ><div class="cl">✅ Autorizado (ASV)</div><div class="cv">${_relF2(d.haAutorizado)} ha</div><div class="cs">Arts. 26-27 CF · ${_relPct(d.haAutorizado,d.totalGeral_ha)}%</div></div>
        <div class="rel-conf conf-il"  ><div class="cl">${d.asvBase?'🔴 A verificar / Ilegal':'🟠 A verificar'}</div><div class="cv">${_relF2(d.haAVerificar)} ha</div><div class="cs">${d.asvBase?'Art. 38 CF':'Base ASV indisp.'} · ${_relPct(d.haAVerificar,d.totalGeral_ha)}%</div></div>
      </div>

      <!-- Mapas lado a lado -->
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        ${_htmlMapaABNT({ id: mapLocId, titulo:'Mapa 1 — Localização Regional', altura:200,
          zona:_zonaImovel(d), fonte:'IBGE · OpenStreetMap · SICAR/SFB', camadas:_LEG_LOC })}
        ${_htmlMapaABNT({ id: mapDetId, titulo:'Mapa 2 — Detalhe do Imóvel', altura:200,
          zona:_zonaImovel(d), fonte:'PRODES/INPE · SICAR/SFB', camadas:_LEG_DET })}
      </div>

      <!-- Recomendação -->
      <div class="rel-secao">
        <div class="rel-secao-titulo">Recomendação</div>
        <div class="rel-narrativa" style="font-size:10px">${rec}</div>
        <div class="rel-refs"><strong>Base legal:</strong> Arts. 12/I · 26 · 38 · 61-A · 66 · 67 · 78-A — Lei nº 12.651/2012</div>
      </div>
      ${_htmlAssinatura(cab)}
    </div>
    <div class="rel-pag-rodape">
      <span>${_relEsc(cab.secretaria)} · ${_relEsc(cab.siglaDiret)} · ${_relEsc(cab.siglaDep)}</span>
      <span>Pág. ${multi?idx+1:1}${total>1?' · Imóvel '+idx+'/'+total:''} · Prot. ${_relEsc(protocolo)}</span>
    </div>
  </div>`;
}

// ── Folhas DETALHADAS (retorna array de strings) ───────────────────────────

function _htmlFolhasDetalhadas(d, cab, protocolo, idx, total, multi) {
  const data    = _relData();
  const mapLocId = `rel-mapa-loc-${d.cod_imovel.replace(/\W/g,'_')}`;
  const mapDetId = `rel-mapa-det-${d.cod_imovel.replace(/\W/g,'_')}`;
  const pag = (n) => `Pág. ${multi?idx+n:n}${total>1?' · Imóvel '+idx+'/'+total:''} · Prot. ${_relEsc(protocolo)}`;

  // Legenda do Mapa 2 inclui as camadas do usuário
  const legDet2 = [..._LEG_DET];
  for (const r of (d.camadasAnalise || [])) {
    if (r.valor > 0) {
      const tipo = r.tipo === 'ponto' ? 'point' : r.tipo === 'linha' ? 'line' : 'fill';
      legDet2.push({ label: r.nome, color: r.cor, kind: tipo });
    }
  }

  // ── FOLHA 1: Capa, identificação, mapa de localização ──────────────────
  const f1 = `
  <div class="rel-a4">
    ${_htmlCabecalho(cab, protocolo, data)}
    <div class="rel-body">
      <div class="rel-titulo-bloco">
        <div class="rel-tipo-label">Laudo Técnico de Análise Ambiental — CAR</div>
        <div class="rel-nome-imovel">${_relEsc(d.nom_imovel)}</div>
        <div class="rel-cod-imovel">${_relEsc(d.cod_imovel)} · ${_relEsc(d.nom_munici)}/AC · Bioma Amazônia</div>
        <div class="rel-badges">
          ${_relBadgeSICAR(d.nome_class)}
          ${d.emUC?`<span class="rel-badge" style="background:#fef9c3;color:#854d0e;border-color:#fde047">⚠️ Sobreposição com UC</span>`:''}
          ${d.pequenaPropriedade?`<span class="rel-badge" style="background:#f5f3ff;color:#6d28d9;border-color:#c4b5fd">⚖️ ${_relF1(d.num_modulo)} módulos fiscais</span>`:''}
          ${!d.prodesCarregado?`<span class="rel-badge" style="background:#fef2f2;color:#991b1b;border-color:#fca5a5">⚠️ Dados PRODES não carregados</span>`:''}
        </div>
      </div>

      <div class="rel-kpi-grid">
        <div class="rel-kpi kpi-lrnj"><div class="kl">Área declarada</div><div class="kv">${_relF2(d.area_ha)}<span style="font-size:9px"> ha</span></div><div class="ks">${_relEsc(d.area_fonte)}</div></div>
        <div class="rel-kpi ${d.totalGeral_ha>0?'kpi-verm':'kpi-verde'}"><div class="kl">Supressão total detectada</div><div class="kv">${_relF2(d.totalGeral_ha)}<span style="font-size:9px"> ha</span></div><div class="ks">PRODES/INPE · ${_relPct(d.totalGeral_ha,d.area_ha)}% · inclui consolidado</div></div>
        <div class="rel-kpi ${d.rlArt67||d.deficitRL<=0?'kpi-verde':'kpi-verm'}"><div class="kl">Déficit Reserva Legal</div><div class="kv">${d.rlArt67?'N/A':_relF2(d.deficitRL)}<span style="font-size:9px">${d.rlArt67?'':' ha'}</span></div><div class="ks">${d.rlArt67?'Art. 67 — pequena propr.':'Exig. 80% = '+_relF2(d.exigenciaRL)+' ha'}</div></div>
        <div class="rel-kpi ${d.focosTotal>0?'kpi-lrnj':'kpi-verde'}"><div class="kl">Focos de calor</div><div class="kv">${d.focosTotal}</div><div class="ks">${d.focosMin&&d.focosMax?d.focosMin+'–'+d.focosMax:'—'}</div></div>
      </div>
      <div class="rel-conf-grid">
        <div class="rel-conf conf-cons"><div class="cl">🟡 Consolidado pré-2008</div><div class="cv">${_relF2(d.haConsolidado)} ha</div><div class="cs">Art. 61-A CF</div></div>
        <div class="rel-conf conf-aut"><div class="cl">✅ Autorizado (ASV)</div><div class="cv">${_relF2(d.haAutorizado)} ha</div><div class="cs">Arts. 26-27 CF</div></div>
        <div class="rel-conf conf-il"><div class="cl">${d.asvBase?'🔴 A verificar / Ilegal':'🟠 A verificar'}</div><div class="cv">${_relF2(d.haAVerificar)} ha</div><div class="cs">${d.asvBase?'Art. 38 CF':'Base ASV indisp.'}</div></div>
      </div>

      <div class="rel-secao">
        <div class="rel-secao-titulo">1. Identificação do Imóvel</div>
        <table class="rel-table">
          <tr><td>Código CAR</td><td style="font-family:monospace;font-size:9px">${_relEsc(d.cod_imovel)}</td></tr>
          <tr><td>Nome do Imóvel</td><td>${_relEsc(d.nom_imovel)}</td></tr>
          ${d.nome_compl?`<tr><td>Proprietário</td><td>${_relEsc(d.nome_compl)}</td></tr>`:''}
          <tr><td>CPF/CNPJ</td><td>${_relEsc(d.cpf_cnpj)}</td></tr>
          <tr><td>Município</td><td>${_relEsc(d.nom_munici)} — Acre</td></tr>
          <tr><td>Área declarada</td><td>${_relF2(d.area_ha)} ha <span style="color:#9ca3af">(${_relEsc(d.area_fonte)})</span></td></tr>
          <tr><td>Módulos fiscais</td><td>${d.num_modulo>0?_relF1(d.num_modulo)+' módulos'+(d.pequenaPropriedade?' (pequena propriedade — Art. 67 CF)':''):'—'}</td></tr>
          <tr><td>Situação CAR</td><td>${_relEsc(d.ind_status)}</td></tr>
          ${d.condicao_analise?`<tr><td>Condição (análise)</td><td>${_relEsc(d.condicao_analise)}</td></tr>`:''}
          <tr><td>Classificação SICAR</td><td>${d.nome_class==='Vermelho'?'<strong style="color:#dc2626">🔴 Vermelho — Art. 78-A CF aplicável</strong>':_relEsc(d.nome_class)}</td></tr>
          ${d.dat_criaca&&d.dat_criaca!=='—'?`<tr><td>Data de cadastro</td><td>${_relEsc(d.dat_criaca)}</td></tr>`:''}
          ${!d.naPlanilha?`<tr><td>Cadastro local</td><td><strong style="color:#d97706">⚠️ Imóvel não consta na planilha SICAR local — proprietário e CPF/CNPJ não disponíveis</strong></td></tr>`:''}
          ${d.emUC?`<tr><td>Sobreposição com UC</td><td><strong style="color:#d97706">⚠️ ${_relEsc(d.ucNome||'UC do Acre')} — ${_relF2(d.areaUC)} ha sobrepostos</strong></td></tr>`:''}
        </table>
      </div>

      <div class="rel-secao">
        <div class="rel-secao-subtitulo">Mapa 1 — Localização Regional</div>
        ${_htmlMapaABNT({ id: mapLocId, titulo:'Mapa de Localização — Estado do Acre · '+d.nom_munici, altura:230,
          zona:_zonaImovel(d), fonte:'IBGE · OpenStreetMap · SICAR/SFB · Elaborado: SIGUC-AC/SEMA-AC',
          camadas:_LEG_LOC })}
      </div>
    </div>
    <div class="rel-pag-rodape">
      <span>${_relEsc(cab.secretaria)} · ${_relEsc(cab.siglaDiret)} · ${_relEsc(cab.siglaDep)}</span>
      <span>${pag(1)}</span>
    </div>
  </div>`;

  // ── FOLHA 2: Mapa detalhe + PRODES + Focos + ASV ─────────────────────
  const maxProdes = Math.max(...Object.values(d.porAno), 0.01);
  const barrasProdes = d.anosAnual.map(ano => {
    const ha  = d.porAno[ano] || 0;
    const pct = Math.round(ha/maxProdes*100);
    const clf = d.geojsonFeatAnual.find(f=>f.properties?.ano===ano)?.properties?.clf;
    const cor = clf?.cor || '#dc2626';
    const ico = clf?.tipo==='autorizado'?'✅':clf?.tipo==='irregular'?'🟠':'🔴';
    return `<div class="rel-barra-row">
      <span class="rel-barra-ano">${ano}</span>
      <div class="rel-barra-bg"><div class="rel-barra-fill" style="width:${pct}%;background:${cor}"></div></div>
      <span class="rel-barra-val">${_relF2(ha)} ha</span>
      <span class="rel-barra-clf">${ico}</span>
    </div>`;
  }).join('');

  const maxFocos = Math.max(...d.focosPorAno.map(r=>r.total), 1);
  const barrasFocos = d.focosPorAno.map(r => {
    const pct = Math.round(r.total/maxFocos*100);
    const corr = d.focosCorrelAnos.includes(r.ano);
    return `<div class="rel-barra-row">
      <span class="rel-barra-ano">${r.ano}</span>
      <div class="rel-barra-bg"><div class="rel-barra-fill" style="width:${pct}%;background:#f97316"></div></div>
      <span class="rel-barra-val">${r.total}</span>
      <span class="rel-barra-clf">${corr?'⚠️':''}</span>
    </div>`;
  }).join('');

  const f2 = `
  <div class="rel-a4">
    ${_htmlCabecalho(cab, protocolo, data, true)}
    <div class="rel-body">
      <div class="rel-secao">
        <div class="rel-secao-subtitulo">Mapa 2 — Detalhe do Imóvel com Camadas Temáticas</div>
        ${_htmlMapaABNT({ id: mapDetId, titulo:'Mapa Temático — Desmatamento PRODES · Imóvel CAR', altura:280,
          zona:_zonaImovel(d), fonte:'PRODES/INPE · SICAR/SFB · Elaborado: SIGUC-AC', camadas:legDet2 })}
      </div>

      <div class="rel-secao">
        <div class="rel-secao-titulo">3. Análise de Desmatamento — PRODES/INPE</div>
        ${d.prodesCarregado ? `
        <div style="font-size:8px;color:#9ca3af;margin-bottom:6px">✅ autorizado · 🟠 irregular · 🔴 ${d.asvBase?'ilegal/a verificar':'a verificar'} · ⚠️ foco de calor no mesmo ano</div>
        <div class="rel-barras">${barrasProdes||'<div style="font-size:9px;color:#9ca3af">Nenhum polígono PRODES detectado.</div>'}</div>
        <table class="rel-table rel-table-sm" style="margin-top:8px">
          <tr><th>Categoria</th><th>Área (ha)</th><th>% da área</th><th>Base legal</th></tr>
          <tr><td>Acumulado pré-2008 (consolidado)</td><td>${_relF2(d.haConsolidado)}</td><td>${_relPct(d.haConsolidado,d.area_ha)}%</td><td>Art. 61-A CF</td></tr>
          <tr><td>Autorizado por ASV (pós-2008)</td><td>${_relF2(d.haAutorizado)}</td><td>${_relPct(d.haAutorizado,d.area_ha)}%</td><td>Arts. 26-27 CF</td></tr>
          <tr><td>${d.asvBase?'A verificar / Ilegal (pós-2008)':'A verificar — sem base ASV (pós-2008)'}</td><td>${_relF2(d.haAVerificar)}</td><td>${_relPct(d.haAVerificar,d.area_ha)}%</td><td>${d.asvBase?'Art. 38 CF':'—'}</td></tr>
          <tr style="background:#fafafa"><td><em>Subtotal pós-2008</em></td><td><em>${_relF2(d.haPos2008)}</em></td><td><em>${_relPct(d.haPos2008,d.area_ha)}%</em></td><td><em>Arts. 26-38 CF</em></td></tr>
          <tr><td><strong>Supressão total detectada</strong></td><td><strong>${_relF2(d.totalGeral_ha)}</strong></td><td><strong>${_relPct(d.totalGeral_ha,d.area_ha)}%</strong></td><td>—</td></tr>
        </table>
        <div style="font-size:7px;color:#9ca3af;margin-top:3px">Obs.: a supressão total inclui a área consolidada pré-2008 (regularizável — Art. 61-A); somente a parcela pós-2008 sem ASV configura potencial infração.${d.asvBase?'':' Base de ASV (SINAFLOR) indisponível — parcela classificada como "a verificar".'}</div>`:`<div style="font-size:10px;color:#9ca3af;padding:8px 0">⚠️ Dados PRODES não carregados — acesse a aba 🌳 PRODES antes de gerar o relatório.</div>`}
      </div>

      <div class="rel-secao">
        <div class="rel-secao-titulo">4. Focos de Calor — BDQueimadas/INPE · FIRMS/NASA</div>
        ${d.focosPorAno.length ? `
        <div style="font-size:8px;color:#9ca3af;margin-bottom:5px">⚠️ = correlação temporal com desmatamento PRODES no mesmo ano</div>
        <div class="rel-barras">${barrasFocos}</div>`
        :`<div style="font-size:10px;color:#9ca3af;padding:8px 0">Nenhum foco de calor registrado na base atual para este imóvel.</div>`}
      </div>

      <div class="rel-secao">
        <div class="rel-secao-titulo">5. Autorizações de Supressão — SINAFLOR/IBAMA</div>
        ${d.asvList.length ? `
        <table class="rel-table rel-table-sm">
          <tr><th>Nº ASV</th><th>Emissão</th><th>Validade</th><th>Área (ha)</th><th>Tipo</th><th>Status</th></tr>
          ${d.asvList.map(a=>`<tr>
            <td style="font-family:monospace">${_relEsc(a.num_asv||'—')}</td>
            <td>${a.data_emissao?new Date(a.data_emissao).toLocaleDateString('pt-BR'):'—'}</td>
            <td>${a.data_validade?new Date(a.data_validade).toLocaleDateString('pt-BR'):'—'}</td>
            <td>${_relF2(a.area_ha)}</td>
            <td>${_relEsc(a.tipo_supressao||'—')}</td>
            <td><span class="asv-badge asv-${a.status||'vigente'}">${_relEsc(a.status||'vigente')}</span></td>
          </tr>`).join('')}
        </table>`
        :`<div style="font-size:10px;color:#9ca3af;padding:8px 0">${d.asvBase?'Nenhuma ASV localizada para este imóvel.':'⚠️ Base SINAFLOR não carregada — verificar IBAMA/SEMA-AC.'}</div>`}
        <div style="font-size:7px;color:#9ca3af;margin-top:4px">Fonte: IBAMA Dados Abertos · Atualizado: ${_relData()}</div>
      </div>

      ${_htmlSecaoCamadas(d.camadasAnalise, '2. Análise Ambiental por Camadas Vetoriais')}
    </div>
    <div class="rel-pag-rodape">
      <span>${_relEsc(cab.secretaria)} · ${_relEsc(cab.siglaDiret)} · ${_relEsc(cab.siglaDep)}</span>
      <span>${pag(2)}</span>
    </div>
  </div>`;

  // ── FOLHA 3: Reserva Legal + Narrativa + Conclusão ─────────────────────
  const narrativa = _gerarNarrativaJuridica(d);
  const rec       = _gerarRecomendacao(d);
  const pctRL     = (d.exigenciaRL > 0 && d.florestaReman > 0) ? Math.min(100, Math.round(d.florestaReman / d.exigenciaRL * 100)) : 0;

  const f3 = `
  <div class="rel-a4">
    ${_htmlCabecalho(cab, protocolo, data, true)}
    <div class="rel-body">
      <div class="rel-secao">
        <div class="rel-secao-titulo">6. Reserva Legal — Art. 12, I · Lei 12.651/2012</div>
        ${d.rlArt67 ? `
        <div style="font-size:9px;color:#6b7280;margin-bottom:8px">Pequena propriedade rural (${_relF1(d.num_modulo)} módulos fiscais ≤ 4). Pelo <strong>Art. 67 da Lei 12.651/2012</strong>, a Reserva Legal corresponde à vegetação nativa existente em 22/07/2008, <strong>sem exigência de recomposição</strong> — não se aplica o percentual de 80%.</div>
        <table class="rel-table" style="margin-bottom:10px">
          <tr><td>Área total declarada</td><td><strong>${_relF2(d.area_ha)} ha</strong></td></tr>
          <tr><td>Supressão total detectada (PRODES)</td><td><strong style="color:#dc2626">${_relF2(d.totalGeral_ha)} ha</strong></td></tr>
          <tr><td>Floresta remanescente (estimada)</td><td><strong style="color:#16a34a">${_relF2(d.florestaReman)} ha</strong></td></tr>
          <tr><td>Exigência de recomposição</td><td><strong style="color:#16a34a">Não aplicável (Art. 67 CF)</strong></td></tr>
        </table>` : `
        <div style="font-size:9px;color:#6b7280;margin-bottom:8px">Amazônia: exigência de 80% da área total cadastrada (Art. 12, I).</div>
        <table class="rel-table" style="margin-bottom:10px">
          <tr><td>Área total declarada</td><td><strong>${_relF2(d.area_ha)} ha</strong></td></tr>
          <tr><td>Exigência de Reserva Legal (80%)</td><td><strong>${_relF2(d.exigenciaRL)} ha</strong></td></tr>
          <tr><td>Supressão total detectada</td><td><strong style="color:#dc2626">${_relF2(d.totalGeral_ha)} ha</strong></td></tr>
          <tr><td>Floresta remanescente (estimada)</td><td><strong style="color:#16a34a">${_relF2(d.florestaReman)} ha</strong></td></tr>
          <tr><td>Déficit de Reserva Legal</td><td><strong style="${d.deficitRL>0?'color:#dc2626':'color:#16a34a'}">${_relF2(d.deficitRL)} ha${d.deficitRL<=0?' (sem déficit)':''}</strong></td></tr>
        </table>
        <div style="font-size:8px;color:#6b7280;margin-bottom:3px">Cobertura remanescente estimada vs. exigência legal (${pctRL}%):</div>
        <div class="rel-rl-barra">
          <div class="rel-rl-fill" style="width:${pctRL}%"></div>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:7px;color:#9ca3af">
          <span>Remanescente: ${_relF2(d.florestaReman)} ha</span>
          ${d.deficitRL>0?`<span style="color:#dc2626">Déficit: ${_relF2(d.deficitRL)} ha</span>`:'<span style="color:#16a34a">✅ Sem déficit</span>'}
        </div>`}
      </div>

      <div class="rel-secao">
        <div class="rel-secao-titulo">7. Análise de Conformidade — Lei 12.651/2012</div>
        <div class="rel-narrativa">${narrativa}</div>
        <div class="rel-refs">
          <strong>Referências legais:</strong> Art. 3/II (APP) · Art. 3/III (Reserva Legal) · Art. 12/I (RL 80% Amazônia) · Art. 26 (vedação supressão sem autorização) · Art. 38 (crime de desmatamento ilegal) · Art. 61-A (áreas consolidadas — corte 22/07/2008) · Art. 66 (obrigação de recomposição de RL) · Art. 67 (pequenas propriedades — ≤4 módulos fiscais) · Art. 78-A (restrição de crédito para imóveis irregulares) — Lei nº 12.651, de 25 de maio de 2012
        </div>
      </div>

      <div class="rel-secao">
        <div class="rel-secao-titulo">8. Conclusão e Recomendação</div>
        <table class="rel-table rel-table-sm">
          <tr><th colspan="2" style="background:${d.haAVerificar>0&&d.asvBase?'#991b1b':d.haAVerificar>0||d.deficitRL>0?'#92400e':'#166534'}">
            ${d.haAVerificar>0&&d.asvBase?'Situação de Não Conformidade — Ação Recomendada':d.haAVerificar>0?'Pendente de Verificação — confirmar ASV (SINAFLOR)':d.deficitRL>0?'Regularização Pendente':'Situação Regular'}
          </th></tr>
          <tr><td>Prioridade</td><td>${d.haAVerificar>0&&d.asvBase&&d.focosCorrelAnos.length?'🔴 Alta':d.haAVerificar>0?'🟡 Média':'🟢 Baixa'}</td></tr>
          <tr><td>Recomendação</td><td>${rec}</td></tr>
          ${d.nome_class==='Vermelho'?`<tr><td>Crédito rural</td><td>Art. 78-A CF: restrição aplicável até regularização</td></tr>`:''}
        </table>
      </div>

      ${_htmlAssinatura(cab)}

      <div class="rel-aviso">
        Documento emitido pelo SIGUC-AC em ${data} · operado por ${_relEsc(appState.usuario?.nome_completo||appState.usuario?.email||'Usuário')} (${_relEsc(appState.perfil||'—')}).<br>
        ${_relEsc(cab.rodapeTxt||'')} As análises são baseadas em dados de sensoriamento remoto com margem de erro de 5–15%.<br>
        ${_relEsc(cab.secretaria)} · ${_relEsc(cab.siglaDiret)} · ${_relEsc(cab.siglaDep)} · ${_relEsc(cab.telefone)} · ${_relEsc(cab.email)} · ${_relEsc(cab.site)}
      </div>
    </div>
    <div class="rel-pag-rodape">
      <span>${_relEsc(cab.secretaria)} · ${_relEsc(cab.siglaDiret)} · ${_relEsc(cab.siglaDep)}</span>
      <span>${pag(3)}</span>
    </div>
  </div>`;

  return [f1, f2, f3];
}

// ── Narrativa jurídica automática ─────────────────────────────────────────

function _gerarNarrativaJuridica(d) {
  const nome = `<strong>${_relEsc(d.nom_imovel)}</strong>`;
  const total = `<strong>${_relF2(d.totalGeral_ha)} ha</strong>`;
  const cons  = `<strong>${_relF2(d.haConsolidado)} ha</strong>`;
  const pos   = `<strong>${_relF2(d.totalGeral_ha - d.haConsolidado)} ha</strong>`;
  const aut   = `<strong>${_relF2(d.haAutorizado)} ha</strong>`;
  const il    = `<strong>${_relF2(d.haAVerificar)} ha</strong>`;
  const nFoc  = d.focosTotal;
  const nCorr = d.focosCorrelAnos.length;

  let sinaf = d.asvBase
    ? `Dos ${pos} suprimidos após 2008, ${aut} possuem ASV vigente no SINAFLOR (Arts. 26-27, Lei 12.651/2012)${d.haAVerificar>0?` e ${il} não possuem autorização localizada`:'.'}`
    : `Dos ${pos} suprimidos após 2008, nenhuma autorização de supressão (ASV) foi localizada na base local — situação a verificar junto ao IBAMA/SEMA-AC (Arts. 26-27, Lei 12.651/2012).`;

  let focoTxt = nFoc > 0
    ? `Foram detectados <strong>${nFoc}</strong> focos de calor dentro do imóvel${d.focosMin?` entre ${d.focosMin} e ${d.focosMax}`:''}${nCorr>0?`, com <strong>correlação temporal em ${nCorr} ano(s)</strong> com polígonos de desmatamento PRODES — indício de incêndio associado a supressão ${d.asvBase?'ilegal':'a verificar'}`:'.'}`
    : 'Não foram detectados focos de calor históricos dentro do imóvel na base atual.';

  let rlTxt = d.rlArt67
    ? `Por se tratar de pequena propriedade rural (≤4 módulos fiscais), aplica-se o <strong>Art. 67 da Lei 12.651/2012</strong>: a Reserva Legal corresponde à vegetação nativa existente em 22/07/2008, sem exigência de recomposição.`
    : d.deficitRL > 0
      ? `O imóvel apresenta <strong>déficit estimado de Reserva Legal de ${_relF2(d.deficitRL)} ha</strong> (exigência: 80% = ${_relF2(d.exigenciaRL)} ha — Art. 12, I, CF).`
      : `A cobertura remanescente estimada atende à exigência de Reserva Legal de 80% (Art. 12, I, CF).`;

  let sicarTxt = d.nome_class === 'Vermelho'
    ? `O imóvel está classificado como <strong>Vermelho</strong> no SICAR — <strong>Art. 78-A CF: restrição de crédito rural aplicável</strong>.`
    : `O imóvel está classificado como <strong>${_relEsc(d.nome_class)}</strong> no SICAR.`;

  return `${nome} (${_relEsc(d.cod_imovel)}) possui ${total} de desmatamento detectado pelo PRODES/INPE. Desses, ${cons} foram suprimidos antes de 22/07/2008 (área consolidada — Art. 61-A, Lei 12.651/2012). ${sinaf}<br><br>${focoTxt}<br><br>${sicarTxt} ${rlTxt}`;
}

function _gerarRecomendacao(d) {
  if (!d.prodesCarregado) return 'Carregar dados PRODES antes de gerar o relatório para análise completa.';
  if (d.totalGeral_ha === 0) return 'Imóvel sem registro de desmatamento no PRODES — manter monitoramento periódico.';
  if (d.haAVerificar > 0 && d.focosCorrelAnos.length > 0)
    return d.asvBase
      ? `Instaurar procedimento administrativo — desmatamento ilegal correlacionado com focos de calor (Arts. 38 e 50 CF). Verificar necessidade de embargo e PRA (Arts. 59-68 CF)${d.nome_class==='Vermelho'?' · Restrição de crédito rural (Art. 78-A CF)':''}.`
      : `Priorizar verificação de ASV no SINAFLOR e fiscalização in loco — supressão pós-2008 correlacionada com focos de calor (a confirmar). Avaliar embargo/PRA (Arts. 59-68 CF)${d.nome_class==='Vermelho'?' · Art. 78-A CF':''}.`;
  if (d.haAVerificar > 0)
    return `Verificar ASVs vigentes no SINAFLOR${d.asvBase?'':' (base local vazia)'}. Desmatamento pós-2008 sem autorização configura infração (Art. 38 CF). Avaliar PRA (Arts. 59-68 CF).`;
  if (d.deficitRL > 0 && !d.pequenaPropriedade)
    return `Déficit de Reserva Legal de ${_relF2(d.deficitRL)} ha — recomposição obrigatória (Art. 66 CF).`;
  if (d.nome_class === 'Vermelho')
    return 'Imóvel Vermelho no SICAR — regularização obrigatória para acesso ao crédito rural (Art. 78-A CF). Orientar adesão ao PRA.';
  return 'Regularização em andamento. Monitorar prazo de adesão ao PRA e recomposição de Reserva Legal.';
}

// ── Laudo de UC ───────────────────────────────────────────────────────────

let _ucDetalhesCache = null;
async function _carregarUCDetalhes() {
  if (_ucDetalhesCache !== null) return _ucDetalhesCache;
  try { const r = await fetch('/data/uc_detalhes.json'); _ucDetalhesCache = await r.json(); }
  catch (_) { _ucDetalhesCache = {}; }
  return _ucDetalhesCache;
}

async function _montarDadosLaudoUC(ucNome) {
  const ucFeat = (_ucGeojson?.features || []).find(f => f.properties?.nome === ucNome);
  if (!ucFeat) return null;

  const p = ucFeat.properties || {};
  const detalhes = await _carregarUCDetalhes();
  const det = detalhes[ucNome] || {};

  let areaHa = det.area_ha || 0;
  if (!areaHa) { try { areaHa = turf.area(ucFeat) / 10000; } catch (_) {} }

  let bbox;
  try { const bb = turf.bbox(ucFeat); bbox = [bb[0], bb[1], bb[2], bb[3]]; }
  catch (_) { bbox = [-73, -11, -66, -7]; }

  let centroide = [-70, -9.5];
  try { centroide = turf.centroid(ucFeat).geometry.coordinates; } catch (_) {}

  const zona = _utmZone(centroide[0]);

  // Análise das camadas vetoriais recortadas pela UC
  const camadasAnalise = _analisarCamadas(ucFeat, areaHa, _relCamadasSelecionadas());

  // CAR na UC: imóveis sobrepostos (usa _carFeatures se carregado para esta UC)
  let nCarSobrep = 0, areaCarHa = 0;
  const featsCar = (typeof _carFeatures !== 'undefined') ? _carFeatures : [];
  for (const cf of featsCar) {
    try {
      if (turf.booleanIntersects(ucFeat, cf)) {
        nCarSobrep++;
        const inter = turf.intersect(ucFeat, cf);
        if (inter) areaCarHa += turf.area(inter) / 10000;
      }
    } catch (_) {}
  }
  const pctCarUC = areaHa > 0 ? areaCarHa / areaHa * 100 : 0;

  return {
    ucNome,
    nome_full:     det.nome_full || p.nome_full || p.nome || ucNome,
    categoria:     p.categoria  || '—',
    grupo:         p.grupo      || '—',
    esfera:        det.esfera   || p.esfera   || '—',
    municipios:    det.municipios || p.municipio || '—',
    area_ha:       areaHa,
    orgao_gestor:  det.orgao_gestor || '—',
    plano_manejo:  det.plano_manejo || false,
    conselho_gestor: det.conselho_gestor || false,
    diploma:       det.conselho_portaria || det.plano_manejo_portaria || null,
    camadasAnalise,
    nCarSobrep,
    areaCarHa,
    pctCarUC,
    carCarregado:  featsCar.length > 0,
    ucFeat,
    bbox,
    centroide,
    zona,
  };
}

function _htmlFolhasLaudoUC(d, cab, protocolo) {
  if (!d) return [];
  const data = _relData();
  const mapUCId = `rel-mapa-uc-${d.ucNome.replace(/\W/g,'_')}`;
  const pag = n => `Pág. ${n} · Prot. ${_relEsc(protocolo)}`;

  const legUC = [
    { label: 'Limite da UC', color: '#0A1A0F', kind: 'line' },
    ...(d.camadasAnalise || []).filter(r => r.valor > 0).map(r => ({
      label: r.nome, color: r.cor,
      kind: r.tipo === 'ponto' ? 'point' : r.tipo === 'linha' ? 'line' : 'fill',
    })),
  ];

  // ── FOLHA A: Capa + Mapa da UC ──────────────────────────────────────────
  const fA = `
  <div class="rel-a4">
    ${_htmlCabecalho(cab, protocolo, data)}
    <div class="rel-body">
      <div class="rel-titulo-bloco">
        <div class="rel-tipo-label">Laudo de Unidade de Conservação</div>
        <div class="rel-nome-imovel">${_relEsc(d.nome_full)}</div>
        <div class="rel-cod-imovel">${_relEsc(d.categoria)} · ${_relEsc(d.esfera)} · ${_relEsc(d.municipios)}/AC · Bioma Amazônia</div>
      </div>
      <div class="rel-kpi-grid">
        <div class="rel-kpi kpi-verde"><div class="kl">Área oficial</div><div class="kv">${_relF2(d.area_ha)}<span style="font-size:9px"> ha</span></div><div class="ks">${_relEsc(d.esfera)}</div></div>
        <div class="rel-kpi kpi-lrnj"><div class="kl">CAR sobrepostos</div><div class="kv">${d.nCarSobrep}</div><div class="ks">${d.carCarregado?_relF2(d.areaCarHa)+' ha ('+_relF1(d.pctCarUC)+'%)':'CAR não carregado'}</div></div>
        <div class="rel-kpi ${d.plano_manejo?'kpi-verde':'kpi-lrnj'}"><div class="kl">Plano de Manejo</div><div class="kv">${d.plano_manejo?'Sim':'Não'}</div><div class="ks">&nbsp;</div></div>
        <div class="rel-kpi ${d.conselho_gestor?'kpi-verde':'kpi-lrnj'}"><div class="kl">Conselho Gestor</div><div class="kv">${d.conselho_gestor?'Sim':'Não'}</div><div class="ks">&nbsp;</div></div>
      </div>
      ${_htmlMapaABNT({ id: mapUCId, titulo:'Mapa de Localização da UC — '+_relEsc(d.ucNome), altura:300,
        zona: d.zona, fonte:'SEMA-AC · IBGE · OpenStreetMap · Elaborado: SIGUC-AC', camadas: legUC })}
    </div>
    <div class="rel-pag-rodape">
      <span>${_relEsc(cab.secretaria)} · ${_relEsc(cab.siglaDiret)} · ${_relEsc(cab.siglaDep)}</span>
      <span>${pag(1)}</span>
    </div>
  </div>`;

  // ── FOLHA B: Identificação + Camadas + CAR ────────────────────────────
  const fB = `
  <div class="rel-a4">
    ${_htmlCabecalho(cab, protocolo, data, true)}
    <div class="rel-body">
      <div class="rel-secao">
        <div class="rel-secao-titulo">1. Identificação da Unidade de Conservação</div>
        <table class="rel-table">
          <tr><td>Nome</td><td>${_relEsc(d.nome_full)}</td></tr>
          <tr><td>Categoria</td><td>${_relEsc(d.categoria)}</td></tr>
          <tr><td>Grupo</td><td>${_relEsc(d.grupo)}</td></tr>
          <tr><td>Esfera administrativa</td><td>${_relEsc(d.esfera)}</td></tr>
          <tr><td>Município(s)</td><td>${_relEsc(d.municipios)} — Acre</td></tr>
          <tr><td>Área (ha)</td><td>${_relF2(d.area_ha)} ha</td></tr>
          <tr><td>Órgão gestor</td><td>${_relEsc(d.orgao_gestor)}</td></tr>
          <tr><td>Plano de Manejo</td><td>${d.plano_manejo?'Sim':'Não'}</td></tr>
          <tr><td>Conselho Gestor</td><td>${d.conselho_gestor?'Sim':'Não'}</td></tr>
          ${d.diploma?`<tr><td>Diploma legal (referência)</td><td>${_relEsc(d.diploma)}</td></tr>`:''}
        </table>
      </div>

      ${_htmlSecaoCamadas(d.camadasAnalise, '2. Análise Ambiental por Camadas Vetoriais')}

      <div class="rel-secao">
        <div class="rel-secao-titulo">3. Imóveis CAR na UC</div>
        ${d.carCarregado ? `
        <table class="rel-table">
          <tr><td>Imóveis sobrepostos à UC (SICAR)</td><td><strong>${d.nCarSobrep}</strong></td></tr>
          <tr><td>Área total de CAR na UC</td><td><strong>${_relF2(d.areaCarHa)} ha</strong></td></tr>
          <tr><td>% da UC ocupada por CAR</td><td><strong>${_relF1(d.pctCarUC)}%</strong></td></tr>
        </table>
        <div style="font-size:8px;color:#9ca3af;margin-top:4px">Calculado a partir de ${(typeof _carFeatures!=='undefined'?_carFeatures.length:0).toLocaleString('pt-BR')} imóveis CAR carregados para esta UC. Dados PRODES por imóvel: ver laudos individuais.</div>` :
        '<div style="font-size:10px;color:#9ca3af;padding:8px 0">CAR não carregado para esta UC — selecione a UC e carregue os imóveis CAR para este diagnóstico.</div>'}
      </div>
    </div>
    <div class="rel-pag-rodape">
      <span>${_relEsc(cab.secretaria)} · ${_relEsc(cab.siglaDiret)} · ${_relEsc(cab.siglaDep)}</span>
      <span>${pag(2)}</span>
    </div>
  </div>`;

  // ── FOLHA C: Conclusão + Assinatura ──────────────────────────────────
  const temCamadas = (d.camadasAnalise || []).some(r => r.valor > 0);
  const temAPP = (d.camadasAnalise || []).some(r => r.tema === 'app' || r.tema === 'nascente' || r.tema === 'hidro');
  const fC = `
  <div class="rel-a4">
    ${_htmlCabecalho(cab, protocolo, data, true)}
    <div class="rel-body">
      <div class="rel-secao">
        <div class="rel-secao-titulo">4. Conclusão e Recomendações</div>
        <div class="rel-narrativa">
          A <strong>${_relEsc(d.nome_full)}</strong>, com ${_relF2(d.area_ha)} ha, é uma unidade de conservação de
          ${_relEsc(d.grupo === 'protecao_integral' ? 'proteção integral' : 'uso sustentável')} da esfera ${_relEsc(d.esfera)},
          categoria ${_relEsc(d.categoria)}, localizada em ${_relEsc(d.municipios)}, Estado do Acre.
          ${d.nCarSobrep > 0 && d.carCarregado
            ? `Foram identificados <strong>${d.nCarSobrep} imóveis CAR</strong> sobrepostos ao polígono da unidade, totalizando <strong>${_relF2(d.areaCarHa)} ha</strong> (${_relF1(d.pctCarUC)}% da UC), o que demanda atenção quanto à regularização fundiária (Lei 9.985/2000, Art. 42).`
            : ''}
          ${temCamadas
            ? ' A análise das camadas vetoriais carregadas identificou elementos ambientais de relevância dentro do perímetro da UC (ver seção 2).'
            : ''}
          ${temAPP
            ? ' Verificar a integridade das Áreas de Preservação Permanente identificadas (Arts. 4º e 7º, Lei 12.651/2012).'
            : ''}
          ${!d.plano_manejo ? ' A ausência de Plano de Manejo limita a gestão e o controle do uso.' : ''}
          ${!d.conselho_gestor ? ' A ausência de Conselho Gestor limita a participação social na gestão.' : ''}
        </div>
        <div class="rel-refs"><strong>Base legal:</strong> Lei nº 9.985/2000 (SNUC) · Lei nº 12.651/2012 (Código Florestal) · Arts. 4º, 7º, 61-A (APP) · Art. 42 (regularização fundiária de UC)</div>
      </div>

      ${_htmlAssinatura(cab)}

      <div class="rel-aviso">
        Documento emitido pelo SIGUC-AC em ${data} · operado por ${_relEsc(appState.usuario?.nome_completo||appState.usuario?.email||'Usuário')} (${_relEsc(appState.perfil||'—')}).<br>
        ${_relEsc(cab.rodapeTxt||'')} As análises são baseadas em dados de sensoriamento remoto e informações vetoriais com margem de erro de 5–15%.<br>
        ${_relEsc(cab.secretaria)} · ${_relEsc(cab.siglaDiret)} · ${_relEsc(cab.siglaDep)} · ${_relEsc(cab.telefone)} · ${_relEsc(cab.email)}
      </div>
    </div>
    <div class="rel-pag-rodape">
      <span>${_relEsc(cab.secretaria)} · ${_relEsc(cab.siglaDiret)} · ${_relEsc(cab.siglaDep)}</span>
      <span>${pag(3)}</span>
    </div>
  </div>`;

  return [fA, fB, fC];
}

// ── Inicializar mapas Leaflet dentro do relatório ─────────────────────────

// Renderiza camadas vetoriais do usuário num mapa Leaflet (leve, sem tooltips)
function _renderizarCamadasNoMapa(mapa, camadasSel) {
  for (const cam of (camadasSel || [])) {
    if (!cam.geojson?.features?.length) continue;
    try {
      const tipo = _tipoGeomCamada(cam.geojson);
      L.geoJSON(cam.geojson, {
        pointToLayer: tipo === 'ponto'
          ? (_, ll) => L.circleMarker(ll, { radius: 4, color: cam.cor || '#6b7280', fillColor: cam.cor || '#6b7280', fillOpacity: 0.8, weight: 1 })
          : undefined,
        style: tipo !== 'ponto'
          ? { color: cam.cor || '#6b7280', weight: tipo === 'linha' ? 1.5 : 1, fillColor: cam.cor || '#6b7280', fillOpacity: tipo === 'linha' ? 0 : 0.3 }
          : undefined,
      }).addTo(mapa);
    } catch (_) {}
  }
}

async function _inicializarMapasRelatorio(imoveis, multi, dadosUC) {
  const TILE = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
  const OSM_ATTR = '© OpenStreetMap';
  await _carregarAcreOutline();

  // Helper: aguarda tiles carregarem
  const aguardarMapa = (m) => new Promise(resolve => {
    let done = false;
    const ok = () => { if (!done) { done = true; resolve(); } };
    m.once('load', ok);
    setTimeout(ok, 4000); // fallback 4s
  });
  const setEscala = (map, id) => {
    const el = document.getElementById(id + '__esc');
    if (el) { const c = map.getCenter(); el.textContent = _calcularEscalaLeaflet(map.getZoom(), c.lat); }
  };

  const mapPromises = [];
  const camadasSel = _relCamadasSelecionadas();

  // ── Mapa do Laudo de UC ──────────────────────────────────────────────────
  if (dadosUC) {
    const ucKey = dadosUC.ucNome.replace(/\W/g, '_');
    const ucMapId = `rel-mapa-uc-${ucKey}`;
    const elUC = document.getElementById(ucMapId);
    if (elUC && dadosUC.ucFeat) {
      const zona = dadosUC.zona;
      const mUC = L.map(elUC, { zoomControl: true, attributionControl: false });
      L.tileLayer(TILE, { attribution: OSM_ATTR }).addTo(mUC);
      try { L.geoJSON(dadosUC.ucFeat, { style: { color: '#0A1A0F', weight: 2.5, fillOpacity: 0.08 } }).addTo(mUC); } catch (_) {}
      _renderizarCamadasNoMapa(mUC, camadasSel);
      try { mUC.fitBounds([[dadosUC.bbox[1], dadosUC.bbox[0]], [dadosUC.bbox[3], dadosUC.bbox[2]]], { padding: [20, 20] }); } catch (_) {}
      L.control.scale({ imperial: false, metric: true, position: 'bottomleft' }).addTo(mUC);
      let gridUC = _desenharGridUTM(mUC, zona);
      setEscala(mUC, ucMapId);
      mUC.on('zoomend moveend', () => {
        setEscala(mUC, ucMapId);
        if (gridUC) mUC.removeLayer(gridUC);
        gridUC = _desenharGridUTM(mUC, zona);
      });
      if (_acreOutline) {
        const ins = document.createElement('div');
        ins.className = 'rel-mapa-inset';
        ins.innerHTML = _insetAcreSVG(dadosUC.centroide);
        elUC.appendChild(ins);
      }
      mapPromises.push(aguardarMapa(mUC));
    }
    await Promise.allSettled(mapPromises);
    return;
  }

  // Mapa consolidado
  if (multi) {
    const elC = document.getElementById('rel-mapa-consolidado');
    if (elC) {
      const bboxAll = imoveis.reduce((acc,d)=>{
        return [Math.min(acc[0],d.bbox[0]),Math.min(acc[1],d.bbox[1]),Math.max(acc[2],d.bbox[2]),Math.max(acc[3],d.bbox[3])];
      }, [Infinity,Infinity,-Infinity,-Infinity]);
      const mc = L.map(elC,{zoomControl:false,attributionControl:false});
      L.tileLayer(TILE,{attribution:OSM_ATTR}).addTo(mc);
      imoveis.forEach((d,i) => {
        try {
          const cor = ['#dc2626','#2563eb','#16a34a','#d97706','#7c3aed','#0891b2'][i%6];
          L.geoJSON({type:'Feature',geometry:d.geometry},{style:{color:cor,weight:2,fillOpacity:.2}}).addTo(mc);
        } catch(_) {}
      });
      mc.fitBounds([[bboxAll[1],bboxAll[0]],[bboxAll[3],bboxAll[2]]],{padding:[20,20]});
      L.control.scale({imperial:false,metric:true,position:'bottomleft'}).addTo(mc);
      _desenharGridUTM(mc, _zonaImovel(imoveis[0]));
      setEscala(mc, 'rel-mapa-consolidado');
      mapPromises.push(aguardarMapa(mc));
    }
  }

  for (const d of imoveis) {
    const codKey = d.cod_imovel.replace(/\W/g,'_');
    const zona = _zonaImovel(d);

    // Mapa de localização
    const locId = `rel-mapa-loc-${codKey}`;
    const elLoc = document.getElementById(locId);
    if (elLoc) {
      const mLoc = L.map(elLoc,{zoomControl:false,attributionControl:false}).setView([-9.5,-70.5],6);
      L.tileLayer(TILE,{attribution:OSM_ATTR}).addTo(mLoc);
      try { L.geoJSON({type:'Feature',geometry:d.geometry},{style:{color:'#dc2626',weight:2,fillColor:'#dc2626',fillOpacity:.25}}).addTo(mLoc); } catch(_){}
      L.control.scale({imperial:false,metric:true,position:'bottomleft'}).addTo(mLoc);
      setEscala(mLoc, locId);
      mLoc.on('zoomend moveend', () => setEscala(mLoc, locId));
      mapPromises.push(aguardarMapa(mLoc));
    }

    // Mapa de detalhe (mapa temático principal)
    const detId = `rel-mapa-det-${codKey}`;
    const elDet = document.getElementById(detId);
    if (elDet && d.bbox) {
      const mDet = L.map(elDet,{zoomControl:true,attributionControl:false});
      L.tileLayer(TILE,{attribution:OSM_ATTR}).addTo(mDet);
      // Limite CAR
      try { L.geoJSON({type:'Feature',geometry:d.geometry},{style:{color:'#1F4E2C',weight:2.5,fillOpacity:.05,dashArray:'6 3'}}).addTo(mDet); } catch(_){}
      // PRODES anual (colorido por CF)
      if (d.geojsonFeatAnual.length) {
        L.geoJSON({type:'FeatureCollection',features:d.geojsonFeatAnual},{
          style(f){ const cor=f.properties?.clf?.cor||'#dc2626'; return {fillColor:cor,fillOpacity:.5,color:cor,weight:1}; },
          onEachFeature(f,l){ const p=f.properties||{}; l.bindTooltip(`PRODES ${p.ano||'—'} · ${_relF2(p.ha_calc||0)} ha`); }
        }).addTo(mDet);
      }
      // PRODES pré-2008
      if (d.geojsonFeatHist.length) {
        L.geoJSON({type:'FeatureCollection',features:d.geojsonFeatHist},{
          style:{fillColor:'#c2410c',fillOpacity:.4,color:'#c2410c',weight:1}
        }).addTo(mDet);
      }
      // Camadas vetoriais do usuário
      _renderizarCamadasNoMapa(mDet, camadasSel);
      mDet.fitBounds([[d.bbox[1],d.bbox[0]],[d.bbox[3],d.bbox[2]]],{padding:[20,20]});
      L.control.scale({imperial:false,metric:true,position:'bottomleft'}).addTo(mDet);
      let gridGrp = _desenharGridUTM(mDet, zona);
      setEscala(mDet, detId);
      // Redesenha grid e escala ao interagir
      mDet.on('zoomend moveend', () => {
        setEscala(mDet, detId);
        if (gridGrp) mDet.removeLayer(gridGrp);
        gridGrp = _desenharGridUTM(mDet, zona);
      });
      // Inset de localização no canto
      if (_acreOutline) {
        const ins = document.createElement('div');
        ins.className = 'rel-mapa-inset';
        ins.innerHTML = _insetAcreSVG(d.centroide);
        elDet.appendChild(ins);
      }
      mapPromises.push(aguardarMapa(mDet));
    }
  }

  await Promise.allSettled(mapPromises);
}

// ── Preview overlay ───────────────────────────────────────────────────────

async function _abrirPreviewRelatorio() {
  _fecharModalRelatorio();
  toast('Gerando relatório…', 'info');

  const [cab, protocolo] = await Promise.all([getCabecalhoRelatorio(), gerarProtocolo()]);
  cab.responsavel = _resolverResponsavel(cab);

  let html, dadosList = [], dadosUC = null;

  if (_relEscopo === 'uc') {
    const ucNome = _carUCAtual;
    if (!ucNome || ucNome.startsWith('Consulta:')) { toast('Nenhuma UC selecionada.', 'warning'); return; }
    dadosUC = await _montarDadosLaudoUC(ucNome);
    if (!dadosUC) { toast('Não foi possível montar o laudo da UC.', 'error'); return; }
    html = await _gerarHTMLRelatorio([], _relModo, cab, protocolo, dadosUC);
  } else {
    const imovelFeats = _relColetarImoveis();
    if (!imovelFeats.length) { toast('Nenhum imóvel selecionado.', 'warning'); return; }
    dadosList = await Promise.all(imovelFeats.map(_montarDadosRelatorio));
    html = await _gerarHTMLRelatorio(dadosList, _relModo, cab, protocolo, null);
  }

  const tituloBar = dadosUC
    ? dadosUC.nome_full
    : (dadosList[0]?.nom_imovel || 'Imóvel') + (dadosList.length > 1 ? ' + ' + (dadosList.length - 1) + ' imóveis' : '');
  const modoBar = dadosUC ? 'LAUDO DE UC' : (_relModo === 'sintetico' ? 'SINTÉTICO' : 'DETALHADO');

  const overlay = document.createElement('div');
  overlay.id = 'rel-preview-overlay';
  overlay.innerHTML = `
  <div id="rel-preview-toolbar">
    <span class="rel-tb-titulo">${_relEsc(tituloBar)}</span>
    <span class="rel-tb-modo">${modoBar}</span>
    <button class="btn btn-outline" style="font-size:11px" onclick="document.getElementById('rel-preview-overlay').remove()">← Fechar</button>
    <button class="btn btn-outline" style="font-size:11px" onclick="_abrirNovaAba()">↗ Nova aba</button>
    <button class="btn btn-primary" style="font-size:11px" onclick="_executarPrint()">Imprimir / Salvar PDF</button>
  </div>
  <div id="rel-preview-area">${html}</div>`;

  document.body.appendChild(overlay);

  if (dadosUC) {
    await _inicializarMapasRelatorio([], false, dadosUC);
  } else {
    await _inicializarMapasRelatorio(dadosList, dadosList.length > 1, null);
  }
}

async function _imprimirRelatorio() {
  _fecharModalRelatorio();
  await _abrirPreviewRelatorio();
  // Pequeno delay para mapas renderizarem
  setTimeout(_executarPrint, 2500);
}

async function _executarPrint() {
  // Aguarda todos os tiles (img) do preview carregarem antes de imprimir
  const area = document.getElementById('rel-preview-area');
  if (area) {
    const imgs = [...area.querySelectorAll('img')];
    if (imgs.length) {
      toast('Aguardando mapas carregarem…', 'info');
      await Promise.allSettled(imgs.map(img =>
        img.complete ? Promise.resolve() :
        new Promise(r => { img.onload = r; img.onerror = r; setTimeout(r, 8000); })
      ));
    }
  }
  // Delay extra para garantir render do canvas Leaflet
  await new Promise(r => setTimeout(r, 600));
  window.print();
}

async function _abrirNovaAba() {
  const [cab, protocolo] = await Promise.all([getCabecalhoRelatorio(), gerarProtocolo()]);
  cab.responsavel = _resolverResponsavel(cab);
  let html;
  if (_relEscopo === 'uc') {
    const d = await _montarDadosLaudoUC(_carUCAtual);
    html = await _gerarHTMLRelatorio([], _relModo, cab, protocolo, d);
  } else {
    const imovelFeats = _relColetarImoveis();
    const dadosList = await Promise.all(imovelFeats.map(_montarDadosRelatorio));
    html = await _gerarHTMLRelatorio(dadosList, _relModo, cab, protocolo, null);
  }
  const win = window.open('', '_blank');
  if (!win) { toast('Popup bloqueado — use o botão Imprimir.', 'warning'); return; }
  win.document.write(`<!DOCTYPE html><html lang="pt-BR"><head>
    <meta charset="UTF-8">
    <title>Relatório SIGUC-AC</title>
    <link rel="stylesheet" href="${location.origin}/css/relatorio-print.css">
    <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
    <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"><\/script>
    <style>body{background:#374151;padding:20px;font-family:'DM Sans',system-ui,sans-serif}</style>
  </head><body>${html}</body></html>`);
  win.document.close();
}
