-- ════════════════════════════════════════════════════════════════════════
-- 363 — Diagnóstico Socioeconômico: app de campo (Fase 3)
-- ════════════════════════════════════════════════════════════════════════
-- Plano: docs/socioeconomico/plano.md §3/§5. Tela: pages/socio-app.html.
--
-- 1. Bucket PRIVADO socio-fotos, desde o nascimento (molde da 258/210).
--    Caminho SEMPRE <uuid_cliente da ficha>/<uuid da foto>.<ext> — é o que
--    socio_enviar_ficha confere. A foto sobe ANTES da ficha (offline-first:
--    a fila envia as fotos e depois chama a RPC), então a policy de envio
--    aceita pasta de ficha que ainda não existe, desde que quem envia possa
--    aplicar ou treinar algum instrumento. Pasta de ficha que já existe só
--    recebe arquivo do próprio entrevistador.
--    Leitura = quem lê a identificação da ficha (gestor do dono + o próprio
--    entrevistador): foto é identificação, leitor e outro departamento não veem.
--    Sem policy de alteração nem de remoção: o app nunca sobrescreve (reenvio que acha o
--    arquivo lá trata o 409 como sucesso) e o expurgo é da Fase 5.
--
-- 2. socio_app_pacote(): tudo que o app precisa guardar no aparelho para
--    trabalhar sem rede, numa chamada só — campanhas em que a pessoa está
--    na equipe (com a versão do questionário), instrumentos em que pode
--    treinar, comunidades, municípios, UCs e as próprias fichas recentes
--    (status, motivo de devolução). Nada de outra pessoa sai daqui.
--
-- Nenhuma instrução desta migration remove dado.
-- ════════════════════════════════════════════════════════════════════════

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('socio-fotos', 'socio-fotos', false, 4194304,
        array['image/jpeg','image/jpg','image/png','image/webp'])
on conflict (id) do nothing;

-- pasta = 1º segmento do caminho; precisa ser um uuid
create or replace function public.fn_socio_foto_pasta(p_nome text)
returns uuid language plpgsql immutable set search_path = public as $$
declare v text := split_part(coalesce(p_nome, ''), '/', 1);
begin
  if v !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return null; end if;
  -- exatamente <pasta>/<arquivo>, sem subpasta
  if array_length(string_to_array(p_nome, '/'), 1) <> 2 or split_part(p_nome, '/', 2) = '' then return null; end if;
  return v::uuid;
end $$;

create or replace function public.fn_socio_foto_pode_enviar(p_nome text)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare
  v_uid  uuid := auth.uid();
  v_pasta uuid := fn_socio_foto_pasta(p_nome);
  v_f    socio_fichas;
begin
  if v_uid is null or v_pasta is null then return false; end if;
  if not exists (select 1 from usuarios where id = v_uid and ativo) then return false; end if;
  select * into v_f from socio_fichas where uuid_cliente = v_pasta;
  if v_f.id is not null then
    return v_f.entrevistador_id = v_uid and v_f.status in ('enviada', 'devolvida')
           and fn_socio_pode_de(v_uid, v_f.instrumento_id, 'treinar');
  end if;
  return exists (select 1 from socio_instrumentos i
                  where i.ativo and fn_socio_pode_de(v_uid, i.id, 'treinar'));
end $$;

create or replace function public.fn_socio_foto_pode_ler(p_nome text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from socio_fichas f
                  where f.uuid_cliente = fn_socio_foto_pasta(p_nome)
                    and fn_socio_pode_ver_identificacao(f.id))
$$;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'
                  and policyname = 'socio_fotos_obj_insert') then
    create policy socio_fotos_obj_insert on storage.objects for insert to authenticated
      with check (bucket_id = 'socio-fotos' and public.fn_socio_foto_pode_enviar(name));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'
                  and policyname = 'socio_fotos_obj_select') then
    create policy socio_fotos_obj_select on storage.objects for select to authenticated
      using (bucket_id = 'socio-fotos' and public.fn_socio_foto_pode_ler(name));
  end if;
end $$;

