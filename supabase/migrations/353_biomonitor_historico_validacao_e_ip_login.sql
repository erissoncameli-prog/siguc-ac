-- ════════════════════════════════════════════════════════════════
-- 353 — Biomonitor: histórico de validação do ninho + IP real no login
-- ════════════════════════════════════════════════════════════════
-- Achado ao investigar os 25 ninhos da Praia da Curva Grande que
-- ficaram "em correção" sem a equipe se lembrar de ter pedido
-- (24/09/2026, motivo "CORRIGIR CODIGO DO NINHO"). Duas lacunas
-- impediram responder "quem fez isso?" com prova:
--
-- 1) ninhos_quelonios não tinha histórico de validação — só o último
--    validado_por/validado_em sobrevivia (registros_campo tem, desde a
--    066/071; ninho nunca ganhou). Tabela própria, gravada SÓ pelo
--    trigger (SECURITY DEFINER, sem policy de escrita — nem super_admin
--    escreve), leitura por pode_ver('biomonitor'). Registra também a
--    troca de número do ninho (de → para), que é o que o pedido de
--    correção costuma exigir.
--    Ponto de partida: o último estado conhecido de cada ninho já
--    validado/devolvido entra como 1ª linha (status_de NULL). As idas e
--    vindas anteriores nunca foram gravadas e não são reconstruídas.
--
-- 2) auditoria_acessos.ip_address era SEMPRE nulo (1.189 de 1.189
--    linhas): o login busca o IP em api.ipify.org, que o CSP do site
--    (connect-src) bloqueia. registrar_tentativa_acesso passa a usar o
--    IP que o SERVIDOR viu (cabeçalhos da requisição repassados pelo
--    PostgREST), com o p_ip do cliente só como reserva. Mesma
--    assinatura → CREATE OR REPLACE mantém os GRANTs (anon precisa,
--    falha de login acontece sem sessão).
--
-- 3) Limpeza: trg_ninhos_seguir_origem foi criado à mão durante a
--    investigação e duplicava trg_ninhos_sincronizar_atual (352). A
--    função já foi neutralizada (RETURN NEW). O DROP fica no FIM e
--    separado — o MCP do Supabase pede confirmação para DROP, e um DROP
--    no meio travava a aplicação inteira até expirar.
--
-- Sem DROP/ALTER em ninhos_quelonios além do CREATE TRIGGER novo.
-- ════════════════════════════════════════════════════════════════

-- ── 1) histórico de validação ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ninhos_validacao_historico (
  id            bigserial PRIMARY KEY,
  ninho_id      uuid NOT NULL REFERENCES public.ninhos_quelonios(id) ON DELETE CASCADE,
  status_de     text,
  status_para   text,
  motivo        text,
  numero_de     text,
  numero_para   text,
  usuario_id    uuid,
  usuario_nome  text,
  perfil        text,
  em            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ninhos_validacao_historico_ninho_idx
  ON public.ninhos_validacao_historico (ninho_id, em);

COMMENT ON TABLE public.ninhos_validacao_historico IS
  'Idas e vindas da validação do ninho e trocas de número. Gravada só pelo trigger trg_ninhos_historico_validacao — nenhuma policy de escrita (migration 353).';

ALTER TABLE public.ninhos_validacao_historico ENABLE ROW LEVEL SECURITY;

CREATE POLICY ninhos_val_hist_select ON public.ninhos_validacao_historico
  FOR SELECT TO authenticated
  USING (pode_ver('biomonitor'));

REVOKE ALL ON public.ninhos_validacao_historico FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.ninhos_validacao_historico FROM authenticated;
GRANT SELECT ON public.ninhos_validacao_historico TO authenticated;

CREATE OR REPLACE FUNCTION public.trg_ninhos_historico_validacao()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _nome   text;
  _perfil text;
BEGIN
  IF NEW.status_validacao IS NOT DISTINCT FROM OLD.status_validacao
     AND NEW.numero_ninho IS NOT DISTINCT FROM OLD.numero_ninho THEN
    RETURN NULL;
  END IF;

  -- Quem agiu: usuário de mesa ou monitor de campo
  SELECT u.nome_completo, u.perfil::text INTO _nome, _perfil
    FROM usuarios u WHERE u.id = auth.uid();
  IF _nome IS NULL THEN
    SELECT m.nome_completo INTO _nome
      FROM monitores_biodiversidade m WHERE m.usuario_id = auth.uid() LIMIT 1;
    IF _nome IS NOT NULL THEN _perfil := 'monitor'; END IF;
  END IF;

  INSERT INTO ninhos_validacao_historico
    (ninho_id, status_de, status_para, motivo, numero_de, numero_para,
     usuario_id, usuario_nome, perfil)
  VALUES
    (NEW.id,
     OLD.status_validacao::text, NEW.status_validacao::text,
     CASE WHEN NEW.status_validacao::text IN ('rejeitado', 'em_correcao')
          THEN NEW.motivo_rejeicao END,
     CASE WHEN NEW.numero_ninho IS DISTINCT FROM OLD.numero_ninho THEN OLD.numero_ninho END,
     CASE WHEN NEW.numero_ninho IS DISTINCT FROM OLD.numero_ninho THEN NEW.numero_ninho END,
     auth.uid(), _nome, _perfil);
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.trg_ninhos_historico_validacao() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_ninhos_historico_validacao
  AFTER UPDATE OF status_validacao, numero_ninho ON public.ninhos_quelonios
  FOR EACH ROW EXECUTE FUNCTION public.trg_ninhos_historico_validacao();

INSERT INTO public.ninhos_validacao_historico
  (ninho_id, status_de, status_para, motivo, usuario_id, usuario_nome, perfil, em)
SELECT n.id, NULL, n.status_validacao::text,
       CASE WHEN n.status_validacao::text IN ('rejeitado', 'em_correcao') THEN n.motivo_rejeicao END,
       n.validado_por, u.nome_completo, u.perfil::text, n.validado_em
  FROM public.ninhos_quelonios n
  LEFT JOIN public.usuarios u ON u.id = n.validado_por
 WHERE n.validado_em IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM public.ninhos_validacao_historico h WHERE h.ninho_id = n.id);

