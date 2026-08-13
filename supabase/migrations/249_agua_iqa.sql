-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Qualidade da Água — cálculo do IQA e conformidade
-- CONAMA. Fase 0 do plano em docs/qualidade-agua/plano.md
--
-- ESTA MIGRATION É A DEFINIÇÃO ÚNICA DO CÁLCULO
-- `agua_calcular_iqa()` é o único lugar do sistema onde o IQA é
-- calculado. NENHUMA página reimplementa a conta em JavaScript —
-- mesma lição de `js/frota-consumo.js` (que nasceu de três cópias do
-- mesmo bloco com o mesmo bug) e de `js/mapa-recorte.js`. Tela nova
-- que precise do índice lê a view; não recalcula.
--
-- MÉTODO
-- IQA CETESB/ANA de 9 parâmetros: média geométrica ponderada dos
-- `q_i`, cada `q_i` lido por interpolação linear na curva de
-- qualidade do parâmetro. As curvas estão em
-- `docs/qualidade-agua/curvas-iqa.json` e os valores aqui são a
-- versão REFINADA na Fase 0 (ver abaixo).
--
-- REFINO DAS CURVAS — o que mudou e por quê
-- As curvas do JSON foram digitalizadas dos gráficos publicados, e a
-- digitalização carrega erro de leitura. Rodadas contra as 268 linhas
-- que já têm IQA na série histórica, davam erro mediano de 1,75
-- ponto. Os valores `q` dos nós foram ajustados por otimização
-- coordenada a coordenada, com DUAS restrições: (a) a forma da curva
-- é preservada (monotonicidade por trecho — só pH, OD-saturação e
-- sólidos têm pico); (b) nenhum nó se afasta mais de 5 pontos do
-- valor digitalizado, para que a curva continue sendo a da CETESB e
-- não uma regressão livre sobre a planilha.
-- Resultado: erro mediano 0,69 ponto no conjunto inteiro. O ganho
-- NÃO é sobreajuste — em validação cruzada (metade treina, metade
-- valida), o erro mediano fora da amostra cai de 1,72 para 1,21.
-- A curva de ΔT não se moveu: a série histórica nunca usou ΔT, então
-- não há sinal nela para ajustar — o que também serve de aferição de
-- que o procedimento não inventa ajuste onde não há evidência.
-- O guarda que trava tudo isso é `tests/agua-iqa.test.js`.
--
-- ATENÇÃO — A SÉRIE HISTÓRICA NÃO USAVA ΔT
-- Descoberto ao reproduzir o baseline: os 1,75 do plano só batem com
-- o ΔT no `q` neutro. Ou seja, os dez anos de IQA da planilha foram
-- calculados SEM o termo de temperatura (os coletores mediam `Temp
-- Ar` e ninguém usava). Isso não invalida a decisão de adotar ΔT —
-- invalida comparar os dois números como se fossem a mesma conta. Por
-- isso a view marca `delta_temperatura_neutro`, e o teste de
-- regressão compara com ΔT neutro (mesmo método da planilha) e mede à
-- parte o efeito de ligar o termo.
--
-- OD: mg/L É O DADO, SATURAÇÃO É DERIVADA
-- A curva do IQA é sobre % de saturação, mas o que o coletor mede é
-- mg/L. `agua_od_saturacao()` faz a conversão pela temperatura da
-- amostra e a view a aplica — nada de gravar a saturação. (Medido: a
-- coluna "OD (%)" da planilha, presente em 243 das 268 linhas, bate
-- com o valor derivado com diferença mediana de 1,03 ponto
-- percentual, então ela também era derivada.)
-- ═══════════════════════════════════════════════════════════

