-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Lotação de usuários em unidades organizacionais
-- Frente 1 de docs/acesso-por-organograma.md
--
-- POR QUE ESTA TABELA EXISTE
-- O organograma (unidades_organizacionais, cargos, cargo_ocupacoes) já
-- está em produção, mas NÃO responde "de que setor é esta pessoa":
-- cargo_ocupacoes modela CHEFIA (25 cargos para 25 unidades, 1 por
-- unidade, 10 ocupantes) e `usuarios` não tem coluna de unidade. Sem
-- lotação, não há como o organograma governar acesso a módulo.
--
-- ESTA MIGRATION NÃO MUDA O ACESSO DE NINGUÉM. Cria o cadastro e as
-- funções de leitura. Quem passa a consumir isso é a frente 4
-- (nivel_efetivo v2), atrás de `modulos.exige_lotacao`.
--
-- LOTAÇÃO ≠ CARGO. Quem ocupa cargo é lotado por DERIVAÇÃO (ver
-- usuario_unidades()), nunca digitado duas vezes: o dado de chefia
-- continua morando só em cargo_ocupacoes.
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS usuario_lotacoes (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id     uuid NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  unidade_org_id uuid NOT NULL REFERENCES unidades_organizacionais(id) ON DELETE RESTRICT,

  -- Lotação principal do servidor. Múltipla lotação é permitida de
  -- propósito (há quem sirva a dois setores); negar isso empurraria o
  -- caso para o mecanismo de exceção, que é mais caro de administrar.
  principal      boolean NOT NULL DEFAULT true,

  -- HISTÓRICO, não estado: mudar de setor é fechar uma linha e abrir
  -- outra. Nada é sobrescrito, então "onde fulano estava em março?"
  -- continua respondível.
  data_inicio    date NOT NULL DEFAULT CURRENT_DATE,
  data_fim       date,               -- NULL = vigente

  portaria       text,
  observacoes    text,

  criado_por     uuid REFERENCES usuarios(id) ON DELETE SET NULL,
  criado_em      timestamptz NOT NULL DEFAULT now(),
  atualizado_em  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT ck_lotacao_datas CHECK (data_fim IS NULL OR data_fim >= data_inicio)
);

COMMENT ON TABLE usuario_lotacoes IS
  'Onde cada servidor trabalha. Distinta de cargo_ocupacoes (chefia). Base do acesso por organograma — ver docs/acesso-por-organograma.md.';
COMMENT ON COLUMN usuario_lotacoes.data_fim IS
  'NULL = lotação vigente. Mudança de setor fecha a linha e abre outra; nunca sobrescreve.';

-- Uma lotação vigente por par usuário×unidade…
CREATE UNIQUE INDEX IF NOT EXISTS uq_lotacao_vigente
  ON usuario_lotacoes (usuario_id, unidade_org_id) WHERE data_fim IS NULL;
-- …e no máximo uma PRINCIPAL vigente por usuário.
CREATE UNIQUE INDEX IF NOT EXISTS uq_lotacao_principal_vigente
  ON usuario_lotacoes (usuario_id) WHERE data_fim IS NULL AND principal;
-- ⚠ Índices UNIQUE PARCIAIS não servem de alvo para ON CONFLICT do
-- PostgREST/supabase-js (lição da migration 257b): o cliente grava por
-- INSERT/UPDATE explícito, nunca por upsert nestas chaves.

CREATE INDEX IF NOT EXISTS idx_lotacao_usuario ON usuario_lotacoes (usuario_id) WHERE data_fim IS NULL;
CREATE INDEX IF NOT EXISTS idx_lotacao_unidade ON usuario_lotacoes (unidade_org_id) WHERE data_fim IS NULL;

DROP TRIGGER IF EXISTS trg_lotacoes_updated ON usuario_lotacoes;
CREATE TRIGGER trg_lotacoes_updated BEFORE UPDATE ON usuario_lotacoes
  FOR EACH ROW EXECUTE FUNCTION touch_atualizado_em();

