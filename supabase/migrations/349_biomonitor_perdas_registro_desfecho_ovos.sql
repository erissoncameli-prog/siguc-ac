-- 349_biomonitor_perdas_registro_desfecho_ovos.sql
--
-- Relatório do Biomonitor — dois buracos nos números de ovos:
--
-- 1) PERDA LANÇADA NO REGISTRO DO NINHO NÃO CONTAVA POR CAUSA.
--    `descartes_ovos` tem duas colunas de causa: `motivo` (grossa —
--    natural|predacao|humana, única que o registro do ninho preenche) e
--    `causa` (fina — predacao|alagamento|erosao|humana|outro, preenchida
--    só pela visita, migration 123). `vw_ninho_ovos` separava as perdas
--    SÓ por `causa`, então o descarte do registro caía no total mas em
--    nenhuma causa. Medido em produção (29/09/2026): os 26 ovos
--    descartados são todos do registro (12 predação, 3 humana, 11
--    natural) — o gráfico "Perdas de ovos por causa" do Painel dizia
--    "Nenhuma perda registrada".
--    Correção NA FONTE (vw_ninho_ovos é a definição única, regra da 320):
--    causa efetiva = `causa`, ou, quando vazia, o `motivo` que tem
--    equivalente fino (predacao→predacao, humana→humana). `motivo =
--    natural` sem causa vira a coluna nova `perda_natural` (AO FINAL da
--    view — CREATE OR REPLACE VIEW não aceita reordenar). Vale de uma vez
--    para todo consumidor da view: Painel (bio_dashboard_praias),
--    relatório (bio_relatorio_completo), vw_praias_biomonitor,
--    vw_ninhos_validacao/PDF por ninho.
--
-- 2) "DESFECHO DOS OVOS" SEM OS OVOS EM INCUBAÇÃO.
--    O gráfico só tinha filhotes vivos/mortos/não nascidos/descartados —
--    com todos os 568 ninhos ainda incubando, a rosca mostrava 100%
--    "descartados". E "descartados" lia a coluna legada
--    `ninhos_quelonios.ovos_descartados`, que não recebe a perda lançada
--    em visita. Campos novos (mesmos nomes nas duas RPCs, só o prefixo
--    `total_` do relatório difere, como os demais):
--      - ovos_em_incubacao  = viáveis (vw_ninho_ovos) de ninho encontrado/
--        transferido SEM eclosão registrada;
--      - ovos_ninho_perdido = viáveis de ninho `perdido` sem eclosão — não
--        podem aparecer como "em incubação";
--      - ovos_descartes     = soma de `descartes_ovos` (registro + visitas).
--    No app (bio_dados_aba) `desfecho_ovos.ovos_descartados` passa a ser a
--    soma de `descartes_ovos` pelo mesmo motivo.
--    Praia do incubação/perdido = praia ATUAL (conta_ecl), onde os ovos
--    estão; descartes = praia de origem (conta_nidif), como a postura.
--
-- As RPCs são grandes (bio_relatorio_completo tem 25 KB); em vez de
-- recopiar o corpo inteiro — e arriscar reintroduzir versão antiga, lição
-- da 181 —, a migration aplica trocas pontuais no corpo ATUAL de produção
-- e ABORTA se algum trecho esperado não for encontrado exatamente uma vez.
-- `kpis` do relatório já usa 98 dos 100 argumentos de jsonb_build_object:
-- os campos novos entram num segundo objeto concatenado com `||`.

