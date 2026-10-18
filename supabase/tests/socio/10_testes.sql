-- ════════════════════════════════════════════════════════════════════════
-- Testes do Diagnóstico Socioeconômico (362*): acesso por departamento,
-- pedidos de acesso, versões, campanhas, envio e validação de fichas.
-- Roda como `authenticated` com auth.uid() trocado por pg_temp.como().
-- ════════════════════════════════════════════════════════════════════════
\set ON_ERROR_STOP 1

-- ── Cenário ─────────────────────────────────────────────────────────────
--   SEC (secretaria) > DIMA (diretoria) > DEUC (depto) > DUC (divisão)
--                                       > DEBIO (depto)
insert into municipios_acre values ('1200401', 'Rio Branco'), ('1200203', 'Cruzeiro do Sul'), ('1200302', 'Feijó');
insert into unidades_conservacao (id, nome) values ('00000000-0000-0000-0000-0000000000c1', 'APA Lago do Amapá');
insert into unidades_organizacionais (id, sigla, nome, tipo, pai_id) values
  ('00000000-0000-0000-0000-00000000a001', 'SEC',   'Secretaria', 'secretaria', null),
  ('00000000-0000-0000-0000-00000000a002', 'DIMA',  'Diretoria de Meio Ambiente', 'diretoria', '00000000-0000-0000-0000-00000000a001'),
  ('00000000-0000-0000-0000-00000000a003', 'DEUC',  'Departamento de UCs', 'departamento', '00000000-0000-0000-0000-00000000a002'),
  ('00000000-0000-0000-0000-00000000a004', 'DUC',   'Divisão de UCs', 'divisao', '00000000-0000-0000-0000-00000000a003'),
  ('00000000-0000-0000-0000-00000000a005', 'DEBIO', 'Departamento de Biodiversidade', 'departamento', '00000000-0000-0000-0000-00000000a002');
insert into usuarios (id, nome_completo, email, perfil, ativo) values
  ('00000000-0000-0000-0000-0000000000a1', 'Chefe DEUC',   'chefe@x', 'chefe_departamento', true),
  ('00000000-0000-0000-0000-0000000000a2', 'Técnica DUC',  'tduc@x',  'tecnico', true),   -- lotada na DIVISÃO
  ('00000000-0000-0000-0000-0000000000a3', 'Técnico DEUC', 'tdeuc@x', 'tecnico', true),
  ('00000000-0000-0000-0000-0000000000a4', 'Diretor DIMA', 'dir@x',   'diretor', true),
  ('00000000-0000-0000-0000-0000000000a5', 'Técnica DEBIO','tdebio@x','tecnico', true),
  ('00000000-0000-0000-0000-0000000000a6', 'Sem Lotação',  'sem@x',   'tecnico', true),
  ('00000000-0000-0000-0000-0000000000a7', 'Admin',        'adm@x',   'super_admin', true),
  ('00000000-0000-0000-0000-0000000000a8', 'Inativo DEUC', 'ina@x',   'tecnico', false);
insert into cargos (id, unidade_org_id, denominacao) values
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-00000000a003', 'Chefe do DEUC'),
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-00000000a002', 'Diretor DIMA'),
  ('00000000-0000-0000-0000-0000000000b3', '00000000-0000-0000-0000-00000000a005', 'Chefe do DEBIO');
insert into cargo_ocupacoes (cargo_id, usuario_id) values
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a1'),
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000a4');
insert into usuario_lotacoes (usuario_id, unidade_org_id) values
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-00000000a004'),
  ('00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-00000000a003'),
  ('00000000-0000-0000-0000-0000000000a5', '00000000-0000-0000-0000-00000000a005'),
  ('00000000-0000-0000-0000-0000000000a8', '00000000-0000-0000-0000-00000000a003');

-- ── Utilitários de teste ────────────────────────────────────────────────
create table public.t_ids (nome text primary key, id uuid);
grant select, insert, update on public.t_ids to authenticated;

create function pg_temp.u(p text) returns uuid language sql as $$
  select case p when 'chefe' then '00000000-0000-0000-0000-0000000000a1' when 'tduc' then '00000000-0000-0000-0000-0000000000a2'
    when 'tdeuc' then '00000000-0000-0000-0000-0000000000a3' when 'dir' then '00000000-0000-0000-0000-0000000000a4'
    when 'tdebio' then '00000000-0000-0000-0000-0000000000a5' when 'sem' then '00000000-0000-0000-0000-0000000000a6'
    when 'admin' then '00000000-0000-0000-0000-0000000000a7' when 'inativo' then '00000000-0000-0000-0000-0000000000a8' end::uuid
$$;
create function pg_temp.como(p text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(pg_temp.u(p)::text, ''), false);
  execute 'set role authenticated';
end $$;
create function pg_temp.raiz() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', '', false);
end $$;
create function pg_temp.ok(c boolean, msg text) returns void language plpgsql as $$
begin
  if c is distinct from true then raise exception 'FALHOU: %', msg; end if;
end $$;
-- executa como `quem` e exige erro com o código
create function pg_temp.erro(quem text, sql text, codigo text) returns void language plpgsql as $$
declare m text;
begin
  perform pg_temp.como(quem);
  begin
    execute sql;
  exception when others then
    m := sqlerrm;
  end;
  perform pg_temp.raiz();
  if m is null then raise exception 'FALHOU: esperava erro % e passou: %', codigo, sql; end if;
  if position(codigo in m) = 0 then raise exception 'FALHOU: esperava % e veio "%" em: %', codigo, m, sql; end if;
