-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Frota — capacidade sem ambiguidade + uma única
-- definição de "quantos veículos esse grupo precisa"
--
-- Sintoma relatado: viagem com 6 passageiros abria a aprovação com
-- UM veículo só e todos os 6 dentro. Só depois de o gestor escolher
-- um 2º veículo à mão a divisão ficava correta.
--
-- Causa 1 — `capacidade_passageiros` tinha DOIS significados na mesma
-- tabela. O rótulo do cadastro ("Capacidade (passageiros)") não dizia
-- se o motorista entra na conta, e os dados provam a confusão: Ônix
-- Plus (5 lugares de fábrica) cadastrado como 4, Amarok/L200/Triton
-- (também 5 lugares) cadastrados como 5. O código lê o número como
-- "passageiros que cabem", então uma caminhonete valia 5 passageiros
-- e um veículo só "cobria" o grupo inteiro. Aqui a coluna passa a ter
-- UM significado, documentado no COMMENT: passageiros ALÉM do
-- motorista. Os dados são corrigidos junto (cabine dupla 5 → 4).
--
-- Causa 2 — a escolha ordenava só por capacidade decrescente, sem
-- olhar o tipo. Por isso uma EMBARCAÇÃO (voadeira, capacidade 6) era
-- sugerida para viagem por estrada, e sozinha "cobria" 6 passageiros.
-- Motocicleta/quadriciclo sem capacidade preenchida ainda valiam 4
-- lugares pelo COALESCE. Passam todos a ficar fora da sugestão
-- AUTOMÁTICA — continuam selecionáveis à mão pelo gestor (viagem
-- fluvial existe; o que não pode é o sistema propor sozinho).
--
-- Causa 3 — a regra "quantos veículos são necessários" estava
-- duplicada em frota_sugerir_alocacao (192b) e em
-- frota_sugerir_motorista_escala (190, para saber quantos motoristas
-- sugerir). Duas cópias discordam. Agora existe UMA função,
-- frota_veiculos_para_grupo, e as duas a chamam — mesma lição do
-- js/frota-consumo.js.
--
-- Assinaturas das duas RPCs públicas ficam INALTERADAS → CREATE OR
-- REPLACE é seguro (regra do projeto: mudou parâmetro, DROP antes).
-- ═══════════════════════════════════════════════════════════

-- ── 1. Significado único da capacidade ─────────────────────────

COMMENT ON COLUMN frota_veiculos.capacidade_passageiros IS
  'Passageiros que o veículo transporta ALÉM do motorista. '
  'Caminhonete cabine dupla (5 lugares) = 4. Nunca inclui quem dirige.';

-- Corrige o que foi cadastrado como "lugares totais". Só mexe nos
-- casos comprovadamente ambíguos (cabine dupla registrada com a
-- lotação de fábrica) e no que estava em branco. O Ônix Plus já
-- estava certo (4) e não é tocado.
UPDATE frota_veiculos SET capacidade_passageiros = 4
 WHERE tipo = 'caminhonete' AND capacidade_passageiros = 5;

UPDATE frota_veiculos SET capacidade_passageiros = 3
 WHERE placa = 'NXT1030' AND capacidade_passageiros IS NULL;

-- ── 2. Uma definição de "quantos veículos esse grupo precisa" ───
-- Escolhe os veículos e já devolve a cota de cada um. Chamada só por
-- funções SECURITY DEFINER do próprio módulo (padrão da 196: fora do
-- catálogo do PostgREST, zero superfície anônima).
--
-- Divisão proporcional à capacidade pelo largest remainder method
-- (herdado da 192b): 6 passageiros em dois veículos de 4 dá 3 e 3,
-- nunca 4 e 2.

CREATE OR REPLACE FUNCTION frota_veiculos_para_grupo(
  p_inicio timestamptz,
  p_fim timestamptz,
  p_total int,
  p_incluir_dedicados boolean DEFAULT false
)
RETURNS TABLE(veiculo_id uuid, placa text, modelo text, capacidade int, cota int)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_total    int;
  v_soma_cap int := 0;
  v_alocado  int := 0;
  v_falta    int;
  v_idx_max  int;
  r          record;
  n          int;
  ids        uuid[]    := '{}';
  placas     text[]    := '{}';
  modelos    text[]    := '{}';
  caps       int[]     := '{}';
  cotas      int[]     := '{}';
  restos     numeric[] := '{}';
  i          int;
