-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Biomonitor — Visitas de acompanhamento de ninho
-- ───────────────────────────────────────────────────────────
-- Registros periódicos durante a incubação: temperatura,
-- umidade, status do ninho, predação de ovos (distinta da
-- predação de filhotes registrada na eclosão) e intervenções.
-- ═══════════════════════════════════════════════════════════

-- ── 1. Enums ──────────────────────────────────────────────────

CREATE TYPE status_ninho_visita AS ENUM (
  'integro',
  'perturbado',
  'parcial_predado',
  'destruido',
  'alagado'
);

CREATE TYPE predacao_incubacao AS ENUM (
  'nenhuma',
  'por_animais',
  'por_pessoas',
  'desconhecida'
);

CREATE TYPE umidade_substrato AS ENUM (
  'seco',
  'umido',
  'encharcado'
);

-- ── 2. Tabela de visitas ──────────────────────────────────────

CREATE TABLE visitas_ninho (
  id                       uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  uuid_cliente             uuid        UNIQUE NOT NULL,
  ninho_id                 uuid        REFERENCES ninhos_quelonios(id) ON DELETE SET NULL,
  data_visita              date        NOT NULL,
  hora_visita              time,
  status_ninho             status_ninho_visita NOT NULL DEFAULT 'integro',
  temperatura_substrato_c  numeric(4,1),
  temperatura_ar_c         numeric(4,1),
  umidade                  umidade_substrato,
  predacao_incubacao       predacao_incubacao  NOT NULL DEFAULT 'nenhuma',
  ovos_predados_n          smallint    CHECK (ovos_predados_n IS NULL OR ovos_predados_n >= 0),
  sinal_alagamento         boolean     NOT NULL DEFAULT false,
  intervencao              text,
  observacoes              text,
  monitor_id               uuid        REFERENCES monitores_biodiversidade(id) ON DELETE SET NULL,
  criado_em                timestamptz NOT NULL DEFAULT now(),
  sincronizado_em          timestamptz
);

-- ── 3. RLS ────────────────────────────────────────────────────

ALTER TABLE visitas_ninho ENABLE ROW LEVEL SECURITY;

CREATE POLICY "visitas_ninho_insert" ON visitas_ninho
  FOR INSERT WITH CHECK (
    monitor_id IN (
      SELECT mb.id FROM monitores_biodiversidade mb
      WHERE mb.usuario_id = auth.uid()
    )
  );

CREATE POLICY "visitas_ninho_select" ON visitas_ninho
  FOR SELECT USING (
    monitor_id IN (
      SELECT mb.id FROM monitores_biodiversidade mb
      WHERE mb.usuario_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM usuarios u
      WHERE u.id = auth.uid()
        AND u.perfil IN ('gestor', 'super_admin', 'tecnico')
    )
  );

-- ── 4. Índices ────────────────────────────────────────────────

CREATE INDEX ON visitas_ninho (ninho_id, data_visita DESC);
CREATE INDEX ON visitas_ninho (monitor_id);
