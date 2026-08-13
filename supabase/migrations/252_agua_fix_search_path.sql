-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Qualidade da Água — `search_path` fixo nas funções
-- do IQA + fecha `agua_conama_violacoes` para anônimo
--
-- POR QUE ESTA MIGRATION EXISTE
-- Achado pelo advisor de segurança do Supabase logo depois de aplicar
-- a 249: as cinco funções nasceram com `search_path` mutável
-- (`function_search_path_mutable`). Sem fixar, quem chama a função
-- pode mudar o `search_path` da sessão e fazer `agua_iqa_q` resolver
-- para outro objeto de mesmo nome — a mesma classe de achado que a
-- 179 tratou no Frota, e o motivo de todas as funções do projeto
-- desde a 057 trazerem `SET search_path = public`.
-- Aqui o risco prático é baixo (quatro delas são puras e nenhuma é
-- SECURITY DEFINER), mas deixar aviso novo aberto é o começo de
-- ninguém mais olhar a lista.
--
-- `ALTER FUNCTION` em vez de recriar: a lista de parâmetros NÃO muda,
-- então não há o risco de overload que a 178 e a 224 tiveram que
-- limpar. Recriar corpo grande só para mexer numa cláusula é
-- justamente como a 181 perdeu uma correção pelo caminho.
--
-- A 249 já foi corrigida no arquivo para não repetir o erro em bases
-- novas (mesmo procedimento adotado com a 176 depois da 178).
-- ═══════════════════════════════════════════════════════════

ALTER FUNCTION agua_od_saturacao(numeric, numeric)          SET search_path = public;
ALTER FUNCTION agua_iqa_q(text, numeric)                    SET search_path = public;
ALTER FUNCTION agua_iqa_faixa(numeric)                      SET search_path = public;
ALTER FUNCTION agua_calcular_iqa(numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric)
  SET search_path = public;
ALTER FUNCTION agua_conama_violacoes(classe_enquadramento_agua,numeric,numeric,numeric,numeric,numeric,numeric)
  SET search_path = public;

-- ── Segundo achado, na conferência do `proacl` depois da 249 ──
-- A 249 fez `REVOKE ALL ... FROM PUBLIC` em `agua_conama_violacoes`
-- para deixá-la só para autenticado, e a função continuou executável
-- por `anon`. Motivo: o Supabase tem `ALTER DEFAULT PRIVILEGES`
-- concedendo EXECUTE em toda função nova do schema `public` a
-- anon/authenticated/service_role. Essa é uma concessão NOMINAL ao
-- papel `anon` — revogar de PUBLIC não a alcança. Tem que revogar do
-- papel pelo nome.
--
-- Não houve vazamento: a função é SECURITY INVOKER e a RLS de
-- `agua_limites_conama` exige `auth.uid() IS NOT NULL`, então para
-- anônimo ela já devolvia NULL. Mas função que devolve NULL em
-- silêncio para quem não podia chamá-la é pior que função que nem
-- aparece, e o comentário da 249 afirmava um fechamento que não
-- existia de fato.
--
-- Vale para QUALQUER função nova deste projeto que não deva ser
-- anônima: `REVOKE ... FROM PUBLIC` sozinho não fecha nada aqui.
-- As outras quatro funções do IQA seguem abertas a `anon` de
-- propósito (são puras e não leem tabela — ver cabeçalho da 249).
REVOKE EXECUTE ON FUNCTION agua_conama_violacoes(classe_enquadramento_agua,numeric,numeric,numeric,numeric,numeric,numeric)
  FROM anon;
