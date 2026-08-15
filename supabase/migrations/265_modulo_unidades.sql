-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Amarração módulo ↔ unidade organizacional (setor dono)
-- Frente 2 de docs/acesso-por-organograma.md
--
-- POR QUE ESTA TABELA EXISTE
-- A frente 1 (migration 262) deu resposta a "de que setor é esta
-- pessoa" (usuario_lotacoes / usuario_unidades). Falta a outra metade:
-- "que setor é DONO de qual módulo". Esta migration cria essa amarração
-- e a função que calcula o ALCANCE de um usuário num módulo, herdando
-- pela árvore do organograma:
--   - unidade DESCENDENTE da dona herda o MESMO nível (reorganização
--     resolve sozinha: religar `pai_id` já recalcula tudo, sem migration);
--   - unidade ANCESTRAL da dona (quem chefia acima) herda só
--     'visualizar' — "quem manda, enxerga", nunca edita por quem está
--     abaixo.
--
-- ESTA MIGRATION NÃO MUDA O ACESSO DE NINGUÉM. Cria a tabela, a função
-- de alcance e a tela de amarração. Ninguém ainda CONSOME o alcance —
-- isso é a frente 4 (nivel_efetivo v2 + modulos.exige_lotacao), que só
-- liga módulo a módulo, com relatório de impacto antes. Até lá,
-- alcance_por_lotacao() existe e pode ser conferida isoladamente, mas
-- nivel_efetivo() continua sem chamá-la.
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS modulo_unidades (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  modulo_id           uuid NOT NULL REFERENCES modulos(id) ON DELETE CASCADE,
  unidade_org_id      uuid NOT NULL REFERENCES unidades_organizacionais(id) ON DELETE RESTRICT,

  -- Nível concedido a quem é lotado NA unidade dona ou em descendente
  -- dela. Nunca 'sem_acesso' — se o setor não é dono, a linha não existe.
  nivel_concedido     nivel_acesso NOT NULL DEFAULT 'editar',

  -- Um módulo pode ter mais de uma unidade dona (ex.: Brigadas
  -- compartilhado entre setores) — por isso não há UNIQUE(modulo_id).
  observacoes         text,

  criado_por          uuid REFERENCES usuarios(id) ON DELETE SET NULL,
  criado_em           timestamptz NOT NULL DEFAULT now(),
  atualizado_em       timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT ck_modulo_unidade_nivel_concedido CHECK (nivel_concedido <> 'sem_acesso'),
  CONSTRAINT uq_modulo_unidade UNIQUE (modulo_id, unidade_org_id)
);

COMMENT ON TABLE modulo_unidades IS
  'Setor(es) dono(s) de cada módulo. Alcance por lotação (frente 2 de docs/acesso-por-organograma.md) — descendente herda o nível, ancestral herda só visualizar.';

CREATE INDEX IF NOT EXISTS idx_modulo_unidades_modulo  ON modulo_unidades (modulo_id);
CREATE INDEX IF NOT EXISTS idx_modulo_unidades_unidade ON modulo_unidades (unidade_org_id);

DROP TRIGGER IF EXISTS trg_modulo_unidades_updated ON modulo_unidades;
CREATE TRIGGER trg_modulo_unidades_updated BEFORE UPDATE ON modulo_unidades
  FOR EACH ROW EXECUTE FUNCTION touch_atualizado_em();

