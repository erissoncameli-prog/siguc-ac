-- ════════════════════════════════════════════════════════════════════════
-- 365 — Diagnóstico Socioeconômico: indicadores, exportação e retenção (Fase 5)
-- ════════════════════════════════════════════════════════════════════════
-- Plano: docs/socioeconomico/plano.md §5 e §10. Tela: aba Indicadores de
-- pages/socio-questionarios.html (js/socio-indicadores.js).
--
--   socio_indicadores(instrumento, campanha?, município?, uc?)
--       quem VÊ o instrumento (inclusive chefia acima e quem tem acesso só a
--       números): contagens por pergunta, montadas da estrutura. Só fichas
--       VALIDADAS e fora do treino. Abaixo de 5 fichas, nada além da contagem
--       (supressão — o recorte por município/UC também obedece).
--   socio_exportar(instrumento, campanha?, identificada)
--       planilha ficha a ficha. Sem identificação: quem lê fichas; o leitor
--       (não gestor) recebe SEM texto livre nem "especifique", que podem
--       trazer nome. Identificada (nome do entrevistado + GPS): só o gestor.
--       Toda chamada grava em socio_exportacoes NA MESMA TRANSAÇÃO.
--   fn_socio_aplicar_retencao()  (cron diário, nunca o cliente)
--       identificação (nome, GPS, colunas de identificação da lista) e fotos
--       saem N meses após a validação ou o descarte (N = retencao_meses do
--       TRAT-021 no ROPA), e 30 dias após o envio no treino. As respostas
--       sem identificação ficam (série histórica). O arquivo da foto entra
--       na fila socio_expurgo_arquivos, drenada pela Edge Function
--       socio-expurgo (o banco não remove arquivo do Storage).
--
-- Apagar aqui = limpar os campos (UPDATE para nulo); nenhuma linha some, e
-- socio_fichas.identificacao_apagada_em registra quando.
-- ════════════════════════════════════════════════════════════════════════

alter table public.socio_fotos add column if not exists arquivo_apagado_em timestamptz;

-- ── registro das exportações ────────────────────────────────────────────
create table if not exists public.socio_exportacoes (
  id             uuid primary key default gen_random_uuid(),
  instrumento_id uuid not null references public.socio_instrumentos(id),
  campanha_id    uuid references public.socio_campanhas(id),
  usuario_id     uuid not null references public.usuarios(id),
  identificada   boolean not null,
  sem_texto      boolean not null,
  n_fichas       int not null,
  criado_em      timestamptz not null default now()
);
create index if not exists idx_socio_export_instr on public.socio_exportacoes (instrumento_id, criado_em desc);
alter table public.socio_exportacoes enable row level security;
revoke all on public.socio_exportacoes from anon, authenticated;
grant select on public.socio_exportacoes to authenticated;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'socio_exportacoes'
                 and policyname = 'socio_exportacoes_select') then
    create policy socio_exportacoes_select on public.socio_exportacoes for select to authenticated
      using (usuario_id = auth.uid() or fn_socio_pode(instrumento_id, 'gerir'));
  end if;
end $$;

-- ── fila de arquivos a remover do Storage ───────────────────────────────
create table if not exists public.socio_expurgo_arquivos (
  id          uuid primary key default gen_random_uuid(),
  bucket      text not null check (bucket = 'socio-fotos'),
  caminho     text not null,
  ficha_id    uuid references public.socio_fichas(id),
  criado_em   timestamptz not null default now(),
  removido_em timestamptz,
  tentativas  int not null default 0,
  erro        text,
  constraint uq_socio_expurgo unique (bucket, caminho)
);
-- só o banco (função) e a Edge Function (service_role) mexem aqui
alter table public.socio_expurgo_arquivos enable row level security;
revoke all on public.socio_expurgo_arquivos from anon, authenticated;

