-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Frota — telefone do motorista na view de viagens
-- (Fase 4 do plano em docs/frota-analise-e-plano.md)
--
-- A tela de acompanhamento do solicitante (frota-app.html,
-- abrirDetalheSolicitante, entregue no commit f1151b4) monta um link
-- de WhatsApp para o motorista:
--
--   ${v.motorista_nome ? ... ${v.motorista_telefone ? fmLinkWhatsapp(...) : ''} ...}
--
-- só que `vw_frota_viagens_detalhe` nunca expôs `motorista_telefone`.
-- O campo chega undefined, a condicional é sempre falsa e o link
-- simplesmente não aparece — falha silenciosa, sem erro no console.
-- Descoberto ao portar essa tela para a mesa (frota-solicitar.html):
-- a mesma linha seria copiada com o mesmo defeito.
--
-- A view expõe o telefone do SOLICITANTE (u.telefone) desde sempre; o
-- do motorista faltava. Adicionado no fim da lista de colunas —
-- CREATE OR REPLACE VIEW só aceita coluna nova no final, e as
-- existentes precisam manter nome, tipo e ordem.
--
-- Com isto o link passa a funcionar nas DUAS superfícies de uma vez,
-- sem tocar em nenhuma das duas.
-- ═══════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW vw_frota_viagens_detalhe WITH (security_invoker = true) AS
 SELECT fv.id,
    fv.solicitante_id,
    fv.setor_solicitante_id,
    fv.destino,
    fv.uc_destino_id,
    fv.finalidade,
    fv.passageiros,
    fv.data_saida_prevista,
    fv.data_retorno_prevista,
    fv.status,
    fv.veiculo_id,
    fv.motorista_id,
    fv.aprovado_por,
    fv.aprovado_em,
    fv.motivo_recusa,
    fv.km_saida,
    fv.horas_saida,
    fv.combustivel_saida_pct,
    fv.checkout_em,
    fv.km_chegada,
    fv.horas_chegada,
    fv.combustivel_chegada_pct,
    fv.checkin_em,
    fv.observacoes_checkin,
    fv.avarias,
    fv.cancelado_por,
    fv.cancelado_em,
    fv.motivo_cancelamento,
    fv.criado_em,
    fv.atualizado_em,
    fv.aberta_direto,
    fv.viagem_pai_id,
    fv.uuid_cliente,
    fv.localizacao_saida,
    fv.localizacao_chegada,
    fv.lista_passageiros,
    fv.dedicado_liberado,
    fv.dedicado_liberado_por,
    fv.dedicado_liberado_em,
    fv.dedicado_liberado_justificativa,
    fv.cidade_origem,
    fv.cidade_destino,
    frota_nome_usuario(fv.solicitante_id) AS solicitante_nome,
    u.telefone AS solicitante_telefone,
    s.sigla AS setor_sigla,
    s.nome AS setor_nome,
    v.placa AS veiculo_placa,
    v.modelo AS veiculo_modelo,
    v.tipo AS veiculo_tipo,
    v.medidor AS veiculo_medidor,
    v.dedicado_setor AS veiculo_dedicado,
    v.hodometro_km AS veiculo_hodometro_km,
    v.horimetro_horas AS veiculo_horimetro_horas,
    sv.sigla AS veiculo_setor_sigla,
    m.nome AS motorista_nome,
    m.usuario_id AS motorista_usuario_id,
    frota_nome_usuario(fv.dedicado_liberado_por) AS dedicado_liberado_por_nome,
    fv.cidade_destino IS NOT NULL AND frota_norm_cidade(fv.cidade_destino) <> frota_norm_cidade(fv.cidade_origem) AS intermunicipal,
        CASE
            WHEN fv.localizacao_saida IS NOT NULL THEN st_y(fv.localizacao_saida)
            ELSE NULL::double precision
        END AS lat_saida,
        CASE
            WHEN fv.localizacao_saida IS NOT NULL THEN st_x(fv.localizacao_saida)
            ELSE NULL::double precision
        END AS lng_saida,
        CASE
            WHEN fv.localizacao_chegada IS NOT NULL THEN st_y(fv.localizacao_chegada)
            ELSE NULL::double precision
        END AS lat_chegada,
        CASE
            WHEN fv.localizacao_chegada IS NOT NULL THEN st_x(fv.localizacao_chegada)
            ELSE NULL::double precision
        END AS lng_chegada,
    m.telefone AS motorista_telefone
   FROM frota_viagens fv
     LEFT JOIN usuarios u ON u.id = fv.solicitante_id
     LEFT JOIN unidades_organizacionais s ON s.id = fv.setor_solicitante_id
     LEFT JOIN frota_veiculos v ON v.id = fv.veiculo_id
     LEFT JOIN unidades_organizacionais sv ON sv.id = v.setor_id
     LEFT JOIN frota_motoristas m ON m.id = fv.motorista_id;
