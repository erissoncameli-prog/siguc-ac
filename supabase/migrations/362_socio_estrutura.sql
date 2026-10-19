-- ════════════════════════════════════════════════════════════════════════
-- 362 — Diagnóstico Socioeconômico: estrutura e acesso por departamento
-- ════════════════════════════════════════════════════════════════════════
-- Plano: docs/socioeconomico/plano.md (decisões de 18/10/2026).
-- Origem do desenho: Diagnóstico Socioambiental do dima-plataforma. Nenhum
-- dado veio de lá: esta base nasce vazia.
--
--   socio_instrumentos (dono = unidade_org_id, o departamento que pediu)
--     └ socio_questionarios (versão; publicada = imutável)
--         └ socio_campanhas (onde, quando, quem aplica)
--             └ socio_fichas (+ identificação separada, fotos)
--
-- ACESSO — regra própria do módulo, num lugar só: fn_socio_pode_de().
-- Ter conta no SIGUC não dá acesso a instrumento nenhum. Acesso vem de
--   (a) pertencer ao departamento dono (usuario_unidades(): lotação + cargo,
--       com herança para baixo — divisão/núcleo é do departamento);
--   (b) papel designado pelo gestor (gestor | aplicador | leitor), só para
--       quem é do departamento;
--   (c) permissão PEDIDA por alguém de outro departamento e aprovada pelo
--       gestor do dono, sempre com prazo (socio_acessos).
-- Chefia acima do dono (diretoria, secretaria) vê só estrutura e agregados.
-- super_admin administra o catálogo, mas NÃO lê ficha nenhuma sem pedir
-- (decisão de 18/10/2026). Sem lotação nem cargo = sem departamento:
-- nada é aberto "por falta de dado" (sem fail-open, de propósito).
--
-- Escrita: só por RPC SECURITY DEFINER (migration 362c). As tabelas não têm
-- policy de escrita para o cliente — não criar.
-- Nenhuma instrução desta migration remove dado: a lista de moradores mora
-- num jsonb da própria ficha, e a correção de qualquer registro é UPDATE.
-- ════════════════════════════════════════════════════════════════════════

-- ── Utilitários ─────────────────────────────────────────────────────────
create or replace function public.fn_socio_hoje()
returns date language sql stable set search_path = public as $$
  select (now() at time zone 'America/Rio_Branco')::date
$$;

create or replace function public.fn_socio_sha256(p text)
returns text language sql immutable strict set search_path = public as $$
  select encode(sha256(convert_to(p, 'UTF8')), 'hex')
$$;

create or replace function public.fn_socio_touch() returns trigger
language plpgsql set search_path = public as $$
begin
  new.atualizado_em := now();
  return new;
end $$;

-- ── Instrumentos ────────────────────────────────────────────────────────
create table if not exists public.socio_instrumentos (
  id               uuid primary key default gen_random_uuid(),
  -- prefixo do código da ficha (DSA-…, PESCA-…). TRE é do modo treino.
  codigo           text not null constraint uq_socio_instrumentos_codigo unique
                     check (codigo ~ '^[A-Z]{2,10}$' and codigo <> 'TRE'),
  titulo           text not null check (length(btrim(titulo)) between 3 and 200),
  finalidade       text not null check (length(btrim(finalidade)) between 10 and 2000),
  unidade_analise  text not null default 'domicilio'
                     check (unidade_analise in ('domicilio','pessoa','comunidade','estabelecimento')),
  unidade_org_id   uuid not null references public.unidades_organizacionais(id),
  ativo            boolean not null default true,
  criado_por       uuid references public.usuarios(id),
  criado_em        timestamptz not null default now(),
  atualizado_em    timestamptz not null default now()
);
comment on table public.socio_instrumentos is
  'Diagnóstico Socioeconômico: cada questionário. unidade_org_id = departamento DONO; acesso por fn_socio_pode_de(). Não se apaga: arquivar = ativo false.';
create index if not exists idx_socio_instr_unidade on public.socio_instrumentos (unidade_org_id);
create or replace trigger trg_socio_instr_touch before update on public.socio_instrumentos
  for each row execute function public.fn_socio_touch();

