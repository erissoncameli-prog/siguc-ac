-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Frota — liga/desliga a captura de GPS (regra
-- configurável). Linha única (singleton) editável só por quem edita
-- 'frota' (você e o gestor de transporte); leitura liberada a
-- qualquer autenticado — o app do motorista precisa ler o valor para
-- decidir se captura ou não, mas nunca escreve aqui.
-- Fail-safe: ausência de linha/valor é tratada como true (captura
-- ligada) no lado do app — ver frota-app.html, fmConfigGps().
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS frota_config_gps (
  id                    smallint PRIMARY KEY DEFAULT 1,
  captura_viagens       boolean NOT NULL DEFAULT true,
  captura_abastecimento boolean NOT NULL DEFAULT true,
  atualizado_por        uuid REFERENCES usuarios(id),
  atualizado_em         timestamptz DEFAULT now(),
  CONSTRAINT chk_frota_config_gps_singleton CHECK (id = 1)
);

INSERT INTO frota_config_gps (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- Preenche atualizado_por/em automaticamente (auditoria de quem
-- desligou a captura) — não depende do valor enviado pelo cliente.
CREATE OR REPLACE FUNCTION frota_marcar_atualizador_config_gps()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  NEW.atualizado_por := auth.uid();
  NEW.atualizado_em := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_frota_config_gps_atualizador ON frota_config_gps;
CREATE TRIGGER trg_frota_config_gps_atualizador BEFORE UPDATE ON frota_config_gps
  FOR EACH ROW EXECUTE FUNCTION frota_marcar_atualizador_config_gps();

ALTER TABLE frota_config_gps ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS frota_config_gps_select ON frota_config_gps;
CREATE POLICY frota_config_gps_select ON frota_config_gps
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM usuarios u WHERE u.id = auth.uid() AND u.ativo)
  );

DROP POLICY IF EXISTS frota_config_gps_update ON frota_config_gps;
CREATE POLICY frota_config_gps_update ON frota_config_gps
  FOR UPDATE USING (pode_editar('frota')) WITH CHECK (pode_editar('frota'));

-- Sem INSERT/DELETE via API: linha única já semeada acima; RLS não
-- libera essas operações para ninguém (nem pode_editar), então a
-- linha nunca pode ser duplicada ou apagada pelo cliente.
