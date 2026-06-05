-- ── 015_car_tables.sql ───────────────────────────────────────────────────
-- Tabelas de suporte ao módulo CAR (Cadastro Ambiental Rural)
-- car_dados_locais : dados enriquecidos do SICAR (importados de planilha)
-- car_marcados     : imóveis marcados/estilizados pelos analistas

-- ── car_dados_locais ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS car_dados_locais (
  cod_imovel   TEXT PRIMARY KEY,
  nom_imovel   TEXT,
  nome_compl   TEXT,          -- proprietário / possuidor
  cpf_cnpj     TEXT,
  num_area_i   NUMERIC,       -- área em ha (SICAR)
  num_modulo   NUMERIC,       -- módulos fiscais
  nom_munici   TEXT,
  ind_status   TEXT,
  condicao_i   TEXT,          -- situação do imóvel
  nome_class   TEXT,          -- classificação ambiental (Verde/Amarelo/Vermelho)
  tipo_docum   TEXT,          -- relação jurídica
  nome_docum   TEXT,
  dat_criaca   DATE,
  criado_em    TIMESTAMPTZ DEFAULT now(),
  atualizado_em TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE car_dados_locais ENABLE ROW LEVEL SECURITY;

-- Leitura: qualquer usuário autenticado
CREATE POLICY "car_dados_locais_select" ON car_dados_locais
  FOR SELECT TO authenticated USING (true);

-- Escrita: apenas gestor e super_admin
CREATE POLICY "car_dados_locais_write" ON car_dados_locais
  FOR ALL TO authenticated
  USING (
    (SELECT perfil FROM usuarios WHERE id = auth.uid()) IN ('super_admin','gestor')
  );

-- ── car_marcados ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS car_marcados (
  cod_imovel    TEXT PRIMARY KEY,
  area          NUMERIC,
  municipio     TEXT,
  condicao      TEXT,
  -- estilo personalizado
  fill_color    TEXT,
  fill_opacity  NUMERIC DEFAULT 0.18,
  stroke_color  TEXT,
  stroke_width  NUMERIC DEFAULT 1.5,
  -- auditoria
  criado_por    UUID REFERENCES usuarios(id),
  atualizado_em TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE car_marcados ENABLE ROW LEVEL SECURITY;

-- Leitura: qualquer autenticado
CREATE POLICY "car_marcados_select" ON car_marcados
  FOR SELECT TO authenticated USING (true);

-- Escrita: qualquer autenticado (analistas marcam seus próprios imóveis)
CREATE POLICY "car_marcados_insert" ON car_marcados
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "car_marcados_update" ON car_marcados
  FOR UPDATE TO authenticated USING (true);

CREATE POLICY "car_marcados_delete" ON car_marcados
  FOR DELETE TO authenticated USING (true);

-- Trigger atualizado_em
CREATE OR REPLACE FUNCTION touch_car_atualizado()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.atualizado_em = now(); RETURN NEW; END;
$$;

CREATE TRIGGER trg_car_dados_locais_touch
  BEFORE UPDATE ON car_dados_locais
  FOR EACH ROW EXECUTE FUNCTION touch_car_atualizado();

CREATE TRIGGER trg_car_marcados_touch
  BEFORE UPDATE ON car_marcados
  FOR EACH ROW EXECUTE FUNCTION touch_car_atualizado();
