-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · LGPD Fase 4 (1/2) — log de acesso a dado de terceiro
--
-- TRAT-013 do ROPA (migration 211) marcou a base do CAR como alto
-- risco justamente por ser dado de TERCEIRO: são ~53 mil proprietários
-- e possuidores rurais que nunca interagiram com a SEMA-AC — o CPF
-- chega pronto, via integração com o SICAR. A observação da 211 já
-- registrava a pendência: "Exige RIPD e log de acesso (Fase 4)".
--
-- ONDE O DADO É EXIBIDO (achado no código, não presumido)
-- car_dados_locais é consultada em pages/mapa.html em dois pontos:
--   1. _consultaCARLocal — busca por nome/CPF/CNPJ. Os RESULTADOS
--      exibidos na tabela NÃO incluem CPF/CNPJ (o mapeamento de
--      retorno só leva cod/nome/município/área/situação) — a busca
--      pode usar o CPF como termo, mas não o reexibe em lista.
--   2. _buscarDadosLocais(cod) — chamado ao clicar um imóvel no mapa
--      (_selecionarCAR → abrirDetalhesCAR). Aqui SIM o nome completo e
--      o CPF/CNPJ (mascarado) do proprietário aparecem na tela, na aba
--      "Dados Cadastrais". É o único ponto do sistema em que a
--      identidade de um titular do CAR é revelada a um servidor
--      específico, por escolha dele — o evento que precisa de log.
--
-- Por que via RPC e não trigger: SELECT não dispara trigger no
-- Postgres. A única forma de garantir o registro é o cliente passar
-- pela função — car_consultar_local() substitui o
-- `.from('car_dados_locais').select('*').eq(...)` direto que o mapa
-- usava, sem mudar o formato do retorno (mesmas colunas, SETOF da
-- própria tabela).
-- ═══════════════════════════════════════════════════════════

CREATE TABLE lgpd_acesso_dado_terceiro (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id  uuid NOT NULL DEFAULT auth.uid() REFERENCES usuarios(id),
  tabela      text NOT NULL,            -- 'car_dados_locais' — deixa aberto para outras bases de terceiro no futuro
  cod_imovel  text,
  cpf_cnpj    text,                     -- redundante de propósito: sobrevive mesmo se o registro de origem mudar/sumir na próxima sincronização
  acessado_em timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_lgpd_acesso_car_usuario ON lgpd_acesso_dado_terceiro(usuario_id);
CREATE INDEX idx_lgpd_acesso_car_imovel  ON lgpd_acesso_dado_terceiro(cod_imovel);

ALTER TABLE lgpd_acesso_dado_terceiro ENABLE ROW LEVEL SECURITY;

-- Só quem audita lê o log — o próprio servidor que consultou não
-- precisa (e não deveria) enxergar a própria trilha de acesso a dado
-- de terceiro pela API; é registro de fiscalização, não de uso.
CREATE POLICY lgpd_acesso_car_select ON lgpd_acesso_dado_terceiro FOR SELECT
  USING (EXISTS (SELECT 1 FROM usuarios u
                  WHERE u.id = auth.uid() AND u.perfil IN ('super_admin','gestor') AND u.ativo));

-- Sem INSERT/UPDATE/DELETE via policy: só a RPC grava (SECURITY
-- DEFINER), nunca o cliente direto.

-- ── RPC que substitui o SELECT direto ao clicar um imóvel ──────
-- Mesma permissão que já valia para ver o mapa (pode_ver('mapa')) —
-- não restringe mais do que já era possível antes, só passa a
-- registrar quem olhou os dados de qual imóvel.
CREATE OR REPLACE FUNCTION car_consultar_local(p_cod_imovel text)
RETURNS SETOF car_dados_locais
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE r car_dados_locais;
BEGIN
  IF NOT pode_ver('mapa') THEN
    RAISE EXCEPTION 'Sem permissão para consultar dados do CAR';
  END IF;

  SELECT * INTO r FROM car_dados_locais WHERE cod_imovel = p_cod_imovel;

  IF FOUND THEN
    -- Só registra quando há de fato um titular por trás do código —
    -- uma consulta que não encontra nada não expôs dado de ninguém.
    INSERT INTO lgpd_acesso_dado_terceiro (tabela, cod_imovel, cpf_cnpj)
    VALUES ('car_dados_locais', r.cod_imovel, r.cpf_cnpj);
    RETURN NEXT r;
  END IF;

  RETURN;
END;
$$;

REVOKE EXECUTE ON FUNCTION car_consultar_local(text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION car_consultar_local(text) TO authenticated;

COMMENT ON TABLE lgpd_acesso_dado_terceiro IS
  'Log de acesso a dado pessoal de terceiro (LGPD Art. 46, mitigação declarada no ROPA para TRAT-013). Alimentado só pela RPC car_consultar_local — nunca por INSERT direto do cliente.';

-- ── Leitura administrativa (Configurações → Privacidade) ───────
CREATE VIEW vw_lgpd_acesso_car WITH (security_invoker = true) AS
SELECT a.id, a.cod_imovel, a.cpf_cnpj, a.acessado_em,
       u.nome_completo AS usuario_nome, u.email AS usuario_email
FROM lgpd_acesso_dado_terceiro a
LEFT JOIN usuarios u ON u.id = a.usuario_id
ORDER BY a.acessado_em DESC;

COMMENT ON VIEW vw_lgpd_acesso_car IS 'Leitura administrativa do log de acesso a dado de terceiro, com nome do servidor resolvido. security_invoker: herda a mesma RLS restrita a super_admin/gestor da tabela base.';
