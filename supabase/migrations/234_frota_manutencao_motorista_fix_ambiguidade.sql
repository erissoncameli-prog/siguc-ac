-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Frota — corrige erro que impedia a aba Manutenções do
-- app de listar QUALQUER coisa (bug presente desde a 232)
--
-- Sintoma: aba Histórico → Manutenções sempre vazia, mesmo com OS e
-- comunicados existindo para o motorista. Não era escopo de veículo
-- (foi o que a 233 tentou consertar, com diagnóstico errado): a RPC
-- simplesmente NUNCA chegava a retornar linha nenhuma, porque
-- explodia em tempo de execução com
--
--   42702: column reference "veiculo_id" is ambiguous
--   DETAIL: It could refer to either a PL/pgSQL variable or a table column.
--
-- Causa: `RETURNS TABLE (... veiculo_id uuid ...)` cria uma VARIÁVEL
-- plpgsql chamada `veiculo_id`. Dentro da CTE, `SELECT veiculo_id FROM
-- frota_veiculo_motoristas` está sem qualificação de tabela — o
-- planejador não sabe se é a coluna ou a variável e, com o
-- `plpgsql.variable_conflict` padrão (`error`), aborta. Todas as
-- referências da consulta principal já eram qualificadas (os.x, v.x,
-- c.x); só as da CTE não eram, e bastou isso.
--
-- Por que passou despercebido: `carregarManutencoesMotorista()` no app
-- captura qualquer erro e cai no cache do IndexedDB (offline-first).
-- Cache vazio = lista vazia, sem mensagem de erro na tela. O commit
-- que acompanha esta migration passa a registrar o erro no console
-- para que a próxima falha de RPC não fique invisível.
--
-- Correção: qualificar TODAS as colunas da CTE com alias de tabela e
-- nomear a coluna de saída da CTE como `v_id`, que não colide com
-- nenhum parâmetro OUT. Mantém o escopo de 4 fontes introduzido pela
-- 233 (padrão, liberado, viagens dirigidas, comunicados reportados).
--
-- Corrige junto a ordenação: a 232 ordenava por `data_conclusao DESC
-- NULLS LAST` antes de `data_referencia`, o que jogava toda OS ainda
-- em aberto (conclusão NULL) para o fim da lista. O correto é ordenar
-- pelo que aconteceu mais recentemente — `data_referencia DESC`.
--
-- Lição (mesma família dos tropeços 178/224 deste projeto): em função
-- plpgsql com RETURNS TABLE, todo nome de coluna igual a um parâmetro
-- OUT precisa de alias de tabela, senão o erro só aparece em runtime.
-- ═══════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION frota_manutencoes_motorista()
RETURNS TABLE (
  item_id        uuid,
  origem         text,
  veiculo_id     uuid,
  placa          text,
  modelo         text,
  tipo           text,
  status         text,
  descricao      text,
  codigo         text,
  data_referencia timestamptz,
  data_conclusao date,
  os_id          uuid,
  comunicado_id  uuid
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_motorista_id uuid;
BEGIN
  SELECT fm.id INTO v_motorista_id
    FROM frota_motoristas fm WHERE fm.usuario_id = auth.uid() AND fm.ativo AND fm.status = 'ativo';
  IF v_motorista_id IS NULL THEN
    RAISE EXCEPTION 'Usuário não está cadastrado como motorista ativo';
  END IF;

  RETURN QUERY
  WITH veiculos_motorista AS (
    SELECT fv.id AS v_id
      FROM frota_veiculos fv WHERE fv.motorista_padrao_id = v_motorista_id
    UNION
    SELECT fvm.veiculo_id AS v_id
      FROM frota_veiculo_motoristas fvm WHERE fvm.motorista_id = v_motorista_id
    UNION
    SELECT fvi.veiculo_id AS v_id
      FROM frota_viagens fvi WHERE fvi.motorista_id = v_motorista_id AND fvi.veiculo_id IS NOT NULL
    UNION
    SELECT fcm.veiculo_id AS v_id
      FROM frota_comunicados_manutencao fcm WHERE fcm.motorista_id = v_motorista_id
  )
  SELECT
    os.id, 'os'::text, os.veiculo_id, v.placa, v.modelo,
    os.tipo::text, os.status::text, os.descricao, os.codigo,
    os.data_abertura::timestamptz, os.data_conclusao, os.id, c.id
  FROM frota_ordens_servico os
  JOIN frota_veiculos v ON v.id = os.veiculo_id
  LEFT JOIN frota_comunicados_manutencao c ON c.os_id = os.id
  WHERE os.veiculo_id IN (SELECT vm.v_id FROM veiculos_motorista vm)

  UNION ALL

  SELECT
    c.id, 'comunicado'::text, c.veiculo_id, v.placa, v.modelo,
    'comunicado'::text,
    (CASE WHEN c.status = 'descartado' THEN 'descartada' ELSE 'aguardando_analise' END)::text,
    c.descricao, NULL::text,
    c.criado_em, NULL::date, NULL::uuid, c.id
  FROM frota_comunicados_manutencao c
  JOIN frota_veiculos v ON v.id = c.veiculo_id
  WHERE c.veiculo_id IN (SELECT vm.v_id FROM veiculos_motorista vm)
    AND c.os_id IS NULL

  ORDER BY 10 DESC;
END;
$$;

-- frota_manutencao_itens (232) não tem o mesmo problema: seus
-- parâmetros OUT (descricao, quantidade, marca) não aparecem sem
-- qualificação em nenhum ponto — todas as referências usam alias `i`.
