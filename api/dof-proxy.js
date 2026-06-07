// SIGUC-AC · Proxy DOF IBAMA — GET /api/dof-proxy
// Consulta dados abertos do Documento de Origem Florestal
// Fonte: dadosabertos.ibama.gov.br/dataset/dof-transportes-de-produtos-florestais

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://atqtybcsvepdabsvgaly.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;

// CKAN API do portal de dados abertos do IBAMA
const IBAMA_DADOS_BASE = 'https://dadosabertos.ibama.gov.br';
const DOF_DATASET_ID   = 'dof-transportes-de-produtos-florestais';

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'GET')     { res.status(405).json({ error: 'Method not allowed' }); return; }

  const { action, uc_id, ano, uf = 'AC' } = req.query;

  // ── 1. Listar recursos disponíveis do dataset DOF no IBAMA ──────────────
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

  // ── 2. Estatísticas DOF do banco local (Supabase) ───────────────────────
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

  // ── 3. DOF dentro de uma UC específica ──────────────────────────────────
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

  // ── 4. DOF sem ASV (potencial irregularidade) ───────────────────────────
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
};
