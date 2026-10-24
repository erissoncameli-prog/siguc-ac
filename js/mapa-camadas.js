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
// = camada do acumulado até 2007. Mesma camada que prodes_resumo_ano lê.
const MAPA_PRODES_WMS = 'https://terrabrasilis.dpi.inpe.br/geoserver/prodes-amazon-nb/wms';
function mapaProdesLayer(L, { ano, acumulado, opacidade, ...extra } = {}) {
  const o = {
    layers: acumulado ? 'prodes-amazon-nb:accumulated_deforestation_2007_biome'
                      : 'prodes-amazon-nb:yearly_deforestation_biome',
    format: 'image/png', transparent: true, version: '1.1.1',
    attribution: acumulado ? 'PRODES/INPE Acumulado' : 'PRODES/INPE',
    opacity: (opacidade ?? 70) / 100,
    maxZoom: 22, maxNativeZoom: 15,
    ...extra,
  };
  if (ano && !acumulado) o.CQL_FILTER = `year=${ano}`;
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
