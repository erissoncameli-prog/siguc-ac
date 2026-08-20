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
    if (!solicitante?.ativo || solicitante.perfil !== "super_admin") {
      return json({ error: "Acesso negado" }, 403)
    }

    const { usuario_id, novo_email } = await req.json()
    const email = (novo_email || "").trim().toLowerCase()
    if (!usuario_id) return json({ error: "usuario_id obrigatório" }, 400)
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return json({ error: "E-mail inválido" }, 400)
    }

    // Corrige nos DOIS lugares: auth.users é quem autentica o login;
    // usuarios.email é a cópia lida pelo resto do sistema (listagem,
    // relatórios, RLS que compara e-mail). Sem os dois, o usuário
    // continuaria logando com o e-mail antigo.
    const { error: authUpdErr } = await admin.auth.admin.updateUserById(usuario_id, {
      email, email_confirm: true,
    })
    if (authUpdErr) {
      const jaExiste = authUpdErr.status === 422 || /already.*registered|already.*exists/i.test(authUpdErr.message)
      return json({ error: jaExiste ? "Já existe uma conta com este e-mail" : authUpdErr.message }, jaExiste ? 409 : 500)
    }

    const { error: dbUpdErr } = await admin.from("usuarios").update({ email }).eq("id", usuario_id)
    if (dbUpdErr) throw dbUpdErr

    return json({ ok: true })
  } catch (e) {
    return json({ error: e.message }, 500)
  }
})
