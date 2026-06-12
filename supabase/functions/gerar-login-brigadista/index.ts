import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } })

// Domínio técnico para brigadistas sem e-mail: o login no app é feito pelo
// CPF, convertido para cpf@DOMINIO_CPF (mesma regra em pages/brigada.html).
// Nenhum e-mail é enviado para esses endereços.
const DOMINIO_CPF = "brigadistas.siguc.local"

// Senha provisória legível, sem caracteres ambíguos (0/O, 1/l/I)
function gerarSenha(): string {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789"
  return Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => chars[b % chars.length]).join("")
}

async function obterIdAuthPorEmail(admin: ReturnType<typeof createClient>, email: string): Promise<string | null> {
  let page = 1
  while (true) {
    const { data: lista, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 })
    if (error) throw error
    const achado = lista.users.find((u) => (u.email || "").toLowerCase() === email)
    if (achado) return achado.id
    if (lista.users.length < 1000) return null
    page++
  }
}

interface Brig { id: string; nome_completo: string; cpf: string | null; email: string | null }

async function provisionar(admin: ReturnType<typeof createClient>, brig: Brig, emailParam?: string | null, senhaParam?: string | null) {
  const cpfDigitos = (brig.cpf || "").replace(/\D/g, "")
  const email = (emailParam || brig.email || "").trim().toLowerCase() ||
    (cpfDigitos.length === 11 ? `${cpfDigitos}@${DOMINIO_CPF}` : "")
  if (!email) throw new Error("sem e-mail e sem CPF válido na ficha")
  const senha = senhaParam || gerarSenha()

  let userId: string
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email, password: senha, email_confirm: true, user_metadata: { nome: brig.nome_completo },
  })

  if (createErr) {
    const jaExiste = createErr.status === 422 || /already.*(registered|exists)/i.test(createErr.message)
    if (!jaExiste) throw createErr

    // E-mail já existe no Auth — adota cadastros órfãos/incompletos, mas
    // nunca uma conta que pertence a outro perfil do sistema
    const idExistente = await obterIdAuthPorEmail(admin, email)
    if (!idExistente) throw new Error(`${email}: já registrado no Auth, mas não encontrado`)

    const { data: contaExistente } = await admin.from("usuarios").select("id, perfil").eq("id", idExistente).maybeSingle()
    if (contaExistente && contaExistente.perfil !== "brigadista") {
      throw new Error(`${email}: já pertence a outro usuário do sistema`)
    }
    const { data: outroBrig } = await admin.from("brigadistas").select("id").eq("usuario_id", idExistente).neq("id", brig.id).maybeSingle()
    if (outroBrig) throw new Error(`${email}: já vinculado a outro brigadista`)

    const { error: updErr } = await admin.auth.admin.updateUserById(idExistente, {
      password: senha, email_confirm: true, user_metadata: { nome: brig.nome_completo },
    })
    if (updErr) throw updErr
    userId = idExistente
  } else {
    userId = created.user.id
  }

  const { error: upsertErr } = await admin.from("usuarios").upsert({
    id: userId, nome_completo: brig.nome_completo, email,
    perfil: "brigadista", ativo: true, deve_trocar_senha: true,
  })
  if (upsertErr) {
    if (!createErr) await admin.auth.admin.deleteUser(userId)
    throw upsertErr
  }

  const { error: vincErr } = await admin.from("brigadistas").update({ usuario_id: userId }).eq("id", brig.id)
  if (vincErr) throw vincErr

  const porCpf = email.endsWith(`@${DOMINIO_CPF}`)
  return {
    brigadista_id: brig.id,
    usuario_id: userId,
    nome: brig.nome_completo,
    login: porCpf ? cpfDigitos : email,
    login_por_cpf: porCpf,
    senha_temp: senha,
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS })

  try {
    const url = Deno.env.get("SUPABASE_URL")!
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!

    const authHeader = req.headers.get("authorization") ?? ""
    if (!authHeader.startsWith("Bearer ")) return json({ error: "Não autenticado" }, 401)

    const admin = createClient(url, serviceKey)
    const { data: { user }, error: authErr } = await admin.auth.getUser(authHeader.replace("Bearer ", ""))
    if (authErr || !user) return json({ error: "Token inválido" }, 401)

    const { data: caller } = await admin.from("usuarios").select("perfil").eq("id", user.id).single()
    if (!["super_admin", "gestor"].includes(caller?.perfil)) return json({ error: "Acesso negado" }, 403)

    const body = await req.json()

    // Modo lote: cria acesso para todos os brigadistas ativos sem login
    if (body.lote) {
      const { data: pendentes, error: pendErr } = await admin
        .from("brigadistas")
        .select("id, nome_completo, cpf, email")
        .is("usuario_id", null)
        .eq("status", "ativo")
        .order("nome_completo")
      if (pendErr) throw pendErr

      const resultados = [], erros = []
      for (const brig of pendentes ?? []) {
        try { resultados.push(await provisionar(admin, brig)) }
        catch (e) { erros.push({ nome: brig.nome_completo, erro: e.message }) }
      }
      return json({ ok: true, resultados, erros })
    }

    // Modo individual
    const { brigadista_id, email, senha_temp } = body
    if (!brigadista_id) return json({ error: "brigadista_id é obrigatório" }, 400)
    if (senha_temp && senha_temp.length < 6) return json({ error: "Senha provisória deve ter no mínimo 6 caracteres" }, 400)

    const { data: brig, error: brigErr } = await admin
      .from("brigadistas")
      .select("id, nome_completo, cpf, email, usuario_id")
      .eq("id", brigadista_id)
      .single()
    if (brigErr || !brig) return json({ error: "Brigadista não encontrado" }, 404)
    if (brig.usuario_id) return json({ error: "Brigadista já possui login" }, 409)

    const resultado = await provisionar(admin, brig, email, senha_temp)
    return json({ ok: true, ...resultado })
  } catch (e) {
    return json({ error: e.message ?? "Erro interno" }, 500)
  }
})
