// ═══════════════════════════════════════════════════════════
// SIGUC-AC · Edge Function — Monitorar Alertas Ambientais
// Cron: 06h BRT (09h UTC) + disparo manual via POST
// ═══════════════════════════════════════════════════════════

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const FIRMS_KEY_ENV    = Deno.env.get('FIRMS_MAP_KEY') ?? ''
// Mesma chave (já pública) usada em ingest-focos e /api/focos-proxy.js.
// Fallback garante que FIRMS funcione mesmo sem o secret configurado.
const FIRMS_KEY        = FIRMS_KEY_ENV || '66690c20b8bf3f13bb21f8706e3a75d5'
const RESEND_KEY       = Deno.env.get('RESEND_API_KEY') ?? ''
const SUPABASE_URL     = Deno.env.get('SUPABASE_URL') ?? ''
const SUPABASE_SRK     = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

// Bounding box do Acre: W,S,E,N
const ACRE_BBOX = '-73.8,-11.14,-66.6,-7.12'

const db = createClient(SUPABASE_URL, SUPABASE_SRK)

// ── Helpers ─────────────────────────────────────────────────

function severidadeFRRP(frp: number): string {
  if (frp >= 100) return 'critica'
  if (frp >= 50)  return 'alta'
  if (frp >= 10)  return 'media'
  return 'baixa'
}

function severidadeAreaHa(ha: number): string {
  if (ha >= 2500) return 'critica'
  if (ha >= 1000) return 'alta'
  if (ha >= 100)  return 'media'
  return 'baixa'
}

function hoje(): string {
  return new Date().toISOString().slice(0, 10)
}

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

// BDQueimadas (INPE): CSV diário de focos do Brasil (estado=ACRE).
// A API JSON antiga foi descontinuada (404).
const BDQ_BASE = 'https://dataserver-coids.inpe.br/queimadas/queimadas/focos/csv/diario/Brasil'

async function bdqFocosAcre(): Promise<any[]> {
  const out: any[] = []
  for (const off of [0, 1]) {
    const d = new Date(); d.setUTCDate(d.getUTCDate() - off)
    const ymd = d.toISOString().slice(0, 10).replace(/-/g, '')
    try {
      const r = await fetch(`${BDQ_BASE}/focos_diario_br_${ymd}.csv`, { signal: AbortSignal.timeout(30000) })
      if (!r.ok) continue
      for (const o of csvParaObjetos(await r.text())) {
        if ((o.estado ?? '').toUpperCase() === 'ACRE') out.push(o)
      }
    } catch { /* best-effort */ }
  }
  return out
}

// ── Busca FIRMS (focos de calor) ────────────────────────────

async function buscarFIRMS(): Promise<any[]> {
  const url = `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${FIRMS_KEY}/VIIRS_SNPP_NRT/${ACRE_BBOX}/1`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`FIRMS HTTP ${res.status}`)
  const csv = await res.text()
  const lines = csv.trim().split('\n')
  if (lines.length < 2) return []
  const headers = lines[0].split(',')
  return lines.slice(1).map(line => {
    const vals = line.split(',')
    const obj: Record<string, string> = {}
    headers.forEach((h, i) => { obj[h.trim()] = (vals[i] ?? '').trim() })
    return obj
  })
}

// ── Busca DETER (desmatamento recente) ──────────────────────

async function buscarDETER(): Promise<any[]> {
  const url = `https://terrabrasilis.dpi.inpe.br/geoserver/deter-amz/ows?` +
    `service=WFS&version=1.0.0&request=GetFeature` +
    `&typeName=deter-amz:deter_amz&outputFormat=application/json` +
    `&BBOX=${ACRE_BBOX},EPSG:4326&maxFeatures=200`
  const res = await fetch(url, { signal: AbortSignal.timeout(20000) })
  if (!res.ok) return []
  const json = await res.json()
  return json.features ?? []
}

// ── Busca BDQueimadas (focos INPE) ──────────────────────────

async function buscarBDQueimadas(): Promise<any[]> {
  return await bdqFocosAcre()
}

