// SIGUC-AC · Proxy INMET — Avisos Meteorológicos ativos — GET /api/inmet-avisos
//
// Fase 2 do Boletim do Tempo / Relatório Hidrometeorológico
// (pages/rh-boletim.html): auto-preenche o bloco "Aviso meteorológico"
// a partir dos avisos oficiais em vigor do INMET, filtrados para o
// Acre. Proxy porque o endpoint do INMET não libera CORS para
// chamada direta do navegador (confirmado testando via pg_net do
// banco — resposta 200 real, mas sem Access-Control-Allow-Origin) —
// mesmo motivo dos outros proxies desta pasta (focos-proxy, dof-proxy).
//
// Fonte: https://apiprevmet3.inmet.gov.br/avisos/ativos — endpoint
// PÚBLICO usado pelo próprio https://avisos.inmet.gov.br, sem
// autenticação. Devolve dois baldes ("hoje"/"futuro"), cada um uma
// lista de avisos vigentes no PAÍS INTEIRO, com o campo `municipios`
// listando "Cidade - UF (geocode)" para TODOS os municípios afetados —
// o filtro para o Acre é feito aqui, nunca no cliente (o payload bruto
// tem ~100 KB por aviso, a maior parte ícone base64 + lista nacional
// de municípios).
//
// NUNCA grava nada sozinho: a tela só PROPÕE o texto do aviso, quem
// monta o boletim revisa e edita antes de salvar — mesma disciplina
// da leitura assistida de laudo em PDF (Qualidade da Água).

const INMET_URL = 'https://apiprevmet3.inmet.gov.br/avisos/ativos';

function _municipiosDoAcre(municipiosTxt) {
  if (!municipiosTxt) return [];
  return String(municipiosTxt).split(',')
    .map(s => s.trim())
    .filter(s => / - AC \(/.test(s));
}

function _filtrarAcre(lista) {
  return (lista || [])
    .map(a => ({
      id: a.id,
      evento: a.descricao,
      severidade: a.severidade,
      cor: a.aviso_cor,
      inicio: a.inicio,
      fim: a.fim,
      riscos: Array.isArray(a.riscos) ? a.riscos : [],
      instrucoes: Array.isArray(a.instrucoes) ? a.instrucoes : [],
      municipiosAcre: _municipiosDoAcre(a.municipios),
    }))
    .filter(a => a.municipiosAcre.length > 0);
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'GET') { res.status(405).json({ error: 'Method not allowed' }); return; }

  try {
    const r = await fetch(INMET_URL, {
      signal: AbortSignal.timeout(15000),
      headers: { 'User-Agent': 'SIGUC-AC/1.0 (+https://siguc-ac.vercel.app)' },
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const dados = await r.json();

    res.setHeader('Cache-Control', 's-maxage=900, stale-while-revalidate=1800');
    res.status(200).json({
      ok: true,
      atualizado_em: new Date().toISOString(),
      hoje: _filtrarAcre(dados.hoje),
      futuro: _filtrarAcre(dados.futuro),
    });
  } catch (err) {
    res.status(502).json({ ok: false, erro: 'Não foi possível consultar o INMET: ' + err.message });
  }
};
