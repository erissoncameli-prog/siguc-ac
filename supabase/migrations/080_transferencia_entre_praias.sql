-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Biomonitor — Transferência de ninhos ENTRE praias
-- ───────────────────────────────────────────────────────────
-- Permite remanejar ninhos de uma praia para outra praia do
-- sistema (tipicamente uma "praia experimental"/berçário que
-- recebe ninhos de várias praias além dos seus próprios).
--
-- Conceito de procedência × localização:
--   praia_id        (ninhos_quelonios) = ORIGEM, onde foi desovado.
--                                        IMUTÁVEL — identidade do ninho.
--   praia_atual_id  (ninhos_quelonios) = onde está incubando AGORA.
--                                        Muda a cada transferência.
-- Depende de 074_biomonitor_quelonios e 078_vw_praias_ids.
-- ═══════════════════════════════════════════════════════════

-- ── 1. Praia experimental / receptora ────────────────────────
ALTER TABLE praias_monitoramento
  ADD COLUMN IF NOT EXISTS experimental boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN praias_monitoramento.experimental IS
  'Praia/berçário que recebe ninhos transferidos de outras praias, além dos próprios.';

-- ── 2. Destino da transferência aponta para uma praia do sistema ──
DO $$ BEGIN
  CREATE TYPE motivo_transferencia AS ENUM (
    'risco_inundacao', 'predacao', 'erosao', 'concentracao_manejo', 'pesquisa', 'outro'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE transferencias_ninho
  ADD COLUMN IF NOT EXISTS praia_destino_id uuid
    REFERENCES praias_monitoramento(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS motivo motivo_transferencia;

CREATE INDEX IF NOT EXISTS idx_transf_praia_destino
  ON transferencias_ninho (praia_destino_id);

-- ── 3. Localização atual do ninho ────────────────────────────
ALTER TABLE ninhos_quelonios
  ADD COLUMN IF NOT EXISTS praia_atual_id uuid
    REFERENCES praias_monitoramento(id) ON DELETE SET NULL;

-- Backfill: ninho sem transferência está na própria praia de origem.
UPDATE ninhos_quelonios
   SET praia_atual_id = praia_id
 WHERE praia_atual_id IS NULL;

-- Ninhos já transferidos com destino registrado: aponta para o último destino.
UPDATE ninhos_quelonios n
   SET praia_atual_id = t.praia_destino_id
  FROM (
    SELECT DISTINCT ON (ninho_id) ninho_id, praia_destino_id
      FROM transferencias_ninho
     WHERE praia_destino_id IS NOT NULL
     ORDER BY ninho_id, data_transferencia DESC, criado_em DESC
  ) t
 WHERE t.ninho_id = n.id;

CREATE INDEX IF NOT EXISTS idx_ninhos_praia_atual
  ON ninhos_quelonios (praia_atual_id);

-- ── 4. Trigger: transferência atualiza status E localização atual ──
-- (substitui a versão de 074, que só atualizava o status)
CREATE OR REPLACE FUNCTION trg_transf_atualizar_status_ninho()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  UPDATE ninhos_quelonios
     SET status = CASE WHEN status = 'encontrado' THEN 'transferido'::status_ninho
                       ELSE status END,
         praia_atual_id = COALESCE(NEW.praia_destino_id, praia_atual_id),
         atualizado_em  = now()
   WHERE id = NEW.ninho_id;
  RETURN NEW;
END;
$$;

-- ── 5. vw_praias_biomonitor — recria (base 078) + experimental + procedência ──
DROP VIEW IF EXISTS vw_praias_biomonitor;

CREATE VIEW vw_praias_biomonitor
WITH (security_invoker = true)
AS
SELECT
  p.id,
  p.codigo,
  p.nome,
  p.comunidade,
  p.municipio,
  p.uc_id,
  p.programa_id,
  p.monitor_responsavel_id,
  p.experimental,
  p.comprimento_m,
  p.area_ha,
  p.periodo_inicio,
  p.periodo_fim,
  p.ativa,
  CASE WHEN p.ponto_acesso IS NOT NULL THEN ST_Y(p.ponto_acesso) END AS lat,
  CASE WHEN p.ponto_acesso IS NOT NULL THEN ST_X(p.ponto_acesso) END AS lng,
  m.nome_completo   AS monitor_responsavel,
  uc.nome           AS uc_nome,
  uc.sigla          AS uc_sigla,
  prog.nome         AS programa_nome,

  -- Ninhos por status (por ORIGEM = praia_id)
  COUNT(DISTINCT n.id)                                                AS ninhos_total,
  COUNT(DISTINCT n.id) FILTER (WHERE n.status = 'encontrado')         AS ninhos_encontrados,
  COUNT(DISTINCT n.id) FILTER (WHERE n.status = 'transferido')        AS ninhos_transferidos,
  COUNT(DISTINCT n.id) FILTER (WHERE n.status = 'eclodido')           AS ninhos_eclodidos,
  COUNT(DISTINCT n.id) FILTER (WHERE n.status = 'perdido')            AS ninhos_perdidos,

  -- Procedência (origem × localização atual)
  (SELECT COUNT(*) FROM ninhos_quelonios x
     WHERE x.praia_id = p.id AND x.praia_atual_id = p.id)             AS ninhos_proprios,
  (SELECT COUNT(*) FROM ninhos_quelonios x
     WHERE x.praia_id = p.id AND x.praia_atual_id IS DISTINCT FROM p.id) AS ninhos_enviados,
  (SELECT COUNT(*) FROM ninhos_quelonios x
     WHERE x.praia_atual_id = p.id AND x.praia_id IS DISTINCT FROM p.id) AS ninhos_recebidos,
  (SELECT COUNT(*) FROM ninhos_quelonios x
     WHERE x.praia_atual_id = p.id)                                   AS ninhos_incubando_aqui,

  -- Por espécie
  COUNT(DISTINCT n.id) FILTER (WHERE n.especie = 'tracaja')           AS ninhos_tracaja,
  COUNT(DISTINCT n.id) FILTER (WHERE n.especie = 'tartaruga')         AS ninhos_tartaruga,
  COUNT(DISTINCT n.id) FILTER (WHERE n.especie = 'cabecudo')          AS ninhos_cabecudo,
  COUNT(DISTINCT n.id) FILTER (WHERE n.especie = 'pitiU')             AS ninhos_pitiu,
  COUNT(DISTINCT n.id) FILTER (WHERE n.especie = 'cupido')            AS ninhos_cupido,

  -- Validação
  COUNT(DISTINCT n.id) FILTER (WHERE n.status_validacao = 'pendente') AS ninhos_pendentes_validacao,

  -- Ovos da postura
  COALESCE(SUM(n.qtd_ovos), 0)                                        AS ovos_postura_total,
  COALESCE(SUM(n.ovos_integros), 0)                                   AS ovos_integros_total,
  COALESCE(SUM(n.ovos_descartados), 0)                                AS ovos_descartados_total,
  ROUND(AVG(n.dist_rio_m)::numeric, 1)                                AS dist_rio_media_m,

  -- Ovos transferidos e eclosão
  COALESCE(SUM(t.qtd_ovos), 0)                                        AS ovos_transferidos,
  COALESCE(SUM(e.filhotes_vivos), 0)                                  AS filhotes_vivos,
  COALESCE(SUM(e.filhotes_mortos), 0)                                 AS filhotes_mortos,
  COALESCE(SUM(e.ovos_nao_nascidos), 0)                               AS ovos_nao_nascidos,
  ROUND(
    100.0 * COALESCE(SUM(e.filhotes_vivos), 0) /
    NULLIF(COALESCE(SUM(e.filhotes_vivos + e.filhotes_mortos + e.ovos_nao_nascidos), 0), 0)
  , 1)                                                                AS taxa_eclosao_pct,

  -- Predação
  COUNT(*) FILTER (WHERE e.predacao = 'por_pessoas')                  AS predacao_pessoas,
  COUNT(*) FILTER (WHERE e.predacao = 'por_animais')                  AS predacao_animais

FROM praias_monitoramento p
LEFT JOIN monitores_biodiversidade mb ON mb.id = p.monitor_responsavel_id
LEFT JOIN usuarios m   ON m.id = mb.usuario_id
LEFT JOIN unidades_conservacao uc   ON uc.id = p.uc_id
LEFT JOIN programas_biomonitoramento prog ON prog.id = p.programa_id
LEFT JOIN ninhos_quelonios n        ON n.praia_id = p.id
LEFT JOIN transferencias_ninho t    ON t.ninho_id = n.id
LEFT JOIN eclosoes_ninho e          ON e.ninho_id = n.id
GROUP BY p.id, m.nome_completo, uc.id, prog.id, mb.id;

-- ── 6. Fluxo de transferências (planejamento / relatórios) ────
CREATE OR REPLACE VIEW vw_transferencias_praia
WITH (security_invoker = true)
AS
SELECT
  t.id,
  t.ninho_id,
  n.numero_ninho,
  n.especie,
  t.data_transferencia,
  t.qtd_ovos,
  t.motivo,
  t.local_destino,
  t.observacoes,
  po.id   AS praia_origem_id,
  po.nome AS praia_origem_nome,
  pd.id   AS praia_destino_id,
  pd.nome AS praia_destino_nome,
  pd.experimental AS destino_experimental,
  mon.nome_completo AS monitor_nome,
  t.criado_em
FROM transferencias_ninho t
JOIN ninhos_quelonios n          ON n.id = t.ninho_id
LEFT JOIN praias_monitoramento po  ON po.id = n.praia_id
LEFT JOIN praias_monitoramento pd  ON pd.id = t.praia_destino_id
LEFT JOIN monitores_biodiversidade mon ON mon.id = t.monitor_id;
