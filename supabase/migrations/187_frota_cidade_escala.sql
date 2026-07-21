-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Frota — Cidade origem/destino + escala de motorista da vez
--
-- Solicitação de viagem passa a ter cidade_origem (default 'Rio Branco',
-- editável) e cidade_destino. Quando a viagem é INTERMUNICIPAL
-- (cidade_destino <> cidade_origem, normalizadas), o sistema SUGERE à
-- gestão o "motorista da vez" por rodízio LRU — quem está há mais tempo
-- sem fazer viagem intermunicipal concluída.
--
-- Decisões de produto (docs/frota-escala-motorista.md):
-- - Gatilho: destino <> origem (intermunicipal), não "<> Rio Branco".
-- - Ordem: LRU pela última viagem intermunicipal CONCLUÍDA (nunca-viajou
--   primeiro). A vez só é consumida na conclusão (recusa/cancelamento não
--   movem a fila).
-- - Exclui da escala: motoristas dedicados (motorista_padrao_id de veículo
--   com dedicado_setor=true), inaptos e já alocados no período.
-- - É SUGESTÃO: nada é gravado nem travado aqui; o gestor escolhe. As RPCs
--   de aprovação (186) não mudam.
-- ═══════════════════════════════════════════════════════════

-- 1) Colunas novas. cidade_destino nullable (linhas antigas); o frontend
--    passa a exigir no fluxo novo. 'destino' (ponto/local específico dentro
--    da cidade) continua existindo e coexiste com cidade_destino.
ALTER TABLE frota_viagens
  ADD COLUMN IF NOT EXISTS cidade_origem  text NOT NULL DEFAULT 'Rio Branco',
  ADD COLUMN IF NOT EXISTS cidade_destino text;