-- ── indicadores ─────────────────────────────────────────────────────────
-- estatística de uma lista de números: média, mediana e quartis. Mínimo e
-- máximo ficam de fora de propósito: o extremo costuma ser UMA casa.
create or replace function public.fn_socio_estat(p_vals numeric[])
returns jsonb language sql immutable set search_path = public as $$
  select case when coalesce(cardinality(p_vals), 0) = 0 then null else (
    select jsonb_build_object(
      'n', count(*), 'media', round(avg(v), 2),
      'q1', round((percentile_cont(0.25) within group (order by v))::numeric, 2),
      'mediana', round((percentile_cont(0.5) within group (order by v))::numeric, 2),
      'q3', round((percentile_cont(0.75) within group (order by v))::numeric, 2))
      from unnest(p_vals) v) end
$$;

create or replace function public.socio_indicadores(
  p_instrumento uuid, p_campanha uuid default null, p_cd_mun text default null, p_uc uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  c_min    constant int := 5;
  v_ids    uuid[];
  v_n      int;
  v_rec    int;
  v_aguard int;
  v_est    jsonb;
  v_versao int;
  v_mun    jsonb;
  v_perg   jsonb := '[]'::jsonb;
  v_lista  jsonb;
  b        jsonb;
  p        jsonb;
  o        jsonb;
  k        text;
  v_ops    jsonb;
  v_item   jsonb;
  v_pres   int;
  v_nr     int;
  v_col    jsonb;
  v_cols   jsonb;
  v_nl     int;
begin
  if not fn_socio_pode_de(auth.uid(), p_instrumento, 'ver') then
    raise exception 'socio:nao_autorizado: sem acesso a este questionário';
  end if;

  select array_agg(f.id) filter (where f.aceitou_participar),
         count(*) filter (where f.aceitou_participar), count(*) filter (where not f.aceitou_participar)
    into v_ids, v_n, v_rec
    from socio_fichas f
   where f.instrumento_id = p_instrumento and not f.treino and f.status = 'validada'
     and (p_campanha is null or f.campanha_id = p_campanha)
     and (p_cd_mun is null or f.cd_mun = p_cd_mun)
     and (p_uc is null or f.uc_id = p_uc);
  v_ids := coalesce(v_ids, '{}');

  select count(*) into v_aguard from socio_fichas f
   where f.instrumento_id = p_instrumento and not f.treino and f.status = 'enviada'
     and (p_campanha is null or f.campanha_id = p_campanha)
     and (p_cd_mun is null or f.cd_mun = p_cd_mun) and (p_uc is null or f.uc_id = p_uc);

  -- municípios: o que tem menos de 5 fichas vai para "outros" (e "outros"
  -- com menos de 5 some — sobra só a contagem total, que já é pública)
  with m as (
    select f.cd_mun, count(*)::int n from socio_fichas f where f.id = any(v_ids) group by f.cd_mun),
  g as (
    select case when n >= c_min then cd_mun end cd, sum(n)::int n from m group by 1)
  select coalesce(jsonb_agg(jsonb_build_object('cd_mun', g.cd, 'nome', coalesce(ma.nome, 'Outros municípios'), 'n', g.n)
                            order by g.cd is null, g.n desc), '[]'::jsonb)
    into v_mun
    from g left join municipios_acre ma on ma.cd_ibge = g.cd
   where g.cd is not null or g.n >= c_min;

  -- estrutura de referência: a versão mais nova entre as fichas do recorte
  -- (mesma chave = mesma pergunta entre versões, como no resto do módulo)
  select q.estrutura, q.versao into v_est, v_versao
    from socio_fichas f join socio_questionarios q on q.id = f.questionario_id
   where f.id = any(v_ids) order by q.versao desc limit 1;

  if v_n < c_min or v_est is null then
    return jsonb_build_object('minimo', c_min, 'suprimido', true, 'n_fichas', v_n, 'n_recusas', v_rec,
      'n_aguardando', v_aguard, 'versao_referencia', v_versao, 'por_municipio', v_mun, 'perguntas', null, 'lista', null);
  end if;

  for b in select value from jsonb_array_elements(coalesce(v_est->'blocos', '[]'::jsonb)) loop
    for p in select value from jsonb_array_elements(coalesce(b->'perguntas', '[]'::jsonb)) loop
      k := p->>'chave';
      continue when p->>'tipo' = 'tabela' or k is null;
      select count(*) filter (where f.respostas ? k), count(*) filter (where f.respostas->>k = '_nr')
        into v_pres, v_nr from socio_fichas f where f.id = any(v_ids);
      v_item := jsonb_build_object('bloco', coalesce(b->>'titulo', b->>'id'), 'chave', k, 'n', p->'n',
        'rotulo', p->'rotulo', 'texto', p->>'texto', 'tipo', p->>'tipo', 'derivada', p ? 'derivada',
        'n_respostas', v_pres - v_nr, 'n_nr', v_nr);
      if p->>'tipo' in ('unica', 'multipla') then
        v_ops := '[]'::jsonb;
        for o in select value from jsonb_array_elements(coalesce(p->'opcoes', '[]'::jsonb)) loop
          v_ops := v_ops || jsonb_build_object('v', o->'v', 'r', o->'r', 'n', (
            select count(*) from socio_fichas f where f.id = any(v_ids)
               and case when p->>'tipo' = 'unica' then f.respostas->>k = o->>'v'
                        else jsonb_typeof(f.respostas->k) = 'array' and (f.respostas->k) ? (o->>'v') end));
        end loop;
        v_item := v_item || jsonb_build_object('opcoes', v_ops);
      elsif p->>'tipo' in ('inteiro', 'decimal') then
        v_item := v_item || jsonb_build_object('estat', fn_socio_estat(array(
          select (f.respostas->>k)::numeric from socio_fichas f
           where f.id = any(v_ids) and jsonb_typeof(f.respostas->k) = 'number')));
      end if;   -- texto livre: só quantos responderam, nunca o conteúdo
      v_perg := v_perg || v_item;
    end loop;
  end loop;

  -- lista (moradores, membros…): só colunas que NÃO são de identificação
  if v_est ? 'lista' then
    select count(*) into v_nl from socio_fichas f, jsonb_array_elements(f.linhas) l where f.id = any(v_ids);
    v_cols := '[]'::jsonb;
    for v_col in select value from jsonb_array_elements(coalesce(v_est->'lista'->'colunas', '[]'::jsonb)) loop
      continue when coalesce((v_col->>'identificacao')::boolean, false) or v_col->>'tipo' = 'texto';
      k := v_col->>'chave';
      v_item := jsonb_build_object('chave', k, 'rotulo', coalesce(v_col->>'rotulo', k), 'tipo', v_col->>'tipo');
      if v_col->>'tipo' = 'unica' then
        v_ops := '[]'::jsonb;
        for o in select value from jsonb_array_elements(coalesce(v_col->'opcoes', '[]'::jsonb)) loop
          v_ops := v_ops || jsonb_build_object('v', o->'v', 'r', o->'r', 'n', (
            select count(*) from socio_fichas f, jsonb_array_elements(f.linhas) l
             where f.id = any(v_ids) and l->>k = o->>'v'));
        end loop;
        v_item := v_item || jsonb_build_object('opcoes', v_ops);
      elsif v_col->>'tipo' = 'booleano' then
        v_item := v_item || jsonb_build_object('opcoes', jsonb_build_array(
          jsonb_build_object('v', true, 'r', 'Sim', 'n', (select count(*) from socio_fichas f, jsonb_array_elements(f.linhas) l
                                                           where f.id = any(v_ids) and l->k = 'true'::jsonb)),
          jsonb_build_object('v', false, 'r', 'Não', 'n', (select count(*) from socio_fichas f, jsonb_array_elements(f.linhas) l
                                                            where f.id = any(v_ids) and l->k = 'false'::jsonb))));
      elsif v_col->>'tipo' = 'inteiro' then
        v_item := v_item || jsonb_build_object('estat', fn_socio_estat(array(
          select (l->>k)::numeric from socio_fichas f, jsonb_array_elements(f.linhas) l
           where f.id = any(v_ids) and jsonb_typeof(l->k) = 'number')));
      end if;
      v_cols := v_cols || v_item;
    end loop;
    v_lista := jsonb_build_object('titulo', coalesce(v_est->'lista'->>'titulo', 'Lista'), 'n_linhas', v_nl, 'colunas', v_cols);
  end if;

  return jsonb_build_object('minimo', c_min, 'suprimido', false, 'n_fichas', v_n, 'n_recusas', v_rec,
    'n_aguardando', v_aguard, 'versao_referencia', v_versao, 'por_municipio', v_mun,
    'perguntas', v_perg, 'lista', v_lista);
end $$;

-- ── exportação ──────────────────────────────────────────────────────────
create or replace function public.socio_exportar(
  p_instrumento uuid, p_campanha uuid default null, p_identificada boolean default false)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_uid     uuid := fn_socio_uid_ativo();
  v_gestor  boolean;
  v_sem_txt boolean;
  v_ident   boolean := coalesce(p_identificada, false);
  v_est     jsonb;
  v_txt     text[];      -- chaves de texto livre (perguntas e colunas da lista)
  v_idcol   text[];      -- colunas de identificação da lista
  v_fichas  jsonb;
  v_linhas  jsonb;
  v_n       int;
  v_id      uuid;
begin
  v_gestor := fn_socio_pode_de(v_uid, p_instrumento, 'gerir');
  if v_ident and not v_gestor then
    raise exception 'socio:nao_autorizado: só o gestor exporta com identificação';
  end if;
  if not (v_gestor or fn_socio_pode_de(v_uid, p_instrumento, 'ler_fichas')) then
    raise exception 'socio:nao_autorizado: sem acesso às fichas deste questionário';
  end if;
  v_sem_txt := not v_gestor;

  -- chaves de texto livre e de identificação em TODAS as versões usadas
  select array_agg(distinct x) into v_txt from (
    select pp->>'chave' x
      from socio_questionarios q, jsonb_array_elements(q.estrutura->'blocos') bb, jsonb_array_elements(bb->'perguntas') pp
     where q.instrumento_id = p_instrumento and pp->>'tipo' in ('texto', 'texto_longo')
    union
    select cc->>'chave' from socio_questionarios q, jsonb_array_elements(coalesce(q.estrutura->'lista'->'colunas', '[]'::jsonb)) cc
     where q.instrumento_id = p_instrumento and cc->>'tipo' = 'texto') s;
  select array_agg(distinct cc->>'chave') into v_idcol
    from socio_questionarios q, jsonb_array_elements(coalesce(q.estrutura->'lista'->'colunas', '[]'::jsonb)) cc
   where q.instrumento_id = p_instrumento and coalesce((cc->>'identificacao')::boolean, false);
  v_txt := coalesce(v_txt, '{}'); v_idcol := coalesce(v_idcol, '{}');

  select q.estrutura into v_est
    from socio_fichas f join socio_questionarios q on q.id = f.questionario_id
   where f.instrumento_id = p_instrumento and not f.treino and f.status = 'validada'
     and (p_campanha is null or f.campanha_id = p_campanha)
   order by q.versao desc limit 1;

  with base as (
    select f.* from socio_fichas f
     where f.instrumento_id = p_instrumento and not f.treino and f.status = 'validada'
       and (p_campanha is null or f.campanha_id = p_campanha))
  select count(*)::int,
         coalesce(jsonb_agg(jsonb_build_object(
           'codigo', b.codigo, 'campanha', c.nome, 'versao', q.versao, 'dt_entrevista', b.dt_entrevista,
           'municipio', m.nome, 'uc', uc.nome, 'comunidade', coalesce(co.nome, b.comunidade_nova),
           'entrevistador', case when v_gestor then u.nome_completo end,
           'aceitou_participar', b.aceitou_participar, 'validado_em', b.validado_em,
           'respostas', case when v_sem_txt then (
               select coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb) from jsonb_each(b.respostas) e
                where not (e.key = any(v_txt)) and e.key not like '%\_outro')
             else b.respostas end,
           'entrevistado_nome', case when v_ident then i.entrevistado_nome end,
           'lat', case when v_ident then i.lat end, 'lon', case when v_ident then i.lon end
         ) order by b.dt_entrevista, b.codigo), '[]'::jsonb)
    into v_n, v_fichas
    from base b
    join socio_questionarios q on q.id = b.questionario_id
    left join socio_campanhas c on c.id = b.campanha_id
    left join municipios_acre m on m.cd_ibge = b.cd_mun
    left join unidades_conservacao uc on uc.id = b.uc_id
    left join socio_comunidades co on co.id = b.comunidade_id
    left join usuarios u on u.id = b.entrevistador_id
    left join socio_fichas_identificacao i on i.ficha_id = b.id;

  -- lista: uma linha por pessoa/item; colunas de identificação só na
  -- exportação identificada, texto livre nunca para o leitor
  select coalesce(jsonb_agg(
           jsonb_build_object('codigo', f.codigo) || (
             select coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb)
               from jsonb_each(l || coalesce((select il from socio_fichas_identificacao i, jsonb_array_elements(i.linhas) il
                                               where v_ident and i.ficha_id = f.id and il->'ordem' = l->'ordem' limit 1), '{}'::jsonb)) e
              where not (v_sem_txt and e.key = any(v_txt)) and (v_ident or not (e.key = any(v_idcol))))
           order by f.codigo, (l->>'ordem')::int), '[]'::jsonb)
    into v_linhas
    from socio_fichas f, jsonb_array_elements(f.linhas) l
   where f.instrumento_id = p_instrumento and not f.treino and f.status = 'validada' and f.aceitou_participar
     and (p_campanha is null or f.campanha_id = p_campanha);

  insert into socio_exportacoes (instrumento_id, campanha_id, usuario_id, identificada, sem_texto, n_fichas)
  values (p_instrumento, p_campanha, v_uid, v_ident, v_sem_txt, v_n) returning id into v_id;

  return jsonb_build_object('exportacao_id', v_id, 'gerado_em', now(), 'identificada', v_ident, 'sem_texto', v_sem_txt,
    'estrutura', v_est, 'n_fichas', v_n, 'fichas', v_fichas, 'linhas', v_linhas,
    'colunas_omitidas', case when v_sem_txt then to_jsonb(v_txt) else '[]'::jsonb end);
