-- SIGUC-AC · Biomonitor — 358c: correção da mesa sobrepõe a estimativa,
-- mapa usa a posição de ENCONTRO e vw_ninhos_validacao ganha
-- localizacao_estimada (ver cabeçalho da 358).

-- ── 4. Correção pela mesa sobrepõe a estimativa ───────────────
-- Troca pontual no corpo ATUAL de produção (molde da 349): marca a
-- sessão como correção manual antes do UPDATE.
CREATE OR REPLACE FUNCTION pg_temp.mig358_trocar(p_func regprocedure, p_de text, p_para text)
RETURNS void LANGUAGE plpgsql AS $f$
DECLARE v_def text; v_qtd int;
BEGIN
  v_def := pg_get_functiondef(p_func);
  v_qtd := (length(v_def) - length(replace(v_def, p_de, ''))) / length(p_de);
  IF v_qtd <> 1 THEN
    RAISE EXCEPTION 'mig358: trecho aparece % vezes em %', v_qtd, p_func;
  END IF;
  EXECUTE replace(v_def, p_de, p_para);
END;
$f$;

DO $do$ BEGIN PERFORM pg_temp.mig358_trocar(
  'biomonitor_corrigir_localizacao_ninho(uuid,uuid,numeric,numeric,numeric)'::regprocedure,
  E'  UPDATE ninhos_quelonios\n     SET praia_id       = p_praia_id,',
  E'  IF v_loc IS NOT NULL THEN\n    PERFORM set_config(''bio.loc_manual'', ''on'', true);\n  END IF;\n\n  UPDATE ninhos_quelonios\n     SET praia_id       = p_praia_id,'
); END $do$;

-- ── 5. Mapa: posição de ENCONTRO primeiro ─────────────────────
-- A 333 plotava o transferido no ponto de acesso da praia de destino.
-- Com a posição de encontro (real ou estimada) disponível, ela vale;
-- o destino só segue como reserva para ninho sem posição nenhuma.
-- As linhas de transferência do mapa continuam ligando origem→destino.
DO $do$ BEGIN PERFORM pg_temp.mig358_trocar(
  'bio_mapa_ninhos(uuid[],uuid,text[],text[],integer[])'::regprocedure,
  E'      ''lat'', CASE\n               WHEN n.praia_atual_id IS DISTINCT FROM n.praia_id AND pa.ponto_acesso IS NOT NULL\n                 THEN ST_Y(pa.ponto_acesso)\n               WHEN n.localizacao IS NOT NULL THEN ST_Y(n.localizacao)\n             END,',
  E'      ''lat'', CASE\n               WHEN n.localizacao IS NOT NULL THEN ST_Y(n.localizacao)\n               WHEN n.praia_atual_id IS DISTINCT FROM n.praia_id AND pa.ponto_acesso IS NOT NULL\n                 THEN ST_Y(pa.ponto_acesso)\n             END,'
); END $do$;
DO $do$ BEGIN PERFORM pg_temp.mig358_trocar(
  'bio_mapa_ninhos(uuid[],uuid,text[],text[],integer[])'::regprocedure,
  E'      ''lng'', CASE\n               WHEN n.praia_atual_id IS DISTINCT FROM n.praia_id AND pa.ponto_acesso IS NOT NULL\n                 THEN ST_X(pa.ponto_acesso)\n               WHEN n.localizacao IS NOT NULL THEN ST_X(n.localizacao)\n             END,',
  E'      ''lng'', CASE\n               WHEN n.localizacao IS NOT NULL THEN ST_X(n.localizacao)\n               WHEN n.praia_atual_id IS DISTINCT FROM n.praia_id AND pa.ponto_acesso IS NOT NULL\n                 THEN ST_X(pa.ponto_acesso)\n             END,\n      ''localizacao_estimada'', n.localizacao_estimada,\n      ''no_destino'', (n.localizacao IS NULL),'
); END $do$;

