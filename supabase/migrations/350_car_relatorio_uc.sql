-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · 350 — Relatório "CAR na UC" (Gestão › Relatórios)
--
-- Pedido do usuário: relatório com os imóveis do CAR registrados numa
-- UC (número, situação, titular etc.), comparado com as zonas de manejo,
-- e opção de trazer dados ambientais (focos, DETER, PRODES), sem mapa.
--
-- Decisões do usuário (30/09/2026):
--   • geometria do CAR AO VIVO do SICAR (WFS, via /api/car-proxy) — o
--     banco não guarda polígono de imóvel; a planilha local
--     (car_dados_locais) só COMPLEMENTA os atributos cadastrais;
--   • CPF/CNPJ sempre MASCARADO no relatório;
--   • acesso: todo o grupo Gestão (mesmo gate do menu, pode_ver('monitoramento')).
--
-- Duas RPCs, as duas SECURITY DEFINER com o mesmo gate:
--   1. car_relatorio_uc_cadastro — complemento cadastral, CPF mascarado
--      no SERVIDOR (o número inteiro nunca trafega), e UMA linha de log
--      por imóvel devolvido em lgpd_acesso_dado_terceiro (mesmo log da
--      216, agora com origem/uc). O relatório expõe nome de titulares em
--      lote — é exatamente o evento que o log existe para registrar.
--   2. car_relatorio_uc_ambiental — só AGREGADOS (focos por ano e alertas
--      DETER) dentro da parte do imóvel que está na UC. Nenhum dado
--      pessoal; o cliente manda a geometria que já tem do SICAR.
-- ═══════════════════════════════════════════════════════════

-- ── Log: de onde veio o acesso ─────────────────────────────
-- Colunas ao FINAL, nulas para as linhas antigas (car_consultar_local).
ALTER TABLE lgpd_acesso_dado_terceiro
  ADD COLUMN IF NOT EXISTS origem text,
  ADD COLUMN IF NOT EXISTS uc_id  uuid REFERENCES unidades_conservacao(id);

CREATE OR REPLACE VIEW vw_lgpd_acesso_car WITH (security_invoker = true) AS
SELECT a.id, a.cod_imovel, a.cpf_cnpj, a.acessado_em,
       u.nome_completo AS usuario_nome, u.email AS usuario_email,
       a.origem, uc.nome AS uc_nome
FROM lgpd_acesso_dado_terceiro a
LEFT JOIN usuarios u  ON u.id  = a.usuario_id
LEFT JOIN unidades_conservacao uc ON uc.id = a.uc_id
ORDER BY a.acessado_em DESC;

