-- 315_rh_boletim_qualidade_ar.sql
--
-- Bloco automático de qualidade do ar no Boletim (rh-boletim.html):
-- pergunta do usuário foi "onde vejo qualidade do ar?" — a ingestão
-- do PurpleAir/MPAC (migration 313) já roda de hora em hora, mas
-- ninguém que monta o boletim conseguia ver o dado, porque
-- `ar_leituras_purpleair` é RLS por `pode_ver('ar')` e o módulo `ar`
-- segue INATIVO (só super_admin alcança, migration 303) — a Fase D
-- (tela própria de Qualidade do Ar) não existe ainda.
--
-- Em vez de afrouxar a RLS do módulo `ar` (abriria a tabela inteira,
-- inclusive o histórico bruto e `bruto` jsonb, para todo mundo que
-- edita Bacias), uma RPC de leitura RESTRITA — mesmo padrão de
-- `agua_publico_*` (migration 297): lista explícita de colunas,
-- SECURITY DEFINER, só a leitura MAIS RECENTE por sensor (não o
-- histórico). Quem pode montar o boletim (`pode_ver('bacias')`) passa
-- a ver isso; a tela de Qualidade do Ar propriamente dita, se um dia
-- for construída, continua decidindo o próprio acesso via módulo `ar`.

CREATE OR REPLACE FUNCTION rh_boletim_qualidade_ar()
RETURNS TABLE (
  sensor_index bigint,
  nome         text,
  pm25_bruto   numeric,
  umidade_pct  numeric,
  temperatura_c numeric,
  data_hora    timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT DISTINCT ON (l.sensor_index)
    l.sensor_index, l.nome, l.pm25_bruto, l.umidade_pct, l.temperatura_c, l.data_hora
  FROM ar_leituras_purpleair l
  WHERE pode_ver('bacias')
  ORDER BY l.sensor_index, l.data_hora DESC;
$$;

REVOKE EXECUTE ON FUNCTION rh_boletim_qualidade_ar() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION rh_boletim_qualidade_ar() FROM anon;
GRANT  EXECUTE ON FUNCTION rh_boletim_qualidade_ar() TO authenticated;
