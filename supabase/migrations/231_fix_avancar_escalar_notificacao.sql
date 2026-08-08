-- 231_fix_avancar_escalar_notificacao.sql
-- As funções avancar_notificacao/escalar_notificacao (definidas na
-- migration 009_painel_gestor.sql) nunca chegaram a ser criadas em
-- produção — tabela notificacoes, notificacoes_historico e o enum
-- status_notificacao existem, mas as funções não (verificado via
-- pg_proc). Efeito visível: "Minhas tarefas" (painel-gestor.html,
-- frota-tarefas.html, frota-app.html) quebra ao clicar em
-- Ver/Concluir com "Could not find the function
-- public.avancar_notificacao(...) in the schema cache". Esta
-- migration só recria as duas funções, idênticas ao arquivo 009,
-- sem alterar tabelas/policies (já existentes e corretas).

CREATE OR REPLACE FUNCTION avancar_notificacao(
  p_notificacao_id  uuid,
  p_novo_status     status_notificacao,
  p_observacao      text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_status_anterior status_notificacao;
BEGIN
  SELECT status INTO v_status_anterior
  FROM notificacoes WHERE id = p_notificacao_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Notificação não encontrada: %', p_notificacao_id;
  END IF;

  UPDATE notificacoes
  SET status       = p_novo_status,
      resolvido_em = CASE WHEN p_novo_status = 'resolvida' THEN now() ELSE resolvido_em END
  WHERE id = p_notificacao_id;

  INSERT INTO notificacoes_historico (notificacao_id, status_anterior, status_novo, usuario_id, observacao)
  VALUES (p_notificacao_id, v_status_anterior, p_novo_status, auth.uid(), p_observacao);
END;
$$;

CREATE OR REPLACE FUNCTION escalar_notificacao(
  p_notificacao_id  uuid,
  p_usuario_destino uuid,
  p_observacao      text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_status_anterior status_notificacao;
BEGIN
  SELECT status INTO v_status_anterior
  FROM notificacoes WHERE id = p_notificacao_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Notificação não encontrada: %', p_notificacao_id;
  END IF;

  UPDATE notificacoes
  SET status        = 'encaminhada',
      escalado_para = p_usuario_destino,
      escalado_em   = now()
  WHERE id = p_notificacao_id;

  INSERT INTO notificacoes_historico (notificacao_id, status_anterior, status_novo, usuario_id, observacao)
  VALUES (p_notificacao_id, v_status_anterior, 'encaminhada', auth.uid(), p_observacao);
END;
$$;

-- Achados do advisor de segurança após aplicar (mesmo padrão da 165/179):
-- search_path mutável em função SECURITY DEFINER, e execução liberada
-- para o role anon (só authenticated deve chamar — usuário sempre logado).
ALTER FUNCTION avancar_notificacao(uuid, status_notificacao, text) SET search_path = public;
ALTER FUNCTION escalar_notificacao(uuid, uuid, text) SET search_path = public;

REVOKE EXECUTE ON FUNCTION avancar_notificacao(uuid, status_notificacao, text) FROM anon;
REVOKE EXECUTE ON FUNCTION escalar_notificacao(uuid, uuid, text) FROM anon;
