-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Departamento correto no cabeçalho dos relatórios,
-- por MÓDULO — não mais um campo genérico único
--
-- ACHADO: `config_sistema.dados.departamento` é UM campo global, lido
-- por `getCabecalhoRelatorio()` (js/config-sistema.js) e usado por
-- TODO relatório do sistema — hoje fixado em "Departamento de
-- Unidades de Conservação" (DEUC). O relatório da Qualidade da Água
-- mostrava DEUC porque nunca existiu um jeito de o relatório saber
-- QUAL departamento é dono do módulo que está gerando o documento.
--
-- A resposta certa já existe: `modulo_unidades` (migration 265, frente
-- 2 de docs/acesso-por-organograma.md) já registra o dono de cada
-- módulo (`agua` → DERHQA, `biomonitor` → DEBIO, `frota` → DITLOG...).
-- Essa migration só ensina o cabeçalho dos relatórios a CONSULTAR essa
-- tabela em vez do campo genérico — pela lógica do organograma, não
-- por um valor hardcoded por página.
--
-- Achado colateral: 4 telas do Biomonitor (js/biomonitor-analise.js,
-- js/biomonitor-analise-comparativa.js, js/biomonitor-relatorio-ninho.js,
-- pages/relatorios-biomonitor.html) já faziam
-- `cab.departamento = 'Departamento de Biodiversidade'` na mão logo
-- depois de chamar getCabecalhoRelatorio() — 4 cópias do mesmo
-- workaround para o MESMO bug que a Água tinha, só que sem cópia
-- nenhuma (por isso a Água aparecia errada e o Biomonitor não). Esta
-- migration + o parâmetro novo em getCabecalhoRelatorio() substituem
-- as 4 cópias pela fonte única.

-- ── 1. Corrige o nome do DERHQA (a sigla foi cadastrada, o nome por
-- extenso nunca foi — migration 004_org_ajustes.sql inseriu `nome =
-- sigla` como placeholder para os 4 departamentos novos da DIMA) ────
UPDATE unidades_organizacionais
SET nome = 'Departamento de Recursos Hídricos e Qualidade Ambiental'
WHERE sigla = 'DERHQA' AND nome = 'DERHQA';

-- ── 2. Departamento dono de um módulo, pela tabela já existente ────
-- Prefere uma unidade tipo 'departamento' se o módulo tiver mais de um
-- dono cadastrado (modulo_unidades não tem UNIQUE(modulo_id) sozinho);
-- sem isso, a mais antiga. SECURITY DEFINER pelo mesmo motivo de
-- alcance_por_lotacao()/unidade_ancestrais() (migration 265): quem
-- chama pode ser `anon` por dentro de agua_publico_cabecalho() —
-- REVOKE de anon aqui é só a segunda camada, igual à de
-- agua_conama_violacoes.
CREATE OR REPLACE FUNCTION modulo_departamento(p_modulo_chave text)
RETURNS TABLE (nome text, sigla text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT o.nome, o.sigla
  FROM modulo_unidades mu
  JOIN modulos m ON m.id = mu.modulo_id
  JOIN unidades_organizacionais o ON o.id = mu.unidade_org_id
  WHERE m.chave = p_modulo_chave AND o.ativo = true
  ORDER BY (o.tipo = 'departamento') DESC, mu.criado_em ASC
  LIMIT 1;
$$;

COMMENT ON FUNCTION modulo_departamento(text) IS
  'Departamento dono de um módulo (modulo_unidades), para o cabeçalho dos relatórios em PDF mostrar o setor certo automaticamente, sem valor fixo por página. Sem linha = módulo sem dono cadastrado (getCabecalhoRelatorio() cai no campo genérico de Configurações).';

-- ⚠️ `REVOKE ALL ... FROM PUBLIC` sozinho NÃO fecha `anon` aqui — achado
-- ao testar como anon de verdade (`SET LOCAL ROLE anon`): a função
-- respondia mesmo sem GRANT nenhum pra ela, porque o `ALTER DEFAULT
-- PRIVILEGES` do projeto concede EXECUTE a `anon` POR NOME em toda
-- função nova do schema public (mesma lição da 165/249/252b/297 — REVOKE
-- de PUBLIC não revoga um GRANT direto a um papel específico). Corrigido
-- com REVOKE explícito do papel, testado de novo até dar "permission
-- denied" — só depois disso GRANT para authenticated.
REVOKE ALL ON FUNCTION modulo_departamento(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION modulo_departamento(text) FROM anon;
GRANT EXECUTE ON FUNCTION modulo_departamento(text) TO authenticated;

-- ── 3. Painel público da Água também passa a mostrar o departamento
-- certo (DERHQA), não mais o genérico de config_sistema ──────────
CREATE OR REPLACE FUNCTION agua_publico_cabecalho()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'secretaria',   COALESCE(dados->'secretaria'->>'nome',   'Secretaria de Estado do Meio Ambiente do Acre'),
    'siglaSecr',    COALESCE(dados->'secretaria'->>'sigla',  'SEMA-AC'),
    'diretoria',    COALESCE(dados->'diretoria'->>'nome',    'Diretoria de Meio Ambiente'),
    'siglaDiret',   COALESCE(dados->'diretoria'->>'sigla',   'DIMA'),
    'departamento', COALESCE((SELECT nome FROM modulo_departamento('agua')),  dados->'departamento'->>'nome', 'Departamento de Unidades de Conservação'),
    'siglaDep',     COALESCE((SELECT sigla FROM modulo_departamento('agua')), dados->'departamento'->>'sigla', 'DEUC'),
    'logoGoverno',  dados->'logos'->>'governo_url',
    'logoSecr',     dados->'logos'->>'secretaria_url',
    'baseLegal',    COALESCE(dados->'agua'->'base_legal', '[]'::jsonb)
  )
  FROM config_sistema WHERE id = 1;
$$;

COMMENT ON FUNCTION agua_publico_cabecalho() IS
  'Timbre institucional do painel público da Qualidade da Água. Departamento vem de modulo_departamento(''agua'') (organograma — DERHQA), com o campo genérico de config_sistema só como último fallback. Base legal adicional em config_sistema.dados.agua.base_legal.';
