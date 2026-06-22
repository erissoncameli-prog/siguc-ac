import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } })

function gerarSenha(): string {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789"
  return Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => chars[b % chars.length]).join("")
}

async function provisionar(
  admin: ReturnType<typeof createClient>,
  mon: { id: string; nome_completo: string; email: string | null },
  emailParam?: string,
  senhaParam?: string,
) {
  const email = (emailParam || mon.email || "").trim().toLowerCase()
  if (!email) throw new Error("E-mail é obrigatório para criar acesso ao Biomonitor")
  const senha = senhaParam || gerarSenha()

  let userId: string
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password: senha,
    email_confirm: true,
    user_metadata: { nome_completo: mon.nome_completo },
  })

  if (createErr) {
    const jaExiste = createErr.status === 422 || /already.*(registered|exists)/i.test(createErr.message)
    if (!jaExiste) throw createErr
    // Usuário já existe — reutiliza e redefine senha
    const { data: lista } = await admin.auth.admin.listUsers({ perPage: 1000 })
    const existente = lista?.users.find((u) => u.email?.toLowerCase() === email)
    if (!existente) throw new Error(`${email}: já existe no Auth mas não foi encontrado`)
    const { error: updErr } = await admin.auth.admin.updateUserById(existente.id, {
      password: senha,
      email_confirm: true,
    })
    if (updErr) throw updErr
    userId = existente.id
  } else {
    userId = created!.user.id
  }

  const { error: vincErr } = await admin
    .from("monitores_biodiversidade")
    .update({ usuario_id: userId })
    .eq("id", mon.id)
  if (vincErr) throw vincErr

  return { monitor_id: mon.id, usuario_id: userId, nome: mon.nome_completo, email, senha_temp: senha }
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
    if (!["super_admin", "gestor", "tecnico"].includes(caller?.perfil)) return json({ error: "Acesso negado" }, 403)

    const body = await req.json()

    // Modo lote: cria acesso para todos os monitores ativos sem login
    if (body.lote) {
      const { data: pendentes, error: pendErr } = await admin
        .from("monitores_biodiversidade")
        .select("id, nome_completo, email")
        .is("usuario_id", null)
        .eq("status", "ativo")
        .order("nome_completo")
      if (pendErr) throw pendErr
      const resultados: unknown[] = [], erros: unknown[] = []
      for (const mon of pendentes ?? []) {
        try { resultados.push(await provisionar(admin, mon)) }
        catch (e) { erros.push({ nome: mon.nome_completo, erro: (e as Error).message }) }
      }
      return json({ ok: true, resultados, erros })
    }

    // Modo individual
    const { monitor_id, email, senha_temp } = body
    if (!monitor_id) return json({ error: "monitor_id é obrigatório" }, 400)

    const { data: mon, error: monErr } = await admin
      .from("monitores_biodiversidade")
      .select("id, nome_completo, email, usuario_id")
      .eq("id", monitor_id)
      .single()
    if (monErr || !mon) return json({ error: "Monitor não encontrado" }, 404)
    if (mon.usuario_id) return json({ error: "Monitor já possui login no app" }, 409)

    const resultado = await provisionar(admin, mon, email, senha_temp)
    return json({ ok: true, ...resultado })
  } catch (e) {
    return json({ error: (e as Error).message ?? "Erro interno" }, 500)
  }
})
