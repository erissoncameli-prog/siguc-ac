#!/usr/bin/env python3
"""
Camadas de meio físico do Acre para o Mapa das UCs (Fase 4 do plano em
docs/mapa-ucs/plano-medicao-comparacao.md).

Roda no GitHub Actions, de propósito: os servidores do IBGE e da ANA
respondem 403 na rede das sessões de desenvolvimento (CLAUDE.md), e
geometria de camada grande nunca entra pelo pg_net (reiniciou o banco 3×).

Modos:
  --autoteste   recorte/simplificação/eixo com dado sintético, sem rede.
  --gerar [tema ...]  baixa do IBGE (BDiA 1:250 mil + clima), recorta pelo
                Acre (data/acre_estado.geojson, o mesmo do mapa), simplifica
                ~45 m e grava data/meio_fisico/<tema>.geojson. Tema que não
                cobrir 95–105% da área do estado NÃO é gravado.
  --descobrir-ana  idem para os servidores ArcGIS da ANA (o GeoServer dela
                não existe mais: o nome não resolve; o de metadados dá 403).
  --descobrir   lista as camadas que os serviços oferecem (por palavra-chave)
                e quantas feições cada uma tem dentro do retângulo do Acre.
                Não grava nada. É o primeiro passo: os nomes exatos das
                camadas não são adivinhados.
"""
import argparse
import json
import os
import re
import sys
import time
import xml.etree.ElementTree as ET
from datetime import date

import requests
from pyproj import Geod
from shapely import make_valid
from shapely.geometry import mapping, shape
from shapely.ops import transform, unary_union
from shapely.prepared import prep

GEOD = Geod(ellps='GRS80')

# Retângulo do Acre (lon/lat) com folga pequena
BBOX = (-74.0, -11.2, -66.5, -7.0)
UA = {'User-Agent': 'SIGUC-AC/1.0 (SEMA-AC; mapa das UCs)'}

# Serviços candidatos. A descoberta diz quais respondem e o que têm.
WFS = [
    ('IBGE geoservicos', 'https://geoservicos.ibge.gov.br/geoserver/ows'),
    ('IBGE BDiA', 'https://geoservicos.ibge.gov.br/geoserver/BDIA/ows'),
    ('ANA geoserver', 'https://geoserver.ana.gov.br/geoserver/ows'),
    ('ANA metadados', 'https://metadados.snirh.gov.br/geoserver/ows'),
]
ARCGIS = [
    ('ANA SNIRH arcgis', 'https://www.snirh.gov.br/arcgis/rest/services?f=json'),
    ('ANA portal1 arcgis', 'https://portal1.snirh.gov.br/server/rest/services?f=json'),
]
TEMAS = re.compile(r'geolog|geomorf|pedolog|solo|vegeta|clima|ottobac|bho|drenag|hidrog|trecho|curso|bacia|massa', re.I)


def capacidades(nome, url):
    try:
        r = requests.get(url, params={'service': 'WFS', 'request': 'GetCapabilities', 'version': '2.0.0'},
                         headers=UA, timeout=90)
    except Exception as e:  # noqa: BLE001 — descoberta: reportar e seguir
        print(f'## {nome}: ERRO {type(e).__name__}: {e}')
        return []
    print(f'## {nome}: HTTP {r.status_code}, {len(r.content)} bytes')
    if r.status_code != 200:
        return []
    try:
        raiz = ET.fromstring(r.content)
    except ET.ParseError as e:
        print(f'   XML inválido: {e}; início: {r.text[:200]!r}')
        return []
    achadas = []
    for ft in raiz.iter():
        if ft.tag.endswith('FeatureType'):
            n = t = ''
            for f in ft:
                if f.tag.endswith('Name'):
                    n = (f.text or '').strip()
                elif f.tag.endswith('Title'):
                    t = (f.text or '').strip()
            if n and (TEMAS.search(n) or TEMAS.search(t)):
                achadas.append((n, t))
    total = sum(1 for ft in raiz.iter() if ft.tag.endswith('FeatureType'))
    print(f'   {total} camadas no serviço, {len(achadas)} do tema')
    return achadas


