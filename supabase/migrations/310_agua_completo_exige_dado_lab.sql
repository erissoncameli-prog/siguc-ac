-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Qualidade da Água — laudo sem dado nenhum não pode virar "completo"
--
-- ACHADO REAL: duas coletas lançadas via app (app de campo) foram
-- "lançadas" pela mesa (pages/agua-laudos.html) com o PDF do laudo
-- anexado e status forçado para 'completo', mas SEM NENHUM dos 16
-- campos de laboratório preenchido (DBO, nitrogênio, fósforo, sólidos,
-- coliformes, etc. — todos NULL). `salvarLaudo()` só exigia o
-- laboratório selecionado; nunca checou se algum resultado foi de
-- fato digitado ou aceito do parser. O laudo "sumia" silenciosamente:
-- marcado como concluído, sem dado, e sem cair em nenhuma tela de
-- revisão (pages/agua-conferencia.html só lista status='quarentena').
--
-- A CORREÇÃO: banco é a garantia dura (mesmo espírito da migration
-- 239 — "vale para qualquer rota de ingestão, atual ou futura, sem
-- depender de redeploy"). Uma coleta só pode ficar `completo` se pelo
-- menos UM dos 16 campos de laboratório estiver preenchido. Não exige
-- TODOS — laboratórios diferentes reportam painéis diferentes (o
-- QUILAB, por exemplo, não reporta coliformes_termotolerantes nem
-- condutividade_especifica) — só barra o caso degenerado de "nenhum
-- resultado nenhum".
--
-- NOT VALID: 25 linhas 'completo' já existem em produção sem nenhum
-- campo de laboratório (medido antes desta migration) — provavelmente
-- coletas cujo interesse era só os parâmetros de campo, lançadas
-- antes desta regra existir. NOT VALID grandfathera essas 25 linhas
-- (a constraint não valida o que já está no banco) e passa a valer
-- só para INSERT/UPDATE novos daqui em diante — mesmo padrão de
-- staging usado no projeto para não quebrar dado histórico.
--
-- O CLIENTE (pages/agua-laudos.html) passa a rotear esse caso para
-- QUARENTENA em vez de tentar 'completo' e falhar com erro de
-- constraint — a mesma fila de revisão que já existe em
-- agua-conferencia.html, reaproveitada em vez de criar tela nova.
-- Esta migration é só a garantia de banco; o roteamento fica no JS.
-- ═══════════════════════════════════════════════════════════

ALTER TABLE agua_coletas
  ADD CONSTRAINT ck_agua_completo_exige_dado_lab CHECK (
    status <> 'completo' OR (
      dbo IS NOT NULL OR nitrogenio_total IS NOT NULL OR nitrogenio_amoniacal IS NOT NULL OR
      nitratos IS NOT NULL OR fosforo_total IS NOT NULL OR ortofosfato_dissolvido IS NOT NULL OR
      solidos_dissolvidos_totais IS NOT NULL OR solidos_suspensao_totais IS NOT NULL OR
      coliformes_termotolerantes IS NOT NULL OR coliformes_totais IS NOT NULL OR
      escherichia_coli IS NOT NULL OR alcalinidade_total IS NOT NULL OR
      carbono_organico_total IS NOT NULL OR cloreto IS NOT NULL OR
      condutividade_especifica IS NOT NULL OR descarga_liquida IS NOT NULL
    )
  ) NOT VALID;

COMMENT ON CONSTRAINT ck_agua_completo_exige_dado_lab ON agua_coletas IS
  'Uma coleta só pode ser marcada completo com pelo menos 1 dos 16 campos de laboratório preenchido — impede laudo "vazio" ser dado como concluído. NOT VALID: 25 linhas históricas grandfathered, regra vale só para escrita nova.';
