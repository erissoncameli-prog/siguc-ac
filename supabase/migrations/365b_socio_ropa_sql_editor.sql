-- ════════════════════════════════════════════════════════════════════════
-- 365b — ROPA do Diagnóstico Socioeconômico após a Fase 5
-- ════════════════════════════════════════════════════════════════════════
-- TRAT-021 passa a citar as duas tabelas da 365: socio_exportacoes (quem
-- exportou o quê — dado do servidor) e socio_expurgo_arquivos (só caminho
-- de arquivo a remover). A retenção deixa de ser "prevista": roda todo dia.
-- UPDATE de dado: o apply_migration do MCP pode travar nele — se travar,
-- colar no SQL Editor. Idempotente (só acrescenta o que falta).
update public.lgpd_tratamentos
   set tabelas = (select array_agg(distinct t order by t)
                    from unnest(tabelas || array['socio_exportacoes','socio_expurgo_arquivos']) t),
       observacoes = 'Migrations 362/362b/362c (estrutura e regras), 363 (app de campo e bucket socio-fotos), '
                  || '364 (mesa: campanhas e validação) e 365 (indicadores com supressão abaixo de 5 fichas, '
                  || 'exportação registrada em socio_exportacoes, retenção diária: fn_socio_aplicar_retencao '
                  || '+ Edge Function socio-expurgo). Treino: identificação apagada 30 dias após o envio.'
 where codigo = 'TRAT-021';
