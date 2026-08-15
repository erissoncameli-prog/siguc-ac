-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Trilha de auditoria genérica — tabelas de permissão
-- Frente 7 de docs/acesso-por-organograma.md
--
-- Reaproveita a arquitetura já desenhada (e ainda não implementada) em
-- docs/qualidade-agua/plano-seguranca-dados.md §2, generalizada desde
-- o início: `trilha_auditoria` recebe `tabela`/`registro_id`, sem nada
-- específico de módulo na forma — exatamente como a decisão 3 daquele
-- plano previa ("estender depois é CREATE TRIGGER, não redesenho").
-- Aplicada aqui às 4 tabelas que decidem QUEM ALCANÇA O QUÊ no sistema:
-- usuario_lotacoes, modulo_unidades, credenciamentos, usuario_permissoes.
-- Quando (ou se) a missão de Água avançar, ligar as 4 tabelas dela é
-- só `CREATE TRIGGER ... EXECUTE FUNCTION trilha_auditoria_registrar(...)`.
--
-- DOIS ADVERSÁRIOS, DUAS RESPOSTAS (mesmo raciocínio do plano de Água,
-- §2.1) — não repetido por extenso aqui, só o resumo do que está feito:
--   Adversário A (super_admin do sistema, via navegador): RESOLVIDO.
--     RLS só de SELECT, REVOKE de INSERT/UPDATE/DELETE/TRUNCATE do
--     cliente, trigger SECURITY DEFINER sem EXECUTE para o cliente.
--     Não existe caminho pelo PostgREST para escrever ou apagar uma
--     linha da trilha.
--   Adversário B (quem tem `service_role`): DETECTÁVEL, não impedido.
--     Encadeamento de hash (sha256, `extensions.digest` — pgcrypto vive
--     em `extensions`, não em `public`) + `trilha_auditoria_verificar()`
--     que aponta a primeira linha fora da cadeia. Falta o ANCORAMENTO
--     EXTERNO (o "selo" que o plano de Água descreve): o selo diário é
--     GERADO E GRAVADO por este migration (trilha_auditoria_selos +
--     cron), mas o ENVIO para fora do banco (e-mail/commit) NÃO está
--     implementado — motivo registrado no cabeçalho da função abaixo.
--     Até o envio ser resolvido, a trilha é imutável para o adversário
--     A e só AUDITÁVEL (não ancorada) contra o B — mesma degradação
--     graciosa que o plano de Água já previa para "sem endereço
--     configurado".
--
-- CONCORRÊNCIA DA CADEIA: dois INSERTs simultâneos em tabelas
-- diferentes (ex.: alguém edita uma lotação enquanto outro credencia
-- alguém, ao mesmo tempo) poderiam ler o mesmo "último hash" antes de
-- qualquer um commitar, bifurcando a cadeia. `pg_advisory_xact_lock`
-- no início do trigger serializa as gravações na trilha — o volume de
-- escrita destas 4 tabelas é baixo (ações administrativas, não
-- transacional de alto volume), então o custo de serializar é
-- desprezível.
-- ═══════════════════════════════════════════════════════════

