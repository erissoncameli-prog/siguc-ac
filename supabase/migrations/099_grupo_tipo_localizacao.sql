-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Biomonitor — Padroniza localização do grupo
-- ───────────────────────────────────────────────────────────
-- Alinha o grupo ao mesmo modelo já usado nas praias (085):
-- tipo_localizacao (enum) + localizacao_referencia (texto livre),
-- com CHECK garantindo que "dentro_uc" exige uc_id.
-- Migra o local_descricao (098) para localizacao_referencia.
-- O local_descricao é mantido (depreciado) para não quebrar o
-- web antigo até o deploy; pode ser removido numa limpeza futura.
-- ═══════════════════════════════════════════════════════════

ALTER TABLE grupos_biomonitor
  ADD COLUMN IF NOT EXISTS tipo_localizacao       tipo_localizacao_praia NOT NULL DEFAULT 'dentro_uc',
  ADD COLUMN IF NOT EXISTS localizacao_referencia text;

-- Migra dados existentes: referência herda do local_descricao; tipo
-- vira 'outro' quando não há UC (e havia local livre), senão 'dentro_uc'.
UPDATE grupos_biomonitor
   SET localizacao_referencia = COALESCE(localizacao_referencia, local_descricao),
       tipo_localizacao = CASE
         WHEN uc_id IS NULL THEN 'outro'::tipo_localizacao_praia
         ELSE 'dentro_uc'::tipo_localizacao_praia
       END
 WHERE local_descricao IS NOT NULL OR uc_id IS NULL;

-- Consistência (igual à praia): dentro_uc → uc_id obrigatório
ALTER TABLE grupos_biomonitor DROP CONSTRAINT IF EXISTS chk_grupo_localizacao;
ALTER TABLE grupos_biomonitor
  ADD CONSTRAINT chk_grupo_localizacao CHECK (
    tipo_localizacao = 'dentro_uc' AND uc_id IS NOT NULL
    OR
    tipo_localizacao <> 'dentro_uc'
  );