-- ── 1. Solubilidade do oxigênio e saturação ───────────────────
CREATE OR REPLACE FUNCTION agua_od_saturacao(p_od_mg_l numeric, p_temp_c numeric)
RETURNS numeric
LANGUAGE sql IMMUTABLE SET search_path = public
AS $$
  -- Cs = solubilidade do O2 em água doce ao nível do mar (mg/L).
  -- Os pontos de coleta do Acre vão de 122 a 264 m de altitude — a
  -- correção barométrica seria de 1,4% a 3%, dentro do erro da
  -- própria curva. Fica registrado como simplificação consciente.
  SELECT CASE
    WHEN p_od_mg_l IS NULL OR p_temp_c IS NULL THEN NULL
    WHEN p_temp_c < 0 OR p_temp_c > 45 THEN NULL   -- temperatura impossível: não inventa saturação
    ELSE p_od_mg_l / NULLIF(
      14.652 - 0.41022 * p_temp_c
             + 0.007991 * p_temp_c ^ 2
             - 0.000077774 * p_temp_c ^ 3, 0) * 100
  END;
$$;

COMMENT ON FUNCTION agua_od_saturacao(numeric, numeric) IS
  'Converte OD em mg/L para % de saturação pela temperatura da amostra. Sem correção de altitude (ver migration 249).';

-- ── 2. Curvas de qualidade q_i ────────────────────────────────
CREATE OR REPLACE FUNCTION agua_iqa_q(p_curva text, p_x numeric)
RETURNS numeric
LANGUAGE plpgsql IMMUTABLE SET search_path = public
AS $$
DECLARE
  xs numeric[];
  qs numeric[];
  x  numeric := p_x;
  i  int;
BEGIN
  IF p_x IS NULL THEN RETURN NULL; END IF;

  CASE p_curva
    WHEN 'od_saturacao' THEN
      xs := ARRAY[0,10,20,30,40,50,60,70,80,90,100,110,120,130,140,150,200]::numeric[];
      qs := ARRAY[3,6,14,21,26,42.5,57,71,82,93,98.5,99.5,96,83,77,70,52]::numeric[];
    WHEN 'coliformes_termotolerantes' THEN
      -- Interpolação em escala LOG10 — a curva cobre cinco ordens de
      -- grandeza; linear achataria tudo abaixo de 10.000.
      xs := ARRAY[1,10,100,1000,5000,20000,100000]::numeric[];
      qs := ARRAY[100,76,50,24,10,5,3]::numeric[];
      x  := log(10, GREATEST(x, 0.001));
      SELECT array_agg(log(10, GREATEST(v, 0.001)) ORDER BY o) INTO xs
        FROM unnest(xs) WITH ORDINALITY AS t(v, o);
    WHEN 'ph' THEN
      xs := ARRAY[2,3,4,5,6,6.5,7,7.5,8,8.5,9,10,11,12,14]::numeric[];
      qs := ARRAY[1,3,4,27,55,76.5,91,93.5,84,73,44,20,5,3,3]::numeric[];
    WHEN 'dbo' THEN
      xs := ARRAY[0,2,4,6,8,10,15,20,30,50]::numeric[];
      qs := ARRAY[99,80,64,46,39,28.5,17,11,6,3]::numeric[];
    WHEN 'nitrogenio_total' THEN
      xs := ARRAY[0,1,2,4,6,10,20,50,100]::numeric[];
      qs := ARRAY[95,83,76.5,50,34,18,10,5,1]::numeric[];
    WHEN 'fosforo_total' THEN
      xs := ARRAY[0,0.05,0.1,0.2,0.3,0.5,1,2,5,10]::numeric[];
      qs := ARRAY[96,82,61,50,38,28,12,8,5,2]::numeric[];
    WHEN 'delta_temperatura' THEN
      xs := ARRAY[0,1,2,3,4,5,6,8,10,15]::numeric[];
      qs := ARRAY[94,92,89,86,82,76,70,58,48,30]::numeric[];
      x  := abs(x);
    WHEN 'turbidez' THEN
      xs := ARRAY[0,5,10,20,40,60,80,100,150,200,300,500,1000]::numeric[];
      qs := ARRAY[99,89,87,74,60,44,38.5,29,24,13,8,7,7]::numeric[];
    WHEN 'solidos_totais' THEN
      xs := ARRAY[0,50,100,150,200,300,400,500,600,700,1000,1500]::numeric[];
      qs := ARRAY[79.5,88,90.5,88.5,81.5,79,64,54,42,32,20,10]::numeric[];
    ELSE
      RAISE EXCEPTION 'agua_iqa_q: curva desconhecida %', p_curva;
  END CASE;

  -- Saturação nos extremos: fora da faixa medida a curva não é
  -- extrapolada — o último q vale para todo o resto.
  IF x <= xs[1] THEN RETURN qs[1]; END IF;
  IF x >= xs[array_length(xs,1)] THEN RETURN qs[array_length(qs,1)]; END IF;

  FOR i IN 1 .. array_length(xs,1) - 1 LOOP
    IF x <= xs[i+1] THEN
      RETURN qs[i] + (qs[i+1] - qs[i]) * (x - xs[i]) / (xs[i+1] - xs[i]);
    END IF;
  END LOOP;

  RETURN qs[array_length(qs,1)];
