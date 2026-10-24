#!/usr/bin/env python3
"""
Camadas de meio físico do Acre para o Mapa das UCs (Fase 4 do plano em
docs/mapa-ucs/plano-medicao-comparacao.md).

Roda no GitHub Actions, de propósito: os servidores do IBGE e da ANA
respondem 403 na rede das sessões de desenvolvimento (CLAUDE.md), e
geometria de camada grande nunca entra pelo pg_net (reiniciou o banco 3×).

Modos:
  --autoteste   recorte/simplificação/eixo com dado sintético, sem rede.
  --gerar [tema ...]  baixa do IBGE (BDiA 1:250 mil + clima) e da ANA
                (rios, massas d'água, micro-regiões hidrográficas), recorta
                pelo Acre (data/acre_estado.geojson, o mesmo do mapa),
                simplifica ~45 m e grava data/meio_fisico/<tema>.geojson.
                Trava: tema de área que não cobrir 95–105% do estado, ou tema
                cuja contagem baixada não bater com a do servidor, NÃO é
                gravado.
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


def _so_tipo(geo, linha):
    tipos = ('LineString', 'MultiLineString') if linha else ('Polygon', 'MultiPolygon')
    if geo.geom_type in tipos:
        return geo
    if geo.geom_type in ('GeometryCollection', 'MultiPolygon', 'MultiLineString', 'MultiPoint'):
        partes = [x for x in getattr(geo, 'geoms', []) if x.geom_type in tipos]
        return unary_union(partes) if partes else None
    return None


def recortar(feats, acre, campos, linha=False):
    """Recorta pelo Acre, simplifica e fica só com os campos pedidos.
    Feição que não sobra nada dentro do estado sai. `linha` = rios: guarda
    só as partes lineares (o recorte de uma linha pela divisa pode devolver
    ponto solto). Devolve (lista, avisos)."""
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
        geo = _so_tipo(geo, linha)
        if geo is None or geo.is_empty:
            continue
        geo = geo.simplify(TOLERANCIA, preserve_topology=True)
        geo = _so_tipo(geo, linha)
        if geo is None or geo.is_empty or (geo.length == 0 if linha else geo.area == 0):
            continue
        props = {k: (f.get('properties') or {}).get(k) for k in campos}
        props = {k: v for k, v in props.items() if v not in (None, '')}
        gj = mapping(geo)
        out.append({'type': 'Feature', 'properties': props,
                    'geometry': {'type': gj['type'], 'coordinates': _arred(gj['coordinates'])}})
    return out, invalidas


# ── ANA (servidores ArcGIS do SNIRH) ─────────────────────────────────────
# Nomes e campos conferidos pela descoberta (--descobrir-ana, 24/10/2026).
SNIRH = 'https://www.snirh.gov.br/arcgis/rest/services/SNIRH2016'
# tema → (camada, atributos, é linha?, trava). trava = 'cobertura' (área que
# recobre o estado) ou 'contagem' (baixado == contado pelo servidor).
TEMAS_ANA = {
    'rios': (f'{SNIRH}/Rios_principais/MapServer/0', ['NORIOCOMP', 'DEDOMINIAL', 'ORGAO_GEST', 'NUAREAMONT'], True, 'contagem'),
    'massas_dagua': (f'{SNIRH}/Massa_dagua/MapServer/0', ['nmoriginal', 'nmgenerico', 'detipomass', 'dedominial',
                                                          'usoprinc', 'nuareaha'], False, 'contagem'),
    'bacias_ana': (f'{SNIRH}/Divisao_de_bacias/MapServer/2', ['DMI_NM', 'DMI_CD', 'DMI_AR_KM2'], False, 'cobertura'),
}
LOTE_IDS = 200


def _get_json(url, params):
    for tentativa in range(4):
        try:
            r = requests.get(url, params=params, headers=UA, timeout=300)
            if r.status_code == 200:
                j = r.json()
                if 'error' not in j:
                    return j
                erro = j['error']
            else:
                erro = f'HTTP {r.status_code}'
        except Exception as e:  # noqa: BLE001 — rede instável: tenta de novo
            erro = f'{type(e).__name__}: {e}'
        time.sleep(5 * (tentativa + 1))
    raise SystemExit(f'{url}: {erro}')


def _esri_para_geojson(g):
    """Geometria do ArcGIS (f=json) → GeoJSON. Polígono: anel no sentido
    horário é contorno, anti-horário é buraco (convenção do ArcGIS)."""
    from shapely.geometry import LinearRing, MultiLineString, Polygon
    if not g:
        return None
    if 'paths' in g:
        return mapping(MultiLineString(g['paths']))
    if 'rings' in g:
        fora, buracos = [], []
        for anel in g['rings']:
            if len(anel) < 4:
                continue
            (buracos if LinearRing(anel).is_ccw else fora).append(make_valid(Polygon(anel)))
        if not fora:
            return None
        geo = unary_union(fora)
        if buracos:
            geo = geo.difference(unary_union(buracos))
        return mapping(geo)
    return None


def baixar_arcgis(url, campos):
    """Pega os ids no retângulo do Acre e baixa por lote de ids — não depende
    de paginação do servidor (MapServer antigo não pagina). Devolve (feições,
    quantos ids o servidor disse ter)."""
    env = f'{BBOX[0]},{BBOX[1]},{BBOX[2]},{BBOX[3]}'
    base = {'geometry': env, 'geometryType': 'esriGeometryEnvelope', 'inSR': 4326,
            'spatialRel': 'esriSpatialRelIntersects', 'where': '1=1'}
    ids = sorted(_get_json(f'{url}/query', {**base, 'returnIdsOnly': 'true', 'f': 'json'}).get('objectIds') or [])
    feats = []
    for i in range(0, len(ids), LOTE_IDS):
        j = _get_json(f'{url}/query', {'objectIds': ','.join(map(str, ids[i:i + LOTE_IDS])),
                                       'outFields': ','.join(campos), 'outSR': 4326,
                                       'returnGeometry': 'true', 'f': 'json'})
        for f in j.get('features') or []:
            gj = _esri_para_geojson(f.get('geometry'))
            if gj:
                feats.append({'type': 'Feature', 'properties': f.get('attributes') or {}, 'geometry': gj})
    return feats, len(ids)


def _descricao_camada(url):
    try:
        j = _get_json(url, {'f': 'json'})
        return (j.get('description') or j.get('copyrightText') or '')[:300]
    except SystemExit:
        return ''


def area_ha(geom_gj):
    a, _ = GEOD.geometry_area_perimeter(shape(geom_gj))
    return abs(a) / 10000


def gerar(temas, saida, acre_arq):
    acre = make_valid(shape(json.load(open(acre_arq))['features'][0]['geometry']))
    area_acre = abs(GEOD.geometry_area_perimeter(acre)[0]) / 10000
    os.makedirs(saida, exist_ok=True)
    resumo = []
    for tema in temas:
        if tema in TEMAS_IBGE:
            url, camada, campos = TEMAS_IBGE[tema]
            brutas = baixar_wfs(url, camada)
            linha, trava = False, 'cobertura'
            fonte = f'IBGE — {camada}'
            escala = '1:250.000' if 'BDIA' in camada else '1:5.000.000'
        else:
            url, campos, linha, trava = TEMAS_ANA[tema]
            brutas, esperado = baixar_arcgis(url, campos)
            # Trava: lote que falhou em silêncio deixaria buraco no mapa.
            if len(brutas) != esperado:
                raise SystemExit(f'{tema}: {len(brutas)} baixadas de {esperado} — arquivo NÃO gravado')
            fonte = 'ANA — ' + url.split('/services/')[-1]
            escala = None
            print(f'{tema}: descrição do serviço: {_descricao_camada(url)!r}')
        feats, inval = recortar(brutas, acre, campos, linha=linha)
        if not feats:
            raise SystemExit(f'{tema}: nenhuma feição dentro do Acre — arquivo NÃO gravado')
        if linha:
            medida = f'{sum(GEOD.geometry_length(shape(f["geometry"])) for f in feats) / 1000:,.0f} km'
        else:
            cobre = sum(area_ha(f['geometry']) for f in feats)
            pct = cobre / area_acre * 100
            medida = f'cobre {pct:.1f}%'
            # Trava: um tema de área que não cobre o estado veio pela metade
            # (paginação, bbox, eixo) — nada é gravado.
            if trava == 'cobertura' and (pct < 95 or pct > 105):
                raise SystemExit(f'{tema}: cobre {pct:.1f}% da área do Acre — arquivo NÃO gravado')
        fc = {'type': 'FeatureCollection', 'fonte': fonte, 'escala': escala,
              'gerado_em': date.today().isoformat(), 'features': feats}
        arq = os.path.join(saida, f'{tema}.geojson')
        with open(arq, 'w', encoding='utf-8') as fh:
            json.dump(fc, fh, ensure_ascii=False, separators=(',', ':'))
        kb = os.path.getsize(arq) / 1024
        print(f'{tema}: {len(brutas)} baixadas → {len(feats)} no Acre ({inval} corrigidas), {medida}, {kb:.0f} KB')
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
    # linha: só a parte dentro do estado, sem virar polígono nem sumir
    rio = [{'type': 'Feature', 'properties': {'a': 9}, 'geometry': {'type': 'LineString', 'coordinates': [[-70.5, -9.5], [-69.5, -9.5]]}}]
    out, _ = recortar(rio, acre, ['a'], linha=True)
    assert len(out) == 1 and out[0]['geometry']['type'] == 'LineString', out
    assert shape(out[0]['geometry']).bounds == (-70.0, -9.5, -69.5, -9.5)
    # ArcGIS: contorno horário com buraco anti-horário
    esri = {'rings': [[[0, 0], [0, 4], [4, 4], [4, 0], [0, 0]], [[1, 1], [2, 1], [2, 2], [1, 2], [1, 1]]]}
    assert abs(shape(_esri_para_geojson(esri)).area - 15) < 1e-9
    assert shape(_esri_para_geojson({'paths': [[[0, 0], [1, 1]]]})).geom_type == 'MultiLineString'
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
    ap.add_argument('--gerar', nargs='*', help='temas do IBGE/ANA (vazio = todos)')
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
        gerar(a.gerar or [*TEMAS_IBGE, *TEMAS_ANA], a.saida, a.acre)
        return 0
    ap.print_help()
    return 1


if __name__ == '__main__':
    sys.exit(main())
