-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Frota — Web Push (motorista recebe no celular)
-- push_subscriptions: inscrição de push por usuário/aparelho.
-- frota_push_config: só o valor do segredo compartilhado com
-- /api/push-send (inserido fora de migration, nunca vai pro git —
-- ver comando abaixo, executar manualmente após esta migration):
--   INSERT INTO frota_push_config (chave, valor)
--   VALUES ('push_secret', '<mesmo valor de PUSH_TRIGGER_SECRET na Vercel>')
--   ON CONFLICT (chave) DO UPDATE SET valor = EXCLUDED.valor;
-- Toda notificação tipo='frota' dispara envio automático via
-- pg_net para quem tiver inscrição — motorista, chefe do setor
-- ou solicitante, dependendo de quem for o destinatário.
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id    uuid NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  endpoint      text NOT NULL,
  p256dh        text NOT NULL,
  auth_key      text NOT NULL,
  user_agent    text,
  criado_em     timestamptz DEFAULT now(),
  atualizado_em timestamptz DEFAULT now(),
  UNIQUE (usuario_id, endpoint)
);

CREATE INDEX IF NOT EXISTS idx_push_subs_usuario ON push_subscriptions (usuario_id);

ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS push_subs_self ON push_subscriptions;
CREATE POLICY push_subs_self ON push_subscriptions
  FOR ALL USING (usuario_id = auth.uid()) WITH CHECK (usuario_id = auth.uid());

DROP TRIGGER IF EXISTS trg_push_subs_updated ON push_subscriptions;
CREATE TRIGGER trg_push_subs_updated BEFORE UPDATE ON push_subscriptions
  FOR EACH ROW EXECUTE FUNCTION touch_atualizado_em();

-- Config sem policy nenhuma: só função SECURITY DEFINER (bypassa RLS) lê.
CREATE TABLE IF NOT EXISTS frota_push_config (
  chave text PRIMARY KEY,
  valor text
);
ALTER TABLE frota_push_config ENABLE ROW LEVEL SECURITY;

-- ── Dispara o envio a cada notificação de Frota ──────────────
CREATE OR REPLACE FUNCTION frota_push_dispatch()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_secret text;
  v_sub    record;
BEGIN
  IF NEW.tipo <> 'frota' OR NEW.destinatario_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT valor INTO v_secret FROM frota_push_config WHERE chave = 'push_secret';

  FOR v_sub IN SELECT * FROM push_subscriptions WHERE usuario_id = NEW.destinatario_id LOOP
    PERFORM net.http_post(
      url := 'https://siguc-ac.vercel.app/api/push-send',
      body := jsonb_build_object(
        'subscription', jsonb_build_object(
          'endpoint', v_sub.endpoint,
          'keys', jsonb_build_object('p256dh', v_sub.p256dh, 'auth', v_sub.auth_key)
        ),
        'title', NEW.titulo,
        'body', NEW.mensagem,
        'url', '/pages/frota-tarefas.html'
      ),
      headers := jsonb_build_object('Content-Type','application/json','X-Push-Secret', COALESCE(v_secret,'')),
      timeout_milliseconds := 5000
    );
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_frota_push_dispatch ON notificacoes;
CREATE TRIGGER trg_frota_push_dispatch AFTER INSERT ON notificacoes
  FOR EACH ROW EXECUTE FUNCTION frota_push_dispatch();