end $$;
create function pg_temp.id(n text) returns uuid language sql as $$ select id from public.t_ids where nome = n $$;
create function pg_temp.guarda(n text, v uuid) returns void language sql as $$
  insert into public.t_ids values (n, v) on conflict (nome) do update set id = excluded.id
$$;
create function pg_temp.est(n text) returns jsonb language sql as $$ select estrutura from public.teste_estruturas where nome = n $$;
-- quantas linhas `quem` enxerga numa tabela
create function pg_temp.conta(quem text, tabela text) returns int language plpgsql as $$
declare n int;
begin
  perform pg_temp.como(quem);
  execute format('select count(*) from public.%I', tabela) into n;
  perform pg_temp.raiz();
  return n;
end $$;
grant execute on all functions in schema pg_temp to authenticated;

-- ── 1. Criar instrumento: só quem é do departamento ─────────────────────
select pg_temp.como('tduc');   -- lotada na divisão: é do DEUC por herança
select pg_temp.guarda('dsa', socio_criar_instrumento('dsa', 'Diagnóstico de domicílios', 'Conhecer as famílias das UCs estaduais.',
                                                     'domicilio', '00000000-0000-0000-0000-00000000a003'));
select pg_temp.raiz();
select pg_temp.ok((select codigo from socio_instrumentos where id = pg_temp.id('dsa')) = 'DSA', 'código vira maiúsculo');
select pg_temp.ok(exists (select 1 from socio_instrumento_membros where instrumento_id = pg_temp.id('dsa')
                            and usuario_id = pg_temp.u('tduc') and papel = 'gestor'), 'quem cria nasce gestor');
select pg_temp.erro('tdebio', $$select socio_criar_instrumento('XYZ','Outro depto','Finalidade qualquer aqui.','pessoa','00000000-0000-0000-0000-00000000a003')$$, 'socio:nao_autorizado');
select pg_temp.erro('sem',    $$select socio_criar_instrumento('XYZ','Sem lotação','Finalidade qualquer aqui.','pessoa','00000000-0000-0000-0000-00000000a003')$$, 'socio:nao_autorizado');
select pg_temp.erro('tdeuc',  $$select socio_criar_instrumento('DSA','Repetido','Finalidade qualquer aqui.','pessoa','00000000-0000-0000-0000-00000000a003')$$, 'socio:codigo_em_uso');
select pg_temp.erro('tdeuc',  $$select socio_criar_instrumento('TRE','Treino','Finalidade qualquer aqui.','pessoa','00000000-0000-0000-0000-00000000a003')$$, 'socio:codigo_invalido');
select pg_temp.erro('inativo',$$select socio_criar_instrumento('INA','Inativo','Finalidade qualquer aqui.','pessoa','00000000-0000-0000-0000-00000000a003')$$, 'socio:sem_sessao');
select pg_temp.erro('',       $$select socio_catalogo()$$, 'socio:sem_sessao');
-- super_admin cria para qualquer unidade, mas não vira gestor
select pg_temp.como('admin');
select pg_temp.guarda('pesca', socio_criar_instrumento('PESCA', 'Pesca artesanal', 'Mapear a pesca de subsistência.', 'pessoa',
                                                       '00000000-0000-0000-0000-00000000a005'));
select pg_temp.raiz();
select pg_temp.ok(not exists (select 1 from socio_instrumento_membros where instrumento_id = pg_temp.id('pesca')), 'admin não vira gestor');

-- ── 2. Catálogo × visibilidade ──────────────────────────────────────────
select pg_temp.como('tdebio');
select pg_temp.ok((select count(*) from socio_catalogo()) = 2, 'catálogo mostra todos os instrumentos a quem está logado');
select pg_temp.ok((select not pode_ver from socio_catalogo() where codigo = 'DSA'), 'DEBIO não vê o DSA sem pedir');
select pg_temp.raiz();
select pg_temp.ok(pg_temp.conta('tdebio', 'socio_instrumentos') = 1, 'DEBIO enxerga só o próprio instrumento (PESCA)');
select pg_temp.ok(pg_temp.conta('tdeuc',  'socio_instrumentos') = 1, 'membro do DEUC enxerga o DSA');
select pg_temp.ok(pg_temp.conta('dir',    'socio_instrumentos') = 2, 'chefia acima (DIMA) enxerga os dois');
select pg_temp.ok(pg_temp.conta('sem',    'socio_instrumentos') = 0, 'sem lotação não enxerga nada');
select pg_temp.ok(pg_temp.conta('admin',  'socio_instrumentos') = 2, 'super_admin enxerga o catálogo');
select pg_temp.ok(pg_temp.conta('inativo','socio_instrumentos') = 0, 'conta inativa não enxerga nada');

-- ── 3. Versões ──────────────────────────────────────────────────────────
select pg_temp.erro('tdeuc', format($$select socio_salvar_versao(%L, %L::jsonb, 'Aviso lido ao entrevistado antes de começar.')$$,
                                    pg_temp.id('dsa'), pg_temp.est('domicilio')), 'socio:nao_autorizado');
select pg_temp.erro('admin', format($$select socio_salvar_versao(%L, %L::jsonb, 'Aviso lido ao entrevistado antes de começar.')$$,
                                    pg_temp.id('dsa'), pg_temp.est('domicilio')), 'socio:nao_autorizado');
