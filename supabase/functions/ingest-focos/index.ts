// ═══════════════════════════════════════════════════════════
// SIGUC-AC · Edge Function — Ingestão diária de focos de calor
// FIRMS (NASA) + BDQueimadas (INPE) → tabela focos_calor.
// Desacoplada do módulo de Alertas: NÃO envia e-mails. Serve para
// o cruzamento na validação de campo (RPC focos_proximos_registro).
// Cron: 06h BRT (09h UTC). Idempotente (refaz a janela recente).
// ═══════════════════════════════════════════════════════════

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Chave FIRMS: mesma já usada (e pública) em /api/focos-proxy.js.
// Pode ser sobrescrita pelo secret FIRMS_MAP_KEY.
const FIRMS_KEY    = Deno.env.get('FIRMS_MAP_KEY') ?? '66690c20b8bf3f13bb21f8706e3a75d5'
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SUPABASE_SRK = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

const db = createClient(SUPABASE_URL, SUPABASE_SRK)

// Bounding box do Acre (W,S,E,N) com folga
const ACRE_BBOX = '-74.05,-11.25,-66.55,-7.05'
const SENSORES  = ['VIIRS_NOAA20_NRT', 'VIIRS_SNPP_NRT', 'MODIS_NRT']
const DIAS      = 3

function csvParaObjetos(csv: string): Record<string, string>[] {
  const linhas = csv.trim().split('\n')
  if (linhas.length < 2) return []
  const cab = linhas[0].split(',').map(h => h.trim())
  return linhas.slice(1).map(l => {
    const v = l.split(',')
    const o: Record<string, string> = {}
    cab.forEach((h, i) => { o[h] = (v[i] ?? '').trim() })
    return o
  })
}

// acq_date = 'YYYY-MM-DD', acq_time = 'HHMM' (UTC)
function dataHoraUTC(acqDate: string, acqTime: string): string {
  const t = String(acqTime ?? '0').padStart(4, '0')
  return `${acqDate}T${t.slice(0, 2)}:${t.slice(2, 4)}:00Z`
}

async function buscarFIRMS(sensor: string): Promise<any[]> {
  const url = `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${FIRMS_KEY}/${sensor}/${ACRE_BBOX}/${DIAS}`
  const r = await fetch(url, { signal: AbortSignal.timeout(20000) })
  if (!r.ok) throw new Error(`${sensor} HTTP ${r.status}`)
  return csvParaObjetos(await r.text())
}

async function buscarBDQueimadas(): Promise<any[]> {
  try {
    const r = await fetch('https://queimadas.dgi.inpe.br/api/focos/?page_size=1000&estado=AC',
      { signal: AbortSignal.timeout(20000) })
    if (!r.ok) return []
    const j = await r.json()
    return j.results ?? j ?? []
  } catch { return [] }
}

Deno.serve(async () => {
  const erros: string[] = []
  const linhas: any[] = []

  // FIRMS (NASA)
  for (const s of SENSORES) {
    try {
      for (const f of await buscarFIRMS(s)) {
        const lat = parseFloat(f.latitude), lon = parseFloat(f.longitude)
        if (!isFinite(lat) || !isFinite(lon)) continue
        linhas.push({
          lat, lon,
          data_hora: dataHoraUTC(f.acq_date, f.acq_time),
          satelite:  f.satellite || s,
          fonte:     'FIRMS',
          frp:       f.frp ? parseFloat(f.frp) : null,
          confianca: f.confidence || null,
        })
      }
    } catch (e) { erros.push(String((e as Error).message ?? e)) }
  }

  // BDQueimadas (INPE) — best-effort
  try {
    for (const f of await buscarBDQueimadas()) {
      const lat = parseFloat(f.lat ?? f.latitude), lon = parseFloat(f.lon ?? f.longitude)
      if (!isFinite(lat) || !isFinite(lon)) continue
      linhas.push({
        lat, lon,
        data_hora: f.data_hora_gmt ?? f.datahora ?? new Date().toISOString(),
        satelite:  f.satelite ?? f.satellite ?? 'INPE',
        fonte:     'BDQUEIMADAS',
        frp:       f.frp ? parseFloat(f.frp) : null,
        confianca: null,
      })
    }
  } catch (e) { erros.push('BDQ: ' + String((e as Error).message ?? e)) }

  // Idempotência: limpa a janela recente e reinsere
  const corte = new Date(Date.now() - DIAS * 86400000).toISOString()
  await db.from('focos_calor').delete().in('fonte', ['FIRMS', 'BDQUEIMADAS']).gte('data_hora', corte)

  let inseridos = 0
  for (let i = 0; i < linhas.length; i += 500) {
    const lote = linhas.slice(i, i + 500)
    const { error } = await db.from('focos_calor').insert(lote)
    if (error) erros.push('insert: ' + error.message)
    else inseridos += lote.length
  }

  return new Response(
    JSON.stringify({ ok: true, inseridos, total: linhas.length, erros }),
    { headers: { 'Content-Type': 'application/json' } },
  )
})
