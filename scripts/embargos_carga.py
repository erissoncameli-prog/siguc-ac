#!/usr/bin/env python3
"""
Embargos ambientais do Acre (migration 360) — IBAMA e IMAC.

Roda FORA do banco, de propósito: o CSV do IBAMA tem ~210 MB (o Brasil
inteiro, com o polígono em WKT) e os ZIPs do IMAC são binários — nenhum dos
dois pode passar pelo pg_net (ver CLAUDE.md: resposta grande pelo pg_net já
reiniciou a produção). Aqui o download e o filtro acontecem no runner do
GitHub; o banco recebe só as linhas do Acre, pela API de gerenciamento.

LGPD (minimização): o cruzamento com o CAR é por SOBREPOSIÇÃO, então nome,
CPF/CNPJ do embargado e nome do imóvel nunca são lidos para gravação — nem
impressos no log. Do IMAC, coluna cujo nome lembre dado pessoal é descartada
antes de qualquer outra coisa.

Recarga segura: upsert por (fonte, chave) e, só depois de tudo gravado, apaga
o que a fonte deixou de publicar. Uma fonte que falhar nunca esvazia a tabela.

Modos:
  --autoteste        lógica pura com dado sintético, sem rede
  --seco             baixa, filtra e mostra o resumo, sem gravar
  (padrão)           baixa, filtra e grava
  --fonte ibama|imac só uma fonte

Variáveis: SUPABASE_ACCESS_TOKEN (segredo do repositório), SUPABASE_REF.
"""
import argparse
import csv
import datetime as dt
import glob
import hashlib
import io
import json
import os
import re
import sys
import tempfile
import time
import unicodedata
import zipfile

import requests

REF = os.environ.get('SUPABASE_REF', 'atqtybcsvepdabsvgaly')
IBAMA_CSV = ('https://stibamadadosabertosprd.blob.core.windows.net/dados-abertos/dados/'
             'TERMOS_DE_EMBARGO/TERMO_EMBARGO/termo_de_embargo.csv')
IMAC_PAGINA = 'https://imac.ac.gov.br/fiscalizacao-autuacoes/'
IMAC_ZIP = re.compile(r'https://imac\.ac\.gov\.br/wp-content/uploads/[^"\'\s]+Embargos?[^"\'\s]*\.zip', re.I)
UA = {'User-Agent': 'SIGUC-AC/1.0 (SEMA-AC; carga de embargos)'}
# Caixa do Acre com folga: coordenada fora disso vem com eixo trocado ou errada.
LON_MIN, LON_MAX, LAT_MIN, LAT_MAX = -75.5, -65.5, -12.5, -6.5
LOTE_BYTES = 1_500_000
PESSOAL = re.compile(r'cpf|cnpj|nome|propriet|autuad|embargad|interessad|telefone|fone|endere|email|e_mail|\brg\b|identid', re.I)


# ── Supabase (API de gerenciamento — o mesmo segredo do deploy) ─────────
def sql(query):
    token = os.environ['SUPABASE_ACCESS_TOKEN']
    for tentativa in range(5):
        r = requests.post(f'https://api.supabase.com/v1/projects/{REF}/database/query',
                          headers={'Authorization': f'Bearer {token}'},
                          json={'query': query}, timeout=180)
        if r.status_code < 500 and r.status_code != 429:
            break
        time.sleep(2 ** (tentativa + 1))
    if r.status_code >= 300:
        raise RuntimeError(f'SQL falhou ({r.status_code}): {r.text[:500]}')
    return r.json()


def lit(v):
    if v is None or v == '':
        return 'NULL'
    return "'" + str(v).replace("'", "''") + "'"


# ── Normalização ────────────────────────────────────────────────────────
def norm(s):
    s = unicodedata.normalize('NFD', str(s or '')).encode('ascii', 'ignore').decode()
    return re.sub(r'[^a-z0-9]+', '_', s.lower()).strip('_')


def data_iso(v):
    """Data plausível (1980 → ano que vem) ou None. Ano de 4 dígitos com
    dígito trocado existe na fonte ("2925-09-25") — vira None, nunca data falsa."""
    if v is None:
        return None
    s = str(v).strip()
    if not s:
        return None
    m = re.match(r'^(\d{4})-(\d{2})-(\d{2})', s) or None
    if m:
        a, mes, d = int(m[1]), int(m[2]), int(m[3])
    else:
        m = re.match(r'^(\d{1,2})/(\d{1,2})/(\d{4})', s)
        if not m:
            return None
        d, mes, a = int(m[1]), int(m[2]), int(m[3])
    if not (1980 <= a <= dt.date.today().year + 1):
        return None
    try:
        return dt.date(a, mes, d).isoformat()
    except ValueError:
        return None


