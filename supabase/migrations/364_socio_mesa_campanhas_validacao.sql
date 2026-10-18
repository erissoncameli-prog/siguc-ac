-- ════════════════════════════════════════════════════════════════════════
-- 364 — Diagnóstico Socioeconômico: campanhas e validação na mesa (Fase 4)
-- ════════════════════════════════════════════════════════════════════════
-- Plano: docs/socioeconomico/plano.md §5. Tela: pages/socio-questionarios.html
-- (abas Campanhas e Fichas do questionário).
--
-- Só LEITURAS montadas no banco, mais um vínculo. A escrita de campanha,
-- equipe e validação já existe (362c: socio_salvar_campanha,
-- socio_situacao_campanha, socio_definir_aplicador, socio_mudar_status).
-- Cada função confere o acesso por dentro com as MESMAS regras de sempre
-- (fn_socio_pode_de / fn_socio_pode_ver_ficha / fn_socio_pode_ver_identificacao)
-- — nenhuma regra nova de quem vê o quê.
--
--   socio_campanhas_resumo(instrumento)  quem vê o instrumento: campanhas +
--                                        CONTAGENS (agregado; sem ficha)
--   socio_campanha_equipe(campanha)      gestor: quem pode ser escalado
--   socio_fichas_lista(instrumento, …)   quem lê fichas: lista para validar
--   socio_ficha_detalhe(ficha)           a ficha inteira; identificação e
--                                        fotos só para quem pode vê-las
--   socio_vincular_comunidade(ficha, c)  gestor: liga a "comunidade nova"
--                                        digitada em campo a uma cadastrada
--
-- Nenhuma instrução desta migration remove dado.
-- ════════════════════════════════════════════════════════════════════════

create or replace function public.socio_campanhas_resumo(p_instrumento uuid)
returns table (id uuid, nome text, inicio date, fim date, situacao text, questionario_id uuid, versao int,
               exige_municipio boolean, exige_uc boolean, municipios text[], ucs uuid[],
               n_aplicadores int, n_enviadas int, n_devolvidas int, n_validadas int, n_descartadas int,
               criado_em timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not fn_socio_pode_de(auth.uid(), p_instrumento, 'ver') then
    raise exception 'socio:nao_autorizado: sem acesso a este questionário';
  end if;
  return query
  select c.id, c.nome, c.inicio, c.fim, c.situacao, c.questionario_id, q.versao,
         c.exige_municipio, c.exige_uc, c.municipios, c.ucs,
         (select count(*)::int from socio_campanha_aplicadores a where a.campanha_id = c.id and a.ativo),
         (select count(*)::int from socio_fichas f where f.campanha_id = c.id and not f.treino and f.status = 'enviada'),
         (select count(*)::int from socio_fichas f where f.campanha_id = c.id and not f.treino and f.status = 'devolvida'),
         (select count(*)::int from socio_fichas f where f.campanha_id = c.id and not f.treino and f.status = 'validada'),
         (select count(*)::int from socio_fichas f where f.campanha_id = c.id and not f.treino and f.status = 'descartada'),
         c.criado_em
    from socio_campanhas c join socio_questionarios q on q.id = c.questionario_id
   where c.instrumento_id = p_instrumento
   order by c.inicio desc, c.nome;
end $$;

-- quem pode ser escalado: aplicador do departamento ou com acesso de
-- aplicador aprovado; mais quem já está na equipe (mesmo que tenha perdido
-- o acesso — aparece marcado, para o gestor tirar)
create or replace function public.socio_campanha_equipe(p_campanha uuid)
returns table (usuario_id uuid, nome text, email text, origem text, pode_aplicar boolean,
               na_equipe boolean, n_fichas int)
language plpgsql stable security definer set search_path = public as $$
declare
  v_c socio_campanhas;
begin
  select * into v_c from socio_campanhas c where c.id = p_campanha;
  if v_c.id is null then raise exception 'socio:nao_encontrado: campanha inexistente'; end if;
  if not fn_socio_pode_de(auth.uid(), v_c.instrumento_id, 'gerir') then
    raise exception 'socio:nao_autorizado: só o gestor do questionário monta a equipe';
  end if;
  return query
  with cand as (
    select m.usuario_id as uid, 'departamento'::text as origem from socio_instrumento_membros m
     where m.instrumento_id = v_c.instrumento_id and m.papel = 'aplicador' and m.ativo
    union
    select a.usuario_id, 'acesso' from socio_acessos a
     where a.instrumento_id = v_c.instrumento_id and a.nivel = 'aplicador' and a.status = 'aprovado'
       and a.data_fim >= fn_socio_hoje()
    union
    select e.usuario_id, 'equipe' from socio_campanha_aplicadores e where e.campanha_id = p_campanha and e.ativo
  ), um as (
    select cand.uid, min(cand.origem) as origem from cand group by cand.uid   -- 'acesso' < 'departamento' < 'equipe'
  )
  select u.id, u.nome_completo, u.email,
         case um.origem when 'equipe' then 'sem_acesso' else um.origem end,
         fn_socio_pode_de(u.id, v_c.instrumento_id, 'aplicar'),
         exists (select 1 from socio_campanha_aplicadores e where e.campanha_id = p_campanha and e.usuario_id = u.id and e.ativo),
         (select count(*)::int from socio_fichas f where f.campanha_id = p_campanha and f.entrevistador_id = u.id and not f.treino)
    from um join usuarios u on u.id = um.uid
   order by u.nome_completo;
end $$;

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
         (select count(*)::int from socio_fotos ft where ft.ficha_id = f.id),
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
      'usou_carencia', v_f.usou_carencia, 'app_versao', v_f.app_versao),
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
          from socio_fotos ft where ft.ficha_id = v_f.id), '[]'::jsonb) end,
    'historico', coalesce((
        select jsonb_agg(jsonb_build_object('status_de', h.status_de, 'status_para', h.status_para, 'motivo', h.motivo,
                                            'por_nome', u.nome_completo, 'em', h.em) order by h.em)
          from socio_fichas_historico h left join usuarios u on u.id = h.por where h.ficha_id = v_f.id), '[]'::jsonb));
