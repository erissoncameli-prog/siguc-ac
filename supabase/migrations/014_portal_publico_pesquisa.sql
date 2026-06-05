-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Migration 014 — Portal Público de Submissão de Pesquisa
-- Documentos, log de e-mails, token público de acompanhamento
-- ═══════════════════════════════════════════════════════════

-- ─── Campos adicionais em pesquisas ──────────────────────────

ALTER TABLE pesquisas
  ADD COLUMN IF NOT EXISTS token_publico        text UNIQUE,
  ADD COLUMN IF NOT EXISTS coleta_biologica     boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS pesquisa_humanos     boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS origem               text NOT NULL DEFAULT 'interno',
  -- 'interno' = criado pelo gestor | 'portal' = submetido pelo pesquisador
  ADD COLUMN IF NOT EXISTS complementacao_solicitada    boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS complementacao_motivo        text,
  ADD COLUMN IF NOT EXISTS complementacao_prazo         date;

CREATE INDEX pesquisas_token_idx ON pesquisas(token_publico) WHERE token_publico IS NOT NULL;

-- ─── Tabela de documentos ─────────────────────────────────────

CREATE TYPE tipo_documento_pesquisa AS ENUM (
  'formulario',       -- Formulário de pesquisa assinado
  'proposta',         -- Proposta digital do projeto
  'sisbio',           -- Comprovante SISBIO
  'conep',            -- Registro CONEP
  'aap_pdf',          -- PDF da AAP gerada
  'relatorio_parcial',
  'relatorio_final',
  'complementar',     -- Documento solicitado em complementação
  'outro'
);

CREATE TABLE pesquisa_documentos (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  pesquisa_id     uuid        NOT NULL REFERENCES pesquisas(id) ON DELETE CASCADE,
  tipo            tipo_documento_pesquisa NOT NULL,
  nome_original   text        NOT NULL,
  storage_path    text        NOT NULL,        -- caminho no bucket pesquisa-documentos
  tamanho_bytes   bigint,
  mime_type       text,
  enviado_por     text        NOT NULL DEFAULT 'pesquisador',
  -- 'pesquisador' | uuid do usuário interno
  observacao      text,
  criado_em       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX pesq_docs_pesquisa_idx ON pesquisa_documentos(pesquisa_id);
CREATE INDEX pesq_docs_tipo_idx     ON pesquisa_documentos(tipo);

-- ─── Log de e-mails ───────────────────────────────────────────

CREATE TYPE status_email AS ENUM ('pendente','enviado','erro');

CREATE TABLE pesquisa_emails (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  pesquisa_id     uuid        REFERENCES pesquisas(id) ON DELETE CASCADE,
  evento          text        NOT NULL,
  -- 'submissao' | 'triagem_aprovada' | 'triagem_rejeitada' | 'exigencia'
  -- 'aap_emitida' | 'relatorio_solicitado' | 'encerrada' | 'complementacao'
  destinatario    text        NOT NULL,
  assunto         text        NOT NULL,
  status          status_email NOT NULL DEFAULT 'pendente',
  resend_id       text,                        -- ID retornado pela Resend API
  erro            text,
  criado_em       timestamptz NOT NULL DEFAULT now(),
  enviado_em      timestamptz
);

CREATE INDEX pesq_emails_pesquisa_idx ON pesquisa_emails(pesquisa_id);

-- ─── RLS ─────────────────────────────────────────────────────

ALTER TABLE pesquisa_documentos ENABLE ROW LEVEL SECURITY;
ALTER TABLE pesquisa_emails     ENABLE ROW LEVEL SECURITY;

-- Documentos: usuários autenticados leem conforme RLS de pesquisas
CREATE POLICY "pesq_docs_select" ON pesquisa_documentos FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM pesquisas p WHERE p.id = pesquisa_id
      AND (p.pesquisador_id = auth.uid()
           OR EXISTS (SELECT 1 FROM usuarios u WHERE u.id = auth.uid()
                        AND u.perfil IN ('tecnico','gestor','super_admin','financeiro')))
  )
);