def numero(v):
    if v is None:
        return None
    s = str(v).strip().replace('.', '').replace(',', '.') if ',' in str(v) else str(v).strip()
    try:
        x = float(s)
        return x if x >= 0 else None
    except ValueError:
        return None


def wkt_no_acre(wkt):
    """Confere/arruma o eixo de um WKT. Devolve (wkt, ok)."""
    nums = re.findall(r'(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)', wkt[:2000])
    if not nums:
        return wkt, False
    x, y = float(nums[0][0]), float(nums[0][1])
    if LON_MIN <= x <= LON_MAX and LAT_MIN <= y <= LAT_MAX:
        return wkt, True
    if LAT_MIN <= x <= LAT_MAX and LON_MIN <= y <= LON_MAX:
        return re.sub(r'(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)', r'\2 \1', wkt), True
    return wkt, False


# ── IBAMA ───────────────────────────────────────────────────────────────
def ibama_situacao(r):
    if str(r.get('SIT_CANCELADO', '')).strip().upper() in ('S', 'SIM', '1', 'TRUE'):
        return 'cancelado'
    sd = norm(r.get('SIT_DESEMBARGO'))
    if sd and sd not in ('n', 'nao', '0', 'false') or data_iso(r.get('DAT_DESEMBARGO')):
        return 'desembargado'
    return 'vigente'


def ibama_linha(r):
    """Uma linha do CSV → registro (ou None). Só o que é do Acre."""
    if str(r.get('UF', '')).strip().upper() != 'AC':
        return None
    chave = str(r.get('SEQ_TAD') or '').strip() or str(r.get('NUM_TAD') or '').strip()
    if not chave:
        return None
    geom = None
    wkt = (r.get('GEOM_AREA_EMBARGADA') or '').strip()
    if wkt and re.match(r'^(MULTI)?POLYGON', wkt, re.I):
        wkt, ok = wkt_no_acre(wkt)
        geom = wkt if ok else None
    if geom is None:
        # Sem polígono válido: o ponto do termo (coordenada decimal, sinal negativo).
        try:
            lon = float(str(r.get('NUM_LONGITUDE_TAD')).replace(',', '.'))
            lat = float(str(r.get('NUM_LATITUDE_TAD')).replace(',', '.'))
            if LON_MIN <= lon <= LON_MAX and LAT_MIN <= lat <= LAT_MAX:
                geom = f'POINT({lon} {lat})'
        except (TypeError, ValueError):
            pass
    termo = ' '.join(x for x in [str(r.get('NUM_TAD') or '').strip(), str(r.get('SER_TAD') or '').strip()] if x)
    return {
        'fonte': 'ibama', 'chave': chave,
        'num_termo': termo or None,
        'num_auto': (r.get('NUM_AUTO_INFRACAO') or '').strip() or None,
        'num_processo': (r.get('NUM_PROCESSO') or '').strip() or None,
        'data_embargo': data_iso(r.get('DAT_EMBARGO')),
        'situacao': ibama_situacao(r),
        'data_desembargo': data_iso(r.get('DAT_DESEMBARGO')),
        'area_ha': numero(r.get('QTD_AREA_EMBARGADA')),
        'municipio': (r.get('MUNICIPIO') or '').strip() or None,
        'descricao': ((r.get('DES_TAD') or '').strip() or None),
        'geom': geom,
    }


def ibama_baixar():
    csv.field_size_limit(10 ** 9)
    with requests.get(IBAMA_CSV, headers=UA, stream=True, timeout=600) as resp:
        resp.raise_for_status()
        texto = io.TextIOWrapper(resp.raw, encoding='utf-8-sig', newline='')
        leitor = csv.DictReader(texto, delimiter=';')
        total, regs, sit = 0, [], {}
        for r in leitor:
            total += 1
            reg = ibama_linha(r)
            if reg:
                regs.append(reg)
                k = (norm(r.get('SIT_DESEMBARGO')) or '-', norm(r.get('TIPO_DESEMBARGO')) or '-', str(r.get('SIT_CANCELADO') or '-'))
                sit[k] = sit.get(k, 0) + 1
    print(f'[ibama] {total} linhas no Brasil, {len(regs)} no Acre')
    print('[ibama] (sit_desembargo, tipo_desembargo, sit_cancelado) → n:', json.dumps({'|'.join(k): v for k, v in sit.items()}, ensure_ascii=False))
    return regs


