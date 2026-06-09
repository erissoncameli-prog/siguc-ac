import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

const SENHA_PADRAO = "Sema@2025"

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS })

  try {
    const url = Deno.env.get("SUPABASE_URL")!
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!

    // Verifica que quem chama é super_admin
    const authHeader = req.headers.get("authorization") ?? ""
    const userDb = createClient(url, anonKey, {
      global: { headers: { authorization: authHeader } },
    })
    const { data: { user }, error: authErr } = await userDb.auth.getUser()
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: "Não autenticado" }), { status: 401, headers: { ...CORS, "Content-Type": "application/json" } })
    }
    const { data: perfil } = await userDb.from("usuarios").select("perfil").eq("id", user.id).single()
    if (perfil?.perfil !== "super_admin") {
      return new Response(JSON.stringify({ error: "Acesso negado" }), { status: 403, headers: { ...CORS, "Content-Type": "application/json" } })
    }

    const { usuario_id } = await req.json()
    if (!usuario_id) {
      return new Response(JSON.stringify({ error: "usuario_id obrigatório" }), { status: 400, headers: { ...CORS, "Content-Type": "application/json" } })
    }

    // Redefine senha com service role
    const admin = createClient(url, serviceKey)
    const { error: resetErr } = await admin.auth.admin.updateUserById(usuario_id, {
      password: SENHA_PADRAO,
    })
    if (resetErr) throw resetErr

    // Marca deve_trocar_senha = true
    await admin.from("usuarios").update({ deve_trocar_senha: true }).eq("id", usuario_id)

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...CORS, "Content-Type": "application/json" },
    })
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { ...CORS, "Content-Type": "application/json" },
    })
  }
})
