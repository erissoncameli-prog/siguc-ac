-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Biomonitor — Equipamentos em cautela + termo de
-- responsabilidade assinado no app
--
-- Cadastro do bem (descrição, plaqueta, código interno, foto) é
-- feito na mesa (biomonitor-equipamentos.html, perfil
-- tecnico/gestor/super_admin). A cautela — um ou mais equipamentos
-- entregues de uma vez — é assinada pelo monitor no app
-- (pages/biomonitor.html), aceitando a versão vigente do termo de
-- responsabilidade (reaproveita lgpd_documentos/lgpd_documento_versoes
-- e lgpd_aceites, migration 212 — mesma âncora em auth.users, mesmo
-- hash gerado pelo banco). Devolução só pela mesa, por decisão de
-- produto (evita monitor "devolver" sem entregar o bem de volta).
--
-- Foto do bem usa o bucket já privado `biomonitor-fotos`
-- (migration 210) — sem bucket novo.
-- ═══════════════════════════════════════════════════════════

-- ── Catálogo de equipamentos (mesa) ────────────────────────────

CREATE TYPE status_biomonitor_equipamento AS ENUM (
  'disponivel', 'em_cautela', 'manutencao', 'baixado'
);

CREATE TABLE biomonitor_equipamentos (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- código interno gerado pelo sistema (trigger abaixo), molde
  -- ABAST-AAAA-NNNN do Frota (migration 175).
  codigo       text UNIQUE,
  -- plaqueta física da SEMA, quando existir; texto livre porque
  -- nem todo bem tem numeração patrimonial já atribuída.
  plaqueta     text,
  descricao    text NOT NULL,
  foto_url     text,
  status       status_biomonitor_equipamento NOT NULL DEFAULT 'disponivel',
  observacoes  text,
  criado_por   uuid REFERENCES usuarios(id),
  criado_em    timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE biomonitor_equipamentos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "bioeq_select" ON biomonitor_equipamentos
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "bioeq_write" ON biomonitor_equipamentos
  FOR ALL TO authenticated USING (
    EXISTS (SELECT 1 FROM usuarios WHERE id = auth.uid()
      AND perfil IN ('tecnico','gestor','super_admin') AND ativo)
  );

CREATE TRIGGER trg_bioeq_updated
  BEFORE UPDATE ON biomonitor_equipamentos
  FOR EACH ROW EXECUTE FUNCTION touch_atualizado_em();

-- Gerador de código sequencial BIOEQ-AAAA-NNNN (mesmo molde da
-- migration 175 — frota_gerar_codigo_abastecimento).
CREATE TABLE biomonitor_eq_contador (
  ano    int PRIMARY KEY,
  ultimo int NOT NULL DEFAULT 0
);
ALTER TABLE biomonitor_eq_contador ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION biomonitor_gerar_codigo_equipamento()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_ano int;
  v_num int;
BEGIN
  IF NEW.codigo IS NOT NULL THEN RETURN NEW; END IF;
  v_ano := EXTRACT(YEAR FROM now())::int;
  INSERT INTO biomonitor_eq_contador (ano, ultimo) VALUES (v_ano, 1)
    ON CONFLICT (ano) DO UPDATE SET ultimo = biomonitor_eq_contador.ultimo + 1
    RETURNING ultimo INTO v_num;
  NEW.codigo := 'BIOEQ-' || v_ano || '-' || lpad(v_num::text, 4, '0');
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_bioeq_codigo
  BEFORE INSERT ON biomonitor_equipamentos
  FOR EACH ROW EXECUTE FUNCTION biomonitor_gerar_codigo_equipamento();

-- Só a trigger deve gerar o código — mesmo achado de segurança da
-- migration 179 (revogar EXECUTE de função que só deve rodar via
-- trigger, nunca chamada direto pelo cliente).
REVOKE EXECUTE ON FUNCTION biomonitor_gerar_codigo_equipamento() FROM PUBLIC, anon, authenticated;

-- ── Termo de responsabilidade (documento versionado) ───────────

INSERT INTO lgpd_documentos (tipo, titulo, exige_aceite, publico, ativo)
VALUES ('termo_equipamento', 'Termo de Responsabilidade — Equipamentos de Campo (Biomonitor)', true, false, true)
ON CONFLICT (tipo, (COALESCE(app, ''))) DO NOTHING;

INSERT INTO lgpd_documento_versoes (documento_id, versao, conteudo_md, vigente_desde, resumo_mudancas)
SELECT id, '1.0',
$md$# Termo de Responsabilidade — Equipamentos de Campo

Ao assinar este termo no momento do recebimento de um ou mais
equipamentos em cautela, o monitor declara estar ciente de que:

1. O(s) equipamento(s) listado(s) nesta cautela são patrimônio da
   SEMA-AC e foram entregues para uso exclusivo nas atividades do
   Programa de Biomonitoramento.
2. É responsável pela guarda, conservação e uso adequado do(s)
   bem(ns) enquanto durar a cautela.
3. Avarias, perda ou extravio devem ser comunicados à coordenação do
   programa assim que identificados.
4. A devolução do(s) equipamento(s) é confirmada pela gestão, mediante
   conferência física do bem.
$md$,
  CURRENT_DATE, 'Versão inicial'
FROM lgpd_documentos WHERE tipo = 'termo_equipamento'
ON CONFLICT DO NOTHING;

-- ── Cautelas (assinadas no app) ─────────────────────────────────

CREATE TABLE biomonitor_cautelas (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  uuid_cliente    uuid UNIQUE NOT NULL,
  monitor_id      uuid NOT NULL REFERENCES monitores_biodiversidade(id),
  termo_versao_id uuid NOT NULL REFERENCES lgpd_documento_versoes(id),
  assinado_em     timestamptz NOT NULL DEFAULT now(),
  status          text NOT NULL DEFAULT 'aberta'
                    CHECK (status IN ('aberta','parcial','devolvida')),
  lat             double precision,
  lng             double precision,
  criado_em       timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE biomonitor_cautelas ENABLE ROW LEVEL SECURITY;

-- Leitura: o próprio monitor (dono da cautela) ou gestão de mesa.
-- Sem policy de INSERT/UPDATE — só grava via RPC SECURITY DEFINER
-- (mesmo padrão de lgpd_aceites e frota_inspecoes).
CREATE POLICY "biocaut_select" ON biomonitor_cautelas
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM monitores_biodiversidade m
      WHERE m.id = monitor_id AND m.usuario_id = auth.uid())
    OR EXISTS (SELECT 1 FROM usuarios WHERE id = auth.uid()
      AND perfil IN ('tecnico','gestor','super_admin') AND ativo)
  );

