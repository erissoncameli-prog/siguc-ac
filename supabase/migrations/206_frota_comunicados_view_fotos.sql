-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Frota — fotos do comunicado de defeito na view
--
-- BUG RELATADO: na aba Manutenção do Administrar, o comunicado de
-- defeito aparece com os dados (veículo, motorista, descrição) mas
-- SEM as fotos.
--
-- CAUSA: a migration 193 criou `vw_frota_comunicados_manutencao`; a
-- 194 acrescentou `fotos_urls` à TABELA `frota_comunicados_manutencao`
-- e esqueceu de refazer a view. Como as duas telas leem a view (e não
-- a tabela), `c.fotos_urls` chega `undefined` no cliente, o
-- `c.fotos_urls?.length` é sempre falso e o bloco das fotos nunca é
-- renderizado. Falha silenciosa: nenhum erro no console, nenhuma
-- imagem quebrada — o bloco simplesmente não existe no HTML.
--
-- Ou seja: a foto do comunicado de defeito NUNCA apareceu desde que o
-- recurso foi entregue na 194. O dado sempre esteve gravado
-- corretamente na tabela e no Storage; era só a view que não o
-- devolvia.
--
-- Terceiro caso desta mesma família no módulo (os outros dois:
-- `motorista_telefone` ausente em vw_frota_viagens_detalhe, corrigido
-- pela 202, e o `custo` inexistente que zerava o painel, corrigido na
-- Fase 6). Vale a regra: ao adicionar coluna numa tabela que tem view
-- de leitura, refazer a view na MESMA migration.
--
-- Corrige as DUAS superfícies de uma vez, sem tocar em nenhuma delas:
-- `frota-manutencao.html` (mesa) e `frota-app.html` (modo gestor) já
-- renderizam as fotos assim que o campo chega.
--
-- Coluna nova no fim da lista — CREATE OR REPLACE VIEW não aceita
-- mudar nome, tipo ou ordem das existentes.
-- ═══════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW vw_frota_comunicados_manutencao WITH (security_invoker = true) AS
 SELECT c.id,
    c.veiculo_id,
    c.motorista_id,
    c.viagem_id,
    c.descricao,
    c.status,
    c.os_id,
    c.validado_por,
    c.validado_em,
    c.motivo_descarte,
    c.uuid_cliente,
    c.criado_em,
    c.atualizado_em,
    v.placa AS veiculo_placa,
    v.modelo AS veiculo_modelo,
    m.nome AS motorista_nome,
    frota_nome_usuario(c.validado_por) AS validado_por_nome,
    c.fotos_urls
   FROM frota_comunicados_manutencao c
     JOIN frota_veiculos v ON v.id = c.veiculo_id
     JOIN frota_motoristas m ON m.id = c.motorista_id;