-- ── Leitura única: unidades do usuário (lotação + chefia) ─────
-- SECURITY DEFINER porque precisa enxergar cargo_ocupacoes/cargos
-- independentemente da RLS de quem pergunta — é insumo de autorização,
-- não exibição de dado.
CREATE OR REPLACE FUNCTION usuario_unidades(p_usuario uuid)
RETURNS TABLE (unidade_org_id uuid, origem text, principal boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT l.unidade_org_id, 'lotacao'::text, l.principal
    FROM usuario_lotacoes l
   WHERE l.usuario_id = p_usuario
     AND l.data_inicio <= CURRENT_DATE
     AND (l.data_fim IS NULL OR l.data_fim >= CURRENT_DATE)
  UNION
  -- Derivação: quem ocupa cargo está lotado na unidade do cargo, sem
  -- precisar de linha em usuario_lotacoes.
  SELECT c.unidade_org_id, 'cargo'::text, false
    FROM cargo_ocupacoes o
    JOIN cargos c ON c.id = o.cargo_id
   WHERE o.usuario_id = p_usuario
     AND o.data_inicio <= CURRENT_DATE
     AND (o.data_fim IS NULL OR o.data_fim >= CURRENT_DATE)
     AND c.ativo;
$$;

COMMENT ON FUNCTION usuario_unidades(uuid) IS
  'Unidades vigentes de um usuário: lotação explícita + derivada de cargo_ocupacoes. Fonte única — nenhuma página deve remontar isso.';

-- Atalho para o usuário corrente (uso em RLS e no frontend).
CREATE OR REPLACE FUNCTION minhas_unidades()
RETURNS TABLE (unidade_org_id uuid, origem text, principal boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT * FROM usuario_unidades(auth.uid()); $$;

-- ── View de apoio para as telas (quem está lotado onde) ───────
CREATE OR REPLACE VIEW vw_lotacoes_vigentes
WITH (security_invoker = true) AS
SELECT
  l.id,
  l.usuario_id,
  u.nome_completo   AS usuario_nome,
  u.email           AS usuario_email,
  u.perfil::text    AS usuario_perfil,
  u.ativo           AS usuario_ativo,
  l.unidade_org_id,
  o.sigla           AS unidade_sigla,
  o.nome            AS unidade_nome,
  o.tipo::text      AS unidade_tipo,
  l.principal,
  l.data_inicio,
  l.data_fim,
  l.portaria,
  l.observacoes
FROM usuario_lotacoes l
JOIN usuarios u                 ON u.id = l.usuario_id
JOIN unidades_organizacionais o ON o.id = l.unidade_org_id
WHERE l.data_fim IS NULL OR l.data_fim >= CURRENT_DATE;

-- Quem está SEM lotação — a tela de Usuários precisa disto em destaque.
-- Silêncio aqui vira chamado de suporte no dia em que a restrição por
-- setor for ligada (frente 8).
CREATE OR REPLACE VIEW vw_usuarios_sem_lotacao
WITH (security_invoker = true) AS
SELECT u.id, u.nome_completo, u.email, u.perfil::text AS perfil, u.cargo
  FROM usuarios u
 WHERE u.ativo
   AND NOT EXISTS (SELECT 1 FROM usuario_unidades(u.id));

-- ── RLS ───────────────────────────────────────────────────────
ALTER TABLE usuario_lotacoes ENABLE ROW LEVEL SECURITY;

-- Leitura: o próprio, quem enxerga a Estrutura Organizacional, e super_admin.
DROP POLICY IF EXISTS lotacoes_select ON usuario_lotacoes;
CREATE POLICY lotacoes_select ON usuario_lotacoes
  FOR SELECT USING (
    usuario_id = auth.uid()
    OR pode_ver('estrutura-organizacional')
    OR is_super_admin()
  );

-- Escrita: quem edita a Estrutura Organizacional (hoje: super_admin e
-- gestor, pelo catálogo). Regra vive em `modulos`, não aqui — mudar quem
-- pode lotar é UPDATE numa linha de permissão, não migration.
DROP POLICY IF EXISTS lotacoes_write ON usuario_lotacoes;
CREATE POLICY lotacoes_write ON usuario_lotacoes
  FOR ALL USING (pode_editar('estrutura-organizacional'))
         WITH CHECK (pode_editar('estrutura-organizacional'));

-- ── Fechar a superfície anônima (regra do projeto) ────────────
REVOKE EXECUTE ON FUNCTION usuario_unidades(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION minhas_unidades()      FROM anon;
