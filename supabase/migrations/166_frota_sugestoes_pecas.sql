-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Frota — sugestões de peças/marcas (autocompletar)
-- Cresce sozinha: toda vez que alguém digita uma descrição/marca
-- nova num item de OS, ela é adicionada aqui (upsert). Começa com
-- uma lista curada de itens comuns — ninguém precisa cadastrar nada.
-- ═══════════════════════════════════════════════════════════

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'tipo_sugestao_frota') THEN
    CREATE TYPE tipo_sugestao_frota AS ENUM ('peca', 'marca');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS frota_sugestoes (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo       tipo_sugestao_frota NOT NULL,
  valor      text NOT NULL,
  uso_count  int NOT NULL DEFAULT 1,
  criado_em  timestamptz DEFAULT now(),
  atualizado_em timestamptz DEFAULT now(),
  UNIQUE (tipo, valor)
);

CREATE INDEX IF NOT EXISTS idx_frota_sugestoes_tipo ON frota_sugestoes (tipo, uso_count DESC);

ALTER TABLE frota_sugestoes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS frota_sugestoes_select ON frota_sugestoes;
CREATE POLICY frota_sugestoes_select ON frota_sugestoes
  FOR SELECT USING (pode_ver('frota'));
DROP POLICY IF EXISTS frota_sugestoes_write ON frota_sugestoes;
CREATE POLICY frota_sugestoes_write ON frota_sugestoes
  FOR ALL USING (pode_editar('frota')) WITH CHECK (pode_editar('frota'));

-- Upsert usado pelo frontend ao salvar um item de OS: incrementa uso
-- se já existir, cria se não existir. SECURITY DEFINER pra não
-- depender da policy de escrita direta (mantém RLS simples).
CREATE OR REPLACE FUNCTION frota_registrar_sugestao(p_tipo tipo_sugestao_frota, p_valor text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF p_valor IS NULL OR btrim(p_valor) = '' THEN RETURN; END IF;
  IF NOT pode_editar('frota') THEN RETURN; END IF;
  INSERT INTO frota_sugestoes (tipo, valor)
  VALUES (p_tipo, btrim(p_valor))
  ON CONFLICT (tipo, valor) DO UPDATE
    SET uso_count = frota_sugestoes.uso_count + 1, atualizado_em = now();
END;
$$;

-- ── Seed: peças comuns de manutenção veicular ────────────────
INSERT INTO frota_sugestoes (tipo, valor) VALUES
  ('peca','Óleo do motor'), ('peca','Filtro de óleo'), ('peca','Filtro de ar'),
  ('peca','Filtro de combustível'), ('peca','Filtro de cabine'), ('peca','Filtro de câmbio'),
  ('peca','Pastilha de freio dianteira'), ('peca','Pastilha de freio traseira'),
  ('peca','Disco de freio dianteiro'), ('peca','Disco de freio traseiro'),
  ('peca','Fluido de freio (DOT)'), ('peca','Lona de freio'), ('peca','Cilindro de freio'),
  ('peca','Correia dentada'), ('peca','Correia do alternador'), ('peca','Correia poly-V'),
  ('peca','Tensor da correia'), ('peca','Vela de ignição'), ('peca','Cabo de vela'),
  ('peca','Bobina de ignição'), ('peca','Bateria'), ('peca','Alternador'), ('peca','Motor de partida'),
  ('peca','Amortecedor dianteiro'), ('peca','Amortecedor traseiro'), ('peca','Batente de amortecedor'),
  ('peca','Kit de embreagem'), ('peca','Disco de embreagem'), ('peca','Rolamento de roda'),
  ('peca','Pneu'), ('peca','Câmara de ar'), ('peca','Balanceamento'), ('peca','Alinhamento'),
  ('peca','Óleo de câmbio'), ('peca','Óleo de diferencial'), ('peca','Junta homocinética'),
  ('peca','Radiador'), ('peca','Bomba d''água'), ('peca','Válvula termostática'),
  ('peca','Mangueira do radiador'), ('peca','Aditivo/fluido de arrefecimento'),
  ('peca','Bico injetor'), ('peca','Bomba de combustível'), ('peca','Sensor de oxigênio (sonda lambda)'),
  ('peca','Lâmpada farol'), ('peca','Lâmpada seta/lanterna'), ('peca','Palheta do limpador'),
  ('peca','Parabrisa'), ('peca','Retrovisor'), ('peca','Bateria 12V'), ('peca','Correia do ar-condicionado'),
  ('peca','Compressor do ar-condicionado'), ('peca','Filtro do ar-condicionado'),
  ('peca','Revisão geral'), ('peca','Troca de óleo e filtros'), ('peca','Cabo do acelerador'),
  ('peca','Escapamento/silencioso'), ('peca','Catalisador'), ('peca','Bucha de suspensão'),
  ('peca','Terminal de direção'), ('peca','Caixa de direção'), ('peca','Bomba de direção hidráulica'),
  ('peca','Óleo de direção hidráulica'), ('peca','Mola de suspensão'), ('peca','Barra estabilizadora')
ON CONFLICT (tipo, valor) DO NOTHING;

-- ── Seed: marcas comuns de peças (Brasil) ────────────────────
INSERT INTO frota_sugestoes (tipo, valor) VALUES
  ('marca','Bosch'), ('marca','NGK'), ('marca','Fras-le'), ('marca','Cofap'),
  ('marca','Nakata'), ('marca','Mahle'), ('marca','Mann Filter'), ('marca','Tecfil'),
  ('marca','Continental'), ('marca','Michelin'), ('marca','Pirelli'), ('marca','Goodyear'),
  ('marca','Firestone'), ('marca','Valeo'), ('marca','SKF'), ('marca','Delphi'),
  ('marca','Denso'), ('marca','Magneti Marelli'), ('marca','Varta'), ('marca','Moura'),
  ('marca','Heliar'), ('marca','ZF'), ('marca','TRW'), ('marca','Original (montadora)'),
  ('marca','Sem marca definida')
ON CONFLICT (tipo, valor) DO NOTHING;
