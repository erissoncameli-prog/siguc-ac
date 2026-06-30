-- ═══════════════════════════════════════════════════════════════
-- SIGUC-AC · Biomonitor — Predação na visita vira descarte de ovos
-- ───────────────────────────────────────────────────────────────
-- A predação lançada numa visita (visitas_ninho.ovos_predados_n) só
-- era usada para gerar alerta — não entrava em descartes_ovos, não
-- aparecia nas estatísticas e não reduzia os ovos do ninho/praia.
--
-- Agora um trigger espelha a predação da visita em descartes_ovos
-- (motivo=predacao, etapa=visita), de forma idempotente (uuid_cliente
-- derivado do uuid da visita) e mantendo os dois em sincronia. Assim a
-- predação passa a alimentar as estatísticas de perda/predação e o
-- cálculo de "ovos viáveis". Tudo aditivo.
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION trg_visita_predacao_descarte()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uuid   uuid;
  v_should boolean;
BEGIN
  IF NEW.ninho_id IS NULL THEN RETURN NEW; END IF;

  -- uuid determinístico a partir da visita (idempotência)
  v_uuid := md5(NEW.uuid_cliente::text || ':visita-predacao')::uuid;

  v_should := (NEW.ovos_predados_n IS NOT NULL
               AND NEW.ovos_predados_n > 0
               AND NEW.predacao_incubacao IN ('por_animais','por_pessoas','desconhecida'));

  IF v_should THEN
    INSERT INTO descartes_ovos
      (uuid_cliente, ninho_id, qtd, motivo, etapa, data_descarte, observacoes, monitor_id)
    VALUES
      (v_uuid, NEW.ninho_id, NEW.ovos_predados_n, 'predacao', 'visita', NEW.data_visita,
       'Gerado automaticamente da visita (predação ' || NEW.predacao_incubacao || ')', NEW.monitor_id)
    ON CONFLICT (uuid_cliente) DO UPDATE
      SET qtd           = EXCLUDED.qtd,
          ninho_id      = EXCLUDED.ninho_id,
          motivo        = 'predacao',
          etapa         = 'visita',
          data_descarte = EXCLUDED.data_descarte,
          monitor_id    = EXCLUDED.monitor_id;
  ELSE
    -- Predação corrigida para nenhuma/0 → remove o descarte espelhado
    DELETE FROM descartes_ovos WHERE uuid_cliente = v_uuid;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_visita_predacao_descarte ON visitas_ninho;
CREATE TRIGGER trg_visita_predacao_descarte
  AFTER INSERT OR UPDATE OF ovos_predados_n, predacao_incubacao, ninho_id, data_visita
  ON visitas_ninho
  FOR EACH ROW EXECUTE FUNCTION trg_visita_predacao_descarte();

-- ── Backfill: visitas já registradas com predação ────────────────
INSERT INTO descartes_ovos
  (uuid_cliente, ninho_id, qtd, motivo, etapa, data_descarte, observacoes, monitor_id)
SELECT
  md5(v.uuid_cliente::text || ':visita-predacao')::uuid,
  v.ninho_id, v.ovos_predados_n, 'predacao', 'visita', v.data_visita,
  'Gerado automaticamente da visita (predação ' || v.predacao_incubacao || ')', v.monitor_id
FROM visitas_ninho v
WHERE v.ninho_id IS NOT NULL
  AND v.ovos_predados_n > 0
  AND v.predacao_incubacao IN ('por_animais','por_pessoas','desconhecida')
ON CONFLICT (uuid_cliente) DO NOTHING;
