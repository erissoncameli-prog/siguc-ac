-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Frota — escrita no bucket de fotos de motorista
-- (Fase 3 do plano em docs/frota-analise-e-plano.md, parte 1 de 2)
--
-- As políticas de INSERT/UPDATE/DELETE do bucket `frota-motoristas`
-- eram `auth.uid() IS NOT NULL`: QUALQUER usuário autenticado da
-- plataforma podia sobrescrever ou apagar a foto de QUALQUER
-- motorista, em qualquer caminho do bucket. Foto de rosto é dado
-- pessoal; escrita nela tem que ser da gestão do módulo ou do próprio
-- dono.
--
-- O caminho do upload é `<motorista_id>/...` nos dois pontos que
-- gravam hoje — o app (`frota-app.html`, `processarFotoMotorista`,
-- grava `<id>/perfil.jpg`) e a mesa (`frota-veiculos.html`, aba
-- Motoristas, grava `<id ou 'novo'>/<timestamp>.<ext>`). A pasta
-- raiz identifica o motorista, então dá para amarrar a política nela.
-- O caso `novo/` da mesa continua funcionando pelo ramo
-- `pode_editar('frota')`.
--
-- Esta migration é separada da parte 2 (privatização dos buckets) de
-- propósito: ela NÃO quebra nenhum cliente já em produção, então pode
-- ser aplicada de imediato. A parte 2 depende do novo js/frota-fotos.js
-- estar publicado — ver o cabeçalho da 200.
-- ═══════════════════════════════════════════════════════════

DROP POLICY IF EXISTS frota_motoristas_fotos_insert ON storage.objects;
DROP POLICY IF EXISTS frota_motoristas_fotos_update ON storage.objects;
DROP POLICY IF EXISTS frota_motoristas_fotos_delete ON storage.objects;

CREATE POLICY frota_motoristas_fotos_insert ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'frota-motoristas' AND (
      pode_editar('frota')
      OR (storage.foldername(name))[1] IN (
           SELECT fm.id::text FROM frota_motoristas fm
            WHERE fm.usuario_id = auth.uid() AND fm.ativo)
    )
  );

CREATE POLICY frota_motoristas_fotos_update ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'frota-motoristas' AND (
      pode_editar('frota')
      OR (storage.foldername(name))[1] IN (
           SELECT fm.id::text FROM frota_motoristas fm
            WHERE fm.usuario_id = auth.uid() AND fm.ativo)
    )
  );

CREATE POLICY frota_motoristas_fotos_delete ON storage.objects FOR DELETE
  USING (
    bucket_id = 'frota-motoristas' AND (
      pode_editar('frota')
      OR (storage.foldername(name))[1] IN (
           SELECT fm.id::text FROM frota_motoristas fm
            WHERE fm.usuario_id = auth.uid() AND fm.ativo)
    )
  );
