-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Qualidade da Água — idempotência do app de campo
-- Fase 3 do plano em docs/qualidade-agua/plano.md (app-agua/).
--
-- IDEMPOTÊNCIA POR uuid_cliente — molde do Brigadas, não do Frota
-- O app de campo salva a coleta localmente (IndexedDB) e sincroniza
-- depois, podendo reenviar o mesmo registro (retry de rede, sync
-- disparado duas vezes). `registros_campo` (Brigadas) resolve isso com
-- uma coluna `uuid_cliente` UNIQUE + `.upsert(payload, {onConflict:
-- 'uuid_cliente'})` no cliente — mais simples que a RPC SECURITY
-- DEFINER que o Frota usa (migration 198), e suficiente aqui porque
-- quem grava já é o mesmo usuário de mesa com pode_editar('agua') —
-- não há elevação de privilégio para proteger como no Frota (onde o
-- motorista não tem acesso de mesa). NULL fica permitido (coletas
-- lançadas pela mesa via agua-laudos.html/agua-conferencia.html não
-- têm uuid_cliente) — a unicidade do Postgres já trata múltiplos NULL
-- como não-conflitantes.
--
-- CÓDIGO DA AMOSTRA
-- O rótulo físico que o coletor escreve no frasco/embalagem enviado ao
-- laboratório. Não substitui a identidade da coleta (que já é o `id`
-- da linha — é o que a fila de agua-laudos.html usa para casar o
-- laudo) — é só o dado que aparece no VÍNCULO físico, útil para o
-- técnico da mesa conferir contra o laudo em papel. Livre, opcional.
-- ═══════════════════════════════════════════════════════════

ALTER TABLE agua_coletas ADD COLUMN IF NOT EXISTS uuid_cliente uuid;
ALTER TABLE agua_coletas ADD COLUMN IF NOT EXISTS codigo_amostra text;

CREATE UNIQUE INDEX IF NOT EXISTS uq_agua_coletas_uuid_cliente
  ON agua_coletas (uuid_cliente) WHERE uuid_cliente IS NOT NULL;

COMMENT ON COLUMN agua_coletas.uuid_cliente IS
  'Chave de idempotência gerada no app de campo (Fase 3) — permite upsert seguro em reenvio de sincronização. NULL para coletas lançadas pela mesa.';
COMMENT ON COLUMN agua_coletas.codigo_amostra IS
  'Rótulo físico escrito no frasco/embalagem enviado ao laboratório, informado pelo coletor. Não é a identidade da coleta no sistema — só ajuda a conferência manual contra o laudo em papel.';
