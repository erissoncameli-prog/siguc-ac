#!/usr/bin/env python3
"""
Zoneamento Ecológico-Econômico do Acre (ZEE) para o Mapa das UCs.
Plano em docs/mapa-ucs/plano-zee.md.

Gera data/zee/<camada>.geojson + data/zee/manifesto.json a partir do
arquivo vetorial do Mapa de Gestão (shapefile, solto ou em .zip). Nunca
editar o GeoJSON à mão: rodar o script de novo.

Os domínios do governo do Acre (*.ac.gov.br) e o Google Drive respondem 403
nas sessões de desenvolvimento; o runner do GitHub alcança os dois — por isso
a descoberta e a conversão a partir de URL rodam no workflow
.github/workflows/zee-acre.yml.

Modos:
  --autoteste   leitura de código de zona/subzona, reprojeção, recorte e as
                travas, com dado sintético e sem rede.
  --descobrir   lista o que as fontes candidatas oferecem (pasta da SEMA no
                Drive, páginas do ZEE da SEMA, GeoServer da INDE/MMA). Não
                grava nada: os nomes não são adivinhados.
  --inspecionar ARQ   mostra campos, projeção e valores de um shapefile, sem
                gravar — é o passo antes de converter.
  --converter ARQ --fase 2|3 [--campo-zona C] [--campo-subzona C]
                [--campo-unidade C] [--campo-nome C] [--legenda CSV]
                [--escala 1:250.000] [--fonte TEXTO]
                ARQ = .shp, pasta com um .shp, .zip ou URL (http/drive:<id>).

Travas (nada é gravado se falhar):
  - sem .prj (sem saber o datum) → para; SAD 69 é convertido, nunca suposto;
  - feição sem zona reconhecível → para e lista os valores que não casaram
    (zona "cinza" no mapa esconderia o erro);
  - a soma das feições recortadas tem de cobrir 95–105% da área do estado
    (mesmo `data/acre_estado.geojson` do mapa).
"""
import argparse
import csv
import io
import json
import os
import re
import sys
import tempfile
import time
import zipfile
from datetime import date

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from meio_fisico import GEOD, TOLERANCIA, area_ha, recortar  # noqa: E402  (mesmo recorte e simplificação do Meio Físico)

import numpy as np  # noqa: E402
import shapely  # noqa: E402
from shapely import make_valid  # noqa: E402
from shapely.geometry import mapping, shape  # noqa: E402
from shapely.ops import transform  # noqa: E402

UA = {'User-Agent': 'SIGUC-AC/1.0 (SEMA-AC; mapa das UCs)'}

# Lei Estadual nº 1.904/2007, art. 4º, e Documento Síntese da Fase II.
# É a ÚNICA tabela de nomes de zona do sistema — o mapa lê o que vem no
# arquivo (`zona`), nunca reescreve.
ZONAS = {
    '1': 'Consolidação de sistemas de produção sustentáveis',
    '2': 'Uso sustentável dos recursos naturais e proteção ambiental',
    '3': 'Áreas prioritárias para o ordenamento territorial',
    '4': 'Cidades florestais',
}

CAMADAS = {
    '2': ('fase2_gestao', 'SEMA-AC — ZEE Fase II, Mapa de Gestão Territorial'),
    '3': ('fase3_gestao', 'SEMA-AC — ZEE Fase III, Mapa de Subsídio à Gestão Territorial e Ambiental'),
}

# Nome de coluna que pode trazer dado pessoal (mesma ideia de
# camadas_mapa_campo_pessoal, migration 367): o valor nunca vai para log nem
# para arquivo público.
CAMPO_PESSOAL = re.compile(r'propriet|cpf|cnpj|matric|certif|titular|detentor|ocupa|posseir|^rg$|^nome', re.I)

CAMPOS_SAIDA = ['zona_cod', 'zona', 'subzona', 'subzona_nome', 'unidade', 'unidade_nome', 'diretriz']

# Fontes candidatas (descoberta). A pasta é a que a SEMA compartilhou
# (dona sema.acre856@gmail.com, "O_ZONEAMENTO_ECOLOGICO_ECONOMICO_DO_ACRE_ZEE").
DRIVE_PASTAS = ['1K3MH1K6fenD7_e33EH1biwRS_ykU2RWa']
PAGINAS = [
    'https://sema.ac.gov.br/zee-acre/',
    'https://sema.ac.gov.br/zee-ac-repositorio/',
    'https://sema.ac.gov.br/zee-fase-iii/',
    'https://sema.ac.gov.br/departamentos-e-divisoes/gestao-ambiental-e-territorial/nucleo-de-zoneamento-ecologico-economico-zee/',
    'https://agencia.ac.gov.br/zee/',
]
GEOSERVERS = [
    'https://geoservicos.inde.gov.br/geoserver/ows',
    'https://geoservicos.inde.gov.br/geoserver/MMA/ows',
    'https://geoinfo.dados.embrapa.br/geoserver/ows',   # GeoInfo/Embrapa (sucessor do SIAGEO?)
]
# i3Geo que reuniram os ZEE estaduais da Amazônia Legal em shapefile:
# SIAGEO (Embrapa + MMA, projeto UZEE-AML, ~650 camadas de 9 estados) e o
# i3Geo do MMA ("Mapa Integrado dos ZEE estaduais", com download em KMZ/SHP).
I3GEO = [
    'http://www.amazonia.cnptia.embrapa.br/i3geo',
    'https://www.amazonia.cnptia.embrapa.br/i3geo',
    'http://mapas.mma.gov.br/i3geo',
]
# ArcGIS Online: itens públicos (camada hospedada ou serviço) com o ZEE do Acre.
AGOL_BUSCAS = ['zoneamento ecológico econômico acre', 'ZEE Acre', 'ZEE AC gestão territorial']
# Wayback Machine: os shapefiles que o i3Geo do MMA e o antigo portal do ZEE
# do Acre (seiam.ac.gov.br, citado no ZEE_AC.pdf) publicavam podem ter sido
# arquivados — os servidores originais saíram do ar.
UZEE_ACRE = ['geonode:acre_aptidao_agric']
WAYBACK_DOMINIOS = ['mapas.mma.gov.br', 'seiam.ac.gov.br', 'www.seiam.ac.gov.br', 'semapi.acre.gov.br',
                    'sema.ac.gov.br', 'www.amazonia.cnptia.embrapa.br', 'zeeamazonia.mma.gov.br']
ARQ_GEO = re.compile(r'\.(zip|rar|7z|shp|kmz|kml|gpkg|geojson|dbf)(\?|$)', re.I)
LINK_DADO = re.compile(r'href="([^"]+?(?:\.zip|\.rar|\.7z|\.shp|\.kmz|\.kml|\.gpkg|\.geojson|\.pdf|drive\.google\.com[^"]*|'
                       r'geoserver[^"]*|/wms[^"]*|/wfs[^"]*))"', re.I)
TEMA_ZEE = re.compile(r'zee|zoneamento|acre|uzee|gest[aã]o.?territ', re.I)


# ── leitura do código de zona/subzona ────────────────────────────────────
_COD = re.compile(r'(?<![\d.])0?([1-4])(?:\s*[.,]\s*(\d{1,2}))?(?:\s*[.,]\s*(\d{1,2}))?(?![\d])')


def ler_codigo(valor):
    """'Zona 1', 'Zona 01' (arquivo da SEMA), 'Z1', '1', 'Subzona 1.2', 'SZ 2.3.1', 1.2 → (zona, subzona, unidade).
    Devolve (None, None, None) quando não há código de 1 a 4 reconhecível."""
    if valor is None:
        return None, None, None
    if isinstance(valor, float) and valor.is_integer():
        valor = int(valor)
    m = _COD.search(str(valor).strip())
    if not m:
        return None, None, None
    z, s, u = m.groups()
    sub = f'{z}.{int(s)}' if s else None
    uni = f'{sub}.{int(u)}' if (sub and u) else None
    return z, sub, uni


def _texto(v):
    if v is None:
        return None
    if isinstance(v, bytes):
        v = v.decode('latin-1', 'replace')
    v = str(v).strip()
    return v or None


def _achar(campos, padrao, evitar=None):
    for c in campos:
        if re.search(padrao, c, re.I) and not (evitar and re.search(evitar, c, re.I)):
            return c
    return None


def detectar_campos(campos):
    """Palpite pelos NOMES das colunas; o operador confirma pelo --inspecionar
    e pode forçar cada um pelos --campo-*."""
    return {
        'subzona': _achar(campos, r'sub_?zon|^sz', None),
        'zona': _achar(campos, r'zona|^zon', r'sub'),
        'unidade': _achar(campos, r'unid|manejo|^um_?'),
        'nome': _achar(campos, r'nome|descr|legend|denom', r'^zona$'),
    }


