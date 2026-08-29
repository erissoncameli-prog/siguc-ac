// SIGUC-AC · Guarda do link de download do APK (api/apk-latest.js)
//
// A regressão que este teste impede é um 404 REAL, visto em produção: as
// páginas de instalação apontavam para
//   /releases/latest/download/siguc-<app>.apk
// que é o Release mais recente do REPOSITÓRIO, não do app. Como os 4 apps
// publicam Release na mesma sequência, quem buildou por último vencia o
// "latest" e os outros 3 links devolviam 404 — trocando de vítima sozinho a
// cada build automático (apk-auto-trigger.yml).
//
// Roda sem rede: a resposta da API do GitHub é injetada. O que se cobra é a
// ESCOLHA do Release, que é onde estava o defeito.

const { test, expect } = require('@playwright/test');
const fs   = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const APPS = ['brigadas', 'biomonitor', 'frota', 'agua'];

function carregarHandler(respostaGh) {
  delete require.cache[require.resolve('../api/apk-latest.js')];
  global.fetch = async () => respostaGh;
  return require('../api/apk-latest.js');
}

async function chamar(handler, app) {
  const o = { headers: {} };
  const res = {
    setHeader: (k, v) => { o.headers[k] = v; },
    status(c) { o.code = c; return this; },
    json(j) { o.body = j; },
    end() {},
    writeHead(c, h) { o.code = c; o.local = h && h.Location; },
  };
  await handler({ method: 'GET', query: { app } }, res);
  return o;
}

// Ordem decrescente de criação, como a API do GitHub devolve — os 4 apps
// intercalados, que é justamente o cenário que quebrava.
const LISTA = [
  { tag: 'agua-v0.0.6',       apk: 'siguc-agua.apk'       },
  { tag: 'biomonitor-v1.1.37', apk: 'siguc-biomonitor.apk' },
  { tag: 'frota-v0.0.14',     apk: 'siguc-frota.apk'      },
  { tag: 'brigadas-v1.18.9',  apk: 'siguc-brigadas.apk'   },
  { tag: 'agua-v0.0.5',       apk: 'siguc-agua.apk'       },
  { tag: 'frota-v0.0.13',     apk: 'siguc-frota.apk'      },
].map((r) => ({
  tag_name: r.tag, draft: false, prerelease: false,
  assets: [{
    name: r.apk,
    browser_download_url:
      `https://github.com/erissoncameli-prog/siguc-ac/releases/download/${r.tag}/${r.apk}`,
  }],
}));

const OK = { ok: true, json: async () => LISTA };

test('cada app é redirecionado para o APK do Release DELE, não do "latest" do repositório', async () => {
  const h = carregarHandler(OK);
  for (const app of APPS) {
    const r = await chamar(h, app);
    expect(r.code, app).toBe(302);
    expect(r.local, app).toContain(`/siguc-${app}.apk`);
  }
});

test('escolhe a versão mais recente do app, ignorando as anteriores', async () => {
  const h = carregarHandler(OK);
  expect((await chamar(h, 'agua')).local).toContain('/agua-v0.0.6/');
  expect((await chamar(h, 'frota')).local).toContain('/frota-v0.0.14/');
});

test('Release de rascunho ou pré-lançamento nunca é servido ao usuário de campo', async () => {
  const lista = [
    { tag_name: 'agua-v0.0.9', draft: true,  prerelease: false,
      assets: [{ name: 'siguc-agua.apk', browser_download_url: 'https://x/rascunho.apk' }] },
    { tag_name: 'agua-v0.0.8', draft: false, prerelease: true,
      assets: [{ name: 'siguc-agua.apk', browser_download_url: 'https://x/previa.apk' }] },
    ...LISTA,
  ];
  const h = carregarHandler({ ok: true, json: async () => lista });
  expect((await chamar(h, 'agua')).local).toContain('/agua-v0.0.6/');
});

test('API do GitHub fora do ar cai na página de Releases, nunca numa tela de erro', async () => {
  const h = carregarHandler({ ok: false, status: 403 });
  const r = await chamar(h, 'agua');
  expect(r.code).toBe(302);
  expect(r.local).toBe('https://github.com/erissoncameli-prog/siguc-ac/releases?q=agua');
});

test('app fora da whitelist é recusado (o slug nunca entra cru no filtro de tag)', async () => {
  const h = carregarHandler(OK);
  for (const ruim of ['', 'outro', '../frota']) {
    const r = await chamar(h, ruim);
    expect(r.code, ruim).toBe(400);
    expect(r.local, ruim).toBeUndefined();
  }
});

test('nenhuma página de instalação usa /releases/latest/ (a origem do 404)', () => {
  for (const app of APPS) {
    const html = fs.readFileSync(path.join(RAIZ, 'pages', `instalar-${app}.html`), 'utf8');
    expect(html, app).not.toContain('/releases/latest/');
    expect(html, app).toContain(`/api/apk-latest?app=${app}`);
  }
});
