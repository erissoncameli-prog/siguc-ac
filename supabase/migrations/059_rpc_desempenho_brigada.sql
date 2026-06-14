-- ════════════════════════════════════════════════════════════════
-- 059 — RPC de desempenho da brigada (para a aba "Dados" do app)
-- ════════════════════════════════════════════════════════════════
-- Um brigadista comum não enxerga (RLS) os registros dos colegas.
-- Esta função SECURITY DEFINER devolve apenas AGREGADOS da brigada
-- do próprio chamador: totais da brigada, por equipe e por brigadista.
-- Não expõe linhas individuais de registro.

CREATE OR REPLACE FUNCTION app_desempenho_brigada(
  p_desde date DEFAULT NULL,
  p_ate   date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_brigada uuid;
  v_result  jsonb;
BEGIN
  SELECT brigada_id INTO v_brigada
  FROM brigadistas
  WHERE usuario_id = auth.uid() AND status = 'ativo'
  LIMIT 1;

  IF v_brigada IS NULL THEN
    RETURN jsonb_build_object('erro', 'sem_brigada');
  END IF;

  WITH base AS (
    SELECT rc.id, rc.equipe_id, rc.brigadista_id,
           rc.area_estimada_ha, rc.duracao_horas,
           COALESCE(fa.n_resg, 0) AS n_resg
    FROM registros_campo rc
    LEFT JOIN (
      SELECT registro_campo_id,
             SUM(quantidade) FILTER (WHERE tipo_evento = 'resgate') AS n_resg
      FROM registro_fauna GROUP BY registro_campo_id
    ) fa ON fa.registro_campo_id = rc.id
    WHERE rc.brigada_id = v_brigada
      AND (p_desde IS NULL OR rc.data_hora_evento >= p_desde)
      AND (p_ate   IS NULL OR rc.data_hora_evento <  (p_ate + 1))
  )
  SELECT jsonb_build_object(
    'brigada', (SELECT jsonb_build_object(
        'n',     COUNT(*),
        'area',  COALESCE(SUM(area_estimada_ha), 0),
        'fauna', COALESCE(SUM(n_resg), 0),
        'horas', COALESCE(SUM(duracao_horas), 0)
      ) FROM base),
    'por_equipe', (SELECT COALESCE(jsonb_agg(x), '[]'::jsonb) FROM (
        SELECT jsonb_build_object(
          'equipe_id', e.id, 'nome', e.nome,
          'n',     COUNT(b.id),
          'area',  COALESCE(SUM(b.area_estimada_ha), 0),
          'fauna', COALESCE(SUM(b.n_resg), 0),
          'horas', COALESCE(SUM(b.duracao_horas), 0)
        ) AS x
        FROM equipes_brigada e
        LEFT JOIN base b ON b.equipe_id = e.id
        WHERE e.brigada_id = v_brigada AND e.ativa
        GROUP BY e.id, e.nome
        ORDER BY e.nome
      ) q),
    'por_brigadista', (SELECT COALESCE(jsonb_agg(x), '[]'::jsonb) FROM (
        SELECT jsonb_build_object(
          'brigadista_id', br.id, 'nome', br.nome_completo,
          'n',     COUNT(b.id),
          'area',  COALESCE(SUM(b.area_estimada_ha), 0),
          'fauna', COALESCE(SUM(b.n_resg), 0),
          'horas', COALESCE(SUM(b.duracao_horas), 0)
        ) AS x
        FROM brigadistas br
        LEFT JOIN base b ON b.brigadista_id = br.id
        WHERE br.brigada_id = v_brigada AND br.status = 'ativo'
        GROUP BY br.id, br.nome_completo
        ORDER BY COUNT(b.id) DESC
      ) q)
  ) INTO v_result;

  RETURN v_result;
END $$;

GRANT EXECUTE ON FUNCTION app_desempenho_brigada(date, date) TO authenticated;
