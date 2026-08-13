#!/usr/bin/env python3
# ── SIGUC-AC · Qualidade da Água — gerador da migration de import ──
# Fase 1 do plano em docs/qualidade-agua/plano.md.
#
# Lê docs/qualidade-agua/serie-historica.csv e escreve o corpo SQL de
# `INSERT INTO _agua_import_raw VALUES (...)` usado pela migration
# 253_agua_import_serie_historica.sql. Não escreve a migration inteira
# de propósito: o resto (joins, quarentena, sanity checks, RLS já
# existente) é SQL de mão, revisável linha a linha — só a carga bruta
# das 450 linhas é mecânica o bastante para gerar.
#
# Uso: python3 scripts/agua_gerar_migration_serie_historica.py
#      (imprime o bloco VALUES em stdout; colar na migration)
#
# Reaproveita csv.reader (parser de verdade, não split(',')) pelo
# mesmo motivo do parser em tests/agua-iqa.test.js: 143 das 451 linhas
# têm campo entre aspas com vírgula dentro.

import csv
import re
import sys
from pathlib import Path

CSV_PATH = Path(__file__).resolve().parent.parent / "docs" / "qualidade-agua" / "serie-historica.csv"


def num(s):
    """Converte texto numérico da planilha para float, ou None.

    Regra da decisão 3 do plano + achado 5: vírgula é separador
    decimal ('23,00' -> 23.00); quando há MAIS de uma vírgula, são
    separadores de milhar mal digitados ('2,419,00') e são removidos.
    'Não' (achado nesta planilha, coluna DescargaLiquida) e valores
    que não fecham como número (formato internacional misto, ex.
    '1,745.050') viram None — não são adivinhados.
    """
    if s is None:
        return None
    t = s.strip()
    if not t or t == "Não":
        return None
    t = re.sub(r"\s", "", t)
    if t.count(",") > 1:
        t = t.replace(",", "")
    else:
        t = t.replace(",", ".")
    try:
        return float(t)
    except ValueError:
        return None


def parse_censurado(s):
    """Valor '<N' -> (None, censurado=True, limite=N). Sem '<' -> (valor, False, None)."""
    if s is None:
        return None, False, None
    t = s.strip()
    if not t:
        return None, False, None
    if t.startswith("<"):
        limite = num(t[1:])
        return None, True, limite
    return num(t), False, None


def parse_hora(s):
    """'HH:MM' / ' HH:MM:SS ' -> literal SQL time; '1900-01-01' (bug do Excel) e vazio -> NULL."""
    t = (s or "").strip()
    if not t or t == "1900-01-01":
        return "NULL"
    if re.match(r"^\d{1,2}:\d{2}(:\d{2})?$", t):
        return f"TIME '{t}'"
    raise ValueError(f"Hora não reconhecida: {t!r}")


def parse_campanha(s):
    return s.strip().lower()


def sql_num(v):
    return "NULL" if v is None else repr(v)


def sql_str(v):
    if v is None:
        return "NULL"
    return "'" + str(v).replace("'", "''") + "'"


def main():
    with CSV_PATH.open(newline="", encoding="utf-8") as f:
        rows = list(csv.reader(f))
    header, data = rows[0], rows[1:]
    col = {name: i for i, name in enumerate(header)}

    def g(r, name):
        return r[col[name]]

    linhas_sql = []
    for r in data:
        linha = int(g(r, "linha_origem"))
        estacao = g(r, "EstacaoCodigo").strip()
        ano = int(g(r, "Ano").strip())
        ordem = parse_campanha(g(r, "Campanha"))
        data_coleta = g(r, "Data").strip()
        hora = parse_hora(g(r, "Hora"))

        temp_ar = num(g(r, "Temp Ar"))
        temp_amostra = num(g(r, "Temp Amostra"))
        ph = num(g(r, "pH"))
        od = num(g(r, "OD"))
        turbidez = num(g(r, "Turbidez"))
        cond_eletrica = num(g(r, "Condutividade Eletrica"))
        dbo = num(g(r, "DBO"))
        n_total = num(g(r, "NitrogenioTotal"))
        n_amoniacal = num(g(r, "NitrogenioAmoniacal"))
        nitratos = num(g(r, "Nitratos"))
        fosforo_total = num(g(r, "FosforoTotal"))
        ortofosfato_diss = num(g(r, "Ortofosfato Dissolvido"))
        sol_diss = num(g(r, "SolDissolvidosTotais"))
        sol_susp = num(g(r, "SolSuspensaoTotais"))
        coli_val, coli_cens, coli_limite = parse_censurado(g(r, "ColiformesTermotolerantes"))
        coli_totais = num(g(r, "ColiformesTotais"))
        escherichia = num(g(r, "Escherichia"))
        alcalinidade = num(g(r, "AlcalinidadeTotal"))
        carbono_org = num(g(r, "CarbonoOrganicoTotal"))
        cloreto = num(g(r, "Cloreto"))
        cond_especifica = num(g(r, "CondutividadeEspecifica"))
        descarga = num(g(r, "DescargaLiquida"))

        vals = [
            str(linha), sql_str(estacao), str(ano), sql_str(ordem),
            f"DATE '{data_coleta}'", hora,
            sql_num(temp_ar), sql_num(temp_amostra), sql_num(ph), sql_num(od), sql_num(turbidez),
            sql_num(cond_eletrica), sql_num(dbo),
            sql_num(n_total), sql_num(n_amoniacal), sql_num(nitratos),
            sql_num(fosforo_total), sql_num(ortofosfato_diss),
            sql_num(sol_diss), sql_num(sol_susp),
            sql_num(coli_val), "true" if coli_cens else "false", sql_num(coli_limite),
            sql_num(coli_totais), sql_num(escherichia), sql_num(alcalinidade),
            sql_num(carbono_org), sql_num(cloreto), sql_num(cond_especifica), sql_num(descarga),
        ]
        linhas_sql.append(f"  ({', '.join(vals)})")

    print(",\n".join(linhas_sql) + ";")
    print(f"-- {len(linhas_sql)} linhas geradas", file=sys.stderr)


if __name__ == "__main__":
    main()
