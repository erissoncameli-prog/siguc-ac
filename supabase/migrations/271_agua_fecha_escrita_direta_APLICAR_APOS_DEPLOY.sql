-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Qualidade da Água — fecha UPDATE/DELETE direto
--
-- ⚠️ NÃO APLICAR antes do deploy do frontend que usa
-- agua_atualizar_coleta/agua_atualizar_ponto/agua_atualizar_laboratorio/
-- agua_excluir_coleta (pages/agua-conferencia.html, agua-laudos.html,
-- agua-pontos.html). Aplicar esta migration primeiro quebra as 3 telas
-- em produção — mesma lição das migrations 200/210/245 (fechar a
-- superfície antes do cliente novo estar no ar).
--
-- Depois desta migration, UPDATE/DELETE em agua_coletas/
-- agua_pontos_coleta/agua_laboratorios só acontecem através das RPCs
-- (SECURITY DEFINER, dono `postgres`, que já bypassam RLS por
-- definição — não precisam de policy própria). INSERT continua aberto
-- via `pode_editar('agua')`, incluindo o app de campo offline.
--
-- `agua_campanhas` fica DE FORA desta migration, deliberadamente: não
-- existe RPC nem fluxo de UPDATE/DELETE dela em nenhuma tela hoje —
-- fechar a escrita direta sem ter para onde redirecioná-la trocaria
-- "nada usa isso" por "nada usa isso, e também não dá mais para usar
-- via SQL direto se algum dia precisar", sem ganho real. Fica
-- registrado como pendência caso `agua_campanhas` ganhe tela própria
-- no futuro (aplicar o mesmo padrão desta migration nela também).
-- ═══════════════════════════════════════════════════════════

DROP POLICY IF EXISTS agua_coletas_write ON agua_coletas;
CREATE POLICY agua_coletas_insert ON agua_coletas
  FOR INSERT WITH CHECK (pode_editar('agua'));
-- Sem policy de UPDATE/DELETE para authenticated/anon: só as RPCs
-- (agua_atualizar_coleta, agua_excluir_coleta) escrevem.

DROP POLICY IF EXISTS agua_pontos_write ON agua_pontos_coleta;
CREATE POLICY agua_pontos_insert ON agua_pontos_coleta
  FOR INSERT WITH CHECK (pode_editar('agua'));
-- Só agua_atualizar_ponto edita depois do INSERT.

DROP POLICY IF EXISTS agua_lab_write ON agua_laboratorios;
CREATE POLICY agua_lab_insert ON agua_laboratorios
  FOR INSERT WITH CHECK (pode_editar('agua'));
-- Só agua_atualizar_laboratorio edita depois do INSERT.