CREATE TABLE biomonitor_cautela_itens (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cautela_id          uuid NOT NULL REFERENCES biomonitor_cautelas(id) ON DELETE CASCADE,
  equipamento_id      uuid NOT NULL REFERENCES biomonitor_equipamentos(id),
  entregue_em         timestamptz NOT NULL DEFAULT now(),
  devolvido_em        timestamptz,
  devolvido_por       uuid REFERENCES usuarios(id),
  observacao_devolucao text,
  UNIQUE (cautela_id, equipamento_id)
);

ALTER TABLE biomonitor_cautela_itens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "biocautitem_select" ON biomonitor_cautela_itens
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM biomonitor_cautelas c
      JOIN monitores_biodiversidade m ON m.id = c.monitor_id
      WHERE c.id = cautela_id AND m.usuario_id = auth.uid())
    OR EXISTS (SELECT 1 FROM usuarios WHERE id = auth.uid()
      AND perfil IN ('tecnico','gestor','super_admin') AND ativo)
  );

-- ── RPC: monitor assina a cautela no app ────────────────────────
-- Idempotente por uuid_cliente (fila offline do Biomonitor, mesmo
-- padrão do check-out/check-in do Frota — migration 198). Recusa
-- equipamento que já esteja em cautela aberta com outro monitor.
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
  v_cautela_id uuid;
  v_eq_id uuid;
BEGIN
  SELECT id INTO v_monitor_id FROM monitores_biodiversidade
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
    WHERE id = ANY(p_equipamento_ids) AND status <> 'disponivel'
  ) THEN
    RAISE EXCEPTION 'Um ou mais equipamentos não estão disponíveis para cautela';
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

-- ── RPC: gestão devolve equipamento(s) na mesa ──────────────────
CREATE OR REPLACE FUNCTION biomonitor_devolver_equipamentos(
  p_cautela_id uuid,
  p_equipamento_ids uuid[],
  p_observacao text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_pendentes int;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM usuarios WHERE id = auth.uid()
    AND perfil IN ('tecnico','gestor','super_admin') AND ativo) THEN
    RAISE EXCEPTION 'Sem permissão para devolver equipamento';
  END IF;

  UPDATE biomonitor_cautela_itens
     SET devolvido_em = now(), devolvido_por = auth.uid(), observacao_devolucao = p_observacao
   WHERE cautela_id = p_cautela_id
     AND equipamento_id = ANY(p_equipamento_ids)
     AND devolvido_em IS NULL;

  UPDATE biomonitor_equipamentos SET status = 'disponivel'
   WHERE id = ANY(p_equipamento_ids);

  SELECT count(*) INTO v_pendentes FROM biomonitor_cautela_itens
   WHERE cautela_id = p_cautela_id AND devolvido_em IS NULL;

  UPDATE biomonitor_cautelas
     SET status = CASE WHEN v_pendentes = 0 THEN 'devolvida' ELSE 'parcial' END
   WHERE id = p_cautela_id;
END;
$$;

REVOKE ALL ON FUNCTION biomonitor_devolver_equipamentos(uuid, uuid[], text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION biomonitor_devolver_equipamentos(uuid, uuid[], text) TO authenticated;

-- ── Views de relatório ───────────────────────────────────────────

CREATE OR REPLACE VIEW vw_biomonitor_cautelas_detalhe
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
      'entregue_em', ci.entregue_em,
      'devolvido_em', ci.devolvido_em
    ) ORDER BY e.descricao)
   FROM biomonitor_cautela_itens ci
   JOIN biomonitor_equipamentos e ON e.id = ci.equipamento_id
   WHERE ci.cautela_id = c.id) AS itens
FROM biomonitor_cautelas c
JOIN monitores_biodiversidade m ON m.id = c.monitor_id
JOIN lgpd_documento_versoes dv ON dv.id = c.termo_versao_id;

CREATE OR REPLACE VIEW vw_biomonitor_equipamentos_status
WITH (security_invoker = true) AS
SELECT
  e.*,
  ci.cautela_id AS cautela_aberta_id,
  m.nome_completo AS com_monitor
FROM biomonitor_equipamentos e
LEFT JOIN biomonitor_cautela_itens ci
  ON ci.equipamento_id = e.id AND ci.devolvido_em IS NULL
LEFT JOIN biomonitor_cautelas c ON c.id = ci.cautela_id AND c.status IN ('aberta','parcial')
LEFT JOIN monitores_biodiversidade m ON m.id = c.monitor_id;
