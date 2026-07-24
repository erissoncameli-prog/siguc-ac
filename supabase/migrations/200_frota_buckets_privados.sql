-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Frota — buckets privados + SELECT escopado
-- (Fase 3 do plano em docs/frota-analise-e-plano.md, parte 2 de 2)
--
-- ⚠️  ORDEM DE APLICAÇÃO — LEIA ANTES DE RODAR
-- Esta é a única migration do módulo que NÃO é compatível com o
-- cliente anterior. Ela derruba a URL pública das fotos; quem exibe
-- foto passa a precisar do js/frota-fotos.js, que assina a URL na
-- hora. Se ela for aplicada enquanto a produção ainda serve o cliente
-- antigo, TODA foto do módulo Frota aparece quebrada até o deploy.
--
-- Aplicar SOMENTE depois que o código desta entrega estiver em
-- produção (merge + deploy do Vercel concluído). Na ordem certa não
-- há janela de quebra: o cliente novo funciona nos dois mundos —
-- `createSignedUrl` funciona igual em bucket público e privado, e há
-- fallback para a URL crua se a assinatura falhar.
--
-- PROBLEMA
-- Os quatro buckets do Frota eram públicos E tinham política de
-- SELECT ampla (`bucket_id = '...'` e nada mais) — o que o advisor do
-- Supabase sinaliza como `public_bucket_allows_listing`. Bucket
-- público já serve a URL do objeto sem precisar de política de
-- SELECT; a política ampla é o que habilita LISTAR o bucket inteiro.
-- Somadas, as duas coisas deixavam qualquer pessoa com a anon key
-- (que é pública) enumerar e baixar:
--   · cupons fiscais de combustível e fotos de hodômetro
--   · fotos de defeito dos veículos
--   · FOTOS DE ROSTO DOS MOTORISTAS (dado pessoal)
--   · fotos da frota
--
-- ESCOPO DE CADA SELECT (conferido no código, não presumido)
--   · abastecimentos e manutenção → só quem vê o módulo Frota. O
--     motorista NÃO revê essas fotos no app: nem a lista de
--     abastecimentos dele nem os comunicados mostram imagem de volta;
--     quem revê é a gestão, na mesa.
--   · motoristas → qualquer usuário autenticado. Mais largo de
--     propósito: a prévia da escala ("motorista da vez", com foto)
--     aparece em frota-solicitar.html para qualquer servidor que peça
--     viagem, não só para a gestão.
--   · veículos → só quem vê o módulo Frota.
--
-- O QUE NÃO MUDA
-- O formato gravado em foto_url / foto_cupom_url / fotos_urls segue
-- sendo a URL pública. Ela deixa de servir o arquivo sozinha, mas
-- continua valendo como endereço: o cliente extrai bucket + caminho
-- dela e assina na hora de exibir. Assim as linhas já existentes
-- continuam válidas, sem migração de dados.
-- ═══════════════════════════════════════════════════════════

UPDATE storage.buckets
   SET public = false
 WHERE id IN ('frota-abastecimentos', 'frota-manutencao', 'frota-motoristas', 'frota-veiculos');

DROP POLICY IF EXISTS frota_abast_fotos_read      ON storage.objects;
DROP POLICY IF EXISTS frota_manut_fotos_read      ON storage.objects;
DROP POLICY IF EXISTS frota_motoristas_fotos_read ON storage.objects;
DROP POLICY IF EXISTS frota_veiculos_fotos_read   ON storage.objects;

CREATE POLICY frota_abast_fotos_read ON storage.objects FOR SELECT
  USING (bucket_id = 'frota-abastecimentos' AND pode_ver('frota'));

CREATE POLICY frota_manut_fotos_read ON storage.objects FOR SELECT
  USING (bucket_id = 'frota-manutencao' AND pode_ver('frota'));

CREATE POLICY frota_motoristas_fotos_read ON storage.objects FOR SELECT
  USING (bucket_id = 'frota-motoristas' AND auth.uid() IS NOT NULL);

CREATE POLICY frota_veiculos_fotos_read ON storage.objects FOR SELECT
  USING (bucket_id = 'frota-veiculos' AND pode_ver('frota'));
