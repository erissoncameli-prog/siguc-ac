-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Credenciamento — acesso de exceção fora do setor
-- Frente 3 de docs/acesso-por-organograma.md
--
-- POR QUE É TABELA PRÓPRIA, E NÃO usuario_permissoes
-- `usuario_permissoes` (migration 057) já existe e faz override
-- individual — mas é ESTADO permanente (PK usuario_id+modulo_id, sem
-- data_fim, `motivo` opcional): serve para "este usuário sempre tem
-- nível X neste módulo", não para exceção com prazo. Reaproveitá-la
-- para credenciamento temporário perderia o histórico de renovações e
-- deixaria o acesso de exceção sem vencimento automático — exatamente
-- o modo como todo sistema de permissão apodrece.
--
-- DECISÕES JÁ TOMADAS (docs/acesso-por-organograma.md, "Decisões
-- tomadas"): só super_admin concede; data_fim é OBRIGATÓRIA (nunca
-- credenciamento sem prazo); justificativa obrigatória; nunca eleva
-- acima do teto do perfil (isso é responsabilidade da FRENTE 4, quando
-- nivel_efetivo() passar a consumir credenciamento_vigente() — até lá
-- a tabela existe e pode ser conferida isoladamente, mas não afeta
-- nenhum acesso, mesma disciplina da migration 265).
--
-- RENOVAÇÃO GERA LINHA NOVA, nunca estende a antiga (`renovado_de`
-- aponta para a anterior) — o histórico mostra quantas vezes foi
-- renovado, em vez de apagar o rastro.
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS credenciamentos (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id     uuid NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  modulo_id      uuid NOT NULL REFERENCES modulos(id) ON DELETE CASCADE,
  nivel          nivel_acesso NOT NULL,

  data_inicio    date NOT NULL DEFAULT CURRENT_DATE,
  data_fim       date NOT NULL,          -- NUNCA nulo: prazo é a defesa contra esquecimento

  justificativa  text NOT NULL,
  portaria       text,

  concedido_por  uuid NOT NULL REFERENCES usuarios(id),
  concedido_em   timestamptz NOT NULL DEFAULT now(),

  revogado_em    timestamptz,
  revogado_por   uuid REFERENCES usuarios(id),
  revogado_motivo text,

  -- Renovação = linha nova apontando para a anterior. NUNCA estende
  -- data_fim da linha antiga — ver cabeçalho.
  renovado_de    uuid REFERENCES credenciamentos(id) ON DELETE SET NULL,

  criado_em      timestamptz NOT NULL DEFAULT now(),
  atualizado_em  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT ck_credenciamento_nivel CHECK (nivel <> 'sem_acesso'),
  CONSTRAINT ck_credenciamento_datas CHECK (data_fim > data_inicio),
  CONSTRAINT ck_credenciamento_justificativa CHECK (char_length(btrim(justificativa)) >= 20),
  CONSTRAINT ck_credenciamento_revogacao CHECK ((revogado_em IS NULL) = (revogado_por IS NULL))
);

COMMENT ON TABLE credenciamentos IS
  'Acesso de exceção a módulo, fora da lotação do usuário. Só super_admin concede (RLS). Prazo e justificativa obrigatórios. Frente 3 de docs/acesso-por-organograma.md — ainda NÃO consumida por nivel_efetivo() (isso é a frente 4).';
COMMENT ON COLUMN credenciamentos.data_fim IS
  'Obrigatória de propósito: acesso de exceção sem prazo vira acesso permanente por esquecimento.';
COMMENT ON COLUMN credenciamentos.renovado_de IS
  'Renovar cria linha nova apontando para a anterior — nunca estende data_fim da linha existente.';

CREATE INDEX IF NOT EXISTS idx_credenciamentos_usuario ON credenciamentos (usuario_id);
CREATE INDEX IF NOT EXISTS idx_credenciamentos_modulo  ON credenciamentos (modulo_id);
CREATE INDEX IF NOT EXISTS idx_credenciamentos_vigencia ON credenciamentos (data_fim) WHERE revogado_em IS NULL;

