-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · LGPD Fase 0 — correções urgentes de segurança
--
-- Primeira migration do plano de adequação à LGPD. Antes de publicar
-- qualquer política de privacidade é preciso estancar o que já vaza:
-- política publicada enquanto CPF sai por API pública é agravante,
-- não atenuante (Art. 46 — medidas de segurança).
--
-- Dois problemas, ambos achados no levantamento das 100 tabelas:
--
--   1. VIEW v_aap_publica expunha CPF e e-mail de pesquisador para
--      qualquer pessoa com a anon key (que é pública, está no
--      config.js). Ver detalhe no bloco 1.
--
--   2. A retenção de auditoria declarada na 042 (5 anos, obrigação
--      LGPD + Lei 8.159/1991) nunca chegou a rodar: a função
--      limpar_auditoria_antiga() foi criada mas não foi agendada.
--      Retenção declarada e não executada é o achado clássico de
--      fiscalização — pior que não ter declarado, porque documenta
--      a obrigação que o órgão descumpriu.
-- ═══════════════════════════════════════════════════════════

-- ── 1. Remove a view que vazava CPF ────────────────────────────
--
-- A v_aap_publica combinava três defeitos que, somados, davam leitura
-- irrestrita de dado pessoal:
--   · owner = postgres e SEM `security_invoker` → roda com os
--     privilégios do dono e ignora o RLS de `pesquisas`;
--   · GRANT SELECT para o papel `anon`;
--   · projetava pesquisador_cpf, pesquisador_email e aap_qr_token.
-- Resultado: GET /rest/v1/v_aap_publica?select=* devolvia CPF e
-- e-mail de todas as AAPs emitidas, sem autenticação. É exatamente o
-- cenário que a 042 tentou fechar ("evita enumeração de CPF + nome
-- completo sem autenticação").
--
-- A view pode simplesmente sair: não tem nenhum consumidor no código
-- (zero ocorrências de "v_aap_publica" em pages/ e js/). A validação
-- pública do QR da AAP é feita pela RPC buscar_aap_por_token
-- (SECURITY DEFINER, com GRANT para anon), que não depende dela e
-- continua funcionando.
--
-- Sem CASCADE de propósito: se algo no banco passar a depender da
-- view no futuro, é melhor esta migration falhar do que derrubar o
-- dependente em silêncio.
DROP VIEW IF EXISTS public.v_aap_publica;

-- ── 2. Agenda a retenção de auditoria que a 042 deixou parada ──
--
-- limpar_auditoria_antiga() apaga auditoria_acessos com mais de 5
-- anos. Roda de madrugada (03:20 UTC ≈ 00:20 BRT), fora da janela dos
-- demais jobs (08h–09h20 UTC), porque é DELETE em tabela que só
-- cresce e não precisa disputar recurso com a ingestão de focos nem
-- com os alertas.
--
-- Semanal, não diário: o corte é por idade em anos, então varrer todo
-- dia não muda o resultado — só gasta. Domingo é o dia mais ocioso.
--
-- unschedule antes de agendar torna a migration idempotente (o mesmo
-- cuidado que a 178 documentou para overload de função). O bloco
-- tolera o job não existir ainda, que é o caso na primeira execução.
DO $$
BEGIN
  PERFORM cron.unschedule('lgpd-retencao-auditoria');
EXCEPTION WHEN OTHERS THEN
  NULL;  -- job ainda não existe: primeira aplicação
END;
$$;

SELECT cron.schedule(
  'lgpd-retencao-auditoria',
  '20 3 * * 0',
  $$SELECT limpar_auditoria_antiga();$$
);

-- ── 3. Fecha a função de retenção para o cliente ───────────────
--
-- limpar_auditoria_antiga() é SECURITY DEFINER e apaga registro de
-- auditoria — só deve rodar pelo pg_cron, nunca por chamada do
-- navegador. Sem este REVOKE, qualquer usuário autenticado poderia
-- chamá-la via /rest/v1/rpc e apagar a própria trilha de acesso.
-- Mesmo padrão das migrations 165 e 179.
REVOKE EXECUTE ON FUNCTION public.limpar_auditoria_antiga() FROM PUBLIC, anon, authenticated;
