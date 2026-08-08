-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Biomonitor — Prazo de devolução da cautela + alertas
-- + ocorrências de equipamento
--
-- Fluxo: o monitor escolhe o prazo ao assinar a cautela no app
-- (biomonitor_registrar_cautela ganha p_dias_prazo). A cautela nasce
-- com data_prevista_devolucao mas SEM validado_por — é a mesa quem
-- confirma (RPC biomonitor_validar_cautela), podendo ajustar o prazo
-- nesse momento. `validado_por` vira o "dono" da cautela para fins
-- de alerta: quando o prazo vence, quem valida recebe o aviso, mais
-- todo super_admin (rede de segurança se ninguém validou ainda).
-- Mesmo destinatário se aplica a ocorrência de equipamento — o
-- monitor pode reportar dano/defeito/extravio a qualquer momento,
-- não só na devolução.
--
-- Alerta de vencimento: dois avisos por cautela (3 dias antes +
-- no dia do vencimento), com dedupe por ref no meta da notificação
-- — mesmo molde de frota_checar_vencimentos (migration 205). Roda
-- via pg_cron, resolve sozinho quando a cautela é devolvida.
-- ═══════════════════════════════════════════════════════════

-- ── Prazo e validação na cautela ────────────────────────────────
ALTER TABLE biomonitor_cautelas
  ADD COLUMN data_prevista_devolucao date,
  ADD COLUMN validado_por uuid REFERENCES usuarios(id),
  ADD COLUMN validado_em  timestamptz;

-- Cautelas já existentes (se houver) não têm prazo retroativo —
-- preenche com +15 dias da assinatura como fallback, só para não
-- deixar NULL passar a exigir tratamento especial no resto do código.
UPDATE biomonitor_cautelas SET data_prevista_devolucao = (assinado_em::date + 15)
 WHERE data_prevista_devolucao IS NULL;

ALTER TABLE biomonitor_cautelas ALTER COLUMN data_prevista_devolucao SET NOT NULL;

-- ── Wrapper de notificação do módulo (molde frota_notificar, 162) ──
CREATE OR REPLACE FUNCTION biomonitor_notificar(p_destinatario uuid, p_titulo text, p_mensagem text, p_meta jsonb)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF p_destinatario IS NULL THEN RETURN; END IF;
  INSERT INTO notificacoes (tipo, status, titulo, mensagem, destinatario_id, meta)
  VALUES ('biomonitor', 'gerada', p_titulo, p_mensagem, p_destinatario, p_meta);
END;
$$;

