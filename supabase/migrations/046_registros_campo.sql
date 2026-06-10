-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Registros de Campo — parte 2: tabelas
-- especies_fauna (catálogo offline), registros_campo (PWA),
-- registro_fauna (sub-registros, alinhado Darwin Core).
-- Depende de 045_registros_campo_enums.
-- Buckets Storage necessários (criar via dashboard):
--   'brigadistas'  (fotos de cadastro)
--   'registros-campo'  (fotos de campo)
-- ═══════════════════════════════════════════════════════════

-- ── 1. Catálogo de espécies (cache offline no PWA) ───────────
CREATE TABLE especies_fauna (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome_cientifico     text NOT NULL UNIQUE,
  nomes_populares     text[],
  classe              classe_fauna NOT NULL,
  ordem               text,
  familia             text,
  -- Conservação: MMA Port. 148/2022 / IUCN
  status_conservacao  text,
  ameacada            boolean NOT NULL DEFAULT false,
  porte               porte_fauna,
  -- Foto de referência; miniatura das ameaçadas baixada offline pelo PWA
  foto_referencia_url text,
  versao_catalogo     text,
  ativo               boolean NOT NULL DEFAULT true,
  criado_em           timestamptz DEFAULT now(),
  atualizado_em       timestamptz DEFAULT now()
);

CREATE INDEX idx_esp_classe    ON especies_fauna (classe);
CREATE INDEX idx_esp_ameacada  ON especies_fauna (ameacada) WHERE ameacada = true;
CREATE INDEX idx_esp_nomes_pop ON especies_fauna USING GIN (nomes_populares);

ALTER TABLE especies_fauna ENABLE ROW LEVEL SECURITY;

-- Todos autenticados e anon leem (catálogo é público para o PWA offline)
CREATE POLICY "especies_select" ON especies_fauna
  FOR SELECT USING (true);

-- Apenas biologo, gestor, super_admin escrevem
CREATE POLICY "especies_write" ON especies_fauna
  FOR ALL TO authenticated USING (
    EXISTS (
      SELECT 1 FROM usuarios u
      WHERE u.id = auth.uid()
        AND u.perfil IN ('biologo','gestor','super_admin')
        AND u.ativo
    )
  );

CREATE TRIGGER trg_especies_updated
  BEFORE UPDATE ON especies_fauna
  FOR EACH ROW EXECUTE FUNCTION touch_atualizado_em();

-- ── 2. Registros de Campo ────────────────────────────────────
CREATE TABLE registros_campo (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Idempotência: o app gera este UUID antes de ter sinal
  uuid_cliente      uuid UNIQUE NOT NULL,

  -- Origem
  brigadista_id     uuid REFERENCES brigadistas(id) ON DELETE SET NULL,
  brigada_id        uuid REFERENCES brigadas(id) ON DELETE SET NULL,
  uc_id             uuid REFERENCES unidades_conservacao(id),
  regional          regional_ac,
  municipio         text,

  -- Classificação (NATUREZA → ATIVIDADE, igual à planilha)
  natureza          natureza_registro NOT NULL,
  atividade         atividade_campo NOT NULL,
  equipe            text,               -- Alfa, Bravo, Charlie (ou texto padronizado)

  -- Período
  data_inicio       date NOT NULL,
  data_fim          date,               -- atividade multi-dia

  -- GPS (captura automática pelo app)
  localizacao       geometry(Point, 4326),
  precisao_gps_m    numeric(8,1),
  altitude_m        numeric(8,1),
  data_hora_evento  timestamptz NOT NULL,

  -- Fotos (Storage 'registros-campo'; carimbadas: coord + data/hora + UC + brigada)
  fotos_urls        text[],

  -- Métricas
  pessoas_alcancadas int,
  area_estimada_ha  numeric(10,2),      -- apenas incêndio/aceiro
  animais_resgatados int,               -- contagem rápida (detalhe em registro_fauna)
  veiculo           text CHECK (veiculo IN ('caminhonete', 'moto', 'outro')),

  -- Descrição livre
  descricao         text,

  -- Integração CIGMA / CBMAC
  alerta_cigma      boolean NOT NULL DEFAULT false,
  integrada_cbmac   boolean NOT NULL DEFAULT false,
  alerta_id         uuid REFERENCES alertas_ambientais(id) ON DELETE SET NULL,
  veredito_campo    veredito_campo,

  -- Validação pelo gestor/técnico
  status_validacao  status_validacao NOT NULL DEFAULT 'aguardando',
  validado_por      uuid REFERENCES usuarios(id) ON DELETE SET NULL,
  validado_em       timestamptz,
  motivo_rejeicao   text,
  historico         jsonb NOT NULL DEFAULT '[]',   -- [{data, usuario, acao, obs}]

  -- Promoção a ocorrência (manual, 1 clique no gestor)
  ocorrencia_id     uuid REFERENCES ocorrencias(id) ON DELETE SET NULL,

  -- Sync
  origem            text NOT NULL DEFAULT 'app_brigada',
  sincronizado_em   timestamptz,

  criado_em         timestamptz DEFAULT now(),
  atualizado_em     timestamptz DEFAULT now()
);

