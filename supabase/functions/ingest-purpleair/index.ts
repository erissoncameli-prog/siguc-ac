// ═══════════════════════════════════════════════════════════
// SIGUC-AC · Edge Function — ingestão da rede de sensores
// PurpleAir/MPAC de qualidade do ar (PM2.5) → ar_leituras_purpleair.
//
// ESTADO: pronta e DESLIGADA. Sem a credencial (PURPLEAIR_API_KEY nos
// secrets) a função devolve `{ ok:false, motivo:'sem-credencial' }` e
// não grava nada — de propósito, mesmo padrão do ingest-hidro
// (migration 306/307), para poder ser publicada antes de a SEMA
// concluir o registro da chave gratuita no PurpleAir. Medido nesta
// entrega, do próprio banco (pg_net): a API responde 403
// ApiKeyMissingError sem credencial — não há via anônima.
//
// Como ligar, quando a chave existir:
//   1. Registrar em https://develop.purpleair.com (gratuito, vinculado
//      a conta Google) e obter a Read Key.
//   2. Painel do Supabase → Edge Functions → Secrets:
//      PURPLEAIR_API_KEY (nunca no frontend, nunca no repositório).
//   3. Agendar no pg_cron (nenhum job criado ainda — ver 307_rh_crons.sql
//      para o molde de como agendar só depois da credencial existir).
//
// SEM CALIBRAÇÃO LRAPA — grava só o bruto (pm2.5_cf_1). Ver o
// cabeçalho da migration 313 para o motivo: aplicar a fórmula
// EPA/LRAPA sem dado real pra conferir contra um boletim publicado
// seria inventar número.
//
// Descoberta por BBOX: não existe inventário de sensores (a rede do
// MPAC não tem lista pública) — cada execução busca os sensores
// dentro da caixa delimitadora do Acre, vinda de limite_acre_bbox()
// (RPC, migration 313) — nunca uma bbox fixa duplicada aqui.
//
// Idempotente: upsert por (sensor_index, data_hora) — reprocessar a
// mesma janela nunca duplica leitura.
// ═══════════════════════════════════════════════════════════

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SUPABASE_SRK = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const PURPLEAIR_KEY = Deno.env.get('PURPLEAIR_API_KEY') ?? ''

const PURPLEAIR_BASE = 'https://api.purpleair.com/v1/sensors'
const CAMPOS = ['name', 'latitude', 'longitude', 'pm2.5_cf_1', 'humidity', 'temperature', 'last_seen']

const db = createClient(SUPABASE_URL, SUPABASE_SRK)

function campoIndice(fields: string[], nome: string): number {
  return fields.indexOf(nome)
}

Deno.serve(async (req) => {
  const inicio = Date.now()
  try {
    if (!PURPLEAIR_KEY) {
      // Não é erro: é o estado esperado enquanto a SEMA não registra a
      // chave gratuita. Responder 200 evita alarme falso no cron.
      return Response.json({
        ok: false, motivo: 'sem-credencial',
        detalhe: 'Defina PURPLEAIR_API_KEY nos secrets para ligar a ingestão (registro gratuito em develop.purpleair.com).',
      })
    }

    const { data: bbox, error: bboxErr } = await db.rpc('limite_acre_bbox').single()
    if (bboxErr) throw bboxErr
    if (!bbox || bbox.min_lng == null) {
      return Response.json({ ok: false, erro: 'limite_acre vazio — carregar a geometria do Acre antes (ver migration 239).' }, { status: 500 })
    }

    const url = `${PURPLEAIR_BASE}?fields=${encodeURIComponent(CAMPOS.join(','))}` +
      `&nwlng=${bbox.min_lng}&nwlat=${bbox.max_lat}&selng=${bbox.max_lng}&selat=${bbox.min_lat}`
    const r = await fetch(url, {
      headers: { 'X-API-Key': PURPLEAIR_KEY },
      signal: AbortSignal.timeout(20000),
    })
    if (!r.ok) throw new Error(`PurpleAir HTTP ${r.status}`)
    const j = await r.json()

    // `sensor_index` é sempre o primeiro elemento da linha, além dos
    // campos pedidos em `fields` — documentado pela própria PurpleAir.
    const fields: string[] = ['sensor_index', ...(j.fields || [])]
    const iNome = campoIndice(fields, 'name')
    const iLat = campoIndice(fields, 'latitude')
    const iLng = campoIndice(fields, 'longitude')
    const iPm25 = campoIndice(fields, 'pm2.5_cf_1')
    const iUmid = campoIndice(fields, 'humidity')
    const iTemp = campoIndice(fields, 'temperature')
    const iVisto = campoIndice(fields, 'last_seen')

    const linhas = (j.data || []).map((row: any[]) => {
      const lastSeen = iVisto >= 0 ? row[iVisto] : null
      if (lastSeen == null) return null
      const lat = iLat >= 0 ? row[iLat] : null
      const lng = iLng >= 0 ? row[iLng] : null
      return {
        sensor_index: row[0],
        nome: iNome >= 0 ? row[iNome] : null,
        geom: (lat != null && lng != null) ? `SRID=4326;POINT(${lng} ${lat})` : null,
        pm25_bruto: iPm25 >= 0 ? row[iPm25] : null,
        pm25_calibrado_lrapa: null, // ver cabeçalho da migration 313
        umidade_pct: iUmid >= 0 ? row[iUmid] : null,
        temperatura_c: iTemp >= 0 ? row[iTemp] : null,
        data_hora: new Date(Number(lastSeen) * 1000).toISOString(),
        bruto: row,
      }
    }).filter(Boolean)

    let gravadas = 0
    if (linhas.length) {
      const { error: upErr } = await db.from('ar_leituras_purpleair')
        .upsert(linhas, { onConflict: 'sensor_index,data_hora', ignoreDuplicates: true })
      if (upErr) throw upErr
      gravadas = linhas.length
    }

    return Response.json({
      ok: true, sensores: linhas.length, leituras_gravadas: gravadas, ms: Date.now() - inicio,
    })
  } catch (err) {
    return Response.json({ ok: false, erro: err.message }, { status: 500 })
  }
})
