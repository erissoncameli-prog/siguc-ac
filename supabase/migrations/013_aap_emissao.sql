-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Migration 013 — Emissão de AAP
-- Gera número sequencial, token QR e metadados da autorização
-- ═══════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION emitir_aap(
  p_pesquisa_id   uuid,
  p_validade_dias int DEFAULT 365
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_pesquisa     pesquisas%ROWTYPE;
  v_seq          int;
  v_numero_aap   text;
  v_token        text;
  v_ano          text;
  v_resultado    jsonb;
BEGIN
  -- Apenas gestor e super_admin emitem AAP
  IF NOT EXISTS (SELECT 1 FROM usuarios WHERE id = auth.uid()
                   AND perfil IN ('gestor','super_admin')) THEN
    RAISE EXCEPTION 'Sem permissão para emitir AAP.';
  END IF;

  SELECT * INTO v_pesquisa FROM pesquisas WHERE id = p_pesquisa_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pesquisa não encontrada: %', p_pesquisa_id;
  END IF;

  IF v_pesquisa.etapa NOT IN ('aap_emissao','parecer_juridico') THEN
    RAISE EXCEPTION 'Pesquisa não está na etapa de emissão de AAP. Etapa atual: %', v_pesquisa.etapa;
  END IF;

  IF v_pesquisa.aap_numero IS NOT NULL THEN
    RAISE EXCEPTION 'AAP já emitida para esta pesquisa: %', v_pesquisa.aap_numero;
  END IF;

  IF v_pesquisa.inadimplente THEN
    RAISE EXCEPTION 'Pesquisador inadimplente. Regularize antes de emitir AAP.';
  END IF;

  -- Gera número sequencial: AAP/SEMA-AC/YYYY/NNN
  v_ano  := to_char(now(), 'YYYY');
  v_seq  := nextval('seq_pesquisa_processo');
  v_numero_aap := format('AAP/SEMA-AC/%s/%s', v_ano, lpad(v_seq::text, 4, '0'));

  -- Token único para URL pública de verificação (QR code)
  v_token := encode(gen_random_bytes(18), 'base64');
  -- Remove caracteres não URL-safe
  v_token := replace(replace(replace(v_token, '+', 'A'), '/', 'B'), '=', '');

  UPDATE pesquisas SET
    aap_numero     = v_numero_aap,
    aap_qr_token   = v_token,
    aap_emitida_em = now(),
    aap_validade   = (now() + (p_validade_dias || ' days')::interval)::date,
    etapa          = 'aap_emissao'
  WHERE id = p_pesquisa_id;

  INSERT INTO pesquisa_historico (pesquisa_id, etapa_anterior, etapa_nova, usuario_id, observacao)
  VALUES (p_pesquisa_id, v_pesquisa.etapa, 'aap_emissao', auth.uid(),
          'AAP emitida: ' || v_numero_aap);

  -- Número de processo geral (diferente do número AAP)
  IF v_pesquisa.numero_processo IS NULL THEN
    UPDATE pesquisas
    SET numero_processo = format('PESQ/SEMA-AC/%s/%s', v_ano, lpad(v_seq::text, 4, '0'))
    WHERE id = p_pesquisa_id;
  END IF;

  v_resultado := jsonb_build_object(
    'aap_numero',   v_numero_aap,
    'aap_token',    v_token,
    'emitida_em',   now(),
    'validade',     (now() + (p_validade_dias || ' days')::interval)::date,
    'verificacao_url', 'https://siguc.sema.ac.gov.br/verificar/aap/' || v_token
  );

  -- Notifica o pesquisador
  INSERT INTO notificacoes (tipo, status, titulo, mensagem, destinatario_id, uc_id, sla_horas, sla_prazo, meta)
  VALUES (
    'documento_pendente', 'enviada',
    'AAP emitida: ' || v_numero_aap,
    format('Sua Autorização de Acesso e Pesquisa foi emitida com validade até %s. Acesse o sistema para baixar o PDF.',
           to_char((now() + (p_validade_dias || ' days')::interval)::date, 'DD/MM/YYYY')),
    v_pesquisa.pesquisador_id,
    v_pesquisa.uc_id, 24, now() + interval '24 hours',
    v_resultado
  );

  RETURN v_resultado;
END;
$$;

-- ─── Função: assinar AAP (Diretor DIMA) ──────────────────────

CREATE OR REPLACE FUNCTION assinar_aap(
  p_pesquisa_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_etapa etapa_pesquisa;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM usuarios WHERE id = auth.uid()
                   AND perfil IN ('gestor','super_admin')) THEN
    RAISE EXCEPTION 'Sem permissão para assinar AAP.';
  END IF;

  SELECT etapa INTO v_etapa FROM pesquisas WHERE id = p_pesquisa_id FOR UPDATE;

  IF v_etapa <> 'aap_emissao' THEN
    RAISE EXCEPTION 'AAP não está na etapa de assinatura. Etapa atual: %', v_etapa;
  END IF;

  UPDATE pesquisas SET
    aap_assinado_por = auth.uid(),
    aap_assinado_em  = now(),
    etapa            = 'aap_assinatura'
  WHERE id = p_pesquisa_id;

  INSERT INTO pesquisa_historico (pesquisa_id, etapa_anterior, etapa_nova, usuario_id, observacao)
  VALUES (p_pesquisa_id, 'aap_emissao', 'aap_assinatura', auth.uid(), 'AAP assinada pelo Diretor DIMA.');
END;
$$;

-- ─── Função: publicar AAP (torna pública e avança para campo) ─

CREATE OR REPLACE FUNCTION publicar_aap(p_pesquisa_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM usuarios WHERE id = auth.uid()
                   AND perfil IN ('gestor','super_admin')) THEN
    RAISE EXCEPTION 'Sem permissão.';
  END IF;

  UPDATE pesquisas SET etapa = 'aap_publicada'
  WHERE id = p_pesquisa_id AND etapa = 'aap_assinatura';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pesquisa não está na etapa de assinatura.';
  END IF;

  INSERT INTO pesquisa_historico (pesquisa_id, etapa_anterior, etapa_nova, usuario_id, observacao)
  VALUES (p_pesquisa_id, 'aap_assinatura', 'aap_publicada', auth.uid(), 'AAP publicada e entregue ao pesquisador.');
END;
$$;

-- ─── Função: verificação pública de AAP por token (sem auth) ──
-- Usada pela página /verificar/aap/:token — sem RLS

CREATE OR REPLACE FUNCTION verificar_aap_publica(p_token text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT to_jsonb(v) FROM v_aap_publica v WHERE aap_qr_token = p_token LIMIT 1;
$$;
