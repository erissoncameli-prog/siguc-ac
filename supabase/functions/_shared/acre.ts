// ═══════════════════════════════════════════════════════════
// SIGUC-AC · Recorte pelo limite do Acre — Edge Functions
// ═══════════════════════════════════════════════════════════
// FIRMS e DETER só aceitam consulta por BOUNDING BOX, e um retângulo
// em volta do Acre engloba pedaços do Amazonas, de Rondônia, de
// Ucayali (Peru) e de Pando (Bolívia). Antes deste filtro, 31% dos
// focos FIRMS e 29% dos alertas DETER gravados não eram do Acre.
//
// Este módulo é a filtragem NA ORIGEM. A garantia dura está no banco
// (migration 239: trigger BEFORE INSERT que descarta ponto fora do
// estado, valendo para qualquer rota de ingestão). Aqui o valor é
// outro: não gastar escrita com dado que será descartado, e fazer os
// contadores devolvidos pelas funções dizerem a verdade.
//
// Fonte do polígono: o MESMO arquivo que o mapa usa
// (data/acre_estado.geojson, servido em produção), para que servidor
// e navegador nunca discordem sobre onde fica a divisa.
//
// FAIL-OPEN: se o arquivo não puder ser buscado, noAcre() devolve
// true e nada é filtrado aqui — a trigger do banco continua barrando.
// Ingestão nunca deve parar por causa de um recorte indisponível.
// ═══════════════════════════════════════════════════════════

const URL_LIMITE = Deno.env.get('ACRE_GEOJSON_URL')
  ?? 'https://siguc-ac.vercel.app/data/acre_estado.geojson'

type Anel = { ring: number[][]; minX: number; minY: number; maxX: number; maxY: number }

let _aneis: Anel[] | null = null
let _tentado = false

function indexar(geom: any): Anel[] {
  if (!geom) return []
  const aneis: number[][][] = geom.type === 'Polygon' ? geom.coordinates
    : geom.type === 'MultiPolygon' ? geom.coordinates.flat(1)
    : []
  return aneis.filter(r => Array.isArray(r) && r.length > 2).map(ring => {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const c of ring) {
      if (c[0] < minX) minX = c[0]
      if (c[0] > maxX) maxX = c[0]
      if (c[1] < minY) minY = c[1]
      if (c[1] > maxY) maxY = c[1]
    }
    return { ring, minX, minY, maxX, maxY }
  })
}

// Ray-casting com paridade entre anéis (buraco de polígono conta como
// fora) — mesma implementação de js/mapa-recorte.js no cliente.
function pip(x: number, y: number, aneis: Anel[]): boolean {
  let dentro = false
  for (const a of aneis) {
    if (x < a.minX || x > a.maxX || y < a.minY || y > a.maxY) continue
    let cruza = false
    const r = a.ring
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const xi = r[i][0], yi = r[i][1]
      const xj = r[j][0], yj = r[j][1]
      if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) cruza = !cruza
    }
    if (cruza) dentro = !dentro
  }
  return dentro
}

// Carrega o limite uma vez por instância da função. Chamar no início
// do handler; é seguro chamar de novo (não refaz a busca).
export async function carregarLimiteAcre(): Promise<boolean> {
  if (_aneis) return true
  if (_tentado) return false
  _tentado = true
  try {
    const r = await fetch(URL_LIMITE, { signal: AbortSignal.timeout(15000) })
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    const gj = await r.json()
    const aneis: Anel[] = []
    for (const f of (gj.features ?? [])) aneis.push(...indexar(f.geometry))
    if (!aneis.length) throw new Error('geojson sem polígono')
    _aneis = aneis
    return true
  } catch (e) {
    console.warn('[acre] limite indisponível, seguindo sem recorte local:', String((e as Error).message ?? e))
    return false
  }
}

// true = dentro do Acre. Fail-open enquanto o limite não carregou.
export function noAcre(lat: number, lon: number): boolean {
  if (!_aneis) return true
  if (!isFinite(lat) || !isFinite(lon)) return false
  return pip(lon, lat, _aneis)
}