def contar(url, camada):
    # resultType=hits: só o número, nenhuma geometria baixada
    p = {'service': 'WFS', 'version': '2.0.0', 'request': 'GetFeature', 'typeNames': camada,
         'resultType': 'hits', 'bbox': f'{BBOX[1]},{BBOX[0]},{BBOX[3]},{BBOX[2]},urn:ogc:def:crs:EPSG::4326'}
    try:
        r = requests.get(url, params=p, headers=UA, timeout=90)
        m = re.search(r'numberMatched="(\d+|unknown)"', r.text)
        return m.group(1) if m else f'HTTP {r.status_code} {r.text[:120]!r}'
    except Exception as e:  # noqa: BLE001
        return f'ERRO {type(e).__name__}'


def atributos(url, camada):
    p = {'service': 'WFS', 'version': '2.0.0', 'request': 'DescribeFeatureType', 'typeNames': camada}
    try:
        r = requests.get(url, params=p, headers=UA, timeout=90)
        nomes = re.findall(r'<(?:xsd:)?element[^>]*name="([^"]+)"[^>]*type="([^"]+)"', r.text)
        return ', '.join(f'{n}' for n, t in nomes if 'gml:' not in t)[:400]
    except Exception as e:  # noqa: BLE001
        return f'ERRO {type(e).__name__}'


def arcgis(nome, url):
    try:
        r = requests.get(url, headers=UA, timeout=60)
        print(f'## {nome}: HTTP {r.status_code}')
        if r.status_code == 200:
            j = r.json()
            for s in (j.get('folders') or [])[:60]:
                print(f'   pasta: {s}')
            for s in (j.get('services') or [])[:80]:
                if TEMAS.search(s.get('name', '')):
                    print(f"   serviço: {s.get('name')} ({s.get('type')})")
    except Exception as e:  # noqa: BLE001
        print(f'## {nome}: ERRO {type(e).__name__}: {e}')


def descobrir():
    for nome, url in WFS:
        for camada, titulo in capacidades(nome, url):
            print(f'   - {camada} | {titulo} | no Acre: {contar(url, camada)}')
            print(f'       atributos: {atributos(url, camada)}')
    for nome, url in ARCGIS:
        arcgis(nome, url)


# ── Geração dos arquivos (IBGE BDiA, 1:250 mil) ──────────────────────────
BDIA = 'https://geoservicos.ibge.gov.br/geoserver/BDIA/ows'
CGEO = 'https://geoservicos.ibge.gov.br/geoserver/ows'
# tema → (serviço, camada, atributos mantidos). Atributo fora da lista não
# entra no arquivo (o popup mostra o que vier, então a lista É o que o
# usuário vê). Nomes conferidos no DescribeFeatureType da descoberta.
TEMAS_IBGE = {
    'geologia': (BDIA, 'BDIA:geol_area', ['nm_unidade', 'letra_simb', 'nm_tempo_g', 'nm_provincia',
                                          'nm_sub_provincia', 'nm_lito1', 'nm_lito2', 'nm_lito3']),
    'geomorfologia': (BDIA, 'BDIA:geom_area', ['nm_dominio', 'nm_regiao', 'nm_unidade', 'letra_simb',
                                               'compartimento', 'categoria', 'natureza', 'forma', 'legenda']),
    'pedologia': (BDIA, 'BDIA:pedo_area', ['legenda_2', 'ordem', 'subordem', 'grande_gru', 'nom_unidad',
                                           'cod_simbol', 'textura', 'horizonte', 'relevo', 'componente']),
    'vegetacao': (BDIA, 'BDIA:vege_area', ['leg_sup', 'legenda_2', 'legenda_1', 'nm_uveg', 'nm_uantr',
                                           'nm_contat', 'nm_pretet', 'clas_domi']),
    'clima': (CGEO, 'CGEO:ANMS2010_03_clima', ['umida_seca', 'temperat']),
}
CASAS = 5            # ~1 m: muito mais fino que a escala da fonte
TOLERANCIA = 0.0004  # ~45 m: abaixo do que 1:250 mil resolve (~125 m no papel a 0,5 mm)
PAGINA_WFS = 1000


def baixar_wfs(url, camada):
    feats, inicio = [], 0
    bbox = f'{BBOX[1]},{BBOX[0]},{BBOX[3]},{BBOX[2]},urn:ogc:def:crs:EPSG::4326'
    while True:
        p = {'service': 'WFS', 'version': '2.0.0', 'request': 'GetFeature', 'typeNames': camada,
             'outputFormat': 'application/json', 'srsName': 'EPSG:4326', 'bbox': bbox,
             'count': PAGINA_WFS, 'startIndex': inicio, 'sortBy': 'id1' if 'BDIA' in camada else ''}
        if not p['sortBy']:
            del p['sortBy']
        for tentativa in range(4):
            r = requests.get(url, params=p, headers=UA, timeout=300)
            if r.status_code == 200:
                break
            time.sleep(5 * (tentativa + 1))
        r.raise_for_status()
        j = r.json()
        lote = j.get('features') or []
        feats.extend(lote)
        if len(lote) < PAGINA_WFS:
            return feats
        inicio += PAGINA_WFS


