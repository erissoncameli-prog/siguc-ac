-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Frota — SLA de pendências do gestor + lembrete automático
--
-- O gestor de Frota decide sobre 3 tipos de pendência vindas de
-- outra pessoa (motorista/servidor): viagem solicitada, abastecimento
-- pendente de validação e comunicado de defeito. Até aqui nenhum dos
-- três tinha prazo formal nem lembrete — o item só reaparecia se o
-- gestor abrisse a tela certa. Esta migration:
--   1. Unifica os três num único painel (vw_frota_sla_pendencias),
--      com o tempo que levou (ou está levando) até a decisão.
--   2. Define um SLA por tipo (24h viagem/abastecimento, 48h
--      comunicado de defeito — decisão de produto: liberar um
--      motorista ou aprovar combustível é mais urgente que uma
--      manutenção corretiva ainda não crítica).
--   3. Lembrete automático: pg_cron roda de 3 em 3h e notifica (tabela
--      notificacoes, mesmo padrão da 205/162) quem edita 'frota' pra
--      cada item que estourou o prazo — com o mesmo dedupe por `ref`
--      (não repete a cada rodada, só quando o item é decidido e volta
--      a estourar prazo em outra pendência).
-- ═══════════════════════════════════════════════════════════

-- ── View unificada de pendências de decisão do gestor ──────────
-- Cobre os 3 tipos com "quem decide é o gestor de frota" (aprovar/
-- recusar viagem, validar/rejeitar abastecimento, abrir OS/descartar
-- comunicado). OS e vencimento de documento ficam de fora de propósito:
-- OS não é aprovação de terceiro (o próprio gestor abre) e vencimento
-- de documento já tem alerta próprio (205) — não é uma "decisão".
DROP VIEW IF EXISTS vw_frota_sla_pendencias;
CREATE VIEW vw_frota_sla_pendencias WITH (security_invoker = true) AS
SELECT
  'viagem'::text                                    AS origem,
  fv.id                                              AS ref_id,
  fv.criado_em,
  fv.aprovado_em                                     AS decidido_em,
  (fv.status <> 'solicitada')                        AS resolvido,
  fv.status::text                                    AS status,
  24                                                  AS prazo_horas,
  EXTRACT(EPOCH FROM (COALESCE(fv.aprovado_em, now()) - fv.criado_em)) / 3600.0 AS horas_decisao,
  fv.destino                                         AS descricao,
  NULL::text                                         AS veiculo_placa,
  u.nome_completo                                    AS solicitante_nome,
  NULL::text                                         AS motorista_nome
FROM frota_viagens fv
LEFT JOIN usuarios u ON u.id = fv.solicitante_id

UNION ALL

SELECT
  'abastecimento'::text,
  fa.id,
  fa.criado_em,
  fa.validado_em,
  (fa.status <> 'pendente'),
  fa.status::text,
  24,
  EXTRACT(EPOCH FROM (COALESCE(fa.validado_em, now()) - fa.criado_em)) / 3600.0,
  format('%s L — %s', fa.litros, COALESCE(fa.posto_nome, 'posto não informado')),
  v.placa,
  NULL::text,
  m.nome
FROM frota_abastecimentos fa
JOIN frota_veiculos v ON v.id = fa.veiculo_id
JOIN frota_motoristas m ON m.id = fa.motorista_id

UNION ALL

SELECT
  'comunicado'::text,
  c.id,
  c.criado_em,
  c.validado_em,
  (c.status <> 'pendente'),
  c.status::text,
  48,
  EXTRACT(EPOCH FROM (COALESCE(c.validado_em, now()) - c.criado_em)) / 3600.0,
  c.descricao,
  v.placa,
  NULL::text,
  m.nome
FROM frota_comunicados_manutencao c
JOIN frota_veiculos v ON v.id = c.veiculo_id
JOIN frota_motoristas m ON m.id = c.motorista_id;

COMMENT ON VIEW vw_frota_sla_pendencias IS
  'Unifica viagem solicitada, abastecimento pendente e comunicado de defeito com o tempo até a decisão do gestor (ou tempo em aberto, se ainda pendente). horas_decisao > prazo_horas com resolvido=false = atrasado.';


-- ── Verificação periódica → lembrete ao gestor ──────────────────
-- SECURITY DEFINER porque o cron não tem sessão de usuário.
-- Dedupe idêntico ao padrão da 205: só notifica de novo se a
-- notificação anterior daquela ref já foi resolvida (ex.: o item foi
-- decidido e depois, hipoteticamente, reaberto).
CREATE OR REPLACE FUNCTION frota_checar_sla_pendencias()
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  p         record;
  g         record;
  v_ref     text;
  v_tit     text;
  v_msg     text;
  v_criadas int := 0;
BEGIN
  FOR p IN
    SELECT * FROM vw_frota_sla_pendencias
     WHERE NOT resolvido AND horas_decisao > prazo_horas
     ORDER BY horas_decisao DESC
  LOOP
    v_ref := p.origem || ':' || p.ref_id::text || ':atrasado';

    IF EXISTS (
      SELECT 1 FROM notificacoes
       WHERE tipo = 'frota' AND status <> 'resolvida'
         AND meta->>'subtipo' = 'sla_atrasado'
         AND meta->>'ref' = v_ref
    ) THEN
      CONTINUE;
    END IF;

    v_tit := CASE p.origem
      WHEN 'viagem'        THEN 'Viagem solicitada sem resposta há ' || round(p.horas_decisao) || 'h'
      WHEN 'abastecimento' THEN 'Abastecimento pendente de validação há ' || round(p.horas_decisao) || 'h'
      ELSE 'Comunicado de defeito sem providência há ' || round(p.horas_decisao) || 'h'
    END;

    v_msg := CASE p.origem
      WHEN 'viagem'        THEN format('%s — solicitado por %s. Prazo de %sh estourado.', p.descricao, COALESCE(p.solicitante_nome,'servidor'), p.prazo_horas)
      WHEN 'abastecimento' THEN format('%s (%s) — %s. Prazo de %sh estourado.', p.descricao, p.veiculo_placa, COALESCE(p.motorista_nome,'motorista'), p.prazo_horas)
      ELSE format('%s (%s) — reportado por %s. Prazo de %sh estourado.', p.descricao, p.veiculo_placa, COALESCE(p.motorista_nome,'motorista'), p.prazo_horas)
    END;

    FOR g IN SELECT id FROM usuarios WHERE ativo AND nivel_efetivo(id, 'frota') = 'editar' LOOP
      PERFORM frota_notificar(g.id, v_tit, v_msg,
        jsonb_build_object('modulo','frota','subtipo','sla_atrasado','ref',v_ref,
          'origem', p.origem, 'ref_id', p.ref_id, 'para','chefe'));
      v_criadas := v_criadas + 1;
    END LOOP;
  END LOOP;

  RETURN v_criadas;
END;
$$;

REVOKE EXECUTE ON FUNCTION frota_checar_sla_pendencias() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION frota_checar_sla_pendencias() TO service_role;

SELECT cron.unschedule('frota-sla-pendencias')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'frota-sla-pendencias');

-- De 3 em 3h: prazo mínimo é 24h, então rodar de hora em hora seria
-- desperdício; diário (como o de vencimentos) seria grosseiro demais
-- pra um prazo de 24h.
SELECT cron.schedule('frota-sla-pendencias', '0 */3 * * *',
  $cron$SELECT frota_checar_sla_pendencias();$cron$);
