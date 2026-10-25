// ── Bloco "Aparência" das camadas territoriais (Mapa das UCs) ───────
// Fonte única do controle de cor/traço/espessura/opacidade/nomes das
// seções de UC, Terras Indígenas e Projetos de Assentamento (guia Áreas
// Territoriais de pages/mapa.html). Cada camada continua com o PRÓPRIO
// handler de estilo — o bloco só desenha os controles com os ids de
// sempre e, nas amostras de cor, troca o valor do <input type="color"> e
// dispara o evento que o handler já escuta. Assim nada do que aplica e
// salva o estilo foi reescrito.
//
// Recolhido por padrão (<details>). Ao abrir, o painel fica estreito e o
// mapa enquadra a camada à direita dele (apAoAlternar), para ver o efeito
// da mudança sem o painel cobrindo os polígonos.

// Okabe-Ito (paleta segura para daltonismo) + branco, que é o que se lê
// sobre o satélite.
const AP_CORES = [
  ['#E69F00', 'Laranja'], ['#56B4E9', 'Azul-claro'], ['#009E73', 'Verde-azulado'], ['#F0E442', 'Amarelo'],
  ['#0072B2', 'Azul'], ['#D55E00', 'Vermelhão'], ['#CC79A7', 'Rosa'], ['#FFFFFF', 'Branco'],
];
// Handler de cada <input type="color">, por id (preenchido em apBlocoHTML)
const _apHandlers = {};
const AP_TRACOS = [['', 'Sólido'], ['6 4', 'Tracejado'], ['2 4', 'Pontilhado'], ['8 4', 'Traço longo'], ['8 4 2 4', 'Traço-ponto']];

// Camadas para enquadrar: { chave: () => L.Layer|null } — a página registra.
const AP_CAMADAS = {};
function apRegistrarCamada(chave, fn) { AP_CAMADAS[chave] = fn }

