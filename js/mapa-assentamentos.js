// ── Projetos de Assentamento (INCRA) — seção da guia Áreas Territoriais ──
// Camada estática data/assentamentos_acre.geojson, gerada por
// scripts/assentamentos_geojson.py a partir do shapefile do Acervo Fundiário
// do INCRA. Mesmo desenho da seção de Terras Indígenas (pages/mapa.html):
// liga/desliga, resumo, estilo, nomes — mais o filtro por modalidade.
// Depende de globais da página: mapaL, escHtml, _atualizarLegendaMapa,
// _prefsAgendarSalvamento (todas opcionais na hora da chamada).

const PA_MODALIDADES = {
  PA:  'Projeto de Assentamento',
  PAE: 'Assentamento Agroextrativista',
  PDS: 'Desenvolvimento Sustentável',
  PAF: 'Assentamento Florestal',
  Outro: 'Outra modalidade',
};
const PA_ESTILO_PADRAO = { cor: '#6D28D9', fill: '#8B5CF6', dash: '', peso: '1.5', opacity: '30', nomes: false, mods: null };
const PA_ACRE_HA = 16421980; // mesma constante das TIs

let _paGeojson = null, _paLayer = null, _paAtivo = false, _paCarregando = null;
let _paEstado = (() => {
  try { return { ...PA_ESTILO_PADRAO, ...(JSON.parse(localStorage.getItem('siguc_pa_estilo') || 'null') || {}) } }
  catch (e) { return { ...PA_ESTILO_PADRAO } }
})();

function _paEl(id) { return document.getElementById(id) }
function _paNum(v, casas = 0) { return Number(v || 0).toLocaleString('pt-BR', { maximumFractionDigits: casas, minimumFractionDigits: casas }) }
function _paData(iso) { if (!iso) return ''; const [a, m, d] = iso.split('-'); return `${d}/${m}/${a}` }
function _paEsc(s) { return typeof escHtml === 'function' ? escHtml(s) : String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])) }

function _paModsAtivas() {
  const todas = Object.keys(PA_MODALIDADES);
  return new Set(Array.isArray(_paEstado.mods) ? _paEstado.mods : todas);
}

// Features que passam no filtro de modalidade — é o que está no mapa
function paFeaturesVisiveis() {
  if (!_paGeojson) return [];
  const ok = _paModsAtivas();
  return (_paGeojson.features || []).filter(f => ok.has(f.properties?.modalidade || 'Outro'));
}

function paEstilo() {
  const s = _paEstado;
  return {
    color: s.cor, weight: parseFloat(s.peso) || 1.5, opacity: .95,
    fillColor: s.fill, fillOpacity: (parseFloat(s.opacity) || 0) / 100,
    dashArray: s.dash || null,
  };
}

function paPopupHTML(p) {
  const linha = (rot, val) => val || val === 0 ? `<div class="cp-row"><strong>${rot}</strong><span>${val}</span></div>` : '';
  const ato = p.area_ato_ha, poli = p.area_poligono_ha;
  const diverge = ato && poli && Math.abs(ato - poli) / ato > 0.1;
  return `<div class="camada-popup">
    <div class="cp-header" style="background:#4C1D95">Projeto de Assentamento · INCRA</div>
    <div class="cp-layer">
      <div class="cp-layer-nome" style="color:#6D28D9">${_paEsc(p.nome_completo || p.nome)}</div>
      ${linha('Modalidade', _paEsc(PA_MODALIDADES[p.modalidade] ? `${p.modalidade} — ${PA_MODALIDADES[p.modalidade]}` : p.modalidade))}
      ${linha('Código SIPRA', _paEsc(p.cd_sipra))}
      ${linha('Município', _paEsc(p.municipio))}
      ${linha('Área no ato', ato ? _paNum(ato) + ' ha' : '')}
      ${linha('Área do polígono', poli ? _paNum(poli) + ' ha' : '')}
      ${diverge ? '<div class="cp-row" style="color:#92400e"><span>As duas áreas divergem mais de 10% — vale conferir com o INCRA.</span></div>' : ''}
      ${linha('Famílias assentadas', p.familias != null ? _paNum(p.familias) : '')}
      ${linha('Capacidade', p.capacidade != null ? _paNum(p.capacidade) + ' famílias' : '')}
      ${linha('Fase', p.fase_nome ? _paEsc(`${p.fase} — ${p.fase_nome}`) : '')}
      ${linha('Criado em', _paData(p.criado_em))}
      ${linha('Forma de obtenção', _paEsc(p.forma_obtencao))}
      ${linha('Obtido em', _paData(p.obtido_em))}
      <div class="cp-row" style="color:#6b7280;font-size:10px"><span>Fonte: INCRA — Acervo Fundiário (recebido em 07/10/2026)</span></div>
      ${p.cd_sipra && typeof carAbrirAssentamento === 'function'
        ? `<button type="button" class="pa-btn-car" data-pa-car="${_paEsc(p.cd_sipra)}">Ver CARs deste assentamento</button>`
        : ''}
    </div>
  </div>`;
}

