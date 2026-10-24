-- 367_camadas_mapa_dados_pessoais.sql
-- Dados pessoais (CPF/CNPJ, nome de ocupante/detentor/proprietário) saem do
-- GeoJSON das camadas enviadas ao Mapa das UCs e vão para uma tabela própria,
-- lida só por RPC, com log LGPD e documento mascarado.
--
-- Achado (24/10/2026, ao planejar a Fase 3 do mapa): `camadas_mapa` tem SELECT
-- para qualquer autenticado e o navegador baixa o GeoJSON inteiro. Duas camadas
-- traziam dado pessoal nas propriedades — "Afluente - Lotes" (132 CPFs, 141
-- nomes de ocupantes) e "Lago do Amapa - Lotes" (115 CPFs, 218 nomes de
-- detentores) — e "AN-SAFS implatadas" 21 nomes de proprietários. Esconder no
-- popup não fecha nada: o dado continuaria sendo baixado. Decisão do usuário:
-- separar no banco.
--
-- Desenho:
-- 1. Cópia de segurança das camadas afetadas (camadas_mapa_backup_367, RLS sem
--    policy, sem GRANT) ANTES de mexer — apagar depois de conferido.
-- 2. camadas_mapa_dados_pessoais (camada_id, pid, dados jsonb). Sem policy:
--    só a RPC lê.
-- 3. Trigger BEFORE INSERT/UPDATE OF geojson em camadas_mapa extrai os campos
--    pessoais de TODA camada, atual ou futura (upload novo pela tela continua
--    fazendo .insert() direto — a garantia é do banco, não da tela). No lugar
--    fica `_siguc_pid` (uuid) na feição, que liga à linha privada.
-- 4. camada_dados_pessoais(camada, pid): exige pode_editar('mapa'), grava uma
--    linha em lgpd_acesso_dado_terceiro e devolve CPF/CNPJ mascarado
--    (car_mascarar_documento, mesmo do CAR). Nome sai inteiro.
-- 5. ROPA: TRAT-022.
--
-- Quem lê: pode_editar('mapa') — hoje só super_admin (o gestor tem
-- 'visualizar' no catálogo do grupo Principal). Mais restrito que a policy
-- antiga de edição das camadas (super_admin/gestor por perfil direto), de
-- propósito: é dado pessoal de terceiro. Ampliar = permissão no cadastro do
-- usuário, sem migration.

-- ── 1. Cópia de segurança ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.camadas_mapa_backup_367 AS
  SELECT id, nome, geojson, now() AS copiado_em
  FROM public.camadas_mapa WHERE false;
ALTER TABLE public.camadas_mapa_backup_367 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.camadas_mapa_backup_367 FROM PUBLIC, anon, authenticated;

-- ── 2. Tabela privada ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.camadas_mapa_dados_pessoais (
  camada_id  uuid NOT NULL REFERENCES public.camadas_mapa(id) ON DELETE CASCADE
             DEFERRABLE INITIALLY DEFERRED,   -- a linha nasce no BEFORE INSERT da camada
  pid        uuid NOT NULL,
  dados      jsonb NOT NULL DEFAULT '{}'::jsonb,
  criado_em  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (camada_id, pid)
);
ALTER TABLE public.camadas_mapa_dados_pessoais ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.camadas_mapa_dados_pessoais FROM PUBLIC, anon, authenticated;
COMMENT ON TABLE public.camadas_mapa_dados_pessoais IS
  'Dado pessoal tirado das propriedades das camadas do mapa (migration 367). Sem policy: leitura só por camada_dados_pessoais(). ROPA TRAT-022.';

