-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Biomonitor — posição ESTIMADA do ninho dentro do
-- polígono da praia de ENCONTRO (ninhos lançados de planilha)
-- ───────────────────────────────────────────────────────────
-- Medido em produção (09/10/2026): os 568 ninhos da temporada foram
-- encontrados em campo SEM o app, anotados em planilha e lançados
-- depois pelo app. Resultado:
--   • 471 sem coordenada nenhuma;
--   • 97 com coordenada, mas NENHUM dentro do polígono da própria
--     praia — mediana de ~105 km de distância: é o GPS do celular na
--     hora da DIGITAÇÃO (escritório), não o ninho;
--   • os 568 têm transferência, e bio_mapa_ninhos (333) plotava o
--     transferido no ponto_acesso da praia de DESTINO — todos empilhados
--     em poucos pontos.
--
-- Decisão do usuário: simular a posição dentro do polígono da praia
-- de ENCONTRO (praia_id, nunca praia_atual_id), distribuição aleatória,
-- ninhos podem ficar perto mas nunca sobrepostos, e NENHUM fora do
-- polígono. Os 97 pontos de escritório também são substituídos.
--
-- Regras desta migration:
--   1. Posição estimada NUNCA se passa por GPS de campo: coluna
--      localizacao_estimada, exibida como marcador vazado + aviso.
--   2. Nada se perde: a coordenada anterior (e a precisão) ficam em
--      localizacao_anterior/precisao_gps_m_anterior.
--   3. Reprodutível: semente fixa por praia (ST_GeneratePoints com
--      seed) — rodar de novo não muda quem já foi posicionado, porque
--      só entra ninho SEM ponto ou com ponto FORA do polígono.
--   4. Dentro do polígono, sempre: sorteio num recuo de 1 m da borda e
--      ST_Within conferido ponto a ponto contra o polígono real.
--   5. Sem sobreposição: espaçamento mínimo entre ninhos da praia,
--      proporcional à área por ninho (0,6·√(área/n), teto 3 m, piso
--      0,5 m); se a praia não comporta, reduz aos poucos.
--   6. Aparelho desatualizado não desfaz a estimativa: a fila offline
--      reenvia `localizacao` no upsert do ninho (biomonitor-sync.js) com
--      o GPS antigo do escritório. O trigger só aceita trocar uma posição
--      estimada por um ponto DENTRO do polígono da praia de encontro
--      (GPS de campo de verdade) ou pela correção da mesa
--      (biomonitor_corrigir_localizacao_ninho). Nos dois casos a marca de
--      estimada sai.
--   7. As 6 praias sem polígono (66 ninhos) ficam como estão — quando o
--      polígono for desenhado, rodar de novo
--      `SELECT * FROM bio_distribuir_ninhos_poligono();`
--
-- Aplicada em 3 partes (358 = colunas + trigger, 358b = funções de
-- distribuir/desfazer, 358c = mapa/correção/view): o MCP do Supabase
-- expirava com tudo junto. Execução: as três só têm DDL. A distribuição em si é a
-- chamada da função, rodada à parte (o MCP do Supabase trava em
-- migration com UPDATE de dado — ver CLAUDE.md, migration 356).
-- ═══════════════════════════════════════════════════════════

-- ── 1. Colunas ────────────────────────────────────────────────
ALTER TABLE ninhos_quelonios
  ADD COLUMN IF NOT EXISTS localizacao_estimada     boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS localizacao_estimada_em  timestamptz,
  ADD COLUMN IF NOT EXISTS localizacao_anterior     geometry(Point, 4326),
  ADD COLUMN IF NOT EXISTS precisao_gps_m_anterior  numeric(8,1);

COMMENT ON COLUMN ninhos_quelonios.localizacao_estimada IS
  'true = posição SIMULADA dentro do polígono da praia de encontro (ninho lançado de planilha, sem GPS de campo). Só para visualização — nunca para análise espacial.';
COMMENT ON COLUMN ninhos_quelonios.localizacao_anterior IS
  'Coordenada que o ninho tinha antes de receber a posição estimada (ex.: GPS do aparelho na hora da digitação).';

-- ── 2. Trigger de proteção da posição estimada ────────────────
CREATE OR REPLACE FUNCTION trg_ninhos_protege_posicao_estimada()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.localizacao IS NOT DISTINCT FROM OLD.localizacao THEN
    RETURN NEW;
  END IF;
  -- a própria distribuição está gravando
  IF current_setting('bio.distribuindo', true) = 'on' THEN
    RETURN NEW;
  END IF;
  IF NOT OLD.localizacao_estimada THEN
    RETURN NEW;
  END IF;

  -- correção explícita na mesa (tela de Validação)
  IF current_setting('bio.loc_manual', true) = 'on' THEN
    NEW.localizacao_estimada := false;
    RETURN NEW;
  END IF;

  -- GPS de campo de verdade: cai dentro da praia de encontro
  IF NEW.localizacao IS NOT NULL AND EXISTS (
       SELECT 1 FROM praias_monitoramento p
        WHERE p.id = NEW.praia_id
          AND p.area_geom IS NOT NULL
          AND ST_Within(NEW.localizacao, ST_MakeValid(p.area_geom))) THEN
    NEW.localizacao_estimada := false;
    RETURN NEW;
  END IF;

  -- qualquer outra coisa (GPS do escritório reenviado pela fila
  -- offline, ponto nulo): mantém a estimativa
  NEW.localizacao    := OLD.localizacao;
  NEW.precisao_gps_m := OLD.precisao_gps_m;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION trg_ninhos_protege_posicao_estimada() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE TRIGGER trg_ninhos_protege_posicao_estimada
  BEFORE UPDATE OF localizacao ON ninhos_quelonios
  FOR EACH ROW EXECUTE FUNCTION trg_ninhos_protege_posicao_estimada();

-- Executado em 09/10/2026: 502 ninhos posicionados em 32 praias,
-- 502/502 dentro do polígono, menor distância entre ninhos 1,50 m;
-- 66 ninhos de 6 praias sem polígono ficaram sem posição.
-- SELECT * FROM bio_distribuir_ninhos_poligono();
