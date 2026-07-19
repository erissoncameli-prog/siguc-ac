-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Frota — motorista precisa ler o próprio cadastro
-- O login gerado por gerar-login-motorista cria o usuário com
-- perfil 'visualizador', que tem 'sem_acesso' ao módulo Frota
-- (grupo_permissoes_padrao, 154). Como a policy de SELECT em
-- frota_motoristas exigia pode_ver('frota'), o próprio motorista
-- nunca conseguia ler sua linha (RLS bloqueava), e o App Frota
-- (frota-app.html, entrarComSessao) sempre caía no modo
-- solicitante, mesmo com o vínculo usuario_id correto no banco.
-- ═══════════════════════════════════════════════════════════

DROP POLICY IF EXISTS frota_mot_select ON frota_motoristas;
CREATE POLICY frota_mot_select ON frota_motoristas
  FOR SELECT USING (pode_ver('frota') OR usuario_id = auth.uid());