BEGIN
  v_total := GREATEST(COALESCE(p_total, 1), 1);

  -- Maior capacidade primeiro, até a soma cobrir o grupo: escala o
  -- MENOR número de veículos possível. Moto/quadriciclo/embarcação
  -- ficam de fora — não é frota de transporte de grupo por estrada, e
  -- sem capacidade preenchida o COALESCE ainda lhes daria 4 lugares.
  FOR r IN
    SELECT d.id, d.placa, d.modelo, COALESCE(d.capacidade_passageiros, 4)::int AS cap
    FROM frota_veiculos_disponiveis(p_inicio, p_fim, p_incluir_dedicados) d
    WHERE d.tipo NOT IN ('motocicleta', 'quadriciclo', 'embarcacao')
      AND COALESCE(d.capacidade_passageiros, 4) >= 1
    ORDER BY COALESCE(d.capacidade_passageiros, 4) DESC, d.placa
  LOOP
    EXIT WHEN v_soma_cap >= v_total;
    ids     := ids     || r.id;
    placas  := placas  || r.placa;
    modelos := modelos || r.modelo;
    caps    := caps    || r.cap;
    v_soma_cap := v_soma_cap + r.cap;
  END LOOP;

  n := array_length(ids, 1);
  IF n IS NULL THEN
    RETURN; -- nenhum veículo elegível; quem chama avisa na tela
  END IF;

  FOR i IN 1 .. n LOOP
    cotas[i]  := LEAST(caps[i], floor(v_total::numeric * caps[i] / v_soma_cap)::int);
    restos[i] := (v_total::numeric * caps[i] / v_soma_cap) - floor(v_total::numeric * caps[i] / v_soma_cap);
    v_alocado := v_alocado + cotas[i];
  END LOOP;

  v_falta := v_total - v_alocado;
  WHILE v_falta > 0 LOOP
    v_idx_max := NULL;
    FOR i IN 1 .. n LOOP
      IF cotas[i] < caps[i] AND (v_idx_max IS NULL OR restos[i] > restos[v_idx_max]) THEN
        v_idx_max := i;
      END IF;
    END LOOP;
    -- Frota não cobre o grupo inteiro: devolve o que cabe e deixa a
    -- soma menor que o total de propósito — a tela mostra a diferença
    -- em vermelho em vez de fingir que coube.
    EXIT WHEN v_idx_max IS NULL;
    cotas[v_idx_max]  := cotas[v_idx_max] + 1;
    restos[v_idx_max] := -1;
    v_falta := v_falta - 1;
  END LOOP;

  FOR i IN 1 .. n LOOP
    veiculo_id := ids[i];
    placa      := placas[i];
    modelo     := modelos[i];
    capacidade := caps[i];
    cota       := cotas[i];
    RETURN NEXT;
  END LOOP;
END;
$$;

REVOKE EXECUTE ON FUNCTION frota_veiculos_para_grupo(timestamptz, timestamptz, int, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION frota_veiculos_para_grupo(timestamptz, timestamptz, int, boolean)
  TO service_role;

-- ── 3. frota_sugerir_alocacao passa a ser só a casca da regra ───

CREATE OR REPLACE FUNCTION frota_sugerir_alocacao(p_viagem_id uuid)
RETURNS TABLE(veiculo_id uuid, placa text, modelo text, capacidade_passageiros smallint, passageiros_sugeridos smallint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_viagem frota_viagens;
BEGIN
  IF NOT pode_editar('frota') THEN
    RAISE EXCEPTION 'Sem permissão para aprovar viagens';
  END IF;

  SELECT * INTO v_viagem FROM frota_viagens WHERE id = p_viagem_id;
  IF v_viagem IS NULL THEN
    RAISE EXCEPTION 'Viagem não encontrada';
  END IF;

  RETURN QUERY
  SELECT g.veiculo_id, g.placa, g.modelo, g.capacidade::smallint, g.cota::smallint
  FROM frota_veiculos_para_grupo(
    v_viagem.data_saida_prevista, v_viagem.data_retorno_prevista,
    COALESCE(v_viagem.passageiros, 1)
  ) g;
END;
$$;

-- ── 4. Escala de motoristas usa a MESMA contagem ────────────────
-- Corpo idêntico ao da 190 (foto do motorista na fila), trocando só o
-- laço próprio de contagem de veículos pela chamada ao helper. Sem
-- isso, o número de motoristas sugeridos podia discordar do número de
-- veículos sugeridos na mesma viagem.

CREATE OR REPLACE FUNCTION frota_sugerir_motorista_escala(
  p_cidade_origem  text,
  p_cidade_destino text,
  p_inicio         timestamptz,
  p_fim            timestamptz,
  p_passageiros    smallint DEFAULT NULL
) RETURNS TABLE (
  motorista_id   uuid,
  nome           text,
  foto_url       text,
  ultima_viagem  timestamptz,
  total_viagens  int,
  sugerido       boolean
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_necessarios int := 1;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Autenticação necessária';
  END IF;

  IF p_passageiros IS NOT NULL AND p_passageiros > 0 THEN
    SELECT count(*)::int INTO v_necessarios
      FROM frota_veiculos_para_grupo(p_inicio, p_fim, p_passageiros::int);
    IF v_necessarios < 1 THEN v_necessarios := 1; END IF;
  END IF;

  RETURN QUERY
  WITH candidatos AS (
    SELECT m.id, m.nome, m.foto_url
    FROM frota_motoristas m
    WHERE frota_motorista_apto(m.id)
      AND NOT EXISTS (
        SELECT 1 FROM frota_veiculos v
        WHERE v.motorista_padrao_id = m.id AND v.dedicado_setor AND v.ativo
      )
      AND NOT EXISTS (
        SELECT 1 FROM frota_viagens fv
        WHERE fv.motorista_id = m.id
          AND fv.status IN ('aprovada','em_andamento')
          AND tstzrange(fv.data_saida_prevista, fv.data_retorno_prevista, '[]')
              && tstzrange(p_inicio, p_fim, '[]')
      )
  ),
  hist AS (
    SELECT fv.motorista_id,
           max(fv.data_retorno_prevista) AS ultima_viagem,
           count(*)::int                 AS total_viagens
    FROM frota_viagens fv
    WHERE fv.status = 'concluida'
      AND fv.motorista_id IS NOT NULL
      AND fv.cidade_destino IS NOT NULL
      AND frota_norm_cidade(fv.cidade_destino) <> frota_norm_cidade(fv.cidade_origem)
    GROUP BY fv.motorista_id
  )
  SELECT c.id, c.nome, c.foto_url, h.ultima_viagem, COALESCE(h.total_viagens, 0),
         row_number() OVER (ORDER BY h.ultima_viagem ASC NULLS FIRST, c.nome) <= v_necessarios
    FROM candidatos c
    LEFT JOIN hist h ON h.motorista_id = c.id
   ORDER BY h.ultima_viagem ASC NULLS FIRST, c.nome;
END;
$$;
