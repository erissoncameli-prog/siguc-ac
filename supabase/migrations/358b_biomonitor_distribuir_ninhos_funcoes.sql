-- SIGUC-AC · Biomonitor — 358b: distribuir/desfazer posição estimada
-- dos ninhos (ver cabeçalho da 358).

-- ── 3. Distribuição ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION bio_distribuir_ninhos_poligono(p_praia_id uuid DEFAULT NULL)
RETURNS TABLE (
  praia_id       uuid,
  praia_nome     text,
  posicionados   int,
  espacamento_m  numeric,
  sem_poligono   boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r        record;
  v_geom   geometry;
  v_inner  geometry;
  v_ids    uuid[];
  v_ja     geometry[];
  v_aceit  geometry[];
  v_novos  geometry[];
  v_cand   geometry;
  v_n      int;
  v_d      numeric;
  v_iter   int;
  v_seed   int;
BEGIN
  PERFORM set_config('bio.distribuindo', 'on', true);

  FOR r IN
    SELECT p.id, p.nome, p.area_geom
      FROM praias_monitoramento p
     WHERE (p_praia_id IS NULL OR p.id = p_praia_id)
       AND EXISTS (SELECT 1 FROM ninhos_quelonios n WHERE n.praia_id = p.id)
     ORDER BY p.nome
  LOOP
    praia_id   := r.id;
    praia_nome := r.nome;

    IF r.area_geom IS NULL OR ST_IsEmpty(r.area_geom) THEN
      posicionados  := 0;
      espacamento_m := NULL;
      sem_poligono  := true;
      RETURN NEXT;
      CONTINUE;
    END IF;

    v_geom := ST_CollectionExtract(ST_MakeValid(r.area_geom), 3);

    SELECT array_agg(n.id ORDER BY n.numero_ninho, n.id) INTO v_ids
      FROM ninhos_quelonios n
     WHERE n.praia_id = r.id
       AND (n.localizacao IS NULL OR NOT ST_Within(n.localizacao, v_geom));
    v_n := coalesce(cardinality(v_ids), 0);

    IF v_n = 0 THEN
      posicionados := 0; espacamento_m := NULL; sem_poligono := false;
      RETURN NEXT;
      CONTINUE;
    END IF;

    -- ninhos que JÁ estão dentro (GPS de campo ou estimados antes) contam
    -- para o espaçamento — o novo nunca cai em cima deles
    SELECT coalesce(array_agg(n.localizacao), '{}') INTO v_ja
      FROM ninhos_quelonios n
     WHERE n.praia_id = r.id
       AND n.localizacao IS NOT NULL
       AND ST_Within(n.localizacao, v_geom);

    -- recuo de 1 m da borda; praia estreita demais usa o polígono inteiro
    v_inner := ST_CollectionExtract(ST_Buffer(v_geom::geography, -1.0)::geometry, 3);
    IF v_inner IS NULL OR ST_IsEmpty(v_inner)
       OR ST_Area(v_inner::geography) < 0.3 * ST_Area(v_geom::geography) THEN
      v_inner := v_geom;
    END IF;

    v_d := LEAST(3.0, GREATEST(0.5,
             0.6 * sqrt(ST_Area(v_inner::geography) / (v_n + cardinality(v_ja)))));

    v_aceit := v_ja;
    v_novos := '{}';
    v_iter  := 0;
    WHILE cardinality(v_novos) < v_n LOOP
      v_iter := v_iter + 1;
      IF v_iter > 80 THEN
        RAISE EXCEPTION 'Praia % não comportou % ninhos sem sobreposição (espaçamento %m)',
          r.nome, v_n, round(v_d, 2);
      END IF;
      v_seed := ((abs(hashtext(r.id::text)::bigint) % 1000000) + v_iter)::int;

      FOR v_cand IN
        SELECT (ST_Dump(ST_GeneratePoints(v_inner, 400, v_seed))).geom
      LOOP
        EXIT WHEN cardinality(v_novos) >= v_n;
        CONTINUE WHEN NOT ST_Within(v_cand, v_geom);
        IF NOT EXISTS (SELECT 1 FROM unnest(v_aceit) a
                        WHERE ST_DistanceSphere(a, v_cand) < v_d) THEN
          v_aceit := v_aceit || ST_SetSRID(v_cand, 4326);
          v_novos := v_novos || ST_SetSRID(v_cand, 4326);
        END IF;
      END LOOP;

      -- a cada 3 rodadas sem completar, afrouxa o espaçamento em 20%
      IF cardinality(v_novos) < v_n AND v_iter % 3 = 0 THEN
        v_d := GREATEST(0.3, v_d * 0.8);
      END IF;
    END LOOP;

    UPDATE ninhos_quelonios n
       SET localizacao_anterior    = CASE WHEN n.localizacao_estimada
                                          THEN n.localizacao_anterior ELSE n.localizacao END,
           precisao_gps_m_anterior = CASE WHEN n.localizacao_estimada
                                          THEN n.precisao_gps_m_anterior ELSE n.precisao_gps_m END,
           localizacao             = u.pt,
           precisao_gps_m          = NULL,
           localizacao_estimada    = true,
           localizacao_estimada_em = now()
      FROM unnest(v_ids, v_novos) AS u(id, pt)
     WHERE n.id = u.id;

    posicionados  := v_n;
    espacamento_m := round(v_d, 2);
    sem_poligono  := false;
    RETURN NEXT;
  END LOOP;
END;
$$;

COMMENT ON FUNCTION bio_distribuir_ninhos_poligono(uuid) IS
  'Posiciona (estimado) dentro do polígono da praia de ENCONTRO todo ninho sem coordenada ou com coordenada fora dela. Idempotente; só roda pelo SQL Editor (sem GRANT).';

REVOKE ALL ON FUNCTION bio_distribuir_ninhos_poligono(uuid) FROM PUBLIC, anon, authenticated;

-- Desfaz: devolve a coordenada anterior aos ninhos estimados.
CREATE OR REPLACE FUNCTION bio_desfazer_posicao_estimada(p_praia_id uuid DEFAULT NULL)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v int;
BEGIN
  PERFORM set_config('bio.distribuindo', 'on', true);
  UPDATE ninhos_quelonios n
     SET localizacao             = n.localizacao_anterior,
         precisao_gps_m          = n.precisao_gps_m_anterior,
         localizacao_anterior    = NULL,
         precisao_gps_m_anterior = NULL,
         localizacao_estimada    = false,
         localizacao_estimada_em = NULL
   WHERE n.localizacao_estimada
     AND (p_praia_id IS NULL OR n.praia_id = p_praia_id);
  GET DIAGNOSTICS v = ROW_COUNT;
  RETURN v;
END;
$$;

REVOKE ALL ON FUNCTION bio_desfazer_posicao_estimada(uuid) FROM PUBLIC, anon, authenticated;
