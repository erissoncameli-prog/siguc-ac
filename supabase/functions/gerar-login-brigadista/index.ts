import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS })

  try {
    const url = Deno.env.get("SUPABASE_URL")!
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!

    const authHeader = req.headers.get("authorization") ?? ""
    if (!authHeader.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Não autenticado" }), {
        status: 401, headers: { ...CORS, "Content-Type": "application/json" },
      })
    }

    const admin = createClient(url, serviceKey)
    const { data: { user }, error: authErr } = await admin.auth.getUser(authHeader.replace("Bearer ", ""))
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: "Token inválido" }), {
        status: 401, headers: { ...CORS, "Content-Type": "application/json" },
      })
    }

    const { data: caller } = await admin.from("usuarios").select("perfil").eq("id", user.id).single()
    if (!["super_admin", "gestor"].includes(caller?.perfil)) {
      return new Response(JSON.stringify({ error: "Acesso negado" }), {
        status: 403, headers: { ...CORS, "Content-Type": "application/json" },
      })
    }

    const { brigadista_id, email, senha_temp } = await req.json()
    if (!brigadista_id || !email || !senha_temp) {
      return new Response(JSON.stringify({ error: "brigadista_id, email e senha_temp são obrigatórios" }), {
        status: 400, headers: { ...CORS, "Content-Type": "application/json" },
      })
    }
    if (senha_temp.length < 6) {
      return new Response(JSON.stringify({ error: "Senha provisória deve ter no mínimo 6 caracteres" }), {
        status: 400, headers: { ...CORS, "Content-Type": "application/json" },
      })
    }

    // Busca o brigadista para validar e obter dados
    const { data: brig, error: brigErr } = await admin
      .from("brigadistas")
      .select("id, nome_completo, usuario_id, brigada_id")
      .eq("id", brigadista_id)
      .single()

    if (brigErr || !brig) {
      return new Response(JSON.stringify({ error: "Brigadista não encontrado" }), {
        status: 404, headers: { ...CORS, "Content-Type": "application/json" },
      })
    }
    if (brig.usuario_id) {
      return new Response(JSON.stringify({ error: "Brigadista já possui login" }), {
        status: 409, headers: { ...CORS, "Content-Type": "application/json" },
      })
    }

    // Cria o usuário no Auth
    const { data: newUser, error: createErr } = await admin.auth.admin.createUser({
      email,
      password: senha_temp,
      email_confirm: true,
    })
    if (createErr || !newUser.user) throw createErr ?? new Error("Falha ao criar usuário")

    const novoId = newUser.user.id

    // Insere em usuarios com perfil brigadista
    const { error: insErr } = await admin.from("usuarios").insert({
      id: novoId,
      nome_completo: brig.nome_completo,
      email,
      perfil: "brigadista",
      ativo: true,
      deve_trocar_senha: true,
    })
    if (insErr) {
      // Reverte: remove o auth user criado
      await admin.auth.admin.deleteUser(novoId)
      throw insErr
    }

    // Vincula brigadista ao usuário recém-criado
    const { error: updErr } = await admin
      .from("brigadistas")
      .update({ usuario_id: novoId })
      .eq("id", brigadista_id)
    if (updErr) throw updErr

    return new Response(JSON.stringify({ ok: true, usuario_id: novoId }), {
      headers: { ...CORS, "Content-Type": "application/json" },
    })
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message ?? "Erro interno" }), {
      status: 500, headers: { ...CORS, "Content-Type": "application/json" },
    })
  }
})
