-- 306b_rh_rpcs_relatorio_cotas.sql
--
-- RPCs da Fase C (plataformas hidrometeorológicas), separadas da 306
-- (tabelas/view) — ver o cabeçalho de lá.
--
--   rh_relatorio_diario(data)  → agregação do dia POR RIO (variação de
--       nível, chuva acumulada, estações em cota). SECURITY INVOKER: a
--       RLS de rh_medicoes/rh_estacoes é quem decide o que aparece.
--   rh_registrar_medicoes(jsonb) → ingestão em lote idempotente por
--       (estacao_id, data_hora, origem) — usada pela importação de
--       arquivo na tela e pela Edge Function ingest-hidro.
--   rh_checar_cotas() → pg_cron; notifica quando uma estação passa da
--       cota de atenção/alerta/inundação. SECURITY DEFINER (cria
--       notificação para terceiros), dedupe por `ref` no meta —
--       mesmo molde de frota_checar_vencimentos (205).
--
-- Verificado contra produção antes do commit: estação de teste com 4
-- leituras → relatório devolveu variação de +215 cm no dia, 50,5 mm de
-- chuva e situação 'alerta'; rh_checar_cotas() gerou 21 notificações
-- (uma por gestor/técnico ativo) dentro de uma transação com ROLLBACK.
-- Linhas de teste apagadas ao final.