DROP TRIGGER IF EXISTS trg_credenciamentos_updated ON credenciamentos;
CREATE TRIGGER trg_credenciamentos_updated BEFORE UPDATE ON credenciamentos
  FOR EACH ROW EXECUTE FUNCTION touch_atualizado_em();

-- ── Cálculo: credenciamento vigente de um usuário num módulo ───
-- Maior nível entre credenciamentos ativos (dentro do prazo, não
-- revogados). NULL quando não há nenhum — nivel_efetivo() (frente 4)
-- trata NULL como "este eixo não se aplica", nunca como sem_acesso.
CREATE OR REPLACE FUNCTION credenciamento_vigente(p_usuario uuid, p_modulo_chave text)
RETURNS nivel_acesso
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT MAX(c.nivel)
    FROM credenciamentos c
    JOIN modulos m ON m.id = c.modulo_id
   WHERE c.usuario_id = p_usuario
     AND m.chave = p_modulo_chave
     AND c.revogado_em IS NULL
     AND CURRENT_DATE BETWEEN c.data_inicio AND c.data_fim;
$$;

COMMENT ON FUNCTION credenciamento_vigente(uuid, text) IS
  'Nível concedido por credenciamento ativo (NULL = nenhum). Ainda NÃO consumida por nivel_efetivo() — ver cabeçalho da migration 266.';

REVOKE EXECUTE ON FUNCTION credenciamento_vigente(uuid, text) FROM anon;

-- ── View de apoio para a tela ────────────────────────────────
CREATE OR REPLACE VIEW vw_credenciamentos
WITH (security_invoker = true) AS
SELECT
  c.id,
  c.usuario_id,
  u.nome_completo       AS usuario_nome,
  u.email               AS usuario_email,
  u.perfil::text        AS usuario_perfil,
  c.modulo_id,
  m.chave               AS modulo_chave,
  m.nome                AS modulo_nome,
  c.nivel::text          AS nivel,
  c.data_inicio,
  c.data_fim,
  (c.data_fim - CURRENT_DATE) AS dias_restantes,
  c.justificativa,
  c.portaria,
  c.concedido_por,
  cp.nome_completo       AS concedido_por_nome,
  c.concedido_em,
  c.revogado_em,
  c.revogado_por,
  rp.nome_completo       AS revogado_por_nome,
  c.revogado_motivo,
  c.renovado_de,
  CASE
    WHEN c.revogado_em IS NOT NULL THEN 'revogado'
    WHEN CURRENT_DATE > c.data_fim THEN 'expirado'
    WHEN CURRENT_DATE < c.data_inicio THEN 'agendado'
    ELSE 'ativo'
  END AS situacao
FROM credenciamentos c
JOIN usuarios u  ON u.id = c.usuario_id
JOIN modulos m   ON m.id = c.modulo_id
JOIN usuarios cp ON cp.id = c.concedido_por
LEFT JOIN usuarios rp ON rp.id = c.revogado_por;

-- ── RLS ───────────────────────────────────────────────────────
ALTER TABLE credenciamentos ENABLE ROW LEVEL SECURITY;

-- Leitura: o próprio credenciado e super_admin. Não é `pode_ver`
-- genérico — quem concede exceção de acesso é assunto de governança,
-- mais restrito que ler o organograma em si (mesmo raciocínio da 265).
DROP POLICY IF EXISTS credenciamentos_select ON credenciamentos;
CREATE POLICY credenciamentos_select ON credenciamentos
  FOR SELECT USING (usuario_id = auth.uid() OR is_super_admin());

-- Escrita (conceder, renovar via INSERT, revogar via UPDATE): só
-- super_admin. Decisão tomada — ver cabeçalho.
DROP POLICY IF EXISTS credenciamentos_admin ON credenciamentos;
CREATE POLICY credenciamentos_admin ON credenciamentos
  FOR ALL USING (is_super_admin()) WITH CHECK (is_super_admin());

