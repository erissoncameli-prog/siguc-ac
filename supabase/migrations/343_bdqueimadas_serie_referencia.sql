-- ═══════════════════════════════════════════════════════════
-- 343 · Focos de calor do BDQueimadas/INPE — série do SATÉLITE DE
--       REFERÊNCIA (Painel de Fogo e Desmatamento)
-- ═══════════════════════════════════════════════════════════
-- O painel mostrava só a série FIRMS/NASA (MODIS + VIIRS S-NPP, na
-- temporada 1º/jul–4/nov). Pedido: acrescentar o BDQueimadas do INPE.
--
-- Qual série do INPE: a do SATÉLITE DE REFERÊNCIA (AQUA_M-T), ano
-- civil inteiro — é a que o INPE usa nas estatísticas oficiais por
-- estado, justamente porque um satélite só mantém os anos comparáveis
-- entre si. `focos_calor` já recebe o BDQueimadas diário, mas com
-- TODOS os satélites e só dos últimos dias; somar satélites faria o
-- ano recente parecer pior só por ter mais satélite em órbita.
--
-- Fonte: arquivos anuais de dados abertos do INPE
--   dataserver-coids.inpe.br/queimadas/queimadas/focos/csv/anual/
--   EstadosBr_sat_ref/AC/focos_br_ac_ref_AAAA.zip   (2003–2024)
--   Brasil_sat_ref/focos_br_ref_AAAA.zip            (anos seguintes)
-- São .zip — o banco não descompacta, então quem baixa é a Edge
-- Function `importar-bdq-referencia` (UM ano por chamada, por limite de
-- CPU). Ela só importa ano FECHADO e AUSENTE daqui: chamá-la de novo
-- não refaz nada (é pública como as demais — a chave dos crons é anon).
--
-- Estado: vale o campo `estado` do próprio INPE, para o total bater com
-- o número oficial publicado. A UC é atribuída aqui, por ponto-em-
-- polígono, com os mesmos limites de `unidades_conservacao`.
--
-- NUNCA somar com a série FIRMS: janela (ano civil × temporada) e
-- satélites diferentes. O painel mostra uma fonte por vez.
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.focos_bdq_ref (
  id         bigserial PRIMARY KEY,
  ano        smallint NOT NULL,
  data_hora  timestamptz NOT NULL,
  lat        double precision NOT NULL,
  lon        double precision NOT NULL,
  municipio  text,
  uc_id      uuid REFERENCES public.unidades_conservacao(id) ON DELETE SET NULL,
  CONSTRAINT focos_bdq_ref_unq UNIQUE (data_hora, lat, lon)
);
CREATE INDEX IF NOT EXISTS focos_bdq_ref_ano_idx ON public.focos_bdq_ref (ano);
COMMENT ON TABLE public.focos_bdq_ref IS
  'Focos BDQueimadas/INPE, satélite de referência (AQUA_M-T), Acre, ano civil. Importado por ano pela Edge Function importar-bdq-referencia.';

-- Agregado lido pelo painel (ano × mês × UC; uc_id NULL = fora de UC)
CREATE TABLE IF NOT EXISTS public.focos_bdq_uc_mes (
  ano    smallint NOT NULL,
  mes    smallint NOT NULL CHECK (mes BETWEEN 1 AND 12),
  uc_id  uuid REFERENCES public.unidades_conservacao(id) ON DELETE CASCADE,
  focos  integer NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS focos_bdq_uc_mes_unq
  ON public.focos_bdq_uc_mes (ano, mes, coalesce(uc_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- Total oficial por ano (e de qual arquivo veio — auditável)
CREATE TABLE IF NOT EXISTS public.focos_bdq_resumo_ano (
  ano            smallint PRIMARY KEY,
  focos          integer NOT NULL,
  arquivo        text NOT NULL,
  atualizado_em  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.focos_bdq_ref        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.focos_bdq_uc_mes     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.focos_bdq_resumo_ano ENABLE ROW LEVEL SECURITY;

-- Leitura: mesmo módulo do mapa/painel. Escrita: só service_role (Edge
-- Function), que ignora RLS — nenhuma policy de escrita para ninguém.
DROP POLICY IF EXISTS focos_bdq_ref_select ON public.focos_bdq_ref;
CREATE POLICY focos_bdq_ref_select ON public.focos_bdq_ref
  FOR SELECT TO authenticated USING (public.pode_ver('mapa'));
DROP POLICY IF EXISTS focos_bdq_uc_mes_select ON public.focos_bdq_uc_mes;
CREATE POLICY focos_bdq_uc_mes_select ON public.focos_bdq_uc_mes
  FOR SELECT TO authenticated USING (public.pode_ver('mapa'));
DROP POLICY IF EXISTS focos_bdq_resumo_ano_select ON public.focos_bdq_resumo_ano;
CREATE POLICY focos_bdq_resumo_ano_select ON public.focos_bdq_resumo_ano
  FOR SELECT TO authenticated USING (public.pode_ver('mapa'));

REVOKE ALL ON public.focos_bdq_ref, public.focos_bdq_uc_mes, public.focos_bdq_resumo_ano FROM anon;

-- Chamada pela Edge Function depois de gravar os pontos de um ano:
-- atribui UC (junção espacial em lote, não ponto a ponto) e refaz os
-- agregados daquele ano.
CREATE OR REPLACE FUNCTION public.bdq_ref_reagregar(p_ano int, p_arquivo text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_total int;
BEGIN
  UPDATE focos_bdq_ref f SET uc_id = NULL WHERE f.ano = p_ano;
  UPDATE focos_bdq_ref f
     SET uc_id = s.uc_id
    FROM (
      SELECT DISTINCT ON (f2.id) f2.id, u.id AS uc_id
        FROM focos_bdq_ref f2
        JOIN unidades_conservacao u
          ON u.ativo AND u.geom IS NOT NULL
         AND ST_Within(ST_SetSRID(ST_MakePoint(f2.lon, f2.lat), 4326), u.geom)
       WHERE f2.ano = p_ano
       ORDER BY f2.id, u.id
    ) s
   WHERE f.id = s.id;

  DELETE FROM focos_bdq_uc_mes WHERE ano = p_ano;
  INSERT INTO focos_bdq_uc_mes (ano, mes, uc_id, focos)
  -- mês em GMT: o mesmo relógio que define o ano no arquivo do INPE
  SELECT p_ano, extract(month FROM data_hora AT TIME ZONE 'UTC')::smallint, uc_id, count(*)
    FROM focos_bdq_ref WHERE ano = p_ano
   GROUP BY 2, 3;

  SELECT count(*) INTO v_total FROM focos_bdq_ref WHERE ano = p_ano;
  INSERT INTO focos_bdq_resumo_ano (ano, focos, arquivo, atualizado_em)
  VALUES (p_ano, v_total, p_arquivo, now())
  ON CONFLICT (ano) DO UPDATE SET focos = EXCLUDED.focos, arquivo = EXCLUDED.arquivo, atualizado_em = now();
  RETURN v_total;
END $$;

REVOKE ALL ON FUNCTION public.bdq_ref_reagregar(int, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bdq_ref_reagregar(int, text) TO service_role;
