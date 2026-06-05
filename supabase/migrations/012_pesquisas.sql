-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Migration 012 — Gestão de Pesquisa Científica
-- 13 etapas: submissão → triagem → análise → AAP → campo → relatórios → encerramento
-- ═══════════════════════════════════════════════════════════

-- ─── Enums ───────────────────────────────────────────────────

CREATE TYPE etapa_pesquisa AS ENUM (
  'submetida',          -- 1  Pesquisador submete
  'triagem',            -- 2  DEUC aceita ou rejeita
  'analise_tecnica',    -- 3  Analista UC avalia mérito
  'parecer_juridico',   -- 4  Jurídico emite parecer
  'aap_emissao',        -- 5  Gestor gera AAP
  'aap_assinatura',     -- 6  Diretor DIMA assina
  'aap_publicada',      -- 7  AAP publicada / entregue
  'em_campo',           -- 8  Execução em campo
  'relatorio_parcial',  -- 9  Relatório parcial (semestral)
  'relatorio_final',    -- 10 Relatório final entregue
  'analise_relatorio',  -- 11 Análise dos relatórios
  'encerrada',          -- 12 Encerramento formal
  'arquivada'           -- 13 Arquivamento
);

CREATE TYPE resultado_triagem AS ENUM ('pendente','aprovada','rejeitada','exigencia');
CREATE TYPE tipo_pesquisa     AS ENUM ('fauna','flora','genetica','ecossistema','socioambiental','outro');
CREATE TYPE vinculo_sisbio    AS ENUM ('nao_requerido','pendente','validado','invalido');

-- ─── Tabela principal ─────────────────────────────────────────

CREATE TABLE pesquisas (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Identificação
  numero_processo     text        UNIQUE,               -- gerado ao aceitar triagem
  titulo              text        NOT NULL,
  resumo              text        NOT NULL,
  tipo                tipo_pesquisa NOT NULL DEFAULT 'fauna',
  etapa               etapa_pesquisa NOT NULL DEFAULT 'submetida',

  -- UC e área
  uc_id               uuid        REFERENCES unidades_conservacao(id) ON DELETE SET NULL,
  area_pesquisa_ha    numeric(12,2),

  -- Datas de execução previstas
  data_inicio_prevista date,
  data_fim_prevista    date,
  data_inicio_real     date,
  data_fim_real        date,

  -- Pesquisador responsável
  pesquisador_id      uuid        REFERENCES usuarios(id) ON DELETE SET NULL,
  pesquisador_nome    text,                             -- cache para externos não cadastrados
  pesquisador_cpf     text,
  pesquisador_email   text,
  pesquisador_instituicao text,

  -- SISBIO
  sisbio_numero       text,
  sisbio_status       vinculo_sisbio NOT NULL DEFAULT 'nao_requerido',
  sisbio_validade     date,
  sisbio_validado_em  timestamptz,
  sisbio_dados        jsonb,                            -- payload bruto da API IBAMA

  -- SISGEN
  sisgen_numero       text,
  sisgen_status       vinculo_sisbio NOT NULL DEFAULT 'nao_requerido',
  sisgen_validado_em  timestamptz,
  sisgen_dados        jsonb,

  -- Triagem
  triagem_resultado   resultado_triagem NOT NULL DEFAULT 'pendente',
  triagem_responsavel uuid        REFERENCES usuarios(id),
  triagem_em          timestamptz,
  triagem_observacao  text,

  -- AAP
  aap_numero          text        UNIQUE,               -- ex: AAP/SEMA-AC/2025/001
  aap_emitida_em      timestamptz,
  aap_validade        date,
  aap_qr_token        text        UNIQUE,               -- token para URL de verificação pública
  aap_assinado_por    uuid        REFERENCES usuarios(id),
  aap_assinado_em     timestamptz,
  aap_pdf_path        text,                             -- caminho no Supabase Storage

  -- Inadimplência
  inadimplente        boolean     NOT NULL DEFAULT false,
  inadimplencia_motivo text,
  inadimplencia_em    timestamptz,

  -- Responsáveis internos
  analista_id         uuid        REFERENCES usuarios(id),
  gestor_uc_id        uuid        REFERENCES usuarios(id),

  -- Auditoria
  criado_por          uuid        REFERENCES usuarios(id),
  criado_em           timestamptz NOT NULL DEFAULT now(),
  atualizado_em       timestamptz NOT NULL DEFAULT now()
);