-- chefe é gestor nato (sem papel designado)
select pg_temp.como('chefe');
select pg_temp.guarda('dsa_v1', (socio_salvar_versao(pg_temp.id('dsa'), '{"blocos":[{"id":"a","titulo":"A","perguntas":[{"n":1,"chave":"x","tipo":"unica","texto":"X"}]}]}',
                                                     'Aviso lido ao entrevistado antes de começar.')->>'id')::uuid);
select pg_temp.raiz();
select pg_temp.ok((select versao from socio_questionarios where id = pg_temp.id('dsa_v1')) = 1, 'primeira versão = 1');
select pg_temp.erro('chefe', format($$select socio_publicar_versao(%L)$$, pg_temp.id('dsa_v1')), 'socio:estrutura_invalida');
-- corrige o mesmo rascunho com a estrutura de teste e publica
select pg_temp.como('tduc');
select pg_temp.ok(jsonb_array_length((socio_salvar_versao(pg_temp.id('dsa'), pg_temp.est('domicilio'),
       'Aviso lido ao entrevistado antes de começar.', pg_temp.id('dsa_v1')))->'erros') = 0, 'estrutura de teste é válida');
select socio_publicar_versao(pg_temp.id('dsa_v1'));
-- v2 em rascunho (para o treino)
select pg_temp.guarda('dsa_v2', (socio_salvar_versao(pg_temp.id('dsa'), pg_temp.est('domicilio'),
                                                     'Aviso lido ao entrevistado antes de começar.')->>'id')::uuid);
select pg_temp.raiz();
select pg_temp.erro('tduc', format($$select socio_salvar_versao(%L, %L::jsonb, 'Aviso lido ao entrevistado antes de começar.', %L)$$,
                                   pg_temp.id('dsa'), pg_temp.est('domicilio'), pg_temp.id('dsa_v1')), 'socio:questionario_publicado');
do $$ begin
  update socio_questionarios set estrutura = '{}'::jsonb where id = pg_temp.id('dsa_v1');
  raise exception 'FALHOU: versão publicada foi alterada';
exception when others then
  if position('socio:questionario_publicado' in sqlerrm) = 0 then raise; end if;
end $$;
select pg_temp.ok(pg_temp.conta('tdeuc', 'socio_questionarios') = 1, 'membro sem papel vê só a publicada (não o rascunho)');
select pg_temp.ok(pg_temp.conta('tduc',  'socio_questionarios') = 2, 'gestor vê o rascunho');
select pg_temp.ok(pg_temp.conta('tdebio','socio_questionarios') = 0, 'outro departamento não vê as perguntas');

-- validação da estrutura: erros legíveis
select pg_temp.ok(array_to_string(fn_socio_validar_estrutura(
  '{"blocos":[{"id":"a","titulo":"A","perguntas":[{"n":1,"chave":"x","tipo":"unica","texto":"X","opcoes":[{"v":"s","r":"S"}],"mostrar_se":{"se":"y","op":"=","valor":"s"}},{"n":2,"chave":"y","tipo":"unica","texto":"Y","opcoes":[{"v":"s","r":"S"},{"v":"s","r":"S2"}]}]}]}'), '|')
  ~ 'não é pergunta anterior.*opção repetida', 'salto para pergunta posterior e opção repetida');
select pg_temp.ok(array_to_string(fn_socio_validar_estrutura(
  '{"blocos":[{"id":"a","titulo":"A","perguntas":[{"n":1,"chave":"x","tipo":"tabela","texto":"Lista"},{"n":2,"chave":"x","tipo":"inteiro","texto":"X","derivada":{"tipo":"total_linhas"}}]}]}'), '|')
  ~ 'sem "lista".*chave repetida', 'tabela sem lista e chave repetida');

-- ── 4. Papéis: só para quem é do departamento ───────────────────────────
select pg_temp.como('tduc');
select socio_definir_papel(pg_temp.id('dsa'), pg_temp.u('tdeuc'), 'aplicador', true);
select socio_definir_papel(pg_temp.id('dsa'), pg_temp.u('tduc'), 'aplicador', true);
select pg_temp.raiz();
select pg_temp.erro('tduc',  format($$select socio_definir_papel(%L, %L, 'aplicador', true)$$, pg_temp.id('dsa'), pg_temp.u('tdebio')), 'socio:fora_do_departamento');
select pg_temp.erro('tduc',  format($$select socio_definir_papel(%L, %L, 'aplicador', true)$$, pg_temp.id('dsa'), pg_temp.u('sem')), 'socio:fora_do_departamento');
select pg_temp.erro('tdeuc', format($$select socio_definir_papel(%L, %L, 'leitor', true)$$, pg_temp.id('dsa'), pg_temp.u('tdeuc')), 'socio:nao_autorizado');
select pg_temp.erro('admin', format($$select socio_definir_papel(%L, %L, 'leitor', true)$$, pg_temp.id('dsa'), pg_temp.u('tdeuc')), 'socio:justificativa_obrigatoria');
select pg_temp.como('admin');
select socio_definir_papel(pg_temp.id('dsa'), pg_temp.u('tdeuc'), 'leitor', true, 'Correção pedida pela chefia do departamento por e-mail.');
select pg_temp.raiz();
select pg_temp.ok(exists (select 1 from trilha_teste where tabela = 'socio_instrumento_membros'
                            and justificativa like 'Correção pedida%'), 'justificativa do super_admin chega à trilha');
