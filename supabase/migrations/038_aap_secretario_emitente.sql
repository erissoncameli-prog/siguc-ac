-- ─────────────────────────────────────────────────────────────────
-- 038 — AAP: registra emitente (Chefe DEUC) separado do autorizador
--           e expõe ambos na view pública de validação
-- ─────────────────────────────────────────────────────────────────

-- 1. Nova coluna: quem clicou "Emitir AAP" (Chefe DEUC)
ALTER TABLE pesquisas
  ADD COLUMN IF NOT EXISTS aap_emitido_por uuid REFERENCES usuarios(id);

-- 2. Atualiza função de emissão para gravar o emitente
CREATE OR REPLACE FUNCTION despachar_emissao_aap(
  p_pesquisa_id    uuid,
  p_validade_dias  int DEFAULT 365,
  p_condicionantes text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
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
  SELECT c.nivel INTO v_nivel
  FROM cargos_atuais ca JOIN cargos c ON c.id = ca.cargo_id
  WHERE ca.responsavel_atual_id = auth.uid() LIMIT 1;

  SELECT etapa, pesquisador_email, numero_processo
  INTO v_etapa, v_email, v_numero
  FROM pesquisas WHERE id = p_pesquisa_id FOR UPDATE;

  IF v_nivel NOT IN ('chefe_deuc','chefe_debio') THEN
    RAISE EXCEPTION 'Apenas o Chefe do DEUC pode emitir a AAP.';
  END IF;

  IF v_etapa != 'aap_assinatura' THEN
    RAISE EXCEPTION 'Pesquisa não está na etapa de Emissão da AAP.';
  END IF;

  v_ano     := to_char(now(), 'YYYY');
  v_seq     := nextval('seq_pesquisa_processo');
  v_aap_num := format('AAP/SEMA-AC/%s/%s', v_ano, lpad(v_seq::text, 4, '0'));
  v_token   := replace(replace(encode(gen_random_bytes(18), 'base64'), '+', 'A'), '/', 'B');
  v_token   := replace(v_token, '=', '');

  UPDATE pesquisas SET
    etapa            = 'aap_publicada',
    aap_numero       = v_aap_num,
    aap_emitida_em   = now(),
    aap_validade     = (now() + (p_validade_dias || ' days')::interval)::date,
    aap_qr_token     = v_token,
    aap_emitido_por  = auth.uid()          -- NOVO: grava quem clicou "Emitir"
  WHERE id = p_pesquisa_id;

  INSERT INTO pesquisa_historico (pesquisa_id, etapa_anterior, etapa_nova, usuario_id, observacao)
  VALUES (p_pesquisa_id, 'aap_assinatura', 'aap_publicada', auth.uid(),
          'AAP emitida: ' || v_aap_num ||
          CASE WHEN p_condicionantes IS NOT NULL THEN ' | Condicionantes: ' || p_condicionantes ELSE '' END);

  IF v_email IS NOT NULL THEN
    INSERT INTO pesquisa_emails (pesquisa_id, evento, destinatario, assunto)
    VALUES (p_pesquisa_id, 'aap_emitida', v_email,
            '[SIGUC] AAP emitida — ' || v_aap_num);
  END IF;

  RETURN jsonb_build_object('aap_numero', v_aap_num, 'aap_qr_token', v_token);
END;
$$;

-- 3. Atualiza view pública para expor emitente e autorizador (Secretário)
CREATE OR REPLACE VIEW v_aap_publica AS
SELECT
  p.id,
  p.numero_processo,
  p.titulo,
  p.tipo,
  p.aap_numero,
  p.aap_qr_token,
  p.aap_emitida_em,
  p.aap_validade,
  p.aap_assinado_em,
  p.aap_condicionantes,
  -- Pesquisador
  p.pesquisador_nome,
  p.pesquisador_email,
  p.pesquisador_cpf,
  p.pesquisador_instituicao,
  -- UC
  uc.nome                               AS uc_nome,
  -- Autorizador = Secretário que deferiu
  u_aut.nome_completo                   AS autorizador_nome,
  -- Emitente = Chefe DEUC que clicou "Emitir"
  u_emit.nome_completo                  AS emitente_nome,
  -- Validade computada
  CASE
    WHEN p.aap_validade >= current_date THEN 'valida'
    ELSE 'expirada'
  END                                   AS status_validade
FROM pesquisas p
LEFT JOIN unidades_conservacao uc   ON uc.id   = p.uc_id
LEFT JOIN usuarios u_aut            ON u_aut.id = p.aap_assinado_por
LEFT JOIN usuarios u_emit           ON u_emit.id = p.aap_emitido_por
WHERE p.aap_qr_token IS NOT NULL;

-- Permissão anon para consulta pública (validação por QR)
GRANT SELECT ON v_aap_publica TO anon, authenticated;
