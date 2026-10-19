-- ════════════════════════════════════════════════════════════════════════
-- 362c — Diagnóstico Socioeconômico: RPCs (única via de escrita)
-- ════════════════════════════════════════════════════════════════════════
-- Toda escrita nas tabelas socio_* passa por aqui (SECURITY DEFINER), com o
-- acesso decidido por fn_socio_pode_de() (362). Erros saem no formato
-- 'socio:<codigo>: <texto para a pessoa>' — a tela mostra o texto.
--
-- Catálogo: TODOS veem que um instrumento existe (para poder pedir acesso),
-- nunca as perguntas, as fichas nem os números (socio_catalogo).
-- Pedido de acesso: decide o GESTOR do departamento dono — nunca quem
-- pediu, nunca o super_admin no lugar dele (decisão de 18/10/2026).
-- ════════════════════════════════════════════════════════════════════════

-- ── Internos ────────────────────────────────────────────────────────────
create or replace function public.fn_socio_uid_ativo() returns uuid
language plpgsql stable security definer set search_path = public as $$
declare v uuid := auth.uid();
begin
  if v is null or not exists (select 1 from usuarios where id = v and ativo) then
    raise exception 'socio:sem_sessao: faça login novamente';
  end if;
  return v;
end $$;

create or replace function public.fn_socio_eh_admin(p_uid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from usuarios where id = p_uid and ativo and perfil = 'super_admin')
$$;

-- quem decide pelo instrumento: chefe da unidade dona + gestores designados
create or replace function public.fn_socio_gestores(p_instrumento uuid)
returns table (usuario_id uuid) language sql stable security definer set search_path = public as $$
  select distinct u.id
    from usuarios u
   where u.ativo and fn_socio_pode_de(u.id, p_instrumento, 'gerir')
     and (u.id in (select o.usuario_id from cargo_ocupacoes o join cargos c on c.id = o.cargo_id
                    join socio_instrumentos i on i.unidade_org_id = c.unidade_org_id
                   where i.id = p_instrumento)
          or u.id in (select m.usuario_id from socio_instrumento_membros m
                       where m.instrumento_id = p_instrumento and m.papel = 'gestor' and m.ativo))
$$;

create or replace function public.fn_socio_notificar(p_dest uuid, p_titulo text, p_msg text, p_meta jsonb)
returns void language sql security definer set search_path = public as $$
  insert into notificacoes (tipo, status, titulo, mensagem, destinatario_id, remetente_id, meta)
  values ('sistema', 'gerada', p_titulo, p_msg, p_dest, auth.uid(),
          jsonb_build_object('modulo', 'socio') || coalesce(p_meta, '{}'::jsonb))
$$;

-- ── Catálogo (todos) ────────────────────────────────────────────────────
create or replace function public.socio_catalogo()
returns table (
  id uuid, codigo text, titulo text, finalidade text, unidade_analise text, ativo boolean,
  unidade_org_id uuid, departamento_sigla text, departamento_nome text,
  versao_publicada integer, pode_ver boolean, pode_ler_fichas boolean, pode_aplicar boolean,
  pode_gerir boolean, sou_admin boolean, do_meu_departamento boolean,
  pedidos_pendentes text[], acessos_vigentes jsonb)
language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := fn_socio_uid_ativo();
begin
  return query
  select i.id, i.codigo, i.titulo, i.finalidade, i.unidade_analise, i.ativo,
         i.unidade_org_id, u.sigla::text, u.nome,
         (select max(q.versao) from socio_questionarios q where q.instrumento_id = i.id and q.status = 'publicado'),
         fn_socio_pode_de(v_uid, i.id, 'ver'), fn_socio_pode_de(v_uid, i.id, 'ler_fichas'),
         fn_socio_pode_de(v_uid, i.id, 'aplicar'), fn_socio_pode_de(v_uid, i.id, 'gerir'),
         fn_socio_eh_admin(v_uid), fn_socio_no_dept(v_uid, i.unidade_org_id),
         array(select a.nivel from socio_acessos a where a.instrumento_id = i.id and a.usuario_id = v_uid
                  and a.status = 'pendente' order by a.nivel),
         coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'nivel', a.nivel, 'data_fim', a.data_fim) order by a.nivel)
                     from socio_acessos a where a.instrumento_id = i.id and a.usuario_id = v_uid
                      and a.status = 'aprovado' and a.data_fim >= fn_socio_hoje()), '[]'::jsonb)
    from socio_instrumentos i
    join unidades_organizacionais u on u.id = i.unidade_org_id
   where i.ativo or fn_socio_pode_de(v_uid, i.id, 'gerir') or fn_socio_eh_admin(v_uid)
   order by u.sigla, i.titulo;
end $$;

-- departamentos onde a pessoa pode criar instrumento (super_admin: todos)
create or replace function public.socio_meus_departamentos()
returns table (unidade_org_id uuid, sigla text, nome text, origem text)
language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := fn_socio_uid_ativo();
begin
  if fn_socio_eh_admin(v_uid) then
    return query select u.id, u.sigla::text, u.nome, 'admin'::text
                   from unidades_organizacionais u where u.ativo order by u.sigla;
  else
    return query select u.id, u.sigla::text, u.nome, min(m.origem)
                   from usuario_unidades(v_uid) m join unidades_organizacionais u on u.id = m.unidade_org_id
                  where u.ativo group by u.id, u.sigla, u.nome order by u.sigla;
  end if;
end $$;