# ── IMAC ────────────────────────────────────────────────────────────────
CAMPOS_IMAC = [
    ('num_termo', re.compile(r'termo|tad|^n_?emb|num.*emb|embargo_n|^te$')),
    ('num_auto', re.compile(r'auto|^ai$|^n_?ai')),
    ('num_processo', re.compile(r'process')),
    ('data_desembargo', re.compile(r'desemb')),
    ('data_embargo', re.compile(r'(^|_)(data|dt|dat)(_|$)|data_emb|dt_emb')),
    ('situacao', re.compile(r'situa|status')),
    ('area_ha', re.compile(r'area|^ha$|hectar')),
    ('municipio', re.compile(r'munic')),
    ('descricao', re.compile(r'desc|infra|motivo|obs|tipo')),
]


def imac_mapear(colunas):
    """Coluna da fonte → campo nosso. Coluna com cara de dado pessoal sai antes."""
    livres = [c for c in colunas if c != 'geometry' and not PESSOAL.search(norm(c))]
    usado, mapa = set(), {}
    for campo, rx in CAMPOS_IMAC:
        for c in livres:
            if c in usado:
                continue
            if rx.search(norm(c)):
                mapa[campo] = c
                usado.add(c)
                break
    return mapa, [c for c in colunas if c != 'geometry' and PESSOAL.search(norm(c))]


def imac_situacao(v, data_desemb):
    s = norm(v)
    if 'cancel' in s:
        return 'cancelado'
    if 'desemb' in s or data_desemb:
        return 'desembargado'
    if s in ('', 'none', 'nan'):
        return 'vigente' if not data_desemb else 'desembargado'
    if 'vigent' in s or 'ativo' in s or 'embarg' in s:
        return 'vigente'
    return 'desconhecida'


def imac_baixar():
    import geopandas as gpd  # só aqui: o autoteste não precisa
    pagina = requests.get(IMAC_PAGINA, headers=UA, timeout=120).text
    zips = sorted(set(IMAC_ZIP.findall(pagina)))
    print(f'[imac] {len(zips)} arquivo(s) na página:', *[z.rsplit("/", 1)[-1] for z in zips])
    if not zips:
        raise RuntimeError('IMAC: nenhum ZIP de embargo encontrado na página')
    regs = []
    for url in zips:
        nome = url.rsplit('/', 1)[-1]
        with tempfile.TemporaryDirectory() as tmp:
            dados = requests.get(url, headers=UA, timeout=300).content
            with zipfile.ZipFile(io.BytesIO(dados)) as z:
                print(f'[imac] {nome}: {len(dados)} bytes →', [i.filename for i in z.infolist()][:20])
                z.extractall(tmp)
            for kmz in glob.glob(os.path.join(tmp, '**', '*.kmz'), recursive=True):
                with zipfile.ZipFile(kmz) as k:
                    k.extractall(os.path.splitext(kmz)[0])
            arquivos = [p for ext in ('shp', 'kml', 'geojson', 'json', 'gpkg')
                        for p in glob.glob(os.path.join(tmp, '**', f'*.{ext}'), recursive=True)]
            if not arquivos:
                raise RuntimeError(f'IMAC {nome}: nenhum arquivo vetorial dentro do ZIP')
            for arq in arquivos:
                gdf = gpd.read_file(arq)
                if gdf.crs is not None and gdf.crs.to_epsg() not in (4326, 4674):
                    gdf = gdf.to_crs(4326)
                mapa, descartadas = imac_mapear(list(gdf.columns))
                print(f'[imac] {os.path.basename(arq)}: {len(gdf)} feições; CRS {gdf.crs}; '
                      f'colunas usadas {mapa}; descartadas por dado pessoal {descartadas}; '
                      f'outras {[c for c in gdf.columns if c not in mapa.values() and c not in descartadas and c != "geometry"]}')
                if 'situacao' in mapa:
                    print('[imac]   situação → n:', gdf[mapa['situacao']].astype(str).value_counts().head(12).to_dict())
                for i, row in gdf.iterrows():
                    g = row.geometry
                    if g is None or g.is_empty:
                        continue
                    if g.has_z:
                        from shapely import force_2d
                        g = force_2d(g)
                    wkt, ok = wkt_no_acre(g.wkt)
                    if not ok:
                        continue
                    pega = lambda campo: (None if campo not in mapa else
                                          (None if str(row[mapa[campo]]) in ('None', 'nan', 'NaT', '') else row[mapa[campo]]))
                    termo = pega('num_termo')
                    base = f'{nome}|{termo}' if termo else f'{nome}|{i}|{hashlib.sha1(wkt.encode()).hexdigest()[:16]}'
                    d_desemb = data_iso(pega('data_desembargo'))
                    regs.append({
                        'fonte': 'imac', 'chave': hashlib.sha1(base.encode()).hexdigest()[:24],
                        'num_termo': str(termo).strip() if termo is not None else None,
                        'num_auto': str(pega('num_auto')).strip() if pega('num_auto') is not None else None,
                        'num_processo': str(pega('num_processo')).strip() if pega('num_processo') is not None else None,
                        'data_embargo': data_iso(pega('data_embargo')),
                        'situacao': imac_situacao(pega('situacao'), d_desemb),
                        'data_desembargo': d_desemb,
                        'area_ha': numero(pega('area_ha')),
                        'municipio': str(pega('municipio')).strip() if pega('municipio') is not None else None,
                        'descricao': str(pega('descricao')).strip()[:1000] if pega('descricao') is not None else None,
                        'geom': wkt,
                    })
    print(f'[imac] {len(regs)} embargos com geometria no Acre')
    return regs