function _paTooltip(layer) {
  const p = layer.feature?.properties || {};
  layer.unbindTooltip();
  layer.bindTooltip(p.nome_completo || p.nome || 'Assentamento', { permanent: !!_paEstado.nomes, direction: 'center', className: 'subbacia-label' });
  if (_paEstado.nomes) layer.openTooltip();
}

function paRenderizar() {
  if (typeof mapaL === 'undefined' || !mapaL) return;
  if (_paLayer) { mapaL.removeLayer(_paLayer); _paLayer = null }
  if (!_paGeojson || !_paAtivo) return;
  _paLayer = L.geoJSON({ type: 'FeatureCollection', features: paFeaturesVisiveis() }, {
    style: paEstilo(),
    onEachFeature: (f, layer) => {
      _paTooltip(layer);
      layer.bindPopup(paPopupHTML(f.properties || {}), { className: 'camada-popup-wrap', maxWidth: 300 });
    },
  });
  _paLayer.addTo(mapaL);
}

async function paCarregar() {
  if (_paGeojson) return _paGeojson;
  if (_paCarregando) return _paCarregando;
  _paCarregando = (async () => {
    const st = _paEl('pa-stat');
    try {
      const r = await fetch(window.PA_GEOJSON_URL || '../data/assentamentos_acre.geojson');
      if (!r.ok) throw new Error('HTTP ' + r.status);
      _paGeojson = await r.json();
    } catch (e) {
      if (st) st.textContent = 'Não foi possível carregar os assentamentos: ' + e.message;
      _paCarregando = null;
      return null;
    }
    const n = _paGeojson.features?.length || 0;
    const badge = _paEl('pa-count-badge'); if (badge) { badge.textContent = n; badge.style.display = n ? '' : 'none' }
    return _paGeojson;
  })();
  return _paCarregando;
}

async function togglePA(ativo) {
  _paAtivo = !!ativo;
  if (_paAtivo) await paCarregar();
  paRenderizar();
  paAtualizarPainel();
  if (typeof _atualizarLegendaMapa === 'function') _atualizarLegendaMapa();
}

function paResumo(feats) {
  feats = feats || paFeaturesVisiveis();
  const area = feats.reduce((s, f) => s + (Number(f.properties?.area_poligono_ha) || 0), 0);
  const familias = feats.reduce((s, f) => s + (Number(f.properties?.familias) || 0), 0);
  return { total: feats.length, area, familias, pct: area / PA_ACRE_HA * 100 };
}

