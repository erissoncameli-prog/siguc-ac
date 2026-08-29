// SIGUC-AC · redireciona para o .apk do último Release do app pedido
// GET /api/apk-latest?app=brigadas|biomonitor|frota|agua
//
// Por que existe (não é conveniência — é correção de um 404 real):
// o link "óbvio" /releases/latest/download/siguc-<app>.apk aponta para o
// Release mais recente do REPOSITÓRIO INTEIRO, e este repositório publica
// Release de 4 apps na mesma sequência (brigadas-v*, biomonitor-v*,
// frota-v*, agua-v*). Quem publicou por último ganha o "latest" — e esse
// Release só tem o .apk DELE, então o link dos outros 3 devolve 404 até o
// próximo build inverter a situação. Como o gatilho de build é automático
// (.github/workflows/apk-auto-trigger.yml, a partir de VERSOES em
// pwa/sw.js), qual app está quebrado muda sozinho ao longo do dia.
// Aqui filtramos explicitamente pela TAG do app pedido.
//
// A página de instalação também não pode consultar api.github.com direto do
// navegador — o CSP do site (vercel.json) não libera esse domínio em
// connect-src, e não deve: é domínio de terceiro. Resolvido no servidor,
// o HTML fica com um <a href> comum, que funciona sem JS.
//
// Substitui api/biomonitor-apk-latest.js (um arquivo por app estouraria o
// limite de Serverless Functions do plano Hobby — mesma consolidação já
// feita em /api/health). A rota antiga continua valendo por rewrite no
// vercel.json, para não quebrar QR/links já impressos.

const APPS = {
  brigadas:   { tag: 'brigadas-v',   apk: 'siguc-brigadas.apk'   },
  biomonitor: { tag: 'biomonitor-v', apk: 'siguc-biomonitor.apk' },
  frota:      { tag: 'frota-v',      apk: 'siguc-frota.apk'      },
  agua:       { tag: 'agua-v',       apk: 'siguc-agua.apk'       },
};

const GH_RELEASES = 'https://api.github.com/repos/erissoncameli-prog/siguc-ac/releases?per_page=100';
const RELEASES_PAGE = 'https://github.com/erissoncameli-prog/siguc-ac/releases';

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'GET') { res.status(405).end(); return; }

  // Whitelist: o slug nunca entra cru no filtro de tag — sem isso, um
  // parâmetro arbitrário poderia casar com um Release inesperado.
  const chave = String((req.query && req.query.app) || '').toLowerCase();
  const app = Object.prototype.hasOwnProperty.call(APPS, chave) ? APPS[chave] : null;
  if (!app) { res.status(400).json({ erro: 'app inválido', apps: Object.keys(APPS) }); return; }

  // Fallback: a página de Releases filtrada pelo app. Nunca deixa o usuário
  // de campo numa tela de erro — ele acha o .apk à mão se a API do GitHub
  // estiver fora do ar ou com o limite de requisições estourado.
  const fallback = `${RELEASES_PAGE}?q=${encodeURIComponent(chave)}`;

  try {
    const r = await fetch(GH_RELEASES, {
      headers: { Accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) throw new Error('gh ' + r.status);
    const lista = await r.json();

    // A API devolve em ordem decrescente de criação: o primeiro que casar
    // com a tag do app é o mais recente DAQUELE app.
    const rel = Array.isArray(lista) && lista.find((x) =>
      x && !x.draft && !x.prerelease &&
      typeof x.tag_name === 'string' && x.tag_name.indexOf(app.tag) === 0
    );
    const apk = rel && Array.isArray(rel.assets) &&
      rel.assets.find((a) => a && a.name === app.apk);

    if (apk && apk.browser_download_url) {
      res.setHeader('Cache-Control', 'no-store');
      res.writeHead(302, { Location: apk.browser_download_url });
      res.end();
      return;
    }
  } catch (_) { /* cai no fallback abaixo */ }

  res.setHeader('Cache-Control', 'no-store');
  res.writeHead(302, { Location: fallback });
  res.end();
};
