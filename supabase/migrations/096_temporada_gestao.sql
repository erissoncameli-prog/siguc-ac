-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Biomonitor — Temporada como motor do ciclo
-- ───────────────────────────────────────────────────────────
-- Torna a Temporada a função-âncora que reinicia o ciclo a cada
-- período reprodutivo, mantendo as praias (permanentes) e
-- reiniciando ninhos/numeração/alertas/relatórios.
--
-- Decisões (alinhadas):
--  · Numeração reinicia por temporada com ano (PRAIA-TR-2026-001).
--  · Praias participam por temporada via temporada_praias (período,
--    responsável e meta próprios a cada ciclo).
--  · Roster de monitores/grupos por carry-over (sem tabela extra).
--  · Ao ativar uma temporada, a anterior é CONGELADA (read-only).
--
-- Tudo é ADITIVO: nenhuma temporada/registro é apagado.
-- ═══════════════════════════════════════════════════════════

-- ── 1. Temporada atual (explícita) ───────────────────────────
ALTER TABLE temporadas_biomonitor
  ADD COLUMN IF NOT EXISTS is_atual boolean NOT NULL DEFAULT false;

-- No máximo UMA temporada atual por programa
CREATE UNIQUE INDEX IF NOT EXISTS uq_temporada_atual_por_programa
  ON temporadas_biomonitor (programa_id) WHERE is_atual;

CREATE OR REPLACE FUNCTION temporada_atual(p_programa_id uuid)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id FROM temporadas_biomonitor
   WHERE programa_id = p_programa_id AND is_atual LIMIT 1;
$$;
GRANT EXECUTE ON FUNCTION temporada_atual TO authenticated, service_role;

-- Marca a atual em cada programa (em_andamento mais recente; senão planejada)
WITH ranked AS (
  SELECT id, programa_id,
         row_number() OVER (PARTITION BY programa_id
           ORDER BY (status = 'em_andamento') DESC, ano_base DESC, data_inicio DESC) AS rn
    FROM temporadas_biomonitor
   WHERE status IN ('planejada','em_andamento')
)
UPDATE temporadas_biomonitor t
   SET is_atual = true
  FROM ranked r
 WHERE r.id = t.id AND r.rn = 1
   AND NOT EXISTS (SELECT 1 FROM temporadas_biomonitor x
                    WHERE x.programa_id = t.programa_id AND x.is_atual);

-- ── 2. Praias participantes por temporada ────────────────────
CREATE TABLE IF NOT EXISTS temporada_praias (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  temporada_id           uuid NOT NULL REFERENCES temporadas_biomonitor(id) ON DELETE CASCADE,
  praia_id               uuid NOT NULL REFERENCES praias_monitoramento(id) ON DELETE CASCADE,
  ativa                  boolean NOT NULL DEFAULT true,
  periodo_inicio         date,
  periodo_fim            date,
  monitor_responsavel_id uuid REFERENCES monitores_biodiversidade(id) ON DELETE SET NULL,
  meta_ninhos            int,
  observacoes            text,
  criado_em              timestamptz NOT NULL DEFAULT now(),
  atualizado_em          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (temporada_id, praia_id)
);

CREATE INDEX IF NOT EXISTS idx_temp_praias_temporada ON temporada_praias (temporada_id);
CREATE INDEX IF NOT EXISTS idx_temp_praias_praia     ON temporada_praias (praia_id);

ALTER TABLE temporada_praias ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "temp_praias_select" ON temporada_praias;
CREATE POLICY "temp_praias_select" ON temporada_praias
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "temp_praias_write" ON temporada_praias;
CREATE POLICY "temp_praias_write" ON temporada_praias
  FOR ALL TO authenticated USING (
    EXISTS (SELECT 1 FROM usuarios WHERE id = auth.uid()
      AND perfil IN ('tecnico','gestor','super_admin') AND ativo)
  );

DROP TRIGGER IF EXISTS trg_temp_praias_updated ON temporada_praias;
CREATE TRIGGER trg_temp_praias_updated
  BEFORE UPDATE ON temporada_praias
  FOR EACH ROW EXECUTE FUNCTION touch_atualizado_em();

-- Seed: a temporada ATUAL recebe as praias do seu programa (carry-over
-- do estado atual da praia), para o app já listar as praias do ciclo.
INSERT INTO temporada_praias (temporada_id, praia_id, ativa, periodo_inicio, periodo_fim, monitor_responsavel_id)
SELECT t.id, p.id, COALESCE(p.ativa, true), p.periodo_inicio, p.periodo_fim, p.monitor_responsavel_id
  FROM temporadas_biomonitor t
  JOIN praias_monitoramento p ON p.programa_id = t.programa_id
 WHERE t.is_atual
