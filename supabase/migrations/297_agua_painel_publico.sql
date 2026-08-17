-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Qualidade da Água — painel público (link para o site da SEMA)
--
-- pages/agua-publico.html reproduz o MESMO painel de
-- pages/agua-relatorios.html (js/agua-painel.js, compartilhado — ver
-- cabeçalho daquele arquivo), sem login, para publicar como link no
-- site institucional da SEMA. `anon` JÁ TEM GRANT de tabela em tudo
-- (padrão do Supabase) — a única coisa que hoje impede leitura pública
-- é a RLS de `agua_coletas`/`agua_pontos_coleta`
-- (`pode_ver('agua')`, que desde a 281 exige lotação). Amarrar a
-- página pública a essa RLS seria "afrouxar até funcionar" — o
-- caminho errado. Em vez disso, três funções SECURITY DEFINER, cada
-- uma devolvendo uma LISTA EXPLÍCITA de colunas (nunca `SELECT *`,
-- nunca a view interna `vw_agua_coletas_detalhe`): o que não está na
-- lista não pode vazar por descuido futuro. Mesmo padrão de
-- `buscar_aap_por_token`/`car_buscar_local` — RPC como portão, não RLS
-- afrouxada.
--
-- FICA FORA de propósito (dado do SERVIDOR que coletou, não do rio):
-- coletor_id, coletor_nome, criado_por, localizacao/lat/lng do
-- aparelho, gps_confirmacao, foto_url, laudo_url, observacoes,
-- quarentena_motivo, exclusao_justificativa, linha_origem_planilha,
-- laboratorio_id. Nenhuma dessas colunas entra no RETURNS TABLE —
-- não é um WHERE escondendo, é ausência de coluna.
--
-- Quarentena ENTRA (decisão do usuário — sem isso a série de 2022 em
-- diante fica quase vazia no público): vem com `status`, e o painel
-- (js/agua-painel.js) já marca "dado preliminar, pendente de
-- conferência humana" — mesma regra que a tela interna já segue.
--
-- `agua_conama_violacoes` teve EXECUTE revogado de `anon` na 252b (lê
-- `agua_limites_conama`, não é pura) — chamá-la de DENTRO de uma
-- função SECURITY DEFINER não precisa desse grant: dentro do corpo da
-- função, current_user é o DONO (mesmo mecanismo que já sustenta
-- is_chefe_brigada()/nivel_efetivo() nas RLS deste projeto), então o
-- REVOKE de anon continua valendo para chamada DIRETA da função, só
-- não se aplica aqui dentro.

