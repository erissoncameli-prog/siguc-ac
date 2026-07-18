// SIGUC-AC · Envia notificação Web Push (App do Motorista — Frota)
// Chamado pelo trigger frota_push_dispatch (pg_net) sempre que nasce
// uma notificação tipo='frota' com destinatário inscrito. Autenticado
// por um segredo compartilhado (nunca pelo cliente) — ver migration
// 164_frota_push_notifications.sql.
//
// Variáveis de ambiente necessárias na Vercel:
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY  — par de chaves do Web Push
//   PUSH_TRIGGER_SECRET                  — mesmo valor gravado em
//                                          frota_push_config('push_secret')
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY — opcional, só para apagar
//                                          inscrições expiradas (404/410)

const webpush = require('web-push');

const VAPID_PUBLIC = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY;
const TRIGGER_SECRET = process.env.PUSH_TRIGGER_SECRET;

if (VAPID_PUBLIC && VAPID_PRIVATE) {
  webpush.setVapidDetails('mailto:contato@sema.ac.gov.br', VAPID_PUBLIC, VAPID_PRIVATE);
}

async function removerInscricaoExpirada(endpoint) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key || !endpoint) return;
  try {
    await fetch(`${url}/rest/v1/push_subscriptions?endpoint=eq.${encodeURIComponent(endpoint)}`, {
      method: 'DELETE',
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    });
  } catch (e) { /* melhor esforço — não bloqueia a resposta */ }
}

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  if (!TRIGGER_SECRET || req.headers['x-push-secret'] !== TRIGGER_SECRET) {
    res.status(401).json({ error: 'Não autorizado' }); return;
  }
  if (!VAPID_PUBLIC || !VAPID_PRIVATE) {
    res.status(503).json({ error: 'Push não configurado (VAPID ausente)' }); return;
  }

  const { subscription, title, body, url } = req.body || {};
  if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
    res.status(400).json({ error: 'subscription inválida' }); return;
  }

  try {
    await webpush.sendNotification(
      subscription,
      JSON.stringify({ title: title || 'SIGUC Frota', body: body || '', url: url || '/pages/frota-tarefas.html' })
    );
    res.status(200).json({ ok: true });
  } catch (e) {
    if (e.statusCode === 404 || e.statusCode === 410) {
      await removerInscricaoExpirada(subscription.endpoint);
      res.status(200).json({ ok: false, removida: true });
      return;
    }
    res.status(502).json({ error: 'Falha ao enviar push' });
  }
};
