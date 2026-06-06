// SIGUC-AC · Edge Function — Sincronizar SINAFLOR
// Baixa o dataset público de ASVs do IBAMA, filtra Acre e upserta em sinaflor_asv.
//
// Dataset: https://dadosabertos.ibama.gov.br/dataset/sinaflor-autorizacao-de-supressao-de-vegetacao
// Arquivo: Azure Blob — sinaflor-autorizacao-de-supressao-de-vegetacao.csv (separador ;)
//
// Cron sugerido: diário às 05h BRT (08h UTC)
// Disparo manual: POST /functions/v1/sincronizar-sinaflor

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SUPABASE_SRK = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const CSV_URL = 'https://stibamadadosabertosprd.blob.core.windows.net/dados-abertos/dados/SINAFLOR/AutSuprVegetacao/sinaflor-autorizacao-de-supressao-de-vegetacao.csv'

const db = createClient(SUPABASE_URL, SUPABASE_SRK)

// ── Parser CSV com separador ; ────────────────────────────────────────────────

function parseCSV(text: string): Record<string, string>[] {
  const lines = text.split('\n').filter(l => l.trim())
  if (lines.length < 2) return []
  const headers = lines[0].split(';').map(h => h.trim().replace(/^"|"$/g, ''))
  return lines.slice(1).map(line => {
    const vals = line.split(';')
    const obj: Record<string, string> = {}
    headers.forEach((h, i) => {
      obj[h] = (vals[i] ?? '').trim().replace(/^"|"$/g, '')
    })
    return obj
  })
}

// DD/MM/AA ou DD/MM/AAAA → YYYY-MM-DD
function parseData(s: string): string | null {
  if (!s) return null
  const parts = s.split('/')
  if (parts.length !== 3) return null
  const [d, m, y] = parts
  const ano = y.length === 2 ? `20${y}` : y
  return `${ano}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`
}

function parseNum(s: string): number | null {
  if (!s) return null
  const n = parseFloat(s.replace(',', '.'))
  return isNaN(n) ? null : n
}

// ── Mapeia linha CSV → registro sinaflor_asv ──────────────────────────────────

function mapRow(r: Record<string, string>): Record<string, unknown> | null {
  // Só importa Acre
  if ((r.uf ?? '').trim().toUpperCase() !== 'AC') return null

  const fonteId = (r.nro_autorizacao || r.nro_registro || '').trim()
  if (!fonteId) return null

  return {
    fonte_id:        fonteId,
    nro_registro:    r.nro_registro || null,
    nro_autorizacao: r.nro_autorizacao || null,
    num_asv:         r.nro_autorizacao || r.nro_registro || null,
    uf:              'AC',
    municipio:       r.municipio || null,
    nome_detentor:   r.nome_detentor || null,
    cpf_cnpj:        r.cpf_cnpj_detentor || null,
    nome_imovel:     r.imovel_rural_vinculado || null,
    cod_imovel:      r.nro_car_imovel_rural || null,
    data_emissao:    parseData(r.data_de_emissao),
    data_validade:   parseData(r.data_de_validade),
    area_ha:         parseNum(r.area_total_proj),
    tipo_supressao:  r.atividade || null,
    finalidade:      r.finalidade_supressao || null,
    bioma:           r.bioma || null,
    orgao_ambiental: r.orgao_ambiental_resp_analise || null,
    situacao:        r.situacao || null,
    status:          _mapSituacao(r.situacao),
    lat:             parseNum(r.latitude_ponto_centr_empreend),
    lon:             parseNum(r.longitude_ponto_centr_empreend),
    atualizado_em:   new Date().toISOString(),
  }
}

function _mapSituacao(s: string): string {
  const v = (s ?? '').toLowerCase()
  if (v.includes('cancelad') || v.includes('indeferid')) return 'cancelada'
  if (v.includes('suspens'))  return 'suspensa'
  if (v.includes('vencid') || v.includes('expirad')) return 'vencida'
  return 'vigente'
}

// ── Handler principal ─────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      },
    })
  }

  const inicio = Date.now()
  console.log('[sincronizar-sinaflor] Iniciando download do CSV...')

  try {
    // Download CSV
    const res = await fetch(CSV_URL, { signal: AbortSignal.timeout(120_000) })
    if (!res.ok) throw new Error(`HTTP ${res.status} ao baixar CSV do IBAMA`)

    const csvText = await res.text()
    console.log(`[sincronizar-sinaflor] CSV baixado: ${Math.round(csvText.length / 1024)} KB`)

    // Parse e filtrar AC
    const rows = parseCSV(csvText)
    const registros = rows.map(mapRow).filter(Boolean) as Record<string, unknown>[]
    console.log(`[sincronizar-sinaflor] Registros AC encontrados: ${registros.length}`)

    if (!registros.length) {
      return new Response(JSON.stringify({ ok: false, erro: 'Nenhum registro AC encontrado' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      })
    }

    // Upsert em lotes de 500
    const LOTE = 500
    let inseridos = 0
    let erros: string[] = []

    for (let i = 0; i < registros.length; i += LOTE) {
      const lote = registros.slice(i, i + LOTE)
      const { error, count } = await db
        .from('sinaflor_asv')
        .upsert(lote, { onConflict: 'fonte_id', ignoreDuplicates: false })
        .select('id', { count: 'exact', head: true })

      if (error) {
        erros.push(`lote ${i}-${i+LOTE}: ${error.message}`)
        console.error('[sincronizar-sinaflor] Erro lote:', error.message)
      } else {
        inseridos += count ?? lote.length
      }
    }

    const duracao = Date.now() - inicio
    console.log(`[sincronizar-sinaflor] Concluído: ${inseridos} upserts em ${duracao}ms`)

    return new Response(JSON.stringify({
      ok: true,
      registros_ac: registros.length,
      upserts: inseridos,
      erros,
      duracao_ms: duracao,
      timestamp: new Date().toISOString(),
    }), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    })

  } catch (e) {
    console.error('[sincronizar-sinaflor] Erro fatal:', e)
    return new Response(JSON.stringify({ ok: false, erro: e.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
})
