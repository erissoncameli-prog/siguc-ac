-- ── 077: temperatura, umidade e profundidade em ninhos_quelonios ──
-- Campos de condições do ninho registradas no momento do encontro.

ALTER TABLE ninhos_quelonios
  ADD COLUMN IF NOT EXISTS temperatura_c   numeric(4,1) CHECK (temperatura_c BETWEEN 0 AND 60),
  ADD COLUMN IF NOT EXISTS umidade_pct     numeric(4,1) CHECK (umidade_pct BETWEEN 0 AND 100),
  ADD COLUMN IF NOT EXISTS profundidade_cm numeric(5,1) CHECK (profundidade_cm >= 0);

-- ── Atualiza vw_ninhos_validacao ─────────────────────────────────
DROP VIEW IF EXISTS vw_ninhos_validacao;

CREATE VIEW vw_ninhos_validacao
WITH (security_invoker = true)
AS
SELECT
  n.id,
  n.uuid_cliente,
  n.numero_ninho,
  n.especie,
  n.data_encontro,
  n.status,
  n.status_validacao,
  n.motivo_rejeicao,
  n.observacoes,
  n.foto_urls,
  n.criado_em,
  n.sincronizado_em,
  CASE WHEN n.localizacao IS NOT NULL THEN ST_Y(n.localizacao) END AS lat,
  CASE WHEN n.localizacao IS NOT NULL THEN ST_X(n.localizacao) END AS lng,
  n.precisao_gps_m,
  -- Ovos e distância
  n.qtd_ovos                   AS ninho_qtd_ovos,
  n.ovos_integros,
  n.ovos_descartados,
  n.dist_rio_m,
  n.dist_rio_metodo,
  -- Condições do ninho
  n.temperatura_c,
  n.umidade_pct,
  n.profundidade_cm,
  -- Dados relacionais
  p.id          AS praia_id,
  p.nome        AS praia_nome,
  p.codigo      AS praia_codigo,
  uc.nome       AS uc_nome,
  mon.id        AS monitor_id,
  mon.nome_completo AS monitor_nome,
  g.nome        AS grupo_nome,
  g.id          AS grupo_id,
  -- Transferência (última)
  t.data_transferencia,
  t.qtd_ovos    AS transf_qtd_ovos,
  t.local_destino,
  -- Eclosão
  e.data_nascimento,
  e.filhotes_vivos,
  e.filhotes_mortos,
  e.ovos_nao_nascidos,
  e.predacao
FROM ninhos_quelonios n
LEFT JOIN praias_monitoramento p       ON p.id = n.praia_id
LEFT JOIN unidades_conservacao uc      ON uc.id = n.uc_id
LEFT JOIN monitores_biodiversidade mon ON mon.id = n.monitor_id
LEFT JOIN grupos_biomonitor g          ON g.id = n.grupo_id
LEFT JOIN LATERAL (
  SELECT data_transferencia, qtd_ovos, local_destino
  FROM transferencias_ninho
  WHERE ninho_id = n.id
  ORDER BY data_transferencia DESC
  LIMIT 1
) t ON true
LEFT JOIN LATERAL (
  SELECT data_nascimento, filhotes_vivos, filhotes_mortos, ovos_nao_nascidos, predacao
  FROM eclosoes_ninho
  WHERE ninho_id = n.id
  ORDER BY data_nascimento DESC
  LIMIT 1
) e ON true;

-- ── Atualiza bio_meus_dados com médias de condições ──────────────
CREATE OR REPLACE FUNCTION bio_meus_dados(
  p_temporada_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_mon_id   uuid;
  v_grupo_id uuid;
  v_result   jsonb;
BEGIN
  SELECT id, grupo_id INTO v_mon_id, v_grupo_id
    FROM monitores_biodiversidade
   WHERE usuario_id = auth.uid() AND status = 'ativo'
   LIMIT 1;

  IF v_mon_id IS NULL THEN RETURN NULL; END IF;

  SELECT jsonb_build_object(
    'meus_ninhos',              COUNT(*)         FILTER (WHERE n.monitor_id = v_mon_id),
    'grupo_ninhos',             COUNT(*),
    'eclodidos',                COUNT(*)         FILTER (WHERE n.status = 'eclodido'),
    'pendentes',                COUNT(*)         FILTER (WHERE n.status = 'encontrado'),
    'filhotes_vivos',           COALESCE(SUM(e.filhotes_vivos), 0),
    'filhotes_mortos',          COALESCE(SUM(e.filhotes_mortos), 0),
    'ovos_nao_nascidos',        COALESCE(SUM(e.ovos_nao_nascidos), 0),
    'taxa_eclosao_pct',         ROUND(100.0 * COALESCE(SUM(e.filhotes_vivos),0) /
                                  NULLIF(COALESCE(SUM(e.filhotes_vivos + e.filhotes_mortos + e.ovos_nao_nascidos),0), 0), 1),
    'total_ovos_postura',       COALESCE(SUM(n.qtd_ovos), 0),
    'total_ovos_integros',      COALESCE(SUM(n.ovos_integros), 0),
    'total_ovos_descartados',   COALESCE(SUM(n.ovos_descartados), 0),
    'dist_rio_media_m',         ROUND(AVG(n.dist_rio_m)::numeric, 1),
    -- Condições do ninho
    'temp_media_c',             ROUND(AVG(n.temperatura_c)::numeric, 1),
    'umidade_media_pct',        ROUND(AVG(n.umidade_pct)::numeric, 1),
    'profundidade_media_cm',    ROUND(AVG(n.profundidade_cm)::numeric, 1)
  ) INTO v_result
  FROM ninhos_quelonios n
  LEFT JOIN eclosoes_ninho e ON e.ninho_id = n.id
  WHERE n.grupo_id = v_grupo_id
    AND (p_temporada_id IS NULL OR n.temporada_id = p_temporada_id);

  RETURN v_result;
END;
$$;
GRANT EXECUTE ON FUNCTION bio_meus_dados TO authenticated;
