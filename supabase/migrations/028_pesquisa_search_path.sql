-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Migration 028 — search_path fixo nas funções do fluxo
-- Corrige o aviso function_search_path_mutable do linter de segurança:
-- funções SECURITY DEFINER devem fixar search_path para evitar
-- sequestro de resolução de nomes. Inclui 'extensions' por causa do
-- pgcrypto (gen_random_bytes).
-- ═══════════════════════════════════════════════════════════

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'anexar_documento_publico','avancar_etapa_pesquisa','bloquear_avanco_inadimplente',
        'buscar_pesquisa_por_token','despachar_analise_tecnica','despachar_autorizacao_secretario',
        'despachar_avaliar_relatorio','despachar_emissao_aap','despachar_encerramento',
        'despachar_entrega_aap','despachar_fase_simples','despachar_homologar_relatorio',
        'despachar_parecer_dima','despachar_triagem','marcar_inadimplencia','regularizar_pesquisador',
        'solicitar_complementacao','submeter_pesquisa_publica','verificar_prazos_pesquisa',
        'minha_posicao','verificar_aap_publica','notificar_etapa_pesquisa'
      )
  LOOP
    EXECUTE format('ALTER FUNCTION public.%I(%s) SET search_path = public, extensions, pg_temp',
                   r.proname, r.args);
  END LOOP;
END $$;
