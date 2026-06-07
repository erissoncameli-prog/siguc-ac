// ═══════════════════════════════════════════════════════════
// SIGUC-AC · Edge Function — Processar fila de e-mails de pesquisa
// Drena pesquisa_emails (status='pendente') e dispara o envio via
// a função pesquisa-email. Pensada para rodar em cron (ex: a cada
// 5 min) e também por disparo manual via POST.
//
// Sem esta função, os registros enfileirados pelas funções SQL do
// fluxo de pesquisa ficavam presos em 'pendente' e nunca eram
// enviados ao pesquisador.
// ═══════════════════════════════════════════════════════════

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SUPABASE_SRK = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const SUPABASE_ANON = Deno.env.get('SUPABASE_ANON_KEY') ?? ''

// Eventos cujo e-mail interno (cópia SEMA) também deve ser enviado
const COPIA_SEMA = new Set(['submissao'])

const db = createClient(SUPABASE_URL, SUPABASE_SRK)

async function dispararEmail(emailLogId: string, evento: string): Promise<boolean> {
  const resp = await fetch(`${SUPABASE_URL}/functions/v1/pesquisa-email`, {
    method: 'POST',
    headers: {
      // apikey (anon, público) roteia no gateway; bearer (service role)
      // é a autenticação interna verificada por pesquisa-email.
      'Authorization': `Bearer ${SUPABASE_SRK}`,
      'apikey': SUPABASE_ANON || SUPABASE_SRK,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email_log_id: emailLogId,
      enviar_copia_sema: COPIA_SEMA.has(evento),
    }),
  })
  return resp.ok
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  const inicio = Date.now()
  let processados = 0
  let falhas = 0
  const erros: string[] = []

  try {
    // Pega lote de pendentes (e e-mails que falharam há mais de 30 min para retry)
    const { data: pendentes, error } = await db
      .from('pesquisa_emails')
      .select('id, evento, destinatario, criado_em, status')
      .or('status.eq.pendente,status.eq.erro')
      .order('criado_em', { ascending: true })
      .limit(50)

    if (error) throw error

    for (const log of pendentes ?? []) {
      if (!log.destinatario) {
        // Sem destinatário não há o que enviar — marca como erro definitivo
        await db.from('pesquisa_emails')
          .update({ status: 'erro', erro: 'Sem destinatário' })
          .eq('id', log.id)
        falhas++
        continue
      }
      try {
        const ok = await dispararEmail(log.id, log.evento)
        if (ok) processados++
        else { falhas++; erros.push(`log ${log.id}: pesquisa-email não OK`) }
      } catch (e) {
        falhas++
        erros.push(`log ${log.id}: ${(e as Error).message}`)
      }
    }

    return new Response(JSON.stringify({
      ok: true,
      processados,
      falhas,
      erros,
      duracao_ms: Date.now() - inicio,
      timestamp: new Date().toISOString(),
    }), { headers: { ...CORS, 'Content-Type': 'application/json' } })
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, erro: (e as Error).message }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }
})