# ── Gravação ────────────────────────────────────────────────────────────
COLS = ['fonte', 'chave', 'num_termo', 'num_auto', 'num_processo', 'data_embargo', 'situacao',
        'data_desembargo', 'area_ha', 'municipio', 'descricao']


def valores(r):
    g = f"ST_MakeValid(ST_GeomFromText({lit(r['geom'])}, 4326))" if r['geom'] else 'NULL'
    return '(' + ', '.join(lit(r[c]) for c in COLS) + f', {g}, now())'


def gravar(fonte, regs):
    if not regs:
        raise RuntimeError(f'{fonte}: 0 registros — nada gravado (fonte vazia nunca apaga a tabela)')
    vistos, unicos = set(), []
    for r in regs:
        if r['chave'] not in vistos:
            vistos.add(r['chave'])
            unicos.append(r)
    inicio = sql('SELECT now() AS t')[0]['t']
    lote, tam, n = [], 0, 0
    def enviar():
        nonlocal lote, tam, n
        if not lote:
            return
        sql('INSERT INTO embargos_ambientais (' + ', '.join(COLS) + ', geom, carregado_em) VALUES '
            + ', '.join(lote) + ' ON CONFLICT (fonte, chave) DO UPDATE SET '
            + ', '.join(f'{c} = EXCLUDED.{c}' for c in COLS[2:]) + ', geom = EXCLUDED.geom, carregado_em = now()')
        n += len(lote)
        lote, tam = [], 0
    for r in unicos:
        v = valores(r)
        lote.append(v)
        tam += len(v)
        if tam > LOTE_BYTES:
            enviar()
    enviar()
    # Só depois de tudo gravado: some o que a fonte deixou de publicar.
    sql(f"DELETE FROM embargos_ambientais WHERE fonte = {lit(fonte)} AND carregado_em < {lit(inicio)}::timestamptz")
    sql(f"INSERT INTO embargos_cargas (fonte, ok, linhas) VALUES ({lit(fonte)}, true, {n})")
    print(f'[{fonte}] gravados {n}')


def registrar_falha(fonte, erro):
    try:
        sql(f"INSERT INTO embargos_cargas (fonte, ok, observacao) VALUES ({lit(fonte)}, false, {lit(str(erro)[:500])})")
    except Exception as e:  # noqa: BLE001
        print(f'[{fonte}] não consegui registrar a falha: {e}')


