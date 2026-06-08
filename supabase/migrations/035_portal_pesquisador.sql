-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Migration 035 — Portal Autenticado do Pesquisador
-- Contas externas de pesquisadores + fluxo de submissão autenticado
-- ═══════════════════════════════════════════════════════════

-- ─── Tabela de pesquisadores ──────────────────────────────

CREATE TABLE pesquisadores (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid UNIQUE NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  nome_completo text NOT NULL,
  cpf           text,
  email         text NOT NULL,
  telefone      text,
  instituicao   text,
  titulacao     text,   -- graduado|especialista|mestre|doutor|pos_doutor
  lattes        text,
  rg            text,
  area_formacao text,   -- grande área CNPq
  especialidade text,
  ativo         boolean NOT NULL DEFAULT true,
  criado_em     timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX pesquisadores_user_idx  ON pesquisadores(user_id);
CREATE INDEX pesquisadores_email_idx ON pesquisadores(email);

CREATE TRIGGER touch_pesquisadores
  BEFORE UPDATE ON pesquisadores
  FOR EACH ROW EXECUTE FUNCTION touch_atualizado_em();

-- ─── Coluna de vínculo na tabela pesquisas ────────────────

ALTER TABLE pesquisas
  ADD COLUMN IF NOT EXISTS pesquisador_conta_id uuid
    REFERENCES pesquisadores(id) ON DELETE SET NULL;

CREATE INDEX pesquisas_conta_idx ON pesquisas(pesquisador_conta_id)
  WHERE pesquisador_conta_id IS NOT NULL;

-- ─── RLS pesquisadores ────────────────────────────────────

ALTER TABLE pesquisadores ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pesquisadores_select" ON pesquisadores FOR SELECT USING (
  user_id = auth.uid()
  OR EXISTS (SELECT 1 FROM usuarios u WHERE u.id = auth.uid()
               AND u.perfil IN ('tecnico','gestor','super_admin'))
);

CREATE POLICY "pesquisadores_insert" ON pesquisadores FOR INSERT WITH CHECK (
  user_id = auth.uid()
);

CREATE POLICY "pesquisadores_update" ON pesquisadores FOR UPDATE USING (
  user_id = auth.uid()
  OR EXISTS (SELECT 1 FROM usuarios u WHERE u.id = auth.uid()
               AND u.perfil IN ('gestor','super_admin'))
);

-- ─── Atualizar RLS pesquisas ──────────────────────────────

DROP POLICY IF EXISTS "pesquisas_select" ON pesquisas;
DROP POLICY IF EXISTS "pesquisas_insert" ON pesquisas;
DROP POLICY IF EXISTS "pesquisas_update" ON pesquisas;

CREATE POLICY "pesquisas_select" ON pesquisas FOR SELECT USING (
  pesquisador_id = auth.uid()
  OR EXISTS (SELECT 1 FROM pesquisadores p
               WHERE p.id = pesquisador_conta_id AND p.user_id = auth.uid())
  OR EXISTS (SELECT 1 FROM usuarios u WHERE u.id = auth.uid()
               AND u.perfil IN ('tecnico','gestor','super_admin','financeiro'))
);

CREATE POLICY "pesquisas_insert" ON pesquisas FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM pesquisadores p
            WHERE p.id = pesquisador_conta_id AND p.user_id = auth.uid())
  OR EXISTS (SELECT 1 FROM usuarios u WHERE u.id = auth.uid()
               AND u.perfil IN ('tecnico','gestor','super_admin'))
);

CREATE POLICY "pesquisas_update" ON pesquisas FOR UPDATE USING (
  (EXISTS (SELECT 1 FROM pesquisadores p
             WHERE p.id = pesquisador_conta_id AND p.user_id = auth.uid())
    AND etapa IN ('submetida','em_campo','relatorio_parcial','relatorio_final'))
  OR pesquisador_id = auth.uid()
  OR EXISTS (SELECT 1 FROM usuarios u WHERE u.id = auth.uid()
               AND u.perfil IN ('tecnico','gestor','super_admin'))
);

