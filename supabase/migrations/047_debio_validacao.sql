-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Passo 7 — DEBIO + Validação de Registros de Campo
-- Adiciona Dept. de Biologia, atualiza RLS, cria RPCs de validação
-- ═══════════════════════════════════════════════════════════

-- ── 1. Departamento de Biologia (DEBIO) ──────────────────────
INSERT INTO unidades_organizacionais (sigla, nome, tipo, pai_id)
SELECT 'DEBIO', 'Departamento de Biologia', 'departamento',
       (SELECT id FROM unidades_organizacionais WHERE sigla = 'DIMA')
WHERE NOT EXISTS (SELECT 1 FROM unidades_organizacionais WHERE sigla = 'DEBIO');

-- Cargo de chefe do DEBIO
INSERT INTO cargos (unidade_org_id, denominacao, tipo, nivel, simbolo)
SELECT uo.id, 'Chefe do Departamento de Biologia', 'cargo_comissionado', 'chefe_deuc', 'DAS-2'
FROM unidades_organizacionais uo
WHERE uo.sigla = 'DEBIO'
  AND NOT EXISTS (
    SELECT 1 FROM cargos c WHERE c.unidade_org_id = uo.id
  );

-- ── 2. Biólogo vinculado ao DEBIO pode atualizar registros ───
-- Inclui 'biologo' na política de update do registro_campo
-- (antes só tecnico/gestor/super_admin podiam)
DROP POLICY IF EXISTS "rc_gestor_update" ON registros_campo;

CREATE POLICY "rc_gestor_update" ON registros_campo
  FOR UPDATE TO authenticated USING (
    EXISTS (
      SELECT 1 FROM usuarios u
      WHERE u.id = auth.uid()
        AND u.perfil IN ('tecnico', 'gestor', 'super_admin', 'biologo')
        AND u.ativo
    )
    OR EXISTS (
      SELECT 1 FROM brigadistas chefe
      WHERE chefe.usuario_id = auth.uid()
        AND chefe.funcao     = 'chefe_brigada'
        AND chefe.brigada_id = registros_campo.brigada_id
        AND chefe.status     = 'ativo'
    )
  );

-- ── 3. View de validação (expõe lat/lng e joins úteis) ───────
CREATE OR REPLACE VIEW vw_registros_validacao
WITH (security_invoker = true)
AS
SELECT
  rc.id,
  rc.uuid_cliente,
  rc.natureza,
  rc.atividade,
  rc.equipe,
  rc.status_validacao,
  rc.veredito_campo,
  rc.motivo_rejeicao,
  rc.historico,
  rc.fotos_urls,
  rc.data_hora_evento,
  rc.criado_em,
  rc.sincronizado_em,
  rc.validado_em,
  rc.descricao,
  rc.area_estimada_ha,
  rc.pessoas_alcancadas,
  rc.precisao_gps_m,
  rc.alerta_cigma,
  rc.integrada_cbmac,
  rc.alerta_id,
  rc.ocorrencia_id,
  rc.uc_id,
  rc.brigada_id,
  rc.brigadista_id,
  rc.regional,
  rc.municipio,
  -- Coordenadas extraídas do geometry
  CASE WHEN rc.localizacao IS NOT NULL THEN ST_Y(rc.localizacao) END AS lat,
  CASE WHEN rc.localizacao IS NOT NULL THEN ST_X(rc.localizacao) END AS lng,
  -- Joins
  b.nome_completo       AS brigadista_nome,
  br.nome               AS brigada_nome,
  uc.nome               AS uc_nome,
  uv.nome_completo      AS validado_por_nome,
  -- Contadores de fauna
  COALESCE(f.n_fauna, 0)          AS n_fauna,
  COALESCE(f.n_fauna_pendente, 0) AS n_fauna_pendente
FROM registros_campo rc
LEFT JOIN brigadistas         b  ON b.id  = rc.brigadista_id
LEFT JOIN brigadas            br ON br.id = rc.brigada_id
LEFT JOIN unidades_conservacao uc ON uc.id = rc.uc_id
LEFT JOIN usuarios            uv ON uv.id  = rc.validado_por
LEFT JOIN (
  SELECT
    registro_campo_id,
    COUNT(*)                                         AS n_fauna,
    COUNT(*) FILTER (WHERE NOT identificacao_confirmada) AS n_fauna_pendente
  FROM registro_fauna
  GROUP BY registro_campo_id
) f ON f.registro_campo_id = rc.id;

