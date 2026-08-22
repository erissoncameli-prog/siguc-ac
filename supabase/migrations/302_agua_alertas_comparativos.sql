-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Qualidade da Água — alertas comparativos no lançamento
-- Entrega 1 do plano em docs/qualidade-agua/plano-leitura-laudo-e-alertas.md
--
-- O QUE ESTA MIGRATION CRIA
-- A malha que compara o valor sendo lançado com (a) o histórico do
-- próprio ponto, (b) os demais parâmetros da MESMA amostra e (c) a
-- própria campanha. `agua_valor_plausivel` (254) continua sendo a
-- checagem física de valor isolado; esta migration é a camada
-- comparativa que ela nunca teve.
--
-- POR QUE NO BANCO, E NÃO EM JS
-- Mesma razão da 254: limiar reimplementado numa tela é uma segunda
-- definição da mesma regra, que diverge no primeiro ajuste. Aqui há uma
-- exceção deliberada e limitada, documentada em §4.6 do plano: o app de
-- campo é offline-first e não pode depender de RPC para avisar. Por isso
-- `vw_agua_baseline_ponto` publica os NÚMEROS (limites já convertidos
-- para a unidade natural do parâmetro), o app os cacheia no IndexedDB, e
-- `js/agua-alertas.js` só COMPARA — nenhum limiar é escrito em
-- JavaScript, nenhuma conta de escala acontece fora daqui.
--
-- CALIBRAGEM MEDIDA, NÃO ARBITRADA
-- A barreira é de Tukey (quartis ± k×IQR), calculada em escala log para
-- os parâmetros multiplicativos (ver `agua_parametro_log`) — turbidez
-- vai de 13 a 1002 UNT nesta série, e uma barreira linear ou marcaria
-- tudo ou nada. `k` foi escolhido medindo a taxa de disparo contra as
-- 452 coletas de produção, separadas pelo que já se sabe delas:
--
--   k=3,0 → 12,2% das `completo` (limpas) × 22,0% das `quarentena`
--   k=4,0 →  6,1%                        × 13,9%
--   k=5,0 →  1,7%                        ×  8,6%
--
-- Em todos os cortes a barreira dispara ~2× mais na população que já se
-- sabe suspeita: o sinal é real. k=3,0 fica sob o teto de 15% de falso
-- alarme em dado limpo que o plano fixou, e é o adotado. Se aparecer
-- fadiga de alerta em uso real, subir para 4,0 é UPDATE de uma linha do
-- CASE — não redesenho.
--
-- O QUE ESTA MALHA NÃO FAZ
-- Violação de padrão CONAMA NÃO entra aqui. Turbidez de 300 UNT num rio
-- amazônico em cheia é resultado verdadeiro e grave; tratá-la como
-- suspeita de digitação ensina o técnico a ignorar avisos. Conformidade
-- continua sendo leitura própria (`agua_conama_violacoes`), exibida em
-- bloco separado — como o painel já faz.
-- ═══════════════════════════════════════════════════════════

-- ── 1. Escala de cada parâmetro ───────────────────────────────
-- Multiplicativo (log) × aditivo (linear). pH JÁ é logarítmico por
-- definição, e temperatura e OD têm faixa estreita e simétrica: os
-- quatro são tratados em escala linear. Todo o resto — concentração,
-- turbidez, condutividade, contagem de coliformes — varia por ordem de
-- grandeza e é tratado em log.
CREATE OR REPLACE FUNCTION agua_parametro_log(p_parametro text)
RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = public
AS $$
  SELECT p_parametro NOT IN ('ph','od','temp_ar','temp_amostra');
$$;

COMMENT ON FUNCTION agua_parametro_log(text) IS
  'true = parâmetro varia multiplicativamente e tem sua estatística robusta calculada em escala log. Definição única — não replicar em JS.';

