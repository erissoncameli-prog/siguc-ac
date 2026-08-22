-- 312_rh_boletins.sql
--
-- Fase 0 do módulo de composição do Boletim do Tempo / Relatório
-- Hidrometeorológico (DERHQA/CIGMA). Ver a proposta completa na
-- conversa que originou esta migration — resumo aqui:
--
-- O que os dois documentos reais mostram é montado hoje à mão
-- (PowerPoint + QGIS + Excel), a partir de fontes externas (CENSIPAM,
-- INMET, ANA, BDQueimadas/INPE, PurpleAir/SISAM, CPTEC). Nem tudo é
-- automatizável: mapas de risco de fogo e de anomalia de chuva são
-- raster processado em QGIS, fora do padrão deste projeto (Vercel +
-- Supabase, sem servidor GIS). A solução é um documento COMPOSTO por
-- blocos: os que o banco já sabe calcular entram automáticos na hora
-- de gerar o PDF (nunca congelados aqui — recalculados sempre); os que
-- exigem QGIS/redação humana entram como texto ou imagem anexada.
--
-- Blocos AUTOMÁTICOS (não têm coluna aqui — calculados na hora do PDF):
--   • Nível dos rios / PCD por bacia         → rh_relatorio_diario()
--   • Chuva acumulada por estação            → rh_medicoes
--   • Focos de calor por município/período   → focos_calor + PIP
--     client-side (js/mapa-recorte.js, geoMunicipioEm) — achado ao
--     construir isto: focos_calor.municipio nunca é preenchido na
--     ingestão (0 de 291 linhas), então não dá para agrupar com SQL
--     puro; a classificação sempre foi manual em quem montava o
--     boletim, olhando o mapa.
--
-- Blocos MANUAIS (colunas desta tabela): previsão regional (CENSIPAM),
-- aviso meteorológico (INMET), prognóstico de chuva da semana (NCEP),
-- mapas de chuva/anomalia e de risco de fogo (QGIS, upload de imagem),
-- qualidade do ar (PurpleAir/SISAM, upload) e prognóstico climático
-- sazonal (CPTEC, só no Relatório Hidrometeorológico, trimestral).
--
-- NUMERAÇÃO: cada tipo tem sua própria série (o Boletim do Tempo e o
-- Relatório Hidrometeorológico são numerados independentemente — os
-- dois documentos reais fornecidos, mesma data 21/08/2026, trazem
-- Nº149 e Nº148). Atribuída SÓ NA PUBLICAÇÃO (rh_publicar_boletim),
-- nunca na criação — um rascunho abandonado não pode furar a
-- sequência. Contador seguindo o padrão de frota_abast_contador
-- (migration 175): tabela + ON CONFLICT...RETURNING dentro de função
-- SECURITY DEFINER, sem policy de acesso direto.
--
-- Contador semeado no ÚLTIMO número conhecido dos boletins reais
-- (149/148) para a numeração do sistema continuar a série oficial que
-- a SEMA já publica em papel — CONFERIR com o CIGMA antes da primeira
-- publicação: se algum boletim foi emitido depois de 21/08/2026 fora
-- deste sistema, o contador precisa ser ajustado (UPDATE simples,
-- nunca decisão de código).

DO $$ BEGIN
  CREATE TYPE rh_tipo_boletim AS ENUM ('boletim_tempo', 'relatorio_hidrometeorologico');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE rh_status_boletim AS ENUM ('rascunho', 'publicado');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS rh_boletins (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo                rh_tipo_boletim NOT NULL,
  numero              integer,                -- NULL até publicar
  data_referencia     date NOT NULL DEFAULT current_date,
  status              rh_status_boletim NOT NULL DEFAULT 'rascunho',

  -- Bloco: previsão regional (CENSIPAM) — array de
  -- {cidade, temp_max, temp_min, ur_max, ur_min, vento_dir, condicao}.
  -- Fica em jsonb (não uma tabela filha) porque nunca é consultado à
  -- parte — só lido/escrito inteiro, sempre junto do boletim.
  previsao_regional        jsonb NOT NULL DEFAULT '[]'::jsonb,

  aviso_meteorologico       text,   -- INMET
  prognostico_chuva_texto   text,   -- leitura do mapa NCEP da semana

  mapa_chuva_url            text,   -- imagem QGIS (anomalia/previsão de chuva)
  mapa_risco_fogo_url       text,   -- imagem QGIS (risco de fogo, estado)
  texto_risco_fogo          text,
  mapa_risco_fogo_ucs_url   text,   -- imagem QGIS (risco de fogo, UCs)
  texto_risco_fogo_ucs      text,

  qualidade_ar_purpleair_url    text,
  qualidade_ar_purpleair_texto  text,
  qualidade_ar_sisam_url        text,
  qualidade_ar_sisam_texto      text,

  -- Só usado quando tipo = 'relatorio_hidrometeorologico' (trimestral,
  -- CPTEC/INPE/INMET/FUNCEME) — sem CHECK: um relatório_hidrometeorologico
  -- antigo sem esse texto ainda é um documento válido.
  prognostico_sazonal_texto     text,

  observacoes         text,
  criado_por          uuid REFERENCES usuarios(id),
  criado_em           timestamptz NOT NULL DEFAULT now(),
  atualizado_em       timestamptz NOT NULL DEFAULT now(),
  publicado_por       uuid REFERENCES usuarios(id),
  publicado_em        timestamptz
);

