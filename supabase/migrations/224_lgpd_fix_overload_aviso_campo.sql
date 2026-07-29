-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · LGPD — corrige overload duplicado que a 223 deixou
--
-- Mesmo erro que a 178 já documentou para o Frota: CREATE OR REPLACE
-- com uma lista de parâmetros DIFERENTE da função existente cria uma
-- função nova em vez de substituir. A 223 tentou trocar
-- lgpd_aviso_campo() por lgpd_aviso_campo(p_app text DEFAULT NULL) —
-- resultado: as duas passaram a existir, e uma chamada sem argumento
-- ficou ambígua ("function lgpd_aviso_campo() is not unique"),
-- confirmado ao testar antes de tocar no cliente.
--
-- Correção: DROP explícito da assinatura antiga, então recria só a
-- nova. Mesmo cuidado que a 173 já tomava.
-- ═══════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS lgpd_aviso_campo();

CREATE OR REPLACE FUNCTION lgpd_aviso_campo(p_app text DEFAULT NULL)
RETURNS TABLE (
  versao_id uuid, titulo text, versao text,
  conteudo_md text, hash_sha256 text, ja_ciente boolean
)
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public
AS $$
  SELECT v.versao_id, v.titulo, v.versao, v.conteudo_md, v.hash_sha256,
         EXISTS (
           SELECT 1 FROM lgpd_aceites a
            WHERE a.versao_id = v.versao_id AND a.usuario_id = auth.uid()
         ) AS ja_ciente
    FROM vw_lgpd_documentos_vigentes v
   WHERE v.tipo = 'aviso_campo'
     AND v.app = p_app
     AND auth.uid() IS NOT NULL;
$$;

REVOKE EXECUTE ON FUNCTION lgpd_aviso_campo(text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION lgpd_aviso_campo(text) TO authenticated;
