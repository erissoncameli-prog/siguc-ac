-- 305_notificacao_enum_hidro.sql
--
-- Novo valor 'hidro' em tipo_notificacao, para os avisos das
-- plataformas hidrometeorológicas (cota de alerta/inundação atingida,
-- resumo diário por rio).
--
-- Migration PRÓPRIA por regra do projeto: um valor novo de enum só
-- pode ser USADO depois de commitado ("unsafe use of new value ...
-- must be committed"), então o ALTER TYPE nunca pode dividir migration
-- com o INSERT/função que o usa — mesma lição das migrations 161
-- (frota) e 229 (biomonitor).

ALTER TYPE tipo_notificacao ADD VALUE IF NOT EXISTS 'hidro';
