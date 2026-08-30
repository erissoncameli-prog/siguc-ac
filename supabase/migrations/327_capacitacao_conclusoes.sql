-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Registro de capacitação (guias de introdução)
--
-- Contraparte no banco de js/guia-app.js. Guarda QUEM concluiu QUAL
-- guia, em que versão e quando — pedido do usuário para ter relatório
-- de capacitação, não apenas progresso no aparelho.
--
-- Decisões que valem para qualquer app que use o motor de guias:
--
--  • TABELA ÚNICA, transversal. `escopo` ('agua-app', 'agua-mesa',
--    'brigadas-app'…) identifica o conjunto de guias; o módulo sai do
--    prefixo (`capacitacao_modulo`). App novo não precisa de tabela
--    nem de migration de schema — só passa a gravar com o escopo dele.
--
--  • O REGISTRO NÃO É GATE. Concluir guia não libera nem bloqueia
--    nada no sistema; é histórico de capacitação. A regra "nada pode
--    impedir o trabalho de campo" continua valendo — o cliente grava
--    local primeiro e sincroniza depois, e falha de envio nunca
--    interrompe o uso do app.
--
--  • Versão junto da conclusão. Guia reescrito sobe de versão e volta
--    a valer como pendente para o usuário, SEM apagar o registro
--    anterior — é o que permite dizer "fulano foi capacitado no texto
--    v1, que mudou depois".
--
--  • LEITURA DE TERCEIRO SÓ POR RPC. A RLS da tabela libera apenas as
--    linhas do próprio titular. O relatório da gestão passa por
--    `capacitacao_relatorio()` (SECURITY DEFINER, whitelist explícita
--    de colunas no RETURNS TABLE, molde da 297), com o acesso decidido
--    por `pode_ver(modulo)` — nunca `perfil = '...'` direto (regra do
--    projeto, "Acesso por organograma").
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS capacitacao_conclusoes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id    uuid NOT NULL DEFAULT auth.uid()
                  REFERENCES auth.users(id) ON DELETE CASCADE,
  escopo        text NOT NULL CHECK (escopo ~ '^[a-z0-9-]{3,40}$'),
  guia          text NOT NULL CHECK (guia   ~ '^[a-z0-9-]{2,60}$'),
  versao        integer NOT NULL DEFAULT 1 CHECK (versao BETWEEN 1 AND 999),
  concluido_em  timestamptz NOT NULL DEFAULT now(),
  registrado_em timestamptz NOT NULL DEFAULT now(),
  UNIQUE (usuario_id, escopo, guia, versao)
);

COMMENT ON TABLE  capacitacao_conclusoes IS
  'Conclusão de guias de introdução/treinamento (js/guia-app.js). Histórico de capacitação — nunca gate de acesso.';
COMMENT ON COLUMN capacitacao_conclusoes.escopo IS
  'Conjunto de guias: agua-app, agua-mesa, brigadas-app… O módulo sai do prefixo (capacitacao_modulo).';
COMMENT ON COLUMN capacitacao_conclusoes.concluido_em IS
  'Momento informado pelo cliente — pode ser anterior ao registrado_em (conclusão offline, sincronizada depois).';

CREATE INDEX IF NOT EXISTS idx_capacitacao_usuario ON capacitacao_conclusoes (usuario_id);
CREATE INDEX IF NOT EXISTS idx_capacitacao_escopo  ON capacitacao_conclusoes (escopo, guia);

ALTER TABLE capacitacao_conclusoes ENABLE ROW LEVEL SECURITY;

-- Só o próprio titular enxerga e grava as próprias linhas. A gestão lê
-- pelo relatório (RPC abaixo), nunca por SELECT direto.
DROP POLICY IF EXISTS capacitacao_self_select ON capacitacao_conclusoes;
CREATE POLICY capacitacao_self_select ON capacitacao_conclusoes
  FOR SELECT TO authenticated USING (usuario_id = auth.uid());

DROP POLICY IF EXISTS capacitacao_self_insert ON capacitacao_conclusoes;
CREATE POLICY capacitacao_self_insert ON capacitacao_conclusoes
  FOR INSERT TO authenticated WITH CHECK (usuario_id = auth.uid());

-- Sem UPDATE e sem DELETE de propósito: é registro de fato ocorrido,
-- como lgpd_aceites. Correção, se algum dia precisar, entra por
-- migration com justificativa.

-- ── Módulo a partir do escopo ────────────────────────────────
CREATE OR REPLACE FUNCTION capacitacao_modulo(p_escopo text)
RETURNS text
LANGUAGE sql IMMUTABLE
SET search_path = public
AS $$ SELECT split_part(coalesce(p_escopo, ''), '-', 1) $$;

