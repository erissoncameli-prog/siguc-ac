// ═══════════════════════════════════════════════════════════
// SIGUC-AC · Edge Function — Monitorar Alertas Ambientais
// Cron: 06h BRT (09h UTC) + disparo manual via POST
// ═══════════════════════════════════════════════════════════

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { carregarLimiteAcre, noAcre } from '../_shared/acre.ts'

const FIRMS_KEY_ENV    = Deno.env.get('FIRMS_MAP_KEY') ?? ''
// Mesma chave (já pública) usada em ingest-focos e /api/focos-proxy.js.
// Fallback garante que FIRMS funcione mesmo sem o secret configurado.
const FIRMS_KEY        = FIRMS_KEY_ENV || '66690c20b8bf3f13bb21f8706e3a75d5'
const RESEND_KEY       = Deno.env.get('RESEND_API_KEY') ?? ''
const SUPABASE_URL     = Deno.env.get('SUPABASE_URL') ?? ''
const SUPABASE_SRK     = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

// Bounding box do Acre: W,S,E,N — usado só por FIRMS (a API não aceita
// filtro por UF/polígono, só bbox). O DETER, desde a Entrega 2, filtra
// por `uf='AC'` direto na fonte (ver processarDETER) — bbox nunca foi
// preciso (engloba AM, RO, Peru e Bolívia).
// ⚠ Quem define o que é do Acre, de fato, é o recorte pelo polígono
// (../_shared/acre.ts) e, como garantia dura, as triggers do banco
// (migrations 239/294).
const ACRE_BBOX = '-73.8,-11.14,-66.6,-7.12'

const db = createClient(SUPABASE_URL, SUPABASE_SRK)

// ── Helpers ─────────────────────────────────────────────────

function severidadeFRRP(frp: number): string {
  if (frp >= 100) return 'critica'
  if (frp >= 50)  return 'alta'
  if (frp >= 10)  return 'media'
  return 'baixa'
}

// Severidade por área (DETER) NÃO vive mais aqui — a área só existe
// depois que o polígono chega ao banco (ver migration 291) e a
// severidade é calculada no MESMO lugar (migration 295,
// alertas_resolver_campos): "cálculo em um lugar só", mesma regra do
// projeto para IQA e consumo de combustível. Duplicar os limiares
// aqui seria a mesma dívida que causou a área sempre nula antes.

function hoje(): string {
  return new Date().toISOString().slice(0, 10)
}

