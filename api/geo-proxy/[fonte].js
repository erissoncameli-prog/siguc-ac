// SIGUC-AC · Proxy geoespacial consolidado — GET/POST /api/geo-proxy/:fonte
//
// Vercel Hobby limita a 12 Serverless Functions por deploy. Antes desta
// entrega, api/*.js tinha 13 arquivos (car-proxy, dof-proxy, focos-proxy,
// prodes-proxy + outros 9) — o 13º (api/inmet-avisos.js) empurrou o total
// acima do limite e TODO deploy de produção passou a falhar em silêncio
// (o site ficava congelado na última versão que tinha passado, sem erro
// visível na tela — só nos logs de build da Vercel).
//
// Correção: car-proxy/dof-proxy/focos-proxy/prodes-proxy eram 4 arquivos
// para o MESMO propósito (proxy CORS/servidor para uma fonte geoespacial
// externa) — viram 1 função só, com rota dinâmica `[fonte].js` (Vercel
// injeta o segmento do path em req.query.fonte, mesma convenção de rotas
// dinâmicas do Next.js, mas isto NÃO é um projeto Next.js — funciona
// igual para funções Node "zero-config" da Vercel). As URLs antigas
// (`/api/car-proxy`, `/api/dof-proxy`, `/api/focos-proxy`,
// `/api/prodes-proxy`) continuam existindo — vercel.json reescreve cada
// uma para `/api/geo-proxy/<fonte>`, preservando querystring/método/corpo
// (rewrite é transparente, diferente de redirect) — NENHUM arquivo de
// frontend (pages/mapa.html, pages/alertas-ambientais.html,
// pages/saude-sistema.html) precisou mudar.
//
// Corpo de cada handler é o mesmo de antes, só movido para dentro de uma
// função nomeada — nenhuma lógica foi alterada.

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://atqtybcsvepdabsvgaly.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;
const FIRMS_KEY     = process.env.FIRMS_KEY;
const FIRMS_BASE    = 'https://firms.modaps.eosdis.nasa.gov/api/area/csv';
const IBAMA_DADOS_BASE = 'https://dadosabertos.ibama.gov.br';
const DOF_DATASET_ID   = 'dof-transportes-de-produtos-florestais';
const CAR_TIMEOUT_MS   = 55000; // 55s — dentro do maxDuration de 60s configurado no Vercel
const CAR_ALLOWED_HOSTS = ['geoserver.car.gov.br', 'geocar.car.gov.br'];
const PRODES_WFS_BASE = 'https://terrabrasilis.dpi.inpe.br/geoserver/wfs';
const PRODES_TYPE_ANUAL = 'prodes-amazon-nb:yearly_deforestation_biome';
const PRODES_TYPE_HIST  = 'prodes-amazon-nb:accumulated_deforestation_2007_biome';
const PRODES_TIMEOUT_MS = 55000; // 55s — dentro do maxDuration de 60s configurado no Vercel
const PRODES_MAX_FEAT   = 2000;

// ── CAR/SICAR — GET /api/car-proxy ────────────────────────────────────
async function handleCar(req, res) {
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'GET') { res.status(405).json({ error: 'Method not allowed' }); return; }

  const { url } = req.query;
  if (!url) { res.status(400).json({ error: 'Parâmetro url ausente' }); return; }

  let parsed;
  try { parsed = new URL(url); } catch { res.status(400).json({ error: 'URL inválida' }); return; }

  if (!CAR_ALLOWED_HOSTS.includes(parsed.hostname)) {
    res.status(403).json({ error: `Host não permitido: ${parsed.hostname}` });
    return;
  }

  try {
    const upstream = await fetch(url, {
      signal: AbortSignal.timeout(CAR_TIMEOUT_MS),
      headers: { 'User-Agent': 'SIGUC-AC/1.0 (SEMA-AC)' },
    });

    const contentType = upstream.headers.get('content-type') || 'application/json';
    const body = await upstream.text();

    res.status(upstream.status)
       .setHeader('Content-Type', contentType)
       .setHeader('Cache-Control', 'public, max-age=3600')
       .end(body);
  } catch (err) {
    res.status(502).json({ error: `Falha ao contatar SICAR: ${err.message}` });
  }
}