select pg_temp.ok(pg_temp.conta('tdeuc', 'socio_instrumento_membros') = 2, 'membro vê só os próprios papéis');
select pg_temp.como('tduc');
select pg_temp.ok((select count(*) from socio_pessoas_do_departamento(pg_temp.id('dsa'))) = 3, 'equipe = chefe + DUC + DEUC (inativo fora)');
select pg_temp.raiz();

-- ── 5. Pedido de acesso de outro departamento ───────────────────────────
select pg_temp.como('tdebio');
select pg_temp.guarda('ped1', socio_pedir_acesso(pg_temp.id('dsa'), 'leitor', 'Cruzar com o monitoramento de fauna das UCs.', fn_socio_hoje() + 60));
select pg_temp.raiz();
select pg_temp.ok((select count(*) from notificacoes where meta->>'subtipo' = 'acesso_pedido'
                     and destinatario_id in (pg_temp.u('chefe'), pg_temp.u('tduc'))) = 2, 'pedido avisa chefe e gestor designado');
select pg_temp.erro('tdebio', format($$select socio_pedir_acesso(%L, 'leitor', 'Cruzar com o monitoramento de fauna das UCs.', fn_socio_hoje() + 60)$$, pg_temp.id('dsa')), 'socio:pedido_pendente');
select pg_temp.erro('tdeuc',  format($$select socio_pedir_acesso(%L, 'leitor', 'Sou do departamento mas quero pedir assim.', fn_socio_hoje() + 60)$$, pg_temp.id('dsa')), 'socio:ja_do_departamento');
select pg_temp.erro('tdebio', format($$select socio_pedir_acesso(%L, 'aplicador', 'curta', fn_socio_hoje() + 60)$$, pg_temp.id('dsa')), 'socio:justificativa_obrigatoria');
select pg_temp.erro('tdebio', format($$select socio_pedir_acesso(%L, 'aplicador', 'Prazo longo demais para o pedido.', fn_socio_hoje() + 400)$$, pg_temp.id('dsa')), 'socio:prazo_invalido');
select pg_temp.erro('admin',  format($$select socio_decidir_acesso(%L, true)$$, pg_temp.id('ped1')), 'socio:nao_autorizado');
select pg_temp.erro('tdeuc',  format($$select socio_decidir_acesso(%L, true)$$, pg_temp.id('ped1')), 'socio:nao_autorizado');
select pg_temp.erro('chefe',  format($$select socio_decidir_acesso(%L, false, '')$$, pg_temp.id('ped1')), 'socio:parecer_obrigatorio');
select pg_temp.erro('chefe',  format($$select socio_decidir_acesso(%L, true, null, fn_socio_hoje() + 90)$$, pg_temp.id('ped1')), 'socio:prazo_invalido');
select pg_temp.ok(pg_temp.conta('tdebio', 'socio_acessos') = 1, 'quem pediu vê o próprio pedido');
select pg_temp.ok(pg_temp.conta('dir', 'socio_acessos') = 0, 'chefia acima não vê pedidos');
select pg_temp.como('chefe');
select socio_decidir_acesso(pg_temp.id('ped1'), true, null, fn_socio_hoje() + 30);
select pg_temp.raiz();
select pg_temp.ok((select status = 'aprovado' and data_fim = fn_socio_hoje() + 30 from socio_acessos where id = pg_temp.id('ped1')), 'aprovado com prazo reduzido');
select pg_temp.ok(exists (select 1 from notificacoes where destinatario_id = pg_temp.u('tdebio') and meta->>'subtipo' = 'acesso_aprovado'), 'quem pediu é avisado');
select pg_temp.ok(pg_temp.conta('tdebio', 'socio_instrumentos') = 2, 'com acesso, DEBIO passa a ver o DSA');
select pg_temp.ok(pg_temp.conta('tdebio', 'socio_questionarios') = 1, 'e as perguntas publicadas');
select pg_temp.erro('tdebio', format($$select socio_decidir_acesso(%L, true)$$, pg_temp.id('ped1')), 'socio:nao_autorizado');
-- pedido a instrumento sem gestor: avisa o super_admin
select pg_temp.como('tdeuc');
select pg_temp.guarda('ped_pesca', socio_pedir_acesso(pg_temp.id('pesca'), 'agregados', 'Comparar a pesca com o uso das UCs.', fn_socio_hoje() + 30));
select pg_temp.raiz();
select pg_temp.ok(exists (select 1 from notificacoes where destinatario_id = pg_temp.u('admin') and meta->>'subtipo' = 'acesso_sem_gestor'),
                  'instrumento sem gestor avisa o super_admin');
-- cancelar o próprio pedido
select pg_temp.como('tdeuc');
select socio_encerrar_acesso(pg_temp.id('ped_pesca'));
select pg_temp.raiz();
select pg_temp.ok((select status from socio_acessos where id = pg_temp.id('ped_pesca')) = 'cancelado', 'quem pediu cancela o pendente');
-- aplicador de fora, para a campanha
select pg_temp.como('tdebio');
select pg_temp.guarda('ped2', socio_pedir_acesso(pg_temp.id('dsa'), 'aplicador', 'Apoiar a coleta em Cruzeiro do Sul em novembro.', fn_socio_hoje() + 60));
select pg_temp.raiz();
select pg_temp.como('tduc');
select socio_decidir_acesso(pg_temp.id('ped2'), true);
select pg_temp.raiz();