-- ── 6. vw_ninhos_validacao: coluna nova AO FINAL ──────────────
-- Corpo idêntico ao de produção (pg_get_viewdef, 09/10/2026); repete o
-- WITH (security_invoker) — sem ele o CREATE OR REPLACE zera a opção.
CREATE OR REPLACE VIEW vw_ninhos_validacao WITH (security_invoker = true) AS
 SELECT n.id,
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
        CASE
            WHEN n.localizacao IS NOT NULL THEN st_y(n.localizacao)
            ELSE NULL::double precision
        END AS lat,
        CASE
            WHEN n.localizacao IS NOT NULL THEN st_x(n.localizacao)
            ELSE NULL::double precision
        END AS lng,
    n.precisao_gps_m,
    n.qtd_ovos,
    n.qtd_ovos AS ninho_qtd_ovos,
    n.ovos_integros,
    n.ovos_descartados,
    ( SELECT COALESCE(sum(d.qtd), 0::bigint) AS "coalesce"
           FROM descartes_ovos d
          WHERE d.ninho_id = n.id AND d.motivo = 'natural'::motivo_descarte) AS descartados_natural,
    ( SELECT COALESCE(sum(d.qtd), 0::bigint) AS "coalesce"
           FROM descartes_ovos d
          WHERE d.ninho_id = n.id AND d.motivo = 'predacao'::motivo_descarte) AS descartados_predacao,
    ( SELECT COALESCE(sum(d.qtd), 0::bigint) AS "coalesce"
           FROM descartes_ovos d
          WHERE d.ninho_id = n.id AND d.motivo = 'humana'::motivo_descarte) AS descartados_humana,
    n.dist_rio_m,
    n.dist_rio_metodo,
    n.temperatura_c,
    n.umidade_pct,
    n.profundidade_cm,
    n.alerta_campo,
    n.temporada_id,
    tmp.nome AS temporada_nome,
    tmp.ano_base AS temporada_ano,
    tmp.is_atual AS temporada_atual,
    p.id AS praia_id,
    p.nome AS praia_nome,
    p.codigo AS praia_codigo,
    n.praia_atual_id,
    pa.nome AS praia_atual_nome,
    pa.sigla AS praia_atual_sigla,
    pa.experimental AS praia_atual_experimental,
    uc.nome AS uc_nome,
    mon.id AS monitor_id,
    mon.nome_completo AS monitor_nome,
    g.nome AS grupo_nome,
    n.grupo_id,
    t.data_transferencia,
    t.qtd_ovos AS transf_qtd_ovos,
    t.local_destino,
    e.data_nascimento,
    e.filhotes_vivos,
    e.filhotes_mortos,
    e.ovos_nao_nascidos,
    e.predacao,
    n.incubacao_dias_previstos,
    n.data_prevista_eclosao,
    n.data_prevista_eclosao - CURRENT_DATE AS dias_para_eclosao,
    n.temp_media_observada,
    n.data_prevista_eclosao_ajustada,
    n.dias_antecipacao_estimados,
    n.contagem_ovos_metodo,
    n.qtd_ovos_estimado_original,
    n.postura_corrigida_em,
    ov.viaveis AS ovos_viaveis,
    ov.perdas_total AS ovos_perdidos_total,
    n.localizacao_estimada
   FROM ninhos_quelonios n
     LEFT JOIN temporadas_biomonitor tmp ON tmp.id = n.temporada_id
     LEFT JOIN praias_monitoramento p ON p.id = n.praia_id
     LEFT JOIN praias_monitoramento pa ON pa.id = n.praia_atual_id
     LEFT JOIN unidades_conservacao uc ON uc.id = n.uc_id
     LEFT JOIN monitores_biodiversidade mon ON mon.id = n.monitor_id
     LEFT JOIN grupos_biomonitor g ON g.id = n.grupo_id
     LEFT JOIN vw_ninho_ovos ov ON ov.ninho_id = n.id
     LEFT JOIN LATERAL ( SELECT transferencias_ninho.data_transferencia,
            transferencias_ninho.qtd_ovos,
            transferencias_ninho.local_destino
           FROM transferencias_ninho
          WHERE transferencias_ninho.ninho_id = n.id
          ORDER BY transferencias_ninho.data_transferencia DESC
         LIMIT 1) t ON true
     LEFT JOIN LATERAL ( SELECT eclosoes_ninho.data_nascimento,
            eclosoes_ninho.filhotes_vivos,
            eclosoes_ninho.filhotes_mortos,
            eclosoes_ninho.ovos_nao_nascidos,
            eclosoes_ninho.predacao
           FROM eclosoes_ninho
          WHERE eclosoes_ninho.ninho_id = n.id
          ORDER BY eclosoes_ninho.data_nascimento DESC
         LIMIT 1) e ON true;
