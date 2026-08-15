-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Qualidade da Água — trilha + reautenticação + justificativa
-- Retoma docs/qualidade-agua/plano-seguranca-dados.md, com duas
-- simplificações reais achadas nesta entrega (não presumidas — testadas):
--
-- 1. NÃO precisa de `agua_auditoria` própria. A trilha genérica
--    (`trilha_auditoria`, migration 269) já existe, testada, com cadeia
--    de hash e RLS imutável para super_admin. Ligar as 4 tabelas de
--    Água é só CREATE TRIGGER — exatamente como a migration 269 previu.
-- 2. NÃO precisa tratar `geometry` no trigger genérico. Testado:
--    `to_jsonb()` de uma linha com coluna `geometry` já produz GeoJSON
--    legível neste PostGIS (`ST_AsGeoJSON` embutido no cast), não o WKB
--    hexadecimal que o plano original temia.
--
-- OPÇÃO A DE REAUTENTICAÇÃO — validada nesta entrega, não presumida.
-- O GoTrue do Supabase já registra, por sessão, quando cada método de
-- autenticação foi satisfeito (`auth.mfa_amr_claims`, 37 linhas reais
-- confirmadas em produção). `agua_reauth_valida()` usa isso: reautenticar
-- num client isolado cria uma sessão nova com `authentication_method =
-- 'password'` e `updated_at = now()` — sem Edge Function, sem ticket
-- próprio, sem a senha passar pelo nosso código.
--
-- JUSTIFICATIVA NA TRILHA — a migration 269 deixou a coluna de fora de
-- propósito ("se um RPC layer for adicionado depois, ALTER TABLE ADD
-- COLUMN, não quebra"). Este é esse momento: adiciona `justificativa`
-- (nullable — as 4 tabelas de permissão continuam sem ela) e o trigger
-- passa a ler `current_setting('app.justificativa', true)`, publicada
-- pelas RPCs abaixo via `set_config`.
--
-- ESCOPO DECIDIDO NESTA ENTREGA: Camada 5 (exclusão lógica) só para
-- `agua_coletas`. Não existe fluxo de exclusão hoje em NENHUMA das 4
-- tabelas nas 3 telas de mesa — construir para `agua_pontos_coleta`/
-- `agua_laboratorios` exigiria também filtrar `excluido_em` em
-- `agua-mapa.html` e `js/agua-relatorio-dados.js`, que não têm nada a
-- ver com o fluxo de edição. `agua_coletas` é a exceção porque é lida
-- por UMA view central (`vw_agua_coletas_detalhe`), então o filtro
-- entra num lugar só. `agua_campanhas` fica de fora inteiramente — não
-- há UPDATE nem DELETE dela em nenhuma tela hoje.
-- ═══════════════════════════════════════════════════════════

-- ── Trilha: liga as 4 tabelas (aditivo, zero mudança de comportamento) ──
DROP TRIGGER IF EXISTS trg_trilha_agua_coletas ON agua_coletas;
CREATE TRIGGER trg_trilha_agua_coletas
  AFTER INSERT OR UPDATE OR DELETE ON agua_coletas
  FOR EACH ROW EXECUTE FUNCTION trilha_auditoria_registrar('id');

DROP TRIGGER IF EXISTS trg_trilha_agua_pontos_coleta ON agua_pontos_coleta;
CREATE TRIGGER trg_trilha_agua_pontos_coleta
  AFTER INSERT OR UPDATE OR DELETE ON agua_pontos_coleta
  FOR EACH ROW EXECUTE FUNCTION trilha_auditoria_registrar('id');

DROP TRIGGER IF EXISTS trg_trilha_agua_campanhas ON agua_campanhas;
CREATE TRIGGER trg_trilha_agua_campanhas
  AFTER INSERT OR UPDATE OR DELETE ON agua_campanhas
  FOR EACH ROW EXECUTE FUNCTION trilha_auditoria_registrar('id');

DROP TRIGGER IF EXISTS trg_trilha_agua_laboratorios ON agua_laboratorios;
CREATE TRIGGER trg_trilha_agua_laboratorios
  AFTER INSERT OR UPDATE OR DELETE ON agua_laboratorios
  FOR EACH ROW EXECUTE FUNCTION trilha_auditoria_registrar('id');

-- ── Justificativa na trilha (coluna nova, nullable) ────────────
ALTER TABLE trilha_auditoria ADD COLUMN IF NOT EXISTS justificativa text;
COMMENT ON COLUMN trilha_auditoria.justificativa IS
  'Preenchida pelas RPCs que exigem justificativa (ex.: agua_atualizar_coleta). NULL para escritas sem esse requisito (ex.: tabelas de permissão).';

CREATE OR REPLACE FUNCTION trilha_auditoria_registrar()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_old         jsonb;
  v_new         jsonb;
  v_chave_cols  text[];
  v_registro_id text;
  v_campos      text[];
  v_usuario_id  uuid;
  v_usuario_nome  text;
  v_usuario_email text;
  v_perfil      text;
  v_hash_ant    text;
  v_conteudo    text;
  v_ip_raw      text;
  v_ip          inet;
  v_ua          text;
  v_origem      text;
  v_justificativa text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('trilha_auditoria'));

  v_chave_cols := string_to_array(TG_ARGV[0], ',');

  IF TG_OP IN ('UPDATE','DELETE') THEN v_old := to_jsonb(OLD); END IF;
  IF TG_OP IN ('INSERT','UPDATE') THEN v_new := to_jsonb(NEW); END IF;

  SELECT string_agg(COALESCE(v_new, v_old) ->> c, '|' ORDER BY ord)
    INTO v_registro_id
    FROM unnest(v_chave_cols) WITH ORDINALITY AS t(c, ord);

  IF TG_OP = 'UPDATE' THEN
    SELECT array_agg(k) INTO v_campos
      FROM jsonb_object_keys(v_new) k
     WHERE k <> 'atualizado_em'
       AND (v_old -> k) IS DISTINCT FROM (v_new -> k);
  END IF;

  v_usuario_id := auth.uid();
  IF v_usuario_id IS NOT NULL THEN
    SELECT u.nome_completo, u.email, u.perfil::text
      INTO v_usuario_nome, v_usuario_email, v_perfil
      FROM usuarios u WHERE u.id = v_usuario_id;
  END IF;

  BEGIN
    v_ip_raw := split_part(current_setting('request.headers', true)::jsonb ->> 'x-forwarded-for', ',', 1);
    v_ip := NULLIF(btrim(v_ip_raw), '')::inet;
  EXCEPTION WHEN OTHERS THEN v_ip := NULL;
  END;
  BEGIN
    v_ua := current_setting('request.headers', true)::jsonb ->> 'user-agent';
  EXCEPTION WHEN OTHERS THEN v_ua := NULL;
  END;
  v_origem := CASE WHEN current_setting('request.headers', true) IS NOT NULL THEN 'mesa_ou_app' ELSE 'servidor' END;

  -- Publicada pelas RPCs (ex.: agua_atualizar_coleta) via set_config('app.justificativa', …, true)
  -- antes do UPDATE/DELETE. NULL quando quem escreveu não passou por essa exigência.
  BEGIN
    v_justificativa := NULLIF(current_setting('app.justificativa', true), '');
  EXCEPTION WHEN OTHERS THEN v_justificativa := NULL;
  END;

  SELECT hash INTO v_hash_ant FROM trilha_auditoria ORDER BY seq DESC LIMIT 1;

  v_conteudo := COALESCE(v_hash_ant, '') || TG_TABLE_NAME || TG_OP || COALESCE(v_registro_id, '')
    || COALESCE(v_old::text, '') || COALESCE(v_new::text, '') || now()::text;

  INSERT INTO trilha_auditoria (
    tabela, registro_id, operacao, dados_antes, dados_depois, campos_alterados,
    usuario_id, usuario_nome, usuario_email, perfil, origem, ip, user_agent,
    hash_anterior, hash, justificativa
  ) VALUES (
    TG_TABLE_NAME, v_registro_id, TG_OP, v_old, v_new, v_campos,
    v_usuario_id, v_usuario_nome, v_usuario_email, v_perfil, v_origem, v_ip, v_ua,
    v_hash_ant, encode(extensions.digest(v_conteudo, 'sha256'), 'hex'), v_justificativa
  );

  RETURN COALESCE(NEW, OLD);