def ler_legenda(caminho):
    """CSV com colunas subzona;nome;diretriz (separador ; ou ,)."""
    if not caminho:
        return {}
    txt = open(caminho, encoding='utf-8-sig').read()
    dial = csv.Sniffer().sniff(txt.splitlines()[0], delimiters=';,')
    out = {}
    for lin in csv.DictReader(io.StringIO(txt), dialect=dial):
        lin = {k.strip().lower(): (v or '').strip() for k, v in lin.items() if k}
        _, sub, uni = ler_codigo(lin.get('subzona'))
        chave = uni or sub
        if chave:
            out[chave] = {'nome': lin.get('nome') or None, 'diretriz': lin.get('diretriz') or None}
    return out


def normalizar(props, campos, legenda):
    """Propriedades de saída a partir de uma linha do .dbf. None se não houver zona."""
    bruto_sub = props.get(campos['subzona']) if campos.get('subzona') else None
    bruto_zona = props.get(campos['zona']) if campos.get('zona') else None
    z1, sub, uni = ler_codigo(bruto_sub)
    z2, sub2, uni2 = ler_codigo(bruto_zona)
    zona = z1 or z2
    sub = sub or sub2
    uni = uni or uni2
    if campos.get('unidade'):
        _, s3, u3 = ler_codigo(props.get(campos['unidade']))
        uni = u3 or uni
        sub = sub or s3
    if not zona:
        return None
    # Fase III: "1.2.0" = subzona 1.2 SEM unidade de manejo (Unid_man 0)
    if uni and uni.endswith('.0'):
        uni = None
    leg = legenda.get(uni) or legenda.get(sub) or {}
    def _cp(chave):
        return _texto(props.get(campos[chave])) if campos.get(chave) else None
    # Nome da zona: o do PRÓPRIO arquivo quando ele traz (a Fase III renomeou
    # as zonas — "Cidades do Acre" etc.); senão o da Lei 1.904/2007 (Fase II).
    nome_zona = _cp('zona_nome') or ZONAS[zona]
    return {
        'zona_cod': zona,
        'zona': f'Zona {zona} — {nome_zona}',
        'subzona': sub,
        'subzona_nome': leg.get('nome') or _cp('subzona_nome') or _cp('nome'),
        'unidade': uni,
        'unidade_nome': _cp('unidade_nome') if uni else None,
        'diretriz': leg.get('diretriz'),
    }


def conferir_nomes(feats):
    """O mesmo código nunca pode ter dois nomes (zona, subzona, unidade):
    seria digitação divergente no arquivo, e a legenda mentiria."""
    vistos, conflitos = {}, []
    for p in (f['properties'] for f in feats):
        for cod, nome in ((p.get('zona_cod'), p.get('zona')), (p.get('subzona'), p.get('subzona_nome')),
                          (p.get('unidade'), p.get('unidade_nome'))):
            if not cod or not nome:
                continue
            if vistos.setdefault(cod, nome) != nome:
                conflitos.append(f'{cod}: {vistos[cod]!r} × {nome!r}')
    if conflitos:
        raise SystemExit('código com mais de um nome no arquivo — nada gravado:\n  ' + '\n  '.join(sorted(set(conflitos))))


# ── leitura do shapefile ─────────────────────────────────────────────────
def _baixar(url, pasta):
    import requests
    if url.startswith('drive:'):
        url = f'https://drive.usercontent.google.com/download?id={url[6:]}&export=download&confirm=t'
    r = requests.get(url, headers=UA, timeout=600, stream=True)
    r.raise_for_status()
    destino = os.path.join(pasta, 'entrada.bin')
    with open(destino, 'wb') as f:
        for bloco in r.iter_content(1 << 20):
            f.write(bloco)
    with open(destino, 'rb') as f:
        cab = f.read(4)
    if cab[:2] != b'PK':
        raise SystemExit(f'{url}: não veio um .zip (cabeçalho {cab!r}) — confira o link/permissão')
    os.rename(destino, destino[:-4] + '.zip')
    return destino[:-4] + '.zip'


def _resumo_zip(z):
    """O que tem no pacote, antes de extrair: contagem/volume por extensão e
    os maiores arquivos. A Fase III veio num .zip de 845 MB — sem isto não dá
    para saber se o vetorial está lá dentro ou se é tudo imagem/PDF."""
    por_ext = {}
    for i in z.infolist():
        if i.is_dir():
            continue
        ext = os.path.splitext(i.filename)[1].lower() or '(sem extensão)'
        n, tam = por_ext.get(ext, (0, 0))
        por_ext[ext] = (n + 1, tam + i.file_size)
    print(f'Pacote: {sum(n for n, _ in por_ext.values())} arquivos')
    for ext, (n, tam) in sorted(por_ext.items(), key=lambda kv: -kv[1][1]):
        print(f'  {ext:16} {n:5} arquivo(s)  {tam / 1e6:9.1f} MB')
    # tudo que não é foto/fonte/arquivo de diagramação — é onde pode haver dado
    outros = [i for i in z.infolist() if not i.is_dir() and os.path.splitext(i.filename)[1].lower()
              not in ('.jpg', '.jpeg', '.png', '.otf', '.ttf', '.indd', '.idml', '.lock')]
    print(f'Arquivos (sem fotos/fontes/diagramação): {len(outros)}')
    for i in sorted(outros, key=lambda i: i.filename):
        print(f'  {i.file_size / 1e6:9.2f} MB  {i.filename}')
    maiores = sorted((i for i in z.infolist() if not i.is_dir()), key=lambda i: -i.file_size)[:15]
    print('Maiores:')
    for i in maiores:
        print(f'  {i.file_size / 1e6:9.1f} MB  {i.filename}')


def _escolher_shp(shps, raiz, escolha):
    """Pacote com vários .shp: --shp TRECHO escolhe pelo caminho (sem
    diferenciar maiúscula). Ambíguo ou ausente = para e lista — nunca chuta."""
    rel = {s: os.path.relpath(s, raiz) for s in shps}
    if escolha:
        cand = [s for s in shps if escolha.lower() in rel[s].lower()]
        exatos = [s for s in cand if os.path.splitext(os.path.basename(s))[0].lower() == escolha.lower()]
        cand = exatos or cand
        # o mesmo arquivo solto e dentro de um .rar interno (cópia): vale o solto
        soltos = [c for c in cand if '_extraido' not in rel[c]]
        if len(cand) > 1 and len(soltos) == 1:
            cand = soltos
        if len(cand) == 1:
            return cand[0]
        raise SystemExit(f'--shp {escolha!r} casou {len(cand)} arquivo(s): {[rel[s] for s in cand] or sorted(rel.values())}')
    if len(shps) == 1:
        return shps[0]
    raise SystemExit(f'esperava 1 .shp, achei {len(shps)} — escolha com --shp: {sorted(rel.values())}')


def _extrair_aninhados(pasta, listar=False):
    """Pacote dentro do pacote (a Fase III traz 3 .rar com versões do mapa):
    extrai cada um numa pasta irmã (unrar, 7zz ou 7z). Sem extrator, avisa e segue
    — nunca falha o que já foi extraído."""
    import shutil
    import subprocess
    internos = [os.path.join(r, f) for r, _, fs in os.walk(pasta) for f in fs
                if f.lower().endswith(('.rar', '.7z', '.zip')) and os.path.dirname(os.path.join(r, f)) != pasta]
    if not internos:
        return
    # Extratores em ordem: o p7zip do runner (7z) dá falha de segmentação (−11)
    # em RAR5 — unrar (multiverse) e 7zz (pacote 7zip + 7zip-rar) abrem.
    def _cmds(arq, destino):
        out = []
        if arq.lower().endswith('.rar') and shutil.which('unrar'):
            out.append(['unrar', 'x', '-o+', '-y', '-idq', arq, destino + os.sep])
        for b in ('7zz', '7z'):
            if shutil.which(b):
                out.append([b, 'x', '-y', f'-o{destino}', arq])
        return out
    for arq in internos:
        destino = arq + '_extraido'
        cmds = _cmds(arq, destino)
        if not cmds:
            print(f'  (sem extrator no ambiente — não abri {os.path.relpath(arq, pasta)})')
            continue
        tentativas = []
        for cmd in cmds:
            os.makedirs(destino, exist_ok=True)
            # destino é pasta própria; unrar e 7z recusam caminho absoluto/".."
            r = subprocess.run(cmd, capture_output=True, text=True)
            if r.returncode == 0:
                break
            tentativas.append(f'{cmd[0]} saiu com {r.returncode}')
            # extração quebrada deixa arquivos de 0 byte que se passariam por shapefile
            shutil.rmtree(destino, ignore_errors=True)
        else:
            print(f'Pacote interno NÃO aberto: {os.path.relpath(arq, pasta)} ({"; ".join(tentativas)})')
            continue
        print(f'Pacote interno aberto com {cmd[0]}: {os.path.relpath(arq, pasta)}')
        if listar:
            n = sum(len(fs) for _, _, fs in os.walk(destino)) if os.path.isdir(destino) else 0
            print(f'Pacote interno: {os.path.relpath(arq, pasta)} → {n} arquivo(s)' +
                  ('' if r.returncode == 0 else f' (7z saiu com {r.returncode}: {r.stderr.strip()[-200:]})'))
            for raiz, _, fs in os.walk(destino):
                for f in sorted(fs):
                    c = os.path.join(raiz, f)
                    print(f'    {os.path.getsize(c) / 1e6:8.1f} MB  {os.path.relpath(c, destino)}')


