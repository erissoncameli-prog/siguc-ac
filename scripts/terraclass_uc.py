#!/usr/bin/env python3
"""
TerraClass por UC (migration 348) + diagnóstico do acumulado 2007 por município.

Roda FORA do banco, de propósito: cortar a geometria do TerraClass pelo
limite de cada UC exige baixar a geometria, e geometria de camada grande
pelo pg_net já reiniciou o banco de produção (ver CLAUDE.md, 25/09/2026).
Aqui o download e o recorte acontecem no runner do GitHub; o banco só
recebe os TOTAIS (ano × UC × classe), pela API de gerenciamento do Supabase.

Modos:
  --autoteste          lógica pura com dado sintético, sem rede (roda antes
                       de tudo no workflow; se falhar, nada é gravado)
  --uc <id|todas>      calcula e grava terraclass_uc (padrão: todas)
  --seco               calcula e mostra, sem gravar
  --d2007              diagnóstico do acumulado 2007 (PRODES) — só relatório

Variáveis: SUPABASE_ACCESS_TOKEN (segredo do repositório), SUPABASE_REF.
"""
import argparse
import json
import os
import sys
import time
from collections import defaultdict

import requests
from pyproj import Geod
from shapely import make_valid, wkt
from shapely.geometry import box, mapping, shape
from shapely.ops import transform
from shapely.prepared import prep

REF = os.environ.get('SUPABASE_REF', 'atqtybcsvepdabsvgaly')
TC_WFS = 'https://www.terraclass.gov.br/geoserver/ows'
TC_CAMADA = 'TerraClass:tc_transicoes_ac_amz_v6'
PRODES_WFS = 'https://terrabrasilis.dpi.inpe.br/geoserver/prodes-amazon-nb/ows'
PRODES_D2007 = 'prodes-amazon-nb:accumulated_deforestation_2007_biome'
ANOS = list(range(2008, 2025, 2))
# Classes que NÃO são uso: floresta primária, água, não observado, natural
# não florestal. Polígono que é só isso em TODOS os anos não qualifica
# desmatado nenhum e fica fora da consulta (e do download).
NATURAIS = (1, 23, 25, 51)
PAGINA = 500
GEOD = Geod(ellps='GRS80')
# Caixa do Acre com folga: coordenada fora disso vem com eixo trocado.
LON_MIN, LON_MAX, LAT_MIN, LAT_MAX = -75.5, -65.5, -12.5, -6.5


# ── Supabase (API de gerenciamento — o mesmo segredo do deploy) ─────────
def sql(query):
    token = os.environ['SUPABASE_ACCESS_TOKEN']
    for tentativa in range(4):
        r = requests.post(f'https://api.supabase.com/v1/projects/{REF}/database/query',
                          headers={'Authorization': f'Bearer {token}'},
                          json={'query': query}, timeout=120)
        if r.status_code < 500 and r.status_code != 429:
            break
        time.sleep(2 ** (tentativa + 1))
    if r.status_code >= 300:
        raise RuntimeError(f'SQL falhou ({r.status_code}): {r.text[:500]}')
    return r.json()


# ── Geometria ───────────────────────────────────────────────────────────
def trocar_eixo(g):
    return transform(lambda x, y, z=None: (y, x), g)


def eixo_trocado(geom_json):
    """True se a coordenada veio lat/lon (x dentro da faixa de latitude)."""
    c = geom_json['coordinates']
    while isinstance(c[0], (list, tuple)):
        c = c[0]
    x, y = c[0], c[1]
    return LAT_MIN <= x <= LAT_MAX and LON_MIN <= y <= LON_MAX


def area_ha(g):
    if g.is_empty:
        return 0.0
    a, _ = GEOD.geometry_area_perimeter(g)
    return abs(a) / 10000.0


def filtro_uc(uc_geom):
    """Polígono de busca que CONTÉM a UC: folga de ~1,1 km e simplificação
    de ~550 m (desvio < folga, então nada da UC fica de fora). Vai em ordem
    LAT LON — o GeoServer do TerraClass (EPSG:4674, WFS 1.1.0) lê assim; em
    lon/lat devolve 0 feições sem erro (medido)."""
    g = uc_geom.buffer(0.01).simplify(0.005, preserve_topology=True)
    return wkt.dumps(trocar_eixo(g), rounding_precision=5)


def cql_tc(uc_geom):
    uso_algum_ano = ' AND '.join(f'classe_{a} IN ({",".join(map(str, NATURAIS))})' for a in ANOS)
    return f'INTERSECTS(geom,{filtro_uc(uc_geom)}) AND NOT ({uso_algum_ano})'