-- ── Pacote do app ───────────────────────────────────────────────────────
create or replace function public.socio_app_pacote()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_hoje date := fn_socio_hoje();
begin
  if v_uid is null or not exists (select 1 from usuarios where id = v_uid and ativo) then
    raise exception 'socio:nao_autorizado: entre com a sua conta do SIGUC';
  end if;

  return jsonb_build_object(
    'gerado_em', now(),
    'hoje', v_hoje,
    'usuario', (select jsonb_build_object('id', u.id, 'nome', u.nome_completo)
                  from usuarios u where u.id = v_uid),
    -- campanhas da equipe: abertas, ou encerradas ainda na carência de 15 dias
    -- (a ficha concluída a tempo ainda pode subir — mesma regra da RPC de envio)
    'campanhas', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', c.id, 'nome', c.nome, 'inicio', c.inicio, 'fim', c.fim, 'situacao', c.situacao,
               'exige_municipio', c.exige_municipio, 'exige_uc', c.exige_uc,
               'municipios', to_jsonb(c.municipios), 'ucs', to_jsonb(c.ucs),
               'aceita_nova', c.situacao = 'aberta' and v_hoje between c.inicio and c.fim
                              and fn_socio_pode_de(v_uid, i.id, 'aplicar'),
               'instrumento', jsonb_build_object('id', i.id, 'codigo', i.codigo, 'titulo', i.titulo,
                                                 'unidade_analise', i.unidade_analise),
               'questionario', jsonb_build_object('id', q.id, 'versao', q.versao, 'status', q.status,
                                                  'estrutura', q.estrutura, 'aviso', q.aviso_entrevistado,
                                                  'hash', q.hash_sha256))
             order by c.fim, c.nome)
        from socio_campanhas c
        join socio_campanha_aplicadores a on a.campanha_id = c.id and a.usuario_id = v_uid and a.ativo
        join socio_instrumentos i on i.id = c.instrumento_id
        join socio_questionarios q on q.id = c.questionario_id
       where c.situacao in ('aberta', 'encerrada') and v_hoje <= c.fim + 15
         and fn_socio_pode_de(v_uid, i.id, 'treinar')), '[]'::jsonb),
    -- treino: a versão mais nova não arquivada (aceita rascunho, para testar antes de publicar)
    'treino', coalesce((
      select jsonb_agg(jsonb_build_object(
               'instrumento', jsonb_build_object('id', i.id, 'codigo', i.codigo, 'titulo', i.titulo,
                                                 'unidade_analise', i.unidade_analise),
               'questionario', jsonb_build_object('id', q.id, 'versao', q.versao, 'status', q.status,
                                                  'estrutura', q.estrutura, 'aviso', q.aviso_entrevistado,
                                                  'hash', q.hash_sha256))
             order by i.titulo)
        from socio_instrumentos i
        join lateral (select * from socio_questionarios q
                       where q.instrumento_id = i.id and q.status <> 'arquivado'
                       order by q.versao desc limit 1) q on true
       where i.ativo and fn_socio_pode_de(v_uid, i.id, 'treinar')), '[]'::jsonb),
    'comunidades', coalesce((
      select jsonb_agg(jsonb_build_object('id', m.id, 'nome', m.nome, 'cd_mun', m.cd_mun, 'uc_id', m.uc_id)
                       order by m.nome)
        from socio_comunidades m where m.ativo), '[]'::jsonb),
    'municipios', coalesce((
      select jsonb_agg(jsonb_build_object('cd_ibge', m.cd_ibge, 'nome', m.nome) order by m.nome)
        from municipios_acre m), '[]'::jsonb),
    'ucs', coalesce((
      select jsonb_agg(jsonb_build_object('id', u.id, 'nome', u.nome, 'sigla', u.sigla) order by u.nome)
        from unidades_conservacao u where coalesce(u.ativo, true)), '[]'::jsonb),
    -- as próprias fichas dos últimos 120 dias: o app mostra devolvida/validada
    'minhas_fichas', coalesce((
      select jsonb_agg(jsonb_build_object(
               'uuid_cliente', f.uuid_cliente, 'codigo', f.codigo, 'status', f.status,
               'motivo_devolucao', f.motivo_devolucao, 'treino', f.treino,
               'instrumento_codigo', i.codigo, 'campanha_id', f.campanha_id,
               'dt_entrevista', f.dt_entrevista, 'enviado_em', f.enviado_em,
               'n_alertas', jsonb_array_length(f.alertas))
             order by f.enviado_em desc)
        from socio_fichas f join socio_instrumentos i on i.id = f.instrumento_id
       where f.entrevistador_id = v_uid and f.enviado_em >= now() - interval '120 days'), '[]'::jsonb)
  );
end $$;

revoke execute on function public.fn_socio_foto_pasta(text) from public, anon;
revoke execute on function public.fn_socio_foto_pode_enviar(text) from public, anon;
revoke execute on function public.fn_socio_foto_pode_ler(text) from public, anon;
revoke execute on function public.socio_app_pacote() from public, anon;
grant execute on function public.fn_socio_foto_pasta(text) to authenticated;
grant execute on function public.fn_socio_foto_pode_enviar(text) to authenticated;
grant execute on function public.fn_socio_foto_pode_ler(text) to authenticated;
grant execute on function public.socio_app_pacote() to authenticated;

-- ROPA: TRAT-021 (362) já cobre a fotografia de moradia e entorno; nada a mudar.
