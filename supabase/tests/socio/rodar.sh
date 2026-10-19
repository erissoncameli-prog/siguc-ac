#!/usr/bin/env bash
# Testa as migrations do Diagnóstico Socioeconômico (362*) num Postgres 16
# LOCAL e descartável. Nada aqui toca o Supabase de produção.
#   uso: supabase/tests/socio/rodar.sh
# Requer os binários do Postgres 16 (initdb/pg_ctl), o usuário "postgres",
# node e python3.
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
RAIZ="$(cd "$DIR/../../.." && pwd)"
BIN="${PG_BIN:-/usr/lib/postgresql/16/bin}"
TMP="$(mktemp -d)"; chmod 755 "$TMP"; chown postgres "$TMP"
PORTA=54331
trap 'su postgres -c "$BIN/pg_ctl -D $TMP/data -m immediate stop" >/dev/null 2>&1 || true; rm -rf "$TMP"' EXIT

su postgres -c "$BIN/initdb -D $TMP/data -A trust -U postgres" >/dev/null
su postgres -c "$BIN/pg_ctl -D $TMP/data -o '-p $PORTA -k $TMP' -l $TMP/log -w start" >/dev/null

export PGOPTIONS="-c client_min_messages=warning"
PSQL=(psql -h "$TMP" -p "$PORTA" -U postgres -d postgres -v ON_ERROR_STOP=1 -q -X)

"${PSQL[@]}" -f "$DIR/00_stub.sql"
for f in "$RAIZ"/supabase/migrations/362_socio_estrutura.sql \
         "$RAIZ"/supabase/migrations/362b_socio_interpretador.sql \
         "$RAIZ"/supabase/migrations/362c_socio_rpcs.sql \
         "$RAIZ"/supabase/migrations/363_socio_app_campo.sql \
         "$RAIZ"/supabase/migrations/364_socio_mesa_campanhas_validacao.sql \
         "$RAIZ"/supabase/migrations/365_socio_indicadores_exportacao_retencao.sql; do
  echo "· aplicando $(basename "$f")"
  "${PSQL[@]}" -f "$f"
done
# idempotência: reaplicar não pode falhar nem duplicar o ROPA
for f in "$RAIZ"/supabase/migrations/362b_socio_interpretador.sql \
         "$RAIZ"/supabase/migrations/362c_socio_rpcs.sql \
         "$RAIZ"/supabase/migrations/363_socio_app_campo.sql \
         "$RAIZ"/supabase/migrations/364_socio_mesa_campanhas_validacao.sql \
         "$RAIZ"/supabase/migrations/365_socio_indicadores_exportacao_retencao.sql; do
  "${PSQL[@]}" -f "$f"
done

# estruturas de teste viram tabela (os testes e o teste cruzado leem daqui)
# o modelo que o editor da mesa oferece (js/socio-previa.js) tem de passar na
# mesma conferência que barra a publicação
node -e "process.stdout.write(JSON.stringify(require('$RAIZ/js/socio-previa.js').modelo()))" > "$TMP/estrutura-modelo.json"
cp "$DIR"/estrutura-domicilio.json "$DIR"/estrutura-pessoa.json "$TMP/"
python3 - "$TMP" > "$TMP/fixtures.sql" <<'PY'
import sys, json, os
d = sys.argv[1]
print("create table public.teste_estruturas (nome text primary key, estrutura jsonb not null);")
for n in ("domicilio", "pessoa", "modelo"):
    j = json.dumps(json.load(open(os.path.join(d, f"estrutura-{n}.json"), encoding="utf-8")), ensure_ascii=False)
    print(f"insert into public.teste_estruturas values ('{n}', $j${j}$j$::jsonb);")
print("grant select on public.teste_estruturas to authenticated;")
PY
"${PSQL[@]}" -f "$TMP/fixtures.sql"

echo "· rodando testes de acesso e fluxo"
"${PSQL[@]}" -o /dev/null -f "$DIR/10_testes.sql"
echo "  ok"

echo "· teste cruzado das regras (js/socio-regras.js × SQL)"
node "$DIR/regras_cruzadas.js" gerar "$TMP/casos.jsonl"
python3 - "$TMP/casos.jsonl" > "$TMP/casos.sql" <<'PY'
import sys
for l in open(sys.argv[1], encoding='utf-8'):
    l = l.strip()
    if l: print("insert into casos values ($j$" + l + "$j$::jsonb);")
PY
{ echo "create temp table casos (l jsonb);"; cat "$TMP/casos.sql";
  cat <<'SQL'
create function pg_temp.t_resultado(c jsonb) returns jsonb language plpgsql as $$
declare est jsonb := (select estrutura from public.teste_estruturas where nome = c->>'e');
        nl jsonb; n jsonb;
begin
  nl := public.fn_socio_linhas_normalizar(est, c->'lin');
  n := public.fn_socio_normalizar_respostas(est, c->'resp', nl);
  return jsonb_build_object('linhas', nl, 'resp', n,
    'alertas', public.fn_socio_calcular_alertas(est, n, nl, false, false),
    'apl', to_jsonb(public.fn_socio_aplicaveis(est, n)));
exception when others then
  return jsonb_build_object('erro', sqlerrm);
end $$;
select jsonb_build_object('id', l->'id', 'r', pg_temp.t_resultado(l))::text from casos order by (l->>'id')::int;
SQL
} | "${PSQL[@]}" -At > "$TMP/saida_sql.jsonl"
node "$DIR/regras_cruzadas.js" comparar "$TMP/casos.jsonl" "$TMP/saida_sql.jsonl"

echo "OK — todos os testes passaram"
