-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Brigadas v2 — parte 2: campos, FK, RLS e view
-- Depende de 043_brigadas_v2 (enums brigadista/biologo/regional_ac
-- precisam estar committed antes de serem referenciados).
-- ═══════════════════════════════════════════════════════════

-- ── 1. Coluna regional em brigadas ───────────────────────────
ALTER TABLE brigadas ADD COLUMN IF NOT EXISTS regional regional_ac;

-- ── 2. Novos campos em brigadistas ───────────────────────────

-- Vínculo ao login do app (NULL = não usa app)
ALTER TABLE brigadistas
  ADD COLUMN IF NOT EXISTS usuario_id uuid REFERENCES usuarios(id) ON DELETE SET NULL;

-- Foto de cadastro (bucket Storage 'brigadistas')
ALTER TABLE brigadistas ADD COLUMN IF NOT EXISTS foto_url text;

-- Sexo com valores legíveis (substitui varchar(1) sem semântica)
ALTER TABLE brigadistas DROP COLUMN IF EXISTS sexo;
ALTER TABLE brigadistas
  ADD COLUMN sexo text CHECK (sexo IN ('masculino', 'feminino', 'outro'));

-- Endereço (contexto rural / comunidade)
ALTER TABLE brigadistas ADD COLUMN IF NOT EXISTS comunidade        text;
ALTER TABLE brigadistas ADD COLUMN IF NOT EXISTS logradouro        text;
ALTER TABLE brigadistas ADD COLUMN IF NOT EXISTS numero            text;
ALTER TABLE brigadistas ADD COLUMN IF NOT EXISTS bairro            text;
ALTER TABLE brigadistas ADD COLUMN IF NOT EXISTS uf                varchar(2) DEFAULT 'AC';
ALTER TABLE brigadistas ADD COLUMN IF NOT EXISTS cep               varchar(10);
ALTER TABLE brigadistas ADD COLUMN IF NOT EXISTS ponto_referencia  text;

-- Segurança operacional (brigada de incêndio)
ALTER TABLE brigadistas ADD COLUMN IF NOT EXISTS tipo_sanguineo               varchar(5);
ALTER TABLE brigadistas ADD COLUMN IF NOT EXISTS alergias                     text;
ALTER TABLE brigadistas ADD COLUMN IF NOT EXISTS contato_emergencia_nome      text;
ALTER TABLE brigadistas ADD COLUMN IF NOT EXISTS contato_emergencia_telefone  varchar(20);

-- Gestão do vínculo
ALTER TABLE brigadistas ADD COLUMN IF NOT EXISTS tipo_vinculo      text
  CHECK (tipo_vinculo IN ('voluntario', 'contratado', 'convenio'));
ALTER TABLE brigadistas ADD COLUMN IF NOT EXISTS data_admissao     date;
ALTER TABLE brigadistas ADD COLUMN IF NOT EXISTS data_desligamento date;

-- ── 3. FK chefe_id em brigadas ───────────────────────────────
-- Circular (brigada → brigadista → brigada); nullable para inserção gradual
ALTER TABLE brigadas
  ADD COLUMN IF NOT EXISTS chefe_id uuid REFERENCES brigadistas(id) ON DELETE SET NULL;

-- ── 4. Índices ────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_brigadistas_usuario ON brigadistas (usuario_id)
  WHERE usuario_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_brigadas_chefe      ON brigadas (chefe_id)
  WHERE chefe_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_brigadas_regional   ON brigadas (regional)
  WHERE regional IS NOT NULL;

-- ── 5. RLS refinada para brigadistas ────────────────────────
-- brigadista: vê só o próprio; chefe: vê toda a brigada;
-- tecnico/gestor/super_admin/biologo: acesso amplo.
DROP POLICY IF EXISTS "brigadistas_select" ON brigadistas;

CREATE POLICY "brigadistas_select" ON brigadistas
  FOR SELECT TO authenticated USING (
    usuario_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM brigadistas chefe
      WHERE chefe.usuario_id = auth.uid()
        AND chefe.funcao = 'chefe_brigada'
        AND chefe.brigada_id = brigadistas.brigada_id
        AND chefe.status = 'ativo'
    )
    OR EXISTS (
      SELECT 1 FROM usuarios u
      WHERE u.id = auth.uid()
        AND u.perfil IN ('tecnico','gestor','super_admin','biologo')
        AND u.ativo
    )
  );

-- ── 6. View brigadas_resumo — adiciona uc_id, regional, chefe_id ──
DROP VIEW IF EXISTS brigadas_resumo;

CREATE OR REPLACE VIEW brigadas_resumo AS
SELECT
  b.id,
  b.uc_id,
  b.nome,
  b.tipo,
  b.fonte_recurso,
  b.regional,
  b.temporada_inicio,
  b.temporada_fim,
  b.vagas_previstas,
  b.coordenador_nome,
  b.chefe_id,
  b.ativa,
  uc.nome                                                         AS uc_nome,
  uc.sigla                                                        AS uc_sigla,
  uc.municipios                                                   AS uc_municipios,
  COUNT(br.id) FILTER (WHERE br.status = 'ativo')                 AS brigadistas_ativos,
  COUNT(br.id)                                                    AS brigadistas_total,
  MAX(ab.data_inicio)                                             AS ultima_atividade,
  b.criado_em,
  b.atualizado_em
FROM brigadas b
JOIN unidades_conservacao uc ON uc.id = b.uc_id
LEFT JOIN brigadistas br ON br.brigada_id = b.id
LEFT JOIN atividades_brigada ab ON ab.brigada_id = b.id
GROUP BY b.id, uc.id;
