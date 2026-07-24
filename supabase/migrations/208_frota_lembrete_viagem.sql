-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Frota — lembrete de viagem (2h/1h/30min antes)
--
-- Motorista e solicitante não tinham nenhum aviso de que a viagem já
-- aprovada estava para começar — só descobriam olhando o app. Esta
-- migration fecha isso reaproveitando a infra de notificações/push já
-- existente (162/164/191/205/207):
--   1. frota_notif_preferencias: opt-out por usuário, só para esse
--      tipo de aviso (aprovação/recusa/outros continuam chegando
--      mesmo com o lembrete desligado — controlado no Config do app).
--   2. frota_checar_lembretes_viagem(): pg_cron de 5 em 5 min (só essa
--      granularidade cobre a janela de 30 min sem furo), notifica
--      motorista e solicitante de toda viagem 'aprovada' entrando nas
--      janelas de 120/60/30 min antes de data_saida_prevista.
--   3. Dedupe por ref (mesmo padrão da 205/207): 'lembrete:<viagem_id>:
--      <minutos>:<destinatario>' — nunca repete a mesma janela para a
--      mesma pessoa.
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS frota_notif_preferencias (
  usuario_id             uuid PRIMARY KEY REFERENCES usuarios(id) ON DELETE CASCADE,
  lembrete_viagem_ativo  boolean NOT NULL DEFAULT true,
  atualizado_em          timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE frota_notif_preferencias ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS frota_notif_pref_self ON frota_notif_preferencias;
CREATE POLICY frota_notif_pref_self ON frota_notif_preferencias
  FOR ALL USING (usuario_id = auth.uid()) WITH CHECK (usuario_id = auth.uid());

DROP TRIGGER IF EXISTS trg_frota_notif_pref_updated ON frota_notif_preferencias;
CREATE TRIGGER trg_frota_notif_pref_updated BEFORE UPDATE ON frota_notif_preferencias
  FOR EACH ROW EXECUTE FUNCTION touch_atualizado_em();


-- ── Verificação periódica → lembrete ─────────────────────────────
-- SECURITY DEFINER porque o cron não tem sessão de usuário.
-- Janela [N min, N min + 5min) a partir de agora: como o cron roda a
-- cada 5 min, cada viagem passa exatamente uma vez por cada uma das
-- 3 janelas (120/60/30), sem sobreposição e sem furo.
CREATE OR REPLACE FUNCTION frota_checar_lembretes_viagem()
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_janela  int;
  v         record;
  v_ref     text;
  v_msg     text;
  v_ativo   boolean;
  v_criadas int := 0;
BEGIN
  FOREACH v_janela IN ARRAY ARRAY[120, 60, 30]
  LOOP
    FOR v IN
      SELECT fv.id, fv.destino, fv.data_saida_prevista, fv.solicitante_id,
             fm.usuario_id AS motorista_usuario_id
        FROM frota_viagens fv
        LEFT JOIN frota_motoristas fm ON fm.id = fv.motorista_id
       WHERE fv.status = 'aprovada'
         AND fv.data_saida_prevista >= now() + make_interval(mins => v_janela)
         AND fv.data_saida_prevista <  now() + make_interval(mins => v_janela + 5)
    LOOP
      v_msg := format('Viagem para %s sai em %s — %s.',
        v.destino,
        CASE WHEN v_janela >= 60 THEN (v_janela / 60) || 'h' ELSE v_janela || ' min' END,
        to_char(v.data_saida_prevista, 'DD/MM HH24:MI'));

      -- Motorista
      IF v.motorista_usuario_id IS NOT NULL THEN
        v_ref := 'lembrete:' || v.id::text || ':' || v_janela::text || ':mot';
        SELECT lembrete_viagem_ativo INTO v_ativo FROM frota_notif_preferencias WHERE usuario_id = v.motorista_usuario_id;
        IF COALESCE(v_ativo, true) AND NOT EXISTS (
          SELECT 1 FROM notificacoes WHERE tipo = 'frota' AND meta->>'ref' = v_ref
        ) THEN
          PERFORM frota_notificar(v.motorista_usuario_id, 'Sua viagem está chegando', v_msg,
            jsonb_build_object('modulo','frota','subtipo','lembrete_viagem','ref',v_ref,
              'viagem_id',v.id,'minutos_antes',v_janela,'para','motorista'));
          v_criadas := v_criadas + 1;
        END IF;
      END IF;

      -- Solicitante
      IF v.solicitante_id IS NOT NULL THEN
        v_ref := 'lembrete:' || v.id::text || ':' || v_janela::text || ':sol';
        SELECT lembrete_viagem_ativo INTO v_ativo FROM frota_notif_preferencias WHERE usuario_id = v.solicitante_id;
        IF COALESCE(v_ativo, true) AND NOT EXISTS (
          SELECT 1 FROM notificacoes WHERE tipo = 'frota' AND meta->>'ref' = v_ref
        ) THEN
          PERFORM frota_notificar(v.solicitante_id, 'Sua viagem está chegando', v_msg,
            jsonb_build_object('modulo','frota','subtipo','lembrete_viagem','ref',v_ref,
              'viagem_id',v.id,'minutos_antes',v_janela,'para','solicitante'));
          v_criadas := v_criadas + 1;
        END IF;
      END IF;
    END LOOP;
  END LOOP;

  RETURN v_criadas;
END;
$$;

REVOKE EXECUTE ON FUNCTION frota_checar_lembretes_viagem() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION frota_checar_lembretes_viagem() TO service_role;

SELECT cron.unschedule('frota-lembretes-viagem')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'frota-lembretes-viagem');

SELECT cron.schedule('frota-lembretes-viagem', '*/5 * * * *',
  $cron$SELECT frota_checar_lembretes_viagem();$cron$);
