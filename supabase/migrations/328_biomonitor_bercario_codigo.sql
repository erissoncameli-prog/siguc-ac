-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Biomonitor — código curto do berçário (placa impressa)
--
-- Plano em docs/biomonitor/plano-etiqueta-ninho-bercario.md. O
-- berçário não tinha nenhum identificador curto — só `nome` (texto
-- livre). O QR da placa impressa precisa de algo pra CARREGAR e, se
-- a leitura falhar (sol forte, tela suja), algo pra DIGITAR à mão —
-- um uuid não serve pra isso.
--
-- Mesmo padrão de `BIOEQ-AAAA-NNNN` (equipamentos, migration 175),
-- mas sem ano no prefixo e sem a complexidade de reserva da Água:
-- berçário nasce raro (1 em produção hoje), sem concorrência de
-- campo — uma SEQUENCE já garante unicidade sozinha.
-- ═══════════════════════════════════════════════════════════

CREATE SEQUENCE IF NOT EXISTS bercarios_codigo_seq;

ALTER TABLE bercarios ADD COLUMN IF NOT EXISTS codigo text;

CREATE OR REPLACE FUNCTION bio_gerar_codigo_bercario()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NEW.codigo IS NULL THEN
    NEW.codigo := 'BERC-' || lpad(nextval('bercarios_codigo_seq')::text, 2, '0');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_bercarios_codigo ON bercarios;
CREATE TRIGGER trg_bercarios_codigo BEFORE INSERT ON bercarios
  FOR EACH ROW EXECUTE FUNCTION bio_gerar_codigo_bercario();

-- Achado pelo advisor em entregas anteriores (mesmo padrão sempre):
-- função de trigger nasce chamável direto via RPC (ALTER DEFAULT
-- PRIVILEGES concede EXECUTE a anon/authenticated por nome). Só deve
-- rodar via trigger.
REVOKE ALL ON FUNCTION bio_gerar_codigo_bercario() FROM PUBLIC, anon, authenticated;

-- ── Backfill dos berçários já existentes (cronológico) ───────────
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM bercarios WHERE codigo IS NULL ORDER BY criado_em, id LOOP
    UPDATE bercarios SET codigo = 'BERC-' || lpad(nextval('bercarios_codigo_seq')::text, 2, '0')
      WHERE id = r.id;
  END LOOP;
END $$;

ALTER TABLE bercarios ALTER COLUMN codigo SET NOT NULL;
ALTER TABLE bercarios ADD CONSTRAINT uq_bercarios_codigo UNIQUE (codigo);

COMMENT ON COLUMN bercarios.codigo IS
  'Código curto (BERC-NN), gerado automaticamente pelo trigger. Identifica a placa impressa do berçário — mesma função do codigo_amostra da Água, mas sem reserva: berçário nasce raro, sem concorrência de campo.';

-- ── Recria a view com o código (sempre ao FINAL — CREATE OR REPLACE
-- VIEW não aceita reordenar; recriada a partir do pg_get_viewdef()
-- real de produção, conferido sem drift contra a migration 134) ────
CREATE OR REPLACE VIEW vw_bercarios_resumo
WITH (security_invoker = true)
AS
SELECT
  b.id,
  b.nome,
  b.tipo,
  b.capacidade_max,
  b.localizacao_descricao,
  b.uc_id,
  uc.nome  AS uc_nome,
  uc.sigla AS uc_sigla,
  b.responsavel_id,
  mb.nome_completo AS responsavel_nome,
  b.status,
  b.observacoes,
  b.criado_em,
  COALESCE(l.lotes_ativos, 0)     AS lotes_ativos,
  COALESCE(l.vivos_atual, 0)      AS filhotes_vivos_atual,
  COALESCE(l.entrada_ativos, 0)   AS filhotes_entrada_ativos,
  COALESCE(l.lotes_soltados, 0)   AS lotes_soltados,
  COALESCE(l.lotes_cancelados, 0) AS lotes_cancelados,
  COALESCE(l.entrada_total, 0)    AS total_entrada_historico,
  COALESCE(l.mortes_total, 0)     AS total_mortes_historico,
  ROUND(100.0 * COALESCE(l.mortes_total, 0) / NULLIF(l.entrada_total, 0), 1) AS taxa_mortalidade_pct,
  COALESCE(al.alertas_abertos, 0) AS alertas_abertos,
  al.maior_severidade,
  b.codigo
FROM bercarios b
LEFT JOIN unidades_conservacao uc     ON uc.id = b.uc_id
LEFT JOIN monitores_biodiversidade mb ON mb.id = b.responsavel_id
LEFT JOIN LATERAL (
  SELECT
    COUNT(*) FILTER (WHERE lb.status = 'ativo')     AS lotes_ativos,
    COUNT(*) FILTER (WHERE lb.status = 'soltado')   AS lotes_soltados,
    COUNT(*) FILTER (WHERE lb.status = 'cancelado') AS lotes_cancelados,
    COALESCE(SUM(vlm.vivos_atual)   FILTER (WHERE lb.status = 'ativo'), 0) AS vivos_atual,
    COALESCE(SUM(lb.qtd_entrada)    FILTER (WHERE lb.status = 'ativo'), 0) AS entrada_ativos,
    COALESCE(SUM(vlm.qtd_entrada), 0) AS entrada_total,
    COALESCE(SUM(vlm.mortes), 0)      AS mortes_total
  FROM lotes_bercario lb
  LEFT JOIN vw_lotes_bercario_mortalidade vlm ON vlm.lote_id = lb.id
  WHERE lb.bercario_id = b.id
) l ON true
LEFT JOIN LATERAL (
  SELECT
    COUNT(*) AS alertas_abertos,
    (ARRAY_AGG(aq.severidade ORDER BY
      CASE aq.severidade WHEN 'critica' THEN 1 WHEN 'alta' THEN 2 WHEN 'media' THEN 3 ELSE 4 END
    ))[1] AS maior_severidade
  FROM alertas_quelonios aq
  WHERE aq.bercario_id = b.id AND aq.status IN ('aberto', 'ciente')
) al ON true;
