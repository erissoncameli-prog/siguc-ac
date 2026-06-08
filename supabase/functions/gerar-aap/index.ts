import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { PDFDocument, rgb, StandardFonts } from "https://esm.sh/pdf-lib@1.17.1"
// @ts-ignore — pure-JS QR code generator (sem dependências nativas)
import qrcode from "https://esm.sh/qrcode-generator@1.4.4"

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

// ── Paleta SIGUC ──────────────────────────────────────────────────────────────
const C_VERDE  = rgb(0.039, 0.102, 0.059)   // #0A1A0F  floresta
const C_OURO   = rgb(0.788, 0.659, 0.298)   // #C9A84C
const C_OURO_C = rgb(0.941, 0.796, 0.416)   // #F0CB6A
const C_CINZA  = rgb(0.420, 0.447, 0.471)   // #6B7280
const C_CINZA2 = rgb(0.647, 0.675, 0.706)   // #9CA3AF
const C_PRETO  = rgb(0.067, 0.067, 0.094)   // #111827
const C_BRANCO = rgb(1, 1, 1)
const C_BORDA  = rgb(0.898, 0.906, 0.922)   // #E5E7EB
const C_BG     = rgb(0.976, 0.984, 0.976)   // #F9FAFB
const C_VERDE2 = rgb(0.082, 0.306, 0.173)   // #153C2C (fundo bloco assinatura secretário)

// ── Layout ────────────────────────────────────────────────────────────────────
const ML = 46
const MR = 46
const PG_W = 595.28
const PG_H = 841.89
const BODY_W = PG_W - ML - MR

// ── Utilitários ───────────────────────────────────────────────────────────────

function fmtDate(dt: string | null | undefined): string {
  if (!dt) return "—"
  const s = String(dt).substring(0, 10)
  if (s.length < 10) return String(dt)
  const [y, m, d] = s.split("-")
  return `${d}/${m}/${y}`
}

function tipoLabel(tipo: string): string {
  const map: Record<string, string> = {
    fauna: "Fauna", flora: "Flora", genetica: "Genética",
    ecossistema: "Ecossistema", socioambiental: "Socioambiental", outro: "Outro",
  }
  return map[tipo] ?? tipo
}

function funcaoLabel(funcao: string): string {
  const map: Record<string, string> = {
    co_orientador: "Co-orientador(a)", pesquisador_colaborador: "Pesquisador(a) colaborador(a)",
    mestrando: "Mestrando(a)", doutorando: "Doutorando(a)", bolsista: "Bolsista",
    tecnico_campo: "Técnico(a) de campo", estagiario: "Estagiário(a)", auxiliar: "Auxiliar",
  }
  return map[funcao] ?? funcao
}

function wrapText(text: string, maxW: number, font: any, size: number): string[] {
  const words = (text ?? "").split(" ")
  const lines: string[] = []
  let cur = ""
  for (const w of words) {
    const t = cur ? cur + " " + w : w
    if (font.widthOfTextAtSize(t, size) > maxW) { if (cur) lines.push(cur); cur = w }
    else cur = t
  }
  if (cur) lines.push(cur)
  return lines.length ? lines : [""]
}

function trunc(text: string | null | undefined, maxC = 70): string {
  if (!text) return "—"
  return text.length > maxC ? text.substring(0, maxC - 1) + "…" : text
}

// ── Logos institucionais ──────────────────────────────────────────────────────

