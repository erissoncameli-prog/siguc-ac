-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Educação Ambiental — Participantes + Lista de Presença
-- App de campo das brigadas: ao registrar atividade de educação
-- ambiental, o brigadista pode anexar a lista de presença (foto/PDF)
-- e cadastrar os participantes alcançados (nome, CPF, nascimento, sexo).
-- ═══════════════════════════════════════════════════════════

-- ── 1. Enum de sexo do participante ──────────────────────────
DO $$ BEGIN
  CREATE TYPE sexo_participante AS ENUM (
    'masculino', 'feminino', 'outro', 'nao_informado'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── 2. Anexo da lista de presença (Storage 'registros-campo') ─
-- Documento (foto ou PDF) digitalizado da lista assinada em campo.
ALTER TABLE registros_campo
  ADD COLUMN IF NOT EXISTS lista_presenca_url text;

-- ── 3. Participantes (1 registro_campo → N participantes) ────
CREATE TABLE IF NOT EXISTS registro_participantes (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  registro_campo_id uuid NOT NULL REFERENCES registros_campo(id) ON DELETE CASCADE,

  nome              text NOT NULL,
  cpf               text,               -- opcional; armazenado só com dígitos
  data_nascimento   date,
  sexo              sexo_participante,

  criado_em         timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rp_registro ON registro_participantes (registro_campo_id);

ALTER TABLE registro_participantes ENABLE ROW LEVEL SECURITY;

-- Leitura: mesma lógica do registro pai (brigadista dono, chefe da
-- brigada e internos técnico/gestor/admin/biólogo).
CREATE POLICY "rp_select" ON registro_participantes
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM registros_campo rc
      JOIN brigadistas b ON b.id = rc.brigadista_id
      WHERE rc.id = registro_participantes.registro_campo_id
        AND b.usuario_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM registros_campo rc
      JOIN brigadistas chefe ON chefe.brigada_id = rc.brigada_id
      WHERE rc.id = registro_participantes.registro_campo_id
        AND chefe.usuario_id = auth.uid()
        AND chefe.funcao = 'chefe_brigada'
        AND chefe.status = 'ativo'
    )
    OR EXISTS (
      SELECT 1 FROM usuarios u
      WHERE u.id = auth.uid()
        AND u.perfil IN ('tecnico','gestor','super_admin','biologo')
        AND u.ativo
    )
  );

-- Escrita: brigadista dono insere; gestor/admin podem ajustar.
CREATE POLICY "rp_insert" ON registro_participantes
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM registros_campo rc
      JOIN brigadistas b ON b.id = rc.brigadista_id
      WHERE rc.id = registro_participantes.registro_campo_id
        AND b.usuario_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM usuarios u
      WHERE u.id = auth.uid()
        AND u.perfil IN ('gestor','super_admin')
        AND u.ativo
    )
  );

CREATE POLICY "rp_update" ON registro_participantes
  FOR UPDATE TO authenticated USING (
    EXISTS (
      SELECT 1 FROM usuarios u
      WHERE u.id = auth.uid()
        AND u.perfil IN ('gestor','super_admin')
        AND u.ativo
    )
  );

-- Exclusão: brigadista dono (re-sync apaga e reinsere) e gestor/admin.
CREATE POLICY "rp_delete" ON registro_participantes
  FOR DELETE TO authenticated USING (
    EXISTS (
      SELECT 1 FROM registros_campo rc
      JOIN brigadistas b ON b.id = rc.brigadista_id
      WHERE rc.id = registro_participantes.registro_campo_id
        AND b.usuario_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM usuarios u
      WHERE u.id = auth.uid()
        AND u.perfil IN ('gestor','super_admin')
        AND u.ativo
    )
  );

-- ── 4. Atualizar vw_registros_validacao ──────────────────────
-- Expõe lista_presenca_url e a contagem de participantes para o
-- painel de validação/relatórios dos gestores.
DROP VIEW IF EXISTS vw_registros_validacao;
CREATE OR REPLACE VIEW vw_registros_validacao AS
SELECT
  rc.id, rc.uuid_cliente, rc.codigo_ocorrencia,
  rc.natureza, rc.atividade,
  rc.equipe, rc.equipe_id, eq.nome AS equipe_nome, rc.duracao_horas,
  rc.hora_inicio, rc.hora_fim,
  rc.origem_acionamento,
  rc.status_validacao, rc.motivo_rejeicao, rc.historico, rc.fotos_urls,
  rc.data_hora_evento, rc.criado_em, rc.sincronizado_em, rc.validado_em,
  rc.descricao, rc.area_estimada_ha, rc.pessoas_alcancadas, rc.precisao_gps_m,
  rc.area_metodo, rc.area_medida_ha, rc.area_validada_ha,
  rc.alerta_cigma, rc.integrada_cbmac, rc.alerta_id, rc.ocorrencia_id,
  rc.lista_presenca_url,
  rc.uc_id, rc.brigada_id, rc.brigadista_id,
  COALESCE(rc.regional, br.regional, uc.regional) AS regional,
  rc.municipio,
  CASE WHEN rc.localizacao IS NOT NULL THEN ST_Y(rc.localizacao) END AS lat,
  CASE WHEN rc.localizacao IS NOT NULL THEN ST_X(rc.localizacao) END AS lng,
  b.nome_completo  AS brigadista_nome,
  br.nome          AS brigada_nome,
  uc.nome          AS uc_nome,
  uv.nome_completo AS validado_por_nome,
  COALESCE(f.n_fauna,          0) AS n_fauna,
  COALESCE(f.n_fauna_pendente, 0) AS n_fauna_pendente,
  COALESCE(f.n_fauna_resgatada,0) AS n_fauna_resgatada,
  -- Incêndio evitado
  COALESCE(aie.n_areas_evitadas,  0) AS n_areas_evitadas,
  COALESCE(aie.ha_evitados_total, 0) AS ha_evitados_total,
  -- Educação ambiental
  COALESCE(p.n_participantes, 0) AS n_participantes
FROM registros_campo rc
LEFT JOIN brigadistas          b  ON b.id  = rc.brigadista_id
LEFT JOIN brigadas             br ON br.id = rc.brigada_id
LEFT JOIN equipes_brigada      eq ON eq.id = rc.equipe_id
LEFT JOIN unidades_conservacao uc ON uc.id = rc.uc_id
LEFT JOIN usuarios             uv ON uv.id = rc.validado_por
LEFT JOIN (
  SELECT registro_campo_id,
    COUNT(*)                                                          AS n_fauna,
    COUNT(*) FILTER (WHERE NOT identificacao_confirmada)              AS n_fauna_pendente,
    COALESCE(SUM(quantidade) FILTER (WHERE tipo_evento = 'resgate'), 0) AS n_fauna_resgatada
  FROM registro_fauna
  GROUP BY registro_campo_id
) f ON f.registro_campo_id = rc.id
LEFT JOIN (
  SELECT registro_id,
    COUNT(*)     AS n_areas_evitadas,
    SUM(area_ha) AS ha_evitados_total
  FROM areas_incendio_evitado
  GROUP BY registro_id
) aie ON aie.registro_id = rc.id
LEFT JOIN (
  SELECT registro_campo_id, COUNT(*) AS n_participantes
  FROM registro_participantes
  GROUP BY registro_campo_id
) p ON p.registro_campo_id = rc.id;
