-- 324_vw_praias_observacoes.sql
--
-- `praias_monitoramento.observacoes` existe na tabela desde sempre, é editável
-- no modal de praia (admin-biomonitor.html) e GRAVADA a cada salvamento — mas
-- `vw_praias_biomonitor`, que alimenta a tela, nunca expôs a coluna. Efeito
-- idêntico ao bug do modal de monitor corrigido antes: o campo abre vazio mesmo
-- com texto gravado e salvar sobrescreve o que havia com null.
--
-- Achado por varredura de todas as telas de mesa atrás do mesmo padrão
-- ("carrega parcial, grava inteiro").
--
-- Duas cautelas do projeto aplicadas aqui:
--  1. `CREATE OR REPLACE VIEW` não aceita reordenar nem inserir coluna no meio
--     (42P16) — a nova entra SEMPRE ao final da lista de saída.
--  2. Esta view TEM DRIFT conhecido em produção (ver migration 321): colunas
--     que nenhuma migration do repositório criou. Por isso a definição NÃO é
--     reescrita a partir do arquivo local — ela é derivada do
--     `pg_get_viewdef()` REAL do banco, com a coluna nova anexada. Reescrever
--     do arquivo apagaria o drift em silêncio, como já aconteceu uma vez.
DO $$
DECLARE
  v_def  text;
  v_novo text;
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'vw_praias_biomonitor'
       AND column_name = 'observacoes'
  ) THEN
    RAISE NOTICE 'vw_praias_biomonitor já expõe observacoes — nada a fazer';
    RETURN;
  END IF;

  v_def := pg_get_viewdef('public.vw_praias_biomonitor'::regclass, true);

  -- Âncora: a última coluna do SELECT é a que antecede o FROM da tabela base.
  IF position(E'\n   FROM praias_monitoramento p' IN v_def) = 0 THEN
    RAISE EXCEPTION 'estrutura inesperada em vw_praias_biomonitor — revisar à mão';
  END IF;

  v_novo := replace(
    v_def,
    E'\n   FROM praias_monitoramento p',
    E',\n    p.observacoes\n   FROM praias_monitoramento p'
  );

  EXECUTE 'CREATE OR REPLACE VIEW public.vw_praias_biomonitor '
       || 'WITH (security_invoker = true) AS ' || v_novo;
END $$;
