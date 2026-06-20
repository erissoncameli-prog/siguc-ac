// SIGUC-AC · Lista mosaicos Planet/NICFI disponíveis — GET /api/planet-mosaics
// Consulta a Basemaps API server-side (chave protegida) e devolve os mosaicos
// visuais de média resolução mais recentes, já formatados para o seletor de mês.
// O front nunca vê a chave nem precisa saber nomes de mosaico.

const PLANET_KEY = process.env.PLANET_API_KEY;
const API_BASE   = 'https://api.planet.com/basemaps/v1/mosaics';

const MESES = ['', 'Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun',
               'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

// "planet_medres_visual_2026-05_mosaic" → "Mai/2026"
function rotulo(name){
  const m = name.match(/(\d{4})-(\d{2})/);
  if(!m) return name;
  return `${MESES[parseInt(m[2], 10)] || m[2]}/${m[1]}`;
}
function chaveData(name){
  const m = name.match(/(\d{4})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}` : '';
}

async function buscar(filtro){
  const url = `${API_BASE}?_page_size=50${filtro ? `&name__contains=${filtro}` : ''}`;
  const r = await fetch(url, {
    headers: {
      // Basemaps API aceita a chave como usuário no Basic Auth (senha vazia).
      'Authorization': 'Basic ' + Buffer.from(`${PLANET_KEY}:`).toString('base64'),
      'User-Agent':    'SIGUC-AC/1.0 (SEMA-AC)',
    },
    signal: AbortSignal.timeout(15000),
  });
  if(!r.ok) throw new Error(`HTTP ${r.status}`);
  const json = await r.json();
  return Array.isArray(json.mosaics) ? json.mosaics : [];
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if(req.method === 'OPTIONS'){ res.status(204).end(); return; }
  if(req.method !== 'GET'){ res.status(405).json({ error: 'Method not allowed' }); return; }

  if(!PLANET_KEY){
    res.status(200)
       .setHeader('Cache-Control', 'public, max-age=300')
       .json({ disponivel: false, motivo: 'sem-chave', mosaicos: [] });
    return;
  }

  try {
    // Preferimos os mosaicos visuais de média resolução (NICFI). Se a conta
    // não tiver NICFI (ex.: trial), caímos para a lista completa do plano.
    let lista = await buscar('planet_medres_visual');
    if(!lista.length) lista = await buscar('');

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
       .json({ disponivel: temMosaicos, recente: mosaicos[0] || null,
               motivo: temMosaicos ? undefined : 'conta-sem-mosaicos', mosaicos });
  } catch(err){
    res.status(200)
       .setHeader('Cache-Control', 'public, max-age=120')
       .json({ disponivel: false, motivo: String(err.message || err), mosaicos: [] });
  }
};
