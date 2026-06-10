-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Regional — propagação automática
-- Cadeia: unidades_conservacao.regional
--       → brigadas.regional  (trigger + backfill)
--       → registros_campo.regional (trigger + backfill)
-- Atualiza vw_registros_validacao com COALESCE como fallback.
-- ═══════════════════════════════════════════════════════════

-- ── 1. Adiciona regional à UC (fonte de verdade) ─────────────
ALTER TABLE unidades_conservacao
  ADD COLUMN IF NOT EXISTS regional regional_ac;

CREATE INDEX IF NOT EXISTS idx_uc_regional ON unidades_conservacao (regional)
  WHERE regional IS NOT NULL;

-- ── 2. Trigger: brigada herda regional da UC ─────────────────
-- Dispara em INSERT e UPDATE de brigadas.
-- Se regional estiver nulo, preenche com uc.regional.
-- Se admin setar explicitamente, respeita o valor.

CREATE OR REPLACE FUNCTION fn_brigada_herda_regional()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.regional IS NULL AND NEW.uc_id IS NOT NULL THEN
    SELECT regional INTO NEW.regional
    FROM unidades_conservacao
    WHERE id = NEW.uc_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_brigada_herda_regional ON brigadas;
CREATE TRIGGER trg_brigada_herda_regional
  BEFORE INSERT OR UPDATE ON brigadas
  FOR EACH ROW EXECUTE FUNCTION fn_brigada_herda_regional();

-- ── 3. Trigger: registro_campo herda regional da brigada ─────
-- Dispara em INSERT. Se regional vier nulo do PWA/app,
-- preenche automaticamente a partir de brigadas.regional.

CREATE OR REPLACE FUNCTION fn_registro_herda_regional()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.regional IS NULL AND NEW.brigada_id IS NOT NULL THEN
    SELECT regional INTO NEW.regional
    FROM brigadas
    WHERE id = NEW.brigada_id;
  END IF;
  -- Fallback: tenta via uc_id caso brigada também esteja sem regional
  IF NEW.regional IS NULL AND NEW.uc_id IS NOT NULL THEN
    SELECT regional INTO NEW.regional
    FROM unidades_conservacao
    WHERE id = NEW.uc_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_registro_herda_regional ON registros_campo;
CREATE TRIGGER trg_registro_herda_regional
  BEFORE INSERT OR UPDATE ON registros_campo
  FOR EACH ROW EXECUTE FUNCTION fn_registro_herda_regional();

-- ── 4. Backfill: brigadas sem regional ───────────────────────
UPDATE brigadas b
SET regional = uc.regional
FROM unidades_conservacao uc
WHERE b.uc_id = uc.id
  AND b.regional IS NULL
  AND uc.regional IS NOT NULL;

-- ── 5. Backfill: registros_campo sem regional ─────────────────
-- Tenta via brigada primeiro, depois via UC direta
UPDATE registros_campo rc
SET regional = COALESCE(br.regional, uc.regional)
FROM brigadas br
LEFT JOIN unidades_conservacao uc ON uc.id = br.uc_id
WHERE rc.brigada_id = br.id
  AND rc.regional IS NULL
  AND COALESCE(br.regional, uc.regional) IS NOT NULL;

-- Registros sem brigada_id mas com uc_id
UPDATE registros_campo rc
SET regional = uc.regional
FROM unidades_conservacao uc
WHERE rc.uc_id = uc.id
  AND rc.regional IS NULL
  AND rc.brigada_id IS NULL
  AND uc.regional IS NOT NULL;

-- ── 6. Atualiza vw_registros_validacao com COALESCE ──────────
-- Garante que o relatório funcione mesmo para registros antigos
-- cujo backfill não cobriu (brigada sem regional definida).

DROP VIEW IF EXISTS vw_registros_validacao;

CREATE OR REPLACE VIEW vw_registros_validacao AS
SELECT
  rc.id,
  rc.uuid_cliente,
  rc.natureza,
  rc.atividade,
  rc.equipe,
  rc.status_validacao,
  rc.motivo_rejeicao,
  rc.historico,
  rc.fotos_urls,
  rc.data_hora_evento,
  rc.criado_em,
  rc.sincronizado_em,
  rc.validado_em,
  rc.descricao,
  rc.area_estimada_ha,
  rc.pessoas_alcancadas,
  rc.precisao_gps_m,
  rc.alerta_cigma,
  rc.integrada_cbmac,
  rc.alerta_id,
  rc.ocorrencia_id,
  rc.uc_id,
  rc.brigada_id,
  rc.brigadista_id,
  -- Regional: usa o do registro; se nulo, cai para brigada, depois para UC
  COALESCE(rc.regional, br.regional, uc.regional) AS regional,
  rc.municipio,
  CASE WHEN rc.localizacao IS NOT NULL THEN ST_Y(rc.localizacao) END AS lat,
  CASE WHEN rc.localizacao IS NOT NULL THEN ST_X(rc.localizacao) END AS lng,
  b.nome_completo       AS brigadista_nome,
  br.nome               AS brigada_nome,
  uc.nome               AS uc_nome,
  uv.nome_completo      AS validado_por_nome,
  COALESCE(f.n_fauna, 0)          AS n_fauna,
  COALESCE(f.n_fauna_pendente, 0) AS n_fauna_pendente
FROM registros_campo rc
LEFT JOIN brigadistas          b  ON b.id  = rc.brigadista_id
LEFT JOIN brigadas             br ON br.id = rc.brigada_id
LEFT JOIN unidades_conservacao uc ON uc.id = rc.uc_id
LEFT JOIN usuarios             uv ON uv.id = rc.validado_por
LEFT JOIN (
  SELECT
    registro_campo_id,
    COUNT(*)                                         AS n_fauna,
    COUNT(*) FILTER (WHERE NOT identificacao_confirmada) AS n_fauna_pendente
  FROM registro_fauna
  GROUP BY registro_campo_id
) f ON f.registro_campo_id = rc.id;