-- ── Versões do questionário ─────────────────────────────────────────────
create table if not exists public.socio_questionarios (
  id                  uuid primary key default gen_random_uuid(),
  instrumento_id      uuid not null references public.socio_instrumentos(id),
  versao              integer not null check (versao >= 1),
  estrutura           jsonb not null check (jsonb_typeof(estrutura) = 'object'),
  aviso_entrevistado  text not null check (length(btrim(aviso_entrevistado)) >= 20),
  -- prova de qual versão foi aplicada; não pode divergir do conteúdo
  hash_sha256         text generated always as
                        (public.fn_socio_sha256(estrutura::text || aviso_entrevistado)) stored,
  status              text not null default 'rascunho'
                        check (status in ('rascunho','publicado','arquivado')),
  publicado_em        timestamptz,
  publicado_por       uuid references public.usuarios(id),
  criado_por          uuid references public.usuarios(id),
  criado_em           timestamptz not null default now(),
  atualizado_em       timestamptz not null default now(),
  constraint uq_socio_questionario_versao unique (instrumento_id, versao)
);
create index if not exists idx_socio_quest_instr on public.socio_questionarios (instrumento_id);

create or replace function public.fn_socio_questionario_guarda() returns trigger
language plpgsql set search_path = public as $$
begin
  if old.status <> 'rascunho' then
    if new.estrutura is distinct from old.estrutura
       or new.aviso_entrevistado is distinct from old.aviso_entrevistado
       or new.instrumento_id <> old.instrumento_id or new.versao <> old.versao then
      raise exception 'socio:questionario_publicado: versão publicada é imutável; crie uma nova versão';
    end if;
    if old.status = 'arquivado' and new.status <> 'arquivado' then
      raise exception 'socio:questionario_arquivado: versão arquivada não volta a ser usada';
    end if;
  end if;
  if new.status = 'rascunho' and old.status <> 'rascunho' then
    raise exception 'socio:questionario_publicado: versão publicada não volta a rascunho';
  end if;
  if new.status = 'publicado' and old.status = 'rascunho' then
    new.publicado_em := now();
    new.publicado_por := auth.uid();
  end if;
  new.atualizado_em := now();
  return new;
end $$;
create or replace trigger trg_socio_questionario_guarda before update on public.socio_questionarios
  for each row execute function public.fn_socio_questionario_guarda();

-- ── Papéis dentro do instrumento (só para quem é do departamento) ───────
create table if not exists public.socio_instrumento_membros (
  id              uuid primary key default gen_random_uuid(),
  instrumento_id  uuid not null references public.socio_instrumentos(id),
  usuario_id      uuid not null references public.usuarios(id),
  papel           text not null check (papel in ('gestor','aplicador','leitor')),
  ativo           boolean not null default true,
  designado_por   uuid references public.usuarios(id),
  designado_em    timestamptz not null default now(),
  removido_por    uuid references public.usuarios(id),
  removido_em     timestamptz,
  constraint uq_socio_membro unique (instrumento_id, usuario_id, papel)
);
create index if not exists idx_socio_membros_usuario on public.socio_instrumento_membros (usuario_id) where ativo;

-- ── Pedidos de acesso de outro departamento ─────────────────────────────
create table if not exists public.socio_acessos (
  id              uuid primary key default gen_random_uuid(),
  instrumento_id  uuid not null references public.socio_instrumentos(id),
  usuario_id      uuid not null references public.usuarios(id),
  nivel           text not null check (nivel in ('agregados','leitor','aplicador')),
  justificativa   text not null check (length(btrim(justificativa)) >= 20),
  data_fim        date not null,
  status          text not null default 'pendente'
                    check (status in ('pendente','aprovado','recusado','revogado','cancelado')),
  parecer         text,
  decidido_por    uuid references public.usuarios(id),
  decidido_em     timestamptz,
  encerrado_por   uuid references public.usuarios(id),
  encerrado_em    timestamptz,
  criado_em       timestamptz not null default now(),
  constraint ck_socio_acesso_recusa check (status <> 'recusado' or length(btrim(coalesce(parecer,''))) >= 5)
);
create index if not exists idx_socio_acessos_usuario on public.socio_acessos (usuario_id, instrumento_id);
create unique index if not exists uq_socio_acesso_pendente
  on public.socio_acessos (instrumento_id, usuario_id, nivel) where status = 'pendente';

