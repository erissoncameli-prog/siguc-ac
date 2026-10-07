-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Biomonitor — monitor de campo volta a ler o PRÓPRIO grupo
--
-- POR QUE ESTA MIGRATION EXISTE
-- A 263 trocou o SELECT de grupos_biomonitor, programas_biomonitoramento,
-- temporadas_biomonitor e biomonitor_equipamentos de `USING (true)` para
-- `pode_ver('biomonitor')`, dizendo "não muda quem tem acesso". Mudou:
-- o monitor de campo NÃO tem linha em `usuarios` (só em
-- monitores_biodiversidade), então pode_ver() é sempre falso para ele.
--
-- Efeito medido em produção (07/10/2026, monitor do grupo Rio Abunã,
-- transação com ROLLBACK): ninhos_quelonios = 568 linhas visíveis, mas
-- vw_ninhos_validacao WHERE grupo_id = <grupo dele> = 0 — a view tira
-- `grupo_id` do LEFT JOIN em grupos_biomonitor, que a RLS zerava. A aba
-- "Ninhos Abertos" do app ficava vazia para todo monitor que não é
-- também perfil de mesa; a temporada atual e o cache de equipamentos
-- também não baixavam.
--
-- O QUE MUDA (só leitura, só o próprio grupo — nunca volta o USING(true)):
--   * bio_meu_grupo_ids(): grupos dos quais o chamador é monitor ATIVO
--     (mesmo critério de bio_monitor_atual()). SECURITY DEFINER para a
--     policy de uma tabela não depender da RLS de outra (sem recursão).
--   * SELECT adicional, por OR com a policy de mesa existente (que não é
--     tocada): grupo próprio, programa do grupo, temporadas do programa,
--     equipamentos do grupo.
--   * vw_ninhos_validacao: ver 357b.
--
-- Sem DROP POLICY IF EXISTS: o MCP do Supabase pede confirmação para DROP
-- e a 1ª tentativa expirou sem aplicar nada (mesma armadilha da 353).
-- ═══════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.bio_meu_grupo_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT m.grupo_id
  FROM monitores_biodiversidade m
  WHERE m.usuario_id = auth.uid()
    AND m.status = 'ativo'
    AND m.grupo_id IS NOT NULL
$$;

REVOKE ALL ON FUNCTION public.bio_meu_grupo_ids() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.bio_meu_grupo_ids() FROM anon;
GRANT EXECUTE ON FUNCTION public.bio_meu_grupo_ids() TO authenticated;

CREATE POLICY grupos_bio_select_monitor ON grupos_biomonitor
  FOR SELECT TO authenticated
  USING (id IN (SELECT public.bio_meu_grupo_ids()));

CREATE POLICY prog_bio_select_monitor ON programas_biomonitoramento
  FOR SELECT TO authenticated
  USING (id IN (SELECT g.programa_id FROM grupos_biomonitor g
                WHERE g.id IN (SELECT public.bio_meu_grupo_ids())));

CREATE POLICY temp_bio_select_monitor ON temporadas_biomonitor
  FOR SELECT TO authenticated
  USING (programa_id IN (SELECT g.programa_id FROM grupos_biomonitor g
                         WHERE g.id IN (SELECT public.bio_meu_grupo_ids())));

CREATE POLICY bioeq_select_monitor ON biomonitor_equipamentos
  FOR SELECT TO authenticated
  USING (grupo_id IN (SELECT public.bio_meu_grupo_ids()));
