import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { PDFDocument, rgb, StandardFonts } from "https://esm.sh/pdf-lib@1.17.1"

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

// ── Paleta SIGUC ──────────────────────────────────────────────────────────────
const C_VERDE  = rgb(0.039, 0.102, 0.059)   // #0A1A0F
const C_OURO   = rgb(0.788, 0.659, 0.298)   // #C9A84C
const C_CINZA  = rgb(0.420, 0.447, 0.471)   // #6B7280
const C_PRETO  = rgb(0.067, 0.067, 0.094)   // #111827
const C_BRANCO = rgb(1, 1, 1)
const C_VERDE_L = rgb(0.906, 0.973, 0.941)  // #ECFDF5 (fundo linha equipe)

// ── Utilitários ───────────────────────────────────────────────────────────────

function fmtDate(dt: string | null | undefined): string {
  if (!dt) return "—"
  const s = String(dt).substring(0, 10)
  if (s.length < 10) return String(dt)
  const [y, m, d] = s.split("-")
  return `${d}/${m}/${y}`
}

function tipoLabel(tipo: string): string {
  return (
    { fauna: "Fauna", flora: "Flora", genetica: "Genetica",
      ecossistema: "Ecossistema", socioambiental: "Socioambiental", outro: "Outro" }[tipo] ?? tipo
  )
}

function funcaoLabel(funcao: string): string {
  return (
    {
      co_orientador: "Co-orientador(a)",
      pesquisador_colaborador: "Pesquisador(a) colaborador(a)",
      mestrando: "Mestrando(a)", doutorando: "Doutorando(a)",
      bolsista: "Bolsista", tecnico_campo: "Tecnico(a) de campo",
      estagiario: "Estagiario(a)", auxiliar: "Auxiliar de pesquisa",
    }[funcao] ?? funcao
  )
}

function wrapText(text: string, maxW: number, font: any, size: number): string[] {
  const words = text.split(" ")
  const lines: string[] = []
  let current = ""
  for (const word of words) {
    const test = current ? current + " " + word : word
    if (font.widthOfTextAtSize(test, size) > maxW) {
      if (current) lines.push(current)
      current = word
    } else {
      current = test
    }
  }
  if (current) lines.push(current)
  return lines.length ? lines : [""]
}

function trunc(text: string | null | undefined, maxChars = 70): string {
  if (!text) return "—"
  return text.length > maxChars ? text.substring(0, maxChars - 1) + "…" : text
}