-- ── Registrar conclusão (idempotente) ────────────────────────
-- SECURITY INVOKER: quem autoriza é a policy de INSERT acima — a RPC
-- existe pela idempotência e por normalizar o carimbo de tempo, nunca
-- para elevar privilégio.
CREATE OR REPLACE FUNCTION capacitacao_registrar_conclusao(
  p_escopo text,
  p_guia   text,
  p_versao integer DEFAULT 1,
  p_concluido_em timestamptz DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sem sessão autenticada.';
  END IF;

  INSERT INTO capacitacao_conclusoes (usuario_id, escopo, guia, versao, concluido_em)
  VALUES (
    auth.uid(), p_escopo, p_guia, coalesce(p_versao, 1),
    -- Carimbo do cliente é aceito (a conclusão pode ter acontecido
    -- offline, dias antes), mas nunca no futuro nem antes de 2020.
    least(greatest(coalesce(p_concluido_em, now()), timestamptz '2020-01-01'), now())
  )
  ON CONFLICT (usuario_id, escopo, guia, versao) DO NOTHING;
END $$;

-- ── Meu progresso (o próprio titular) ────────────────────────
CREATE OR REPLACE FUNCTION capacitacao_meu_progresso(p_escopo text DEFAULT NULL)
RETURNS TABLE (escopo text, guia text, versao integer, concluido_em timestamptz)
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public
AS $$
  SELECT c.escopo, c.guia, c.versao, c.concluido_em
    FROM capacitacao_conclusoes c
   WHERE c.usuario_id = auth.uid()
     AND (p_escopo IS NULL OR c.escopo = p_escopo)
   ORDER BY c.concluido_em DESC
$$;

-- ── Relatório da gestão ──────────────────────────────────────
-- SECURITY DEFINER com whitelist explícita de colunas (molde da 297):
-- devolve nome e conclusão, nunca a linha crua de `usuarios`.
CREATE OR REPLACE FUNCTION capacitacao_relatorio(p_escopo text)
RETURNS TABLE (
  usuario_id   uuid,
  nome         text,
  escopo       text,
  guia         text,
  versao       integer,
  concluido_em timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT pode_ver(capacitacao_modulo(p_escopo)) THEN
    RAISE EXCEPTION 'Sem permissão para ver a capacitação deste módulo.';
  END IF;

  RETURN QUERY
    SELECT c.usuario_id,
           coalesce(u.nome_completo, '(sem cadastro)')::text,
           c.escopo, c.guia, c.versao, c.concluido_em
      FROM capacitacao_conclusoes c
      LEFT JOIN usuarios u ON u.id = c.usuario_id
     WHERE c.escopo = p_escopo
     ORDER BY coalesce(u.nome_completo, ''), c.guia;
END $$;

-- Fechar a superfície anônima. `REVOKE ... FROM PUBLIC` não basta
-- neste projeto: o ALTER DEFAULT PRIVILEGES concede EXECUTE a `anon`
-- por NOME em toda função nova (lição das migrations 165/249/252b/297).
REVOKE ALL ON FUNCTION capacitacao_modulo(text)                              FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION capacitacao_registrar_conclusao(text, text, integer, timestamptz) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION capacitacao_meu_progresso(text)                       FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION capacitacao_relatorio(text)                           FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION capacitacao_modulo(text)                              TO authenticated;
GRANT EXECUTE ON FUNCTION capacitacao_registrar_conclusao(text, text, integer, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION capacitacao_meu_progresso(text)                       TO authenticated;
GRANT EXECUTE ON FUNCTION capacitacao_relatorio(text)                           TO authenticated;

-- ── ROPA (regra da migration 211) ────────────────────────────
-- Tabela nova com dado pessoal = entrada nova no ROPA, na MESMA
-- entrega. Risco baixo e nenhum dado sensível: é o registro de que
-- uma pessoa leu um material de treinamento.
INSERT INTO lgpd_tratamentos (
  codigo, nome, modulo, finalidade,
  base_legal, base_legal_detalhe,
  categorias_titulares, categorias_dados,
  dado_sensivel, dado_de_menor,
  origem, origem_detalhe,
  tabelas,
  retencao_meses, retencao_criterio,
  compartilhamento, transferencia_internacional,
  alto_risco, observacoes
) VALUES (
  'TRAT-020',
  'Registro de capacitação nos guias do sistema',
  'agua',
  'Registrar quais guias de introdução cada usuário concluiu, para comprovar capacitação da equipe no uso dos módulos e identificar quem ainda precisa de treinamento.',
  'politica_publica',
  'Art. 7º, III — execução de política pública: capacitar a equipe para operar os sistemas do órgão ambiental é parte da própria execução do monitoramento.',
  ARRAY['servidores e colaboradores usuários do sistema'],
  ARRAY['vínculo com conta de usuário','identificação do guia concluído','versão do material','data e hora da conclusão'],
  false, false,
  'coleta_direta',
  'Gerado pelo próprio uso: o usuário conclui um guia no app ou na mesa.',
  ARRAY['capacitacao_conclusoes'],
  60,
  'Cinco anos — mesmo horizonte da prestação de contas das atividades a que a capacitação se refere. Registro de fato ocorrido, sem UPDATE nem DELETE pela aplicação.',
  'Uso interno. Não integra divulgação pública nem é compartilhado com terceiros.',
  false,
  false,
  'Não é gate: concluir ou não um guia nunca libera ou bloqueia acesso a nada no sistema. Conclusão feita offline é sincronizada depois, e a falha de envio nunca interrompe o trabalho de campo.'
)
ON CONFLICT (codigo) DO NOTHING;
