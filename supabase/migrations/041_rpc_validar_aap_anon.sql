-- RPC SECURITY DEFINER para validação pública da AAP por QR token
-- Substitui a consulta direta à v_aap_publica (que era bloqueada pelo RLS anon)
CREATE OR REPLACE FUNCTION buscar_aap_por_token(p_token text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public AS $$
  SELECT jsonb_build_object(
    'id',                   p.id,
    'numero_processo',      p.numero_processo,
    'titulo',               p.titulo,
    'tipo',                 p.tipo,
    'aap_numero',           p.aap_numero,
    'aap_qr_token',         p.aap_qr_token,
    'aap_emitida_em',       p.aap_emitida_em,
    'aap_validade',         p.aap_validade,
    'aap_assinado_em',      p.aap_assinado_em,
    'aap_condicionantes',   p.aap_condicionantes,
    'pesquisador_nome',     p.pesquisador_nome,
    'pesquisador_email',    p.pesquisador_email,
    'pesquisador_cpf',      p.pesquisador_cpf,
    'pesquisador_instituicao', p.pesquisador_instituicao,
    'uc_nome',              uc.nome,
    'autorizador_nome',     u_aut.nome_completo,
    'emitente_nome',        u_emit.nome_completo,
    'status_validade',      CASE
                              WHEN p.aap_validade >= current_date THEN 'valida'
                              ELSE 'expirada'
                            END
  )
  FROM pesquisas p
  LEFT JOIN unidades_conservacao uc   ON uc.id    = p.uc_id
  LEFT JOIN usuarios u_aut            ON u_aut.id  = p.aap_assinado_por
  LEFT JOIN usuarios u_emit           ON u_emit.id = p.aap_emitido_por
  WHERE p.aap_qr_token = p_token
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION buscar_aap_por_token(text) TO anon, authenticated;
