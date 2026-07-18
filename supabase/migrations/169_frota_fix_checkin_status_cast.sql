-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Frota — corrige erro no check-in: "column status is of
-- type status_veiculo_frota but expression is of type text".
-- O CASE com apenas literais de texto resolve como text puro (não
-- como "unknown"), exigindo cast explícito para o enum.
-- ═══════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.frota_checkin_viagem(p_viagem_id uuid, p_medida numeric, p_combustivel_pct smallint, p_observacoes text, p_avarias text)
 RETURNS frota_viagens
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_viagem  frota_viagens;
  v_medidor medidor_uso_frota;
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
        avarias = NULLIF(p_avarias, '')
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
$function$;
