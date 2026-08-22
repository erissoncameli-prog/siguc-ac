-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Qualidade da Água — cadastro de sondas (equipamento
-- de leitura) + campo na coleta
--
-- Pedido do usuário: o app de campo (pages/agua-app.html) precisa
-- registrar QUAL sonda leu os parâmetros de campo (temp/pH/OD/
-- turbidez/condutividade) de cada coleta — hoje isso não é rastreado
-- em lugar nenhum. Decisões confirmadas antes de codar:
--   1. "Ficar padrão no app" é preferência POR APARELHO (IndexedDB,
--      store `config` já existente — mesmo padrão de `pin_hash`/
--      `baselines`), não por conta — sem RPC nova de vínculo
--      usuário↔equipamento.
--   2. Cadastro entra como aba nova em pages/agua-pontos.html (já
--      reúne Pontos/Laboratórios/Gabaritos), não página própria.
--   3. Vínculo é 1 sonda por COLETA (coluna em agua_coletas), não um
--      vínculo fixo por ponto — o técnico escolhe a sonda usada
--      naquela coleta específica.
--
-- Molde de agua_laboratorios (mesmo desenho de cadastro simples de
-- mesa) + do endurecimento que a 271 aplicou a ele DEPOIS de existir:
-- aqui a tabela já nasce com a escrita fechada (INSERT direto via
-- RLS, UPDATE só pela RPC agua_atualizar_equipamento, com
-- reautenticação + justificativa) — nunca precisa de uma migration
-- de "fecha escrita direta" separada como a 271 precisou.
-- ═══════════════════════════════════════════════════════════

