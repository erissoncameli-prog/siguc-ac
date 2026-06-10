-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Auditoria de Brigadistas
-- Sessões com data/hora + log completo de todas as ações
-- ═══════════════════════════════════════════════════════════

-- ── 1. Tabela de sessões ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS brigadista_sessoes (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  brigadista_id   uuid        NOT NULL REFERENCES brigadistas(id) ON DELETE CASCADE,
  usuario_id      uuid        NOT NULL REFERENCES auth.users(id)  ON DELETE CASCADE,
  login_em        timestamptz NOT NULL DEFAULT now(),
  ultimo_ping_em  timestamptz NOT NULL DEFAULT now(),
  logout_em       timestamptz,
  dispositivo     text,
  app_versao      text,
  localizacao     geometry(Point,4326),
  status          text        NOT NULL DEFAULT 'ativa'
                  CHECK (status IN ('ativa','encerrada','expirada')),
  criado_em       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bsess_brigadista ON brigadista_sessoes (brigadista_id);
CREATE INDEX IF NOT EXISTS idx_bsess_status     ON brigadista_sessoes (status);
CREATE INDEX IF NOT EXISTS idx_bsess_login_em   ON brigadista_sessoes (login_em DESC);

-- ── 2. Tabela de log de atividades ───────────────────────────
CREATE TABLE IF NOT EXISTS brigadista_log_atividade (
  id              bigserial   PRIMARY KEY,
  brigadista_id   uuid        NOT NULL REFERENCES brigadistas(id) ON DELETE CASCADE,
  usuario_id      uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  sessao_id       uuid        REFERENCES brigadista_sessoes(id)   ON DELETE SET NULL,
  tipo_acao       text        NOT NULL,
  -- tipos: login | logout | registro_criado | registro_sincronizado |
  --        registro_atualizado | foto_enviada | fauna_adicionada | sync_erro | ping
  referencia_id   uuid,
  referencia_tipo text,       -- 'registro_campo' | 'registro_fauna'
  dados_extra     jsonb,
  localizacao     geometry(Point,4326),
  criado_em       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_blog_brigadista ON brigadista_log_atividade (brigadista_id);
CREATE INDEX IF NOT EXISTS idx_blog_sessao     ON brigadista_log_atividade (sessao_id);
CREATE INDEX IF NOT EXISTS idx_blog_tipo       ON brigadista_log_atividade (tipo_acao);
CREATE INDEX IF NOT EXISTS idx_blog_criado_em  ON brigadista_log_atividade (criado_em DESC);

-- ── 3. RLS ───────────────────────────────────────────────────
ALTER TABLE brigadista_sessoes      ENABLE ROW LEVEL SECURITY;
ALTER TABLE brigadista_log_atividade ENABLE ROW LEVEL SECURITY;

-- Brigadista vê só as próprias sessões; gestores/técnicos veem tudo
CREATE POLICY "bsess_select" ON brigadista_sessoes FOR SELECT TO authenticated USING (
  usuario_id = auth.uid()
  OR EXISTS (SELECT 1 FROM usuarios u WHERE u.id = auth.uid() AND u.perfil IN ('gestor','tecnico','super_admin'))
);
CREATE POLICY "bsess_insert" ON brigadista_sessoes FOR INSERT TO authenticated
  WITH CHECK (usuario_id = auth.uid());
CREATE POLICY "bsess_update" ON brigadista_sessoes FOR UPDATE TO authenticated
  USING (usuario_id = auth.uid());

CREATE POLICY "blog_select" ON brigadista_log_atividade FOR SELECT TO authenticated USING (
  usuario_id = auth.uid()
  OR EXISTS (SELECT 1 FROM usuarios u WHERE u.id = auth.uid() AND u.perfil IN ('gestor','tecnico','super_admin'))
);
CREATE POLICY "blog_insert" ON brigadista_log_atividade FOR INSERT TO authenticated
  WITH CHECK (usuario_id = auth.uid());

-- ── 4. RPC: iniciar sessão ───────────────────────────────────
CREATE OR REPLACE FUNCTION brigadista_iniciar_sessao(
  p_dispositivo text    DEFAULT NULL,
  p_app_versao  text    DEFAULT NULL,
  p_lat         float   DEFAULT NULL,
  p_lng         float   DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_brig_id uuid;
  v_sess_id uuid;
BEGIN
  SELECT id INTO v_brig_id
    FROM brigadistas
   WHERE usuario_id = auth.uid() AND status = 'ativo';

  IF v_brig_id IS NULL THEN
    RAISE EXCEPTION 'Brigadista ativo não encontrado para este usuário';
  END IF;

  -- Expira sessões abertas sem ping há mais de 2h
  UPDATE brigadista_sessoes
     SET status = 'expirada', logout_em = now()
   WHERE brigadista_id = v_brig_id
     AND status = 'ativa'
     AND ultimo_ping_em < now() - interval '2 hours';

  INSERT INTO brigadista_sessoes
    (brigadista_id, usuario_id, dispositivo, app_versao, localizacao)
  VALUES (
    v_brig_id,
    auth.uid(),
    p_dispositivo,
    p_app_versao,
    CASE WHEN p_lat IS NOT NULL AND p_lng IS NOT NULL
         THEN ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)
         ELSE NULL END
  )
  RETURNING id INTO v_sess_id;

  INSERT INTO brigadista_log_atividade
    (brigadista_id, usuario_id, sessao_id, tipo_acao, dados_extra)
  VALUES (
    v_brig_id, auth.uid(), v_sess_id, 'login',
    jsonb_build_object('dispositivo', p_dispositivo, 'app_versao', p_app_versao)
  );

  RETURN v_sess_id;
END;
$$;
GRANT EXECUTE ON FUNCTION brigadista_iniciar_sessao TO authenticated;

-- ── 5. RPC: ping de presença (a cada 5 min) ──────────────────
CREATE OR REPLACE FUNCTION brigadista_ping_sessao(p_sessao_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  UPDATE brigadista_sessoes
     SET ultimo_ping_em = now()
   WHERE id = p_sessao_id
     AND usuario_id = auth.uid()
     AND status = 'ativa';
END;
$$;
GRANT EXECUTE ON FUNCTION brigadista_ping_sessao TO authenticated;

-- ── 6. RPC: encerrar sessão ──────────────────────────────────
CREATE OR REPLACE FUNCTION brigadista_encerrar_sessao(p_sessao_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_brig_id uuid;
BEGIN
  UPDATE brigadista_sessoes
     SET status = 'encerrada', logout_em = now()
   WHERE id = p_sessao_id
     AND usuario_id = auth.uid()
  RETURNING brigadista_id INTO v_brig_id;

  IF v_brig_id IS NOT NULL THEN
    INSERT INTO brigadista_log_atividade
      (brigadista_id, usuario_id, sessao_id, tipo_acao)
    VALUES (v_brig_id, auth.uid(), p_sessao_id, 'logout');
  END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION brigadista_encerrar_sessao TO authenticated;

-- ── 7. Trigger: log automático em registros_campo ────────────
CREATE OR REPLACE FUNCTION trg_log_registro_campo()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_brig_id uuid;
BEGIN
  v_brig_id := COALESCE(NEW.brigadista_id, OLD.brigadista_id);
  IF v_brig_id IS NULL THEN RETURN NEW; END IF;

  INSERT INTO brigadista_log_atividade
    (brigadista_id, usuario_id, tipo_acao, referencia_id, referencia_tipo, dados_extra, localizacao)
  VALUES (
    v_brig_id,
    auth.uid(),
    CASE TG_OP WHEN 'INSERT' THEN 'registro_criado' ELSE 'registro_atualizado' END,
    NEW.id,
    'registro_campo',
    jsonb_build_object(
      'natureza',          NEW.natureza,
      'atividade',         NEW.atividade,
      'status_validacao',  NEW.status_validacao,
      'uuid_cliente',      NEW.uuid_cliente,
      'n_fotos',           COALESCE(array_length(NEW.fotos_urls, 1), 0),
      'brigada_id',        NEW.brigada_id,
      'uc_id',             NEW.uc_id
    ),
    NEW.localizacao
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_rc_log ON registros_campo;
CREATE TRIGGER trg_rc_log
  AFTER INSERT OR UPDATE ON registros_campo
  FOR EACH ROW EXECUTE FUNCTION trg_log_registro_campo();

-- ── 8. Trigger: log automático em registro_fauna ─────────────
CREATE OR REPLACE FUNCTION trg_log_registro_fauna()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_brig_id uuid;
BEGIN
  SELECT brigadista_id INTO v_brig_id
    FROM registros_campo WHERE id = NEW.registro_campo_id;

  IF v_brig_id IS NULL THEN RETURN NEW; END IF;

  INSERT INTO brigadista_log_atividade
    (brigadista_id, usuario_id, tipo_acao, referencia_id, referencia_tipo, dados_extra)
  VALUES (
    v_brig_id,
    auth.uid(),
    'fauna_adicionada',
    NEW.id,
    'registro_fauna',
    jsonb_build_object(
      'nome_popular',        NEW.nome_popular,
      'classe',              NEW.classe,
      'condicao',            NEW.condicao,
      'quantidade',          NEW.quantidade,
      'registro_campo_id',   NEW.registro_campo_id
    )
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_rf_log ON registro_fauna;
CREATE TRIGGER trg_rf_log
  AFTER INSERT ON registro_fauna
  FOR EACH ROW EXECUTE FUNCTION trg_log_registro_fauna();

-- ── 9. View de presença para gestores ────────────────────────
CREATE OR REPLACE VIEW vw_brigadista_presenca
WITH (security_invoker = true) AS
SELECT
  s.id,
  s.brigadista_id,
  b.nome_completo          AS brigadista_nome,
  br.nome                  AS brigada_nome,
  uc.nome                  AS uc_nome,
  s.login_em,
  s.ultimo_ping_em,
  s.logout_em,
  EXTRACT(EPOCH FROM (COALESCE(s.logout_em, s.ultimo_ping_em) - s.login_em))::int / 60
                           AS duracao_min,
  s.dispositivo,
  s.app_versao,
  s.status,
  CASE WHEN s.localizacao IS NOT NULL THEN ST_Y(s.localizacao) END AS lat_login,
  CASE WHEN s.localizacao IS NOT NULL THEN ST_X(s.localizacao) END AS lng_login,
  (SELECT COUNT(*) FROM brigadista_log_atividade l WHERE l.sessao_id = s.id) AS n_acoes,
  (SELECT COUNT(*) FROM brigadista_log_atividade l WHERE l.sessao_id = s.id AND l.tipo_acao = 'registro_criado') AS n_registros
FROM brigadista_sessoes s
JOIN brigadistas b ON b.id = s.brigadista_id
LEFT JOIN brigadas br ON br.id = b.brigada_id
LEFT JOIN unidades_conservacao uc ON uc.id = br.uc_id;
