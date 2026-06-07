-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · DOF — Documento de Origem Florestal (IBAMA)
-- Dados abertos: dadosabertos.ibama.gov.br
-- Cruzamento PostGIS com UCs para detectar extração irregular
-- ═══════════════════════════════════════════════════════════

-- ── Transportes DOF ─────────────────────────────────────────
-- Fonte: DOF - Transportes de Produtos Florestais (IBAMA)
-- Dados por ano/estado, disponíveis desde 2007

CREATE TABLE IF NOT EXISTS dof_transportes (
  id               bigserial PRIMARY KEY,
  num_dof          text UNIQUE,             -- número do documento
  estado_origem    char(2),                 -- UF de origem
  municipio_origem text,
  estado_destino   char(2),
  municipio_destino text,
  cpf_cnpj_emitente text,
  nome_emitente    text,
  produto          text,                    -- espécie/produto transportado
  volume_m3        numeric(12,3),           -- volume em m³
  data_emissao     date,
  data_validade    date,
  num_asv          text,                    -- ASV vinculada (se houver)
  num_pmfs         text,                    -- PMFS vinculado (se houver)
  -- Geolocalização (quando disponível via cruzamento com CAR/ASV)
  lat_origem       double precision,
  lon_origem       double precision,
  geom_origem      geometry(Point, 4326)
                   GENERATED ALWAYS AS (
                     CASE WHEN lon_origem IS NOT NULL AND lat_origem IS NOT NULL
                       THEN ST_SetSRID(ST_MakePoint(lon_origem, lat_origem), 4326)
                     END
                   ) STORED,
  -- Controle de importação
  ano_referencia   smallint NOT NULL,       -- ano do dataset importado
  importado_em     timestamptz DEFAULT now(),
  raw_data         jsonb                    -- linha original para auditoria
);

CREATE INDEX IF NOT EXISTS idx_dof_uf      ON dof_transportes (estado_origem);
CREATE INDEX IF NOT EXISTS idx_dof_data    ON dof_transportes (data_emissao DESC);
CREATE INDEX IF NOT EXISTS idx_dof_asv     ON dof_transportes (num_asv) WHERE num_asv IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_dof_emitente ON dof_transportes (cpf_cnpj_emitente);
CREATE INDEX IF NOT EXISTS idx_dof_geom    ON dof_transportes USING GIST (geom_origem)
  WHERE geom_origem IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_dof_ano     ON dof_transportes (ano_referencia);

ALTER TABLE dof_transportes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "dof_select" ON dof_transportes
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM usuarios WHERE id = auth.uid()
        AND perfil IN ('tecnico','gestor','super_admin') AND ativo
    )
  );

CREATE POLICY "dof_write" ON dof_transportes
  FOR ALL TO authenticated USING (
    EXISTS (
      SELECT 1 FROM usuarios WHERE id = auth.uid()
        AND perfil IN ('gestor','super_admin') AND ativo
    )
  );

-- ── Controle de importações DOF ─────────────────────────────

CREATE TABLE IF NOT EXISTS dof_importacoes (
  id           serial PRIMARY KEY,
  ano          smallint NOT NULL,
  uf           char(2) NOT NULL DEFAULT 'AC',
  registros    integer DEFAULT 0,
  status       text DEFAULT 'ok' CHECK (status IN ('ok','erro','parcial')),
  importado_em timestamptz DEFAULT now(),
  mensagem     text
);

-- ── RPCs ────────────────────────────────────────────────────

-- DOF com origem dentro de uma UC (cruzamento geoespacial)
CREATE OR REPLACE FUNCTION dof_dentro_uc(p_uc_id uuid, p_ano smallint DEFAULT NULL)
RETURNS TABLE (
  num_dof text, produto text, volume_m3 numeric,
  nome_emitente text, data_emissao date, municipio_origem text
)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT d.num_dof, d.produto, d.volume_m3,
         d.nome_emitente, d.data_emissao, d.municipio_origem
  FROM dof_transportes d
  JOIN unidades_conservacao u ON u.id = p_uc_id
  WHERE d.geom_origem IS NOT NULL
    AND ST_Within(d.geom_origem, u.geom)
    AND (p_ano IS NULL OR d.ano_referencia = p_ano)
  ORDER BY d.data_emissao DESC
  LIMIT 500;
$$;

-- Volume total de DOF por produto/ano para um estado
CREATE OR REPLACE FUNCTION dof_volume_por_produto(p_uf char DEFAULT 'AC', p_ano smallint DEFAULT NULL)
RETURNS TABLE (produto text, ano_referencia smallint, total_registros bigint, volume_total_m3 numeric)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT produto, ano_referencia,
         COUNT(*) AS total_registros,
         COALESCE(SUM(volume_m3), 0) AS volume_total_m3
  FROM dof_transportes
  WHERE estado_origem = p_uf
    AND (p_ano IS NULL OR ano_referencia = p_ano)
  GROUP BY produto, ano_referencia
  ORDER BY volume_total_m3 DESC;
$$;

-- DOF sem ASV correspondente (potencial irregularidade)
CREATE OR REPLACE FUNCTION dof_sem_asv(p_uf char DEFAULT 'AC', p_ano smallint DEFAULT NULL)
RETURNS TABLE (
  num_dof text, produto text, volume_m3 numeric,
  nome_emitente text, data_emissao date, municipio_origem text
)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT d.num_dof, d.produto, d.volume_m3,
         d.nome_emitente, d.data_emissao, d.municipio_origem
  FROM dof_transportes d
  WHERE d.estado_origem = p_uf
    AND (p_ano IS NULL OR d.ano_referencia = p_ano)
    AND d.num_asv IS NULL
  ORDER BY d.data_emissao DESC
  LIMIT 1000;
$$;
