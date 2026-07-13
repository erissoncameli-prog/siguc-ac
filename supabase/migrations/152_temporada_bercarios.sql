-- ═══════════════════════════════════════════════════════════════
-- SIGUC-AC · Biomonitor — Berçário participa por temporada
-- ───────────────────────────────────────────────────────────────
-- O berçário (tanque/piscina/viveiro) é uma estrutura FÍSICA e
-- permanente — como a praia. Mas responsável, status (em uso/fora
-- de uso) e capacidade reservada podem mudar a cada temporada, e
-- hoje isso sobrescrevia o cadastro permanente (bercarios), sem
-- histórico por ciclo — diferente do que já existe para praias
-- (temporada_praias, 096).
--
-- Acrescenta temporada_bercarios (mesmo padrão de temporada_praias):
-- cada temporada tem sua própria config por berçário, com valores
-- padrão herdados do cadastro do berçário na primeira vez. Nada é
-- apagado; o cadastro permanente (nome/tipo/localização/UC) continua
-- em bercarios.
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS temporada_bercarios (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  temporada_id   uuid NOT NULL REFERENCES temporadas_biomonitor(id) ON DELETE CASCADE,
  bercario_id    uuid NOT NULL REFERENCES bercarios(id) ON DELETE CASCADE,
  ativo          boolean NOT NULL DEFAULT true,
  responsavel_id uuid REFERENCES monitores_biodiversidade(id) ON DELETE SET NULL,
  capacidade_max smallint,
  observacoes    text,
  criado_em      timestamptz NOT NULL DEFAULT now(),
  atualizado_em  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (temporada_id, bercario_id)
);

CREATE INDEX IF NOT EXISTS idx_temp_berc_temporada ON temporada_bercarios (temporada_id);
CREATE INDEX IF NOT EXISTS idx_temp_berc_bercario   ON temporada_bercarios (bercario_id);

ALTER TABLE temporada_bercarios ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "temp_berc_select" ON temporada_bercarios;
CREATE POLICY "temp_berc_select" ON temporada_bercarios
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "temp_berc_write" ON temporada_bercarios;
CREATE POLICY "temp_berc_write" ON temporada_bercarios
  FOR ALL TO authenticated USING (
    EXISTS (SELECT 1 FROM usuarios WHERE id = auth.uid()
      AND perfil IN ('tecnico','gestor','super_admin') AND ativo)
  );

DROP TRIGGER IF EXISTS trg_temp_berc_updated ON temporada_bercarios;
CREATE TRIGGER trg_temp_berc_updated
  BEFORE UPDATE ON temporada_bercarios
  FOR EACH ROW EXECUTE FUNCTION touch_atualizado_em();

-- ── Seed: cada temporada ATUAL recebe os berçários existentes,
--    carregando os valores atuais do cadastro (carry-over) ────────
INSERT INTO temporada_bercarios (temporada_id, bercario_id, ativo, responsavel_id, capacidade_max)
SELECT t.id, b.id, COALESCE(b.status, true), b.responsavel_id, b.capacidade_max
  FROM temporadas_biomonitor t
  CROSS JOIN bercarios b
 WHERE t.is_atual
ON CONFLICT (temporada_id, bercario_id) DO NOTHING;

