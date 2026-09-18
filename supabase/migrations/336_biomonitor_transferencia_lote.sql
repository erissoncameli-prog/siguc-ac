-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Biomonitor — Transferência de ninhos EM LOTE (mesa)
-- ───────────────────────────────────────────────────────────
-- Pedido do usuário: na aba de Validação (mesa), selecionar uma praia,
-- marcar todos ou alguns ninhos dela e transferir para outra praia de
-- uma vez. Só na mesa.
--
-- Reusa 100% do mecanismo de transferência de 1 ninho (transferencias_
-- ninho + triggers de 080/092/119/322): esta migration NÃO cria regra
-- de negócio nova — só orquestra N transferências numa transação, com
-- a placa (numero_atual) de destino de cada ninho.
--
-- Decisões do usuário:
--   • placa EDITÁVEL por ninho (a tela pré-preenche sugestões
--     sequenciais e o técnico pode ajustar) → a 1ª RPC sugere, a 2ª
--     recebe as placas escolhidas;
--   • perfis: tecnico/gestor/super_admin (mesmo teto da RLS de insert);
--   • motivo OBRIGATÓRIO no lote.
--
-- Segurança: as duas RPCs são SECURITY DEFINER (o destino costuma ser
-- berçário de outro grupo, fora da RLS do monitor — mesmo motivo de
-- bio_ninhos_ocupados, mig. 119) e checam o perfil de mesa server-side.
-- A placa duplicada continua barrada pelo trigger trg_transf_zguard_dup;
-- aqui a colisão (com o existente E dentro do próprio lote) é
-- pré-validada para dar retorno claro antes de gravar.
-- Depende de 080/092/110/119.
-- ═══════════════════════════════════════════════════════════

-- ── 1. Sugestão de placas para o lote ─────────────────────────
-- Para cada ninho selecionado, devolve elegibilidade + a placa
-- sugerida no destino (sequencial por espécie/temporada, a partir do
-- próximo número livre — proximo_numero_ninho). Só numera os ELEGÍVEIS
-- em sequência (inelegível não consome número).
CREATE OR REPLACE FUNCTION public.bio_transferencia_lote_sugerir(
  p_ninho_ids uuid[],
  p_praia_destino_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_result jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM usuarios
                  WHERE id = auth.uid()
                    AND perfil = ANY (ARRAY['tecnico','gestor','super_admin']::perfil_usuario[])
                    AND ativo) THEN
    RAISE EXCEPTION 'Sem permissão para transferência em lote.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_praia_destino_id IS NULL THEN
    RAISE EXCEPTION 'Praia de destino é obrigatória.';
  END IF;

  WITH sel0 AS (
    SELECT
      n.id, n.numero_ninho, n.especie, n.temporada_id, n.status,
      n.praia_atual_id, n.qtd_ovos,
      COALESCE(pa.nome, po.nome) AS praia_atual_nome,
      (n.status IN ('encontrado','transferido')
        AND n.praia_atual_id IS DISTINCT FROM p_praia_destino_id) AS elegivel
    FROM ninhos_quelonios n
    LEFT JOIN praias_monitoramento pa ON pa.id = n.praia_atual_id
    LEFT JOIN praias_monitoramento po ON po.id = n.praia_id
    WHERE n.id = ANY (p_ninho_ids)
  ),
  sel AS (
    SELECT s.*,
      CASE WHEN s.elegivel
        THEN (row_number() OVER (PARTITION BY s.especie, s.temporada_id, s.elegivel
                                 ORDER BY s.numero_ninho) - 1)
      END AS rn
    FROM sel0 s
  ),
  base AS (
    SELECT DISTINCT especie, temporada_id,
      proximo_numero_ninho(p_praia_destino_id, especie, temporada_id, 'numero_atual') AS base_num
    FROM sel WHERE elegivel
  ),
  calc AS (
    SELECT s.*,
      b.base_num,
      (regexp_match(b.base_num, '(\d+)\s*$'))[1]::int AS base_seq,
      regexp_replace(b.base_num, '\d+\s*$', '')       AS prefixo
    FROM sel s
    LEFT JOIN base b ON b.especie = s.especie
      AND b.temporada_id IS NOT DISTINCT FROM s.temporada_id
  )
  SELECT jsonb_agg(jsonb_build_object(
    'ninho_id',              id,
    'numero_ninho',          numero_ninho,
    'especie',               especie,
    'status',                status,
    'qtd_ovos',              qtd_ovos,
    'praia_atual_nome',      praia_atual_nome,
    'elegivel',              elegivel,
    'motivo_inelegivel',     CASE
                               WHEN status NOT IN ('encontrado','transferido') THEN 'status: ' || status
                               WHEN praia_atual_id = p_praia_destino_id       THEN 'já está no destino'
                               ELSE NULL END,
    'numero_atual_sugerido', CASE WHEN elegivel AND base_num IS NOT NULL
                               THEN prefixo || lpad((base_seq + rn)::text, 3, '0')
                               ELSE NULL END
  ) ORDER BY numero_ninho)
  INTO v_result
  FROM calc;

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$function$;

