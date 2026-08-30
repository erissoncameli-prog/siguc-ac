-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Qualidade da Água — reserva de códigos para etiqueta
-- de frasco (Fase 1 do plano em
-- docs/qualidade-agua/plano-etiqueta-frasco.md)
--
-- PROBLEMA: `codigo_amostra` (o identificador que vai na etiqueta do
-- frasco, ex. COL-2026-0042) só existe depois do SYNC — é gerado por
-- trigger no banco (migration 273). Mas a etiqueta precisa ser
-- impressa em campo, OFFLINE, com o código DEFINITIVO (o mesmo que o
-- laboratório vai ver no laudo) — nunca um provisório que precise de
-- reconciliação depois.
--
-- SOLUÇÃO: o app RESERVA um bloco de códigos com antecedência
-- (enquanto há conexão, ex. antes de sair a campo) via
-- `agua_reservar_codigos()`. Esses códigos já são definitivos — a
-- reserva consome o MESMO contador (`agua_coletas_contador`,
-- migration 273) que o trigger usa, então nunca colide. O app guarda
-- os códigos reservados no IndexedDB (js/agua-etiqueta.js) e atribui
-- um a cada coleta nova antes de salvar offline. Quando essa coleta
-- sincroniza com `codigo_amostra` já preenchido, o trigger da 273
-- simplesmente RESPEITA o valor (não gera outro) — nenhuma mudança
-- naquele trigger foi necessária.
--
-- CONSEQUÊNCIA ACEITA E DECLARADA: um código reservado que nunca vira
-- coleta (usuário reservou 20, usou 12) deixa BURACO na numeração —
-- COL-2026-0042 pode nunca existir. Isso é esperado, não é bug: sem
-- declarar, uma auditoria futura concluiria que uma coleta sumiu. Por
-- isso `agua_codigos_reservados_pendentes()` existe: relatório do que
-- foi reservado e nunca usado, para a mesa conferir.
--
-- CÓDIGO RESERVADO NUNCA É RECICLADO — reaproveitar um código não
-- usado abriria a chance de dois frascos físicos (um velho, sobrado
-- na caixa; um novo) com o mesmo código.
--
-- MARCAÇÃO DE USO É AUTOMÁTICA (trigger AFTER, não uma chamada de
-- API): quando QUALQUER coleta é gravada com um `codigo_amostra` que
-- bate com uma reserva em aberto, a reserva é marcada `usado_em`. Isso
-- fecha o laço sem exigir nenhuma mudança em js/agua-sync.js — o
-- upsert de sempre já faz o suficiente.
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS agua_codigos_reservados (
  codigo        text PRIMARY KEY,
  ano           int NOT NULL,
  reservado_por uuid NOT NULL REFERENCES auth.users(id),
  reservado_em  timestamptz NOT NULL DEFAULT now(),
  expira_em     timestamptz NOT NULL,
  usado_em      timestamptz
);

CREATE INDEX IF NOT EXISTS idx_agua_codigos_reservados_pendentes
  ON agua_codigos_reservados (reservado_por) WHERE usado_em IS NULL;

COMMENT ON TABLE agua_codigos_reservados IS
  'Bloco de códigos de amostra (codigo_amostra) reservados com antecedência para impressão de etiqueta offline. Só escrito por agua_reservar_codigos() (RPC) e pelo trigger de uso — nunca INSERT/UPDATE direto do cliente.';
COMMENT ON COLUMN agua_codigos_reservados.usado_em IS
  'Preenchido automaticamente (trigger em agua_coletas) quando uma coleta é gravada com este código. NULL = ainda não usado — se ficar assim para sempre, é um buraco aceito na numeração (ver cabeçalho desta migration).';

ALTER TABLE agua_codigos_reservados ENABLE ROW LEVEL SECURITY;
-- Sem policies de INSERT/UPDATE/DELETE: só a RPC (SECURITY DEFINER) e
-- o trigger escrevem. SELECT: o próprio técnico vê o que reservou;
-- quem edita o módulo vê tudo (mesa, relatório de pendências).
CREATE POLICY agua_codigos_reservados_select ON agua_codigos_reservados
  FOR SELECT TO authenticated
  USING (reservado_por = auth.uid() OR pode_editar('agua'));

REVOKE ALL ON agua_codigos_reservados FROM anon;

