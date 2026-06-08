import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { PDFDocument, rgb, StandardFonts } from "https://esm.sh/pdf-lib@1.17.1"

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

// ── Constantes de layout ───────────────────────────────────────────────────
const ML = 46  // margem esquerda
const MR = 46  // margem direita
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
    fauna: "Fauna", flora: "Flora", genetica: "Genetica",
    ecossistema: "Ecossistema", socioambiental: "Socioambiental", outro: "Outro",
  }
  return map[tipo] ?? tipo
}

function funcaoLabel(funcao: string): string {
  const map: Record<string, string> = {
    co_orientador: "Co-orientador(a)", pesquisador_colaborador: "Pesquisador(a) colaborador(a)",
    mestrando: "Mestrando(a)", doutorando: "Doutorando(a)", bolsista: "Bolsista",
    tecnico_campo: "Tecnico(a) de campo", estagiario: "Estagiario(a)", auxiliar: "Auxiliar",
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

// ── Desenha logo institucional (placeholder vetorial elegante) ──────────────
//
//  Replica: rel-logo (48×48, bg cinza, emoji dentro) do mockup CAR
//  Como não há imagens, desenhamos dois blocos com siglas e detalhes geométricos
//
function drawLogo(
  page: any,
  x: number, y: number, w: number, h: number,
  sigla: string, sub: string,
  fontB: any, fontR: any,
  tipo: "escudo" | "folha" = "escudo",
) {
  // Fundo do bloco
  page.drawRectangle({ x, y, width: w, height: h, color: C_VERDE, borderColor: C_OURO, borderWidth: 0.8 })

  if (tipo === "escudo") {
    // Estrela/escudo: duas barras diagonais douradas finas (detalhe geométrico)
    page.drawLine({ start: { x: x + 4, y: y + h - 4 }, end: { x: x + 12, y: y + h - 12 }, thickness: 0.7, color: C_OURO_C })
    page.drawLine({ start: { x: x + w - 4, y: y + h - 4 }, end: { x: x + w - 12, y: y + h - 12 }, thickness: 0.7, color: C_OURO_C })
    // Barra ouro horizontal no topo
    page.drawRectangle({ x, y: y + h - 5, width: w, height: 5, color: C_OURO })
  } else {
    // Folha: losango dourado central (detalhe geométrico)
    const cx = x + w / 2, cy = y + h * 0.62
    const r  = 4
    page.drawLine({ start: { x: cx, y: cy + r }, end: { x: cx + r, y: cy }, thickness: 0.7, color: C_OURO_C })
    page.drawLine({ start: { x: cx + r, y: cy }, end: { x: cx, y: cy - r }, thickness: 0.7, color: C_OURO_C })
    page.drawLine({ start: { x: cx, y: cy - r }, end: { x: cx - r, y: cy }, thickness: 0.7, color: C_OURO_C })
    page.drawLine({ start: { x: cx - r, y: cy }, end: { x: cx, y: cy + r }, thickness: 0.7, color: C_OURO_C })
    // Linha vertical fina central
    page.drawLine({ start: { x: cx, y: cy + r - 1 }, end: { x: cx, y: y + 2 }, thickness: 0.5, color: rgb(0.7, 0.9, 0.75) })
  }

  // Sigla
  const sw = fontB.widthOfTextAtSize(sigla, 10)
  page.drawText(sigla, { x: x + (w - sw) / 2, y: y + 12, size: 10, font: fontB, color: C_BRANCO })
  // Subtexto
  const subW = fontR.widthOfTextAtSize(sub, 5.5)
  page.drawText(sub, { x: x + (w - subW) / 2, y: y + 6, size: 5.5, font: fontR, color: C_OURO_C })
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

  const [pesqRes, cargosRes, userRes, equipeRes] = await Promise.all([
    svc.from("pesquisas")
      .select("*, uc:unidades_conservacao(nome), autorizador:usuarios!aap_assinado_por(nome_completo)")
      .eq("id", pesquisa_id).single(),
    svc.from("cargos_atuais")
      .select("nivel, responsavel_atual_id, responsavel_atual_nome, denominacao"),
    svc.from("usuarios").select("nome_completo").eq("id", user.id).single(),
    svc.from("pesquisa_equipe")
      .select("nome_completo, cpf, rg, funcao, titulacao, instituicao")
      .eq("pesquisa_id", pesquisa_id).order("criado_em"),
  ])

  if (pesqRes.error || !pesqRes.data) {
    return new Response(JSON.stringify({ error: "Pesquisa nao encontrada" }), { status: 404, headers: CORS })
  }

  const p        = pesqRes.data as Record<string, any>
  const cargos   = (cargosRes.data ?? []) as Array<Record<string, string>>
  const equipe   = (equipeRes.data ?? []) as Array<Record<string, string>>
  const emitente = userRes.data?.nome_completo ?? "Chefe DEUC"
  const meuCargo = cargos.find(c => c.responsavel_atual_id === user.id)?.denominacao
    ?? "Chefe do Departamento de Unidades de Conservacao"
  const diretor   = cargos.find(c => c.nivel === "diretor")
  const chefeDEUC = cargos.find(c => c.nivel === "chefe_deuc")
  const nomeChefe = chefeDEUC?.responsavel_atual_nome ?? emitente

  // ── Documento PDF ─────────────────────────────────────────────────────────
  const pdfDoc = await PDFDocument.create()
  const fontR  = await pdfDoc.embedFont(StandardFonts.Helvetica)
  const fontB  = await pdfDoc.embedFont(StandardFonts.HelveticaBold)
  const fontI  = await pdfDoc.embedFont(StandardFonts.HelveticaOblique)

  // ════════════════════════════════════════════════════════════════════════
  // FUNÇÃO: Adiciona página com cabeçalho ABNT + rodapé  (= relatorio CAR)
  // ════════════════════════════════════════════════════════════════════════
  //
  // Estrutura do cabeçalho (inspirado em .rel-cabecalho do mockup-relatorio-car):
  //
  //  ┌──────────────────────────────────────────────────────────────────┐
  //  │  [AC GOV] │ [SEMA] │ GOVERNO DO ESTADO DO ACRE · 2023-2026  SIGUC-AC  │
  //  │  logo 1   │ logo 2 │ Secretaria de Meio Ambiente – SEMA-AC    data  │
  //  │           │        │ Diretoria de Meio Ambiente · DEUC        AAP   │
  //  ├══════ borda verde 3pt ════════════════════════════════════════════╡
  //  │          linha dourada 1pt                                       │
  //  └──────────────────────────────────────────────────────────────────┘
  //
  const HDR_H = 72   // altura do cabeçalho
  const HDR_PAD = 14 // padding interno vertical
  const LOGO_W = 42
  const LOGO_H = 42

  function addPage(): { pg: any; startY: number } {
    const pg = pdfDoc.addPage([PG_W, PG_H])

    // ── Área do cabeçalho ────────────────────────────────────────────
    const hdrTop = PG_H          // topo absoluto
    const hdrBot = PG_H - HDR_H  // base do cabeçalho

    // Fundo branco explícito para o cabeçalho
    pg.drawRectangle({ x: 0, y: hdrBot, width: PG_W, height: HDR_H, color: C_BRANCO })

    // Logo 1 — Governo do Acre
    const logoY = hdrBot + (HDR_H - LOGO_H) / 2
    drawLogo(pg, ML, logoY, LOGO_W, LOGO_H, "AC", "ESTADO DO ACRE", fontB, fontR, "escudo")

    // Logo 2 — SEMA-AC
    const logo2X = ML + LOGO_W + 8
    drawLogo(pg, logo2X, logoY, LOGO_W, LOGO_H, "SEMA", "MEIO AMBIENTE", fontB, fontR, "folha")

    // Divisor vertical entre logos e texto institucional
    const divX = logo2X + LOGO_W + 10
    pg.drawLine({
      start: { x: divX, y: logoY + 4 },
      end:   { x: divX, y: logoY + LOGO_H - 4 },
      thickness: 0.8, color: C_BORDA,
    })

    // Texto institucional
    const instX = divX + 10
    const instTop = logoY + LOGO_H - 2

    // Linha 1 — "GOVERNO DO ESTADO DO ACRE · 2023–2026" (cinza pequeno)
    pg.drawText("GOVERNO DO ESTADO DO ACRE  ·  2023 – 2026", {
      x: instX, y: instTop - 10, size: 7, font: fontR, color: C_CINZA2,
    })
    // Linha 2 — "Secretaria de Estado do Meio Ambiente do Acre — SEMA-AC" (bold principal)
    pg.drawText("Secretaria de Estado do Meio Ambiente do Acre — SEMA-AC", {
      x: instX, y: instTop - 22, size: 9.5, font: fontB, color: C_VERDE,
    })
    // Linha 3 — "Diretoria de Meio Ambiente  ·  Departamento de Unidades de Conservacao"
    pg.drawText("Diretoria de Meio Ambiente  ·  Depto. de Unidades de Conservacao — DEUC", {
      x: instX, y: instTop - 35, size: 7.5, font: fontR, color: C_CINZA,
    })

    // Meta — canto superior direito (SIGUC-AC, emissão, AAP)
    const metaX = PG_W - MR
    const aapNum  = p.aap_numero ?? "—"
    const metaLines = [
      { t: "SIGUC-AC",                   f: fontB,  s: 8.5 },
      { t: `Emitido: ${fmtDate(p.aap_emitida_em)}`, f: fontR, s: 8 },
      { t: `AAP: ${aapNum}`,              f: fontR,  s: 8 },
    ]
    metaLines.forEach((m, i) => {
      const tw = m.f.widthOfTextAtSize(m.t, m.s)
      pg.drawText(m.t, { x: metaX - tw, y: instTop - 10 - i * 12, size: m.s, font: m.f, color: C_CINZA })
    })

    // Borda inferior do cabeçalho — linha verde 3pt (= border-bottom:3px solid #0A1A0F)
    pg.drawLine({ start: { x: 0, y: hdrBot }, end: { x: PG_W, y: hdrBot }, thickness: 3, color: C_VERDE })
    // Acento dourado 1pt logo acima
    pg.drawLine({ start: { x: 0, y: hdrBot + 4 }, end: { x: PG_W, y: hdrBot + 4 }, thickness: 1, color: C_OURO })

    // ── Rodapé ───────────────────────────────────────────────────────
    const baseUrl = Deno.env.get("PUBLIC_URL") ?? "https://siguc-ac.vercel.app"
    const fLine1 = `Autentique este documento em: ${baseUrl}/verificar/${p.aap_qr_token}`
    const fLine2 = `Token: ${p.aap_qr_token ?? "—"}   |   Rio Branco – Acre, ${fmtDate(p.aap_emitida_em)}`
    pg.drawLine({ start: { x: ML, y: 44 }, end: { x: PG_W - MR, y: 44 }, thickness: 0.5, color: C_BORDA })
    const f1w = fontR.widthOfTextAtSize(fLine1, 7)
    const f2w = fontR.widthOfTextAtSize(fLine2, 7)
    pg.drawText(fLine1, { x: (PG_W - f1w) / 2, y: 33, size: 7, font: fontR, color: C_CINZA })
    pg.drawText(fLine2, { x: (PG_W - f2w) / 2, y: 22, size: 7, font: fontR, color: C_CINZA2 })

    return { pg, startY: hdrBot - 14 }
  }

  // ── Página 1 ──────────────────────────────────────────────────────────────
  let { pg: page, startY } = addPage()
  let y = startY

  // ── Helpers de desenho (usam `page` por closure — rebind em nova página) ──

  const sec = (label: string, pg = page) => {
    pg.drawRectangle({ x: ML, y: y - 3, width: BODY_W, height: 15, color: C_VERDE })
    pg.drawText(label, { x: ML + 6, y, size: 8, font: fontB, color: C_BRANCO })
    y -= 22
  }

  const field1 = (label: string, value: string, pg = page) => {
    const lw = fontB.widthOfTextAtSize(label + ":", 8)
    pg.drawText(label + ":", { x: ML, y, size: 8, font: fontB, color: C_CINZA })
    pg.drawText(trunc(value), { x: ML + lw + 4, y, size: 8, font: fontR, color: C_PRETO })
    y -= 13
  }

  const field2 = (l1: string, v1: string, l2: string, v2: string, pg = page) => {
    const half = BODY_W / 2
    const lw1  = fontB.widthOfTextAtSize(l1 + ":", 8)
    const lw2  = fontB.widthOfTextAtSize(l2 + ":", 8)
    pg.drawText(l1 + ":", { x: ML,           y, size: 8, font: fontB, color: C_CINZA })
    pg.drawText(trunc(v1, 34), { x: ML + lw1 + 4, y, size: 8, font: fontR, color: C_PRETO })
    pg.drawText(l2 + ":", { x: ML + half,    y, size: 8, font: fontB, color: C_CINZA })
    pg.drawText(trunc(v2, 34), { x: ML + half + lw2 + 4, y, size: 8, font: fontR, color: C_PRETO })
    y -= 13
  }

  const centerTxt = (text: string, yy: number, size: number, font = fontR, color = C_PRETO, pg = page) => {
    const tw = font.widthOfTextAtSize(text, size)
    pg.drawText(text, { x: (PG_W - tw) / 2, y: yy, size, font, color })
  }

  // ── TÍTULO DO DOCUMENTO ───────────────────────────────────────────────────
  // "AUTORIZAÇÃO DE ACESSO E PESQUISA" centralizado com sub-badges

  y -= 4
  centerTxt("AUTORIZACAO DE ACESSO E PESQUISA", y, 15, fontB, C_VERDE)
  y -= 17

  // Linha divisória ouro
  page.drawLine({ start: { x: ML, y }, end: { x: PG_W - MR, y }, thickness: 1.5, color: C_OURO })
  y -= 8

  // Badge do número do processo
  const numProc = p.numero_processo ?? "Em triagem"
  const badgeTxt = numProc
  const bW = fontB.widthOfTextAtSize(badgeTxt, 8) + 20
  const bX = (PG_W - bW) / 2
  page.drawRectangle({ x: bX, y: y - 4, width: bW, height: 14, color: C_BG, borderColor: C_BORDA, borderWidth: 0.8 })
  const btw = fontB.widthOfTextAtSize(badgeTxt, 8)
  page.drawText(badgeTxt, { x: bX + (bW - btw) / 2, y: y, size: 8, font: fontB, color: C_CINZA })
  y -= 20

  // ── 1. DADOS DA PESQUISA ──────────────────────────────────────────────────
  sec("1. DADOS DA PESQUISA")
  const titLines = wrapText(p.titulo ?? "—", BODY_W - fontB.widthOfTextAtSize("Titulo:", 8) - 8, fontR, 8)
  const lwTit    = fontB.widthOfTextAtSize("Titulo:", 8)
  page.drawText("Titulo:", { x: ML, y, size: 8, font: fontB, color: C_CINZA })
  for (let i = 0; i < Math.min(titLines.length, 3); i++) {
    page.drawText(titLines[i], { x: ML + lwTit + 4, y, size: 8, font: fontR, color: C_PRETO })
    if (i < Math.min(titLines.length, 3) - 1) y -= 11
  }
  y -= 13
  field2("Tipo", tipoLabel(p.tipo ?? "—"), "Area de estudo", p.area_pesquisa_ha ? p.area_pesquisa_ha + " ha" : "—")
  y -= 4

  // ── 2. PESQUISADOR RESPONSAVEL ────────────────────────────────────────────
  sec("2. PESQUISADOR RESPONSAVEL")
  field1("Nome completo",  p.pesquisador_nome          ?? "—")
  field2("CPF",            p.pesquisador_cpf            ?? "—", "RG",         p.pesquisador_rg        ?? "—")
  field2("Titulacao",      p.pesquisador_titulacao      ?? "—", "Telefone",   p.pesquisador_telefone  ?? "—")
  field2("E-mail",         p.pesquisador_email          ?? "—", "Lattes",     p.pesquisador_lattes    ?? "—")
  field1("Instituicao",    p.pesquisador_instituicao    ?? "—")
  y -= 4

  // ── 3. EQUIPE AUTORIZADA (condicional) ────────────────────────────────────
  let secN = 2
  if (equipe.length > 0) {
    secN++
    sec(`${secN}. EQUIPE AUTORIZADA`)

    // Cabeçalho da tabela (= .rel-tabela th do mockup)
    const COL_W = [BODY_W * 0.38, BODY_W * 0.30, BODY_W * 0.32]
    const COL_X = [ML, ML + COL_W[0], ML + COL_W[0] + COL_W[1]]

    page.drawRectangle({ x: ML, y: y - 2, width: BODY_W, height: 13, color: C_VERDE })
    const headers = ["Nome completo", "CPF / RG", "Funcao na pesquisa"]
    headers.forEach((h, i) => {
      page.drawText(h, { x: COL_X[i] + 4, y, size: 7, font: fontB, color: C_BRANCO })
    })
    y -= 14

    for (let i = 0; i < Math.min(equipe.length, 10); i++) {
      const m = equipe[i]
      const even = i % 2 === 0
      page.drawRectangle({ x: ML, y: y - 2, width: BODY_W, height: 12,
        color: even ? rgb(0.976, 0.984, 0.976) : C_BRANCO })
      page.drawText(trunc(m.nome_completo, 38), { x: COL_X[0] + 4, y, size: 7, font: fontR, color: C_PRETO })
      page.drawText(`${m.cpf ?? "—"}${m.rg ? " / " + m.rg : ""}`, { x: COL_X[1] + 4, y, size: 7, font: fontR, color: C_PRETO })
      page.drawText(trunc(funcaoLabel(m.funcao), 30), { x: COL_X[2] + 4, y, size: 7, font: fontR, color: C_PRETO })
      y -= 12
      page.drawLine({ start: { x: ML, y }, end: { x: ML + BODY_W, y }, thickness: 0.3, color: C_BORDA })
    }
    if (equipe.length > 10) {
      page.drawText(`+ ${equipe.length - 10} membros adicionais cadastrados no sistema.`,
        { x: ML, y: y - 2, size: 7, font: fontI, color: C_CINZA })
      y -= 12
    }
    y -= 6
  }

  // ── AREA DE ESTUDO ────────────────────────────────────────────────────────
  secN++
  sec(`${secN}. AREA DE ESTUDO`)
  field1("Unidade de Conservacao", p.uc?.nome ?? "—")
  y -= 4

  // ── VIGENCIA ──────────────────────────────────────────────────────────────
  secN++
  sec(`${secN}. VIGENCIA`)
  field2("Inicio previsto",  fmtDate(p.data_inicio_prevista), "Termino previsto", fmtDate(p.data_fim_prevista))
  field2("Data de emissao",  fmtDate(p.aap_emitida_em),       "Valida ate",       fmtDate(p.aap_validade))
  y -= 4

  // ── AUTORIZACOES EXTERNAS (condicional) ───────────────────────────────────
  if (p.sisbio_numero || p.sisgen_numero) {
    secN++
    sec(`${secN}. AUTORIZACOES EXTERNAS`)
    if (p.sisbio_numero) field2("SISBIO n.", p.sisbio_numero, "Status SISBIO", p.sisbio_status === "validado" ? "Validado" : (p.sisbio_status ?? "—"))
    if (p.sisgen_numero) field2("SISGEN n.", p.sisgen_numero, "Status SISGEN", p.sisgen_status === "validado" ? "Validado" : (p.sisgen_status ?? "—"))
    y -= 4
  }

  // ── CONDICIONANTES ────────────────────────────────────────────────────────
  secN++
  sec(`${secN}. CONDICIONANTES E OBRIGACOES`)
  const condTxt = p.aap_condicionantes ??
    "I - Cumprir integralmente as condicoes estabelecidas nesta autorizacao; " +
    "II - Comunicar a SEMA/AC qualquer alteracao no projeto de pesquisa ou na composicao da equipe; " +
    "III - Entregar relatorios parciais semestrais e relatorio final ao termino da vigencia; " +
    "IV - Fornecer copia dos dados e amostras coletadas ao acervo da Unidade de Conservacao; " +
    "V - Zelar pela integridade dos ecossistemas, nao causando danos ao ambiente durante a execucao."
  const condLines = wrapText(condTxt, BODY_W - 12, fontR, 8)
  for (const line of condLines.slice(0, 8)) {
    page.drawText(line, { x: ML + 6, y, size: 8, font: fontR, color: C_PRETO })
    y -= 11
  }
  y -= 10

  // ── Nova página se necessário ─────────────────────────────────────────────
  if (y < 180) {
    const next = addPage()
    page = next.pg
    y    = next.startY
  }

  // ── DESPACHO E ASSINATURAS ────────────────────────────────────────────────
  secN++
  sec(`${secN}. DESPACHO E ASSINATURAS`, page)

  // Texto de autorização
  const nomeAut = p.autorizador?.nome_completo ?? "—"
  page.drawText(
    `Pesquisa autorizada em ${fmtDate(p.aap_assinado_em)} por ${nomeAut}.`,
    { x: ML, y, size: 8, font: fontI, color: C_CINZA },
  )
  y -= 32

  // Duas linhas de assinatura (= .rel-cabecalho layout)
  const SW  = 200
  const SX1 = ML
  const SX2 = PG_W - MR - SW

  // Linha esquerda — Diretor DIMA
  page.drawLine({ start: { x: SX1, y }, end: { x: SX1 + SW, y }, thickness: 0.8, color: C_CINZA })
  // Linha direita — Chefe DEUC
  page.drawLine({ start: { x: SX2, y }, end: { x: SX2 + SW, y }, thickness: 0.8, color: C_CINZA })
  y -= 13

  const ctr = (text: string, x1: number, x2: number, yy: number, size: number, f = fontR, col = C_PRETO) => {
    const tw = f.widthOfTextAtSize(String(text), size)
    page.drawText(String(text), { x: (x1 + x2) / 2 - tw / 2, y: yy, size, font: f, color: col })
  }

  const nomeDiretor  = diretor?.responsavel_atual_nome ?? "—"
  const cargoDiretor = diretor?.denominacao ?? "Diretor de Meio Ambiente"

  ctr(nomeDiretor,  SX1, SX1 + SW, y, 8.5, fontB, C_PRETO)
  ctr(nomeChefe,    SX2, SX2 + SW, y, 8.5, fontB, C_PRETO)
  y -= 12
  ctr(cargoDiretor, SX1, SX1 + SW, y, 7.5, fontR, C_CINZA)
  ctr(meuCargo,     SX2, SX2 + SW, y, 7.5, fontR, C_CINZA)
  y -= 11
  ctr("DIMA / SEMA-AC",        SX1, SX1 + SW, y, 7, fontR, C_CINZA2)
  ctr("DEUC / DIMA / SEMA-AC", SX2, SX2 + SW, y, 7, fontR, C_CINZA2)
  y -= 30

  // Selos / stamps decorativos (círculos pontilhados simulando carimbos)
  const stampR = 24
  for (const sx of [SX1 + SW / 2, SX2 + SW / 2]) {
    // circulo pontilhado: 24 pontos ao redor
    const cy = y + stampR
    for (let a = 0; a < 360; a += 15) {
      const rad = a * Math.PI / 180
      page.drawCircle({
        x: sx + stampR * Math.cos(rad),
        y: cy + stampR * Math.sin(rad),
        size: 0.8, color: C_BORDA,
      })
    }
    // Texto interno do carimbo
    const st1W = fontR.widthOfTextAtSize("SEMA-AC", 5.5)
    page.drawText("SEMA-AC", { x: sx - st1W / 2, y: cy + 4, size: 5.5, font: fontR, color: C_CINZA2 })
    const st2W = fontR.widthOfTextAtSize("ACRE", 5)
    page.drawText("ACRE",    { x: sx - st2W / 2, y: cy - 5, size: 5, font: fontB, color: C_CINZA })
  }

  // ── SALVA E ENVIA PARA STORAGE ────────────────────────────────────────────
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