-- ── 1. Coletas (painel + PDF/PPTX por bacia) ──────────────────
CREATE OR REPLACE FUNCTION agua_publico_coletas()
RETURNS TABLE (
  ponto_id        uuid,
  ponto_nome      text,
  codigo_ana      text,
  ponto_municipio text,
  ponto_rio       text,
  ponto_bacia     text,
  campanha_id     uuid,
  campanha_ano    int,
  campanha_ordem  ordem_campanha_agua,
  data_coleta     date,
  status          status_coleta_agua,
  iqa             numeric,
  iqa_faixa       text,
  conama_violacoes text[]
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT
    p.id, p.nome, p.codigo_ana, p.municipio, p.rio, p.bacia,
    c.campanha_id, ca.ano, ca.ordem,
    c.data_coleta, c.status,
    agua_calcular_iqa(
      agua_od_saturacao(c.od, c.temp_amostra), c.coliformes_termotolerantes, c.ph, c.dbo,
      c.nitrogenio_total, c.fosforo_total,
      CASE WHEN c.temp_ar IS NOT NULL AND c.temp_amostra IS NOT NULL
           THEN abs(c.temp_amostra - c.temp_ar) ELSE NULL::numeric END,
      c.turbidez,
      CASE WHEN c.solidos_dissolvidos_totais IS NOT NULL OR c.solidos_suspensao_totais IS NOT NULL
           THEN COALESCE(c.solidos_dissolvidos_totais,0) + COALESCE(c.solidos_suspensao_totais,0)
           ELSE NULL::numeric END
    ) AS iqa,
    agua_iqa_faixa(agua_calcular_iqa(
      agua_od_saturacao(c.od, c.temp_amostra), c.coliformes_termotolerantes, c.ph, c.dbo,
      c.nitrogenio_total, c.fosforo_total,
      CASE WHEN c.temp_ar IS NOT NULL AND c.temp_amostra IS NOT NULL
           THEN abs(c.temp_amostra - c.temp_ar) ELSE NULL::numeric END,
      c.turbidez,
      CASE WHEN c.solidos_dissolvidos_totais IS NOT NULL OR c.solidos_suspensao_totais IS NOT NULL
           THEN COALESCE(c.solidos_dissolvidos_totais,0) + COALESCE(c.solidos_suspensao_totais,0)
           ELSE NULL::numeric END
    )) AS iqa_faixa,
    agua_conama_violacoes(p.classe_enquadramento, c.od, c.dbo, c.turbidez,
                           c.coliformes_termotolerantes, c.ph, c.fosforo_total) AS conama_violacoes
  FROM agua_coletas c
  JOIN agua_pontos_coleta p ON p.id = c.ponto_id
  JOIN agua_campanhas    ca ON ca.id = c.campanha_id
  WHERE c.excluido_em IS NULL AND p.ativo = true
  ORDER BY c.data_coleta;
$$;

COMMENT ON FUNCTION agua_publico_coletas() IS
  'Painel público da Qualidade da Água (pages/agua-publico.html, sem login). Mesmas colunas que js/agua-painel.js consome de vw_agua_coletas_detalhe — nunca coletor/GPS/foto/laudo/observações. IQA e CONAMA calculados pelas MESMAS funções da view interna (agua_calcular_iqa/agua_conama_violacoes), nunca reimplementados.';

-- ── 2. Pontos de coleta (mapa) ─────────────────────────────────
-- Devolve lat/lng já extraídos (ST_Y/ST_X), não o geom bruto — a
-- página pública não precisa carregar js/mapa-recorte.js só para
-- fazer o que a própria função já faz no banco.
CREATE OR REPLACE FUNCTION agua_publico_pontos()
RETURNS TABLE (id uuid, nome text, lat double precision, lng double precision)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT id, nome, ST_Y(geom), ST_X(geom)
  FROM agua_pontos_coleta
  WHERE ativo = true;
$$;

COMMENT ON FUNCTION agua_publico_pontos() IS
  'Pontos de coleta (id/nome/lat/lng) para o mapa do painel público — sem RLS por lotação, mesmo espírito de agua_publico_coletas().';

-- ── 3. Cabeçalho institucional (timbre do PDF/PPTX) ────────────
-- `config_sistema` está atrás de `pode_ver`/`pode_editar` desde a 268
-- — anon não lê a tabela. Devolve só o subconjunto que
-- js/relatorio-cabecalho-pdf.js e js/agua-relatorio-pptx.js usam
-- (mesmas chaves de getCabecalhoRelatorio(), js/config-sistema.js).
-- Sem protocolo: `gerar_protocolo_relatorio()` incrementa uma
-- sequência institucional compartilhada por TODOS os relatórios do
-- sistema — não é apropriado deixar `anon` incrementá-la a cada
-- exportação pública. O rodapé do PDF/PPTX público usa um texto fixo,
-- nunca essa RPC.
CREATE OR REPLACE FUNCTION agua_publico_cabecalho()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'secretaria',   COALESCE(dados->'secretaria'->>'nome',   'Secretaria de Estado do Meio Ambiente do Acre'),
    'siglaSecr',    COALESCE(dados->'secretaria'->>'sigla',  'SEMA-AC'),
    'diretoria',    COALESCE(dados->'diretoria'->>'nome',    'Diretoria de Meio Ambiente'),
    'siglaDiret',   COALESCE(dados->'diretoria'->>'sigla',   'DIMA'),
    'departamento', COALESCE(dados->'departamento'->>'nome', 'Departamento de Unidades de Conservação'),
    'logoGoverno',  dados->'logos'->>'governo_url',
    'logoSecr',     dados->'logos'->>'secretaria_url'
  )
  FROM config_sistema WHERE id = 1;
$$;

COMMENT ON FUNCTION agua_publico_cabecalho() IS
  'Timbre institucional (logos + nomes) para o PDF/PPTX do painel público — mesmas chaves de getCabecalhoRelatorio(), sem endereço/telefone/e-mail/responsáveis técnicos (não usados pelo timbre) e sem protocolo (ver comentário da função).';

-- ── 4. Permissões ───────────────────────────────────────────────
-- `ALTER DEFAULT PRIVILEGES` do projeto concede EXECUTE a `anon` por
-- NOME em toda função nova do schema public — REVOKE explícito antes
-- do GRANT, mesma lição das migrations 165/249/252b, só para deixar a
-- intenção auditável (o comportamento seria o mesmo sem o REVOKE).
REVOKE ALL ON FUNCTION agua_publico_coletas()   FROM PUBLIC;
REVOKE ALL ON FUNCTION agua_publico_pontos()    FROM PUBLIC;
REVOKE ALL ON FUNCTION agua_publico_cabecalho() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION agua_publico_coletas()   TO anon, authenticated;
GRANT EXECUTE ON FUNCTION agua_publico_pontos()    TO anon, authenticated;
GRANT EXECUTE ON FUNCTION agua_publico_cabecalho() TO anon, authenticated;
