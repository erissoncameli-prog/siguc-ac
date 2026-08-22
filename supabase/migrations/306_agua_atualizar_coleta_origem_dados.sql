-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Qualidade da Água — agua_atualizar_coleta aceita origem_dados
-- Entrega 2 do plano em docs/qualidade-agua/plano-leitura-laudo-e-alertas.md.
--
-- `agua_atualizar_coleta` (migration 270) tem whitelist EXPLÍCITA de
-- colunas — qualquer chave fora dela é rejeitada ("Campo não
-- permitido"). `origem_dados` (migration 304, proveniência por campo
-- do parser) precisa entrar nessa lista para `pages/agua-laudos.html`
-- conseguir gravar quais campos vieram do OCR, quais foram digitados
-- e quais foram corrigidos depois do OCR propor um valor.
--
-- MUDANÇA CIRÚRGICA: o corpo é o MESMO da 270 — só as duas listas de
-- colunas ganham `origem_dados` no fim. Nada de reescrever a
-- mecânica de merge (`jsonb_populate_record(t, p_campos)`): trocar
-- por COALESCE por coluna mudaria o comportamento para NULL explícito
-- (a 270 permite zerar `quarentena_motivo` mandando null; COALESCE
-- silenciosamente manteria o valor antigo) — regressão que não vale o
-- risco por uma mudança que é só "aceitar mais uma chave".
-- `agua_coletas.origem_dados` é jsonb NOT NULL DEFAULT '{}' (304), e
-- o CLIENTE já manda o objeto cobrindo TODOS os campos preenchidos no
-- formulário a cada gravação (não só os alterados) — substituir
-- inteiro é equivalente, na prática, a mesclar.
--
-- CREATE OR REPLACE é seguro aqui — a ASSINATURA da função
-- (p_id uuid, p_campos jsonb, p_justificativa text) não muda.
-- Diferente da armadilha das migrations 173/178/224/297/300 (mudar a
-- LISTA DE PARÂMETROS exige DROP FUNCTION antes).
-- ═══════════════════════════════════════════════════════════

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
    'origem_dados'
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
    origem_dados
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
      origem_dados
    FROM jsonb_populate_record(t, p_campos)
  )
  WHERE t.id = p_id;
END;
$$;