END;
$$;

COMMENT ON FUNCTION agua_iqa_q(text, numeric) IS
  'Curva de qualidade q_i do IQA CETESB, interpolada linearmente. Valores refinados na Fase 0 (ver cabeçalho da migration 249).';

-- ── 3. O cálculo ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION agua_calcular_iqa(
  p_od_saturacao              numeric,
  p_coliformes_termotolerantes numeric,
  p_ph                        numeric,
  p_dbo                       numeric,
  p_nitrogenio_total          numeric,
  p_fosforo_total             numeric,
  p_delta_temperatura         numeric,
  p_turbidez                  numeric,
  p_solidos_totais            numeric
)
RETURNS numeric
LANGUAGE plpgsql IMMUTABLE SET search_path = public
AS $$
DECLARE
  -- Pesos do IQA CETESB; somam 1 quando os 9 parâmetros existem.
  w_od    CONSTANT numeric := 0.17;
  w_coli  CONSTANT numeric := 0.15;
  w_ph    CONSTANT numeric := 0.12;
  w_dbo   CONSTANT numeric := 0.10;
  w_n     CONSTANT numeric := 0.10;
  w_p     CONSTANT numeric := 0.10;
  w_dt    CONSTANT numeric := 0.10;
  w_turb  CONSTANT numeric := 0.08;
  w_sol   CONSTANT numeric := 0.08;
  -- q neutro do ΔT quando não há temperatura do ar (6% da série).
  q_dt_neutro CONSTANT numeric := 94;
  -- Abaixo disto não é IQA, é palpite: um índice montado com dois
  -- parâmetros não é comparável com um de nove. Devolve NULL, e a
  -- tela mostra "sem índice" em vez de um número que engana.
  peso_minimo CONSTANT numeric := 0.60;

  soma_ln   numeric := 0;   -- soma de w_i * ln(q_i)
  soma_w    numeric := 0;   -- peso total efetivamente usado
  soma_w_medido numeric := 0;  -- idem, sem contar o ΔT neutro
  q         numeric;