end $$;

create or replace function public.socio_vincular_comunidade(p_ficha uuid, p_comunidade uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := fn_socio_uid_ativo();
  v_f   socio_fichas;
  v_com socio_comunidades;
begin
  select * into v_f from socio_fichas f where f.id = p_ficha for update;
  if v_f.id is null then raise exception 'socio:nao_encontrado: ficha inexistente'; end if;
  if not fn_socio_pode_de(v_uid, v_f.instrumento_id, 'gerir') then
    raise exception 'socio:nao_autorizado: só o gestor do questionário liga a ficha a uma comunidade';
  end if;
  if v_f.status = 'descartada' then
    raise exception 'socio:transicao_invalida: ficha descartada não muda';
  end if;
  select * into v_com from socio_comunidades c where c.id = p_comunidade and c.ativo;
  if v_com.id is null then raise exception 'socio:nao_encontrado: comunidade inexistente ou desativada'; end if;
  if v_f.cd_mun is not null and v_com.cd_mun <> v_f.cd_mun then
    raise exception 'socio:territorio_invalido: a comunidade é de outro município';
  end if;
  update socio_fichas f set
    comunidade_id = v_com.id, comunidade_nova = null, cd_mun = coalesce(f.cd_mun, v_com.cd_mun),
    alertas = coalesce((select jsonb_agg(a) from jsonb_array_elements(f.alertas) a where a->>'tipo' <> 'comunidade_nova'), '[]'::jsonb)
  where f.id = p_ficha;
  return jsonb_build_object('id', p_ficha, 'comunidade_id', v_com.id);
end $$;

do $$
declare f text;
begin
  foreach f in array array['socio_campanhas_resumo(uuid)', 'socio_campanha_equipe(uuid)',
    'socio_fichas_lista(uuid, uuid, text, boolean)', 'socio_ficha_detalhe(uuid)',
    'socio_vincular_comunidade(uuid, uuid)'] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
