-- ════════════════════════════════════════════════════════════════════════
-- 362b — Diagnóstico Socioeconômico: interpretador do questionário
-- ════════════════════════════════════════════════════════════════════════
-- O questionário é DADO (socio_questionarios.estrutura). Estas funções são
-- a metade do banco do interpretador; a outra metade é js/socio-regras.js,
-- que o app usa sem rede. As duas têm de dar o MESMO resultado — guarda:
-- supabase/tests/socio/rodar.sh (teste cruzado com casos aleatórios).
-- Regra nova ou operador novo entra nos DOIS arquivos e no teste.
--
-- Porte do Diagnóstico Socioambiental do DIMA, generalizado para vários
-- instrumentos: o que lá era fixo do questionário de domicílio (colunas da
-- tabela de moradores, "não há mulheres", total de moradores) aqui é
-- declarado na própria estrutura — `lista`, `derivada` e `coerencia`.
-- Formato completo em docs/socioeconomico/plano.md §1.5.
--
-- Valores especiais em respostas:
--   "_nr"            → Não respondeu
--   chave ausente    → não se aplica (salto) ou em branco (vira pendência)
--   "<chave>_outro"  → texto do "especifique"
-- ════════════════════════════════════════════════════════════════════════

create or replace function public.fn_socio_perguntas(p_estrutura jsonb)
returns table(ordem integer, bloco text, pergunta jsonb)
language sql immutable set search_path = public as $$
  select (bb.i * 1000 + pp.j)::int, b->>'id', p
    from jsonb_array_elements(coalesce(p_estrutura->'blocos', '[]'::jsonb)) with ordinality as bb(b, i),
         jsonb_array_elements(coalesce(b->'perguntas', '[]'::jsonb)) with ordinality as pp(p, j)
$$;

-- condição de salto sobre UMA pergunta anterior, ou {"todas": [...]}
create or replace function public.fn_socio_cond(p_cond jsonb, p_respostas jsonb, p_aplicaveis text[])
returns boolean language plpgsql immutable set search_path = public as $$
declare
  v_ref jsonb;
  c     jsonb;
begin
  if p_cond ? 'todas' then
    for c in select * from jsonb_array_elements(p_cond->'todas') loop
      if not fn_socio_cond(c, p_respostas, p_aplicaveis) then return false; end if;
    end loop;
    return true;
  end if;
  -- pergunta de referência fora de aplicação → dependente também fica fora
  if not ((p_cond->>'se') = any(p_aplicaveis)) then return false; end if;
  v_ref := p_respostas -> (p_cond->>'se');
  return case p_cond->>'op'
    when '='  then coalesce(jsonb_typeof(v_ref) = 'string' and v_ref = p_cond->'valor', false)
    when '!=' then not coalesce(jsonb_typeof(v_ref) = 'string' and v_ref = p_cond->'valor', false)
    when 'in' then coalesce(jsonb_typeof(v_ref) = 'string' and (p_cond->'valor') @> jsonb_build_array(v_ref), false)
    when 'contem' then coalesce(jsonb_typeof(v_ref) = 'array' and v_ref @> jsonb_build_array(p_cond->'valor'), false)
    when 'nao_contem' then not coalesce(jsonb_typeof(v_ref) = 'array' and v_ref @> jsonb_build_array(p_cond->'valor'), false)
    else null
  end;
end $$;

-- chaves de resposta que se aplicam, na ordem do questionário
create or replace function public.fn_socio_aplicaveis(p_estrutura jsonb, p_respostas jsonb)
returns text[] language plpgsql immutable set search_path = public as $$
declare
  r     record;
  v_apl text[] := '{}';
  v_ok  boolean;
begin
  for r in select pergunta from fn_socio_perguntas(p_estrutura) order by ordem loop
    continue when r.pergunta->>'tipo' = 'tabela';
    if r.pergunta ? 'mostrar_se' then
      v_ok := fn_socio_cond(r.pergunta->'mostrar_se', p_respostas, v_apl);
      if v_ok is null then
        raise exception 'socio:estrutura_invalida: operador de salto desconhecido em %', r.pergunta->>'chave';
      end if;
    else
      v_ok := true;
    end if;
    if v_ok then v_apl := v_apl || (r.pergunta->>'chave'); end if;
  end loop;
  return v_apl;
end $$;

-- uma linha da lista atende ao filtro {"coluna","op","valor"}?
-- valor ausente: só '!=' é verdadeiro
create or replace function public.fn_socio_linha_casa(p_onde jsonb, p_linha jsonb)
returns boolean language plpgsql immutable set search_path = public as $$
declare
  v jsonb := p_linha -> (p_onde->>'coluna');
  r boolean;