-- ── 3. O que é campo pessoal ──────────────────────────────────────────
-- Pelo NOME da propriedade (o shapefile não diz o que é cada coluna). Lista
-- conservadora: documento e nome de pessoa ligada ao lote. Nome de imóvel,
-- de núcleo, de ramal etc. não entra.
CREATE OR REPLACE FUNCTION public.camadas_mapa_campo_pessoal(p_chave text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT p_chave ~* '^(cpf|cnpj|cpf_?cnpj|cpfcnpj|rg|documento|doc_titular|nome_ocupa\w*|ocupante\w*|propriet\w*|detentor\w*|titular\w*|nome_titul\w*|nome_propr\w*)$'
$$;

CREATE OR REPLACE FUNCTION public._camadas_mapa_extrair_pessoais()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_feats  jsonb := '[]'::jsonb;
  f        jsonb;
  v_props  jsonb;
  v_pess   jsonb;
  v_pid    uuid;
  v_pids   uuid[] := '{}';
  k        text;
BEGIN
  IF NEW.geojson IS NULL OR jsonb_typeof(NEW.geojson->'features') <> 'array' THEN
    RETURN NEW;
  END IF;
  FOR f IN SELECT value FROM jsonb_array_elements(NEW.geojson->'features') LOOP
    v_props := COALESCE(f->'properties', '{}'::jsonb);
    v_pess := '{}'::jsonb;
    IF jsonb_typeof(v_props) = 'object' THEN
      FOR k IN SELECT jsonb_object_keys(v_props) LOOP
        IF public.camadas_mapa_campo_pessoal(k) THEN
          IF COALESCE(v_props->>k, '') <> '' THEN
            v_pess := v_pess || jsonb_build_object(k, v_props->k);
          END IF;
          v_props := v_props - k;
        END IF;
      END LOOP;
    END IF;
    IF v_pess <> '{}'::jsonb THEN
      v_pid := COALESCE(NULLIF(v_props->>'_siguc_pid', '')::uuid, gen_random_uuid());
      INSERT INTO public.camadas_mapa_dados_pessoais (camada_id, pid, dados)
      VALUES (NEW.id, v_pid, v_pess)
      ON CONFLICT (camada_id, pid) DO UPDATE SET dados = camadas_mapa_dados_pessoais.dados || EXCLUDED.dados;
      v_props := v_props || jsonb_build_object('_siguc_pid', v_pid::text);
    END IF;
    IF v_props ? '_siguc_pid' THEN v_pids := v_pids || (v_props->>'_siguc_pid')::uuid; END IF;
    v_feats := v_feats || jsonb_build_array(jsonb_set(f, '{properties}', v_props, true));
  END LOOP;
  NEW.geojson := jsonb_set(NEW.geojson, '{features}', v_feats);
  -- GeoJSON trocado: o que não tem mais feição correspondente sai
  IF TG_OP = 'UPDATE' THEN
    DELETE FROM public.camadas_mapa_dados_pessoais d
    WHERE d.camada_id = NEW.id AND NOT (d.pid = ANY (v_pids));
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public._camadas_mapa_extrair_pessoais() FROM PUBLIC, anon, authenticated;

-- PG14+: sem DROP (o MCP pede confirmação para DROP e expira)
CREATE OR REPLACE TRIGGER trg_camadas_mapa_extrair_pessoais
  BEFORE INSERT OR UPDATE OF geojson ON public.camadas_mapa
  FOR EACH ROW EXECUTE FUNCTION public._camadas_mapa_extrair_pessoais();

-- ── 4. Leitura com log ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.camada_dados_pessoais(p_camada uuid, p_pid uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_dados jsonb;
  v_doc   text;
  v_saida jsonb := '[]'::jsonb;
  k       text;
  v       text;
BEGIN
  IF NOT public.pode_editar('mapa') THEN
    RAISE EXCEPTION 'Sem permissão para ver dados pessoais desta camada' USING ERRCODE = '42501';
  END IF;
  SELECT dados INTO v_dados FROM public.camadas_mapa_dados_pessoais
   WHERE camada_id = p_camada AND pid = p_pid;
  IF v_dados IS NULL THEN RETURN '[]'::jsonb; END IF;
  FOR k, v IN SELECT key, value #>> '{}' FROM jsonb_each(v_dados) ORDER BY key LOOP
    IF k ~* '^(cpf|cnpj|cpf_?cnpj|cpfcnpj|rg|documento|doc_titular)$'
       OR (v ~ '^\D*\d{3}\D?\d{3}\D?\d{3}\D?\d{2}\D*$')
       OR (v ~ '^\D*\d{2}\D?\d{3}\D?\d{3}\D?\d{4}\D?\d{2}\D*$') THEN
      v_doc := COALESCE(v_doc, v);
      v := public.car_mascarar_documento(v);
    END IF;
    v_saida := v_saida || jsonb_build_array(jsonb_build_object('campo', k, 'valor', v));
  END LOOP;
  INSERT INTO public.lgpd_acesso_dado_terceiro (tabela, cod_imovel, cpf_cnpj, origem)
  VALUES ('camadas_mapa_dados_pessoais', p_camada::text || ':' || p_pid::text, v_doc, 'mapa_camada');
  RETURN v_saida;
END $$;
REVOKE ALL ON FUNCTION public.camada_dados_pessoais(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.camada_dados_pessoais(uuid, uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.camadas_mapa_campo_pessoal(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.camadas_mapa_campo_pessoal(text) TO authenticated;

-- ── 5. Aplicar às camadas existentes ──────────────────────────────────
INSERT INTO public.camadas_mapa_backup_367 (id, nome, geojson, copiado_em)
SELECT c.id, c.nome, c.geojson, now() FROM public.camadas_mapa c
WHERE EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(c.geojson->'features','[]')) f,
                    jsonb_object_keys(CASE WHEN jsonb_typeof(f->'properties')='object' THEN f->'properties' ELSE '{}' END) k
              WHERE public.camadas_mapa_campo_pessoal(k))
  AND NOT EXISTS (SELECT 1 FROM public.camadas_mapa_backup_367 b WHERE b.id = c.id);

UPDATE public.camadas_mapa c SET geojson = c.geojson
WHERE c.id IN (SELECT id FROM public.camadas_mapa_backup_367);

-- ── 6. ROPA ───────────────────────────────────────────────────────────
INSERT INTO public.lgpd_tratamentos
  (codigo, nome, modulo, finalidade, base_legal, base_legal_detalhe, categorias_titulares,
   categorias_dados, dado_sensivel, dado_de_menor, origem, origem_detalhe, tabelas,
   retencao_meses, retencao_criterio, compartilhamento, transferencia_internacional,
   alto_risco, observacoes, ativo)
SELECT 'TRAT-022', 'Ocupantes e detentores em camadas do Mapa das UCs', 'territorial',
  'Identificar ocupante, detentor ou proprietário de lote em camadas cartográficas enviadas pela gestão das UCs (ex.: lotes de RESEX/APA), para regularização fundiária e gestão da UC.',
  'politica_publica', 'Art. 7º, III — execução de política pública ambiental e de gestão de unidades de conservação.',
  ARRAY['ocupantes, detentores e proprietários de lotes em unidades de conservação'],
  ARRAY['CPF/CNPJ','nome'], false, false, 'coleta_terceiro',
  'Shapefiles/planilhas de levantamento fundiário enviados pela gestão das UCs como camadas do mapa.',
  ARRAY['camadas_mapa_dados_pessoais'], NULL,
  'Enquanto a camada existir no mapa; apagar a camada apaga os dados (ON DELETE CASCADE).',
  'Nenhum.', false, false,
  'Separado do GeoJSON público em 24/10/2026 (migration 367): antes, qualquer usuário autenticado baixava CPF e nome junto com a camada. Leitura só por camada_dados_pessoais() (pode_editar(''mapa'')), CPF/CNPJ mascarado, uma linha de log por consulta (origem mapa_camada). Cópia de segurança temporária em camadas_mapa_backup_367 — apagar depois de conferido.',
  true
WHERE NOT EXISTS (SELECT 1 FROM public.lgpd_tratamentos WHERE codigo = 'TRAT-022');
