-- 314_ar_purpleair_cron.sql
--
-- Liga o cron da ingestão PurpleAir/MPAC — PURPLEAIR_API_KEY foi
-- configurada nos secrets do Supabase em 22/08/2026 e a função já foi
-- testada contra a API de verdade (28 sensores no Acre, dois bugs reais
-- corrigidos na ingest-purpleair: índice de campo duplicado e
-- temperatura em Fahrenheit não convertida — ver cabeçalho da função).
--
-- De hora em hora, mesmo período do rh-checar-cotas (307_rh_crons.sql)
-- — não precisa ser mais frequente que isso para o uso do boletim
-- diário, e evita gastar limite de chamadas da chave gratuita à toa.
--
-- Mesmo padrão de chamada dos crons que já existem (ingest-focos,
-- rh-checar-cotas): net.http_post com a chave anônima no header.

SELECT cron.unschedule('ingest-purpleair') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname='ingest-purpleair');

SELECT cron.schedule(
  'ingest-purpleair',
  '15 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://atqtybcsvepdabsvgaly.supabase.co/functions/v1/ingest-purpleair',
    headers := jsonb_build_object(
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF0cXR5YmNzdmVwZGFic3ZnYWx5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA0MjMzNzgsImV4cCI6MjA5NTk5OTM3OH0.hWx1AB2rK7xdco1Dgagm0XUOBPQbxZVE614SW4SKoLk',
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  );
  $$
);