END;
$$;

-- ── Reautenticação (Opção A — validada, GoTrue já registra amr) ────
CREATE OR REPLACE FUNCTION agua_reauth_valida(p_minutos int DEFAULT 5)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM auth.mfa_amr_claims c
    JOIN auth.sessions s ON s.id = c.session_id
    WHERE s.user_id = auth.uid()
      AND c.authentication_method = 'password'
      AND c.updated_at > now() - (p_minutos || ' minutes')::interval
  );
$$;

COMMENT ON FUNCTION agua_reauth_valida(int) IS
  'Houve reautenticação por senha nos últimos p_minutos min, em QUALQUER sessão do usuário (inclusive um client isolado, usado de propósito para não rotacionar a sessão de trabalho). Camada 3 de docs/qualidade-agua/plano-seguranca-dados.md, Opção A.';

REVOKE EXECUTE ON FUNCTION agua_reauth_valida(int) FROM anon;

-- ── Exclusão lógica (só agua_coletas — ver cabeçalho) ──────────
ALTER TABLE agua_coletas ADD COLUMN IF NOT EXISTS excluido_em timestamptz;
ALTER TABLE agua_coletas ADD COLUMN IF NOT EXISTS excluido_por uuid;
ALTER TABLE agua_coletas ADD COLUMN IF NOT EXISTS exclusao_justificativa text;
COMMENT ON COLUMN agua_coletas.excluido_em IS
  'Exclusão lógica — nunca DELETE físico pela RPC de mesa. NULL = ativa.';

