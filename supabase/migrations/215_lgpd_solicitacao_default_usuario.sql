-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · LGPD — usuario_id default auth.uid() em
-- lgpd_solicitacoes_titular (migration 214)
--
-- Sem isso, todo cliente que abre o canal do titular (mesa, os 3 apps
-- de campo, futuramente o portal do pesquisador) precisaria primeiro
-- chamar db.auth.getUser() só para descobrir o próprio id antes de
-- enviar o formulário — repetido em cada superfície. Com o DEFAULT, o
-- INSERT manda só {tipo, descricao} e o Postgres preenche usuario_id
-- a partir do JWT da própria sessão.
--
-- Não relaxa a segurança: a policy `lgpd_solic_insert` (WITH CHECK
-- usuario_id = auth.uid()) continua valendo sobre o valor já
-- preenchido, então um cliente que tentasse forçar outro usuario_id
-- ainda seria rejeitado — o default só cobre o caminho comum.
-- ═══════════════════════════════════════════════════════════

ALTER TABLE lgpd_solicitacoes_titular ALTER COLUMN usuario_id SET DEFAULT auth.uid();
