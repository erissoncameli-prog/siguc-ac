-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · LGPD — link clicável para a Política de Privacidade
-- completa nos avisos por app
--
-- Os 4 avisos por app (Brigadas/Biomonitor/Frota/Pesquisa, migration
-- 223) terminam com "A Política de Privacidade completa está em
-- **siguc-ac.vercel.app/pages/privacidade.html**" — texto em negrito,
-- não clicável. js/lgpd.js (lgpdMarkdown, compartilhado pelo gate de
-- mesa, pelo gate de campo e pelo gate do pesquisador) ganhou suporte
-- a `[texto](url)` nesta entrega; esta migration só troca o trecho
-- final pelo link equivalente, mantendo o resto do texto idêntico —
-- por isso usa replace() sobre o conteúdo vigente em vez de reescrever
-- o documento inteiro à mão (risco de erro de transcrição).
--
-- Editar conteudo_md sempre cria versão nova (hash muda) e volta a
-- pedir ciência — mesmo padrão desde a 212. Cada documento tinha só
-- 1 aceite registrado até aqui (avisos publicados há poucos dias).
-- ═══════════════════════════════════════════════════════════

INSERT INTO lgpd_documento_versoes (documento_id, versao, vigente_desde, resumo_mudancas, conteudo_md)
SELECT
  v.documento_id,
  '1.1',
  CURRENT_DATE,
  'Corrige o link da Política de Privacidade completa: antes era só o endereço em negrito, agora é um link clicável.',
  replace(
    v.conteudo_md,
    '**siguc-ac.vercel.app/pages/privacidade.html**',
    '[siguc-ac.vercel.app/pages/privacidade.html](/pages/privacidade.html)'
  )
FROM vw_lgpd_documentos_vigentes v
WHERE v.tipo IN ('aviso_campo', 'aviso_pesquisa')
  AND v.app IN ('brigadas', 'biomonitor', 'frota', 'pesquisa');