-- ── Comunidades (cadastro comum a todos os departamentos) ───────────────
create table if not exists public.socio_comunidades (
  id          uuid primary key default gen_random_uuid(),
  nome        text not null check (length(btrim(nome)) between 2 and 150),
  cd_mun      text not null references public.municipios_acre(cd_ibge),
  uc_id       uuid references public.unidades_conservacao(id),
  ativo       boolean not null default true,
  criado_por  uuid references public.usuarios(id),
  criado_em   timestamptz not null default now()
);
create unique index if not exists uq_socio_comunidade_nome
  on public.socio_comunidades (cd_mun, lower(btrim(nome)));

-- ── Campanhas ───────────────────────────────────────────────────────────
create table if not exists public.socio_campanhas (
  id               uuid primary key default gen_random_uuid(),
  instrumento_id   uuid not null references public.socio_instrumentos(id),
  questionario_id  uuid not null references public.socio_questionarios(id),
  nome             text not null check (length(btrim(nome)) between 3 and 150),
  inicio           date not null,
  fim              date not null,
  situacao         text not null default 'planejada'
                     check (situacao in ('planejada','aberta','encerrada')),
  -- território: UC opcional (decisão de 18/10/2026); cada campanha decide
  exige_municipio  boolean not null default true,
  exige_uc         boolean not null default false,
  municipios       text[] not null default '{}',   -- vazio = qualquer município
  ucs              uuid[] not null default '{}',   -- vazio = qualquer UC
  criado_por       uuid references public.usuarios(id),
  criado_em        timestamptz not null default now(),
  atualizado_em    timestamptz not null default now(),
  constraint ck_socio_campanha_periodo check (fim >= inicio)
);
create index if not exists idx_socio_camp_instr on public.socio_campanhas (instrumento_id);
create or replace trigger trg_socio_camp_touch before update on public.socio_campanhas
  for each row execute function public.fn_socio_touch();

create table if not exists public.socio_campanha_aplicadores (
  campanha_id   uuid not null references public.socio_campanhas(id),
  usuario_id    uuid not null references public.usuarios(id),
  ativo         boolean not null default true,
  incluido_por  uuid references public.usuarios(id),
  incluido_em   timestamptz not null default now(),
  primary key (campanha_id, usuario_id)
);