-- ── Clona a config de berçários ao gerar uma nova temporada ──────
-- (mesma função de 096, acrescentando o passo de berçários)
CREATE OR REPLACE FUNCTION gerar_nova_temporada(
  p_programa_id  uuid,
  p_nome         text,
  p_ano_base     smallint,
  p_data_inicio  date,
  p_data_fim     date,
  p_clonar_de    uuid DEFAULT NULL,
  p_ativar       boolean DEFAULT false
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_nova uuid;
  v_origem uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM usuarios u
                  WHERE u.id = auth.uid() AND u.perfil IN ('tecnico','gestor','super_admin') AND u.ativo) THEN
    RAISE EXCEPTION 'Sem permissão para gerar temporada.';
  END IF;

  INSERT INTO temporadas_biomonitor (programa_id, nome, ano_base, data_inicio, data_fim, status, criado_por)
  VALUES (p_programa_id, p_nome, p_ano_base, p_data_inicio, p_data_fim, 'planejada', auth.uid())
  RETURNING id INTO v_nova;

  -- Origem do clone: explícita, senão a temporada mais recente do programa
  v_origem := p_clonar_de;
  IF v_origem IS NULL THEN
    SELECT id INTO v_origem FROM temporadas_biomonitor
     WHERE programa_id = p_programa_id AND id <> v_nova
     ORDER BY ano_base DESC, data_inicio DESC LIMIT 1;
  END IF;

  -- Clona as praias participantes (config por temporada)
  IF v_origem IS NOT NULL THEN
    INSERT INTO temporada_praias (temporada_id, praia_id, ativa, periodo_inicio, periodo_fim, monitor_responsavel_id, meta_ninhos, observacoes)
    SELECT v_nova, praia_id, ativa, p_data_inicio, p_data_fim, monitor_responsavel_id, meta_ninhos, observacoes
      FROM temporada_praias WHERE temporada_id = v_origem
    ON CONFLICT (temporada_id, praia_id) DO NOTHING;

    -- Clona a config de berçários da temporada anterior
    INSERT INTO temporada_bercarios (temporada_id, bercario_id, ativo, responsavel_id, capacidade_max, observacoes)
    SELECT v_nova, bercario_id, ativo, responsavel_id, capacidade_max, observacoes
      FROM temporada_bercarios WHERE temporada_id = v_origem
    ON CONFLICT (temporada_id, bercario_id) DO NOTHING;
  ELSE
    -- Sem origem: pega todas as praias do programa
    INSERT INTO temporada_praias (temporada_id, praia_id, ativa, periodo_inicio, periodo_fim, monitor_responsavel_id)
    SELECT v_nova, p.id, COALESCE(p.ativa, true), p_data_inicio, p_data_fim, p.monitor_responsavel_id
      FROM praias_monitoramento p WHERE p.programa_id = p_programa_id
    ON CONFLICT (temporada_id, praia_id) DO NOTHING;

    -- Sem origem: pega todos os berçários cadastrados
    INSERT INTO temporada_bercarios (temporada_id, bercario_id, ativo, responsavel_id, capacidade_max)
    SELECT v_nova, b.id, COALESCE(b.status, true), b.responsavel_id, b.capacidade_max
      FROM bercarios b
    ON CONFLICT (temporada_id, bercario_id) DO NOTHING;
  END IF;

  -- Roster de monitores/grupos: carry-over implícito (são permanentes,
  -- filtrados por status='ativo'); nada a clonar estruturalmente.

  IF p_ativar THEN
    PERFORM ativar_temporada(v_nova);
  END IF;

  RETURN v_nova;
END;
$$;
GRANT EXECUTE ON FUNCTION gerar_nova_temporada TO authenticated;

-- ── View de apoio: berçários da temporada (com nome/responsável) ──
CREATE OR REPLACE VIEW vw_temporada_bercarios
WITH (security_invoker = true)
AS
SELECT
  tb.*,
  b.nome          AS bercario_nome,
  b.tipo          AS bercario_tipo,
  b.capacidade_max AS bercario_capacidade_base,
  b.uc_id,
  t.nome          AS temporada_nome,
  t.ano_base      AS temporada_ano,
  t.is_atual      AS temporada_atual,
  m.nome_completo AS responsavel_nome
FROM temporada_bercarios tb
JOIN bercarios b              ON b.id = tb.bercario_id
JOIN temporadas_biomonitor t  ON t.id = tb.temporada_id
LEFT JOIN monitores_biodiversidade m ON m.id = tb.responsavel_id;
