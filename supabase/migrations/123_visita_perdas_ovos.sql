-- ═══════════════════════════════════════════════════════════════
-- SIGUC-AC · Biomonitor — Perdas de ovos na visita (por causa)
-- ───────────────────────────────────────────────────────────────
-- Antes, só a PREDAÇÃO lançada na visita (ovos_predados_n) virava
-- descarte e baixava os ovos viáveis (mig. 105). Alagamento, erosão/
-- apodrecimento, dano humano e a DESTRUIÇÃO TOTAL do ninho não eram
-- contabilizados nem baixados.
--
-- Agora a visita registra a perda POR CAUSA (campos separados) e a
-- causa fina é preservada em descartes_ovos.causa; o motivo grosso
-- (natural/predacao/humana) continua para os relatórios existentes.
-- Destruição total (status_ninho='destruido') baixa TODOS os ovos
-- viáveis restantes e marca o ninho como 'perdido'.
--
-- Mecanismo de baixa reaproveitado: descartes_ovos (etapa='visita')
-- → já entra em "ovos viáveis" (postura − Σ descartes). Idempotente
-- por (visita, causa); a edição da visita reconcilia os descartes.
-- Depende de 093 (descartes_ovos) e 105 (visita→predação).
-- ═══════════════════════════════════════════════════════════════

-- ── 1. Causa fina da perda ───────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE causa_perda_ovo AS ENUM ('predacao','alagamento','erosao','humana','outro');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 2. Causa fina no evento de descarte ──────────────────────────
ALTER TABLE descartes_ovos
  ADD COLUMN IF NOT EXISTS causa causa_perda_ovo;

COMMENT ON COLUMN descartes_ovos.causa IS
  'Causa detalhada da baixa (predacao/alagamento/erosao/humana/outro). '
  'motivo continua sendo a classe grossa (natural/predacao/humana).';

-- Backfill de causa para os descartes que já têm motivo inequívoco
UPDATE descartes_ovos SET causa = 'predacao' WHERE causa IS NULL AND motivo = 'predacao';
UPDATE descartes_ovos SET causa = 'humana'   WHERE causa IS NULL AND motivo = 'humana';
-- 'natural' legado fica sem causa fina (pode ser alagamento/erosão/etc.)

-- ── 3. Campos de perda por causa na visita ───────────────────────
ALTER TABLE visitas_ninho
  ADD COLUMN IF NOT EXISTS ovos_perdidos_alagamento smallint
    CHECK (ovos_perdidos_alagamento IS NULL OR ovos_perdidos_alagamento >= 0),
  ADD COLUMN IF NOT EXISTS ovos_perdidos_erosao     smallint
    CHECK (ovos_perdidos_erosao IS NULL OR ovos_perdidos_erosao >= 0),
  ADD COLUMN IF NOT EXISTS ovos_perdidos_humana     smallint
    CHECK (ovos_perdidos_humana IS NULL OR ovos_perdidos_humana >= 0),
  ADD COLUMN IF NOT EXISTS causa_destruicao         causa_perda_ovo;

COMMENT ON COLUMN visitas_ninho.causa_destruicao IS
  'Causa principal quando status_ninho = destruido (baixa total dos viáveis).';

-- ── 4. Trigger único: espelha TODAS as perdas da visita ──────────
-- Substitui trg_visita_predacao_descarte (mig. 105).
CREATE OR REPLACE FUNCTION trg_visita_perdas_descarte()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  u_pred uuid := md5(NEW.uuid_cliente::text || ':visita-predacao')::uuid;
  u_alag uuid := md5(NEW.uuid_cliente::text || ':visita-alagamento')::uuid;
  u_eros uuid := md5(NEW.uuid_cliente::text || ':visita-erosao')::uuid;
  u_hum  uuid := md5(NEW.uuid_cliente::text || ':visita-humana')::uuid;
  u_dest uuid := md5(NEW.uuid_cliente::text || ':visita-destruicao')::uuid;
  v_restante int;
