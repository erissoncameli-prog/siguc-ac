-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Frota — distribuição proporcional de passageiros
-- na sugestão de alocação multiveículo (172_frota_viagem_multipla)
--
-- ATENÇÃO — arquivo recuperado do banco (ver docs/frota-migrations-mapa.md).
-- Esta migration foi aplicada em produção em 23/07/2026 (versão
-- 20260723034939, nome `frota_alocacao_proporcional`) SEM ter sido
-- commitada no repositório. O conteúdo abaixo é o SQL exato que o
-- Supabase registrou, recuperado de supabase_migrations.schema_migrations.
-- O sufixo "b" no número mantém a posição real na ordem de aplicação
-- (entre a 192 e a 193) sem renumerar arquivos já aplicados.
--
-- Bug: frota_sugerir_alocacao enchia cada veículo até a capacidade
-- máxima antes de passar pro próximo (guloso), então o 1º veículo
-- sempre saía lotado e o(s) seguinte(s) ficavam com pouca gente (às
-- vezes só 1). Correção: primeiro decide quantos veículos são
-- necessários (mesmo critério de antes — soma de capacidades cobrir
-- o total), depois divide os passageiros proporcionalmente à
-- capacidade de cada veículo escolhido (largest remainder method,
-- sem estourar a capacidade de nenhum), em vez de lotar um de cada
-- vez. Assinatura e retorno inalterados → CREATE OR REPLACE.
-- ═══════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION frota_sugerir_alocacao(p_viagem_id uuid)
RETURNS TABLE(veiculo_id uuid, placa text, modelo text, capacidade_passageiros smallint, passageiros_sugeridos smallint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_viagem   frota_viagens;
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
  IF NOT pode_editar('frota') THEN
    RAISE EXCEPTION 'Sem permissão para aprovar viagens';
  END IF;

  SELECT * INTO v_viagem FROM frota_viagens WHERE id = p_viagem_id;
  IF v_viagem IS NULL THEN
    RAISE EXCEPTION 'Viagem não encontrada';
  END IF;

  v_total := GREATEST(COALESCE(v_viagem.passageiros, 1), 1);

  -- Escolhe os veículos necessários: maior capacidade primeiro, até a
  -- soma cobrir o total de passageiros (mesmo critério da versão
  -- anterior, só que agora sem alocar ainda).
  FOR r IN
    SELECT d.id, d.placa, d.modelo, COALESCE(d.capacidade_passageiros, 4)::int AS cap
    FROM frota_veiculos_disponiveis(v_viagem.data_saida_prevista, v_viagem.data_retorno_prevista) d
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
    RETURN;
  END IF;

  -- Cota inicial de cada veículo = piso da proporção de capacidade;
  -- guarda a parte fracionária (resto) pra distribuir a sobra depois.
  FOR i IN 1 .. n LOOP
    cotas[i]  := LEAST(caps[i], floor(v_total::numeric * caps[i] / v_soma_cap)::int);
    restos[i] := (v_total::numeric * caps[i] / v_soma_cap) - floor(v_total::numeric * caps[i] / v_soma_cap);
    v_alocado := v_alocado + cotas[i];
  END LOOP;

  -- Sobra do arredondamento (largest remainder method): distribui 1
  -- passageiro por vez ao veículo com maior resto que ainda tenha
  -- vaga, até fechar o total — sem estourar nenhuma capacidade.
  v_falta := v_total - v_alocado;
  WHILE v_falta > 0 LOOP
    v_idx_max := NULL;
    FOR i IN 1 .. n LOOP
      IF cotas[i] < caps[i] AND (v_idx_max IS NULL OR restos[i] > restos[v_idx_max]) THEN
        v_idx_max := i;
      END IF;
    END LOOP;
    EXIT WHEN v_idx_max IS NULL; -- todos lotados (não deveria acontecer, soma_cap >= total)
    cotas[v_idx_max]  := cotas[v_idx_max] + 1;
    restos[v_idx_max] := -1; -- já usado, não concorre de novo
    v_falta := v_falta - 1;
  END LOOP;

  FOR i IN 1 .. n LOOP
    veiculo_id := ids[i];
    placa := placas[i];
    modelo := modelos[i];
    capacidade_passageiros := caps[i]::smallint;
    passageiros_sugeridos := cotas[i]::smallint;
    RETURN NEXT;
  END LOOP;
END;
$$;
