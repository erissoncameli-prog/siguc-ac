-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Biomonitor — Integridade da transferência de ninhos
-- ───────────────────────────────────────────────────────────
-- Inteligência na transferência (proposta, seções 1 e 5):
--  · bio_ninhos_ocupados(praia, temporada, especie): lista os
--    ninhos já ocupados na praia de DESTINO, o intervalo de
--    numeração e o próximo número livre — para o app mostrar ao
--    usuário e sugerir a correção com 1 clique. SECURITY DEFINER
--    porque o destino costuma ser um berçário de OUTRO grupo, que
--    a RLS do monitor não enxergaria; devolve só número/espécie/
--    status (sem dados sensíveis).
--  · Guard de duplicidade: impede gravar transferência cujo
--    numero_atual já esteja ocupado no destino, na temporada e
--    espécie. Vale para NOVAS transferências (tolera legado).
--
-- "Ocupado" = ninho cuja placa ainda está fisicamente na praia:
-- status NOT IN ('perdido','soltado'). Namespace de numeração é
-- por (praia_atual, temporada, espécie) — espécies diferentes
-- podem repetir "001" pois a placa é prefixada por espécie.
--
-- Depende de 074, 092, 096 (proximo_numero_ninho), 110.
-- ═══════════════════════════════════════════════════════════

-- Índice ampliado: ocupação por praia atual + temporada + placa
CREATE INDEX IF NOT EXISTS idx_ninhos_ocupacao
  ON ninhos_quelonios (praia_atual_id, temporada_id, especie, numero_atual);

-- ── 1. RPC: ocupação da praia de destino ─────────────────────
CREATE OR REPLACE FUNCTION bio_ninhos_ocupados(
  p_praia_id     uuid,
  p_temporada_id uuid            DEFAULT NULL,
  p_especie      especie_quelonio DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_temp     uuid := p_temporada_id;
  v_ocupados jsonb;
  v_nums     int[];
  v_proximo  text;
BEGIN
  IF p_praia_id IS NULL THEN
    RAISE EXCEPTION 'praia de destino é obrigatória';
  END IF;

  -- Temporada de referência: explícita → atual do programa da praia
  IF v_temp IS NULL THEN
    SELECT temporada_atual(p.programa_id) INTO v_temp
      FROM praias_monitoramento p WHERE p.id = p_praia_id;
  END IF;

  -- Lista de ninhos ocupados (placa ainda no local)
  SELECT
    COALESCE(jsonb_agg(jsonb_build_object(
      'ninho_id',     x.id,
      'numero_atual', x.numero_atual,
      'seq',          x.seq,
      'especie',      x.especie,
      'status',       x.status
    ) ORDER BY x.seq NULLS LAST, x.numero_atual), '[]'::jsonb),
    array_remove(array_agg(x.seq ORDER BY x.seq), NULL)
    INTO v_ocupados, v_nums
  FROM (
    SELECT
      n.id,
      COALESCE(n.numero_atual, n.numero_ninho) AS numero_atual,
      n.especie,
      n.status,
      -- dígitos finais da placa (cast-safe: NULL se a placa for livre/sem número)
      (regexp_match(COALESCE(n.numero_atual, n.numero_ninho), '(\d+)\s*$'))[1]::int AS seq
    FROM ninhos_quelonios n
    WHERE n.praia_atual_id = p_praia_id
      AND (v_temp IS NULL OR n.temporada_id = v_temp)
      AND (p_especie IS NULL OR n.especie = p_especie)
      AND n.status NOT IN ('perdido','soltado')
  ) x;

  -- Próximo número livre (reaproveita a numeração canônica da praia)
  IF p_especie IS NOT NULL THEN
    v_proximo := proximo_numero_ninho(p_praia_id, p_especie, v_temp, 'numero_atual');
  END IF;

  RETURN jsonb_build_object(
    'praia_id',      p_praia_id,
    'temporada_id',  v_temp,
    'especie',       p_especie,
    'total',         COALESCE(array_length(v_nums, 1), 0),
    'seq_min',       (SELECT min(u) FROM unnest(v_nums) u),
    'seq_max',       (SELECT max(u) FROM unnest(v_nums) u),
    'proximo_livre', v_proximo,
    'ocupados',      v_ocupados
  );
END;
$$;
GRANT EXECUTE ON FUNCTION bio_ninhos_ocupados TO authenticated, service_role;

-- ── 2. Guard: bloqueia numero_atual duplicado no destino ─────
-- Roda BEFORE INSERT em transferencias_ninho. Só considera ninhos
-- ATIVOS (placa no local) da MESMA praia/temporada/espécie, e ignora
-- o próprio ninho. Legado com duplicidade não é bloqueado.
CREATE OR REPLACE FUNCTION trg_transf_guard_duplicidade()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_especie especie_quelonio;
  v_temp    uuid;
  v_conflito text;
BEGIN
  -- Sem número ou sem destino não há o que validar aqui
  IF NEW.numero_atual IS NULL OR NEW.praia_destino_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT especie, temporada_id INTO v_especie, v_temp
    FROM ninhos_quelonios WHERE id = NEW.ninho_id;

  SELECT COALESCE(n.numero_atual, n.numero_ninho)
    INTO v_conflito
    FROM ninhos_quelonios n
   WHERE n.praia_atual_id = NEW.praia_destino_id
     AND n.id <> NEW.ninho_id
     AND COALESCE(n.numero_atual, n.numero_ninho) = NEW.numero_atual
     AND (v_temp IS NULL OR n.temporada_id = v_temp)
     AND (v_especie IS NULL OR n.especie = v_especie)
     AND n.status NOT IN ('perdido','soltado')
   LIMIT 1;

  IF v_conflito IS NOT NULL THEN
    RAISE EXCEPTION 'Número % já está ocupado na praia de destino nesta temporada.', NEW.numero_atual
      USING ERRCODE = 'unique_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_transf_zguard_dup ON transferencias_ninho;
CREATE TRIGGER trg_transf_zguard_dup
  BEFORE INSERT ON transferencias_ninho
  FOR EACH ROW EXECUTE FUNCTION trg_transf_guard_duplicidade();
