-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Qualidade da Água — bucket privado do laudo (PDF)
-- Fase 2 do plano em docs/qualidade-agua/plano.md, item 4.
--
-- PRIVADO DESDE O NASCIMENTO
-- Os buckets mais antigos do projeto (Frota, Brigadas, Biomonitor)
-- nasceram PÚBLICOS e só viraram privados numa migration posterior
-- (200/210), depois de um achado de segurança — regra do projeto desde
-- então (ver cabeçalho da 200): "TODO bucket com imagem de pessoa ou
-- dado pessoal é PRIVADO". `agua-laudos` não carrega dado pessoal, mas
-- segue o mesmo padrão por default — nasce privado, sem a janela em
-- que ficaria público à toa. Leitura por signed URL, com
-- `js/fotos-privadas.js` (helper único do projeto — não escrever
-- assinador novo, mesma lição de `js/frota-consumo.js`).
--
-- MIME TYPES — o precedente mais próximo é `pesquisa-documentos`, que
-- já mistura PDF com imagem (laudo pode chegar escaneado como foto).
--
-- QUEM ESCREVE
-- Ao contrário dos buckets de campo do Frota/Brigadas/Biomonitor (onde
-- quem fotografa é o próprio agente de campo), o laudo é lançado
-- SEMPRE pela mesa (Fase 2 — não há app de campo do módulo `agua`
-- ainda, isso é Fase 3). Por isso INSERT/UPDATE/DELETE exigem
-- pode_editar('agua'), sem a policy dupla que o Frota precisa para
-- deixar o motorista subir sua própria foto.
-- ═══════════════════════════════════════════════════════════

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('agua-laudos', 'agua-laudos', false, 10485760,
  ARRAY['application/pdf','image/jpeg','image/jpg','image/png','image/webp','image/heic','image/heif'])
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS agua_laudos_read ON storage.objects;
CREATE POLICY agua_laudos_read ON storage.objects
  FOR SELECT USING (bucket_id = 'agua-laudos' AND pode_ver('agua'));

DROP POLICY IF EXISTS agua_laudos_insert ON storage.objects;
CREATE POLICY agua_laudos_insert ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'agua-laudos' AND pode_editar('agua'));

DROP POLICY IF EXISTS agua_laudos_update ON storage.objects;
CREATE POLICY agua_laudos_update ON storage.objects
  FOR UPDATE USING (bucket_id = 'agua-laudos' AND pode_editar('agua'));

DROP POLICY IF EXISTS agua_laudos_delete ON storage.objects;
CREATE POLICY agua_laudos_delete ON storage.objects
  FOR DELETE USING (bucket_id = 'agua-laudos' AND pode_editar('agua'));