-- ── 1. Enum de status ──────────────────────────────────────────
-- Só o que o seletor do app precisa saber: sonda disponível para uso
-- ou não. Sem 'em_cautela' (não existe controle de cautela aqui,
-- diferente do Biomonitor — migration 227) e sem "vinculada a X
-- pessoa": qualquer técnico pode escolher qualquer sonda ativa.
DO $$ BEGIN
  CREATE TYPE status_agua_equipamento AS ENUM ('ativo', 'manutencao', 'baixado');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 2. Cadastro ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS agua_equipamentos (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome           text NOT NULL CHECK (length(btrim(nome)) >= 2),   -- apelido, ex.: "Sonda 1 — HORIBA U-50"
  marca          text,
  modelo         text,
  numero_serie   text,
  data_aquisicao date,
  status         status_agua_equipamento NOT NULL DEFAULT 'ativo',
  observacoes    text,
  criado_em      timestamptz NOT NULL DEFAULT now(),
  atualizado_em  timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_agua_equip_nome
  ON agua_equipamentos (lower(btrim(nome)));

COMMENT ON TABLE agua_equipamentos IS
  'Sondas/equipamentos de leitura usados na coleta de campo da Qualidade da Água. Cadastro em pages/agua-pontos.html (aba "Equipamentos"); vínculo com a coleta é 1 sonda por coleta (agua_coletas.equipamento_id) — não é cautela nem vínculo fixo a ponto.';
COMMENT ON COLUMN agua_equipamentos.status IS
  'ativo = aparece no seletor do app; manutencao/baixado = some do seletor de novas coletas, mas coletas antigas continuam referenciando a linha.';

DROP TRIGGER IF EXISTS trg_agua_equip_updated ON agua_equipamentos;
CREATE TRIGGER trg_agua_equip_updated BEFORE UPDATE ON agua_equipamentos
  FOR EACH ROW EXECUTE FUNCTION touch_atualizado_em();

ALTER TABLE agua_equipamentos ENABLE ROW LEVEL SECURITY;

CREATE POLICY agua_equip_select ON agua_equipamentos
  FOR SELECT TO authenticated USING (pode_ver('agua'));
CREATE POLICY agua_equip_insert ON agua_equipamentos
  FOR INSERT TO authenticated WITH CHECK (pode_editar('agua'));
-- Sem policy de UPDATE/DELETE: só agua_atualizar_equipamento edita
-- (mesmo padrão que a 271 aplicou a agua_laboratorios/agua_pontos_coleta).

REVOKE ALL ON agua_equipamentos FROM anon;

-- ── 3. RPC: atualizar equipamento ───────────────────────────────
-- Mesmo molde de agua_atualizar_laboratorio (migration 270): reauth
-- de 5 min + justificativa ≥20 caracteres, whitelist de colunas.
CREATE OR REPLACE FUNCTION agua_atualizar_equipamento(p_id uuid, p_campos jsonb, p_justificativa text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_permitidas text[] := ARRAY[
    'nome','marca','modelo','numero_serie','data_aquisicao','status','observacoes'
  ];
  v_col text;
BEGIN
  IF NOT pode_editar('agua') THEN
    RAISE EXCEPTION 'Sem permissão para editar Qualidade da Água.';
  END IF;
  IF NOT agua_reauth_valida(5) THEN
    RAISE EXCEPTION 'REAUTH_NECESSARIA';
  END IF;
  IF char_length(btrim(COALESCE(p_justificativa,''))) < 20 THEN
    RAISE EXCEPTION 'Justificativa precisa de pelo menos 20 caracteres.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM agua_equipamentos WHERE id = p_id) THEN
    RAISE EXCEPTION 'Equipamento não encontrado.';
  END IF;

  FOR v_col IN SELECT jsonb_object_keys(p_campos) LOOP
    IF NOT (v_col = ANY(v_permitidas)) THEN
      RAISE EXCEPTION 'Campo não permitido: %', v_col;
    END IF;
  END LOOP;

  PERFORM set_config('app.justificativa', p_justificativa, true);

  UPDATE agua_equipamentos t SET (
    nome, marca, modelo, numero_serie, data_aquisicao, status, observacoes
  ) = (
    SELECT nome, marca, modelo, numero_serie, data_aquisicao, status, observacoes
    FROM jsonb_populate_record(t, p_campos)
  )
  WHERE t.id = p_id;
END;
$$;

COMMENT ON FUNCTION agua_atualizar_equipamento(uuid, jsonb, text) IS
  'Único caminho de UPDATE em agua_equipamentos. Mesmas exigências de agua_atualizar_laboratorio.';

REVOKE ALL ON FUNCTION agua_atualizar_equipamento(uuid, jsonb, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION agua_atualizar_equipamento(uuid, jsonb, text) FROM anon;
GRANT EXECUTE ON FUNCTION agua_atualizar_equipamento(uuid, jsonb, text) TO authenticated;

-- ── 4. Vínculo na coleta ─────────────────────────────────────────
ALTER TABLE agua_coletas
  ADD COLUMN IF NOT EXISTS equipamento_id uuid REFERENCES agua_equipamentos(id) ON DELETE SET NULL;

COMMENT ON COLUMN agua_coletas.equipamento_id IS
  'Sonda usada para ler os parâmetros de campo desta coleta. Nulo nas coletas antigas (série histórica e coletas anteriores a esta entrega) — nunca preenchido por suposição.';

-- ── 5. Recria a view enumerando as colunas (armadilha da 260/304/308) ──
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
       ELSE ST_Distance(c.localizacao::geography, p.geom::geography)::numeric END) AS gps_confirmacao,
  c.origem_dados,
  c.data_recebimento_laboratorio,
  -- ── Acrescentado nesta migration (equipamento de leitura) — só no fim é permitido ──
  c.equipamento_id, eq.nome AS equipamento_nome
FROM agua_coletas c
JOIN agua_pontos_coleta p ON p.id = c.ponto_id
JOIN agua_campanhas ca ON ca.id = c.campanha_id
LEFT JOIN agua_laboratorios l ON l.id = c.laboratorio_id
LEFT JOIN agua_equipamentos eq ON eq.id = c.equipamento_id
WHERE c.excluido_em IS NULL;

-- ── 6. agua_atualizar_coleta ganha equipamento_id na whitelist ──
-- Mudança cirúrgica no corpo (assinatura intacta), mesmo padrão da
-- 306/308.
CREATE OR REPLACE FUNCTION agua_atualizar_coleta(p_id uuid, p_campos jsonb, p_justificativa text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_permitidas text[] := ARRAY[
    'observacoes','data_coleta','hora_coleta','status','quarentena_motivo',
    'laboratorio_id','laudo_url',
    'temp_ar','temp_amostra','ph','od','turbidez','condutividade_eletrica',
    'dbo','nitrogenio_total','nitrogenio_amoniacal','nitratos','fosforo_total',
    'ortofosfato_dissolvido','solidos_dissolvidos_totais','solidos_suspensao_totais',
    'coliformes_termotolerantes','coliformes_totais','escherichia_coli',
    'alcalinidade_total','carbono_organico_total','cloreto',
    'condutividade_especifica','descarga_liquida',
    'origem_dados','data_recebimento_laboratorio','equipamento_id'
  ];
  v_col text;
BEGIN
  IF NOT pode_editar('agua') THEN
    RAISE EXCEPTION 'Sem permissão para editar dados de Qualidade da Água.';
  END IF;
  IF NOT agua_reauth_valida(5) THEN
    RAISE EXCEPTION 'REAUTH_NECESSARIA';
  END IF;
  IF char_length(btrim(COALESCE(p_justificativa,''))) < 20 THEN
    RAISE EXCEPTION 'Justificativa precisa de pelo menos 20 caracteres.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM agua_coletas WHERE id = p_id AND excluido_em IS NULL) THEN
    RAISE EXCEPTION 'Coleta não encontrada.';
  END IF;

  FOR v_col IN SELECT jsonb_object_keys(p_campos) LOOP
    IF NOT (v_col = ANY(v_permitidas)) THEN
      RAISE EXCEPTION 'Campo não permitido: %', v_col;
    END IF;
  END LOOP;

  PERFORM set_config('app.justificativa', p_justificativa, true);

  UPDATE agua_coletas t SET (
    observacoes, data_coleta, hora_coleta, status, quarentena_motivo,
    laboratorio_id, laudo_url,
    temp_ar, temp_amostra, ph, od, turbidez, condutividade_eletrica,
    dbo, nitrogenio_total, nitrogenio_amoniacal, nitratos, fosforo_total,
    ortofosfato_dissolvido, solidos_dissolvidos_totais, solidos_suspensao_totais,
    coliformes_termotolerantes, coliformes_totais, escherichia_coli,
    alcalinidade_total, carbono_organico_total, cloreto,
    condutividade_especifica, descarga_liquida,
    origem_dados, data_recebimento_laboratorio, equipamento_id
  ) = (
    SELECT
      observacoes, data_coleta, hora_coleta, status, quarentena_motivo,
      laboratorio_id, laudo_url,
      temp_ar, temp_amostra, ph, od, turbidez, condutividade_eletrica,
      dbo, nitrogenio_total, nitrogenio_amoniacal, nitratos, fosforo_total,
      ortofosfato_dissolvido, solidos_dissolvidos_totais, solidos_suspensao_totais,
      coliformes_termotolerantes, coliformes_totais, escherichia_coli,
      alcalinidade_total, carbono_organico_total, cloreto,
      condutividade_especifica, descarga_liquida,
      origem_dados, data_recebimento_laboratorio, equipamento_id
    FROM jsonb_populate_record(t, p_campos)
  )
  WHERE t.id = p_id;
END;
$$;