// ── Handler principal ─────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS })

  const authHeader = req.headers.get("Authorization")
  if (!authHeader) {
    return new Response(JSON.stringify({ error: "Nao autorizado" }), { status: 401, headers: CORS })
  }

  // Verifica usuário
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

  // Busca dados em paralelo
  const [pesqRes, cargosRes, userRes, equipeRes] = await Promise.all([
    svc.from("pesquisas")
      .select("*, uc:unidades_conservacao(nome), autorizador:usuarios!aap_assinado_por(nome_completo)")
      .eq("id", pesquisa_id)
      .single(),
    svc.from("cargos_atuais")
      .select("nivel, responsavel_atual_id, responsavel_atual_nome, denominacao"),
    svc.from("usuarios").select("nome_completo").eq("id", user.id).single(),
    svc.from("pesquisa_equipe")
      .select("nome_completo, cpf, rg, funcao, titulacao, instituicao")
      .eq("pesquisa_id", pesquisa_id)
      .order("criado_em"),
  ])

  if (pesqRes.error || !pesqRes.data) {
    return new Response(JSON.stringify({ error: "Pesquisa nao encontrada" }), { status: 404, headers: CORS })
  }

  const p        = pesqRes.data as Record<string, any>
  const cargos   = (cargosRes.data ?? []) as Array<Record<string, string>>
  const equipe   = (equipeRes.data ?? []) as Array<Record<string, string>>
  const emitente = userRes.data?.nome_completo ?? "Chefe DEUC"
  const meuCargo = cargos.find(c => c.responsavel_atual_id === user.id)?.denominacao ?? "Chefe do Departamento de Unidades de Conservacao"
  const diretor   = cargos.find(c => c.nivel === "diretor")
  const chefeDEUC = cargos.find(c => c.nivel === "chefe_deuc")
  const nomeChefe = chefeDEUC?.responsavel_atual_nome ?? emitente

  // ── Gera PDF ──────────────────────────────────────────────────────────────
  const pdfDoc = await PDFDocument.create()
  const fontR = await pdfDoc.embedFont(StandardFonts.Helvetica)
  const fontB = await pdfDoc.embedFont(StandardFonts.HelveticaBold)
  const fontI = await pdfDoc.embedFont(StandardFonts.HelveticaOblique)

  const ML = 50
  const MR = 50

  // ── Adiciona página com header/footer ────────────────────────────────────
  function addPage() {
    const pg = pdfDoc.addPage([595.28, 841.89])
    const { width, height } = pg.getSize()

    // Header bar
    pg.drawRectangle({ x: 0, y: height - 80, width, height: 80, color: C_VERDE })
    pg.drawRectangle({ x: 0, y: height - 84, width, height: 4,  color: C_OURO })
    pg.drawText("GOVERNO DO ESTADO DO ACRE",                       { x: ML, y: height - 18, size: 9,  font: fontB, color: C_BRANCO })
    pg.drawText("Secretaria de Estado do Meio Ambiente – SEMA/AC", { x: ML, y: height - 31, size: 8,  font: fontR, color: rgb(0.80, 0.90, 0.84) })
    pg.drawText("Diretoria de Meio Ambiente – DIMA",               { x: ML, y: height - 43, size: 8,  font: fontR, color: rgb(0.80, 0.90, 0.84) })
    pg.drawText("Departamento de Unidades de Conservacao – DEUC",  { x: ML, y: height - 55, size: 7,  font: fontR, color: rgb(0.70, 0.84, 0.77) })

    const aapNum = p.aap_numero ?? "—"
    const aapNW  = fontB.widthOfTextAtSize(aapNum, 8)
    pg.drawText(aapNum, { x: width - MR - aapNW, y: height - 18, size: 8, font: fontB, color: C_OURO })

    // Footer
    const baseUrl = Deno.env.get("PUBLIC_URL") ?? "https://siguc-ac.vercel.app"
    const footerLine = `Autentique este documento: ${baseUrl}/verificar/${p.aap_qr_token}   |   Rio Branco - Acre, ${fmtDate(p.aap_emitida_em)}`
    const fw = fontR.widthOfTextAtSize(footerLine, 7)
    pg.drawLine({ start: { x: ML, y: 42 }, end: { x: width - MR, y: 42 }, thickness: 0.5, color: rgb(0.85, 0.85, 0.85) })
    pg.drawText(footerLine, { x: (width - fw) / 2, y: 30, size: 7, font: fontR, color: C_CINZA })

    return { pg, width, height }
  }

  // Página 1
  let { pg: page, width, height } = addPage()
  let y = height - 100

  // helpers locais (rebind a cada página)
  const txt = (text: string, x: number, yy: number, size: number, font = fontR, color = C_PRETO) =>
    page.drawText(String(text ?? "—"), { x, y: yy, size, font, color })

  const txtC = (text: string, yy: number, size: number, font = fontR, color = C_PRETO) => {
    const tw = font.widthOfTextAtSize(String(text), size)
    page.drawText(String(text), { x: (width - tw) / 2, y: yy, size, font, color })
  }

  const txtRange = (text: string, x1: number, x2: number, yy: number, size: number, font = fontR, color = C_PRETO) => {
    const tw = font.widthOfTextAtSize(String(text), size)
    page.drawText(String(text), { x: (x1 + x2) / 2 - tw / 2, y: yy, size, font, color })
  }

  const hline = (yy: number, x1 = ML, x2 = width - MR, thick = 0.5, color = rgb(0.85, 0.85, 0.85)) =>
    page.drawLine({ start: { x: x1, y: yy }, end: { x: x2, y: yy }, thickness: thick, color })

  const W = width - ML - MR

  const sec = (label: string) => {
    page.drawRectangle({ x: ML, y: y - 3, width: W, height: 15, color: C_VERDE })
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
    const half = W / 2
    const lw1  = fontB.widthOfTextAtSize(l1 + ":", 8)
    const lw2  = fontB.widthOfTextAtSize(l2 + ":", 8)
    page.drawText(l1 + ":", { x: ML, y, size: 8, font: fontB, color: C_CINZA })
    page.drawText(trunc(v1, 34), { x: ML + lw1 + 4, y, size: 8, font: fontR, color: C_PRETO })
    page.drawText(l2 + ":", { x: ML + half, y, size: 8, font: fontB, color: C_CINZA })
    page.drawText(trunc(v2, 34), { x: ML + half + lw2 + 4, y, size: 8, font: fontR, color: C_PRETO })
    y -= 13
  }

  // ── TÍTULO ────────────────────────────────────────────────────────────────
  txtC("AUTORIZACAO DE ACESSO E PESQUISA", y, 14, fontB, C_VERDE); y -= 20
  hline(y, ML, width - MR, 1.5, C_OURO); y -= 16

  // ── 1. DADOS DA PESQUISA ──────────────────────────────────────────────────
  sec("1. DADOS DA PESQUISA")
  field1("Processo",    p.numero_processo ?? "Aguardando numero")
  const tituloW = W - fontB.widthOfTextAtSize("Titulo:", 8) - 8
  const tituloLines = wrapText(p.titulo ?? "—", tituloW, fontR, 8)
  const lw = fontB.widthOfTextAtSize("Titulo:", 8)
  page.drawText("Titulo:", { x: ML, y, size: 8, font: fontB, color: C_CINZA })
  for (let i = 0; i < Math.min(tituloLines.length, 3); i++) {
    page.drawText(tituloLines[i], { x: ML + lw + 4, y, size: 8, font: fontR, color: C_PRETO })
    if (i < Math.min(tituloLines.length, 3) - 1) y -= 11
  }
  y -= 13
  field2("Tipo", tipoLabel(p.tipo ?? "—"), "Area (ha)", p.area_pesquisa_ha ? String(p.area_pesquisa_ha) : "—")
  y -= 4

  // ── 2. PESQUISADOR ────────────────────────────────────────────────────────
  sec("2. RESPONSAVEL PELA PESQUISA")
  field1("Nome",        p.pesquisador_nome ?? "—")
  field2("CPF",         p.pesquisador_cpf  ?? "—", "RG",      p.pesquisador_rg         ?? "—")
  field2("Titulacao",   p.pesquisador_titulacao ?? "—", "E-mail", p.pesquisador_email ?? "—")
  field1("Instituicao", p.pesquisador_instituicao ?? "—")
  y -= 4

  // ── 3. EQUIPE AUTORIZADA (condicional) ────────────────────────────────────
  let secCount = 2
  if (equipe.length > 0) {
    secCount++
    sec(`${secCount}. EQUIPE AUTORIZADA`)

    // Cabeçalho da tabela
    const COL = [0, 190, 310, W]  // larguras relativas a ML
    page.drawRectangle({ x: ML, y: y - 2, width: W, height: 13, color: rgb(0.93, 0.97, 0.95) })
    page.drawText("Nome completo",  { x: ML + COL[0] + 3, y, size: 7, font: fontB, color: C_CINZA })
    page.drawText("CPF / RG",       { x: ML + COL[1] + 3, y, size: 7, font: fontB, color: C_CINZA })
    page.drawText("Funcao",         { x: ML + COL[2] + 3, y, size: 7, font: fontB, color: C_CINZA })
    y -= 14

    const maxMembers = Math.min(equipe.length, 10)
    for (let i = 0; i < maxMembers; i++) {
      const m = equipe[i]
      // Fundo alternado
      if (i % 2 === 0) {
        page.drawRectangle({ x: ML, y: y - 2, width: W, height: 12, color: rgb(0.98, 0.99, 0.98) })
      }
      page.drawText(trunc(m.nome_completo, 32),   { x: ML + COL[0] + 3, y, size: 7, font: fontR, color: C_PRETO })
      page.drawText(`${m.cpf ?? "—"}${m.rg ? " / " + m.rg : ""}`, { x: ML + COL[1] + 3, y, size: 7, font: fontR, color: C_PRETO })
      page.drawText(trunc(funcaoLabel(m.funcao), 28), { x: ML + COL[2] + 3, y, size: 7, font: fontR, color: C_PRETO })
      y -= 12

      // Linha divisória leve
      page.drawLine({ start: { x: ML, y }, end: { x: ML + W, y }, thickness: 0.3, color: rgb(0.90, 0.93, 0.90) })
    }

    if (equipe.length > 10) {
      page.drawText(`+ ${equipe.length - 10} membros adicionais cadastrados no sistema.`, { x: ML, y, size: 7, font: fontI, color: C_CINZA })
      y -= 11
    }

    y -= 4
  }

  // ── ÁREA DE ESTUDO ────────────────────────────────────────────────────────
  secCount++
  sec(`${secCount}. AREA DE ESTUDO`)
  field1("Unidade de Conservacao", p.uc?.nome ?? "—")
  y -= 4

  // ── VIGÊNCIA ──────────────────────────────────────────────────────────────
  secCount++
  sec(`${secCount}. VIGENCIA`)
  field2("Inicio previsto",  fmtDate(p.data_inicio_prevista),
         "Termino previsto", fmtDate(p.data_fim_prevista))
  field2("Data de emissao",  fmtDate(p.aap_emitida_em),
         "Valida ate",       fmtDate(p.aap_validade))
  y -= 4

  // ── AUTORIZAÇÕES EXTERNAS (condicional) ───────────────────────────────────
  if (p.sisbio_numero || p.sisgen_numero) {
    secCount++
    sec(`${secCount}. AUTORIZACOES EXTERNAS`)
    if (p.sisbio_numero) field2("SISBIO n.", p.sisbio_numero, "Status", p.sisbio_status === "validado" ? "Validado" : (p.sisbio_status ?? "—"))
    if (p.sisgen_numero) field2("SISGEN n.", p.sisgen_numero, "Status", p.sisgen_status === "validado" ? "Validado" : (p.sisgen_status ?? "—"))
    y -= 4
  }

  // ── CONDICIONANTES ────────────────────────────────────────────────────────
  secCount++
  sec(`${secCount}. CONDICIONANTES`)
  const condTexto = p.aap_condicionantes ??
    "O pesquisador autorizado fica obrigado a: (I) cumprir as condicoes desta autorizacao; " +
    "(II) comunicar a SEMA/AC qualquer alteracao no projeto ou equipe de pesquisa; " +
    "(III) entregar relatorios parciais semestrais e relatorio final ao termino da pesquisa; " +
    "(IV) fornecer copia dos dados coletados ao acervo da Unidade de Conservacao; " +
    "(V) zelar pela integridade dos ecossistemas e nao causar danos durante a execucao."
  const condLines = wrapText(condTexto, W - 10, fontR, 8)
  for (const line of condLines.slice(0, 7)) {
    page.drawText(line, { x: ML + 5, y, size: 8, font: fontR, color: C_PRETO })
    y -= 11
  }
  y -= 8

  // ── DESPACHO E ASSINATURAS ────────────────────────────────────────────────
  // Se y estiver muito baixo, adiciona nova página
  if (y < 160) {
    const nextPg = addPage()
    page = nextPg.pg
    width = nextPg.width
    height = nextPg.height
    y = height - 120
  }

  secCount++
  sec(`${secCount}. DESPACHO E ASSINATURAS`)
  const nomeAutorizador = p.autorizador?.nome_completo ?? "—"
  page.drawText(`Pesquisa autorizada em ${fmtDate(p.aap_assinado_em)} por ${nomeAutorizador}.`, { x: ML, y, size: 8, font: fontI, color: C_CINZA })
  y -= 30

  // Linhas de assinatura
  const SW  = 190
  const SX1 = ML
  const SX2 = width - MR - SW
  page.drawLine({ start: { x: SX1, y }, end: { x: SX1 + SW, y }, thickness: 0.7, color: C_CINZA })
  page.drawLine({ start: { x: SX2, y }, end: { x: SX2 + SW, y }, thickness: 0.7, color: C_CINZA })
  y -= 12

  const nomeDiretor  = diretor?.responsavel_atual_nome ?? "—"
  const cargoDiretor = diretor?.denominacao ?? "Diretor de Meio Ambiente"

  const txtR2 = (text: string, x1: number, x2: number, yy: number, size: number, font = fontR, color = C_PRETO) => {
    const tw = font.widthOfTextAtSize(String(text), size)
    page.drawText(String(text), { x: (x1 + x2) / 2 - tw / 2, y: yy, size, font, color })
  }

  txtR2(nomeDiretor,  SX1, SX1 + SW, y, 8, fontB, C_PRETO)
  txtR2(nomeChefe,    SX2, SX2 + SW, y, 8, fontB, C_PRETO)
  y -= 11
  txtR2(cargoDiretor, SX1, SX1 + SW, y, 7, fontR, C_CINZA)
  txtR2(meuCargo,     SX2, SX2 + SW, y, 7, fontR, C_CINZA)
  y -= 10
  txtR2("DIMA / SEMA-AC",        SX1, SX1 + SW, y, 7, fontR, C_CINZA)
  txtR2("DEUC / DIMA / SEMA-AC", SX2, SX2 + SW, y, 7, fontR, C_CINZA)

  // ── SALVA E ENVIA PARA STORAGE ────────────────────────────────────────────
  const pdfBytes = await pdfDoc.save()
  const safeNum  = (p.aap_numero ?? "sem-numero").replace(/\//g, "-")
  const storagePath = `${pesquisa_id}/AAP_${safeNum}.pdf`

  const { error: upErr } = await svc.storage
    .from("pesquisa-documentos")
    .upload(storagePath, pdfBytes, { contentType: "application/pdf", upsert: true })

  if (upErr) {
    return new Response(JSON.stringify({ error: upErr.message }), { status: 500, headers: CORS })
  }

  // Atualiza aap_pdf_path
  await svc.from("pesquisas").update({ aap_pdf_path: storagePath }).eq("id", pesquisa_id)

  // Retorna URL assinada (1 hora)
  const { data: signed } = await svc.storage
    .from("pesquisa-documentos")
    .createSignedUrl(storagePath, 3600)

  return new Response(
    JSON.stringify({ url: signed?.signedUrl, filename: storagePath }),
    { headers: { ...CORS, "Content-Type": "application/json" } },
  )
})
