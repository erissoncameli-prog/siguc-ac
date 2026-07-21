-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Frota — push abre no APP (deep-link) em vez da página web
--
-- Antes: frota_push_dispatch (164) mandava url fixa
-- '/pages/frota-tarefas.html' (página de mesa) para toda notificação e
-- não levava o tipo. Ao clicar, o service worker abria uma aba web nova
-- — nunca o app já aberto, e caía no login (o app usa sessão isolada).
--
-- Agora: manda a URL do APP com o id da notificação
-- (/pages/frota-app.html?notif=<id>) + o meta (subtipo/para/viagem_id) +
-- o notif id, para o SW focar o app aberto e rotear pelo tipo (o app já
-- sabe rotear em verTarefaFrota/rotearNotifFrota). Só muda o payload do
-- net.http_post — nada de schema.
-- ═══════════════════════════════════════════════════════════

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
        'url', '/pages/frota-app.html?notif=' || NEW.id::text,
        'notif', NEW.id,
        'meta', NEW.meta
      ),
      headers := jsonb_build_object('Content-Type','application/json','X-Push-Secret', COALESCE(v_secret,'')),
      timeout_milliseconds := 5000
    );
  END LOOP;

  RETURN NEW;
END;
$$;
