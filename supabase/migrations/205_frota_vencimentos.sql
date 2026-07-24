-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Frota — alerta de vencimento de documentos e CNH
-- (Fase 6 do plano em docs/frota-analise-e-plano.md)
--
-- `frota_veiculo_documentos` existe desde a 154 e está VAZIA: a tabela
-- foi criada, o fluxo nunca. CRLV, seguro, IPVA e licenciamento vencem
-- e ninguém é avisado. O mesmo vale para CNH e habilitação fluvial,
-- que já são colunas de frota_motoristas e só apareciam como badge em
-- quem abrisse a tela de cadastro.
--
-- Esta migration fecha isso reaproveitando o que já existe: o módulo
-- de notificações (162) e o pg_cron (que já roda verificar_prazos_pesquisa
-- como função SQL pura — o padrão mais limpo do projeto, sem HTTP e
-- sem chave embutida no comando do job).
--
-- DEDUPE — o ponto delicado de qualquer alerta recorrente
-- Rodando todo dia, o ingênuo notificaria o mesmo documento 30 vezes.
-- A chave `ref` do meta carrega o alvo E a fase
-- ('doc:<id>:proximo' / 'doc:<id>:vencido'), e só notifica se não
-- houver notificação não resolvida com aquela mesma ref. Assim o
-- gestor recebe UM aviso quando entra na janela de 30 dias e UM
-- quando de fato vence — não um por dia.
-- ═══════════════════════════════════════════════════════════

-- ── View unificada (mesa) ──────────────────────────────────────
-- Junta documento de veículo e habilitação de motorista numa lista só,
-- que é como a gestão pensa o assunto ("o que vence agora?").
DROP VIEW IF EXISTS vw_frota_vencimentos;
CREATE VIEW vw_frota_vencimentos WITH (security_invoker = true) AS
SELECT
  'documento'::text          AS origem,
  d.id                       AS ref_id,
  d.veiculo_id,
  NULL::uuid                 AS motorista_id,
  d.tipo::text               AS tipo,
  COALESCE(d.descricao, d.tipo::text) AS descricao,
  d.numero,
  d.data_vencimento,
  (d.data_vencimento - CURRENT_DATE) AS dias_restantes,
  v.placa                    AS veiculo_placa,
  v.modelo                   AS veiculo_modelo,
  NULL::text                 AS motorista_nome
FROM frota_veiculo_documentos d
JOIN frota_veiculos v ON v.id = d.veiculo_id
WHERE d.data_vencimento IS NOT NULL AND v.ativo

UNION ALL

SELECT
  'cnh'::text, m.id, NULL::uuid, m.id,
  'cnh'::text,
  'CNH' || COALESCE(' ' || m.cnh_categoria, ''),
  m.cnh_numero,
  m.cnh_validade,
  (m.cnh_validade - CURRENT_DATE),
  NULL::text, NULL::text, m.nome
FROM frota_motoristas m
WHERE m.cnh_validade IS NOT NULL AND m.ativo

UNION ALL

SELECT
  'habilitacao_fluvial'::text, m.id, NULL::uuid, m.id,
  'habilitacao_fluvial'::text,
  'Habilitação fluvial',
  m.habilitacao_fluvial,
  m.habilitacao_fluvial_validade,
  (m.habilitacao_fluvial_validade - CURRENT_DATE),
  NULL::text, NULL::text, m.nome
FROM frota_motoristas m
WHERE m.habilitacao_fluvial_validade IS NOT NULL AND m.ativo;


-- ── Verificação diária ─────────────────────────────────────────
-- Roda pelo pg_cron. SECURITY DEFINER porque o cron não tem sessão de
-- usuário e precisa ler tudo e escrever notificação.
--
-- p_dias: antecedência do aviso (padrão 30).
-- Retorna quantas notificações criou — útil para conferir no log do
-- cron sem precisar abrir a tabela.
CREATE OR REPLACE FUNCTION frota_checar_vencimentos(p_dias int DEFAULT 30)
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v       record;
  g       record;
  v_fase  text;
  v_ref   text;
  v_tit   text;
  v_msg   text;
  v_alvo  uuid;
  v_criadas int := 0;
