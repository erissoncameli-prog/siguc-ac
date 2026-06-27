-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Biomonitor — Cadastro de berçários
-- ═══════════════════════════════════════════════════════════

CREATE TYPE tipo_bercario AS ENUM (
  'tanque_fibra',
  'piscina_alvenaria',
  'viveiro',
  'outro'
);

CREATE TABLE bercarios (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  nome                  text        NOT NULL,
  tipo                  tipo_bercario NOT NULL DEFAULT 'tanque_fibra',
  capacidade_max        smallint,
  localizacao_descricao text,
  uc_id                 uuid        REFERENCES unidades_conservacao(id) ON DELETE SET NULL,
  responsavel_id        uuid        REFERENCES monitores_biodiversidade(id) ON DELETE SET NULL,
  status                boolean     NOT NULL DEFAULT true,
  observacoes           text,
  criado_em             timestamptz NOT NULL DEFAULT now(),
  atualizado_em         timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE bercarios ENABLE ROW LEVEL SECURITY;

-- Todos autenticados podem consultar (necessário para o app de campo)
CREATE POLICY "bercarios_select" ON bercarios
  FOR SELECT USING (auth.uid() IS NOT NULL);

-- Apenas gestores/admin/tecnico criam
CREATE POLICY "bercarios_insert" ON bercarios
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM usuarios u
      WHERE u.id = auth.uid()
        AND u.perfil IN ('gestor', 'super_admin', 'tecnico')
    )
  );

-- Apenas gestores/admin/tecnico editam
CREATE POLICY "bercarios_update" ON bercarios
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM usuarios u
      WHERE u.id = auth.uid()
        AND u.perfil IN ('gestor', 'super_admin', 'tecnico')
    )
  );

CREATE INDEX ON bercarios (status);
CREATE INDEX ON bercarios (uc_id);

-- Vincula lotes ao berçário cadastrado (campo novo na tabela existente)
ALTER TABLE lotes_bercario
  ADD COLUMN IF NOT EXISTS bercario_id uuid REFERENCES bercarios(id) ON DELETE SET NULL;

CREATE INDEX ON lotes_bercario (bercario_id);