-- ── 4. RPC: validar_registro_campo ───────────────────────────
-- Atualiza status_validacao + veredito + appenda ao historico
-- SECURITY DEFINER: acessa auth.uid() de forma segura
CREATE OR REPLACE FUNCTION validar_registro_campo(
  p_id       uuid,
  p_status   status_validacao,
  p_motivo   text             DEFAULT NULL,
  p_veredito veredito_campo   DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_perfil text;
  v_nome   text;
BEGIN
  SELECT u.perfil, u.nome_completo
    INTO v_perfil, v_nome
    FROM usuarios u
   WHERE u.id = auth.uid() AND u.ativo;

  IF v_perfil IS NULL THEN
    RAISE EXCEPTION 'Não autorizado — usuário sem perfil ativo';
  END IF;

  IF v_perfil NOT IN ('tecnico', 'gestor', 'super_admin', 'biologo') THEN
    RAISE EXCEPTION 'Perfil "%" não tem permissão para validar registros de campo', v_perfil;
  END IF;

  -- Biólogo pode validar/requer_correcao mas NÃO rejeitar definitivamente
  IF v_perfil = 'biologo' AND p_status = 'rejeitado' THEN
    RAISE EXCEPTION 'Biólogo (DEBIO) pode solicitar correção mas não rejeitar definitivamente. Use perfil gestor/técnico.';
  END IF;

  UPDATE registros_campo
  SET
    status_validacao = p_status,
    validado_por     = auth.uid(),
    validado_em      = now(),
    motivo_rejeicao  = CASE
                         WHEN p_status IN ('rejeitado', 'requer_correcao') THEN p_motivo
                         ELSE motivo_rejeicao
                       END,
    veredito_campo   = COALESCE(p_veredito, veredito_campo),
    historico        = historico || jsonb_build_object(
                         'data',         to_char(now() AT TIME ZONE 'America/Rio_Branco', 'YYYY-MM-DD"T"HH24:MI:SS'),
                         'usuario_id',   auth.uid()::text,
                         'usuario_nome', v_nome,
                         'perfil',       v_perfil,
                         'acao',         p_status::text,
                         'obs',          COALESCE(p_motivo, '')
                       )
  WHERE id = p_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Registro de campo não encontrado (id=%)', p_id;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION validar_registro_campo TO authenticated;

-- ── 5. RPC: confirmar_fauna_especie ──────────────────────────
-- Biólogo (DEBIO) confirma/corrige identificação taxonômica
CREATE OR REPLACE FUNCTION confirmar_fauna_especie(
  p_rf_id           uuid,
  p_especie_id      uuid DEFAULT NULL,
  p_nome_cientifico text DEFAULT NULL,
  p_obs             text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_perfil text;
BEGIN
  SELECT u.perfil INTO v_perfil
    FROM usuarios u WHERE u.id = auth.uid() AND u.ativo;

  IF v_perfil NOT IN ('biologo', 'gestor', 'super_admin') THEN
    RAISE EXCEPTION 'Apenas biólogo (DEBIO), gestor ou super_admin podem confirmar identificações de espécies';
  END IF;

  UPDATE registro_fauna
  SET
    identificacao_confirmada = true,
    identificado_por         = auth.uid(),
    especie_id               = COALESCE(p_especie_id,      especie_id),
    nome_cientifico          = COALESCE(p_nome_cientifico, nome_cientifico),
    observacoes              = COALESCE(p_obs,             observacoes)
  WHERE id = p_rf_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Registro de fauna não encontrado (id=%)', p_rf_id;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION confirmar_fauna_especie TO authenticated;

-- ── 6. RPC: promover_registro_a_ocorrencia ────────────────────
-- Gestor/super_admin: cria ocorrência a partir de um registro de campo
CREATE OR REPLACE FUNCTION promover_registro_a_ocorrencia(
  p_rc_id      uuid,
  p_titulo     text,
  p_severidade severidade_ocorrencia DEFAULT 'media'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_perfil text;
  v_rc     registros_campo%ROWTYPE;
  v_oc_id  uuid;
BEGIN
  SELECT u.perfil INTO v_perfil
    FROM usuarios u WHERE u.id = auth.uid() AND u.ativo;

  IF v_perfil NOT IN ('gestor', 'super_admin', 'tecnico') THEN
    RAISE EXCEPTION 'Apenas gestor, técnico ou super_admin podem promover registros a ocorrências';
  END IF;

  SELECT * INTO v_rc FROM registros_campo WHERE id = p_rc_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Registro de campo não encontrado';
  END IF;

  -- Evita duplicata
  IF v_rc.ocorrencia_id IS NOT NULL THEN
    RETURN v_rc.ocorrencia_id;
  END IF;

  INSERT INTO ocorrencias (
    uc_id, tipo, titulo, severidade, descricao,
    data_ocorrencia, status, criado_por
  )
  VALUES (
    v_rc.uc_id,
    CASE v_rc.natureza::text
      WHEN 'combate' THEN 'incendio'::tipo_ocorrencia
      ELSE 'outro'::tipo_ocorrencia
    END,
    p_titulo,
    p_severidade,
    v_rc.descricao,
    (v_rc.data_hora_evento AT TIME ZONE 'America/Rio_Branco')::date,
    'aberta',
    auth.uid()
  )
  RETURNING id INTO v_oc_id;

  -- Vincula de volta ao registro
  UPDATE registros_campo SET ocorrencia_id = v_oc_id WHERE id = p_rc_id;

  RETURN v_oc_id;
END;
$$;

GRANT EXECUTE ON FUNCTION promover_registro_a_ocorrencia TO authenticated;