function drawLogo(
  page: any, x: number, y: number, w: number, h: number,
  sigla: string, sub: string, fontB: any, fontR: any,
  tipo: "escudo" | "folha" = "escudo",
) {
  page.drawRectangle({ x, y, width: w, height: h, color: C_VERDE, borderColor: C_OURO, borderWidth: 0.8 })
  if (tipo === "escudo") {
    page.drawLine({ start: { x: x + 4, y: y + h - 4 }, end: { x: x + 12, y: y + h - 12 }, thickness: 0.7, color: C_OURO_C })
    page.drawLine({ start: { x: x + w - 4, y: y + h - 4 }, end: { x: x + w - 12, y: y + h - 12 }, thickness: 0.7, color: C_OURO_C })
    page.drawRectangle({ x, y: y + h - 5, width: w, height: 5, color: C_OURO })
  } else {
    const cx = x + w / 2, cy = y + h * 0.62; const r = 4
    page.drawLine({ start: { x: cx, y: cy + r }, end: { x: cx + r, y: cy }, thickness: 0.7, color: C_OURO_C })
    page.drawLine({ start: { x: cx + r, y: cy }, end: { x: cx, y: cy - r }, thickness: 0.7, color: C_OURO_C })
    page.drawLine({ start: { x: cx, y: cy - r }, end: { x: cx - r, y: cy }, thickness: 0.7, color: C_OURO_C })
    page.drawLine({ start: { x: cx - r, y: cy }, end: { x: cx, y: cy + r }, thickness: 0.7, color: C_OURO_C })
    page.drawLine({ start: { x: cx, y: cy + r - 1 }, end: { x: cx, y: y + 2 }, thickness: 0.5, color: rgb(0.7, 0.9, 0.75) })
  }
  const sw = fontB.widthOfTextAtSize(sigla, 10)
  page.drawText(sigla, { x: x + (w - sw) / 2, y: y + 12, size: 10, font: fontB, color: C_BRANCO })
  const subW = fontR.widthOfTextAtSize(sub, 5.5)
  page.drawText(sub, { x: x + (w - subW) / 2, y: y + 6, size: 5.5, font: fontR, color: C_OURO_C })
}

// ── QR Code: renderiza como matriz de retângulos no PDF ───────────────────────

function drawQR(page: any, url: string, x: number, y: number, size: number) {
  try {
    const qr = qrcode(0, "M")
    qr.addData(url)
    qr.make()
    const mc   = qr.getModuleCount()
    const cell = size / mc
    // Fundo branco com borda discreta
    page.drawRectangle({ x: x - 3, y: y - 3, width: size + 6, height: size + 6, color: C_BRANCO, borderColor: C_BORDA, borderWidth: 0.5 })
    for (let row = 0; row < mc; row++) {
      for (let col = 0; col < mc; col++) {
        if (qr.isDark(row, col)) {
          page.drawRectangle({
            x: x + col * cell,
            y: y + (mc - 1 - row) * cell,
            width: cell,
            height: cell,
            color: C_PRETO,
          })
        }
      }
    }
  } catch (_) {
    // Falha silenciosa — não impede a geração do restante do PDF
  }
}

