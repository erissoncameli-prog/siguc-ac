-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Migration 030 — Equipe de Pesquisa
-- Dados completos do responsável + tabela de membros da equipe
-- ═══════════════════════════════════════════════════════════

-- ── Enum de funções na equipe ─────────────────────────────────

CREATE TYPE funcao_equipe_pesquisa AS ENUM (
  'co_orientador',
  'pesquisador_colaborador',
  'mestrando',
  'doutorando',
  'bolsista',
  'tecnico_campo',
  'estagiario',
  'auxiliar'
);

-- ── Colunas faltantes no pesquisador responsável ─────────────

ALTER TABLE pesquisas
  ADD COLUMN IF NOT EXISTS pesquisador_telefone  text,
  ADD COLUMN IF NOT EXISTS pesquisador_lattes    text,
  ADD COLUMN IF NOT EXISTS pesquisador_titulacao text,
  ADD COLUMN IF NOT EXISTS pesquisador_rg        text;

-- ── Tabela de equipe ──────────────────────────────────────────

CREATE TABLE pesquisa_equipe (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  pesquisa_id     uuid        NOT NULL REFERENCES pesquisas(id) ON DELETE CASCADE,
  nome_completo   text        NOT NULL,
  cpf             text        NOT NULL,
  rg              text,
  data_nascimento date,
  email           text        NOT NULL,
  telefone        text,
  instituicao     text,
  funcao          funcao_equipe_pesquisa NOT NULL,
  titulacao       text,
  lattes          text,
  criado_em       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX pesq_equipe_pesquisa_idx ON pesquisa_equipe(pesquisa_id);

-- ── RLS ───────────────────────────────────────────────────────

ALTER TABLE pesquisa_equipe ENABLE ROW LEVEL SECURITY;

-- Internos e o próprio pesquisador visualizam
CREATE POLICY "pesq_equipe_select" ON pesquisa_equipe FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM pesquisas p WHERE p.id = pesquisa_id
      AND (p.pesquisador_id = auth.uid()
           OR EXISTS (SELECT 1 FROM usuarios u WHERE u.id = auth.uid()
                        AND u.perfil IN ('tecnico','gestor','super_admin','financeiro')))
  )
);

-- INSERT público via service_role (funções SECURITY DEFINER fazem o insert)
CREATE POLICY "pesq_equipe_insert" ON pesquisa_equipe FOR INSERT WITH CHECK (true);

-- ── submeter_pesquisa_publica — atualizada com novos campos ───

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
  p_pesquisa_humanos      boolean DEFAULT false
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
  v_token  := encode(gen_random_bytes(18), 'base64');
  v_token  := replace(replace(replace(v_token, '+', 'A'), '/', 'B'), '=', '');
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
    origem, token_publico, etapa
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
    'portal', v_token, 'submetida'
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

-- ── inserir_equipe_pesquisa_publica ───────────────────────────
-- Chamada após submissão, usando o token público para autenticar

CREATE OR REPLACE FUNCTION inserir_equipe_pesquisa_publica(
  p_token   text,
  p_membros jsonb   -- [{"nome_completo":"...","cpf":"...","email":"...","funcao":"...",...}]
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pesquisa_id uuid;
  v_membro      jsonb;
BEGIN
  SELECT id INTO v_pesquisa_id
  FROM pesquisas WHERE token_publico = p_token;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Token inválido ou pesquisa não encontrada.';
  END IF;

  FOR v_membro IN SELECT value FROM jsonb_array_elements(p_membros)
  LOOP
    INSERT INTO pesquisa_equipe (
      pesquisa_id, nome_completo, cpf, rg, data_nascimento,
      email, telefone, instituicao, funcao, titulacao, lattes
    ) VALUES (
      v_pesquisa_id,
      v_membro->>'nome_completo',
      v_membro->>'cpf',
      nullif(trim(v_membro->>'rg'), ''),
      CASE WHEN nullif(trim(v_membro->>'data_nascimento'), '') IS NOT NULL
           THEN (v_membro->>'data_nascimento')::date ELSE NULL END,
      v_membro->>'email',
      nullif(trim(v_membro->>'telefone'), ''),
      nullif(trim(v_membro->>'instituicao'), ''),
      (v_membro->>'funcao')::funcao_equipe_pesquisa,
      nullif(trim(v_membro->>'titulacao'), ''),
      nullif(trim(v_membro->>'lattes'), '')
    );
  END LOOP;
END;
$$;