-- ── Fichas ──────────────────────────────────────────────────────────────
create table if not exists public.socio_fichas (
  id                 uuid primary key default gen_random_uuid(),
  -- idempotência da fila: UNIQUE CONSTRAINT (índice parcial não serve ao
  -- ON CONFLICT do PostgREST — lição da 257b)
  uuid_cliente       uuid not null constraint uq_socio_fichas_uuid_cliente unique,
  codigo             text not null constraint uq_socio_fichas_codigo unique
                       check (length(codigo) between 5 and 40),
  instrumento_id     uuid not null references public.socio_instrumentos(id),
  questionario_id    uuid not null references public.socio_questionarios(id),
  campanha_id        uuid references public.socio_campanhas(id),   -- nulo só no treino
  treino             boolean not null default false,
  cd_mun             text references public.municipios_acre(cd_ibge),
  uc_id              uuid references public.unidades_conservacao(id),
  comunidade_id      uuid references public.socio_comunidades(id),
  comunidade_nova    text check (comunidade_nova is null or length(btrim(comunidade_nova)) between 2 and 150),
  dt_entrevista      date not null,
  iniciada_em        timestamptz,
  finalizada_em      timestamptz not null,
  entrevistador_id   uuid not null references public.usuarios(id),
  aviso_lido         boolean not null,
  aceitou_participar boolean not null,
  fotos_autorizadas  boolean,
  respostas          jsonb not null default '{}'::jsonb check (jsonb_typeof(respostas) = 'object'),
  -- lista da ficha (moradores, membros…) SEM as colunas de identificação
  linhas             jsonb not null default '[]'::jsonb check (jsonb_typeof(linhas) = 'array'),
  alertas            jsonb not null default '[]'::jsonb check (jsonb_typeof(alertas) = 'array'),
  status             text not null default 'enviada'
                       check (status in ('enviada','devolvida','validada','descartada')),
  motivo_devolucao   text,
  validado_por       uuid references public.usuarios(id),
  validado_em        timestamptz,
  descartado_em      timestamptz,
  usou_carencia      boolean not null default false,
  identificacao_apagada_em timestamptz,
  app_versao         text,
  dispositivo_id     text,
  enviado_em         timestamptz not null default now(),
  criado_em          timestamptz not null default now(),
  atualizado_em      timestamptz not null default now(),
  constraint ck_socio_ficha_campanha check (treino or campanha_id is not null),
  constraint ck_socio_ficha_recusa check (aceitou_participar or (respostas = '{}'::jsonb and linhas = '[]'::jsonb)),
  constraint ck_socio_ficha_validada check (status <> 'validada' or validado_em is not null),
  constraint ck_socio_ficha_devolvida check (status <> 'devolvida' or motivo_devolucao is not null)
);
create index if not exists idx_socio_fichas_instr on public.socio_fichas (instrumento_id);
create index if not exists idx_socio_fichas_campanha on public.socio_fichas (campanha_id);
create index if not exists idx_socio_fichas_entrevistador on public.socio_fichas (entrevistador_id);
create or replace trigger trg_socio_fichas_touch before update on public.socio_fichas
  for each row execute function public.fn_socio_touch();

-- identificação: nome do entrevistado (se o instrumento pedir), GPS da
-- casa e as colunas de identificação da lista. Gestor e o próprio
-- entrevistador leem; leitor e quem veio de outro departamento, nunca.
create table if not exists public.socio_fichas_identificacao (
  ficha_id           uuid primary key references public.socio_fichas(id),
  entrevistado_nome  text check (entrevistado_nome is null or length(entrevistado_nome) <= 150),
  lat                numeric(9,6) check (lat is null or lat between -90 and 90),
  lon                numeric(9,6) check (lon is null or lon between -180 and 180),
  gps_precisao_m     numeric,
  gps_em             timestamptz,
  obs_localizacao    text check (obs_localizacao is null or length(obs_localizacao) <= 500),
  linhas             jsonb not null default '[]'::jsonb check (jsonb_typeof(linhas) = 'array'),
  atualizado_em      timestamptz not null default now()
);

create table if not exists public.socio_fotos (
  id              uuid primary key default gen_random_uuid(),
  ficha_id        uuid not null references public.socio_fichas(id),
  uuid_cliente    uuid not null constraint uq_socio_fotos_uuid_cliente unique,
  tema            text not null check (tema in ('moradia','infraestrutura','entorno','producao','outro')),
  pergunta_chave  text,
  legenda         text check (legenda is null or length(legenda) <= 300),
  arquivo_url     text not null,
  tirada_em       timestamptz,
  lat             numeric(9,6),
  lon             numeric(9,6),
  gps_precisao_m  numeric,
  criado_por      uuid not null references public.usuarios(id),
  criado_em       timestamptz not null default now()
);
create index if not exists idx_socio_fotos_ficha on public.socio_fotos (ficha_id);

create table if not exists public.socio_fichas_historico (
  id          uuid primary key default gen_random_uuid(),
  ficha_id    uuid not null references public.socio_fichas(id),
  status_de   text,
  status_para text not null,
  motivo      text,
  por         uuid references public.usuarios(id),
  em          timestamptz not null default now()
);
create index if not exists idx_socio_hist_ficha on public.socio_fichas_historico (ficha_id);

create or replace function public.fn_socio_ficha_historico() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    insert into socio_fichas_historico (ficha_id, status_de, status_para, motivo, por)
    values (new.id, case when tg_op = 'UPDATE' then old.status end, new.status,
            nullif(current_setting('socio.motivo', true), ''), auth.uid());
  end if;
  return new;
