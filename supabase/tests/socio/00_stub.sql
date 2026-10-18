-- ════════════════════════════════════════════════════════════════════════
-- Stub mínimo do SIGUC para testar as migrations 362* num Postgres LOCAL.
-- Só o que o Diagnóstico Socioeconômico usa. As funções de organograma
-- (usuario_unidades, unidade_ancestrais/descendentes) são CÓPIA das
-- migrations 262/265 — se mudarem lá, mudar aqui.
-- ════════════════════════════════════════════════════════════════════════
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
end $$;
grant usage on schema public to anon, authenticated;

create schema if not exists auth;
grant usage on schema auth to anon, authenticated;
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
grant execute on function auth.uid() to anon, authenticated;

create type public.perfil_usuario as enum ('super_admin','gestor','tecnico','visualizador','diretor','chefe_departamento');
create type public.tipo_notificacao as enum ('sistema','frota','biomonitor','hidro');
create type public.status_notificacao as enum ('gerada','enviada','visualizada','em_analise','encaminhada','resolvida');
create type public.lgpd_base_legal as enum ('politica_publica','obrigacao_legal','execucao_contrato','exercicio_direitos','consentimento');
create type public.lgpd_origem_dado as enum ('coleta_direta','coleta_terceiro','api_externa','geracao_automatica');

create table public.usuarios (
  id uuid primary key, nome_completo text not null, email text not null,
  perfil public.perfil_usuario not null default 'tecnico', ativo boolean not null default true);

create table public.unidades_organizacionais (
  id uuid primary key default gen_random_uuid(), sigla varchar not null, nome text not null,
  tipo text not null default 'departamento', pai_id uuid references public.unidades_organizacionais(id),
  ativo boolean not null default true);

create table public.cargos (
  id uuid primary key default gen_random_uuid(), unidade_org_id uuid not null references public.unidades_organizacionais(id),
  denominacao text not null, ativo boolean not null default true);

create table public.cargo_ocupacoes (
  id uuid primary key default gen_random_uuid(), cargo_id uuid not null references public.cargos(id),
  usuario_id uuid not null references public.usuarios(id), data_inicio date not null default current_date - 30, data_fim date);

create table public.usuario_lotacoes (
  id uuid primary key default gen_random_uuid(), usuario_id uuid not null references public.usuarios(id),
  unidade_org_id uuid not null references public.unidades_organizacionais(id), principal boolean not null default true,
  data_inicio date not null default current_date - 30, data_fim date);

create table public.municipios_acre (cd_ibge text primary key, nome text not null);
create table public.unidades_conservacao (id uuid primary key default gen_random_uuid(), nome text not null);

create table public.notificacoes (
  id uuid primary key default gen_random_uuid(), tipo public.tipo_notificacao not null,
  status public.status_notificacao not null default 'gerada', titulo text not null, mensagem text not null,
  destinatario_id uuid, remetente_id uuid, meta jsonb not null default '{}'::jsonb, criado_em timestamptz default now());

create table public.lgpd_tratamentos (
  id uuid primary key default gen_random_uuid(), codigo text not null unique, nome text not null, modulo text,
  finalidade text not null, base_legal public.lgpd_base_legal not null, base_legal_detalhe text not null,
  categorias_titulares text[] not null, categorias_dados text[] not null, dado_sensivel boolean not null,
  dado_de_menor boolean not null, origem public.lgpd_origem_dado not null, origem_detalhe text,
  tabelas text[] not null, retencao_meses int, retencao_criterio text not null, compartilhamento text,
  transferencia_internacional boolean not null, alto_risco boolean not null, observacoes text,
  ativo boolean not null default true);

-- trilha: registra só o essencial, para o teste conferir que a justificativa chega
create table public.trilha_teste (tabela text, operacao text, justificativa text, quando timestamptz default now());
create or replace function public.trilha_auditoria_registrar() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into trilha_teste (tabela, operacao, justificativa)
  values (tg_table_name, tg_op, nullif(current_setting('app.justificativa', true), ''));
  return null;
end $$;

-- ── cópia de 262_usuario_lotacoes.sql ───────────────────────────────────
create or replace function public.usuario_unidades(p_usuario uuid)
returns table (unidade_org_id uuid, origem text, principal boolean)
language sql stable security definer set search_path = public as $$
  select l.unidade_org_id, 'lotacao'::text, l.principal
    from usuario_lotacoes l
   where l.usuario_id = p_usuario
     and l.data_inicio <= current_date
     and (l.data_fim is null or l.data_fim >= current_date)
  union
  select c.unidade_org_id, 'cargo'::text, false
    from cargo_ocupacoes o
    join cargos c on c.id = o.cargo_id
   where o.usuario_id = p_usuario
     and o.data_inicio <= current_date
     and (o.data_fim is null or o.data_fim >= current_date)
     and c.ativo;
$$;

-- ── cópia de 265_modulo_unidades.sql ────────────────────────────────────
create or replace function public.unidade_ancestrais(p_unidade uuid)
returns table (unidade_org_id uuid) language sql stable security definer set search_path = public as $$
  with recursive subida as (
    select pai_id from unidades_organizacionais where id = p_unidade
    union all
    select u.pai_id from unidades_organizacionais u join subida s on u.id = s.pai_id
  )
  select pai_id from subida where pai_id is not null;
$$;
create or replace function public.unidade_descendentes(p_unidade uuid)
returns table (unidade_org_id uuid) language sql stable security definer set search_path = public as $$
  with recursive descida as (
    select id from unidades_organizacionais where pai_id = p_unidade
    union all
    select u.id from unidades_organizacionais u join descida d on u.pai_id = d.id
  )
  select id from descida;
$$;

-- o Supabase concede EXECUTE a anon por nome em toda função nova; aqui o
-- PUBLIC padrão do Postgres faz o mesmo papel para os testes de REVOKE
grant select on all tables in schema public to anon, authenticated;
revoke select on public.trilha_teste from anon, authenticated;
