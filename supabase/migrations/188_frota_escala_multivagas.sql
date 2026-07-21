-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Frota — escala do motorista da vez também no SOLICITANTE
-- e para MÚLTIPLOS veículos.
--
-- Requisito: ao solicitar a viagem, o solicitante já vê o "motorista da
-- vez" (sugestão, a confirmar pela gestão de frota). Quando a viagem
-- precisa de 2+ veículos (nº de passageiros não cabe em um só), mostra
-- os N motoristas da vez — um por veículo necessário.
--
-- Solução: frota_sugerir_motorista_escala ganha o parâmetro opcional
-- p_passageiros. Com ele, calcula quantos veículos a viagem exige
-- (greedy por capacidade sobre os veículos disponíveis no período, mesma
-- regra da frota_sugerir_alocacao/172, dedicados já ficam de fora) e
-- marca como sugerido=true os N primeiros da fila LRU. Sem p_passageiros
-- (chamada da aprovação simples, gestor) → N=1: comportamento anterior,
-- só o 1º é sugerido. Continua sendo consulta pura (SECURITY DEFINER,
-- authenticated) — nada é gravado, é sugestão; o gestor confirma.
--
-- Assinatura muda (novo parâmetro) → DROP antes de recriar, senão o
-- CREATE OR REPLACE criaria um overload (lição 178/181). A chamada com
-- os 4 params nomeados continua resolvendo (5º tem DEFAULT NULL).
-- ═══════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS frota_sugerir_motorista_escala(text, text, timestamptz, timestamptz);
DROP FUNCTION IF EXISTS frota_sugerir_motorista_escala(text, text, timestamptz, timestamptz, smallint);
CREATE FUNCTION frota_sugerir_motorista_escala(
  p_cidade_origem  text,
  p_cidade_destino text,
  p_inicio         timestamptz,
  p_fim            timestamptz,
  p_passageiros    smallint DEFAULT NULL
) RETURNS TABLE (
  motorista_id   uuid,
  nome           text,
  ultima_viagem  timestamptz,   -- última intermunicipal concluída (NULL = nunca)
  total_viagens  int,           -- nº de intermunicipais concluídas (info/UI)
  sugerido       boolean        -- true nos N primeiros (N = veículos necessários)
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_necessarios int := 1;   -- veículos (e portanto motoristas) necessários
  v_restante    int;
  r             record;
BEGIN
  -- Quantos veículos a viagem exige? Só quando o solicitante informou
  -- passageiros; senão fica 1 (comportamento da aprovação simples).
  IF p_passageiros IS NOT NULL AND p_passageiros > 0 THEN
    v_restante    := p_passageiros;
    v_necessarios := 0;
    FOR r IN
      SELECT COALESCE(d.capacidade_passageiros, 4)::int AS cap
      FROM frota_veiculos_disponiveis(p_inicio, p_fim) d
      ORDER BY COALESCE(d.capacidade_passageiros, 4) DESC, d.placa
    LOOP
      EXIT WHEN v_restante <= 0;
      v_necessarios := v_necessarios + 1;
      v_restante    := v_restante - r.cap;
    END LOOP;
    IF v_necessarios < 1 THEN v_necessarios := 1; END IF;  -- sem frota livre
  END IF;

  RETURN QUERY
  WITH candidatos AS (
    SELECT m.id, m.nome
    FROM frota_motoristas m
    WHERE frota_motorista_apto(m.id)
      AND NOT EXISTS (
        SELECT 1 FROM frota_veiculos v
        WHERE v.motorista_padrao_id = m.id AND v.dedicado_setor AND v.ativo
      )
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
         row_number() OVER (ORDER BY h.ultima_viagem ASC NULLS FIRST, c.nome) <= v_necessarios
    FROM candidatos c
    LEFT JOIN hist h ON h.motorista_id = c.id
   ORDER BY h.ultima_viagem ASC NULLS FIRST, c.nome;
END;
$$;

REVOKE ALL ON FUNCTION frota_sugerir_motorista_escala(text, text, timestamptz, timestamptz, smallint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION frota_sugerir_motorista_escala(text, text, timestamptz, timestamptz, smallint) TO authenticated;