-- INSERT público permitido via service_role (Edge Function faz o upload)
CREATE POLICY "pesq_docs_insert" ON pesquisa_documentos FOR INSERT WITH CHECK (true);

-- E-mails: apenas internos leem
CREATE POLICY "pesq_emails_select" ON pesquisa_emails FOR SELECT USING (
  EXISTS (SELECT 1 FROM usuarios u WHERE u.id = auth.uid()
            AND u.perfil IN ('gestor','super_admin'))
);

CREATE POLICY "pesq_emails_insert" ON pesquisa_emails FOR INSERT WITH CHECK (true);
CREATE POLICY "pesq_emails_update" ON pesquisa_emails FOR UPDATE USING (true);

-- ─── Função: submissão pública (sem auth) ────────────────────

CREATE OR REPLACE FUNCTION submeter_pesquisa_publica(
  p_titulo                text,
  p_resumo                text,
  p_tipo                  tipo_pesquisa,
  p_uc_id                 uuid DEFAULT NULL,
  p_data_inicio_prevista  date DEFAULT NULL,
  p_data_fim_prevista     date DEFAULT NULL,
  p_area_ha               numeric DEFAULT NULL,
  p_pesquisador_nome      text DEFAULT NULL,
  p_pesquisador_cpf       text DEFAULT NULL,
  p_pesquisador_email     text DEFAULT NULL,
  p_pesquisador_inst      text DEFAULT NULL,
  p_sisbio_numero         text DEFAULT NULL,
  p_sisgen_numero         text DEFAULT NULL,
  p_coleta_biologica      boolean DEFAULT false,
  p_pesquisa_humanos      boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_id      uuid;
  v_token   text;
  v_seq     int;
  v_ano     text;
  v_numero  text;
BEGIN
  -- Gera token público e número de processo
  v_token := encode(gen_random_bytes(18), 'base64');
  v_token := replace(replace(replace(v_token, '+', 'A'), '/', 'B'), '=', '');

  v_ano  := to_char(now(), 'YYYY');
  v_seq  := nextval('seq_pesquisa_processo');
  v_numero := format('PESQ/SEMA-AC/%s/%s', v_ano, lpad(v_seq::text, 4, '0'));

  INSERT INTO pesquisas (
    numero_processo, titulo, resumo, tipo,
    uc_id, data_inicio_prevista, data_fim_prevista, area_pesquisa_ha,
    pesquisador_nome, pesquisador_cpf, pesquisador_email, pesquisador_instituicao,
    sisbio_numero, sisbio_status,
    sisgen_numero, sisgen_status,
    coleta_biologica, pesquisa_humanos,
    origem, token_publico, etapa
  )
  VALUES (
    v_numero, p_titulo, p_resumo, p_tipo,
    p_uc_id, p_data_inicio_prevista, p_data_fim_prevista, p_area_ha,
    p_pesquisador_nome, p_pesquisador_cpf, p_pesquisador_email, p_pesquisador_inst,
    p_sisbio_numero, CASE WHEN p_sisbio_numero IS NOT NULL THEN 'pendente'::vinculo_sisbio ELSE 'nao_requerido'::vinculo_sisbio END,
    nullif(p_sisgen_numero,''), CASE WHEN p_sisgen_numero IS NOT NULL AND p_sisgen_numero <> '' THEN 'pendente'::vinculo_sisbio ELSE 'nao_requerido'::vinculo_sisbio END,
    p_coleta_biologica, p_pesquisa_humanos,
    'portal', v_token, 'submetida'
  )
  RETURNING id INTO v_id;

  INSERT INTO pesquisa_historico (pesquisa_id, etapa_anterior, etapa_nova, usuario_id, observacao)
  VALUES (v_id, NULL, 'submetida', NULL, 'Submetida pelo pesquisador via portal público.');

  -- Log do e-mail de confirmação (a Edge Function envia de fato)
  INSERT INTO pesquisa_emails (pesquisa_id, evento, destinatario, assunto)
  VALUES (v_id, 'submissao', p_pesquisador_email,
          '[SIGUC] Pesquisa ' || v_numero || ' recebida — SEMA/AC');

  RETURN jsonb_build_object(
    'id',              v_id,
    'numero_processo', v_numero,
    'token_publico',   v_token
  );
END;
$$;

-- ─── Função: solicitar complementação de documentos ──────────

CREATE OR REPLACE FUNCTION solicitar_complementacao(
  p_pesquisa_id uuid,
  p_motivo      text,
  p_prazo_dias  int DEFAULT 15
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_email text;
  v_num   text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM usuarios WHERE id = auth.uid()
                   AND perfil IN ('tecnico','gestor','super_admin')) THEN
    RAISE EXCEPTION 'Sem permissão.';
  END IF;

  SELECT pesquisador_email, numero_processo INTO v_email, v_num
  FROM pesquisas WHERE id = p_pesquisa_id;

  UPDATE pesquisas SET
    complementacao_solicitada = true,
    complementacao_motivo     = p_motivo,
    complementacao_prazo      = (now() + (p_prazo_dias || ' days')::interval)::date
  WHERE id = p_pesquisa_id;

  INSERT INTO pesquisa_emails (pesquisa_id, evento, destinatario, assunto)
  VALUES (p_pesquisa_id, 'complementacao', v_email,
          '[SIGUC] Documentação complementar solicitada — ' || v_num);

  INSERT INTO pesquisa_historico (pesquisa_id, etapa_anterior, etapa_nova, usuario_id, observacao)
  SELECT etapa, etapa, auth.uid(), 'Complementação solicitada: ' || p_motivo
  FROM pesquisas WHERE id = p_pesquisa_id;
END;
$$;

-- ─── Função: busca pública por token (sem auth) ───────────────

CREATE OR REPLACE FUNCTION buscar_pesquisa_por_token(p_token text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT jsonb_build_object(
    'id',                       p.id,
    'numero_processo',          p.numero_processo,
    'titulo',                   p.titulo,
    'tipo',                     p.tipo,
    'etapa',                    p.etapa,
    'pesquisador_nome',         p.pesquisador_nome,
    'pesquisador_email',        p.pesquisador_email,
    'uc_nome',                  uc.nome,
    'data_inicio_prevista',     p.data_inicio_prevista,
    'data_fim_prevista',        p.data_fim_prevista,
    'aap_numero',               p.aap_numero,
    'aap_validade',             p.aap_validade,
    'complementacao_solicitada',p.complementacao_solicitada,
    'complementacao_motivo',    p.complementacao_motivo,
    'complementacao_prazo',     p.complementacao_prazo,
    'inadimplente',             p.inadimplente,
    'criado_em',                p.criado_em,
    'historico', (
      SELECT jsonb_agg(jsonb_build_object(
        'etapa_nova',   h.etapa_nova,
        'observacao',   h.observacao,
        'criado_em',    h.criado_em
      ) ORDER BY h.criado_em)
      FROM pesquisa_historico h WHERE h.pesquisa_id = p.id
    ),
    'documentos', (
      SELECT jsonb_agg(jsonb_build_object(
        'id',           d.id,
        'tipo',         d.tipo,
        'nome_original',d.nome_original,
        'criado_em',    d.criado_em
      ) ORDER BY d.criado_em)
      FROM pesquisa_documentos d WHERE d.pesquisa_id = p.id
    )
  )
  FROM pesquisas p
  LEFT JOIN unidades_conservacao uc ON uc.id = p.uc_id
  WHERE p.token_publico = p_token
  LIMIT 1;
$$;
