-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Frota — corrige regressão introduzida pela migration
-- 176: ao recriar frota_checkin_viagem (para adicionar
-- localizacao_chegada/p_lat/p_lng), usei como base o corpo original
-- da 155 em vez do corpo já corrigido pela 169, perdendo 2 coisas:
-- 1) o cast explícito ::status_veiculo_frota no CASE que define o
--    status do veículo (sem ele: "column status is of type
--    status_veiculo_frota but expression is of type text" — CASE só
--    com literais de texto resolve como text puro, não como
--    "unknown", e não casta sozinho pro enum);
-- 2) a chamada a frota_checar_manutencao_veiculo() ao final do
--    check-in (aviso de manutenção pendente).
-- Restaura as duas, mantendo a captura de GPS da 176.
-- ═══════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION frota_checkin_viagem(
  p_viagem_id uuid, p_medida numeric, p_combustivel_pct smallint,
  p_observacoes text, p_avarias text,
  p_lat numeric DEFAULT NULL, p_lng numeric DEFAULT NULL
)
RETURNS frota_viagens
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_viagem            frota_viagens;
  v_medidor           medidor_uso_frota;
  v_motorista_usuario uuid;
BEGIN
  IF NOT frota_pode_operar_viagem(p_viagem_id) THEN
    RAISE EXCEPTION 'Sem permissão para concluir esta viagem';
  END IF;

  SELECT medidor INTO v_medidor FROM frota_veiculos v
    JOIN frota_viagens fv ON fv.veiculo_id = v.id WHERE fv.id = p_viagem_id;

  UPDATE frota_viagens
    SET status = 'concluida', checkin_em = now(),
        km_chegada    = CASE WHEN v_medidor = 'hodometro' THEN p_medida ELSE NULL END,
        horas_chegada = CASE WHEN v_medidor = 'horimetro' THEN p_medida ELSE NULL END,
        combustivel_chegada_pct = p_combustivel_pct,
        observacoes_checkin = p_observacoes,
        avarias = NULLIF(p_avarias, ''),
        localizacao_chegada = CASE WHEN p_lat IS NOT NULL AND p_lng IS NOT NULL
          THEN ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326) ELSE NULL END
    WHERE id = p_viagem_id AND status = 'em_andamento'
    RETURNING * INTO v_viagem;

  IF v_viagem IS NULL THEN
    RAISE EXCEPTION 'Viagem não encontrada ou não está em andamento';
  END IF;

  UPDATE frota_veiculos
    SET status = (CASE WHEN v_viagem.avarias IS NOT NULL THEN 'em_manutencao' ELSE 'disponivel' END)::status_veiculo_frota,
        hodometro_km    = CASE WHEN v_medidor = 'hodometro' AND p_medida > hodometro_km THEN p_medida ELSE hodometro_km END,
        horimetro_horas = CASE WHEN v_medidor = 'horimetro' AND p_medida > horimetro_horas THEN p_medida ELSE horimetro_horas END
    WHERE id = v_viagem.veiculo_id;

  SELECT usuario_id INTO v_motorista_usuario FROM frota_motoristas WHERE id = v_viagem.motorista_id;
  PERFORM frota_checar_manutencao_veiculo(v_viagem.veiculo_id, v_motorista_usuario);

  RETURN v_viagem;
END;
$$;