-- ── Máscara de CPF/CNPJ (definição única no banco) ─────────
-- CPF  12345678901    → ***.456.789-**
-- CNPJ 12345678000190 → **.345.678/****-**
-- Qualquer outra coisa → *** (nunca devolve o texto cru por engano).
CREATE OR REPLACE FUNCTION car_mascarar_documento(p text)
RETURNS text LANGUAGE sql IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN p IS NULL OR btrim(p) = '' THEN NULL
    WHEN length(d) = 11 THEN '***.' || substr(d,4,3) || '.' || substr(d,7,3) || '-**'
    WHEN length(d) = 14 THEN '**.'  || substr(d,3,3) || '.' || substr(d,6,3) || '/****-**'
    ELSE '***'
  END
  FROM (SELECT regexp_replace(coalesce(p,''), '\D', '', 'g') AS d) s;
$$;

REVOKE EXECUTE ON FUNCTION car_mascarar_documento(text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION car_mascarar_documento(text) TO authenticated;

-- ── 1. Complemento cadastral (planilha SICAR local) ────────
CREATE OR REPLACE FUNCTION car_relatorio_uc_cadastro(p_uc_id uuid, p_cod_imoveis text[])
RETURNS TABLE (
  cod_imovel text, nom_imovel text, nome_compl text, cpf_cnpj_mascarado text,
  num_area_i numeric, num_modulo numeric, nom_munici text, ind_status text,
  condicao_i text, nome_class text, tipo_docum text, nome_docum text,
  dat_criaca date
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT pode_ver('monitoramento') THEN
    RAISE EXCEPTION 'Sem permissão para gerar o relatório de CAR';
  END IF;
  IF p_uc_id IS NULL OR NOT EXISTS (SELECT 1 FROM unidades_conservacao WHERE id = p_uc_id) THEN
    RAISE EXCEPTION 'UC inválida';
  END IF;
  IF coalesce(array_length(p_cod_imoveis, 1), 0) > 5000 THEN
    RAISE EXCEPTION 'Máximo de 5000 imóveis por chamada';
  END IF;

  -- Log ANTES de devolver: um registro por titular exposto.
  INSERT INTO lgpd_acesso_dado_terceiro (tabela, cod_imovel, cpf_cnpj, origem, uc_id)
  SELECT 'car_dados_locais', c.cod_imovel, c.cpf_cnpj, 'relatorio_car_uc', p_uc_id
    FROM car_dados_locais c
   WHERE c.cod_imovel = ANY (p_cod_imoveis);

  RETURN QUERY
  SELECT c.cod_imovel, c.nom_imovel, c.nome_compl, car_mascarar_documento(c.cpf_cnpj),
         c.num_area_i, c.num_modulo, c.nom_munici, c.ind_status,
         c.condicao_i, c.nome_class, c.tipo_docum, c.nome_docum, c.dat_criaca
    FROM car_dados_locais c
   WHERE c.cod_imovel = ANY (p_cod_imoveis);
END;
$$;

REVOKE EXECUTE ON FUNCTION car_relatorio_uc_cadastro(uuid, text[]) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION car_relatorio_uc_cadastro(uuid, text[]) TO authenticated;

COMMENT ON FUNCTION car_relatorio_uc_cadastro(uuid, text[]) IS
  'Relatório CAR na UC (pages/relatorios.html): atributos da planilha SICAR local para os imóveis que o cliente achou no WFS. CPF/CNPJ mascarado no servidor (car_mascarar_documento); grava uma linha por imóvel em lgpd_acesso_dado_terceiro (origem relatorio_car_uc).';

-- ── Focos da linha do tempo dentro de um polígono ──────────
-- MESMA definição de vw_focos_linha_tempo (340/341): série histórica
-- (dentro_acre) + FIRMS diário nos anos que a série não cobre, só
-- VIIRS S-NPP + MODIS, janela da temporada 1º/jul–4/nov. Existe à parte
-- porque a view não expõe a geometria e, medido, o planner NÃO empurra
-- ST_Intersects para dentro do UNION ALL: 33 s contra ~1 s com o índice
-- GIST de cada ramo (100 polígonos na RESEX Chico Mendes). Mudou a
-- regra na view → mudar aqui na mesma migration.
CREATE OR REPLACE FUNCTION focos_linha_tempo_em(p_geom geometry)
RETURNS TABLE (ano smallint)
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT h.ano
    FROM focos_calor_ac h
   WHERE h.dentro_acre AND h.geom && p_geom AND ST_Intersects(p_geom, h.geom)
  UNION ALL
  SELECT EXTRACT(year FROM (f.data_hora AT TIME ZONE 'America/Rio_Branco'))::smallint
    FROM focos_calor f
   WHERE f.geom && p_geom AND ST_Intersects(p_geom, f.geom)
     AND f.fonte = 'FIRMS'
     AND f.satelite = ANY (ARRAY['N','Terra','Aqua'])
     AND to_char(f.data_hora AT TIME ZONE 'America/Rio_Branco', 'MM-DD') BETWEEN '07-01' AND '11-04'
     AND EXTRACT(year FROM (f.data_hora AT TIME ZONE 'America/Rio_Branco'))
         > (SELECT max(x.ano) FROM focos_calor_ac x);
$$;

REVOKE EXECUTE ON FUNCTION focos_linha_tempo_em(geometry) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION focos_linha_tempo_em(geometry) TO authenticated;

-- ── 2. Agregados ambientais por imóvel (parte dentro da UC) ─
-- p_imoveis = [{"cod":"AC-...","geom":<GeoJSON geometry>}, ...]
-- Até 150 por chamada (statement_timeout de 8 s do authenticated; o
-- pior caso medido — 300 polígonos cobrindo a Chico Mendes inteira —
-- levou 2,9 s só nos focos).
CREATE OR REPLACE FUNCTION car_relatorio_uc_ambiental(p_uc_id uuid, p_imoveis jsonb)
RETURNS TABLE (
  cod_imovel text, focos_por_ano jsonb, focos_total int,
  deter_alertas int, deter_ha numeric, deter_ultimo date
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT pode_ver('monitoramento') THEN
    RAISE EXCEPTION 'Sem permissão para gerar o relatório de CAR';
  END IF;
  IF jsonb_typeof(p_imoveis) <> 'array' OR jsonb_array_length(p_imoveis) > 150 THEN
    RAISE EXCEPTION 'p_imoveis deve ser uma lista de até 150 imóveis';
  END IF;

  RETURN QUERY
  WITH imv AS MATERIALIZED (
    SELECT e->>'cod' AS cod,
           ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(e->>'geom'), 4326)) AS g
      FROM jsonb_array_elements(p_imoveis) e
     WHERE e ? 'cod' AND e ? 'geom'
  ),
  fa AS (
    SELECT imv.cod, x.ano, count(*)::int AS n
      FROM imv CROSS JOIN LATERAL focos_linha_tempo_em(imv.g) x
     GROUP BY 1, 2
  ),
  fo AS (
    SELECT cod, jsonb_object_agg(ano::text, n ORDER BY ano) AS por_ano, sum(n)::int AS total
      FROM fa GROUP BY cod
  ),
  dt AS (
    SELECT imv.cod,
           count(*)::int AS n,
           round(sum(ST_Area(ST_Intersection(ST_MakeValid(a.poligono), imv.g)::geography) / 10000)::numeric, 2) AS ha,
           max(a.data_referencia) AS ultimo
      FROM imv
      JOIN alertas_ambientais a
        ON a.fonte = 'DETER' AND coalesce(a.ativo, true)
       AND a.poligono && imv.g AND ST_Intersects(a.poligono, imv.g)
     GROUP BY imv.cod
  )
  SELECT imv.cod,
         coalesce(fo.por_ano, '{}'::jsonb),
         coalesce(fo.total, 0),
         coalesce(dt.n, 0),
         coalesce(dt.ha, 0),
         dt.ultimo
    FROM imv
    LEFT JOIN fo ON fo.cod = imv.cod
    LEFT JOIN dt ON dt.cod = imv.cod;
END;
$$;

REVOKE EXECUTE ON FUNCTION car_relatorio_uc_ambiental(uuid, jsonb) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION car_relatorio_uc_ambiental(uuid, jsonb) TO authenticated;

COMMENT ON FUNCTION car_relatorio_uc_ambiental(uuid, jsonb) IS
  'Relatório CAR na UC: focos (definição de vw_focos_linha_tempo, via focos_linha_tempo_em) e alertas DETER dentro da geometria enviada (parte do imóvel na UC). Só agregados — nenhum dado pessoal.';

-- ── ROPA / RIPD ────────────────────────────────────────────
UPDATE lgpd_tratamentos
   SET observacoes = observacoes || ' Relatório "CAR na UC" (Gestão › Relatórios, migration 350): lista titulares por UC com CPF/CNPJ sempre mascarado no servidor e uma linha de log por imóvel (origem relatorio_car_uc) — RIPD v1.2.'
 WHERE codigo = 'TRAT-013'
   AND observacoes NOT LIKE '%relatorio_car_uc%';

DO $$
DECLARE
  v_doc uuid;
  v_txt text;
  v_ancora constant text := '- **CPF/CNPJ mascarado na tela**';
BEGIN
  SELECT d.id, v.conteudo_md INTO v_doc, v_txt
    FROM lgpd_documentos d
    JOIN lgpd_documento_versoes v ON v.documento_id = d.id
   WHERE d.tipo = 'ripd_car'
   ORDER BY v.vigente_desde DESC, v.versao DESC
   LIMIT 1;

  IF v_doc IS NULL THEN RAISE EXCEPTION 'RIPD do CAR não encontrado'; END IF;
  IF EXISTS (SELECT 1 FROM lgpd_documento_versoes WHERE documento_id = v_doc AND versao = '1.2') THEN
    RETURN;  -- reaplicação
  END IF;
  IF (length(v_txt) - length(replace(v_txt, v_ancora, ''))) / length(v_ancora) <> 1 THEN
    RAISE EXCEPTION 'Âncora do RIPD v1.1 não encontrada exatamente uma vez — revisar a migration';
  END IF;

  v_txt := replace(v_txt, v_ancora,
    '- **Relatório "CAR na UC" em lote** (migration 350, Gestão ›' || chr(10) ||
    '  Relatórios): lista os imóveis sobrepostos a uma UC com o nome do' || chr(10) ||
    '  titular, que é o que identifica sobre quem recai a gestão. O' || chr(10) ||
    '  CPF/CNPJ sai SEMPRE mascarado, e a máscara é aplicada no servidor' || chr(10) ||
    '  (`car_mascarar_documento`) — o número inteiro nunca trafega para o' || chr(10) ||
    '  navegador nem vai para o PDF/planilha exportados. Cada imóvel' || chr(10) ||
    '  devolvido grava uma linha em `lgpd_acesso_dado_terceiro`' || chr(10) ||
    '  (`origem = relatorio_car_uc`, com a UC), então o relatório em lote' || chr(10) ||
    '  deixa a mesma trilha que a consulta individual. Acesso restrito ao' || chr(10) ||
    '  grupo Gestão (`pode_ver(''monitoramento'')`).' || chr(10) ||
    v_ancora);

  INSERT INTO lgpd_documento_versoes (documento_id, versao, vigente_desde, resumo_mudancas, conteudo_md)
  VALUES (v_doc, '1.2', current_date,
    'Registra o relatório "CAR na UC" (migration 350): lista de titulares por UC com CPF/CNPJ mascarado no servidor e log por imóvel em lgpd_acesso_dado_terceiro.',
    v_txt);
END;
$$;