function diasAtras(n: number): string {
  const d = new Date(); d.setUTCDate(d.getUTCDate() - n)
  return d.toISOString().slice(0, 10)
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

// ── Busca DETER (desmatamento/degradação/queimada — deter-amz) ──
//
// Contrato real do WFS (confirmado contra produção na Entrega 2 —
// a documentação pública não estava acessível da sessão de dev):
//   • `uf` é a SIGLA de 2 letras ('AC'), NÃO o nome extenso —
//     `uf='ACRE'` devolve 0 resultados, sempre. Bug silencioso: o
//     código antigo nem tentava filtrar por uf, só por BBOX.
//   • Não existe atributo de área total no WFS. `areauckm`/
//     `areamunkm` são a área SÓ dentro de UC / SÓ dentro de
//     município — não a área do polígono. `area_km`/`areakm2`
//     (o que o código antigo tentava ler) não existem em NENHUMA
//     feição — por isso area_ha sempre saía nula.
//   • `classname` tem pelo menos 6 valores distintos observados
//     para o Acre (DESMATAMENTO_CR, DESMATAMENTO_VEG, CS_DESORDENADO,
//     CS_GEOMETRICO, DEGRADACAO, CICATRIZ_DE_QUEIMADA) — o código
//     antigo gravava TUDO como tipo='desmatamento'. O enum de
//     alertas_ambientais.tipo já previa 'degradacao' desde o início;
//     nunca tinha sido usado.
//   • `municipality` traz o nome do município já resolvido pelo
//     INPE — usado para preencher `municipio` sem precisar de
//     point-in-polygon próprio.
//   • Paginação real via `startIndex` + `sortBy=gid` (GeoServer
//     aceita como extensão do WFS 1.0.0) — testado e estável.
//   • Total para uf='AC', toda a série (desde 2016-08-04 até hoje):
//     30.903 feições — volume pequeno, cabe um backfill completo.

const DETER_WFS = 'https://terrabrasilis.dpi.inpe.br/geoserver/deter-amz/ows'

// Mapeamento classname → tipo do alerta. Escolha de engenharia desta
// entrega (documentação oficial do INPE não estava acessível para
// confirmar a taxonomia palavra por palavra): corte raso e remoção de
// vegetação são desmatamento pleno; cicatriz de queimada é o sinal de
// fogo que o próprio DETER detecta (mesmo bucket que BDQUEIMADAS/FIRMS
// para o enum 'queimada'); corte seletivo (ordenado ou não) e
// degradação genérica caem em 'degradacao' — nunca fizeram parte de
// 'desmatamento' aqui, e o enum já tinha esse terceiro valor pronto.
function classnameParaTipo(classname: string | null | undefined): 'desmatamento' | 'queimada' | 'degradacao' {
  const c = (classname ?? '').toUpperCase()
  if (c === 'DESMATAMENTO_CR' || c === 'DESMATAMENTO_VEG') return 'desmatamento'
  if (c === 'CICATRIZ_DE_QUEIMADA') return 'queimada'
  return 'degradacao' // CS_DESORDENADO, CS_GEOMETRICO, DEGRADACAO, MINERACAO e qualquer classe nova
}

// Converte geometry (Polygon ou MultiPolygon) do GeoJSON do WFS em WKT
// MULTIPOLYGON — a coluna `poligono` é sempre MultiPolygon (migration
// 291), então um Polygon single vira multipolígono de 1 elemento.
function geoJsonParaMultiPolygonWKT(geometry: any): string | null {
  if (!geometry?.type || !geometry?.coordinates) return null
  const anelParaWkt = (anel: number[][]) =>
    '(' + anel.map(([x, y]: number[]) => `${x} ${y}`).join(',') + ')'
  const polyParaWkt = (rings: number[][][]) => '(' + rings.map(anelParaWkt).join(',') + ')'

  if (geometry.type === 'Polygon') {
    return `MULTIPOLYGON(${polyParaWkt(geometry.coordinates)})`
  }
  if (geometry.type === 'MultiPolygon') {
    return `MULTIPOLYGON(${geometry.coordinates.map(polyParaWkt).join(',')})`
  }
  return null
}

interface PaginaDETER {
  features: any[]
  total: number
}

async function buscarPaginaDETER(opts: {
  desde?: string          // view_date >= desde (YYYY-MM-DD)
  ate?: string            // view_date <= ate (YYYY-MM-DD)
  startIndex: number
  maxFeatures: number
}): Promise<PaginaDETER> {
  const filtros = [`uf='AC'`]
  if (opts.desde) filtros.push(`view_date>='${opts.desde}'`)
  if (opts.ate)   filtros.push(`view_date<='${opts.ate}'`)

  const params = new URLSearchParams({
    service: 'WFS', version: '1.0.0', request: 'GetFeature',
    typeName: 'deter-amz:deter_amz', outputFormat: 'application/json',
    CQL_FILTER: filtros.join(' AND '),
    sortBy: 'gid',
    startIndex: String(opts.startIndex),
    maxFeatures: String(opts.maxFeatures),
  })
  const res = await fetch(`${DETER_WFS}?${params}`, { signal: AbortSignal.timeout(30000) })
  if (!res.ok) throw new Error(`DETER HTTP ${res.status}`)
  const json = await res.json()
  return { features: json.features ?? [], total: json.totalFeatures ?? 0 }
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
  try {
    const { features, total } = await buscarPaginaDETER({
      desde: diasAtras(15), ate: hoje(), startIndex: 0, maxFeatures: 5,
    })
    return { fonte: 'DETER', ok: true, http_status: 200, registros: features.length, total_uf_ac: total, erro: null }
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
    if (!noAcre(lat, lng)) continue  // bbox do FIRMS invade AM/RO/Peru/Bolívia
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

// ── Processar DETER ──────────────────────────────────────────
//
// Duas chamadas possíveis:
//   • Cron/diário: janela móvel de `diasJanela` dias (padrão 15 —
//     o DETER republica/revisa feições enquanto a nuvem não limpa a
//     cena, então reprocessar um pouco do passado é intencional).
//   • Backfill: `desde`/`ate` cobrindo o intervalo pedido (a rota
//     HTTP abaixo cobre 2016-08-04 → hoje, em chamadas paginadas).
//
// UPSERT por fonte_id (migration 293, índice único): quando o INPE
// revisa a geometria de uma feição já gravada (mesmo gid), o registro
// se autocorrige na próxima passada — nunca duplica.
async function processarDETER(opts: {
  desde?: string
  ate?: string
  startIndex: number
  maxPaginas: number
  tamanhoPagina: number
}, erros: string[]): Promise<{ processados: number; proximoStartIndex: number; concluido: boolean; totalFonte: number }> {
  let startIndex = opts.startIndex
  let processados = 0
  let totalFonte = 0

  for (let pagina = 0; pagina < opts.maxPaginas; pagina++) {
    const { features, total } = await buscarPaginaDETER({
      desde: opts.desde, ate: opts.ate, startIndex, maxFeatures: opts.tamanhoPagina,
    })
    totalFonte = total
    if (!features.length) return { processados, proximoStartIndex: startIndex, concluido: true, totalFonte }

    const linhas = features.map((f: any) => {
      const props = f.properties ?? {}
      const wkt = geoJsonParaMultiPolygonWKT(f.geometry)
      if (!wkt || !props.gid) return null
      return {
        fonte: 'DETER',
        tipo: classnameParaTipo(props.classname),
        severidade: 'baixa', // placeholder — recalculada no banco a partir da área real (migration 295)
        poligono: wkt,
        municipio: props.municipality ?? null,
        fonte_id: `DETER_${props.gid}`,
        data_referencia: props.view_date ?? opts.ate ?? hoje(),
        raw_data: props,
      }
    }).filter(Boolean)

    if (linhas.length) {
      const { error, count } = await db.from('alertas_ambientais')
        .upsert(linhas, { onConflict: 'fonte_id', ignoreDuplicates: false, count: 'exact' })
      if (error) erros.push(`DETER (página startIndex=${startIndex}): ${error.message}`)
      else processados += count ?? linhas.length
    }

    startIndex += features.length
    if (features.length < opts.tamanhoPagina) return { processados, proximoStartIndex: startIndex, concluido: true, totalFonte }
  }

  return { processados, proximoStartIndex: startIndex, concluido: false, totalFonte }
}

// ── Processar BDQueimadas ───────────────────────────────────

async function processarBDQueimadas(novos: number, erros: string[]): Promise<number> {
  const focos = await buscarBDQueimadas()
  for (const f of focos) {
    const lat = parseFloat(f.lat ?? f.latitude ?? '0')
    const lng = parseFloat(f.lon ?? f.longitude ?? '0')
    if (!lat || !lng) continue
    if (!noAcre(lat, lng)) continue

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
    const tipoLabel = alerta.tipo === 'queimada' ? '🔥 Foco de Calor' : alerta.tipo === 'degradacao' ? '🪓 Degradação Florestal' : '🌳 Desmatamento'

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

  let body: any = {}
  try { body = await req.json() } catch { /* corpo vazio */ }

  // ── Modo diagnóstico (dry-run): testa as fontes SEM inserir nem enviar e-mail ──
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

  // ── Modo backfill DETER: carga retroativa em páginas (chamar repetido) ──
  // Corpo: { backfill_deter: true, start_index?: number, max_paginas?: number,
  //          tamanho_pagina?: number, desde?: string, ate?: string }
  // Devolve proximo_start_index/concluido — quem chama repete até concluido=true.
  if (body?.backfill_deter) {
    const erros: string[] = []
    try {
      const r = await processarDETER({
        desde: body.desde,
        ate: body.ate,
        startIndex: Number(body.start_index ?? 0),
        maxPaginas: Number(body.max_paginas ?? 8),
        tamanhoPagina: Number(body.tamanho_pagina ?? 400),
      }, erros)
      return new Response(JSON.stringify({
        ok: true, modo: 'backfill_deter', ...r, erros,
        timestamp: new Date().toISOString(),
      }), { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } })
    } catch (e) {
      return new Response(JSON.stringify({ ok: false, erro: e.message }), {
        status: 500, headers: { 'Content-Type': 'application/json' },
      })
    }
  }

  const inicio = Date.now()
  const erros: string[] = []
  let novos = 0

  try {
    console.log('[monitorar-alertas] Iniciando monitoramento...')

    // Polígono do Acre antes de processar qualquer fonte. Fail-open:
    // se não carregar, nada é filtrado aqui e a trigger do banco assume.
    const comLimite = await carregarLimiteAcre()
    if (!comLimite) erros.push('limite do Acre indisponível — recorte delegado ao banco')

    // Processar fontes em paralelo (FIRMS + BDQueimadas)
    // DETER separado pois é mais pesado
    const [n1, n2] = await Promise.all([
      processarFIRMS(0, erros),
      processarBDQueimadas(0, erros),
    ])
    novos = n1 + n2

    // DETER: janela móvel de 15 dias (a fonte revisa/republica feições
    // enquanto a cena tem nuvem — reprocessar um pouco do passado é
    // intencional; upsert por fonte_id nunca duplica).
    try {
      const rDeter = await processarDETER({
        desde: diasAtras(15), ate: hoje(), startIndex: 0, maxPaginas: 10, tamanhoPagina: 400,
      }, erros)
      novos += rDeter.processados
      if (!rDeter.concluido) erros.push('DETER: janela de 15 dias não coube em 10 páginas — verificar volume incomum')
    } catch (e) {
      erros.push(`DETER: ${e.message}`)
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
