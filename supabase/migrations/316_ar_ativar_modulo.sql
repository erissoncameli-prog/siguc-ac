-- 316_ar_ativar_modulo.sql
--
-- Tela própria de Qualidade do Ar (pages/ar-qualidade.html) — o
-- módulo `ar`, criado inativo pela 303 (só super_admin alcançava),
-- passa a valer para os perfis do catálogo. Mesmo passo que a 304 deu
-- para 'bacias' quando a mesa de lá nasceu.
--
-- `grupo` já era 'Gestão' (303) e `exige_lotacao` já era FALSE — sem
-- mudança: leitura de sensor de ar não tem CPF nem laudo, mesmo
-- raciocínio da 304 para bacias (esconder do resto da SEMA uma
-- leitura ambiental pública não faz sentido).
--
-- View `vw_ar_sensores_atual`: leitura MAIS RECENTE de cada sensor,
-- SECURITY INVOKER (padrão 165/047) — a RLS de `ar_leituras_purpleair`
-- (pode_ver('ar')) continua valendo para quem consulta a view. lat/lng
-- extraídos como as outras views do projeto (ST_Y/ST_X). Diferente da
-- RPC `rh_boletim_qualidade_ar()` (migration 315, gate por
-- `pode_ver('bacias')` para quem monta o boletim): esta view serve a
-- TELA de qualidade do ar, gate pelo módulo `ar` propriamente.

UPDATE modulos
   SET ativo = true,
       rota  = '../pages/ar-qualidade.html',
       atualizado_em = now()
 WHERE chave = 'ar';

DO $$
DECLARE v_ativo boolean;
BEGIN
  SELECT ativo INTO v_ativo FROM modulos WHERE chave = 'ar';
  IF v_ativo IS NOT TRUE THEN
    RAISE EXCEPTION 'Módulo ar não ficou ativo — verifique se a migration 303 foi aplicada';
  END IF;
END $$;

DROP VIEW IF EXISTS vw_ar_sensores_atual;
CREATE VIEW vw_ar_sensores_atual
WITH (security_invoker = true) AS
SELECT DISTINCT ON (l.sensor_index)
  l.sensor_index, l.nome, l.pm25_bruto, l.pm25_calibrado_lrapa,
  l.umidade_pct, l.temperatura_c, l.data_hora,
  ST_Y(l.geom) AS lat, ST_X(l.geom) AS lng
FROM ar_leituras_purpleair l
ORDER BY l.sensor_index, l.data_hora DESC;