function _apEsc(s) { return String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])) }
function _apHex(v) { return /^#[0-9a-f]{6}$/i.test(String(v || '')) ? String(v).toLowerCase() : '' }

function _apAmostrasCor(alvo, valor, extra) {
  const atual = _apHex(valor);
  const bt = AP_CORES.map(([c, nome]) => `<button type="button" class="ap-cor${atual === c.toLowerCase() ? ' sel' : ''}" style="background:${c}"
      data-ap-alvo="${alvo}" data-ap-cor="${c}" title="${nome}" aria-label="${nome}" aria-pressed="${atual === c.toLowerCase()}"></button>`).join('');
  return `<div class="ap-cores" role="group">${extra || ''}${bt}
    <label class="ap-cor-outra" title="Outra cor…"><span>Outra…</span>
      <input type="color" id="${alvo}" value="${atual || '#000000'}" oninput="${_apHandlers[alvo] || ''}"></label></div>`;
}

/**
 * cfg = {
 *   chave: 'uc'|'ti'|'pa', cor (acento),
 *   linha: { id, valor, ao, propria? },   // propria = {ativa, ao} → amostra "Cor de cada UC"
 *   fill?: { id, valor, ao },
 *   dash:  { id, valor, ao },
 *   peso:  { id, valor, ao, opcoes: [[valor, rótulo]] },
 *   opac:  { id, valorId, valor, ao },
 *   nomes: { id, valor, ao, rotulo },
 *   padrao: { [id]: valor },              // "Restaurar padrão"
 *   aposRestaurar?: 'nomeDaFuncao',
 * }
 */
function apBlocoHTML(cfg) {
  const { chave, linha, fill, dash, peso, opac, nomes } = cfg;
  _apHandlers[linha.id] = linha.ao;
  if (fill) _apHandlers[fill.id] = fill.ao;
  const propria = linha.propria
    ? `<button type="button" class="ap-cor ap-cor-propria${linha.propria.ativa ? ' sel' : ''}" data-ap-propria="${linha.propria.ao}"
        title="${_apEsc(linha.propria.rotulo || 'Cor de cada UC')}" aria-label="${_apEsc(linha.propria.rotulo || 'Cor de cada UC')}" aria-pressed="${!!linha.propria.ativa}"></button>` : '';
  const opPeso = peso.opcoes.map(([v, r]) => `<option value="${v}"${String(peso.valor) === String(v) ? ' selected' : ''}>${r}</option>`).join('');
  const opDash = AP_TRACOS.map(([v, r]) => `<option value="${v}"${String(dash.valor ?? '') === v ? ' selected' : ''}>${r}</option>`).join('');
  const op = Math.round(parseFloat(opac.valor) || 0);
  return `<details class="ap-bloco" data-ap-chave="${chave}" style="--ap-acento:${cfg.cor}" ontoggle="apAoAlternar(this)"
      data-ap-padrao="${_apEsc(JSON.stringify(cfg.padrao || {}))}" data-ap-apos="${cfg.aposRestaurar || ''}">
    <summary class="ap-sum"><span>Aparência</span>${apAmostraSVG(cfg, true)}</summary>
    <div class="ap-corpo">
      <div class="ap-amostra-grande">${apAmostraSVG(cfg)}</div>
      <div class="ap-rot">${fill ? 'Cor da linha' : 'Cor da borda'}</div>
      ${_apAmostrasCor(linha.id, linha.propria?.ativa ? '' : linha.valor, propria)}
      ${fill ? `<div class="ap-rot">Cor de preenchimento</div>${_apAmostrasCor(fill.id, fill.valor)}` : ''}
      <div class="ap-grade">
        <label class="ap-campo"><span class="ap-rot">Traço</span>
          <select id="${dash.id}" onchange="${dash.ao}">${opDash}</select></label>
        <label class="ap-campo"><span class="ap-rot">Espessura</span>
          <select id="${peso.id}" onchange="${peso.ao}">${opPeso}</select></label>
      </div>
      <label class="ap-campo"><span class="ap-rot">Opacidade do preenchimento <span id="${opac.valorId}" class="ap-val">${op}%</span></span>
        <input type="range" id="${opac.id}" min="0" max="100" value="${op}" oninput="${opac.ao}"></label>
      <label class="ap-check"><input type="checkbox" id="${nomes.id}"${nomes.valor ? ' checked' : ''} onchange="${nomes.ao}"> ${nomes.rotulo}</label>
      <button type="button" class="ap-restaurar" data-ap-restaurar>Restaurar padrão</button>
    </div>
  </details>`;
}

// Amostra desenhada: preenchimento com a opacidade + a linha com cor,
// traço e espessura reais. Lida dos controles quando eles já existem.
function apAmostraSVG(cfg, mini) {
  const d = _apLer(cfg);
  const w = mini ? 34 : 220, h = mini ? 14 : 34, p = mini ? 2 : 5;
  const multi = d.propria
    ? `<defs><linearGradient id="ap-g-${cfg.chave}${mini ? 'm' : ''}"><stop offset="0" stop-color="#1F4E2C"/><stop offset=".5" stop-color="#2563eb"/><stop offset="1" stop-color="#dc2626"/></linearGradient></defs>` : '';
  const traco = d.propria ? `url(#ap-g-${cfg.chave}${mini ? 'm' : ''})` : d.cor;
  const peso = Math.min(parseFloat(d.peso) || 1.5, mini ? 3 : 6);
  return `<svg class="ap-svg${mini ? ' mini' : ''}" data-ap-svg="${mini ? 'mini' : 'grande'}" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true">${multi}
    <rect x="${p}" y="${p}" width="${w - 2 * p}" height="${h - 2 * p}" rx="${mini ? 2 : 4}" fill="${d.fill}" fill-opacity="${(parseFloat(d.opac) || 0) / 100}"
      stroke="${traco}" stroke-width="${peso}" ${d.dash ? `stroke-dasharray="${d.dash}"` : ''}/></svg>`;
}

function _apLer(cfg) {
  const el = id => document.getElementById(id);
  const v = (o, campo = 'value') => (o && el(o.id)) ? el(o.id)[campo] : (o?.valor ?? '');
  return {
    cor: _apHex(v(cfg.linha)) || cfg.cor,
    propria: cfg.linha.propria ? !!cfg.linha.propria.ativa : false,
    fill: cfg.fill ? (_apHex(v(cfg.fill)) || cfg.cor) : (_apHex(v(cfg.linha)) || cfg.cor),
    dash: v(cfg.dash), peso: v(cfg.peso), opac: v(cfg.opac),
  };
}

// Redesenha as amostras do bloco a partir dos controles
function apAtualizar(bloco) {
  if (!bloco) return;
  const q = s => bloco.querySelector(s);
  const ids = [...bloco.querySelectorAll('input[type=color]')].map(e => e.id);
  const propria = !!q('.ap-cor-propria.sel');
  const corEl = document.getElementById(ids[0]);
  const fillEl = ids[1] ? document.getElementById(ids[1]) : corEl;
  const cfg = {
    chave: bloco.dataset.apChave, cor: getComputedStyle(bloco).getPropertyValue('--ap-acento').trim() || '#1F4E2C',
    linha: { id: ids[0], propria: propria ? { ativa: true } : null },
    fill: fillEl ? { id: fillEl.id } : null,
    dash: { id: q('select')?.id }, peso: { id: bloco.querySelectorAll('select')[1]?.id },
    opac: { id: q('input[type=range]')?.id },
  };
  if (!cfg.linha.propria) delete cfg.linha.propria;
  const g = q('[data-ap-svg="grande"]'), m = q('[data-ap-svg="mini"]');
  if (g) g.outerHTML = apAmostraSVG(cfg);
  if (m) m.outerHTML = apAmostraSVG(cfg, true);
  // marca a amostra de cor escolhida
  bloco.querySelectorAll('.ap-cores').forEach(grp => {
    const inp = grp.querySelector('input[type=color]');
    const val = _apHex(inp?.value);
    grp.querySelectorAll('[data-ap-cor]').forEach(b => {
      const sel = !(propria && grp === bloco.querySelector('.ap-cores')) && b.dataset.apCor.toLowerCase() === val;
      b.classList.toggle('sel', sel); b.setAttribute('aria-pressed', sel);
    });
  });
}

function _apDisparar(el, tipo) { el.dispatchEvent(new Event(tipo, { bubbles: true })) }

document.addEventListener('click', ev => {
  const t = ev.target.closest && ev.target.closest('[data-ap-cor],[data-ap-propria],[data-ap-restaurar]');
  if (!t) return;
  const bloco = t.closest('.ap-bloco');
  if (t.dataset.apCor) {
    const inp = document.getElementById(t.dataset.apAlvo);
    if (!inp) return;
    const prop = bloco?.querySelector('.ap-cor-propria');
    if (prop && inp === bloco.querySelector('input[type=color]')) { prop.classList.remove('sel'); prop.setAttribute('aria-pressed', 'false') }
    inp.value = t.dataset.apCor;
    _apDisparar(inp, 'input');
  } else if (t.dataset.apPropria !== undefined) {
    t.classList.add('sel'); t.setAttribute('aria-pressed', 'true');
    const fn = window[t.dataset.apPropria]; if (typeof fn === 'function') fn();
  } else if (bloco) {
    let padrao = {}; try { padrao = JSON.parse(bloco.dataset.apPadrao || '{}') } catch (e) { }
    Object.entries(padrao).forEach(([id, val]) => {
      const el = document.getElementById(id); if (!el) return;
      if (el.type === 'checkbox') { el.checked = !!val; _apDisparar(el, 'change') }
      else { el.value = val; _apDisparar(el, el.tagName === 'SELECT' ? 'change' : 'input') }
    });
    const apos = window[bloco.dataset.apApos]; if (typeof apos === 'function') apos();
  }
  apAtualizar(bloco);
});
// "Outra cor…" na linha da UC desliga a "Cor de cada UC" ANTES do handler
// da camada ler o estado (captura roda antes do oninput do alvo).
document.addEventListener('input', ev => {
  const bloco = ev.target.closest && ev.target.closest('.ap-bloco');
  if (!bloco || ev.target !== bloco.querySelector('input[type=color]')) return;
  const prop = bloco.querySelector('.ap-cor-propria.sel');
  if (prop) { prop.classList.remove('sel'); prop.setAttribute('aria-pressed', 'false') }
}, true);
['input', 'change'].forEach(tipo => document.addEventListener(tipo, ev => {
  const bloco = ev.target.closest && ev.target.closest('.ap-bloco');
  if (bloco) apAtualizar(bloco);
  if (bloco && typeof window.areasAtualizarCabecalhos === 'function') window.areasAtualizarCabecalhos();
}));

// Aparência aberta ⇒ painel estreito + mapa enquadrando a camada à direita
function apAoAlternar(det) {
  const dd = det.closest('.mlb-dropdown');
  if (dd) dd.classList.toggle('mlb-estreito', !!dd.querySelector('.ap-bloco[open]'));
  if (typeof window._layerbarPosicionarDropdown === 'function') window._layerbarPosicionarDropdown();
  if (!det.open || typeof mapaL === 'undefined' || !mapaL) return;
  const camada = AP_CAMADAS[det.dataset.apChave]?.();
  if (!camada || typeof camada.getBounds !== 'function') return;
  const b = camada.getBounds();
  if (!b || !b.isValid || !b.isValid()) return;
  requestAnimationFrame(() => {
    const m = mapaL.getContainer().getBoundingClientRect();
    const r = dd ? dd.getBoundingClientRect() : null;
    const esq = r ? Math.max(0, Math.min(r.right - m.left, m.width * 0.6)) + 16 : 16;
    mapaL.fitBounds(b, { paddingTopLeft: [esq, 16], paddingBottomRight: [16, 16], animate: false });
  });
}
