-- 247_lockout_janela_10min.sql
-- ─────────────────────────────────────────────────────────────
-- ACHADO DE SEGURANÇA (pentest #4 — lockout como arma de DoS):
-- `registrar_tentativa_acesso` bloqueava a conta por 30 min após 5
-- falhas. Como o bloqueio é por E-MAIL, um atacante que conheça o
-- e-mail de um gestor consegue trancá-lo repetidamente só errando a
-- senha 5x (DoS dirigido de disponibilidade).
--
-- Decisão do dono (opção A): reduzir a janela de 30 → 10 min. Diminui o
-- impacto do DoS dirigido (vítima real recupera rápido) mantendo freio
-- ao brute-force — que, além disso, já tem o rate-limit próprio do
-- Supabase Auth por trás. Mudança pontual e reversível: só o intervalo.
--
-- Recriação fiel da função da migration 002, trocando apenas
-- '30 minutes' por '10 minutes'.
-- ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION registrar_tentativa_acesso(
  p_email        text,
  p_sucesso      boolean,
  p_ip           text    DEFAULT NULL,
  p_user_agent   text    DEFAULT NULL,
  p_motivo_falha text    DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_user_id    uuid;
  v_tentativas integer;
BEGIN
  SELECT id, tentativas_falha
  INTO   v_user_id, v_tentativas
  FROM   usuarios
  WHERE  lower(email) = lower(p_email);

  IF p_sucesso THEN
    IF v_user_id IS NOT NULL THEN
      UPDATE usuarios
         SET tentativas_falha = 0,
             bloqueado_ate    = NULL,
             ultimo_login     = now()
       WHERE id = v_user_id;
    END IF;

    INSERT INTO auditoria_acessos (usuario_id, email, tipo_evento, sucesso, ip_address, user_agent)
    VALUES (v_user_id, p_email, 'login', true, p_ip, p_user_agent);

    RETURN jsonb_build_object('ok', true);

  ELSE
    IF v_user_id IS NOT NULL THEN
      v_tentativas := COALESCE(v_tentativas, 0) + 1;
      IF v_tentativas >= 5 THEN
        UPDATE usuarios
           SET tentativas_falha = v_tentativas,
               bloqueado_ate    = now() + interval '10 minutes'
         WHERE id = v_user_id;
      ELSE
        UPDATE usuarios
           SET tentativas_falha = v_tentativas
         WHERE id = v_user_id;
      END IF;
    END IF;

    INSERT INTO auditoria_acessos (usuario_id, email, tipo_evento, sucesso, motivo_falha, ip_address, user_agent)
    VALUES (v_user_id, p_email, 'falha_login', false, p_motivo_falha, p_ip, p_user_agent);

    RETURN jsonb_build_object('ok', true, 'tentativas', COALESCE(v_tentativas, 0));
  END IF;
END;
$$;
