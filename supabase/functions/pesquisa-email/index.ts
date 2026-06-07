// ── SIGUC-AC · Edge Function: pesquisa-email ─────────────────
// Envia e-mails transacionais via Resend API para todas as
// interações do sistema com o pesquisador.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const RESEND_KEY     = Deno.env.get('RESEND_API_KEY') ?? ''
const FROM_EMAIL     = Deno.env.get('EMAIL_FROM')     ?? 'noreply@siguc.sema.ac.gov.br'
const FROM_NAME      = 'SIGUC · SEMA/AC'
const SEMA_EMAIL     = Deno.env.get('SEMA_EMAIL')     ?? 'sema.gabin@gmail.com'
const BASE_URL       = Deno.env.get('BASE_URL')       ?? 'https://siguc.sema.ac.gov.br'

// ── Templates de e-mail ──────────────────────────────────────

function wrapLayout(titulo: string, corpo: string): string {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>${titulo}</title></head>
<body style="margin:0;padding:0;background:#F4EFE6;font-family:'DM Sans',Arial,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F4EFE6;padding:32px 16px">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%">
        <!-- Header -->
        <tr><td style="background:#0A1A0F;border-radius:12px 12px 0 0;padding:24px 32px">
          <div style="font-family:Georgia,serif;font-size:24px;font-weight:700;color:#F0CB6A;letter-spacing:-.02em">SIGUC</div>
          <div style="font-size:11px;color:#9CA3AF;letter-spacing:.08em;text-transform:uppercase;margin-top:2px">Sistema de Gestão de UCs · SEMA/AC</div>
        </td></tr>
        <!-- Body -->
        <tr><td style="background:#fff;padding:32px;border-radius:0 0 12px 12px">
          ${corpo}
          <hr style="border:none;border-top:1px solid #F3F4F6;margin:28px 0">
          <p style="font-size:11px;color:#9CA3AF;margin:0;line-height:1.6">
            Este é um e-mail automático do SIGUC — Sistema de Gestão de Unidades de Conservação do Acre.<br>
            Secretaria de Estado do Meio Ambiente · Rua Benjamin Constant, nº 856 — Centro, Rio Branco/AC<br>
            CEP 69900-160 · Seg–Sex 7h–14h · <a href="mailto:sema.gabin@gmail.com" style="color:#52B788">sema.gabin@gmail.com</a>
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`
}

function h2(t: string) {
  return `<h2 style="font-size:20px;font-weight:800;color:#0A1A0F;margin:0 0 16px">${t}</h2>`
}
function p(t: string) {
  return `<p style="font-size:14px;color:#374151;line-height:1.7;margin:0 0 12px">${t}</p>`
}
function btn(label: string, url: string) {
  return `<a href="${url}" style="display:inline-block;margin:12px 0 20px;padding:12px 28px;background:#52B788;color:#fff;font-weight:700;font-size:14px;border-radius:8px;text-decoration:none">${label}</a>`
}
function info(label: string, valor: string) {
  return `<tr>
    <td style="padding:8px 12px;font-size:12px;font-weight:700;color:#374151;background:#F9FAFB;border-radius:4px;width:160px">${label}</td>
    <td style="padding:8px 12px;font-size:12px;color:#6B7280">${valor}</td>
  </tr>`
}
function infoTable(linhas: string[]) {
  return `<table cellpadding="0" cellspacing="4" style="width:100%;margin:12px 0">${linhas.join('')}</table>`
}

type Dados = Record<string, string>

const TEMPLATES: Record<string, (d: Dados) => { assunto: string; html: string }> = {

  submissao: (d) => ({
    assunto: `[SIGUC] Pesquisa ${d.numero} recebida — aguarda análise`,
    html: wrapLayout('Pesquisa recebida', `
      ${h2('✅ Sua pesquisa foi recebida!')}
      ${p(`Olá, <strong>${d.pesquisador_nome}</strong>! Recebemos a submissão da sua pesquisa e ela já está em análise pela equipe técnica da SEMA/AC.`)}
      ${infoTable([
        info('Número do processo', d.numero),
        info('Título', d.titulo),
        info('UC de interesse', d.uc || 'A definir'),
        info('Data de submissão', d.data),
      ])}
      ${p('Guarde o número do processo acima — você pode acompanhar o status a qualquer momento pelo link abaixo:')}
      ${btn('Acompanhar minha pesquisa', `${BASE_URL}/pages/pesquisa-status.html?token=${d.token}`)}
      ${p('Em caso de dúvidas, entre em contato com a DEUC/DIMA pelo e-mail <a href="mailto:sema.gabin@gmail.com" style="color:#52B788">sema.gabin@gmail.com</a>.')}
    `),
  }),

  submissao_sema: (d) => ({
    assunto: `[SIGUC] Nova pesquisa submetida — ${d.numero}`,
    html: wrapLayout('Nova pesquisa submetida', `
      ${h2('Nova pesquisa aguarda triagem')}
      ${infoTable([
        info('Número', d.numero),
        info('Pesquisador', d.pesquisador_nome),
        info('E-mail', d.pesquisador_email),
        info('Instituição', d.instituicao || '—'),
        info('Título', d.titulo),
        info('UC', d.uc || 'A definir'),
      ])}
      ${btn('Abrir no sistema', `${BASE_URL}/pages/pesquisas.html`)}
    `),
  }),

  triagem_aprovada: (d) => ({
    assunto: `[SIGUC] ${d.numero} — Pesquisa aceita para análise técnica`,
    html: wrapLayout('Pesquisa aceita', `
      ${h2('🎉 Sua pesquisa foi aceita!')}
      ${p(`Olá, <strong>${d.pesquisador_nome}</strong>! A equipe técnica da DEUC/DIMA aceitou sua pesquisa na triagem inicial. Ela seguirá para análise técnica.`)}
      ${infoTable([
        info('Número do processo', d.numero),
        info('Próxima etapa', 'Análise técnica'),
      ])}
      ${d.observacao ? p(`<em>Observação do analista: ${d.observacao}</em>`) : ''}
      ${btn('Acompanhar status', `${BASE_URL}/pages/pesquisa-status.html?token=${d.token}`)}
    `),
  }),

  triagem_rejeitada: (d) => ({
    assunto: `[SIGUC] ${d.numero} — Pesquisa não aceita`,
    html: wrapLayout('Pesquisa não aceita', `
      ${h2('Pesquisa não aceita')}
      ${p(`Olá, <strong>${d.pesquisador_nome}</strong>. Após análise da triagem, sua pesquisa <strong>${d.numero}</strong> não foi aceita.`)}
      ${d.observacao ? `<div style="background:#FEF2F2;border-left:4px solid #DC2626;padding:12px 16px;border-radius:4px;margin:12px 0"><p style="font-size:13px;color:#991B1B;margin:0"><strong>Motivo:</strong> ${d.observacao}</p></div>` : ''}
      ${p('Se desejar contestar ou obter mais informações, entre em contato com a DEUC/DIMA.')}
      <a href="mailto:sema.gabin@gmail.com" style="display:inline-block;margin:12px 0;padding:10px 22px;background:#0A1A0F;color:#fff;border-radius:8px;text-decoration:none;font-size:13px;font-weight:700">Entrar em contato</a>
    `),
  }),

  complementacao: (d) => ({
    assunto: `[SIGUC] ${d.numero} — Documentação complementar solicitada`,
    html: wrapLayout('Documentação solicitada', `
      ${h2('📎 Documentação complementar necessária')}
      ${p(`Olá, <strong>${d.pesquisador_nome}</strong>. A equipe técnica solicita documentação complementar para continuar a análise da sua pesquisa.`)}
      <div style="background:#FFFBEB;border-left:4px solid #F59E0B;padding:14px 16px;border-radius:4px;margin:16px 0">
        <p style="font-size:13px;color:#92400E;margin:0"><strong>O que é solicitado:</strong><br>${d.motivo}</p>
        ${d.prazo ? `<p style="font-size:12px;color:#B45309;margin:8px 0 0"><strong>Prazo:</strong> ${d.prazo}</p>` : ''}
      </div>
      ${p('Acesse o portal abaixo para enviar os documentos solicitados:')}
      ${btn('Enviar documentos agora', `${BASE_URL}/pages/pesquisa-status.html?token=${d.token}`)}
    `),
  }),

  aap_emitida: (d) => ({
    assunto: `[SIGUC] AAP emitida — ${d.aap_numero}`,
    html: wrapLayout('AAP emitida', `
      ${h2('📋 Autorização de Acesso e Pesquisa emitida!')}
      ${p(`Olá, <strong>${d.pesquisador_nome}</strong>! Sua Autorização de Acesso e Pesquisa (AAP) foi emitida e está disponível no sistema.`)}
      ${infoTable([
        info('Número da AAP', d.aap_numero),
        info('Processo', d.numero),
        info('Validade', d.validade),
      ])}
      ${p('Acesse o portal para baixar o documento. A AAP deve ser apresentada sempre que solicitado durante as atividades de campo.')}
      ${btn('Acessar minha AAP', `${BASE_URL}/pages/pesquisa-status.html?token=${d.token}`)}
      ${p('<strong>Verificação:</strong> a autenticidade desta AAP pode ser verificada em qualquer momento através do QR Code impresso no documento.')}
    `),
  }),

  relatorio_solicitado: (d) => ({
    assunto: `[SIGUC] ${d.numero} — ${d.tipo_relatorio} aguardado`,
    html: wrapLayout('Relatório solicitado', `
      ${h2(`📄 ${d.tipo_relatorio} aguardado`)}
      ${p(`Olá, <strong>${d.pesquisador_nome}</strong>. Conforme cronograma da sua pesquisa, o ${d.tipo_relatorio.toLowerCase()} está sendo aguardado.`)}
      ${d.prazo ? infoTable([info('Prazo de entrega', d.prazo)]) : ''}
      ${p('Acesse o portal para enviar o documento:')}
      ${btn('Enviar relatório', `${BASE_URL}/pages/pesquisa-status.html?token=${d.token}`)}
    `),
  }),

  encerrada: (d) => ({
    assunto: `[SIGUC] ${d.numero} — Pesquisa encerrada`,
    html: wrapLayout('Pesquisa encerrada', `
      ${h2('✅ Pesquisa encerrada com sucesso')}
      ${p(`Olá, <strong>${d.pesquisador_nome}</strong>. Sua pesquisa <strong>${d.numero}</strong> foi formalmente encerrada pela DEUC/DIMA.`)}
      ${p('Agradecemos pela contribuição ao conhecimento científico das Unidades de Conservação do Acre. Os resultados da sua pesquisa são fundamentais para a gestão e conservação dessas áreas.')}
      ${btn('Ver histórico completo', `${BASE_URL}/pages/pesquisa-status.html?token=${d.token}`)}
    `),
  }),

  triagem_exigencia: (d) => ({
    assunto: `[SIGUC] ${d.numero} — Documentação complementar necessária (triagem)`,
    html: wrapLayout('Exigência na triagem', `
      ${h2('📎 Sua pesquisa precisa de ajustes')}
      ${p(`Olá, <strong>${d.pesquisador_nome}</strong>. Na triagem da pesquisa <strong>${d.numero}</strong> foram identificadas pendências que precisam ser atendidas antes de prosseguir.`)}
      ${d.motivo ? `<div style="background:#FFFBEB;border-left:4px solid #F59E0B;padding:14px 16px;border-radius:4px;margin:16px 0"><p style="font-size:13px;color:#92400E;margin:0"><strong>O que é solicitado:</strong><br>${d.motivo}</p></div>` : ''}
      ${p('Acesse o portal abaixo para enviar os documentos ou esclarecimentos solicitados:')}
      ${btn('Atender exigência', `${BASE_URL}/pages/pesquisa-status.html?token=${d.token}`)}
    `),
  }),

  relatorio_exigencia: (d) => ({
    assunto: `[SIGUC] ${d.numero} — Complementação do relatório necessária`,
    html: wrapLayout('Complementação do relatório', `
      ${h2('📄 Relatório precisa de complementação')}
      ${p(`Olá, <strong>${d.pesquisador_nome}</strong>. A análise do relatório da pesquisa <strong>${d.numero}</strong> apontou a necessidade de complementação.`)}
      ${d.motivo ? `<div style="background:#FFFBEB;border-left:4px solid #F59E0B;padding:14px 16px;border-radius:4px;margin:16px 0"><p style="font-size:13px;color:#92400E;margin:0"><strong>Observações:</strong><br>${d.motivo}</p></div>` : ''}
      ${p('Acesse o portal para reenviar o relatório com os ajustes solicitados:')}
      ${btn('Reenviar relatório', `${BASE_URL}/pages/pesquisa-status.html?token=${d.token}`)}
    `),
  }),

  autorizacao_negada: (d) => ({
    assunto: `[SIGUC] ${d.numero} — Pesquisa não autorizada`,
    html: wrapLayout('Pesquisa não autorizada', `
      ${h2('Pesquisa não autorizada')}
      ${p(`Olá, <strong>${d.pesquisador_nome}</strong>. Após análise final, a pesquisa <strong>${d.numero}</strong> não foi autorizada pelo Secretário de Estado do Meio Ambiente.`)}
      ${d.motivo ? `<div style="background:#FEF2F2;border-left:4px solid #DC2626;padding:12px 16px;border-radius:4px;margin:12px 0"><p style="font-size:13px;color:#991B1B;margin:0"><strong>Fundamento:</strong> ${d.motivo}</p></div>` : ''}
      ${p('Para mais informações ou eventual recurso, entre em contato com a DEUC/DIMA.')}
      <a href="mailto:sema.gabin@gmail.com" style="display:inline-block;margin:12px 0;padding:10px 22px;background:#0A1A0F;color:#fff;border-radius:8px;text-decoration:none;font-size:13px;font-weight:700">Entrar em contato</a>
    `),
  }),

  // Evento interno: avisa o Secretário que há pesquisa aguardando autorização
  aviso_secretario: (d) => ({
    assunto: `[SIGUC] ${d.numero} — Pesquisa aguarda autorização do Secretário`,
    html: wrapLayout('Pesquisa aguarda autorização', `
      ${h2('Pesquisa aguardando autorização')}
      ${p('Uma pesquisa concluiu o parecer da DIMA e aguarda autorização do Gabinete.')}
      ${infoTable([
        info('Número', d.numero),
        info('Título', d.titulo),
        info('UC', d.uc || 'A definir'),
      ])}
      ${btn('Abrir no sistema', `${BASE_URL}/pages/pesquisas.html`)}
    `),
  }),
}

// ── Envio via Resend ─────────────────────────────────────────

async function enviarEmail(para: string, assunto: string, html: string): Promise<{ id?: string; erro?: string }> {
  if (!RESEND_KEY) return { erro: 'RESEND_API_KEY não configurada' }

  const resp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: `${FROM_NAME} <${FROM_EMAIL}>`, to: [para], subject: assunto, html }),
  })

  if (!resp.ok) {
    const err = await resp.text()
    return { erro: `Resend ${resp.status}: ${err}` }
  }

  const data = await resp.json()
  return { id: data.id }
}

// ── Handler ───────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  const supabaseAdmin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  try {
    const body = await req.json() as {
      email_log_id?: string   // ID do registro em pesquisa_emails para processar
      evento?: string         // ou chamar diretamente com evento + dados
      dados?: Dados
      destinatario?: string
      pesquisa_id?: string
      enviar_copia_sema?: boolean
    }

    let evento = body.evento
    let dados  = body.dados || {}
    let para   = body.destinatario || dados.pesquisador_email || ''
    let pesquisa_id = body.pesquisa_id

    // Se vier por email_log_id, busca do banco
    if (body.email_log_id) {
      const { data: log } = await supabaseAdmin
        .from('pesquisa_emails').select('*').eq('id', body.email_log_id).single()
      if (log) {
        evento = log.evento
        para   = log.destinatario
        pesquisa_id = log.pesquisa_id
      }
    }

    // Busca dados da pesquisa se necessário
    if (pesquisa_id && (!dados.numero || !dados.token)) {
      const { data: p } = await supabaseAdmin
        .from('pesquisas')
        .select('*, uc:unidades_conservacao(nome)')
        .eq('id', pesquisa_id).single()
      if (p) {
        dados = {
          numero:           p.numero_processo || '',
          titulo:           p.titulo,
          pesquisador_nome: p.pesquisador_nome || '',
          pesquisador_email:p.pesquisador_email || '',
          instituicao:      p.pesquisador_instituicao || '',
          uc:               p.uc?.nome || '',
          token:            p.token_publico || '',
          data:             new Date(p.criado_em).toLocaleDateString('pt-BR'),
          aap_numero:       p.aap_numero || '',
          validade:         p.aap_validade || '',
          motivo:           p.complementacao_motivo || '',
          prazo:            p.complementacao_prazo || '',
          ...dados,
        }
      }
    }

    if (!evento || !para || !TEMPLATES[evento]) {
      return new Response(JSON.stringify({ error: 'evento ou destinatário inválido' }), {
        status: 400, headers: { ...CORS, 'Content-Type': 'application/json' },
      })
    }

    const template = TEMPLATES[evento](dados)
    const resultado = await enviarEmail(para, template.assunto, template.html)

    // Atualiza log no banco
    if (pesquisa_id || body.email_log_id) {
      const filtro = body.email_log_id
        ? { id: body.email_log_id }
        : { pesquisa_id, evento }

      await supabaseAdmin.from('pesquisa_emails').update({
        status:    resultado.erro ? 'erro' : 'enviado',
        resend_id: resultado.id || null,
        erro:      resultado.erro || null,
        enviado_em:new Date().toISOString(),
      }).match(filtro)
    }

    // Cópia para SEMA se solicitada
    if (body.enviar_copia_sema && evento === 'submissao') {
      const tplSema = TEMPLATES['submissao_sema'](dados)
      await enviarEmail(SEMA_EMAIL, tplSema.assunto, tplSema.html)
    }

    return new Response(JSON.stringify(resultado), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }
})
