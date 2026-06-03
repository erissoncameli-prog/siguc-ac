"""
Converte shapefiles de zonas das UCs para GeoJSON WGS84.
Detecta automaticamente a projecao de cada arquivo via .prj.
Gera: data/uc_zonas_acre.geojson
Uso: py scripts/converter_zonas.py
"""
import os, json, re, shapefile
from pyproj import Transformer, CRS

BASE = r"C:\Users\eriss\OneDrive\Documents\OneDrive\Documents\Dima OneDrive\Gestão de UCs\Gestão Florestal na Amazônia Legal"
OUT  = os.path.join(os.path.dirname(__file__), '..', 'data', 'uc_zonas_acre.geojson')

# Cache de transformers por EPSG de origem
_transformers = {}

def get_transformer(epsg_src):
    if epsg_src not in _transformers:
        _transformers[epsg_src] = Transformer.from_crs(f"EPSG:{epsg_src}", "EPSG:4326", always_xy=True)
    return _transformers[epsg_src]

def detectar_epsg_do_prj(prj_path):
    """Lê o .prj e retorna o EPSG de origem."""
    try:
        with open(prj_path, encoding='utf-8', errors='ignore') as f:
            wkt = f.read()
        crs = CRS.from_wkt(wkt)
        epsg = crs.to_epsg()
        if epsg:
            return epsg
    except Exception:
        pass
    # Fallback manual pelo texto do .prj
    with open(prj_path, encoding='utf-8', errors='ignore') as f:
        wkt = f.read()
    if 'WGS_1984' in wkt and 'UTM_Zone_19S' in wkt:
        return 32719
    if 'SAD_1969' in wkt and 'UTM_Zone_19S' in wkt:
        return 29189
    if 'SAD_1969' in wkt and 'UTM_Zone_18S' in wkt:
        return 29188
    return 29189  # default SAD69 UTM 19S

# Mapeamento de codigo_de_zona → metadados
ZONA_META_MAP = {
    'ZI':  {'codigo': 'ZI',  'nome': 'Zona Intangível',             'cor': '#7f1d1d'},
    'ZP':  {'codigo': 'ZP',  'nome': 'Zona Primitiva',              'cor': '#14532d'},
    'ZOA': {'codigo': 'ZOA', 'nome': 'Zona de Amortecimento',       'cor': '#fbbf24'},
    'ZOC': {'codigo': 'ZOC', 'nome': 'Zona de Conservação',         'cor': '#166534'},
    'ZEX': {'codigo': 'ZEX', 'nome': 'Zona de Extrativismo',        'cor': '#15803d'},
    'ZPR': {'codigo': 'ZPR', 'nome': 'Zona de Produção',            'cor': '#0891b2'},
    'ZPO': {'codigo': 'ZPO', 'nome': 'Zona Populacional',           'cor': '#7c3aed'},
    'ZUE': {'codigo': 'ZUE', 'nome': 'Zona de Uso Especial',        'cor': '#db2777'},
    'ZUP': {'codigo': 'ZUP', 'nome': 'Zona de Uso Público',         'cor': '#ea580c'},
    'ZUC': {'codigo': 'ZUC', 'nome': 'Zona de Uso Conflitante',     'cor': '#dc2626'},
    'ZOT': {'codigo': 'ZOT', 'nome': 'Zona de Ocupacao Temporaria', 'cor': '#9333ea'},
}

# Mapeamento: prefixo do nome do arquivo → código de zona (para UCs com arquivos separados por zona)
NOME_ARQUIVO_ZONA = {
    'zona_amortecimento':    'ZOA',
    'zona_conservacao':      'ZOC',
    'zona_extrativismo':     'ZEX',
    'zona_producao':         'ZPR',
    'zona_populacional':     'ZPO',
    'zona_uso_especial':     'ZUE',
    'zona_uso_publico':      'ZUP',
    'zona_uso_conflitante':  'ZUC',
}

# UCs cujo shapefile tem TODAS as zonas em um único arquivo
# Formato: { pasta_uc: { 'shp': 'nome_arquivo.shp', 'campo_tipo': 'campo_no_dbf', 'uc_nome': '...' } }
UC_ARQUIVO_UNICO = {
    'Parque Estadual Chandless': {
        'shp':        os.path.join('DADOS RENOMEADOS', 'zoneamento5.shp'),
        'campo_tipo': 'Tipo_Zonea',
        'uc_nome':    'Parque Estadual Chandless',
    },
}

