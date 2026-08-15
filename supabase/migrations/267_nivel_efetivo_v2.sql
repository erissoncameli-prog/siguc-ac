-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · nivel_efetivo() v2 — organograma passa a poder governar
-- Frente 4 de docs/acesso-por-organograma.md
--
-- É AQUI que as frentes 1-3 (lotação, modulo_unidades, credenciamento)
-- deixam de ser peças soltas e passam a poder valer de verdade. Mesmo
-- assim, ESTA MIGRATION NÃO MUDA O ACESSO DE NINGUÉM HOJE:
--   - `modulos.exige_lotacao` nasce `false` em TODOS os módulos
--     existentes (default da coluna nova) — enquanto for `false`, o
--     módulo continua exatamente no caminho antigo (perfil/módulo >
--     perfil/grupo > sem_acesso), sem tocar em lotação nem alcance.
--   - `credenciamentos` está vazia em produção (a tabela só nasceu na
--     266) — o novo passo de credenciamento sempre resolve NULL hoje,
--     então não muda nenhum resultado.
--   - Ligar `exige_lotacao=true` num módulo é ato FUTURO, deliberado,
--     um de cada vez, sempre depois de rodar `vw_impacto_lotacao()` —
--     nenhuma linha desta migration liga nada.
--
-- TETO DO PERFIL — decisão de implementação (documentada, não travada
-- em conversa prévia; é a peça que faltava desenhar em código).
-- O princípio do plano é "nivel = min(capacidade_do_perfil,
-- alcance_da_lotação), elevado por credenciamento". Mas "capacidade do
-- perfil" não é um valor fixo por perfil no catálogo hoje — o mesmo
-- perfil tem 'editar' num grupo e 'visualizar' ou 'sem_acesso' noutro
-- (ex.: tecnico é 'editar' em Gestão mas só 'visualizar' em Frota).
-- Não existe teto único e correto sem inventar um número.
-- Solução adotada: `teto_do_perfil(perfil)` = o MAIOR nível que aquele
-- perfil já alcança em QUALQUER módulo hoje, olhando os dois catálogos
-- (perfil_permissoes_padrao ∪ grupo_permissoes_padrao). Ou seja: "este
-- perfil edita ALGUMA coisa no sistema?" — se sim, teto = editar; se o
-- perfil nunca passa de visualizar em lugar nenhum, teto = visualizar.
-- Isso cobre o exemplo do plano ("visualizador credenciado em Frota
-- não vira editor" — visualizador nunca tem 'editar' em nenhum grupo
-- hoje, teto = visualizar) sem exigir uma tabela nova nem um valor
-- hard-coded por perfil — o teto se ajusta sozinho se o catálogo mudar.
-- Se esta definição não for a que a SEMA quer, é um UPDATE de
-- perfil_permissoes_padrao/grupo_permissoes_padrao que já existe, não
-- redesenho: o teto deriva do catálogo, não o contrário.
--
-- FAIL-OPEN quando exige_lotacao=true mas o módulo não tem dono
-- cadastrado em modulo_unidades (config incompleta): cai para o
-- caminho antigo, nunca para sem_acesso. Mesmo espírito de
-- `geo_ponto_no_acre` (falha de configuração não pode travar acesso
-- que já existia).
-- ═══════════════════════════════════════════════════════════

ALTER TABLE modulos ADD COLUMN IF NOT EXISTS exige_lotacao boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN modulos.exige_lotacao IS
  'Liga a restrição por setor para este módulo (frente 4/8 de docs/acesso-por-organograma.md). Nasce false em todo módulo — mudar exige rodar vw_impacto_lotacao() antes.';

-- ── Teto do perfil (capacidade estrutural, derivada do catálogo) ──
CREATE OR REPLACE FUNCTION teto_do_perfil(p_perfil perfil_usuario)
RETURNS nivel_acesso
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE(MAX(nivel), 'sem_acesso'::nivel_acesso) FROM (
    SELECT nivel FROM perfil_permissoes_padrao WHERE perfil = p_perfil
    UNION ALL
    SELECT nivel FROM grupo_permissoes_padrao  WHERE perfil = p_perfil
  ) t;
$$;

COMMENT ON FUNCTION teto_do_perfil(perfil_usuario) IS
  'Maior nível que o perfil alcança em QUALQUER módulo hoje — usado para capar credenciamento e alcance por lotação. Ver cabeçalho da migration 267.';

REVOKE EXECUTE ON FUNCTION teto_do_perfil(perfil_usuario) FROM anon;

-- ── Motor único: nivel_efetivo, com override para simulação ───────
-- p_forcar_exige_lotacao permite a vw_impacto_lotacao perguntar "e se
-- este módulo já exigisse lotação?" sem mexer na coluna de verdade.
CREATE OR REPLACE FUNCTION nivel_efetivo_calc(p_usuario uuid, p_modulo_chave text, p_forcar_exige_lotacao boolean DEFAULT NULL)
RETURNS nivel_acesso
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_perfil  perfil_usuario;
  v_ativo   boolean;
  v_modulo  uuid;
  v_grupo   text;
  v_exige   boolean;
  v_nivel   nivel_acesso;
  v_cred    nivel_acesso;
  v_alcance nivel_acesso;
