// ═══════════════════════════════════════════════════════════
// SIGUC-AC · Edge Function — Monitorar Quelônios (Biomonitor)
// ───────────────────────────────────────────────────────────
// Cron diário (sugerido 06h BRT / 09h UTC) + disparo manual via POST.
// Executa a avaliação dos alertas AGREGADOS/SAZONAIS de incubação:
//   · Razão sexual da praia (feminização — sinal climático)
//   · Atraso de eclosão
//   · Friagem (frente fria) pelas visitas recentes
// Os alertas por ninho/visita são gerados em tempo real pelos
// triggers no banco (migration 093); aqui cuidamos do que só faz
// sentido em lote. As notificações caem na inbox do Painel do Gestor.
// ═══════════════════════════════════════════════════════════

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SUPABASE_SRK = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

const db = createClient(SUPABASE_URL, SUPABASE_SRK)

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  try {
    const { data, error } = await db.rpc('quelonio_avaliar_agregados')
    if (error) throw error

    console.log('[monitorar-quelonios]', JSON.stringify(data))
    return new Response(JSON.stringify({ ok: true, resultado: data }), {
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  } catch (e) {
    console.error('[monitorar-quelonios] erro:', e?.message ?? e)
    return new Response(JSON.stringify({ ok: false, erro: String(e?.message ?? e) }), {
      status: 500,
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }
})