-- 2) Normalização p/ comparar cidades sem tropeçar em acento/caixa/espaço
--    ("Rio Branco" == "rio branco " == "RIO BRANCO"). Sem depender da
--    extensão unaccent (não instalada) — translate cobre os acentos do
--    PT-BR e regexp colapsa espaços. IMMUTABLE p/ poder usar em índice/view.
CREATE OR REPLACE FUNCTION frota_norm_cidade(p text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public
AS $$
  SELECT btrim(regexp_replace(
    translate(lower(coalesce(p, '')),
      'áàâãäéèêëíìîïóòôõöúùûüçñ',
      'aaaaaeeeeiiiiooooouuuucn'),
    '\s+', ' ', 'g'))
$$;

-- 3) RPC de sugestão do "motorista da vez" (LRU). Consulta pura — não grava
--    nada. Devolve a fila inteira ordenada; sugerido=true marca o 1º.
DROP FUNCTION IF EXISTS frota_sugerir_motorista_escala(text, text, timestamptz, timestamptz);
CREATE FUNCTION frota_sugerir_motorista_escala(
  p_cidade_origem  text,
  p_cidade_destino text,
  p_inicio         timestamptz,
  p_fim            timestamptz
) RETURNS TABLE (
  motorista_id   uuid,
  nome           text,
  ultima_viagem  timestamptz,   -- última intermunicipal concluída (NULL = nunca)
  total_viagens  int,           -- nº de intermunicipais concluídas (info/UI)
  sugerido       boolean        -- true só na 1ª linha (o "da vez")
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH candidatos AS (
    SELECT m.id, m.nome
    FROM frota_motoristas m
    WHERE frota_motorista_apto(m.id)                       -- ativo + apto
      -- exclui dedicados: dono (motorista_padrao_id) de veículo dedicado
      AND NOT EXISTS (
        SELECT 1 FROM frota_veiculos v
        WHERE v.motorista_padrao_id = m.id AND v.dedicado_setor AND v.ativo
      )
      -- exclui quem já está alocado no período (aprovada/em_andamento)
      AND NOT EXISTS (
        SELECT 1 FROM frota_viagens fv
        WHERE fv.motorista_id = m.id
          AND fv.status IN ('aprovada','em_andamento')
          AND tstzrange(fv.data_saida_prevista, fv.data_retorno_prevista, '[]')
              && tstzrange(p_inicio, p_fim, '[]')
      )
  ),
  hist AS (
    SELECT fv.motorista_id,
           max(fv.data_retorno_prevista) AS ultima_viagem,
           count(*)::int                 AS total_viagens
    FROM frota_viagens fv
    WHERE fv.status = 'concluida'
      AND fv.motorista_id IS NOT NULL
      AND fv.cidade_destino IS NOT NULL
      AND frota_norm_cidade(fv.cidade_destino) <> frota_norm_cidade(fv.cidade_origem)
    GROUP BY fv.motorista_id
  )
  SELECT c.id, c.nome, h.ultima_viagem, COALESCE(h.total_viagens, 0),
         row_number() OVER (ORDER BY h.ultima_viagem ASC NULLS FIRST, c.nome) = 1
    FROM candidatos c
    LEFT JOIN hist h ON h.motorista_id = c.id
   ORDER BY h.ultima_viagem ASC NULLS FIRST, c.nome;
$$;

REVOKE ALL ON FUNCTION frota_sugerir_motorista_escala(text, text, timestamptz, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION frota_sugerir_motorista_escala(text, text, timestamptz, timestamptz) TO authenticated;

-- 4) View de detalhe: recria a partir da 186 (mais recente) acrescentando
--    o campo derivado 'intermunicipal'. fv.* já traz cidade_origem/destino.
--    Molde idêntico ao da 186 (security_invoker, mesmos joins/campos) —
--    lição 178/181: recriar sempre a partir da versão mais recente.
DROP VIEW IF EXISTS vw_frota_viagens_detalhe;
CREATE VIEW vw_frota_viagens_detalhe WITH (security_invoker = true) AS
SELECT
  fv.*,
  frota_nome_usuario(fv.solicitante_id) AS solicitante_nome,
  u.telefone        AS solicitante_telefone,
  s.sigla           AS setor_sigla,
  s.nome            AS setor_nome,
  v.placa           AS veiculo_placa,
  v.modelo          AS veiculo_modelo,
  v.tipo            AS veiculo_tipo,
  v.medidor         AS veiculo_medidor,
  v.dedicado_setor  AS veiculo_dedicado,
  sv.sigla          AS veiculo_setor_sigla,
  m.nome            AS motorista_nome,
  m.usuario_id      AS motorista_usuario_id,
  frota_nome_usuario(fv.dedicado_liberado_por) AS dedicado_liberado_por_nome,
  (fv.cidade_destino IS NOT NULL
   AND frota_norm_cidade(fv.cidade_destino) <> frota_norm_cidade(fv.cidade_origem))
                    AS intermunicipal,
  CASE WHEN fv.localizacao_saida IS NOT NULL THEN ST_Y(fv.localizacao_saida) END AS lat_saida,
  CASE WHEN fv.localizacao_saida IS NOT NULL THEN ST_X(fv.localizacao_saida) END AS lng_saida,
  CASE WHEN fv.localizacao_chegada IS NOT NULL THEN ST_Y(fv.localizacao_chegada) END AS lat_chegada,
  CASE WHEN fv.localizacao_chegada IS NOT NULL THEN ST_X(fv.localizacao_chegada) END AS lng_chegada
FROM frota_viagens fv
LEFT JOIN usuarios u                  ON u.id = fv.solicitante_id
LEFT JOIN unidades_organizacionais s  ON s.id = fv.setor_solicitante_id
LEFT JOIN frota_veiculos v            ON v.id = fv.veiculo_id
LEFT JOIN unidades_organizacionais sv ON sv.id = v.setor_id
LEFT JOIN frota_motoristas m          ON m.id = fv.motorista_id;
