// ── SIGUC Biomonitor · gestão de monitores — modal de edição ──────────
// Executar: npx playwright test tests/biomonitor-admin-monitor.test.js
//
// Caso real: campos corrigidos depois do cadastro (CPF, data de início)
// "não salvavam". A causa não era RLS nem o UPDATE — era a consulta que
// alimenta a tela trazer só 8 das 17 colunas que o modal edita.
// Três efeitos, todos do mesmo defeito:
//   1. o campo abre VAZIO mesmo com dado gravado (abrirModalMonitor lê de
//      _monitores);
//   2. salvar sobrescreve o que havia com null, porque salvarMonitor
//      manda o payload inteiro;
//   3. data_inicio é obrigatória na validação e vinha sempre vazia, então
//      corrigir só o CPF era barrado antes de chegar ao banco.
//
// Este guarda é de CONSISTÊNCIA DE FONTE, não de DOM: a invariante que
// quebrou é "toda coluna que salvarMonitor grava precisa estar no select
// que carregarDados faz". Verificar isso pelo navegador exigiria sessão
// autenticada de super_admin, que este ambiente não tem.

const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

const PAGINA = path.join(__dirname, '..', 'pages', 'admin-biomonitor.html');

function lerFonte() {
  return fs.readFileSync(PAGINA, 'utf8');
}

// Colunas pedidas no .select() de monitores_biodiversidade. O select é
// montado com concatenação de strings, então junta os pedaços antes.
function colunasDoSelect(src) {
  const m = src.match(
    /db\.from\('monitores_biodiversidade'\)\s*\.select\(\s*([\s\S]*?)\)\s*\.order\(/,
  );
  expect(m, 'select de monitores_biodiversidade não encontrado').toBeTruthy();
  const literal = [...m[1].matchAll(/'([^']*)'/g)].map(x => x[1]).join('');
  return literal.split(',').map(c => c.trim()).filter(Boolean);
}

// Colunas que salvarMonitor grava (chaves do payload).
function colunasDoPayload(src) {
  const i = src.indexOf('window.salvarMonitor');
  expect(i, 'salvarMonitor não encontrada').toBeGreaterThan(-1);
  const corpo = src.slice(i, src.indexOf('const { error }', i));
  return [...corpo.matchAll(/^\s{6}(\w+):/gm)].map(x => x[1]);
}

test('o modal carrega toda coluna que ele grava', () => {
  const src = lerFonte();
  const select = colunasDoSelect(src);
  const payload = colunasDoPayload(src);

  const faltando = payload.filter(c => !select.includes(c));
  expect(
    faltando,
    'Colunas gravadas pelo modal mas não carregadas: abrem em branco e são ' +
    'zeradas ao salvar. Acrescente-as ao .select() de carregarDados.',
  ).toEqual([]);
});

test('data_inicio, obrigatória na validação, é carregada', () => {
  const src = lerFonte();
  // Se ela não vier do banco, o campo abre vazio e a validação barra
  // qualquer edição — inclusive uma que só queria corrigir o CPF.
  expect(src).toMatch(/!payload\.data_inicio/);      // segue obrigatória
  expect(colunasDoSelect(src)).toContain('data_inicio');
});

test('o select traz o id e o vínculo de login (coluna "Login app")', () => {
  const select = colunasDoSelect(lerFonte());
  expect(select).toContain('id');
  expect(select).toContain('usuario_id');
});
