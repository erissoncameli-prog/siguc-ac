-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Qualidade da Água — aplica o laboratório cadastrado a
-- todas as coletas sem laboratório
--
-- ACHADO: só existe UM laboratório cadastrado em `agua_laboratorios`
-- ("ACQUALIMP PRODUTOS QUIMICOS LTDA - QUILAB") — é o mesmo que o
-- gabarito de leitura de laudo (migrations 304/305) já assume como o
-- laboratório da série. 449 das 452 coletas nunca tiveram
-- `laboratorio_id` preenchido: a importação da série histórica
-- (migration 253) não trouxe laboratório nenhum, só os resultados; só
-- 3 coletas lançadas depois, pela mesa, já têm o vínculo. Como existe
-- um único laboratório no sistema, aplicamos esse mesmo laboratório a
-- toda coleta que ainda está sem — pedido explícito do usuário.
--
-- Não mexe nas 3 coletas que já têm laboratorio_id (já é o mesmo, e
-- WHERE laboratorio_id IS NULL não as toca de qualquer forma).
--
-- ACHADO 2 (achado ao aplicar): ~25 coletas 'completo' grandfathered
-- pela migration 310 (nenhum dos 16 campos de laboratório preenchido —
-- ex.: só parâmetros de campo) violam
-- ck_agua_completo_exige_dado_lab ao serem regravadas, mesmo só
-- mudando laboratorio_id — CHECK constraint valida a linha inteira em
-- todo UPDATE, não só a coluna alterada; NOT VALID só isenta a
-- validação no momento da criação da constraint, não em escritas
-- futuras. Não faz sentido vincular laboratório a uma coleta sem
-- nenhum resultado de laboratório mesmo (não foi analisada por
-- nenhum) — excluídas do UPDATE pela mesma condição da constraint.
-- ═══════════════════════════════════════════════════════════

SELECT set_config(
  'app.justificativa',
  'Aplica o único laboratório cadastrado no sistema (ACQUALIMP/QUILAB) às coletas que nunca tiveram laboratorio_id preenchido — a importação da série histórica não trouxe esse vínculo. Pedido explícito do usuário.',
  true
);

UPDATE agua_coletas
SET laboratorio_id = (SELECT id FROM agua_laboratorios ORDER BY criado_em LIMIT 1)
WHERE laboratorio_id IS NULL
  AND excluido_em IS NULL
  AND (SELECT count(*) FROM agua_laboratorios) = 1
  AND (
    dbo IS NOT NULL OR nitrogenio_total IS NOT NULL OR nitrogenio_amoniacal IS NOT NULL OR
    nitratos IS NOT NULL OR fosforo_total IS NOT NULL OR ortofosfato_dissolvido IS NOT NULL OR
    solidos_dissolvidos_totais IS NOT NULL OR solidos_suspensao_totais IS NOT NULL OR
    coliformes_termotolerantes IS NOT NULL OR coliformes_totais IS NOT NULL OR
    escherichia_coli IS NOT NULL OR alcalinidade_total IS NOT NULL OR
    carbono_organico_total IS NOT NULL OR cloreto IS NOT NULL OR
    condutividade_especifica IS NOT NULL OR descarga_liquida IS NOT NULL
  );
