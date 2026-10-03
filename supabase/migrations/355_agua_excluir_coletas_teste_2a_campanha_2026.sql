-- ============================================================
-- SIGUC-AC · Qualidade da Água — exclui 3 coletas de TESTE
-- (2ª campanha de 2026), pedido do usuário em 03/10/2026.
--
-- COL-2026-0016 (Brasiléia), COL-2026-0018 (Cruzeiro do Sul) e
-- COL-2026-0019 (Xapuri): feitas pelo app de campo, na conta do
-- super_admin, para testar o fluxo — não são amostras reais.
--
-- Exclusão LÓGICA, nunca DELETE: mesmo efeito de agua_excluir_coleta
-- (migration 270) — excluido_em/por/justificativa + linha na
-- trilha_auditoria com a justificativa. A RPC não pode ser chamada
-- daqui (exige reautenticação recente, feita no navegador), então a
-- migration repete a gravação dela e publica o autor em
-- request.jwt.claims para auth.uid() — e portanto a trilha — apontar
-- quem pediu, em vez de ficar NULL.
--
-- Os códigos 0016/0018/0019 viram buraco na numeração e nunca são
-- reaproveitados (mesma regra dos códigos reservados, migration 325).
-- Fotos e laudos no Storage ficam onde estão: sem a coleta, nenhuma
-- tela os referencia.
-- ============================================================

DO $$
DECLARE
  v_autor uuid := '54f52900-bc41-4a98-b43d-fe502b567398';
  v_just  text := 'Coleta de teste do app de campo (2ª campanha 2026), não é amostra real — excluída a pedido do usuário.';
  v_n     int;
BEGIN
  -- Sanity: as 3 linhas existem, com o código esperado, e ainda não
  -- foram excluídas. Qualquer divergência aborta a migration inteira.
  SELECT count(*) INTO v_n
    FROM agua_coletas
   WHERE excluido_em IS NULL
     AND (id, codigo_amostra) IN (
       ('4521522d-b353-4cca-96fa-651017a82e52'::uuid, 'COL-2026-0016'),
       ('b2893131-f6c0-4075-99df-b1749bc625a2'::uuid, 'COL-2026-0018'),
       ('adb5209d-6e38-4a1f-8c6b-d0cb8931c8b8'::uuid, 'COL-2026-0019'));
  IF v_n <> 3 THEN
    RAISE EXCEPTION 'Esperava 3 coletas de teste ativas, encontrei %', v_n;
  END IF;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_autor)::text, true);
  PERFORM set_config('app.justificativa', v_just, true);

  UPDATE agua_coletas
     SET excluido_em = now(), excluido_por = v_autor, exclusao_justificativa = v_just
   WHERE id IN ('4521522d-b353-4cca-96fa-651017a82e52',
                'b2893131-f6c0-4075-99df-b1749bc625a2',
                'adb5209d-6e38-4a1f-8c6b-d0cb8931c8b8')
     AND excluido_em IS NULL;
END $$;
