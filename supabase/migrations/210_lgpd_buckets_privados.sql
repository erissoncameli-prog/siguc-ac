-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · LGPD Fase 0 — buckets de Brigadas e Biomonitor privados
--
-- ⚠️  ORDEM DE APLICAÇÃO — LEIA ANTES DE RODAR
-- Mesma advertência da migration 200 (que fez isto no Frota): esta
-- migration derruba a URL pública das fotos. Quem exibe foto passa a
-- precisar do js/fotos-privadas.js, que assina a URL na hora. Se ela
-- for aplicada enquanto a produção ainda serve o cliente antigo, TODA
-- foto dos apps Brigadas e Biomonitor aparece quebrada até o deploy.
--
-- Aplicar SOMENTE depois que o código desta entrega estiver em
-- produção (merge + deploy do Vercel concluído). Na ordem certa não há
-- janela de quebra: o cliente novo funciona nos dois mundos —
-- `createSignedUrl` funciona igual em bucket público e privado, e todo
-- chamador tem fallback para a URL crua ou para as iniciais.
--
-- PROBLEMA
-- Os três buckets eram públicos E tinham política de SELECT para o
-- papel `public` com `bucket_id = '...'` e nada mais — a combinação
-- que o advisor do Supabase sinaliza como
-- `public_bucket_allows_listing`. Bucket público já serve o objeto sem
-- política de SELECT; a política ampla é o que habilita LISTAR o
-- bucket inteiro. Somadas, deixavam qualquer pessoa com a anon key
-- (que é pública, está no config.js) enumerar e baixar:
--   · `brigadistas`      → FOTO DE ROSTO de 56 brigadistas
--   · `registros-campo`  → fotos de ocorrência e de fauna, com GPS na
--                          marca d'água, e o PDF da lista de presença
--                          (nome de participante de educação ambiental)
--   · `biomonitor-fotos` → fotos de ninho, soltura e ocorrência, mais
--                          a foto de rosto do monitor
--
-- ESCOPO DE CADA SELECT (conferido no código, não presumido)
-- Os três ficam em "qualquer usuário autenticado", e não no
-- `pode_ver(modulo)` mais estreito que o Frota usa em dois buckets. O
-- motivo é que nos três casos quem lê inclui o próprio trabalhador de
-- campo pelo app (brigadista e monitor têm login próprio, com perfil
-- que não passa por `pode_ver` dos módulos de mesa) — apertar mais
-- deixaria o app sem as fotos que o próprio usuário produziu. O ganho
-- real está em sair de "qualquer um na internet" para "quem tem
-- conta", que é o que a LGPD Art. 46 cobra aqui.
--
-- O QUE NÃO MUDA
-- Escrita (INSERT/UPDATE/DELETE) segue como está: já era restrita a
-- `authenticated`. E o formato gravado em foto_url / fotos_urls /
-- foto_urls continua sendo a URL pública — ela deixa de servir o
-- arquivo sozinha, mas segue valendo como endereço, de onde o cliente
-- extrai bucket + caminho para assinar. Nenhuma migração de dados.
-- ═══════════════════════════════════════════════════════════

UPDATE storage.buckets
   SET public = false
 WHERE id IN ('brigadistas', 'registros-campo', 'biomonitor-fotos');

-- As três políticas antigas eram SELECT para `public` (inclui anon)
-- com o bucket_id como única condição — é o que permitia listar.
DROP POLICY IF EXISTS brigadistas_public_read     ON storage.objects;
DROP POLICY IF EXISTS registros_campo_public_read ON storage.objects;
DROP POLICY IF EXISTS biomonitor_fotos_read       ON storage.objects;

CREATE POLICY brigadistas_auth_read ON storage.objects FOR SELECT
  USING (bucket_id = 'brigadistas' AND auth.uid() IS NOT NULL);

CREATE POLICY registros_campo_auth_read ON storage.objects FOR SELECT
  USING (bucket_id = 'registros-campo' AND auth.uid() IS NOT NULL);

CREATE POLICY biomonitor_fotos_auth_read ON storage.objects FOR SELECT
  USING (bucket_id = 'biomonitor-fotos' AND auth.uid() IS NOT NULL);
