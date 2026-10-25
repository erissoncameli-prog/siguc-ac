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
import zipfile
from datetime import date

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from meio_fisico import GEOD, area_ha, recortar  # noqa: E402  (mesmo recorte e simplificação do Meio Físico)

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

CAMPOS_SAIDA = ['zona_cod', 'zona', 'subzona', 'subzona_nome', 'unidade', 'diretriz']

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
]
LINK_DADO = re.compile(r'href="([^"]+?(?:\.zip|\.rar|\.7z|\.shp|\.kmz|\.kml|\.gpkg|\.geojson|\.pdf|drive\.google\.com[^"]*|'
                       r'geoserver[^"]*|/wms[^"]*|/wfs[^"]*))"', re.I)
TEMA_ZEE = re.compile(r'zee|zoneamento|acre', re.I)


# ── leitura do código de zona/subzona ────────────────────────────────────
_COD = re.compile(r'(?<![\d.])([1-4])(?:\s*[.,]\s*(\d{1,2}))?(?:\s*[.,]\s*(\d{1,2}))?(?![\d])')


def ler_codigo(valor):
    """'Zona 1', 'Z1', '1', 'Subzona 1.2', 'SZ 2.3.1', 1.2 → (zona, subzona, unidade).
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
    leg = legenda.get(uni) or legenda.get(sub) or {}
    nome = _texto(props.get(campos['nome'])) if campos.get('nome') else None
    return {
        'zona_cod': zona,
        'zona': f'Zona {zona} — {ZONAS[zona]}',
        'subzona': sub,
        'subzona_nome': leg.get('nome') or nome,
        'unidade': uni,
        'diretriz': leg.get('diretriz'),
    }


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


def localizar_shp(alvo, pasta_tmp):
    if re.match(r'^(https?://|drive:)', alvo):
        alvo = _baixar(alvo, pasta_tmp)
    if alvo.lower().endswith('.zip'):
        with zipfile.ZipFile(alvo) as z:
            for nome in z.namelist():
                destino = os.path.realpath(os.path.join(pasta_tmp, nome))
                if not destino.startswith(os.path.realpath(pasta_tmp) + os.sep):
                    raise SystemExit(f'caminho suspeito dentro do .zip: {nome}')
            z.extractall(pasta_tmp)
        alvo = pasta_tmp
    if os.path.isdir(alvo):
        shps = [os.path.join(r, f) for r, _, fs in os.walk(alvo) for f in fs if f.lower().endswith('.shp')]
        if len(shps) != 1:
            raise SystemExit(f'esperava 1 .shp em {alvo}, achei {len(shps)}: {[os.path.basename(s) for s in shps]}')
        alvo = shps[0]
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


def ler_shp(shp):
    import shapefile
    cpg = _arquivo_irmao(shp, '.cpg')
    cod = open(cpg).read().strip() if cpg else 'latin-1'
    r = shapefile.Reader(shp[:-4], encoding=cod, encodingErrors='replace')
    campos = [f[0] for f in r.fields[1:]]
    regs = [(sr.shape.__geo_interface__, sr.record.as_dict()) for sr in r.iterShapeRecords() if sr.shape.shapeType != 0]
    return campos, regs


def inspecionar(alvo):
    with tempfile.TemporaryDirectory() as tmp:
        shp = localizar_shp(alvo, tmp)
        _, crs = transformador(shp)
        campos, regs = ler_shp(shp)
        print(f'Arquivo: {os.path.basename(shp)} · {len(regs)} feições · projeção: {crs}')
        print('Campos detectados:', detectar_campos(campos))
        for c in campos:
            vals = sorted({str(p.get(c)) for _, p in regs})
            print(f'  {c}: {len(vals)} valores — {vals[:12]}{" …" if len(vals) > 12 else ""}')


def converter(alvo, fase, campos_forcados, legenda_csv, escala, fonte, saida, acre_arq):
    if fase not in CAMADAS:
        raise SystemExit('--fase deve ser 2 ou 3')
    camada_id, fonte_padrao = CAMADAS[fase]
    legenda = ler_legenda(legenda_csv)
    acre = make_valid(shape(json.load(open(acre_arq))['features'][0]['geometry']))
    area_acre = abs(GEOD.geometry_area_perimeter(acre)[0]) / 10000
    with tempfile.TemporaryDirectory() as tmp:
        shp = localizar_shp(alvo, tmp)
        t, crs_nome = transformador(shp)
        campos_arq, regs = ler_shp(shp)
    campos = detectar_campos(campos_arq)
    campos.update({k: v for k, v in campos_forcados.items() if v})
    faltam = [v for v in campos.values() if v and v not in campos_arq]
    if faltam:
        raise SystemExit(f'campo(s) inexistente(s) no arquivo: {faltam}. Campos: {campos_arq}')
    if not campos.get('zona') and not campos.get('subzona'):
        raise SystemExit(f'nenhum campo de zona/subzona encontrado. Campos: {campos_arq} — use --campo-zona/--campo-subzona')
    print(f'Projeção de origem: {crs_nome} · campos usados: {campos}')

    brutas, sem_zona = [], {}
    for geo, props in regs:
        p = normalizar(props, campos, legenda)
        if p is None:
            chave = str(props.get(campos.get('subzona') or campos.get('zona')))
            sem_zona[chave] = sem_zona.get(chave, 0) + 1
            continue
        g = shape(geo)
        if t is not None:
            g = transform(t.transform, g)
        if not g.is_valid:
            g = make_valid(g)
        brutas.append({'type': 'Feature', 'properties': p, 'geometry': mapping(g)})
    if sem_zona:
        raise SystemExit(f'{sum(sem_zona.values())} feição(ões) sem zona reconhecível — nada gravado. Valores: {sem_zona}')

    feats, inval = recortar(brutas, acre, CAMPOS_SAIDA)
    if not feats:
        raise SystemExit('nenhuma feição dentro do Acre — nada gravado (projeção ou eixo errado?)')
    for f in feats:
        f['properties']['area_ha'] = round(area_ha(f['geometry']), 1)
    area = sum(f['properties']['area_ha'] for f in feats)
    pct = area / area_acre * 100
    if pct < 95 or pct > 105:
        raise SystemExit(f'cobre {pct:.1f}% da área do Acre (esperado 95–105%) — nada gravado')
    feats.sort(key=lambda f: (f['properties']['zona_cod'], f['properties'].get('subzona') or '', f['properties'].get('unidade') or ''))

    os.makedirs(saida, exist_ok=True)
    meta = {'fonte': fonte or fonte_padrao, 'escala': escala, 'projecao_origem': crs_nome,
            'gerado_em': date.today().isoformat()}
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
        for nome, titulo in re.findall(r'<(?:wfs:)?Name>([^<]+)</(?:wfs:)?Name>\s*<(?:wfs:)?Title>([^<]*)</', r.text):
            if TEMA_ZEE.search(nome) or TEMA_ZEE.search(titulo):
                print(f'   {nome} — {titulo}')


# ── autoteste (sem rede) ─────────────────────────────────────────────────
def autoteste():
    from shapely.geometry import box
    assert ler_codigo('Zona 1') == ('1', None, None)
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
    ap.add_argument('--legenda')
    ap.add_argument('--escala')
    ap.add_argument('--fonte')
    ap.add_argument('--saida', default='data/zee')
    ap.add_argument('--acre', default='data/acre_estado.geojson')
    a = ap.parse_args()
    if a.autoteste:
        autoteste()
    elif a.descobrir:
        descobrir()
    elif a.inspecionar:
        inspecionar(a.inspecionar)
    elif a.converter:
        if not a.fase:
            ap.error('--converter exige --fase 2 ou 3')
        converter(a.converter, a.fase, {'zona': a.campo_zona, 'subzona': a.campo_subzona, 'unidade': a.campo_unidade,
                                        'nome': a.campo_nome}, a.legenda, a.escala, a.fonte, a.saida, a.acre)
    else:
        ap.print_help()


if __name__ == '__main__':
    main()