-- ── RPC: atualizar coleta ───────────────────────────────────────
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
    'condutividade_especifica','descarga_liquida'
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
    condutividade_especifica, descarga_liquida
  ) = (
    SELECT
      observacoes, data_coleta, hora_coleta, status, quarentena_motivo,
      laboratorio_id, laudo_url,
      temp_ar, temp_amostra, ph, od, turbidez, condutividade_eletrica,
      dbo, nitrogenio_total, nitrogenio_amoniacal, nitratos, fosforo_total,
      ortofosfato_dissolvido, solidos_dissolvidos_totais, solidos_suspensao_totais,
      coliformes_termotolerantes, coliformes_totais, escherichia_coli,
      alcalinidade_total, carbono_organico_total, cloreto,
      condutividade_especifica, descarga_liquida
    FROM jsonb_populate_record(t, p_campos)
  )
  WHERE t.id = p_id;
END;
$$;

COMMENT ON FUNCTION agua_atualizar_coleta(uuid, jsonb, text) IS
  'Único caminho de UPDATE em agua_coletas para a mesa. Exige pode_editar(agua), reautenticação recente (5 min) e justificativa (20+ caracteres). Lista branca de colunas — nunca aceita id/ponto_id/campanha_id/coletor_*/censurados/criado_*/uuid_cliente/codigo_amostra/localizacao.';

REVOKE EXECUTE ON FUNCTION agua_atualizar_coleta(uuid, jsonb, text) FROM anon;

