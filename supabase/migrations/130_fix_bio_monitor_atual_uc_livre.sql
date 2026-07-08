-- 130_fix_bio_monitor_atual_uc_livre.sql
-- Corrige bio_monitor_atual() e vw_grupos_biomonitor: o JOIN com
-- unidades_conservacao era INNER, mas grupos_biomonitor.uc_id é
-- opcional (tipo_localizacao = 'margem_livre'/'fora_uc' usa
-- localizacao_referencia em vez de UC). Isso fazia a RPC de login do
-- app Biomonitor retornar NULL para TODOS os monitores de um grupo
-- sem UC vinculada — mensagem "Usuário não vinculado a nenhum grupo
-- de monitoramento" mesmo com cadastro correto.

CREATE OR REPLACE FUNCTION bio_monitor_atual()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_rec record;
BEGIN
  SELECT
    m.id,
    m.nome_completo,
    m.funcao,
    m.status,
    m.foto_url,
    m.deve_trocar_senha,
    m.grupo_id,
    g.nome                AS grupo_nome,
    g.programa_id,
    p.tipo                AS programa_tipo,
    p.nome                AS programa_nome,
    uc.id                 AS uc_id,
    uc.nome               AS uc_nome,
    uc.sigla               AS uc_sigla
  INTO v_rec
  FROM monitores_biodiversidade m
  JOIN grupos_biomonitor g    ON g.id = m.grupo_id
  JOIN programas_biomonitoramento p ON p.id = g.programa_id
  LEFT JOIN unidades_conservacao uc ON uc.id = g.uc_id
  WHERE m.usuario_id = auth.uid()
    AND m.status = 'ativo'
  LIMIT 1;

  IF v_rec IS NULL THEN
    RETURN NULL;
  END IF;

  RETURN to_jsonb(v_rec);
END;
$$;
GRANT EXECUTE ON FUNCTION bio_monitor_atual TO authenticated;

CREATE OR REPLACE VIEW vw_grupos_biomonitor AS
SELECT
  g.id,
  g.nome,
  g.ativo,
  g.temporada_inicio,
  g.temporada_fim,
  g.coordenador_nome,
  p.tipo        AS programa_tipo,
  p.nome        AS programa_nome,
  uc.nome       AS uc_nome,
  uc.sigla      AS uc_sigla,
  COUNT(m.id) FILTER (WHERE m.status = 'ativo')  AS monitores_ativos,
  COUNT(m.id)                                     AS monitores_total,
  g.criado_em,
  g.atualizado_em
FROM grupos_biomonitor g
JOIN programas_biomonitoramento p ON p.id = g.programa_id
LEFT JOIN unidades_conservacao uc ON uc.id = g.uc_id
LEFT JOIN monitores_biodiversidade m ON m.grupo_id = g.id
GROUP BY g.id, p.id, uc.id;
