-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Frota — fotos no comunicado de defeito (até 5, definido
-- no cliente/frota-app.html)
--
-- frota_reportar_defeito (193) ganha p_fotos_urls — precisa do DROP
-- explícito da assinatura antiga, senão CREATE OR REPLACE cria um
-- overload ambíguo em vez de substituir (mesmo cuidado das 173/176/192).
-- ═══════════════════════════════════════════════════════════

ALTER TABLE frota_comunicados_manutencao
  ADD COLUMN IF NOT EXISTS fotos_urls text[];

DROP FUNCTION IF EXISTS frota_reportar_defeito(uuid, text, uuid, uuid);
CREATE OR REPLACE FUNCTION frota_reportar_defeito(
  p_veiculo_id uuid,
  p_descricao text,
  p_viagem_id uuid DEFAULT NULL,
  p_uuid_cliente uuid DEFAULT NULL,
  p_fotos_urls text[] DEFAULT NULL
)
RETURNS frota_comunicados_manutencao
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_motorista_id uuid;
  v_motorista_nome text;
  v_placa        text;
  v_comunicado   frota_comunicados_manutencao;
  r              record;
BEGIN
  IF p_uuid_cliente IS NOT NULL THEN
    SELECT * INTO v_comunicado FROM frota_comunicados_manutencao WHERE uuid_cliente = p_uuid_cliente;
    IF FOUND THEN
      RETURN v_comunicado;
    END IF;
  END IF;

  SELECT id, nome INTO v_motorista_id, v_motorista_nome
    FROM frota_motoristas WHERE usuario_id = auth.uid() AND ativo AND status = 'ativo';
  IF v_motorista_id IS NULL THEN
    RAISE EXCEPTION 'Usuário não está cadastrado como motorista ativo';
  END IF;

  IF NULLIF(TRIM(p_descricao), '') IS NULL THEN
    RAISE EXCEPTION 'Descreva o defeito antes de enviar';
  END IF;

  IF p_fotos_urls IS NOT NULL AND array_length(p_fotos_urls, 1) > 5 THEN
    RAISE EXCEPTION 'No máximo 5 fotos por comunicado';
  END IF;

  SELECT placa INTO v_placa FROM frota_veiculos WHERE id = p_veiculo_id;
  IF v_placa IS NULL THEN
    RAISE EXCEPTION 'Veículo não encontrado';
  END IF;

  BEGIN
    INSERT INTO frota_comunicados_manutencao (veiculo_id, motorista_id, viagem_id, descricao, uuid_cliente, fotos_urls)
    VALUES (p_veiculo_id, v_motorista_id, p_viagem_id, TRIM(p_descricao), p_uuid_cliente, p_fotos_urls)
    RETURNING * INTO v_comunicado;
  EXCEPTION WHEN unique_violation THEN
    SELECT * INTO v_comunicado FROM frota_comunicados_manutencao WHERE uuid_cliente = p_uuid_cliente;
    IF FOUND THEN
      RETURN v_comunicado;
    END IF;
    RAISE;
  END;

  FOR r IN SELECT id FROM usuarios WHERE ativo AND nivel_efetivo(id, 'frota') = 'editar' LOOP
    PERFORM frota_notificar(
      r.id,
      'Defeito reportado',
      format('%s reportou um defeito no veículo %s.', v_motorista_nome, v_placa),
      jsonb_build_object('modulo','frota','subtipo','defeito','comunicado_id',v_comunicado.id,'para','chefe')
    );
  END LOOP;

  RETURN v_comunicado;
END;
$$;

REVOKE ALL ON FUNCTION frota_reportar_defeito(uuid, text, uuid, uuid, text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION frota_reportar_defeito(uuid, text, uuid, uuid, text[]) TO authenticated;

-- ── Bucket de fotos do comunicado (motorista faz upload das suas
-- próprias; gestão lê tudo via pode_ver) — mesmo molde da 175 ───
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('frota-manutencao', 'frota-manutencao', true, 5242880,
  ARRAY['image/jpeg','image/jpg','image/png','image/webp','image/heic','image/heif'])
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS frota_manut_fotos_read ON storage.objects;
CREATE POLICY frota_manut_fotos_read ON storage.objects
  FOR SELECT USING (bucket_id = 'frota-manutencao');

DROP POLICY IF EXISTS frota_manut_fotos_insert ON storage.objects;
CREATE POLICY frota_manut_fotos_insert ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'frota-manutencao'
    AND (
      pode_editar('frota')
      OR EXISTS (SELECT 1 FROM frota_motoristas fm WHERE fm.usuario_id = auth.uid() AND fm.ativo)
    )
  );

DROP POLICY IF EXISTS frota_manut_fotos_update ON storage.objects;
CREATE POLICY frota_manut_fotos_update ON storage.objects
  FOR UPDATE USING (bucket_id = 'frota-manutencao' AND pode_editar('frota'));

DROP POLICY IF EXISTS frota_manut_fotos_delete ON storage.objects;
CREATE POLICY frota_manut_fotos_delete ON storage.objects
  FOR DELETE USING (bucket_id = 'frota-manutencao' AND pode_editar('frota'));
