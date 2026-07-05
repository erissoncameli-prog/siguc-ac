-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Biomonitor — Incubação por espécie + previsão de eclosão
-- ───────────────────────────────────────────────────────────
-- Cada espécie tem um tempo médio de incubação distinto. Este
-- período passa a ser PARAMETRIZÁVEL no catálogo de espécies
-- (biólogo/gestor ajusta sem migration). Com ele, cada ninho
-- ganha data prevista de eclosão e dias de incubação previstos,
-- ARMAZENADOS para consulta histórica e análise previsto × real.
--
-- Data de postura = data_encontro (a desova é registrada no dia
-- do achado). hora_desova refina a janela crítica, não a previsão.
--
-- Dias restantes e faixa de risco variam com a data de hoje e por
-- isso NÃO são armazenados: ficam na view vw_ninhos_previsao_eclosao.
--
-- Tudo aditivo. Depende de 074, 092, 110.
-- ═══════════════════════════════════════════════════════════

-- ── 1. Parâmetros de incubação no catálogo de espécies ───────
ALTER TABLE especies_quelonio_catalogo
  ADD COLUMN IF NOT EXISTS incubacao_dias_min   smallint,
  ADD COLUMN IF NOT EXISTS incubacao_dias_media smallint,
  ADD COLUMN IF NOT EXISTS incubacao_dias_max   smallint;

COMMENT ON COLUMN especies_quelonio_catalogo.incubacao_dias_media IS
  'Base do cálculo da data prevista de eclosão (data_encontro + média).';
COMMENT ON COLUMN especies_quelonio_catalogo.incubacao_dias_max IS
  'Limite superior da incubação; passado dele sem eclosão, o ninho fica "atrasado".';

-- Seed de valores de literatura (Podocnemis / condições amazônicas).
-- Parametrizável: o biólogo ajusta depois pelo catálogo.
UPDATE especies_quelonio_catalogo SET incubacao_dias_min = v.mn,
       incubacao_dias_media = v.md, incubacao_dias_max = v.mx
  FROM (VALUES
    ('tracaja'::especie_quelonio,            60, 68, 75),
    ('tartaruga',                            45, 55, 65),
    ('cabecudo',                             45, 52, 60),
    ('pitiU',                                60, 70, 80),
    ('cupido',                               60, 68, 75),
    ('mucua',                               120,135,160),
    ('jabuti_pe_elefante',                  120,140,160),
    ('jabuti_piranga',                      120,140,160),
    ('outro',                                55, 65, 75)
  ) AS v(codigo, mn, md, mx)
 WHERE especies_quelonio_catalogo.codigo = v.codigo;

-- ── 2. Colunas de previsão (armazenadas) no ninho ────────────
ALTER TABLE ninhos_quelonios
  ADD COLUMN IF NOT EXISTS incubacao_dias_previstos smallint,
  ADD COLUMN IF NOT EXISTS data_prevista_eclosao    date;

COMMENT ON COLUMN ninhos_quelonios.data_prevista_eclosao IS
  'data_encontro + incubacao_dias_previstos. Recalculada ao mudar espécie/data.';
COMMENT ON COLUMN ninhos_quelonios.incubacao_dias_previstos IS
  'Dias de incubação previstos (média do catálogo no momento do cálculo).';

-- Índice para o painel de eclosão (varre só ninhos em incubação)
CREATE INDEX IF NOT EXISTS idx_ninhos_prev_eclosao
  ON ninhos_quelonios (data_prevista_eclosao)
  WHERE status IN ('encontrado','transferido');

-- ── 3. Função: dias de incubação previstos por espécie ───────
-- Lê o catálogo (média); fallback 65 dias quando não parametrizado.
CREATE OR REPLACE FUNCTION bio_incubacao_dias_previstos(p_especie especie_quelonio)
RETURNS smallint
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT COALESCE(
    (SELECT incubacao_dias_media FROM especies_quelonio_catalogo
      WHERE codigo = p_especie AND incubacao_dias_media IS NOT NULL),
    65
  )::smallint;
