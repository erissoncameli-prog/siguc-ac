-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Qualidade da Água — código único da coleta + confirmação
-- de coordenada por GPS (faixas de distância)
--
-- CÓDIGO ÚNICO POR CIMA DE `codigo_amostra`, NÃO UMA COLUNA NOVA
-- O plano original desta entrega previa uma 2ª coluna (`codigo_coleta`,
-- sequencial, gerado por trigger — molde ABAST-AAAA-NNNN/BIOEQ-AAAA-NNNN)
-- ao lado de `codigo_amostra` (texto livre, o rótulo que o coletor
-- escreve no frasco, migration 257). Decisão do usuário: um campo só.
-- `codigo_amostra` passa a ser AUTOGERADO pelo trigger no molde
-- COL-AAAA-NNNN sempre que o cliente não informar nada — o comum,
-- já que hoje 0 das 451 linhas em produção têm o campo preenchido
-- (conferido antes desta migration). Se o coletor digitar um valor
-- (ex.: etiqueta física pré-impressa de um kit de laboratório), esse
-- valor é respeitado — o trigger só entra quando o campo está vazio,
-- mesma regra do `frota_gerar_codigo_abastecimento` (migration 175).
-- Isso preserva o texto de ajuda do formulário ("como está escrito no
-- frasco") — na prática o fluxo normal inverte: o sistema gera o
-- código antes de o coletor escrever no frasco, e ele copia o código
-- gerado para o rótulo físico, em vez do contrário.
--
-- BACKFILL das 451 linhas existentes (nenhuma tem o campo hoje): esta
-- migration também preenche as linhas já gravadas, em ordem
-- cronológica (`data_coleta`, depois `id` para desempate estável),
-- consumindo a MESMA tabela-contador que o trigger usa daqui pra
-- frente — não haveria sentido em "coleta sem número" para o dado
-- antigo se o propósito é vínculo futuro.
--
-- CONFIRMAÇÃO DE COORDENADA — DERIVADA, NUNCA GRAVADA
-- Mesma disciplina de `agua_iqa_faixa`: a distância entre o GPS do
-- aparelho (`agua_coletas.localizacao`, já existente desde a Fase 0) e
-- a coordenada cadastrada do ponto (`agua_pontos_coleta.geom`) é
-- geometria pura — não precisa de coluna nova, é calculada na view a
-- cada leitura (`agua_gps_faixa`, molde `agua_iqa_faixa`). Faixas
-- (achado do app de campo: aviso antigo só disparava acima de 1 km,
-- silencioso demais para pegar erro de ponto; GPS de celular erra
-- tipicamente 5–20 m a céu aberto, mais sob copa de árvore/margem de
-- rio):
--   ≤ 30 m   → 'confirmado' (dentro do erro esperado de aparelho)
--   30–150 m → 'atencao'    (fora do erro típico, mas pode ser
--                             imprecisão de sinal — pede conferência)
--   > 150 m  → 'divergente' (provável ponto errado)
--   sem leitura de GPS (localizacao NULL, aparelho falhou/offline)
--            → NULL — "não avaliado", nunca confundido com "confirmado"
-- Continua SEM bloquear salvamento (regra do sistema: nada impede o
-- trabalho de campo) — é só o dado que alimenta o indicador visual em
-- pages/agua-app.html e a leitura de mesa/relatório.
-- ═══════════════════════════════════════════════════════════

-- ── Código único (reaproveita codigo_amostra) ──────────────────
CREATE TABLE IF NOT EXISTS agua_coletas_contador (
  ano    int PRIMARY KEY,
  ultimo int NOT NULL DEFAULT 0
);
ALTER TABLE agua_coletas_contador ENABLE ROW LEVEL SECURITY;
-- Sem policies: acesso só via função SECURITY DEFINER abaixo.

CREATE OR REPLACE FUNCTION agua_gerar_codigo_amostra()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_ano int;
  v_num int;
BEGIN
  IF NEW.codigo_amostra IS NOT NULL THEN RETURN NEW; END IF;
  v_ano := EXTRACT(YEAR FROM COALESCE(NEW.data_coleta, now()))::int;
  INSERT INTO agua_coletas_contador (ano, ultimo) VALUES (v_ano, 1)
    ON CONFLICT (ano) DO UPDATE SET ultimo = agua_coletas_contador.ultimo + 1
    RETURNING ultimo INTO v_num;
  NEW.codigo_amostra := 'COL-' || v_ano || '-' || lpad(v_num::text, 4, '0');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_agua_coletas_codigo ON agua_coletas;
CREATE TRIGGER trg_agua_coletas_codigo BEFORE INSERT ON agua_coletas
  FOR EACH ROW EXECUTE FUNCTION agua_gerar_codigo_amostra();

-- ── Backfill das linhas já existentes (cronológico, mesmo contador) ──
DO $$
DECLARE
  v_ano int;
  v_max int;
BEGIN
  -- Para cada ano com linha pendente, atribui os números em ordem
  -- cronológica e deixa o contador já apontando para o último usado —
  -- o trigger, daqui pra frente, continua exatamente dali.
  FOR v_ano IN
    SELECT DISTINCT EXTRACT(YEAR FROM data_coleta)::int
      FROM agua_coletas WHERE codigo_amostra IS NULL
  LOOP
    WITH numerado AS (
      SELECT id, row_number() OVER (ORDER BY data_coleta, id) AS n
        FROM agua_coletas
       WHERE codigo_amostra IS NULL
         AND EXTRACT(YEAR FROM data_coleta)::int = v_ano
    )
    UPDATE agua_coletas c
       SET codigo_amostra = 'COL-' || v_ano || '-' || lpad(numerado.n::text, 4, '0')
      FROM numerado
     WHERE c.id = numerado.id;

    SELECT max(n) INTO v_max FROM (
      SELECT row_number() OVER (ORDER BY data_coleta, id) AS n
        FROM agua_coletas WHERE EXTRACT(YEAR FROM data_coleta)::int = v_ano
    ) t;

    INSERT INTO agua_coletas_contador (ano, ultimo) VALUES (v_ano, v_max)
      ON CONFLICT (ano) DO UPDATE SET ultimo = GREATEST(agua_coletas_contador.ultimo, excluded.ultimo);
  END LOOP;
END $$;

ALTER TABLE agua_coletas ADD CONSTRAINT uq_agua_coletas_codigo_amostra UNIQUE (codigo_amostra);

COMMENT ON COLUMN agua_coletas.codigo_amostra IS
  'Identificador único da coleta (COL-AAAA-NNNN), autogerado pelo trigger trg_agua_coletas_codigo quando o cliente não informa nada. Sentido original preservado: se o coletor digitar um valor (etiqueta física pré-existente), esse valor é respeitado. Fonte de vínculo futuro — sempre presente, sempre único.';

-- ── Confirmação de coordenada por faixa de distância (derivada) ──
CREATE OR REPLACE FUNCTION agua_gps_faixa(p_distancia_m numeric)
RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = public
AS $$
  SELECT CASE
    WHEN p_distancia_m IS NULL THEN NULL
    WHEN p_distancia_m <= 30  THEN 'confirmado'
    WHEN p_distancia_m <= 150 THEN 'atencao'
    ELSE 'divergente'
  END;
$$;

COMMENT ON FUNCTION agua_gps_faixa(numeric) IS
  'Classifica a distância (m) entre o GPS do aparelho e a coordenada cadastrada do ponto: confirmado ≤30m, atencao 30-150m, divergente >150m, NULL sem leitura. Nunca bloqueia salvamento — só alimenta o indicador visual.';

REVOKE ALL ON FUNCTION agua_gps_faixa(numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION agua_gps_faixa(numeric) TO authenticated;

-- ── View: acrescenta distância + faixa (sempre no FINAL — CREATE OR
-- REPLACE VIEW só aceita coluna nova no fim, lição da migration 260) ──
CREATE OR REPLACE VIEW vw_agua_coletas_detalhe
WITH (security_invoker = true) AS
SELECT
  c.id, c.ponto_id, c.campanha_id, c.laboratorio_id, c.data_coleta, c.hora_coleta,
  c.coletor_id, c.coletor_nome, c.localizacao, c.foto_url, c.laudo_url,
  c.temp_ar, c.temp_amostra, c.ph, c.od, c.turbidez, c.condutividade_eletrica,
  c.dbo, c.nitrogenio_total, c.nitrogenio_amoniacal, c.nitratos, c.fosforo_total,
  c.ortofosfato_dissolvido, c.solidos_dissolvidos_totais, c.solidos_suspensao_totais,
  c.coliformes_termotolerantes, c.coliformes_totais, c.escherichia_coli,
  c.alcalinidade_total, c.carbono_organico_total, c.cloreto,
  c.condutividade_especifica, c.descarga_liquida, c.censurados, c.status,
  c.quarentena_motivo, c.observacoes, c.linha_origem_planilha, c.criado_por,
  c.criado_em, c.atualizado_em,
  p.codigo_ana, p.nome AS ponto_nome, p.municipio AS ponto_municipio,
  p.rio AS ponto_rio, p.bacia AS ponto_bacia, p.classe_enquadramento, p.uc_id,
  ST_Y(p.geom) AS ponto_lat, ST_X(p.geom) AS ponto_lng,
  ca.ano AS campanha_ano, ca.ordem AS campanha_ordem,
  l.nome AS laboratorio_nome,
  ST_Y(c.localizacao) AS lat, ST_X(c.localizacao) AS lng,
  CASE WHEN c.temp_ar IS NOT NULL AND c.temp_amostra IS NOT NULL
       THEN abs(c.temp_amostra - c.temp_ar) ELSE NULL::numeric END AS delta_temperatura,
  (c.temp_ar IS NULL OR c.temp_amostra IS NULL) AS delta_temperatura_neutro,
  agua_od_saturacao(c.od, c.temp_amostra) AS od_saturacao,
  CASE WHEN c.solidos_dissolvidos_totais IS NOT NULL OR c.solidos_suspensao_totais IS NOT NULL
       THEN COALESCE(c.solidos_dissolvidos_totais,0) + COALESCE(c.solidos_suspensao_totais,0)
       ELSE NULL::numeric END AS solidos_totais,
  agua_calcular_iqa(
    agua_od_saturacao(c.od, c.temp_amostra), c.coliformes_termotolerantes, c.ph, c.dbo,
    c.nitrogenio_total, c.fosforo_total,
    CASE WHEN c.temp_ar IS NOT NULL AND c.temp_amostra IS NOT NULL
         THEN abs(c.temp_amostra - c.temp_ar) ELSE NULL::numeric END,
    c.turbidez,
    CASE WHEN c.solidos_dissolvidos_totais IS NOT NULL OR c.solidos_suspensao_totais IS NOT NULL
         THEN COALESCE(c.solidos_dissolvidos_totais,0) + COALESCE(c.solidos_suspensao_totais,0)
         ELSE NULL::numeric END
  ) AS iqa,
  agua_iqa_faixa(agua_calcular_iqa(
    agua_od_saturacao(c.od, c.temp_amostra), c.coliformes_termotolerantes, c.ph, c.dbo,
    c.nitrogenio_total, c.fosforo_total,
    CASE WHEN c.temp_ar IS NOT NULL AND c.temp_amostra IS NOT NULL
         THEN abs(c.temp_amostra - c.temp_ar) ELSE NULL::numeric END,
    c.turbidez,
    CASE WHEN c.solidos_dissolvidos_totais IS NOT NULL OR c.solidos_suspensao_totais IS NOT NULL
         THEN COALESCE(c.solidos_dissolvidos_totais,0) + COALESCE(c.solidos_suspensao_totais,0)
         ELSE NULL::numeric END
  )) AS iqa_faixa,
  agua_conama_violacoes(p.classe_enquadramento, c.od, c.dbo, c.turbidez, c.coliformes_termotolerantes, c.ph, c.fosforo_total) AS conama_violacoes,
  CASE WHEN agua_conama_violacoes(p.classe_enquadramento, c.od, c.dbo, c.turbidez, c.coliformes_termotolerantes, c.ph, c.fosforo_total) IS NULL THEN NULL::boolean
       ELSE cardinality(agua_conama_violacoes(p.classe_enquadramento, c.od, c.dbo, c.turbidez, c.coliformes_termotolerantes, c.ph, c.fosforo_total)) = 0
  END AS conama_conforme,
  c.codigo_amostra,
  c.excluido_em, c.excluido_por, c.exclusao_justificativa,
  CASE WHEN c.localizacao IS NULL THEN NULL::numeric
       ELSE ST_Distance(c.localizacao::geography, p.geom::geography)::numeric END AS distancia_ponto_metros,
  agua_gps_faixa(CASE WHEN c.localizacao IS NULL THEN NULL::numeric
       ELSE ST_Distance(c.localizacao::geography, p.geom::geography)::numeric END) AS gps_confirmacao
FROM agua_coletas c
JOIN agua_pontos_coleta p ON p.id = c.ponto_id
JOIN agua_campanhas ca ON ca.id = c.campanha_id
LEFT JOIN agua_laboratorios l ON l.id = c.laboratorio_id
WHERE c.excluido_em IS NULL;