def localizar_shp(alvo, pasta_tmp, escolha=None, listar=False):
    if re.match(r'^(https?://|drive:)', alvo):
        alvo = _baixar(alvo, pasta_tmp)
    if alvo.lower().endswith('.zip'):
        with zipfile.ZipFile(alvo) as z:
            if listar:
                _resumo_zip(z)
            for nome in z.namelist():
                destino = os.path.realpath(os.path.join(pasta_tmp, nome))
                if not destino.startswith(os.path.realpath(pasta_tmp) + os.sep):
                    raise SystemExit(f'caminho suspeito dentro do .zip: {nome}')
            z.extractall(pasta_tmp)
        _extrair_aninhados(pasta_tmp, listar)
        alvo = pasta_tmp
    if os.path.isdir(alvo):
        shps = sorted(os.path.join(r, f) for r, _, fs in os.walk(alvo) for f in fs if f.lower().endswith('.shp'))
        if listar and len(shps) > 1 and not escolha:
            return shps
        if not shps:
            raise SystemExit(f'nenhum .shp em {alvo}')
        alvo = _escolher_shp(shps, alvo, escolha)
    if not alvo.lower().endswith('.shp'):
        raise SystemExit(f'{alvo}: esperava .shp, pasta, .zip ou URL')
    return alvo


def _arquivo_irmao(shp, ext):
    base = shp[:-4]
    for cand in (base + ext, base + ext.upper()):
        if os.path.exists(cand):
            return cand
    return None


def transformador(shp):
    """Do datum do .prj para lon/lat (SIRGAS 2000 ≈ WGS 84 no mapa).
    Sem .prj → para: adivinhar SAD 69 × SIRGAS deslocaria tudo ~60 m."""
    from pyproj import CRS, Transformer
    prj = _arquivo_irmao(shp, '.prj')
    if not prj:
        raise SystemExit(f'{os.path.basename(shp)}: sem .prj — não dá para saber o datum. Peça o arquivo com o .prj.')
    crs = CRS.from_wkt(open(prj, encoding='latin-1').read())
    alvo = CRS.from_epsg(4674)
    if crs.equals(alvo) or crs.equals(CRS.from_epsg(4326)):
        return None, crs.name
    t = Transformer.from_crs(crs, alvo, always_xy=True)
    return t, crs.name


def tolerancia_origem(shp):
    """TOLERANCIA/2 do Meio Físico (graus) na unidade do arquivo: a
    simplificação prévia roda ANTES da reprojeção (em UTM, metros)."""
    from pyproj import CRS
    crs = CRS.from_wkt(open(_arquivo_irmao(shp, '.prj'), encoding='latin-1').read())
    if crs.is_geographic:
        return TOLERANCIA / 2
    un = crs.axis_info[0].unit_name if crs.axis_info else ''
    if un not in ('metre', 'meter'):
        raise SystemExit(f'{os.path.basename(shp)}: projeção em {un!r} — esperava graus ou metros')
    return TOLERANCIA / 2 * M_POR_GRAU


# 1° de longitude no Acre (~9° S) ≈ 110 km; de latitude ≈ 110,6 km — 111,3 km
# é o teto (a tolerância em metros fica um pouco MAIOR que a em graus no
# oeste/leste, nunca o dobro; o recorte simplifica de novo em graus).
M_POR_GRAU = 111_320


def _log(msg, t0):
    print(f'  {msg} · {time.time() - t0:.1f} s', flush=True)


def tirar_miudos(geoms, area_min):
    """Tira partes e furos menores que `area_min` (na unidade do arquivo).
    O ZEE III veio de raster vetorizado: 224 mil partes e 142 mil furos,
    quase todos de menos de 1 ha — é isso, não o número de vértices, que
    trava o simplify topológico e o make_valid. Num mapa que recobre o
    estado, o furo de uma zona é a ilha de outra: tirando os dois, a área
    passa para a zona em volta, sem buraco nem sobreposição.
    Devolve (geometrias, partes tiradas, furos tirados)."""
    from shapely.geometry import MultiPolygon, Polygon
    partes, idx = shapely.get_parts(geoms, return_index=True)
    poli = shapely.get_type_id(partes) == 3   # só polígonos
    partes, idx = partes[poli], idx[poli]
    ext = shapely.get_exterior_ring(partes)
    fica = shapely.area(shapely.polygons(ext)) >= area_min
    novas = [[] for _ in geoms]
    n_furos = 0
    for p, i, ok in zip(partes, idx, fica):
        if not ok:
            continue
        furos = list(p.interiors)
        if furos:
            af = shapely.area(shapely.polygons(furos))
            manter = [f for f, a in zip(furos, af) if a >= area_min]
            n_furos += len(furos) - len(manter)
            if len(manter) != len(furos):
                p = Polygon(p.exterior, manter)
        novas[i].append(p)
    saida = np.array([MultiPolygon(ps) if len(ps) > 1 else (ps[0] if ps else Polygon()) for ps in novas], dtype=object)
    return saida, int((~fica).sum()), n_furos


def ler_preparar(shp, t, area_min_ha=0):
    """Caminho rápido (Fase III: 30 polígonos com milhões de vértices cada).
    pyogrio lê a geometria em WKB direto para um array do shapely 2 e todas
    as etapas são vetorizadas: tirar o Z, simplificar na unidade de ORIGEM
    (antes de qualquer outra conta, que é o que pesa), make_valid só no que
    ficou inválido e reprojetar com o pyproj em bloco. Devolve
    (campos, geometrias em lon/lat, propriedades, nº corrigidas)."""
    import pyogrio
    t0 = time.time()
    import codecs
    # nome canônico ("iso8859-1"): o GDAL não reconhece "latin-1" e cai em UTF-8
    meta, _, wkb, valores = pyogrio.raw.read(shp, encoding=codecs.lookup(_codificacao(shp)).name)
    campos = list(meta['fields'])
    geoms = shapely.from_wkb(wkb)
    n0 = int(shapely.get_num_coordinates(geoms).sum())
    _log(f'lidas {len(geoms)} feições, {n0:,} vértices', t0)
    props = [{c: (None if (v is None or (isinstance(v, float) and v != v)) else (v.item() if hasattr(v, 'item') else v))
              for c, v in zip(campos, linha)} for linha in zip(*valores)] if campos else [{} for _ in geoms]
    vazio = shapely.is_missing(geoms) | shapely.is_empty(geoms)
    geoms, props = geoms[~vazio], [p for p, v in zip(props, vazio) if not v]
    geoms = shapely.force_2d(geoms)        # Fase III vem em POLYGONZ (Z sempre 0)
    _log('sem Z', t0)
    tol = tolerancia_origem(shp)
    if area_min_ha:
        # unidade do arquivo: m² em UTM, grau² em lon/lat (aproximado)
        amin = area_min_ha * 10000 / (1 if tol > 1 else M_POR_GRAU ** 2)
        a0 = shapely.area(geoms)
        geoms, n_p, n_f = tirar_miudos(geoms, amin)
        _log(f'menores que {area_min_ha} ha: {n_p:,} parte(s) e {n_f:,} furo(s) tirados', t0)
        # Sem os anéis miúdos, Douglas-Peucker simples basta (o topológico
        # levava minutos por feição); o que sair inválido o make_valid corrige.
        geoms = shapely.simplify(geoms, tol, preserve_topology=False)
        a1 = shapely.area(geoms)
        var = np.abs(a1 - a0) / np.where(a0 > 0, a0, 1) * 100
        _log(f'simplificadas: {int(shapely.get_num_coordinates(geoms).sum()):,} vértices · área total '
             f'{(a1.sum() - a0.sum()) / a0.sum() * 100:+.2f}% · maior variação numa feição {var.max():.1f}%', t0)
    else:
        geoms = shapely.simplify(geoms, tol, preserve_topology=True)
        _log(f'simplificadas: {int(shapely.get_num_coordinates(geoms).sum()):,} vértices', t0)
    inval = ~shapely.is_valid(geoms)
    if inval.any():
        geoms[inval] = shapely.make_valid(geoms[inval])
    _log(f'{int(inval.sum())} corrigida(s) pelo make_valid', t0)
    if t is not None:
        geoms = shapely.transform(geoms, lambda c: np.column_stack(t.transform(c[:, 0], c[:, 1])))
        _log('reprojetadas', t0)
    return campos, geoms, props, int(inval.sum())


def _codificacao(shp):
    cpg = _arquivo_irmao(shp, '.cpg')
    cod = open(cpg).read().strip() if cpg else 'latin-1'
    # QGIS grava "System" (codificação da máquina que salvou) — não é nome
    # que o Python conheça; o ZEE da SEMA veio assim. Latin-1 é o padrão dos
    # .dbf brasileiros; se o texto vier errado, o --inspecionar mostra.
    try:
        import codecs
        codecs.lookup(cod)
    except LookupError:
        cod = 'latin-1'
    return cod