-- ── 6. Campanha ─────────────────────────────────────────────────────────
select pg_temp.erro('tduc', format($$select socio_salvar_campanha(null, %L, %L, 'Campanha', fn_socio_hoje(), fn_socio_hoje() + 10, true, false)$$,
                                   pg_temp.id('dsa'), pg_temp.id('dsa_v2')), 'socio:questionario_invalido');
select pg_temp.como('tduc');
select pg_temp.guarda('camp', socio_salvar_campanha(null, pg_temp.id('dsa'), pg_temp.id('dsa_v1'), 'Campanha 2026 — Juruá',
                                                    fn_socio_hoje() - 2, fn_socio_hoje() + 30, true, false,
                                                    array['1200401', '1200203'], '{}'));
select socio_definir_aplicador(pg_temp.id('camp'), pg_temp.u('tdeuc'), true);
select socio_definir_aplicador(pg_temp.id('camp'), pg_temp.u('tdebio'), true);
select pg_temp.raiz();
select pg_temp.erro('tduc', format($$select socio_definir_aplicador(%L, %L, true)$$, pg_temp.id('camp'), pg_temp.u('sem')), 'socio:sem_papel_aplicador');
select pg_temp.erro('tduc', format($$select socio_definir_aplicador(%L, %L, true)$$, pg_temp.id('camp'), pg_temp.u('chefe')), 'socio:sem_papel_aplicador');
select pg_temp.erro('tdeuc', format($$select socio_situacao_campanha(%L, 'aberta')$$, pg_temp.id('camp')), 'socio:nao_autorizado');

-- ficha montada para os testes de envio
create function pg_temp.ficha(p_cod text, p_uuid uuid, p_extra jsonb default '{}') returns jsonb language sql as $$
  select jsonb_build_object(
    'uuid_cliente', p_uuid, 'codigo', p_cod, 'questionario_id', pg_temp.id('dsa_v1'), 'campanha_id', pg_temp.id('camp'),
    'cd_mun', '1200401', 'dt_entrevista', fn_socio_hoje(), 'finalizada_em', now(),
    'aviso_lido', true, 'aceitou_participar', true, 'fotos_autorizadas', true,
    'entrevistado_nome', 'Maria do Rio', 'lat', -9.97, 'lon', -67.81,
    'respostas', jsonb_build_object('qtd_moradores', 3, 'idade_entrevistado', 40, 'agua_fonte', 'rede',
                                    'renda_fontes', jsonb_build_array('pesca'), 'pesca_kg', 12.5, 'busca_trabalho', 'nao',
                                    'atividades_mulheres', jsonb_build_array('nao_ha_mulheres'), 'observacoes', 'Tudo certo')) || p_extra
$$;
create function pg_temp.linhas() returns jsonb language sql as $$
  select '[{"ordem":2,"idade":8,"sexo":"homem","escolaridade":"fund_inc"},
           {"ordem":1,"idade":40,"sexo":"mulher","escolaridade":"medio","nome":"Maria","e_entrevistado":true}]'::jsonb
$$;
grant execute on all functions in schema pg_temp to authenticated;

select pg_temp.erro('tdeuc', format($$select socio_enviar_ficha(%L, %L)$$,
       pg_temp.ficha('DSA-261018-AB12-01', '11111111-0000-0000-0000-000000000001'), pg_temp.linhas()), 'socio:campanha_invalida');
select pg_temp.como('tduc');
select socio_situacao_campanha(pg_temp.id('camp'), 'aberta');
select pg_temp.raiz();

-- ── 7. Envio da ficha ───────────────────────────────────────────────────
select pg_temp.como('tdeuc');
select pg_temp.guarda('f1', (socio_enviar_ficha(pg_temp.ficha('DSA-261018-AB12-01', '11111111-0000-0000-0000-000000000001'),
                             pg_temp.linhas(),
                             '[{"uuid_cliente":"22222222-0000-0000-0000-000000000001","tema":"moradia","arquivo_url":"https://x/storage/v1/object/public/socio-fotos/11111111-0000-0000-0000-000000000001/a.webp"}]')->>'id')::uuid);
-- reenviar a mesma ficha não duplica
select socio_enviar_ficha(pg_temp.ficha('DSA-261018-AB12-01', '11111111-0000-0000-0000-000000000001'), pg_temp.linhas());
select pg_temp.raiz();
select pg_temp.ok((select count(*) from socio_fichas) = 1, 'reenvio não duplica');
select pg_temp.ok((select respostas->>'tem_crianca' = 'sim' and respostas->>'maior_esc' = 'medio' and (respostas->>'qtd_listada')::int = 2
                     from socio_fichas where id = pg_temp.id('f1')), 'derivadas calculadas no banco');
select pg_temp.ok((select linhas::text not like '%Maria%' and (linhas->0->>'ordem')::int = 1 from socio_fichas where id = pg_temp.id('f1')),
                  'nome do morador fora da ficha; linhas ordenadas');
select pg_temp.ok((select linhas->0->>'nome' = 'Maria' and entrevistado_nome = 'Maria do Rio'
                     from socio_fichas_identificacao where ficha_id = pg_temp.id('f1')), 'identificação separada');