end $$;

-- ── retenção ────────────────────────────────────────────────────────────
create or replace function public.fn_socio_aplicar_retencao()
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_meses int;
  v_ids   uuid[];
  v_fotos int;
begin
  select coalesce(t.retencao_meses, 24) into v_meses from lgpd_tratamentos t where t.codigo = 'TRAT-021';
  v_meses := coalesce(v_meses, 24);

  select array_agg(f.id) into v_ids from socio_fichas f
   where f.identificacao_apagada_em is null
     and ((f.treino and f.enviado_em < now() - interval '30 days')
       or (not f.treino and f.status = 'validada' and f.validado_em < now() - make_interval(months => v_meses))
       or (not f.treino and f.status = 'descartada'
           and coalesce(f.descartado_em, f.atualizado_em) < now() - make_interval(months => v_meses)));
  if v_ids is null then return jsonb_build_object('fichas', 0, 'fotos', 0, 'meses', v_meses); end if;

  update socio_fichas_identificacao i
     set entrevistado_nome = null, lat = null, lon = null, gps_precisao_m = null, gps_em = null,
         obs_localizacao = null, linhas = '[]'::jsonb, atualizado_em = now()
   where i.ficha_id = any(v_ids);

  insert into socio_expurgo_arquivos (bucket, caminho, ficha_id)
  select 'socio-fotos',
         regexp_replace(split_part(split_part(ft.arquivo_url, '?', 1), '#', 1), '^.*/storage/v1/object/(public/)?socio-fotos/', ''),
         ft.ficha_id
    from socio_fotos ft
   where ft.ficha_id = any(v_ids) and ft.arquivo_apagado_em is null
  on conflict (bucket, caminho) do nothing;

  update socio_fotos ft set arquivo_apagado_em = now(), legenda = null, lat = null, lon = null, gps_precisao_m = null
   where ft.ficha_id = any(v_ids) and ft.arquivo_apagado_em is null;
  get diagnostics v_fotos = row_count;

  update socio_fichas f set identificacao_apagada_em = now() where f.id = any(v_ids);
  return jsonb_build_object('fichas', cardinality(v_ids), 'fotos', v_fotos, 'meses', v_meses);
