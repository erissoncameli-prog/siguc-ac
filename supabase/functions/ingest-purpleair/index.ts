// ═══════════════════════════════════════════════════════════
// SIGUC-AC · Edge Function — ingestão da rede de sensores
// PurpleAir/MPAC de qualidade do ar (PM2.5) → ar_leituras_purpleair.
//
// ESTADO: LIGADA — PURPLEAIR_API_KEY configurada nos secrets do
// Supabase em 22/08/2026. Confirmado contra a API de verdade: 28
// sensores da rede MPAC dentro da bbox do Acre (ex.: MPAC_MNL_01_
// promotoria, MPAC_PTA_01_Sec.infraestrutura).
//
// ACHADO REAL (não estava nos manuais consultados): `j.fields` na
// resposta da API JÁ inclui "sensor_index" como primeiro elemento —
// a 1ª versão desta função prependia "sensor_index" de novo,
// desalinhando todos os índices por um (e a ordem devolvida também
// NÃO é a mesma do parâmetro `fields` da requisição: veio
// [sensor_index, last_seen, name, latitude, longitude, humidity,
// temperature, pm2.5_cf_1] para um pedido em outra ordem — por isso
// o código below localiza cada campo por NOME em `j.fields`, nunca
// por posição fixa). Sintoma do bug original: "Invalid time value" ao
// tentar montar a data a partir do campo errado.
//
// SEGUNDO ACHADO REAL: o campo `temperature` da API vem em
// FAHRENHEIT por padrão (não documentado explicitamente nos manuais
// consultados) — confirmado porque a 1ª carga real gravou 95-113 na
// coluna `temperatura_c`, valor impossível para o Acre em Celsius.
// Convertido aqui ((F-32)×5/9) antes de gravar — nunca grava
// Fahrenheit numa coluna que diz ser Celsius.
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

    // `j.fields` JÁ vem com "sensor_index" incluso — nunca prependar
    // de novo (ver achado no cabeçalho). Localizar cada campo por
    // nome, nunca por posição: a ordem devolvida não é a pedida.
    const fields: string[] = j.fields || []
    const iIndex = campoIndice(fields, 'sensor_index')
    const iNome = campoIndice(fields, 'name')
    const iLat = campoIndice(fields, 'latitude')
    const iLng = campoIndice(fields, 'longitude')
    const iPm25 = campoIndice(fields, 'pm2.5_cf_1')
    const iUmid = campoIndice(fields, 'humidity')
    const iTemp = campoIndice(fields, 'temperature')
    const iVisto = campoIndice(fields, 'last_seen')

    const linhas = (j.data || []).map((row: any[]) => {
      const lastSeen = iVisto >= 0 ? row[iVisto] : null
      const sensorIndex = iIndex >= 0 ? row[iIndex] : null
      if (lastSeen == null || sensorIndex == null) return null
      const lat = iLat >= 0 ? row[iLat] : null
      const lng = iLng >= 0 ? row[iLng] : null
      return {
        sensor_index: sensorIndex,
        nome: iNome >= 0 ? row[iNome] : null,
        geom: (lat != null && lng != null) ? `SRID=4326;POINT(${lng} ${lat})` : null,
        pm25_bruto: iPm25 >= 0 ? row[iPm25] : null,
        pm25_calibrado_lrapa: null, // ver cabeçalho da migration 313
        umidade_pct: iUmid >= 0 ? row[iUmid] : null,
        // O campo `temperature` da PurpleAir vem em FAHRENHEIT por
        // padrão (confirmado contra dado real: valores 95-113 para o
        // Acre só fazem sentido em °F — a coluna é `temperatura_c`,
        // então converte aqui; nunca grava Fahrenheit numa coluna que
        // diz ser Celsius).
        temperatura_c: (iTemp >= 0 && row[iTemp] != null) ? Math.round((Number(row[iTemp]) - 32) * 5 / 9 * 100) / 100 : null,
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