// ── Diagnóstico das fontes (dry-run: testa sem inserir) ─────

async function checarFIRMS() {
  const url = `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${FIRMS_KEY}/VIIRS_SNPP_NRT/${ACRE_BBOX}/1`
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) })
    const txt = await res.text()
    if (!res.ok) return { fonte: 'FIRMS', ok: false, http_status: res.status, registros: 0, erro: txt.slice(0, 200) }
    const linhas = txt.trim().split('\n').filter(Boolean)
    const n = Math.max(0, linhas.length - 1)
    // FIRMS responde 200 mesmo com erro de chave (texto "Invalid MAP_KEY")
    const suspeito = n === 0 && /invalid|error|key|exceed/i.test(linhas[0] ?? '')
    return { fonte: 'FIRMS', ok: !suspeito, http_status: res.status, registros: n, erro: suspeito ? linhas[0] : null }
  } catch (e) {
    return { fonte: 'FIRMS', ok: false, http_status: 0, registros: 0, erro: String((e as Error).message ?? e) }
  }
}

async function checarDETER() {
  const url = `https://terrabrasilis.dpi.inpe.br/geoserver/deter-amz/ows?` +
    `service=WFS&version=1.0.0&request=GetFeature` +
    `&typeName=deter-amz:deter_amz&outputFormat=application/json` +
    `&BBOX=${ACRE_BBOX},EPSG:4326&maxFeatures=200`
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(20000) })
    if (!res.ok) return { fonte: 'DETER', ok: false, http_status: res.status, registros: 0, erro: `HTTP ${res.status}` }
    const json = await res.json()
    return { fonte: 'DETER', ok: true, http_status: res.status, registros: json.features?.length ?? 0, erro: null }
  } catch (e) {
    return { fonte: 'DETER', ok: false, http_status: 0, registros: 0, erro: String((e as Error).message ?? e) }
  }
}

async function checarBDQueimadas() {
  // Testa o CSV diário mais recente (hoje, com fallback p/ ontem)
  for (const off of [0, 1]) {
    const d = new Date(); d.setUTCDate(d.getUTCDate() - off)
    const ymd = d.toISOString().slice(0, 10).replace(/-/g, '')
    const url = `${BDQ_BASE}/focos_diario_br_${ymd}.csv`
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(30000) })
      if (!res.ok) { if (off === 1) return { fonte: 'BDQUEIMADAS', ok: false, http_status: res.status, registros: 0, erro: `HTTP ${res.status} (${ymd})` }; continue }
      const objs = csvParaObjetos(await res.text())
      const acre = objs.filter(o => (o.estado ?? '').toUpperCase() === 'ACRE').length
      return { fonte: 'BDQUEIMADAS', ok: true, http_status: res.status, registros: acre, erro: null }
    } catch (e) {
      if (off === 1) return { fonte: 'BDQUEIMADAS', ok: false, http_status: 0, registros: 0, erro: String((e as Error).message ?? e) }
    }
  }
  return { fonte: 'BDQUEIMADAS', ok: false, http_status: 0, registros: 0, erro: 'CSV diário indisponível' }
}

// ── Cruzar ponto com UCs via PostGIS ────────────────────────

async function ucParaPonto(lat: number, lng: number): Promise<{ id: string; nome: string } | null> {
  const { data } = await db.rpc('encontrar_uc_por_ponto', { p_lat: lat, p_lng: lng })
  if (!data || !data.length) return null
  return { id: data[0].id, nome: data[0].nome }
}

// ── Processar FIRMS ─────────────────────────────────────────

