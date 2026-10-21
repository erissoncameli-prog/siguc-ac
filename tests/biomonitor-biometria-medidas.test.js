// ── SIGUC Biomonitor · biometria individual — medidas do casco ────────
// Executar: npx playwright test tests/biomonitor-biometria-medidas.test.js
//
// Migration 366: a biometria do filhote ganhou a LARGURA DO PLASTRÃO,
// medida própria (maior largura da placa ventral), nunca copiada da
// largura da carapaça — a razão plastrão/carapaça daria 1 por construção.
// E "Comprimento" passou a se chamar "Comprimento da carapaça" (só o
// rótulo; a coluna segue comprimento_cm).
//
// Guarda de CONSISTÊNCIA DE FONTE: cada medida tem de atravessar o
// caminho inteiro (formulário → IndexedDB → envio → download → PDF).
// Uma coluna esquecida em um desses pontos some em silêncio — o envio
// grava null e o download apaga o valor local na próxima sincronização.

const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

const raiz = path.join(__dirname, '..');
const ler = f => fs.readFileSync(path.join(raiz, f), 'utf8');

const MEDIDAS = [
  'comprimento_cm', 'largura_carapaca_cm',
  'comprimento_plastrao_cm', 'largura_plastrao_cm', 'peso_g',
];

function trecho(src, inicio, fim) {
  const i = src.indexOf(inicio);
  expect(i, `trecho "${inicio}" não encontrado`).toBeGreaterThanOrEqual(0);
  const j = src.indexOf(fim, i + inicio.length);
  return src.slice(i, j < 0 ? undefined : j);
}

test('formulário: largura do plastrão existe e o comprimento é da carapaça', () => {
  const html = ler('pages/biomonitor.html');
  const form = trecho(html, 'Biometria — Filhote', 'bio-bio-ind-obs');
  expect(form).toContain('id="bio-bio-ind-larg-plastrao"');
  expect(form).toContain('Largura do plastrão (cm)');
  expect(form).toContain('Comprimento da carapaça (cm)');
  expect(form).not.toMatch(/>Comprimento \(cm\)</);
  expect(html).toContain('Compr. médio da carapaça (cm)');
});

test('salvar no app grava as 5 medidas, sem copiar carapaça para plastrão', () => {
  const src = ler('js/biomonitor-quelonios.js');
  const fn = trecho(src, 'async function bioSalvarBiometriaInd', '\n}\n');
  for (const c of MEDIDAS) expect(fn, c).toMatch(new RegExp(`\\b${c}:`));
  expect(fn).toContain("getElementById('bio-bio-ind-larg-plastrao')");
  // nunca derivada da largura da carapaça
  expect(fn).not.toMatch(/largura_plastrao_cm:\s*largura\b/);
  expect(fn).not.toMatch(/largPlastrao\s*=\s*.*largura\b(?!_)/);
});

test('sync: envio e download carregam as 5 medidas', () => {
  const src = ler('js/biomonitor-sync.js');
  const envio = trecho(src, 'Biometria individual…', 'bioOfflineAtualizarSync(');
  const pull = trecho(src, 'async function bioSyncPullBiometriasInd', '\n}\n');
  for (const c of MEDIDAS) {
    expect(envio, `envio: ${c}`).toMatch(new RegExp(`\\b${c}:`));
    expect(pull, `select do download: ${c}`).toMatch(new RegExp(`[\\s,]${c}[,\\s]`));
    expect(pull, `gravação do download: ${c}`).toMatch(new RegExp(`\\b${c}:`));
  }
});

test('PDF por ninho e tabela da mesa mostram a largura do plastrão', () => {
  const pdf = ler('js/biomonitor-relatorio-ninho.js');
  expect(pdf).toMatch(/from\('biometrias_individuais'\)\s*\.select\('[^']*largura_plastrao_cm/);
  expect(pdf).toContain('larg. plastrão');
  const mesa = ler('pages/biomonitor-bercarios.html');
  expect(mesa).toContain('<th>Larg. plastrão</th>');
  expect(mesa).toContain('ultimo_largura_plastrao_cm');
});

test('migration 366: coluna, CHECK e view com a coluna nova ao final', () => {
  const sql = ler('supabase/migrations/366_biometria_largura_plastrao.sql');
  expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS largura_plastrao_cm numeric\(5,1\)/);
  expect(sql).toMatch(/OR largura_plastrao_cm IS NOT NULL/);
  expect(sql).toMatch(/WITH \(security_invoker = true\)/);
  // coluna nova depois de f.anomalia (CREATE OR REPLACE VIEW só acrescenta no fim)
  expect(sql).toMatch(/f\.anomalia,\s*ub\.largura_plastrao_cm\s+AS ultimo_largura_plastrao_cm\s*FROM/);
});