-- ─── Relatórios ───────────────────────────────────────────────

CREATE TYPE tipo_relatorio_pesquisa AS ENUM ('parcial','final','complementar');
CREATE TYPE status_relatorio        AS ENUM ('pendente','entregue','aprovado','reprovado','exigencia');

CREATE TABLE pesquisa_relatorios (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  pesquisa_id     uuid        NOT NULL REFERENCES pesquisas(id) ON DELETE CASCADE,
  tipo            tipo_relatorio_pesquisa NOT NULL,
  status          status_relatorio NOT NULL DEFAULT 'pendente',
  periodo_ref     text,                                 -- ex: "1º semestre 2025"
  prazo           date,
  entregue_em     timestamptz,
  avaliado_em     timestamptz,
  avaliado_por    uuid        REFERENCES usuarios(id),
  arquivo_path    text,
  observacoes     text,
  criado_em       timestamptz NOT NULL DEFAULT now()
);

-- ─── Histórico de etapas ──────────────────────────────────────

CREATE TABLE pesquisa_historico (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  pesquisa_id     uuid        NOT NULL REFERENCES pesquisas(id) ON DELETE CASCADE,
  etapa_anterior  etapa_pesquisa,
  etapa_nova      etapa_pesquisa NOT NULL,
  usuario_id      uuid        REFERENCES usuarios(id),
  observacao      text,
  criado_em       timestamptz NOT NULL DEFAULT now()
);

-- ─── Índices ─────────────────────────────────────────────────

CREATE INDEX pesquisas_uc_idx          ON pesquisas(uc_id);
CREATE INDEX pesquisas_etapa_idx       ON pesquisas(etapa);
CREATE INDEX pesquisas_pesquisador_idx ON pesquisas(pesquisador_id);
CREATE INDEX pesquisas_aap_token_idx   ON pesquisas(aap_qr_token) WHERE aap_qr_token IS NOT NULL;
CREATE INDEX pesquisas_inadimplente_idx ON pesquisas(inadimplente) WHERE inadimplente = true;
CREATE INDEX pesquisa_rel_pesquisa_idx ON pesquisa_relatorios(pesquisa_id);
CREATE INDEX pesquisa_hist_pesq_idx    ON pesquisa_historico(pesquisa_id);

-- ─── Triggers ─────────────────────────────────────────────────

CREATE TRIGGER touch_pesquisas
  BEFORE UPDATE ON pesquisas
  FOR EACH ROW EXECUTE FUNCTION touch_atualizado_em();

-- ─── Sequência para número de processo ───────────────────────

CREATE SEQUENCE seq_pesquisa_processo START 1;

-- ─── RLS ─────────────────────────────────────────────────────

ALTER TABLE pesquisas             ENABLE ROW LEVEL SECURITY;
ALTER TABLE pesquisa_relatorios   ENABLE ROW LEVEL SECURITY;
ALTER TABLE pesquisa_historico    ENABLE ROW LEVEL SECURITY;

-- Pesquisas: pesquisador vê apenas as suas; internos veem todas da sua UC ou perfil
CREATE POLICY "pesquisas_select" ON pesquisas FOR SELECT USING (
  pesquisador_id = auth.uid()
  OR EXISTS (
    SELECT 1 FROM usuarios u WHERE u.id = auth.uid()
      AND u.perfil IN ('tecnico','gestor','super_admin','financeiro')
  )
);

CREATE POLICY "pesquisas_insert" ON pesquisas FOR INSERT WITH CHECK (
  -- pesquisador submete a si mesmo, ou interno cria
  pesquisador_id = auth.uid()
  OR EXISTS (SELECT 1 FROM usuarios u WHERE u.id = auth.uid()
               AND u.perfil IN ('tecnico','gestor','super_admin'))
);

