/**
 * Captura screenshots do App Brigadas para a apresentação de treinamento.
 * Uso: node scripts/capturar-slides.js
 * Requer: servidor rodando em http://localhost:3456
 */

const { chromium } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const OUT = path.join(__dirname, '..', 'tmp', 'slides-screenshots');
fs.mkdirSync(OUT, { recursive: true });

const BASE = 'http://localhost:3456';
const VP = { width: 390, height: 844 };

async function shot(page, name) {
  const file = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: file, clip: { x: 0, y: 0, width: VP.width, height: VP.height } });
  console.log(`  ✓ ${name}.png`);
  return file;
}

async function showOnly(page, id) {
  await page.evaluate((id) => {
    document.querySelectorAll('.tela').forEach(t => t.hidden = true);
    const el = document.getElementById(id);
    if (el) el.hidden = false;
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
  }, id);
  await page.waitForTimeout(300);
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: VP });
  const page = await ctx.newPage();

  // ── TELA 1: LOGIN ─────────────────────────────────────────────
  console.log('Capturando telas do App Brigadas...');
  await page.goto(`${BASE}/pages/brigada.html`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  await page.evaluate(() => {
    document.querySelectorAll('.tela').forEach(t => t.hidden = true);
    document.getElementById('tela-login').hidden = false;
  });
  await page.waitForTimeout(200);
  await shot(page, '01-login');

  // ── TELA 2: PIN ───────────────────────────────────────────────
  await showOnly(page, 'tela-bloqueio');
  await page.evaluate(() => {
    document.getElementById('lock-nome').textContent = 'João Pedro Silva';
  });
  await shot(page, '02-pin');

  // ── TELA 3: HOME ──────────────────────────────────────────────
  await showOnly(page, 'tela-home');
  await page.evaluate(() => {
    document.getElementById('home-nome').textContent = 'João Pedro Silva';
    document.getElementById('home-saudacao').textContent = 'Bom dia,';
    document.getElementById('home-avatar-letra').textContent = 'JP';
    const chipBrigada = document.getElementById('home-brigada');
    chipBrigada.hidden = false;
    document.getElementById('home-brigada-nome').textContent = 'Brigada Juruá';
    document.getElementById('home-equipe-wrap').hidden = false;
    const sel = document.getElementById('home-equipe');
    sel.innerHTML = '<option value="A" selected>Equipe A</option><option value="B">Equipe B</option><option value="C">Equipe C</option>';
    document.getElementById('gps-coords').textContent = '-9.0238, -67.8072';
    document.getElementById('gps-municipio').textContent = 'Cruzeiro do Sul — AC';
    document.getElementById('conn-texto').textContent = 'Online';
    document.getElementById('gps-status').textContent = '±8m';
    // Make faixa logos visible
    document.querySelectorAll('.faixa-logo-chip').forEach(el => el.hidden = false);
  });
  await shot(page, '03-home');

  // ── TELA 4: FORMULÁRIO (parte 1) ─────────────────────────────
  await showOnly(page, 'tela-form');
  await page.evaluate(() => {
    document.getElementById('form-natureza-label').textContent = 'Combate';
    document.getElementById('form-gps-coords').textContent = '-9.0238, -67.8072';
    document.getElementById('form-gps-acc').textContent = '±5m';
    const atv = document.getElementById('f-atividade');
    atv.innerHTML = '<option value="combate_incendio" selected>Combate a incêndio</option>';
    document.getElementById('f-origem').innerHTML = `
      <option value="">Selecione…</option>
      <option value="denuncia_193" selected>Denúncia anônima / 193</option>
      <option value="informacao_populares">Informação de populares</option>
      <option value="ronda_brigada">Ronda da brigada</option>`;
    document.getElementById('f-duracao').value = '3.5';
    document.getElementById('f-area').value = '12.50';
    document.getElementById('f-obs').value = 'Incêndio em área de floresta próximo ao rio. Equipe utilizou abafadores e bombas costais.';
    document.getElementById('foto-count-label').textContent = '(2/5)';
    document.getElementById('fauna-count-label').textContent = '(1)';
  });
  await shot(page, '04-form-p1');

  // ── TELA 5: FORMULÁRIO (parte 2 — fotos + fauna + salvar) ────
  await page.evaluate(() => {
    const grid = document.getElementById('foto-grid');
    grid.innerHTML = `
      <div style="width:80px;height:80px;background:#1a3a20;border-radius:8px;display:inline-block;margin:4px;position:relative;border:2px solid #52B788">
        <span style="position:absolute;top:2px;right:2px;background:#52B788;color:#fff;font-size:10px;padding:1px 5px;border-radius:4px">✓</span>
      </div>
      <div style="width:80px;height:80px;background:#1a3a20;border-radius:8px;display:inline-block;margin:4px;position:relative;border:2px solid #52B788">
        <span style="position:absolute;top:2px;right:2px;background:#52B788;color:#fff;font-size:10px;padding:1px 5px;border-radius:4px">✓</span>
      </div>`;
    const faunaLista = document.getElementById('fauna-lista');
    faunaLista.innerHTML = `
      <div style="background:#1a3a20;border-radius:10px;padding:10px 14px;margin-top:8px;display:flex;gap:10px;align-items:center">
        <img src="/pwa/icons/fauna/mamifero.png" style="width:36px;height:36px;object-fit:contain">
        <div>
          <div style="font-weight:600;color:#f4efe6">Bradypus tridactylus</div>
          <div style="font-size:12px;color:#52B788">Resgate · Ferido · 1 ind.</div>
        </div>
      </div>`;
    document.documentElement.scrollTop = 700;
  });
  await page.waitForTimeout(300);
  await shot(page, '05-form-p2');

  // ── TELA 6: FAUNA ─────────────────────────────────────────────
  await showOnly(page, 'tela-fauna');
  await page.evaluate(() => {
    const mamBtn = document.querySelector('[data-v="mamifero"]');
    if (mamBtn) {
      mamBtn.style.outline = '3px solid #52B788';
      mamBtn.style.background = '#1a4a22';
    }
    document.getElementById('f-fauna-especie').value = 'Bradypus tridactylus (Preguiça-de-três-dedos)';
    document.getElementById('f-fauna-tipo').innerHTML = '<option value="resgate" selected>Resgate</option>';
    document.getElementById('f-fauna-condicao').innerHTML = '<option value="ferido" selected>Ferido</option>';
    document.getElementById('f-fauna-causa').innerHTML = '<option value="incendio" selected>Incêndio</option>';
    document.getElementById('f-fauna-destinacao').innerHTML = '<option value="cetas" selected>CETAS</option>';
    document.getElementById('f-fauna-qtd').value = '1';
    document.getElementById('f-fauna-faixa').innerHTML = '<option value="adulto" selected>Adulto</option>';
  });
  await page.waitForTimeout(400);
  await shot(page, '06-fauna');

  // ── TELA 7: FILA ──────────────────────────────────────────────
  await showOnly(page, 'tela-fila');
  await page.evaluate(() => {
    document.getElementById('stat-pendentes').textContent = '4';
    document.getElementById('stat-enviando').textContent = '1';
    document.getElementById('stat-confirmados').textContent = '12';
    const colors = { combate: 'EF5B3C', prevencao: '52B788', monitoramento: '3B82C4' };
    const statusColors = { pendente: 'C9A84C', enviando: '3B82C4', confirmado: '52B788' };
    const items = [
      { nat: 'combate', atividade: 'Combate a incêndio', data: '17/06 14:23', fotos: 3, size: '4,2 MB', status: 'pendente' },
      { nat: 'prevencao', atividade: 'Aceiro manual', data: '17/06 11:45', fotos: 2, size: '2,8 MB', status: 'pendente' },
      { nat: 'monitoramento', atividade: 'Monitoramento de fauna', data: '17/06 09:10', fotos: 1, size: '1,1 MB', status: 'enviando' },
      { nat: 'combate', atividade: 'Rescaldo', data: '16/06 16:30', fotos: 4, size: '5,6 MB', status: 'pendente' },
      { nat: 'prevencao', atividade: 'Educação ambiental', data: '16/06 10:00', fotos: 0, size: '< 1 MB', status: 'confirmado' },
      { nat: 'combate', atividade: 'Combate a incêndio', data: '15/06 08:45', fotos: 5, size: '7,1 MB', status: 'confirmado' },
    ];
    const statusLabels = { pendente: 'Pendente', enviando: 'Enviando…', confirmado: 'Confirmado' };
    document.getElementById('fila-lista').innerHTML = items.map(it => `
      <div style="background:#1a3a20;border-radius:12px;padding:12px 14px;margin-bottom:10px;display:flex;align-items:center;gap:12px">
        <div style="width:10px;height:10px;border-radius:50%;background:#${colors[it.nat]};flex-shrink:0"></div>
        <div style="flex:1">
          <div style="font-weight:600;color:#f4efe6;font-size:.9rem">${it.atividade}</div>
          <div style="font-size:.75rem;color:#9CA3AF;margin-top:2px">${it.data} · ${it.fotos} foto${it.fotos !== 1 ? 's' : ''} · ${it.size}</div>
        </div>
        <span style="background:#${statusColors[it.status]}22;color:#${statusColors[it.status]};border-radius:20px;padding:3px 10px;font-size:.72rem;font-weight:600">${statusLabels[it.status]}</span>
      </div>`).join('');
  });
  await shot(page, '07-fila');

  // ── TELA 8: DADOS (KPIs + gráfico natureza) ───────────────────
  await showOnly(page, 'tela-dados');
  await page.evaluate(() => {
    document.getElementById('dados-atualizado').textContent = 'Atualizado às 14:30 de hoje';
    document.getElementById('kpi-total').textContent = '47';
    document.getElementById('kpi-mes').textContent = '12';
    document.getElementById('kpi-area').textContent = '183';
    document.getElementById('kpi-fauna').textContent = '28';
    document.getElementById('chart-natureza').innerHTML = `
      <div style="margin-bottom:10px">
        <div style="display:flex;justify-content:space-between;font-size:.85rem;margin-bottom:4px"><span>Combate</span><span style="color:#EF5B3C;font-weight:700">22</span></div>
        <div style="background:#1a3a20;border-radius:4px;height:12px"><div style="background:#EF5B3C;width:47%;height:12px;border-radius:4px"></div></div>
      </div>
      <div style="margin-bottom:10px">
        <div style="display:flex;justify-content:space-between;font-size:.85rem;margin-bottom:4px"><span>Prevenção</span><span style="color:#52B788;font-weight:700">18</span></div>
        <div style="background:#1a3a20;border-radius:4px;height:12px"><div style="background:#52B788;width:38%;height:12px;border-radius:4px"></div></div>
      </div>
      <div>
        <div style="display:flex;justify-content:space-between;font-size:.85rem;margin-bottom:4px"><span>Monitoramento</span><span style="color:#3B82C4;font-weight:700">7</span></div>
        <div style="background:#1a3a20;border-radius:4px;height:12px"><div style="background:#3B82C4;width:15%;height:12px;border-radius:4px"></div></div>
      </div>`;
    // Hide empty chart sections
    ['chart-meses','chart-fauna-cruzado','chart-atividade','chart-fauna','chart-validacao','chart-equipes','chart-brigadistas'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.closest('.form-section').style.display = 'none';
    });
    // Hide brigade section
    const brig = document.querySelector('[data-icon="award"]');
    if (brig) brig.closest('.form-section').style.display = 'none';
  });
  await shot(page, '08-dados-kpis');

  // ── TELA 9: DADOS (ranking brigada) ───────────────────────────
  await showOnly(page, 'tela-dados');
  await page.evaluate(() => {
    document.getElementById('dados-atualizado').textContent = 'Atualizado às 14:30 de hoje';
    // Hide KPI cards
    document.querySelector('.dados-grid').style.display = 'none';
    document.querySelectorAll('.form-section').forEach(s => s.style.display = 'none');
    // Show brigade perf
    document.getElementById('bri-n').textContent = '47';
    document.getElementById('bri-area').textContent = '183';
    document.getElementById('bri-fauna').textContent = '28';
    document.getElementById('bri-horas').textContent = '124';
    const brig = document.querySelector('[data-icon="award"]');
    if (brig) {
      const sec = brig.closest('.form-section');
      sec.style.display = '';
      sec.querySelector('.dados-grid').style.display = '';
    }
    const equipes = document.getElementById('chart-equipes');
    equipes.closest('.form-section').style.display = '';
    equipes.innerHTML = `
      <div style="margin-bottom:10px">
        <div style="display:flex;justify-content:space-between;font-size:.85rem;margin-bottom:4px"><span>🥇 Equipe A</span><span style="color:#C9A84C;font-weight:700">19 reg.</span></div>
        <div style="background:#1a3a20;border-radius:4px;height:12px"><div style="background:#C9A84C;width:75%;height:12px;border-radius:4px"></div></div>
      </div>
      <div style="margin-bottom:10px">
        <div style="display:flex;justify-content:space-between;font-size:.85rem;margin-bottom:4px"><span>🥈 Equipe B</span><span style="color:#9CA3AF;font-weight:700">16 reg.</span></div>
        <div style="background:#1a3a20;border-radius:4px;height:12px"><div style="background:#9CA3AF;width:60%;height:12px;border-radius:4px"></div></div>
      </div>
      <div>
        <div style="display:flex;justify-content:space-between;font-size:.85rem;margin-bottom:4px"><span>🥉 Equipe C</span><span style="color:#9CA3AF;font-weight:700">12 reg.</span></div>
        <div style="background:#1a3a20;border-radius:4px;height:12px"><div style="background:#9CA3AF;width:45%;height:12px;border-radius:4px"></div></div>
      </div>`;
    const brigadistas = document.getElementById('chart-brigadistas');
    brigadistas.closest('.form-section').style.display = '';
    brigadistas.innerHTML = `
      <div style="margin-bottom:10px">
        <div style="display:flex;justify-content:space-between;font-size:.85rem;margin-bottom:4px"><span>1. Ana Lima</span><span style="color:#C9A84C;font-weight:700">11</span></div>
        <div style="background:#1a3a20;border-radius:4px;height:12px"><div style="background:#C9A84C;width:85%;height:12px;border-radius:4px"></div></div>
      </div>
      <div style="margin-bottom:10px">
        <div style="display:flex;justify-content:space-between;font-size:.85rem;margin-bottom:4px"><span>2. João Pedro Silva ★</span><span style="color:#52B788;font-weight:700">9</span></div>
        <div style="background:#1a3a20;border-radius:4px;height:12px"><div style="background:#52B788;width:70%;height:12px;border-radius:4px"></div></div>
      </div>
      <div>
        <div style="display:flex;justify-content:space-between;font-size:.85rem;margin-bottom:4px"><span>3. Carlos Souza</span><span style="color:#9CA3AF;font-weight:700">8</span></div>
        <div style="background:#1a3a20;border-radius:4px;height:12px"><div style="background:#9CA3AF;width:62%;height:12px;border-radius:4px"></div></div>
      </div>`;
  });
  await shot(page, '09-dados-ranking');

  // ── TELA 10: CONFIG ───────────────────────────────────────────
  await showOnly(page, 'tela-config');
  await page.evaluate(() => {
    document.getElementById('avatar-letra').textContent = 'JP';
    document.getElementById('config-nome-brig').textContent = 'João Pedro Silva';
    document.getElementById('config-brigada-nome').textContent = 'Brigada Juruá — Equipe A';
    document.getElementById('quota-fill').style.width = '34%';
    document.getElementById('quota-texto').textContent = '34 MB de 100 MB usados';
    document.getElementById('app-versao').textContent = 'Versão 3.1.0';
    document.getElementById('app-copyright').textContent = '© 2026 SEMA-AC / DIMA';
    if (typeof bIconsAplicar === 'function') bIconsAplicar(document.getElementById('tela-config'));
  });
  await page.waitForTimeout(300);
  await shot(page, '10-config');

  // ── TELA 11: INSTALAR ─────────────────────────────────────────
  await page.goto(`${BASE}/pages/instalar-brigadas.html`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  await shot(page, '11-instalar');

  await browser.close();
  console.log(`\nScreenshots salvas em: ${OUT}`);
  console.log('Total:', fs.readdirSync(OUT).length, 'arquivos');
})();
