import json, os

base = os.path.join(os.path.dirname(__file__), '..', 'data')

with open(os.path.join(base, 'uc_acre.geojson'), encoding='utf-8') as f:
    uc = json.load(f)
with open(os.path.join(base, 'uc_zonas_acre.geojson'), encoding='utf-8') as f:
    zonas = json.load(f)

nomes_uc    = sorted(set(ft['properties'].get('nome','') for ft in uc['features']))
nomes_zonas = sorted(set(ft['properties'].get('uc_nome','') for ft in zonas['features']))

print("=== uc_acre.geojson (nomes das UCs) ===")
for n in nomes_uc: print(" ", repr(n))

print("\n=== uc_zonas_acre.geojson (uc_nome) ===")
for n in nomes_zonas: print(" ", repr(n))

print("\n=== Zonas SEM match em uc_acre ===")
for n in nomes_zonas:
    if n not in nomes_uc:
        print("  ZONA:", repr(n))
        candidatos = [u for u in nomes_uc if any(w in u for w in n.split()[:3])]
        if candidatos:
            print("    -> candidatos:", candidatos)
