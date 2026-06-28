-- Adiciona foto_urls às tabelas de eventos do biomonitor que ainda
-- não possuem o campo (ninhos e eclosões já têm desde a migration 074).
-- Permite registrar evidências fotográficas em visitas, transferências,
-- solturas e ocorrências de berçário, com marca d'água aplicada no app.

ALTER TABLE visitas_ninho
  ADD COLUMN IF NOT EXISTS foto_urls text[];

ALTER TABLE transferencias_ninho
  ADD COLUMN IF NOT EXISTS foto_urls text[];

ALTER TABLE solturas_filhotes
  ADD COLUMN IF NOT EXISTS foto_urls text[];

ALTER TABLE ocorrencias_bercario
  ADD COLUMN IF NOT EXISTS foto_urls text[];
