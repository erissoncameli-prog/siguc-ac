-- ═══════════════════════════════════════════════════════════════
-- SIGUC-AC · Biomonitor — Postura de ovos por ESTIMATIVA
-- ───────────────────────────────────────────────────────────────
-- Hoje `ninhos_quelonios.qtd_ovos` é um número só, sem marca de como
-- foi obtido — um ninho contado ovo a ovo e um ninho contado "no
-- olho" (alto volume de ninhos numa mesma noite) entram na mesma
-- coluna, e todos os agregados científicos (taxa_fertilidade_pct,
-- eficiencia_ninho_pct, ovos_viaveis via vw_ninho_ovos) misturam os
-- dois sem aviso. Pedido do usuário: permitir cadastrar a postura
-- por ESTIMATIVA quando o volume de ninhos numa noite não permite
-- contar um a um, e corrigir esse número quando a eclosão (ou a
-- transferência, onde os ovos são de fato manuseados) apurar o real
-- — sem que isso seja tratado como erro do monitor, e com o registro
-- de todo ninho estimado disponível para acompanhamento da gestão.
--
-- Decisões confirmadas com o usuário:
--   1. Transferência TAMBÉM corrige a postura estimada (é onde os
--      ovos são de fato contados um a um).
--   2. A correção na eclosão é oferecida com UM toque (valor apurado
--      pré-preenchido, editável) — nunca automática sem o monitor ver.
--   3. Ninhos já cadastrados (antes desta migration) entram como
--      'contado' — é o default da coluna, sem UPDATE em massa.
--
-- Mesma lição de dist_rio_metodo ('tracker'|'estimativa', mig. 074):
-- o MÉTODO de obtenção do dado é uma coluna própria, nunca inferido.
-- ═══════════════════════════════════════════════════════════════

-- ── 1. Método de contagem ──────────────────────────────────────
CREATE TYPE metodo_contagem_ovos AS ENUM ('contado', 'estimado', 'confirmado_eclosao');

ALTER TABLE ninhos_quelonios
  ADD COLUMN contagem_ovos_metodo   metodo_contagem_ovos NOT NULL DEFAULT 'contado',
  ADD COLUMN qtd_ovos_estimado_original smallint CHECK (qtd_ovos_estimado_original >= 0),
  ADD COLUMN postura_corrigida_em   timestamptz,
  ADD COLUMN postura_corrigida_por  uuid REFERENCES auth.users(id) ON DELETE SET NULL;

COMMENT ON COLUMN ninhos_quelonios.contagem_ovos_metodo IS
  'Como qtd_ovos foi obtido: contado (um a um), estimado (aguarda confirmação na eclosão/transferência) ou confirmado_eclosao (já corrigido por apuração real). Default contado — ninhos anteriores a esta migration não foram marcados como estimados por suposição.';
COMMENT ON COLUMN ninhos_quelonios.qtd_ovos_estimado_original IS
  'Preserva o número ORIGINAL estimado quando qtd_ovos é corrigido por apuração real — nunca sobrescrito, é a base do cálculo de viés da estimativa.';

-- Registro de acompanhamento das ações: quando/quem confirmou a postura.
COMMENT ON COLUMN ninhos_quelonios.postura_corrigida_em  IS 'Quando qtd_ovos foi corrigido a partir de uma estimativa (eclosão ou transferência).';
COMMENT ON COLUMN ninhos_quelonios.postura_corrigida_por IS 'Quem confirmou a correção da postura estimada (auth.uid() no momento do salvamento).';

-- ── 2. Onde a apuração acontece: eclosão e transferência ───────
-- Ambas já referenciam ninhos_quelonios(id) via ninho_id; a correção
-- viaja DENTRO do registro (mesmo padrão do checklist DVIR do Frota,
-- migration 204) — nunca um segundo .update() do cliente, que
-- poderia falhar sozinho na fila offline e deixar o ninho desatualizado.
ALTER TABLE eclosoes_ninho
  ADD COLUMN postura_corrigida smallint CHECK (postura_corrigida >= 0);
COMMENT ON COLUMN eclosoes_ninho.postura_corrigida IS
  'Preenchido só quando o monitor confirma, com um toque, a correção da postura estimada do ninho a partir do total apurado na eclosão. NULL = não corrigido nesta eclosão.';