-- ── Ancestrais de uma unidade (para o cálculo "para cima") ─────
-- Árvore de 25 nós — profundidade máxima baixa; RECURSIVE é o jeito
-- correto e não precisa de proteção especial contra ciclo aqui (ciclo
-- em pai_id seria bug de cadastro, fora do escopo desta migration).
CREATE OR REPLACE FUNCTION unidade_ancestrais(p_unidade uuid)
RETURNS TABLE (unidade_org_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH RECURSIVE subida AS (
    SELECT pai_id FROM unidades_organizacionais WHERE id = p_unidade
    UNION ALL
    SELECT u.pai_id FROM unidades_organizacionais u
      JOIN subida s ON u.id = s.pai_id
  )
  SELECT pai_id FROM subida WHERE pai_id IS NOT NULL;
$$;

-- ── Descendentes de uma unidade (para o cálculo "para baixo") ──
CREATE OR REPLACE FUNCTION unidade_descendentes(p_unidade uuid)
RETURNS TABLE (unidade_org_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH RECURSIVE descida AS (
    SELECT id FROM unidades_organizacionais WHERE pai_id = p_unidade
    UNION ALL
    SELECT u.id FROM unidades_organizacionais u
      JOIN descida d ON u.pai_id = d.id
  )
  SELECT id FROM descida;
$$;

-- ── O cálculo central: alcance de um usuário num módulo, por lotação ──
-- Maior nível entre todas as suas unidades (múltipla lotação já é
-- permitida pela frente 1). NULL quando o módulo não tem dono nenhum
-- (modulo_unidades vazia para ele) — nivel_efetivo() trata NULL como
-- "este eixo não se aplica", nunca como sem_acesso; é o que evita
-- trancar módulos sem dono (mapa, dashboard, documentos…) quando a
-- frente 4 ligar exige_lotacao.
CREATE OR REPLACE FUNCTION alcance_por_lotacao(p_usuario uuid, p_modulo_chave text)
RETURNS nivel_acesso
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_modulo_id uuid;
  v_nivel     nivel_acesso;
BEGIN
  SELECT id INTO v_modulo_id FROM modulos WHERE chave = p_modulo_chave;
  IF v_modulo_id IS NULL THEN
    RETURN NULL;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM modulo_unidades WHERE modulo_id = v_modulo_id) THEN
    RETURN NULL; -- módulo sem dono: eixo de setor não se aplica
  END IF;

  SELECT MAX(nivel) INTO v_nivel FROM (
    -- lotado na própria unidade dona, ou em descendente dela: herda o nível concedido
    SELECT mu.nivel_concedido AS nivel
      FROM modulo_unidades mu
      JOIN usuario_unidades(p_usuario) uu ON uu.unidade_org_id = mu.unidade_org_id
                                          OR uu.unidade_org_id IN (SELECT unidade_org_id FROM unidade_descendentes(mu.unidade_org_id))
     WHERE mu.modulo_id = v_modulo_id
    UNION ALL
    -- lotado em ancestral da unidade dona (chefia acima): só visualizar
    SELECT 'visualizar'::nivel_acesso AS nivel
      FROM modulo_unidades mu
      JOIN usuario_unidades(p_usuario) uu ON uu.unidade_org_id IN (SELECT unidade_org_id FROM unidade_ancestrais(mu.unidade_org_id))
     WHERE mu.modulo_id = v_modulo_id
  ) alcances;

  RETURN COALESCE(v_nivel, 'sem_acesso');
END;
$$;

COMMENT ON FUNCTION alcance_por_lotacao(uuid, text) IS
  'Nível que a LOTAÇÃO do usuário concede num módulo (NULL = módulo sem dono, eixo não se aplica). Ainda NÃO é consumida por nivel_efetivo() — ver cabeçalho da migration 265.';

REVOKE EXECUTE ON FUNCTION unidade_ancestrais(uuid)      FROM anon;
REVOKE EXECUTE ON FUNCTION unidade_descendentes(uuid)    FROM anon;
REVOKE EXECUTE ON FUNCTION alcance_por_lotacao(uuid,text) FROM anon;

-- ── View de apoio para a tela de amarração ──────────────────────
CREATE OR REPLACE VIEW vw_modulo_unidades
WITH (security_invoker = true) AS
SELECT
  mu.id,
  mu.modulo_id,
  m.chave        AS modulo_chave,
  m.nome         AS modulo_nome,
  mu.unidade_org_id,
  o.sigla        AS unidade_sigla,
  o.nome         AS unidade_nome,
  o.tipo::text   AS unidade_tipo,
  mu.nivel_concedido::text AS nivel_concedido,
  mu.observacoes,
  mu.criado_em,
  mu.atualizado_em
FROM modulo_unidades mu
JOIN modulos m                  ON m.id = mu.modulo_id
JOIN unidades_organizacionais o ON o.id = mu.unidade_org_id;

-- ── RLS ───────────────────────────────────────────────────────
ALTER TABLE modulo_unidades ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS modulo_unidades_select ON modulo_unidades;
CREATE POLICY modulo_unidades_select ON modulo_unidades
  FOR SELECT USING (auth.uid() IS NOT NULL); -- mesmo padrão de `modulos` (057): leitura autenticada, é catálogo

DROP POLICY IF EXISTS modulo_unidades_admin ON modulo_unidades;
CREATE POLICY modulo_unidades_admin ON modulo_unidades
  FOR ALL USING (is_super_admin()) WITH CHECK (is_super_admin());
-- Escrita só por super_admin (não pode_editar('estrutura-organizacional')):
-- amarrar módulo a setor redefine QUEM tem acesso a QUÊ em todo o
-- sistema — é decisão de governança, mais restrita que editar o
-- organograma em si.
