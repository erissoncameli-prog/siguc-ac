-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Frota — sugestão da escala expõe a FOTO do motorista
--
-- frota_sugerir_motorista_escala passa a devolver foto_url do motorista,
-- para o app/mesa mostrarem nome + foto do motorista da vez (solicitante
-- e gestor). Assinatura de retorno muda (coluna nova) → DROP antes de
-- recriar (lição 178/181). Mantém p_passageiros (188) e a trava de
-- autenticação (189).
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
  foto_url       text,
  ultima_viagem  timestamptz,
  total_viagens  int,
  sugerido       boolean
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_necessarios int := 1;
  v_restante    int;
  r             record;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Autenticação necessária';
  END IF;

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
    IF v_necessarios < 1 THEN v_necessarios := 1; END IF;
  END IF;

  RETURN QUERY
  WITH candidatos AS (
    SELECT m.id, m.nome, m.foto_url
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
  SELECT c.id, c.nome, c.foto_url, h.ultima_viagem, COALESCE(h.total_viagens, 0),
         row_number() OVER (ORDER BY h.ultima_viagem ASC NULLS FIRST, c.nome) <= v_necessarios
    FROM candidatos c
    LEFT JOIN hist h ON h.motorista_id = c.id
   ORDER BY h.ultima_viagem ASC NULLS FIRST, c.nome;
END;
$$;

REVOKE ALL ON FUNCTION frota_sugerir_motorista_escala(text, text, timestamptz, timestamptz, smallint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION frota_sugerir_motorista_escala(text, text, timestamptz, timestamptz, smallint) TO authenticated;
