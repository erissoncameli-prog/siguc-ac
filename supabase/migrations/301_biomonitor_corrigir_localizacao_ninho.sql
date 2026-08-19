-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Biomonitor — corrigir praia/GPS de um ninho já
-- cadastrado (tela de Validação de Ninhos)
-- ───────────────────────────────────────────────────────────
-- Problema real: monitor grava a coordenada pelo Avenza sem estar
-- fisicamente no ninho, e escolhe a praia errada no app (praia_id é
-- um select manual — js/biomonitor-quelonios.js linha 1059 — não tem
-- checagem contra a geometria da praia). Hoje a tela de validação só
-- permite ADICIONAR GPS quando não há nenhum (botão "+ GPS"); não dá
-- para editar coordenada existente nem trocar a praia.
--
-- Isso não é o mesmo que TRANSFERÊNCIA (transferencias_ninho): é
-- correção de cadastro, não um evento físico de mudar os ovos de
-- lugar. Por isso não usa aquele fluxo, que tem sua própria linha do
-- tempo e relatórios.
--
-- numero_ninho embute a sigla da praia (migration 092: "identidade
-- imutável" — mas isso vale para o ciclo normal; aqui é correção de
-- erro de cadastro, então o número É regerado, na sequência da praia
-- certa, mesma lógica de bioGerarNumeroNinho (js/biomonitor-
-- quelonios.js) — mas em SQL, porque quem corrige é a mesa
-- (biomonitor-validacao.html), que não carrega esse arquivo.
--
-- praia_atual_id/numero_atual só têm default no INSERT (082/092) —
-- se o ninho nunca foi de fato transferido (ainda incuba na origem),
-- a correção da origem arrasta os dois junto; se já houve
-- transferência real, eles não são tocados (só a origem estava
-- errada, o destino real continua valendo).
--
-- uc_id (hoje herdado do monitor no INSERT, não da praia) passa a
-- ser realinhado com a praia nova quando ela muda.
-- ═══════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION biomonitor_corrigir_localizacao_ninho(
  p_ninho_id        uuid,
  p_praia_id        uuid,
  p_lat             numeric DEFAULT NULL,
  p_lng             numeric DEFAULT NULL,
  p_precisao_gps_m  numeric DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_ninho        ninhos_quelonios%ROWTYPE;
  v_praia_sigla  text;
  v_uc_id        uuid;
  v_esp_sigla    text;
  v_ano          int;
  v_prefix       text;
  v_max_seq      int;
  v_numero       text;
  v_numero_atual text;
  v_praia_atual  uuid;
  v_loc          geometry;
BEGIN
  SELECT * INTO v_ninho FROM ninhos_quelonios WHERE id = p_ninho_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ninho não encontrado.';
  END IF;

  IF p_lat IS NOT NULL AND p_lng IS NOT NULL THEN
    v_loc := ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326);
  END IF;

  v_numero       := v_ninho.numero_ninho;
  v_numero_atual := v_ninho.numero_atual;
  v_praia_atual  := v_ninho.praia_atual_id;
  v_uc_id        := v_ninho.uc_id;

  IF p_praia_id IS DISTINCT FROM v_ninho.praia_id THEN
    SELECT sigla, uc_id INTO v_praia_sigla, v_uc_id
      FROM praias_monitoramento WHERE id = p_praia_id;
    IF v_praia_sigla IS NULL THEN
      RAISE EXCEPTION 'Praia inválida.';
    END IF;

    SELECT sigla_placa INTO v_esp_sigla
      FROM especies_quelonio_catalogo WHERE codigo = v_ninho.especie;
    v_esp_sigla := COALESCE(v_esp_sigla, '?');

    SELECT tmp.ano_base INTO v_ano
      FROM temporadas_biomonitor tmp WHERE tmp.id = v_ninho.temporada_id;
    v_ano := COALESCE(v_ano, EXTRACT(YEAR FROM v_ninho.data_encontro)::int);

    v_prefix := v_praia_sigla || '-' || v_esp_sigla || '-' || v_ano || '-';

    SELECT COALESCE(MAX(
      COALESCE(NULLIF(regexp_replace(substring(numero_ninho from length(v_prefix) + 1), '\D', '', 'g'), '')::int, 0)
    ), 0)
    INTO v_max_seq
    FROM ninhos_quelonios
    WHERE praia_id = p_praia_id AND numero_ninho LIKE v_prefix || '%';

    v_numero := v_prefix || lpad((v_max_seq + 1)::text, 3, '0');

    -- Só arrasta praia_atual/numero_atual se o ninho ainda estava na
    -- própria origem (nunca foi transferido de verdade).
    IF v_praia_atual = v_ninho.praia_id THEN
      v_praia_atual  := p_praia_id;
      v_numero_atual := v_numero;
    END IF;
  END IF;

  UPDATE ninhos_quelonios
     SET praia_id       = p_praia_id,
         uc_id          = v_uc_id,
         numero_ninho   = v_numero,
         praia_atual_id = v_praia_atual,
         numero_atual   = v_numero_atual,
         localizacao    = COALESCE(v_loc, localizacao),
         precisao_gps_m = COALESCE(p_precisao_gps_m, precisao_gps_m)
   WHERE id = p_ninho_id;

  RETURN v_numero;
END;
$$;

-- Mesmo achado repetido em toda função nova do projeto: o ALTER
-- DEFAULT PRIVILEGES concede EXECUTE a anon por nome. Fecha explícito.
REVOKE ALL ON FUNCTION biomonitor_corrigir_localizacao_ninho(uuid,uuid,numeric,numeric,numeric) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION biomonitor_corrigir_localizacao_ninho(uuid,uuid,numeric,numeric,numeric) FROM anon;
GRANT EXECUTE ON FUNCTION biomonitor_corrigir_localizacao_ninho(uuid,uuid,numeric,numeric,numeric) TO authenticated;
