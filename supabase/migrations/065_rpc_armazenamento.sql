-- 065_rpc_armazenamento.sql
-- RPC que retorna tamanho de todas as tabelas do schema public
-- e tamanho dos buckets de storage, agrupados para o painel de armazenamento.
-- Só pode ser chamada por super_admin.

create or replace function get_armazenamento_resumo()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Restrição de acesso
  if not exists (
    select 1 from usuarios
    where id = auth.uid() and perfil = 'super_admin'
  ) then
    raise exception 'Acesso restrito a super_admin';
  end if;

  return jsonb_build_object(
    -- Tamanho de cada tabela do schema public (dados + índices + TOAST)
    'tabelas', (
      select coalesce(jsonb_object_agg(c.relname, pg_total_relation_size(c.oid)), '{}')
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relkind = 'r'  -- apenas tabelas (não views, índices etc)
    ),
    -- Tamanho total de arquivos por bucket no Supabase Storage
    'storage', (
      select coalesce(
        jsonb_object_agg(bucket_id, total_bytes),
        '{}'
      )
      from (
        select
          bucket_id,
          coalesce(sum((metadata->>'size')::bigint), 0) as total_bytes
        from storage.objects
        where metadata is not null
          and metadata->>'size' is not null
        group by bucket_id
      ) s
    ),
    'gerado_em', now()::text
  );
end;
$$;

grant execute on function get_armazenamento_resumo() to authenticated;
