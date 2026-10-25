// ── SIGUC — Camadas de mapa compartilhadas ────────────────────
// Base de satélite + camadas diárias do NASA GIBS (cor real e focos
// de calor). Usado na validação de campo (e reutilizável no mapa).
// Requer Leaflet (L) já carregado.

const MAPA_GIBS_CAMADAS = [
  { id: 'VIIRS_SNPP_CorrectedReflectance_TrueColor', fmt: 'jpg', label: 'VIIRS — Cor real (375m)' },
  { id: 'MODIS_Terra_CorrectedReflectance_TrueColor', fmt: 'jpg', label: 'MODIS Terra — Cor real (250m)' },
  { id: 'VIIRS_NOAA20_Thermal_Anomalies_375m_Day',    fmt: 'png', label: 'VIIRS — Anomalias térmicas (focos)' },
  { id: 'MODIS_Terra_Thermal_Anomalies_Day',          fmt: 'png', label: 'MODIS — Anomalias térmicas (focos)' },
];

// GIBS tem atraso de ~1–2 dias; usa anteontem como padrão seguro.
function mapaGibsDataSegura() {
  const d = new Date();
  d.setDate(d.getDate() - 2);
  return d.toISOString().slice(0, 10);
}

// Base de satélite de alta resolução. Usa a MESMA fonte do mapa.html
// (Google Satellite), já comprovada no projeto. ESRI fica como fallback.
function mapaBasemapSatelite(L) {
  return L.tileLayer(
    'https://{s}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}',
    { maxZoom: 21, subdomains: ['mt0', 'mt1', 'mt2', 'mt3'], attribution: 'Google Satélite' }
  );
}

// Fallback de satélite (ESRI World Imagery) — sem chave.
function mapaBasemapSateliteEsri(L) {
  return L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    { maxZoom: 21, maxNativeZoom: 19, attribution: 'ESRI World Imagery' }
  );
}

// Ruas/labels (overlay opcional sobre o satélite).
function mapaBasemapRuas(L) {
  return L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    { maxZoom: 19, attribution: '© OpenStreetMap', subdomains: ['a', 'b', 'c'] });
}

// ── Planet / NICFI (mosaicos mensais ~4,77 m) ─────────────────────
// Tiles passam pelo proxy /api/planet?op=tiles (chave protegida no
// servidor) — api/planet-tiles.js e api/planet-mosaics.js foram unidos
// num arquivo só (api/planet.js) para caber no limite de 12 Serverless
// Functions do plano Hobby da Vercel (achado ao investigar por que a
// produção parou de receber deploy). O nome do mosaico vem de
// mapaPlanetMosaicos(); nada de chave no front.

// Lista os mosaicos disponíveis (mais recentes primeiro). Cacheia em memória
// para não repetir a chamada a cada mapa. Retorna { disponivel, recente, mosaicos }.
let _mapaPlanetCache = null;
async function mapaPlanetMosaicos() {
  if (_mapaPlanetCache) return _mapaPlanetCache;
  try {
    const r = await fetch('/api/planet?op=mosaics', { signal: AbortSignal.timeout(15000) });
    _mapaPlanetCache = await r.json();
  } catch (_) {
    _mapaPlanetCache = { disponivel: false, motivo: 'rede', mosaicos: [] };
  }
  return _mapaPlanetCache;
}

const MAPA_TILE_VAZIO = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';

// Camada de um mosaico Planet (nome ex.: planet_medres_visual_2026-05_mosaic).
// `extra` (opcional) entra por último nas opções do Leaflet — ex.: { pane }.
function mapaPlanetLayer(L, mosaico, opacidade, extra) {
  return L.tileLayer(
    `/api/planet?op=tiles&z={z}&x={x}&y={y}&m=${encodeURIComponent(mosaico)}`,
    {
      attribution: 'Planet / NICFI',
      opacity: (opacidade ?? 80) / 100,
      maxZoom: 21, maxNativeZoom: 18,
      errorTileUrl: MAPA_TILE_VAZIO,
      ...(extra || {}),
    }
  );
}

