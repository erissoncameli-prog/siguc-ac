-- Expõe aap_pdf_path no RPC público para permitir download da AAP
CREATE OR REPLACE FUNCTION buscar_pesquisa_por_token(p_token text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT jsonb_build_object(
    'id',                        p.id,
    'numero_processo',           p.numero_processo,
    'titulo',                    p.titulo,
    'tipo',                      p.tipo,
    'etapa',                     p.etapa,
    'pesquisador_nome',          p.pesquisador_nome,
    'uc_nome',                   uc.nome,
    'data_inicio_prevista',      p.data_inicio_prevista,
    'data_fim_prevista',         p.data_fim_prevista,
    'aap_numero',                p.aap_numero,
    'aap_validade',              p.aap_validade,
    'aap_pdf_path',              p.aap_pdf_path,
    'aap_assinado_por',          u_sign.nome_completo,
    'complementacao_solicitada', p.complementacao_solicitada,
    'complementacao_motivo',     p.complementacao_motivo,
    'complementacao_prazo',      p.complementacao_prazo,
    'inadimplente',              p.inadimplente,
    'criado_em',                 p.criado_em,
    'historico', (
      SELECT jsonb_agg(jsonb_build_object(
        'etapa_nova',   h.etapa_nova,
        'observacao',   h.observacao,
        'criado_em',    h.criado_em,
        'usuario_nome', u_h.nome_completo
      ) ORDER BY h.criado_em)
      FROM pesquisa_historico h
      LEFT JOIN usuarios u_h ON u_h.id = h.usuario_id
      WHERE h.pesquisa_id = p.id
    ),
    'documentos', (
      SELECT jsonb_agg(jsonb_build_object(
        'id',            d.id,
        'tipo',          d.tipo,
        'nome_original', d.nome_original,
        'storage_path',  d.storage_path,
        'tamanho_bytes', d.tamanho_bytes,
        'mime_type',     d.mime_type,
        'criado_em',     d.criado_em
      ) ORDER BY d.criado_em)
      FROM pesquisa_documentos d WHERE d.pesquisa_id = p.id
    )
  )
  FROM pesquisas p
  LEFT JOIN unidades_conservacao uc   ON uc.id    = p.uc_id
  LEFT JOIN usuarios u_sign           ON u_sign.id = p.aap_assinado_por
  WHERE p.token_publico = p_token
  LIMIT 1;
$$;