-- ── Aviso de vencimento (molde: frota_checar_vencimentos, 205) ──
-- Dedupe pela mesma técnica: `ref` no meta identifica credenciamento+
-- fase, só notifica se não houver notificação não resolvida com a
-- mesma ref. Dois avisos por credenciamento: 15 dias antes e no
-- vencimento — não um por dia.
CREATE OR REPLACE FUNCTION credenciamento_checar_vencimentos(p_dias int DEFAULT 15)
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  c         record;
  v_fase    text;
  v_ref     text;
  v_dias    int;
  v_tit     text;
  v_msg     text;
  v_criadas int := 0;
BEGIN
  FOR c IN
    SELECT cr.id, cr.usuario_id, cr.concedido_por, cr.data_fim,
           m.nome AS modulo_nome, u.nome_completo AS usuario_nome,
           (cr.data_fim - CURRENT_DATE) AS dias_restantes
      FROM credenciamentos cr
      JOIN modulos m  ON m.id = cr.modulo_id
      JOIN usuarios u ON u.id = cr.usuario_id
     WHERE cr.revogado_em IS NULL
       AND cr.data_fim - CURRENT_DATE <= p_dias
       AND cr.data_fim >= CURRENT_DATE - 1  -- inclui "venceu ontem" (cron roda 1x/dia)
  LOOP
    v_dias := c.dias_restantes;
    v_fase := CASE WHEN v_dias < 0 THEN 'vencido' ELSE 'proximo' END;
    v_ref  := 'credenciamento:' || c.id::text || ':' || v_fase;

    IF EXISTS (
      SELECT 1 FROM notificacoes
       WHERE tipo = 'sistema' AND status <> 'resolvida'
         AND meta->>'subtipo' = 'credenciamento_vencimento'
         AND meta->>'ref' = v_ref
    ) THEN
      CONTINUE;
    END IF;

    v_tit := CASE WHEN v_fase = 'vencido'
      THEN 'Credenciamento vencido: ' || c.modulo_nome
      ELSE 'Credenciamento vence em breve: ' || c.modulo_nome END;
    v_msg := format('Acesso de exceção de %s ao módulo %s %s em %s.',
      c.usuario_nome, c.modulo_nome,
      CASE WHEN v_fase = 'vencido' THEN 'venceu' ELSE 'vence' END,
      to_char(c.data_fim, 'DD/MM/YYYY'));

    -- Avisa o credenciado e quem concedeu — o super_admin decide se renova.
    INSERT INTO notificacoes (tipo, status, titulo, mensagem, destinatario_id, meta)
    VALUES ('sistema', 'gerada', v_tit, v_msg, c.usuario_id,
      jsonb_build_object('subtipo','credenciamento_vencimento','ref',v_ref,'credenciamento_id',c.id,'para','credenciado'));
    v_criadas := v_criadas + 1;

    IF c.concedido_por <> c.usuario_id THEN
      INSERT INTO notificacoes (tipo, status, titulo, mensagem, destinatario_id, meta)
      VALUES ('sistema', 'gerada', v_tit, v_msg, c.concedido_por,
        jsonb_build_object('subtipo','credenciamento_vencimento','ref',v_ref || ':concedente','credenciamento_id',c.id,'para','concedente'));
      v_criadas := v_criadas + 1;
    END IF;
  END LOOP;

  RETURN v_criadas;
END;
$$;

REVOKE EXECUTE ON FUNCTION credenciamento_checar_vencimentos(int) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION credenciamento_checar_vencimentos(int) TO service_role;

SELECT cron.unschedule('credenciamentos-vencimentos-diario')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'credenciamentos-vencimentos-diario');

-- 09h20 UTC ≈ 06h20 Acre — mesma janela da 205, evitando colidir com
-- outros crons diários do projeto (09h10 frota, 09h15 biomonitor).
SELECT cron.schedule('credenciamentos-vencimentos-diario', '20 9 * * *',
  $cron$SELECT credenciamento_checar_vencimentos();$cron$);
