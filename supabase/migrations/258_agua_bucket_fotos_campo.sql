-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Qualidade da Água — bucket privado da foto de campo
-- Fase 3 do plano em docs/qualidade-agua/plano.md (app-agua/).
--
-- BUCKET PRÓPRIO, DIFERENTE DE `agua-laudos`
-- `agua-laudos` (migration 255) é o PDF/imagem do laudo do laboratório,
-- lançado SEMPRE pela mesa (Fase 2) — conceitualmente um documento de
-- prestação de contas. A foto do ponto de coleta é outra coisa: é
-- capturada pelo COLETOR em campo, no momento da coleta, e prova o
-- estado do local — mesma família da foto de ocorrência do Brigadas
-- ou do cupom de abastecimento do Frota. Dois conceitos diferentes não
-- dividem bucket, mesmo sendo o mesmo módulo.
--
-- QUEM ESCREVE — aqui NÃO existe a assimetria do Frota (onde o
-- motorista não tem acesso de mesa e por isso precisa de uma policy de
-- escrita própria, restrita ao dono do registro). Em Água, quem coleta
-- em campo é a MESMA população de tecnico/gestor/biologo que já opera
-- a mesa (decisão do usuário, ver cabeçalho do plano — Fase 3) — então
-- WRITE por `pode_editar('agua')` já é a permissão certa, sem policy
-- dupla.
--
-- PRIVADO DESDE O NASCIMENTO — mesmo padrão da 255/210: nunca existe
-- uma janela em que o bucket é público.
-- ═══════════════════════════════════════════════════════════

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('agua-fotos-campo', 'agua-fotos-campo', false, 8388608,
  ARRAY['image/jpeg','image/jpg','image/png','image/webp','image/heic','image/heif'])
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS agua_fotos_campo_read ON storage.objects;
CREATE POLICY agua_fotos_campo_read ON storage.objects
  FOR SELECT USING (bucket_id = 'agua-fotos-campo' AND pode_ver('agua'));

DROP POLICY IF EXISTS agua_fotos_campo_insert ON storage.objects;
CREATE POLICY agua_fotos_campo_insert ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'agua-fotos-campo' AND pode_editar('agua'));

DROP POLICY IF EXISTS agua_fotos_campo_update ON storage.objects;
CREATE POLICY agua_fotos_campo_update ON storage.objects
  FOR UPDATE USING (bucket_id = 'agua-fotos-campo' AND pode_editar('agua'));

DROP POLICY IF EXISTS agua_fotos_campo_delete ON storage.objects;
CREATE POLICY agua_fotos_campo_delete ON storage.objects
  FOR DELETE USING (bucket_id = 'agua-fotos-campo' AND pode_editar('agua'));
