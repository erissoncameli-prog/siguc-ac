import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } })

// Domínio técnico para motoristas sem e-mail: o login no app é feito pelo
// CPF, convertido para cpf@DOMINIO_CPF. Nenhum e-mail é enviado para esses
// endereços — mesma regra usada para brigadistas (gerar-login-brigadista).
const DOMINIO_CPF = "motoristas.siguc.local"

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

interface Mot { id: string; nome: string; cpf: string | null }

async function provisionar(admin: ReturnType<typeof createClient>, mot: Mot, emailParam?: string | null, senhaParam?: string | null) {
  const cpfDigitos = (mot.cpf || "").replace(/\D/g, "")
  const email = (emailParam || "").trim().toLowerCase() ||
    (cpfDigitos.length === 11 ? `${cpfDigitos}@${DOMINIO_CPF}` : "")
  if (!email) throw new Error("sem e-mail e sem CPF válido na ficha")
  const senha = senhaParam || gerarSenha()

  let userId: string
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email, password: senha, email_confirm: true, user_metadata: { nome: mot.nome },
  })

  if (createErr) {
    const jaExiste = createErr.status === 422 || /already.*(registered|exists)/i.test(createErr.message)
    if (!jaExiste) throw createErr

    // E-mail já existe no Auth — adota cadastros órfãos/incompletos, mas
    // nunca uma conta que já pertence a outra pessoa do sistema
    const idExistente = await obterIdAuthPorEmail(admin, email)
    if (!idExistente) throw new Error(`${email}: já registrado no Auth, mas não encontrado`)

    const { data: outroMot } = await admin.from("frota_motoristas").select("id").eq("usuario_id", idExistente).neq("id", mot.id).maybeSingle()
    if (outroMot) throw new Error(`${email}: já vinculado a outro motorista`)

    const { error: updErr } = await admin.auth.admin.updateUserById(idExistente, {
      password: senha, email_confirm: true, user_metadata: { nome: mot.nome },
    })
    if (updErr) throw updErr
    userId = idExistente
  } else {
    userId = created.user.id
  }

  const { error: upsertErr } = await admin.from("usuarios").upsert({
    id: userId, nome_completo: mot.nome, email,
    perfil: "visualizador", ativo: true, deve_trocar_senha: true,
  })
  if (upsertErr) {
    if (!createErr) await admin.auth.admin.deleteUser(userId)
    throw upsertErr
  }

  const { error: vincErr } = await admin.from("frota_motoristas").update({ usuario_id: userId }).eq("id", mot.id)
  if (vincErr) throw vincErr

  const porCpf = email.endsWith(`@${DOMINIO_CPF}`)
  return {
    motorista_id: mot.id,
    usuario_id: userId,
    nome: mot.nome,
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

    // Usa a mesma permissão fina do módulo Frota (RBAC), não uma lista de
    // perfis fixa — quem tem "editar" em frota pode gerenciar motoristas.
    const { data: nivel } = await admin.rpc("nivel_efetivo", { p_usuario: user.id, p_modulo_chave: "frota" })
    if (nivel !== "editar") return json({ error: "Acesso negado" }, 403)

    const body = await req.json()

    // Modo lote: cria acesso para todos os motoristas ativos sem login
    if (body.lote) {
      const { data: pendentes, error: pendErr } = await admin
        .from("frota_motoristas")
        .select("id, nome, cpf")
        .is("usuario_id", null)
        .eq("status", "ativo")
        .order("nome")
      if (pendErr) throw pendErr

      const resultados = [], erros = []
      for (const mot of pendentes ?? []) {
        try { resultados.push(await provisionar(admin, mot)) }
        catch (e) { erros.push({ nome: mot.nome, erro: e.message }) }
      }
      return json({ ok: true, resultados, erros })
    }

    // Modo individual
    const { motorista_id, email, senha_temp } = body
    if (!motorista_id) return json({ error: "motorista_id é obrigatório" }, 400)
    if (senha_temp && senha_temp.length < 6) return json({ error: "Senha provisória deve ter no mínimo 6 caracteres" }, 400)

    const { data: mot, error: motErr } = await admin
      .from("frota_motoristas")
      .select("id, nome, cpf, usuario_id")
      .eq("id", motorista_id)
      .single()
    if (motErr || !mot) return json({ error: "Motorista não encontrado" }, 404)
    if (mot.usuario_id) return json({ error: "Motorista já possui login" }, 409)

    const resultado = await provisionar(admin, mot, email, senha_temp)
    return json({ ok: true, ...resultado })
  } catch (e) {
    return json({ error: e.message ?? "Erro interno" }, 500)
  }
})