def ler_shp(shp):
    import shapefile
    r = shapefile.Reader(shp[:-4], encoding=_codificacao(shp), encodingErrors='replace')
    campos = [f[0] for f in r.fields[1:]]
    regs = [(sr.shape.__geo_interface__, sr.record.as_dict()) for sr in r.iterShapeRecords() if sr.shape.shapeType != 0]
    return campos, regs


def _resumo_shp(shp, raiz):
    """Uma linha por shapefile do pacote: feições, tipo, projeção e campos."""
    import shapefile
    try:
        r = shapefile.Reader(shp[:-4], encoding=_codificacao(shp), encodingErrors='replace')
        prj = _arquivo_irmao(shp, '.prj')
        if prj:
            from pyproj import CRS
            crs = CRS.from_wkt(open(prj, encoding='latin-1').read()).name
        else:
            crs = 'SEM .prj'
        campos = [f[0] for f in r.fields[1:]]
        print(f'- {os.path.relpath(shp, raiz)} · {len(r)} feições · {r.shapeTypeName} · {crs}')
        regs = [rec.as_dict() for rec in r.iterRecords()]
        for c in campos:
            vals = sorted({str(x.get(c)).strip() for x in regs} - {'', 'None'})
            cheio = sum(1 for x in regs if str(x.get(c)).strip() not in ('', 'None'))
            if CAMPO_PESSOAL.search(c):
                # log de Actions pode ser público: nome de proprietário,
                # matrícula etc. nunca são impressos, só contados
                print(f'    {c}: {len(vals)} valores, {cheio}/{len(regs)} preenchidos — NÃO exibidos (possível dado pessoal)')
            else:
                amostra = [v if len(v) <= 70 else v[:67] + '…' for v in vals[:10]]
                print(f'    {c}: {len(vals)} valores, {cheio}/{len(regs)} preenchidos — {amostra}{" …" if len(vals) > 10 else ""}')
    except Exception as e:  # um arquivo quebrado não pode esconder os outros
        print(f'- {os.path.relpath(shp, raiz)} · NÃO LEU: {e}')


def inspecionar(alvo, escolha=None):
    with tempfile.TemporaryDirectory() as tmp:
        shp = localizar_shp(alvo, tmp, escolha, listar=True)
        if isinstance(shp, list):
            print(f'\n{len(shp)} shapefiles no pacote (escolha um com --shp):')
            for s in shp:
                _resumo_shp(s, tmp)
            # metadado em texto (escala, datum, data, autoria do mapa)
            for raiz, _, fs in os.walk(tmp):
                for f in fs:
                    c = os.path.join(raiz, f)
                    if f.lower().endswith('.txt') and 'metad' in f.lower() and os.path.getsize(c) < 60000:
                        print(f'\n── {os.path.relpath(c, tmp)} ──')
                        txt = open(c, 'rb').read()
                        try:
                            txt = txt.decode('utf-8')
                        except UnicodeDecodeError:
                            txt = txt.decode('latin-1')
                        print('\n'.join(txt.splitlines()[:80]))
            return
        _, crs = transformador(shp)
        campos, regs = ler_shp(shp)
        print(f'Arquivo: {os.path.basename(shp)} · {len(regs)} feições · projeção: {crs}')
        print('Campos detectados:', detectar_campos(campos))
        for c in campos:
            vals = sorted({str(p.get(c)) for _, p in regs})
            print(f'  {c}: {len(vals)} valores — {vals[:12]}{" …" if len(vals) > 12 else ""}')


def extrair(alvo, escolha, destino):
    """Só o shapefile escolhido (.shp e irmãos), num .zip para o artefato do
    workflow — é como a sessão de desenvolvimento mede as etapas sem o
    pacote de 845 MB (o Drive dá 403 lá)."""
    t0 = time.time()
    with tempfile.TemporaryDirectory() as tmp:
        shp = localizar_shp(alvo, tmp, escolha)
        print(f'baixado e extraído em {time.time() - t0:.0f} s', flush=True)
        base = os.path.basename(shp)[:-4]
        irmaos = [os.path.join(os.path.dirname(shp), f) for f in os.listdir(os.path.dirname(shp))
                  if os.path.splitext(f)[0] == base]
        with zipfile.ZipFile(destino, 'w', zipfile.ZIP_DEFLATED) as z:
            for c in sorted(irmaos):
                z.write(c, os.path.basename(c))
                print(f'  {os.path.getsize(c) / 1e6:8.1f} MB  {os.path.basename(c)}', flush=True)
    print(f'{destino}: {os.path.getsize(destino) / 1e6:.1f} MB em {time.time() - t0:.0f} s', flush=True)


def perfil(alvo, escolha, acre_arq, areas_ha=(6.25, 25, 100)):
    """Mede a conversão inteira (sem gravar) para cada área mínima: tempo de
    cada etapa, vértices, área por zona antes × depois e tamanho do GeoJSON
    que sairia. É como se escolhe a área mínima com número, não no chute."""
    acre = make_valid(shape(json.load(open(acre_arq))['features'][0]['geometry']))
    with tempfile.TemporaryDirectory() as tmp:
        t0 = time.time()
        shp = localizar_shp(alvo, tmp, escolha)
        print(f'baixado e extraído em {time.time() - t0:.0f} s', flush=True)
        t, _ = transformador(shp)
        for amin in areas_ha:
            print(f'\n== área mínima {amin} ha', flush=True)
            t1 = time.time()
            campos, geoms, props, corr = ler_preparar(shp, t, amin)
            feats = [{'type': 'Feature', 'properties': {'_i': i}, 'geometry': mapping(g)} for i, g in enumerate(geoms)]
            t2 = time.time()
            out, inval = recortar(feats, acre, ['_i'])
            print(f'  recorte {time.time() - t2:.1f} s · {len(out)} feições', flush=True)
            por_zona = {}
            for f in out:
                z = str(props[f['properties']['_i']].get('Zona'))
                por_zona[z] = por_zona.get(z, 0) + area_ha(f['geometry'])
            import gzip
            bruto = json.dumps({'type': 'FeatureCollection', 'features': out}, separators=(',', ':')).encode()
            tam, gz = len(bruto), len(gzip.compress(bruto, 6))
            n_aneis = sum(len(shapely.get_rings(shapely.get_parts(shape(f['geometry'])))) for f in out)
            nv = sum(int(shapely.get_num_coordinates(shape(f['geometry']))) for f in out)
            print(f'  total {time.time() - t1:.0f} s · {nv:,} vértices em {n_aneis:,} anéis · GeoJSON {tam / 1e6:.1f} MB '
                  f'({gz / 1e6:.1f} MB com gzip) · '
                  f'área por zona (ha): {dict(sorted((k, round(v)) for k, v in por_zona.items()))} · '
                  f'Acre {sum(por_zona.values()) / (abs(GEOD.geometry_area_perimeter(acre)[0]) / 1e4) * 100:.1f}%', flush=True)


