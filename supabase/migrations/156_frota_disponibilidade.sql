-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Frota — Fase 2b: fotos de veículos + disponibilidade
-- Bucket de fotos + RPC de disponibilidade por período (usada tanto
-- para avisar o solicitante quanto para filtrar o dropdown de
-- aprovação — só mostra veículo realmente livre naquela janela).
-- ═══════════════════════════════════════════════════════════

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('frota-veiculos', 'frota-veiculos', true, 5242880,
  ARRAY['image/jpeg','image/jpg','image/png','image/webp','image/heic','image/heif'])
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS frota_veiculos_fotos_read ON storage.objects;
CREATE POLICY frota_veiculos_fotos_read ON storage.objects
  FOR SELECT USING (bucket_id = 'frota-veiculos');

DROP POLICY IF EXISTS frota_veiculos_fotos_insert ON storage.objects;
CREATE POLICY frota_veiculos_fotos_insert ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'frota-veiculos' AND pode_editar('frota'));

DROP POLICY IF EXISTS frota_veiculos_fotos_update ON storage.objects;
CREATE POLICY frota_veiculos_fotos_update ON storage.objects
  FOR UPDATE USING (bucket_id = 'frota-veiculos' AND pode_editar('frota'));

DROP POLICY IF EXISTS frota_veiculos_fotos_delete ON storage.objects;
CREATE POLICY frota_veiculos_fotos_delete ON storage.objects
  FOR DELETE USING (bucket_id = 'frota-veiculos' AND pode_editar('frota'));

-- Veículos livres num período: ativos, status 'disponivel' e sem viagem
-- aprovada/em andamento cujo período se sobreponha ao solicitado.
-- SECURITY DEFINER: devolve só campos não sensíveis, para poder ser
-- chamada também por quem só tem acesso a 'frota-solicitar' (sem
-- pode_ver('frota')) na hora de avisar sobre indisponibilidade.
CREATE OR REPLACE FUNCTION frota_veiculos_disponiveis(p_inicio timestamptz, p_fim timestamptz)
RETURNS TABLE(id uuid, placa text, modelo text, tipo tipo_veiculo_frota, capacidade_passageiros smallint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT v.id, v.placa, v.modelo, v.tipo, v.capacidade_passageiros
  FROM frota_veiculos v
  WHERE v.ativo AND v.status = 'disponivel'
    AND NOT EXISTS (
      SELECT 1 FROM frota_viagens fv
      WHERE fv.veiculo_id = v.id
        AND fv.status IN ('aprovada','em_andamento')
        AND tstzrange(fv.data_saida_prevista, fv.data_retorno_prevista, '[]')
            && tstzrange(p_inicio, p_fim, '[]')
    )
  ORDER BY v.placa;
$$;
