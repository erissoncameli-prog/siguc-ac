-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Migration 029 — Coluna aap_condicionantes
-- Persiste condicionantes da AAP para uso no PDF gerado
-- ═══════════════════════════════════════════════════════════

ALTER TABLE pesquisas
  ADD COLUMN IF NOT EXISTS aap_condicionantes text;

-- Atualiza despachar_emissao_aap para salvar condicionantes

CREATE OR REPLACE FUNCTION despachar_emissao_aap(
  p_pesquisa_id    uuid,
  p_validade_dias  int  DEFAULT 365,
  p_condicionantes text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_nivel    nivel_hierarquico;
  v_etapa    etapa_pesquisa;
  v_seq      int;
  v_ano      text;
  v_aap_num  text;
  v_token    text;
  v_email    text;
  v_numero   text;
BEGIN
  -- super_admin pode emitir sem cargo formal
  IF NOT _is_super_admin() THEN
    SELECT c.nivel INTO v_nivel
    FROM cargos_atuais ca
    JOIN cargos c ON c.id = ca.cargo_id
    WHERE ca.responsavel_atual_id = auth.uid()
    LIMIT 1;

    IF v_nivel NOT IN ('chefe_deuc','chefe_debio') THEN
      RAISE EXCEPTION 'Apenas o Chefe do DEUC pode emitir a AAP.';
    END IF;
  END IF;

  SELECT etapa, pesquisador_email, numero_processo
  INTO v_etapa, v_email, v_numero
  FROM pesquisas WHERE id = p_pesquisa_id FOR UPDATE;

  IF v_etapa != 'aap_assinatura' THEN
    RAISE EXCEPTION 'Pesquisa não está na etapa de assinatura da AAP.';
  END IF;

  v_ano     := to_char(now(), 'YYYY');
  v_seq     := nextval('seq_pesquisa_processo');
  v_aap_num := format('AAP/SEMA-AC/%s/%s', v_ano, lpad(v_seq::text, 4, '0'));
  v_token   := replace(replace(replace(encode(gen_random_bytes(18), 'base64'), '+', 'A'), '/', 'B'), '=', '');

  UPDATE pesquisas SET
    etapa              = 'aap_publicada',
    aap_numero         = v_aap_num,
    aap_emitida_em     = now(),
    aap_validade       = (now() + (p_validade_dias || ' days')::interval)::date,
    aap_qr_token       = v_token,
    aap_condicionantes = p_condicionantes
  WHERE id = p_pesquisa_id;

  INSERT INTO pesquisa_historico (pesquisa_id, etapa_anterior, etapa_nova, usuario_id, observacao)
  VALUES (p_pesquisa_id, 'aap_assinatura', 'aap_publicada', auth.uid(),
          'AAP emitida: ' || v_aap_num ||
          CASE WHEN p_condicionantes IS NOT NULL
               THEN ' | Condicionantes: ' || p_condicionantes
               ELSE '' END);

  IF v_email IS NOT NULL THEN
    INSERT INTO pesquisa_emails (pesquisa_id, evento, destinatario, assunto)
    VALUES (p_pesquisa_id, 'aap_emitida', v_email,
            '[SIGUC] AAP ' || v_aap_num || ' emitida — ' || v_numero);
  END IF;

  RETURN jsonb_build_object(
    'aap_numero',  v_aap_num,
    'aap_validade', (now() + (p_validade_dias || ' days')::interval)::date,
    'aap_qr_token', v_token
  );
END;
$$;
