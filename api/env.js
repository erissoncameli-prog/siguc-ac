// SIGUC-AC · Endpoint de configuração pública
// Expõe apenas URL + anon key do Supabase — lidos de variáveis de ambiente.
// Nunca inclua SERVICE_ROLE_KEY ou qualquer segredo aqui.

module.exports = (req, res) => {
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'GET') { res.status(405).end(); return; }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return res.status(503).json({ error: 'Configuração indisponível' });
  }

  res.setHeader('Cache-Control', 'public, max-age=3600, stale-while-revalidate=86400');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.json({ supabaseUrl, supabaseKey });
};
