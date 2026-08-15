-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Fecha o buraco das policies com perfil direto (1/N)
-- Frente 5 de docs/acesso-por-organograma.md
--
-- Ver docs/acesso-por-organograma.md §3 e o apêndice "Inventário das
-- 129 policies" para o levantamento completo e a razão de esta ser a
-- ÚNICA conversão desta sessão: comparei, tabela a tabela, o array de
-- perfis hard-coded na policy contra o que `perfil_permissoes_padrao`/
-- `grupo_permissoes_padrao` concedem hoje para o módulo correspondente.
-- Na maioria das tabelas testadas (documentos, equipe_servidores,
-- netflora_*, unidades_conservacao, camadas_mapa, alertas_ambientais,
-- monitoramento_indicadores) o catálogo DIVERGE do array real — converter
-- teria ampliado ou reduzido acesso de verdade, silenciosamente. Isso é
-- achado, não suposição: documentado no apêndice do plano.
--
-- `config_sistema` é a exceção limpa: `perfil_permissoes_padrao` e
-- `grupo_permissoes_padrao` não concedem NADA (nem visualizar) a nenhum
-- perfil no módulo 'configuracoes' além de super_admin — e super_admin
-- já bypassa nivel_efetivo() antes de qualquer consulta ao catálogo.
-- `pode_editar('configuracoes')` é portanto EXATAMENTE equivalente a
-- `perfil = 'super_admin'` hoje, para todo o enum de 15 perfis
-- (verificado por consulta direta ao catálogo, não só ao perfil
-- presente entre os usuários ativos).
-- ═══════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "config escrita admin" ON config_sistema;
CREATE POLICY config_escrita_admin ON config_sistema
  FOR ALL USING (pode_editar('configuracoes')) WITH CHECK (pode_editar('configuracoes'));

-- "config leitura publica" (SELECT USING true) não muda — não usa perfil.