BEGIN
  SELECT perfil, ativo INTO v_perfil, v_ativo FROM usuarios WHERE id = p_usuario;
  IF v_perfil IS NULL OR v_ativo IS NOT TRUE THEN
    RETURN 'sem_acesso';
  END IF;

  IF v_perfil = 'super_admin' THEN
    RETURN 'editar';
  END IF;

  SELECT id, grupo, exige_lotacao INTO v_modulo, v_grupo, v_exige
    FROM modulos WHERE chave = p_modulo_chave AND ativo;
  IF v_modulo IS NULL THEN
    RETURN 'sem_acesso';
  END IF;

  IF p_forcar_exige_lotacao IS NOT NULL THEN
    v_exige := p_forcar_exige_lotacao;
  END IF;

  -- 1) Credenciamento vigente (exceção, nunca acima do teto do perfil)
  v_cred := credenciamento_vigente(p_usuario, p_modulo_chave);
  IF v_cred IS NOT NULL THEN
    RETURN LEAST(v_cred, teto_do_perfil(v_perfil));
  END IF;

  -- 2) Override individual — válvula de escape, sempre acima da lotação
  SELECT nivel INTO v_nivel FROM usuario_permissoes
   WHERE usuario_id = p_usuario AND modulo_id = v_modulo;
  IF FOUND THEN RETURN v_nivel; END IF;

  -- 3) Módulo ainda não exige lotação: comportamento de sempre
  IF NOT v_exige THEN
    SELECT nivel INTO v_nivel FROM perfil_permissoes_padrao
     WHERE perfil = v_perfil AND modulo_id = v_modulo;
    IF FOUND THEN RETURN v_nivel; END IF;

    SELECT nivel INTO v_nivel FROM grupo_permissoes_padrao
     WHERE perfil = v_perfil AND grupo = v_grupo;
    IF FOUND THEN RETURN v_nivel; END IF;

    RETURN 'sem_acesso';
  END IF;

  -- 4) Módulo exige lotação: alcance por setor, capado pelo teto do perfil
  v_alcance := alcance_por_lotacao(p_usuario, p_modulo_chave);
  IF v_alcance IS NULL THEN
    -- Módulo marcado exige_lotacao mas sem dono em modulo_unidades —
    -- configuração incompleta. FAIL-OPEN para o caminho antigo.
    SELECT nivel INTO v_nivel FROM perfil_permissoes_padrao
     WHERE perfil = v_perfil AND modulo_id = v_modulo;
    IF FOUND THEN RETURN v_nivel; END IF;

    SELECT nivel INTO v_nivel FROM grupo_permissoes_padrao
     WHERE perfil = v_perfil AND grupo = v_grupo;
    IF FOUND THEN RETURN v_nivel; END IF;

    RETURN 'sem_acesso';
  END IF;

  RETURN LEAST(v_alcance, teto_do_perfil(v_perfil));
END;
$$;

COMMENT ON FUNCTION nivel_efetivo_calc(uuid, text, boolean) IS
  'Motor de nivel_efetivo(). p_forcar_exige_lotacao permite simular (vw_impacto_lotacao) sem mudar modulos.exige_lotacao de verdade.';

REVOKE EXECUTE ON FUNCTION nivel_efetivo_calc(uuid, text, boolean) FROM anon;

-- nivel_efetivo() mantém a MESMA assinatura de sempre (migration 057) —
-- pode_ver/pode_editar/minhas_permissoes continuam funcionando sem
-- qualquer alteração.
CREATE OR REPLACE FUNCTION nivel_efetivo(p_usuario uuid, p_modulo_chave text)
RETURNS nivel_acesso
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT nivel_efetivo_calc(p_usuario, p_modulo_chave, NULL);
$$;

-- ── Relatório de impacto — obrigatório antes de ligar exige_lotacao ──
-- "vw_" por convenção de leitura (o plano já a chama assim), mas
-- precisa de parâmetro para simular, então é função, não view.
CREATE OR REPLACE FUNCTION vw_impacto_lotacao(p_modulo_chave text)
RETURNS TABLE (
  usuario_id uuid,
  usuario_nome text,
  perfil text,
  nivel_hoje text,
  nivel_com_lotacao text,
  mudanca text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT is_super_admin() THEN
    RAISE EXCEPTION 'Só super_admin pode conferir impacto de uma virada de exige_lotacao.';
  END IF;

  RETURN QUERY
  WITH calc AS (
    SELECT u.id, u.nome_completo, u.perfil,
           nivel_efetivo_calc(u.id, p_modulo_chave, false) AS hoje,
           nivel_efetivo_calc(u.id, p_modulo_chave, true)  AS com_lotacao
      FROM usuarios u
     WHERE u.ativo
  )
  SELECT
    c.id, c.nome_completo, c.perfil::text,
    c.hoje::text, c.com_lotacao::text,
    CASE
      WHEN c.com_lotacao > c.hoje THEN 'ganha'
      WHEN c.com_lotacao < c.hoje THEN 'perde'
      ELSE 'igual'
    END
  FROM calc c
  ORDER BY 6, 2;
END;
$$;

COMMENT ON FUNCTION vw_impacto_lotacao(text) IS
  'Quem ganha/perde acesso se o módulo passasse a exige_lotacao=true, sem mudar nada de verdade. Rodar antes de toda virada (frente 8). Só super_admin.';

REVOKE EXECUTE ON FUNCTION vw_impacto_lotacao(text) FROM anon;