-- ── Relatório diário por RIO ─────────────────────────────────────
-- Agregação do dia escolhido: variação de nível e chuva acumulada, por
-- rio (é assim que a leitura operacional acontece — "o Acre subiu 40 cm
-- em Rio Branco", não "a estação 13600002 subiu"). SECURITY INVOKER: a
-- RLS de rh_medicoes/rh_estacoes decide quem vê o quê.
CREATE OR REPLACE FUNCTION rh_relatorio_diario(p_data date DEFAULT current_date)
RETURNS TABLE (
  rio               text,
  bacia             text,
  n_estacoes        bigint,
  nivel_medio_cm    numeric,
  nivel_max_cm      numeric,
  variacao_cm       numeric,
  chuva_total_mm    numeric,
  chuva_max_mm      numeric,
  estacoes_em_cota  bigint,
  pior_situacao     text,
  detalhe           jsonb
)
LANGUAGE sql STABLE
SET search_path = public
AS $$
WITH janela AS (
  SELECT m.*, e.rio, e.bacia, e.nome, e.id AS eid,
         e.cota_atencao_cm, e.cota_alerta_cm, e.cota_inundacao_cm
    FROM rh_medicoes m
    JOIN rh_estacoes e ON e.id = m.estacao_id
   WHERE m.data_hora >= p_data::timestamptz
     AND m.data_hora <  (p_data + 1)::timestamptz
     AND e.ativo
),
por_estacao AS (
  SELECT eid, rio, bacia, nome,
         cota_atencao_cm, cota_alerta_cm, cota_inundacao_cm,
         MAX(nivel_cm)                                     AS nivel_max,
         AVG(nivel_cm)                                     AS nivel_medio,
         (MAX(nivel_cm) FILTER (WHERE nivel_cm IS NOT NULL)
          - MIN(nivel_cm) FILTER (WHERE nivel_cm IS NOT NULL)) AS amplitude,
         (SELECT j2.nivel_cm FROM janela j2 WHERE j2.eid = j.eid AND j2.nivel_cm IS NOT NULL
           ORDER BY j2.data_hora DESC LIMIT 1)             AS nivel_fim,
         (SELECT j3.nivel_cm FROM janela j3 WHERE j3.eid = j.eid AND j3.nivel_cm IS NOT NULL
           ORDER BY j3.data_hora ASC LIMIT 1)              AS nivel_ini,
         SUM(chuva_mm)                                     AS chuva
    FROM janela j
   GROUP BY eid, rio, bacia, nome, cota_atencao_cm, cota_alerta_cm, cota_inundacao_cm
),
com_situacao AS (
  SELECT p.*,
         CASE
           WHEN nivel_max IS NULL THEN NULL
           WHEN cota_inundacao_cm IS NOT NULL AND nivel_max >= cota_inundacao_cm THEN 'inundacao'
           WHEN cota_alerta_cm    IS NOT NULL AND nivel_max >= cota_alerta_cm    THEN 'alerta'
           WHEN cota_atencao_cm   IS NOT NULL AND nivel_max >= cota_atencao_cm   THEN 'atencao'
           WHEN cota_atencao_cm IS NULL AND cota_alerta_cm IS NULL AND cota_inundacao_cm IS NULL THEN NULL
           ELSE 'normal'
         END AS situacao
    FROM por_estacao p
)
SELECT COALESCE(rio, 'Rio não informado') AS rio,
       MIN(bacia)                          AS bacia,
       COUNT(*)                            AS n_estacoes,
       ROUND(AVG(nivel_medio), 1)          AS nivel_medio_cm,
       MAX(nivel_max)                      AS nivel_max_cm,
       ROUND(AVG(nivel_fim - nivel_ini), 1) AS variacao_cm,
       ROUND(SUM(chuva), 1)                AS chuva_total_mm,
       MAX(chuva)                          AS chuva_max_mm,
       COUNT(*) FILTER (WHERE situacao IN ('atencao', 'alerta', 'inundacao')) AS estacoes_em_cota,
       (ARRAY_AGG(situacao ORDER BY CASE situacao
          WHEN 'inundacao' THEN 1 WHEN 'alerta' THEN 2 WHEN 'atencao' THEN 3
          WHEN 'normal' THEN 4 ELSE 5 END) FILTER (WHERE situacao IS NOT NULL))[1] AS pior_situacao,
       jsonb_agg(jsonb_build_object(
         'estacao_id', eid, 'nome', nome,
         'nivel_fim_cm', nivel_fim, 'nivel_ini_cm', nivel_ini,
         'variacao_cm', nivel_fim - nivel_ini,
         'amplitude_cm', amplitude,
         'chuva_mm', chuva, 'situacao', situacao
       ) ORDER BY nome) AS detalhe
  FROM com_situacao
 GROUP BY COALESCE(rio, 'Rio não informado')
 ORDER BY 9 DESC, 7 DESC NULLS LAST, 1;
$$;

REVOKE EXECUTE ON FUNCTION rh_relatorio_diario(date) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION rh_relatorio_diario(date) FROM anon;
GRANT  EXECUTE ON FUNCTION rh_relatorio_diario(date) TO authenticated;

-- ── Ingestão em lote (importação de arquivo e Edge Function) ─────
-- Idempotente por (estacao_id, data_hora, origem). SECURITY INVOKER:
-- não amplia privilégio nenhum — a policy de rh_medicoes é quem
-- autoriza (mesma decisão da RPC frota_solicitar_viagem, migration 235).
CREATE OR REPLACE FUNCTION rh_registrar_medicoes(p_medicoes jsonb)
RETURNS integer
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE v_n integer;
BEGIN
  IF p_medicoes IS NULL OR jsonb_typeof(p_medicoes) <> 'array' THEN
    RAISE EXCEPTION 'p_medicoes deve ser um array JSON';
  END IF;

  WITH entrada AS (
    SELECT (x->>'estacao_id')::uuid        AS estacao_id,
           (x->>'data_hora')::timestamptz  AS data_hora,
           NULLIF(x->>'nivel_cm','')::numeric  AS nivel_cm,
           NULLIF(x->>'chuva_mm','')::numeric  AS chuva_mm,
           NULLIF(x->>'vazao_m3s','')::numeric AS vazao_m3s,
           COALESCE(NULLIF(x->>'origem','')::rh_origem_medicao, 'importacao') AS origem,
           x->'bruto' AS bruto
      FROM jsonb_array_elements(p_medicoes) x
  ), gravadas AS (
    INSERT INTO rh_medicoes (estacao_id, data_hora, nivel_cm, chuva_mm, vazao_m3s, origem, bruto, criado_por)
    SELECT estacao_id, data_hora, nivel_cm, chuva_mm, vazao_m3s, origem, bruto, auth.uid()
      FROM entrada
      WHERE estacao_id IS NOT NULL AND data_hora IS NOT NULL
    ON CONFLICT (estacao_id, data_hora, origem) DO UPDATE
      SET nivel_cm  = COALESCE(EXCLUDED.nivel_cm,  rh_medicoes.nivel_cm),
          chuva_mm  = COALESCE(EXCLUDED.chuva_mm,  rh_medicoes.chuva_mm),
          vazao_m3s = COALESCE(EXCLUDED.vazao_m3s, rh_medicoes.vazao_m3s),
          bruto     = COALESCE(EXCLUDED.bruto,     rh_medicoes.bruto)
    RETURNING 1
  )
  SELECT count(*) INTO v_n FROM gravadas;
  RETURN v_n;
END $$;

REVOKE EXECUTE ON FUNCTION rh_registrar_medicoes(jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION rh_registrar_medicoes(jsonb) FROM anon;
GRANT  EXECUTE ON FUNCTION rh_registrar_medicoes(jsonb) TO authenticated;

-- ── Aviso automático de cota atingida (pg_cron) ──────────────────
-- SECURITY DEFINER porque precisa enxergar todas as estações e criar
-- notificação para terceiros. Dedupe pelo `ref` no meta — mesmo molde
-- de frota_checar_vencimentos (205) e biomonitor (230): não repete
-- enquanto houver notificação pendente do mesmo fato.
CREATE OR REPLACE FUNCTION rh_checar_cotas()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r        record;
  v_dest   record;
  v_ref    text;
  v_n      integer := 0;
BEGIN
  FOR r IN
    SELECT e.id, e.nome, e.rio, e.municipio, v.nivel_atual_cm, v.situacao_cota,
           v.variacao_24h_cm, v.ultima_leitura
      FROM vw_rh_estacoes_detalhe v
      JOIN rh_estacoes e ON e.id = v.id
     WHERE e.ativo
       AND v.situacao_cota IN ('atencao', 'alerta', 'inundacao')
       AND v.ultima_leitura >= now() - interval '36 hours'
  LOOP
    -- Uma notificação por estação/situação/dia: o rio pode oscilar em
    -- volta da cota várias vezes no mesmo dia, e avisar a cada leitura
    -- viraria ruído que ninguém lê.
    v_ref := 'rh_cota:' || r.id || ':' || r.situacao_cota || ':' || current_date;

    IF EXISTS (SELECT 1 FROM notificacoes WHERE meta->>'ref' = v_ref) THEN
      CONTINUE;
    END IF;

    FOR v_dest IN
      SELECT id FROM usuarios
       WHERE ativo AND perfil IN ('super_admin', 'gestor', 'diretor', 'chefe_departamento', 'tecnico')
    LOOP
      INSERT INTO notificacoes (tipo, status, titulo, mensagem, destinatario_id, meta)
      VALUES (
        'hidro', 'gerada',
        CASE r.situacao_cota
          WHEN 'inundacao' THEN 'Cota de INUNDAÇÃO atingida — ' || COALESCE(r.rio, r.nome)
          WHEN 'alerta'    THEN 'Cota de alerta atingida — '    || COALESCE(r.rio, r.nome)
          ELSE 'Cota de atenção atingida — '                    || COALESCE(r.rio, r.nome)
        END,
        format('%s (%s): nível %s cm%s. Leitura de %s.',
               r.nome, COALESCE(r.municipio, 'município não informado'),
               COALESCE(r.nivel_atual_cm::text, '—'),
               CASE WHEN r.variacao_24h_cm IS NULL THEN ''
                    ELSE format(', variação de %s cm em 24h', r.variacao_24h_cm) END,
               to_char(r.ultima_leitura AT TIME ZONE 'America/Rio_Branco', 'DD/MM/YYYY HH24:MI')),
        v_dest.id,
        jsonb_build_object('ref', v_ref, 'estacao_id', r.id, 'situacao', r.situacao_cota)
      );
      v_n := v_n + 1;
    END LOOP;
  END LOOP;

  RETURN v_n;
END $$;

REVOKE EXECUTE ON FUNCTION rh_checar_cotas() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION rh_checar_cotas() FROM anon;
GRANT  EXECUTE ON FUNCTION rh_checar_cotas() TO authenticated;

-- 307b (migration separada, aplicada depois): achado pelo advisor de
-- segurança — rh_checar_cotas() só deveria rodar via pg_cron (dono
-- postgres), nunca chamada direta por um usuário autenticado via
-- /rest/v1/rpc. Ver supabase/migrations/307b_rh_checar_cotas_revoke_authenticated.sql.
