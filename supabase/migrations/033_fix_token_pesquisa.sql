-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Migration 033 — Fix token_publico em submeter_pesquisa_publica
-- gen_random_bytes vive em extensions.* no Supabase.
-- Substituído por geração via gen_random_uuid() (sempre disponível).
-- ═══════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION submeter_pesquisa_publica(
  p_titulo                text,
  p_resumo                text,
  p_tipo                  tipo_pesquisa,
  p_uc_id                 uuid    DEFAULT NULL,
  p_data_inicio_prevista  date    DEFAULT NULL,
  p_data_fim_prevista     date    DEFAULT NULL,
  p_area_ha               numeric DEFAULT NULL,
  p_pesquisador_nome      text    DEFAULT NULL,
  p_pesquisador_cpf       text    DEFAULT NULL,
  p_pesquisador_email     text    DEFAULT NULL,
  p_pesquisador_inst      text    DEFAULT NULL,
  p_pesquisador_telefone  text    DEFAULT NULL,
  p_pesquisador_lattes    text    DEFAULT NULL,
  p_pesquisador_titulacao text    DEFAULT NULL,
  p_pesquisador_rg        text    DEFAULT NULL,
  p_sisbio_numero         text    DEFAULT NULL,
  p_sisgen_numero         text    DEFAULT NULL,
  p_coleta_biologica      boolean DEFAULT false,
  p_pesquisa_humanos      boolean DEFAULT false,
  p_aceite_in_em          timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id     uuid;
  v_token  text;
  v_seq    int;
  v_ano    text;
  v_numero text;
BEGIN
  -- Token de 32 chars alfanumérico usando dois UUIDs (sem dependência de pgcrypto)
  v_token  := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  v_token  := substring(v_token from 1 for 32);

  v_ano    := to_char(now(), 'YYYY');
  v_seq    := nextval('seq_pesquisa_processo');
  v_numero := format('PESQ/SEMA-AC/%s/%s', v_ano, lpad(v_seq::text, 4, '0'));

  INSERT INTO pesquisas (
    numero_processo, titulo, resumo, tipo,
    uc_id, data_inicio_prevista, data_fim_prevista, area_pesquisa_ha,
    pesquisador_nome, pesquisador_cpf, pesquisador_email, pesquisador_instituicao,
    pesquisador_telefone, pesquisador_lattes, pesquisador_titulacao, pesquisador_rg,
    sisbio_numero, sisbio_status,
    sisgen_numero, sisgen_status,
    coleta_biologica, pesquisa_humanos,
    origem, token_publico, etapa,
    aceite_in_em
  )
  VALUES (
    v_numero, p_titulo, p_resumo, p_tipo,
    p_uc_id, p_data_inicio_prevista, p_data_fim_prevista, p_area_ha,
    p_pesquisador_nome, p_pesquisador_cpf, p_pesquisador_email, p_pesquisador_inst,
    p_pesquisador_telefone, p_pesquisador_lattes, p_pesquisador_titulacao, p_pesquisador_rg,
    p_sisbio_numero,
    CASE WHEN p_sisbio_numero IS NOT NULL THEN 'pendente'::vinculo_sisbio
         ELSE 'nao_requerido'::vinculo_sisbio END,
    nullif(p_sisgen_numero, ''),
    CASE WHEN p_sisgen_numero IS NOT NULL AND p_sisgen_numero <> '' THEN 'pendente'::vinculo_sisbio
         ELSE 'nao_requerido'::vinculo_sisbio END,
    p_coleta_biologica, p_pesquisa_humanos,
    'portal', v_token, 'submetida',
    COALESCE(p_aceite_in_em, now())
  )
  RETURNING id INTO v_id;

  INSERT INTO pesquisa_historico (pesquisa_id, etapa_anterior, etapa_nova, usuario_id, observacao)
  VALUES (v_id, NULL, 'submetida', NULL, 'Submetida pelo pesquisador via portal público.');

  IF p_pesquisador_email IS NOT NULL THEN
    INSERT INTO pesquisa_emails (pesquisa_id, evento, destinatario, assunto)
    VALUES (v_id, 'submissao', p_pesquisador_email,
            '[SIGUC] Pesquisa ' || v_numero || ' recebida — SEMA/AC');
  END IF;

  RETURN jsonb_build_object(
    'id',              v_id,
    'numero_processo', v_numero,
    'token_publico',   v_token
  );
END;
$$;