select pg_temp.ok((select alertas @> '[{"tipo":"diverge_da_lista"},{"tipo":"incoerente_com_lista"}]'::jsonb
                     from socio_fichas where id = pg_temp.id('f1')), 'alertas de coerência com a lista');
select pg_temp.ok((select count(*) from socio_fotos where ficha_id = pg_temp.id('f1')) = 1, 'foto registrada');
select pg_temp.ok((select count(*) from socio_fichas_historico where ficha_id = pg_temp.id('f1')) = 1, 'histórico só com a mudança de status');

select pg_temp.como('tdebio');
select pg_temp.guarda('f2', (socio_enviar_ficha(pg_temp.ficha('DSA-261018-CD34-01', '11111111-0000-0000-0000-000000000002',
                             '{"cd_mun":"1200203"}'), pg_temp.linhas())->>'id')::uuid);
select pg_temp.raiz();

select pg_temp.erro('sem',    format($$select socio_enviar_ficha(%L, %L)$$, pg_temp.ficha('DSA-261018-EF56-01', '11111111-0000-0000-0000-000000000003'), pg_temp.linhas()), 'socio:nao_autorizado');
select pg_temp.erro('tduc',   format($$select socio_enviar_ficha(%L, %L)$$, pg_temp.ficha('DSA-261018-EF56-01', '11111111-0000-0000-0000-000000000003'), pg_temp.linhas()), 'socio:nao_autorizado');
select pg_temp.erro('tdeuc',  format($$select socio_enviar_ficha(%L, %L)$$, pg_temp.ficha('PESCA-261018-AB12-02', '11111111-0000-0000-0000-000000000004'), pg_temp.linhas()), 'socio:ficha_invalida');
select pg_temp.erro('tdeuc',  format($$select socio_enviar_ficha(%L, %L)$$, pg_temp.ficha('DSA-261018-AB12-03', '11111111-0000-0000-0000-000000000005', '{"cd_mun":"1200302"}'), pg_temp.linhas()), 'socio:territorio_invalido');
select pg_temp.erro('tdeuc',  format($$select socio_enviar_ficha(%L, %L)$$, pg_temp.ficha('DSA-261018-AB12-03', '11111111-0000-0000-0000-000000000005', '{"cd_mun":null}'), pg_temp.linhas()), 'socio:territorio_invalido');
select pg_temp.erro('tdebio', format($$select socio_enviar_ficha(%L, %L)$$, pg_temp.ficha('DSA-261018-AB12-01', '11111111-0000-0000-0000-000000000001'), pg_temp.linhas()), 'socio:nao_autorizado');
select pg_temp.erro('tdeuc',  format($$select socio_enviar_ficha(%L, %L)$$, pg_temp.ficha('DSA-261018-AB12-01', '11111111-0000-0000-0000-000000000006'), pg_temp.linhas()), 'socio:codigo_duplicado');
select pg_temp.erro('tdeuc',  format($$select socio_enviar_ficha(%L, %L)$$, pg_temp.ficha('DSA-261018-AB12-04', '11111111-0000-0000-0000-000000000007',
       '{"finalizada_em":"2020-01-01T12:00:00Z"}'), pg_temp.linhas()), 'socio:fora_do_periodo');
select pg_temp.erro('tdeuc',  format($$select socio_enviar_ficha(%L, %L, %L)$$, pg_temp.ficha('DSA-261018-AB12-05', '11111111-0000-0000-0000-000000000008',
       '{"fotos_autorizadas":false}'), pg_temp.linhas(), '[{"uuid_cliente":"22222222-0000-0000-0000-000000000009","arquivo_url":"https://x/socio-fotos/11111111-0000-0000-0000-000000000008/a.webp"}]'), 'socio:fotos_nao_autorizadas');
select pg_temp.erro('tdeuc',  format($$select socio_enviar_ficha(%L, %L, %L)$$, pg_temp.ficha('DSA-261018-AB12-06', '11111111-0000-0000-0000-00000000000a'), pg_temp.linhas(),
       '[{"uuid_cliente":"22222222-0000-0000-0000-00000000000a","arquivo_url":"https://x/socio-fotos/outra-ficha/a.webp"}]'), 'socio:foto_invalida');
select pg_temp.erro('tdeuc',  format($$select socio_enviar_ficha(%L, %L)$$, pg_temp.ficha('DSA-261018-AB12-07', '11111111-0000-0000-0000-00000000000b',
       '{"respostas":{"qtd_moradores":2,"pergunta_que_nao_existe":1}}'), pg_temp.linhas()), 'socio:resposta_invalida');

-- recusa: nada além do aceite é gravado
select pg_temp.como('tdeuc');
select pg_temp.guarda('f_recusa', (socio_enviar_ficha(pg_temp.ficha('DSA-261018-AB12-08', '11111111-0000-0000-0000-00000000000c',
                                   '{"aceitou_participar":false}'), pg_temp.linhas())->>'id')::uuid);
select pg_temp.raiz();
select pg_temp.ok((select respostas = '{}' and linhas = '[]' and alertas = '[]' from socio_fichas where id = pg_temp.id('f_recusa')), 'recusa grava só o aceite');
select pg_temp.ok(not exists (select 1 from socio_fichas_identificacao where ficha_id = pg_temp.id('f_recusa')), 'recusa não guarda nome nem GPS');