$$;
GRANT EXECUTE ON FUNCTION bio_incubacao_dias_previstos TO authenticated, service_role;

-- ── 4. Trigger: recalcula a previsão ao mudar espécie/data ───
CREATE OR REPLACE FUNCTION trg_ninhos_calcular_previsao()
RETURNS trigger
LANGUAGE plpgsql SET search_path = public
AS $$
DECLARE v_dias smallint;
BEGIN
  IF NEW.especie IS NULL OR NEW.data_encontro IS NULL THEN
    NEW.incubacao_dias_previstos := NULL;
    NEW.data_prevista_eclosao    := NULL;
    RETURN NEW;
  END IF;
  v_dias := bio_incubacao_dias_previstos(NEW.especie);
  NEW.incubacao_dias_previstos := v_dias;
  NEW.data_prevista_eclosao    := NEW.data_encontro + v_dias;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ninhos_previsao ON ninhos_quelonios;
CREATE TRIGGER trg_ninhos_previsao
  BEFORE INSERT OR UPDATE OF especie, data_encontro ON ninhos_quelonios
  FOR EACH ROW EXECUTE FUNCTION trg_ninhos_calcular_previsao();

-- ── 5. Backfill dos ninhos existentes ────────────────────────
UPDATE ninhos_quelonios n
   SET incubacao_dias_previstos = bio_incubacao_dias_previstos(n.especie),
       data_prevista_eclosao    = n.data_encontro + bio_incubacao_dias_previstos(n.especie)
 WHERE n.especie IS NOT NULL AND n.data_encontro IS NOT NULL
   AND (n.data_prevista_eclosao IS NULL OR n.incubacao_dias_previstos IS NULL);

-- ── 6. View: previsão de eclosão (dias restantes + faixa de risco) ──
-- Derivados de CURRENT_DATE. Só faz sentido para ninhos em incubação.
CREATE OR REPLACE VIEW vw_ninhos_previsao_eclosao
WITH (security_invoker = true)
AS
SELECT
  n.id,
  n.uuid_cliente,
  n.numero_ninho,
  n.numero_atual,
  n.especie,
  n.status,
  n.temporada_id,
  n.grupo_id,
  n.data_encontro,
  n.incubacao_dias_previstos,
  n.data_prevista_eclosao,
  n.praia_id,
  n.praia_atual_id,
  pa.nome  AS praia_atual_nome,
  pa.sigla AS praia_atual_sigla,
  (n.data_prevista_eclosao - CURRENT_DATE)                       AS dias_para_eclosao,
  cat.incubacao_dias_max,
  -- Faixa de risco para ninhos ainda em incubação
  CASE
    WHEN n.status NOT IN ('encontrado','transferido')            THEN 'inativo'
    WHEN n.data_prevista_eclosao IS NULL                         THEN 'sem_previsao'
    WHEN CURRENT_DATE > n.data_encontro
         + COALESCE(cat.incubacao_dias_max, n.incubacao_dias_previstos)
                                                                 THEN 'atrasado'
    WHEN n.data_prevista_eclosao = CURRENT_DATE                  THEN 'hoje'
    WHEN n.data_prevista_eclosao - CURRENT_DATE BETWEEN 0 AND 7  THEN 'atencao'
    ELSE 'normal'
  END                                                            AS faixa_risco,
  -- Situação textual amigável
  CASE
    WHEN n.status NOT IN ('encontrado','transferido')            THEN NULL
    WHEN n.data_prevista_eclosao IS NULL                         THEN 'Sem previsão'
    WHEN CURRENT_DATE > n.data_encontro
         + COALESCE(cat.incubacao_dias_max, n.incubacao_dias_previstos)
      THEN 'Atrasada há ' || (CURRENT_DATE - n.data_prevista_eclosao) || ' dia(s)'
    WHEN n.data_prevista_eclosao = CURRENT_DATE                  THEN 'Prevista para hoje'
    WHEN n.data_prevista_eclosao > CURRENT_DATE
      THEN 'Faltam ' || (n.data_prevista_eclosao - CURRENT_DATE) || ' dia(s)'
    ELSE 'Prevista há ' || (CURRENT_DATE - n.data_prevista_eclosao) || ' dia(s)'
  END                                                            AS situacao