# Mapeamento de pasta → nome oficial da UC (para UCs com arquivos separados por zona)
UC_NOMES = {
    '1_Floresta_Estadual_Rio_Gregorio':  'Floresta Estadual do Rio Gregório',
    '2_Floresta_Estadual_Mogno':         'Floresta Estadual do Mogno',
    '3_Floresta_Estadual_Rio_Liberdade': 'Floresta Estadual do Rio Liberdade',
    'Apa_LagodoAmapa':                   'APA Lago do Amapá',
    'APA_Sao_Francisco':                 'APA São Francisco',
    'Plano_Gestor_Antimary':             'Floresta Estadual do Antimary',
    'UGAIs':                             'UGAIs',
}

SKIP_PATTERNS = ('vertices_', 'lotes_', 'hidrografia', 'perimetro', 'imoveis',
                 'propriedades', 'vegetacao', 'geologia', 'geomorfologia', 'solos',
                 'curva_nivel', 'pontes', 'ramais', 'sitios', 'assentamento',
                 'projeto_', 'ugais')

def detectar_zona_por_nome(nome_arquivo):
    n = nome_arquivo.lower()
    for prefixo, cod in NOME_ARQUIVO_ZONA.items():
        if prefixo in n:
            return ZONA_META_MAP[cod]
    return None

def reprojetar_ring(ring_pts, transformer):
    result = []
    for pt in ring_pts:
        lon, lat = transformer.transform(pt[0], pt[1])
        result.append([round(lon, 6), round(lat, 6)])
    return result

def shp_para_features_fixo(caminho_shp, uc_nome, meta_zona, transformer):
    """Arquivo com uma única zona — usa meta_zona fixo."""
    features = []
    try:
        sf = shapefile.Reader(caminho_shp, encoding='latin-1')
        fields = [f[0] for f in sf.fields[1:]]
        for sr in sf.shapeRecords():
            shape = sr.shape
            record = dict(zip(fields, sr.record))
            if shape.shapeType not in (5, 15, 25):
                continue
            parts = list(shape.parts) + [len(shape.points)]
            rings = [reprojetar_ring([[p[0], p[1]] for p in shape.points[parts[i]:parts[i+1]]], transformer)
                     for i in range(len(parts) - 1)]
            if not rings:
                continue
            props = {
                'uc_nome':     uc_nome,
                'zona_codigo': meta_zona['codigo'],
                'zona_nome':   meta_zona['nome'],
                'cor':         meta_zona['cor'],
            }
            for k, v in record.items():
                if v and k.lower() not in ('fid', 'objectid', 'shape_area', 'shape_leng'):
                    props[k.lower()] = str(v).strip() if isinstance(v, str) else v
            features.append({'type': 'Feature',
                              'geometry': {'type': 'Polygon', 'coordinates': rings},
                              'properties': props})
    except Exception as e:
        print(f'  ERRO em {os.path.basename(caminho_shp)}: {e}')
    return features

def shp_para_features_multi(caminho_shp, uc_nome, campo_tipo, transformer):
    """Arquivo com múltiplas zonas — lê o tipo de cada feature pelo campo."""
    features = []
    try:
        sf = shapefile.Reader(caminho_shp, encoding='latin-1')
        fields = [f[0] for f in sf.fields[1:]]
        for sr in sf.shapeRecords():
            shape = sr.shape
            record = dict(zip(fields, sr.record))
            if shape.shapeType not in (5, 15, 25):
                continue
            cod = str(record.get(campo_tipo, '')).strip().upper()
            meta = ZONA_META_MAP.get(cod)
            if not meta:
                print(f'  AVISO: tipo de zona desconhecido "{cod}" — ignorado')
                continue
            parts = list(shape.parts) + [len(shape.points)]
            rings = [reprojetar_ring([[p[0], p[1]] for p in shape.points[parts[i]:parts[i+1]]], transformer)
                     for i in range(len(parts) - 1)]
            if not rings:
                continue
            # Nome legivel da zona (campo Area_Zona se disponivel)
            zona_nome_raw = str(record.get('Area_Zona', meta['nome'])).strip()
            # Limpa caracteres mal decodificados com substituicoes comuns
            zona_nome = (zona_nome_raw
                         .replace('\xc3\xa7\xc3\xa3', 'ção')
                         .replace('vel', 'vel'))
            props = {
                'uc_nome':     uc_nome,
                'zona_codigo': meta['codigo'],
                'zona_nome':   meta['nome'],
                'cor':         meta['cor'],
                'zoneamento':  str(record.get('Zoneamento', '')).strip(),
                'hectares':    record.get('Hectares'),
            }
            features.append({'type': 'Feature',
                              'geometry': {'type': 'Polygon', 'coordinates': rings},
                              'properties': props})
    except Exception as e:
        print(f'  ERRO em {os.path.basename(caminho_shp)}: {e}')
    return features

