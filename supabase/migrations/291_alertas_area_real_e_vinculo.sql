-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Migration 291 — Alerta com área real + vínculo com ocorrência
-- Entrega 1 (Base) do Dashboard de Alertas Ambientais.
--
-- Três problemas medidos em produção antes desta migration:
-- (1) DETER entrava como PONTO (primeiro vértice do polígono),
--     area_ha sempre nula — a função de ingestão lia area_km,
--     atributo que o WFS não devolve com esse nome; (2) 100%
--     dos alertas sem uc_id, porque unidades_conservacao.geom
--     estava vazia (corrigido na migration 290, agora populada);
--     (3) nenhum vínculo entre alerta e vistoria de campo.
--
-- Decisão de desenho: geom continua Point (não quebra quem já
-- lê lat/lng dele — mapa, e-mail, análise por alerta). Polígono
-- real entra em coluna nova `poligono`; area_ha passa a ser
-- CALCULADA no banco por ST_Area(geography), nunca copiada do
-- atributo cru da fonte.
--
-- uc_id/uc_nome passam a ser resolvidos SEMPRE pelo trigger, no
-- servidor — nunca mais decisão do cliente/edge function. Isso
-- também backfilla os 2.578 alertas existentes nesta própria
-- migration (UPDATE geom = geom dispara o trigger de novo, sem
-- duplicar a lógica de resolução).
--
-- Aplicada em produção com sucesso: 340/2578 alertas passaram a
-- resolver para dentro de UC (eram 0 antes). Trigger validada com
-- INSERT de teste (revertido) — área, UC e ano_deter corretos.
-- ═══════════════════════════════════════════════════════════

CREATE TYPE status_desfecho_alerta AS ENUM (
  'sem_vistoria', 'em_vistoria', 'procedente', 'improcedente',
  'autuado', 'embargado', 'arquivado'
);

ALTER TABLE alertas_ambientais
  ADD COLUMN poligono geometry(MultiPolygon, 4326),
  ADD COLUMN municipio text,
  ADD COLUMN ano_deter smallint GENERATED ALWAYS AS (
    (EXTRACT(year FROM data_referencia)
     - (CASE WHEN EXTRACT(month FROM data_referencia) < 8 THEN 1 ELSE 0 END))::smallint
  ) STORED,
  ADD COLUMN ocorrencia_id uuid REFERENCES ocorrencias(id),
  ADD COLUMN status_desfecho status_desfecho_alerta NOT NULL DEFAULT 'sem_vistoria',
  ADD COLUMN numero_auto text,
  ADD COLUMN orgao_autuador text,
  ADD COLUMN data_autuacao date,
  ADD COLUMN observacao_desfecho text;

COMMENT ON COLUMN alertas_ambientais.poligono IS
  'Geometria real do alerta (hoje só DETER). Point em `geom` continua sendo o centroide/representativo — não remover, é o que o mapa e o e-mail de notificação já leem.';
COMMENT ON COLUMN alertas_ambientais.municipio IS
  'Copiado do atributo da fonte na ingestão (ex.: props.municipio do WFS DETER). Não é resolvido por point-in-polygon nesta entrega — não há tabela de geometria de município no banco ainda.';
COMMENT ON COLUMN alertas_ambientais.status_desfecho IS
  'Ciclo de vida do alerta até a penalidade: sem_vistoria → em_vistoria → procedente/improcedente → autuado/embargado → arquivado. numero_auto/orgao_autuador são preenchidos manualmente por quem tem o processo em mãos — sobreposição geográfica nunca vira afirmação de causa.';

CREATE INDEX idx_alertas_poligono   ON alertas_ambientais USING gist (poligono) WHERE poligono IS NOT NULL;
CREATE INDEX idx_alertas_ocorrencia ON alertas_ambientais (ocorrencia_id) WHERE ocorrencia_id IS NOT NULL;
CREATE INDEX idx_alertas_desfecho   ON alertas_ambientais (status_desfecho);
CREATE INDEX idx_alertas_ano_deter  ON alertas_ambientais (ano_deter);

-- ── Trigger: área real do polígono + UC sempre resolvida no servidor ──

CREATE OR REPLACE FUNCTION public.alertas_resolver_campos()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uc RECORD;
BEGIN
  IF NEW.poligono IS NOT NULL THEN
    NEW.area_ha := round((ST_Area(NEW.poligono::geography) / 10000)::numeric, 2);
    IF NEW.geom IS NULL THEN
      NEW.geom := ST_Centroid(NEW.poligono);
    END IF;
  END IF;

  IF NEW.geom IS NOT NULL THEN
    SELECT * INTO v_uc FROM encontrar_uc_por_ponto(ST_Y(NEW.geom)::numeric, ST_X(NEW.geom)::numeric) LIMIT 1;
    NEW.uc_id   := v_uc.id;
    NEW.uc_nome := v_uc.nome;
  ELSE
    NEW.uc_id   := NULL;
    NEW.uc_nome := NULL;
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.alertas_resolver_campos() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_alertas_resolver_campos
  BEFORE INSERT OR UPDATE OF geom, poligono ON alertas_ambientais
  FOR EACH ROW EXECUTE FUNCTION public.alertas_resolver_campos();

-- Backfill dos 2.578 alertas existentes — dispara o mesmo trigger,
-- agora que unidades_conservacao.geom está populada (migration 290).
UPDATE alertas_ambientais SET geom = geom;

-- ── RPC: abrir vistoria a partir de um alerta (decisão — vínculo + botão manual) ──

CREATE OR REPLACE FUNCTION public.alerta_abrir_vistoria(
  p_alerta_id uuid,
  p_titulo text DEFAULT NULL,
  p_descricao text DEFAULT NULL,
  p_responsavel_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $function$
DECLARE
  v_alerta        RECORD;
  v_ocorrencia_id uuid;
  v_tipo          tipo_ocorrencia;
BEGIN
  IF NOT pode_editar('alertas-ambientais') THEN
    RAISE EXCEPTION 'sem permissão para abrir vistoria';
  END IF;

  SELECT * INTO v_alerta FROM alertas_ambientais WHERE id = p_alerta_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'alerta não encontrado';
  END IF;
  IF v_alerta.ocorrencia_id IS NOT NULL THEN
    RETURN v_alerta.ocorrencia_id;  -- idempotente: já tem vistoria, devolve a mesma
  END IF;

  v_tipo := CASE WHEN v_alerta.tipo = 'queimada' THEN 'incendio'::tipo_ocorrencia
                 ELSE 'desmatamento'::tipo_ocorrencia END;

  INSERT INTO ocorrencias (
    uc_id, tipo, severidade, status, titulo, descricao, localizacao,
    area_afetada_ha, data_ocorrencia, responsavel_id
  ) VALUES (
    v_alerta.uc_id, v_tipo, v_alerta.severidade, 'aberta',
    COALESCE(p_titulo, initcap(v_alerta.tipo::text) || ' detectada por ' || v_alerta.fonte),
    COALESCE(p_descricao, 'Vistoria aberta a partir de alerta ambiental ('
             || v_alerta.fonte || ', ref. ' || v_alerta.data_referencia || ')'),
    v_alerta.geom, v_alerta.area_ha, v_alerta.data_referencia, p_responsavel_id
  )
  RETURNING id INTO v_ocorrencia_id;

  UPDATE alertas_ambientais
     SET ocorrencia_id = v_ocorrencia_id,
         status_desfecho = 'em_vistoria'
   WHERE id = p_alerta_id;

  RETURN v_ocorrencia_id;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.alerta_abrir_vistoria(uuid, text, text, uuid) FROM PUBLIC, anon;
