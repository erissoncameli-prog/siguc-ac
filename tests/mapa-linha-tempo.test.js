// ── Mapa das UCs · linha do tempo por ano ────────────────────────
// Executar: npx playwright test tests/mapa-linha-tempo.test.js
// (não precisa de servidor — carrega js/mapa-linha-tempo.js direto)
//
// POR QUE ESTE TESTE EXISTE: o slider da linha do tempo vai até o ano
// corrente, mas os totais eram constantes no código paradas em 2024 —
// 2025 e 2026 apareciam como "—" sem explicação nenhuma. Agora os
// totais vêm do banco (migration 340) e js/mapa-linha-tempo.js decide o
// que mostrar. O que este teste trava:
//  - ano com dado mostra os números do banco, não de constante;
//  - ano sem foco nenhum no sistema DIZ isso (nunca "—" mudo);
//  - ano corrente aparece como PARCIAL, com o período coberto;
//  - PRODES não publicado diz "ainda não publicado", nunca vira zero;
//  - antes de 2008 continua dizendo que o PRODES anual começa em 2008;
//  - resposta vazia/erro do banco (fail-open) não quebra nada.

const fs = require('node:fs');
const path = require('node:path');
const { test, expect } = require('@playwright/test');

const CHROMIUM_PATH = '/opt/pw-browsers/chromium';
if (fs.existsSync(CHROMIUM_PATH)) {
  test.use({ launchOptions: { executablePath: CHROMIUM_PATH } });
}

const ARQ = path.join(__dirname, '..', 'js', 'mapa-linha-tempo.js');
const HOJE = '2026-09-23T12:00:00';

async function carregar(page) {
  await page.setContent('<html><body></body></html>');
  await page.addScriptTag({ path: ARQ });
}

const FOCOS = [
  { ano: 2024, focos: 47805, origem: 'serie_historica', periodo_ini: '2024-07-01', periodo_fim: '2024-11-04' },
  { ano: 2026, focos: 1660,  origem: 'firms_diario',    periodo_ini: '2026-07-03', periodo_fim: '2026-09-23' },
];
const PRODES = [
  { ano: 2024, poligonos: 5699, area_ha: '41135' },
  { ano: 2025, poligonos: 5096, area_ha: '27546' },
];

async function descrever(page, ano) {
  return page.evaluate(({ ano, FOCOS, PRODES, HOJE }) => {
    const f = tlIndexarPorAno(FOCOS), p = tlIndexarPorAno(PRODES);
    return tlDescreverAno(ano, f[ano], p[ano], new Date(HOJE));
  }, { ano, FOCOS, PRODES, HOJE });
}

test('ano fechado com os dois dados: números vêm do banco', async ({ page }) => {
  await carregar(page);
  const d = await descrever(page, 2024);
  expect(d.focosN).toBe(47805);
  expect(d.desmatN).toBe(5699);
  expect(d.areaHa).toBe(41135);
  expect(d.avisos.join(' ')).toContain('01/07/2024 a 04/11/2024');
  expect(d.avisos.join(' ')).not.toMatch(/parcia/i);
});

test('2025 sem focos no sistema: diz isso, e mostra o PRODES que existe', async ({ page }) => {
  await carregar(page);
  const d = await descrever(page, 2025);
  expect(d.focosN).toBeNull();
  expect(d.avisos.join(' ')).toContain('Sem registro de focos para 2025');
  expect(d.desmatN).toBe(5096);
  expect(d.areaHa).toBe(27546);
});

test('ano corrente: focos parciais com período, PRODES "ainda não publicado"', async ({ page }) => {
  await carregar(page);
  const d = await descrever(page, 2026);
  expect(d.focosN).toBe(1660);
  const txt = d.avisos.join(' ');
  expect(txt).toContain('Focos parciais de 2026');
  expect(txt).toContain('03/07/2026 a 23/09/2026');
  expect(d.desmatN).toBeNull();
  expect(d.areaHa).toBeNull();
  expect(txt).toContain('PRODES 2026 ainda não publicado');
});

test('antes de 2008: aviso de início do PRODES anual', async ({ page }) => {
  await carregar(page);
  const d = await descrever(page, 2005);
  expect(d.avisos.join(' ')).toContain('PRODES anual disponível a partir de 2008');
});

test('fail-open: resumo vazio ou nulo não quebra', async ({ page }) => {
  await carregar(page);
  const d = await page.evaluate(() => {
    const f = tlIndexarPorAno(null), p = tlIndexarPorAno(undefined);
    return tlDescreverAno(2024, f[2024], p[2024]);
  });
  expect(d.focosN).toBeNull();
  expect(d.desmatN).toBeNull();
  expect(d.avisos.length).toBe(2);
});