FROM ninhos_quelonios n
LEFT JOIN praias_monitoramento pa            ON pa.id = n.praia_atual_id
LEFT JOIN especies_quelonio_catalogo cat     ON cat.codigo = n.especie;

-- ── 7. vw_ninhos_validacao — recria expondo a previsão ───────
-- Reproduz FIELMENTE a definição vigente (inclui descartes_ovos,
-- alerta_campo e temporada_*, agregados por migrations posteriores à
-- 092) e ACRESCENTA, ao final, as colunas de previsão. Não remove
-- nenhuma coluna existente (consumida pelo card do app).
DROP VIEW IF EXISTS vw_ninhos_validacao;

CREATE VIEW vw_ninhos_validacao
WITH (security_invoker = true)
AS
SELECT
  n.id,
  n.uuid_cliente,
  n.numero_ninho,
  n.numero_atual,
  n.especie,
  n.data_encontro,
  n.hora_desova,
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
  n.qtd_ovos,
  n.qtd_ovos                   AS ninho_qtd_ovos,
  n.ovos_integros,
  n.ovos_descartados,
  (SELECT COALESCE(sum(d.qtd), 0) FROM descartes_ovos d
     WHERE d.ninho_id = n.id AND d.motivo = 'natural'::motivo_descarte)  AS descartados_natural,
  (SELECT COALESCE(sum(d.qtd), 0) FROM descartes_ovos d
     WHERE d.ninho_id = n.id AND d.motivo = 'predacao'::motivo_descarte) AS descartados_predacao,
  (SELECT COALESCE(sum(d.qtd), 0) FROM descartes_ovos d
     WHERE d.ninho_id = n.id AND d.motivo = 'humana'::motivo_descarte)   AS descartados_humana,
  n.dist_rio_m,
  n.dist_rio_metodo,
  n.temperatura_c,
  n.umidade_pct,
  n.profundidade_cm,
  n.alerta_campo,
  n.temporada_id,
  tmp.nome      AS temporada_nome,
  tmp.ano_base  AS temporada_ano,
  tmp.is_atual  AS temporada_atual,
  p.id          AS praia_id,
  p.nome        AS praia_nome,
  p.codigo      AS praia_codigo,
  n.praia_atual_id,
  pa.nome         AS praia_atual_nome,
  pa.sigla        AS praia_atual_sigla,
  pa.experimental AS praia_atual_experimental,
  uc.nome       AS uc_nome,
  mon.id        AS monitor_id,
  mon.nome_completo AS monitor_nome,
  g.nome        AS grupo_nome,
  g.id          AS grupo_id,
  t.data_transferencia,
  t.qtd_ovos    AS transf_qtd_ovos,
  t.local_destino,
  e.data_nascimento,
  e.filhotes_vivos,
  e.filhotes_mortos,
  e.ovos_nao_nascidos,
  e.predacao,
  -- Previsão de eclosão (armazenada + derivada) — colunas NOVAS ao final
  n.incubacao_dias_previstos,
  n.data_prevista_eclosao,
  (n.data_prevista_eclosao - CURRENT_DATE) AS dias_para_eclosao
FROM ninhos_quelonios n
LEFT JOIN temporadas_biomonitor tmp    ON tmp.id = n.temporada_id
LEFT JOIN praias_monitoramento p       ON p.id = n.praia_id
LEFT JOIN praias_monitoramento pa      ON pa.id = n.praia_atual_id
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
