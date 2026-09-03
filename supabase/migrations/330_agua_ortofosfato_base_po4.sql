-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Qualidade da Água — o alerta de ortofosfato passa a
-- respeitar a base PO4 do laudo. Segue a migration 329 (correção
-- de pH), da mesma conferência de planilha.
--
-- ACHADO 2 — ortofosfato × fósforo total: a regra de coerência
-- comparava os dois como se estivessem na mesma base. O laudo do
-- QUILAB (tests/fixtures/laudos/) mostra que NÃO estão — a coluna
-- UNIDADES é assimétrica:
--     Fosforo Total ............ mg/l P    (base declarada)
--     Ortofosfato Dissolvido ... mg/l      (SEM base declarada)
-- Reportar ortofosfato como o íon PO₄³⁻ inteiro é prática corrente do
-- Standard Methods 4500-P, e explica uma razão de até
-- 94,97/30,97 = 3,066 (massa molar PO₄ ÷ P) sem que haja erro nenhum.
-- O limiar passa de 1,2 para 3,066 × 1,2 ≈ 3,68.
-- Medido contra as 310 coletas comparáveis da série: 42 já eram
-- coerentes lendo como P, 52 deixam de alertar (eram falso positivo)
-- e 216 (69,7%) CONTINUAM incoerentes mesmo concedendo a base PO₄ —
-- a conversão é um teto, não uma explicação geral. Exemplo real dos
-- dois lados, nos laudos conferidos: 1.304/2025 (orto 0,08 · P 0,023,
-- razão 3,48) fica coerente; 1.347/2025 (orto 1,10 · P 0,028, razão
-- 39,3) segue 12,8× acima mesmo convertido.
-- Fica pendente de resposta do laboratório em que base o ortofosfato
-- é de fato reportado — a mensagem passa a mostrar a conversão para
-- que quem confere o laudo consiga decidir.
--
-- ═══════════════════════════════════════════════════════════

