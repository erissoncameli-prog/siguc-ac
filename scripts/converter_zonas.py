"""
Converte shapefiles de zonas das UCs (SAD69 UTM 19S) para GeoJSON WGS84.
Gera: data/uc_zonas_acre.geojson
Uso: py scripts/converter_zonas.py
"""
import os, json, shapefile
from pyproj import Transformer

BASE = r"C:\Users\eriss\OneDrive\Documents\OneDrive\Documents\Dima OneDrive\Gestão de UCs\Gestão Florestal na Amazônia Legal"
OUT  = os.path.join(os.path.dirname(__file__), '..', 'data', 'uc_zonas_acre.geojson')

# Reprojeção: SAD69 UTM 19S → WGS84
# EPSG:29189 = SAD69 / UTM zone 19S
transformer = Transformer.from_crs("EPSG:29189", "EPSG:4326", always_xy=True)

# Mapeamento: prefixo do arquivo → metadados da zona
ZONA_MAP = {
    'zona_amortecimento': {'codigo': 'ZOA', 'nome': 'Zona de Amortecimento',       'cor': '#fbbf24'},
    'zona_conservacao':   {'codigo': 'ZOC', 'nome': 'Zona de Conservação',         'cor': '#166534'},
    'zona_extrativismo':  {'codigo': 'ZEX', 'nome': 'Zona de Extrativismo',        'cor': '#15803d'},
    'zona_producao':      {'codigo': 'ZPR', 'nome': 'Zona de Produção',            'cor': '#0891b2'},
    'zona_populacional':  {'codigo': 'ZPO', 'nome': 'Zona Populacional',           'cor': '#7c3aed'},
    'zona_uso_especial':  {'codigo': 'ZUE', 'nome': 'Zona de Uso Especial',        'cor': '#db2777'},
    'zona_uso_publico':   {'codigo': 'ZUP', 'nome': 'Zona de Uso Público',         'cor': '#ea580c'},
    'zona_uso_conflitante':{'codigo':'ZUC', 'nome': 'Zona de Uso Conflitante',     'cor': '#dc2626'},
}

# Mapeamento de pasta → nome oficial da UC
UC_NOMES = {
    '1_Floresta_Estadual_Rio_Gregorio':  'Floresta Estadual do Rio Gregório',
    '2_Floresta_Estadual_Mogno':         'Floresta Estadual do Mogno',
    '3_Floresta_Estadual_Rio_Liberdade': 'Floresta Estadual do Rio Liberdade',
    'Apa_LagodoAmapa':                   'APA Lago do Amapá',
    'APA_Sao_Francisco':                 'APA São Francisco',
    'Plano_Gestor_Antimary':             'Floresta Estadual do Antimary',
    'UGAIs':                             'UGAIs',
}

def detectar_zona(nome_arquivo):
    """Retorna metadados da zona com base no nome do arquivo."""
    n = nome_arquivo.lower()
    for prefixo, meta in ZONA_MAP.items():
        if prefixo in n:
            return meta
    return None

def reprojetar_ring(coords):
    """Converte lista de [x,y] UTM para [lon,lat] WGS84."""
    result = []
    for pt in coords:
        lon, lat = transformer.transform(pt[0], pt[1])
        result.append([round(lon, 6), round(lat, 6)])
    return result

def shp_para_features(caminho_shp, uc_nome, meta_zona):
    """Lê um shapefile e retorna lista de features GeoJSON."""
    features = []
    try:
        sf = shapefile.Reader(caminho_shp, encoding='latin-1')
        fields = [f[0] for f in sf.fields[1:]]
        for sr in sf.shapeRecords():
            shape = sr.shape
            record = dict(zip(fields, sr.record))
            # Apenas polígonos
            if shape.shapeType not in (5, 15, 25):  # POLYGON types
                continue
            parts = list(shape.parts) + [len(shape.points)]
            rings = []
            for i in range(len(parts) - 1):
                ring = [[p[0], p[1]] for p in shape.points[parts[i]:parts[i+1]]]
                rings.append(reprojetar_ring(ring))
            if not rings:
                continue
            # Propriedades: mistura dos atributos do shape + metadados da zona
            props = {
                'uc_nome':    uc_nome,
                'zona_codigo': meta_zona['codigo'],
                'zona_nome':   meta_zona['nome'],
                'cor':         meta_zona['cor'],
            }
            # Adiciona campos do shapefile que sejam úteis
            for k, v in record.items():
                if v and k.lower() not in ('fid', 'objectid', 'shape_area', 'shape_leng'):
                    props[k.lower()] = str(v).strip() if isinstance(v, str) else v
            features.append({
                'type': 'Feature',
                'geometry': {'type': 'Polygon', 'coordinates': rings},
                'properties': props
            })
    except Exception as e:
        print(f'  ERRO ao ler {caminho_shp}: {e}')
    return features

def main():
    todas_features = []
    total_shp = 0

    for pasta_uc in sorted(os.listdir(BASE)):
        uc_dir = os.path.join(BASE, pasta_uc)
        if not os.path.isdir(uc_dir):
            continue
        uc_nome = UC_NOMES.get(pasta_uc, pasta_uc)
        print(f'\n[UC] {uc_nome}')

        # Busca shapefiles de zonas (recursivo)
        for root, dirs, files in os.walk(uc_dir):
            for f in sorted(files):
                if not f.endswith('.shp'):
                    continue
                # Apenas shapefiles de zonas (não vértices, lotes, hidrografia, etc.)
                nome_lower = f.lower()
                if any(skip in nome_lower for skip in ('vertices_', 'lotes_', 'hidrografia', 'perimetro', 'imoveis', 'propriedades', 'vegetacao', 'geologia', 'geomorfologia', 'solos', 'curva_nivel', 'pontes', 'ramais', 'sitios', 'assentamento', 'projeto_', 'ugais')):
                    continue
                meta = detectar_zona(nome_lower)
                if not meta:
                    continue
                shp_path = os.path.join(root, f)
                feats = shp_para_features(shp_path, uc_nome, meta)
                if feats:
                    print(f'  ✓ {f} → {len(feats)} polígono(s) [{meta["codigo"]}]')
                    todas_features.extend(feats)
                    total_shp += 1
                else:
                    print(f'  ○ {f} → sem polígonos')

    geojson = {
        'type': 'FeatureCollection',
        'crs': {'type': 'name', 'properties': {'name': 'urn:ogc:def:crs:OGC:1.3:CRS84'}},
        'features': todas_features
    }

    os.makedirs(os.path.dirname(os.path.abspath(OUT)), exist_ok=True)
    with open(OUT, 'w', encoding='utf-8') as fp:
        json.dump(geojson, fp, ensure_ascii=False, separators=(',', ':'))

    print(f'\n✅ {total_shp} shapefile(s) processado(s)')
    print(f'✅ {len(todas_features)} features no total')
    print(f'✅ Salvo em: {os.path.abspath(OUT)}')

if __name__ == '__main__':
    main()