-- treino: rascunho, sem campanha, código TRE-
select pg_temp.como('tdeuc');
select pg_temp.guarda('f_treino', (socio_enviar_ficha(jsonb_build_object(
  'uuid_cliente', '11111111-0000-0000-0000-00000000000d', 'codigo', 'TRE-261018-AB12-01', 'treino', true,
  'questionario_id', pg_temp.id('dsa_v2'), 'finalizada_em', now(), 'aviso_lido', true, 'aceitou_participar', true,
  'respostas', '{"qtd_moradores":1}'::jsonb), '[{"ordem":1,"idade":30,"e_entrevistado":true}]')->>'id')::uuid);
select pg_temp.raiz();
select pg_temp.erro('tdebio', format($$select socio_enviar_ficha(jsonb_build_object('uuid_cliente','11111111-0000-0000-0000-00000000000e','codigo','DSA-261018-CD34-09','treino',false,
  'questionario_id',%L,'campanha_id',%L,'cd_mun','1200401','finalizada_em',now(),'aviso_lido',true,'aceitou_participar',true,'respostas','{}'::jsonb))$$,
  pg_temp.id('dsa_v2'), pg_temp.id('camp')), 'socio:questionario_invalido');

-- ── 8. Quem vê quais fichas ─────────────────────────────────────────────
-- fichas reais: f1 (tdeuc), f2 (tdebio), f_recusa (tdeuc); treino: f_treino (tdeuc)
select pg_temp.ok(pg_temp.conta('chefe',  'socio_fichas') = 4, 'gestor vê todas, inclusive treino');
select pg_temp.ok(pg_temp.conta('tdeuc',  'socio_fichas') = 4, 'leitor do departamento vê as reais + o próprio treino');
select pg_temp.ok(pg_temp.conta('tdebio', 'socio_fichas') = 3, 'leitor de fora (pedido aprovado) vê as fichas reais, nunca o treino');
select pg_temp.ok(pg_temp.conta('dir',    'socio_fichas') = 0, 'chefia acima não vê ficha');
select pg_temp.ok(pg_temp.conta('admin',  'socio_fichas') = 0, 'super_admin não vê ficha sem pedir');
select pg_temp.ok(pg_temp.conta('sem',    'socio_fichas') = 0, 'sem lotação não vê ficha');
select pg_temp.ok(pg_temp.conta('chefe',  'socio_fichas_identificacao') = 2, 'gestor vê a identificação');
select pg_temp.ok(pg_temp.conta('tdeuc',  'socio_fichas_identificacao') = 1, 'leitor vê só a identificação das próprias fichas');
select pg_temp.ok(pg_temp.conta('tdebio', 'socio_fichas_identificacao') = 1, 'aplicador de fora vê só a da própria ficha');
select pg_temp.ok(pg_temp.conta('admin',  'socio_fichas_identificacao') = 0, 'super_admin não vê identificação');
select pg_temp.ok(pg_temp.conta('tdebio', 'socio_fotos') = 0, 'aplicador de fora não vê foto de ficha alheia');
select pg_temp.ok(pg_temp.conta('chefe',  'socio_fotos') = 1, 'gestor vê a foto');
-- anon: nada
do $$ begin
  set local role anon;
  perform count(*) from socio_fichas;
  raise exception 'FALHOU: anon leu socio_fichas';
exception when insufficient_privilege then null;
end $$;
do $$ begin
  set local role anon;
  perform socio_catalogo();
  raise exception 'FALHOU: anon executou socio_catalogo';
exception when insufficient_privilege then null;
end $$;
do $$ begin
  set local role authenticated;
  perform fn_socio_pode_de('00000000-0000-0000-0000-0000000000a1', null, 'gerir');
  raise exception 'FALHOU: cliente consultou o acesso de outra pessoa';
exception when insufficient_privilege then null;
end $$;
do $$ begin
  set local role authenticated;
  insert into socio_comunidades (nome, cd_mun) values ('Direto', '1200401');
  raise exception 'FALHOU: cliente escreveu direto na tabela';
exception when insufficient_privilege then null;
end $$;

-- ── 9. Validação pela mesa ──────────────────────────────────────────────
select pg_temp.erro('tdeuc', format($$select socio_mudar_status(%L, 'validada')$$, pg_temp.id('f1')), 'socio:nao_autorizado');
select pg_temp.erro('chefe', format($$select socio_mudar_status(%L, 'devolvida', '')$$, pg_temp.id('f1')), 'socio:motivo_obrigatorio');
select pg_temp.erro('chefe', format($$select socio_mudar_status(%L, 'validada')$$, pg_temp.id('f_treino')), 'socio:treino');
select pg_temp.como('chefe');
select socio_mudar_status(pg_temp.id('f1'), 'devolvida', 'Confira a quantidade de moradores.');
select pg_temp.raiz();
select pg_temp.ok(exists (select 1 from notificacoes where destinatario_id = pg_temp.u('tdeuc') and meta->>'subtipo' = 'ficha_devolvida'), 'devolução avisa o entrevistador');
select pg_temp.como('tdeuc');
select socio_enviar_ficha(pg_temp.ficha('DSA-261018-AB12-01', '11111111-0000-0000-0000-000000000001',
                          '{"respostas":{"qtd_moradores":2,"idade_entrevistado":40,"agua_fonte":"rede","renda_fontes":["pesca"],"pesca_kg":12.5,"busca_trabalho":"nao","atividades_mulheres":["casa"],"observacoes":"Corrigido"}}'),
                          pg_temp.linhas());