-- ── 2. Valores em formato longo, já filtrados ─────────────────
-- Uma linha por (coleta, parâmetro). O filtro por
-- `agua_valor_plausivel` é o que impede a série de se envenenar: sem
-- ele, o pH 16,36 que a Fase 1 quarentenou entraria na base que decide
-- se um pH novo é atípico. Valor fisicamente impossível não descreve o
-- rio — descreve um erro, e erro não vira referência.
--
-- Linhas em `quarentena` CONTINUAM entrando (só 115 das 452 são
-- `completo`; excluí-las deixaria a base sem tamanho). Quem sustenta
-- essa escolha é a estatística robusta: quartis e IQR não se movem com
-- outlier, ao contrário de média e desvio padrão.
CREATE OR REPLACE VIEW vw_agua_valores_longos
WITH (security_invoker = true) AS
SELECT
  c.id            AS coleta_id,
  c.ponto_id,
  p.rio,
  c.campanha_id,
  ca.ordem,
  u.parametro,
  u.valor,
  CASE WHEN agua_parametro_log(u.parametro)
       THEN ln(GREATEST(u.valor, 0.0001))
       ELSE u.valor END AS v_escala
FROM agua_coletas c
JOIN agua_pontos_coleta p ON p.id = c.ponto_id
JOIN agua_campanhas    ca ON ca.id = c.campanha_id
CROSS JOIN LATERAL (VALUES
  ('ph', c.ph), ('od', c.od), ('temp_ar', c.temp_ar), ('temp_amostra', c.temp_amostra),
  ('turbidez', c.turbidez), ('condutividade_eletrica', c.condutividade_eletrica),
  ('dbo', c.dbo), ('nitrogenio_total', c.nitrogenio_total),
  ('nitrogenio_amoniacal', c.nitrogenio_amoniacal), ('nitratos', c.nitratos),
  ('fosforo_total', c.fosforo_total), ('ortofosfato_dissolvido', c.ortofosfato_dissolvido),
  ('solidos_dissolvidos_totais', c.solidos_dissolvidos_totais),
  ('solidos_suspensao_totais', c.solidos_suspensao_totais),
  ('coliformes_termotolerantes', c.coliformes_termotolerantes),
  ('coliformes_totais', c.coliformes_totais), ('escherichia_coli', c.escherichia_coli),
  ('alcalinidade_total', c.alcalinidade_total),
  ('carbono_organico_total', c.carbono_organico_total), ('cloreto', c.cloreto),
  ('condutividade_especifica', c.condutividade_especifica),
  ('descarga_liquida', c.descarga_liquida)
) u(parametro, valor)
WHERE u.valor IS NOT NULL
  AND agua_valor_plausivel(u.parametro, u.valor, c.temp_amostra) IS DISTINCT FROM 'impossivel';