// ── Handler principal ─────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS })

  const authHeader = req.headers.get("Authorization")
  if (!authHeader) {
    return new Response(JSON.stringify({ error: "Nao autorizado" }), { status: 401, headers: CORS })
  }

  const userSupa = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  )
  const { data: { user }, error: authErr } = await userSupa.auth.getUser()
  if (authErr || !user) {
    return new Response(JSON.stringify({ error: "Nao autorizado" }), { status: 401, headers: CORS })
  }

  const svc = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!)

  let body: { pesquisa_id?: string }
  try { body = await req.json() } catch {
    return new Response(JSON.stringify({ error: "Body invalido" }), { status: 400, headers: CORS })
  }
  const { pesquisa_id } = body
  if (!pesquisa_id) {
    return new Response(JSON.stringify({ error: "pesquisa_id obrigatorio" }), { status: 400, headers: CORS })
  }

  const [pesqRes, cargosRes, equipeRes] = await Promise.all([
    svc.from("pesquisas")
      .select(`*,
        uc:unidades_conservacao(nome),
        autorizador:usuarios!aap_assinado_por(nome_completo),
        emitente:usuarios!aap_emitido_por(nome_completo)`)
      .eq("id", pesquisa_id).single(),
    svc.from("cargos_atuais")
      .select("nivel, responsavel_atual_id, responsavel_atual_nome, denominacao"),
    svc.from("pesquisa_equipe")
      .select("nome_completo, cpf, rg, funcao, titulacao, instituicao")
      .eq("pesquisa_id", pesquisa_id).order("criado_em"),
  ])

  if (pesqRes.error || !pesqRes.data) {
    return new Response(JSON.stringify({ error: "Pesquisa nao encontrada" }), { status: 404, headers: CORS })
  }

  const p      = pesqRes.data as Record<string, any>
  const cargos = (cargosRes.data ?? []) as Array<Record<string, string>>
  const equipe = (equipeRes.data ?? []) as Array<Record<string, string>>

  // ── Identidades para as assinaturas ──────────────────────────────────────
  // Esquerda: Secretário de Estado (quem autorizou o processo)
  const secretarioCargo = cargos.find(c => c.nivel === "secretario")
  const nomeSecretario  = p.autorizador?.nome_completo
    ?? secretarioCargo?.responsavel_atual_nome
    ?? "Leonardo das Neves Carvalho"

  // Direita: Chefe DEUC (quem clicou "Emitir AAP")
  const chefeCargo  = cargos.find(c => c.nivel === "chefe_deuc" || c.nivel === "chefe_debio")
  const nomeChefe   = p.emitente?.nome_completo
    ?? chefeCargo?.responsavel_atual_nome
    ?? "Chefe do Departamento de Unidades de Conservação"
  const cargoChefe  = chefeCargo?.denominacao ?? "Chefe do Departamento de Unidades de Conservação"

  // ── URL de validação por QR ───────────────────────────────────────────────
  const baseUrl    = Deno.env.get("PUBLIC_URL") ?? "https://siguc-ac.vercel.app"
  const validarUrl = `${baseUrl}/pages/validar-aap.html?token=${p.aap_qr_token}`

  // ════════════════════════════════════════════════════════════════════════════
  // PDF
  // ════════════════════════════════════════════════════════════════════════════
  const pdfDoc = await PDFDocument.create()
  const fontR  = await pdfDoc.embedFont(StandardFonts.Helvetica)
  const fontB  = await pdfDoc.embedFont(StandardFonts.HelveticaBold)
  const fontI  = await pdfDoc.embedFont(StandardFonts.HelveticaOblique)

  const HDR_H  = 72
  const LOGO_W = 42
  const LOGO_H = 42

  function addPage(): { pg: any; startY: number } {
    const pg     = pdfDoc.addPage([PG_W, PG_H])
    const hdrBot = PG_H - HDR_H

    pg.drawRectangle({ x: 0, y: hdrBot, width: PG_W, height: HDR_H, color: C_BRANCO })

    const logoY  = hdrBot + (HDR_H - LOGO_H) / 2
    drawLogo(pg, ML, logoY, LOGO_W, LOGO_H, "AC", "ESTADO DO ACRE", fontB, fontR, "escudo")
    const logo2X = ML + LOGO_W + 8
    drawLogo(pg, logo2X, logoY, LOGO_W, LOGO_H, "SEMA", "MEIO AMBIENTE", fontB, fontR, "folha")

    const divX = logo2X + LOGO_W + 10
    pg.drawLine({ start: { x: divX, y: logoY + 4 }, end: { x: divX, y: logoY + LOGO_H - 4 }, thickness: 0.8, color: C_BORDA })

    const instX  = divX + 10
    const instTop = logoY + LOGO_H - 2
    pg.drawText("GOVERNO DO ESTADO DO ACRE  ·  2023 – 2026", { x: instX, y: instTop - 10, size: 7, font: fontR, color: C_CINZA2 })
    pg.drawText("Secretaria de Estado do Meio Ambiente do Acre — SEMA-AC", { x: instX, y: instTop - 22, size: 9.5, font: fontB, color: C_VERDE })
    pg.drawText("Diretoria de Meio Ambiente  ·  Depto. de Unidades de Conservação — DEUC", { x: instX, y: instTop - 35, size: 7.5, font: fontR, color: C_CINZA })

    const metaX     = PG_W - MR
    const aapNum    = p.aap_numero ?? "—"
    const metaLines = [
      { t: "SIGUC-AC",                               f: fontB, s: 8.5 },
      { t: `Emitido: ${fmtDate(p.aap_emitida_em)}`,  f: fontR, s: 8 },
      { t: `AAP: ${aapNum}`,                          f: fontR, s: 8 },
    ]
    metaLines.forEach((m, i) => {
      const tw = m.f.widthOfTextAtSize(m.t, m.s)
      pg.drawText(m.t, { x: metaX - tw, y: instTop - 10 - i * 12, size: m.s, font: m.f, color: C_CINZA })
    })

    pg.drawLine({ start: { x: 0, y: hdrBot }, end: { x: PG_W, y: hdrBot }, thickness: 3, color: C_VERDE })
    pg.drawLine({ start: { x: 0, y: hdrBot + 4 }, end: { x: PG_W, y: hdrBot + 4 }, thickness: 1, color: C_OURO })

    // Rodapé
    const fLine1 = `Autentique este documento em: ${validarUrl}`
    const fLine2 = `Token: ${p.aap_qr_token ?? "—"}   |   Rio Branco – Acre, ${fmtDate(p.aap_emitida_em)}`
    pg.drawLine({ start: { x: ML, y: 44 }, end: { x: PG_W - MR, y: 44 }, thickness: 0.5, color: C_BORDA })
    const f1w = fontR.widthOfTextAtSize(fLine1, 7)
    const f2w = fontR.widthOfTextAtSize(fLine2, 7)
    pg.drawText(fLine1, { x: (PG_W - f1w) / 2, y: 33, size: 7, font: fontR, color: C_CINZA })
    pg.drawText(fLine2, { x: (PG_W - f2w) / 2, y: 22, size: 7, font: fontR, color: C_CINZA2 })

    return { pg, startY: hdrBot - 14 }
  }

  let { pg: page, startY } = addPage()
  let y = startY

  // ── Helpers de layout ─────────────────────────────────────────────────────
  const sec = (label: string) => {
    page.drawRectangle({ x: ML, y: y - 3, width: BODY_W, height: 15, color: C_VERDE })
    page.drawText(label, { x: ML + 6, y, size: 8, font: fontB, color: C_BRANCO })
    y -= 22
  }

  const field1 = (label: string, value: string) => {
    const lw = fontB.widthOfTextAtSize(label + ":", 8)
    page.drawText(label + ":", { x: ML, y, size: 8, font: fontB, color: C_CINZA })
    page.drawText(trunc(value), { x: ML + lw + 4, y, size: 8, font: fontR, color: C_PRETO })
    y -= 13
  }

  const field2 = (l1: string, v1: string, l2: string, v2: string) => {
    const half = BODY_W / 2
    const lw1  = fontB.widthOfTextAtSize(l1 + ":", 8)
    const lw2  = fontB.widthOfTextAtSize(l2 + ":", 8)
    page.drawText(l1 + ":", { x: ML,         y, size: 8, font: fontB, color: C_CINZA })
    page.drawText(trunc(v1, 34), { x: ML + lw1 + 4, y, size: 8, font: fontR, color: C_PRETO })
    page.drawText(l2 + ":", { x: ML + half,  y, size: 8, font: fontB, color: C_CINZA })
    page.drawText(trunc(v2, 34), { x: ML + half + lw2 + 4, y, size: 8, font: fontR, color: C_PRETO })
    y -= 13
  }

  const centerTxt = (text: string, yy: number, size: number, font = fontR, color = C_PRETO) => {
    const tw = font.widthOfTextAtSize(text, size)
    page.drawText(text, { x: (PG_W - tw) / 2, y: yy, size, font, color })
  }

  // ── TÍTULO ────────────────────────────────────────────────────────────────
  y -= 4
  centerTxt("AUTORIZAÇÃO DE ACESSO E PESQUISA", y, 15, fontB, C_VERDE)
  y -= 17
  page.drawLine({ start: { x: ML, y }, end: { x: PG_W - MR, y }, thickness: 1.5, color: C_OURO })
  y -= 8

  const numProc = p.numero_processo ?? "Em triagem"
  const bW = fontB.widthOfTextAtSize(numProc, 8) + 20
  const bX = (PG_W - bW) / 2
  page.drawRectangle({ x: bX, y: y - 4, width: bW, height: 14, color: C_BG, borderColor: C_BORDA, borderWidth: 0.8 })
  const btw = fontB.widthOfTextAtSize(numProc, 8)
  page.drawText(numProc, { x: bX + (bW - btw) / 2, y, size: 8, font: fontB, color: C_CINZA })
  y -= 20

  // ── 1. DADOS DA PESQUISA ──────────────────────────────────────────────────
  sec("1. DADOS DA PESQUISA")
  const titLines = wrapText(p.titulo ?? "—", BODY_W - fontB.widthOfTextAtSize("Título:", 8) - 8, fontR, 8)
  const lwTit    = fontB.widthOfTextAtSize("Título:", 8)
  page.drawText("Título:", { x: ML, y, size: 8, font: fontB, color: C_CINZA })
  for (let i = 0; i < Math.min(titLines.length, 3); i++) {
    page.drawText(titLines[i], { x: ML + lwTit + 4, y, size: 8, font: fontR, color: C_PRETO })
    if (i < Math.min(titLines.length, 3) - 1) y -= 11
  }
  y -= 13
  field2("Tipo", tipoLabel(p.tipo ?? "—"), "Área de estudo", p.area_pesquisa_ha ? p.area_pesquisa_ha + " ha" : "—")
  y -= 4

  // ── 2. PESQUISADOR RESPONSÁVEL ────────────────────────────────────────────
  sec("2. PESQUISADOR RESPONSÁVEL")
  field1("Nome completo", p.pesquisador_nome       ?? "—")
  field2("CPF",           p.pesquisador_cpf         ?? "—", "RG",       p.pesquisador_rg       ?? "—")
  field2("Titulação",     p.pesquisador_titulacao   ?? "—", "Telefone", p.pesquisador_telefone ?? "—")
  field2("E-mail",        p.pesquisador_email       ?? "—", "Lattes",   p.pesquisador_lattes   ?? "—")
  field1("Instituição",   p.pesquisador_instituicao ?? "—")
  y -= 4

  // ── 3. EQUIPE AUTORIZADA (condicional) ────────────────────────────────────
  let secN = 2
  if (equipe.length > 0) {
    secN++
    sec(`${secN}. EQUIPE AUTORIZADA`)

    const COL_W = [BODY_W * 0.38, BODY_W * 0.30, BODY_W * 0.32]
    const COL_X = [ML, ML + COL_W[0], ML + COL_W[0] + COL_W[1]]

    page.drawRectangle({ x: ML, y: y - 2, width: BODY_W, height: 13, color: C_VERDE })
    ;["Nome completo", "CPF / RG", "Função na pesquisa"].forEach((h, i) => {
      page.drawText(h, { x: COL_X[i] + 4, y, size: 7, font: fontB, color: C_BRANCO })
    })
    y -= 14

    for (let i = 0; i < Math.min(equipe.length, 10); i++) {
      const m = equipe[i]
      page.drawRectangle({ x: ML, y: y - 2, width: BODY_W, height: 12, color: i % 2 === 0 ? C_BG : C_BRANCO })
      page.drawText(trunc(m.nome_completo, 38), { x: COL_X[0] + 4, y, size: 7, font: fontR, color: C_PRETO })
      page.drawText(`${m.cpf ?? "—"}${m.rg ? " / " + m.rg : ""}`, { x: COL_X[1] + 4, y, size: 7, font: fontR, color: C_PRETO })
      page.drawText(trunc(funcaoLabel(m.funcao), 30), { x: COL_X[2] + 4, y, size: 7, font: fontR, color: C_PRETO })
      y -= 12
      page.drawLine({ start: { x: ML, y }, end: { x: ML + BODY_W, y }, thickness: 0.3, color: C_BORDA })
    }
    if (equipe.length > 10) {
      page.drawText(`+ ${equipe.length - 10} membros adicionais cadastrados no sistema.`, { x: ML, y: y - 2, size: 7, font: fontI, color: C_CINZA })
      y -= 12
    }
    y -= 6
  }

  // ── ÁREA DE ESTUDO ────────────────────────────────────────────────────────
  secN++
  sec(`${secN}. ÁREA DE ESTUDO`)
  field1("Unidade de Conservação", p.uc?.nome ?? "—")
  y -= 4

  // ── VIGÊNCIA ──────────────────────────────────────────────────────────────
  secN++
  sec(`${secN}. VIGÊNCIA`)
  field2("Início previsto",  fmtDate(p.data_inicio_prevista), "Término previsto", fmtDate(p.data_fim_prevista))
  field2("Data de emissão",  fmtDate(p.aap_emitida_em),       "Válida até",       fmtDate(p.aap_validade))
  y -= 4

  // ── AUTORIZAÇÕES EXTERNAS (condicional) ───────────────────────────────────
  if (p.sisbio_numero || p.sisgen_numero) {
    secN++
    sec(`${secN}. AUTORIZAÇÕES EXTERNAS`)
    if (p.sisbio_numero) field2("SISBIO n.", p.sisbio_numero, "Status SISBIO", p.sisbio_status === "validado" ? "Validado" : (p.sisbio_status ?? "—"))
    if (p.sisgen_numero) field2("SISGEN n.", p.sisgen_numero, "Status SISGEN", p.sisgen_status === "validado" ? "Validado" : (p.sisgen_status ?? "—"))
    y -= 4
  }

  // ── CONDICIONANTES ────────────────────────────────────────────────────────
  secN++
  sec(`${secN}. CONDICIONANTES E OBRIGAÇÕES`)
  const condTxt = p.aap_condicionantes ??
    "I - Cumprir integralmente as condições estabelecidas nesta autorização; " +
    "II - Comunicar à SEMA/AC qualquer alteração no projeto de pesquisa ou na composição da equipe; " +
    "III - Entregar relatórios parciais semestrais e relatório final ao término da vigência; " +
    "IV - Fornecer cópia dos dados e amostras coletadas ao acervo da Unidade de Conservação; " +
    "V - Zelar pela integridade dos ecossistemas, não causando danos ao ambiente durante a execução."
  const condLines = wrapText(condTxt, BODY_W - 12, fontR, 8)
  for (const line of condLines.slice(0, 8)) {
    page.drawText(line, { x: ML + 6, y, size: 8, font: fontR, color: C_PRETO })
    y -= 11
  }
  y -= 10

  // ── Nova página se não couber a seção de assinaturas ─────────────────────
  if (y < 210) {
    const next = addPage()
    page = next.pg
    y    = next.startY
  }

  // ── DESPACHO E ASSINATURA ────────────────────────────────────────────────
  secN++
  sec(`${secN}. DESPACHO E ASSINATURA`)

  page.drawText(
    `Autorizado em ${fmtDate(p.aap_assinado_em)}, nos termos da Lei 14.063/2020 — Assinatura Eletrônica Simples.`,
    { x: ML, y, size: 8, font: fontI, color: C_CINZA },
  )
  y -= 28

  // ─── Layout de assinaturas: [QR] [Secretário] [Chefe DEUC] ───────────────
  const QR_SIZE = 72
  const QR_X   = ML
  const QR_Y   = y - QR_SIZE

  // QR code
  drawQR(page, validarUrl, QR_X, QR_Y, QR_SIZE)
  const qrLbl1 = "Escaneie para validar"
  const qrLbl2 = "este documento"
  ;[qrLbl1, qrLbl2].forEach((t, i) => {
    const tw = fontR.widthOfTextAtSize(t, 6.5)
    page.drawText(t, { x: QR_X + (QR_SIZE - tw) / 2, y: QR_Y - 10 - i * 10, size: 6.5, font: fontR, color: C_CINZA })
  })

  // Duas caixas de assinatura ao lado do QR
  const SIGN_X  = QR_X + QR_SIZE + 18
  const SIGN_W  = (PG_W - MR - SIGN_X) / 2 - 6
  const SIGN_X2 = SIGN_X + SIGN_W + 12
  const BLK_H   = QR_SIZE
  const BLK_Y   = QR_Y

  // Bloco Secretário (fundo verde escuro, letras claras)
  page.drawRectangle({ x: SIGN_X, y: BLK_Y, width: SIGN_W, height: BLK_H, color: C_VERDE2, borderColor: C_OURO, borderWidth: 0.6 })
  page.drawRectangle({ x: SIGN_X, y: BLK_Y + BLK_H - 14, width: SIGN_W, height: 14, color: C_VERDE })

  const lbl1 = "AUTORIZADO POR"
  page.drawText(lbl1, { x: SIGN_X + (SIGN_W - fontB.widthOfTextAtSize(lbl1, 6.5)) / 2, y: BLK_Y + BLK_H - 10, size: 6.5, font: fontB, color: C_OURO_C })

  const nSec = trunc(nomeSecretario, 30)
  page.drawText(nSec, { x: SIGN_X + (SIGN_W - fontB.widthOfTextAtSize(nSec, 8.5)) / 2, y: BLK_Y + BLK_H - 30, size: 8.5, font: fontB, color: C_BRANCO })

  ;["Secretário de Estado do", "Meio Ambiente do Acre"].forEach((t, i) => {
    page.drawText(t, { x: SIGN_X + (SIGN_W - fontR.widthOfTextAtSize(t, 7)) / 2, y: BLK_Y + BLK_H - 43 - i * 10, size: 7, font: fontR, color: C_OURO_C })
  })

  const dtSec = `Autorizado em: ${fmtDate(p.aap_assinado_em)}`
  page.drawText(dtSec, { x: SIGN_X + (SIGN_W - fontR.widthOfTextAtSize(dtSec, 6.5)) / 2, y: BLK_Y + 6, size: 6.5, font: fontR, color: C_CINZA2 })

  // Bloco Chefe DEUC (fundo branco, borda)
  page.drawRectangle({ x: SIGN_X2, y: BLK_Y, width: SIGN_W, height: BLK_H, color: C_BRANCO, borderColor: C_BORDA, borderWidth: 0.8 })
  page.drawRectangle({ x: SIGN_X2, y: BLK_Y + BLK_H - 14, width: SIGN_W, height: 14, color: C_VERDE })

  const lbl2 = "EMITIDO POR"
  page.drawText(lbl2, { x: SIGN_X2 + (SIGN_W - fontB.widthOfTextAtSize(lbl2, 6.5)) / 2, y: BLK_Y + BLK_H - 10, size: 6.5, font: fontB, color: C_OURO_C })

  const nChef = trunc(nomeChefe, 30)
  page.drawText(nChef, { x: SIGN_X2 + (SIGN_W - fontB.widthOfTextAtSize(nChef, 8.5)) / 2, y: BLK_Y + BLK_H - 30, size: 8.5, font: fontB, color: C_PRETO })

  wrapText(cargoChefe, SIGN_W - 8, fontR, 7).slice(0, 2).forEach((t, i) => {
    page.drawText(t, { x: SIGN_X2 + (SIGN_W - fontR.widthOfTextAtSize(t, 7)) / 2, y: BLK_Y + BLK_H - 43 - i * 10, size: 7, font: fontR, color: C_CINZA })
  })

  const dtEmit = `Emitido em: ${fmtDate(p.aap_emitida_em)}`
  page.drawText(dtEmit, { x: SIGN_X2 + (SIGN_W - fontR.widthOfTextAtSize(dtEmit, 6.5)) / 2, y: BLK_Y + 6, size: 6.5, font: fontR, color: C_CINZA2 })

  // Nota legal
  y = BLK_Y - 26
  const legalTxt = "Documento emitido eletronicamente nos termos da Lei Federal nº 14.063, de 23 de setembro de 2020."
  wrapText(legalTxt, BODY_W, fontI, 7.5).forEach(line => {
    const lw = fontI.widthOfTextAtSize(line, 7.5)
    page.drawText(line, { x: (PG_W - lw) / 2, y, size: 7.5, font: fontI, color: C_CINZA })
    y -= 10
  })

  // ── Salva e envia para Supabase Storage ───────────────────────────────────
  const pdfBytes    = await pdfDoc.save()
  const safeNum     = (p.aap_numero ?? "sem-numero").replace(/\//g, "-")
  const storagePath = `${pesquisa_id}/AAP_${safeNum}.pdf`

  const { error: upErr } = await svc.storage
    .from("pesquisa-documentos")
    .upload(storagePath, pdfBytes, { contentType: "application/pdf", upsert: true })

  if (upErr) {
    return new Response(JSON.stringify({ error: upErr.message }), { status: 500, headers: CORS })
  }

  await svc.from("pesquisas").update({ aap_pdf_path: storagePath }).eq("id", pesquisa_id)

  const { data: signed } = await svc.storage
    .from("pesquisa-documentos")
    .createSignedUrl(storagePath, 3600)

  return new Response(
    JSON.stringify({ url: signed?.signedUrl, filename: storagePath }),
    { headers: { ...CORS, "Content-Type": "application/json" } },
  )
})
