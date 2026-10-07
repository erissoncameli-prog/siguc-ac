-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · vw_ninhos_validacao.grupo_id vem do próprio ninho (par da 357)
-- `grupo_id` vinha de g.id (LEFT JOIN em grupos_biomonitor): com a RLS de
-- grupos escondendo a linha, a coluna virava NULL e o filtro
-- `grupo_id = X` do app de campo devolvia zero ninhos — foi o que
-- aconteceu com todo monitor sem perfil de mesa depois da 263.
-- n.grupo_id já é liberado pela RLS de ninhos_quelonios: não amplia
-- acesso nenhum. Mesmo nome, tipo e posição da coluna.
-- ═══════════════════════════════════════════════════════════

-- ── vw_ninhos_validacao: grupo_id da própria linha do ninho ─────────
-- Recriada a partir do pg_get_viewdef() REAL de produção (07/10/2026),
-- trocando só `g.id AS grupo_id` por `n.grupo_id`. WITH (security_invoker)
-- repetido de propósito: CREATE OR REPLACE sem ele zera a opção (349b).
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
            WHEN (n.localizacao IS NOT NULL) THEN st_y(n.localizacao)
            ELSE NULL::double precision
        END AS lat,
        CASE
            WHEN (n.localizacao IS NOT NULL) THEN st_x(n.localizacao)
            ELSE NULL::double precision
        END AS lng,
    n.precisao_gps_m,
    n.qtd_ovos,
    n.qtd_ovos AS ninho_qtd_ovos,
    n.ovos_integros,
    n.ovos_descartados,
    ( SELECT COALESCE(sum(d.qtd), (0)::bigint) AS "coalesce"
           FROM descartes_ovos d
          WHERE ((d.ninho_id = n.id) AND (d.motivo = 'natural'::motivo_descarte))) AS descartados_natural,
    ( SELECT COALESCE(sum(d.qtd), (0)::bigint) AS "coalesce"
           FROM descartes_ovos d
          WHERE ((d.ninho_id = n.id) AND (d.motivo = 'predacao'::motivo_descarte))) AS descartados_predacao,
    ( SELECT COALESCE(sum(d.qtd), (0)::bigint) AS "coalesce"
           FROM descartes_ovos d
          WHERE ((d.ninho_id = n.id) AND (d.motivo = 'humana'::motivo_descarte))) AS descartados_humana,
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
    (n.data_prevista_eclosao - CURRENT_DATE) AS dias_para_eclosao,
    n.temp_media_observada,
    n.data_prevista_eclosao_ajustada,
    n.dias_antecipacao_estimados,
    n.contagem_ovos_metodo,
    n.qtd_ovos_estimado_original,
    n.postura_corrigida_em,
    ov.viaveis AS ovos_viaveis,
    ov.perdas_total AS ovos_perdidos_total
   FROM (((((((((ninhos_quelonios n
     LEFT JOIN temporadas_biomonitor tmp ON ((tmp.id = n.temporada_id)))
     LEFT JOIN praias_monitoramento p ON ((p.id = n.praia_id)))
     LEFT JOIN praias_monitoramento pa ON ((pa.id = n.praia_atual_id)))
     LEFT JOIN unidades_conservacao uc ON ((uc.id = n.uc_id)))
     LEFT JOIN monitores_biodiversidade mon ON ((mon.id = n.monitor_id)))
     LEFT JOIN grupos_biomonitor g ON ((g.id = n.grupo_id)))
     LEFT JOIN vw_ninho_ovos ov ON ((ov.ninho_id = n.id)))
     LEFT JOIN LATERAL ( SELECT transferencias_ninho.data_transferencia,
            transferencias_ninho.qtd_ovos,
            transferencias_ninho.local_destino
           FROM transferencias_ninho
          WHERE (transferencias_ninho.ninho_id = n.id)
          ORDER BY transferencias_ninho.data_transferencia DESC
         LIMIT 1) t ON (true))
     LEFT JOIN LATERAL ( SELECT eclosoes_ninho.data_nascimento,
            eclosoes_ninho.filhotes_vivos,
            eclosoes_ninho.filhotes_mortos,
            eclosoes_ninho.ovos_nao_nascidos,
            eclosoes_ninho.predacao
           FROM eclosoes_ninho
          WHERE (eclosoes_ninho.ninho_id = n.id)
          ORDER BY eclosoes_ninho.data_nascimento DESC
         LIMIT 1) e ON (true));