BEGIN
  IF NEW.ninho_id IS NULL THEN RETURN NEW; END IF;

  IF NEW.status_ninho = 'destruido' THEN
    -- Destruição total: itemização por causa não se aplica; baixa o
    -- que restava de viável e marca o ninho como perdido.
    DELETE FROM descartes_ovos WHERE uuid_cliente IN (u_pred, u_alag, u_eros, u_hum);

    SELECT GREATEST(COALESCE(n.qtd_ovos,0) - COALESCE((
             SELECT SUM(d.qtd) FROM descartes_ovos d
              WHERE d.ninho_id = NEW.ninho_id AND d.uuid_cliente <> u_dest), 0), 0)
      INTO v_restante
      FROM ninhos_quelonios n WHERE n.id = NEW.ninho_id;

    IF v_restante > 0 THEN
      INSERT INTO descartes_ovos
        (uuid_cliente, ninho_id, qtd, motivo, causa, etapa, data_descarte, observacoes, monitor_id)
      VALUES (u_dest, NEW.ninho_id, v_restante,
        (CASE COALESCE(NEW.causa_destruicao,'outro')
           WHEN 'predacao' THEN 'predacao' WHEN 'humana' THEN 'humana'
           ELSE 'natural' END)::motivo_descarte,
        COALESCE(NEW.causa_destruicao,'outro'), 'visita', NEW.data_visita,
        'Destruição total do ninho (visita)', NEW.monitor_id)
      ON CONFLICT (uuid_cliente) DO UPDATE
        SET qtd = EXCLUDED.qtd, motivo = EXCLUDED.motivo, causa = EXCLUDED.causa,
            data_descarte = EXCLUDED.data_descarte, monitor_id = EXCLUDED.monitor_id;
    ELSE
      DELETE FROM descartes_ovos WHERE uuid_cliente = u_dest;
    END IF;

    UPDATE ninhos_quelonios SET status = 'perdido', atualizado_em = now()
     WHERE id = NEW.ninho_id AND status IN ('encontrado','transferido');

    RETURN NEW;
  END IF;

  -- Não destruído: remove eventual baixa de destruição desta visita
  -- (caso o status tenha sido corrigido). Não reverte 'perdido' sozinho.
  DELETE FROM descartes_ovos WHERE uuid_cliente = u_dest;

  -- Predação (mantém o gate do subtipo, como na mig. 105)
  IF NEW.ovos_predados_n > 0
     AND NEW.predacao_incubacao IN ('por_animais','por_pessoas','desconhecida') THEN
    INSERT INTO descartes_ovos
      (uuid_cliente, ninho_id, qtd, motivo, causa, etapa, data_descarte, observacoes, monitor_id)
    VALUES (u_pred, NEW.ninho_id, NEW.ovos_predados_n, 'predacao', 'predacao', 'visita',
      NEW.data_visita, 'Predação na visita (' || NEW.predacao_incubacao || ')', NEW.monitor_id)
    ON CONFLICT (uuid_cliente) DO UPDATE
      SET qtd = EXCLUDED.qtd, causa = 'predacao', data_descarte = EXCLUDED.data_descarte,
          monitor_id = EXCLUDED.monitor_id;
  ELSE
    DELETE FROM descartes_ovos WHERE uuid_cliente = u_pred;
  END IF;

  -- Alagamento (motivo natural)
  IF NEW.ovos_perdidos_alagamento > 0 THEN
    INSERT INTO descartes_ovos
      (uuid_cliente, ninho_id, qtd, motivo, causa, etapa, data_descarte, observacoes, monitor_id)
    VALUES (u_alag, NEW.ninho_id, NEW.ovos_perdidos_alagamento, 'natural', 'alagamento', 'visita',
      NEW.data_visita, 'Perda por alagamento (visita)', NEW.monitor_id)
    ON CONFLICT (uuid_cliente) DO UPDATE
      SET qtd = EXCLUDED.qtd, causa = 'alagamento', data_descarte = EXCLUDED.data_descarte,
          monitor_id = EXCLUDED.monitor_id;
  ELSE
    DELETE FROM descartes_ovos WHERE uuid_cliente = u_alag;
  END IF;

  -- Erosão / apodrecimento (motivo natural)
  IF NEW.ovos_perdidos_erosao > 0 THEN
    INSERT INTO descartes_ovos
      (uuid_cliente, ninho_id, qtd, motivo, causa, etapa, data_descarte, observacoes, monitor_id)
    VALUES (u_eros, NEW.ninho_id, NEW.ovos_perdidos_erosao, 'natural', 'erosao', 'visita',
      NEW.data_visita, 'Perda por erosão/apodrecimento (visita)', NEW.monitor_id)
    ON CONFLICT (uuid_cliente) DO UPDATE
      SET qtd = EXCLUDED.qtd, causa = 'erosao', data_descarte = EXCLUDED.data_descarte,
          monitor_id = EXCLUDED.monitor_id;
  ELSE
    DELETE FROM descartes_ovos WHERE uuid_cliente = u_eros;
  END IF;

  -- Dano humano (motivo humana)
  IF NEW.ovos_perdidos_humana > 0 THEN
    INSERT INTO descartes_ovos
      (uuid_cliente, ninho_id, qtd, motivo, causa, etapa, data_descarte, observacoes, monitor_id)
    VALUES (u_hum, NEW.ninho_id, NEW.ovos_perdidos_humana, 'humana', 'humana', 'visita',
      NEW.data_visita, 'Dano humano aos ovos (visita)', NEW.monitor_id)
    ON CONFLICT (uuid_cliente) DO UPDATE
      SET qtd = EXCLUDED.qtd, causa = 'humana', data_descarte = EXCLUDED.data_descarte,
          monitor_id = EXCLUDED.monitor_id;
  ELSE
    DELETE FROM descartes_ovos WHERE uuid_cliente = u_hum;
  END IF;

  RETURN NEW;
END;
$$;

-- Troca o trigger da 105 pelo novo (cobre todas as causas + status)
DROP TRIGGER IF EXISTS trg_visita_predacao_descarte ON visitas_ninho;
DROP TRIGGER IF EXISTS trg_visita_perdas_descarte   ON visitas_ninho;
CREATE TRIGGER trg_visita_perdas_descarte
  AFTER INSERT OR UPDATE OF ovos_predados_n, predacao_incubacao,
    ovos_perdidos_alagamento, ovos_perdidos_erosao, ovos_perdidos_humana,
    causa_destruicao, status_ninho, ninho_id, data_visita
  ON visitas_ninho
  FOR EACH ROW EXECUTE FUNCTION trg_visita_perdas_descarte();