BEGIN
  IF p_od_saturacao IS NOT NULL THEN
    q := agua_iqa_q('od_saturacao', p_od_saturacao);
    soma_ln := soma_ln + w_od * ln(GREATEST(q, 1)); soma_w := soma_w + w_od;
    soma_w_medido := soma_w_medido + w_od;
  END IF;
  IF p_coliformes_termotolerantes IS NOT NULL THEN
    q := agua_iqa_q('coliformes_termotolerantes', p_coliformes_termotolerantes);
    soma_ln := soma_ln + w_coli * ln(GREATEST(q, 1)); soma_w := soma_w + w_coli;
    soma_w_medido := soma_w_medido + w_coli;
  END IF;
  IF p_ph IS NOT NULL THEN
    q := agua_iqa_q('ph', p_ph);
    soma_ln := soma_ln + w_ph * ln(GREATEST(q, 1)); soma_w := soma_w + w_ph;
    soma_w_medido := soma_w_medido + w_ph;
  END IF;
  IF p_dbo IS NOT NULL THEN
    q := agua_iqa_q('dbo', p_dbo);
    soma_ln := soma_ln + w_dbo * ln(GREATEST(q, 1)); soma_w := soma_w + w_dbo;
    soma_w_medido := soma_w_medido + w_dbo;
  END IF;
  IF p_nitrogenio_total IS NOT NULL THEN
    q := agua_iqa_q('nitrogenio_total', p_nitrogenio_total);
    soma_ln := soma_ln + w_n * ln(GREATEST(q, 1)); soma_w := soma_w + w_n;
    soma_w_medido := soma_w_medido + w_n;
  END IF;
  IF p_fosforo_total IS NOT NULL THEN
    q := agua_iqa_q('fosforo_total', p_fosforo_total);
    soma_ln := soma_ln + w_p * ln(GREATEST(q, 1)); soma_w := soma_w + w_p;
    soma_w_medido := soma_w_medido + w_p;
  END IF;
  -- ΔT sempre entra: medido quando há temperatura do ar, neutro
  -- quando não há. Deixá-lo de fora mudaria o peso de todos os outros
  -- e faria a série de antes e a de depois deixarem de ser comparáveis.
  q := COALESCE(agua_iqa_q('delta_temperatura', p_delta_temperatura), q_dt_neutro);
  soma_ln := soma_ln + w_dt * ln(q); soma_w := soma_w + w_dt;
  IF p_delta_temperatura IS NOT NULL THEN
    soma_w_medido := soma_w_medido + w_dt;
  END IF;
  IF p_turbidez IS NOT NULL THEN
    q := agua_iqa_q('turbidez', p_turbidez);
    soma_ln := soma_ln + w_turb * ln(GREATEST(q, 1)); soma_w := soma_w + w_turb;
    soma_w_medido := soma_w_medido + w_turb;
  END IF;
  IF p_solidos_totais IS NOT NULL THEN
    q := agua_iqa_q('solidos_totais', p_solidos_totais);
    soma_ln := soma_ln + w_sol * ln(GREATEST(q, 1)); soma_w := soma_w + w_sol;
    soma_w_medido := soma_w_medido + w_sol;
  END IF;

  IF soma_w_medido < peso_minimo THEN
    RETURN NULL;
  END IF;

  -- Média geométrica ponderada, com os pesos RENORMALIZADOS pelo que
  -- existe. Sem renormalizar, faltar um parâmetro puxaria o índice
  -- para baixo como se o rio tivesse piorado.
  RETURN round(exp(soma_ln / soma_w)::numeric, 2);
END;
$$;

COMMENT ON FUNCTION agua_calcular_iqa(numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric) IS
  'Definição ÚNICA do IQA no SIGUC. Nenhuma página reimplementa a conta — ver cabeçalho da migration 249 e tests/agua-iqa.test.js.';

-- ── 4. Faixa de classificação ─────────────────────────────────
-- A faixa é DERIVADA, nunca digitada: na planilha, 9 das 268
-- classificações divergiam do próprio valor (IQA 44,15 marcado como
-- BOA). Aqui isso deixa de ser possível.
CREATE OR REPLACE FUNCTION agua_iqa_faixa(p_iqa numeric)
RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = public
AS $$
  SELECT CASE
    WHEN p_iqa IS NULL THEN NULL
    WHEN p_iqa >= 79 THEN 'Ótima'
    WHEN p_iqa >= 51 THEN 'Boa'
    WHEN p_iqa >= 36 THEN 'Regular'
    WHEN p_iqa >= 19 THEN 'Ruim'
    ELSE 'Péssima'
  END;
$$;