-- REVOKE de PUBLIC E anon: a função nasce com EXECUTE para PUBLIC (e o
-- ALTER DEFAULT PRIVILEGES do projeto concede a anon por nome) — revogar
-- só de anon não fecha, anon herda por PUBLIC (gotcha do projeto).
REVOKE EXECUTE ON FUNCTION public.bio_transferencia_lote_sugerir(uuid[], uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.bio_transferencia_lote_sugerir(uuid[], uuid) TO authenticated;

-- ── 2. Executa a transferência em lote ────────────────────────
-- p_itens = [{"ninho_id": uuid, "numero_atual": text}, ...]
-- Valida TUDO antes de gravar; se algo bloquear, devolve
-- {ok:false, problemas:[...]} sem inserir nada. Se tudo ok, insere as
-- N transferências (os triggers atualizam cada ninho) e devolve
-- {ok:true, transferidos:[...]}.
CREATE OR REPLACE FUNCTION public.bio_transferir_ninhos_lote(
  p_itens jsonb,
  p_praia_destino_id uuid,
  p_data_transferencia date,
  p_motivo motivo_transferencia,
  p_hora time DEFAULT NULL,
  p_observacoes text DEFAULT NULL,
  p_local_destino text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_monitor_id uuid;
  v_problemas  jsonb;
  v_result     jsonb;
BEGIN
  -- Permissão (mesa)
  IF NOT EXISTS (SELECT 1 FROM usuarios
                  WHERE id = auth.uid()
                    AND perfil = ANY (ARRAY['tecnico','gestor','super_admin']::perfil_usuario[])
                    AND ativo) THEN
    RAISE EXCEPTION 'Sem permissão para transferência em lote.' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF p_praia_destino_id IS NULL      THEN RAISE EXCEPTION 'Praia de destino é obrigatória.'; END IF;
  IF p_data_transferencia IS NULL    THEN RAISE EXCEPTION 'Data da transferência é obrigatória.'; END IF;
  IF p_motivo IS NULL                THEN RAISE EXCEPTION 'Motivo é obrigatório.'; END IF;
  IF p_itens IS NULL OR jsonb_typeof(p_itens) <> 'array' OR jsonb_array_length(p_itens) = 0 THEN
    RAISE EXCEPTION 'Nenhum ninho selecionado.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM praias_monitoramento WHERE id = p_praia_destino_id) THEN
    RAISE EXCEPTION 'Praia de destino não encontrada.';
  END IF;

  SELECT id INTO v_monitor_id
    FROM monitores_biodiversidade
   WHERE usuario_id = auth.uid() AND status = 'ativo' LIMIT 1;

  -- Itens normalizados
  CREATE TEMP TABLE _itens ON COMMIT DROP AS
    SELECT (e->>'ninho_id')::uuid AS ninho_id,
           NULLIF(trim(e->>'numero_atual'), '') AS numero_atual,
           row_number() OVER () AS ord
    FROM jsonb_array_elements(p_itens) e;

  -- ── Pré-validação (nenhuma gravação ainda) ──
  WITH v AS (
    SELECT i.ninho_id, i.numero_atual, n.id AS achou,
      n.numero_ninho, n.especie, n.temporada_id, n.status, n.praia_atual_id,
      -- placa repetida DENTRO do lote?
      (COUNT(*) OVER (PARTITION BY i.numero_atual) > 1) AS dup_lote,
      -- placa já ocupada no destino (ninho ativo, mesma temporada/espécie, outro ninho)?
      EXISTS (
        SELECT 1 FROM ninhos_quelonios x
         WHERE x.praia_atual_id = p_praia_destino_id
           AND x.id <> i.ninho_id
           AND COALESCE(x.numero_atual, x.numero_ninho) = i.numero_atual
           AND (n.temporada_id IS NULL OR x.temporada_id = n.temporada_id)
           AND (n.especie IS NULL OR x.especie = n.especie)
           AND x.status NOT IN ('perdido','soltado')
      ) AS dup_destino
    FROM _itens i
    LEFT JOIN ninhos_quelonios n ON n.id = i.ninho_id
  )
  SELECT jsonb_agg(jsonb_build_object(
    'ninho_id', ninho_id, 'numero_ninho', numero_ninho, 'numero_atual', numero_atual,
    'motivo', CASE
      WHEN achou IS NULL                                   THEN 'ninho não encontrado'
      WHEN status NOT IN ('encontrado','transferido')      THEN 'status não permite transferência (' || status || ')'
      WHEN praia_atual_id = p_praia_destino_id             THEN 'já está no destino'
      WHEN numero_atual IS NULL                            THEN 'placa no destino em branco'
      WHEN dup_lote                                        THEN 'placa repetida dentro do lote'
      WHEN dup_destino                                     THEN 'placa já ocupada no destino'
      ELSE NULL END
  ) ORDER BY numero_ninho)
  INTO v_problemas
  FROM v
  WHERE (achou IS NULL
      OR status NOT IN ('encontrado','transferido')
      OR praia_atual_id = p_praia_destino_id
      OR numero_atual IS NULL
      OR dup_lote
      OR dup_destino);

  IF v_problemas IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'problemas', v_problemas);
  END IF;

  -- ── Gravação (todos válidos) ──
  INSERT INTO transferencias_ninho
    (uuid_cliente, ninho_id, data_transferencia, hora_transferencia, qtd_ovos,
     praia_destino_id, numero_atual, motivo, local_destino, observacoes,
     monitor_id, sincronizado_em)
  SELECT gen_random_uuid(), i.ninho_id, p_data_transferencia, p_hora,
         COALESCE(n.qtd_ovos, 0), p_praia_destino_id, i.numero_atual, p_motivo,
         p_local_destino, p_observacoes, v_monitor_id, now()
  FROM _itens i
  JOIN ninhos_quelonios n ON n.id = i.ninho_id
  ORDER BY i.ord;

  SELECT jsonb_agg(jsonb_build_object(
    'ninho_id', n.id, 'numero_ninho', n.numero_ninho,
    'numero_atual', n.numero_atual, 'especie', n.especie
  ) ORDER BY n.numero_ninho)
  INTO v_result
  FROM _itens i JOIN ninhos_quelonios n ON n.id = i.ninho_id;

  RETURN jsonb_build_object('ok', true,
    'total', (SELECT COUNT(*) FROM _itens),
    'praia_destino_id', p_praia_destino_id,
    'transferidos', COALESCE(v_result, '[]'::jsonb));
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.bio_transferir_ninhos_lote(jsonb, uuid, date, motivo_transferencia, time, text, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.bio_transferir_ninhos_lote(jsonb, uuid, date, motivo_transferencia, time, text, text) TO authenticated;