ON CONFLICT (temporada_id, praia_id) DO NOTHING;

-- ── 3. Derivação da temporada do ninho (em cascata) ──────────
-- Prioridade: temporada_id do app → temporada atual do programa →
-- por data. Acaba com ninhos órfãos (temporada_id NULL).
CREATE OR REPLACE FUNCTION trg_ninhos_derivar_temporada()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_prog uuid;
  v_temp uuid;
BEGIN
  -- 1) Respeita a temporada que o app já carimbou
  IF NEW.temporada_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- Programa via grupo; fallback via praia
  SELECT g.programa_id INTO v_prog FROM grupos_biomonitor g WHERE g.id = NEW.grupo_id;
  IF v_prog IS NULL THEN
    SELECT p.programa_id INTO v_prog FROM praias_monitoramento p WHERE p.id = NEW.praia_id;
  END IF;
  IF v_prog IS NULL THEN RETURN NEW; END IF;

  -- 2) Temporada atual do programa
  SELECT id INTO v_temp FROM temporadas_biomonitor
   WHERE programa_id = v_prog AND is_atual LIMIT 1;

  -- 3) Senão, por data de encontro
  IF v_temp IS NULL THEN
    SELECT id INTO v_temp FROM temporadas_biomonitor
     WHERE programa_id = v_prog
       AND NEW.data_encontro BETWEEN data_inicio AND data_fim
     LIMIT 1;
  END IF;

  NEW.temporada_id := v_temp;
  RETURN NEW;
END;
$$;
-- (trigger trg_ninhos_temporada já existe e aponta para esta função)

-- ── 4. Congelamento: temporada encerrada/arquivada não aceita
--       novos ninhos. Nomeado para rodar APÓS a derivação. ────
CREATE OR REPLACE FUNCTION trg_ninhos_guard_temporada()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_status status_temporada_bio;
BEGIN
  IF NEW.temporada_id IS NULL THEN RETURN NEW; END IF;
  SELECT status INTO v_status FROM temporadas_biomonitor WHERE id = NEW.temporada_id;
  IF v_status IN ('encerrada','arquivada') THEN
    RAISE EXCEPTION 'Temporada % está % — não aceita novos ninhos.', NEW.temporada_id, v_status
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ninhos_zguard_temporada ON ninhos_quelonios;
CREATE TRIGGER trg_ninhos_zguard_temporada
  BEFORE INSERT ON ninhos_quelonios
  FOR EACH ROW EXECUTE FUNCTION trg_ninhos_guard_temporada();

-- ── 5. RPC: gerar nova temporada (clona praias da anterior) ──
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
  ELSE
    -- Sem origem: pega todas as praias do programa
    INSERT INTO temporada_praias (temporada_id, praia_id, ativa, periodo_inicio, periodo_fim, monitor_responsavel_id)
    SELECT v_nova, p.id, COALESCE(p.ativa, true), p_data_inicio, p_data_fim, p.monitor_responsavel_id
      FROM praias_monitoramento p WHERE p.programa_id = p_programa_id
    ON CONFLICT (temporada_id, praia_id) DO NOTHING;
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

-- ── 6. RPC: ativar temporada (congela a anterior) ────────────
CREATE OR REPLACE FUNCTION ativar_temporada(p_temporada_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_prog uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM usuarios u
                  WHERE u.id = auth.uid() AND u.perfil IN ('tecnico','gestor','super_admin') AND u.ativo) THEN
    RAISE EXCEPTION 'Sem permissão para ativar temporada.';
  END IF;

  SELECT programa_id INTO v_prog FROM temporadas_biomonitor WHERE id = p_temporada_id;
  IF v_prog IS NULL THEN RAISE EXCEPTION 'Temporada não encontrada.'; END IF;

  -- Encerra (congela) e desmarca a atual anterior do mesmo programa
  UPDATE temporadas_biomonitor
     SET is_atual = false,
         status   = CASE WHEN status = 'em_andamento' THEN 'encerrada' ELSE status END
   WHERE programa_id = v_prog AND is_atual AND id <> p_temporada_id;

  -- Ativa a nova
  UPDATE temporadas_biomonitor
     SET is_atual = true, status = 'em_andamento'
   WHERE id = p_temporada_id;