-- ── 5. Limites CONAMA 357/2005 ────────────────────────────────
-- TABELA, e não CASE dentro de uma função, por dois motivos: (a) só
-- os limites da Classe 2 estão validados no plano — as outras classes
-- entram por INSERT quando alguém conferir a resolução, sem migration
-- de código; (b) enquadramento é ato administrativo, e o dia em que
-- um trecho for reenquadrado a mudança é de dado, não de deploy.
CREATE TABLE IF NOT EXISTS agua_limites_conama (
  classe     classe_enquadramento_agua NOT NULL,
  parametro  text NOT NULL,
  operador   text NOT NULL CHECK (operador IN ('>=','<=','entre')),
  valor      numeric,
  valor_min  numeric,
  valor_max  numeric,
  unidade    text NOT NULL,
  fonte      text NOT NULL DEFAULT 'CONAMA 357/2005',
  observacao text,
  PRIMARY KEY (classe, parametro),
  CONSTRAINT ck_agua_limite_valores CHECK (
    (operador = 'entre' AND valor_min IS NOT NULL AND valor_max IS NOT NULL)
    OR (operador <> 'entre' AND valor IS NOT NULL)
  )
);

ALTER TABLE agua_limites_conama ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS agua_limites_select ON agua_limites_conama;
CREATE POLICY agua_limites_select ON agua_limites_conama
  FOR SELECT USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS agua_limites_admin ON agua_limites_conama;
CREATE POLICY agua_limites_admin ON agua_limites_conama
  FOR ALL USING (is_super_admin()) WITH CHECK (is_super_admin());

INSERT INTO agua_limites_conama (classe, parametro, operador, valor, valor_min, valor_max, unidade, observacao) VALUES
  ('classe_2','od',                        '>=',    5, NULL, NULL, 'mg/L',        'Não inferior a 5 mg/L O2'),
  ('classe_2','dbo',                       '<=',    5, NULL, NULL, 'mg/L',        'DBO 5 dias a 20 °C'),
  ('classe_2','turbidez',                  '<=',  100, NULL, NULL, 'UNT',         NULL),
  ('classe_2','coliformes_termotolerantes','<=', 1000, NULL, NULL, 'NMP/100 mL',  'Limite para uso menos restritivo (dessedentação/irrigação)'),
  ('classe_2','ph',                     'entre', NULL,    6,    9, 'adimensional', NULL),
  ('classe_2','fosforo_total',             '<=',  0.1, NULL, NULL, 'mg/L',        'Ambiente lótico')
ON CONFLICT (classe, parametro) DO NOTHING;

-- ── 6. Violações de conformidade ──────────────────────────────
-- Devolve a LISTA de parâmetros violados, não um booleano: a
-- conformidade é leitura de fiscalização e a pergunta que ela responde
-- é "o que está fora", não "está tudo bem". Array vazio = conforme;
-- NULL = a classe do ponto não tem limites cadastrados (não é o mesmo
-- que conforme, e a tela não pode confundir os dois).
CREATE OR REPLACE FUNCTION agua_conama_violacoes(
  p_classe                     classe_enquadramento_agua,
  p_od                         numeric,
  p_dbo                        numeric,
  p_turbidez                   numeric,
  p_coliformes_termotolerantes numeric,
  p_ph                         numeric,
  p_fosforo_total              numeric
)
RETURNS text[]
LANGUAGE plpgsql STABLE SET search_path = public
AS $$
DECLARE
  r        record;
  medido   numeric;
  fora     text[] := '{}';
  tem_limite boolean := false;