CREATE POLICY "pesquisas_update" ON pesquisas FOR UPDATE USING (
  -- pesquisador atualiza apenas nas etapas onde é ator
  (pesquisador_id = auth.uid() AND etapa IN ('submetida','em_campo','relatorio_parcial','relatorio_final'))
  OR EXISTS (SELECT 1 FROM usuarios u WHERE u.id = auth.uid()
               AND u.perfil IN ('tecnico','gestor','super_admin'))
);

-- Relatórios: mesma lógica
CREATE POLICY "rel_select" ON pesquisa_relatorios FOR SELECT USING (
  EXISTS (SELECT 1 FROM pesquisas p WHERE p.id = pesquisa_id
            AND (p.pesquisador_id = auth.uid()
                 OR EXISTS (SELECT 1 FROM usuarios u WHERE u.id = auth.uid()
                              AND u.perfil IN ('tecnico','gestor','super_admin','financeiro'))))
);

CREATE POLICY "rel_insert" ON pesquisa_relatorios FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM pesquisas p WHERE p.id = pesquisa_id
            AND (p.pesquisador_id = auth.uid()
                 OR EXISTS (SELECT 1 FROM usuarios u WHERE u.id = auth.uid()
                              AND u.perfil IN ('tecnico','gestor','super_admin'))))
);

CREATE POLICY "rel_update" ON pesquisa_relatorios FOR UPDATE USING (
  EXISTS (SELECT 1 FROM pesquisas p WHERE p.id = pesquisa_id
            AND (p.pesquisador_id = auth.uid()
                 OR EXISTS (SELECT 1 FROM usuarios u WHERE u.id = auth.uid()
                              AND u.perfil IN ('tecnico','gestor','super_admin'))))
);

-- Histórico: leitura para quem pode ver a pesquisa
CREATE POLICY "hist_select" ON pesquisa_historico FOR SELECT USING (
  EXISTS (SELECT 1 FROM pesquisas p WHERE p.id = pesquisa_id
            AND (p.pesquisador_id = auth.uid()
                 OR EXISTS (SELECT 1 FROM usuarios u WHERE u.id = auth.uid()
                              AND u.perfil IN ('tecnico','gestor','super_admin'))))
);

CREATE POLICY "hist_insert" ON pesquisa_historico FOR INSERT WITH CHECK (
  usuario_id = auth.uid()
);

-- ─── Função: avançar etapa ────────────────────────────────────