-- Único por tipo QUANDO publicado — dois rascunhos do mesmo tipo/dia
-- não colidem (numero NULL não entra em índice único).
CREATE UNIQUE INDEX IF NOT EXISTS uq_rh_boletins_tipo_numero
  ON rh_boletins (tipo, numero) WHERE numero IS NOT NULL;
CREATE INDEX IF NOT EXISTS rh_boletins_tipo_data_idx ON rh_boletins (tipo, data_referencia DESC);

DROP TRIGGER IF EXISTS trg_rh_boletins_touch ON rh_boletins;
CREATE TRIGGER trg_rh_boletins_touch BEFORE UPDATE ON rh_boletins
  FOR EACH ROW EXECUTE FUNCTION touch_atualizado_em();

ALTER TABLE rh_boletins ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rh_boletins_select ON rh_boletins;
CREATE POLICY rh_boletins_select ON rh_boletins FOR SELECT
  TO authenticated USING (pode_ver('bacias'));
-- UPDATE/INSERT/DELETE por pode_editar, MAS a coluna `numero` só é
-- gravada pela RPC abaixo (o cliente nunca escolhe o próprio número —
-- validado no corpo da função, não dá para expressar "não confie no
-- valor desta coluna vindo do cliente" numa policy de RLS comum).
DROP POLICY IF EXISTS rh_boletins_write ON rh_boletins;
CREATE POLICY rh_boletins_write ON rh_boletins FOR ALL
  TO authenticated USING (pode_editar('bacias')) WITH CHECK (pode_editar('bacias'));

-- ── Numeração sequencial por tipo ────────────────────────────────
CREATE TABLE IF NOT EXISTS rh_boletim_contador (
  tipo   rh_tipo_boletim PRIMARY KEY,
  ultimo integer NOT NULL DEFAULT 0
);
ALTER TABLE rh_boletim_contador ENABLE ROW LEVEL SECURITY;
-- Sem policies: acesso só via rh_publicar_boletim (SECURITY DEFINER).

INSERT INTO rh_boletim_contador (tipo, ultimo) VALUES
  ('boletim_tempo', 149),
  ('relatorio_hidrometeorologico', 148)
ON CONFLICT (tipo) DO NOTHING;

CREATE OR REPLACE FUNCTION rh_publicar_boletim(p_id uuid)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_tipo   rh_tipo_boletim;
  v_status rh_status_boletim;
  v_num    integer;
BEGIN
  IF NOT pode_editar('bacias') THEN
    RAISE EXCEPTION 'Sem permissão para publicar boletim.';
  END IF;

  SELECT tipo, status INTO v_tipo, v_status FROM rh_boletins WHERE id = p_id FOR UPDATE;
  IF v_tipo IS NULL THEN
    RAISE EXCEPTION 'Boletim não encontrado.';
  END IF;
  IF v_status = 'publicado' THEN
    RAISE EXCEPTION 'Este boletim já foi publicado.';
  END IF;

  INSERT INTO rh_boletim_contador (tipo, ultimo) VALUES (v_tipo, 1)
    ON CONFLICT (tipo) DO UPDATE SET ultimo = rh_boletim_contador.ultimo + 1
    RETURNING ultimo INTO v_num;

  UPDATE rh_boletins
     SET numero = v_num, status = 'publicado',
         publicado_por = auth.uid(), publicado_em = now()
   WHERE id = p_id;

  RETURN v_num;
END;
$$;

REVOKE EXECUTE ON FUNCTION rh_publicar_boletim(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION rh_publicar_boletim(uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION rh_publicar_boletim(uuid) TO authenticated;

-- ── Bucket privado das imagens dos blocos (mapas QGIS, PurpleAir/SISAM) ──
-- Mesmo padrão da 258 (agua-fotos-campo): privado desde o nascimento,
-- WRITE só por pode_editar('bacias') — não há assimetria de dono de
-- registro aqui (só quem edita Bacias monta boletim).
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('rh-boletim-imagens', 'rh-boletim-imagens', false, 8388608,
  ARRAY['image/jpeg','image/jpg','image/png','image/webp'])
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS rh_boletim_imagens_read ON storage.objects;
CREATE POLICY rh_boletim_imagens_read ON storage.objects
  FOR SELECT USING (bucket_id = 'rh-boletim-imagens' AND pode_ver('bacias'));

DROP POLICY IF EXISTS rh_boletim_imagens_insert ON storage.objects;
CREATE POLICY rh_boletim_imagens_insert ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'rh-boletim-imagens' AND pode_editar('bacias'));

DROP POLICY IF EXISTS rh_boletim_imagens_update ON storage.objects;
CREATE POLICY rh_boletim_imagens_update ON storage.objects
  FOR UPDATE USING (bucket_id = 'rh-boletim-imagens' AND pode_editar('bacias'));

DROP POLICY IF EXISTS rh_boletim_imagens_delete ON storage.objects;
CREATE POLICY rh_boletim_imagens_delete ON storage.objects
  FOR DELETE USING (bucket_id = 'rh-boletim-imagens' AND pode_editar('bacias'));