begin
  if v is null or v = 'null'::jsonb then
    r := case p_onde->>'op' when '!=' then true when '=' then false when 'in' then false
                            when 'entre' then false end;
  else
    r := case p_onde->>'op'
      when '='  then v = p_onde->'valor'
      when '!=' then v <> p_onde->'valor'
      when 'in' then jsonb_typeof(p_onde->'valor') = 'array' and (p_onde->'valor') @> jsonb_build_array(v)
      when 'entre' then jsonb_typeof(v) = 'number'
                        and (v #>> '{}')::numeric >= (p_onde->'valor'->>0)::numeric
                        and (v #>> '{}')::numeric <= (p_onde->'valor'->>1)::numeric
    end;
  end if;
  if r is null then
    raise exception 'socio:estrutura_invalida: filtro de lista desconhecido (%)', p_onde->>'op';
  end if;
  return r;
end $$;

-- Valida e normaliza a lista (moradores, membros…). Devolve as linhas
-- COMPLETAS (inclusive colunas de identificação), sem valores vazios,
-- ordenadas por `ordem`. Quem separa identificação é a RPC de envio.
create or replace function public.fn_socio_linhas_normalizar(p_estrutura jsonb, p_linhas jsonb)
returns jsonb language plpgsql immutable set search_path = public as $$
declare
  v_lista  jsonb := p_estrutura->'lista';
  v_cols   jsonb;
  v_linhas jsonb := coalesce(p_linhas, '[]'::jsonb);
  m        jsonb;
  k        text;
  v        jsonb;
  c        jsonb;
  v_row    jsonb;
  v_out    jsonb := '[]'::jsonb;
  v_ords   int[] := '{}';
  v_ord    numeric;
  v_n      numeric;
  v_ent    int := 0;
begin
  if jsonb_typeof(v_linhas) <> 'array' then
    raise exception 'socio:linha_invalida: lista mal formada';
  end if;
  if jsonb_array_length(v_linhas) = 0 then return '[]'::jsonb; end if;
  if v_lista is null then
    raise exception 'socio:linha_invalida: este questionário não tem lista';
  end if;
  if jsonb_array_length(v_linhas) > coalesce((v_lista->>'max_linhas')::int, 30) then
    raise exception 'socio:linha_invalida: linhas demais';
  end if;
  select jsonb_object_agg(x->>'chave', x) into v_cols from jsonb_array_elements(v_lista->'colunas') x;

  for m in select * from jsonb_array_elements(v_linhas) loop
    if jsonb_typeof(m) <> 'object' or jsonb_typeof(m->'ordem') is distinct from 'number' then
      raise exception 'socio:linha_invalida: ordem ausente';
    end if;
    v_ord := (m->>'ordem')::numeric;
    if v_ord <> trunc(v_ord) or v_ord < 1 or v_ord > 1000 or v_ord::int = any(v_ords) then
      raise exception 'socio:linha_invalida: ordem ausente ou repetida';
    end if;
    v_ords := v_ords || v_ord::int;
    v_row := jsonb_build_object('ordem', v_ord::int);
    for k, v in select e.key, e.value from jsonb_each(m) e loop
      continue when k = 'ordem';
      if k = 'e_entrevistado' then
        if not coalesce((v_lista->>'marca_entrevistado')::boolean, false) or jsonb_typeof(v) <> 'boolean' then
          raise exception 'socio:linha_invalida: e_entrevistado inválido';
        end if;
        if v = 'true'::jsonb then
          v_ent := v_ent + 1;
          v_row := v_row || jsonb_build_object(k, v);
        end if;
        continue;
      end if;
      c := v_cols -> k;
      if c is null then
        raise exception 'socio:linha_invalida: coluna desconhecida %', k;
      end if;
      continue when v = 'null'::jsonb or v = '""'::jsonb;
      if v = '"_nr"'::jsonb then
        v_row := v_row || jsonb_build_object(k, v);
        continue;
      end if;
      case c->>'tipo'
        when 'unica' then
          if jsonb_typeof(v) <> 'string'
             or not exists (select 1 from jsonb_array_elements(c->'opcoes') o where o->'v' = v) then
            raise exception 'socio:linha_invalida: % fora das opções', k;
          end if;
        when 'inteiro' then
          if jsonb_typeof(v) <> 'number' then
            raise exception 'socio:linha_invalida: % deve ser número', k;
          end if;
          v_n := (v #>> '{}')::numeric;
          if v_n <> trunc(v_n) or (c ? 'min' and v_n < (c->>'min')::numeric)
             or (c ? 'max' and v_n > (c->>'max')::numeric) then
            raise exception 'socio:linha_invalida: % fora do intervalo', k;
          end if;
        when 'texto' then
          if jsonb_typeof(v) <> 'string' or length(v #>> '{}') > coalesce((c->>'max_len')::int, 120) then
            raise exception 'socio:linha_invalida: % texto inválido', k;
          end if;
          continue when btrim(v #>> '{}') = '';
        when 'booleano' then
          if jsonb_typeof(v) <> 'boolean' then
            raise exception 'socio:linha_invalida: % deve ser sim/não', k;
          end if;
        else
          raise exception 'socio:estrutura_invalida: tipo de coluna % em %', c->>'tipo', k;
      end case;
      v_row := v_row || jsonb_build_object(k, v);
    end loop;
    v_out := v_out || jsonb_build_array(v_row);
  end loop;
  if v_ent > 1 then
    raise exception 'socio:linha_invalida: mais de uma linha marcada como entrevistado';
  end if;
  return (select coalesce(jsonb_agg(x order by (x->>'ordem')::int), '[]'::jsonb)
            from jsonb_array_elements(v_out) x);
end $$;

-- valor de uma pergunta derivada da lista; NULL = sem valor
--   {"tipo":"total_linhas"}
--   {"tipo":"existe_linha","onde":{...},"sim":"sim","nao":"nao"}
--   {"tipo":"maior_nivel","coluna":"escolaridade"}  (opção da coluna → `nivel`
--      = opção da pergunta; a ordem das opções da pergunta é a escala)
create or replace function public.fn_socio_derivada(p_estrutura jsonb, p_pergunta jsonb, p_linhas jsonb)
returns jsonb language plpgsql immutable set search_path = public as $$
declare
  d jsonb := p_pergunta->'derivada';
  v_linhas jsonb := coalesce(p_linhas, '[]'::jsonb);
begin
  case d->>'tipo'
    when 'total_linhas' then
      return to_jsonb(jsonb_array_length(v_linhas));
    when 'existe_linha' then
      if exists (select 1 from jsonb_array_elements(v_linhas) l where fn_socio_linha_casa(d->'onde', l)) then
        return coalesce(d->'sim', '"sim"'::jsonb);
      end if;
      return coalesce(d->'nao', '"nao"'::jsonb);
    when 'maior_nivel' then
      return (select to_jsonb(e.v)
                from jsonb_array_elements(v_linhas) l
                join jsonb_array_elements(coalesce(p_estrutura->'lista'->'colunas', '[]'::jsonb)) c
                  on c->>'chave' = d->>'coluna'
                join jsonb_array_elements(c->'opcoes') o on o->'v' = l->(d->>'coluna') and o ? 'nivel'
                join jsonb_array_elements_text(coalesce(
                       (select jsonb_agg(x->'v' order by k)
                          from jsonb_array_elements(p_pergunta->'opcoes') with ordinality as xx(x, k)), '[]'))
                     with ordinality as e(v, i) on e.v = o->>'nivel'
               order by e.i desc limit 1);
    else
      raise exception 'socio:estrutura_invalida: derivada desconhecida em %', p_pergunta->>'chave';
  end case;
end $$;

-- Normaliza as respostas. p_linhas = saída de fn_socio_linhas_normalizar.
--  · derivadas sobrescritas pelo cálculo (sem valor → saem)
--  · não aplicáveis descartadas (com o _outro)
--  · estrutura errada → exceção 'socio:resposta_invalida: ...'
create or replace function public.fn_socio_normalizar_respostas(p_estrutura jsonb, p_respostas jsonb, p_linhas jsonb)
returns jsonb language plpgsql immutable set search_path = public as $$
declare
  v_resp   jsonb := coalesce(p_respostas, '{}'::jsonb);
  v_apl    text[];
  v_out    jsonb := '{}'::jsonb;
  v_perg   jsonb := '{}'::jsonb;
  v_chave  text;
  v_val    jsonb;
  p        jsonb;
  v_opcoes jsonb;
  v_excl   jsonb;
  v_n      numeric;
  v_base   text;
  v_maxlen int := coalesce((p_estrutura->>'texto_max_len')::int, 2000);
  v_outlen int := coalesce((p_estrutura->>'outro_max_len')::int, 120);
begin
  if jsonb_typeof(v_resp) <> 'object' then
    raise exception 'socio:resposta_invalida: respostas deve ser um objeto';
  end if;
  select coalesce(jsonb_object_agg(pergunta->>'chave', pergunta), '{}'::jsonb) into v_perg
    from fn_socio_perguntas(p_estrutura);

  for p in select pergunta from fn_socio_perguntas(p_estrutura) where pergunta ? 'derivada' order by ordem loop
    v_val := fn_socio_derivada(p_estrutura, p, p_linhas);
    if v_val is null or v_val = 'null'::jsonb then
      v_resp := v_resp - (p->>'chave');
    else
      v_resp := v_resp || jsonb_build_object(p->>'chave', v_val);
    end if;
  end loop;

  v_apl := fn_socio_aplicaveis(p_estrutura, v_resp);

  -- chave desconhecida é erro (app antigo ou bug) — nunca ignorar em silêncio
  for v_chave in select jsonb_object_keys(v_resp) loop
    v_base := regexp_replace(v_chave, '_outro$', '');
    if not (v_perg ? v_chave)
       and not (v_chave like '%\_outro' and v_perg ? v_base
                and exists (select 1 from jsonb_array_elements(coalesce(v_perg->v_base->'opcoes', '[]')) o
                             where coalesce((o->>'especificar')::boolean, false))) then
      raise exception 'socio:resposta_invalida: chave desconhecida %', v_chave;
    end if;
    if v_perg ? v_chave and v_perg->v_chave->>'tipo' = 'tabela' then
      raise exception 'socio:resposta_invalida: % não pertence a respostas', v_chave;
    end if;
  end loop;

  foreach v_chave in array v_apl loop
    continue when not (v_resp ? v_chave);
    p := v_perg -> v_chave;
    v_val := v_resp -> v_chave;
    if v_val = '"_nr"'::jsonb then
      v_out := v_out || jsonb_build_object(v_chave, v_val);
      continue;
    end if;
    v_opcoes := coalesce((select jsonb_agg(o->'v') from jsonb_array_elements(p->'opcoes') o), '[]');
    case p->>'tipo'
      when 'unica' then
        if jsonb_typeof(v_val) <> 'string' or not (v_opcoes @> jsonb_build_array(v_val)) then
          raise exception 'socio:resposta_invalida: % fora das opções', v_chave;
        end if;
      when 'multipla' then
        if jsonb_typeof(v_val) <> 'array' or jsonb_array_length(v_val) = 0
           or exists (select 1 from jsonb_array_elements(v_val) e where jsonb_typeof(e) <> 'string')
           or not (v_opcoes @> v_val)
           or (select count(*) <> count(distinct e) from jsonb_array_elements(v_val) e) then
          raise exception 'socio:resposta_invalida: % fora das opções', v_chave;
        end if;
        v_excl := coalesce((select jsonb_agg(o->'v') from jsonb_array_elements(p->'opcoes') o
                             where coalesce((o->>'exclusiva')::boolean, false)), '[]');
        if jsonb_array_length(v_val) > 1
           and exists (select 1 from jsonb_array_elements(v_val) e where v_excl @> jsonb_build_array(e)) then
          raise exception 'socio:resposta_invalida: % tem opção exclusiva junto com outras', v_chave;
        end if;
        if p ? 'max_marcar' and jsonb_array_length(v_val) > (p->>'max_marcar')::int then
          raise exception 'socio:resposta_invalida: % passa do limite de % opções', v_chave, p->>'max_marcar';
        end if;
      when 'inteiro', 'decimal' then
        if jsonb_typeof(v_val) <> 'number' then
          raise exception 'socio:resposta_invalida: % deve ser número', v_chave;
        end if;
        v_n := (v_val #>> '{}')::numeric;
        if (p->>'tipo' = 'inteiro' and v_n <> trunc(v_n))
           or (p ? 'min' and v_n < (p->>'min')::numeric)
           or (p ? 'max' and v_n > (p->>'max')::numeric) then
          raise exception 'socio:resposta_invalida: % fora do intervalo', v_chave;
        end if;
      when 'texto', 'texto_longo' then
        if jsonb_typeof(v_val) <> 'string'
           or length(v_val #>> '{}') > coalesce((p->>'max_len')::int, v_maxlen) then
          raise exception 'socio:resposta_invalida: % texto inválido', v_chave;
        end if;
        continue when btrim(v_val #>> '{}') = '';
      else
        raise exception 'socio:estrutura_invalida: tipo % em %', p->>'tipo', v_chave;
    end case;
    v_out := v_out || jsonb_build_object(v_chave, v_val);

    -- "especifique": só com a opção "outro" marcada
    if v_resp ? (v_chave || '_outro') then
      if jsonb_typeof(v_resp->(v_chave || '_outro')) <> 'string'
         or length(v_resp->>(v_chave || '_outro')) > v_outlen then
        raise exception 'socio:resposta_invalida: %_outro inválido', v_chave;
      end if;
      if not (v_val = '"outro"'::jsonb or (jsonb_typeof(v_val) = 'array' and v_val @> '["outro"]')) then
        raise exception 'socio:resposta_invalida: %_outro sem a opção Outro marcada', v_chave;
      end if;
      if btrim(v_resp->>(v_chave || '_outro')) <> '' then
        v_out := v_out || jsonb_build_object(v_chave || '_outro', v_resp->(v_chave || '_outro'));
      end if;
    end if;
  end loop;
  return v_out;
end $$;

-- Lista de alertas da revisão (o app mostra antes de salvar; a mesa, na
-- validação). p_respostas já normalizada; p_linhas = linhas normalizadas.
create or replace function public.fn_socio_calcular_alertas(
  p_estrutura jsonb, p_respostas jsonb, p_linhas jsonb,
  p_usou_carencia boolean, p_comunidade_nova boolean)
returns jsonb language plpgsql immutable set search_path = public as $$
declare
  v_al     jsonb := '[]'::jsonb;
  v_apl    text[] := fn_socio_aplicaveis(p_estrutura, p_respostas);
  v_linhas jsonb := coalesce(p_linhas, '[]'::jsonb);
  v_perg   jsonb;
  v_tab    jsonb;
  r        record;
  p        jsonb;
  v        jsonb;
  c        jsonb;
begin
  if p_respostas = '{}'::jsonb then
    return v_al;   -- recusa: nada a cobrar
  end if;
  select coalesce(jsonb_object_agg(pergunta->>'chave', pergunta), '{}'::jsonb) into v_perg
    from fn_socio_perguntas(p_estrutura);

  for r in select pergunta from fn_socio_perguntas(p_estrutura) order by ordem loop
    p := r.pergunta;
    continue when not ((p->>'chave') = any(v_apl));
    continue when coalesce((p->>'opcional')::boolean, false) or p ? 'derivada';
    v := p_respostas -> (p->>'chave');
    if v is null then
      v_al := v_al || jsonb_build_object('tipo', 'pendente', 'chave', p->>'chave', 'n', p->'n');
      continue;
    end if;
    if (v = '"outro"' or (jsonb_typeof(v) = 'array' and v @> '["outro"]'))
       and not (p_respostas ? ((p->>'chave') || '_outro')) then
      v_al := v_al || jsonb_build_object('tipo', 'outro_sem_texto', 'chave', p->>'chave', 'n', p->'n');
    end if;
    if jsonb_typeof(v) = 'number' then
      if p ? 'aviso_min' and (v #>> '{}')::numeric < (p->>'aviso_min')::numeric then
        v_al := v_al || jsonb_build_object('tipo', 'abaixo_do_esperado', 'chave', p->>'chave', 'n', p->'n');
      end if;
      if p ? 'aviso_max' and (v #>> '{}')::numeric > (p->>'aviso_max')::numeric then
        v_al := v_al || jsonb_build_object('tipo', 'acima_do_esperado', 'chave', p->>'chave', 'n', p->'n');
      end if;
    end if;
  end loop;

  -- lista: vazia (se o instrumento exige) e entrevistado na 1ª linha
  select pergunta into v_tab from fn_socio_perguntas(p_estrutura)
   where pergunta->>'tipo' = 'tabela' order by ordem limit 1;
  if v_tab is not null then
    if jsonb_array_length(v_linhas) = 0 then
      if coalesce((p_estrutura->'lista'->>'minimo')::int, 1) >= 1 then
        v_al := v_al || jsonb_build_object('tipo', 'pendente', 'chave', v_tab->>'chave', 'n', v_tab->'n');
      end if;
    elsif coalesce((p_estrutura->'lista'->>'marca_entrevistado')::boolean, false)
          and not exists (select 1 from jsonb_array_elements(v_linhas) l
                           where (l->>'ordem')::int = 1 and coalesce((l->>'e_entrevistado')::boolean, false)) then
      v_al := v_al || jsonb_build_object('tipo', 'entrevistado_fora_da_1a_linha', 'chave', v_tab->>'chave', 'n', v_tab->'n');
    end if;
  end if;

  -- coerência declarada na estrutura
  for c in select * from jsonb_array_elements(coalesce(p_estrutura->'coerencia', '[]'::jsonb)) loop
    v := p_respostas -> (c->>'chave');
    if c->>'tipo' = 'igual_total_linhas' then
      if jsonb_typeof(v) = 'number' and (v #>> '{}')::numeric <> jsonb_array_length(v_linhas) then
        v_al := v_al || jsonb_build_object('tipo', 'diverge_da_lista', 'chave', c->>'chave',
                          'n', v_perg->(c->>'chave')->'n', 'informado', v, 'listados', jsonb_array_length(v_linhas));
      end if;
    elsif c->>'tipo' = 'nega_linha' then
      if (v = c->'valor' or (jsonb_typeof(v) = 'array' and v @> jsonb_build_array(c->'valor')))
         and exists (select 1 from jsonb_array_elements(v_linhas) l where fn_socio_linha_casa(c->'onde', l)) then
        v_al := v_al || jsonb_build_object('tipo', 'incoerente_com_lista', 'chave', c->>'chave',
                          'n', v_perg->(c->>'chave')->'n');
      end if;
    end if;
  end loop;

  if p_usou_carencia then
    v_al := v_al || jsonb_build_object('tipo', 'enviada_na_carencia');
  end if;
  if p_comunidade_nova then
    v_al := v_al || jsonb_build_object('tipo', 'comunidade_nova');
  end if;
  return v_al;
end $$;

-- ── Validação da ESTRUTURA (antes de salvar/publicar uma versão) ────────
-- Agora quem escreve questionário são vários departamentos: a estrutura é
-- conferida aqui, e o erro volta como lista legível para o editor.
create or replace function public.fn_socio_validar_onde(p_onde jsonb, p_cols jsonb, p_onde_txt text)
returns text[] language plpgsql immutable set search_path = public as $$
declare e text[] := '{}';
begin
  if jsonb_typeof(p_onde) is distinct from 'object' then
    return array[p_onde_txt || ': filtro "onde" ausente'];
  end if;
  if not (p_cols ? coalesce(p_onde->>'coluna', '')) then
    e := e || (p_onde_txt || ': coluna "' || coalesce(p_onde->>'coluna', '') || '" não existe na lista');
  end if;
  if coalesce(p_onde->>'op', '') not in ('=', '!=', 'in', 'entre') then
    e := e || (p_onde_txt || ': operador de filtro inválido');
  elsif p_onde->>'op' = 'in' and jsonb_typeof(p_onde->'valor') is distinct from 'array' then
    e := e || (p_onde_txt || ': "in" exige uma lista de valores');
  elsif p_onde->>'op' = 'entre' and (jsonb_typeof(p_onde->'valor') is distinct from 'array'
        or jsonb_array_length(p_onde->'valor') <> 2
        or jsonb_typeof(p_onde->'valor'->0) <> 'number' or jsonb_typeof(p_onde->'valor'->1) <> 'number') then
    e := e || (p_onde_txt || ': "entre" exige [mínimo, máximo]');
  elsif p_onde->>'op' in ('=', '!=') and jsonb_typeof(p_onde->'valor') not in ('string', 'number', 'boolean') then
    e := e || (p_onde_txt || ': valor do filtro inválido');
  end if;
  return e;
end $$;

create or replace function public.fn_socio_validar_cond(p_cond jsonb, p_vistas text[], p_chave text)
returns text[] language plpgsql immutable set search_path = public as $$
declare
  e text[] := '{}';
  c jsonb;
begin
  if jsonb_typeof(p_cond) is distinct from 'object' then
    return array[p_chave || ': mostrar_se inválido'];
  end if;
  if p_cond ? 'todas' then
    if jsonb_typeof(p_cond->'todas') <> 'array' or jsonb_array_length(p_cond->'todas') = 0 then
      return array[p_chave || ': "todas" exige uma lista de condições'];
    end if;
    for c in select * from jsonb_array_elements(p_cond->'todas') loop
      e := e || fn_socio_validar_cond(c, p_vistas, p_chave);
    end loop;
    return e;
  end if;
  if not (coalesce(p_cond->>'se', '') = any(p_vistas)) then
    e := e || (p_chave || ': o salto depende de "' || coalesce(p_cond->>'se', '') || '", que não é pergunta anterior');
  end if;
  if coalesce(p_cond->>'op', '') not in ('=', '!=', 'in', 'contem', 'nao_contem') then
    e := e || (p_chave || ': operador de salto inválido');
  elsif p_cond->>'op' = 'in' and jsonb_typeof(p_cond->'valor') is distinct from 'array' then
    e := e || (p_chave || ': "in" exige uma lista de valores');
  elsif p_cond->>'op' <> 'in' and jsonb_typeof(p_cond->'valor') is distinct from 'string' then
    e := e || (p_chave || ': valor do salto deve ser texto');
  end if;
  return e;
end $$;

create or replace function public.fn_socio_validar_estrutura(p jsonb)
returns text[] language plpgsql immutable set search_path = public as $$
declare
  e        text[] := '{}';
  b        jsonb;
  q        jsonb;
  o        jsonb;
  c        jsonb;
  d        jsonb;
  v_blocos text[] := '{}';
  v_vistas text[] := '{}';
  v_vs     text[];
  v_cols   jsonb := '{}'::jsonb;
  v_ntab   int := 0;
  v_chave  text;
  v_lista  jsonb := p->'lista';
  v_tipos  text[] := array['unica','multipla','inteiro','decimal','texto','texto_longo','tabela'];
begin
  if jsonb_typeof(p) is distinct from 'object' then
    return array['a estrutura deve ser um objeto JSON'];
  end if;
  if jsonb_typeof(p->'blocos') is distinct from 'array' or jsonb_array_length(p->'blocos') = 0 then
    return array['a estrutura precisa de "blocos" com ao menos um bloco'];
  end if;

  -- lista (colunas) antes das perguntas: derivada e filtro dependem dela
  if v_lista is not null then
    if jsonb_typeof(v_lista->'colunas') is distinct from 'array' or jsonb_array_length(v_lista->'colunas') = 0 then
      e := e || 'lista: precisa de "colunas"'::text;
    else
      for c in select * from jsonb_array_elements(v_lista->'colunas') loop
        v_chave := coalesce(c->>'chave', '');
        if v_chave !~ '^[a-z][a-z0-9_]{0,39}$' or v_chave in ('ordem', 'e_entrevistado') then
          e := e || ('lista: chave de coluna inválida "' || v_chave || '"');
        elsif v_cols ? v_chave then
          e := e || ('lista: coluna repetida "' || v_chave || '"');
        end if;
        if coalesce(c->>'tipo', '') not in ('unica', 'inteiro', 'texto', 'booleano') then
          e := e || ('lista: tipo inválido na coluna "' || v_chave || '"');
        end if;
        if length(btrim(coalesce(c->>'rotulo', ''))) = 0 then
          e := e || ('lista: coluna "' || v_chave || '" sem rótulo');
        end if;
        if c->>'tipo' = 'unica' and (jsonb_typeof(c->'opcoes') is distinct from 'array' or jsonb_array_length(c->'opcoes') = 0) then
          e := e || ('lista: coluna "' || v_chave || '" sem opções');
        end if;
        v_cols := v_cols || jsonb_build_object(v_chave, c);
      end loop;
    end if;
    if v_lista ? 'max_linhas' and (jsonb_typeof(v_lista->'max_linhas') <> 'number' or (v_lista->>'max_linhas')::numeric not between 1 and 200) then
      e := e || 'lista: max_linhas deve ficar entre 1 e 200'::text;
    end if;
  end if;

  for b in select * from jsonb_array_elements(p->'blocos') loop
    if coalesce(b->>'id', '') !~ '^[a-z][a-z0-9_]{0,39}$' then
      e := e || ('bloco com id inválido "' || coalesce(b->>'id', '') || '"');
    elsif (b->>'id') = any(v_blocos) then
      e := e || ('bloco repetido "' || (b->>'id') || '"');
    end if;
    v_blocos := v_blocos || coalesce(b->>'id', '');
    if length(btrim(coalesce(b->>'titulo', ''))) = 0 then
      e := e || ('bloco "' || coalesce(b->>'id', '') || '" sem título');
    end if;
    if jsonb_typeof(b->'perguntas') is distinct from 'array' or jsonb_array_length(b->'perguntas') = 0 then
      e := e || ('bloco "' || coalesce(b->>'id', '') || '" sem perguntas');
      continue;
    end if;
    for q in select * from jsonb_array_elements(b->'perguntas') loop
      v_chave := coalesce(q->>'chave', '');
      if v_chave !~ '^[a-z][a-z0-9_]{0,59}$' or v_chave like '%\_outro' then
        e := e || ('pergunta com chave inválida "' || v_chave || '"');
      elsif v_chave = any(v_vistas) then
        e := e || ('chave repetida "' || v_chave || '"');
      end if;
      if not (coalesce(q->>'tipo', '') = any(v_tipos)) then
        e := e || (v_chave || ': tipo inválido');
      end if;
      if jsonb_typeof(q->'n') is distinct from 'number' or (q->>'n')::numeric <> trunc((q->>'n')::numeric) then
        e := e || (v_chave || ': "n" (número da pergunta) deve ser inteiro');
      end if;
      if length(btrim(coalesce(q->>'texto', ''))) = 0 then
        e := e || (v_chave || ': sem texto');
      end if;
      if q->>'tipo' in ('unica', 'multipla') then
        if jsonb_typeof(q->'opcoes') is distinct from 'array' or jsonb_array_length(q->'opcoes') = 0 then
          e := e || (v_chave || ': sem opções');
        else
          v_vs := '{}';
          for o in select * from jsonb_array_elements(q->'opcoes') loop
            if coalesce(o->>'v', '') !~ '^[a-z0-9_]{1,60}$' or o->>'v' = '_nr' then
              e := e || (v_chave || ': opção com valor inválido "' || coalesce(o->>'v', '') || '"');
            elsif (o->>'v') = any(v_vs) then
              e := e || (v_chave || ': opção repetida "' || (o->>'v') || '"');
            end if;
            v_vs := v_vs || coalesce(o->>'v', '');
            if length(btrim(coalesce(o->>'r', ''))) = 0 then
              e := e || (v_chave || ': opção "' || coalesce(o->>'v', '') || '" sem rótulo');
            end if;
          end loop;
        end if;
      end if;
      if q ? 'max_marcar' and (q->>'tipo' <> 'multipla' or jsonb_typeof(q->'max_marcar') <> 'number' or (q->>'max_marcar')::numeric < 1) then
        e := e || (v_chave || ': max_marcar só em múltipla, a partir de 1');
      end if;
      if q ? 'min' and q ? 'max' and (q->>'min')::numeric > (q->>'max')::numeric then
        e := e || (v_chave || ': mínimo maior que o máximo');
      end if;
      if q->>'tipo' = 'tabela' then
        v_ntab := v_ntab + 1;
        if v_lista is null then
          e := e || (v_chave || ': pergunta de lista sem "lista" na estrutura');
        end if;
      end if;
      if q ? 'mostrar_se' then
        e := e || fn_socio_validar_cond(q->'mostrar_se', v_vistas, v_chave);
      end if;
      if q ? 'derivada' then
        d := q->'derivada';
        if v_lista is null then
          e := e || (v_chave || ': derivada exige "lista"');
        elsif d->>'tipo' = 'total_linhas' then
          if q->>'tipo' <> 'inteiro' then e := e || (v_chave || ': total_linhas exige pergunta inteiro'); end if;
        elsif d->>'tipo' = 'existe_linha' then
          e := e || fn_socio_validar_onde(d->'onde', v_cols, v_chave);
          if q->>'tipo' <> 'unica' or not exists (select 1 from jsonb_array_elements(q->'opcoes') x where x->'v' = coalesce(d->'sim', '"sim"'))
             or not exists (select 1 from jsonb_array_elements(q->'opcoes') x where x->'v' = coalesce(d->'nao', '"nao"')) then
            e := e || (v_chave || ': existe_linha exige pergunta única com as opções de sim e de não');
          end if;
        elsif d->>'tipo' = 'maior_nivel' then
          if q->>'tipo' <> 'unica' or coalesce(v_cols->(d->>'coluna')->>'tipo', '') <> 'unica' then
            e := e || (v_chave || ': maior_nivel exige pergunta única e coluna única da lista');
          end if;
        else
          e := e || (v_chave || ': derivada desconhecida');
        end if;
      end if;
      v_vistas := v_vistas || v_chave;
    end loop;
  end loop;

  if v_ntab > 1 then
    e := e || 'só pode haver uma pergunta de lista'::text;
  elsif v_ntab = 0 and v_lista is not null then
    e := e || '"lista" declarada sem pergunta do tipo tabela que diga onde ela aparece'::text;
  end if;

  for c in select * from jsonb_array_elements(coalesce(p->'coerencia', '[]'::jsonb)) loop
    if not (coalesce(c->>'chave', '') = any(v_vistas)) then
      e := e || ('coerência: pergunta "' || coalesce(c->>'chave', '') || '" não existe');
    end if;
    if c->>'tipo' = 'igual_total_linhas' then
      if v_lista is null then e := e || 'coerência: igual_total_linhas exige "lista"'::text; end if;
    elsif c->>'tipo' = 'nega_linha' then
      if v_lista is null then
        e := e || 'coerência: nega_linha exige "lista"'::text;
      else
        e := e || fn_socio_validar_onde(c->'onde', v_cols, 'coerência ' || coalesce(c->>'chave', ''));
      end if;
      if jsonb_typeof(c->'valor') is distinct from 'string' then
        e := e || 'coerência: nega_linha exige "valor" (opção)'::text;
      end if;
    else
      e := e || 'coerência: tipo desconhecido'::text;
    end if;
  end loop;

  if p ? 'identificacao' then
    if coalesce(p->'identificacao'->>'nome', 'nao') not in ('nao', 'opcional')
       or coalesce(p->'identificacao'->>'gps', 'nao') not in ('nao', 'opcional') then
      e := e || 'identificacao: nome e gps aceitam "nao" ou "opcional"'::text;
    end if;
  end if;
  return e;
end $$;

-- todas imutáveis/puras: sem acesso a tabela; EXECUTE só para logado
do $$
declare f text;
begin
  foreach f in array array[
    'fn_socio_perguntas(jsonb)', 'fn_socio_cond(jsonb, jsonb, text[])',
    'fn_socio_aplicaveis(jsonb, jsonb)', 'fn_socio_linha_casa(jsonb, jsonb)',
    'fn_socio_linhas_normalizar(jsonb, jsonb)', 'fn_socio_derivada(jsonb, jsonb, jsonb)',
    'fn_socio_normalizar_respostas(jsonb, jsonb, jsonb)',
    'fn_socio_calcular_alertas(jsonb, jsonb, jsonb, boolean, boolean)',
    'fn_socio_validar_onde(jsonb, jsonb, text)', 'fn_socio_validar_cond(jsonb, text[], text)',
    'fn_socio_validar_estrutura(jsonb)'] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
