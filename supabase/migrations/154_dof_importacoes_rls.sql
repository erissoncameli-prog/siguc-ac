-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Correção de segurança: RLS ausente em dof_importacoes
-- Detectado pelo Supabase Security Advisor (rls_disabled_in_public)
-- Tabela de controle de importação dos datasets DOF (IBAMA) —
-- sem uso no frontend, só leitura/escrita administrativa
-- ═══════════════════════════════════════════════════════════

ALTER TABLE dof_importacoes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "dof_importacoes_select" ON dof_importacoes
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM usuarios WHERE id = auth.uid()
        AND perfil IN ('tecnico','gestor','super_admin') AND ativo
    )
  );

CREATE POLICY "dof_importacoes_write" ON dof_importacoes
  FOR ALL TO authenticated USING (
    EXISTS (
      SELECT 1 FROM usuarios WHERE id = auth.uid()
        AND perfil IN ('gestor','super_admin') AND ativo
    )
  );