ALTER TABLE transferencias_ninho
  ADD COLUMN postura_corrigida smallint CHECK (postura_corrigida >= 0);
COMMENT ON COLUMN transferencias_ninho.postura_corrigida IS
  'Preenchido só quando o monitor confirma a correção da postura estimada a partir da contagem real feita ao transferir os ovos. NULL = não corrigido nesta transferência.';

-- ── 3. Trigger — aplica a correção no ninho, idempotente ───────
-- Só corrige se o ninho estiver em 'estimado' (ou já 'confirmado_
-- eclosao', permitindo reforço por uma 2ª apuração) — nunca mexe num
-- ninho 'contado': ali qualquer divergência é inconsistência de
-- verdade a ser conferida pelo monitor/gestão, não uma correção
-- esperada. Guarda contra bug de cliente que envie o campo por engano.
CREATE OR REPLACE FUNCTION trg_bio_aplicar_postura_corrigida()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NEW.postura_corrigida IS NOT NULL THEN
    UPDATE ninhos_quelonios
       SET qtd_ovos_estimado_original = COALESCE(qtd_ovos_estimado_original, qtd_ovos),
           qtd_ovos                   = NEW.postura_corrigida,
           contagem_ovos_metodo       = 'confirmado_eclosao',
           postura_corrigida_em       = now(),
           postura_corrigida_por      = auth.uid()
     WHERE id = NEW.ninho_id
       AND contagem_ovos_metodo IN ('estimado', 'confirmado_eclosao');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_eclosao_postura_corrigida ON eclosoes_ninho;
CREATE TRIGGER trg_eclosao_postura_corrigida
  AFTER INSERT ON eclosoes_ninho
  FOR EACH ROW EXECUTE FUNCTION trg_bio_aplicar_postura_corrigida();

DROP TRIGGER IF EXISTS trg_transf_postura_corrigida ON transferencias_ninho;
CREATE TRIGGER trg_transf_postura_corrigida
  AFTER INSERT ON transferencias_ninho
  FOR EACH ROW EXECUTE FUNCTION trg_bio_aplicar_postura_corrigida();

-- Trigger roda só via INSERT das tabelas de evento — nunca chamada
-- direta pelo cliente (mesmo cuidado da 179, achado pelo advisor).
REVOKE ALL ON FUNCTION trg_bio_aplicar_postura_corrigida() FROM PUBLIC, anon, authenticated;

-- ── 4. Views — coluna nova SEMPRE ao final (CREATE OR REPLACE VIEW
--    não aceita reordenar, erro 42P16) ──────────────────────────
-- Reconstruída a partir do pg_get_viewdef() REAL de produção (mesma
-- lição da migration 321 — a view local pode não refletir drift).
-- ⚠️ Achado nesta entrega: CREATE OR REPLACE VIEW NÃO preserva
-- reloptions — as duas views abaixo tinham security_invoker=true
-- (padrão do projeto, mig. 165) e o replace as devolveria ao padrão
-- (roda com privilégio do CRIADOR) se as duas ALTER VIEW ao final
-- desta seção não reafirmassem a opção explicitamente. Vale para
-- qualquer CREATE OR REPLACE VIEW futuro numa view com esse reloption.
CREATE OR REPLACE VIEW vw_ninhos_validacao AS
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
    g.id AS grupo_id,
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
    n.postura_corrigida_em
   FROM ninhos_quelonios n
     LEFT JOIN temporadas_biomonitor tmp ON tmp.id = n.temporada_id
     LEFT JOIN praias_monitoramento p ON p.id = n.praia_id
     LEFT JOIN praias_monitoramento pa ON pa.id = n.praia_atual_id
     LEFT JOIN unidades_conservacao uc ON uc.id = n.uc_id
     LEFT JOIN monitores_biodiversidade mon ON mon.id = n.monitor_id
     LEFT JOIN grupos_biomonitor g ON g.id = n.grupo_id
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

-- vw_praias_biomonitor — contadores de acompanhamento por praia
-- (reconstruída do pg_get_viewdef() real de produção, mesma lição).
CREATE OR REPLACE VIEW vw_praias_biomonitor AS
SELECT p.id,
    p.codigo,
    p.nome,
    p.comunidade,
    p.municipio,
    p.uc_id,
    p.tipo_localizacao,
    p.localizacao_referencia,
        CASE
            WHEN p.tipo_localizacao = 'dentro_uc'::tipo_localizacao_praia THEN COALESCE(uc.nome, '—'::text)
            ELSE COALESCE(p.localizacao_referencia,
            CASE p.tipo_localizacao
                WHEN 'terra_indigena'::tipo_localizacao_praia THEN 'Terra Indígena'::text
                WHEN 'area_municipal'::tipo_localizacao_praia THEN 'Área Municipal'::text
                WHEN 'margem_livre'::tipo_localizacao_praia THEN 'Margem Livre'::text
                ELSE 'Outro'::text
            END)
        END AS area_display,
    p.programa_id,
    p.grupo_id,
    g.nome AS grupo_nome,
    p.monitor_responsavel_id,
    p.experimental,
    p.comprimento_m,
    p.area_ha,
    round(COALESCE(p.area_ha, 0::numeric) * 10000::numeric, 2) AS area_m2,
    p.periodo_inicio,
    p.periodo_fim,
    p.ativa,
        CASE
            WHEN p.ponto_acesso IS NOT NULL THEN st_y(p.ponto_acesso)
            ELSE NULL::double precision
        END AS lat,
        CASE
            WHEN p.ponto_acesso IS NOT NULL THEN st_x(p.ponto_acesso)
            ELSE NULL::double precision
        END AS lng,
    st_asgeojson(p.ponto_acesso) AS ponto_geojson,
    st_asgeojson(p.area_geom) AS area_geojson,
    p.sigla,
    m.nome_completo AS monitor_responsavel,
    uc.nome AS uc_nome,
    uc.sigla AS uc_sigla,
    prog.nome AS programa_nome,
    count(DISTINCT n.id) AS ninhos_total,
    count(DISTINCT n.id) FILTER (WHERE n.status = 'encontrado'::status_ninho) AS ninhos_encontrados,
    count(DISTINCT n.id) FILTER (WHERE n.status = 'transferido'::status_ninho) AS ninhos_transferidos,
    count(DISTINCT n.id) FILTER (WHERE n.status = ANY (ARRAY['eclodido'::status_ninho, 'em_bercario'::status_ninho, 'soltado'::status_ninho])) AS ninhos_eclodidos,
    count(DISTINCT n.id) FILTER (WHERE n.status = 'perdido'::status_ninho) AS ninhos_perdidos,
    ( SELECT count(*) AS count
           FROM ninhos_quelonios x
          WHERE x.praia_id = p.id AND x.praia_atual_id = p.id) AS ninhos_proprios,
    ( SELECT count(*) AS count
           FROM ninhos_quelonios x
          WHERE x.praia_id = p.id AND x.praia_atual_id IS DISTINCT FROM p.id) AS ninhos_enviados,
    ( SELECT count(*) AS count
           FROM ninhos_quelonios x
          WHERE x.praia_atual_id = p.id AND x.praia_id IS DISTINCT FROM p.id) AS ninhos_recebidos,
    ( SELECT count(*) AS count
           FROM ninhos_quelonios x
          WHERE x.praia_atual_id = p.id) AS ninhos_incubando_aqui,
    count(DISTINCT n.id) FILTER (WHERE n.especie = 'tracaja'::especie_quelonio) AS ninhos_tracaja,
    count(DISTINCT n.id) FILTER (WHERE n.especie = 'tartaruga'::especie_quelonio) AS ninhos_tartaruga,
    count(DISTINCT n.id) FILTER (WHERE n.especie = 'cabecudo'::especie_quelonio) AS ninhos_cabecudo,
    count(DISTINCT n.id) FILTER (WHERE n.especie = 'pitiU'::especie_quelonio) AS ninhos_pitiu,
    count(DISTINCT n.id) FILTER (WHERE n.especie = 'cupido'::especie_quelonio) AS ninhos_cupido,
    count(DISTINCT n.id) FILTER (WHERE n.status_validacao = 'pendente'::status_validacao_bio) AS ninhos_pendentes_validacao,
    COALESCE(sum(n.qtd_ovos), 0::bigint) AS ovos_postura_total,
    COALESCE(sum(n.ovos_integros), 0::bigint) AS ovos_integros_total,
    COALESCE(sum(n.ovos_descartados), 0::bigint) AS ovos_descartados_total,
    round(avg(n.dist_rio_m), 1) AS dist_rio_media_m,
    ( SELECT COALESCE(sum(t.qtd_ovos), 0::bigint) AS "coalesce"
           FROM transferencias_ninho t
             JOIN ninhos_quelonios x ON x.id = t.ninho_id
          WHERE x.praia_id = p.id) AS ovos_transferidos,
    ( SELECT COALESCE(sum(e.filhotes_vivos), 0::bigint) AS "coalesce"
           FROM eclosoes_ninho e
             JOIN ninhos_quelonios x ON x.id = e.ninho_id
          WHERE x.praia_id = p.id) AS filhotes_vivos,
    ( SELECT COALESCE(sum(e.filhotes_mortos), 0::bigint) AS "coalesce"
           FROM eclosoes_ninho e
             JOIN ninhos_quelonios x ON x.id = e.ninho_id
          WHERE x.praia_id = p.id) AS filhotes_mortos,
    ( SELECT COALESCE(sum(e.ovos_nao_nascidos), 0::bigint) AS "coalesce"
           FROM eclosoes_ninho e
             JOIN ninhos_quelonios x ON x.id = e.ninho_id
          WHERE x.praia_id = p.id) AS ovos_nao_nascidos,
    ( SELECT round(100.0 * COALESCE(sum(e.filhotes_vivos), 0::bigint)::numeric / NULLIF(COALESCE(sum(e.filhotes_vivos + e.filhotes_mortos + e.ovos_nao_nascidos), 0::bigint), 0)::numeric, 1) AS round
           FROM eclosoes_ninho e
             JOIN ninhos_quelonios x ON x.id = e.ninho_id
          WHERE x.praia_id = p.id) AS taxa_eclosao_pct,
    ( SELECT count(*) AS count
           FROM eclosoes_ninho e
             JOIN ninhos_quelonios x ON x.id = e.ninho_id
          WHERE x.praia_id = p.id AND e.predacao = 'por_pessoas'::predacao_ninho) AS predacao_pessoas,
    ( SELECT count(*) AS count
           FROM eclosoes_ninho e
             JOIN ninhos_quelonios x ON x.id = e.ninho_id
          WHERE x.praia_id = p.id AND e.predacao = 'por_animais'::predacao_ninho) AS predacao_animais,
    ( SELECT COALESCE(sum(ov.viaveis), 0::numeric) AS "coalesce"
           FROM vw_ninho_ovos ov
             JOIN ninhos_quelonios x ON x.id = ov.ninho_id
          WHERE x.praia_id = p.id) AS ovos_viaveis_total,
    ( SELECT COALESCE(sum(ov.perdas_total), 0::numeric) AS "coalesce"
           FROM vw_ninho_ovos ov
             JOIN ninhos_quelonios x ON x.id = ov.ninho_id
          WHERE x.praia_id = p.id) AS ovos_perdidos_total,
    p.rio,
    ( SELECT COALESCE(sum(e.filhotes_anomalia), 0::bigint) AS "coalesce"
           FROM eclosoes_ninho e
             JOIN ninhos_quelonios x ON x.id = e.ninho_id
          WHERE x.praia_id = p.id) AS filhotes_anomalia,
    count(DISTINCT n.id) FILTER (WHERE n.contagem_ovos_metodo = 'estimado') AS ninhos_postura_estimada,
    count(DISTINCT n.id) FILTER (WHERE n.contagem_ovos_metodo = 'confirmado_eclosao') AS ninhos_postura_confirmada
   FROM praias_monitoramento p
     LEFT JOIN monitores_biodiversidade mb ON mb.id = p.monitor_responsavel_id
     LEFT JOIN usuarios m ON m.id = mb.usuario_id
     LEFT JOIN unidades_conservacao uc ON uc.id = p.uc_id
     LEFT JOIN programas_biomonitoramento prog ON prog.id = p.programa_id
     LEFT JOIN grupos_biomonitor g ON g.id = p.grupo_id
     LEFT JOIN ninhos_quelonios n ON n.praia_id = p.id
  GROUP BY p.id, m.nome_completo, uc.id, prog.id, mb.id, g.id;

ALTER VIEW vw_ninhos_validacao  SET (security_invoker = true);
ALTER VIEW vw_praias_biomonitor SET (security_invoker = true);

-- ── 5. Acompanhamento — app de campo (bio_dados_aba) ────────────
-- Mudança CIRÚRGICA: acrescenta contadores de postura estimada ao
-- JSON já existente, sem alterar o corpo original (CTEs/consultas
-- intactas). Assinatura preservada — CREATE OR REPLACE seguro.
CREATE OR REPLACE FUNCTION bio_dados_aba(p_temporada_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  WITH base AS (
    SELECT
      n.id,
      n.especie,
      n.status,
      n.monitor_id,
      n.data_encontro,
      n.qtd_ovos,
      n.ovos_integros,
      n.ovos_descartados,
      n.dist_rio_m,
      n.temperatura_c,
      n.umidade_pct,
      n.profundidade_cm,
      n.contagem_ovos_metodo,
      p.nome AS praia_nome,
      e.filhotes_vivos,
      e.filhotes_mortos,
      e.ovos_nao_nascidos,
      e.filhotes_anomalia,
      e.predacao,
      e.data_nascimento,
      CASE
        WHEN e.data_nascimento IS NOT NULL AND n.data_encontro IS NOT NULL
        THEN (e.data_nascimento - n.data_encontro)
      END AS dias_incubacao
    FROM ninhos_quelonios n
    LEFT JOIN praias_monitoramento p ON p.id = n.praia_id
    LEFT JOIN LATERAL (
      SELECT filhotes_vivos, filhotes_mortos, ovos_nao_nascidos, filhotes_anomalia, predacao, data_nascimento
      FROM eclosoes_ninho
      WHERE ninho_id = n.id ORDER BY data_nascimento DESC LIMIT 1
    ) e ON true
    WHERE n.grupo_id = v_grupo_id
      AND (p_temporada_id IS NULL OR n.temporada_id = p_temporada_id)
  ),

  agg AS (
    SELECT
      COUNT(*)                                               AS total_ninhos,
      COUNT(*) FILTER (WHERE monitor_id = v_mon_id)         AS meus_ninhos,
      COUNT(*) FILTER (WHERE status = 'encontrado')         AS encontrados,
      COUNT(*) FILTER (WHERE status = 'transferido')        AS transferidos,
      COUNT(*) FILTER (WHERE status IN ('eclodido','em_bercario','soltado')) AS eclodidos,
      COUNT(*) FILTER (WHERE status = 'eclodido')           AS eclodidos_status,
      COUNT(*) FILTER (WHERE status = 'em_bercario')        AS em_bercario,
      COUNT(*) FILTER (WHERE status = 'soltado')            AS soltados,
      COUNT(*) FILTER (WHERE status = 'perdido')            AS perdidos,
      COALESCE(SUM(filhotes_vivos),  0)                     AS filhotes_vivos,
      COALESCE(SUM(filhotes_mortos), 0)                     AS filhotes_mortos,
      COALESCE(SUM(ovos_nao_nascidos), 0)                   AS ovos_nao_nascidos,
      COALESCE(SUM(filhotes_anomalia), 0)                   AS filhotes_anomalia,
      COALESCE(SUM(qtd_ovos), 0)                            AS total_ovos_postura,
      COALESCE(SUM(ovos_integros), 0)                       AS total_ovos_integros,
      COALESCE(SUM(ovos_descartados), 0)                    AS total_ovos_descartados,
      COUNT(*) FILTER (WHERE predacao = 'por_pessoas')      AS predacao_pessoas,
      COUNT(*) FILTER (WHERE predacao = 'por_animais')      AS predacao_animais,
      COUNT(*) FILTER (WHERE predacao = 'nenhuma')          AS sem_predacao,
      ROUND(AVG(dist_rio_m)::numeric, 1)                    AS dist_rio_media_m,
      ROUND(AVG(temperatura_c)::numeric, 1)                 AS temp_media_c,
      ROUND(AVG(umidade_pct)::numeric, 1)                   AS umidade_media_pct,
      ROUND(AVG(profundidade_cm)::numeric, 1)               AS profundidade_media_cm,
      ROUND(AVG(dias_incubacao)::numeric)                   AS incubacao_media_dias,
      COUNT(*) FILTER (WHERE contagem_ovos_metodo = 'estimado')                                          AS postura_estimada_total,
      COUNT(*) FILTER (WHERE contagem_ovos_metodo = 'estimado' AND status IN ('eclodido','em_bercario','soltado','transferido')) AS postura_estimada_pendente_confirmacao,
      COUNT(*) FILTER (WHERE contagem_ovos_metodo = 'confirmado_eclosao')                                 AS postura_confirmada_total
    FROM base
  ),

  por_especie AS (
    SELECT
      especie,
      COUNT(*)                                              AS total,
      COUNT(*) FILTER (WHERE status IN ('eclodido','em_bercario','soltado')) AS eclodidos,
      COALESCE(SUM(filhotes_vivos), 0)                     AS filhotes_vivos,
      ROUND(
        100.0 * COALESCE(SUM(filhotes_vivos), 0) /
        NULLIF(COALESCE(SUM(filhotes_vivos + filhotes_mortos + ovos_nao_nascidos), 0), 0)
      , 1)                                                  AS taxa_eclosao
    FROM base
    GROUP BY especie
    ORDER BY total DESC
  ),

  por_mes AS (
    SELECT
      to_char(date_trunc('month', data_encontro), 'YYYY-MM') AS mes,
      COUNT(*)                                               AS ninhos,
      COUNT(*) FILTER (WHERE status IN ('eclodido','em_bercario','soltado')) AS eclodidos,
      COALESCE(SUM(filhotes_vivos), 0)                      AS filhotes
    FROM base
    WHERE data_encontro IS NOT NULL
    GROUP BY date_trunc('month', data_encontro)
    ORDER BY date_trunc('month', data_encontro)
  ),

  top_praias AS (
    SELECT praia_nome, COUNT(*) AS total
    FROM base
    WHERE praia_nome IS NOT NULL
    GROUP BY praia_nome
    ORDER BY total DESC
    LIMIT 6
  ),

  berc_agg AS (
    SELECT
      COUNT(*) FILTER (WHERE l.status IN ('ativo','soltado')) AS total_lotes,
      COALESCE(SUM(l.qtd_entrada), 0)                         AS total_entrada,
      COALESCE(SUM(ls.soltado), 0)                            AS total_soltado,
      COALESCE(SUM(vlm.mortes), 0)                            AS total_mortalidade
    FROM lotes_bercario l
    LEFT JOIN vw_lotes_bercario_mortalidade vlm ON vlm.lote_id = l.id
    LEFT JOIN LATERAL (
      SELECT COALESCE(SUM(sf.qtd_soltada), 0) AS soltado
      FROM solturas_filhotes sf
      WHERE sf.lote_bercario_id = l.id AND sf.via_bercario = true
    ) ls ON true
    WHERE l.grupo_id = v_grupo_id
      AND (p_temporada_id IS NULL OR l.temporada_id = p_temporada_id)
  ),

  solturas_agg AS (
    SELECT
      COALESCE(SUM(sf.qtd_soltada) FILTER (WHERE sf.via_bercario = false), 0) AS direto_rio,
      COALESCE(SUM(sf.qtd_soltada) FILTER (WHERE sf.via_bercario = true),  0) AS via_bercario
    FROM solturas_filhotes sf
    LEFT JOIN ninhos_quelonios n ON n.id = sf.ninho_id
    WHERE n.grupo_id = v_grupo_id
      AND (p_temporada_id IS NULL OR n.temporada_id = p_temporada_id)
  ),

  oc_tipos AS (
    SELECT ob.tipo, COUNT(*) AS total
    FROM ocorrencias_bercario ob
    JOIN lotes_bercario l ON l.id = ob.lote_id
    WHERE l.grupo_id = v_grupo_id
      AND (p_temporada_id IS NULL OR l.temporada_id = p_temporada_id)
    GROUP BY ob.tipo
    ORDER BY total DESC
  ),

  biometria_serie AS (
    SELECT
      data,
      ROUND(AVG(comp)::numeric, 1) AS comp_medio,
      ROUND(AVG(peso)::numeric, 1) AS peso_medio
    FROM (
      SELECT
        to_char(ob.data_ocorrencia, 'YYYY-MM-DD') AS data,
        ob.comprimento_medio_cm AS comp,
        ob.peso_medio_g AS peso
      FROM ocorrencias_bercario ob
      JOIN lotes_bercario l ON l.id = ob.lote_id
      WHERE ob.tipo = 'biometria'
        AND l.grupo_id = v_grupo_id
        AND (p_temporada_id IS NULL OR l.temporada_id = p_temporada_id)

      UNION ALL

      SELECT
        to_char(bi.data_medicao, 'YYYY-MM-DD') AS data,
        bi.comprimento_cm AS comp,
        bi.peso_g AS peso
      FROM biometrias_individuais bi
      JOIN filhotes_bercario fb ON fb.id = bi.individuo_id
      JOIN lotes_bercario l ON l.id = fb.lote_id
      WHERE l.grupo_id = v_grupo_id
        AND (p_temporada_id IS NULL OR l.temporada_id = p_temporada_id)
    ) todas
    WHERE comp IS NOT NULL OR peso IS NOT NULL
    GROUP BY data
    ORDER BY data
    LIMIT 30
  )

  SELECT jsonb_build_object(
    'meus_ninhos',              a.meus_ninhos,
    'grupo_ninhos',             a.total_ninhos,
    'eclodidos',                a.eclodidos,
    'pendentes',                a.encontrados,
    'filhotes_vivos',           a.filhotes_vivos,
    'filhotes_mortos',          a.filhotes_mortos,
    'ovos_nao_nascidos',        a.ovos_nao_nascidos,
    'filhotes_anomalia',        a.filhotes_anomalia,
    'taxa_anomalia_pct',        ROUND(100.0 * a.filhotes_anomalia / NULLIF(a.filhotes_vivos, 0), 1),
    'total_ovos_postura',       a.total_ovos_postura,
    'total_ovos_integros',      a.total_ovos_integros,
    'total_ovos_descartados',   a.total_ovos_descartados,
    'dist_rio_media_m',         a.dist_rio_media_m,
    'temp_media_c',             a.temp_media_c,
    'umidade_media_pct',        a.umidade_media_pct,
    'profundidade_media_cm',    a.profundidade_media_cm,

    'taxa_eclosao_pct',
      ROUND(100.0 * a.filhotes_vivos /
        NULLIF(a.filhotes_vivos + a.filhotes_mortos + a.ovos_nao_nascidos, 0), 1),

    'taxa_sucesso_nidificacao_pct',
      ROUND(100.0 * a.eclodidos / NULLIF(a.total_ninhos, 0), 1),

    'taxa_fertilidade_pct',
      ROUND(100.0 * a.total_ovos_integros / NULLIF(a.total_ovos_postura, 0), 1),

    'eficiencia_ninho_pct',
      ROUND(100.0 * a.filhotes_vivos / NULLIF(a.total_ovos_integros, 0), 1),

    'taxa_predacao_pct',
      ROUND(100.0 * a.perdidos / NULLIF(a.total_ninhos, 0), 1),

    'taxa_transferencia_pct',
      ROUND(100.0 * a.transferidos / NULLIF(a.total_ninhos, 0), 1),

    'incubacao_media_dias',     a.incubacao_media_dias,

    'postura_estimada_total',               a.postura_estimada_total,
    'postura_estimada_pendente_confirmacao', a.postura_estimada_pendente_confirmacao,
    'postura_confirmada_total',              a.postura_confirmada_total,

    'por_status', jsonb_build_object(
      'encontrado',  a.encontrados,
      'transferido', a.transferidos,
      'eclodido',    a.eclodidos_status,
      'em_bercario', a.em_bercario,
      'soltado',     a.soltados,
      'perdido',     a.perdidos
    ),
    'predacao_breakdown', jsonb_build_object(
      'por_animais', a.predacao_animais,
      'por_pessoas', a.predacao_pessoas,
      'nenhuma',     a.sem_predacao
    ),
    'desfecho_ovos', jsonb_build_object(
      'filhotes_vivos',    a.filhotes_vivos,
      'filhotes_mortos',   a.filhotes_mortos,
      'ovos_nao_nascidos', a.ovos_nao_nascidos,
      'ovos_descartados',  a.total_ovos_descartados
    ),
    'por_especie', (SELECT jsonb_agg(row_to_json(pe)) FROM por_especie pe),
    'por_mes',     (SELECT jsonb_agg(row_to_json(pm)) FROM por_mes pm),
    'top_praias',  (SELECT jsonb_agg(row_to_json(tp)) FROM top_praias tp),

    'bercario_total_lotes',     ba.total_lotes,
    'bercario_total_entrada',   ba.total_entrada,
    'bercario_total_soltado',   ba.total_soltado,
    'bercario_mortalidade',     ba.total_mortalidade,

    'taxa_sobrevivencia_bercario_pct',
      ROUND(100.0 * ba.total_soltado / NULLIF(ba.total_entrada, 0), 1),

    'taxa_mortalidade_bercario_pct',
      ROUND(100.0 * ba.total_mortalidade / NULLIF(ba.total_entrada, 0), 1),

    'solturas_direto_rio',      sa.direto_rio,
    'solturas_via_bercario',    sa.via_bercario,

    'ocorrencias_tipos', (SELECT jsonb_agg(row_to_json(ot)) FROM oc_tipos ot),
    'biometria_serie',   (SELECT jsonb_agg(row_to_json(bs)) FROM biometria_serie bs)

  ) INTO v_result
  FROM agg a, berc_agg ba, solturas_agg sa;

  RETURN v_result;
END;
$function$;

GRANT EXECUTE ON FUNCTION bio_dados_aba TO authenticated;
REVOKE EXECUTE ON FUNCTION bio_dados_aba FROM anon;

-- ── 6. Acompanhamento — relatório oficial (bio_relatorio_completo) ─
-- Bloco novo, aditivo (não mexe nas chaves existentes do JSON):
-- contagem por método na temporada/filtro corrente + o VIÉS da
-- estimativa (postura confirmada − postura estimada original), para
-- calibrar o método de estimativa nas próximas temporadas.
CREATE OR REPLACE FUNCTION bio_relatorio_postura_estimada(
  p_temporada_id uuid DEFAULT NULL,
  p_praia_id     uuid DEFAULT NULL,
  p_uc_id        uuid DEFAULT NULL,
  p_grupo_id     uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'contados',             COUNT(*) FILTER (WHERE n.contagem_ovos_metodo = 'contado'),
    'estimados_pendentes',  COUNT(*) FILTER (WHERE n.contagem_ovos_metodo = 'estimado'),
    'confirmados',          COUNT(*) FILTER (WHERE n.contagem_ovos_metodo = 'confirmado_eclosao'),
    'total_estimados_temporada',
      COUNT(*) FILTER (WHERE n.contagem_ovos_metodo IN ('estimado', 'confirmado_eclosao')),
    'vies_medio_ovos',
      ROUND(AVG(n.qtd_ovos - n.qtd_ovos_estimado_original)
        FILTER (WHERE n.contagem_ovos_metodo = 'confirmado_eclosao'), 1),
    'vies_percentual',
      ROUND(100.0 * AVG(
        (n.qtd_ovos - n.qtd_ovos_estimado_original)::numeric / NULLIF(n.qtd_ovos_estimado_original, 0)
      ) FILTER (WHERE n.contagem_ovos_metodo = 'confirmado_eclosao'), 1)
  )
  FROM ninhos_quelonios n
  WHERE (p_temporada_id IS NULL OR n.temporada_id = p_temporada_id)
    AND (p_praia_id     IS NULL OR n.praia_atual_id = p_praia_id OR n.praia_id = p_praia_id)
    AND (p_uc_id        IS NULL OR n.uc_id = p_uc_id)
    AND (p_grupo_id     IS NULL OR n.grupo_id = p_grupo_id);
$$;

-- Nova função nasce com EXECUTE em PUBLIC (grant padrão do Postgres,
-- não do Supabase) — REVOKE só de anon não fecha isso, é PUBLIC que
-- precisa ser revogado (achado real ao checar o advisor após aplicar).
REVOKE ALL ON FUNCTION bio_relatorio_postura_estimada FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION bio_relatorio_postura_estimada TO authenticated;