-- ─── Atualizar RLS pesquisa_relatorios ────────────────────

DROP POLICY IF EXISTS "rel_select" ON pesquisa_relatorios;
DROP POLICY IF EXISTS "rel_insert" ON pesquisa_relatorios;
DROP POLICY IF EXISTS "rel_update" ON pesquisa_relatorios;

CREATE POLICY "rel_select" ON pesquisa_relatorios FOR SELECT USING (
  EXISTS (SELECT 1 FROM pesquisas p WHERE p.id = pesquisa_id
    AND (p.pesquisador_id = auth.uid()
         OR EXISTS (SELECT 1 FROM pesquisadores pr
                      WHERE pr.id = p.pesquisador_conta_id AND pr.user_id = auth.uid())
         OR EXISTS (SELECT 1 FROM usuarios u WHERE u.id = auth.uid()
                      AND u.perfil IN ('tecnico','gestor','super_admin','financeiro'))))
);

CREATE POLICY "rel_insert" ON pesquisa_relatorios FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM pesquisas p WHERE p.id = pesquisa_id
    AND (p.pesquisador_id = auth.uid()
         OR EXISTS (SELECT 1 FROM pesquisadores pr
                      WHERE pr.id = p.pesquisador_conta_id AND pr.user_id = auth.uid())
         OR EXISTS (SELECT 1 FROM usuarios u WHERE u.id = auth.uid()
                      AND u.perfil IN ('tecnico','gestor','super_admin'))))
);

CREATE POLICY "rel_update" ON pesquisa_relatorios FOR UPDATE USING (
  EXISTS (SELECT 1 FROM pesquisas p WHERE p.id = pesquisa_id
    AND (p.pesquisador_id = auth.uid()
         OR EXISTS (SELECT 1 FROM pesquisadores pr
                      WHERE pr.id = p.pesquisador_conta_id AND pr.user_id = auth.uid())
         OR EXISTS (SELECT 1 FROM usuarios u WHERE u.id = auth.uid()
                      AND u.perfil IN ('tecnico','gestor','super_admin'))))
);

-- ─── Atualizar RLS pesquisa_documentos ───────────────────

DROP POLICY IF EXISTS "pesq_docs_select" ON pesquisa_documentos;

CREATE POLICY "pesq_docs_select" ON pesquisa_documentos FOR SELECT USING (
  EXISTS (SELECT 1 FROM pesquisas p WHERE p.id = pesquisa_id
    AND (p.pesquisador_id = auth.uid()
         OR EXISTS (SELECT 1 FROM pesquisadores pr
                      WHERE pr.id = p.pesquisador_conta_id AND pr.user_id = auth.uid())
         OR EXISTS (SELECT 1 FROM usuarios u WHERE u.id = auth.uid()
                      AND u.perfil IN ('tecnico','gestor','super_admin','financeiro'))))
);

-- ─── Atualizar RLS pesquisa_historico ────────────────────

DROP POLICY IF EXISTS "hist_select" ON pesquisa_historico;

CREATE POLICY "hist_select" ON pesquisa_historico FOR SELECT USING (
  EXISTS (SELECT 1 FROM pesquisas p WHERE p.id = pesquisa_id
    AND (p.pesquisador_id = auth.uid()
         OR EXISTS (SELECT 1 FROM pesquisadores pr
                      WHERE pr.id = p.pesquisador_conta_id AND pr.user_id = auth.uid())
         OR EXISTS (SELECT 1 FROM usuarios u WHERE u.id = auth.uid()
                      AND u.perfil IN ('tecnico','gestor','super_admin'))))
);

-- ─── Função: submissão autenticada ───────────────────────