end $$;


-- ── 364 revistas: foto apagada pela retenção não aparece mais ───────────
create or replace function public.socio_fichas_lista(
  p_instrumento uuid, p_campanha uuid default null, p_status text default null, p_treino boolean default false)
returns table (id uuid, codigo text, status text, treino boolean, campanha_id uuid, campanha_nome text,
               versao int, dt_entrevista date, enviado_em timestamptz, entrevistador_id uuid, entrevistador_nome text,
               cd_mun text, municipio_nome text, uc_nome text, comunidade_nome text, comunidade_nova text,
               aceitou_participar boolean, n_alertas int, n_pendentes int, n_fotos int,
               usou_carencia boolean, motivo_devolucao text, validado_em timestamptz)
language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
begin
  if not (fn_socio_pode_de(v_uid, p_instrumento, 'ler_fichas') or fn_socio_pode_de(v_uid, p_instrumento, 'gerir')
          or fn_socio_pode_de(v_uid, p_instrumento, 'treinar')) then
    raise exception 'socio:nao_autorizado: sem acesso às fichas deste questionário';
  end if;
  return query
  select f.id, f.codigo, f.status, f.treino, f.campanha_id, c.nome, q.versao, f.dt_entrevista, f.enviado_em,
         f.entrevistador_id, u.nome_completo, f.cd_mun, m.nome, uc.nome, co.nome, f.comunidade_nova,
         f.aceitou_participar, jsonb_array_length(f.alertas),
         (select count(*)::int from jsonb_array_elements(f.alertas) a where a->>'tipo' = 'pendente'),
         (select count(*)::int from socio_fotos ft where ft.ficha_id = f.id and ft.arquivo_apagado_em is null),
         f.usou_carencia, f.motivo_devolucao, f.validado_em
    from socio_fichas f
    join socio_questionarios q on q.id = f.questionario_id
    left join socio_campanhas c on c.id = f.campanha_id
    left join usuarios u on u.id = f.entrevistador_id
    left join municipios_acre m on m.cd_ibge = f.cd_mun
    left join unidades_conservacao uc on uc.id = f.uc_id
    left join socio_comunidades co on co.id = f.comunidade_id
   where f.instrumento_id = p_instrumento
     and (p_campanha is null or f.campanha_id = p_campanha)
     and (p_status is null or f.status = p_status)
     and f.treino = coalesce(p_treino, false)
     and fn_socio_pode_ver_ficha(f.id)
   order by f.enviado_em desc
   limit 2000;