def converter(alvo, fase, campos_forcados, legenda_csv, escala, fonte, saida, acre_arq, escolha=None, area_min_ha=0):
    if fase not in CAMADAS:
        raise SystemExit('--fase deve ser 2 ou 3')
    camada_id, fonte_padrao = CAMADAS[fase]
    legenda = ler_legenda(legenda_csv)
    acre = make_valid(shape(json.load(open(acre_arq))['features'][0]['geometry']))
    area_acre = abs(GEOD.geometry_area_perimeter(acre)[0]) / 10000
    with tempfile.TemporaryDirectory() as tmp:
        shp = localizar_shp(alvo, tmp, escolha)
        t, crs_nome = transformador(shp)
        campos_arq, geoms, regs, corr = ler_preparar(shp, t, area_min_ha)
    campos = detectar_campos(campos_arq)
    campos.update({k: v for k, v in campos_forcados.items() if v})
    faltam = [v for v in campos.values() if v and v not in campos_arq]
    if faltam:
        raise SystemExit(f'campo(s) inexistente(s) no arquivo: {faltam}. Campos: {campos_arq}')
    if not campos.get('zona') and not campos.get('subzona'):
        raise SystemExit(f'nenhum campo de zona/subzona encontrado. Campos: {campos_arq} — use --campo-zona/--campo-subzona')
    print(f'Projeção de origem: {crs_nome} · campos usados: {campos}')

    brutas, sem_zona = [], {}
    for g, props in zip(geoms, regs):
        p = normalizar(props, campos, legenda)
        if p is None:
            chave = str(props.get(campos.get('subzona') or campos.get('zona')))
            sem_zona[chave] = sem_zona.get(chave, 0) + 1
            continue
        brutas.append({'type': 'Feature', 'properties': p, 'geometry': mapping(g)})
    if sem_zona:
        raise SystemExit(f'{sum(sem_zona.values())} feição(ões) sem zona reconhecível — nada gravado. Valores: {sem_zona}')
    conferir_nomes(brutas)
    t0 = time.time()
    feats, inval = recortar(brutas, acre, CAMPOS_SAIDA)
    inval += corr
    _log(f'recortadas pelo limite do Acre: {len(feats)} feições', t0)
    if not feats:
        raise SystemExit('nenhuma feição dentro do Acre — nada gravado (projeção ou eixo errado?)')
    for f in feats:
        f['properties']['area_ha'] = round(area_ha(f['geometry']), 1)
    _log('áreas', t0)
    area = sum(f['properties']['area_ha'] for f in feats)
    pct = area / area_acre * 100
    if pct < 95 or pct > 105:
        raise SystemExit(f'cobre {pct:.1f}% da área do Acre (esperado 95–105%) — nada gravado')
    feats.sort(key=lambda f: (f['properties']['zona_cod'], f['properties'].get('subzona') or '', f['properties'].get('unidade') or ''))

    os.makedirs(saida, exist_ok=True)
    # "nenhuma" = a fonte não informa escala; a tela diz isso, nunca inventa
    escala = None if (escala or '').strip().lower() in ('', 'nenhuma', 'nao_informada', '-') else escala
    meta = {'fonte': fonte or fonte_padrao, 'escala': escala, 'projecao_origem': crs_nome,
            'gerado_em': date.today().isoformat()}
    if area_min_ha:
        # declarado: partes e furos abaixo disto foram absorvidos pela zona em volta
        meta['area_minima_ha'] = area_min_ha
    with open(os.path.join(saida, camada_id + '.geojson'), 'w', encoding='utf-8') as f:
        json.dump({'type': 'FeatureCollection', **meta, 'features': feats}, f, ensure_ascii=False, separators=(',', ':'))
    man_arq = os.path.join(saida, 'manifesto.json')
    man = json.load(open(man_arq, encoding='utf-8')) if os.path.exists(man_arq) else {'camadas': {}}
    man['camadas'][camada_id] = {**meta, 'arquivo': camada_id + '.geojson', 'feicoes': len(feats),
                                 'area_ha': round(area), 'cobertura_pct': round(pct, 1),
                                 'zonas': sorted({f['properties']['zona_cod'] for f in feats}),
                                 'subzonas': len({f['properties'].get('subzona') for f in feats} - {None})}
    with open(man_arq, 'w', encoding='utf-8') as f:
        json.dump(man, f, ensure_ascii=False, indent=1)
    kb = os.path.getsize(os.path.join(saida, camada_id + '.geojson')) / 1024
    print(f'{camada_id}: {len(feats)} feições, cobre {pct:.1f}% do Acre, {inval} geometria(s) corrigida(s), {kb:.0f} KB')


# ── base fundiária do ZEE (Fase III) ─────────────────────────────────────
# Tipo do arquivo → rótulo da tela. Tipo fora desta lista = para (nunca
# adivinha o que é).
FUND_TIPOS = {
    'ASSENTAMENTO': 'Projeto de assentamento',
    'GLEBEST': 'Gleba pública estadual',
    'GLEBFED': 'Gleba pública federal',
    'IRU': 'Imóvel rural (propriedade privada)',
    'TI': 'Terra indígena',
    'UCPI': 'UC de proteção integral',
    'UCUS': 'UC de uso sustentável',
}
# Campos que SAEM no arquivo público — lista fechada. Ficam de fora:
# PROPRIET (proprietário), MATRICULA, CERTIF, CODIGO (código do SIGEF, que
# leva ao titular) e OBSERVACAO (texto livre). NOME só para área pública:
# no imóvel rural o nome da fazenda costuma ser o do dono.
FUND_CAMPOS = ['tipo', 'tipo_rotulo', 'subtipo', 'nome', 'orgao', 'fonte', 'situacao', 'sobreposicao',
               'zona', 'subzona']


def normalizar_fundiario(props):
    tipo = (_texto(props.get('Tipo')) or '').upper()
    if tipo not in FUND_TIPOS:
        return None
    return {
        'tipo': tipo,
        'tipo_rotulo': FUND_TIPOS[tipo],
        'subtipo': _texto(props.get('SUBTIPO')),
        'nome': None if tipo == 'IRU' else _texto(props.get('NOME')),
        'orgao': _texto(props.get('ORGAO')),
        'fonte': _texto(props.get('FONTE')),
        'situacao': _texto(props.get('SITUACAO')),
        'sobreposicao': _texto(props.get('SOBREPOSIC')),
        'zona': _texto(props.get('zonas')),
        'subzona': _texto(props.get('subzonas')),
    }


def converter_fundiario(alvo, saida, acre_arq, escolha=None):
    acre = make_valid(shape(json.load(open(acre_arq))['features'][0]['geometry']))
    with tempfile.TemporaryDirectory() as tmp:
        shp = localizar_shp(alvo, tmp, escolha)
        t, crs_nome = transformador(shp)
        campos_arq, geoms, regs, corr = ler_preparar(shp, t)
    if 'Tipo' not in campos_arq:
        raise SystemExit(f'sem o campo Tipo — não parece a base fundiária do ZEE. Campos: {campos_arq}')
    brutas, fora = [], {}
    for g, props in zip(geoms, regs):
        p = normalizar_fundiario(props)
        if p is None:
            k = str(props.get('Tipo')); fora[k] = fora.get(k, 0) + 1
            continue
        brutas.append({'type': 'Feature', 'properties': p, 'geometry': mapping(g)})
    if fora:
        raise SystemExit(f'Tipo não reconhecido — nada gravado: {fora}')
    feats, inval = recortar(brutas, acre, FUND_CAMPOS)
    inval += corr
    # Trava de CONTAGEM (a base fundiária não recobre o estado de forma
    # exclusiva: as camadas se sobrepõem). Sumir mais de 5% = algo errado.
    if len(feats) < 0.95 * len(brutas):
        raise SystemExit(f'só {len(feats)} de {len(brutas)} feições ficaram dentro do Acre — nada gravado (projeção?)')
    for f in feats:
        f['properties']['area_ha'] = round(area_ha(f['geometry']), 1)
        assert set(f['properties']) <= set(FUND_CAMPOS) | {'area_ha'}, f['properties'].keys()
    feats.sort(key=lambda f: (f['properties']['tipo'], f['properties'].get('nome') or ''))
    os.makedirs(saida, exist_ok=True)
    camada_id = 'fase3_fundiario'
    meta = {'fonte': 'SEMA-AC — ZEE Fase III, base fundiária (INCRA, ITERACRE, SIGEF/SNCI, FUNAI, ICMBio, IMAC e outros)',
            'escala': None, 'projecao_origem': crs_nome, 'gerado_em': date.today().isoformat()}
    with open(os.path.join(saida, camada_id + '.geojson'), 'w', encoding='utf-8') as f:
        json.dump({'type': 'FeatureCollection', **meta, 'features': feats}, f, ensure_ascii=False, separators=(',', ':'))
    man_arq = os.path.join(saida, 'manifesto.json')
    man = json.load(open(man_arq, encoding='utf-8')) if os.path.exists(man_arq) else {'camadas': {}}
    por_tipo = {}
    for f in feats:
        por_tipo[f['properties']['tipo']] = por_tipo.get(f['properties']['tipo'], 0) + 1
    man['camadas'][camada_id] = {**meta, 'arquivo': camada_id + '.geojson', 'feicoes': len(feats),
                                 'complementar': True, 'por_tipo': por_tipo}
    with open(man_arq, 'w', encoding='utf-8') as f:
        json.dump(man, f, ensure_ascii=False, indent=1)
    kb = os.path.getsize(os.path.join(saida, camada_id + '.geojson')) / 1024
    print(f'{camada_id}: {len(feats)} de {len(brutas)} feições, por tipo {por_tipo}, {inval} geometria(s) corrigida(s), {kb:.0f} KB')


# ── descoberta (só leitura) ──────────────────────────────────────────────
def _get(url, **kw):
    import requests
    try:
        r = requests.get(url, headers=UA, timeout=60, **kw)
        return r
    except Exception as e:  # noqa: BLE001 — descoberta: registra e segue
        print(f'  ✗ {url}: {type(e).__name__}: {e}')
        return None


def listar_drive(pasta_id, nivel=0, vistos=None):
    """Lista a pasta pública pela visão embutida do Drive (HTML simples)."""
    vistos = vistos if vistos is not None else set()
    if pasta_id in vistos or nivel > 4:
        return
    vistos.add(pasta_id)
    r = _get(f'https://drive.google.com/embeddedfolderview?id={pasta_id}')
    if r is None or r.status_code != 200:
        print(f'{"  " * nivel}✗ pasta {pasta_id}: HTTP {getattr(r, "status_code", "-")}')
        return
    itens = re.findall(r'<a href="([^"]+)"[^>]*>.*?<div class="flip-entry-title">([^<]*)</div>', r.text, re.S)
    print(f'{"  " * nivel}📁 {pasta_id}: {len(itens)} item(ns)')
    for href, nome in itens:
        m = re.search(r'/folders/([\w-]+)', href)
        if m:
            print(f'{"  " * nivel}  [pasta] {nome}  (id {m.group(1)})')
            listar_drive(m.group(1), nivel + 1, vistos)
        else:
            fid = re.search(r'/d/([\w-]+)', href)
            print(f'{"  " * nivel}  {nome}  (id {fid.group(1) if fid else href})')