// Sincroniza controles com o estado e redesenha resumo e contagens do filtro
function paAtualizarPainel() {
  const set = (id, prop, v) => { const e = _paEl(id); if (e) e[prop] = v };
  set('pa-toggle', 'checked', _paAtivo);
  set('pa-cor-linha', 'value', _paEstado.cor); set('pa-cor-fill', 'value', _paEstado.fill);
  set('pa-dash', 'value', _paEstado.dash); set('pa-peso', 'value', _paEstado.peso);
  set('pa-opacity', 'value', _paEstado.opacity); set('pa-nomes', 'checked', !!_paEstado.nomes);
  const ov = _paEl('pa-opacity-val'); if (ov) ov.textContent = Math.round(parseFloat(_paEstado.opacity) || 0) + '%';

  const box = _paEl('pa-mods');
  if (box && _paGeojson) {
    const cont = {};
    (_paGeojson.features || []).forEach(f => { const m = f.properties?.modalidade || 'Outro'; cont[m] = (cont[m] || 0) + 1 });
    const ok = _paModsAtivas();
    box.innerHTML = Object.keys(PA_MODALIDADES).filter(m => cont[m]).map(m => `
      <label class="pa-mod" title="${_paEsc(PA_MODALIDADES[m])}">
        <input type="checkbox" data-pa-mod="${m}" ${ok.has(m) ? 'checked' : ''} onchange="paFiltrarModalidade()">
        <span class="pa-mod-sigla">${m}</span><span class="pa-mod-nome">${_paEsc(PA_MODALIDADES[m])}</span><span class="pa-mod-n">${cont[m]}</span>
      </label>`).join('');
  }
  const res = _paEl('pa-resumo');
  if (res) {
    if (!_paGeojson) { res.style.display = 'none' }
    else {
      const r = paResumo();
      set('pa-res-total', 'textContent', _paNum(r.total));
      set('pa-res-area', 'textContent', _paNum(r.area / 1e6, 2));
      set('pa-res-fam', 'textContent', _paNum(r.familias));
      set('pa-res-pct', 'textContent', r.pct.toFixed(1).replace('.', ',') + '%');
      res.style.display = '';
    }
  }
  const st = _paEl('pa-stat');
  if (st && _paGeojson) {
    const n = _paGeojson.features.length, v = paFeaturesVisiveis().length;
    st.textContent = v === n ? `${n} assentamentos carregados` : `${v} de ${n} assentamentos no filtro`;
  }
}

function paFiltrarModalidade() {
  const marcadas = [...document.querySelectorAll('[data-pa-mod]')].filter(e => e.checked).map(e => e.dataset.paMod);
  const presentes = [...document.querySelectorAll('[data-pa-mod]')].map(e => e.dataset.paMod);
  // Guarda só a escolha; modalidade que não está no arquivo segue ligada
  const outras = Object.keys(PA_MODALIDADES).filter(m => !presentes.includes(m));
  _paEstado.mods = marcadas.length === presentes.length ? null : [...marcadas, ...outras];
  _paSalvarEstado();
  paRenderizar();
  paAtualizarPainel();
  if (typeof _atualizarLegendaMapa === 'function') _atualizarLegendaMapa();
}

function paAplicarEstilo() {
  const v = id => _paEl(id)?.value;
  _paEstado = {
    ..._paEstado,
    cor: v('pa-cor-linha') || _paEstado.cor, fill: v('pa-cor-fill') || _paEstado.fill,
    dash: v('pa-dash') ?? _paEstado.dash, peso: v('pa-peso') || _paEstado.peso,
    opacity: v('pa-opacity') ?? _paEstado.opacity, nomes: !!_paEl('pa-nomes')?.checked,
  };
  const ov = _paEl('pa-opacity-val'); if (ov) ov.textContent = Math.round(parseFloat(_paEstado.opacity) || 0) + '%';
  _paSalvarEstado();
  if (_paLayer) { _paLayer.setStyle(paEstilo()); _paLayer.eachLayer(_paTooltip) }
  if (typeof _atualizarLegendaMapa === 'function') _atualizarLegendaMapa();
}

function _paSalvarEstado() {
  try { localStorage.setItem('siguc_pa_estilo', JSON.stringify(_paEstado)) } catch (e) { }
  if (typeof _prefsAgendarSalvamento === 'function') _prefsAgendarSalvamento();
}

// Preferências na nuvem (preferencias_mapa.dados.pa)
function paPrefsCapturar() { return { ..._paEstado } }
function paPrefsAplicar(d) {
  if (!d || !Object.keys(d).length) return;
  _paEstado = { ...PA_ESTILO_PADRAO, ...d };
  try { localStorage.setItem('siguc_pa_estilo', JSON.stringify(_paEstado)) } catch (e) { }
  if (_paLayer) { paRenderizar() }
}

// Item da legenda do mapa (tela e impressão)
function paItemLegenda() {
  if (!_paAtivo || !_paLayer) return null;
  return { simbolo: 'rect', cor: _paEstado.fill, opacidade: (parseFloat(_paEstado.opacity) || 0) / 100, cor_borda: _paEstado.cor, label: 'Projetos de Assentamento (INCRA)' };
}