-- ── 1. vw_ninho_ovos ───────────────────────────────────────────────
CREATE OR REPLACE VIEW public.vw_ninho_ovos AS
 SELECT n.id AS ninho_id,
    COALESCE((n.qtd_ovos)::integer, 0) AS postura,
    COALESCE(dd.total, (0)::bigint) AS perdas_total,
    GREATEST((COALESCE((n.qtd_ovos)::integer, 0) - COALESCE(dd.total, (0)::bigint)), (0)::bigint) AS viaveis,
    COALESCE(dd.predacao, (0)::bigint) AS perda_predacao,
    COALESCE(dd.alagamento, (0)::bigint) AS perda_alagamento,
    COALESCE(dd.erosao, (0)::bigint) AS perda_erosao,
    COALESCE(dd.humana, (0)::bigint) AS perda_humana,
    COALESCE(dd.registro, (0)::bigint) AS perda_registro,
    COALESCE(dd.natural, (0)::bigint) AS perda_natural
   FROM (ninhos_quelonios n
     LEFT JOIN LATERAL ( SELECT sum(d.qtd) AS total,
            sum(d.qtd) FILTER (WHERE (COALESCE(d.causa::text, d.motivo::text) = 'predacao')) AS predacao,
            sum(d.qtd) FILTER (WHERE (d.causa = 'alagamento'::causa_perda_ovo)) AS alagamento,
            sum(d.qtd) FILTER (WHERE (d.causa = 'erosao'::causa_perda_ovo)) AS erosao,
            sum(d.qtd) FILTER (WHERE (COALESCE(d.causa::text, d.motivo::text) = 'humana')) AS humana,
            sum(d.qtd) FILTER (WHERE (d.etapa = 'registro'::text)) AS registro,
            sum(d.qtd) FILTER (WHERE (d.causa IS NULL AND d.motivo::text = 'natural')) AS natural
           FROM descartes_ovos d
          WHERE (d.ninho_id = n.id)) dd ON (true));

-- ── helper de troca exata (só nesta migration) ─────────────────────
CREATE FUNCTION pg_temp.mig349_trocar(p_texto text, p_de text, p_para text)
RETURNS text LANGUAGE plpgsql AS $f$
DECLARE v_n int;
BEGIN
  v_n := (length(p_texto) - length(replace(p_texto, p_de, ''))) / length(p_de);
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'migration 349: trecho esperado % vez(es), achado %: %', 1, v_n, left(p_de, 120);
  END IF;
  RETURN replace(p_texto, p_de, p_para);
END $f$;

DO $mig$
DECLARE v text;
BEGIN
  -- ── 2. bio_relatorio_completo ────────────────────────────────────
  v := pg_get_functiondef('public.bio_relatorio_completo(uuid,uuid,uuid,uuid,tipo_localizacao_praia)'::regprocedure);

  v := pg_temp.mig349_trocar(v,
$a$      COALESCE(ov.perda_humana, 0)     AS ovos_perda_humana,
$a$,
$a$      COALESCE(ov.perda_humana, 0)     AS ovos_perda_humana,
      COALESCE(ov.perda_natural, 0)    AS ovos_perda_natural,
$a$);

  v := pg_temp.mig349_trocar(v,
$a$      COALESCE(SUM(ovos_perda_humana) FILTER (WHERE conta_nidif), 0)     AS total_ovos_perda_humana,
$a$,
$a$      COALESCE(SUM(ovos_perda_humana) FILTER (WHERE conta_nidif), 0)     AS total_ovos_perda_humana,
      COALESCE(SUM(ovos_perda_natural) FILTER (WHERE conta_nidif), 0)    AS total_ovos_perda_natural,
      COALESCE(SUM(ovos_descartes_total) FILTER (WHERE conta_nidif), 0)  AS total_ovos_descartes,
      COALESCE(SUM(ovos_viaveis_ninho) FILTER (WHERE conta_ecl AND status IN ('encontrado','transferido') AND data_nascimento IS NULL), 0) AS total_ovos_em_incubacao,
      COALESCE(SUM(ovos_viaveis_ninho) FILTER (WHERE conta_ecl AND status = 'perdido' AND data_nascimento IS NULL), 0) AS total_ovos_ninho_perdido,
$a$);

  v := pg_temp.mig349_trocar(v,
$a$'sem_predacao', a.sem_predacao
      ) FROM agg a,$a$,