BEGIN
  FOR v IN
    SELECT * FROM vw_frota_vencimentos
     WHERE dias_restantes <= p_dias
     ORDER BY dias_restantes
  LOOP
    v_fase := CASE WHEN v.dias_restantes < 0 THEN 'vencido' ELSE 'proximo' END;
    v_ref  := v.origem || ':' || v.ref_id::text || ':' || v_fase;

    -- Já avisado nesta fase e ainda não tratado? Não repete.
    IF EXISTS (
      SELECT 1 FROM notificacoes
       WHERE tipo = 'frota' AND status <> 'resolvida'
         AND meta->>'subtipo' = 'vencimento'
         AND meta->>'ref' = v_ref
    ) THEN
      CONTINUE;
    END IF;

    v_tit := CASE
      WHEN v_fase = 'vencido' THEN 'Documento vencido: ' || v.descricao
      ELSE 'Vence em breve: ' || v.descricao
    END;

    v_msg := CASE
      WHEN v.origem = 'documento' THEN
        format('%s (%s) — %s em %s.',
          v.descricao, COALESCE(v.veiculo_placa, 'veículo'),
          CASE WHEN v_fase = 'vencido' THEN 'venceu' ELSE 'vence' END,
          to_char(v.data_vencimento, 'DD/MM/YYYY'))
      ELSE
        format('%s de %s — %s em %s.',
          v.descricao, COALESCE(v.motorista_nome, 'motorista'),
          CASE WHEN v_fase = 'vencido' THEN 'venceu' ELSE 'vence' END,
          to_char(v.data_vencimento, 'DD/MM/YYYY'))
    END;

    -- Gestão do módulo sempre.
    FOR g IN SELECT id FROM usuarios WHERE ativo AND nivel_efetivo(id, 'frota') = 'editar' LOOP
      PERFORM frota_notificar(g.id, v_tit, v_msg,
        jsonb_build_object('modulo','frota','subtipo','vencimento','ref',v_ref,
          'origem', v.origem, 'ref_id', v.ref_id, 'para','chefe'));
      v_criadas := v_criadas + 1;
    END LOOP;

    -- Habilitação é do motorista: ele também precisa saber, senão
    -- descobre no dia em que for barrado na escala.
    IF v.origem IN ('cnh','habilitacao_fluvial') THEN
      SELECT usuario_id INTO v_alvo FROM frota_motoristas WHERE id = v.motorista_id;
      IF v_alvo IS NOT NULL THEN
        PERFORM frota_notificar(v_alvo,
          CASE WHEN v_fase = 'vencido' THEN 'Sua ' || v.descricao || ' está vencida'
               ELSE 'Sua ' || v.descricao || ' vence em breve' END,
          format('Vencimento em %s. Procure o setor de transporte para regularizar.',
            to_char(v.data_vencimento, 'DD/MM/YYYY')),
          jsonb_build_object('modulo','frota','subtipo','vencimento','ref',v_ref || ':mot',
            'origem', v.origem, 'ref_id', v.ref_id, 'para','motorista'));
        v_criadas := v_criadas + 1;
      END IF;
    END IF;
  END LOOP;

  RETURN v_criadas;
END;
$$;

-- Só o cron (que roda como postgres) e o service_role executam.
REVOKE EXECUTE ON FUNCTION frota_checar_vencimentos(int) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION frota_checar_vencimentos(int) TO service_role;


-- ── Agendamento ────────────────────────────────────────────────
-- 09h10 UTC ≈ 06h10 no Acre (UTC-5), antes do expediente. Função SQL
-- pura, no molde do job verificar_prazos_pesquisa — sem HTTP e sem
-- chave embutida no comando.
SELECT cron.unschedule('frota-vencimentos-diario')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'frota-vencimentos-diario');

SELECT cron.schedule('frota-vencimentos-diario', '10 9 * * *',
  $cron$SELECT frota_checar_vencimentos();$cron$);