# ── WFS paginado ────────────────────────────────────────────────────────
def wfs_paginado(url, camada, cql, propriedades=None):
    """Baixa TODAS as feições, uma página por vez, e confere o total —
    nunca devolve um conjunto pela metade."""
    vistos, feicoes, total, inicio = set(), [], None, 0
    while True:
        params = {'service': 'WFS', 'version': '1.1.0', 'request': 'GetFeature',
                  'typeName': camada, 'outputFormat': 'application/json',
                  'maxFeatures': PAGINA, 'startIndex': inicio, 'CQL_FILTER': cql}
        if propriedades:
            params['propertyName'] = propriedades
        for tentativa in range(5):
            try:
                r = requests.get(url, params=params, timeout=300)
                if r.status_code == 200:
                    break
            except requests.RequestException:
                pass
            time.sleep(5 * (tentativa + 1))
        else:
            raise RuntimeError(f'WFS falhou em startIndex={inicio}')
        j = r.json()
        if total is None:
            total = int(j.get('totalFeatures') or j.get('numberMatched') or 0)
        pagina = j.get('features') or []
        for f in pagina:
            fid = f.get('id')
            if fid in vistos:
                continue
            vistos.add(fid)
            feicoes.append(f)
        inicio += len(pagina)
        if not pagina or inicio >= total:
            break
    if len(feicoes) != total:
        raise RuntimeError(f'{camada}: {len(feicoes)} feições únicas de {total} — paginação inconsistente, nada gravado')
    return feicoes


# ── Agregação (pura) ────────────────────────────────────────────────────
def agregar(feicoes, uc_geom):
    """(ano, classe) → [polígonos, hectares] da parte DENTRO da UC."""
    uc_p = prep(uc_geom)
    agg = defaultdict(lambda: [0, 0.0])
    for f in feicoes:
        gj = f.get('geometry')
        if not gj:
            continue
        g = shape(trocar_eixo_json(gj) if eixo_trocado(gj) else gj)
        if not g.is_valid:
            g = make_valid(g)
        if not uc_p.intersects(g):
            continue
        parte = g if uc_p.contains(g) else g.intersection(uc_geom)
        ha = area_ha(parte)
        if ha <= 0:
            continue
        p = f['properties']
        for a in ANOS:
            c = p.get(f'classe_{a}')
            if c is None:
                continue
            item = agg[(a, int(c))]
            item[0] += 1
            item[1] += ha
    return agg


def trocar_eixo_json(gj):
    return mapping(trocar_eixo(shape(gj)))


def sql_gravar(uc_id, agg):
    linhas = ',\n'.join(f"({a}, '{uc_id}'::uuid, {c}, {n}, {round(ha, 2)})"
                        for (a, c), (n, ha) in sorted(agg.items()))
    corpo = f"DELETE FROM public.terraclass_uc WHERE uc_id = '{uc_id}'::uuid;\n"
    if linhas:
        corpo += ('INSERT INTO public.terraclass_uc (ano, uc_id, classe, poligonos, area_ha) VALUES\n'
                  + linhas + ';\n')
    return 'BEGIN;\n' + corpo + 'COMMIT;'


# ── Modos ───────────────────────────────────────────────────────────────
def ucs(filtro):
    onde = '' if filtro in (None, 'todas') else f" AND id = '{filtro}'::uuid"
    linhas = sql('SELECT id::text AS id, nome, ST_AsGeoJSON(ST_MakeValid(geom), 7) AS g '
                 f'FROM public.unidades_conservacao WHERE ativo AND geom IS NOT NULL{onde} ORDER BY nome')
    return [(r['id'], r['nome'], make_valid(shape(json.loads(r['g'])))) for r in linhas]


def rodar_ucs(filtro, seco, resumo):
    resumo.append('## TerraClass por UC\n\n| UC | polígonos baixados | uso em 2024 (ha) |\n|---|---:|---:|')
    for uc_id, nome, g in ucs(filtro):
        t0 = time.time()
        feicoes = wfs_paginado(TC_WFS, TC_CAMADA, cql_tc(g))
        agg = agregar(feicoes, g)
        uso24 = sum(ha for (a, c), (_, ha) in agg.items() if a == 2024 and c not in NATURAIS)
        print(f'{nome}: {len(feicoes)} feições, {len(agg)} linhas, uso 2024 = {uso24:,.0f} ha ({time.time() - t0:.0f}s)', flush=True)
        resumo.append(f'| {nome} | {len(feicoes):,} | {uso24:,.0f} |')
        if not seco:
            sql(sql_gravar(uc_id, agg))