CREATE OR REPLACE FUNCTION submeter_pesquisa_autenticada(
  p_titulo               text,
  p_resumo               text,
  p_tipo                 tipo_pesquisa,
  p_uc_id                uuid        DEFAULT NULL,
  p_data_inicio_prevista date        DEFAULT NULL,
  p_data_fim_prevista    date        DEFAULT NULL,
  p_area_ha              numeric     DEFAULT NULL,
  p_sisbio_numero        text        DEFAULT NULL,
  p_sisgen_numero        text        DEFAULT NULL,
  p_coleta_biologica     boolean     DEFAULT false,
  p_pesquisa_humanos     boolean     DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id    uuid;
  v_token text;
  v_seq   int;
  v_ano   text;
  v_num   text;
  v_pesq  pesquisadores%ROWTYPE;
BEGIN
  SELECT * INTO v_pesq FROM pesquisadores WHERE user_id = auth.uid();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pesquisador não encontrado. Conclua seu cadastro primeiro.';
  END IF;
  IF NOT v_pesq.ativo THEN
    RAISE EXCEPTION 'Conta inativa. Contate o DEUC/SEMA-AC.';
  END IF;

  v_token := replace(replace(replace(
    encode(gen_random_bytes(18), 'base64'), '+', 'A'), '/', 'B'), '=', '');
  v_ano   := to_char(now(), 'YYYY');
  v_seq   := nextval('seq_pesquisa_processo');
  v_num   := format('PESQ/SEMA-AC/%s/%s', v_ano, lpad(v_seq::text, 4, '0'));

  INSERT INTO pesquisas (
    numero_processo, titulo, resumo, tipo,
    uc_id, data_inicio_prevista, data_fim_prevista, area_pesquisa_ha,
    pesquisador_conta_id,
    pesquisador_nome, pesquisador_cpf, pesquisador_email,
    pesquisador_instituicao, pesquisador_titulacao,
    pesquisador_area_formacao, pesquisador_especialidade,
    sisbio_numero, sisbio_status,
    sisgen_numero, sisgen_status,
    coleta_biologica, pesquisa_humanos,
    origem, token_publico, etapa, aceite_in_em
  )
  VALUES (
    v_num, p_titulo, p_resumo, p_tipo,
    p_uc_id, p_data_inicio_prevista, p_data_fim_prevista, p_area_ha,
    v_pesq.id,
    v_pesq.nome_completo, v_pesq.cpf, v_pesq.email,
    v_pesq.instituicao, v_pesq.titulacao,
    v_pesq.area_formacao, v_pesq.especialidade,
    nullif(p_sisbio_numero, ''),
    CASE WHEN p_sisbio_numero IS NOT NULL AND p_sisbio_numero <> ''
         THEN 'pendente'::vinculo_sisbio ELSE 'nao_requerido'::vinculo_sisbio END,
    nullif(p_sisgen_numero, ''),
    CASE WHEN p_sisgen_numero IS NOT NULL AND p_sisgen_numero <> ''
         THEN 'pendente'::vinculo_sisbio ELSE 'nao_requerido'::vinculo_sisbio END,
    p_coleta_biologica, p_pesquisa_humanos,
    'portal', v_token, 'submetida', now()
  )
  RETURNING id INTO v_id;

  INSERT INTO pesquisa_historico (pesquisa_id, etapa_anterior, etapa_nova, observacao)
  VALUES (v_id, NULL, 'submetida', 'Submetida pelo pesquisador via portal autenticado.');

  INSERT INTO pesquisa_emails (pesquisa_id, evento, destinatario, assunto)
  VALUES (v_id, 'submissao', v_pesq.email,
          '[SIGUC] Pesquisa ' || v_num || ' recebida — SEMA/AC');

  RETURN jsonb_build_object(
    'id',              v_id,
    'numero_processo', v_num,
    'token_publico',   v_token
  );
END;
$$;

-- ─── Função: vincular submissões públicas antigas por e-mail ─

CREATE OR REPLACE FUNCTION vincular_pesquisas_por_email()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pesq  pesquisadores%ROWTYPE;
  v_count int;
BEGIN
  SELECT * INTO v_pesq FROM pesquisadores WHERE user_id = auth.uid();
  IF NOT FOUND THEN RETURN 0; END IF;

  UPDATE pesquisas
  SET pesquisador_conta_id = v_pesq.id
  WHERE pesquisador_conta_id IS NULL
    AND pesquisador_email = v_pesq.email;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;
