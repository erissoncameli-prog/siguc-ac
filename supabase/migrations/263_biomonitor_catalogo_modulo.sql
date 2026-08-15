-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Biomonitor entra no catálogo de módulos
-- Frente 6 de docs/acesso-por-organograma.md
--
-- POR QUE ESTA MIGRATION EXISTE
-- Biomonitor está no ar (admin-biomonitor.html, app de campo, validação
-- de ninhos, berçários, equipamentos — migrations 073…230) mas NUNCA
-- teve linha em `modulos`. Ele é autorizado hoje por
-- `perfil = ANY(ARRAY['tecnico','gestor','super_admin'])` cravado direto
-- em cada policy (grupos_biomonitor, programas_biomonitoramento,
-- temporadas_biomonitor, biomonitor_equipamentos, cautelas…), e as
-- policies de SELECT dessas tabelas são `USING (true)` — qualquer
-- autenticado lê tudo. Sem chave no catálogo não há o que amarrar ao
-- organograma (pode_ver('biomonitor') não resolveria nada).
--
-- ESTA MIGRATION:
--   1) cria a chave 'biomonitor' em `modulos` e o padrão de perfil
--      (mesmo nível que as policies hoje concedem — tecnico/gestor/
--      super_admin = editar; demais = sem_acesso), preservando o
--      comportamento atual;
--   2) reescreve as policies das tabelas de configuração do Biomonitor
--      para pode_ver/pode_editar('biomonitor'), fechando o `USING (true)`.
--
-- NÃO MUDA QUEM TEM ACESSO HOJE — só troca ONDE a regra mora (de "escrita
-- em cada policy" para "uma linha no catálogo, a mesma fonte que todo
-- módulo novo usa"). tecnico/gestor/super_admin continuam podendo ver e
-- editar; os demais perfis continuam sem acesso, exatamente como antes.
--
-- Tabelas do Biomonitor que NÃO são tocadas aqui (ficam de fora de
-- propósito): as de dado de campo (ninhos, biometria, ocorrências,
-- cautelas por monitor…) já misturam regra de dono-do-registro
-- ("o próprio monitor" via monitores_biodiversidade.usuario_id) com
-- regra de mesa — são o §3 do plano (inventário das policies por
-- perfil), não esta frente. Esta migration cobre só o cadastro/
-- configuração, que era puramente "sou tecnico/gestor/super_admin?".
-- ═══════════════════════════════════════════════════════════

-- ── 1) Chave no catálogo ───────────────────────────────────────
INSERT INTO modulos (chave, nome, grupo, icone, rota, ordem, respeita_escopo_uc, ativo)
VALUES ('biomonitor', 'Biomonitor', 'Gestão', 'biomonitor-app',
        '../pages/admin-biomonitor.html', 40, true, true)
ON CONFLICT (chave) DO NOTHING;

-- Padrão por PERFIL (não por grupo): reproduz exatamente a regra que
-- estava cravada nas policies — tecnico/gestor/super_admin editam,
-- demais sem acesso. super_admin nem precisaria da linha (nivel_efetivo
-- já retorna 'editar' antes de consultar isto), mas fica explícito por
-- clareza de auditoria do catálogo.
INSERT INTO perfil_permissoes_padrao (perfil, modulo_id, nivel)
SELECT p.perfil, m.id, 'editar'
FROM modulos m
CROSS JOIN (VALUES ('tecnico'::perfil_usuario), ('gestor'::perfil_usuario), ('super_admin'::perfil_usuario)) AS p(perfil)
WHERE m.chave = 'biomonitor'
ON CONFLICT (perfil, modulo_id) DO NOTHING;

-- ── 2) Fecha o USING (true) nas tabelas de configuração ────────
-- Molde: FOR SELECT pode_ver('biomonitor'); FOR ALL/escrita pode_editar.
-- (a policy de escrita já existia separada da de select em todas as 4.)

ALTER TABLE grupos_biomonitor ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS grupos_bio_select ON grupos_biomonitor;
CREATE POLICY grupos_bio_select ON grupos_biomonitor
  FOR SELECT USING (pode_ver('biomonitor'));
DROP POLICY IF EXISTS grupos_bio_write ON grupos_biomonitor;
CREATE POLICY grupos_bio_write ON grupos_biomonitor
  FOR ALL USING (pode_editar('biomonitor')) WITH CHECK (pode_editar('biomonitor'));

ALTER TABLE programas_biomonitoramento ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS prog_bio_select ON programas_biomonitoramento;
CREATE POLICY prog_bio_select ON programas_biomonitoramento
  FOR SELECT USING (pode_ver('biomonitor'));
DROP POLICY IF EXISTS prog_bio_write ON programas_biomonitoramento;
CREATE POLICY prog_bio_write ON programas_biomonitoramento
  FOR ALL USING (pode_editar('biomonitor')) WITH CHECK (pode_editar('biomonitor'));

ALTER TABLE temporadas_biomonitor ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS temp_bio_select ON temporadas_biomonitor;
CREATE POLICY temp_bio_select ON temporadas_biomonitor
  FOR SELECT USING (pode_ver('biomonitor'));
DROP POLICY IF EXISTS temp_bio_write ON temporadas_biomonitor;
CREATE POLICY temp_bio_write ON temporadas_biomonitor
  FOR ALL USING (pode_editar('biomonitor')) WITH CHECK (pode_editar('biomonitor'));

ALTER TABLE biomonitor_equipamentos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bioeq_select ON biomonitor_equipamentos;
CREATE POLICY bioeq_select ON biomonitor_equipamentos
  FOR SELECT USING (pode_ver('biomonitor'));
DROP POLICY IF EXISTS bioeq_write ON biomonitor_equipamentos;
CREATE POLICY bioeq_write ON biomonitor_equipamentos
  FOR ALL USING (pode_editar('biomonitor')) WITH CHECK (pode_editar('biomonitor'));

-- biomonitor_cautelas / biomonitor_cautela_itens / biomonitor_equipamento_ocorrencias
-- NÃO entram aqui: a policy delas é OR (dono do registro via monitor)
-- OR (perfil de mesa) — mudar exige decidir a substituição do segundo
-- ramo por pode_ver/pode_editar sem tocar no primeiro, o que é o
-- trabalho do §3 (inventário das 133 policies), não desta frente.