CREATE OR REPLACE FUNCTION avancar_etapa_pesquisa(
  p_pesquisa_id  uuid,
  p_nova_etapa   etapa_pesquisa,
  p_observacao   text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_etapa_anterior etapa_pesquisa;
  v_inadimplente   boolean;
BEGIN
  SELECT etapa, inadimplente INTO v_etapa_anterior, v_inadimplente
  FROM pesquisas WHERE id = p_pesquisa_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pesquisa não encontrada: %', p_pesquisa_id;
  END IF;

  -- Bloqueia avanço se pesquisador inadimplente (exceto para encerrar/arquivar)
  IF v_inadimplente AND p_nova_etapa NOT IN ('encerrada','arquivada') THEN
    RAISE EXCEPTION 'Pesquisador inadimplente. Regularize pendências antes de avançar.';
  END IF;

  UPDATE pesquisas SET etapa = p_nova_etapa WHERE id = p_pesquisa_id;

  INSERT INTO pesquisa_historico (pesquisa_id, etapa_anterior, etapa_nova, usuario_id, observacao)
  VALUES (p_pesquisa_id, v_etapa_anterior, p_nova_etapa, auth.uid(), p_observacao);
END;
$$;

-- ─── Função: marcar inadimplência ─────────────────────────────

CREATE OR REPLACE FUNCTION marcar_inadimplencia(
  p_pesquisa_id uuid,
  p_motivo      text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM usuarios WHERE id = auth.uid()
                   AND perfil IN ('gestor','super_admin','financeiro')) THEN
    RAISE EXCEPTION 'Sem permissão para marcar inadimplência.';
  END IF;

  UPDATE pesquisas
  SET inadimplente        = true,
      inadimplencia_motivo = p_motivo,
      inadimplencia_em    = now()
  WHERE id = p_pesquisa_id;

  INSERT INTO pesquisa_historico (pesquisa_id, etapa_anterior, etapa_nova, usuario_id, observacao)
  SELECT etapa, etapa, auth.uid(), '⚠ Pesquisador marcado como inadimplente. Motivo: ' || p_motivo
  FROM pesquisas WHERE id = p_pesquisa_id;
END;
$$;

-- ─── Trigger: pesquisa encerrada → notificação no painel ──────

CREATE OR REPLACE FUNCTION notificar_etapa_pesquisa()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_gestor   uuid;
  v_titulo   text;
  v_msg      text;
  v_tipo     tipo_notificacao;
BEGIN
  IF OLD.etapa = NEW.etapa THEN RETURN NEW; END IF;

  -- Busca gestor UC ou analista responsável para notificar
  v_gestor := COALESCE(NEW.gestor_uc_id, NEW.analista_id);
  IF v_gestor IS NULL THEN RETURN NEW; END IF;

  CASE NEW.etapa
    WHEN 'triagem' THEN
      v_titulo := 'Pesquisa aguarda triagem: ' || NEW.titulo;
      v_msg    := 'Nova pesquisa submetida aguarda sua triagem.';
      v_tipo   := 'sistema';
    WHEN 'analise_tecnica' THEN
      v_titulo := 'Análise técnica necessária: ' || NEW.titulo;
      v_msg    := 'Pesquisa aprovada na triagem aguarda análise técnica.';
      v_tipo   := 'sistema';
    WHEN 'aap_emissao' THEN
      v_titulo := 'Emitir AAP: ' || NEW.titulo;
      v_msg    := 'Pesquisa aprovada. Emita a Autorização de Acesso e Pesquisa (AAP).';
      v_tipo   := 'documento_pendente';
    WHEN 'relatorio_parcial' THEN
      v_titulo := 'Relatório parcial pendente: ' || NEW.titulo;
      v_msg    := 'Pesquisa em campo. Aguardando entrega do relatório parcial.';
      v_tipo   := 'sistema';
    WHEN 'relatorio_final' THEN
      v_titulo := 'Relatório final pendente: ' || NEW.titulo;
      v_msg    := 'Pesquisa concluída em campo. Aguardando entrega do relatório final.';
      v_tipo   := 'sistema';
    WHEN 'encerrada' THEN
      v_titulo := 'Pesquisa encerrada: ' || NEW.titulo;
      v_msg    := 'Pesquisa encerrada com sucesso. Proceda ao arquivamento.';
      v_tipo   := 'sistema';
    ELSE
      RETURN NEW;
  END CASE;

  INSERT INTO notificacoes (tipo, status, titulo, mensagem, destinatario_id, uc_id, sla_horas, sla_prazo, meta)
  VALUES (v_tipo, 'enviada', v_titulo, v_msg, v_gestor, NEW.uc_id, 48, now() + interval '48 hours',
          jsonb_build_object('pesquisa_id', NEW.id, 'etapa', NEW.etapa::text));

  RETURN NEW;
END;
$$;

CREATE TRIGGER trigger_notificar_etapa_pesquisa
  AFTER UPDATE OF etapa ON pesquisas
  FOR EACH ROW EXECUTE FUNCTION notificar_etapa_pesquisa();

-- ─── View pública para verificação de AAP por QR code ────────

CREATE OR REPLACE VIEW v_aap_publica AS
SELECT
  p.aap_numero,
  p.aap_qr_token,
  p.titulo,
  p.tipo,
  p.pesquisador_nome,
  p.pesquisador_instituicao,
  p.sisbio_numero,
  p.sisgen_numero,
  uc.nome  AS uc_nome,
  p.aap_emitida_em,
  p.aap_validade,
  p.aap_assinado_em,
  u_ass.nome_completo AS assinado_por,
  p.data_inicio_prevista,
  p.data_fim_prevista,
  p.etapa
FROM pesquisas p
LEFT JOIN unidades_conservacao uc ON uc.id = p.uc_id
LEFT JOIN usuarios u_ass ON u_ass.id = p.aap_assinado_por
WHERE p.aap_qr_token IS NOT NULL;