select pg_temp.raiz();
select pg_temp.ok((select status = 'enviada' and motivo_devolucao is null and not (alertas @> '[{"tipo":"diverge_da_lista"}]')
                     from socio_fichas where id = pg_temp.id('f1')), 'reenvio após devolução volta a enviada, sem o alerta corrigido');
select pg_temp.como('chefe');
select socio_mudar_status(pg_temp.id('f1'), 'validada');
select pg_temp.raiz();
select pg_temp.erro('tdeuc', format($$select socio_enviar_ficha(%L, %L)$$, pg_temp.ficha('DSA-261018-AB12-01', '11111111-0000-0000-0000-000000000001'), pg_temp.linhas()), 'socio:ja_validada');
select pg_temp.ok((select count(*) from socio_fichas_historico where ficha_id = pg_temp.id('f1')) = 4, 'histórico: enviada, devolvida, enviada, validada');

-- ── 10. Revogação e carência ────────────────────────────────────────────
select pg_temp.erro('tdebio', format($$select socio_encerrar_acesso(%L, 'Não preciso mais.')$$, pg_temp.id('ped2')), 'socio:nao_autorizado');
select pg_temp.erro('tduc',   format($$select socio_encerrar_acesso(%L, '')$$, pg_temp.id('ped2')), 'socio:parecer_obrigatorio');
select pg_temp.como('tduc');
select socio_encerrar_acesso(pg_temp.id('ped2'), 'Coleta de novembro cancelada.');
select pg_temp.raiz();
select pg_temp.ok(not (select ativo from socio_campanha_aplicadores where campanha_id = pg_temp.id('camp') and usuario_id = pg_temp.u('tdebio')),
                  'revogar o aplicador tira da equipe da campanha');
select pg_temp.ok(pg_temp.conta('tdebio', 'socio_fichas_identificacao') = 0, 'sem acesso de aplicador, perde até a identificação da própria ficha');
select pg_temp.erro('tdebio', format($$select socio_enviar_ficha(%L, %L)$$, pg_temp.ficha('DSA-261018-CD34-02', '11111111-0000-0000-0000-00000000000f', '{"cd_mun":"1200203"}'), pg_temp.linhas()), 'socio:nao_autorizado');
-- carência: campanha terminou há 5 dias; ficha concluída dentro do período
update socio_campanhas set inicio = fn_socio_hoje() - 20, fim = fn_socio_hoje() - 5 where id = pg_temp.id('camp');
select pg_temp.como('tdeuc');
select pg_temp.ok((socio_enviar_ficha(pg_temp.ficha('DSA-261018-AB12-09', '11111111-0000-0000-0000-000000000010',
                   jsonb_build_object('finalizada_em', now() - interval '6 days')), pg_temp.linhas())->>'usou_carencia')::boolean,
                  'ficha concluída a tempo e enviada até 15 dias depois entra com carência');
select pg_temp.raiz();
update socio_campanhas set inicio = fn_socio_hoje() - 40, fim = fn_socio_hoje() - 20 where id = pg_temp.id('camp');
select pg_temp.erro('tdeuc', format($$select socio_enviar_ficha(%L, %L)$$, pg_temp.ficha('DSA-261018-AB12-10', '11111111-0000-0000-0000-000000000011',
       jsonb_build_object('finalizada_em', now() - interval '25 days')), pg_temp.linhas()), 'socio:campanha_encerrada');

-- ── 11. Transferir o instrumento de departamento (só super_admin) ───────
select pg_temp.erro('chefe', format($$select socio_transferir_instrumento(%L, %L, 'Mudou de departamento por portaria.')$$,
                                    pg_temp.id('dsa'), '00000000-0000-0000-0000-00000000a005'), 'socio:nao_autorizado');
select pg_temp.erro('admin', format($$select socio_transferir_instrumento(%L, %L, 'curta')$$,
                                    pg_temp.id('dsa'), '00000000-0000-0000-0000-00000000a005'), 'socio:justificativa_obrigatoria');
select pg_temp.como('admin');
select socio_transferir_instrumento(pg_temp.id('dsa'), '00000000-0000-0000-0000-00000000a005', 'Portaria 123/2026 passou o diagnóstico ao DEBIO.');
select pg_temp.raiz();
select pg_temp.ok(pg_temp.conta('chefe', 'socio_fichas') = 0, 'depois da troca, o antigo chefe perde as fichas');
select pg_temp.ok(not exists (select 1 from socio_instrumento_membros where instrumento_id = pg_temp.id('dsa') and ativo),
                  'papéis do departamento antigo deixam de valer');
select pg_temp.ok(pg_temp.conta('tdebio', 'socio_instrumentos') = 2, 'o novo departamento passa a ver');

-- ── 12. ROPA ────────────────────────────────────────────────────────────
select pg_temp.ok((select count(*) from lgpd_tratamentos where codigo = 'TRAT-021') = 1, 'TRAT-021 no ROPA, sem duplicar');
select pg_temp.ok((select bool_and(exists (select 1 from information_schema.tables where table_name = t))
                     from lgpd_tratamentos, unnest(tabelas) t where codigo = 'TRAT-021'), 'ROPA cita só tabelas que existem');

select 'testes de acesso e fluxo: OK' as resultado;
