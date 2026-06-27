-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Biomonitor — Eventos de descarte de ovos com motivo
-- ───────────────────────────────────────────────────────────
-- Antes, ovos_descartados (ninhos_quelonios) guardava só a
-- contagem, sem motivo. Agora cada descarte vira um evento com
-- causa (natural / predação / humana) para virar estatística.
-- A contagem total continua em ninhos_quelonios.ovos_descartados;
-- a soma dos eventos (etapa='registro') deve bater com ela.
-- Depende de 074_biomonitor_quelonios e 092_ninho_numero_atual.
-- ═══════════════════════════════════════════════════════════

-- ── 1. Enum da causa ─────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE motivo_descarte AS ENUM ('natural', 'predacao', 'humana');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 2. Tabela de eventos de descarte ─────────────────────────
CREATE TABLE IF NOT EXISTS descartes_ovos (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  uuid_cliente    uuid UNIQUE NOT NULL,           -- idempotência offline
  ninho_id        uuid NOT NULL REFERENCES ninhos_quelonios(id) ON DELETE CASCADE,
  qtd             smallint NOT NULL CHECK (qtd > 0),
  motivo          motivo_descarte NOT NULL,
  etapa           text NOT NULL DEFAULT 'registro', -- registro|visita|eclosao
  data_descarte   date NOT NULL DEFAULT current_date,
  observacoes     text,
  monitor_id      uuid REFERENCES monitores_biodiversidade(id) ON DELETE SET NULL,
  criado_em       timestamptz DEFAULT now(),
  sincronizado_em timestamptz
);

CREATE INDEX IF NOT EXISTS idx_descartes_ninho  ON descartes_ovos (ninho_id);
CREATE INDEX IF NOT EXISTS idx_descartes_motivo ON descartes_ovos (motivo);
CREATE INDEX IF NOT EXISTS idx_descartes_etapa  ON descartes_ovos (ninho_id, etapa);

ALTER TABLE descartes_ovos ENABLE ROW LEVEL SECURITY;

-- Monitor vê os do próprio grupo; gestores/biólogos veem tudo
CREATE POLICY "descartes_select" ON descartes_ovos
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM ninhos_quelonios n
      JOIN monitores_biodiversidade m ON m.grupo_id = n.grupo_id
      WHERE n.id = descartes_ovos.ninho_id AND m.usuario_id = auth.uid()
    )
    OR EXISTS (SELECT 1 FROM usuarios WHERE id = auth.uid()
      AND perfil IN ('tecnico','gestor','super_admin','biologo') AND ativo)
  );

CREATE POLICY "descartes_insert" ON descartes_ovos
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM monitores_biodiversidade m
      WHERE m.usuario_id = auth.uid() AND m.id = descartes_ovos.monitor_id
    )
    OR EXISTS (SELECT 1 FROM usuarios WHERE id = auth.uid()
      AND perfil IN ('tecnico','gestor','super_admin') AND ativo)
  );

-- Monitor pode apagar os próprios (necessário para reconciliar no reenvio
-- de correção: apaga os do ninho e reinsere o novo conjunto)
CREATE POLICY "descartes_delete" ON descartes_ovos
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM monitores_biodiversidade m
      WHERE m.usuario_id = auth.uid() AND m.id = descartes_ovos.monitor_id
    )
    OR EXISTS (SELECT 1 FROM usuarios WHERE id = auth.uid()
      AND perfil IN ('tecnico','gestor','super_admin') AND ativo)
  );

-- ── 3. View para estatística (agregação por causa) ───────────
CREATE OR REPLACE VIEW vw_descartes_ovos
WITH (security_invoker = true)
AS
SELECT
  d.id,
  d.ninho_id,
  d.qtd,
  d.motivo,
  d.etapa,
  d.data_descarte,
  n.especie,
  n.grupo_id,
  n.temporada_id,
  n.praia_id,
  pp.nome  AS praia_nome,
  n.praia_atual_id,
  pa.nome  AS praia_atual_nome,
  uc.nome  AS uc_nome,
  mon.nome_completo AS monitor_nome
FROM descartes_ovos d
JOIN ninhos_quelonios n            ON n.id = d.ninho_id
LEFT JOIN praias_monitoramento pp  ON pp.id = n.praia_id
LEFT JOIN praias_monitoramento pa  ON pa.id = n.praia_atual_id
LEFT JOIN unidades_conservacao uc  ON uc.id = n.uc_id
LEFT JOIN monitores_biodiversidade mon ON mon.id = d.monitor_id;

-- ── 4. vw_ninhos_validacao — recria + quebra de descarte por causa ──
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
  -- Quebra de descartados por causa (eventos de registro)
  (SELECT COALESCE(SUM(qtd),0) FROM descartes_ovos d
     WHERE d.ninho_id = n.id AND d.motivo = 'natural')   AS descartados_natural,
  (SELECT COALESCE(SUM(qtd),0) FROM descartes_ovos d
     WHERE d.ninho_id = n.id AND d.motivo = 'predacao')  AS descartados_predacao,
  (SELECT COALESCE(SUM(qtd),0) FROM descartes_ovos d
     WHERE d.ninho_id = n.id AND d.motivo = 'humana')    AS descartados_humana,
  n.dist_rio_m,
  n.dist_rio_metodo,
  n.temperatura_c,
  n.umidade_pct,
  n.profundidade_cm,
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
  e.predacao
FROM ninhos_quelonios n
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
