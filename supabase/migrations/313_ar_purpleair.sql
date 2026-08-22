-- 313_ar_purpleair.sql
--
-- Item 1 do que ficou pendente na Fase 3 do Boletim do Tempo: deixar
-- PRONTA E DESLIGADA a ingestão de qualidade do ar (rede PurpleAir/
-- MPAC) — mesmo padrão do ingest-hidro (migrations 306/307): sem
-- PURPLEAIR_API_KEY nos secrets, a função devolve
-- {ok:false, motivo:'sem-credencial'} e não grava nada. Isto é só o
-- CANO de dado (tabela + função); não ativa o módulo `ar` para uso
-- geral nem cria tela — Fase D do plano de Recursos Hídricos continua
-- sem página, como estava.
--
-- CONFIRMADO ANTES DE DESENHAR (mesmo cuidado da ANA/HidroWeb): testei
-- `GET https://api.purpleair.com/v1/sensors` via pg_net do banco, sem
-- chave — devolveu HTTP 403 `{"error":"ApiKeyMissingError"}`. O
-- endpoint existe e a URL está certa; falta só a credencial (chave
-- gratuita vinculada a conta Google, registro em
-- develop.purpleair.com — ação humana, mesma classe da credencial da
-- ANA). A API é bem documentada publicamente (api.purpleair.com), só
-- o ACESSO exige chave.
--
-- SEM CALIBRAÇÃO LRAPA AINDA — decisão deliberada. O boletim real
-- aplica um "fator de calibração estatística LRAPA" ao PM2.5 bruto do
-- PurpleAir antes de publicar. A fórmula publicada pela EPA/LRAPA é
-- conhecida (PM corrigido = 0,5×PM_cf1 − 0,66×UR + 5,75), mas esta
-- migration NÃO a aplica: sem uma leitura real para conferir contra um
-- boletim já publicado, gravar um "calibrado" não validado seria
-- inventar número — mesma disciplina que a Qualidade da Água já usa
-- (Fase 1: "IQA da planilha NÃO foi gravado" até a Fase 2 confirmar o
-- cálculo por RPC própria). `pm25_bruto` grava o dado como veio da
-- API (campo `pm2.5_cf_1`); `pm25_calibrado_lrapa` fica NULL até
-- alguém confirmar a fórmula contra um boletim publicado de verdade.
--
-- Grão da tabela: NÃO existe inventário próprio de sensores (ao
-- contrário de rh_estacoes) — a rede do MPAC não tem uma lista
-- pública de `sensor_index`, e inventar uma lista sem ver o dado real
-- seria o mesmo erro de fabricar coordenada. A ingestão descobre os
-- sensores pela busca por CAIXA DELIMITADORA (bbox) do Acre a cada
-- execução — por isso `limite_acre_bbox()` abaixo, reaproveitando a
-- MESMA geometria de limite_acre (migration 239) que já sustenta o
-- recorte de focos/alertas — nunca uma bbox fixa hardcoded numa
-- segunda cópia.

CREATE OR REPLACE FUNCTION limite_acre_bbox()
RETURNS TABLE (min_lng double precision, min_lat double precision, max_lng double precision, max_lat double precision)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT ST_XMin(geom), ST_YMin(geom), ST_XMax(geom), ST_YMax(geom) FROM limite_acre LIMIT 1;
$$;

REVOKE EXECUTE ON FUNCTION limite_acre_bbox() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION limite_acre_bbox() FROM anon;
GRANT  EXECUTE ON FUNCTION limite_acre_bbox() TO authenticated;

CREATE TABLE IF NOT EXISTS ar_leituras_purpleair (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sensor_index          bigint NOT NULL,       -- id do sensor na PurpleAir
  nome                  text,
  geom                  geometry(Point, 4326),
  pm25_bruto            numeric(8,2),          -- pm2.5_cf_1, direto da API — NUNCA calibrado aqui
  pm25_calibrado_lrapa  numeric(8,2),          -- NULL até a fórmula ser confirmada (ver cabeçalho)
  umidade_pct           numeric(5,2),
  temperatura_c         numeric(5,2),
  data_hora             timestamptz NOT NULL,  -- last_seen do sensor, convertido de epoch
  bruto                 jsonb,                 -- payload cru da linha, para auditoria
  criado_em             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ar_leituras_purpleair_unica UNIQUE (sensor_index, data_hora)
);

CREATE INDEX IF NOT EXISTS ar_leituras_purpleair_data_idx ON ar_leituras_purpleair (data_hora DESC);
CREATE INDEX IF NOT EXISTS ar_leituras_purpleair_geom_idx ON ar_leituras_purpleair USING GIST (geom);

ALTER TABLE ar_leituras_purpleair ENABLE ROW LEVEL SECURITY;

-- Só leitura por quem alcança o módulo `ar` (hoje só super_admin —
-- módulo inativo desde a migration 303). Sem policy de escrita para
-- `authenticated`: só a Edge Function grava, com a service_role key
-- (bypassa RLS), mesmo padrão de ingest-focos/monitorar-alertas —
-- nunca o cliente insere leitura de sensor direto.
DROP POLICY IF EXISTS ar_leituras_purpleair_select ON ar_leituras_purpleair;
CREATE POLICY ar_leituras_purpleair_select ON ar_leituras_purpleair FOR SELECT
  TO authenticated USING (pode_ver('ar'));