BEGIN
  FOR r IN SELECT * FROM agua_limites_conama WHERE classe = p_classe LOOP
    tem_limite := true;
    medido := CASE r.parametro
      WHEN 'od'                         THEN p_od
      WHEN 'dbo'                        THEN p_dbo
      WHEN 'turbidez'                   THEN p_turbidez
      WHEN 'coliformes_termotolerantes' THEN p_coliformes_termotolerantes
      WHEN 'ph'                         THEN p_ph
      WHEN 'fosforo_total'              THEN p_fosforo_total
      ELSE NULL
    END;
    CONTINUE WHEN medido IS NULL;   -- não medido não é violação

    IF (r.operador = '>='    AND medido <  r.valor)
    OR (r.operador = '<='    AND medido >  r.valor)
    OR (r.operador = 'entre' AND (medido < r.valor_min OR medido > r.valor_max)) THEN
      fora := fora || r.parametro;
    END IF;
  END LOOP;

  IF NOT tem_limite THEN RETURN NULL; END IF;
  RETURN fora;
END;
$$;

-- ── 7. View de detalhe ────────────────────────────────────────
-- SECURITY INVOKER (padrão do projeto desde a migration 165): a view
-- não amplia privilégio, quem manda é a RLS de `agua_coletas`.
DROP VIEW IF EXISTS vw_agua_coletas_detalhe;
CREATE VIEW vw_agua_coletas_detalhe
WITH (security_invoker = true) AS
SELECT
  c.*,

  p.codigo_ana,
  p.nome            AS ponto_nome,
  p.municipio       AS ponto_municipio,
  p.rio             AS ponto_rio,
  p.bacia           AS ponto_bacia,
  p.classe_enquadramento,
  p.uc_id,
  ST_Y(p.geom)      AS ponto_lat,
  ST_X(p.geom)      AS ponto_lng,

  ca.ano            AS campanha_ano,
  ca.ordem          AS campanha_ordem,

  l.nome            AS laboratorio_nome,

  -- Coordenada do aparelho no momento da coleta (padrão 047/053).
  ST_Y(c.localizacao) AS lat,
  ST_X(c.localizacao) AS lng,

  -- ── Derivados ──
  -- ΔT sai da view, não do banco: a referência decidida é `Temp Ar`,
  -- mas se a SEMA adotar ponto de controle a montante no futuro é
  -- troca de view, não migração de dados (plano, seção do ΔT).
  CASE WHEN c.temp_ar IS NOT NULL AND c.temp_amostra IS NOT NULL
       THEN abs(c.temp_amostra - c.temp_ar) END AS delta_temperatura,
  -- Marca as coletas que caíram no q neutro. Um gráfico que cruze
  -- essa fronteira de método precisa poder avisar.
  (c.temp_ar IS NULL OR c.temp_amostra IS NULL) AS delta_temperatura_neutro,

  agua_od_saturacao(c.od, c.temp_amostra) AS od_saturacao,

  CASE WHEN c.solidos_dissolvidos_totais IS NOT NULL
         OR c.solidos_suspensao_totais IS NOT NULL
       THEN COALESCE(c.solidos_dissolvidos_totais, 0) + COALESCE(c.solidos_suspensao_totais, 0)
  END AS solidos_totais,

  agua_calcular_iqa(
    agua_od_saturacao(c.od, c.temp_amostra),
    c.coliformes_termotolerantes,
    c.ph,
    c.dbo,
    c.nitrogenio_total,
    c.fosforo_total,
    CASE WHEN c.temp_ar IS NOT NULL AND c.temp_amostra IS NOT NULL
         THEN abs(c.temp_amostra - c.temp_ar) END,
    c.turbidez,
    CASE WHEN c.solidos_dissolvidos_totais IS NOT NULL
           OR c.solidos_suspensao_totais IS NOT NULL
         THEN COALESCE(c.solidos_dissolvidos_totais, 0) + COALESCE(c.solidos_suspensao_totais, 0)
    END
  ) AS iqa,

  agua_iqa_faixa(agua_calcular_iqa(
    agua_od_saturacao(c.od, c.temp_amostra),
    c.coliformes_termotolerantes, c.ph, c.dbo, c.nitrogenio_total, c.fosforo_total,
    CASE WHEN c.temp_ar IS NOT NULL AND c.temp_amostra IS NOT NULL
         THEN abs(c.temp_amostra - c.temp_ar) END,
    c.turbidez,
    CASE WHEN c.solidos_dissolvidos_totais IS NOT NULL
           OR c.solidos_suspensao_totais IS NOT NULL
         THEN COALESCE(c.solidos_dissolvidos_totais, 0) + COALESCE(c.solidos_suspensao_totais, 0)
    END
  )) AS iqa_faixa,

  -- Conformidade legal é leitura SEPARADA do índice: um rio pode ter
  -- IQA "Boa" e violar o limite de turbidez. As duas aparecem lado a
  -- lado — o índice para a série histórica, a conformidade para o
  -- papel de fiscalização.
  agua_conama_violacoes(p.classe_enquadramento, c.od, c.dbo, c.turbidez,
                        c.coliformes_termotolerantes, c.ph, c.fosforo_total) AS conama_violacoes,
  CASE
    WHEN agua_conama_violacoes(p.classe_enquadramento, c.od, c.dbo, c.turbidez,
                               c.coliformes_termotolerantes, c.ph, c.fosforo_total) IS NULL THEN NULL
    ELSE cardinality(agua_conama_violacoes(p.classe_enquadramento, c.od, c.dbo, c.turbidez,
                                           c.coliformes_termotolerantes, c.ph, c.fosforo_total)) = 0
  END AS conama_conforme