def main():
    todas_features = []
    total_shp = 0

    # ── UCs com arquivo único de zoneamento ───────────────────────────────────
    for pasta_uc, cfg in UC_ARQUIVO_UNICO.items():
        uc_dir = os.path.join(BASE, pasta_uc)
        if not os.path.isdir(uc_dir):
            print(f'\n[UC] {cfg["uc_nome"]} -- pasta nao encontrada, ignorado')
            continue
        shp_path = os.path.join(uc_dir, cfg['shp'])
        prj_path = shp_path.replace('.shp', '.prj')
        epsg = detectar_epsg_do_prj(prj_path) if os.path.exists(prj_path) else 29189
        transformer = get_transformer(epsg)
        print(f'\n[UC] {cfg["uc_nome"]} (EPSG:{epsg}, arquivo unico)')
        feats = shp_para_features_multi(shp_path, cfg['uc_nome'], cfg['campo_tipo'], transformer)
        if feats:
            from collections import Counter
            tipos = Counter(f['properties']['zona_codigo'] for f in feats)
            print(f'  + {os.path.basename(shp_path)} -> {len(feats)} poligono(s) {dict(tipos)}')
            todas_features.extend(feats)
            total_shp += 1
        else:
            print(f'  - sem poligonos')

    # ── UCs com arquivos separados por zona ───────────────────────────────────
    for pasta_uc in sorted(os.listdir(BASE)):
        if pasta_uc in UC_ARQUIVO_UNICO:
            continue
        uc_dir = os.path.join(BASE, pasta_uc)
        if not os.path.isdir(uc_dir):
            continue
        uc_nome = UC_NOMES.get(pasta_uc, pasta_uc)
        print(f'\n[UC] {uc_nome}')

        for root, dirs, files in os.walk(uc_dir):
            for f in sorted(files):
                if not f.endswith('.shp'):
                    continue
                nome_lower = f.lower()
                if any(skip in nome_lower for skip in SKIP_PATTERNS):
                    continue
                meta = detectar_zona_por_nome(nome_lower)
                if not meta:
                    continue
                shp_path = os.path.join(root, f)
                prj_path = shp_path.replace('.shp', '.prj')
                epsg = detectar_epsg_do_prj(prj_path) if os.path.exists(prj_path) else 29189
                transformer = get_transformer(epsg)
                feats = shp_para_features_fixo(shp_path, uc_nome, meta, transformer)
                if feats:
                    print(f'  + {f} -> {len(feats)} poligono(s) [{meta["codigo"]}] (EPSG:{epsg})')
                    todas_features.extend(feats)
                    total_shp += 1
                else:
                    print(f'  - {f} -> sem poligonos')

    geojson = {
        'type': 'FeatureCollection',
        'crs': {'type': 'name', 'properties': {'name': 'urn:ogc:def:crs:OGC:1.3:CRS84'}},
        'features': todas_features,
    }

    os.makedirs(os.path.dirname(os.path.abspath(OUT)), exist_ok=True)
    with open(OUT, 'w', encoding='utf-8') as fp:
        json.dump(geojson, fp, ensure_ascii=False, separators=(',', ':'))

    print(f'\nOK: {total_shp} shapefile(s) processado(s)')
    print(f'OK: {len(todas_features)} features no total')
    print(f'OK: Salvo em: {os.path.abspath(OUT)}')

if __name__ == '__main__':
    main()