def descobrir():
    print('== Pasta da SEMA no Google Drive')
    for p in DRIVE_PASTAS:
        listar_drive(p)
    print('\n== Páginas do ZEE (links para arquivo, Drive ou serviço de mapa)')
    for url in PAGINAS:
        r = _get(url)
        if r is None:
            continue
        links = sorted(set(LINK_DADO.findall(r.text)))
        print(f'{url} → HTTP {r.status_code}, {len(links)} link(s)')
        for lk in links:
            print(f'   {lk}')
    print('\n== GeoServers (camadas com zee/zoneamento/acre no nome ou título)')
    for url in GEOSERVERS:
        r = _get(url, params={'service': 'WFS', 'request': 'GetCapabilities', 'version': '2.0.0'})
        if r is None:
            continue
        print(f'{url} → HTTP {r.status_code}, {len(r.content) // 1024} KB')
        for nome, titulo in _camadas_cap(r.text):
            if TEMA_ZEE.search(nome) or TEMA_ZEE.search(titulo):
                print(f'   {nome} — {titulo}')

    print('\n== i3Geo (SIAGEO/Embrapa e MMA) — temas com zee/zoneamento/acre')
    for base in I3GEO:
        r = _get(base + '/ogc.php', params={'lista': 'temas'})
        if r is not None:
            print(f'{base}/ogc.php?lista=temas → HTTP {r.status_code}, {len(r.content) // 1024} KB')
            vistos = set()
            for cod, txt in re.findall(r'tema=([\w.-]+)[^>]*>([^<]{0,160})', r.text):
                if (TEMA_ZEE.search(cod) or TEMA_ZEE.search(txt)) and cod not in vistos:
                    vistos.add(cod)
                    print(f'   tema={cod} — {txt.strip()}')
            for lin in re.findall(r'[^\n<>]{0,120}(?:zee|zoneamento)[^\n<>]{0,120}', r.text, re.I)[:40]:
                print(f'   … {lin.strip()}')
        r = _get(base + '/ogc.php', params={'service': 'WMS', 'request': 'GetCapabilities', 'version': '1.1.1'})
        if r is not None:
            cam = _camadas_cap(r.text)
            print(f'{base}/ogc.php GetCapabilities → HTTP {r.status_code}, {len(r.content) // 1024} KB, {len(cam)} camadas')
            for nome, titulo in cam:
                if TEMA_ZEE.search(nome) or TEMA_ZEE.search(titulo):
                    print(f'   {nome} — {titulo}')

    print('\n== GeoInfo/Embrapa — camadas temáticas do UZEE no Acre (atributos e amostra)')
    for camada in UZEE_ACRE:
        _amostra_wfs('https://geoinfo.dados.embrapa.br/geoserver/ows', camada)
        _legenda_geonode('https://geoinfo.dados.embrapa.br', camada)

    print('\n== Wayback Machine (arquivos geográficos arquivados)')
    for dom in WAYBACK_DOMINIOS:
        r = _get('http://web.archive.org/cdx/search/cdx', params={
            'url': dom + '/*', 'output': 'json', 'fl': 'timestamp,original,statuscode,length',
            'collapse': 'urlkey', 'filter': 'statuscode:200', 'limit': 50000})
        if r is None or r.status_code != 200:
            print(f'   {dom}: HTTP {getattr(r, "status_code", "-")}')
            continue
        try:
            linhas = r.json()[1:]
        except ValueError:
            print(f'   {dom}: resposta não-JSON ({len(r.content)} bytes)')
            continue
        geo = [l for l in linhas if ARQ_GEO.search(l[1])]
        zee = [l for l in geo if re.search(r'zee|zonea|gest|acre|_ac\b|subzon', l[1], re.I)]
        print(f'   {dom}: {len(linhas)} URLs arquivadas, {len(geo)} arquivos geográficos, {len(zee)} com cara de ZEE')
        for ts, url, _, tam in (zee or geo)[:60]:
            print(f'      {ts} {tam:>9} https://web.archive.org/web/{ts}id_/{url}')

    print('\n== ArcGIS Online (itens públicos)')
    for q in AGOL_BUSCAS:
        r = _get('https://www.arcgis.com/sharing/rest/search', params={'q': q, 'f': 'json', 'num': 50})
        if r is None or r.status_code != 200:
            continue
        itens = r.json().get('results', [])
        print(f'"{q}" → {len(itens)} item(ns)')
        for it in itens:
            if TEMA_ZEE.search(it.get('title', '') + ' ' + ' '.join(it.get('tags') or [])):
                print(f"   [{it.get('type')}] {it.get('title')} — {it.get('owner')} — {it.get('url') or 'https://www.arcgis.com/home/item.html?id=' + it.get('id', '')}")


def _amostra_wfs(url, camada):
    """Atributos, contagem, CRS e valores distintos (texto) de uma camada WFS."""
    r = _get(url, params={'service': 'WFS', 'version': '2.0.0', 'request': 'DescribeFeatureType', 'typeNames': camada})
    if r is not None:
        campos = re.findall(r'<(?:xsd:)?element[^>]*name="([^"]+)"[^>]*type="([^"]+)"', r.text)
        print(f'{camada}: atributos {[(n, t) for n, t in campos]}')
    r = _get(url, params={'service': 'WFS', 'version': '2.0.0', 'request': 'GetFeature', 'typeNames': camada,
                          'outputFormat': 'application/json', 'srsName': 'EPSG:4326', 'count': 3000})
    if r is None or r.status_code != 200:
        print(f'   GetFeature: HTTP {getattr(r, "status_code", "-")}')
        return
    j = r.json()
    feats = j.get('features') or []
    print(f'   {len(feats)} feições (numberMatched={j.get("numberMatched")}, totalFeatures={j.get("totalFeatures")}), '
          f'crs={j.get("crs")}, {len(r.content) // 1024} KB')
    if feats:
        g = shape(feats[0]['geometry'])
        print(f'   geometria {g.geom_type}, bounds da 1ª: {[round(x, 3) for x in g.bounds]}')
        for k in feats[0]['properties']:
            vals = {}
            for f in feats:
                v = f['properties'].get(k)
                vals[v] = vals.get(v, 0) + 1
            top = sorted(vals.items(), key=lambda x: -x[1])[:15]
            print(f'   {k}: {len(vals)} valores — {top}')


def _legenda_geonode(base, camada):
    """Legenda por extenso: regras do estilo SLD (título de cada classe) e o
    resumo/metadados do GeoNode — a sigla da classe nunca é adivinhada."""
    r = _get(base + '/geoserver/ows', params={'service': 'WMS', 'version': '1.1.1', 'request': 'GetStyles', 'layers': camada})
    if r is not None:
        print(f'   GetStyles → HTTP {r.status_code}, {len(r.content)} bytes')
        for nome, titulo in re.findall(r'<(?:\w+:)?Rule>\s*<(?:\w+:)?Name>([^<]*)</(?:\w+:)?Name>\s*(?:<(?:\w+:)?Title>([^<]*)</)?', r.text):
            print(f'      regra: {nome!r} — {titulo!r}')
        for lit in sorted(set(re.findall(r'<(?:\w+:)?Literal>([^<]*)</', r.text))):
            print(f'      literal: {lit!r}')
    r = _get(base + '/geoserver/ows', params={'service': 'WMS', 'version': '1.1.1', 'request': 'GetLegendGraphic',
                                               'layer': camada, 'format': 'application/json'})
    if r is not None and r.status_code == 200:
        print(f'   GetLegendGraphic(json): {r.text[:3000]}')
    nome = camada.split(':')[-1]
    for url in (f'{base}/api/v2/datasets', f'{base}/api/v2/layers', f'{base}/api/layers/'):
        r = _get(url, params={'filter{alternate}': camada} if 'v2' in url else {'alternate': camada})
        if r is None or r.status_code != 200:
            continue
        try:
            j = r.json()
        except ValueError:
            continue
        itens = j.get('datasets') or j.get('layers') or j.get('objects') or []
        for it in itens[:1]:
            for k in ('title', 'abstract', 'purpose', 'supplemental_information', 'data_quality_statement', 'attribution', 'date', 'detail_url'):
                if it.get(k):
                    print(f'   {k}: {str(it[k])[:1500]}')
            for at in (it.get('attribute_set') or []):
                print(f"   atributo: {at.get('attribute')} — {at.get('attribute_label')} — {at.get('description')}")
        if itens:
            break
    print(f'   página: {base}/catalogue/#/dataset/ (procurar {nome})')