// ── Sentinel-2 (proxy /api/sentinel, Copernicus Data Space) ──────────
// Dois modos do proxy: { data: 'AAAA-MM-DD', nuvem } = cena do dia;
// { ano: AAAA } = composição da época seca (mai–out, menos nublado).
// Fonte única da URL: Mapa das UCs (camada do painel, linha do tempo e
// comparação de imagens). Nunca remontar a URL numa página.
function mapaSentinelLayer(L, { data, ano, nuvem, opacidade, ...extra } = {}) {
  const q = ano ? `ano=${encodeURIComponent(ano)}`
    : `data=${encodeURIComponent(data)}&nuvem=${encodeURIComponent(nuvem ?? 30)}`;
  return L.tileLayer(`/api/sentinel?z={z}&x={x}&y={y}&${q}`, {
    attribution: 'Sentinel-2 / Copernicus',
    opacity: (opacidade ?? 80) / 100,
    maxZoom: 21, maxNativeZoom: 15,
    errorTileUrl: MAPA_TILE_VAZIO,
    ...extra,
  });
}

// Cenas Sentinel-2 que cobrem o retângulo [oeste, sul, leste, norte]
// (últimos ~60 dias, pelo proxy). Devolve { disponivel, motivo?, dias?, datas:[{data, nuvem}] }.
async function mapaSentinelCenas(bbox) {
  try {
    const r = await fetch(`/api/sentinel?bbox=${encodeURIComponent(bbox.join(','))}`, { signal: AbortSignal.timeout(15000) });
    return await r.json();
  } catch (_) {
    return { disponivel: false, motivo: 'rede', datas: [] };
  }
}

// ── PRODES (WMS TerraBrasilis) ───────────────────────────────────────
// { ano } recorta o desmatamento anual por CQL (year=N); { acumulado:true }
// = camada do acumulado até 2007; { ate:N } = TUDO o que foi desmatado até
// o ano N (acumulado 2007 + anuais <= N, CQL por camada separado por ';').
// Mesma camada que prodes_resumo_ano lê.
const MAPA_PRODES_WMS = 'https://terrabrasilis.dpi.inpe.br/geoserver/prodes-amazon-nb/wms';
function mapaProdesLayer(L, { ano, ate, acumulado, opacidade, ...extra } = {}) {
  const o = {
    layers: acumulado ? 'prodes-amazon-nb:accumulated_deforestation_2007_biome'
                      : 'prodes-amazon-nb:yearly_deforestation_biome',
    format: 'image/png', transparent: true, version: '1.1.1',
    attribution: acumulado ? 'PRODES/INPE Acumulado' : 'PRODES/INPE',
    opacity: (opacidade ?? 70) / 100,
    maxZoom: 22, maxNativeZoom: 15,
    ...extra,
  };
  if (ate) {
    o.layers = 'prodes-amazon-nb:accumulated_deforestation_2007_biome,prodes-amazon-nb:yearly_deforestation_biome';
    o.CQL_FILTER = `INCLUDE;year<=${Number(ate)}`;
    o.attribution = 'PRODES/INPE';
  } else if (ano && !acumulado) o.CQL_FILTER = `year=${ano}`;
  return L.tileLayer.wms(MAPA_PRODES_WMS, o);
}

// Camada diária do GIBS (cor real ou focos), para uma data YYYY-MM-DD.
function mapaGibsLayer(L, camadaId, data, opacidade) {
  const cfg = MAPA_GIBS_CAMADAS.find(c => c.id === camadaId) || MAPA_GIBS_CAMADAS[0];
  const dt  = data || mapaGibsDataSegura();
  return L.tileLayer(
    `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/${cfg.id}/default/${dt}/GoogleMapsCompatible/{z}/{y}/{x}.${cfg.fmt}`,
    {
      attribution: 'NASA GIBS / Earthdata',
      opacity: (opacidade ?? 70) / 100,
      maxZoom: 21, maxNativeZoom: 9,
      errorTileUrl: MAPA_TILE_VAZIO,
    }
  );
}