end $$;

create or replace function public.socio_ficha_detalhe(p_ficha uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_f     socio_fichas;
  v_ident boolean;
begin
  select * into v_f from socio_fichas f where f.id = p_ficha;
  if v_f.id is null or not fn_socio_pode_ver_ficha(p_ficha) then
    raise exception 'socio:nao_autorizado: sem acesso a esta ficha';
  end if;
  v_ident := fn_socio_pode_ver_identificacao(p_ficha);
  return jsonb_build_object(
    'ficha', jsonb_build_object(
      'id', v_f.id, 'codigo', v_f.codigo, 'status', v_f.status, 'treino', v_f.treino,
      'instrumento_id', v_f.instrumento_id, 'campanha_id', v_f.campanha_id,
      'cd_mun', v_f.cd_mun, 'uc_id', v_f.uc_id, 'comunidade_id', v_f.comunidade_id, 'comunidade_nova', v_f.comunidade_nova,
      'dt_entrevista', v_f.dt_entrevista, 'iniciada_em', v_f.iniciada_em, 'finalizada_em', v_f.finalizada_em,
      'enviado_em', v_f.enviado_em, 'aviso_lido', v_f.aviso_lido, 'aceitou_participar', v_f.aceitou_participar,
      'fotos_autorizadas', v_f.fotos_autorizadas, 'respostas', v_f.respostas, 'linhas', v_f.linhas,
      'alertas', v_f.alertas, 'motivo_devolucao', v_f.motivo_devolucao, 'validado_em', v_f.validado_em,
      'usou_carencia', v_f.usou_carencia, 'app_versao', v_f.app_versao,
      'identificacao_apagada_em', v_f.identificacao_apagada_em),
    'questionario', (select jsonb_build_object('versao', q.versao, 'estrutura', q.estrutura, 'hash', q.hash_sha256)
                       from socio_questionarios q where q.id = v_f.questionario_id),
    'campanha_nome', (select c.nome from socio_campanhas c where c.id = v_f.campanha_id),
    'municipio_nome', (select m.nome from municipios_acre m where m.cd_ibge = v_f.cd_mun),
    'uc_nome', (select u.nome from unidades_conservacao u where u.id = v_f.uc_id),
    'comunidade_nome', (select c.nome from socio_comunidades c where c.id = v_f.comunidade_id),
    'entrevistador_nome', (select u.nome_completo from usuarios u where u.id = v_f.entrevistador_id),
    'validado_por_nome', (select u.nome_completo from usuarios u where u.id = v_f.validado_por),
    'pode_gerir', fn_socio_pode(v_f.instrumento_id, 'gerir'),
    've_identificacao', v_ident,
    -- identificação e fotos só para quem pode; para os demais, nem a chave
    'identificacao', case when v_ident then (
        select jsonb_build_object('entrevistado_nome', i.entrevistado_nome, 'lat', i.lat, 'lon', i.lon,
                                  'gps_precisao_m', i.gps_precisao_m, 'obs_localizacao', i.obs_localizacao, 'linhas', i.linhas)
          from socio_fichas_identificacao i where i.ficha_id = v_f.id) end,
    'fotos', case when v_ident then coalesce((
        select jsonb_agg(jsonb_build_object('id', ft.id, 'tema', ft.tema, 'legenda', ft.legenda,
                                            'arquivo_url', ft.arquivo_url, 'tirada_em', ft.tirada_em) order by ft.tirada_em)
          from socio_fotos ft where ft.ficha_id = v_f.id and ft.arquivo_apagado_em is null), '[]'::jsonb) end,
    'historico', coalesce((
        select jsonb_agg(jsonb_build_object('status_de', h.status_de, 'status_para', h.status_para, 'motivo', h.motivo,
                                            'por_nome', u.nome_completo, 'em', h.em) order by h.em)
          from socio_fichas_historico h left join usuarios u on u.id = h.por where h.ficha_id = v_f.id), '[]'::jsonb));
end $$;

-- ── permissões ──────────────────────────────────────────────────────────
do $$
declare f text;
begin
  foreach f in array array['socio_indicadores(uuid, uuid, text, uuid)', 'socio_exportar(uuid, uuid, boolean)',
    'socio_fichas_lista(uuid, uuid, text, boolean)', 'socio_ficha_detalhe(uuid)'] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
  -- só o cron (dono postgres) roda a retenção; fn_socio_estat é pura
  revoke execute on function public.fn_socio_aplicar_retencao() from public, anon, authenticated;
  revoke execute on function public.fn_socio_estat(numeric[]) from public, anon;
  grant execute on function public.fn_socio_estat(numeric[]) to authenticated;
end $$;

-- ── agendamento (só onde há pg_cron/pg_net — a base local de teste não tem) ──
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('socio-retencao-diaria', '10 9 * * *', 'select public.fn_socio_aplicar_retencao()');
    if exists (select 1 from pg_extension where extname = 'pg_net') then
      -- a função só drena a fila (idempotente): a chave anon, a mesma dos
      -- outros crons, basta
      perform cron.schedule('socio-expurgo-diario', '25 9 * * *', $c$
        select net.http_post(
          url := 'https://atqtybcsvepdabsvgaly.supabase.co/functions/v1/socio-expurgo',
          headers := jsonb_build_object(
            'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF0cXR5YmNzdmVwZGFic3ZnYWx5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA0MjMzNzgsImV4cCI6MjA5NTk5OTM3OH0.hWx1AB2rK7xdco1Dgagm0XUOBPQbxZVE614SW4SKoLk',
            'Content-Type', 'application/json'),
          body := '{}'::jsonb)
      $c$);
    end if;
  end if;
end $$;
