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
      return new Response(JSON.stringify({ error: "Não autenticado" }), { status: 401, headers: { ...CORS, "Content-Type": "application/json" } })
    }

    // Usa service role para verificar o JWT e buscar perfil
    const admin = createClient(url, serviceKey)
    const { data: { user }, error: authErr } = await admin.auth.getUser(authHeader.replace("Bearer ", ""))
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: "Token inválido" }), { status: 401, headers: { ...CORS, "Content-Type": "application/json" } })
    }

    const { data: perfil } = await admin.from("usuarios").select("perfil").eq("id", user.id).single()
    if (perfil?.perfil !== "super_admin") {
      return new Response(JSON.stringify({ error: "Acesso negado" }), { status: 403, headers: { ...CORS, "Content-Type": "application/json" } })
    }

    const { usuario_id, nova_senha } = await req.json()
    if (!usuario_id) {
      return new Response(JSON.stringify({ error: "usuario_id obrigatório" }), { status: 400, headers: { ...CORS, "Content-Type": "application/json" } })
    }
    if (!nova_senha || nova_senha.length < 8) {
      return new Response(JSON.stringify({ error: "Senha deve ter no mínimo 8 caracteres" }), { status: 400, headers: { ...CORS, "Content-Type": "application/json" } })
    }

    const { error: resetErr } = await admin.auth.admin.updateUserById(usuario_id, { password: nova_senha })
    if (resetErr) throw resetErr

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
