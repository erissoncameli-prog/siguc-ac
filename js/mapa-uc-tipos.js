// ── UCs por tipo e nível (Mapa das UCs, seção da guia Áreas Territoriais) ──
// "Colorir por": cada UC (cor individual, como sempre foi) · grupo (PI/US) ·
// categoria · esfera. Cada tipo tem sua cor (editável) e sua caixa de
// mostrar/ocultar. Os filtros se SOMAM: categoria oculta, grupo oculto e
// esfera desligada valem juntos em qualquer modo (ex.: só Florestas
// estaduais). O filtro de esfera continua sendo o de sempre
// (_ucEsfFed/_ucEsfEst/_ucEsfMun em pages/mapa.html).
// Depende de globais da página na hora da chamada: _ucGeojson, _ucCorNome,
// _ucGrupoId, _ucEsf*, toggleUCEsfera, _renderizarUC, _atualizarLegendaMapa,
// renderCamadasHtml, _prefsAgendarSalvamento, AP_CORES (js/mapa-aparencia.js).

const UCT_MODOS = [['uc', 'Cada UC'], ['grupo', 'Grupo'], ['categoria', 'Categoria'], ['esfera', 'Esfera']];
const UCT_GRUPO_NOME = { pi: 'Proteção Integral', us: 'Uso Sustentável' };
const UCT_ESFERAS = ['federal', 'estadual', 'municipal'];
// Cores iniciais: PI/US mantêm a convenção do mapa (vermelho/azul); categoria
// e esfera usam Okabe-Ito (segura para daltonismo) + vinho de Paul Tol.
const UCT_PADRAO = {
  grupo: { pi: '#dc2626', us: '#2563eb' },
  esfera: { federal: '#0072B2', estadual: '#009E73', municipal: '#E69F00' },
  categoria: {
    'Reserva Extrativista': '#E69F00', 'Floresta Estadual': '#009E73', 'Floresta Nacional': '#56B4E9',
    'Área de Proteção Ambiental': '#F0E442', 'Área de Relevante Interesse Ecológico': '#CC79A7',
    'Estação Ecológica': '#D55E00', 'Parque Estadual': '#0072B2', 'Parque Nacional': '#882255',
  },
};
const UCT_CICLO = ['#E69F00', '#56B4E9', '#009E73', '#F0E442', '#0072B2', '#D55E00', '#CC79A7', '#882255'];

function _uctLer(chave, padrao) { try { return JSON.parse(localStorage.getItem(chave) || 'null') ?? padrao } catch (e) { return padrao } }
let _uctModo = _uctLer('siguc_uc_colorir', 'uc');
let _uctCores = _uctLer('siguc_uc_cores_tipo', {}) || {};
let _uctOcultos = new Set(_uctLer('siguc_uc_tipo_ocultos', []) || []);
if (!UCT_MODOS.some(m => m[0] === _uctModo)) _uctModo = 'uc';

function _uctEsc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])) }

// Valor do tipo de uma UC num modo (grupo → 'pi'|'us', esfera → minúscula)
function uctValor(p, modo) {
  if (modo === 'grupo') return _ucGrupoId(p?.grupo);
  if (modo === 'esfera') return String(p?.esfera || '').toLowerCase() || 'sem esfera';
  if (modo === 'categoria') return String(p?.categoria || '').trim() || 'Sem categoria';
  return p?.nome || '';
}
function uctRotulo(modo, v) {
  if (modo === 'grupo') return UCT_GRUPO_NOME[v] || v;
  if (modo === 'esfera') return v.charAt(0).toUpperCase() + v.slice(1);
  return v;
}

// Cor do tipo: a escolhida, senão a inicial, senão a do ciclo (categoria nova)
function uctCorTipo(modo, v) {
  const esc = _uctCores[modo]?.[v];
  if (esc) return esc;
  const pad = UCT_PADRAO[modo]?.[v];
  if (pad) return pad;
  const lista = uctTipos(modo).map(t => t.valor);
  return UCT_CICLO[Math.max(0, lista.indexOf(v)) % UCT_CICLO.length];
}

// Cor de preenchimento de uma UC conforme o modo — ÚNICA definição; todo
// estilo da camada passa por aqui (antes era _ucCorNome direto).
function uctCor(p) {
  if (_uctModo === 'uc') return _ucCorNome(p.nome, p.cor);
  return uctCorTipo(_uctModo, uctValor(p, _uctModo));
}

// Filtro por tipo (grupo e categoria). Esfera fica no filtro de sempre.
function uctVisivel(p) {
  return !_uctOcultos.has('grupo:' + uctValor(p, 'grupo')) && !_uctOcultos.has('categoria:' + uctValor(p, 'categoria'));
}
function _uctEsferaLigada(v) {
  return v === 'federal' ? _ucEsfFed : v === 'estadual' ? _ucEsfEst : v === 'municipal' ? _ucEsfMun : true;
}

