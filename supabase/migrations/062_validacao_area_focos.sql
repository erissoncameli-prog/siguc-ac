-- 062_validacao_area_focos.sql
-- Validação de área das ocorrências de campo + cruzamento com focos de
-- calor (FIRMS/BDQueimadas). O técnico (sempre online na validação) pode
-- editar a geometria enviada pelo app e validar contra satélite.
-- Aditivo e compatível com registros antigos.

-- ── 1. Geometria/área VALIDADA (preserva o original do brigadista) ──
ALTER TABLE registros_campo
  ADD COLUMN IF NOT EXISTS perimetro_geom_validado geometry(Polygon, 4326),
  ADD COLUMN IF NOT EXISTS area_validada_ha        numeric(10,2);

COMMENT ON COLUMN registros_campo.perimetro_geom_validado IS
  'Polígono corrigido pelo técnico na validação (satélite). Mantém perimetro_geom original do app.';
COMMENT ON COLUMN registros_campo.area_validada_ha IS
  'Área (ha) calculada a partir de perimetro_geom_validado.';

CREATE INDEX IF NOT EXISTS idx_registros_campo_perim_validado
  ON registros_campo USING GIST (perimetro_geom_validado)
  WHERE perimetro_geom_validado IS NOT NULL;

-- ── 2. Metadados extras nos focos (para exibir/filtrar na validação) ──
ALTER TABLE focos_calor
  ADD COLUMN IF NOT EXISTS frp       numeric,   -- Fire Radiative Power (MW)
  ADD COLUMN IF NOT EXISTS confianca text;      -- VIIRS: l/n/h | MODIS: 0-100

-- ── 3. RPC: focos de calor perto de um registro (cruzamento PostGIS) ──
-- Usa a geometria mais confiável disponível (validada > app > ponto) e
-- uma janela de dias em torno da data do evento.
CREATE OR REPLACE FUNCTION focos_proximos_registro(
  p_registro_id uuid,
  p_raio_m      int DEFAULT 1000,
  p_dias        int DEFAULT 10
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_geom   geometry;
  v_evento timestamptz;
  v_result jsonb;
BEGIN
  SELECT COALESCE(perimetro_geom_validado, perimetro_geom, localizacao),
         COALESCE(data_hora_evento, data_inicio::timestamptz, criado_em)
    INTO v_geom, v_evento
    FROM registros_campo
   WHERE id = p_registro_id;

  IF v_geom IS NULL THEN
    RETURN jsonb_build_object('total', 0, 'focos', '[]'::jsonb, 'sem_geom', true);
  END IF;

  SELECT jsonb_build_object(
           'total',  count(*),
           'raio_m', p_raio_m,
           'dias',   p_dias,
           'focos',  COALESCE(jsonb_agg(jsonb_build_object(
                       'lat',      f.lat,
                       'lon',      f.lon,
                       'data',     f.data_hora,
                       'fonte',    f.fonte,
                       'satelite', f.satelite,
                       'frp',      f.frp,
                       'dist_m',   round(ST_Distance(f.geom::geography, v_geom::geography))
                     ) ORDER BY f.data_hora DESC), '[]'::jsonb)
         )
    INTO v_result
    FROM focos_calor f
   WHERE f.data_hora BETWEEN (v_evento - make_interval(days => p_dias))
                         AND (v_evento + make_interval(days => p_dias))
     AND ST_DWithin(f.geom::geography, v_geom::geography, p_raio_m);

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION focos_proximos_registro TO authenticated;

-- ── 4. validar_registro_campo: aceita a geometria validada (p_geom) ──
-- Recria a função preservando as checagens de permissão e o histórico.
-- Dropa a assinatura antiga (4 args) para não criar sobrecarga ambígua.
DROP FUNCTION IF EXISTS validar_registro_campo(uuid, status_validacao, text, veredito_campo);

CREATE OR REPLACE FUNCTION validar_registro_campo(
  p_id       uuid,
  p_status   status_validacao,
  p_motivo   text             DEFAULT NULL,
  p_veredito veredito_campo   DEFAULT NULL,
  p_geom     jsonb            DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_perfil text;
  v_nome   text;
  v_geom   geometry;
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

  IF v_perfil = 'biologo' AND p_status = 'rejeitado' THEN
    RAISE EXCEPTION 'Biólogo (DEBIO) pode solicitar correção mas não rejeitar definitivamente. Use perfil gestor/técnico.';
  END IF;

  IF p_geom IS NOT NULL THEN
    v_geom := ST_SetSRID(ST_GeomFromGeoJSON(p_geom::text), 4326);
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
    perimetro_geom_validado = COALESCE(v_geom, perimetro_geom_validado),
    area_validada_ha = CASE
                         WHEN v_geom IS NOT NULL
                         THEN ROUND((ST_Area(v_geom::geography) / 10000.0)::numeric, 2)
                         ELSE area_validada_ha
                       END,
    historico        = historico || jsonb_build_object(
                         'data',         to_char(now() AT TIME ZONE 'America/Rio_Branco', 'YYYY-MM-DD"T"HH24:MI:SS'),
                         'usuario_id',   auth.uid()::text,
                         'usuario_nome', v_nome,
                         'perfil',       v_perfil,
                         'acao',         p_status::text,
                         'obs',          COALESCE(p_motivo, ''),
                         'geom_editada', (v_geom IS NOT NULL)
                       )
  WHERE id = p_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Registro de campo não encontrado (id=%)', p_id;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION validar_registro_campo TO authenticated;
