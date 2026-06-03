-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Auditoria de Acessos
-- Monitoramento de login/logout com bloqueio por tentativas
-- ═══════════════════════════════════════════════════════════

-- Colunas adicionais em usuarios
ALTER TABLE usuarios
  ADD COLUMN IF NOT EXISTS tentativas_falha integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS bloqueado_ate     timestamptz,
  ADD COLUMN IF NOT EXISTS ultimo_login      timestamptz;

-- ── Tabela de auditoria ──────────────────────────────────────

CREATE TABLE IF NOT EXISTS auditoria_acessos (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id   uuid        REFERENCES usuarios(id) ON DELETE SET NULL,
  email        text        NOT NULL,
  tipo_evento  text        NOT NULL CHECK (tipo_evento IN ('login','logout','falha_login','sessao_expirada')),
  sucesso      boolean     NOT NULL,
  motivo_falha text,
  ip_address   text,
  user_agent   text,
  created_at   timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_auditoria_usuario ON auditoria_acessos (usuario_id);
CREATE INDEX IF NOT EXISTS idx_auditoria_created ON auditoria_acessos (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_auditoria_email   ON auditoria_acessos (email);

ALTER TABLE auditoria_acessos ENABLE ROW LEVEL SECURITY;

-- super_admin e gestor veem todos os registros
CREATE POLICY "auditoria_admin_select" ON auditoria_acessos
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM usuarios u
      WHERE u.id = auth.uid()
        AND u.perfil IN ('super_admin','gestor')
        AND u.ativo
    )
  );

-- Cada usuário vê apenas os próprios registros
CREATE POLICY "auditoria_self_select" ON auditoria_acessos
  FOR SELECT USING (usuario_id = auth.uid());

-- ── Função: verificar bloqueio (anon, antes do login) ────────

CREATE OR REPLACE FUNCTION verificar_bloqueio(p_email text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_bloqueado_ate timestamptz;
  v_ativo         boolean;
BEGIN
  SELECT bloqueado_ate, ativo
  INTO   v_bloqueado_ate, v_ativo
  FROM   usuarios
  WHERE  lower(email) = lower(p_email);

  IF NOT FOUND THEN
    RETURN jsonb_build_object('bloqueado', false);
  END IF;

  IF NOT v_ativo THEN
    -- Conta inativa; não revelamos detalhes
    RETURN jsonb_build_object('bloqueado', false, 'inativo', true);
  END IF;

  IF v_bloqueado_ate IS NOT NULL AND v_bloqueado_ate > now() THEN
    RETURN jsonb_build_object('bloqueado', true, 'ate', v_bloqueado_ate);
  END IF;

  RETURN jsonb_build_object('bloqueado', false);
END;
$$;

-- ── Função: registrar tentativa e atualizar contadores ───────

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
               bloqueado_ate    = now() + interval '30 minutes'
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

-- ── Função: limpeza de registros com mais de 1 ano ───────────

CREATE OR REPLACE FUNCTION limpar_auditoria_antiga() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  DELETE FROM auditoria_acessos WHERE created_at < now() - interval '1 year';
END;
$$;