function paSecaoHTML() {
  return `
    <div><label style="display:flex;align-items:center;gap:8px;font-size:12px;font-weight:600;cursor:pointer">
      <input type="checkbox" id="pa-toggle" style="accent-color:#6D28D9;width:14px;height:14px" onchange="togglePA(this.checked)">
      Exibir Projetos de Assentamento</label>
      <p style="font-size:11px;color:var(--cinza-500);margin:5px 0 0">Fonte: INCRA · Acervo Fundiário (assentamentos federais do Acre, recebido em 07/10/2026).</p>
    </div>
    <div id="pa-resumo" class="pa-resumo" style="display:none">
      <div><b id="pa-res-total">—</b><span>Assentamentos</span></div>
      <div><b id="pa-res-area">—</b><span>Milhões ha</span></div>
      <div><b id="pa-res-fam">—</b><span>Famílias</span></div>
      <div><b id="pa-res-pct">—</b><span>% Acre</span></div>
    </div>
    <div>
      <div style="font-size:11px;color:var(--cinza-600);margin:10px 0 4px;font-weight:600">Modalidade</div>
      <div id="pa-mods" class="pa-mods"><span style="font-size:11px;color:var(--cinza-400)">Ligue a camada para ver as modalidades.</span></div>
    </div>
    <div style="margin-top:12px;display:flex;flex-direction:column;gap:10px">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
        <div><label style="font-size:11px;color:var(--cinza-600);display:block;margin-bottom:3px">Cor da linha</label>
          <input type="color" id="pa-cor-linha" value="${_paEstado.cor}" oninput="paAplicarEstilo()" style="width:100%;height:28px;border:1px solid var(--cinza-300);border-radius:6px;padding:2px;cursor:pointer"></div>
        <div><label style="font-size:11px;color:var(--cinza-600);display:block;margin-bottom:3px">Cor de preenchimento</label>
          <input type="color" id="pa-cor-fill" value="${_paEstado.fill}" oninput="paAplicarEstilo()" style="width:100%;height:28px;border:1px solid var(--cinza-300);border-radius:6px;padding:2px;cursor:pointer"></div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
        <div><label style="font-size:11px;color:var(--cinza-600);display:block;margin-bottom:3px">Tracejado</label>
          <select id="pa-dash" onchange="paAplicarEstilo()" style="width:100%;height:28px;border:1px solid var(--cinza-300);border-radius:6px;font-size:11px;padding:0 6px;background:#fff">
            <option value="">Sólido ───</option><option value="6 4">Tracejado - - -</option><option value="2 4">Pontilhado · · ·</option>
            <option value="8 4">Traço longo ——</option><option value="8 4 2 4">Traço-ponto -·-</option>
          </select></div>
        <div><label style="font-size:11px;color:var(--cinza-600);display:block;margin-bottom:3px">Espessura</label>
          <select id="pa-peso" onchange="paAplicarEstilo()" style="width:100%;height:28px;border:1px solid var(--cinza-300);border-radius:6px;font-size:11px;padding:0 6px;background:#fff">
            <option value="0.8">Fina (0.8)</option><option value="1.5">Normal (1.5)</option><option value="2.5">Grossa (2.5)</option><option value="4">Muito grossa (4)</option>
          </select></div>
      </div>
      <div><label style="font-size:11px;color:var(--cinza-600);display:block;margin-bottom:3px">Opacidade do preenchimento
          <span id="pa-opacity-val" style="float:right;color:var(--cinza-500)">${Math.round(parseFloat(_paEstado.opacity) || 0)}%</span></label>
        <input type="range" id="pa-opacity" min="0" max="100" value="${_paEstado.opacity}" style="width:100%;accent-color:#6D28D9" oninput="paAplicarEstilo()"></div>
      <label style="display:flex;align-items:center;gap:8px;font-size:11px;cursor:pointer;font-weight:600">
        <input type="checkbox" id="pa-nomes" style="accent-color:#6D28D9;width:13px;height:13px" onchange="paAplicarEstilo()">
        Exibir nomes dos assentamentos</label>
    </div>
    <div id="pa-stat" style="font-size:10px;color:var(--cinza-400);text-align:right;margin-top:6px"></div>`;
}

// Clique no botão da janela → camada CAR no modo assentamento (pages/mapa.html)
document.addEventListener('click', ev => {
  const b = ev.target.closest && ev.target.closest('[data-pa-car]');
  if (b && typeof carAbrirAssentamento === 'function') carAbrirAssentamento(b.dataset.paCar);
});
