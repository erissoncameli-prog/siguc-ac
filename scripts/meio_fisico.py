#!/usr/bin/env python3
"""
Camadas de meio físico do Acre para o Mapa das UCs (Fase 4 do plano em
docs/mapa-ucs/plano-medicao-comparacao.md).

Roda no GitHub Actions, de propósito: os servidores do IBGE e da ANA
respondem 403 na rede das sessões de desenvolvimento (CLAUDE.md), e
geometria de camada grande nunca entra pelo pg_net (reiniciou o banco 3×).

Modos:
  --descobrir   lista as camadas que os serviços oferecem (por palavra-chave)
                e quantas feições cada uma tem dentro do retângulo do Acre.
                Não grava nada. É o primeiro passo: os nomes exatos das
                camadas não são adivinhados.
"""
import argparse
import re
import sys
import xml.etree.ElementTree as ET

import requests

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


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--descobrir', action='store_true')
    a = ap.parse_args()
    if a.descobrir:
        descobrir()
        return 0
    ap.print_help()
    return 1


if __name__ == '__main__':
    sys.exit(main())