end $$;
create or replace trigger trg_socio_ficha_historico after insert or update of status on public.socio_fichas
  for each row execute function public.fn_socio_ficha_historico();

-- ════════════════════════════════════════════════════════════════════════
-- ACESSO — fonte única
-- ════════════════════════════════════════════════════════════════════════
-- Pertence ao departamento: lotado/cargo na unidade ou num descendente.
create or replace function public.fn_socio_no_dept(p_uid uuid, p_unidade uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from usuario_unidades(p_uid) u
     where u.unidade_org_id = p_unidade
        or u.unidade_org_id in (select d.unidade_org_id from unidade_descendentes(p_unidade) d))
$$;

-- Chefia acima: lotado/cargo num ancestral da unidade (só agregados).
create or replace function public.fn_socio_acima(p_uid uuid, p_unidade uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from usuario_unidades(p_uid) u
     where u.unidade_org_id in (select a.unidade_org_id from unidade_ancestrais(p_unidade) a))
$$;

-- Chefe: titular vigente do cargo da unidade (1 cargo por unidade no
-- organograma — é a chefia). É gestor nato de todo instrumento da unidade.
create or replace function public.fn_socio_chefe(p_uid uuid, p_unidade uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from cargo_ocupacoes o join cargos c on c.id = o.cargo_id
     where o.usuario_id = p_uid and c.unidade_org_id = p_unidade and c.ativo
       and o.data_inicio <= fn_socio_hoje()
       and (o.data_fim is null or o.data_fim >= fn_socio_hoje()))
$$;

-- p_acao:
--   ver       → enxerga estrutura, campanhas e números agregados
--   ler_fichas→ fichas SEM identificação
--   aplicar   → envia ficha real (precisa ainda estar na campanha)
--   treinar   → modo treino (aplicador ou gestor)
--   gerir     → versões, campanhas, papéis, validação, decidir pedidos
--   ver_identificacao → nome/GPS/fotos de fichas de outros (só gestor)
--   admin     → super_admin ativo (catálogo; nunca lê ficha por isso)
create or replace function public.fn_socio_pode_de(p_uid uuid, p_instrumento uuid, p_acao text)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare
  v_dono    uuid;
  v_admin   boolean;
  v_membro  boolean;
  v_gestor  boolean;
  v_papeis  text[];
  v_acesso  text[];
begin
  if p_uid is null or p_instrumento is null then return false; end if;
  if not exists (select 1 from usuarios where id = p_uid and ativo) then return false; end if;
  select unidade_org_id into v_dono from socio_instrumentos where id = p_instrumento;
  if v_dono is null then return false; end if;

  v_admin := exists (select 1 from usuarios where id = p_uid and ativo and perfil = 'super_admin');
  if p_acao = 'admin' then return v_admin; end if;

  v_membro := fn_socio_no_dept(p_uid, v_dono);
  v_papeis := case when v_membro then array(
                select m.papel from socio_instrumento_membros m
                 where m.instrumento_id = p_instrumento and m.usuario_id = p_uid and m.ativo)
              else '{}'::text[] end;
  v_gestor := v_membro and (fn_socio_chefe(p_uid, v_dono) or 'gestor' = any(v_papeis));
  v_acesso := array(select a.nivel from socio_acessos a
                     where a.instrumento_id = p_instrumento and a.usuario_id = p_uid
                       and a.status = 'aprovado' and a.data_fim >= fn_socio_hoje());

  return case p_acao
    when 'gerir'             then v_gestor
    when 'ver_identificacao' then v_gestor
    when 'ler_fichas'        then v_gestor or 'leitor' = any(v_papeis) or 'leitor' = any(v_acesso)
    when 'aplicar'           then 'aplicador' = any(v_papeis) or 'aplicador' = any(v_acesso)
    when 'treinar'           then v_gestor or 'aplicador' = any(v_papeis) or 'aplicador' = any(v_acesso)
    when 'ver'               then v_admin or v_membro or fn_socio_acima(p_uid, v_dono)
                                  or cardinality(v_acesso) > 0
    else false
  end;
end $$;