-- ── Camada 1: a trilha ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS trilha_auditoria (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seq              bigint GENERATED ALWAYS AS IDENTITY,  -- ordem real de gravação, para a cadeia
  tabela           text NOT NULL,
  registro_id      text,               -- colunas-chave da linha, juntas por '|' (ver trigger)
  operacao         text NOT NULL CHECK (operacao IN ('INSERT','UPDATE','DELETE')),
  dados_antes      jsonb,              -- NULL no INSERT
  dados_depois     jsonb,              -- NULL no DELETE
  campos_alterados text[],             -- diff calculado no trigger (só UPDATE), sem atualizado_em
  usuario_id       uuid,               -- SEM FK: snapshot precisa sobreviver à exclusão do usuário
  usuario_nome     text,               -- snapshot — nome pode mudar depois
  usuario_email    text,
  perfil           text,
  quando           timestamptz NOT NULL DEFAULT now(),
  origem           text,               -- 'mesa' | 'app' | 'servidor' (cron/migration)
  ip               inet,
  user_agent       text,
  hash_anterior    text,
  hash             text NOT NULL,
  criado_em        timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE trilha_auditoria IS
  'Trilha de auditoria genérica por trigger — frente 7 de docs/acesso-por-organograma.md. Hoje cobre usuario_lotacoes/modulo_unidades/credenciamentos/usuario_permissoes. Estender a outra tabela é CREATE TRIGGER, não redesenho.';
COMMENT ON COLUMN trilha_auditoria.registro_id IS
  'Valores das colunas-chave da linha (definidas no 2º argumento do trigger), unidas por "|". Não é sempre um uuid único — usuario_permissoes tem chave composta.';

CREATE UNIQUE INDEX IF NOT EXISTS uq_trilha_auditoria_seq ON trilha_auditoria (seq);
CREATE INDEX IF NOT EXISTS idx_trilha_auditoria_registro ON trilha_auditoria (tabela, registro_id, quando DESC);
CREATE INDEX IF NOT EXISTS idx_trilha_auditoria_usuario  ON trilha_auditoria (usuario_id, quando DESC);

-- ── Camada 2: só super_admin lê; ninguém escreve pelo PostgREST ──
ALTER TABLE trilha_auditoria ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS trilha_auditoria_select ON trilha_auditoria;
CREATE POLICY trilha_auditoria_select ON trilha_auditoria FOR SELECT USING (is_super_admin());
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON trilha_auditoria FROM authenticated, anon;

-- ── Função de trigger genérica ────────────────────────────────
-- Argumento: lista de colunas-chave da tabela, separadas por vírgula
-- (ex.: 'id' ou 'usuario_id,modulo_id'), passada em CREATE TRIGGER.
CREATE OR REPLACE FUNCTION trilha_auditoria_registrar()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_old         jsonb;
  v_new         jsonb;
  v_chave_cols  text[];
  v_registro_id text;
  v_campos      text[];
  v_usuario_id  uuid;
  v_usuario_nome  text;
  v_usuario_email text;
  v_perfil      text;
  v_hash_ant    text;
  v_conteudo    text;
  v_ip_raw      text;
  v_ip          inet;
  v_ua          text;
  v_origem      text;
BEGIN
  -- Serializa a cadeia entre tabelas diferentes (ver cabeçalho da migration).
  PERFORM pg_advisory_xact_lock(hashtext('trilha_auditoria'));

  v_chave_cols := string_to_array(TG_ARGV[0], ',');

  IF TG_OP IN ('UPDATE','DELETE') THEN v_old := to_jsonb(OLD); END IF;
  IF TG_OP IN ('INSERT','UPDATE') THEN v_new := to_jsonb(NEW); END IF;

  SELECT string_agg(COALESCE(v_new, v_old) ->> c, '|' ORDER BY ord)
    INTO v_registro_id
    FROM unnest(v_chave_cols) WITH ORDINALITY AS t(c, ord);

  IF TG_OP = 'UPDATE' THEN
    SELECT array_agg(k) INTO v_campos
      FROM jsonb_object_keys(v_new) k
     WHERE k <> 'atualizado_em'
       AND (v_old -> k) IS DISTINCT FROM (v_new -> k);
  END IF;

  v_usuario_id := auth.uid();
  IF v_usuario_id IS NOT NULL THEN
    SELECT u.nome_completo, u.email, u.perfil::text
      INTO v_usuario_nome, v_usuario_email, v_perfil
      FROM usuarios u WHERE u.id = v_usuario_id;
  END IF;

  -- Cabeçalhos só existem em requisição via PostgREST (mesa/app);
  -- fora disso (cron, migration, psql) ficam NULL — informação, não falha.
  BEGIN
    v_ip_raw := split_part(current_setting('request.headers', true)::jsonb ->> 'x-forwarded-for', ',', 1);
    v_ip := NULLIF(btrim(v_ip_raw), '')::inet;
  EXCEPTION WHEN OTHERS THEN v_ip := NULL;
  END;
  BEGIN
    v_ua := current_setting('request.headers', true)::jsonb ->> 'user-agent';
  EXCEPTION WHEN OTHERS THEN v_ua := NULL;
  END;
  v_origem := CASE WHEN current_setting('request.headers', true) IS NOT NULL THEN 'mesa_ou_app' ELSE 'servidor' END;

  SELECT hash INTO v_hash_ant FROM trilha_auditoria ORDER BY seq DESC LIMIT 1;

  -- `now()` é estável dentro da transação (não muda entre chamadas na
  -- mesma tx) — o mesmo valor cai aqui e no DEFAULT now() de `quando`,
  -- então trilha_auditoria_verificar() consegue recomputar exatamente
  -- o mesmo hash usando a coluna `quando` já gravada.
  v_conteudo := COALESCE(v_hash_ant, '') || TG_TABLE_NAME || TG_OP || COALESCE(v_registro_id, '')
    || COALESCE(v_old::text, '') || COALESCE(v_new::text, '') || now()::text;

  INSERT INTO trilha_auditoria (
    tabela, registro_id, operacao, dados_antes, dados_depois, campos_alterados,
    usuario_id, usuario_nome, usuario_email, perfil, origem, ip, user_agent,
    hash_anterior, hash
  ) VALUES (
    TG_TABLE_NAME, v_registro_id, TG_OP, v_old, v_new, v_campos,
    v_usuario_id, v_usuario_nome, v_usuario_email, v_perfil, v_origem, v_ip, v_ua,
    v_hash_ant, encode(extensions.digest(v_conteudo, 'sha256'), 'hex')
  );

  RETURN COALESCE(NEW, OLD);
END;
$$;

COMMENT ON FUNCTION trilha_auditoria_registrar() IS
  'Trigger genérico da trilha de auditoria (frente 7). Não chamar direto — só via CREATE TRIGGER. Argumento: colunas-chave da tabela, separadas por vírgula.';

-- Padrão da migration 179: função de trigger não é executável pelo cliente.
REVOKE EXECUTE ON FUNCTION trilha_auditoria_registrar() FROM PUBLIC, anon, authenticated;

-- ── Liga a trilha nas 4 tabelas de permissão ──────────────────
DROP TRIGGER IF EXISTS trg_trilha_usuario_lotacoes ON usuario_lotacoes;
CREATE TRIGGER trg_trilha_usuario_lotacoes
  AFTER INSERT OR UPDATE OR DELETE ON usuario_lotacoes
  FOR EACH ROW EXECUTE FUNCTION trilha_auditoria_registrar('id');

DROP TRIGGER IF EXISTS trg_trilha_modulo_unidades ON modulo_unidades;
CREATE TRIGGER trg_trilha_modulo_unidades
  AFTER INSERT OR UPDATE OR DELETE ON modulo_unidades
  FOR EACH ROW EXECUTE FUNCTION trilha_auditoria_registrar('id');

DROP TRIGGER IF EXISTS trg_trilha_credenciamentos ON credenciamentos;
CREATE TRIGGER trg_trilha_credenciamentos
  AFTER INSERT OR UPDATE OR DELETE ON credenciamentos
  FOR EACH ROW EXECUTE FUNCTION trilha_auditoria_registrar('id');

DROP TRIGGER IF EXISTS trg_trilha_usuario_permissoes ON usuario_permissoes;
CREATE TRIGGER trg_trilha_usuario_permissoes
  AFTER INSERT OR UPDATE OR DELETE ON usuario_permissoes
  FOR EACH ROW EXECUTE FUNCTION trilha_auditoria_registrar('usuario_id,modulo_id');

-- ── Verificação da cadeia (adversário B — detecção) ───────────
CREATE OR REPLACE FUNCTION trilha_auditoria_verificar()
RETURNS TABLE (seq bigint, tabela text, quando timestamptz, ok boolean, hash_esperado text, hash_gravado text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  r record;
  v_hash_ant text := NULL;
  v_calc     text;
BEGIN
  IF NOT is_super_admin() THEN
    RAISE EXCEPTION 'Só super_admin pode verificar a trilha de auditoria.';
  END IF;

  FOR r IN SELECT * FROM trilha_auditoria ORDER BY seq LOOP
    v_calc := encode(extensions.digest(
      COALESCE(v_hash_ant, '') || r.tabela || r.operacao || COALESCE(r.registro_id, '')
      || COALESCE(r.dados_antes::text, '') || COALESCE(r.dados_depois::text, '') || r.quando::text
    , 'sha256'), 'hex');

    RETURN QUERY SELECT r.seq, r.tabela, r.quando, (v_calc = r.hash), v_calc, r.hash;

    v_hash_ant := v_calc;  -- segue a cadeia como ela DEVERIA ser, não como está gravada —
                           -- uma linha adulterada faz toda linha seguinte reportar ok=false também,
                           -- que é o comportamento certo (a cadeia real quebrou ali).
  END LOOP;
END;
$$;

COMMENT ON FUNCTION trilha_auditoria_verificar() IS
  'Recomputa a cadeia de hash e aponta a primeira linha (menor seq com ok=false) adulterada, reordenada ou removida. Só super_admin.';

REVOKE EXECUTE ON FUNCTION trilha_auditoria_verificar() FROM anon;

-- ── Selo diário (âncora externa — gerado e gravado; envio pendente) ──
CREATE TABLE IF NOT EXISTS trilha_auditoria_selos (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gerado_em      timestamptz NOT NULL DEFAULT now(),
  total_linhas   bigint NOT NULL,
  ultima_seq     bigint,
  ultimo_hash    text,
  ultima_quando  timestamptz,
  enviado        boolean NOT NULL DEFAULT false,
  enviado_para   text,
  enviado_em     timestamptz,
  erro_envio     text
);

COMMENT ON TABLE trilha_auditoria_selos IS
  'Selo diário da cadeia (contagem + hash da cabeça). enviado=false até o envio externo ser implementado — ver comentário de trilha_auditoria_gerar_selo(). A cadeia em si não depende do envio.';

ALTER TABLE trilha_auditoria_selos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS trilha_selos_select ON trilha_auditoria_selos;
CREATE POLICY trilha_selos_select ON trilha_auditoria_selos FOR SELECT USING (is_super_admin());
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON trilha_auditoria_selos FROM authenticated, anon;

-- ⚠ ENVIO EXTERNO NÃO IMPLEMENTADO NESTA ENTREGA. Enviar por e-mail
-- exigiria chamar uma Edge Function a partir deste cron (via pg_net),
-- o que obrigaria embutir a SERVICE_ROLE_KEY no comando do job —
-- exatamente o anti-padrão que o projeto evita hoje (nenhum cron atual
-- chama Edge Function; todos são função SQL pura, ver comentário da
-- migration 205). Resolver isso com segurança (Vault do Postgres, ou
-- agendamento nativo de Edge Function fora do pg_cron) é trabalho de
-- outra sessão. Até lá, o selo é gerado e gravado — a cadeia já tem o
-- ponto de referência —, só não sai do banco. Sem isso, a trilha segue
-- imutável para o super_admin do sistema (adversário A, resolvido) mas
-- só auditável, não ancorada, contra quem tem service_role
-- (adversário B) — mesma degradação graciosa prevista no plano de Água.
CREATE OR REPLACE FUNCTION trilha_auditoria_gerar_selo()
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_total bigint;
  v_seq bigint;
  v_hash text;
  v_quando timestamptz;
BEGIN
  SELECT count(*) INTO v_total FROM trilha_auditoria;
  SELECT seq, hash, quando INTO v_seq, v_hash, v_quando
    FROM trilha_auditoria ORDER BY seq DESC LIMIT 1;

  INSERT INTO trilha_auditoria_selos (total_linhas, ultima_seq, ultimo_hash, ultima_quando)
  VALUES (v_total, v_seq, v_hash, v_quando)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

COMMENT ON FUNCTION trilha_auditoria_gerar_selo() IS
  'Gera e grava o selo diário (contagem + hash da cabeça da cadeia). NÃO envia para fora do banco ainda — ver comentário acima da função.';

REVOKE EXECUTE ON FUNCTION trilha_auditoria_gerar_selo() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION trilha_auditoria_gerar_selo() TO service_role;

SELECT cron.unschedule('trilha-auditoria-selo-diario')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'trilha-auditoria-selo-diario');

-- 09h30 UTC ≈ 06h30 Acre — 09h10/15/20/25 já têm jobs (frota,
-- biomonitor, quelônios, purga de passageiros, credenciamentos).
SELECT cron.schedule('trilha-auditoria-selo-diario', '30 9 * * *',
  $cron$SELECT trilha_auditoria_gerar_selo();$cron$);

-- ── ROPA (a trilha guarda dado pessoal: nome/e-mail/perfil/IP) ────
INSERT INTO lgpd_tratamentos (
  codigo, nome, modulo, finalidade, base_legal, base_legal_detalhe,
  categorias_titulares, categorias_dados, dado_sensivel, dado_de_menor,
  origem, origem_detalhe, tabelas, retencao_meses, retencao_criterio,
  compartilhamento, transferencia_internacional, alto_risco, observacoes, ativo
) VALUES (
  'TRAT-020', 'Trilha de auditoria de permissões', 'estrutura-organizacional',
  'Registrar quem concedeu, alterou ou revogou acesso a módulos do sistema (lotação, amarração módulo↔setor, credenciamento de exceção, override individual), para prestação de contas e detecção de uso indevido de privilégio administrativo.',
  'obrigacao_legal', 'Art. 7º, II da LGPD — dever de segurança e prestação de contas de órgão público sobre concessão de acesso a dados administrados pelo sistema.',
  ARRAY['servidor'], ARRAY['nome completo','e-mail','perfil funcional','endereço IP','user-agent'],
  false, false,
  'geracao_automatica', 'Gerada pelo próprio banco via trigger a cada INSERT/UPDATE/DELETE nas tabelas de permissão — não é preenchida pelo titular.',
  ARRAY['trilha_auditoria','trilha_auditoria_selos'], 60, 'Alinhado à prestação de contas administrativa (mesmo critério do TRAT-019/frota); expurgo quebra a cadeia de hash, então retenção vencida exige arquivar o trecho com o selo correspondente, nunca DELETE solto.',
  'Acesso restrito a super_admin, dentro do sistema. Sem compartilhamento externo.',
  false, false,
  'Frente 7 de docs/acesso-por-organograma.md. Selo diário de integridade (trilha_auditoria_selos) ainda não tem envio externo implementado — ver comentário de trilha_auditoria_gerar_selo().',
  true
)
ON CONFLICT (codigo) DO NOTHING;