$a$'sem_predacao', a.sem_predacao
      ) || jsonb_build_object(
        'total_ovos_perda_natural', a.total_ovos_perda_natural,
        'total_ovos_descartes',     a.total_ovos_descartes,
        'total_ovos_em_incubacao',  a.total_ovos_em_incubacao,
        'total_ovos_ninho_perdido', a.total_ovos_ninho_perdido
      ) FROM agg a,$a$);

  EXECUTE v;

  -- ── 3. bio_dashboard_praias (Painel) ─────────────────────────────
  v := pg_get_functiondef('public.bio_dashboard_praias(uuid,especie_quelonio,uuid,text,uuid,text,date,date)'::regprocedure);

  v := pg_temp.mig349_trocar(v,
$a$ov.perda_predacao, ov.perda_alagamento, ov.perda_erosao, ov.perda_humana
$a$,
$a$ov.perda_predacao, ov.perda_alagamento, ov.perda_erosao, ov.perda_humana,
      ov.perda_natural
$a$);

  v := pg_temp.mig349_trocar(v,
$a$      COALESCE(SUM(b.perda_humana), 0)                                    AS perdas_humana
$a$,
$a$      COALESCE(SUM(b.perda_humana), 0)                                    AS perdas_humana,
      COALESCE(SUM(b.perda_natural), 0)                                   AS perdas_natural
$a$);

  v := pg_temp.mig349_trocar(v,
$a$'perdas_humana', COALESCE(nd.perdas_humana, 0)
$a$,
$a$'perdas_humana', COALESCE(nd.perdas_humana, 0),
    'perdas_natural', COALESCE(nd.perdas_natural, 0)
$a$);

  EXECUTE v;

  -- ── 4. bio_dados_aba (app de campo, aba Dados) ───────────────────
  v := pg_get_functiondef('public.bio_dados_aba(uuid,especie_quelonio)'::regprocedure);

  v := pg_temp.mig349_trocar(v,
$a$      n.ovos_descartados,
      n.dist_rio_m,$a$,
$a$      n.ovos_descartados,
      COALESCE(ov.viaveis, 0)      AS ovos_viaveis_ninho,
      COALESCE(ov.perdas_total, 0) AS ovos_descartes_total,
      n.dist_rio_m,$a$);

  v := pg_temp.mig349_trocar(v,
$a$    LEFT JOIN praias_monitoramento p ON p.id = n.praia_id
    LEFT JOIN LATERAL ($a$,
$a$    LEFT JOIN praias_monitoramento p ON p.id = n.praia_id
    LEFT JOIN vw_ninho_ovos ov ON ov.ninho_id = n.id
    LEFT JOIN LATERAL ($a$);

  v := pg_temp.mig349_trocar(v,
$a$      COALESCE(SUM(ovos_descartados), 0)                    AS total_ovos_descartados,
$a$,
$a$      COALESCE(SUM(ovos_descartados), 0)                    AS total_ovos_descartados,
      COALESCE(SUM(ovos_descartes_total), 0)                AS total_ovos_descartes,
      COALESCE(SUM(ovos_viaveis_ninho) FILTER (WHERE status IN ('encontrado','transferido') AND data_nascimento IS NULL), 0) AS ovos_em_incubacao,
      COALESCE(SUM(ovos_viaveis_ninho) FILTER (WHERE status = 'perdido' AND data_nascimento IS NULL), 0) AS ovos_ninho_perdido,
$a$);

  v := pg_temp.mig349_trocar(v,
$a$      'ovos_descartados',  a.total_ovos_descartados
    ),$a$,
$a$      'ovos_descartados',  a.total_ovos_descartes,
      'ovos_em_incubacao', a.ovos_em_incubacao,
      'ovos_ninho_perdido', a.ovos_ninho_perdido
    ),$a$);

  EXECUTE v;
END $mig$;
