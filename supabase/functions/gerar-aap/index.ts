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
    { fauna: "Fauna", flora: "Flora", genetica: "Genética",
      ecossistema: "Ecossistema", socioambiental: "Socioambiental", outro: "Outro" }[tipo] ?? tipo
  )
}

function wrapText(text: string, maxW: number, font: ReturnType<PDFDocument["embedFont"]> extends Promise<infer F> ? F : never, size: number): string[] {
  const words = text.split(" ")
  const lines: string[] = []
  let current = ""
  for (const word of words) {
    const test = current ? current + " " + word : word
    if ((font as any).widthOfTextAtSize(test, size) > maxW) {
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
    return new Response(JSON.stringify({ error: "Não autorizado" }), { status: 401, headers: CORS })
  }

  // Verifica usuário
  const userSupa = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  )
  const { data: { user }, error: authErr } = await userSupa.auth.getUser()
  if (authErr || !user) {
    return new Response(JSON.stringify({ error: "Não autorizado" }), { status: 401, headers: CORS })
  }

  const svc = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!)

  let body: { pesquisa_id?: string }
  try { body = await req.json() } catch {
    return new Response(JSON.stringify({ error: "Body inválido" }), { status: 400, headers: CORS })
  }
  const { pesquisa_id } = body
  if (!pesquisa_id) {
    return new Response(JSON.stringify({ error: "pesquisa_id obrigatório" }), { status: 400, headers: CORS })
  }

  // Busca dados em paralelo
  const [pesqRes, cargosRes, userRes] = await Promise.all([
    svc.from("pesquisas")
      .select("*, uc:unidades_conservacao(nome), autorizador:usuarios!aap_assinado_por(nome_completo)")
      .eq("id", pesquisa_id)
      .single(),
    svc.from("cargos_atuais")
      .select("nivel, responsavel_atual_id, responsavel_atual_nome, denominacao"),
    svc.from("usuarios").select("nome_completo").eq("id", user.id).single(),
  ])

  if (pesqRes.error || !pesqRes.data) {
    return new Response(JSON.stringify({ error: "Pesquisa não encontrada" }), { status: 404, headers: CORS })
  }

  const p        = pesqRes.data as Record<string, any>
  const cargos   = (cargosRes.data ?? []) as Array<Record<string, string>>
  const emitente = userRes.data?.nome_completo ?? "Chefe DEUC"
  const meuCargo = cargos.find(c => c.responsavel_atual_id === user.id)?.denominacao ?? "Chefe do Departamento de Unidades de Conservação"
  const diretor  = cargos.find(c => c.nivel === "diretor")
  const chefeDEUC = cargos.find(c => c.nivel === "chefe_deuc")
  const nomeChefe = chefeDEUC?.responsavel_atual_nome ?? emitente

  // ── Gera PDF ──────────────────────────────────────────────────────────────
  const pdfDoc = await PDFDocument.create()
  const page   = pdfDoc.addPage([595.28, 841.89]) // A4
  const { width, height } = page.getSize()
  const fontR = await pdfDoc.embedFont(StandardFonts.Helvetica)
  const fontB = await pdfDoc.embedFont(StandardFonts.HelveticaBold)
  const fontI = await pdfDoc.embedFont(StandardFonts.HelveticaOblique)

  const ML = 50
  const MR = 50
  const W  = width - ML - MR
  let y    = height

  // helpers
  const txt = (text: string, x: number, yy: number, size: number, font = fontR, color = C_PRETO) =>
    page.drawText(String(text ?? "—"), { x, y: yy, size, font, color })

  const txtC = (text: string, yy: number, size: number, font = fontR, color = C_PRETO) => {
    const tw = (font as any).widthOfTextAtSize(String(text), size)
    page.drawText(String(text), { x: (width - tw) / 2, y: yy, size, font, color })
  }

  const txtRange = (text: string, x1: number, x2: number, yy: number, size: number, font = fontR, color = C_PRETO) => {
    const tw = (font as any).widthOfTextAtSize(String(text), size)
    page.drawText(String(text), { x: (x1 + x2) / 2 - tw / 2, y: yy, size, font, color })
  }

  const hline = (yy: number, x1 = ML, x2 = width - MR, thick = 0.5, color = rgb(0.85, 0.85, 0.85)) =>
    page.drawLine({ start: { x: x1, y: yy }, end: { x: x2, y: yy }, thickness: thick, color })

  const sec = (label: string) => {
    page.drawRectangle({ x: ML, y: y - 3, width: W, height: 15, color: C_VERDE })
    txt(label, ML + 6, y, 8, fontB, C_BRANCO)
    y -= 22
  }

  const field1 = (label: string, value: string) => {
    const lw = (fontB as any).widthOfTextAtSize(label + ":", 8)
    txt(label + ":", ML, y, 8, fontB, C_CINZA)
    txt(trunc(value), ML + lw + 4, y, 8, fontR, C_PRETO)
    y -= 13
  }

  const field2 = (l1: string, v1: string, l2: string, v2: string) => {
    const half = W / 2
    const lw1  = (fontB as any).widthOfTextAtSize(l1 + ":", 8)
    const lw2  = (fontB as any).widthOfTextAtSize(l2 + ":", 8)
    txt(l1 + ":", ML, y, 8, fontB, C_CINZA)
    txt(trunc(v1, 34), ML + lw1 + 4, y, 8, fontR, C_PRETO)
    txt(l2 + ":", ML + half, y, 8, fontB, C_CINZA)
    txt(trunc(v2, 34), ML + half + lw2 + 4, y, 8, fontR, C_PRETO)
    y -= 13
  }

  // ── CABEÇALHO ─────────────────────────────────────────────────────────────
  page.drawRectangle({ x: 0, y: height - 80, width, height: 80, color: C_VERDE })
  page.drawRectangle({ x: 0, y: height - 84, width, height: 4,  color: C_OURO })

  txt("GOVERNO DO ESTADO DO ACRE",                        ML, height - 18, 9,  fontB, C_BRANCO)
  txt("Secretaria de Estado do Meio Ambiente – SEMA/AC",  ML, height - 31, 8,  fontR, rgb(0.80, 0.90, 0.84))
  txt("Diretoria de Meio Ambiente – DIMA",                ML, height - 43, 8,  fontR, rgb(0.80, 0.90, 0.84))
  txt("Departamento de Unidades de Conservação – DEUC",   ML, height - 55, 7,  fontR, rgb(0.70, 0.84, 0.77))

  // Número AAP no canto superior direito do cabeçalho
  const aapNum = p.aap_numero ?? "—"
  const aapNW  = (fontB as any).widthOfTextAtSize(aapNum, 8)
  txt(aapNum, width - MR - aapNW, height - 18, 8, fontB, C_OURO)

  y = height - 104

  // ── TÍTULO ────────────────────────────────────────────────────────────────
  txtC("AUTORIZAÇÃO DE ACESSO E PESQUISA", y, 14, fontB, C_VERDE); y -= 20
  hline(y, ML, width - MR, 1.5, C_OURO); y -= 16

  // ── 1. DADOS DA PESQUISA ──────────────────────────────────────────────────
  sec("1. DADOS DA PESQUISA")
  field1("Processo",    p.numero_processo ?? "Aguardando número")
  // Título pode ser longo — até 3 linhas
  const tituloW = W - (fontB as any).widthOfTextAtSize("Titulo:", 8) - 8
  const tituloLines = wrapText(p.titulo ?? "—", tituloW, fontR as any, 8)
  const lw = (fontB as any).widthOfTextAtSize("Titulo:", 8)
  txt("Titulo:", ML, y, 8, fontB, C_CINZA)
  for (let i = 0; i < Math.min(tituloLines.length, 3); i++) {
    txt(tituloLines[i], ML + lw + 4, y, 8, fontR, C_PRETO)
    if (i < Math.min(tituloLines.length, 3) - 1) y -= 11
  }
  y -= 13
  field2("Tipo",  tipoLabel(p.tipo ?? "—"), "Area (ha)", p.area_pesquisa_ha ? String(p.area_pesquisa_ha) : "—")
  y -= 4

  // ── 2. PESQUISADOR ────────────────────────────────────────────────────────
  sec("2. RESPONSAVEL PELA PESQUISA")
  field1("Nome",       p.pesquisador_nome ?? "—")
  field2("CPF",        p.pesquisador_cpf  ?? "—", "E-mail", p.pesquisador_email ?? "—")
  field1("Instituicao", p.pesquisador_instituicao ?? "—")
  y -= 4

  // ── 3. ÁREA DE ESTUDO ─────────────────────────────────────────────────────
  sec("3. AREA DE ESTUDO")
  field1("Unidade de Conservacao", p.uc?.nome ?? "—")
  y -= 4

  // ── 4. VIGÊNCIA ───────────────────────────────────────────────────────────
  sec("4. VIGENCIA")
  field2("Inicio previsto",  fmtDate(p.data_inicio_prevista),
         "Termino previsto", fmtDate(p.data_fim_prevista))
  field2("Data de emissao",  fmtDate(p.aap_emitida_em),
         "Valida ate",       fmtDate(p.aap_validade))
  y -= 4

  // ── 5. AUTORIZAÇÕES EXTERNAS (condicional) ────────────────────────────────
  if (p.sisbio_numero || p.sisgen_numero) {
    sec("5. AUTORIZACOES EXTERNAS")
    if (p.sisbio_numero) field2("SISBIO n.", p.sisbio_numero, "Status", p.sisbio_status === "validado" ? "Validado" : (p.sisbio_status ?? "—"))
    if (p.sisgen_numero) field2("SISGEN n.", p.sisgen_numero, "Status", p.sisgen_status === "validado" ? "Validado" : (p.sisgen_status ?? "—"))
    y -= 4
  }

  // ── 6. CONDICIONANTES ────────────────────────────────────────────────────
  const secNum = (p.sisbio_numero || p.sisgen_numero) ? "6" : "5"
  sec(`${secNum}. CONDICIONANTES`)
  const condTexto = p.aap_condicionantes ??
    "O pesquisador autorizado fica obrigado a: (I) cumprir as condicoes desta autorizacao; " +
    "(II) comunicar a SEMA/AC qualquer alteracao no projeto ou equipe de pesquisa; " +
    "(III) entregar relatorios parciais semestrais e relatorio final ao termino da pesquisa; " +
    "(IV) fornecer copia dos dados coletados ao acervo da Unidade de Conservacao; " +
    "(V) zelar pela integridade dos ecossistemas e nao causar danos durante a execucao."
  const condLines = wrapText(condTexto, W - 10, fontR as any, 8)
  for (const line of condLines.slice(0, 7)) {
    txt(line, ML + 5, y, 8, fontR, C_PRETO)
    y -= 11
  }
  y -= 8

  // ── 7. DESPACHO E ASSINATURAS ─────────────────────────────────────────────
  const secNum2 = parseInt(secNum) + 1
  sec(`${secNum2}. DESPACHO E ASSINATURAS`)
  const nomeAutorizador = p.autorizador?.nome_completo ?? "—"
  txt(`Pesquisa autorizada em ${fmtDate(p.aap_assinado_em)} por ${nomeAutorizador}.`, ML, y, 8, fontI, C_CINZA)
  y -= 30

  // Linhas de assinatura
  const SW   = 190
  const SX1  = ML
  const SX2  = width - MR - SW
  hline(y, SX1, SX1 + SW, 0.7, C_CINZA)
  hline(y, SX2, SX2 + SW, 0.7, C_CINZA)
  y -= 12

  const nomeDiretor    = diretor?.responsavel_atual_nome ?? "—"
  const cargoDiretor   = diretor?.denominacao ?? "Diretor de Meio Ambiente"

  txtRange(nomeDiretor,  SX1, SX1 + SW, y, 8, fontB, C_PRETO)
  txtRange(nomeChefe,    SX2, SX2 + SW, y, 8, fontB, C_PRETO)
  y -= 11
  txtRange(cargoDiretor, SX1, SX1 + SW, y, 7, fontR, C_CINZA)
  txtRange(meuCargo,     SX2, SX2 + SW, y, 7, fontR, C_CINZA)
  y -= 10
  txtRange("DIMA / SEMA-AC",         SX1, SX1 + SW, y, 7, fontR, C_CINZA)
  txtRange("DEUC / DIMA / SEMA-AC",  SX2, SX2 + SW, y, 7, fontR, C_CINZA)
  y -= 24

  // ── RODAPÉ ────────────────────────────────────────────────────────────────
  hline(y, ML, width - MR, 0.5)
  y -= 12
  const baseUrl = Deno.env.get("PUBLIC_URL") ?? "https://siguc-ac.vercel.app"
  txtC(`Autentique este documento: ${baseUrl}/verificar/${p.aap_qr_token}`, y, 7, fontR, C_CINZA)
  y -= 10
  txtC(`Token: ${p.aap_qr_token}   |   Rio Branco - Acre, ${fmtDate(p.aap_emitida_em)}`, y, 7, fontR, C_CINZA)

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
