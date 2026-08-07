-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Biomonitor — Cadastro de equipamento mais completo
--
-- O cadastro original (227) tinha só descrição/plaqueta/código/foto/
-- status — insuficiente para controle de patrimônio real. Adiciona:
-- categoria (orienta quais campos extras o formulário mostra),
-- vínculo com grupo/UC (equipamento pertence a um grupo de
-- monitoramento, não a um pool geral da SEMA — decisão de produto),
-- identificação de fabricante (marca/modelo/número de série),
-- rastreabilidade não financeira (data de aquisição/fornecedor — sem
-- valor pago nem nota fiscal, fora do escopo por decisão de produto)
-- e `especificacoes jsonb` para os campos que só fazem sentido por
-- categoria (ex.: IMEI de GPS, motor de embarcação) — evita criar
-- tabela nova a cada tipo de equipamento novo.
--
-- Efeito colateral: com o vínculo a grupo, `biomonitor_registrar_
-- cautela` passa a exigir que o equipamento seja do MESMO grupo do
-- monitor que está assinando (mesmo espírito da trava de veículo do
-- Frota, migration 180 — validação server-side, não só no app).
-- ═══════════════════════════════════════════════════════════

CREATE TYPE categoria_biomonitor_equipamento AS ENUM (
  'gps', 'camera', 'equip_medicao', 'equip_mergulho', 'embarcacao',
  'radio_comunicacao', 'informatica', 'mobiliario_campo', 'outro'
);

ALTER TABLE biomonitor_equipamentos
  ADD COLUMN categoria      categoria_biomonitor_equipamento NOT NULL DEFAULT 'outro',
  ADD COLUMN grupo_id       uuid REFERENCES grupos_biomonitor(id),
  ADD COLUMN marca          text,
  ADD COLUMN modelo         text,
  ADD COLUMN numero_serie   text,
  ADD COLUMN data_aquisicao date,
  ADD COLUMN fornecedor     text,
  ADD COLUMN especificacoes jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE biomonitor_equipamentos ALTER COLUMN categoria DROP DEFAULT;

CREATE INDEX idx_bioeq_grupo ON biomonitor_equipamentos (grupo_id);

-- ── RPC de cautela: agora exige equipamento do mesmo grupo do monitor ──
CREATE OR REPLACE FUNCTION biomonitor_registrar_cautela(
  p_uuid_cliente uuid,
  p_equipamento_ids uuid[],
  p_termo_versao_id uuid,
  p_lat double precision DEFAULT NULL,
  p_lng double precision DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_monitor_id uuid;
  v_grupo_id   uuid;
  v_cautela_id uuid;
  v_eq_id uuid;
BEGIN
  SELECT id, grupo_id INTO v_monitor_id, v_grupo_id FROM monitores_biodiversidade
    WHERE usuario_id = auth.uid() AND status = 'ativo';
  IF v_monitor_id IS NULL THEN
    RAISE EXCEPTION 'Monitor não encontrado ou inativo';
  END IF;

  SELECT id INTO v_cautela_id FROM biomonitor_cautelas WHERE uuid_cliente = p_uuid_cliente;
  IF v_cautela_id IS NOT NULL THEN
    RETURN v_cautela_id;
  END IF;

  IF p_equipamento_ids IS NULL OR array_length(p_equipamento_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'Informe ao menos um equipamento';
  END IF;

  IF EXISTS (
    SELECT 1 FROM biomonitor_equipamentos
    WHERE id = ANY(p_equipamento_ids)
      AND (status <> 'disponivel' OR grupo_id IS DISTINCT FROM v_grupo_id)
  ) THEN
    RAISE EXCEPTION 'Um ou mais equipamentos não estão disponíveis para o seu grupo';
  END IF;

  INSERT INTO biomonitor_cautelas (uuid_cliente, monitor_id, termo_versao_id, lat, lng)
  VALUES (p_uuid_cliente, v_monitor_id, p_termo_versao_id, p_lat, p_lng)
  RETURNING id INTO v_cautela_id;

  FOREACH v_eq_id IN ARRAY p_equipamento_ids LOOP
    INSERT INTO biomonitor_cautela_itens (cautela_id, equipamento_id)
    VALUES (v_cautela_id, v_eq_id);
    UPDATE biomonitor_equipamentos SET status = 'em_cautela' WHERE id = v_eq_id;
  END LOOP;

  INSERT INTO lgpd_aceites (usuario_id, versao_id)
  VALUES (auth.uid(), p_termo_versao_id)
  ON CONFLICT DO NOTHING;

  RETURN v_cautela_id;
END;
$$;

REVOKE ALL ON FUNCTION biomonitor_registrar_cautela(uuid, uuid[], uuid, double precision, double precision) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION biomonitor_registrar_cautela(uuid, uuid[], uuid, double precision, double precision) TO authenticated;

-- ── Views: incluir os novos campos ──────────────────────────────
-- DROP explícito porque `e.*` muda de posição de colunas com os
-- campos novos — CREATE OR REPLACE VIEW não aceita reordenar/inserir
-- coluna no meio da projeção existente.
DROP VIEW IF EXISTS vw_biomonitor_cautelas_detalhe;
DROP VIEW IF EXISTS vw_biomonitor_equipamentos_status;

CREATE VIEW vw_biomonitor_cautelas_detalhe
WITH (security_invoker = true) AS
SELECT
  c.id, c.uuid_cliente, c.status, c.assinado_em, c.lat, c.lng,
  m.id AS monitor_id, m.nome_completo AS monitor_nome,
  dv.versao AS termo_versao,
  (SELECT json_agg(json_build_object(
      'item_id', ci.id,
      'equipamento_id', e.id,
      'codigo', e.codigo,
      'plaqueta', e.plaqueta,
      'descricao', e.descricao,
      'categoria', e.categoria,
      'entregue_em', ci.entregue_em,
      'devolvido_em', ci.devolvido_em
    ) ORDER BY e.descricao)
   FROM biomonitor_cautela_itens ci
   JOIN biomonitor_equipamentos e ON e.id = ci.equipamento_id
   WHERE ci.cautela_id = c.id) AS itens
FROM biomonitor_cautelas c
JOIN monitores_biodiversidade m ON m.id = c.monitor_id
JOIN lgpd_documento_versoes dv ON dv.id = c.termo_versao_id;

CREATE VIEW vw_biomonitor_equipamentos_status
WITH (security_invoker = true) AS
SELECT
  e.*,
  g.nome AS grupo_nome,
  g.uc_id AS uc_id,
  ci.cautela_id AS cautela_aberta_id,
  m.nome_completo AS com_monitor
FROM biomonitor_equipamentos e
LEFT JOIN grupos_biomonitor g ON g.id = e.grupo_id
LEFT JOIN biomonitor_cautela_itens ci
  ON ci.equipamento_id = e.id AND ci.devolvido_em IS NULL
LEFT JOIN biomonitor_cautelas c ON c.id = ci.cautela_id AND c.status IN ('aberta','parcial')
LEFT JOIN monitores_biodiversidade m ON m.id = c.monitor_id;