-- ── RPC: reservar um bloco de códigos ────────────────────────────
-- Mesmo contador de agua_gerar_codigo_amostra() (migration 273) —
-- nunca uma numeração paralela, senão colide no UNIQUE de
-- codigo_amostra assim que sincronizar.
CREATE OR REPLACE FUNCTION agua_reservar_codigos(p_qtd int)
RETURNS TABLE(codigo text, expira_em timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_ano       int := EXTRACT(YEAR FROM now())::int;
  v_num       int;
  v_codigo    text;
  v_expira    timestamptz := make_timestamptz(v_ano, 12, 31, 23, 59, 59, 'UTC');
  v_pendentes int;
  i           int;
BEGIN
  IF NOT pode_editar('agua') THEN
    RAISE EXCEPTION 'Sem permissão para editar Qualidade da Água.';
  END IF;
  IF p_qtd IS NULL OR p_qtd < 1 OR p_qtd > 50 THEN
    RAISE EXCEPTION 'Quantidade deve ser entre 1 e 50 por chamada.';
  END IF;

  -- Teto em aberto por técnico: reserva não é consumo grátis do
  -- contador — sem limite, um toque acidental furaria centenas de
  -- números.
  SELECT count(*) INTO v_pendentes
    FROM agua_codigos_reservados
   WHERE reservado_por = auth.uid() AND usado_em IS NULL AND expira_em > now();
  IF v_pendentes + p_qtd > 200 THEN
    RAISE EXCEPTION 'Limite de 200 códigos reservados e ainda não usados por técnico. Você tem % pendentes — use-os ou aguarde expirar antes de reservar mais.', v_pendentes;
  END IF;

  FOR i IN 1..p_qtd LOOP
    INSERT INTO agua_coletas_contador (ano, ultimo) VALUES (v_ano, 1)
      ON CONFLICT (ano) DO UPDATE SET ultimo = agua_coletas_contador.ultimo + 1
      RETURNING ultimo INTO v_num;
    v_codigo := 'COL-' || v_ano || '-' || lpad(v_num::text, 4, '0');
    INSERT INTO agua_codigos_reservados (codigo, ano, reservado_por, expira_em)
      VALUES (v_codigo, v_ano, auth.uid(), v_expira);
    codigo := v_codigo;
    expira_em := v_expira;
    RETURN NEXT;
  END LOOP;
END;
$$;

COMMENT ON FUNCTION agua_reservar_codigos(int) IS
  'Reserva N códigos de amostra definitivos (mesmo contador do trigger da migration 273), para o app de campo imprimir etiqueta offline com o código real. Teto de 50 por chamada e 200 em aberto por técnico.';

REVOKE ALL ON FUNCTION agua_reservar_codigos(int) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION agua_reservar_codigos(int) FROM anon;
GRANT EXECUTE ON FUNCTION agua_reservar_codigos(int) TO authenticated;

-- ── Trigger: marca reserva como usada quando a coleta grava ──────
CREATE OR REPLACE FUNCTION agua_marcar_codigo_reservado_usado()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NEW.codigo_amostra IS NOT NULL THEN
    UPDATE agua_codigos_reservados
       SET usado_em = now()
     WHERE codigo = NEW.codigo_amostra AND usado_em IS NULL;
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION agua_marcar_codigo_reservado_usado() IS
  'Fecha o laço da reserva: quando uma coleta sincroniza com codigo_amostra que bate com uma reserva em aberto, marca usado_em. Roda depois do trigger BEFORE INSERT da 273 (que já preencheu codigo_amostra), então sempre vê o valor final.';

DROP TRIGGER IF EXISTS trg_agua_marcar_codigo_usado ON agua_coletas;
CREATE TRIGGER trg_agua_marcar_codigo_usado
  AFTER INSERT OR UPDATE OF codigo_amostra ON agua_coletas
  FOR EACH ROW EXECUTE FUNCTION agua_marcar_codigo_reservado_usado();

-- ── RPC: relatório de reservados sem uso (mesa) ──────────────────
CREATE OR REPLACE FUNCTION agua_codigos_reservados_pendentes()
RETURNS TABLE(
  codigo text, ano int, reservado_por_nome text,
  reservado_em timestamptz, expira_em timestamptz, dias_desde_reserva int
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT pode_ver('agua') THEN
    RAISE EXCEPTION 'Sem permissão para ver Qualidade da Água.';
  END IF;
  RETURN QUERY
    SELECT r.codigo, r.ano, u.nome_completo, r.reservado_em, r.expira_em,
           EXTRACT(DAY FROM now() - r.reservado_em)::int
      FROM agua_codigos_reservados r
      LEFT JOIN usuarios u ON u.id = r.reservado_por
     WHERE r.usado_em IS NULL
     ORDER BY r.reservado_em;
END;
$$;

COMMENT ON FUNCTION agua_codigos_reservados_pendentes() IS
  'Relatório de mesa: códigos reservados para etiqueta que nunca viraram coleta — o buraco aceito na numeração (ver cabeçalho desta migration), auditável em vez de misterioso.';

REVOKE ALL ON FUNCTION agua_codigos_reservados_pendentes() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION agua_codigos_reservados_pendentes() FROM anon;
GRANT EXECUTE ON FUNCTION agua_codigos_reservados_pendentes() TO authenticated;
