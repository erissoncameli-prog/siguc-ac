-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Biomonitor — Número do ninho na praia ATUAL
-- ───────────────────────────────────────────────────────────
-- Um ninho carrega DOIS números:
--   numero_ninho  = placa de ORIGEM (onde desovou). Identidade,
--                   imutável. Já existia.
--   numero_atual  = placa onde está incubando AGORA. Muda a cada
--                   transferência, seguindo a sequência da praia de
--                   destino — porque a praia receptora (experimental/
--                   berçário) recebe ninhos de várias origens e o
--                   número de origem pode já estar ocupado lá.
--
-- Sem isto, dois ninhos de origens diferentes podiam ficar com a
-- mesma placa física no mesmo berçário (ex.: dois "005").
-- Depende de 080_transferencia_entre_praias e 079_praias_sigla.
-- ═══════════════════════════════════════════════════════════

-- ── 1. Coluna nova no ninho ──────────────────────────────────
ALTER TABLE ninhos_quelonios
  ADD COLUMN IF NOT EXISTS numero_atual text;

COMMENT ON COLUMN ninhos_quelonios.numero_atual IS
  'Placa do ninho na praia onde incuba agora (praia_atual_id). '
  'Igual a numero_ninho enquanto não houver transferência.';

-- Backfill base: todo ninho começa com a própria placa de origem.
UPDATE ninhos_quelonios
   SET numero_atual = numero_ninho
 WHERE numero_atual IS NULL;

-- ── 2. Renumera os ninhos JÁ transferidos ────────────────────
-- Ninhos que já estão numa praia diferente da origem recebem agora
-- uma placa da sequência do destino (sigla_destino-sigla_especie-NNN),
-- continuando após o maior número já usado pelos ninhos próprios do
-- destino para a mesma espécie.
WITH esp(especie, sig) AS (
  VALUES
    ('tracaja','TR'), ('tartaruga','TA'), ('cabecudo','R'),
    ('pitiU','C'), ('cupido','CP'), ('mucua','M'),
    ('jabuti_pe_elefante','JP'), ('jabuti_piranga','JP'), ('outro','OUT')
),
transf AS (
  SELECT n.id, n.especie, n.data_encontro, n.criado_em,
         n.praia_atual_id,
         COALESCE(p.sigla, 'XX') AS dest_sigla,
         COALESCE(e.sig, 'XX')   AS esp_sig
    FROM ninhos_quelonios n
    JOIN praias_monitoramento p ON p.id = n.praia_atual_id
    LEFT JOIN esp e ON e.especie = n.especie::text
   WHERE n.praia_atual_id IS DISTINCT FROM n.praia_id
),
base AS (
  -- maior sufixo já usado no destino pelos ninhos PRÓPRIOS de lá
  SELECT t.praia_atual_id, t.especie,
         COALESCE(MAX((regexp_replace(x.numero_atual, '^.*-', ''))::int), 0) AS base_seq
    FROM transf t
    JOIN ninhos_quelonios x
      ON x.praia_atual_id = t.praia_atual_id
     AND x.especie        = t.especie
     AND x.praia_atual_id IS NOT DISTINCT FROM x.praia_id
     AND x.numero_atual ~ ('^' || t.dest_sigla || '-' || t.esp_sig || '-[0-9]+$')
   GROUP BY t.praia_atual_id, t.especie
),
seq AS (
  SELECT t.id, t.dest_sigla, t.esp_sig,
         COALESCE(b.base_seq, 0)
           + ROW_NUMBER() OVER (PARTITION BY t.praia_atual_id, t.especie
                                ORDER BY t.data_encontro, t.criado_em) AS novo_seq
    FROM transf t
    LEFT JOIN base b
      ON b.praia_atual_id = t.praia_atual_id AND b.especie = t.especie
)
UPDATE ninhos_quelonios n
   SET numero_atual = s.dest_sigla || '-' || s.esp_sig || '-' || lpad(s.novo_seq::text, 3, '0')
  FROM seq s
 WHERE s.id = n.id;

CREATE INDEX IF NOT EXISTS idx_ninhos_numero_atual
  ON ninhos_quelonios (praia_atual_id, numero_atual);

-- ── 3. Coluna na transferência (placa atribuída no destino) ──
ALTER TABLE transferencias_ninho
  ADD COLUMN IF NOT EXISTS numero_atual text;

COMMENT ON COLUMN transferencias_ninho.numero_atual IS
  'Placa que o ninho passou a ter na praia de destino desta transferência.';

-- ── 4. Default de numero_atual no INSERT do ninho ────────────
-- (substitui a versão de 082, que só preenchia praia_atual_id)
CREATE OR REPLACE FUNCTION trg_ninhos_default_praia_atual()
RETURNS trigger
LANGUAGE plpgsql SET search_path = public
AS $$
BEGIN
  IF NEW.praia_atual_id IS NULL THEN
    NEW.praia_atual_id := NEW.praia_id;
  END IF;
  IF NEW.numero_atual IS NULL THEN
    NEW.numero_atual := NEW.numero_ninho;
  END IF;
  RETURN NEW;
END;
$$;

