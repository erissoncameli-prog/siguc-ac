#!/usr/bin/env python3
"""
sincronizar_uc_areas.py
=======================
Sincroniza o campo `area_ha` do uc_acre.geojson com os valores oficiais
registrados em uc_detalhes.json (fonte autoritativa: SNUC / ICMBio / SEMA-AC).

Regra de precedência:
  1. uc_detalhes.json  → fonte oficial (decreto de criação, SNUC, ICMBio)
  2. uc_acre.geojson   → fonte geométrica (cálculo sobre shapefile)

Quando os dois divergem, o detalhes sempre prevalece.
Quando o detalhes não tem o nome exato, tenta correspondência parcial.

Uso:
  python scripts/sincronizar_uc_areas.py [--dry-run] [--verbose]
"""

import json
import unicodedata
import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).parent.parent
GEO_PATH = ROOT / "data" / "uc_acre.geojson"
DET_PATH = ROOT / "data" / "uc_detalhes.json"

DIVERGENCIA_THRESHOLD = 0.01  # 1% — diferenças abaixo disso são arredondamento


def normalizar(s: str) -> str:
    """Remove acentos, ligatures e lowercases para comparação."""
    s = unicodedata.normalize("NFKD", s or "")
    s = "".join(c for c in s if not unicodedata.combining(c))
    return s.lower().strip()


def encontrar_det(nome: str, det_map: dict) -> tuple[str | None, dict | None]:
    """Retorna (chave_original, dados) do detalhes para o nome dado."""
    # 1. Match exato
    if nome in det_map:
        return nome, det_map[nome]
    # 2. Match normalizado
    nome_n = normalizar(nome)
    for k, v in det_map.items():
        if normalizar(k) == nome_n:
            return k, v
    # 3. Substring normalizado
    for k, v in det_map.items():
        if nome_n in normalizar(k) or normalizar(k) in nome_n:
            return k, v
    return None, None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true",
                        help="Apenas mostra o que seria alterado, sem salvar")
    parser.add_argument("--verbose", "-v", action="store_true",
                        help="Mostra todas as UCs, incluindo as OK")
    args = parser.parse_args()

    # ── Carregar arquivos (utf-8-sig suporta BOM e sem BOM) ───────
    with open(GEO_PATH, encoding="utf-8-sig") as f:
        geojson = json.load(f)
    with open(DET_PATH, encoding="utf-8-sig") as f:
        detalhes_raw = json.load(f)

    # Remover _meta
    det_map = {k: v for k, v in detalhes_raw.items() if k != "_meta"}

    # ── Processar features ────────────────────────────────────────
    alteracoes = []
    sem_match = []
    ok = []

    for feat in geojson["features"]:
        props = feat["properties"]
        nome = props.get("nome", "")
        area_geo = float(props.get("area_ha") or 0)

        chave_det, d = encontrar_det(nome, det_map)

        if d is None:
            sem_match.append(nome)
            continue

        area_det = float(d.get("area_ha") or 0)

        if area_det == 0:
            # Detalhes também não tem — não altera
            ok.append((nome, area_geo, area_det, "DET_ZERO"))
            continue

        if area_geo == 0:
            # GeoJSON zerado — corrige com o detalhes
            props["area_ha"] = area_det
            alteracoes.append((nome, area_geo, area_det, "ZERADO→CORRIGIDO"))
        elif abs(area_geo - area_det) / max(area_det, 1) > DIVERGENCIA_THRESHOLD:
            # Divergência significativa — prevalece o detalhes
            props["area_ha"] = area_det
            pct = (area_det - area_geo) / area_geo * 100
            alteracoes.append((nome, area_geo, area_det, f"DIVERGÊNCIA {pct:+.1f}%→CORRIGIDO"))
        else:
            # OK — mantém o valor do geojson (mais preciso geometricamente)
            ok.append((nome, area_geo, area_det, "OK"))

    # ── Relatório ─────────────────────────────────────────────────
    print(f"\n{'='*70}")
    print(f"  SINCRONIZAÇÃO uc_acre.geojson ← uc_detalhes.json")
    print(f"{'='*70}")

    if alteracoes:
        print(f"\n🔧 ALTERAÇÕES ({len(alteracoes)}):")
        print(f"  {'Nome':<45} {'GEO':>10} {'DET':>10}  STATUS")
        print(f"  {'-'*80}")
        for nome, geo, det, status in alteracoes:
            print(f"  {nome:<45} {geo:>10,.0f} {det:>10,.0f}  {status}")

    if sem_match:
        print(f"\n⚠ SEM CORRESPONDÊNCIA EM DETALHES ({len(sem_match)}):")
        for n in sem_match:
            print(f"  - {n}")

    if args.verbose and ok:
        print(f"\n✅ OK ({len(ok)}):")
        for nome, geo, det, status in ok:
            print(f"  {nome:<45} {geo:>10,.0f}  {status}")

    # Totais
    total_geo = sum(float(f["properties"].get("area_ha") or 0) for f in geojson["features"])
    total_det = sum(float(v.get("area_ha") or 0) for v in det_map.values())
    print(f"\n📊 TOTAIS APÓS SYNC:")
    print(f"  GeoJSON  : {total_geo:>12,.2f} ha  ({total_geo/1e6:.3f} M ha / {total_geo/16421980*100:.1f}% Acre)")
    print(f"  Detalhes : {total_det:>12,.2f} ha  ({total_det/1e6:.3f} M ha / {total_det/16421980*100:.1f}% Acre)")

    if not alteracoes:
        print("\n✅ Nenhuma alteração necessária — dados já sincronizados.")
        return

    # ── Salvar ───────────────────────────────────────────────────
    if args.dry_run:
        print(f"\n⚡ DRY-RUN: arquivo NÃO foi salvo.")
    else:
        with open(GEO_PATH, "w", encoding="utf-8", newline="\n") as f:
            json.dump(geojson, f, ensure_ascii=False, indent=2)
        print(f"\n💾 Arquivo salvo: {GEO_PATH.name}")
        print(f"   {len(alteracoes)} UC(s) corrigida(s).")

    print()


if __name__ == "__main__":
    main()