END;
$$;
GRANT EXECUTE ON FUNCTION ativar_temporada TO authenticated;

-- ── 7. RPC: encerrar temporada ───────────────────────────────
CREATE OR REPLACE FUNCTION encerrar_temporada(p_temporada_id uuid, p_arquivar boolean DEFAULT false)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM usuarios u
                  WHERE u.id = auth.uid() AND u.perfil IN ('tecnico','gestor','super_admin') AND u.ativo) THEN
    RAISE EXCEPTION 'Sem permissão para encerrar temporada.';
  END IF;

  UPDATE temporadas_biomonitor
     SET is_atual = false,
         status   = CASE WHEN p_arquivar THEN 'arquivada' ELSE 'encerrada' END
   WHERE id = p_temporada_id;
END;
$$;
GRANT EXECUTE ON FUNCTION encerrar_temporada TO authenticated;

-- ── 8. Numeração de ninho escopada por temporada + ano ───────
-- Prefixo PRAIA-ESP-ANO- e sequência reiniciando por temporada.
CREATE OR REPLACE FUNCTION proximo_numero_ninho(
  p_praia_id     uuid,
  p_especie      especie_quelonio,
  p_temporada_id uuid DEFAULT NULL,
  p_campo        text DEFAULT 'numero_ninho'
)
RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_sigla text;
  v_esp   text;
  v_ano   smallint;
  v_temp  uuid := p_temporada_id;
  v_prefix text;
  v_max   int := 0;
BEGIN
  SELECT sigla INTO v_sigla FROM praias_monitoramento WHERE id = p_praia_id;
  v_sigla := COALESCE(v_sigla, 'XX');

  v_esp := CASE p_especie
    WHEN 'tracaja' THEN 'TR' WHEN 'tartaruga' THEN 'TA' WHEN 'cabecudo' THEN 'R'
    WHEN 'pitiU' THEN 'C' WHEN 'cupido' THEN 'CP' WHEN 'mucua' THEN 'M'
    WHEN 'jabuti_pe_elefante' THEN 'JP' WHEN 'jabuti_piranga' THEN 'JI' ELSE 'OUT' END;

  -- Temporada de referência: explícita → atual do programa da praia
  IF v_temp IS NULL THEN
    SELECT temporada_atual(p.programa_id) INTO v_temp
      FROM praias_monitoramento p WHERE p.id = p_praia_id;
  END IF;

  SELECT ano_base INTO v_ano FROM temporadas_biomonitor WHERE id = v_temp;
  v_ano := COALESCE(v_ano, EXTRACT(YEAR FROM CURRENT_DATE)::smallint);

  v_prefix := v_sigla || '-' || v_esp || '-' || v_ano || '-';

  IF p_campo = 'numero_atual' THEN
    SELECT COALESCE(MAX(NULLIF(regexp_replace(COALESCE(numero_atual, numero_ninho), '^.*-', ''), '')::int), 0)
      INTO v_max FROM ninhos_quelonios
     WHERE temporada_id = v_temp
       AND COALESCE(numero_atual, numero_ninho) LIKE v_prefix || '%';
  ELSE
    SELECT COALESCE(MAX(NULLIF(regexp_replace(numero_ninho, '^.*-', ''), '')::int), 0)
      INTO v_max FROM ninhos_quelonios
     WHERE temporada_id = v_temp
       AND numero_ninho LIKE v_prefix || '%';
  END IF;

  RETURN v_prefix || lpad((v_max + 1)::text, 3, '0');
END;
$$;
GRANT EXECUTE ON FUNCTION proximo_numero_ninho TO authenticated;

-- ── 9. View de apoio: praias da temporada (com nome/sigla) ───
CREATE OR REPLACE VIEW vw_temporada_praias
WITH (security_invoker = true)
AS
SELECT
  tp.*,
  p.codigo      AS praia_codigo,
  p.sigla       AS praia_sigla,
  p.nome        AS praia_nome,
  p.uc_id,
  p.programa_id,
  t.nome        AS temporada_nome,
  t.ano_base    AS temporada_ano,
  t.is_atual    AS temporada_atual,
  m.nome_completo AS responsavel_nome
FROM temporada_praias tp
JOIN praias_monitoramento p     ON p.id = tp.praia_id
JOIN temporadas_biomonitor t    ON t.id = tp.temporada_id
LEFT JOIN monitores_biodiversidade m ON m.id = tp.monitor_responsavel_id;
