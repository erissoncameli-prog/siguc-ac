// SIGUC-AC · Proxy Planet/NICFI Basemaps — uma função só para as duas
// rotas antigas (api/planet-tiles.js + api/planet-mosaics.js), unidas
// por `op` — achado ao investigar por que a produção parou de receber
// deploy: o Vercel Hobby trava em 12 Serverless Functions por deploy,
// e o 13º arquivo em api/ (api/inmet-avisos.js, de outra sessão)
// travou TODO merge em main desde então (erro
// exceeded_serverless_functions_per_deployment). As duas rotas Planet
// são do MESMO domínio/chave (PLANET_API_KEY) — junção natural, sem
// perder nenhuma delas.
//
//   GET /api/planet?op=tiles&z={z}&x={x}&y={y}&m={mosaico}
//   GET /api/planet?op=mosaics
//
// A chave PLANET_API_KEY fica SOMENTE no servidor; o front nunca a recebe.

const PLANET_KEY = process.env.PLANET_API_KEY;
const TILES_BASE = 'https://tiles.planet.com/basemaps/v1/planet-tiles';
const MOSAICS_API_BASE = 'https://api.planet.com/basemaps/v1/mosaics';

// PNG 1×1 transparente — devolvido quando não há chave ou tile indisponível,
// para o mapa nunca quebrar (mostra "vazio" em vez de erro).
const TILE_VAZIO = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
);

function tileVazio(res, motivo) {
  res.status(200)
    .setHeader('Content-Type', 'image/png')
    .setHeader('Cache-Control', 'public, max-age=300')   // erro/sem-chave: cache curto
    .setHeader('X-Planet-Status', motivo)
    .send(TILE_VAZIO);
}

async function handleTiles(req, res) {
  if (!PLANET_KEY) { tileVazio(res, 'sem-chave'); return; }

  const { z, x, y, m } = req.query;

  // Validação estrita — evita SSRF / path traversal no nome do mosaico.
  const zi = parseInt(z, 10), xi = parseInt(x, 10), yi = parseInt(y, 10);
  if (!Number.isInteger(zi) || !Number.isInteger(xi) || !Number.isInteger(yi) ||
    zi < 0 || zi > 22 || xi < 0 || yi < 0) {
    res.status(400).json({ error: 'Parâmetros z/x/y inválidos' }); return;
  }
  if (typeof m !== 'string' || !/^[a-z0-9_\-]{3,80}$/i.test(m)) {
    res.status(400).json({ error: 'Nome de mosaico inválido' }); return;
  }

  const url = `${TILES_BASE}/${m}/gmap/${zi}/${xi}/${yi}.png?api_key=${encodeURIComponent(PLANET_KEY)}`;

  try {
    const r = await fetch(url, {
      signal: AbortSignal.timeout(15000),
      headers: { 'User-Agent': 'SIGUC-AC/1.0 (SEMA-AC)' },
    });
    if (!r.ok) { tileVazio(res, `upstream-${r.status}`); return; }

    const buf = Buffer.from(await r.arrayBuffer());
    res.status(200)
      .setHeader('Content-Type', r.headers.get('content-type') || 'image/png')
      // Mosaico é imutável por mês → pode cachear por muito tempo na borda.
      .setHeader('Cache-Control', 'public, max-age=86400, s-maxage=2592000, immutable')
      .send(buf);
  } catch (_) {
    tileVazio(res, 'timeout');
  }
}

const MESES = ['', 'Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun',
  'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

// "planet_medres_visual_2026-05_mosaic" → "Mai/2026"
function rotulo(name) {
  const m = name.match(/(\d{4})-(\d{2})/);
  if (!m) return name;
  return `${MESES[parseInt(m[2], 10)] || m[2]}/${m[1]}`;
}
function chaveData(name) {
  const m = name.match(/(\d{4})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}` : '';
}

async function buscarMosaicos(filtro) {
  const url = `${MOSAICS_API_BASE}?_page_size=50${filtro ? `&name__contains=${filtro}` : ''}`;
  const r = await fetch(url, {
    headers: {
      // Basemaps API aceita a chave como usuário no Basic Auth (senha vazia).
      'Authorization': 'Basic ' + Buffer.from(`${PLANET_KEY}:`).toString('base64'),
      'User-Agent': 'SIGUC-AC/1.0 (SEMA-AC)',
    },
    signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const json = await r.json();
  return Array.isArray(json.mosaics) ? json.mosaics : [];
}

async function handleMosaics(req, res) {
  if (!PLANET_KEY) {
    res.status(200)
      .setHeader('Cache-Control', 'public, max-age=300')
      .json({ disponivel: false, motivo: 'sem-chave', mosaicos: [] });
    return;
  }

  try {
    // Preferimos os mosaicos visuais de média resolução (NICFI). Se a conta
    // não tiver NICFI (ex.: trial), caímos para a lista completa do plano.
    let lista = await buscarMosaicos('planet_medres_visual');
    if (!lista.length) lista = await buscarMosaicos('');

    const mosaicos = lista
      .map(m => ({ name: m.name, label: rotulo(m.name), data: chaveData(m.name) }))
      .filter(m => /^[a-z0-9_\-]{3,80}$/i.test(m.name))
      .sort((a, b) => b.data.localeCompare(a.data));

    const temMosaicos = mosaicos.length > 0;
    res.status(200)
      .setHeader('Content-Type', 'application/json')
      // Cache longo só quando há mosaicos; vazio cacheia pouco, para o mapa
      // "acender" assim que o NICFI for ativado na conta (sem esperar 6h).
      .setHeader('Cache-Control', temMosaicos
        ? 'public, max-age=21600, s-maxage=21600'   // 6h
        : 'public, max-age=120, s-maxage=120')      // 2min
      .json({
        disponivel: temMosaicos, recente: mosaicos[0] || null,
        motivo: temMosaicos ? undefined : 'conta-sem-mosaicos', mosaicos,
      });
  } catch (err) {
    res.status(200)
      .setHeader('Cache-Control', 'public, max-age=120')
      .json({ disponivel: false, motivo: String(err.message || err), mosaicos: [] });
  }
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'GET') { res.status(405).json({ error: 'Method not allowed' }); return; }

  if (req.query.op === 'mosaics') { await handleMosaics(req, res); return; }
  if (req.query.op === 'tiles') { await handleTiles(req, res); return; }
  res.status(400).json({ error: 'Parâmetro "op" inválido (use tiles ou mosaics)' });
};
