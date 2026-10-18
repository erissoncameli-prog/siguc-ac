"""
Converte o shapefile dos Projetos de Assentamento federais do INCRA/AC
(Acervo Fundiário) em data/assentamentos_acre.geojson, lido pela seção
"Projetos de Assentamento" da guia Áreas Territoriais do Mapa das UCs.

Uso:  python scripts/assentamentos_geojson.py <pasta-ou-.shp> [--autoteste]
      (precisa de: pip install pyshp shapely)

O que faz:
- lê em latin-1 (o .dbf do INCRA vem assim) e confere SIRGAS 2000 no .prj
  — SIRGAS 2000 e WGS 84 diferem em centímetros, então não há reprojeção;
- corrige polígono inválido com make_valid (registra quantos);
- grava coordenadas com 5 casas (~1 m), suficiente para o mapa;
- modalidade (PA, PAE, PDS, PAF…) vem do prefixo do nome do projeto;
- fase numérica do SIPRA vira o rótulo oficial (3 a 7);
- datas dd/mm/aaaa viram aaaa-mm-dd;
- mantém as DUAS áreas: a do ato de criação (area_hecta, texto) e a do
  polígono (area_calc_) — divergem bastante em alguns PAs e a tela mostra
  as duas, nunca escolhe uma em silêncio.
Não há dado pessoal no arquivo (só o projeto), então não entra no ROPA.
"""
import json, os, re, sys
from datetime import date

FASES = {
    1: 'Pré-projeto', 2: 'Em obtenção', 3: 'Criado', 4: 'Em instalação',
    5: 'Em estruturação', 6: 'Em consolidação', 7: 'Consolidado',
}
MODALIDADES = {
    'PA': 'Projeto de Assentamento',
    'PAE': 'Projeto de Assentamento Agroextrativista',
    'PDS': 'Projeto de Desenvolvimento Sustentável',
    'PAF': 'Projeto de Assentamento Florestal',
}
CASAS = 5


def data_iso(s):
    m = re.match(r'^\s*(\d{2})/(\d{2})/(\d{4})\s*$', s or '')
    if not m:
        return None
    d, mth, a = map(int, m.groups())
    try:
        return date(a, mth, d).isoformat()
    except ValueError:
        return None


def numero(v):
    if v is None:
        return None
    try:
        x = float(str(v).strip().replace(',', '.'))
    except ValueError:
        return None
    return round(x, 2)


def modalidade(nome):
    pre = (nome or '').strip().split(' ', 1)[0].upper()
    return pre if pre in MODALIDADES else 'Outro'


def nome_sem_prefixo(nome):
    nome = (nome or '').strip()
    pre, _, resto = nome.partition(' ')
    return resto.strip() if pre.upper() in MODALIDADES and resto.strip() else nome


def propriedades(rec):
    nome = (rec.get('nome_proje') or '').strip()
    fase = rec.get('fase')
    try:
        fase = int(fase) if fase not in (None, '') else None
    except (TypeError, ValueError):
        fase = None
    return {
        'cd_sipra': (rec.get('cd_sipra') or '').strip() or None,
        'nome': nome_sem_prefixo(nome),
        'nome_completo': nome,
        'modalidade': modalidade(nome),
        'municipio': (rec.get('municipio') or '').strip().title() or None,
        'area_ato_ha': numero(rec.get('area_hecta')),
        'area_poligono_ha': numero(rec.get('area_calc_')),
        'capacidade': rec.get('capacidade') or None,
        'familias': rec.get('num_famili') if rec.get('num_famili') is not None else None,
        'fase': fase,
        'fase_nome': FASES.get(fase),
        'criado_em': data_iso(rec.get('data_de_cr')),
        'forma_obtencao': (rec.get('forma_obte') or '').strip() or None,
        'obtido_em': data_iso(rec.get('data_obten')),
    }