-- ── 3. Baseline por ponto, com degradação DECLARADA ───────────
-- Quatro grãos, do mais específico ao mais geral. `n >= 8` é o mínimo
-- para um quartil dizer alguma coisa; abaixo disso a barreira seria
-- desenhada por três pontos e marcaria qualquer coisa.
--
-- Levantamento que motiva a degradação (§1 do plano): 13 dos 17 pontos
-- têm 29–33 coletas, mas 3 têm 13–14 e um tem 4. Um baseline que
-- assumisse n grande simplesmente não existiria para esses quatro
-- pontos — e "sem alerta nenhum" no ponto menos monitorado é o pior
-- lugar para ficar cego.
--
-- A coluna `base` existe para a MENSAGEM: "atípico para este ponto
-- (mediana 45, n=31)" é acionável, "valor atípico" não é. A tela é
-- obrigada a dizer de onde veio a referência.
CREATE OR REPLACE VIEW vw_agua_baseline_ponto
WITH (security_invoker = true) AS
WITH grade AS (
  SELECT p.id AS ponto_id, p.rio, par.parametro, o.ordem
  FROM agua_pontos_coleta p
  CROSS JOIN (SELECT DISTINCT parametro FROM vw_agua_valores_longos) par
  CROSS JOIN (SELECT unnest(enum_range(NULL::ordem_campanha_agua)) AS ordem) o
),
-- Grão 1: o ponto, na mesma metade do ano (proxy do regime
-- hidrológico — cheia × seca). É o grão certo: a mesma estação tem
-- turbidez de outra ordem de grandeza entre uma campanha e outra.
g_ponto_ordem AS (
  SELECT ponto_id, ordem, parametro, count(*) n,
         percentile_cont(0.25) WITHIN GROUP (ORDER BY v_escala) q1,
         percentile_cont(0.50) WITHIN GROUP (ORDER BY v_escala) med,
         percentile_cont(0.75) WITHIN GROUP (ORDER BY v_escala) q3,
         percentile_cont(0.10) WITHIN GROUP (ORDER BY v_escala) p10,
         percentile_cont(0.90) WITHIN GROUP (ORDER BY v_escala) p90
  FROM vw_agua_valores_longos GROUP BY 1,2,3
),
g_ponto AS (
  SELECT ponto_id, parametro, count(*) n,
         percentile_cont(0.25) WITHIN GROUP (ORDER BY v_escala) q1,
         percentile_cont(0.50) WITHIN GROUP (ORDER BY v_escala) med,
         percentile_cont(0.75) WITHIN GROUP (ORDER BY v_escala) q3,
         percentile_cont(0.10) WITHIN GROUP (ORDER BY v_escala) p10,
         percentile_cont(0.90) WITHIN GROUP (ORDER BY v_escala) p90
  FROM vw_agua_valores_longos GROUP BY 1,2
),
g_rio AS (
  SELECT rio, parametro, count(*) n,
         percentile_cont(0.25) WITHIN GROUP (ORDER BY v_escala) q1,
         percentile_cont(0.50) WITHIN GROUP (ORDER BY v_escala) med,
         percentile_cont(0.75) WITHIN GROUP (ORDER BY v_escala) q3,
         percentile_cont(0.10) WITHIN GROUP (ORDER BY v_escala) p10,
         percentile_cont(0.90) WITHIN GROUP (ORDER BY v_escala) p90
  FROM vw_agua_valores_longos GROUP BY 1,2
),
g_serie AS (
  SELECT parametro, count(*) n,
         percentile_cont(0.25) WITHIN GROUP (ORDER BY v_escala) q1,
         percentile_cont(0.50) WITHIN GROUP (ORDER BY v_escala) med,
         percentile_cont(0.75) WITHIN GROUP (ORDER BY v_escala) q3,
         percentile_cont(0.10) WITHIN GROUP (ORDER BY v_escala) p10,
         percentile_cont(0.90) WITHIN GROUP (ORDER BY v_escala) p90
  FROM vw_agua_valores_longos GROUP BY 1
),
escolhido AS (
  SELECT g.ponto_id, g.parametro, g.ordem,
         COALESCE(
           CASE WHEN a.n >= 8 THEN 'ponto_campanha' END,
           CASE WHEN b.n >= 8 THEN 'ponto'          END,
           CASE WHEN r.n >= 8 THEN 'rio'            END,
           CASE WHEN s.n >= 8 THEN 'serie'          END
         ) AS base,
         COALESCE(CASE WHEN a.n>=8 THEN a.n END, CASE WHEN b.n>=8 THEN b.n END,
                  CASE WHEN r.n>=8 THEN r.n END, CASE WHEN s.n>=8 THEN s.n END) AS n,
         COALESCE(CASE WHEN a.n>=8 THEN a.q1 END, CASE WHEN b.n>=8 THEN b.q1 END,
                  CASE WHEN r.n>=8 THEN r.q1 END, CASE WHEN s.n>=8 THEN s.q1 END) AS q1,
         COALESCE(CASE WHEN a.n>=8 THEN a.med END, CASE WHEN b.n>=8 THEN b.med END,
                  CASE WHEN r.n>=8 THEN r.med END, CASE WHEN s.n>=8 THEN s.med END) AS med,
         COALESCE(CASE WHEN a.n>=8 THEN a.q3 END, CASE WHEN b.n>=8 THEN b.q3 END,
                  CASE WHEN r.n>=8 THEN r.q3 END, CASE WHEN s.n>=8 THEN s.q3 END) AS q3,
         COALESCE(CASE WHEN a.n>=8 THEN a.p10 END, CASE WHEN b.n>=8 THEN b.p10 END,
                  CASE WHEN r.n>=8 THEN r.p10 END, CASE WHEN s.n>=8 THEN s.p10 END) AS p10,
         COALESCE(CASE WHEN a.n>=8 THEN a.p90 END, CASE WHEN b.n>=8 THEN b.p90 END,
                  CASE WHEN r.n>=8 THEN r.p90 END, CASE WHEN s.n>=8 THEN s.p90 END) AS p90
  FROM grade g
  LEFT JOIN g_ponto_ordem a ON a.ponto_id = g.ponto_id AND a.parametro = g.parametro AND a.ordem = g.ordem
  LEFT JOIN g_ponto       b ON b.ponto_id = g.ponto_id AND b.parametro = g.parametro
  LEFT JOIN g_rio         r ON r.rio      = g.rio      AND r.parametro = g.parametro
  LEFT JOIN g_serie       s ON s.parametro = g.parametro
)
SELECT
  ponto_id, parametro, ordem, base, n,
  -- Tudo devolvido na UNIDADE NATURAL do parâmetro: quem consome
  -- (RPC, mesa ou app offline) só compara números, nunca desfaz log.
  -- É isso que permite `js/agua-alertas.js` ser um comparador de três
  -- linhas em vez de uma segunda implementação da estatística.
  CASE WHEN agua_parametro_log(parametro) THEN exp(med) ELSE med END AS mediana,
  CASE WHEN agua_parametro_log(parametro) THEN exp(p10) ELSE p10 END AS usual_inf,
  CASE WHEN agua_parametro_log(parametro) THEN exp(p90) ELSE p90 END AS usual_sup,
  -- Barreira de Tukey com k=3,0 (ver cabeçalho). IQR zero significa
  -- série constante: devolve NULL em vez de uma barreira de largura
  -- zero, que marcaria qualquer valor novo como atípico.
  CASE WHEN base IS NULL OR q3 - q1 <= 0 THEN NULL
       WHEN agua_parametro_log(parametro) THEN exp(q1 - 3.0 * (q3 - q1))
       ELSE q1 - 3.0 * (q3 - q1) END AS lim_inf,
  CASE WHEN base IS NULL OR q3 - q1 <= 0 THEN NULL
       WHEN agua_parametro_log(parametro) THEN exp(q3 + 3.0 * (q3 - q1))
       ELSE q3 + 3.0 * (q3 - q1) END AS lim_sup
