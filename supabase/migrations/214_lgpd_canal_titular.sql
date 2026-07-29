-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · LGPD Fase 3 — Canal do titular (Art. 18) + "Meus dados"
--
-- O SIGUC tem CINCO populações de titular com dado pessoal, e cada
-- uma vive numa superfície diferente:
--   · servidor            → mesa (index.html + pages/*, sessionStorage)
--   · brigadista          → app próprio (brigada.html, sessão isolada)
--   · monitor de biodiversidade → app próprio (biomonitor.html)
--   · motorista           → app próprio (frota-app.html)
--   · pesquisador externo → portal próprio (portal-pesquisador.html)
--
-- Em vez de um canal por superfície, esta migration cria UMA tabela e
-- DUAS RPCs que servem as cinco populações ao mesmo tempo, porque
-- todas ancoram em auth.users — o mesmo motivo que já levou
-- lgpd_aceites a referenciar auth.users em vez de `usuarios` (migration
-- 212). Cada frontend (mesa, os 3 apps de campo, portal do
-- pesquisador) chama a mesma RPC; a diferença é só a casca visual.
--
-- lgpd_meus_dados() resolve sozinha qual população o usuário logado
-- pertence — consultando as 5 tabelas de identidade e devolvendo só o
-- que existir — e sob RLS existente (self-select já liberado em todas
-- elas desde antes desta migration). Não precisa de SECURITY DEFINER:
-- a própria RLS já permite a cada um ver os próprios dados; a função
-- só agrega para poupar o cliente de cinco consultas.
-- ═══════════════════════════════════════════════════════════

CREATE TYPE lgpd_tipo_solicitacao AS ENUM (
  'acesso',                  -- Art. 18, I e II — confirmação de tratamento e acesso
  'correcao',                -- Art. 18, III
  'exclusao',                -- Art. 18, IV/VI — anonimização, bloqueio ou eliminação
  'portabilidade',           -- Art. 18, V
  'compartilhamento',        -- Art. 18, VII — com quem os dados são compartilhados
  'revogacao_consentimento', -- Art. 18, IX — só se aplica ao que é opcional (foto, push)
  'outro'
);

CREATE TYPE lgpd_status_solicitacao AS ENUM (
  'recebida', 'em_analise', 'respondida', 'indeferida'
);

CREATE TABLE lgpd_solicitacoes_titular (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tipo           lgpd_tipo_solicitacao NOT NULL,
  descricao      text NOT NULL,
  status         lgpd_status_solicitacao NOT NULL DEFAULT 'recebida',
  resposta       text,
  respondido_por uuid REFERENCES usuarios(id),
  respondido_em  timestamptz,
  criado_em      timestamptz NOT NULL DEFAULT now(),
  atualizado_em  timestamptz NOT NULL DEFAULT now()
  -- Sem coluna prazo_em: `timestamptz + interval` não é IMMUTABLE (a
  -- soma de dias depende do fuso da sessão), então o Postgres recusa
  -- coluna GENERATED com essa expressão. O prazo de 15 dias — o mesmo
  -- declarado na Política de Privacidade e no Aviso de Campo
  -- (migrations 212/213) — é calculado em vw_lgpd_solicitacoes e em
  -- lgpd_meus_dados() a partir de criado_em, e não em armazenamento.
);

CREATE INDEX idx_lgpd_solic_usuario ON lgpd_solicitacoes_titular(usuario_id);
CREATE INDEX idx_lgpd_solic_status  ON lgpd_solicitacoes_titular(status) WHERE status <> 'respondida';

CREATE TRIGGER trg_lgpd_solic_touch
  BEFORE UPDATE ON lgpd_solicitacoes_titular
  FOR EACH ROW EXECUTE FUNCTION touch_atualizado_em();

-- Carimba quem/quando respondeu no servidor — nunca confia no que o
-- cliente envie nesses dois campos.
CREATE OR REPLACE FUNCTION lgpd_solic_carimbar_resposta()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status IN ('respondida','indeferida') THEN
    NEW.respondido_por := auth.uid();
    NEW.respondido_em  := now();
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_lgpd_solic_carimbar
  BEFORE UPDATE ON lgpd_solicitacoes_titular
  FOR EACH ROW EXECUTE FUNCTION lgpd_solic_carimbar_resposta();

-- Nova solicitação → avisa quem administra a Privacidade (mesmo perfil
-- que edita lgpd_documentos: super_admin/gestor). Não existe papel de
-- "encarregado" no sistema de permissões — o Encarregado hoje é um
-- contato institucional em config_sistema (migration 212), não uma
-- conta —, então o aviso operacional vai para quem de fato consegue
-- agir na tela de Configurações → Privacidade.
CREATE OR REPLACE FUNCTION lgpd_solic_notificar_nova()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM usuarios WHERE ativo AND perfil IN ('super_admin','gestor') LOOP
    INSERT INTO notificacoes (tipo, status, titulo, mensagem, destinatario_id, meta)
    VALUES ('sistema', 'gerada', 'Nova solicitação de titular (LGPD)',
      format('Tipo: %s. Prazo de resposta: 15 dias.', NEW.tipo::text),
      r.id, jsonb_build_object('modulo','lgpd','subtipo','solicitacao_titular','solicitacao_id',NEW.id));
  END LOOP;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_lgpd_solic_notificar_nova
  AFTER INSERT ON lgpd_solicitacoes_titular
  FOR EACH ROW EXECUTE FUNCTION lgpd_solic_notificar_nova();

-- Respondida/indeferida → avisa o titular.
CREATE OR REPLACE FUNCTION lgpd_solic_notificar_resposta()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status IN ('respondida','indeferida') THEN
    INSERT INTO notificacoes (tipo, status, titulo, mensagem, destinatario_id, meta)
    VALUES ('sistema', 'gerada',
      CASE WHEN NEW.status = 'indeferida' THEN 'Sua solicitação foi indeferida' ELSE 'Sua solicitação foi respondida' END,
      COALESCE(NEW.resposta, 'Consulte os detalhes em Meus Dados.'),
      NEW.usuario_id,
      jsonb_build_object('modulo','lgpd','subtipo','resposta_solicitacao','solicitacao_id',NEW.id));
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_lgpd_solic_notificar_resposta
  AFTER UPDATE ON lgpd_solicitacoes_titular
  FOR EACH ROW EXECUTE FUNCTION lgpd_solic_notificar_resposta();

-- ── RLS ────────────────────────────────────────────────────────
ALTER TABLE lgpd_solicitacoes_titular ENABLE ROW LEVEL SECURITY;

CREATE POLICY lgpd_solic_select ON lgpd_solicitacoes_titular FOR SELECT
  USING (usuario_id = auth.uid()
         OR EXISTS (SELECT 1 FROM usuarios u
                     WHERE u.id = auth.uid() AND u.perfil IN ('super_admin','gestor') AND u.ativo));

-- Qualquer titular autenticado abre a própria solicitação — é o canal
-- do Art. 18, tem que estar aberto a todas as 5 populações.
CREATE POLICY lgpd_solic_insert ON lgpd_solicitacoes_titular FOR INSERT
  WITH CHECK (usuario_id = auth.uid());

-- Só quem administra a Privacidade responde. Sem policy de UPDATE
-- para o próprio titular de propósito: uma solicitação enviada não é
-- editável por quem pediu (evita reescrever o pedido depois de
-- receber resposta) — para corrigir o pedido, abre-se um novo.
CREATE POLICY lgpd_solic_update ON lgpd_solicitacoes_titular FOR UPDATE
  USING (EXISTS (SELECT 1 FROM usuarios u
                  WHERE u.id = auth.uid() AND u.perfil IN ('super_admin','gestor') AND u.ativo));

-- Sem DELETE: é histórico de exercício de direito, não se apaga.

-- ── View para a tela de administração ──────────────────────────
-- Resolve o nome do titular cruzando as 5 tabelas de identidade — não
-- há uma coluna de nome única porque nem toda população tem linha em
-- `usuarios` (brigadista/monitor/motorista/pesquisador autenticam
-- direto pelo Supabase Auth, sem perfil em `usuarios`).
CREATE VIEW vw_lgpd_solicitacoes WITH (security_invoker = true) AS
SELECT
  s.id, s.usuario_id, s.tipo, s.descricao, s.status, s.resposta,
  s.respondido_por, s.respondido_em, s.criado_em, s.atualizado_em,
  s.criado_em + interval '15 days' AS prazo_em,
  COALESCE(u.nome_completo, b.nome_completo, m.nome_completo, fm.nome, p.nome_completo) AS solicitante_nome,
  COALESCE(u.email, b.email, m.email, p.email)                                          AS solicitante_email,
  CASE
    WHEN u.id  IS NOT NULL THEN 'servidor'
    WHEN b.id  IS NOT NULL THEN 'brigadista'
    WHEN m.id  IS NOT NULL THEN 'monitor'
    WHEN fm.id IS NOT NULL THEN 'motorista'
    WHEN p.id  IS NOT NULL THEN 'pesquisador'
    ELSE 'desconhecido'
  END AS solicitante_papel,
  ur.nome_completo AS respondido_por_nome
FROM lgpd_solicitacoes_titular s
LEFT JOIN usuarios u                    ON u.id  = s.usuario_id
LEFT JOIN brigadistas b                 ON b.usuario_id = s.usuario_id
LEFT JOIN monitores_biodiversidade m    ON m.usuario_id = s.usuario_id
LEFT JOIN frota_motoristas fm           ON fm.usuario_id = s.usuario_id
LEFT JOIN pesquisadores p               ON p.user_id = s.usuario_id
LEFT JOIN usuarios ur                   ON ur.id = s.respondido_por;

-- ── RPC: "Meus dados" ───────────────────────────────────────────
-- SECURITY INVOKER: não escala privilégio nenhum, só agrega o que o
-- próprio titular já pode ler pela RLS existente em cada tabela.
CREATE OR REPLACE FUNCTION lgpd_meus_dados()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'usuario', (
      SELECT jsonb_build_object(
        'nome_completo', u.nome_completo, 'email', u.email, 'telefone', u.telefone,
        'perfil', u.perfil, 'ativo', u.ativo, 'criado_em', u.criado_em)
      FROM usuarios u WHERE u.id = auth.uid()
    ),
    'brigadista', (
      SELECT jsonb_build_object(
        'nome_completo', b.nome_completo, 'cpf', b.cpf, 'rg', b.rg,
        'data_nascimento', b.data_nascimento, 'telefone', b.telefone, 'email', b.email,
        'cnh', b.cnh, 'funcao', b.funcao, 'status', b.status,
        'contato_emergencia_nome', b.contato_emergencia_nome,
        'contato_emergencia_telefone', b.contato_emergencia_telefone,
        'brigada_nome', br.nome, 'equipe_nome', eq.nome)
      FROM brigadistas b
      LEFT JOIN brigadas br ON br.id = b.brigada_id
      LEFT JOIN equipes_brigada eq ON eq.id = b.equipe_id
      WHERE b.usuario_id = auth.uid()
    ),
    'monitor', (
      SELECT jsonb_build_object(
        'nome_completo', m.nome_completo, 'cpf', m.cpf, 'rg', m.rg,
        'data_nascimento', m.data_nascimento, 'telefone', m.telefone, 'email', m.email,
        'funcao', m.funcao, 'status', m.status, 'grupo_nome', g.nome)
      FROM monitores_biodiversidade m
      LEFT JOIN grupos_biomonitor g ON g.id = m.grupo_id
      WHERE m.usuario_id = auth.uid()
    ),
    'motorista', (
      SELECT jsonb_build_object(
        'nome', fm.nome, 'cpf', fm.cpf, 'matricula', fm.matricula, 'telefone', fm.telefone,
        'cnh_numero', fm.cnh_numero, 'cnh_categoria', fm.cnh_categoria, 'cnh_validade', fm.cnh_validade,
        'status', fm.status, 'ativo', fm.ativo)
      FROM frota_motoristas fm WHERE fm.usuario_id = auth.uid()
    ),
    'pesquisador', (
      SELECT jsonb_build_object(
        'nome_completo', p.nome_completo, 'cpf', p.cpf, 'rg', p.rg, 'email', p.email,
        'telefone', p.telefone, 'instituicao', p.instituicao, 'titulacao', p.titulacao,
        'ativo', p.ativo)
      FROM pesquisadores p WHERE p.user_id = auth.uid()
    ),
    'aceites', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
               'documento', d.titulo, 'versao', v.versao, 'aceito_em', a.aceito_em
             ) ORDER BY a.aceito_em DESC), '[]'::jsonb)
      FROM lgpd_aceites a
      JOIN lgpd_documento_versoes v ON v.id = a.versao_id
      JOIN lgpd_documentos d        ON d.id = v.documento_id
      WHERE a.usuario_id = auth.uid()
    ),
    'solicitacoes', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
               'id', s.id, 'tipo', s.tipo, 'descricao', s.descricao, 'status', s.status,
               'resposta', s.resposta, 'criado_em', s.criado_em,
               'prazo_em', s.criado_em + interval '15 days',
               'respondido_em', s.respondido_em
             ) ORDER BY s.criado_em DESC), '[]'::jsonb)
      FROM lgpd_solicitacoes_titular s
      WHERE s.usuario_id = auth.uid()
    )
  );
$$;

REVOKE EXECUTE ON FUNCTION lgpd_meus_dados() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION lgpd_meus_dados() TO authenticated;

COMMENT ON TABLE lgpd_solicitacoes_titular IS
  'Canal do titular (LGPD Art. 18). Serve as 5 populações de titular do sistema via auth.users — servidor, brigadista, monitor, motorista e pesquisador — com a mesma tabela e as mesmas RPCs.';