-- ── 5. Transferência atualiza status + localização + placa ───
-- (substitui a versão de 080, que não tocava em numero_atual)
CREATE OR REPLACE FUNCTION trg_transf_atualizar_status_ninho()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  UPDATE ninhos_quelonios
     SET status = CASE WHEN status = 'encontrado' THEN 'transferido'::status_ninho
                       ELSE status END,
         praia_atual_id = COALESCE(NEW.praia_destino_id, praia_atual_id),
         numero_atual   = COALESCE(NEW.numero_atual, numero_atual),
         atualizado_em  = now()
   WHERE id = NEW.ninho_id;
  RETURN NEW;
END;
$$;

-- ── 6. vw_ninhos_validacao — recria expondo praia atual + placa ──
DROP VIEW IF EXISTS vw_ninhos_validacao;

CREATE VIEW vw_ninhos_validacao
WITH (security_invoker = true)
AS
SELECT
  n.id,
  n.uuid_cliente,
  n.numero_ninho,
  n.numero_atual,
  n.especie,
  n.data_encontro,
  n.status,
  n.status_validacao,
  n.motivo_rejeicao,
  n.observacoes,
  n.foto_urls,
  n.criado_em,
  n.sincronizado_em,
  CASE WHEN n.localizacao IS NOT NULL THEN ST_Y(n.localizacao) END AS lat,
  CASE WHEN n.localizacao IS NOT NULL THEN ST_X(n.localizacao) END AS lng,
  n.precisao_gps_m,
  -- Ovos e distância
  n.qtd_ovos,
  n.qtd_ovos                   AS ninho_qtd_ovos,
  n.ovos_integros,
  n.ovos_descartados,
  n.dist_rio_m,
  n.dist_rio_metodo,
  -- Condições do ninho
  n.temperatura_c,
  n.umidade_pct,
  n.profundidade_cm,
  -- Origem (identidade)
  p.id          AS praia_id,
  p.nome        AS praia_nome,
  p.codigo      AS praia_codigo,
  -- Localização atual (onde incuba agora)
  n.praia_atual_id,
  pa.nome         AS praia_atual_nome,
  pa.sigla        AS praia_atual_sigla,
  pa.experimental AS praia_atual_experimental,
  uc.nome       AS uc_nome,
  mon.id        AS monitor_id,
  mon.nome_completo AS monitor_nome,
  g.nome        AS grupo_nome,
  g.id          AS grupo_id,
  -- Transferência (última)
  t.data_transferencia,
  t.qtd_ovos    AS transf_qtd_ovos,
  t.local_destino,
  -- Eclosão (última)
  e.data_nascimento,
  e.filhotes_vivos,
  e.filhotes_mortos,
  e.ovos_nao_nascidos,
  e.predacao
FROM ninhos_quelonios n
LEFT JOIN praias_monitoramento p       ON p.id = n.praia_id
LEFT JOIN praias_monitoramento pa      ON pa.id = n.praia_atual_id
LEFT JOIN unidades_conservacao uc      ON uc.id = n.uc_id
LEFT JOIN monitores_biodiversidade mon ON mon.id = n.monitor_id
LEFT JOIN grupos_biomonitor g          ON g.id = n.grupo_id
LEFT JOIN LATERAL (
  SELECT data_transferencia, qtd_ovos, local_destino
  FROM transferencias_ninho
  WHERE ninho_id = n.id
  ORDER BY data_transferencia DESC
  LIMIT 1
) t ON true
LEFT JOIN LATERAL (
  SELECT data_nascimento, filhotes_vivos, filhotes_mortos, ovos_nao_nascidos, predacao
  FROM eclosoes_ninho
  WHERE ninho_id = n.id
  ORDER BY data_nascimento DESC
  LIMIT 1
) e ON true;

-- ── 7. vw_transferencias_praia — recria + numero_atual ───────
DROP VIEW IF EXISTS vw_transferencias_praia;

CREATE VIEW vw_transferencias_praia
WITH (security_invoker = true)
AS
SELECT
  t.id,
  t.ninho_id,
  n.numero_ninho,
  t.numero_atual,
  n.especie,
  n.data_encontro,
  n.hora_desova,
  t.data_transferencia,
  t.hora_transferencia,
  t.qtd_ovos,
  t.motivo,
  t.local_destino,
  t.observacoes,
  po.id   AS praia_origem_id,
  po.nome AS praia_origem_nome,
  pd.id   AS praia_destino_id,
  pd.nome AS praia_destino_nome,
  pd.experimental AS destino_experimental,
  mon.nome_completo AS monitor_nome,
  ROUND((EXTRACT(EPOCH FROM (
    (t.data_transferencia + COALESCE(t.hora_transferencia, time '06:00'))
    - (n.data_encontro    + COALESCE(n.hora_desova,        time '06:00'))
  )) / 3600.0)::numeric, 1) AS janela_horas,
  t.criado_em
FROM transferencias_ninho t
JOIN ninhos_quelonios n          ON n.id = t.ninho_id
LEFT JOIN praias_monitoramento po  ON po.id = n.praia_id
LEFT JOIN praias_monitoramento pd  ON pd.id = t.praia_destino_id
LEFT JOIN monitores_biodiversidade mon ON mon.id = t.monitor_id;