// ── DOF IBAMA — GET /api/dof-proxy ────────────────────────────────────
async function handleDof(req, res) {
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'GET')     { res.status(405).json({ error: 'Method not allowed' }); return; }

  const { action, uc_id, ano, uf = 'AC' } = req.query;

  if (action === 'recursos') {
    try {
      const r = await fetch(
        `${IBAMA_DADOS_BASE}/api/3/action/package_show?id=${DOF_DATASET_ID}`,
        { signal: AbortSignal.timeout(15000), headers: { 'User-Agent': 'SIGUC-AC/1.0' } }
      );
      if (!r.ok) throw new Error(`IBAMA status ${r.status}`);
      const json = await r.json();
      const recursos = (json.result?.resources || []).map(rc => ({
        id:       rc.id,
        nome:     rc.name,
        formato:  rc.format,
        url:      rc.url,
        tamanho:  rc.size,
        criado:   rc.created,
      }));
      res.setHeader('Cache-Control', 'public, max-age=86400');
      return res.status(200).json({ ok: true, total: recursos.length, recursos });
    } catch (e) {
      return res.status(502).json({ error: 'Falha ao consultar IBAMA Dados Abertos', detalhe: e.message });
    }
  }

  if (action === 'stats') {
    try {
      const params = new URLSearchParams({ p_uf: uf });
      if (ano) params.set('p_ano', ano);

      const sbRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/dof_volume_por_produto?${params}`, {
        headers: {
          'apikey':        SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`,
        },
        signal: AbortSignal.timeout(10000),
      });
      if (!sbRes.ok) throw new Error(`Supabase status ${sbRes.status}`);
      const dados = await sbRes.json();
      res.setHeader('Cache-Control', 'public, max-age=3600');
      return res.status(200).json({ ok: true, dados });
    } catch (e) {
      return res.status(502).json({ error: 'Falha ao consultar Supabase', detalhe: e.message });
    }
  }

  if (action === 'dentro_uc' && uc_id) {
    try {
      const params = new URLSearchParams({ p_uc_id: uc_id });
      if (ano) params.set('p_ano', ano);

      const sbRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/dof_dentro_uc?${params}`, {
        headers: {
          'apikey':        SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`,
        },
        signal: AbortSignal.timeout(10000),
      });
      if (!sbRes.ok) throw new Error(`Supabase status ${sbRes.status}`);
      const dados = await sbRes.json();
      res.setHeader('Cache-Control', 'public, max-age=1800');
      return res.status(200).json({ ok: true, total: dados.length, dados });
    } catch (e) {
      return res.status(502).json({ error: 'Falha na consulta de DOF por UC', detalhe: e.message });
    }
  }

  if (action === 'sem_asv') {
    try {
      const params = new URLSearchParams({ p_uf: uf });
      if (ano) params.set('p_ano', ano);

      const sbRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/dof_sem_asv?${params}`, {
        headers: {
          'apikey':        SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`,
        },
        signal: AbortSignal.timeout(10000),
      });
      if (!sbRes.ok) throw new Error(`Supabase status ${sbRes.status}`);
      const dados = await sbRes.json();
      res.setHeader('Cache-Control', 'public, max-age=1800');
      return res.status(200).json({ ok: true, total: dados.length, dados });
    } catch (e) {
      return res.status(502).json({ error: 'Falha na consulta DOF sem ASV', detalhe: e.message });
    }
  }

  res.status(400).json({
    error: 'Parâmetro action inválido',
    opcoes: ['recursos', 'stats', 'dentro_uc', 'sem_asv'],
  });
}

