-- ════════════════════════════════════════════════════════════════
-- 072 — Incêndio Evitado: polígonos de área protegida pela brigada
-- Desenhados pelo técnico/gestor na tela de Validação de Campo.
-- Cada polígono representa uma área que seria atingida pelo fogo
-- sem a intervenção da brigada — dado estratégico para gestão.
-- ════════════════════════════════════════════════════════════════

-- ── 1. Tabela ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS areas_incendio_evitado (
  id            uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  registro_id   uuid        NOT NULL REFERENCES registros_campo(id) ON DELETE CASCADE,
  geom          geometry(Polygon, 4326) NOT NULL,
  area_ha       decimal(10,4),
  descricao     text,
  criado_por    uuid        REFERENCES auth.users(id),
  criado_em     timestamptz DEFAULT now(),
  atualizado_em timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_aie_registro ON areas_incendio_evitado (registro_id);
CREATE INDEX IF NOT EXISTS idx_aie_geom     ON areas_incendio_evitado USING GIST (geom);

-- ── 2. Trigger atualizado_em ─────────────────────────────────────
CREATE TRIGGER trg_aie_atualizado
  BEFORE UPDATE ON areas_incendio_evitado
  FOR EACH ROW EXECUTE FUNCTION touch_atualizado_em();

-- ── 3. RLS ───────────────────────────────────────────────────────
ALTER TABLE areas_incendio_evitado ENABLE ROW LEVEL SECURITY;

-- Leitura: todos os autenticados
CREATE POLICY "aie_select" ON areas_incendio_evitado
  FOR SELECT TO authenticated USING (true);

-- Escrita: técnico, gestor, super_admin, biologo
CREATE POLICY "aie_insert" ON areas_incendio_evitado
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM usuarios
      WHERE id = auth.uid()
        AND perfil IN ('tecnico','gestor','super_admin','biologo')
    )
  );

CREATE POLICY "aie_update" ON areas_incendio_evitado
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM usuarios
      WHERE id = auth.uid()
        AND perfil IN ('tecnico','gestor','super_admin','biologo')
    )
  );

CREATE POLICY "aie_delete" ON areas_incendio_evitado
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM usuarios
      WHERE id = auth.uid()
        AND perfil IN ('tecnico','gestor','super_admin','biologo')
    )
  );

-- ── 4. RPC listar_areas_evitadas ─────────────────────────────────
CREATE OR REPLACE FUNCTION listar_areas_evitadas(p_registro_id uuid)
RETURNS TABLE (
  id              uuid,
  geom            json,
  area_ha         decimal,
  descricao       text,
  criado_em       timestamptz,
  criado_por_nome text
) LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public AS $$
  SELECT
    a.id,
    ST_AsGeoJSON(a.geom)::json  AS geom,
    a.area_ha,
    a.descricao,
    a.criado_em,
    u.nome_completo             AS criado_por_nome
  FROM areas_incendio_evitado a
  LEFT JOIN usuarios u ON u.id = a.criado_por
  WHERE a.registro_id = p_registro_id
  ORDER BY a.criado_em;
$$;

