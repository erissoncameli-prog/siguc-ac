-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Qualidade da Água — Base Legal no painel público
--
-- Card "Base Legal e Conformidade" (pages/agua-relatorios.html e
-- pages/agua-publico.html, js/agua-painel.js) — pedido do usuário:
-- mostrar aos órgãos de fiscalização qual norma respalda a
-- classificação exibida. A Resolução CONAMA nº 357/2005 (Art. 14/15,
-- limites da Classe 2) já é texto fixo no cliente (é a mesma fonte
-- que `agua_limites_conama.fonte` já registra desde a migration 249).
-- Atos ADICIONAIS (portaria estadual etc.) são editáveis em
-- Configurações → Qualidade da Água, sem migration nem deploy —
-- gravados em `config_sistema.dados.agua.base_legal` (array de
-- {titulo, orgao, data, link, ementa}), mesmo padrão de
-- `responsaveis_tecnicos`/`encarregado`.
--
-- `agua_publico_cabecalho()` (migration 297) já é o portão de leitura
-- de `config_sistema` para `anon` — só amplia o jsonb devolvido com a
-- chave `baseLegal`, sem tocar em SECURITY DEFINER/grants (já
-- corretos). CREATE OR REPLACE é seguro aqui porque a assinatura
-- (zero parâmetros) não muda — lição da 178/173/224 é só para quando
-- a LISTA DE PARÂMETROS muda.
CREATE OR REPLACE FUNCTION agua_publico_cabecalho()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'secretaria',   COALESCE(dados->'secretaria'->>'nome',   'Secretaria de Estado do Meio Ambiente do Acre'),
    'siglaSecr',    COALESCE(dados->'secretaria'->>'sigla',  'SEMA-AC'),
    'diretoria',    COALESCE(dados->'diretoria'->>'nome',    'Diretoria de Meio Ambiente'),
    'siglaDiret',   COALESCE(dados->'diretoria'->>'sigla',   'DIMA'),
    'departamento', COALESCE(dados->'departamento'->>'nome', 'Departamento de Unidades de Conservação'),
    'logoGoverno',  dados->'logos'->>'governo_url',
    'logoSecr',     dados->'logos'->>'secretaria_url',
    'baseLegal',    COALESCE(dados->'agua'->'base_legal', '[]'::jsonb)
  )
  FROM config_sistema WHERE id = 1;
$$;

COMMENT ON FUNCTION agua_publico_cabecalho() IS
  'Timbre institucional + base legal adicional (config_sistema.dados.agua.base_legal, editável em Configurações) para o painel público da Qualidade da Água. A Resolução CONAMA 357/2005 é texto fixo no cliente (js/agua-painel.js), não vem daqui.';