def _arred(c):
    if isinstance(c[0], (int, float)):
        return [round(c[0], CASAS), round(c[1], CASAS)]
    return [_arred(x) for x in c]


def recortar(feats, acre, campos):
    """Recorta pelo Acre, simplifica e fica só com os campos pedidos.
    Feição que não sobra nada dentro do estado sai. Devolve (lista, avisos)."""
    acre_p = prep(acre)
    out, invalidas = [], 0
    for f in feats:
        g = f.get('geometry')
        if not g:
            continue
        geo = shape(g)
        # eixo trocado (lat,lon) vem com x positivo pequeno — corrige
        if geo.bounds[0] > -20 and geo.bounds[1] < -20:
            geo = transform(lambda x, y, z=None: (y, x), geo)
        if not geo.is_valid:
            geo = make_valid(geo)
            invalidas += 1
        if not acre_p.intersects(geo):
            continue
        geo = geo.intersection(acre)
        if geo.is_empty:
            continue
        geo = geo.simplify(TOLERANCIA, preserve_topology=True)
        if geo.geom_type == 'GeometryCollection':
            polis = [x for x in geo.geoms if x.geom_type in ('Polygon', 'MultiPolygon')]
            if not polis:
                continue
            geo = unary_union(polis)
        if geo.is_empty or geo.area == 0:
            continue
        props = {k: (f.get('properties') or {}).get(k) for k in campos}
        props = {k: v for k, v in props.items() if v not in (None, '')}
        gj = mapping(geo)
        out.append({'type': 'Feature', 'properties': props,
                    'geometry': {'type': gj['type'], 'coordinates': _arred(gj['coordinates'])}})
    return out, invalidas


def area_ha(geom_gj):
    a, _ = GEOD.geometry_area_perimeter(shape(geom_gj))
    return abs(a) / 10000


def gerar(temas, saida, acre_arq):
    acre = make_valid(shape(json.load(open(acre_arq))['features'][0]['geometry']))
    area_acre = abs(GEOD.geometry_area_perimeter(acre)[0]) / 10000
    os.makedirs(saida, exist_ok=True)
    resumo = []
    for tema in temas:
        url, camada, campos = TEMAS_IBGE[tema]
        brutas = baixar_wfs(url, camada)
        feats, inval = recortar(brutas, acre, campos)
        cobre = sum(area_ha(f['geometry']) for f in feats)
        pct = cobre / area_acre * 100
        # Trava: um tema que não cobre o estado veio pela metade (paginação,
        # bbox, eixo) — nada é gravado.
        if pct < 95 or pct > 105:
            raise SystemExit(f'{tema}: cobre {pct:.1f}% da área do Acre — arquivo NÃO gravado')
        fc = {'type': 'FeatureCollection', 'fonte': f'IBGE — {camada}', 'escala': '1:250.000' if 'BDIA' in camada else '1:5.000.000',
              'gerado_em': date.today().isoformat(), 'features': feats}
        arq = os.path.join(saida, f'{tema}.geojson')
        with open(arq, 'w', encoding='utf-8') as fh:
            json.dump(fc, fh, ensure_ascii=False, separators=(',', ':'))
        kb = os.path.getsize(arq) / 1024
        print(f'{tema}: {len(brutas)} baixadas → {len(feats)} no Acre ({inval} corrigidas), cobre {pct:.1f}%, {kb:.0f} KB')
        for k in campos[:3]:
            vals = {}
            for f in feats:
                v = f['properties'].get(k)
                vals[v] = vals.get(v, 0) + 1
            print(f'   {k}: {len(vals)} valores — {sorted(vals.items(), key=lambda x: -x[1])[:6]}')
        resumo.append((tema, len(feats), kb))
    return resumo


