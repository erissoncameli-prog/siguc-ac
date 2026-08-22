// ═══════════════════════════════════════════════════════════
// SIGUC-AC · Edge Function — relatório diário de rios por e-mail
// Lê a RPC rh_relatorio_diario (a MESMA que a tela usa — nenhuma
// agregação nova aqui) e envia o resumo por e-mail via RESEND.
//
// Destinatários: config_sistema.dados.hidro.emails, editável em
// Configurações › Qualidade da Água (campo "Relatório diário de rios").
// Lista vazia = não envia e-mail nenhum. Isso é decisão válida, não
// erro: o aviso de cota atingida continua chegando pelas notificações
// do sistema (rh_checar_cotas), que não dependem desta lista.
//
// Cron: migration 307 (08h BRT / 11h UTC).
// ═══════════════════════════════════════════════════════════

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SUPABASE_SRK = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const RESEND_KEY   = Deno.env.get('RESEND_API_KEY') ?? ''

const db = createClient(SUPABASE_URL, SUPABASE_SRK)

const COTA_LABEL: Record<string, string> = {
  normal: 'Normal', atencao: 'Atenção', alerta: 'Alerta', inundacao: 'Inundação',
}
// Mesmas cores da tela (js/rh-hidro.js) — validadas contra daltonismo
// em js/agua-iqa-visual.js. Cor nunca anda sozinha: o rótulo vai junto.
const COTA_COR: Record<string, string> = {
  normal: '#059669', atencao: '#CA8A04', alerta: '#C2410C', inundacao: '#86198F',
}

function num(v: unknown, casas = 0): string {
  if (v === null || v === undefined || v === '' || !isFinite(Number(v))) return '—'
  return Number(v).toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas })
}
function variacao(v: unknown): string {
  if (v === null || v === undefined || !isFinite(Number(v))) return '—'
  const n = Number(v)
  return `${n > 0 ? '+' : ''}${num(n, 0)} cm`
}
function esc(s: unknown): string {
  return String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!))
}

function montarHtml(linhas: any[], dataTxt: string): string {
  const emCota = linhas.filter(l => Number(l.estacoes_em_cota) > 0)
  const corpo = linhas.map(l => {
    const s = l.pior_situacao
    return `<tr>
      <td style="padding:7px 10px;border-bottom:1px solid #E5E7EB"><strong>${esc(l.rio)}</strong>
        <div style="color:#6B7280;font-size:11px">${esc(l.bacia || 'Bacia não informada')} · ${l.n_estacoes} estação(ões)</div></td>
      <td style="padding:7px 10px;border-bottom:1px solid #E5E7EB;text-align:right">${num(l.nivel_max_cm)} cm</td>
      <td style="padding:7px 10px;border-bottom:1px solid #E5E7EB;text-align:right">${variacao(l.variacao_cm)}</td>
      <td style="padding:7px 10px;border-bottom:1px solid #E5E7EB;text-align:right">${num(l.chuva_total_mm, 1)} mm</td>
      <td style="padding:7px 10px;border-bottom:1px solid #E5E7EB">
        ${Number(l.estacoes_em_cota) > 0
          ? `<span style="color:${COTA_COR[s] || '#6B7280'};font-weight:700">${esc(COTA_LABEL[s] || s)}</span> (${l.estacoes_em_cota})`
          : '<span style="color:#6B7280">—</span>'}</td>
    </tr>`
  }).join('')

  return `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:720px;color:#111827">
    <h2 style="font-size:17px;margin:0 0 4px">Monitoramento hidrometeorológico — ${esc(dataTxt)}</h2>
    <p style="color:#6B7280;font-size:12.5px;margin:0 0 14px">
      SIGUC-AC · Departamento de Recursos Hídricos e Qualidade Ambiental (SEMA-AC)</p>
    ${emCota.length
      ? `<div style="background:#FEF3C7;border:1px solid #FCD34D;border-radius:8px;padding:10px 12px;margin-bottom:14px;font-size:13px">
          <strong>${emCota.length} rio(s) com estação acima de cota:</strong>
          ${emCota.map(l => `${esc(l.rio)} (${esc(COTA_LABEL[l.pior_situacao] || l.pior_situacao)})`).join(' · ')}
        </div>`
      : `<div style="background:#ECFDF5;border:1px solid #A7F3D0;border-radius:8px;padding:10px 12px;margin-bottom:14px;font-size:13px">
          Nenhuma estação acima da cota de atenção neste dia.</div>`}
    ${linhas.length
      ? `<table style="width:100%;border-collapse:collapse;font-size:13px">
          <thead><tr style="text-align:left;color:#6B7280;font-size:11px;text-transform:uppercase">
            <th style="padding:0 10px 6px">Rio</th><th style="padding:0 10px 6px;text-align:right">Nível máx.</th>
            <th style="padding:0 10px 6px;text-align:right">Variação</th><th style="padding:0 10px 6px;text-align:right">Chuva</th>
            <th style="padding:0 10px 6px">Situação</th>
          </tr></thead><tbody>${corpo}</tbody></table>`
      : '<p style="font-size:13px;color:#6B7280">Nenhuma leitura registrada neste dia.</p>'}
    <p style="color:#9CA3AF;font-size:11px;margin-top:16px;line-height:1.5">
      Cotas de atenção, alerta e inundação são valores cadastrados por estação; a classificação é feita
      pelo banco comparando a leitura com essas cotas. Estação sem cota cadastrada não é classificada —
      e isso não significa nível normal.<br>
      Mensagem automática do SIGUC-AC. Para alterar quem recebe, use Configurações › Qualidade da Água.</p>
  </div>`
}

Deno.serve(async () => {
  try {
    // Dia anterior por padrão: a função roda de manhã e o dia cheio que
    // interessa é o que fechou (o dia corrente ainda está no começo).
    const alvo = new Date(Date.now() - 24 * 3600 * 1000)
    const dataISO = alvo.toISOString().slice(0, 10)
    const dataTxt = dataISO.split('-').reverse().join('/')

    const { data: linhas, error } = await db.rpc('rh_relatorio_diario', { p_data: dataISO })
    if (error) throw error

    const { data: cfg } = await db.from('config_sistema').select('dados').eq('id', 1).single()
    const emails: string[] = (cfg?.dados?.hidro?.emails ?? []).filter((e: string) => /.+@.+\..+/.test(e))

    if (!emails.length) {
      return Response.json({ ok: true, enviado: false, motivo: 'sem-destinatarios', rios: linhas?.length ?? 0 })
    }
    if (!RESEND_KEY) {
      return Response.json({ ok: false, enviado: false, motivo: 'sem-resend-key' }, { status: 500 })
    }

    const emCota = (linhas ?? []).filter((l: any) => Number(l.estacoes_em_cota) > 0)
    const assunto = emCota.length
      ? `[SIGUC] Rios em cota (${emCota.length}) — ${dataTxt}`
      : `[SIGUC] Monitoramento de rios — ${dataTxt}`

    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'SIGUC-AC Recursos Hídricos <alertas@siguc.sema.ac.gov.br>',
        to: emails,
        subject: assunto,
        html: montarHtml(linhas ?? [], dataTxt),
      }),
    })
    if (!r.ok) throw new Error(`Resend HTTP ${r.status}: ${await r.text()}`)

    return Response.json({ ok: true, enviado: true, destinatarios: emails.length, rios: linhas?.length ?? 0, data: dataISO })
  } catch (err) {
    return Response.json({ ok: false, erro: err.message }, { status: 500 })
  }
})