-- ── Instrumentos ────────────────────────────────────────────────────────
create or replace function public.socio_criar_instrumento(
  p_codigo text, p_titulo text, p_finalidade text, p_unidade_analise text, p_unidade_org_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := fn_socio_uid_ativo();
  v_id  uuid;
  v_cod text := upper(btrim(coalesce(p_codigo, '')));
begin
  if not (fn_socio_no_dept(v_uid, p_unidade_org_id) or fn_socio_eh_admin(v_uid)) then
    raise exception 'socio:nao_autorizado: só quem é do departamento cria instrumento para ele';
  end if;
  if v_cod !~ '^[A-Z]{2,10}$' or v_cod = 'TRE' then
    raise exception 'socio:codigo_invalido: use de 2 a 10 letras, sem acento (TRE é reservado ao treino)';
  end if;
  if exists (select 1 from socio_instrumentos where codigo = v_cod) then
    raise exception 'socio:codigo_em_uso: já existe instrumento com o código %', v_cod;
  end if;
  insert into socio_instrumentos (codigo, titulo, finalidade, unidade_analise, unidade_org_id, criado_por)
  values (v_cod, btrim(p_titulo), btrim(p_finalidade), coalesce(p_unidade_analise, 'domicilio'), p_unidade_org_id, v_uid)
  returning id into v_id;
  -- quem cria (sendo do departamento) já nasce gestor; o chefe é gestor nato
  if fn_socio_no_dept(v_uid, p_unidade_org_id) then
    insert into socio_instrumento_membros (instrumento_id, usuario_id, papel, designado_por)
    values (v_id, v_uid, 'gestor', v_uid);
  end if;
  return v_id;
end $$;

create or replace function public.socio_atualizar_instrumento(
  p_id uuid, p_titulo text, p_finalidade text, p_unidade_analise text, p_ativo boolean)
returns void language plpgsql security definer set search_path = public as $$
declare v_uid uuid := fn_socio_uid_ativo();
begin
  if not (fn_socio_pode_de(v_uid, p_id, 'gerir') or fn_socio_eh_admin(v_uid)) then
    raise exception 'socio:nao_autorizado: só o gestor do instrumento altera o cadastro';
  end if;
  update socio_instrumentos
     set titulo = btrim(coalesce(p_titulo, titulo)), finalidade = btrim(coalesce(p_finalidade, finalidade)),
         unidade_analise = coalesce(p_unidade_analise, unidade_analise), ativo = coalesce(p_ativo, ativo)
   where id = p_id;
  if not found then raise exception 'socio:nao_encontrado: instrumento inexistente'; end if;
end $$;

-- só super_admin, com justificativa (fica na trilha de auditoria)
create or replace function public.socio_transferir_instrumento(p_id uuid, p_unidade_org_id uuid, p_justificativa text)
returns void language plpgsql security definer set search_path = public as $$
declare v_uid uuid := fn_socio_uid_ativo();
begin
  if not fn_socio_eh_admin(v_uid) then
    raise exception 'socio:nao_autorizado: só o super_admin troca o departamento dono';
  end if;
  if length(btrim(coalesce(p_justificativa, ''))) < 20 then
    raise exception 'socio:justificativa_obrigatoria: explique a troca (mínimo de 20 caracteres)';
  end if;
  if not exists (select 1 from unidades_organizacionais where id = p_unidade_org_id and ativo) then
    raise exception 'socio:nao_encontrado: unidade inexistente ou inativa';
  end if;
  perform set_config('app.justificativa', btrim(p_justificativa), true);
  update socio_instrumentos set unidade_org_id = p_unidade_org_id where id = p_id;
  if not found then raise exception 'socio:nao_encontrado: instrumento inexistente'; end if;
  -- papéis eram do departamento antigo: deixam de valer
  update socio_instrumento_membros set ativo = false, removido_por = v_uid, removido_em = now()
   where instrumento_id = p_id and ativo;
  perform set_config('app.justificativa', '', true);
end $$;

-- ── Versões ─────────────────────────────────────────────────────────────
-- rascunho pode ser salvo com erros (o editor mostra a lista); publicar não
create or replace function public.socio_salvar_versao(
  p_instrumento uuid, p_estrutura jsonb, p_aviso text, p_questionario_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid  uuid := fn_socio_uid_ativo();
  v_q    socio_questionarios;
  v_erros text[];
begin
  if not fn_socio_pode_de(v_uid, p_instrumento, 'gerir') then
    raise exception 'socio:nao_autorizado: só o gestor do instrumento edita o questionário';
  end if;
  if length(btrim(coalesce(p_aviso, ''))) < 20 then
    raise exception 'socio:aviso_obrigatorio: escreva o aviso lido ao entrevistado (mínimo de 20 caracteres)';
  end if;
  if jsonb_typeof(p_estrutura) is distinct from 'object' then
    raise exception 'socio:estrutura_invalida: a estrutura deve ser um objeto JSON';
  end if;
  v_erros := fn_socio_validar_estrutura(p_estrutura);
  if p_questionario_id is not null then
    select * into v_q from socio_questionarios where id = p_questionario_id for update;
    if v_q.id is null or v_q.instrumento_id <> p_instrumento then
      raise exception 'socio:nao_encontrado: versão inexistente neste instrumento';
    end if;
    if v_q.status <> 'rascunho' then
      raise exception 'socio:questionario_publicado: versão publicada é imutável; crie uma nova versão';
    end if;
    update socio_questionarios set estrutura = p_estrutura, aviso_entrevistado = btrim(p_aviso)
     where id = v_q.id returning * into v_q;
  else
    perform 1 from socio_instrumentos where id = p_instrumento for update;
    insert into socio_questionarios (instrumento_id, versao, estrutura, aviso_entrevistado, criado_por)
    values (p_instrumento,
            coalesce((select max(versao) from socio_questionarios where instrumento_id = p_instrumento), 0) + 1,
            p_estrutura, btrim(p_aviso), v_uid)
    returning * into v_q;
  end if;
  return jsonb_build_object('id', v_q.id, 'versao', v_q.versao, 'status', v_q.status,
                            'hash_sha256', v_q.hash_sha256, 'erros', to_jsonb(v_erros));
end $$;

create or replace function public.socio_publicar_versao(p_questionario_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid   uuid := fn_socio_uid_ativo();
  v_q     socio_questionarios;
  v_erros text[];
begin
  select * into v_q from socio_questionarios where id = p_questionario_id for update;
  if v_q.id is null then raise exception 'socio:nao_encontrado: versão inexistente'; end if;
  if not fn_socio_pode_de(v_uid, v_q.instrumento_id, 'gerir') then
    raise exception 'socio:nao_autorizado: só o gestor do instrumento publica';
  end if;
  if v_q.status <> 'rascunho' then
    raise exception 'socio:questionario_publicado: esta versão já foi publicada';
  end if;
  v_erros := fn_socio_validar_estrutura(v_q.estrutura);
  if cardinality(v_erros) > 0 then
    raise exception 'socio:estrutura_invalida: %', array_to_string(v_erros, '; ');
  end if;
  update socio_questionarios set status = 'publicado' where id = v_q.id returning * into v_q;
  return jsonb_build_object('id', v_q.id, 'versao', v_q.versao, 'hash_sha256', v_q.hash_sha256);
end $$;

create or replace function public.socio_arquivar_versao(p_questionario_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := fn_socio_uid_ativo();
  v_q   socio_questionarios;
begin
  select * into v_q from socio_questionarios where id = p_questionario_id for update;
  if v_q.id is null then raise exception 'socio:nao_encontrado: versão inexistente'; end if;
  if not fn_socio_pode_de(v_uid, v_q.instrumento_id, 'gerir') then
    raise exception 'socio:nao_autorizado: só o gestor do instrumento arquiva';
  end if;
  if v_q.status <> 'publicado' then
    raise exception 'socio:transicao_invalida: só versão publicada é arquivada';
  end if;
  if exists (select 1 from socio_campanhas where questionario_id = v_q.id and situacao = 'aberta') then
    raise exception 'socio:em_uso: encerre as campanhas abertas com esta versão antes de arquivar';
  end if;
  update socio_questionarios set status = 'arquivado' where id = v_q.id;
end $$;

-- ── Papéis (só para quem é do departamento) ─────────────────────────────
create or replace function public.socio_definir_papel(
  p_instrumento uuid, p_usuario uuid, p_papel text, p_ativo boolean, p_justificativa text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_uid  uuid := fn_socio_uid_ativo();
  v_dono uuid;
begin
  select unidade_org_id into v_dono from socio_instrumentos where id = p_instrumento;
  if v_dono is null then raise exception 'socio:nao_encontrado: instrumento inexistente'; end if;
  if p_papel not in ('gestor', 'aplicador', 'leitor') then
    raise exception 'socio:papel_invalido: papel deve ser gestor, aplicador ou leitor';
  end if;
  if not fn_socio_pode_de(v_uid, p_instrumento, 'gerir') then
    -- super_admin corrige papéis, mas sempre com justificativa na trilha
    if not fn_socio_eh_admin(v_uid) then
      raise exception 'socio:nao_autorizado: só o gestor do instrumento define papéis';
    end if;
    if length(btrim(coalesce(p_justificativa, ''))) < 20 then
      raise exception 'socio:justificativa_obrigatoria: explique a correção (mínimo de 20 caracteres)';
    end if;
  end if;
  if coalesce(p_ativo, true) and not fn_socio_no_dept(p_usuario, v_dono) then
    raise exception 'socio:fora_do_departamento: a pessoa não é do departamento dono (sem lotação ou cargo nele); quem é de fora pede acesso';
  end if;
  if coalesce(p_ativo, true) and not exists (select 1 from usuarios where id = p_usuario and ativo) then
    raise exception 'socio:nao_encontrado: usuário inexistente ou inativo';
  end if;
  perform set_config('app.justificativa', coalesce(btrim(p_justificativa), ''), true);
  if coalesce(p_ativo, true) then
    insert into socio_instrumento_membros as m (instrumento_id, usuario_id, papel, designado_por)
    values (p_instrumento, p_usuario, p_papel, v_uid)
    on conflict on constraint uq_socio_membro do update
      set ativo = true, designado_por = v_uid, designado_em = now(), removido_por = null, removido_em = null
      where not m.ativo;
  else
    update socio_instrumento_membros set ativo = false, removido_por = v_uid, removido_em = now()
     where instrumento_id = p_instrumento and usuario_id = p_usuario and papel = p_papel and ativo;
    -- quem deixa de aplicar sai das campanhas do instrumento
    if p_papel = 'aplicador' and not fn_socio_pode_de(p_usuario, p_instrumento, 'aplicar') then
      update socio_campanha_aplicadores ca set ativo = false
        from socio_campanhas c
       where c.id = ca.campanha_id and c.instrumento_id = p_instrumento and ca.usuario_id = p_usuario and ca.ativo;
    end if;
  end if;
  perform set_config('app.justificativa', '', true);
end $$;

-- membros do departamento dono (para o gestor escolher) — só nome e e-mail
create or replace function public.socio_pessoas_do_departamento(p_instrumento uuid)
returns table (usuario_id uuid, nome text, email text, papeis text[], e_chefe boolean)
language plpgsql stable security definer set search_path = public as $$
declare
  v_uid  uuid := fn_socio_uid_ativo();
  v_dono uuid;
begin
  if not (fn_socio_pode_de(v_uid, p_instrumento, 'gerir') or fn_socio_eh_admin(v_uid)) then
    raise exception 'socio:nao_autorizado: só o gestor do instrumento vê a equipe';
  end if;
  select unidade_org_id into v_dono from socio_instrumentos where id = p_instrumento;
  return query
  select u.id, u.nome_completo, u.email,
         array(select m.papel from socio_instrumento_membros m
                where m.instrumento_id = p_instrumento and m.usuario_id = u.id and m.ativo order by m.papel),
         fn_socio_chefe(u.id, v_dono)
    from usuarios u
   where u.ativo and fn_socio_no_dept(u.id, v_dono)
   order by u.nome_completo;
end $$;

-- ── Pedidos de acesso (outro departamento) ──────────────────────────────
create or replace function public.socio_pedir_acesso(
  p_instrumento uuid, p_nivel text, p_justificativa text, p_data_fim date)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_uid  uuid := fn_socio_uid_ativo();
  v_i    socio_instrumentos;
  v_id   uuid;
  v_nome text;
  v_g    uuid;
  v_n    int := 0;
begin
  select * into v_i from socio_instrumentos where id = p_instrumento;
  if v_i.id is null or not v_i.ativo then
    raise exception 'socio:nao_encontrado: instrumento inexistente ou arquivado';
  end if;
  if p_nivel not in ('agregados', 'leitor', 'aplicador') then
    raise exception 'socio:nivel_invalido: escolha agregados, leitor ou aplicador';
  end if;
  if fn_socio_no_dept(v_uid, v_i.unidade_org_id) then
    raise exception 'socio:ja_do_departamento: você é do departamento dono; peça o papel ao gestor do instrumento';
  end if;
  if length(btrim(coalesce(p_justificativa, ''))) < 20 then
    raise exception 'socio:justificativa_obrigatoria: explique para que precisa (mínimo de 20 caracteres)';
  end if;
  if p_data_fim is null or p_data_fim < fn_socio_hoje() or p_data_fim > fn_socio_hoje() + 365 then
    raise exception 'socio:prazo_invalido: o prazo vai de hoje até 1 ano';
  end if;
  if exists (select 1 from socio_acessos where instrumento_id = p_instrumento and usuario_id = v_uid
               and nivel = p_nivel and status = 'aprovado' and data_fim >= fn_socio_hoje()) then
    raise exception 'socio:ja_tem_acesso: você já tem esse acesso em vigor';
  end if;
  if exists (select 1 from socio_acessos where instrumento_id = p_instrumento and usuario_id = v_uid
               and nivel = p_nivel and status = 'pendente') then
    raise exception 'socio:pedido_pendente: já existe um pedido igual aguardando o gestor';
  end if;
  insert into socio_acessos (instrumento_id, usuario_id, nivel, justificativa, data_fim)
  values (p_instrumento, v_uid, p_nivel, btrim(p_justificativa), p_data_fim)
  returning id into v_id;

  select nome_completo into v_nome from usuarios where id = v_uid;
  for v_g in select usuario_id from fn_socio_gestores(p_instrumento) loop
    perform fn_socio_notificar(v_g, 'Pedido de acesso — ' || v_i.codigo,
      coalesce(v_nome, 'Um usuário') || ' pediu acesso (' || p_nivel || ') a "' || v_i.titulo || '" até '
        || to_char(p_data_fim, 'DD/MM/YYYY') || '.',
      jsonb_build_object('subtipo', 'acesso_pedido', 'acesso_id', v_id, 'instrumento_id', p_instrumento));
    v_n := v_n + 1;
  end loop;
  -- departamento sem gestor: avisa o super_admin para designar um
  if v_n = 0 then
    for v_g in select id from usuarios where ativo and perfil = 'super_admin' loop
      perform fn_socio_notificar(v_g, 'Instrumento sem gestor — ' || v_i.codigo,
        'Há pedido de acesso a "' || v_i.titulo || '", mas o departamento dono não tem chefe nem gestor cadastrado. Designe um gestor.',
        jsonb_build_object('subtipo', 'acesso_sem_gestor', 'acesso_id', v_id, 'instrumento_id', p_instrumento));
    end loop;
  end if;
  return v_id;
end $$;

create or replace function public.socio_decidir_acesso(
  p_acesso uuid, p_aprovar boolean, p_parecer text default null, p_data_fim date default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := fn_socio_uid_ativo();
  v_a   socio_acessos;
  v_i   socio_instrumentos;
  v_fim date;
begin
  select * into v_a from socio_acessos where id = p_acesso for update;
  if v_a.id is null then raise exception 'socio:nao_encontrado: pedido inexistente'; end if;
  select * into v_i from socio_instrumentos where id = v_a.instrumento_id;
  if not fn_socio_pode_de(v_uid, v_a.instrumento_id, 'gerir') then
    raise exception 'socio:nao_autorizado: só o gestor do departamento dono decide o pedido';
  end if;
  if v_a.usuario_id = v_uid then
    raise exception 'socio:nao_autorizado: ninguém decide o próprio pedido';
  end if;
  if v_a.status <> 'pendente' then
    raise exception 'socio:transicao_invalida: o pedido já foi %', v_a.status;
  end if;
  if not coalesce(p_aprovar, false) and length(btrim(coalesce(p_parecer, ''))) < 5 then
    raise exception 'socio:parecer_obrigatorio: diga o motivo da recusa';
  end if;
  v_fim := coalesce(p_data_fim, v_a.data_fim);
  if coalesce(p_aprovar, false) and (v_fim > v_a.data_fim or v_fim < fn_socio_hoje()) then
    raise exception 'socio:prazo_invalido: o prazo aprovado vai de hoje até o pedido (%)', to_char(v_a.data_fim, 'DD/MM/YYYY');
  end if;
  update socio_acessos
     set status = case when p_aprovar then 'aprovado' else 'recusado' end,
         parecer = nullif(btrim(coalesce(p_parecer, '')), ''),
         data_fim = case when p_aprovar then v_fim else data_fim end,
         decidido_por = v_uid, decidido_em = now()
   where id = p_acesso;
  perform fn_socio_notificar(v_a.usuario_id,
    case when p_aprovar then 'Acesso aprovado — ' else 'Acesso recusado — ' end || v_i.codigo,
    case when p_aprovar
         then 'Seu acesso (' || v_a.nivel || ') a "' || v_i.titulo || '" vale até ' || to_char(v_fim, 'DD/MM/YYYY') || '.'
         else 'Seu pedido de acesso a "' || v_i.titulo || '" foi recusado: ' || btrim(p_parecer) end,
    jsonb_build_object('subtipo', case when p_aprovar then 'acesso_aprovado' else 'acesso_recusado' end,
                       'acesso_id', v_a.id, 'instrumento_id', v_a.instrumento_id));
end $$;

-- quem pediu cancela o pendente; o gestor revoga o aprovado (com motivo)
create or replace function public.socio_encerrar_acesso(p_acesso uuid, p_motivo text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := fn_socio_uid_ativo();
  v_a   socio_acessos;
  v_i   socio_instrumentos;
begin
  select * into v_a from socio_acessos where id = p_acesso for update;
  if v_a.id is null then raise exception 'socio:nao_encontrado: pedido inexistente'; end if;
  select * into v_i from socio_instrumentos where id = v_a.instrumento_id;
  if v_a.status = 'pendente' and v_a.usuario_id = v_uid then
    update socio_acessos set status = 'cancelado', encerrado_por = v_uid, encerrado_em = now() where id = p_acesso;
    return;
  end if;
  if v_a.status = 'aprovado' and fn_socio_pode_de(v_uid, v_a.instrumento_id, 'gerir') then
    if length(btrim(coalesce(p_motivo, ''))) < 5 then
      raise exception 'socio:parecer_obrigatorio: diga o motivo da revogação';
    end if;
    update socio_acessos set status = 'revogado', parecer = btrim(p_motivo), encerrado_por = v_uid, encerrado_em = now()
     where id = p_acesso;
    perform fn_socio_notificar(v_a.usuario_id, 'Acesso revogado — ' || v_i.codigo,
      'Seu acesso a "' || v_i.titulo || '" foi revogado: ' || btrim(p_motivo),
      jsonb_build_object('subtipo', 'acesso_revogado', 'acesso_id', v_a.id, 'instrumento_id', v_a.instrumento_id));
    if v_a.nivel = 'aplicador' and not fn_socio_pode_de(v_a.usuario_id, v_a.instrumento_id, 'aplicar') then
      update socio_campanha_aplicadores ca set ativo = false
        from socio_campanhas c
       where c.id = ca.campanha_id and c.instrumento_id = v_a.instrumento_id
         and ca.usuario_id = v_a.usuario_id and ca.ativo;
    end if;
    return;
  end if;
  raise exception 'socio:nao_autorizado: só quem pediu cancela o pedido pendente, e só o gestor revoga o aprovado';
end $$;

-- ── Comunidades ─────────────────────────────────────────────────────────
create or replace function public.socio_salvar_comunidade(
  p_nome text, p_cd_mun text, p_uc_id uuid default null, p_id uuid default null, p_ativo boolean default true)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := fn_socio_uid_ativo();
  v_id  uuid;
begin
  if not (fn_socio_eh_admin(v_uid) or exists (
            select 1 from socio_instrumentos i where fn_socio_pode_de(v_uid, i.id, 'gerir'))) then
    raise exception 'socio:nao_autorizado: só gestor de instrumento cadastra comunidade';
  end if;
  if not exists (select 1 from municipios_acre where cd_ibge = p_cd_mun) then
    raise exception 'socio:territorio_invalido: município inexistente';
  end if;
  if p_uc_id is not null and not exists (select 1 from unidades_conservacao where id = p_uc_id) then
    raise exception 'socio:territorio_invalido: UC inexistente';
  end if;
  if exists (select 1 from socio_comunidades where cd_mun = p_cd_mun and lower(btrim(nome)) = lower(btrim(p_nome))
               and id is distinct from p_id) then
    raise exception 'socio:comunidade_repetida: já existe comunidade com esse nome no município';
  end if;
  if p_id is null then
    insert into socio_comunidades (nome, cd_mun, uc_id, criado_por)
    values (btrim(p_nome), p_cd_mun, p_uc_id, v_uid) returning id into v_id;
  else
    update socio_comunidades set nome = btrim(p_nome), cd_mun = p_cd_mun, uc_id = p_uc_id,
           ativo = coalesce(p_ativo, ativo)
     where id = p_id returning id into v_id;
    if v_id is null then raise exception 'socio:nao_encontrado: comunidade inexistente'; end if;
  end if;
  return v_id;
end $$;

-- ── Campanhas ───────────────────────────────────────────────────────────
create or replace function public.socio_salvar_campanha(
  p_id uuid, p_instrumento uuid, p_questionario uuid, p_nome text, p_inicio date, p_fim date,
  p_exige_municipio boolean, p_exige_uc boolean, p_municipios text[] default '{}', p_ucs uuid[] default '{}')
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := fn_socio_uid_ativo();
  v_c   socio_campanhas;
  v_id  uuid;
begin
  if not fn_socio_pode_de(v_uid, p_instrumento, 'gerir') then
    raise exception 'socio:nao_autorizado: só o gestor do instrumento cria campanha';
  end if;
  if not exists (select 1 from socio_questionarios where id = p_questionario
                   and instrumento_id = p_instrumento and status = 'publicado') then
    raise exception 'socio:questionario_invalido: escolha uma versão PUBLICADA deste instrumento';
  end if;
  if p_inicio is null or p_fim is null or p_fim < p_inicio then
    raise exception 'socio:prazo_invalido: o fim não pode ser antes do início';
  end if;
  if exists (select 1 from unnest(coalesce(p_municipios, '{}')) m
              where not exists (select 1 from municipios_acre where cd_ibge = m)) then
    raise exception 'socio:territorio_invalido: município inexistente na lista';
  end if;
  if exists (select 1 from unnest(coalesce(p_ucs, '{}')) u
              where not exists (select 1 from unidades_conservacao where id = u)) then
    raise exception 'socio:territorio_invalido: UC inexistente na lista';
  end if;
  if p_id is null then
    insert into socio_campanhas (instrumento_id, questionario_id, nome, inicio, fim, exige_municipio, exige_uc,
                                 municipios, ucs, criado_por)
    values (p_instrumento, p_questionario, btrim(p_nome), p_inicio, p_fim, coalesce(p_exige_municipio, true),
            coalesce(p_exige_uc, false), coalesce(p_municipios, '{}'), coalesce(p_ucs, '{}'), v_uid)
    returning id into v_id;
  else
    select * into v_c from socio_campanhas where id = p_id for update;
    if v_c.id is null or v_c.instrumento_id <> p_instrumento then
      raise exception 'socio:nao_encontrado: campanha inexistente neste instrumento';
    end if;
    if v_c.situacao = 'encerrada' then
      raise exception 'socio:transicao_invalida: campanha encerrada não se edita';
    end if;
    if exists (select 1 from socio_fichas where campanha_id = p_id)
       and (p_questionario <> v_c.questionario_id or p_inicio > v_c.inicio) then
      raise exception 'socio:em_uso: com fichas enviadas, a versão e o início não mudam';
    end if;
    update socio_campanhas set questionario_id = p_questionario, nome = btrim(p_nome), inicio = p_inicio, fim = p_fim,
           exige_municipio = coalesce(p_exige_municipio, exige_municipio), exige_uc = coalesce(p_exige_uc, exige_uc),
           municipios = coalesce(p_municipios, '{}'), ucs = coalesce(p_ucs, '{}')
     where id = p_id returning id into v_id;
  end if;
  return v_id;
end $$;

create or replace function public.socio_situacao_campanha(p_id uuid, p_situacao text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := fn_socio_uid_ativo();
  v_c   socio_campanhas;
begin
  select * into v_c from socio_campanhas where id = p_id for update;
  if v_c.id is null then raise exception 'socio:nao_encontrado: campanha inexistente'; end if;
  if not fn_socio_pode_de(v_uid, v_c.instrumento_id, 'gerir') then
    raise exception 'socio:nao_autorizado: só o gestor do instrumento abre ou encerra campanha';
  end if;
  if not ((v_c.situacao = 'planejada' and p_situacao in ('aberta', 'encerrada'))
       or (v_c.situacao = 'aberta' and p_situacao = 'encerrada')
       or (v_c.situacao = 'encerrada' and p_situacao = 'aberta')) then
    raise exception 'socio:transicao_invalida: % → %', v_c.situacao, p_situacao;
  end if;
  if p_situacao = 'aberta' then
    if v_c.fim < fn_socio_hoje() then
      raise exception 'socio:prazo_invalido: o período da campanha já terminou; ajuste o fim antes de abrir';
    end if;
    if not exists (select 1 from socio_questionarios where id = v_c.questionario_id and status = 'publicado') then
      raise exception 'socio:questionario_invalido: a versão da campanha não está publicada';
    end if;
  end if;
  update socio_campanhas set situacao = p_situacao where id = p_id;
end $$;

create or replace function public.socio_definir_aplicador(p_campanha uuid, p_usuario uuid, p_incluir boolean)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := fn_socio_uid_ativo();
  v_c   socio_campanhas;
begin
  select * into v_c from socio_campanhas where id = p_campanha;
  if v_c.id is null then raise exception 'socio:nao_encontrado: campanha inexistente'; end if;
  if not fn_socio_pode_de(v_uid, v_c.instrumento_id, 'gerir') then
    raise exception 'socio:nao_autorizado: só o gestor do instrumento escala a equipe';
  end if;
  if coalesce(p_incluir, true) then
    if not fn_socio_pode_de(p_usuario, v_c.instrumento_id, 'aplicar') then
      raise exception 'socio:sem_papel_aplicador: a pessoa precisa ser aplicadora do instrumento (ou ter acesso de aplicador aprovado)';
    end if;
    insert into socio_campanha_aplicadores as a (campanha_id, usuario_id, incluido_por)
    values (p_campanha, p_usuario, v_uid)
    on conflict (campanha_id, usuario_id) do update set ativo = true, incluido_por = v_uid, incluido_em = now()
      where not a.ativo;
  else
    update socio_campanha_aplicadores set ativo = false where campanha_id = p_campanha and usuario_id = p_usuario;
  end if;
end $$;

-- ── Envio da ficha (app de campo) ───────────────────────────────────────
-- Idempotente por uuid_cliente: reenviar a mesma ficha atualiza, nunca
-- duplica. Ficha + identificação + fotos numa transação só.
create or replace function public.socio_enviar_ficha(
  p_ficha jsonb, p_linhas jsonb default '[]'::jsonb, p_fotos jsonb default '[]'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid       uuid := fn_socio_uid_ativo();
  v_treino    boolean := coalesce((p_ficha->>'treino')::boolean, false);
  v_aceitou   boolean := coalesce((p_ficha->>'aceitou_participar')::boolean, false);
  v_q         socio_questionarios;
  v_i         socio_instrumentos;
  v_c         socio_campanhas;
  v_exist     socio_fichas;
  v_final     timestamptz;
  v_dia       date;
  v_uuid_cli  uuid;
  v_codigo    text := p_ficha->>'codigo';
  v_carencia  boolean := false;
  v_linhas    jsonb := '[]'::jsonb;
  v_pub       jsonb := '[]'::jsonb;
  v_ident     jsonb := '[]'::jsonb;
  v_idcols    text[];
  v_resp      jsonb := '{}'::jsonb;
  v_alertas   jsonb;
  v_ficha_id  uuid;
  v_cd_mun    text := nullif(btrim(p_ficha->>'cd_mun'), '');
  v_uc        uuid := nullif(p_ficha->>'uc_id', '')::uuid;
  v_com       uuid := nullif(p_ficha->>'comunidade_id', '')::uuid;
  v_com_nova  text := nullif(btrim(p_ficha->>'comunidade_nova'), '');
  v_nome      text := nullif(btrim(p_ficha->>'entrevistado_nome'), '');
  v_status_ant text;
  l           jsonb;
  k           text;
  v_lp        jsonb;
  v_li        jsonb;
  f           jsonb;
begin
  v_final := (p_ficha->>'finalizada_em')::timestamptz;
  if v_final is null or v_final > now() + interval '1 day' then
    raise exception 'socio:ficha_invalida: finalizada_em ausente ou no futuro';
  end if;
  v_dia := (v_final at time zone 'America/Rio_Branco')::date;
  v_uuid_cli := (p_ficha->>'uuid_cliente')::uuid;
  if v_uuid_cli is null then
    raise exception 'socio:ficha_invalida: uuid_cliente ausente';
  end if;

  select * into v_q from socio_questionarios where id = (p_ficha->>'questionario_id')::uuid;
  if v_q.id is null then
    raise exception 'socio:questionario_invalido: versão do questionário inexistente';
  end if;
  select * into v_i from socio_instrumentos where id = v_q.instrumento_id;

  if v_treino then
    -- treino: aplicador ou gestor; aceita rascunho (testar antes de publicar)
    if not fn_socio_pode_de(v_uid, v_i.id, 'treinar') then
      raise exception 'socio:nao_autorizado: modo treino só para aplicador ou gestor deste instrumento';
    end if;
    if v_q.status = 'arquivado' then
      raise exception 'socio:questionario_invalido: versão arquivada';
    end if;
    if p_ficha ? 'campanha_id' and nullif(p_ficha->>'campanha_id', '') is not null then
      select * into v_c from socio_campanhas where id = (p_ficha->>'campanha_id')::uuid and instrumento_id = v_i.id;
    end if;
  else
    if v_q.status = 'rascunho' then
      raise exception 'socio:questionario_invalido: versão do questionário não publicada';
    end if;
    select * into v_c from socio_campanhas where id = nullif(p_ficha->>'campanha_id', '')::uuid;
    if v_c.id is null or v_c.instrumento_id <> v_i.id or v_c.questionario_id <> v_q.id then
      raise exception 'socio:campanha_invalida: a ficha não pertence a esta campanha';
    end if;
    if v_c.situacao = 'planejada' then
      raise exception 'socio:campanha_invalida: a campanha ainda não foi aberta';
    end if;
    if v_dia < v_c.inicio or v_dia > v_c.fim then
      raise exception 'socio:fora_do_periodo: a entrevista foi concluída fora do período da campanha';
    end if;
    if not exists (select 1 from socio_campanha_aplicadores
                    where campanha_id = v_c.id and usuario_id = v_uid and ativo) then
      raise exception 'socio:nao_autorizado: você não está na equipe desta campanha';
    end if;
    -- aplicar agora, com a campanha aberta e no prazo; senão, carência de
    -- 15 dias para a ficha concluída a tempo (sinal fraco em campo)
    if not (fn_socio_pode_de(v_uid, v_i.id, 'aplicar') and v_c.situacao = 'aberta' and fn_socio_hoje() <= v_c.fim) then
      if not (fn_socio_pode_de(v_uid, v_i.id, 'aplicar')
              or exists (select 1 from socio_acessos a where a.instrumento_id = v_i.id and a.usuario_id = v_uid
                           and a.nivel = 'aplicador' and a.status in ('aprovado', 'revogado')
                           and a.decidido_em <= v_final and a.data_fim >= v_dia
                           and coalesce(a.encerrado_em, 'infinity') >= v_final
                           and fn_socio_hoje() <= a.data_fim + 15)) then
        raise exception 'socio:sem_permissao: seu acesso de aplicador terminou';
      end if;
      if fn_socio_hoje() > v_c.fim + 15 then
        raise exception 'socio:campanha_encerrada: passou o prazo de envio (15 dias após o fim)';
      end if;
      v_carencia := true;
    end if;
  end if;

  select * into v_exist from socio_fichas where uuid_cliente = v_uuid_cli for update;
  if v_exist.id is not null then
    if v_exist.entrevistador_id <> v_uid then
      raise exception 'socio:nao_autorizado: ficha de outro entrevistador';
    end if;
    if v_exist.status not in ('enviada', 'devolvida') then
      raise exception 'socio:ja_%: a ficha já foi % pelo gestor', v_exist.status, v_exist.status;
    end if;
    if v_exist.treino <> v_treino or v_exist.questionario_id <> v_q.id
       or v_exist.campanha_id is distinct from v_c.id then
      raise exception 'socio:ficha_invalida: treino, versão e campanha da ficha não mudam';
    end if;
  end if;

  if v_aceitou then
    v_linhas := fn_socio_linhas_normalizar(v_q.estrutura, p_linhas);
    v_resp := fn_socio_normalizar_respostas(v_q.estrutura, p_ficha->'respostas', v_linhas);
  end if;

  -- território (UC opcional; a campanha decide o que é obrigatório)
  if v_cd_mun is not null and not exists (select 1 from municipios_acre where cd_ibge = v_cd_mun) then
    raise exception 'socio:territorio_invalido: município inexistente';
  end if;
  if v_uc is not null and not exists (select 1 from unidades_conservacao where id = v_uc) then
    raise exception 'socio:territorio_invalido: UC inexistente';
  end if;
  if v_c.id is not null and not v_treino then
    if v_c.exige_municipio and v_cd_mun is null then
      raise exception 'socio:territorio_invalido: informe o município';
    end if;
    if v_c.exige_uc and v_uc is null then
      raise exception 'socio:territorio_invalido: informe a UC';
    end if;
    if cardinality(v_c.municipios) > 0 and v_cd_mun is not null and not (v_cd_mun = any(v_c.municipios)) then
      raise exception 'socio:territorio_invalido: município fora da campanha';
    end if;
    if cardinality(v_c.ucs) > 0 and v_uc is not null and not (v_uc = any(v_c.ucs)) then
      raise exception 'socio:territorio_invalido: UC fora da campanha';
    end if;
  end if;
  if v_com is not null then
    if not exists (select 1 from socio_comunidades where id = v_com and (v_cd_mun is null or cd_mun = v_cd_mun)) then
      raise exception 'socio:territorio_invalido: comunidade inexistente ou de outro município';
    end if;
    v_com_nova := null;
  end if;

  -- identificação: só o que o instrumento pede
  if v_nome is not null and coalesce(v_q.estrutura->'identificacao'->>'nome', 'nao') <> 'opcional' then
    raise exception 'socio:ficha_invalida: este questionário não registra o nome do entrevistado';
  end if;
  if (p_ficha->>'lat') is not null and coalesce(v_q.estrutura->'identificacao'->>'gps', 'nao') <> 'opcional' then
    raise exception 'socio:ficha_invalida: este questionário não registra a localização';
  end if;
  if not v_aceitou then
    v_nome := null;
  end if;

  -- separa as colunas de identificação da lista
  v_idcols := array(select c->>'chave' from jsonb_array_elements(coalesce(v_q.estrutura->'lista'->'colunas', '[]'::jsonb)) c
                     where coalesce((c->>'identificacao')::boolean, false));
  for l in select * from jsonb_array_elements(v_linhas) loop
    v_lp := '{}'::jsonb;
    v_li := jsonb_build_object('ordem', l->'ordem');
    for k in select jsonb_object_keys(l) loop
      if k = any(v_idcols) then v_li := v_li || jsonb_build_object(k, l->k);
      else v_lp := v_lp || jsonb_build_object(k, l->k); end if;
    end loop;
    v_pub := v_pub || jsonb_build_array(v_lp);
    if v_li - 'ordem' <> '{}'::jsonb then v_ident := v_ident || jsonb_build_array(v_li); end if;
  end loop;

  v_alertas := fn_socio_calcular_alertas(v_q.estrutura, v_resp, v_linhas, v_carencia, v_com_nova is not null);

  if v_treino <> coalesce(v_codigo like 'TRE-%', false) then
    raise exception 'socio:ficha_invalida: código de treino começa com TRE- (e só ele)';
  end if;
  if not v_treino and v_codigo not like v_i.codigo || '-%' then
    raise exception 'socio:ficha_invalida: o código da ficha começa com %-', v_i.codigo;
  end if;
  if exists (select 1 from socio_fichas where codigo = v_codigo and uuid_cliente <> v_uuid_cli) then
    raise exception 'socio:codigo_duplicado: gere um novo código e reenvie';
  end if;

  v_status_ant := v_exist.status;
  insert into socio_fichas as d (
    uuid_cliente, codigo, instrumento_id, questionario_id, campanha_id, treino, cd_mun, uc_id,
    comunidade_id, comunidade_nova, dt_entrevista, iniciada_em, finalizada_em, entrevistador_id,
    aviso_lido, aceitou_participar, fotos_autorizadas, respostas, linhas, alertas, status, usou_carencia,
    app_versao, dispositivo_id)
  values (
    v_uuid_cli, v_codigo, v_i.id, v_q.id, v_c.id, v_treino, v_cd_mun, v_uc, v_com, v_com_nova,
    coalesce((p_ficha->>'dt_entrevista')::date, v_dia), (p_ficha->>'iniciada_em')::timestamptz, v_final, v_uid,
    coalesce((p_ficha->>'aviso_lido')::boolean, false), v_aceitou,
    case when v_aceitou then (p_ficha->>'fotos_autorizadas')::boolean end,
    v_resp, v_pub, v_alertas, 'enviada', v_carencia, p_ficha->>'app_versao', p_ficha->>'dispositivo_id')
  on conflict on constraint uq_socio_fichas_uuid_cliente do update set
    codigo = excluded.codigo, cd_mun = excluded.cd_mun, uc_id = excluded.uc_id,
    comunidade_id = excluded.comunidade_id, comunidade_nova = excluded.comunidade_nova,
    dt_entrevista = excluded.dt_entrevista, iniciada_em = excluded.iniciada_em,
    finalizada_em = excluded.finalizada_em, aviso_lido = excluded.aviso_lido,
    aceitou_participar = excluded.aceitou_participar, fotos_autorizadas = excluded.fotos_autorizadas,
    respostas = excluded.respostas, linhas = excluded.linhas, alertas = excluded.alertas,
    status = 'enviada', motivo_devolucao = null,
    usou_carencia = d.usou_carencia or excluded.usou_carencia,
    app_versao = excluded.app_versao, dispositivo_id = excluded.dispositivo_id, enviado_em = now()
  returning id into v_ficha_id;

  -- identificação: grava se houver algo; senão esvazia a linha existente
  if v_nome is not null or (v_aceitou and (p_ficha->>'lat') is not null)
     or nullif(btrim(p_ficha->>'obs_localizacao'), '') is not null or jsonb_array_length(v_ident) > 0 then
    insert into socio_fichas_identificacao as i (ficha_id, entrevistado_nome, lat, lon, gps_precisao_m, gps_em,
                                                 obs_localizacao, linhas)
    values (v_ficha_id, v_nome,
            case when v_aceitou then (p_ficha->>'lat')::numeric end, case when v_aceitou then (p_ficha->>'lon')::numeric end,
            (p_ficha->>'gps_precisao_m')::numeric, (p_ficha->>'gps_em')::timestamptz,
            nullif(btrim(p_ficha->>'obs_localizacao'), ''), v_ident)
    on conflict (ficha_id) do update set
      entrevistado_nome = excluded.entrevistado_nome, lat = excluded.lat, lon = excluded.lon,
      gps_precisao_m = excluded.gps_precisao_m, gps_em = excluded.gps_em,
      obs_localizacao = excluded.obs_localizacao, linhas = excluded.linhas, atualizado_em = now();
  else
    update socio_fichas_identificacao
       set entrevistado_nome = null, lat = null, lon = null, gps_precisao_m = null, gps_em = null,
           obs_localizacao = null, linhas = '[]'::jsonb, atualizado_em = now()
     where ficha_id = v_ficha_id;
  end if;

  -- fotos: o arquivo já subiu para socio-fotos/<uuid_cliente da ficha>/…
  if v_aceitou then
    if (p_ficha->>'fotos_autorizadas')::boolean is not true and jsonb_array_length(coalesce(p_fotos, '[]')) > 0 then
      raise exception 'socio:fotos_nao_autorizadas: a família não autorizou fotos nesta ficha';
    end if;
    for f in select * from jsonb_array_elements(coalesce(p_fotos, '[]')) loop
      if (f->>'arquivo_url') !~ ('/socio-fotos/' || v_uuid_cli::text || '/[^/]+$') then
        raise exception 'socio:foto_invalida: caminho da foto não pertence a esta ficha';
      end if;
      insert into socio_fotos (ficha_id, uuid_cliente, tema, pergunta_chave, legenda, arquivo_url, tirada_em,
                               lat, lon, gps_precisao_m, criado_por)
      values (v_ficha_id, (f->>'uuid_cliente')::uuid, coalesce(f->>'tema', 'outro'), nullif(f->>'pergunta_chave', ''),
              nullif(btrim(f->>'legenda'), ''), f->>'arquivo_url', (f->>'tirada_em')::timestamptz,
              (f->>'lat')::numeric, (f->>'lon')::numeric, (f->>'gps_precisao_m')::numeric, v_uid)
      on conflict on constraint uq_socio_fotos_uuid_cliente do update set
        tema = excluded.tema, pergunta_chave = excluded.pergunta_chave, legenda = excluded.legenda
      where socio_fotos.ficha_id = v_ficha_id;
    end loop;
    if (select count(*) from socio_fotos where ficha_id = v_ficha_id) > 8 then
      raise exception 'socio:foto_invalida: máximo de 8 fotos por ficha';
    end if;
  end if;

  return jsonb_build_object('id', v_ficha_id, 'codigo', v_codigo, 'status', 'enviada',
                            'alertas', v_alertas, 'usou_carencia', v_carencia,
                            'status_anterior', v_status_ant, 'treino', v_treino);
end $$;

-- ── Validação pela mesa (gestor) ────────────────────────────────────────
create or replace function public.socio_mudar_status(p_ficha_id uuid, p_status text, p_motivo text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := fn_socio_uid_ativo();
  v_f   socio_fichas;
begin
  select * into v_f from socio_fichas where id = p_ficha_id for update;
  if v_f.id is null then raise exception 'socio:nao_encontrado: ficha inexistente'; end if;
  if not fn_socio_pode_de(v_uid, v_f.instrumento_id, 'gerir') then
    raise exception 'socio:nao_autorizado: só o gestor do instrumento valida, devolve ou descarta';
  end if;
  if v_f.treino then
    raise exception 'socio:treino: ficha de treino não passa por validação';
  end if;
  if p_status in ('devolvida', 'descartada') and length(btrim(coalesce(p_motivo, ''))) < 5 then
    raise exception 'socio:motivo_obrigatorio: informe o motivo';
  end if;
  if not ((v_f.status = 'enviada'   and p_status in ('validada', 'devolvida', 'descartada'))
       or (v_f.status = 'devolvida' and p_status = 'descartada')
       or (v_f.status = 'validada'  and p_status = 'devolvida')) then
    raise exception 'socio:transicao_invalida: % → %', v_f.status, p_status;
  end if;
  perform set_config('socio.motivo', coalesce(p_motivo, ''), true);
  update socio_fichas set
    status = p_status,
    motivo_devolucao = case when p_status = 'devolvida' then btrim(p_motivo) else motivo_devolucao end,
    validado_por  = case when p_status = 'validada' then v_uid when p_status = 'devolvida' then null else validado_por end,
    validado_em   = case when p_status = 'validada' then now() when p_status = 'devolvida' then null else validado_em end,
    descartado_em = case when p_status = 'descartada' then now() else descartado_em end
  where id = p_ficha_id
  returning * into v_f;
  perform set_config('socio.motivo', '', true);
  if p_status = 'devolvida' then
    perform fn_socio_notificar(v_f.entrevistador_id, 'Ficha devolvida — ' || v_f.codigo,
      'A ficha ' || v_f.codigo || ' voltou para correção: ' || btrim(p_motivo),
      jsonb_build_object('subtipo', 'ficha_devolvida', 'ficha_id', v_f.id));
  end if;
  return jsonb_build_object('id', v_f.id, 'status', v_f.status);
end $$;

-- ── Permissões de execução ──────────────────────────────────────────────
do $$
declare f text;
begin
  -- internos: nenhum cliente chama
  foreach f in array array['fn_socio_uid_ativo()', 'fn_socio_eh_admin(uuid)', 'fn_socio_gestores(uuid)',
                           'fn_socio_notificar(uuid, text, text, jsonb)'] loop
    execute format('revoke execute on function public.%s from public, anon, authenticated', f);
  end loop;
  -- RPCs: só logado (cada uma confere o acesso por dentro)
  foreach f in array array['socio_catalogo()', 'socio_meus_departamentos()',
    'socio_criar_instrumento(text, text, text, text, uuid)',
    'socio_atualizar_instrumento(uuid, text, text, text, boolean)',
    'socio_transferir_instrumento(uuid, uuid, text)',
    'socio_salvar_versao(uuid, jsonb, text, uuid)', 'socio_publicar_versao(uuid)', 'socio_arquivar_versao(uuid)',
    'socio_definir_papel(uuid, uuid, text, boolean, text)', 'socio_pessoas_do_departamento(uuid)',
    'socio_pedir_acesso(uuid, text, text, date)', 'socio_decidir_acesso(uuid, boolean, text, date)',
    'socio_encerrar_acesso(uuid, text)',
    'socio_salvar_comunidade(text, text, uuid, uuid, boolean)',
    'socio_salvar_campanha(uuid, uuid, uuid, text, date, date, boolean, boolean, text[], uuid[])',
    'socio_situacao_campanha(uuid, text)', 'socio_definir_aplicador(uuid, uuid, boolean)',
    'socio_enviar_ficha(jsonb, jsonb, jsonb)', 'socio_mudar_status(uuid, text, text)'] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
