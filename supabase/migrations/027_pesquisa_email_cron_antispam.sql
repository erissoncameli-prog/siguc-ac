-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Migration 027 — Automação de e-mail + anti-spam
-- Decisões finais do diagnóstico:
--   • Habilita pg_net e agenda o cron que drena a fila de e-mails
--   • Rate limit no portal público (alternativa server-side ao CAPTCHA)
--   • Documenta a semântica das etapas do enum (sem renomear)
-- ═══════════════════════════════════════════════════════════

-- ─── pg_net + cron de drenagem da fila de e-mails ────────────
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Drena pesquisa_emails (status pendente/erro) a cada 2 minutos,
-- chamando a edge function processar-pesquisa-emails (verify_jwt=false).
-- A chave anon é pública (já consta em js/config.js).
SELECT cron.schedule(
  'drain_pesquisa_emails',
  '*/2 * * * *',
  $cron$
    SELECT net.http_post(
      url := 'https://atqtybcsvepdabsvgaly.supabase.co/functions/v1/processar-pesquisa-emails',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'apikey', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF0cXR5YmNzdmVwZGFic3ZnYWx5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA0MjMzNzgsImV4cCI6MjA5NTk5OTM3OH0.hWx1AB2rK7xdco1Dgagm0XUOBPQbxZVE614SW4SKoLk',
        'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF0cXR5YmNzdmVwZGFic3ZnYWx5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA0MjMzNzgsImV4cCI6MjA5NTk5OTM3OH0.hWx1AB2rK7xdco1Dgagm0XUOBPQbxZVE614SW4SKoLk'
      ),
      body := '{}'::jsonb
    );
  $cron$
);

-- ─── Rate limit no portal público (anti-spam sem CAPTCHA) ─────
-- Recria submeter_pesquisa_publica com limite de 5 submissões por
-- e-mail/hora e 8 por CPF/dia. Tudo o mais é idêntico à 024.

CREATE OR REPLACE FUNCTION submeter_pesquisa_publica(
  p_titulo                text,
  p_resumo                text,
  p_tipo                  tipo_pesquisa,
  p_uc_id                 uuid DEFAULT NULL,
  p_data_inicio_prevista  date DEFAULT NULL,
  p_data_fim_prevista     date DEFAULT NULL,
  p_area_ha               numeric DEFAULT NULL,
  p_pesquisador_nome      text DEFAULT NULL,
  p_pesquisador_cpf       text DEFAULT NULL,
  p_pesquisador_email     text DEFAULT NULL,
  p_pesquisador_inst      text DEFAULT NULL,
  p_sisbio_numero         text DEFAULT NULL,
  p_sisgen_numero         text DEFAULT NULL,
  p_coleta_biologica      boolean DEFAULT false,
  p_pesquisa_humanos      boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_id            uuid;
  v_token         text;
  v_seq           bigint;
  v_ano           text;
  v_numero        text;
  v_gestor        uuid;
BEGIN
  -- Anti-spam (server-side)
  IF p_pesquisador_email IS NOT NULL AND (
       SELECT count(*) FROM pesquisas
       WHERE pesquisador_email = p_pesquisador_email
         AND criado_em > now() - interval '1 hour'
     ) >= 5 THEN
    RAISE EXCEPTION 'Muitas submissões recentes para este e-mail. Aguarde antes de tentar novamente.';
  END IF;

  IF p_pesquisador_cpf IS NOT NULL AND (
       SELECT count(*) FROM pesquisas
       WHERE pesquisador_cpf = p_pesquisador_cpf
         AND criado_em > now() - interval '1 day'
     ) >= 8 THEN
    RAISE EXCEPTION 'Limite diário de submissões atingido para este CPF.';
  END IF;

  v_token := encode(gen_random_bytes(18), 'base64');
  v_token := replace(replace(replace(v_token, '+', 'A'), '/', 'B'), '=', '');

  v_ano    := to_char(now(), 'YYYY');
  v_seq    := nextval('seq_numero_processo');
  v_numero := format('PESQ/SEMA-AC/%s/%s', v_ano, lpad(v_seq::text, 4, '0'));

  IF p_uc_id IS NOT NULL THEN
    SELECT ca.responsavel_atual_id INTO v_gestor
    FROM cargos_atuais ca JOIN cargos c ON c.id = ca.cargo_id
    WHERE c.nivel = 'gestor_uc' AND c.uc_id = p_uc_id
    LIMIT 1;
  END IF;

  INSERT INTO pesquisas (
    numero_processo, titulo, resumo, tipo,
    uc_id, data_inicio_prevista, data_fim_prevista, area_pesquisa_ha,
    pesquisador_nome, pesquisador_cpf, pesquisador_email, pesquisador_instituicao,
    sisbio_numero, sisbio_status,
    sisgen_numero, sisgen_status,
    coleta_biologica, pesquisa_humanos,
    origem, token_publico, etapa, gestor_uc_id
  )
  VALUES (
    v_numero, p_titulo, p_resumo, p_tipo,
    p_uc_id, p_data_inicio_prevista, p_data_fim_prevista, p_area_ha,
    p_pesquisador_nome, p_pesquisador_cpf, p_pesquisador_email, p_pesquisador_inst,
    nullif(p_sisbio_numero,''), CASE WHEN nullif(p_sisbio_numero,'') IS NOT NULL THEN 'pendente'::vinculo_sisbio ELSE 'nao_requerido'::vinculo_sisbio END,
    nullif(p_sisgen_numero,''), CASE WHEN nullif(p_sisgen_numero,'') IS NOT NULL THEN 'pendente'::vinculo_sisbio ELSE 'nao_requerido'::vinculo_sisbio END,
    p_coleta_biologica, p_pesquisa_humanos,
    'portal', v_token, 'submetida', v_gestor
  )
  RETURNING id INTO v_id;

  INSERT INTO pesquisa_historico (pesquisa_id, etapa_anterior, etapa_nova, usuario_id, observacao)
  VALUES (v_id, NULL, 'submetida', NULL, 'Submetida pelo pesquisador via portal público.');

  INSERT INTO pesquisa_emails (pesquisa_id, evento, destinatario, assunto)
  VALUES (v_id, 'submissao', p_pesquisador_email,
          '[SIGUC] Pesquisa ' || v_numero || ' recebida — SEMA/AC');

  IF v_gestor IS NOT NULL THEN
    INSERT INTO notificacoes (tipo, status, titulo, mensagem, destinatario_id, uc_id, sla_horas, sla_prazo, meta)
    VALUES ('sistema', 'enviada',
            'Nova pesquisa aguarda triagem: ' || p_titulo,
            'Uma nova pesquisa foi submetida pelo portal público e aguarda sua triagem.',
            v_gestor, p_uc_id, 48, now() + interval '48 hours',
            jsonb_build_object('pesquisa_id', v_id, 'etapa', 'submetida'));
  END IF;

  RETURN jsonb_build_object(
    'id',              v_id,
    'numero_processo', v_numero,
    'token_publico',   v_token
  );
END;
$$;

-- ─── Documentação da semântica das etapas (sem renomear) ─────
COMMENT ON TYPE etapa_pesquisa IS
  'Fluxo SEMA-AC. Atenção à semântica real (mantida por compatibilidade): '
  'parecer_juridico = Parecer do Diretor DIMA; '
  'aap_emissao = aguardando Autorização do Secretário; '
  'aap_assinatura = Emissão da AAP pelo Chefe DEUC; '
  'aap_publicada = AAP emitida/entregue. '
  'Rótulos de exibição definidos em pages/pesquisas.html (const ETAPAS).';
