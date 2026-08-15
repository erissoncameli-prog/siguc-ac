import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } })

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS })

  try {
    const url = Deno.env.get("SUPABASE_URL")!
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!

    const authHeader = req.headers.get("authorization") ?? ""
    if (!authHeader.startsWith("Bearer ")) return json({ error: "Não autenticado" }, 401)

    // Usa service role para verificar o JWT e buscar perfil
    const admin = createClient(url, serviceKey)
    const { data: { user }, error: authErr } = await admin.auth.getUser(authHeader.replace("Bearer ", ""))
    if (authErr || !user) return json({ error: "Token inválido" }, 401)

    const { data: solicitante } = await admin.from("usuarios").select("perfil, ativo").eq("id", user.id).single()
    if (!solicitante?.ativo || !["super_admin", "gestor"].includes(solicitante.perfil)) {
      return json({ error: "Acesso negado" }, 403)
    }

    const body = await req.json()
    const email = (body.email || "").trim().toLowerCase()
    const senha = body.senha || ""
    const nome_completo = (body.nome_completo || "").trim()
    if (!email || !nome_completo) return json({ error: "Nome e e-mail são obrigatórios" }, 400)
    if (!senha || senha.length < 8) return json({ error: "Senha deve ter no mínimo 8 caracteres" }, 400)

    // Cria o usuário no Auth sem afetar a sessão do admin
    let userId: string | null = null
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email, password: senha, email_confirm: true, user_metadata: { nome: nome_completo },
    })

    if (createErr) {
      // E-mail já existe no Auth: pode ser cadastro órfão (signUp antigo sem
      // registro em usuarios) — nesse caso adota o usuário e completa o cadastro
      const jaExiste = createErr.status === 422 || /already.*registered|already.*exists/i.test(createErr.message)
      if (!jaExiste) throw createErr

      let page = 1
      while (!userId) {
        const { data: lista, error: listErr } = await admin.auth.admin.listUsers({ page, perPage: 1000 })
        if (listErr) throw listErr
        userId = lista.users.find((u) => (u.email || "").toLowerCase() === email)?.id ?? null
        if (lista.users.length < 1000) break
        page++
      }
      if (!userId) return json({ error: "E-mail já registrado no Auth, mas usuário não encontrado" }, 409)

      const { count } = await admin.from("usuarios").select("id", { count: "exact", head: true }).eq("id", userId)
      if (count && count > 0) return json({ error: "Já existe um usuário cadastrado com este e-mail" }, 409)

      const { error: updErr } = await admin.auth.admin.updateUserById(userId, {
        password: senha, email_confirm: true, user_metadata: { nome: nome_completo },
      })
      if (updErr) throw updErr
    } else {
      userId = created.user.id
    }

    const { error: dbErr } = await admin.from("usuarios").upsert({
      id: userId, email, nome_completo,
      perfil: body.perfil || "visualizador",
      uc_id: body.uc_id || null,
      cargo: body.cargo || null,
      telefone: body.telefone || null,
      deve_trocar_senha: true, ativo: true,
    })
    if (dbErr) throw dbErr

    // Lotação inicial (opcional) — frente "vínculos no cadastro" de
    // docs/acesso-por-organograma.md. Decisão do usuário: quem já pode
    // criar a identidade inteira da pessoa (perfil/UC/cargo-texto) também
    // pode lotá-la, mesmo sendo `gestor` — por isso isto roda aqui, com
    // service_role, em vez de um INSERT client-side em usuario_lotacoes
    // (cuja RLS restringe a super_admin/diretor). Melhor esforço: se
    // falhar, a criação do usuário NÃO é desfeita — o admin lota depois
    // pela aba Lotações.
    let lotacao_aviso: string | null = null
    if (body.unidade_org_id) {
      const { error: lotErr } = await admin.from("usuario_lotacoes").insert({
        usuario_id: userId,
        unidade_org_id: body.unidade_org_id,
        principal: true,
        criado_por: user.id,
      })
      if (lotErr) lotacao_aviso = `Usuário criado, mas a lotação inicial falhou: ${lotErr.message}`
    }

    return json({ ok: true, id: userId, aviso: lotacao_aviso })
  } catch (e) {
    return json({ error: e.message }, 500)
  }
})
