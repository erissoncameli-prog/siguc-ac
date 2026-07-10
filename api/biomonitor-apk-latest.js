// SIGUC-AC · Biomonitor — redireciona para o .apk do último Release
// GET /api/biomonitor-apk-latest
//
// A página de instalação (pages/instalar-biomonitor.html) não pode buscar a
// API do GitHub direto do navegador — o CSP do site (vercel.json) não libera
// api.github.com em connect-src (e não deve: é domínio de terceiro). Este
// proxy resolve no servidor e nunca precisa de uma versão hardcoded no HTML.
//
// Usa releases/latest do repositório INTEIRO seria errado (pode devolver um
// Release do Brigadas). Aqui filtramos explicitamente por tag "biomonitor-v*".

const GH_RELEASES = 'https://api.github.com/repos/erissoncameli-prog/siguc-ac/releases?per_page=30';
const RELEASES_PAGE = 'https://github.com/erissoncameli-prog/siguc-ac/releases?q=biomonitor';

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'GET') { res.status(405).end(); return; }

  try {
    const r = await fetch(GH_RELEASES, {
      headers: { Accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) throw new Error('gh ' + r.status);
    const lista = await r.json();

    const rel = Array.isArray(lista) && lista.find((x) =>
      x && !x.draft && !x.prerelease &&
      typeof x.tag_name === 'string' && x.tag_name.indexOf('biomonitor-v') === 0
    );
    const apk = rel && Array.isArray(rel.assets) &&
      rel.assets.find((a) => a && a.name === 'siguc-biomonitor.apk');

    if (apk && apk.browser_download_url) {
      res.setHeader('Cache-Control', 'no-store');
      res.writeHead(302, { Location: apk.browser_download_url });
      res.end();
      return;
    }
  } catch (_) { /* cai no fallback abaixo */ }

  res.setHeader('Cache-Control', 'no-store');
  res.writeHead(302, { Location: RELEASES_PAGE });
  res.end();
};