REVOKE ALL ON FUNCTION biomonitor_notificar(uuid, text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION biomonitor_notificar(uuid, text, text, jsonb) TO service_role;

-- ── RPC: monitor assina cautela, agora com prazo ────────────────
-- Substitui a versão da migration 228: adiciona p_dias_prazo
-- (obrigatório, sem default — regra do produto é "toda cautela tem
-- prazo"). Mantém tudo o mais igual (idempotência, trava de grupo).
CREATE OR REPLACE FUNCTION biomonitor_registrar_cautela(
  p_uuid_cliente uuid,
  p_equipamento_ids uuid[],
  p_termo_versao_id uuid,
  p_dias_prazo int,
  p_lat double precision DEFAULT NULL,
  p_lng double precision DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_monitor_id uuid;
  v_grupo_id   uuid;
  v_cautela_id uuid;
  v_eq_id uuid;
BEGIN
  IF p_dias_prazo IS NULL OR p_dias_prazo < 1 THEN
    RAISE EXCEPTION 'Informe o prazo de devolução (em dias)';
  END IF;

  SELECT id, grupo_id INTO v_monitor_id, v_grupo_id FROM monitores_biodiversidade
    WHERE usuario_id = auth.uid() AND status = 'ativo';
  IF v_monitor_id IS NULL THEN
    RAISE EXCEPTION 'Monitor não encontrado ou inativo';
  END IF;

  SELECT id INTO v_cautela_id FROM biomonitor_cautelas WHERE uuid_cliente = p_uuid_cliente;
  IF v_cautela_id IS NOT NULL THEN
    RETURN v_cautela_id;
  END IF;

  IF p_equipamento_ids IS NULL OR array_length(p_equipamento_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'Informe ao menos um equipamento';
  END IF;

  IF EXISTS (
    SELECT 1 FROM biomonitor_equipamentos
    WHERE id = ANY(p_equipamento_ids)
      AND (status <> 'disponivel' OR grupo_id IS DISTINCT FROM v_grupo_id)
  ) THEN
    RAISE EXCEPTION 'Um ou mais equipamentos não estão disponíveis para o seu grupo';
  END IF;

  INSERT INTO biomonitor_cautelas (uuid_cliente, monitor_id, termo_versao_id, lat, lng, data_prevista_devolucao)
  VALUES (p_uuid_cliente, v_monitor_id, p_termo_versao_id, p_lat, p_lng, CURRENT_DATE + p_dias_prazo)
  RETURNING id INTO v_cautela_id;

  FOREACH v_eq_id IN ARRAY p_equipamento_ids LOOP
    INSERT INTO biomonitor_cautela_itens (cautela_id, equipamento_id)
    VALUES (v_cautela_id, v_eq_id);
    UPDATE biomonitor_equipamentos SET status = 'em_cautela' WHERE id = v_eq_id;
  END LOOP;

  INSERT INTO lgpd_aceites (usuario_id, versao_id)
  VALUES (auth.uid(), p_termo_versao_id)
  ON CONFLICT DO NOTHING;

  -- Avisa a gestão que há uma cautela nova pendente de validação
  -- (quem validar vira o "dono" dela para efeito de alerta).
  DECLARE r record;
  BEGIN
    FOR r IN SELECT id FROM usuarios WHERE ativo AND perfil IN ('tecnico','gestor','super_admin') LOOP
      PERFORM biomonitor_notificar(r.id, 'Nova cautela de equipamento pendente de validação',
        format('Cautela assinada, devolução prevista para %s. Confira e valide.',
          to_char(CURRENT_DATE + p_dias_prazo, 'DD/MM/YYYY')),
        jsonb_build_object('modulo','biomonitor','subtipo','cautela_pendente','cautela_id',v_cautela_id));
    END LOOP;
  END;

  RETURN v_cautela_id;
END;
$$;

REVOKE ALL ON FUNCTION biomonitor_registrar_cautela(uuid, uuid[], uuid, int, double precision, double precision) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION biomonitor_registrar_cautela(uuid, uuid[], uuid, int, double precision, double precision) TO authenticated;

-- A assinatura antiga (sem p_dias_prazo) deixa de existir — regra do
-- projeto (178/224): DROP explícito antes, senão o Postgres cria uma
-- função nova em vez de substituir e o cliente antigo em cache de
-- PWA passa a dar "function is not unique".
DROP FUNCTION IF EXISTS biomonitor_registrar_cautela(uuid, uuid[], uuid, double precision, double precision);

-- ── RPC: mesa valida a cautela (pode ajustar o prazo) ───────────
CREATE OR REPLACE FUNCTION biomonitor_validar_cautela(p_cautela_id uuid, p_nova_data_prevista date DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM usuarios WHERE id = auth.uid()
    AND perfil IN ('tecnico','gestor','super_admin') AND ativo) THEN
    RAISE EXCEPTION 'Sem permissão para validar cautela';
  END IF;

  UPDATE biomonitor_cautelas
     SET validado_por = auth.uid(),
         validado_em  = now(),
         data_prevista_devolucao = COALESCE(p_nova_data_prevista, data_prevista_devolucao)
   WHERE id = p_cautela_id;
END;
$$;

REVOKE ALL ON FUNCTION biomonitor_validar_cautela(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION biomonitor_validar_cautela(uuid, date) TO authenticated;

-- ── RPC: devolver equipamento(s) — agora resolve notificações ───
CREATE OR REPLACE FUNCTION biomonitor_devolver_equipamentos(
  p_cautela_id uuid,
  p_equipamento_ids uuid[],
  p_observacao text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_pendentes int;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM usuarios WHERE id = auth.uid()
    AND perfil IN ('tecnico','gestor','super_admin') AND ativo) THEN
    RAISE EXCEPTION 'Sem permissão para devolver equipamento';
  END IF;

  UPDATE biomonitor_cautela_itens
     SET devolvido_em = now(), devolvido_por = auth.uid(), observacao_devolucao = p_observacao
   WHERE cautela_id = p_cautela_id
     AND equipamento_id = ANY(p_equipamento_ids)
     AND devolvido_em IS NULL;

  UPDATE biomonitor_equipamentos SET status = 'disponivel'
   WHERE id = ANY(p_equipamento_ids);

  SELECT count(*) INTO v_pendentes FROM biomonitor_cautela_itens
   WHERE cautela_id = p_cautela_id AND devolvido_em IS NULL;

  UPDATE biomonitor_cautelas
     SET status = CASE WHEN v_pendentes = 0 THEN 'devolvida' ELSE 'parcial' END
   WHERE id = p_cautela_id;

  -- Cautela totalmente devolvida: fecha os avisos de vencimento
  -- pendentes dela (mesmo padrão da trigger de manutenção do Frota,
  -- migration 162 — resolve quando o problema é sanado).
  IF v_pendentes = 0 THEN
    UPDATE notificacoes
       SET status = 'resolvida', resolvido_em = now()
     WHERE tipo = 'biomonitor' AND status <> 'resolvida'
       AND meta->>'subtipo' = 'cautela_vencimento'
       AND meta->>'cautela_id' = p_cautela_id::text;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION biomonitor_devolver_equipamentos(uuid, uuid[], text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION biomonitor_devolver_equipamentos(uuid, uuid[], text) TO authenticated;

-- ── View: cautelas vencendo/vencidas ─────────────────────────────
CREATE OR REPLACE VIEW vw_biomonitor_cautelas_vencendo
WITH (security_invoker = true) AS
SELECT
  c.id, c.monitor_id, c.status, c.data_prevista_devolucao, c.validado_por,
  (c.data_prevista_devolucao - CURRENT_DATE) AS dias_restantes,
  m.usuario_id AS monitor_usuario_id, m.nome_completo AS monitor_nome
FROM biomonitor_cautelas c
JOIN monitores_biodiversidade m ON m.id = c.monitor_id
WHERE c.status IN ('aberta','parcial');

-- ── Verificação diária de prazo vencendo/vencido ────────────────
-- p_dias: antecedência do aviso prévio (padrão 3 — cautela costuma
-- ser prazo curto, diferente do documento de veículo que usa 30).
CREATE OR REPLACE FUNCTION biomonitor_checar_cautelas_vencidas(p_dias int DEFAULT 3)
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  c record;
  g record;
  v_fase text;
  v_ref  text;
  v_tit  text;
  v_msg  text;
  v_criadas int := 0;
BEGIN
  FOR c IN
    SELECT * FROM vw_biomonitor_cautelas_vencendo
     WHERE dias_restantes <= p_dias
     ORDER BY dias_restantes
  LOOP
    v_fase := CASE WHEN c.dias_restantes < 0 THEN 'vencido' ELSE 'proximo' END;
    v_ref  := 'cautela:' || c.id::text || ':' || v_fase;

    IF EXISTS (
      SELECT 1 FROM notificacoes
       WHERE tipo = 'biomonitor' AND status <> 'resolvida'
         AND meta->>'subtipo' = 'cautela_vencimento'
         AND meta->>'ref' = v_ref
    ) THEN
      CONTINUE;
    END IF;

    v_tit := CASE WHEN v_fase = 'vencido' THEN 'Cautela de equipamento vencida' ELSE 'Cautela de equipamento vence em breve' END;
    v_msg := format('%s — devolução prevista %s.', COALESCE(c.monitor_nome, 'Monitor'),
                     to_char(c.data_prevista_devolucao, 'DD/MM/YYYY'));

    -- Monitor responsável.
    PERFORM biomonitor_notificar(c.monitor_usuario_id, v_tit, v_msg,
      jsonb_build_object('modulo','biomonitor','subtipo','cautela_vencimento','ref',v_ref,
        'cautela_id', c.id, 'para','monitor'));
    v_criadas := v_criadas + 1;

    -- Quem validou a cautela é o "dono" para efeito de alerta.
    IF c.validado_por IS NOT NULL THEN
      PERFORM biomonitor_notificar(c.validado_por, v_tit, v_msg,
        jsonb_build_object('modulo','biomonitor','subtipo','cautela_vencimento','ref',v_ref,
          'cautela_id', c.id, 'para','validador'));
      v_criadas := v_criadas + 1;
    END IF;

    -- Rede de segurança: super_admin sempre, mesmo se já validado
    -- por outra pessoa ou se ninguém validou ainda.
    FOR g IN SELECT id FROM usuarios WHERE ativo AND perfil = 'super_admin' AND id IS DISTINCT FROM c.validado_por LOOP
      PERFORM biomonitor_notificar(g.id, v_tit, v_msg,
        jsonb_build_object('modulo','biomonitor','subtipo','cautela_vencimento','ref',v_ref,
          'cautela_id', c.id, 'para','super_admin'));
      v_criadas := v_criadas + 1;
    END LOOP;
  END LOOP;

  RETURN v_criadas;
END;
$$;

REVOKE EXECUTE ON FUNCTION biomonitor_checar_cautelas_vencidas(int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION biomonitor_checar_cautelas_vencidas(int) TO service_role;

SELECT cron.unschedule('biomonitor-cautelas-vencidas')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'biomonitor-cautelas-vencidas');

SELECT cron.schedule('biomonitor-cautelas-vencidas', '15 9 * * *',
  $cron$SELECT biomonitor_checar_cautelas_vencidas();$cron$);

-- ── Ocorrências de equipamento ───────────────────────────────────
CREATE TYPE tipo_biomonitor_ocorrencia_equip AS ENUM ('dano', 'defeito', 'extravio', 'perda', 'outro');
CREATE TYPE status_biomonitor_ocorrencia_equip AS ENUM ('aberta', 'em_analise', 'resolvida');

CREATE TABLE biomonitor_equipamento_ocorrencias (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  uuid_cliente  uuid UNIQUE NOT NULL,
  equipamento_id uuid NOT NULL REFERENCES biomonitor_equipamentos(id),
  cautela_id    uuid REFERENCES biomonitor_cautelas(id),
  monitor_id    uuid NOT NULL REFERENCES monitores_biodiversidade(id),
  tipo          tipo_biomonitor_ocorrencia_equip NOT NULL,
  descricao     text NOT NULL,
  fotos_urls    text[],
  status        status_biomonitor_ocorrencia_equip NOT NULL DEFAULT 'aberta',
  validado_por  uuid REFERENCES usuarios(id),
  validado_em   timestamptz,
  criado_em     timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE biomonitor_equipamento_ocorrencias ENABLE ROW LEVEL SECURITY;

-- Leitura: o próprio monitor que reportou, ou gestão. Sem policy de
-- INSERT/UPDATE — só via RPC (mesmo padrão de frota_comunicados_manutencao).
CREATE POLICY "bioeqocorr_select" ON biomonitor_equipamento_ocorrencias
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM monitores_biodiversidade m
      WHERE m.id = monitor_id AND m.usuario_id = auth.uid())
    OR EXISTS (SELECT 1 FROM usuarios WHERE id = auth.uid()
      AND perfil IN ('tecnico','gestor','super_admin') AND ativo)
  );

-- ── RPC: monitor reporta ocorrência a qualquer momento ──────────
CREATE OR REPLACE FUNCTION biomonitor_reportar_ocorrencia_equipamento(
  p_uuid_cliente uuid,
  p_equipamento_id uuid,
  p_tipo tipo_biomonitor_ocorrencia_equip,
  p_descricao text,
  p_fotos_urls text[] DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_monitor_id uuid;
  v_cautela_id uuid;
  v_ocorrencia_id uuid;
  v_validador uuid;
  g record;
BEGIN
  SELECT id INTO v_monitor_id FROM monitores_biodiversidade
    WHERE usuario_id = auth.uid() AND status = 'ativo';
  IF v_monitor_id IS NULL THEN
    RAISE EXCEPTION 'Monitor não encontrado ou inativo';
  END IF;

  SELECT id INTO v_ocorrencia_id FROM biomonitor_equipamento_ocorrencias WHERE uuid_cliente = p_uuid_cliente;
  IF v_ocorrencia_id IS NOT NULL THEN
    RETURN v_ocorrencia_id;
  END IF;

  -- Cautela aberta desse monitor com esse equipamento, se houver
  -- (a ocorrência pode ser reportada mesmo sem cautela aberta —
  -- ex. equipamento já devolvido, mas o defeito só foi notado depois).
  SELECT ci.cautela_id, c.validado_por INTO v_cautela_id, v_validador
    FROM biomonitor_cautela_itens ci
    JOIN biomonitor_cautelas c ON c.id = ci.cautela_id
   WHERE ci.equipamento_id = p_equipamento_id AND c.monitor_id = v_monitor_id
   ORDER BY ci.entregue_em DESC LIMIT 1;

  INSERT INTO biomonitor_equipamento_ocorrencias
    (uuid_cliente, equipamento_id, cautela_id, monitor_id, tipo, descricao, fotos_urls)
  VALUES (p_uuid_cliente, p_equipamento_id, v_cautela_id, v_monitor_id, p_tipo, p_descricao, p_fotos_urls)
  RETURNING id INTO v_ocorrencia_id;

  -- Mesmo destinatário do alerta de vencimento: quem validou a
  -- cautela relacionada (se houver) + todo super_admin.
  IF v_validador IS NOT NULL THEN
    PERFORM biomonitor_notificar(v_validador, 'Ocorrência em equipamento',
      p_descricao, jsonb_build_object('modulo','biomonitor','subtipo','ocorrencia_equipamento',
        'ocorrencia_id', v_ocorrencia_id, 'equipamento_id', p_equipamento_id, 'para','validador'));
  END IF;
  FOR g IN SELECT id FROM usuarios WHERE ativo AND perfil = 'super_admin' AND id IS DISTINCT FROM v_validador LOOP
    PERFORM biomonitor_notificar(g.id, 'Ocorrência em equipamento',
      p_descricao, jsonb_build_object('modulo','biomonitor','subtipo','ocorrencia_equipamento',
        'ocorrencia_id', v_ocorrencia_id, 'equipamento_id', p_equipamento_id, 'para','super_admin'));
  END LOOP;

  RETURN v_ocorrencia_id;
END;
$$;

REVOKE ALL ON FUNCTION biomonitor_reportar_ocorrencia_equipamento(uuid, uuid, tipo_biomonitor_ocorrencia_equip, text, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION biomonitor_reportar_ocorrencia_equipamento(uuid, uuid, tipo_biomonitor_ocorrencia_equip, text, text[]) TO authenticated;

-- ── RPC: mesa resolve/descarta ocorrência (pode mudar status do bem) ──
CREATE OR REPLACE FUNCTION biomonitor_tratar_ocorrencia_equipamento(
  p_ocorrencia_id uuid,
  p_novo_status status_biomonitor_ocorrencia_equip,
  p_novo_status_equipamento status_biomonitor_equipamento DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_equip_id uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM usuarios WHERE id = auth.uid()
    AND perfil IN ('tecnico','gestor','super_admin') AND ativo) THEN
    RAISE EXCEPTION 'Sem permissão para tratar ocorrência';
  END IF;

  UPDATE biomonitor_equipamento_ocorrencias
     SET status = p_novo_status, validado_por = auth.uid(), validado_em = now()
   WHERE id = p_ocorrencia_id
  RETURNING equipamento_id INTO v_equip_id;

  IF p_novo_status_equipamento IS NOT NULL AND v_equip_id IS NOT NULL THEN
    UPDATE biomonitor_equipamentos SET status = p_novo_status_equipamento WHERE id = v_equip_id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION biomonitor_tratar_ocorrencia_equipamento(uuid, status_biomonitor_ocorrencia_equip, status_biomonitor_equipamento) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION biomonitor_tratar_ocorrencia_equipamento(uuid, status_biomonitor_ocorrencia_equip, status_biomonitor_equipamento) TO authenticated;

CREATE VIEW vw_biomonitor_ocorrencias_equipamento
WITH (security_invoker = true) AS
SELECT
  o.*,
  e.descricao AS equipamento_descricao, e.codigo AS equipamento_codigo,
  m.nome_completo AS monitor_nome
FROM biomonitor_equipamento_ocorrencias o
JOIN biomonitor_equipamentos e ON e.id = o.equipamento_id
JOIN monitores_biodiversidade m ON m.id = o.monitor_id;

-- ── View de detalhe da cautela: inclui prazo/validação ──────────
DROP VIEW IF EXISTS vw_biomonitor_cautelas_detalhe;
CREATE VIEW vw_biomonitor_cautelas_detalhe
WITH (security_invoker = true) AS
SELECT
  c.id, c.uuid_cliente, c.status, c.assinado_em, c.lat, c.lng,
  c.data_prevista_devolucao, c.validado_por, c.validado_em,
  m.id AS monitor_id, m.nome_completo AS monitor_nome,
  dv.versao AS termo_versao,
  (SELECT json_agg(json_build_object(
      'item_id', ci.id,
      'equipamento_id', e.id,
      'codigo', e.codigo,
      'plaqueta', e.plaqueta,
      'descricao', e.descricao,
      'categoria', e.categoria,
      'entregue_em', ci.entregue_em,
      'devolvido_em', ci.devolvido_em
    ) ORDER BY e.descricao)
   FROM biomonitor_cautela_itens ci
   JOIN biomonitor_equipamentos e ON e.id = ci.equipamento_id
   WHERE ci.cautela_id = c.id) AS itens
FROM biomonitor_cautelas c
JOIN monitores_biodiversidade m ON m.id = c.monitor_id
JOIN lgpd_documento_versoes dv ON dv.id = c.termo_versao_id;
