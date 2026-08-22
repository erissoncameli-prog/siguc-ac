-- 303_derhqa_submodulos_bacias_ar.sql
--
-- DERHQA — Departamento de Recursos Hídricos e Qualidade Ambiental
-- passa a ser o GUARDA-CHUVA na sidebar, e "Qualidade da Água" vira um
-- SUBGRUPO dele, ao lado de "Bacias Hidrográficas" e (mais à frente)
-- "Qualidade do Ar". Ver docs/recursos-hidricos/plano.md para o desenho
-- completo e as fases.
--
-- Esta migration cria só o CATÁLOGO dos dois módulos novos. Nenhuma
-- tabela de dado, nenhuma página, nenhuma RLS — as duas nascem
-- `ativo = false`, exatamente como 'agua' nasceu na migration 248:
-- enquanto não há tela, só super_admin alcança (nivel_efetivo_calc
-- devolve 'sem_acesso' quando o módulo não está ativo). Ativar é UPDATE
-- de uma linha, na entrega que criar a primeira página de cada um.
--
-- ⚠ O QUE ESTA MIGRATION DELIBERADAMENTE **NÃO** FAZ:
-- não mexe em `modulos.grupo` da chave 'agua' (segue 'Gestão'). Parece
-- natural mudar para um grupo "Recursos Hídricos" junto com o rename da
-- sidebar, mas `modulos.grupo` NÃO é rótulo: é a chave de fallback de
-- permissão (`nivel_catalogo_perfil` → `grupo_permissoes_padrao`), e
-- 'agua' não tem NENHUMA linha em `perfil_permissoes_padrao` — ou seja,
-- todo o acesso dela hoje vem do padrão do grupo 'Gestão'. Trocar o
-- grupo tiraria o acesso de todo mundo em silêncio. O rename é só de
-- rótulo, e rótulo de menu vive em js/layout.js.
--
-- Pelo mesmo motivo os dois módulos novos nascem em 'Gestão': herdam o
-- mesmo padrão de perfil que 'agua' já usa, sem inventar uma faixa de
-- acesso nova para uma tela que ainda não existe.
--
-- `exige_lotacao = false` nos dois (regra do plano de organograma —
-- módulo novo nunca nasce mudando acesso de ninguém; ligar depende do
-- relatório vw_impacto_lotacao rodado antes da virada). Note que 'agua'
-- está em `true` desde a 281: quando as páginas de Bacias/Ar nascerem,
-- decidir explicitamente se elas também se restringem ao DERHQA —
-- painel de bacias tende a ser mais aberto que laudo de IQA.
--
-- `modulo_unidades` → DERHQA em ambos: é o que faz
-- `modulo_departamento('bacias')`/`('ar')` devolver o departamento certo
-- no cabeçalho dos relatórios (migration 299), de graça, desde o
-- primeiro PDF gerado.

INSERT INTO modulos (chave, nome, grupo, ordem, rota, icone, ativo, exige_lotacao)
VALUES
  ('bacias', 'Bacias Hidrográficas', 'Gestão', 36, NULL, 'mapa',           false, false),
  ('ar',     'Qualidade do Ar',      'Gestão', 37, NULL, 'monitoramento',  false, false)
ON CONFLICT (chave) DO NOTHING;

INSERT INTO modulo_unidades (modulo_id, unidade_org_id, nivel_concedido, observacoes)
SELECT m.id, u.id, 'editar',
       'DERHQA é o dono do módulo (mesmo dono da chave agua, migration 265).'
  FROM modulos m
  CROSS JOIN unidades_organizacionais u
 WHERE m.chave IN ('bacias', 'ar')
   AND u.sigla = 'DERHQA'
   AND NOT EXISTS (
     SELECT 1 FROM modulo_unidades mu
      WHERE mu.modulo_id = m.id AND mu.unidade_org_id = u.id
   );

-- Sanity: falha alto se o DERHQA não existir no organograma (em vez de
-- deixar os dois módulos órfãos e o cabeçalho do relatório cair no
-- departamento genérico de Configurações sem ninguém perceber).
DO $$
DECLARE v_n int;
BEGIN
  SELECT count(*) INTO v_n
    FROM modulo_unidades mu
    JOIN modulos m ON m.id = mu.modulo_id
   WHERE m.chave IN ('bacias', 'ar');
  IF v_n <> 2 THEN
    RAISE EXCEPTION 'Esperava 2 vínculos modulo_unidades para bacias/ar, achei %', v_n;
  END IF;
END $$;