async function processarFIRMS(novos: number, erros: string[]): Promise<number> {
  const focos = await buscarFIRMS()
  for (const f of focos) {
    const lat = parseFloat(f.latitude)
    const lng = parseFloat(f.longitude)
    const frp = parseFloat(f.frp ?? '0')
    const fonteId = `FIRMS_${f.acq_date}_${f.acq_time}_${f.latitude}_${f.longitude}`

    // Evitar duplicatas
    const { count } = await db.from('alertas_ambientais')
      .select('id', { count: 'exact', head: true })
      .eq('fonte_id', fonteId)
    if ((count ?? 0) > 0) continue

    const uc = await ucParaPonto(lat, lng)
    const { error } = await db.from('alertas_ambientais').insert({
      fonte: 'FIRMS',
      tipo: 'queimada',
      severidade: severidadeFRRP(frp),
      uc_id: uc?.id ?? null,
      uc_nome: uc?.nome ?? null,
      geom: `POINT(${lng} ${lat})`,
      fonte_id: fonteId,
      data_referencia: f.acq_date,
      raw_data: f,
    })
    if (error) erros.push(`FIRMS: ${error.message}`)
    else novos++
  }
  return novos
}

// ── Processar DETER ─────────────────────────────────────────

async function processarDETER(novos: number, erros: string[]): Promise<number> {
  const feats = await buscarDETER()
  for (const f of feats) {
    const props = f.properties ?? {}
    const fonteId = `DETER_${props.gid ?? props.fid ?? JSON.stringify(props).slice(0, 40)}`

    const { count } = await db.from('alertas_ambientais')
      .select('id', { count: 'exact', head: true })
      .eq('fonte_id', fonteId)
    if ((count ?? 0) > 0) continue

    const areaKm2 = parseFloat(props.area_km ?? props.areakm2 ?? '0')
    const areaHa  = areaKm2 * 100

    // Centroide aproximado do bbox
    const coords = f.geometry?.coordinates
    let lat = -9.5, lng = -70.0
    if (coords) {
      // flatten coords para extrair primeiro ponto
      const flat = coords.flat(5)
      lng = parseFloat(flat[0]) ?? lng
      lat = parseFloat(flat[1]) ?? lat
    }

    const uc = await ucParaPonto(lat, lng)
    const { error } = await db.from('alertas_ambientais').insert({
      fonte: 'DETER',
      tipo: 'desmatamento',
      severidade: severidadeAreaHa(areaHa),
      uc_id: uc?.id ?? null,
      uc_nome: uc?.nome ?? null,
      area_ha: areaHa > 0 ? areaHa : null,
      geom: `POINT(${lng} ${lat})`,
      fonte_id: fonteId,
      data_referencia: props.data_imagem?.slice(0, 10) ?? hoje(),
      raw_data: props,
    })
    if (error) erros.push(`DETER: ${error.message}`)
    else novos++
  }
  return novos
}

// ── Processar BDQueimadas ───────────────────────────────────

async function processarBDQueimadas(novos: number, erros: string[]): Promise<number> {
  const focos = await buscarBDQueimadas()
  for (const f of focos) {
    const lat = parseFloat(f.lat ?? f.latitude ?? '0')
    const lng = parseFloat(f.lon ?? f.longitude ?? '0')
    if (!lat || !lng) continue

    const fonteId = `BDQ_${f.id ?? f.data_hora_gmt ?? ''}_${lat}_${lng}`
    const { count } = await db.from('alertas_ambientais')
      .select('id', { count: 'exact', head: true })
      .eq('fonte_id', fonteId)
    if ((count ?? 0) > 0) continue

    const uc = await ucParaPonto(lat, lng)
    const { error } = await db.from('alertas_ambientais').insert({
      fonte: 'BDQUEIMADAS',
      tipo: 'queimada',
      severidade: 'media',
      uc_id: uc?.id ?? null,
      uc_nome: uc?.nome ?? null,
      geom: `POINT(${lng} ${lat})`,
      fonte_id: fonteId,
      data_referencia: (f.data_hora_gmt ?? hoje()).slice(0, 10),
      raw_data: f,
    })
    if (error) erros.push(`BDQ: ${error.message}`)
    else novos++
  }
  return novos
}

// ── Enviar e-mails via Resend ────────────────────────────────