// ── Focos de calor — GET /api/focos-proxy ─────────────────────────────
async function handleFocos(req, res) {
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'GET') { res.status(405).json({ error: 'Method not allowed' }); return; }

  const { minLon, minLat, maxLon, maxLat } = req.query;
  if (!minLon || !minLat || !maxLon || !maxLat) {
    res.status(400).json({ error: 'Parâmetros: minLon, minLat, maxLon, maxLat' });
    return;
  }

  const x0 = parseFloat(minLon), y0 = parseFloat(minLat);
  const x1 = parseFloat(maxLon), y1 = parseFloat(maxLat);

  if (isNaN(x0) || isNaN(y0) || isNaN(x1) || isNaN(y1) ||
      x0 < -180 || x1 > 180 || y0 < -90 || y1 > 90 ||
      x0 >= x1 || y0 >= y1 || (x1 - x0) > 20 || (y1 - y0) > 20) {
    res.status(400).json({ error: 'Coordenadas bbox inválidas' });
    return;
  }

  let historico = [];
  try {
    const sbRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/focos_por_ano`, {
      method:  'POST',
      headers: {
        'apikey':        SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type':  'application/json',
      },
      body:   JSON.stringify({ p_min_lon: x0, p_min_lat: y0, p_max_lon: x1, p_max_lat: y1 }),
      signal: AbortSignal.timeout(10000),
    });
    if (sbRes.ok) historico = await sbRes.json();
  } catch (_) {}

  const bbox = `${x0},${y0},${x1},${y1}`;
  let recentes = { total: 0, focos: [] };
  try {
    const nrtRes = await fetch(
      `${FIRMS_BASE}/${FIRMS_KEY}/VIIRS_NOAA20_NRT/${bbox}/3`,
      { signal: AbortSignal.timeout(15000), headers: { 'User-Agent': 'SIGUC-AC/1.0' } }
    );
    if (nrtRes.ok) {
      const txt  = await nrtRes.text();
      const rows = txt.trim().split('\n').filter(Boolean);
      if (rows.length > 1) {
        const h   = rows[0].split(',');
        const idx = k => h.indexOf(k);
        rows.slice(1).forEach(l => {
          const c = l.split(',');
          recentes.focos.push({
            lat:        parseFloat(c[idx('latitude')]),
            lon:        parseFloat(c[idx('longitude')]),
            acq_date:   c[idx('acq_date')],
            confidence: c[idx('confidence')],
            frp:        parseFloat(c[idx('frp')]) || null,
          });
        });
        recentes.total = recentes.focos.length;
      }
    }
  } catch (_) {}

  res.status(200)
     .setHeader('Content-Type', 'application/json')
     .setHeader('Cache-Control', 'public, max-age=3600')
     .json({ historico, recentes });
}

// ── PRODES/INPE — POST /api/prodes-proxy ──────────────────────────────
async function fetchWFS(typeName, bbox) {
  const [x0, y0, x1, y1] = bbox;
  const params = new URLSearchParams({
    service:      'WFS',
    version:      '1.1.0',
    request:      'GetFeature',
    typeName,
    outputFormat: 'application/json',
    srsName:      'CRS:84',
    BBOX:         `${x0},${y0},${x1},${y1},CRS:84`,
    maxFeatures:  PRODES_MAX_FEAT,
  });
  const url = `${PRODES_WFS_BASE}?${params}`;
  const r = await fetch(url, {
    signal:  AbortSignal.timeout(PRODES_TIMEOUT_MS),
    headers: { 'User-Agent': 'SIGUC-AC/1.0 (SEMA-AC)' },
  });
  const text = await r.text();
  if (text.trimStart().startsWith('<')) {
    const match = text.match(/<ows:ExceptionText[^>]*>([\s\S]*?)<\/ows:ExceptionText>/);
    throw new Error(match ? match[1].trim().substring(0, 200) : `HTTP ${r.status} — resposta XML inesperada`);
  }
  const json = JSON.parse(text);
  if (!Array.isArray(json.features)) throw new Error('GeoJSON sem features array');
  return json;
}

async function handleProdes(req, res) {
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  const { bbox } = req.body || {};
  if (!Array.isArray(bbox) || bbox.length !== 4) {
    res.status(400).json({ error: 'bbox inválido — esperado [minLon, minLat, maxLon, maxLat]' });
    return;
  }

  const [anualResult, histResult] = await Promise.allSettled([
    fetchWFS(PRODES_TYPE_ANUAL, bbox),
    fetchWFS(PRODES_TYPE_HIST,  bbox),
  ]);

  const anual     = anualResult.status === 'fulfilled'
    ? anualResult.value
    : { features: [], _error: anualResult.reason?.message };
  const historico = histResult.status === 'fulfilled'
    ? histResult.value
    : { features: [], _error: histResult.reason?.message };

  res.status(200)
     .setHeader('Content-Type', 'application/json')
     .setHeader('Cache-Control', 'public, max-age=86400')
     .json({ anual, historico });
}

const HANDLERS = { car: handleCar, dof: handleDof, focos: handleFocos, prodes: handleProdes };
const METODOS  = { car: 'GET, OPTIONS', dof: 'GET, OPTIONS', focos: 'GET, OPTIONS', prodes: 'POST, OPTIONS' };

// Rede de segurança: o roteamento normal vem do segmento dinâmico do path
// (Vercel injeta `req.query.fonte` a partir de `[fonte].js`, mesma
// convenção do Next.js — não pôde ser testado ponta a ponta nesta sessão
// por falta de acesso à plataforma da Vercel). Se por qualquer motivo o
// segmento não chegar (ex.: alguém chamar /api/geo-proxy direto, sem
// passar pela rewrite), infere a fonte pelos parâmetros — cada uma tem
// uma assinatura própria que não se confunde com as outras.
function inferirFonte(req) {
  if (req.method === 'POST' && Array.isArray(req.body?.bbox)) return 'prodes'
  if (req.query.url) return 'car'
  if (req.query.action) return 'dof'
  if (req.query.minLon) return 'focos'
  return null
}

module.exports = async (req, res) => {
  const fonte = req.query.fonte || inferirFonte(req);
  const handler = HANDLERS[fonte];

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', METODOS[fonte] || 'GET, POST, OPTIONS');

  if (!handler) {
    res.status(404).json({ error: 'Fonte desconhecida', opcoes: Object.keys(HANDLERS) });
    return;
  }

  await handler(req, res);
};