FROM escolhido
WHERE base IS NOT NULL;

COMMENT ON VIEW vw_agua_baseline_ponto IS
  'Faixa histórica esperada por ponto × parâmetro × ordem de campanha, em unidade natural. `base` diz qual grão sustentou o número (ponto_campanha > ponto > rio > serie) e `n` com quantas medidas — a tela é obrigada a mostrar os dois. Consumida pela RPC agua_avaliar_coleta e cacheada pelo app de campo.';

-- ── 4. A malha de avaliação ───────────────────────────────────
-- Devolve uma LISTA de alertas (array vazio = nada a apontar), no
-- mesmo espírito de `agua_conama_violacoes`: a pergunta que a tela faz
-- é "o que está estranho", não "está tudo bem".
--
-- Cada alerta tem `tipo` (por que disparou, define a mensagem) e
-- `nivel` (o que a tela faz com ele):
--   bloqueio  → mesa impede salvar. Só `fisico`.
--   confirmar → mesa pede confirmação explícita; app apenas mostra.
--   informar  → nunca interrompe ninguém.
-- NO APP DE CAMPO NADA BLOQUEIA — "nada pode impedir o trabalho de
-- campo" é regra do sistema. O nível `bloqueio` é lido só pela mesa.
--
-- `p_ordem` vem separado de `p_campanha_id` de propósito: o app deriva
-- a ordem do mês da coleta (`mes <= 6`) e sincroniza a campanha só
-- depois, então exigir `campanha_id` deixaria o campo sem alerta
-- comparativo justamente onde ele mais serve. Com `p_campanha_id`
-- presente, entra também o contexto de campanha (item 6 abaixo).
CREATE OR REPLACE FUNCTION agua_avaliar_coleta(
  p_ponto_id    uuid,
  p_ordem       ordem_campanha_agua,
  p_valores     jsonb,
  p_campanha_id uuid DEFAULT NULL,
  p_coleta_id   uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path = public
AS $$
DECLARE
  v_out     jsonb := '[]'::jsonb;
  v_par     text;
  v_val     numeric;
  v_classe  text;
  v_b       record;
  v_temp    numeric := NULLIF(p_valores->>'temp_amostra','')::numeric;
  v_acima   boolean;
  v_razao   numeric;
  v_pares   integer;
  v_juntos  integer;
  v_tipo    text;
  v_nivel   text;
  v_msg     text;

  -- Atalhos para as regras de coerência (item 5). NULL quando o
  -- parâmetro não veio — toda regra só dispara com os dois lados
  -- presentes.
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
BEGIN
  IF p_valores IS NULL OR jsonb_typeof(p_valores) <> 'object' THEN RETURN v_out; END IF;

  -- ══ Parte 1 — por parâmetro ══
  FOR v_par, v_val IN
    SELECT key, NULLIF(value,'')::numeric
    FROM jsonb_each_text(p_valores)
    WHERE NULLIF(value,'') IS NOT NULL
      AND value ~ '^-?[0-9]+(\.[0-9]+)?([eE][-+]?[0-9]+)?$'
  LOOP
    -- 1. Físico — a checagem que já existia (migration 254), agora
    -- devolvida no mesmo formato das demais para a tela ter uma lista só.
    v_classe := agua_valor_plausivel(v_par, v_val, v_temp);
    IF v_classe = 'impossivel' THEN
      v_out := v_out || jsonb_build_object(
        'parametro', v_par, 'tipo', 'fisico', 'nivel', 'bloqueio',
        'mensagem', 'Valor fisicamente impossível para este parâmetro.');
      CONTINUE;   -- valor impossível não merece ser comparado com histórico
    ELSIF v_classe = 'improvavel' THEN
      v_out := v_out || jsonb_build_object(
        'parametro', v_par, 'tipo', 'serie', 'nivel', 'confirmar',
        'mensagem', 'Valor fora da faixa típica da série histórica.');
    END IF;

    -- 2. Comparação com o histórico do próprio ponto.
    SELECT * INTO v_b FROM vw_agua_baseline_ponto
     WHERE ponto_id = p_ponto_id AND parametro = v_par AND ordem = p_ordem;

    IF NOT FOUND THEN CONTINUE; END IF;
    CONTINUE WHEN v_b.lim_inf IS NULL OR v_b.lim_sup IS NULL;
    CONTINUE WHEN v_val >= v_b.lim_inf AND v_val <= v_b.lim_sup;

    v_acima := v_val > v_b.lim_sup;
    v_tipo  := 'atipico';
    v_nivel := 'confirmar';

    -- 3. Erro de unidade: fator ~1000 contra a mediana do ponto é
    -- assinatura de g/L lançado como mg/L (ou o inverso) — a origem
    -- das 337 linhas em quarentena da Fase 1. Vale a pena separar de
    -- "atípico" porque a correção é outra: não é conferir o laudo, é
    -- conferir a unidade.
    IF v_b.mediana IS NOT NULL AND v_b.mediana > 0 THEN
      v_razao := v_val / v_b.mediana;
      IF (v_razao BETWEEN 300 AND 3000) OR (v_razao BETWEEN 1.0/3000 AND 1.0/300) THEN
        v_tipo := 'unidade';
      END IF;
    END IF;

    -- 4. Contexto de campanha: se os OUTROS pontos da mesma campanha
    -- também saíram da própria faixa no mesmo sentido, isso é evento
    -- hidrológico (cheia, estiagem), não erro de digitação — o alerta
    -- cai para informativo. Sem isso a primeira cheia dispararia 17
    -- alertas simultâneos, todos falsos, e a malha perderia a
    -- credibilidade na primeira semana de uso.
    IF v_tipo = 'atipico' AND p_campanha_id IS NOT NULL THEN
      SELECT count(*), count(*) FILTER (
               WHERE (v_acima AND l.valor > b.lim_sup) OR (NOT v_acima AND l.valor < b.lim_inf))
        INTO v_pares, v_juntos
        FROM vw_agua_valores_longos l
        JOIN vw_agua_baseline_ponto b
          ON b.ponto_id = l.ponto_id AND b.parametro = l.parametro AND b.ordem = p_ordem
       WHERE l.campanha_id = p_campanha_id
         AND l.parametro   = v_par
         AND l.ponto_id   <> p_ponto_id
         AND (p_coleta_id IS NULL OR l.coleta_id <> p_coleta_id)
         AND b.lim_inf IS NOT NULL;

      IF v_pares >= 3 AND v_juntos::numeric / v_pares >= 0.5 THEN
        v_tipo  := 'contexto';
        v_nivel := 'informar';
      END IF;
    END IF;

    v_msg := CASE v_tipo
      WHEN 'unidade'  THEN format('Valor ~%sx a mediana histórica deste ponto (%s) — confira a unidade do laudo.',
                                  to_char(GREATEST(v_razao, 1/NULLIF(v_razao,0)), 'FM999999'),
                                  to_char(v_b.mediana, 'FM999999990.0999'))
      WHEN 'contexto' THEN format('%s do usual para este ponto, mas %s de %s outros pontos desta campanha também %s — provável evento hidrológico.',
                                  CASE WHEN v_acima THEN 'Acima' ELSE 'Abaixo' END,
                                  v_juntos, v_pares, CASE WHEN v_acima THEN 'subiram' ELSE 'caíram' END)
      ELSE format('%s da faixa histórica deste ponto (usual %s a %s; mediana %s).',
                  CASE WHEN v_acima THEN 'Acima' ELSE 'Abaixo' END,
                  to_char(v_b.usual_inf, 'FM999999990.0999'),
                  to_char(v_b.usual_sup, 'FM999999990.0999'),
                  to_char(v_b.mediana,   'FM999999990.0999'))
    END;

    v_out := v_out || jsonb_build_object(
      'parametro', v_par, 'tipo', v_tipo, 'nivel', v_nivel, 'mensagem', v_msg,
      'base', v_b.base, 'n', v_b.n,
      'referencia', jsonb_build_object(
        'mediana', v_b.mediana, 'usual_inf', v_b.usual_inf, 'usual_sup', v_b.usual_sup,
        'lim_inf', v_b.lim_inf, 'lim_sup', v_b.lim_sup));
  END LOOP;

  -- ══ Parte 2 — coerência entre parâmetros da MESMA amostra ══
  -- Estas regras não olham histórico nenhum: são relações que a
  -- química da amostra obriga. Violada, a explicação mais provável é
  -- erro de transcrição — não poluição. Todas com folga generosa (são
  -- métodos analíticos diferentes, cada um com sua incerteza), e todas
  -- citando os DOIS valores que se contradizem: "incoerente" sozinho
  -- não diz a ninguém o que conferir.

  -- Subconjuntos por definição: E. coli ⊂ termotolerantes ⊂ totais.
  IF v_ecoli IS NOT NULL AND v_ctt IS NOT NULL AND v_ecoli > v_ctt * 1.1 THEN
    v_out := v_out || jsonb_build_object('parametro','escherichia_coli','tipo','incoerente','nivel','confirmar',
      'mensagem', format('E. coli (%s) maior que coliformes termotolerantes (%s) — E. coli é subconjunto deles.', v_ecoli, v_ctt));
  END IF;
  IF v_ctt IS NOT NULL AND v_ct IS NOT NULL AND v_ctt > v_ct * 1.1 THEN
    v_out := v_out || jsonb_build_object('parametro','coliformes_termotolerantes','tipo','incoerente','nivel','confirmar',
      'mensagem', format('Coliformes termotolerantes (%s) acima dos totais (%s) — os termotolerantes são parte dos totais.', v_ctt, v_ct));
  END IF;

  -- Frações do total (nitrogênio e fósforo).
  IF v_ntot IS NOT NULL AND (COALESCE(v_nam,0) + COALESCE(v_nit,0)) > v_ntot * 1.2
     AND (v_nam IS NOT NULL OR v_nit IS NOT NULL) THEN
    v_out := v_out || jsonb_build_object('parametro','nitrogenio_total','tipo','incoerente','nivel','confirmar',
      'mensagem', format('Amoniacal (%s) + nitratos (%s) somam mais que o nitrogênio total (%s).',
                         COALESCE(v_nam,0), COALESCE(v_nit,0), v_ntot));
  END IF;
  IF v_orto IS NOT NULL AND v_ptot IS NOT NULL AND v_orto > v_ptot * 1.2 THEN
    v_out := v_out || jsonb_build_object('parametro','ortofosfato_dissolvido','tipo','incoerente','nivel','confirmar',
      'mensagem', format('Ortofosfato dissolvido (%s) maior que o fósforo total (%s) — é fração dele.', v_orto, v_ptot));
  END IF;

  -- Sólidos dissolvidos × condutividade: a correlação clássica em água
  -- doce é SDT ≈ 0,55–0,75 × CE. Faixa alargada para 0,3–1,2 porque a
  -- constante varia com a composição iônica do rio. É o melhor
  -- detector de erro de unidade em sólidos que este banco permite.
  IF v_sdt IS NOT NULL AND v_ce IS NOT NULL AND v_ce > 0 THEN
    v_razao := v_sdt / v_ce;
    IF v_razao < 0.3 OR v_razao > 1.2 THEN
      v_out := v_out || jsonb_build_object('parametro','solidos_dissolvidos_totais','tipo','unidade','nivel','confirmar',
        'mensagem', format('Sólidos dissolvidos (%s mg/L) fora da relação usual com a condutividade (%s µS/cm): razão %s, esperada entre 0,3 e 1,2.',
                           v_sdt, v_ce, to_char(v_razao,'FM990.099')));
    END IF;
  END IF;

  -- Mesma grandeza medida duas vezes (sonda em campo × laboratório).
  IF v_ce IS NOT NULL AND v_cesp IS NOT NULL AND v_ce > 0 AND v_cesp > 0
     AND (v_cesp / v_ce < 0.5 OR v_cesp / v_ce > 2.0) THEN
    v_out := v_out || jsonb_build_object('parametro','condutividade_especifica','tipo','incoerente','nivel','confirmar',
      'mensagem', format('Condutividade do laboratório (%s) e a medida em campo (%s) diferem mais que o dobro.', v_cesp, v_ce));
  END IF;

  -- Sólidos em suspensão × turbidez. Em água natural a razão SST/UNT
  -- fica em ordem de grandeza próxima de 1; razão abaixo de 0,01 é a
  -- assinatura de g/L lançado como mg/L — exatamente a pendência que
  -- deixou 337 linhas em quarentena na Fase 1.
  IF v_sst IS NOT NULL AND v_turb IS NOT NULL AND v_turb > 10 AND v_sst > 0
     AND v_sst / v_turb < 0.01 THEN
    v_out := v_out || jsonb_build_object('parametro','solidos_suspensao_totais','tipo','unidade','nivel','confirmar',
      'mensagem', format('Sólidos em suspensão (%s) muito baixos para a turbidez medida (%s UNT) — provável valor em g/L lançado como mg/L.',
                         v_sst, v_turb));
  END IF;

  -- Tamponamento: alcalinidade alta não convive com pH ácido.
  IF v_ph IS NOT NULL AND v_alc IS NOT NULL AND v_ph < 5 AND v_alc > 50 THEN
    v_out := v_out || jsonb_build_object('parametro','ph','tipo','incoerente','nivel','confirmar',
      'mensagem', format('pH ácido (%s) com alcalinidade alta (%s mg/L) — a alcalinidade tamponaria o pH acima disso.', v_ph, v_alc));
  END IF;

  RETURN v_out;
END;
$$;

COMMENT ON FUNCTION agua_avaliar_coleta(uuid, ordem_campanha_agua, jsonb, uuid, uuid) IS
  'Lista de alertas comparativos de uma coleta: físico, faixa da série, atípico para o ponto, erro de unidade, coerência entre parâmetros e contexto de campanha. Array vazio = nada a apontar. Definição única — nenhuma tela reimplementa limiar. Violação CONAMA NÃO entra aqui de propósito (é resultado, não erro).';

-- ── 5. Permissões ─────────────────────────────────────────────
-- ⚠ `REVOKE ... FROM PUBLIC` não fecha nada neste projeto: o `ALTER
-- DEFAULT PRIVILEGES` concede EXECUTE a `anon` POR NOME em toda função
-- nova (lição das migrations 165/249/252b/297/299). Revogar do papel.
REVOKE ALL ON FUNCTION agua_parametro_log(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION agua_avaliar_coleta(uuid, ordem_campanha_agua, jsonb, uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION agua_parametro_log(text) FROM anon;
REVOKE EXECUTE ON FUNCTION agua_avaliar_coleta(uuid, ordem_campanha_agua, jsonb, uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION agua_parametro_log(text) TO authenticated;
GRANT EXECUTE ON FUNCTION agua_avaliar_coleta(uuid, ordem_campanha_agua, jsonb, uuid, uuid) TO authenticated;

-- As views herdam a RLS de `agua_coletas`/`agua_pontos_coleta`
-- (security_invoker), então quem não tem `pode_ver('agua')` não lê
-- nada por elas. `anon` não recebe GRANT nenhum: o painel público
-- (297/300) tem sua própria whitelist e não expõe baseline.
REVOKE ALL ON vw_agua_valores_longos  FROM anon;
REVOKE ALL ON vw_agua_baseline_ponto  FROM anon;
GRANT SELECT ON vw_agua_valores_longos TO authenticated;
GRANT SELECT ON vw_agua_baseline_ponto TO authenticated;