-- ── 5. RPC salvar_area_evitada ────────────────────────────────────
-- p_id = NULL → INSERT; p_id = uuid → UPDATE
CREATE OR REPLACE FUNCTION salvar_area_evitada(
  p_registro_id uuid,
  p_geom        jsonb,
  p_descricao   text DEFAULT NULL,
  p_id          uuid DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  _perfil  text;
  _geom    geometry;
  _area_ha decimal;
  _ret     uuid;
BEGIN
  SELECT perfil INTO _perfil FROM usuarios WHERE id = auth.uid();
  IF _perfil NOT IN ('tecnico','gestor','super_admin','biologo') THEN
    RAISE EXCEPTION 'Sem permissão para registrar área evitada';
  END IF;

  _geom    := ST_GeomFromGeoJSON(p_geom::text);
  _area_ha := round((ST_Area(_geom::geography) / 10000)::numeric, 4);

  IF p_id IS NULL THEN
    INSERT INTO areas_incendio_evitado (registro_id, geom, area_ha, descricao, criado_por)
    VALUES (p_registro_id, _geom, _area_ha, p_descricao, auth.uid())
    RETURNING id INTO _ret;
  ELSE
    UPDATE areas_incendio_evitado
       SET geom = _geom, area_ha = _area_ha,
           descricao = p_descricao, atualizado_em = now()
     WHERE id = p_id AND registro_id = p_registro_id
    RETURNING id INTO _ret;
  END IF;

  RETURN _ret;
END;
$$;

-- ── 6. RPC excluir_area_evitada ──────────────────────────────────
CREATE OR REPLACE FUNCTION excluir_area_evitada(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  _perfil text;
BEGIN
  SELECT perfil INTO _perfil FROM usuarios WHERE id = auth.uid();
  IF _perfil NOT IN ('tecnico','gestor','super_admin','biologo') THEN
    RAISE EXCEPTION 'Sem permissão';
  END IF;
  DELETE FROM areas_incendio_evitado WHERE id = p_id;
END;
$$;

-- ── 7. Atualizar vw_registros_validacao ──────────────────────────
-- Adiciona n_areas_evitadas e ha_evitados_total vindos da nova tabela.
DROP VIEW IF EXISTS vw_registros_validacao;
CREATE OR REPLACE VIEW vw_registros_validacao AS
SELECT
  rc.id, rc.uuid_cliente, rc.codigo_ocorrencia,
  rc.natureza, rc.atividade,
  rc.equipe, rc.equipe_id, eq.nome AS equipe_nome, rc.duracao_horas,
  rc.hora_inicio, rc.hora_fim,
  rc.origem_acionamento,
  rc.status_validacao, rc.motivo_rejeicao, rc.historico, rc.fotos_urls,
  rc.data_hora_evento, rc.criado_em, rc.sincronizado_em, rc.validado_em,
  rc.descricao, rc.area_estimada_ha, rc.pessoas_alcancadas, rc.precisao_gps_m,
  rc.area_metodo, rc.area_medida_ha, rc.area_validada_ha,
  rc.alerta_cigma, rc.integrada_cbmac, rc.alerta_id, rc.ocorrencia_id,
  rc.uc_id, rc.brigada_id, rc.brigadista_id,
  COALESCE(rc.regional, br.regional, uc.regional) AS regional,
  rc.municipio,
  CASE WHEN rc.localizacao IS NOT NULL THEN ST_Y(rc.localizacao) END AS lat,
  CASE WHEN rc.localizacao IS NOT NULL THEN ST_X(rc.localizacao) END AS lng,
  b.nome_completo  AS brigadista_nome,
  br.nome          AS brigada_nome,
  uc.nome          AS uc_nome,
  uv.nome_completo AS validado_por_nome,
  COALESCE(f.n_fauna,          0) AS n_fauna,
  COALESCE(f.n_fauna_pendente, 0) AS n_fauna_pendente,
  COALESCE(f.n_fauna_resgatada,0) AS n_fauna_resgatada,
  -- Incêndio evitado
  COALESCE(aie.n_areas_evitadas,  0) AS n_areas_evitadas,
  COALESCE(aie.ha_evitados_total, 0) AS ha_evitados_total
FROM registros_campo rc
LEFT JOIN brigadistas          b  ON b.id  = rc.brigadista_id
LEFT JOIN brigadas             br ON br.id = rc.brigada_id
LEFT JOIN equipes_brigada      eq ON eq.id = rc.equipe_id
LEFT JOIN unidades_conservacao uc ON uc.id = rc.uc_id
LEFT JOIN usuarios             uv ON uv.id = rc.validado_por
LEFT JOIN (
  SELECT registro_campo_id,
    COUNT(*)                                                          AS n_fauna,
    COUNT(*) FILTER (WHERE NOT identificacao_confirmada)              AS n_fauna_pendente,
    COALESCE(SUM(quantidade) FILTER (WHERE tipo_evento = 'resgate'), 0) AS n_fauna_resgatada
  FROM registro_fauna
  GROUP BY registro_campo_id
) f ON f.registro_campo_id = rc.id
LEFT JOIN (
  SELECT registro_id,
    COUNT(*)     AS n_areas_evitadas,
    SUM(area_ha) AS ha_evitados_total
  FROM areas_incendio_evitado
  GROUP BY registro_id
) aie ON aie.registro_id = rc.id;