// Tipos presentes no arquivo, com contagem (ordem: grupo PI→US, esfera fixa, categoria por nº)
function uctTipos(modo) {
  const cont = new Map();
  (_ucGeojson?.features || []).forEach(f => { const v = uctValor(f.properties, modo); cont.set(v, (cont.get(v) || 0) + 1) });
  let lista = [...cont.entries()].map(([valor, n]) => ({ valor, n }));
  if (modo === 'grupo') lista.sort((a, b) => (a.valor === 'pi' ? -1 : 1) - (b.valor === 'pi' ? -1 : 1));
  else if (modo === 'esfera') lista.sort((a, b) => UCT_ESFERAS.indexOf(a.valor) - UCT_ESFERAS.indexOf(b.valor));
  else lista.sort((a, b) => b.n - a.n || a.valor.localeCompare(b.valor));
  return lista;
}

function _uctSalvar() {
  try {
    localStorage.setItem('siguc_uc_colorir', JSON.stringify(_uctModo));
    localStorage.setItem('siguc_uc_cores_tipo', JSON.stringify(_uctCores));
    localStorage.setItem('siguc_uc_tipo_ocultos', JSON.stringify([..._uctOcultos]));
  } catch (e) { }
  if (typeof _prefsAgendarSalvamento === 'function') _prefsAgendarSalvamento();
}
function _uctRedesenhar() {
  if (typeof _renderizarUC === 'function') _renderizarUC();
  if (typeof _atualizarLegendaMapa === 'function') _atualizarLegendaMapa();
  if (typeof renderCamadasHtml === 'function') renderCamadasHtml();
  if (typeof _ucStatsAtualizar === 'function' && typeof _ucsFeaturesVisiveis === 'function') _ucStatsAtualizar(_ucsFeaturesVisiveis());
}

// Bloco "Colorir por" (vai no corpo da seção de UCs)
function uctBlocoHTML() {
  const op = UCT_MODOS.map(([m, r]) => `<button type="button" role="radio" class="uct-op${m === _uctModo ? ' sel' : ''}" aria-checked="${m === _uctModo}" data-uct-modo="${m}">${r}</button>`).join('');
  return `<div class="uct">
    <div class="ap-rot">Colorir por</div>
    <div class="uct-ops" role="radiogroup" aria-label="Colorir as UCs por">${op}</div>
    <div id="uct-lista" class="uct-lista"></div>
  </div>`;
}

// Linhas do modo atual + mostra/esconde a lista por UC
function uctAtualizarPainel() {
  document.querySelectorAll('[data-uct-modo]').forEach(b => { const s = b.dataset.uctModo === _uctModo; b.classList.toggle('sel', s); b.setAttribute('aria-checked', s) });
  const ctrl = document.getElementById('uc-controles');
  if (ctrl && _ucGeojson) ctrl.style.display = _uctModo === 'uc' ? '' : 'none';
  const box = document.getElementById('uct-lista');
  if (!box) return;
  if (_uctModo === 'uc' || !_ucGeojson) { box.innerHTML = ''; return }
  const linhas = uctTipos(_uctModo).map(({ valor, n }) => {
    const chave = _uctModo + ':' + valor;
    const ligado = _uctModo === 'esfera' ? _uctEsferaLigada(valor) : !_uctOcultos.has(chave);
    const cor = uctCorTipo(_uctModo, valor);
    return `<div class="uct-linha${ligado ? '' : ' off'}">
      <label class="uct-chk"><input type="checkbox" data-uct-mostrar="${_uctEsc(chave)}"${ligado ? ' checked' : ''}>
        <span class="uct-nome">${_uctEsc(uctRotulo(_uctModo, valor))}</span></label>
      <span class="uct-n">${n}</span>
      <button type="button" class="uct-cor" style="background:${cor}" data-uct-cor="${_uctEsc(chave)}" title="Mudar a cor" aria-label="Mudar a cor de ${_uctEsc(uctRotulo(_uctModo, valor))}" aria-expanded="false"></button>
    </div>`;
  }).join('');
  // Ocultas uma a uma (modo "Cada UC") continuam valendo — avisa, nunca some sem explicação
  const indiv = [...document.querySelectorAll('[data-uc-nome]')].filter(e => !e.checked).length;
  box.innerHTML = linhas + (indiv ? `<div class="uct-aviso">${indiv} UC${indiv > 1 ? 's' : ''} ocultada${indiv > 1 ? 's' : ''} uma a uma — veja em "Cada UC".</div>` : '');
}