-- ── RPC: excluir (lógico) coleta ────────────────────────────────
CREATE OR REPLACE FUNCTION agua_excluir_coleta(p_id uuid, p_justificativa text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT pode_editar('agua') THEN
    RAISE EXCEPTION 'Sem permissão para excluir dados de Qualidade da Água.';
  END IF;
  IF NOT agua_reauth_valida(5) THEN
    RAISE EXCEPTION 'REAUTH_NECESSARIA';
  END IF;
  IF char_length(btrim(COALESCE(p_justificativa,''))) < 20 THEN
    RAISE EXCEPTION 'Justificativa precisa de pelo menos 20 caracteres.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM agua_coletas WHERE id = p_id AND excluido_em IS NULL) THEN
    RAISE EXCEPTION 'Coleta não encontrada ou já excluída.';
  END IF;

  PERFORM set_config('app.justificativa', p_justificativa, true);

  UPDATE agua_coletas
     SET excluido_em = now(), excluido_por = auth.uid(), exclusao_justificativa = p_justificativa
   WHERE id = p_id;
END;
$$;

COMMENT ON FUNCTION agua_excluir_coleta(uuid, text) IS
  'Exclusão LÓGICA (nunca DELETE físico) de uma coleta. Mesmas exigências de agua_atualizar_coleta.';

REVOKE EXECUTE ON FUNCTION agua_excluir_coleta(uuid, text) FROM anon;

-- ── RPC: atualizar ponto de coleta (inclui geom) ────────────────
CREATE OR REPLACE FUNCTION agua_atualizar_ponto(p_id uuid, p_campos jsonb, p_justificativa text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_permitidas text[] := ARRAY[
    'codigo_ana','nome','municipio','rio','bacia','altitude_m','uc_id',
    'classe_enquadramento','coordenada_conferida','coordenada_observacao',
    'observacoes','ativo'
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
  IF NOT EXISTS (SELECT 1 FROM agua_pontos_coleta WHERE id = p_id) THEN
    RAISE EXCEPTION 'Ponto não encontrado.';
  END IF;

  FOR v_col IN SELECT jsonb_object_keys(p_campos) LOOP
    IF NOT (v_col = ANY(v_permitidas) OR v_col = 'geom') THEN
      RAISE EXCEPTION 'Campo não permitido: %', v_col;
    END IF;
  END LOOP;

  PERFORM set_config('app.justificativa', p_justificativa, true);

  UPDATE agua_pontos_coleta t SET (
    codigo_ana, nome, municipio, rio, bacia, altitude_m, uc_id,
    classe_enquadramento, coordenada_conferida, coordenada_observacao,
    observacoes, ativo
  ) = (
    SELECT
      codigo_ana, nome, municipio, rio, bacia, altitude_m, uc_id,
      classe_enquadramento, coordenada_conferida, coordenada_observacao,
      observacoes, ativo
    FROM jsonb_populate_record(t, p_campos)
  )
  WHERE t.id = p_id;

  -- geom vem como texto EWKT ('SRID=4326;POINT(lng lat)'), não GeoJSON —
  -- jsonb_populate_record não daria o cast certo; feito à parte.
  IF p_campos ? 'geom' THEN
    UPDATE agua_pontos_coleta SET geom = (p_campos->>'geom')::geometry WHERE id = p_id;
  END IF;
END;
$$;

COMMENT ON FUNCTION agua_atualizar_ponto(uuid, jsonb, text) IS
  'Único caminho de UPDATE em agua_pontos_coleta para a mesa. Mesmas exigências de agua_atualizar_coleta. Sem exclusão — não há fluxo de delete nesta tela hoje (ver cabeçalho da migration 270).';

REVOKE EXECUTE ON FUNCTION agua_atualizar_ponto(uuid, jsonb, text) FROM anon;

-- ── RPC: atualizar laboratório ───────────────────────────────────
CREATE OR REPLACE FUNCTION agua_atualizar_laboratorio(p_id uuid, p_campos jsonb, p_justificativa text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_permitidas text[] := ARRAY[
    'nome','cnpj','acreditacao','responsavel_tecnico','registro_conselho',
    'email','telefone','observacoes','ativo'
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
  IF NOT EXISTS (SELECT 1 FROM agua_laboratorios WHERE id = p_id) THEN
    RAISE EXCEPTION 'Laboratório não encontrado.';
  END IF;

  FOR v_col IN SELECT jsonb_object_keys(p_campos) LOOP
    IF NOT (v_col = ANY(v_permitidas)) THEN
      RAISE EXCEPTION 'Campo não permitido: %', v_col;
    END IF;
  END LOOP;

  PERFORM set_config('app.justificativa', p_justificativa, true);

  UPDATE agua_laboratorios t SET (
    nome, cnpj, acreditacao, responsavel_tecnico, registro_conselho,
    email, telefone, observacoes, ativo
  ) = (
    SELECT nome, cnpj, acreditacao, responsavel_tecnico, registro_conselho,
           email, telefone, observacoes, ativo
    FROM jsonb_populate_record(t, p_campos)
  )
  WHERE t.id = p_id;
END;
$$;

COMMENT ON FUNCTION agua_atualizar_laboratorio(uuid, jsonb, text) IS
  'Único caminho de UPDATE em agua_laboratorios para a mesa. Mesmas exigências de agua_atualizar_coleta.';

REVOKE EXECUTE ON FUNCTION agua_atualizar_laboratorio(uuid, jsonb, text) FROM anon;

-- ── View: passa a esconder coletas excluídas ────────────────────
-- CREATE OR REPLACE VIEW só aceita ACRESCENTAR coluna ao final —
-- por isso as 3 novas vêm depois de codigo_amostra (lição da 260).
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
  c.excluido_em, c.excluido_por, c.exclusao_justificativa
FROM agua_coletas c
JOIN agua_pontos_coleta p ON p.id = c.ponto_id
JOIN agua_campanhas ca ON ca.id = c.campanha_id
LEFT JOIN agua_laboratorios l ON l.id = c.laboratorio_id
WHERE c.excluido_em IS NULL;