def arredondar(coords):
    if isinstance(coords[0], (int, float)):
        return [round(coords[0], CASAS), round(coords[1], CASAS)]
    return [arredondar(c) for c in coords]


def converter(caminho_shp):
    import shapefile
    from shapely.geometry import shape, mapping
    from shapely.validation import make_valid

    base = caminho_shp[:-4] if caminho_shp.lower().endswith('.shp') else caminho_shp
    prj = base + '.prj'
    if os.path.exists(prj):
        txt = open(prj, encoding='latin-1').read().upper()
        if 'SIRGAS' not in txt and 'WGS' not in txt:
            raise SystemExit(f'.prj não é SIRGAS 2000/WGS 84 — reprojetar antes: {txt[:80]}')
    r = shapefile.Reader(base, encoding='latin-1')
    feats, corrigidos = [], 0
    for sr in r.iterShapeRecords():
        g = shape(sr.shape.__geo_interface__)
        if g.is_empty:
            continue
        if not g.is_valid:
            g = make_valid(g)
            corrigidos += 1
        geo = mapping(g)
        feats.append({
            'type': 'Feature',
            'properties': propriedades(sr.record.as_dict()),
            'geometry': {'type': geo['type'], 'coordinates': arredondar(geo['coordinates'])},
        })
    feats.sort(key=lambda f: (f['properties']['cd_sipra'] or '', f['properties']['nome']))
    return {
        'type': 'FeatureCollection',
        'metadata': {
            'fonte': 'INCRA — Acervo Fundiário (Projetos de Assentamento federais, AC)',
            'recebido_em': '2026-10-07',
            'gerado_em': date.today().isoformat(),
            'total': len(feats),
            'poligonos_corrigidos': corrigidos,
        },
        'features': feats,
    }, corrigidos


def autoteste():
    p = propriedades({'cd_sipra': 'AC0028000 ', 'nome_proje': 'PAE CHICO MENDES', 'municipio': 'XAPURI',
                      'area_hecta': '24243.1038', 'area_calc_': 24259.4465, 'capacidade': 88,
                      'num_famili': 80, 'fase': 7, 'data_de_cr': '08/03/1989',
                      'forma_obte': 'Desapropriação', 'data_obten': '31/02/1988'})
    assert p['modalidade'] == 'PAE' and p['nome'] == 'CHICO MENDES', p
    assert p['municipio'] == 'Xapuri' and p['fase_nome'] == 'Consolidado'
    assert p['criado_em'] == '1989-03-08' and p['obtido_em'] is None   # data inexistente não vira data
    assert p['area_ato_ha'] == 24243.1 and p['area_poligono_ha'] == 24259.45
    assert modalidade('ASSENTAMENTO X') == 'Outro' and nome_sem_prefixo('PA') == 'PA'
    assert propriedades({'nome_proje': 'PA X', 'num_famili': 0})['familias'] == 0  # zero não some
    assert arredondar([[-68.1234567, -9.7654321]]) == [[-68.12346, -9.76543]]
    print('autoteste ok')


if __name__ == '__main__':
    if '--autoteste' in sys.argv:
        autoteste()
        sys.exit(0)
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    alvo = sys.argv[1]
    if os.path.isdir(alvo):
        shp = [f for f in os.listdir(alvo) if f.lower().endswith('.shp')]
        if len(shp) != 1:
            raise SystemExit(f'esperava 1 .shp em {alvo}, achei {shp}')
        alvo = os.path.join(alvo, shp[0])
    gj, corr = converter(alvo)
    saida = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data', 'assentamentos_acre.geojson')
    with open(saida, 'w', encoding='utf-8') as f:
        json.dump(gj, f, ensure_ascii=False, separators=(',', ':'))
    print(f"{gj['metadata']['total']} assentamentos, {corr} polígono(s) corrigido(s) → {os.path.normpath(saida)} "
          f"({os.path.getsize(saida)/1024:.0f} KB)")