function _uctPaleta(chave, atual) {
  const cores = (typeof AP_CORES !== 'undefined' ? AP_CORES : []).map(([c, nome]) =>
    `<button type="button" class="ap-cor${c.toLowerCase() === String(atual).toLowerCase() ? ' sel' : ''}" style="background:${c}" data-uct-escolher="${c}" title="${nome}" aria-label="${nome}"></button>`).join('');
  return `<div class="uct-paleta" data-uct-paleta="${_uctEsc(chave)}">${cores}
    <label class="ap-cor-outra" title="Outra cor…"><span>Outra…</span><input type="color" value="${atual}" data-uct-outra></label></div>`;
}

function _uctDefinirCor(chave, cor) {
  const i = chave.indexOf(':'); const modo = chave.slice(0, i), v = chave.slice(i + 1);
  _uctCores[modo] = { ...(_uctCores[modo] || {}), [v]: cor };
  _uctSalvar();
  _uctRedesenhar();
}

document.addEventListener('click', ev => {
  const t = ev.target.closest && ev.target.closest('[data-uct-modo],[data-uct-cor],[data-uct-escolher]');
  if (!t) return;
  if (t.dataset.uctModo) {
    _uctModo = t.dataset.uctModo; _uctSalvar(); uctAtualizarPainel(); _uctRedesenhar();
  } else if (t.dataset.uctCor) {
    const linha = t.closest('.uct-linha');
    const aberta = linha.nextElementSibling?.classList.contains('uct-paleta');
    document.querySelectorAll('.uct-paleta').forEach(p => p.remove());
    document.querySelectorAll('[data-uct-cor]').forEach(b => b.setAttribute('aria-expanded', 'false'));
    if (!aberta) {
      linha.insertAdjacentHTML('afterend', _uctPaleta(t.dataset.uctCor, t.style.background ? _uctHexDe(t.style.background) : '#000000'));
      t.setAttribute('aria-expanded', 'true');
    }
  } else {
    const pal = t.closest('[data-uct-paleta]');
    _uctDefinirCor(pal.dataset.uctPaleta, t.dataset.uctEscolher);
    uctAtualizarPainel();
  }
});
document.addEventListener('input', ev => {
  if (!ev.target.matches || !ev.target.matches('[data-uct-outra]')) return;
  const pal = ev.target.closest('[data-uct-paleta]');
  _uctDefinirCor(pal.dataset.uctPaleta, ev.target.value);
  const btn = pal.previousElementSibling?.querySelector('[data-uct-cor]');
  if (btn) btn.style.background = ev.target.value;
});
document.addEventListener('change', ev => {
  if (!ev.target.matches || !ev.target.matches('[data-uct-mostrar]')) return;
  const chave = ev.target.dataset.uctMostrar, on = ev.target.checked;
  const i = chave.indexOf(':'); const modo = chave.slice(0, i), v = chave.slice(i + 1);
  if (modo === 'esfera') {
    // a esfera usa o filtro de sempre — marca a caixa original e deixa ela agir
    const el = document.getElementById('uc-esfera-' + v);
    if (el) { el.checked = on; if (typeof toggleUCEsfera === 'function') toggleUCEsfera() }
  } else {
    if (on) _uctOcultos.delete(chave); else _uctOcultos.add(chave);
    _uctSalvar(); _uctRedesenhar();
  }
  uctAtualizarPainel();
});

function _uctHexDe(rgb) {
  const m = String(rgb).match(/\d+/g); if (!m) return rgb;
  return '#' + m.slice(0, 3).map(x => (+x).toString(16).padStart(2, '0')).join('');
}

// Itens da legenda (tela e impressão) para os modos por tipo; null = modo "Cada UC"
function uctItensLegenda(feats, opacidade) {
  if (_uctModo === 'uc') return null;
  const presentes = new Set(feats.map(f => uctValor(f.properties, _uctModo)));
  return uctTipos(_uctModo).filter(t => presentes.has(t.valor)).map(t => ({
    simbolo: 'rect', cor: uctCorTipo(_uctModo, t.valor), opacidade, label: 'UC — ' + uctRotulo(_uctModo, t.valor),
  }));
}

// Preferências na nuvem (preferencias_mapa.dados)
function uctPrefsCapturar() { return { modo: _uctModo, cores: _uctCores, ocultos: [..._uctOcultos] } }
function uctPrefsAplicar(d) {
  if (!d || typeof d !== 'object') return;
  if (UCT_MODOS.some(m => m[0] === d.modo)) _uctModo = d.modo;
  if (d.cores && typeof d.cores === 'object') _uctCores = d.cores;
  if (Array.isArray(d.ocultos)) _uctOcultos = new Set(d.ocultos);
  try {
    localStorage.setItem('siguc_uc_colorir', JSON.stringify(_uctModo));
    localStorage.setItem('siguc_uc_cores_tipo', JSON.stringify(_uctCores));
    localStorage.setItem('siguc_uc_tipo_ocultos', JSON.stringify([..._uctOcultos]));
  } catch (e) { }
}
