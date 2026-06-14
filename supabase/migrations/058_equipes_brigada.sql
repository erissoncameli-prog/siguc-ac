-- ════════════════════════════════════════════════════════════════
-- 058 — Equipes de brigada (A/B/C)
-- ════════════════════════════════════════════════════════════════
-- Cada brigada tem ~10 brigadistas: 1 chefe + 9 divididos em 3
-- equipes (A, B, C). A equipe passa a ser atributo do brigadista e
-- é propagada ao registro de campo (com possibilidade de troca no app).
-- Persiste também duracao_horas (antes descartada no sync) para
-- permitir ranking de desempenho por horas de trabalho.

-- ── 1. Tabela de equipes ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS equipes_brigada (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brigada_id    uuid NOT NULL REFERENCES brigadas(id) ON DELETE CASCADE,
  nome          text NOT NULL,                       -- 'A', 'B', 'C' ou nome livre
  lider_id      uuid REFERENCES brigadistas(id) ON DELETE SET NULL,
  ativa         boolean NOT NULL DEFAULT true,
  criado_em     timestamptz DEFAULT now(),
  atualizado_em timestamptz DEFAULT now(),
  UNIQUE (brigada_id, nome)
);

CREATE INDEX IF NOT EXISTS idx_eq_brigada ON equipes_brigada (brigada_id);

DROP TRIGGER IF EXISTS trg_eq_touch ON equipes_brigada;
CREATE TRIGGER trg_eq_touch BEFORE UPDATE ON equipes_brigada
  FOR EACH ROW EXECUTE FUNCTION touch_atualizado_em();

-- ── 2. Vínculo brigadista → equipe ──────────────────────────────
ALTER TABLE brigadistas
  ADD COLUMN IF NOT EXISTS equipe_id uuid REFERENCES equipes_brigada(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_brig_equipe ON brigadistas (equipe_id);

-- ── 3. Registro de campo → equipe + horas ───────────────────────
ALTER TABLE registros_campo
  ADD COLUMN IF NOT EXISTS equipe_id     uuid REFERENCES equipes_brigada(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS duracao_horas numeric(5,1);

CREATE INDEX IF NOT EXISTS idx_rc_equipe ON registros_campo (equipe_id);

-- Mantém a coluna text `equipe` preenchida com o nome da equipe
-- (denormalização p/ compatibilidade com relatórios e exportações).
CREATE OR REPLACE FUNCTION fn_registro_preenche_equipe_nome()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.equipe_id IS NOT NULL THEN
    SELECT nome INTO NEW.equipe FROM equipes_brigada WHERE id = NEW.equipe_id;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_rc_equipe_nome ON registros_campo;
CREATE TRIGGER trg_rc_equipe_nome
  BEFORE INSERT OR UPDATE OF equipe_id ON registros_campo
  FOR EACH ROW EXECUTE FUNCTION fn_registro_preenche_equipe_nome();

-- ── 4. Seed: cria equipes A, B e C para cada brigada existente ───
INSERT INTO equipes_brigada (brigada_id, nome)
SELECT b.id, e.nome
FROM brigadas b
CROSS JOIN (VALUES ('A'), ('B'), ('C')) AS e(nome)
ON CONFLICT (brigada_id, nome) DO NOTHING;

-- Auto-cria A/B/C ao cadastrar uma nova brigada
CREATE OR REPLACE FUNCTION fn_brigada_cria_equipes()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO equipes_brigada (brigada_id, nome)
  VALUES (NEW.id, 'A'), (NEW.id, 'B'), (NEW.id, 'C')
  ON CONFLICT (brigada_id, nome) DO NOTHING;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_brigada_cria_equipes ON brigadas;
CREATE TRIGGER trg_brigada_cria_equipes
  AFTER INSERT ON brigadas
  FOR EACH ROW EXECUTE FUNCTION fn_brigada_cria_equipes();

-- ── 5. RLS ──────────────────────────────────────────────────────
ALTER TABLE equipes_brigada ENABLE ROW LEVEL SECURITY;

-- Leitura: brigadista da brigada, chefe da brigada, ou equipe interna
DROP POLICY IF EXISTS "eq_select" ON equipes_brigada;
CREATE POLICY "eq_select" ON equipes_brigada
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM brigadistas b
            WHERE b.brigada_id = equipes_brigada.brigada_id
              AND b.usuario_id = auth.uid()
              AND b.status = 'ativo')
    OR is_chefe_brigada(auth.uid(), equipes_brigada.brigada_id)
    OR EXISTS (SELECT 1 FROM usuarios u
               WHERE u.id = auth.uid()
                 AND u.perfil IN ('tecnico','gestor','super_admin','biologo')
                 AND u.ativo)
  );

-- Escrita: equipe interna (tecnico/gestor/super_admin) ou chefe da brigada
DROP POLICY IF EXISTS "eq_write" ON equipes_brigada;
CREATE POLICY "eq_write" ON equipes_brigada
  FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM usuarios u
            WHERE u.id = auth.uid()
              AND u.perfil IN ('tecnico','gestor','super_admin')
              AND u.ativo)
    OR is_chefe_brigada(auth.uid(), equipes_brigada.brigada_id)
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM usuarios u
            WHERE u.id = auth.uid()
              AND u.perfil IN ('tecnico','gestor','super_admin')
              AND u.ativo)
    OR is_chefe_brigada(auth.uid(), equipes_brigada.brigada_id)
  );

-- ── 6. Atualiza vw_registros_validacao com equipe + horas + fauna resgatada ──
DROP VIEW IF EXISTS vw_registros_validacao;

CREATE OR REPLACE VIEW vw_registros_validacao AS
SELECT
  rc.id,
  rc.uuid_cliente,
  rc.natureza,
  rc.atividade,
  rc.equipe,
  rc.equipe_id,
  eq.nome               AS equipe_nome,
  rc.duracao_horas,
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
  COALESCE(f.n_fauna, 0)            AS n_fauna,
  COALESCE(f.n_fauna_pendente, 0)   AS n_fauna_pendente,
  COALESCE(f.n_fauna_resgatada, 0)  AS n_fauna_resgatada
FROM registros_campo rc
LEFT JOIN brigadistas          b  ON b.id  = rc.brigadista_id
LEFT JOIN brigadas             br ON br.id = rc.brigada_id
LEFT JOIN equipes_brigada      eq ON eq.id = rc.equipe_id
LEFT JOIN unidades_conservacao uc ON uc.id = rc.uc_id
LEFT JOIN usuarios             uv ON uv.id = rc.validado_por
LEFT JOIN (
  SELECT
    registro_campo_id,
    COUNT(*)                                              AS n_fauna,
    COUNT(*) FILTER (WHERE NOT identificacao_confirmada)  AS n_fauna_pendente,
    COALESCE(SUM(quantidade) FILTER (WHERE tipo_evento = 'resgate'), 0) AS n_fauna_resgatada
  FROM registro_fauna
  GROUP BY registro_campo_id
) f ON f.registro_campo_id = rc.id;
