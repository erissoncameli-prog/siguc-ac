-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Frota — foto de cadastro do motorista
-- frota_motoristas.foto_url já existia (154) mas sem uso. Bucket
-- e policies no mesmo padrão do bucket 'brigadistas' (044/049):
-- leitura pública, escrita por qualquer autenticado (mesa) e o
-- próprio motorista pode atualizar sua linha (self-service no
-- App Frota, análogo a brigadistas_self_update).
-- ═══════════════════════════════════════════════════════════

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('frota-motoristas', 'frota-motoristas', true, 5242880,
        ARRAY['image/jpeg','image/jpg','image/png','image/webp','image/heic','image/heif'])
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS frota_motoristas_fotos_read ON storage.objects;
CREATE POLICY frota_motoristas_fotos_read ON storage.objects
  FOR SELECT USING (bucket_id = 'frota-motoristas');

DROP POLICY IF EXISTS frota_motoristas_fotos_insert ON storage.objects;
CREATE POLICY frota_motoristas_fotos_insert ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'frota-motoristas' AND auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS frota_motoristas_fotos_update ON storage.objects;
CREATE POLICY frota_motoristas_fotos_update ON storage.objects
  FOR UPDATE USING (bucket_id = 'frota-motoristas' AND auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS frota_motoristas_fotos_delete ON storage.objects;
CREATE POLICY frota_motoristas_fotos_delete ON storage.objects
  FOR DELETE USING (bucket_id = 'frota-motoristas' AND auth.uid() IS NOT NULL);

-- Motorista atualiza a própria linha (usado pelo App Frota para trocar foto)
DROP POLICY IF EXISTS frota_mot_self_update ON frota_motoristas;
CREATE POLICY frota_mot_self_update ON frota_motoristas
  FOR UPDATE USING (usuario_id = auth.uid()) WITH CHECK (usuario_id = auth.uid());
