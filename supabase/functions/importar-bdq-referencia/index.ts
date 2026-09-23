// ═══════════════════════════════════════════════════════════
// SIGUC-AC · Edge Function — Série histórica BDQueimadas/INPE
// (satélite de referência, AQUA_M-T, ano civil) → focos_bdq_ref.
// Migration 343 explica a escolha da série.
//
// UM ANO POR CHAMADA (limite de CPU da Edge Function) e SÓ ano FECHADO
// que ainda não está no banco. Chamar de novo com o ano já importado
// não faz nada — a função é pública como as demais (os crons usam a
// chave anon), então ser inofensiva por construção é a proteção.
//
// Corpo: {} → importa o ano mais antigo que falta; {"ano": 2025} → só
// esse. Chamada pelo `ingest-focos` diário quando falta ano fechado:
// a temporada de um ano entra sozinha quando o INPE publicar o arquivo.
// ═══════════════════════════════════════════════════════════

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { unzipSync } from 'https://esm.sh/fflate@0.8.2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SUPABASE_SRK = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const db = createClient(SUPABASE_URL, SUPABASE_SRK)

const BASE = 'https://dataserver-coids.inpe.br/queimadas/queimadas/focos/csv/anual'
const ANO_MIN = 2003
// Arquivo do Acre primeiro (pequeno); o do Brasil só quando o do estado
// ainda não saiu (o INPE parou de atualizar a pasta por estado em 2024).
const arquivos = (ano: number) => [
  `${BASE}/EstadosBr_sat_ref/AC/focos_br_ac_ref_${ano}.zip`,
  `${BASE}/Brasil_sat_ref/focos_br_ref_${ano}.zip`,
]

const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json' } })

// "2024/08/15 17:20:00", "2024-08-15 17:20:00" ou ISO → ISO UTC
function isoUTC(v: string): string | null {
  const m = /^(\d{4})[-/](\d{2})[-/](\d{2})[ T]?(\d{2})?:?(\d{2})?:?(\d{2})?/.exec(v.trim())
  if (!m) return null
  return `${m[1]}-${m[2]}-${m[3]}T${m[4] ?? '00'}:${m[5] ?? '00'}:${m[6] ?? '00'}Z`
}

function extrairAcre(csv: string, ano: number) {
  const fimCab = csv.indexOf('\n')
  const cab = csv.slice(0, fimCab).replace(/\r/g, '').split(',').map(h => h.trim().replace(/"/g, '').toLowerCase())
  const idx = (...nomes: string[]) => nomes.map(n => cab.indexOf(n)).find(i => i >= 0) ?? -1
  const iLat = idx('lat', 'latitude'), iLon = idx('lon', 'longitude')
  const iData = idx('data_hora_gmt', 'data_pas', 'datahora', 'data_hora', 'data')
  const iEst = idx('estado'), iMun = idx('municipio')
  if (iLat < 0 || iLon < 0 || iData < 0) throw new Error('cabeçalho inesperado: ' + cab.join(','))
  const out: Record<string, unknown>[] = []
  let pos = fimCab + 1
  while (pos < csv.length) {
    let fim = csv.indexOf('\n', pos); if (fim < 0) fim = csv.length
    const l = csv.slice(pos, fim); pos = fim + 1
    // arquivo do Brasil: descarta cedo, sem dividir a linha
    if (iEst >= 0 && l.indexOf('ACRE') < 0 && l.indexOf('Acre') < 0) continue
    const v = l.replace(/\r/g, '').split(',').map(s => s.replace(/"/g, '').trim())
    if (iEst >= 0 && v[iEst].toUpperCase() !== 'ACRE') continue
    const lat = parseFloat(v[iLat]), lon = parseFloat(v[iLon]), dh = isoUTC(v[iData] ?? '')
    if (!isFinite(lat) || !isFinite(lon) || !dh || +dh.slice(0, 4) !== ano) continue
    out.push({ ano, data_hora: dh, lat, lon, municipio: iMun >= 0 ? v[iMun] || null : null })
  }
  return out
}

Deno.serve(async (req) => {
  const anoAtual = new Date().getUTCFullYear()
  let pedido: number | null = null
  try { const b = await req.json(); if (b?.ano != null) pedido = Number(b.ano) } catch { /* corpo vazio */ }
  if (pedido != null && (!Number.isInteger(pedido) || pedido < ANO_MIN || pedido >= anoAtual))
    return json({ ok: false, erro: `ano fora do intervalo ${ANO_MIN}–${anoAtual - 1} (só ano fechado)` }, 400)

  const { data: feitos, error: e1 } = await db.from('focos_bdq_resumo_ano').select('ano')
  if (e1) return json({ ok: false, erro: e1.message }, 500)
  const tem = new Set((feitos ?? []).map(r => r.ano))
  const faltam: number[] = []
  for (let a = ANO_MIN; a < anoAtual; a++) if (!tem.has(a)) faltam.push(a)
  const ano = pedido ?? faltam[0]
  if (ano == null || tem.has(ano)) return json({ ok: true, nada_a_fazer: true, faltam })

  let csv: string | null = null, usado = ''
  for (const url of arquivos(ano)) {
    const r = await fetch(url, { signal: AbortSignal.timeout(60000) })
    if (!r.ok) { await r.body?.cancel(); continue }
    const zip = unzipSync(new Uint8Array(await r.arrayBuffer()))
    const nome = Object.keys(zip).find(n => n.toLowerCase().endsWith('.csv'))
    if (!nome) continue
    csv = new TextDecoder('utf-8').decode(zip[nome]); usado = url.split('/csv/anual/')[1]
    break
  }
  if (csv == null) return json({ ok: true, ano, nao_publicado: true, faltam })

  const linhas = extrairAcre(csv, ano)
  csv = null
  // Refaz o ano do zero: sobra de uma tentativa interrompida não soma.
  const { error: e2 } = await db.from('focos_bdq_ref').delete().eq('ano', ano)
  if (e2) return json({ ok: false, ano, erro: e2.message }, 500)
  for (let i = 0; i < linhas.length; i += 2000) {
    const { error } = await db.from('focos_bdq_ref')
      .upsert(linhas.slice(i, i + 2000), { onConflict: 'data_hora,lat,lon', ignoreDuplicates: true })
    if (error) return json({ ok: false, ano, erro: 'insert: ' + error.message }, 500)
  }
  const { data: total, error: e3 } = await db.rpc('bdq_ref_reagregar', { p_ano: ano, p_arquivo: usado })
  if (e3) return json({ ok: false, ano, erro: 'reagregar: ' + e3.message }, 500)
  return json({ ok: true, ano, arquivo: usado, lidos: linhas.length, gravados: total, faltam: faltam.filter(a => a !== ano) })
})
