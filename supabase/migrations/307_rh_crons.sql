-- 307_rh_crons.sql
--
-- Agendamentos da Fase C (plataformas hidrometeorológicas):
--
-- 1. rh-checar-cotas (de hora em hora) — chama rh_checar_cotas(), que
--    notifica quando uma estação passa da cota de atenção/alerta/
--    inundação. De hora em hora, e não 1×/dia como os outros crons do
--    projeto, porque cheia é evento rápido: um aviso que chega no dia
--    seguinte não serve para nada. O dedupe por `ref` (migration 306b)
--    garante uma notificação por estação/situação/dia, então rodar de
--    hora em hora não vira spam.
--
-- 2. hidro-relatorio-diario (11h UTC = 08h BRT) — Edge Function que
--    envia o resumo do dia anterior por e-mail para
--    config_sistema.dados.hidro.emails (Configurações › Qualidade da
--    Água). Lista vazia = não envia nada, e isso é decisão válida.
--
-- 3. ingest-hidro — NÃO agendado nesta migration, de propósito: a
--    função existe e está publicada, mas sem as credenciais da ANA nos
--    secrets ela só devolve 'sem-credencial'. Agendar um cron que não
--    faz nada polui o log e cria a impressão de que a ingestão está
--    ligada. O comando pronto está no comentário abaixo — basta rodar
--    depois de cadastrar ANA_HIDROWEB_ID/ANA_HIDROWEB_SENHA.
--
-- Mesmo padrão de chamada dos crons que já existem (ingest-focos,
-- monitorar-alertas): net.http_post com a chave anônima no header.

-- Reaplicável: cron.schedule falha se o job já existir com outro
-- comando, então a migration aplicada em produção desagenda antes.
SELECT cron.unschedule('rh-checar-cotas') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname='rh-checar-cotas');
SELECT cron.unschedule('hidro-relatorio-diario') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname='hidro-relatorio-diario');

SELECT cron.schedule(
  'rh-checar-cotas',
  '35 * * * *',
  $$SELECT rh_checar_cotas();$$
);

SELECT cron.schedule(
  'hidro-relatorio-diario',
  '0 11 * * *',
  $$
  SELECT net.http_post(
    url := 'https://atqtybcsvepdabsvgaly.supabase.co/functions/v1/hidro-relatorio-diario',
    headers := jsonb_build_object(
      -- Chave ANÔNIMA (pública, a mesma de js/config.js) — mesmo
      -- padrão dos crons ingest-focos/monitorar-alertas. A função é
      -- verify_jwt, então precisa de um JWT válido; nunca a service
      -- role aqui.
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...(chave anônima do projeto)',
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  );
  $$
);

-- Quando as credenciais da ANA existirem, ligar a ingestão com:
--
--   SELECT cron.schedule(
--     'ingest-hidro-diario',
--     '10 10 * * *',
--     $$SELECT net.http_post(
--         url := 'https://atqtybcsvepdabsvgaly.supabase.co/functions/v1/ingest-hidro',
--         headers := jsonb_build_object('Authorization','Bearer <anon>','Content-Type','application/json'),
--         body := '{}'::jsonb);$$);