create or replace function public.fn_socio_pode(p_instrumento uuid, p_acao text)
returns boolean language sql stable security definer set search_path = public as $$
  select fn_socio_pode_de(auth.uid(), p_instrumento, p_acao)
$$;

create or replace function public.fn_socio_pode_ver_ficha(p_ficha_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from socio_fichas f
     where f.id = p_ficha_id
       and (fn_socio_pode(f.instrumento_id, 'gerir')
            or (not f.treino and fn_socio_pode(f.instrumento_id, 'ler_fichas'))
            or (f.entrevistador_id = auth.uid() and fn_socio_pode(f.instrumento_id, 'treinar'))))
$$;

create or replace function public.fn_socio_pode_ver_identificacao(p_ficha_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from socio_fichas f
     where f.id = p_ficha_id
       and (fn_socio_pode(f.instrumento_id, 'ver_identificacao')
            or (f.entrevistador_id = auth.uid() and fn_socio_pode(f.instrumento_id, 'treinar'))))
$$;

-- ── RLS: só leitura para o cliente; escrita só por RPC (362c) ───────────
do $$
declare t text;
begin
  foreach t in array array['socio_instrumentos','socio_questionarios','socio_instrumento_membros',
    'socio_acessos','socio_comunidades','socio_campanhas','socio_campanha_aplicadores',
    'socio_fichas','socio_fichas_identificacao','socio_fotos','socio_fichas_historico'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;

create policy socio_instrumentos_select on public.socio_instrumentos for select to authenticated
  using (fn_socio_pode(id, 'ver'));
create policy socio_questionarios_select on public.socio_questionarios for select to authenticated
  using (fn_socio_pode(instrumento_id, 'ver')
         and (status <> 'rascunho' or fn_socio_pode(instrumento_id, 'treinar')));
create policy socio_membros_select on public.socio_instrumento_membros for select to authenticated
  using (usuario_id = auth.uid() or fn_socio_pode(instrumento_id, 'gerir')
         or fn_socio_pode(instrumento_id, 'admin'));
create policy socio_acessos_select on public.socio_acessos for select to authenticated
  using (usuario_id = auth.uid() or fn_socio_pode(instrumento_id, 'gerir')
         or fn_socio_pode(instrumento_id, 'admin'));
-- comunidade é cadastro geográfico comum, sem dado pessoal
create policy socio_comunidades_select on public.socio_comunidades for select to authenticated
  using (auth.uid() is not null);
create policy socio_campanhas_select on public.socio_campanhas for select to authenticated
  using (fn_socio_pode(instrumento_id, 'ver'));
create policy socio_camp_aplic_select on public.socio_campanha_aplicadores for select to authenticated
  using (usuario_id = auth.uid() or exists (
           select 1 from socio_campanhas c where c.id = campanha_id and fn_socio_pode(c.instrumento_id, 'gerir')));
create policy socio_fichas_select on public.socio_fichas for select to authenticated
  using (fn_socio_pode_ver_ficha(id));
create policy socio_fichas_ident_select on public.socio_fichas_identificacao for select to authenticated
  using (fn_socio_pode_ver_identificacao(ficha_id));
create policy socio_fotos_select on public.socio_fotos for select to authenticated
  using (fn_socio_pode_ver_identificacao(ficha_id));
create policy socio_hist_select on public.socio_fichas_historico for select to authenticated
  using (fn_socio_pode_ver_ficha(ficha_id));

-- ── Funções: nada para anon (ALTER DEFAULT PRIVILEGES concede por nome) ─
revoke execute on function public.fn_socio_hoje() from public, anon;
revoke execute on function public.fn_socio_sha256(text) from public, anon;
revoke execute on function public.fn_socio_touch() from public, anon, authenticated;
revoke execute on function public.fn_socio_questionario_guarda() from public, anon, authenticated;
revoke execute on function public.fn_socio_ficha_historico() from public, anon, authenticated;
revoke execute on function public.fn_socio_no_dept(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.fn_socio_acima(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.fn_socio_chefe(uuid, uuid) from public, anon, authenticated;
-- consultar o acesso de OUTRA pessoa é só para as RPCs (rodam como dono)
revoke execute on function public.fn_socio_pode_de(uuid, uuid, text) from public, anon, authenticated;
revoke execute on function public.fn_socio_pode(uuid, text) from public, anon;
revoke execute on function public.fn_socio_pode_ver_ficha(uuid) from public, anon;
revoke execute on function public.fn_socio_pode_ver_identificacao(uuid) from public, anon;
grant execute on function public.fn_socio_hoje() to authenticated;
grant execute on function public.fn_socio_sha256(text) to authenticated;
grant execute on function public.fn_socio_pode(uuid, text) to authenticated;
grant execute on function public.fn_socio_pode_ver_ficha(uuid) to authenticated;
grant execute on function public.fn_socio_pode_ver_identificacao(uuid) to authenticated;

-- ── Trilha de auditoria: quem deu/tirou acesso e quem mexeu no instrumento.
-- Fichas NÃO entram: a trilha copia a linha inteira e o super_admin lê a
-- trilha — seria ler ficha sem pedir. O histórico de status cobre a ficha.
create or replace trigger trg_trilha_socio_instrumentos
  after insert or update on public.socio_instrumentos
  for each row execute function trilha_auditoria_registrar('id');
create or replace trigger trg_trilha_socio_membros
  after insert or update on public.socio_instrumento_membros
  for each row execute function trilha_auditoria_registrar('id');
create or replace trigger trg_trilha_socio_acessos
  after insert or update on public.socio_acessos
  for each row execute function trilha_auditoria_registrar('id');
create or replace trigger trg_trilha_socio_campanhas
  after insert or update on public.socio_campanhas
  for each row execute function trilha_auditoria_registrar('id');

-- ── ROPA ────────────────────────────────────────────────────────────────
insert into public.lgpd_tratamentos (
  codigo, nome, modulo, finalidade, base_legal, base_legal_detalhe,
  categorias_titulares, categorias_dados, dado_sensivel, dado_de_menor,
  origem, origem_detalhe, tabelas, retencao_meses, retencao_criterio,
  compartilhamento, transferencia_internacional, alto_risco, observacoes)
values (
  'TRAT-021', 'Diagnóstico Socioeconômico (questionários de campo)', 'socio',
  'Aplicar questionários socioeconômicos em comunidades e domicílios a pedido de um departamento da SEMA, para subsidiar a gestão territorial, de unidades de conservação e de políticas públicas ambientais.',
  'politica_publica',
  'Art. 7º, III — execução de política pública ambiental; dado sensível eventualmente presente no instrumento (saúde, filiação a organização): Art. 11, II, "b". Nunca consentimento: o entrevistado é avisado (Art. 9º) e pode recusar a entrevista ou qualquer pergunta.',
  array['entrevistados (moradores de comunidades)','moradores do domicílio, inclusive menores (idade e sexo, sem nome por padrão)','servidores que aplicam e validam'],
  array['respostas do questionário','composição do domicílio','município, UC e comunidade','nome do entrevistado (só se o instrumento pedir)','geolocalização do domicílio (opcional)','fotografia de moradia e entorno (nunca de pessoas)','identificação do entrevistador'],
  true, true, 'coleta_direta',
  'Entrevista presencial pelo app de campo; cada instrumento pertence a um departamento (socio_instrumentos.unidade_org_id).',
  array['socio_instrumentos','socio_questionarios','socio_campanhas','socio_campanha_aplicadores','socio_instrumento_membros','socio_acessos','socio_comunidades','socio_fichas','socio_fichas_identificacao','socio_fotos','socio_fichas_historico'],
  24,
  'Identificação (nome, GPS, colunas de identificação da lista) e fotos: 2 anos após a validação da ficha. Respostas sem identificação: guarda permanente, como base de série histórica.',
  'Uso interno da SEMA. Cada departamento só vê o próprio instrumento; outro departamento só por pedido aprovado pelo dono, com prazo e justificativa (socio_acessos). Identificação nunca sai para outro departamento nem para o super_admin.',
  false, true,
  'Migrations 362/362b/362c. Expurgo automático da identificação entra na Fase 5 do plano (docs/socioeconomico/plano.md).')
on conflict (codigo) do nothing;
