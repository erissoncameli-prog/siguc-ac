-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Biomonitor — Visibilidade das visitas de ninho
-- ───────────────────────────────────────────────────────────
-- A política de SELECT de visitas_ninho só deixava o monitor ver
-- as visitas que ELE MESMO registrou (monitor_id = seu id) e não
-- incluía o perfil 'biologo'. Como o ninho é visível para todo o
-- GRUPO (e para biólogo/gestor), as visitas de colegas de grupo —
-- ou vistas por um biólogo — não apareciam no histórico do card.
--
-- Alinha a visibilidade das visitas à dos ninhos/eclosões: pode ver
-- a visita quem pode ver o ninho a que ela pertence (mesmo grupo),
-- além de tecnico/gestor/super_admin/biologo.
-- Depende de 086 (visitas_ninho).
-- ═══════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "visitas_ninho_select" ON visitas_ninho;

CREATE POLICY "visitas_ninho_select" ON visitas_ninho
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM ninhos_quelonios n
      JOIN monitores_biodiversidade m ON m.grupo_id = n.grupo_id
      WHERE n.id = visitas_ninho.ninho_id AND m.usuario_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM usuarios u
      WHERE u.id = auth.uid()
        AND u.perfil IN ('tecnico','gestor','super_admin','biologo')
        AND u.ativo
    )
  );