def rodar_d2007(resumo):
    """Por que o acumulado 2007 somado por município dá ~1,4% acima do
    estado? Estado = soma do area_km do INPE; município = área da
    interseção após ST_MakeValid. Mede cada etapa com o mesmo dado."""
    feicoes = wfs_paginado(PRODES_WFS, PRODES_D2007, "state='AC'")
    inpe = brutas = validas = 0.0
    invalidas = 0
    geoms = []
    for f in feicoes:
        inpe += float(f['properties'].get('area_km') or 0) * 100
        gj = f['geometry']
        g = shape(trocar_eixo_json(gj) if eixo_trocado(gj) else gj)
        brutas += area_ha(g)
        if not g.is_valid:
            invalidas += 1
            g = make_valid(g)
        validas += area_ha(g)
        geoms.append(g)
    from shapely import union_all
    uniao = area_ha(union_all(geoms))
    muns = sql('SELECT cd_ibge, nome, ST_AsGeoJSON(ST_MakeValid(geom), 7) AS g FROM public.municipios_acre')
    soma_mun = 0.0
    for m in muns:
        mg = make_valid(shape(json.loads(m['g'])))
        mp = prep(mg)
        soma_mun += sum(area_ha(g.intersection(mg)) for g in geoms if mp.intersects(g))
    pct = lambda v: f'{100 * v / inpe - 100:+.2f}%'
    resumo += ['## Diagnóstico — acumulado até 2007 (PRODES), Acre',
               f'- Feições: {len(feicoes):,} ({invalidas:,} inválidas)',
               f'- Soma do `area_km` do INPE (o que o estado usa): {inpe:,.0f} ha',
               f'- Área geodésica da geometria como veio: {brutas:,.0f} ha ({pct(brutas)})',
               f'- Depois de `make_valid`: {validas:,.0f} ha ({pct(validas)})',
               f'- União (sem sobreposição): {uniao:,.0f} ha ({pct(uniao)})',
               f'- Soma das interseções com os 22 municípios: {soma_mun:,.0f} ha ({pct(soma_mun)})']
    print('\n'.join(resumo[-7:]))


def autoteste():
    """Casos de resposta conhecida, sem rede."""
    uc = box(-70.0, -10.0, -69.0, -9.0)
    dentro = box(-69.6, -9.6, -69.5, -9.5)          # inteiro dentro
    meio = box(-69.05, -9.6, -68.95, -9.5)          # metade fora (a leste)
    fora = box(-68.0, -9.6, -67.9, -9.5)            # fora
    props = lambda c24: {**{f'classe_{a}': 1 for a in ANOS}, 'classe_2024': c24, 'classe_2008': 11}
    feat = lambda g, c24, fid, flip=False: {'id': fid, 'properties': props(c24),
                                            'geometry': mapping(trocar_eixo(g) if flip else g)}
    fs = [feat(dentro, 11, 'a'), feat(meio, 2, 'b'), feat(fora, 11, 'c'), feat(dentro, 17, 'd', flip=True)]
    agg = agregar(fs, uc)
    a_dentro = area_ha(dentro)
    assert abs(agg[(2024, 11)][1] - a_dentro) < 1e-6, agg[(2024, 11)]
    assert agg[(2024, 11)][0] == 1                                   # o de fora não conta
    assert abs(agg[(2024, 2)][1] - area_ha(meio) / 2) / (area_ha(meio) / 2) < 0.01   # só a metade de dentro
    assert abs(agg[(2024, 17)][1] - a_dentro) < 1e-6                 # eixo trocado é corrigido
    assert agg[(2008, 11)][0] == 3                                   # cada ano conta o seu uso
    # filtro de busca contém a UC inteira, em ordem lat lon
    fb = trocar_eixo(wkt.loads(filtro_uc(uc)))
    assert fb.contains(uc)
    # área geodésica de 1°×1° perto do equador ~ 1,2 milhão de ha
    assert 1.1e6 < area_ha(uc) < 1.3e6
    s = sql_gravar('00000000-0000-0000-0000-000000000000', agg)
    assert s.startswith('BEGIN;') and s.rstrip().endswith('COMMIT;') and 'DELETE' in s
    print('autoteste: ok')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--autoteste', action='store_true')
    ap.add_argument('--uc', default=None)
    ap.add_argument('--seco', action='store_true')
    ap.add_argument('--d2007', action='store_true')
    a = ap.parse_args()
    autoteste()
    if a.autoteste:
        return
    resumo = []
    try:
        if a.d2007:
            rodar_d2007(resumo)
        else:
            rodar_ucs(a.uc, a.seco, resumo)
    finally:
        saida = os.environ.get('GITHUB_STEP_SUMMARY')
        if saida and resumo:
            with open(saida, 'a') as fh:
                fh.write('\n'.join(resumo) + '\n')


if __name__ == '__main__':
    sys.exit(main())