// ── MapBiomas — uso e cobertura do solo POR ANO (Coleção 11) ────────
// Tiles desenhados pelo nosso servidor a partir do COG oficial
// (/api/geo?svc=tile, api/_mapbiomas-cog.js) — a MapBiomas não publica
// tiles prontos. Legenda/cores/anos em data/mapbiomas-col11-legenda.json,
// o MESMO arquivo que o servidor usa para pintar (nunca uma 2ª tabela).
const MAPA_MB_LEGENDA_URL = '/data/mapbiomas-col11-legenda.json';
let _mapaMbLegenda = null;
async function mapaMapbiomasLegenda() {
  if (_mapaMbLegenda) return _mapaMbLegenda;
  try {
    const r = await fetch(MAPA_MB_LEGENDA_URL, { signal: AbortSignal.timeout(15000) });
    _mapaMbLegenda = await r.json();
  } catch (_) {
    _mapaMbLegenda = null;
  }
  return _mapaMbLegenda;
}
function mapaMapbiomasLayer(L, { ano, opacidade, ...extra } = {}) {
  const q = ano ? `&ano=${encodeURIComponent(ano)}` : '';
  return L.tileLayer(`/api/geo?svc=tile${q}&z={z}&x={x}&y={y}`, {
    attribution: 'MapBiomas Coleção 11 (CC BY 4.0)',
    opacity: (opacidade ?? 80) / 100,
    maxZoom: 22, maxNativeZoom: 13,        // pixel de 30 m ≈ zoom 12–13
    errorTileUrl: MAPA_TILE_VAZIO,
    ...extra,
  });
}

// ── Esri World Imagery Wayback (foto de satélite, versões desde 2014) ──
// Tiles direto da Esri (img-src https:); a LISTA de versões e as mudanças
// num ponto passam por /api/geo?svc=wayback (o CSP não libera o domínio em
// connect-src). Gratuito, sem chave.
let _mapaWbCache = null;
async function mapaWaybackVersoes() {
  if (_mapaWbCache) return _mapaWbCache;
  try {
    const r = await fetch('/api/geo?svc=wayback&op=lista', { signal: AbortSignal.timeout(15000) });
    _mapaWbCache = await r.json();
  } catch (_) {
    _mapaWbCache = { disponivel: false, motivo: 'rede', versoes: [] };
  }
  return _mapaWbCache;
}
// Só as versões em que a foto DAQUELE ponto mudou (com data de captura).
async function mapaWaybackMudancas(lat, lng, z) {
  try {
    const r = await fetch(`/api/geo?svc=wayback&op=mudancas&lat=${lat.toFixed(5)}&lng=${lng.toFixed(5)}&z=${z}`,
      { signal: AbortSignal.timeout(30000) });
    return await r.json();
  } catch (_) {
    return { disponivel: false, motivo: 'rede', mudancas: [] };
  }
}
function mapaWaybackLayer(L, num, { opacidade, ...extra } = {}) {
  return L.tileLayer(
    `https://wayback.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/WMTS/1.0.0/default028mm/MapServer/tile/${encodeURIComponent(num)}/{z}/{y}/{x}`,
    { attribution: 'Esri World Imagery Wayback', opacity: (opacidade ?? 100) / 100,
      maxZoom: 22, maxNativeZoom: 19, errorTileUrl: MAPA_TILE_VAZIO, ...extra });
}

// Google Satélite como CAMADA (a base do mapa é outra coisa): só a foto atual
// — o Google não publica datas antigas por endereço de tile.
function mapaGoogleSateliteLayer(L, { opacidade, ...extra } = {}) {
  return L.tileLayer('https://{s}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}',
    { attribution: 'Google Satélite', subdomains: ['mt0', 'mt1', 'mt2', 'mt3'],
      opacity: (opacidade ?? 100) / 100, maxZoom: 22, errorTileUrl: MAPA_TILE_VAZIO, ...extra });
}