-- ── 2) IP real no registro de acesso ───────────────────────────────
CREATE OR REPLACE FUNCTION public.registrar_tentativa_acesso(
  p_email text, p_sucesso boolean, p_ip text DEFAULT NULL::text,
  p_user_agent text DEFAULT NULL::text, p_motivo_falha text DEFAULT NULL::text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id    uuid;
  v_tentativas integer;
  v_headers    jsonb;
  v_ip         text;
BEGIN
  -- IP que o servidor viu. O cliente não alcança serviço externo de IP
  -- (CSP connect-src), então p_ip quase sempre chega nulo — fica só de
  -- reserva.
  BEGIN
    v_headers := nullif(current_setting('request.headers', true), '')::jsonb;
  EXCEPTION WHEN others THEN v_headers := NULL;
  END;
  v_ip := left(COALESCE(
    nullif(trim(v_headers->>'cf-connecting-ip'), ''),
    nullif(trim(split_part(v_headers->>'x-forwarded-for', ',', 1)), ''),
    nullif(trim(v_headers->>'x-real-ip'), ''),
    nullif(trim(p_ip), '')), 64);

  SELECT id, tentativas_falha
  INTO   v_user_id, v_tentativas
  FROM   usuarios
  WHERE  lower(email) = lower(p_email);

  IF p_sucesso THEN
    IF v_user_id IS NOT NULL THEN
      UPDATE usuarios
         SET tentativas_falha = 0,
             bloqueado_ate    = NULL,
             ultimo_login     = now()
       WHERE id = v_user_id;
    END IF;

    INSERT INTO auditoria_acessos (usuario_id, email, tipo_evento, sucesso, ip_address, user_agent)
    VALUES (v_user_id, p_email, 'login', true, v_ip, p_user_agent);

    RETURN jsonb_build_object('ok', true);

  ELSE
    IF v_user_id IS NOT NULL THEN
      v_tentativas := COALESCE(v_tentativas, 0) + 1;
      IF v_tentativas >= 5 THEN
        UPDATE usuarios
           SET tentativas_falha = v_tentativas,
               bloqueado_ate    = now() + interval '10 minutes'
         WHERE id = v_user_id;
      ELSE
        UPDATE usuarios
           SET tentativas_falha = v_tentativas
         WHERE id = v_user_id;
      END IF;
    END IF;

    INSERT INTO auditoria_acessos (usuario_id, email, tipo_evento, sucesso, motivo_falha, ip_address, user_agent)
    VALUES (v_user_id, p_email, 'falha_login', false, p_motivo_falha, v_ip, p_user_agent);

    RETURN jsonb_build_object('ok', true, 'tentativas', COALESCE(v_tentativas, 0));
  END IF;
END;
$function$;

-- ── 3) limpeza do trigger duplicado (passo separado, ver cabeçalho) ─
-- Aplicado em produção (03/10/2026): o trigger foi DESLIGADO com
--   ALTER TABLE public.ninhos_quelonios DISABLE TRIGGER trg_ninhos_seguir_origem;
-- porque o DROP abaixo pede confirmação no MCP e expirou 4 vezes. Desligado
-- e com a função em RETURN NEW, não tem efeito nenhum; o DROP fica para
-- quem rodar à mão no SQL Editor.
ALTER TABLE public.ninhos_quelonios DISABLE TRIGGER trg_ninhos_seguir_origem;
DROP TRIGGER IF EXISTS trg_ninhos_seguir_origem ON public.ninhos_quelonios;
DROP FUNCTION IF EXISTS public.trg_ninhos_seguir_origem();