-- Índices
CREATE INDEX idx_rc_brigadista   ON registros_campo (brigadista_id);
CREATE INDEX idx_rc_brigada      ON registros_campo (brigada_id);
CREATE INDEX idx_rc_uc           ON registros_campo (uc_id);
CREATE INDEX idx_rc_data         ON registros_campo (data_hora_evento DESC);
CREATE INDEX idx_rc_natureza     ON registros_campo (natureza);
CREATE INDEX idx_rc_validacao    ON registros_campo (status_validacao);
CREATE INDEX idx_rc_alerta       ON registros_campo (alerta_id) WHERE alerta_id IS NOT NULL;
CREATE INDEX idx_rc_ocorrencia   ON registros_campo (ocorrencia_id) WHERE ocorrencia_id IS NOT NULL;
CREATE INDEX idx_rc_geom         ON registros_campo USING GIST (localizacao)
  WHERE localizacao IS NOT NULL;
CREATE INDEX idx_rc_uuid_cliente ON registros_campo (uuid_cliente);

ALTER TABLE registros_campo ENABLE ROW LEVEL SECURITY;

-- Brigadista insere apenas os próprios registros
CREATE POLICY "rc_brigadista_insert" ON registros_campo
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM brigadistas b
      WHERE b.id = registros_campo.brigadista_id
        AND b.usuario_id = auth.uid()
        AND b.status = 'ativo'
    )
  );

-- Leitura: próprio brigadista, chefe da brigada e internos
CREATE POLICY "rc_select" ON registros_campo
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM brigadistas b
      WHERE b.id = registros_campo.brigadista_id
        AND b.usuario_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM brigadistas chefe
      WHERE chefe.usuario_id = auth.uid()
        AND chefe.funcao = 'chefe_brigada'
        AND chefe.brigada_id = registros_campo.brigada_id
        AND chefe.status = 'ativo'
    )
    OR EXISTS (
      SELECT 1 FROM usuarios u
      WHERE u.id = auth.uid()
        AND u.perfil IN ('tecnico','gestor','super_admin','biologo')
        AND u.ativo
    )
  );

-- Atualização: gestor/técnico validam; chefe corrige e reencaminha
CREATE POLICY "rc_gestor_update" ON registros_campo
  FOR UPDATE TO authenticated USING (
    EXISTS (
      SELECT 1 FROM usuarios u
      WHERE u.id = auth.uid()
        AND u.perfil IN ('tecnico','gestor','super_admin')
        AND u.ativo
    )
    OR EXISTS (
      SELECT 1 FROM brigadistas chefe
      WHERE chefe.usuario_id = auth.uid()
        AND chefe.funcao = 'chefe_brigada'
        AND chefe.brigada_id = registros_campo.brigada_id
        AND chefe.status = 'ativo'
    )
  );

CREATE TRIGGER trg_rc_updated
  BEFORE UPDATE ON registros_campo
  FOR EACH ROW EXECUTE FUNCTION touch_atualizado_em();

-- ── 3. Registro de Fauna (1 registro_campo → N animais) ─────
CREATE TABLE registro_fauna (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  registro_campo_id        uuid NOT NULL REFERENCES registros_campo(id) ON DELETE CASCADE,

  -- Identificação taxonômica
  classe                   classe_fauna NOT NULL,
  especie_id               uuid REFERENCES especies_fauna(id) ON DELETE SET NULL,
  nome_popular             text,
  nome_cientifico          text,

  -- Evento
  quantidade               int NOT NULL DEFAULT 1,
  condicao                 condicao_fauna NOT NULL,
  tipo_evento              tipo_evento_fauna NOT NULL,
  causa_aparente           causa_fauna,
  destinacao               destinacao_fauna,

  -- Caracterização
  sexo                     text CHECK (sexo IN ('macho', 'femea', 'indeterminado')),
  faixa_etaria             faixa_etaria_fauna,
  ameacada                 boolean NOT NULL DEFAULT false,

  -- Mídia e anotações
  fotos_urls               text[],
  observacoes              text,

  -- Confirmação pelo biólogo
  identificado_por         uuid REFERENCES usuarios(id) ON DELETE SET NULL,
  identificacao_confirmada boolean NOT NULL DEFAULT false,

  criado_em                timestamptz DEFAULT now()
);

CREATE INDEX idx_rf_registro    ON registro_fauna (registro_campo_id);
CREATE INDEX idx_rf_especie     ON registro_fauna (especie_id) WHERE especie_id IS NOT NULL;
CREATE INDEX idx_rf_classe      ON registro_fauna (classe);
CREATE INDEX idx_rf_ameacada    ON registro_fauna (ameacada) WHERE ameacada = true;
CREATE INDEX idx_rf_condicao    ON registro_fauna (condicao);

ALTER TABLE registro_fauna ENABLE ROW LEVEL SECURITY;

-- Leitura: mesma lógica do registro pai
CREATE POLICY "rf_select" ON registro_fauna
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM registros_campo rc
      JOIN brigadistas b ON b.id = rc.brigadista_id
      WHERE rc.id = registro_fauna.registro_campo_id
        AND b.usuario_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM registros_campo rc
      JOIN brigadistas chefe ON chefe.brigada_id = rc.brigada_id
      WHERE rc.id = registro_fauna.registro_campo_id
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

-- Escrita: brigadista insere, biólogo/gestor/admin editam
CREATE POLICY "rf_insert" ON registro_fauna
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM registros_campo rc
      JOIN brigadistas b ON b.id = rc.brigadista_id
      WHERE rc.id = registro_fauna.registro_campo_id
        AND b.usuario_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM usuarios u
      WHERE u.id = auth.uid()
        AND u.perfil IN ('biologo','gestor','super_admin')
        AND u.ativo
    )
  );

CREATE POLICY "rf_update" ON registro_fauna
  FOR UPDATE TO authenticated USING (
    EXISTS (
      SELECT 1 FROM usuarios u
      WHERE u.id = auth.uid()
        AND u.perfil IN ('biologo','gestor','super_admin')
        AND u.ativo
    )
  );