def resumo(regs):
    sit = {}
    for r in regs:
        sit[r['situacao']] = sit.get(r['situacao'], 0) + 1
    com_poligono = sum(1 for r in regs if r['geom'] and 'POLYGON' in r['geom'].upper())
    com_ponto = sum(1 for r in regs if r['geom'] and r['geom'].upper().startswith('POINT'))
    sem = sum(1 for r in regs if not r['geom'])
    anos = sorted({r['data_embargo'][:4] for r in regs if r['data_embargo']})
    return f'situação {sit}; polígono {com_poligono}, ponto {com_ponto}, sem geometria {sem}; anos {anos[:1]}…{anos[-1:]}'


# ── Autoteste (sem rede) ────────────────────────────────────────────────
def autoteste():
    base = {'UF': 'AC', 'SEQ_TAD': '1', 'NUM_TAD': 'ABC', 'SER_TAD': 'E', 'SIT_CANCELADO': 'N',
            'DAT_EMBARGO': '2024-05-02 10:00:00', 'QTD_AREA_EMBARGADA': '71,9994',
            'GEOM_AREA_EMBARGADA': 'MULTIPOLYGON (((-68 -10, -67.9 -10, -67.9 -9.9, -68 -10)))',
            'NOME_EMBARGADO': 'FULANO', 'CPF_CNPJ_EMBARGADO': '00000000000', 'MUNICIPIO': 'Xapuri'}
    r = ibama_linha(base)
    assert r['situacao'] == 'vigente' and r['area_ha'] == 71.9994 and r['data_embargo'] == '2024-05-02'
    assert 'FULANO' not in json.dumps(r) and '00000000000' not in json.dumps(r), 'dado pessoal vazou'
    assert ibama_linha({**base, 'UF': 'AM'}) is None
    assert ibama_linha({**base, 'SIT_CANCELADO': 'S'})['situacao'] == 'cancelado'
    assert ibama_linha({**base, 'DAT_DESEMBARGO': '2025-01-03'})['situacao'] == 'desembargado'
    assert ibama_linha({**base, 'DAT_EMBARGO': '2925-09-25'})['data_embargo'] is None
    # eixo trocado vira lon/lat; fora do Acre sem coordenada fica sem geometria
    trocado = ibama_linha({**base, 'GEOM_AREA_EMBARGADA': 'POLYGON ((-10 -68, -10 -67.9, -9.9 -67.9, -10 -68))'})
    assert trocado['geom'].startswith('POLYGON ((-68 -10'), trocado['geom']
    fora = ibama_linha({**base, 'GEOM_AREA_EMBARGADA': 'POLYGON ((-40 -5, -39 -5, -39 -4, -40 -5))'})
    assert fora['geom'] is None
    ponto = ibama_linha({**base, 'GEOM_AREA_EMBARGADA': '', 'NUM_LONGITUDE_TAD': '-68,5', 'NUM_LATITUDE_TAD': '-9,8'})
    assert ponto['geom'] == 'POINT(-68.5 -9.8)', ponto['geom']
    mapa, desc = imac_mapear(['N_TERMO', 'DATA', 'NOME_AUTUADO', 'CPF_CNPJ', 'MUNICIPIO', 'AREA_HA', 'SITUACAO', 'geometry'])
    assert mapa == {'num_termo': 'N_TERMO', 'data_embargo': 'DATA', 'situacao': 'SITUACAO',
                    'area_ha': 'AREA_HA', 'municipio': 'MUNICIPIO'}, mapa
    assert desc == ['NOME_AUTUADO', 'CPF_CNPJ']
    assert imac_situacao('Desembargado', None) == 'desembargado'
    assert imac_situacao(None, '2025-01-01') == 'desembargado'
    assert data_iso('03/02/2024') == '2024-02-03'
    print('autoteste ok')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--autoteste', action='store_true')
    ap.add_argument('--seco', action='store_true')
    ap.add_argument('--fonte', choices=['ibama', 'imac'])
    a = ap.parse_args()
    if a.autoteste:
        autoteste()
        return
    falhou = False
    for fonte, fn in (('ibama', ibama_baixar), ('imac', imac_baixar)):
        if a.fonte and a.fonte != fonte:
            continue
        try:
            regs = fn()
            print(f'[{fonte}] {resumo(regs)}')
            if not a.seco:
                gravar(fonte, regs)
        except Exception as e:  # noqa: BLE001 — uma fonte falhar não impede a outra
            falhou = True
            print(f'[{fonte}] FALHOU: {e}', file=sys.stderr)
            if not a.seco:
                registrar_falha(fonte, e)
    if falhou:
        sys.exit(1)


if __name__ == '__main__':
    main()