FROM agua_coletas c
JOIN agua_pontos_coleta p ON p.id = c.ponto_id
JOIN agua_campanhas    ca ON ca.id = c.campanha_id
LEFT JOIN agua_laboratorios l ON l.id = c.laboratorio_id;

-- ── 8. Permissões de execução ─────────────────────────────────
-- As quatro funções de cálculo são PURAS: não leem tabela, não tocam
-- auth.*, não são SECURITY DEFINER. Devolvem um número a partir de
-- números que o chamador já tem. Por isso podem ser executadas por
-- `anon` — é o que permite `tests/agua-iqa.test.js` rodar a regressão
-- contra a função DE VERDADE, em vez de contra uma cópia em
-- JavaScript que seria exatamente o que esta migration existe para
-- impedir. Não confundir com a superfície que as migrations 196/197
-- fecharam: aquelas eram funções SECURITY DEFINER que liam e
-- escreviam dado do Frota.
REVOKE ALL ON FUNCTION agua_iqa_q(text, numeric) FROM PUBLIC;
REVOKE ALL ON FUNCTION agua_od_saturacao(numeric, numeric) FROM PUBLIC;
REVOKE ALL ON FUNCTION agua_iqa_faixa(numeric) FROM PUBLIC;
REVOKE ALL ON FUNCTION agua_calcular_iqa(numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION agua_iqa_q(text, numeric) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION agua_od_saturacao(numeric, numeric) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION agua_iqa_faixa(numeric) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION agua_calcular_iqa(numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric) TO anon, authenticated;

-- `agua_conama_violacoes` LÊ TABELA (`agua_limites_conama`) — fica só
-- para autenticado, mesmo a tabela sendo de limites legais públicos.
-- ⚠ `REVOKE ... FROM PUBLIC` NÃO BASTA no Supabase: o projeto tem
-- `ALTER DEFAULT PRIVILEGES` concedendo EXECUTE em toda função nova do
-- schema public a anon/authenticated/service_role. Isso é uma
-- concessão NOMINAL a `anon`, que revogar PUBLIC não alcança —
-- conferido no `proacl` depois de aplicar. Tem que revogar do papel
-- pelo nome. (Vale para qualquer função nova deste projeto que não
-- deva ser anônima.)
REVOKE ALL ON FUNCTION agua_conama_violacoes(classe_enquadramento_agua,numeric,numeric,numeric,numeric,numeric,numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION agua_conama_violacoes(classe_enquadramento_agua,numeric,numeric,numeric,numeric,numeric,numeric) TO authenticated;
