// ═══════════════════════════════════════════════════════════
// SIGUC-AC · Edge Function — Diagnóstico Socioeconômico: expurgo
// de fotos vencidas (migration 365).
//
// O banco limpa a identificação da ficha e põe o caminho de cada
// foto vencida em socio_expurgo_arquivos (fn_socio_aplicar_retencao,
// cron diário); o banco não remove arquivo do Storage, então esta
// função drena a fila: remove o arquivo e marca removido_em.
//
// Pública como os demais crons (chave anon): só drena a fila que o
// banco montou, não recebe caminho do chamador, e chamar de novo com
// a fila vazia não faz nada. Bucket fixo (o CHECK da tabela também).
// ═══════════════════════════════════════════════════════════

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const db = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '')
const BUCKET = 'socio-fotos'
const LOTE = 100

const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json' } })

Deno.serve(async () => {
  const { data: fila, error } = await db.from('socio_expurgo_arquivos')
    .select('id, caminho, tentativas')
    .eq('bucket', BUCKET).is('removido_em', null).lt('tentativas', 10)
    .order('criado_em').limit(LOTE)
  if (error) return json({ ok: false, erro: error.message }, 500)
  if (!fila?.length) return json({ ok: true, removidos: 0 })

  const { error: errRem } = await db.storage.from(BUCKET).remove(fila.map(f => f.caminho))
  const agora = new Date().toISOString()
  // remove() não falha por arquivo inexistente — já ter sumido também é sucesso
  for (const f of fila) {
    await db.from('socio_expurgo_arquivos')
      .update(errRem ? { tentativas: f.tentativas + 1, erro: errRem.message } : { removido_em: agora, erro: null })
      .eq('id', f.id)
  }
  return json({ ok: !errRem, removidos: errRem ? 0 : fila.length, erro: errRem?.message ?? null })
})
