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
// Tiles passam pelo proxy /api/planet-tiles (chave protegida no servidor).
// O nome do mosaico vem de mapaPlanetMosaicos(); nada de chave no front.

// Lista os mosaicos disponíveis (mais recentes primeiro). Cacheia em memória
// para não repetir a chamada a cada mapa. Retorna { disponivel, recente, mosaicos }.
let _mapaPlanetCache = null;
async function mapaPlanetMosaicos() {
  if (_mapaPlanetCache) return _mapaPlanetCache;
  try {
    const r = await fetch('/api/planet-mosaics', { signal: AbortSignal.timeout(15000) });
    _mapaPlanetCache = await r.json();
  } catch (_) {
    _mapaPlanetCache = { disponivel: false, motivo: 'rede', mosaicos: [] };
  }
  return _mapaPlanetCache;
}

// Camada de um mosaico Planet (nome ex.: planet_medres_visual_2026-05_mosaic).
function mapaPlanetLayer(L, mosaico, opacidade) {
  return L.tileLayer(
    `/api/planet-tiles?z={z}&x={x}&y={y}&m=${encodeURIComponent(mosaico)}`,
    {
      attribution: 'Planet / NICFI',
      opacity: (opacidade ?? 80) / 100,
      maxZoom: 21, maxNativeZoom: 18,
      errorTileUrl: 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==',
    }
  );
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
      errorTileUrl: 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==',
    }
  );
}
