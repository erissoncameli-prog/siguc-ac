"""
importar_focos_calor.py
=======================
Importa focos de calor históricos do Acre para o Supabase.
Fonte: FIRMS NASA (MODIS + VIIRS SNPP)
Período: julho-outubro de cada ano (pico de queimadas no Acre)
Cobertura: MODIS 2001-2024 | VIIRS SNPP 2012-2024

Uso:
  python importar_focos_calor.py

Requisitos:
  pip install requests pandas
"""

import requests
import pandas as pd
import time
import math
from datetime import date, timedelta
from io import StringIO

# ── Configurações ─────────────────────────────────────────────────────────
FIRMS_KEY    = '66690c20b8bf3f13bb21f8706e3a75d5'
FIRMS_BASE   = 'https://firms.modaps.eosdis.nasa.gov/api/area/csv'
BBOX_ACRE    = '-74,-11,-66,-7'   # lon_min,lat_min,lon_max,lat_max
DIAS_REQ     = 5                  # máximo permitido pela API

SUPABASE_URL = 'https://atqtybcsvepdabsvgaly.supabase.co'

# Leia a anon key do config.js ou defina aqui
# Atenção: precisamos de permissão de escrita.
# Como focos_write exige super_admin, usaremos INSERT direto via execute_sql
# via service_role. Aqui usaremos a anon key com política temporária.
ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF0cXR5YmNzdmVwZGFic3ZnYWx5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA0MjMzNzgsImV4cCI6MjA5NTk5OTM3OH0.hWx1AB2rK7xdco1Dgagm0XUOBPQbxZVE614SW4SKoLk'

# Meses do pico de queimadas no Acre (julho=7 a outubro=10)
MESES_FOGO = [7, 8, 9, 10]

# Fontes e anos de cobertura
FONTES = [
    ('MODIS_SP',      2001, 2024),
    ('VIIRS_SNPP_SP', 2012, 2024),
]

BATCH_INSERT = 500   # linhas por insert no Supabase
DELAY_REQ    = 0.3   # segundos entre requests à API

# ── Helpers ────────────────────────────────────────────────────────────────
def datas_do_mes(ano, mes):
    """Retorna lista de datas de início de cada janela de 5 dias no mês."""
    d = date(ano, mes, 1)
    ultimo = date(ano, mes, 28) + timedelta(days=4)
    ultimo = date(ano, mes+1 if mes < 12 else 1, 1) - timedelta(days=1)
    datas = []
    while d <= ultimo:
        datas.append(d)
        d += timedelta(days=DIAS_REQ)
    return datas

def fetch_firms(source, bbox, dias, start_date):
    """Busca dados FIRMS e retorna DataFrame ou None."""
    url = f'{FIRMS_BASE}/{FIRMS_KEY}/{source}/{bbox}/{dias}/{start_date}'
    try:
        r = requests.get(url, timeout=30)
        if r.status_code != 200:
            return None
        if not r.text.strip() or r.text.startswith('<!'):
            return None
        df = pd.read_csv(StringIO(r.text))
        if df.empty:
            return None
        # Filtra só fogos em vegetação (type=0)
        if 'type' in df.columns:
            df = df[df['type'] == 0]
        return df
    except Exception as e:
        print(f'  ERRO fetch: {e}')
        return None

def normalizar(df, source):
    """Normaliza colunas de MODIS e VIIRS para formato padrão."""
    rows = []
    src_label = 'MODIS' if 'MODIS' in source else 'VIIRS_SNPP'
    for _, r in df.iterrows():
        try:
            acq = str(r.get('acq_date', ''))[:10]
            if not acq or len(acq) < 10:
                continue
            dt = date.fromisoformat(acq)
            conf = str(r.get('confidence', ''))
            rows.append({
                'lat':        round(float(r['latitude']),  5),
                'lon':        round(float(r['longitude']), 5),
                'acq_date':   acq,
                'ano':        dt.year,
                'mes':        dt.month,
                'satellite':  str(r.get('satellite', '')),
                'source':     src_label,
                'confidence': conf,
                'frp':        float(r['frp']) if pd.notna(r.get('frp')) else None,
                'daynight':   str(r.get('daynight', ''))[:1] or None,
            })
        except Exception:
            continue
    return rows

def inserir_supabase(rows, headers):
    """Insere linhas no Supabase em lotes (INSERT simples, sem upsert)."""
    if not rows:
        return 0
    ok = 0
    for i in range(0, len(rows), BATCH_INSERT):
        batch = rows[i:i+BATCH_INSERT]
        r = requests.post(
            f'{SUPABASE_URL}/rest/v1/focos_calor_ac',
            json=batch,
            headers={**headers, 'Prefer': 'return=minimal'},
            timeout=60
        )
        if r.status_code in (200, 201, 204):
            ok += len(batch)
        elif r.status_code == 409:
            # Conflito de chave única — insere um a um saltando duplicatas
            for row in batch:
                rr = requests.post(
                    f'{SUPABASE_URL}/rest/v1/focos_calor_ac',
                    json=[row],
                    headers={**headers, 'Prefer': 'return=minimal'},
                    timeout=15
                )
                if rr.status_code in (200, 201, 204):
                    ok += 1
        else:
            print(f'  INSERT ERRO {r.status_code}: {r.text[:150]}')
    return ok

# ── Main ───────────────────────────────────────────────────────────────────
def main():
    headers = {
        'apikey':        ANON_KEY,
        'Authorization': f'Bearer {ANON_KEY}',
        'Content-Type':  'application/json',
    }

    # Conta registros já existentes
    r = requests.get(f'{SUPABASE_URL}/rest/v1/focos_calor_ac?select=id&limit=1',
                     headers=headers)
    print(f'Registros existentes no banco: verificar via SQL')

    total_inseridos = 0
    total_requests  = 0

    for (source, ano_ini, ano_fim) in FONTES:
        print(f'\n{"="*60}')
        print(f'Fonte: {source} | Anos: {ano_ini}–{ano_fim}')
        print(f'{"="*60}')

        for ano in range(ano_ini, ano_fim + 1):
            focos_ano = []
            for mes in MESES_FOGO:
                datas = datas_do_mes(ano, mes)
                for d in datas:
                    df = fetch_firms(source, BBOX_ACRE, DIAS_REQ, d.isoformat())
                    total_requests += 1
                    if df is not None and not df.empty:
                        rows = normalizar(df, source)
                        focos_ano.extend(rows)
                    time.sleep(DELAY_REQ)

            if focos_ano:
                # Remove duplicatas locais antes de inserir
                seen = set()
                uniq = []
                for row in focos_ano:
                    key = (row['lat'], row['lon'], row['acq_date'], row['source'])
                    if key not in seen:
                        seen.add(key)
                        uniq.append(row)

                n = inserir_supabase(uniq, headers)
                total_inseridos += n
                print(f'  {ano}: {len(uniq)} focos unicos -> {n} inseridos')
            else:
                print(f'  {ano}: 0 focos')

    print(f'\n{"="*60}')
    print(f'CONCLUIDO: {total_inseridos} focos inseridos | {total_requests} requests')
    print(f'{"="*60}')

if __name__ == '__main__':
    main()
