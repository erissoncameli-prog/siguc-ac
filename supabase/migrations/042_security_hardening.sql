-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Migration 042 — Security Hardening
-- Corrige: enumeração de PII, papel brigadista, RLS por UC,
--          exposição de CPF/e-mail via QR, retenção de auditoria
-- ═══════════════════════════════════════════════════════════

-- ─── 1. Revogar acesso anônimo à função de verificação de duplicatas ──
-- Evita enumeração de CPF + nome completo sem autenticação (LGPD Art.46)
REVOKE EXECUTE ON FUNCTION verificar_pesquisador_duplicado(text, text) FROM anon;
GRANT  EXECUTE ON FUNCTION verificar_pesquisador_duplicado(text, text) TO authenticated;

-- ─── 2. Corrigir buscar_aap_por_token — remover CPF e e-mail do retorno ──
-- O QR code é público; validar autenticidade não requer expor PII.
CREATE OR REPLACE FUNCTION buscar_aap_por_token(p_token text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public AS $$
  SELECT jsonb_build_object(
    'id',                   p.id,
    'numero_processo',      p.numero_processo,
    'titulo',               p.titulo,
    'tipo',                 p.tipo,
    'aap_numero',           p.aap_numero,
    'aap_qr_token',         p.aap_qr_token,
    'aap_emitida_em',       p.aap_emitida_em,
    'aap_validade',         p.aap_validade,
    'aap_assinado_em',      p.aap_assinado_em,
    'aap_condicionantes',   p.aap_condicionantes,
    'pesquisador_nome',     p.pesquisador_nome,
    'pesquisador_instituicao', p.pesquisador_instituicao,
    'uc_nome',              uc.nome,
    'autorizador_nome',     u_aut.nome_completo,
    'emitente_nome',        u_emit.nome_completo,
    'status_validade',      CASE
                              WHEN p.aap_validade >= current_date THEN 'valida'
                              ELSE 'expirada'
                            END
  )
  FROM pesquisas p
  LEFT JOIN unidades_conservacao uc   ON uc.id    = p.uc_id
  LEFT JOIN usuarios u_aut            ON u_aut.id  = p.aap_assinado_por
  LEFT JOIN usuarios u_emit           ON u_emit.id = p.aap_emitido_por
  WHERE p.aap_qr_token = p_token
  LIMIT 1;
$$;

-- ─── 3. Corrigir verificar_bloqueio — não revelar se conta existe ─────
-- A resposta "inativo: true" indicava que o e-mail existe no sistema.
CREATE OR REPLACE FUNCTION verificar_bloqueio(p_email text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_bloqueado_ate timestamptz;
  v_ativo         boolean;
BEGIN
  SELECT bloqueado_ate, ativo
  INTO   v_bloqueado_ate, v_ativo
  FROM   usuarios
  WHERE  lower(email) = lower(p_email);

  IF NOT FOUND OR NOT v_ativo THEN
    RETURN jsonb_build_object('bloqueado', false);
  END IF;

  IF v_bloqueado_ate IS NOT NULL AND v_bloqueado_ate > now() THEN
    RETURN jsonb_build_object('bloqueado', true, 'ate', v_bloqueado_ate);
  END IF;

  RETURN jsonb_build_object('bloqueado', false);
END;
$$;

-- ─── 4. Adicionar papel brigadista ────────────────────────────────────
ALTER TYPE perfil_usuario ADD VALUE IF NOT EXISTS 'brigadista';

-- ─── 5. RLS — brigadista só registra ocorrências na sua UC ───────────
-- Leitura: brigadista vê ocorrências apenas da sua UC
CREATE POLICY "ocorr_brigadista_select" ON ocorrencias
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM usuarios u
      WHERE u.id = auth.uid()
        AND u.perfil = 'brigadista'
        AND u.uc_id = ocorrencias.uc_id
        AND u.ativo
    )
  );

-- Inserção: brigadista só cria ocorrências do tipo incendio/outro na sua UC
CREATE POLICY "ocorr_brigadista_insert" ON ocorrencias
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM usuarios u
      WHERE u.id = auth.uid()
        AND u.perfil = 'brigadista'
        AND u.uc_id = uc_id
        AND u.ativo
    )
    AND tipo IN ('incendio', 'outro')
  );

-- Brigadista não pode alterar ou excluir ocorrências (somente registrar)

-- ─── 6. RLS — técnico restrito à sua UC (quando uc_id definido) ──────
-- Técnico com uc_id atribuído só modifica ocorrências da sua UC.
-- Técnico sem uc_id (NULL) mantém acesso a todas (ex: equipe central).
CREATE POLICY "ocorr_tecnico_scoped" ON ocorrencias
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM usuarios u
      WHERE u.id = auth.uid()
        AND u.perfil = 'tecnico'
        AND u.ativo
        AND (u.uc_id IS NULL OR u.uc_id = ocorrencias.uc_id)
    )
  );

-- Remover a política ampla de técnico (substituída pela scoped acima)
DROP POLICY IF EXISTS "ocorr_modify" ON ocorrencias;

-- Recriar policy de modify apenas para gestor e super_admin (sem tecnico)
CREATE POLICY "ocorr_gestor_all" ON ocorrencias
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM usuarios u
      WHERE u.id = auth.uid()
        AND u.perfil IN ('super_admin', 'gestor')
        AND u.ativo
    )
  );

-- ─── 7. Brigadista acessa monitoramento somente da sua UC ─────────────
CREATE POLICY "monit_brigadista_select" ON monitoramento_registros
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM usuarios u
      WHERE u.id = auth.uid()
        AND u.perfil = 'brigadista'
        AND u.uc_id = monitoramento_registros.uc_id
        AND u.ativo
    )
  );

-- ─── 8. Retenção de auditoria: 5 anos (obrigação LGPD + Lei 8.159/1991) ─
CREATE OR REPLACE FUNCTION limpar_auditoria_antiga() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  DELETE FROM auditoria_acessos WHERE created_at < now() - interval '5 years';
END;
$$;

-- ─── 9. Validação de coordenadas geográficas em ocorrências ───────────
-- Impede inserção de pontos fora de WGS-84 válido
ALTER TABLE ocorrencias DROP CONSTRAINT IF EXISTS chk_localizacao_bounds;
ALTER TABLE ocorrencias
  ADD CONSTRAINT chk_localizacao_bounds CHECK (
    localizacao IS NULL OR (
      ST_X(localizacao) BETWEEN -180 AND 180 AND
      ST_Y(localizacao) BETWEEN -90  AND 90
    )
  ) NOT VALID;

-- ─── 10. Validação de area_afetada_ha ────────────────────────────────
ALTER TABLE ocorrencias DROP CONSTRAINT IF EXISTS chk_area_afetada;
ALTER TABLE ocorrencias
  ADD CONSTRAINT chk_area_afetada CHECK (
    area_afetada_ha IS NULL OR (area_afetada_ha > 0 AND area_afetada_ha <= 5000000)
  ) NOT VALID;