def _camadas_cap(xml):
    """(nome, título) de cada camada de um GetCapabilities WMS/WFS, nas duas
    ordens em que os servidores escrevem."""
    a = re.findall(r'<(?:wfs:)?Name>([^<]+)</(?:wfs:)?Name>\s*<(?:wfs:)?Title>([^<]*)</', xml)
    b = [(n, t) for t, n in re.findall(r'<(?:wfs:)?Title>([^<]*)</(?:wfs:)?Title>\s*<(?:wfs:)?Name>([^<]+)</', xml)]
    return a + b


# ── autoteste (sem rede) ─────────────────────────────────────────────────
def autoteste():
    from shapely.geometry import box
    assert ler_codigo('Zona 1') == ('1', None, None)
    assert ler_codigo('Zona 01') == ('1', None, None)          # Label do arquivo da SEMA (Fase II)
    assert ler_codigo('Zona 04') == ('4', None, None)
    assert ler_codigo('Zona 10') == (None, None, None)
    assert ler_codigo('Subzona 1.2') == ('1', '1.2', None)
    assert ler_codigo('SZ 2.3.1') == ('2', '2.3', '2.3.1')
    assert ler_codigo('2,1') == ('2', '2.1', None)
    assert ler_codigo(3.0) == ('3', None, None)
    assert ler_codigo(1.2) == ('1', '1.2', None)
    assert ler_codigo('Zona 5') == (None, None, None)        # não existe zona 5
    assert ler_codigo('BR-364') == (None, None, None)         # número que não é zona
    assert ler_codigo(None) == (None, None, None)
    c = detectar_campos(['OBJECTID', 'ZONA', 'SUBZONA', 'NOME_SZ', 'AREA'])
    assert c['zona'] == 'ZONA' and c['subzona'] == 'SUBZONA' and c['nome'] == 'NOME_SZ', c
    leg = {'1.2': {'nome': 'Áreas com médio potencial social', 'diretriz': 'Consolidar a produção'}}
    p = normalizar({'ZONA': 'Zona 1', 'SUBZONA': '1.2'}, c, leg)
    assert p['zona'] == 'Zona 1 — Consolidação de sistemas de produção sustentáveis', p
    assert p['subzona_nome'] == 'Áreas com médio potencial social' and p['diretriz'] == 'Consolidar a produção'
    # só a subzona preenchida já dá a zona
    assert normalizar({'ZONA': None, 'SUBZONA': '3.1'}, c, {})['zona_cod'] == '3'
    assert normalizar({'ZONA': 'sem informação', 'SUBZONA': ''}, c, {}) is None

    with tempfile.TemporaryDirectory() as tmp:
        csvp = os.path.join(tmp, 'leg.csv')
        open(csvp, 'w', encoding='utf-8').write('subzona;nome;diretriz\nSubzona 2.1;UCs de proteção integral;Proteger\n')
        assert ler_legenda(csvp) == {'2.1': {'nome': 'UCs de proteção integral', 'diretriz': 'Proteger'}}

        # .zip com caminho para fora da pasta é recusado
        zp = os.path.join(tmp, 'mau.zip')
        with zipfile.ZipFile(zp, 'w') as z:
            z.writestr('../fora.shp', b'')
        try:
            os.makedirs(os.path.join(tmp, 'x'))
            localizar_shp(zp, os.path.join(tmp, 'x'))
            raise AssertionError('zip malicioso aceito')
        except SystemExit as e:
            assert 'suspeito' in str(e)

        # conversão de ponta a ponta: shapefile em SAD 69 (EPSG:4618) cobrindo
        # um "estado" sintético, com o .prj
        import shapefile
        from pyproj import CRS, Transformer
        estado = box(-70.0, -10.0, -69.0, -9.0)
        acre_arq = os.path.join(tmp, 'acre.geojson')
        json.dump({'type': 'FeatureCollection', 'features': [{'type': 'Feature', 'properties': {}, 'geometry': mapping(estado)}]},
                  open(acre_arq, 'w'))
        para_sad = Transformer.from_crs(4674, 4618, always_xy=True)
        base = os.path.join(tmp, 'zee')
        w = shapefile.Writer(base, shapeType=shapefile.POLYGON)
        w.field('ZONA', 'C', 20)
        w.field('SUBZONA', 'C', 20)
        metades = [(box(-70.0, -10.0, -69.5, -9.0), 'Zona 1', '1.1'), (box(-69.5, -10.0, -68.9, -9.0), 'Zona 2', '2.1')]
        for g, z, s in metades:
            gs = transform(para_sad.transform, g)
            w.poly([list(gs.exterior.coords)[::-1]])   # horário = contorno no shapefile
            w.record(z, s)
        w.close()
        open(base + '.prj', 'w').write(CRS.from_epsg(4618).to_wkt('WKT1_ESRI'))
        saida = os.path.join(tmp, 'saida')
        converter(base + '.shp', '2', {}, None, '1:250.000', None, saida, acre_arq)
        fc = json.load(open(os.path.join(saida, 'fase2_gestao.geojson')))
        assert [f['properties']['subzona'] for f in fc['features']] == ['1.1', '2.1']
        # recortado no limite (a 2ª passava de -69.0) e reprojetado (SAD 69
        # → SIRGAS desloca ~60 m; sem conversão o canto não cairia em -70.0)
        xs = [shape(f['geometry']).bounds for f in fc['features']]
        assert abs(xs[0][0] - (-70.0)) < 1e-4 and abs(xs[1][2] - (-69.0)) < 1e-4, xs
        man = json.load(open(os.path.join(saida, 'manifesto.json')))
        assert man['camadas']['fase2_gestao']['feicoes'] == 2 and 'SAD69' in man['camadas']['fase2_gestao']['projecao_origem'].replace(' ', '')

        # trava de cobertura: só metade do estado → nada gravado
        os.remove(os.path.join(saida, 'fase2_gestao.geojson'))
        w = shapefile.Writer(base + '_meio', shapeType=shapefile.POLYGON)
        w.field('SUBZONA', 'C', 20)
        w.poly([list(metades[0][0].exterior.coords)[::-1]])
        w.record('1.1')
        w.close()
        open(base + '_meio.prj', 'w').write(CRS.from_epsg(4674).to_wkt('WKT1_ESRI'))
        try:
            converter(base + '_meio.shp', '2', {}, None, None, None, saida, acre_arq)
            raise AssertionError('trava de cobertura não pegou')
        except SystemExit as e:
            assert 'cobre 50' in str(e), e
        assert not os.path.exists(os.path.join(saida, 'fase2_gestao.geojson'))

        # sem .prj → para
        os.remove(base + '_meio.prj')
        try:
            converter(base + '_meio.shp', '2', {}, None, None, None, saida, acre_arq)
            raise AssertionError('aceitou shapefile sem .prj')
        except SystemExit as e:
            assert 'sem .prj' in str(e)
        # caminho rápido da Fase III: POLYGONZ em UTM 19S (SIRGAS 2000), anel
        # com milhares de vértices e ruído de 1 m (some na simplificação em
        # METROS, antes da reprojeção), uma feição com laço (make_valid) e
        # nomes do próprio arquivo
        para_utm = Transformer.from_crs(4674, 31979, always_xy=True)
        def anel_denso(g, n=4000):
            ext = g.exterior
            pts = [ext.interpolate(i / n, normalized=True) for i in range(n)]
            xy = [para_utm.transform(q.x, q.y) for q in pts]
            return [(x + (i % 2) * 1.0, y, 0.0) for i, (x, y) in enumerate(xy)]
        base3 = os.path.join(tmp, 'zee3')
        w = shapefile.Writer(base3, shapeType=shapefile.POLYGONZ, encoding='latin-1')
        for c in ('Zona', 'Zon_label', 'DescrZona', 'DescSubZon', 'DescUniman'):
            w.field(c, 'C', 60)
        r1 = anel_denso(metades[0][0])
        w.polyz([r1[::-1] + [r1[-1]]])
        w.record('1', '1.2.3', 'Produção', 'Agropecuária', 'Áreas com alto potencial')
        r2 = anel_denso(metades[1][0])
        # laço: o anel volta sobre si num canto (autointerseção)
        x0, y0, _ = r2[0]
        laco = [(x0 + 3000, y0 + 3000, 0.0), (x0 + 3000, y0, 0.0), (x0, y0 + 3000, 0.0)]
        r2 = [r2[0]] + laco + r2[1:]
        w.polyz([r2[::-1] + [r2[-1]]])
        w.record('2', '2.1.0', 'Proteção', 'Unidades de conservação', '')
        w.close()
        open(base3 + '.prj', 'w').write(CRS.from_epsg(31979).to_wkt('WKT1_ESRI'))
        open(base3 + '.cpg', 'w').write('System')   # QGIS: lido como latin-1
        assert abs(tolerancia_origem(base3 + '.shp') - TOLERANCIA / 2 * M_POR_GRAU) < 1e-9
        _, g3, pr3, corr3 = ler_preparar(base3 + '.shp', transformador(base3 + '.shp')[0])
        assert not shapely.has_z(g3).any() and shapely.is_valid(g3).all() and corr3 == 1, (corr3,)
        assert shapely.get_num_coordinates(g3).max() < 200, shapely.get_num_coordinates(g3)   # 4 000 → poucos
        assert pr3[0]['DescSubZon'] == 'Agropecuária', pr3[0]
        saida3 = os.path.join(tmp, 'saida3')
        converter(base3 + '.shp', '3', {'zona': 'Zona', 'subzona': 'Zon_label', 'zona_nome': 'DescrZona',
                                        'subzona_nome': 'DescSubZon', 'unidade_nome': 'DescUniman'},
                  None, 'nenhuma', None, saida3, acre_arq)
        fc3 = json.load(open(os.path.join(saida3, 'fase3_gestao.geojson')))
        ps = [f['properties'] for f in fc3['features']]
        assert [p['unidade'] if 'unidade' in p else None for p in ps] == ['1.2.3', None], ps
        assert ps[0]['zona'] == 'Zona 1 — Produção' and ps[0]['unidade_nome'] == 'Áreas com alto potencial', ps
        man3 = json.load(open(os.path.join(saida3, 'manifesto.json')))['camadas']['fase3_gestao']
        assert man3['escala'] is None and 99 <= man3['cobertura_pct'] <= 101 and man3['subzonas'] == 2, man3
        xs = [shape(f['geometry']).bounds for f in fc3['features']]
        assert abs(xs[0][0] - (-70.0)) < 1e-3 and abs(xs[1][2] - (-69.0)) < 1e-3, xs   # UTM → lon/lat certo
        # o mesmo arquivo pelo caminho da área mínima (Douglas-Peucker + make_valid)
        converter(base3 + '.shp', '3', {'zona': 'Zona', 'subzona': 'Zon_label', 'zona_nome': 'DescrZona',
                                        'subzona_nome': 'DescSubZon', 'unidade_nome': 'DescUniman'},
                  None, 'nenhuma', None, saida3, acre_arq, area_min_ha=1)
        man3 = json.load(open(os.path.join(saida3, 'manifesto.json')))['camadas']['fase3_gestao']
        assert man3['area_minima_ha'] == 1 and 99 <= man3['cobertura_pct'] <= 101 and man3['feicoes'] == 2, man3

    # área mínima: furo miúdo some (vira da zona em volta), ilha miúda some,
    # o que é grande fica
    from shapely.geometry import MultiPolygon, Polygon
    grande = Polygon([(0, 0), (0, 1000), (1000, 1000), (1000, 0)], [[(100, 100), (100, 150), (150, 150), (150, 100)],
                                                                     [(500, 500), (500, 800), (800, 800), (800, 500)]])
    ilha = Polygon([(2000, 0), (2000, 50), (2050, 50), (2050, 0)])
    g, n_p, n_f = tirar_miudos(np.array([MultiPolygon([grande, ilha])], dtype=object), 10000)   # 1 ha
    assert (n_p, n_f) == (1, 1) and len(g[0].interiors) == 1 and abs(g[0].area - (1e6 - 9e4)) < 1e-6, (n_p, n_f, g[0].area)

    # Fase III: código completo no Zon_label, nomes do próprio arquivo, ".0" = sem unidade
    c3 = {'zona': 'Zona', 'subzona': 'Zon_label', 'unidade': None, 'nome': None,
          'zona_nome': 'DescrZona', 'subzona_nome': 'DescSubZon', 'unidade_nome': 'DescUniman'}
    p3 = normalizar({'Zona': '4', 'Zon_label': '4.1.0', 'DescrZona': 'Cidades do Acre',
                     'DescSubZon': 'Capital do Acre', 'DescUniman': ''}, c3, {})
    assert p3['zona'] == 'Zona 4 — Cidades do Acre' and p3['subzona'] == '4.1' and p3['unidade'] is None, p3
    assert p3['subzona_nome'] == 'Capital do Acre' and p3['unidade_nome'] is None, p3
    p3 = normalizar({'Zona': '1', 'Zon_label': '1.2.3', 'DescrZona': 'Produção', 'DescSubZon': 'Agropecuária',
                     'DescUniman': 'Áreas com alto potencial'}, c3, {})
    assert p3['unidade'] == '1.2.3' and p3['unidade_nome'] == 'Áreas com alto potencial', p3
    try:
        conferir_nomes([{'properties': {'zona_cod': '1', 'zona': 'Zona 1 — A'}},
                        {'properties': {'zona_cod': '1', 'zona': 'Zona 1 — B'}}])
        raise AssertionError('código com dois nomes aceito')
    except SystemExit:
        pass
    # fundiário: dado pessoal nunca sai; nome do imóvel rural também não
    f = normalizar_fundiario({'Tipo': 'IRU', 'NOME': 'Fazenda do Fulano', 'PROPRIET': 'Fulano de Tal',
                              'MATRICULA': '123', 'CODIGO': 'abc', 'SUBTIPO': 'Propriedade Privada'})
    assert f['nome'] is None and 'Fulano' not in json.dumps(f) and '123' not in json.dumps(f), f
    assert normalizar_fundiario({'Tipo': 'UCUS', 'NOME': 'RESEX Chico Mendes'})['nome'] == 'RESEX Chico Mendes'
    assert normalizar_fundiario({'Tipo': 'OUTRO'}) is None
    assert set(normalizar_fundiario({'Tipo': 'TI'})) <= set(FUND_CAMPOS)

    # pacote com vários .shp: escolhe pelo trecho, nunca chuta
    shps = ['/r/a/Zonas_Gestao.shp', '/r/b/Zonas_Gestao_Sub.shp', '/r/c/Fundiario.shp']
    assert _escolher_shp(shps, '/r', 'zonas_gestao') == '/r/a/Zonas_Gestao.shp'   # nome exato vence
    assert _escolher_shp(shps, '/r', 'fundi') == '/r/c/Fundiario.shp'
    # cópia dentro de .rar interno não torna a escolha ambígua
    assert _escolher_shp(shps + ['/r/x.rar_extraido/Fundiario.shp'], '/r', 'fundi') == '/r/c/Fundiario.shp'
    for ruim in (None, 'zonas', 'nada'):
        try:
            _escolher_shp(shps, '/r', ruim)
            raise AssertionError(f'escolha {ruim!r} aceita')
        except SystemExit:
            pass
    print('autoteste ok')


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--autoteste', action='store_true')
    ap.add_argument('--descobrir', action='store_true')
    ap.add_argument('--inspecionar')
    ap.add_argument('--converter')
    ap.add_argument('--fase', choices=['2', '3'])
    ap.add_argument('--campo-zona')
    ap.add_argument('--campo-subzona')
    ap.add_argument('--campo-unidade')
    ap.add_argument('--campo-nome')
    ap.add_argument('--campo-zona-nome', help='nome da zona no próprio arquivo (Fase III: DescrZona)')
    ap.add_argument('--campo-subzona-nome', help='Fase III: DescSubZon')
    ap.add_argument('--campo-unidade-nome', help='Fase III: DescUniman')
    ap.add_argument('--fundiario', help='converte a base fundiária do ZEE (ARQ; escolha o .shp com --shp)')
    ap.add_argument('--legenda')
    ap.add_argument('--area-minima-ha', type=float, default=0,
                    help='tira partes e furos menores que isto antes de simplificar (ZEE III: raster vetorizado)')
    ap.add_argument('--escala')
    ap.add_argument('--fonte')
    ap.add_argument('--saida', default='data/zee')
    ap.add_argument('--acre', default='data/acre_estado.geojson')
    ap.add_argument('--extrair', help='baixa ARQ e zipa só o .shp escolhido (--shp) e os irmãos em --destino')
    ap.add_argument('--destino', default='zee_extraido.zip')
    ap.add_argument('--perfil', help='mede cada etapa da conversão de ARQ (--shp), feição por feição, sem gravar')
    ap.add_argument('--shp', help='pacote com vários .shp: trecho do caminho/nome do escolhido')
    a = ap.parse_args()
    if a.autoteste:
        autoteste()
    elif a.descobrir:
        descobrir()
    elif a.inspecionar:
        inspecionar(a.inspecionar, a.shp)
    elif a.converter:
        if not a.fase:
            ap.error('--converter exige --fase 2 ou 3')
        converter(a.converter, a.fase, {'zona': a.campo_zona, 'subzona': a.campo_subzona, 'unidade': a.campo_unidade,
                                        'nome': a.campo_nome, 'zona_nome': a.campo_zona_nome,
                                        'subzona_nome': a.campo_subzona_nome, 'unidade_nome': a.campo_unidade_nome},
                  a.legenda, a.escala, a.fonte, a.saida, a.acre, a.shp, a.area_minima_ha)
    elif a.perfil:
        perfil(a.perfil, a.shp, a.acre)
    elif a.extrair:
        extrair(a.extrair, a.shp, a.destino)
    elif a.fundiario:
        converter_fundiario(a.fundiario, a.saida, a.acre, a.shp)
    else:
        ap.print_help()


if __name__ == '__main__':
    main()
