-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Frota — motorista sem grant no módulo não conseguia
-- ver veículos ativos ao abastecer.
--
-- Achado: Gabriel Araújo (motorista) tentou abastecer sem viagem em
-- andamento; o app foi buscar veículos direto em frota_veiculos
-- (frota-app.html, carregarVeiculosAtivosAbastecimento), mas a policy
-- de SELECT exige pode_ver('frota'). Motoristas nascem com perfil
-- 'visualizador' (gerar-login-motorista) e não têm grant nenhum no
-- módulo Frota (mesmo problema documentado na migration 182, ali para
-- frota_motoristas) — a query voltava vazia por RLS, caía no cache
-- offline (também vazio) e mostrava "nenhum veículo disponível" mesmo
-- com o Saveiro CD NXT1030 ativo e disponível no banco.
--
-- Correção em 2 camadas:
-- 1) Estrutural: RPC SECURITY DEFINER — motorista ativo não depende
--    mais de grant no módulo pra listar veículos que ele pode usar
--    (mesmo padrão das RPCs de viagem/abastecimento, 155/173/175).
-- 2) Pontual: concede 'visualizar' em frota pros motoristas que hoje
--    estão sem nenhum grant (override individual), pra não deixar
--    nenhuma outra leitura direta que ainda dependa de pode_ver('frota')
--    quebrada pelo mesmo motivo.
-- ═══════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION frota_veiculos_ativos_abastecimento()
RETURNS TABLE (id uuid, placa text, modelo text, medidor medidor_uso_frota)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM frota_motoristas
    WHERE usuario_id = auth.uid() AND ativo AND status = 'ativo'
  ) AND NOT pode_ver('frota') THEN
    RAISE EXCEPTION 'Usuário não está cadastrado como motorista ativo';
  END IF;

  RETURN QUERY
    SELECT v.id, v.placa, v.modelo, v.medidor
    FROM frota_veiculos v
    WHERE v.ativo AND v.status NOT IN ('em_manutencao', 'baixado')
    ORDER BY v.placa;
END;
$$;

-- Só chamável por autenticados (mesmo padrão das demais RPCs).
REVOKE ALL ON FUNCTION frota_veiculos_ativos_abastecimento() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION frota_veiculos_ativos_abastecimento() TO authenticated;

-- ── Grant pontual: motoristas ativos hoje sem nenhum acesso ao
-- módulo Frota (override individual, nível visualizar) ─────────
INSERT INTO usuario_permissoes (usuario_id, modulo_id, nivel)
SELECT fm.usuario_id, m.id, 'visualizar'
FROM frota_motoristas fm
JOIN modulos m ON m.chave = 'frota' AND m.ativo
WHERE fm.usuario_id IS NOT NULL
  AND fm.ativo AND fm.status = 'ativo'
  AND nivel_efetivo(fm.usuario_id, 'frota') = 'sem_acesso'
ON CONFLICT (usuario_id, modulo_id) DO NOTHING;