async function enviarNotificacoes() {
  // Alertas novos (críticos/altos) ainda não notificados
  const { data: alertas } = await db.from('alertas_ambientais')
    .select('*, unidades_conservacao(nome, gestor_id, email_contato)')
    .is('notificado_em', null)
    .in('severidade', ['critica', 'alta'])
    .not('uc_id', 'is', null)
    .limit(50)

  if (!alertas?.length) return

  // Buscar responsáveis: Chefe DEUC e Diretor DIMA (sempre notificados)
  const { data: chefias } = await db.from('cargos_atuais')
    .select('responsavel_atual_id, usuarios!inner(email, nome_completo)')
    .in('unidade_sigla', ['DEUC', 'DIMA'])

  const emailsBase: string[] = (chefias ?? [])
    .map((c: any) => c.usuarios?.email)
    .filter(Boolean)

  for (const alerta of alertas) {
    const emails = [...emailsBase]

    // Gestor da UC afetada
    if (alerta.unidades_conservacao?.email_contato)
      emails.push(alerta.unidades_conservacao.email_contato)

    if (!emails.length) continue

    const corSev: Record<string, string> = {
      critica: '#DC2626', alta: '#F97316', media: '#F59E0B', baixa: '#059669'
    }
    const cor = corSev[alerta.severidade] ?? '#374151'
    const tipoLabel = alerta.tipo === 'queimada' ? '🔥 Foco de Calor' : '🌳 Desmatamento'

    const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Alerta Ambiental — SIGUC-AC</title></head>
<body style="margin:0;padding:0;background:#f4efe6;font-family:'Segoe UI',Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4efe6;padding:32px 0">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.1)">
  <!-- Header -->
  <tr><td style="background:linear-gradient(135deg,#0A1A0F,#1F4E2C);padding:28px 32px">
    <div style="display:flex;align-items:center;gap:12px">
      <div style="color:#C9A84C;font-size:24px;font-weight:900;letter-spacing:-1px">SIGUC</div>
      <div style="color:rgba(255,255,255,.4);font-size:18px">|</div>
      <div style="color:rgba(255,255,255,.8);font-size:13px;font-weight:500">Sistema de Gestão de UCs — Acre</div>
    </div>
    <div style="margin-top:16px;padding:10px 14px;background:${cor};border-radius:8px;display:inline-block">
      <span style="color:#fff;font-size:15px;font-weight:700">${tipoLabel} — Severidade ${alerta.severidade.toUpperCase()}</span>
    </div>
  </td></tr>
  <!-- Corpo -->
  <tr><td style="padding:28px 32px">
    <p style="margin:0 0 8px;font-size:13px;color:#6B7280">Alerta detectado em <strong>${new Date(alerta.data_deteccao).toLocaleString('pt-BR', { timeZone: 'America/Rio_Branco' })}</strong> (horário de Brasília)</p>
    <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #E5E7EB;border-radius:8px;overflow:hidden;margin-top:16px">
      <tr style="background:#F9FAFB"><td style="padding:10px 16px;font-size:11px;font-weight:700;color:#9CA3AF;text-transform:uppercase;letter-spacing:.06em;width:140px">UC Afetada</td><td style="padding:10px 16px;font-size:13px;font-weight:600;color:#111827">${alerta.uc_nome ?? '—'}</td></tr>
      <tr style="border-top:1px solid #E5E7EB"><td style="padding:10px 16px;font-size:11px;font-weight:700;color:#9CA3AF;text-transform:uppercase;letter-spacing:.06em">Fonte</td><td style="padding:10px 16px;font-size:13px;color:#374151">${alerta.fonte}</td></tr>
      <tr style="border-top:1px solid #E5E7EB;background:#F9FAFB"><td style="padding:10px 16px;font-size:11px;font-weight:700;color:#9CA3AF;text-transform:uppercase;letter-spacing:.06em">Tipo</td><td style="padding:10px 16px;font-size:13px;color:#374151">${alerta.tipo}</td></tr>
      <tr style="border-top:1px solid #E5E7EB"><td style="padding:10px 16px;font-size:11px;font-weight:700;color:#9CA3AF;text-transform:uppercase;letter-spacing:.06em">Data Referência</td><td style="padding:10px 16px;font-size:13px;color:#374151">${alerta.data_referencia}</td></tr>
      ${alerta.area_ha ? `<tr style="border-top:1px solid #E5E7EB;background:#F9FAFB"><td style="padding:10px 16px;font-size:11px;font-weight:700;color:#9CA3AF;text-transform:uppercase;letter-spacing:.06em">Área</td><td style="padding:10px 16px;font-size:13px;color:#374151">${Number(alerta.area_ha).toLocaleString('pt-BR')} ha</td></tr>` : ''}
    </table>
    <div style="margin-top:24px;padding:16px;background:#FEF3C7;border-radius:8px;border-left:4px solid #C9A84C">
      <p style="margin:0;font-size:12px;color:#92400E">⚠ Este é um alerta automático gerado pelo SIGUC-AC. Acesse o sistema para verificar e registrar as ações tomadas.</p>
    </div>
  </td></tr>
  <!-- Footer -->
  <tr><td style="background:#F9FAFB;padding:16px 32px;border-top:1px solid #E5E7EB">
    <p style="margin:0;font-size:11px;color:#9CA3AF;text-align:center">SEMA-AC · DIMA · Secretaria de Estado do Meio Ambiente do Acre<br>Sistema de Gestão de Unidades de Conservação — SIGUC-AC</p>
  </td></tr>
</table>
</td></tr>
</table>
</body></html>`

    // Enviar via Resend
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'SIGUC-AC Alertas <alertas@siguc.sema.ac.gov.br>',
        to: [...new Set(emails)],
        subject: `🚨 [SIGUC-AC] ${tipoLabel} — ${alerta.uc_nome ?? 'UC do Acre'} — ${alerta.severidade.toUpperCase()}`,
        html,
      }),
    })

    // Marcar como notificado
    await db.from('alertas_ambientais')
      .update({ notificado_em: new Date().toISOString(), emails_enviados: emails })
      .eq('id', alerta.id)
  }
}

// ── Função RPC: encontrar UC por ponto ──────────────────────
// (deve existir no banco — criada abaixo via migration)

// ── Handler principal ────────────────────────────────────────

Deno.serve(async (req) => {
  // CORS para disparo manual pelo frontend
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      }
    })
  }

  // ── Modo diagnóstico (dry-run): testa as fontes SEM inserir nem enviar e-mail ──
  let body: any = {}
  try { body = await req.json() } catch { /* corpo vazio */ }
  if (body?.check) {
    const [firms, deter, bdqueimadas] = await Promise.all([
      checarFIRMS(), checarDETER(), checarBDQueimadas(),
    ])
    return new Response(JSON.stringify({
      ok: true,
      modo: 'check',
      firms_key_configurada: FIRMS_KEY_ENV !== '',
      fontes: { firms, deter, bdqueimadas },
      timestamp: new Date().toISOString(),
    }), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    })
  }

  const inicio = Date.now()
  const erros: string[] = []
  let novos = 0

  try {
    console.log('[monitorar-alertas] Iniciando monitoramento...')

    // Processar fontes em paralelo (FIRMS + BDQueimadas)
    // DETER separado pois é mais pesado
    const [n1, n2] = await Promise.all([
      processarFIRMS(0, erros),
      processarBDQueimadas(0, erros),
    ])
    novos = n1 + n2

    // DETER (com timeout maior)
    try {
      novos += await processarDETER(0, erros)
    } catch (e) {
      erros.push(`DETER timeout: ${e.message}`)
    }

    // Enviar notificações para alertas críticos/altos não notificados
    if (RESEND_KEY) await enviarNotificacoes()

    const duracao = Date.now() - inicio
    console.log(`[monitorar-alertas] Concluído: ${novos} novos alertas em ${duracao}ms`)

    return new Response(JSON.stringify({
      ok: true,
      novos_alertas: novos,
      firms_key_configurada: FIRMS_KEY_ENV !== '',
      erros,
      duracao_ms: duracao,
      timestamp: new Date().toISOString(),
    }), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      }
    })
  } catch (e) {
    console.error('[monitorar-alertas] Erro:', e)
    return new Response(JSON.stringify({ ok: false, erro: e.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    })
  }
})