-- Recriada a partir do pg_get_functiondef() REAL de produção (não do
-- arquivo 302b local, que pode estar defasado — mesma cautela do
-- drift achado em vw_praias_biomonitor, migration 321). ÚNICA
-- mudança em relação ao que está em produção: o bloco do ortofosfato.
-- Assinatura idêntica, então CREATE OR REPLACE substitui de fato
-- (sem o overload acidental da 178/224).
CREATE OR REPLACE FUNCTION public.agua_avaliar_coleta(p_ponto_id uuid, p_ordem ordem_campanha_agua, p_valores jsonb, p_campanha_id uuid DEFAULT NULL::uuid, p_coleta_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_out     jsonb := '[]'::jsonb;
  v_base    jsonb := '{}'::jsonb;
  v_ctx     jsonb := '{}'::jsonb;
  v_b       jsonb;
  v_c       jsonb;
  v_par     text;
  v_val     numeric;
  v_classe  text;
  v_temp    numeric := NULLIF(p_valores->>'temp_amostra','')::numeric;
  v_acima   boolean;
  v_razao   numeric;
  v_pares   integer;
  v_juntos  integer;
  v_med     numeric;
  v_li      numeric;
  v_ls      numeric;
  v_tipo    text;
  v_nivel   text;
  v_msg     text;
  v_ph    numeric := NULLIF(p_valores->>'ph','')::numeric;
  v_alc   numeric := NULLIF(p_valores->>'alcalinidade_total','')::numeric;
  v_ct    numeric := NULLIF(p_valores->>'coliformes_totais','')::numeric;
  v_ctt   numeric := NULLIF(p_valores->>'coliformes_termotolerantes','')::numeric;
  v_ecoli numeric := NULLIF(p_valores->>'escherichia_coli','')::numeric;
  v_ntot  numeric := NULLIF(p_valores->>'nitrogenio_total','')::numeric;
  v_nam   numeric := NULLIF(p_valores->>'nitrogenio_amoniacal','')::numeric;
  v_nit   numeric := NULLIF(p_valores->>'nitratos','')::numeric;
  v_ptot  numeric := NULLIF(p_valores->>'fosforo_total','')::numeric;
  v_orto  numeric := NULLIF(p_valores->>'ortofosfato_dissolvido','')::numeric;
  v_sdt   numeric := NULLIF(p_valores->>'solidos_dissolvidos_totais','')::numeric;
  v_sst   numeric := NULLIF(p_valores->>'solidos_suspensao_totais','')::numeric;
  v_ce    numeric := NULLIF(p_valores->>'condutividade_eletrica','')::numeric;
  v_cesp  numeric := NULLIF(p_valores->>'condutividade_especifica','')::numeric;
  v_turb  numeric := NULLIF(p_valores->>'turbidez','')::numeric;
  -- Massa molar PO₄ (94,97) ÷ P (30,97). Ver ACHADO 2 no cabeçalho.
  c_po4_p  constant numeric := 3.066;
BEGIN
  IF p_valores IS NULL OR jsonb_typeof(p_valores) <> 'object' THEN RETURN v_out; END IF;

  SELECT COALESCE(jsonb_object_agg(b.parametro, jsonb_build_object(
           'base', b.base, 'n', b.n, 'mediana', b.mediana,
           'usual_inf', b.usual_inf, 'usual_sup', b.usual_sup,
           'lim_inf', b.lim_inf, 'lim_sup', b.lim_sup)), '{}'::jsonb)
    INTO v_base
    FROM vw_agua_baseline_ponto b
   WHERE b.ponto_id = p_ponto_id AND b.ordem = p_ordem;

  IF p_campanha_id IS NOT NULL THEN
    SELECT COALESCE(jsonb_object_agg(t.parametro, jsonb_build_object(
             'pares', t.pares, 'acima', t.acima, 'abaixo', t.abaixo)), '{}'::jsonb)
      INTO v_ctx
      FROM (
        SELECT l.parametro,
               count(*)                                   AS pares,
               count(*) FILTER (WHERE l.valor > b.lim_sup) AS acima,
               count(*) FILTER (WHERE l.valor < b.lim_inf) AS abaixo
          FROM vw_agua_valores_longos l
          JOIN vw_agua_baseline_ponto b
            ON b.ponto_id = l.ponto_id AND b.parametro = l.parametro AND b.ordem = p_ordem
         WHERE l.campanha_id = p_campanha_id
           AND l.ponto_id   <> p_ponto_id
           AND (p_coleta_id IS NULL OR l.coleta_id <> p_coleta_id)
           AND b.lim_inf IS NOT NULL
         GROUP BY l.parametro
      ) t;
  END IF;

  FOR v_par, v_val IN
    SELECT key, NULLIF(value,'')::numeric
    FROM jsonb_each_text(p_valores)
    WHERE NULLIF(value,'') IS NOT NULL
      AND value ~ '^-?[0-9]+(\.[0-9]+)?([eE][-+]?[0-9]+)?$'
  LOOP
    v_classe := agua_valor_plausivel(v_par, v_val, v_temp);
    IF v_classe = 'impossivel' THEN
      v_out := v_out || jsonb_build_object(
        'parametro', v_par, 'tipo', 'fisico', 'nivel', 'bloqueio',
        'mensagem', 'Valor fisicamente impossível para este parâmetro.');
      CONTINUE;
    ELSIF v_classe = 'improvavel' THEN
      v_out := v_out || jsonb_build_object(
        'parametro', v_par, 'tipo', 'serie', 'nivel', 'confirmar',
        'mensagem', 'Valor fora da faixa típica da série histórica.');
    END IF;

    v_b := v_base -> v_par;
    CONTINUE WHEN v_b IS NULL;
    v_li := (v_b->>'lim_inf')::numeric;
    v_ls := (v_b->>'lim_sup')::numeric;
    CONTINUE WHEN v_li IS NULL OR v_ls IS NULL;
    CONTINUE WHEN v_val >= v_li AND v_val <= v_ls;

    v_med   := (v_b->>'mediana')::numeric;
    v_acima := v_val > v_ls;
    v_tipo  := 'atipico';
    v_nivel := 'confirmar';

    IF v_med IS NOT NULL AND v_med > 0 THEN
      v_razao := v_val / v_med;
      IF (v_razao BETWEEN 300 AND 3000) OR (v_razao BETWEEN 1.0/3000 AND 1.0/300) THEN
        v_tipo := 'unidade';
      END IF;
    END IF;

    IF v_tipo = 'atipico' THEN
      v_c := v_ctx -> v_par;
      IF v_c IS NOT NULL THEN
        v_pares  := (v_c->>'pares')::integer;
        v_juntos := CASE WHEN v_acima THEN (v_c->>'acima')::integer ELSE (v_c->>'abaixo')::integer END;
        IF v_pares >= 3 AND v_juntos::numeric / v_pares >= 0.5 THEN
          v_tipo  := 'contexto';
          v_nivel := 'informar';
        END IF;
      END IF;
    END IF;

    v_msg := CASE v_tipo
      WHEN 'unidade'  THEN format('Valor ~%sx a mediana histórica deste ponto (%s) — confira a unidade do laudo.',
                                  round(GREATEST(v_razao, 1/NULLIF(v_razao,0))), agua_num_br(v_med))
      WHEN 'contexto' THEN format('%s do usual para este ponto, mas %s de %s outros pontos desta campanha também %s — provável evento hidrológico.',
                                  CASE WHEN v_acima THEN 'Acima' ELSE 'Abaixo' END,
                                  v_juntos, v_pares, CASE WHEN v_acima THEN 'subiram' ELSE 'caíram' END)
      ELSE format('%s da faixa histórica deste ponto (usual %s a %s; mediana %s).',
                  CASE WHEN v_acima THEN 'Acima' ELSE 'Abaixo' END,
                  agua_num_br((v_b->>'usual_inf')::numeric),
                  agua_num_br((v_b->>'usual_sup')::numeric),
                  agua_num_br(v_med))
    END;

    v_out := v_out || jsonb_build_object(
      'parametro', v_par, 'tipo', v_tipo, 'nivel', v_nivel, 'mensagem', v_msg,
      'base', v_b->>'base', 'n', (v_b->>'n')::integer,
      'referencia', jsonb_build_object(
        'mediana', v_med, 'usual_inf', (v_b->>'usual_inf')::numeric,
        'usual_sup', (v_b->>'usual_sup')::numeric, 'lim_inf', v_li, 'lim_sup', v_ls));
  END LOOP;

  IF v_ecoli IS NOT NULL AND v_ctt IS NOT NULL AND v_ecoli > v_ctt * 1.1 THEN
    v_out := v_out || jsonb_build_object('parametro','escherichia_coli','tipo','incoerente','nivel','confirmar',
      'mensagem', format('E. coli (%s) maior que coliformes termotolerantes (%s) — E. coli é subconjunto deles.',
                         agua_num_br(v_ecoli), agua_num_br(v_ctt)));
  END IF;
  IF v_ctt IS NOT NULL AND v_ct IS NOT NULL AND v_ctt > v_ct * 1.1 THEN
    v_out := v_out || jsonb_build_object('parametro','coliformes_termotolerantes','tipo','incoerente','nivel','confirmar',
      'mensagem', format('Coliformes termotolerantes (%s) acima dos totais (%s) — os termotolerantes são parte dos totais.',
                         agua_num_br(v_ctt), agua_num_br(v_ct)));
  END IF;
  IF v_ntot IS NOT NULL AND (COALESCE(v_nam,0) + COALESCE(v_nit,0)) > v_ntot * 1.2
     AND (v_nam IS NOT NULL OR v_nit IS NOT NULL) THEN
    v_out := v_out || jsonb_build_object('parametro','nitrogenio_total','tipo','incoerente','nivel','confirmar',
      'mensagem', format('Amoniacal (%s) + nitratos (%s) somam mais que o nitrogênio total (%s).',
                         agua_num_br(COALESCE(v_nam,0)), agua_num_br(COALESCE(v_nit,0)), agua_num_br(v_ntot)));
  END IF;
  -- Ortofosfato dissolvido × fósforo total. O laudo declara o fósforo
  -- como "mg/l P" e o ortofosfato só como "mg/l", sem base — logo o
  -- ortofosfato pode estar como o íon PO₄ inteiro, o que permite uma
  -- razão de até 3,066 sem erro nenhum. Só alerta acima disso, e a
  -- mensagem já mostra a conversão para quem confere o laudo decidir.
  IF v_orto IS NOT NULL AND v_ptot IS NOT NULL AND v_orto > v_ptot * c_po4_p * 1.2 THEN
    v_out := v_out || jsonb_build_object('parametro','ortofosfato_dissolvido','tipo','incoerente','nivel','confirmar',
      'mensagem', format('Ortofosfato dissolvido (%s) maior que o fósforo total (%s) — é fração dele. Mesmo lendo o ortofosfato como PO₄ (÷3,066 = %s mg/L P), continua acima. Confira a base do laudo.',
                         agua_num_br(v_orto), agua_num_br(v_ptot),
                         agua_num_br(round(v_orto / c_po4_p, 4))));
  END IF;
  IF v_sdt IS NOT NULL AND v_ce IS NOT NULL AND v_ce > 0 THEN
    v_razao := v_sdt / v_ce;
    IF v_razao < 0.3 OR v_razao > 1.2 THEN
      v_out := v_out || jsonb_build_object('parametro','solidos_dissolvidos_totais','tipo','unidade','nivel','confirmar',
        'mensagem', format('Sólidos dissolvidos (%s mg/L) fora da relação usual com a condutividade (%s µS/cm): razão %s, esperada entre 0,3 e 1,2.',
                           agua_num_br(v_sdt), agua_num_br(v_ce), agua_num_br(v_razao)));
    END IF;
  END IF;
  IF v_ce IS NOT NULL AND v_cesp IS NOT NULL AND v_ce > 0 AND v_cesp > 0
     AND (v_cesp / v_ce < 0.5 OR v_cesp / v_ce > 2.0) THEN
    v_out := v_out || jsonb_build_object('parametro','condutividade_especifica','tipo','incoerente','nivel','confirmar',
      'mensagem', format('Condutividade do laboratório (%s) e a medida em campo (%s) diferem mais que o dobro.',
                         agua_num_br(v_cesp), agua_num_br(v_ce)));
  END IF;
  IF v_sst IS NOT NULL AND v_turb IS NOT NULL AND v_turb > 10 AND v_sst > 0
     AND v_sst / v_turb < 0.01 THEN
    v_out := v_out || jsonb_build_object('parametro','solidos_suspensao_totais','tipo','unidade','nivel','confirmar',
      'mensagem', format('Sólidos em suspensão (%s) muito baixos para a turbidez medida (%s UNT) — provável valor em g/L lançado como mg/L.',
                         agua_num_br(v_sst), agua_num_br(v_turb)));
  END IF;
  IF v_ph IS NOT NULL AND v_alc IS NOT NULL AND v_ph < 5 AND v_alc > 50 THEN
    v_out := v_out || jsonb_build_object('parametro','ph','tipo','incoerente','nivel','confirmar',
      'mensagem', format('pH ácido (%s) com alcalinidade alta (%s mg/L) — a alcalinidade tamponaria o pH acima disso.',
                         agua_num_br(v_ph), agua_num_br(v_alc)));
  END IF;

  RETURN v_out;
END;
$function$;
