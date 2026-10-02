-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Biomonitor — impedir "transferência fantasma" em ninhos
-- ───────────────────────────────────────────────────────────
-- Problema real (medido em produção): corrigir a PRAIA ou a PLACA de um
-- ninho já sincronizado pelo app movia só o par de ORIGEM
-- (praia_id / numero_ninho). O par ATUAL (praia_atual_id / numero_atual)
-- ficava CONGELADO no primeiro valor, porque:
--   • o payload de sync de ninho (js/biomonitor-sync.js) NÃO envia
--     praia_atual_id nem numero_atual; e
--   • o gatilho de default (trg_ninhos_praia_atual, migration 092) é
--     BEFORE INSERT apenas — não roda em UPDATE.
-- A divergência resultante (origem ≠ atual) é lida pela tela do app como
-- "Transferido de …", mesmo SEM nenhuma linha em transferencias_ninho e
-- com status ainda 'encontrado'. Foram 19 ninhos nessa situação (2 praias
-- trocadas + 17 renumerações), de 2 monitores diferentes — bug sistêmico.
--
-- A RPC da mesa biomonitor_corrigir_localizacao_ninho (migration 301) já
-- "arrastava" o par ATUAL junto quando o ninho nunca foi transferido.
-- Aqui a MESMA regra passa a valer no BANCO, para QUALQUER caminho de
-- escrita (app, sync, RPC, futuro) — mesma filosofia de defesa no banco
-- da trava de veículo do Frota (180) e do recorte do Acre (239).
--
-- Transferência REAL não é afetada: o gatilho só age quando a ORIGEM
-- muda E o ninho ainda estava na própria origem (nunca transferido).
-- ═══════════════════════════════════════════════════════════

-- ── 1. Backfill: normaliza ninhos nunca transferidos cuja origem
--       divergiu do atual (idempotente — 0 linhas depois de corrigido).
UPDATE ninhos_quelonios n
   SET praia_atual_id = n.praia_id,
       numero_atual   = n.numero_ninho
 WHERE ( n.praia_atual_id IS DISTINCT FROM n.praia_id
      OR n.numero_atual   IS DISTINCT FROM n.numero_ninho )
   AND NOT EXISTS (SELECT 1 FROM transferencias_ninho t WHERE t.ninho_id = n.id);

-- ── 2. Gatilho de prevenção ──────────────────────────────────
-- Ao corrigir a ORIGEM (praia_id/numero_ninho) de um ninho que AINDA
-- estava na própria origem (nunca transferido de verdade), arrasta o par
-- ATUAL junto, mantendo origem == atual. Se o ninho já foi transferido
-- (origem ≠ atual antes do UPDATE), NÃO toca o destino real.
CREATE OR REPLACE FUNCTION trg_ninhos_sincronizar_atual_sem_transf()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF ( NEW.praia_id     IS DISTINCT FROM OLD.praia_id
    OR NEW.numero_ninho IS DISTINCT FROM OLD.numero_ninho )
     AND OLD.praia_atual_id IS NOT DISTINCT FROM OLD.praia_id
     AND OLD.numero_atual   IS NOT DISTINCT FROM OLD.numero_ninho
  THEN
    NEW.praia_atual_id := NEW.praia_id;
    NEW.numero_atual   := NEW.numero_ninho;
  END IF;
  RETURN NEW;
END;
$$;

-- Função só roda via trigger — fecha EXECUTE direto (o ALTER DEFAULT
-- PRIVILEGES do projeto concede a anon/authenticated por nome).
REVOKE ALL ON FUNCTION trg_ninhos_sincronizar_atual_sem_transf() FROM PUBLIC, anon, authenticated;

-- BEFORE UPDATE OF praia_id, numero_ninho: só é avaliado quando a ORIGEM
-- está no SET do UPDATE. O gatilho de transferência (092) mexe só em
-- praia_atual_id/numero_atual/status, então nunca dispara este aqui.
DROP TRIGGER IF EXISTS trg_ninhos_sincronizar_atual ON ninhos_quelonios;
CREATE TRIGGER trg_ninhos_sincronizar_atual
  BEFORE UPDATE OF praia_id, numero_ninho ON ninhos_quelonios
  FOR EACH ROW
  EXECUTE FUNCTION trg_ninhos_sincronizar_atual_sem_transf();