def autoteste():
    from shapely.geometry import box as _box
    acre = _box(-70, -10, -69, -9)
    feats = [
        {'type': 'Feature', 'properties': {'a': 1, 'b': 'x', 'c': None},
         'geometry': mapping(_box(-69.5, -9.5, -68.5, -8.5))},        # metade dentro
        {'type': 'Feature', 'properties': {'a': 2}, 'geometry': mapping(_box(-60, -5, -59, -4))},  # fora
        {'type': 'Feature', 'properties': {'a': 3},                   # eixo trocado (lat, lon)
         'geometry': {'type': 'Polygon', 'coordinates': [[[-9.8, -69.8], [-9.8, -69.6], [-9.6, -69.6], [-9.6, -69.8], [-9.8, -69.8]]]}},
    ]
    out, _ = recortar(feats, acre, ['a', 'c'])
    assert [f['properties'] for f in out] == [{'a': 1}, {'a': 3}], out
    b = shape(out[0]['geometry']).bounds
    assert b == (-69.5, -9.5, -69.0, -9.0), b                       # recortado no limite
    assert abs(shape(out[1]['geometry']).bounds[0] - (-69.8)) < 1e-9  # eixo corrigido
    print('autoteste ok')


# ANA: listar serviços e camadas nas pastas de dados abertos dos dois
# servidores ArcGIS que responderam; contar feições no Acre (returnCountOnly).
ANA_PASTAS = [
    ('https://www.snirh.gov.br/arcgis/rest/services', ['DADOSABERTOS', 'SPR', 'SGH', 'IG', 'INDE', 'SNIRH2016']),
    ('https://portal1.snirh.gov.br/server/rest/services', ['dados_abertos', 'SPR', 'SGH', 'IG', 'consulta_geo']),
]
TEMA_ANA = re.compile(r'otto|bho|bacia|drenag|trecho|curso|hidrog|massa', re.I)


def descobrir_ana():
    env = f'{BBOX[0]},{BBOX[1]},{BBOX[2]},{BBOX[3]}'
    for base, pastas in ANA_PASTAS:
        for pasta in pastas:
            try:
                j = requests.get(f'{base}/{pasta}?f=json', headers=UA, timeout=60).json()
            except Exception as e:  # noqa: BLE001
                print(f'## {base}/{pasta}: ERRO {type(e).__name__}')
                continue
            for s in j.get('services') or []:
                nome, tipo = s.get('name', ''), s.get('type', '')
                if tipo not in ('MapServer', 'FeatureServer'):
                    continue
                url = f'{base}/{nome}/{tipo}'
                try:
                    sj = requests.get(f'{url}?f=json', headers=UA, timeout=60).json()
                except Exception as e:  # noqa: BLE001
                    print(f'## {url}: ERRO {type(e).__name__}')
                    continue
                camadas = [c for c in (sj.get('layers') or []) if TEMA_ANA.search(c.get('name', '')) or TEMA_ANA.search(nome)]
                if not camadas:
                    continue
                print(f'## {url}')
                for c in camadas[:40]:
                    q = {'where': '1=1', 'geometry': env, 'geometryType': 'esriGeometryEnvelope', 'inSR': 4326,
                         'spatialRel': 'esriSpatialRelIntersects', 'returnCountOnly': 'true', 'f': 'json'}
                    try:
                        n = requests.get(f"{url}/{c['id']}/query", params=q, headers=UA, timeout=90).json().get('count')
                    except Exception as e:  # noqa: BLE001
                        n = f'ERRO {type(e).__name__}'
                    campos = ''
                    try:
                        lj = requests.get(f"{url}/{c['id']}?f=json", headers=UA, timeout=60).json()
                        campos = ', '.join(f.get('name', '') for f in (lj.get('fields') or []))[:300]
                        geo = lj.get('geometryType', '')
                    except Exception:  # noqa: BLE001
                        geo = '?'
                    print(f"   - [{c['id']}] {c.get('name')} | {geo} | no Acre: {n}")
                    print(f'       campos: {campos}')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--descobrir', action='store_true')
    ap.add_argument('--descobrir-ana', action='store_true')
    ap.add_argument('--autoteste', action='store_true')
    ap.add_argument('--gerar', nargs='*', help='temas do IBGE (vazio = todos)')
    ap.add_argument('--saida', default='data/meio_fisico')
    ap.add_argument('--acre', default='data/acre_estado.geojson')
    a = ap.parse_args()
    if a.descobrir:
        descobrir()
        return 0
    if a.descobrir_ana:
        descobrir_ana()
        return 0
    if a.autoteste:
        autoteste()
        return 0
    if a.gerar is not None:
        gerar(a.gerar or list(TEMAS_IBGE), a.saida, a.acre)
        return 0
    ap.print_help()
    return 1


if __name__ == '__main__':
    sys.exit(main())
