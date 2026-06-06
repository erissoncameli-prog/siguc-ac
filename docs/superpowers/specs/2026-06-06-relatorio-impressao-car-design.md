# Spec — Relatório de Impressão CAR (SIGUC-AC)
**Data:** 2026-06-06  
**Status:** Aprovado  
**Depende de:** Spec Config Institucional (`2026-06-06-config-institucional-design.md`)

---

## Objetivo

Gerar um laudo técnico ambiental imprimível (PDF/papel) para imóveis CAR, com dados reais carregados em memória (PRODES, SINAFLOR, focos de calor, atributos CAR), mapas com elementos cartográficos ABNT, e dois níveis de detalhamento (Sintético e Detalhado). Suporta relatório individual ou consolidado para múltiplos imóveis marcados.

---

## Fluxo do Usuário

```
Usuário abre imóvel CAR → painel lateral com abas
         ↓
Botão 🖨️ no rodapé do painel (visível em todas as abas)
         ↓
Modal de configuração do relatório:
  [1] Escopo: "Imóvel atual" ou "Todos os marcados (N)"
  [2] Modo: Sintético | Detalhado
         ↓
     [Pré-visualizar]          [Imprimir / PDF]
          ↓                          ↓
  Overlay fullscreen           Abre nova aba
  com toolbar + folhas A4      window.print()
  Botão "↗ Nova aba"
  Botão "🖨️ Imprimir / PDF"
  window.print() → browser dialog
```

---

## Escopo do Relatório

### Imóvel único (padrão)
- Relatório do imóvel aberto no painel

### Múltiplos imóveis (📌 Marcados)
- Se há imóveis marcados, o modal oferece os dois escopos
- Consolidado: capa geral + **Mapa 0** (todos os imóveis no mapa) + seção separada por imóvel
- Cada seção tem seu próprio Mapa de Detalhe
- Ordem: imóveis ordenados por área (maior → menor)

---

## Modos de Relatório

### Sintético (1–2 páginas por imóvel)
Página 1:
- Cabeçalho institucional
- Título + badges (SICAR, CAR status, módulos fiscais)
- KPI cards (área, desmatamento, déficit RL, focos)
- Card de conformidade CF (Consolidado / Autorizado / A verificar)
- Mapa 1 (localização regional) + Mapa 2 (detalhe do imóvel)
- Recomendação (1 parágrafo)
- Rodapé com aviso legal

### Detalhado (3+ páginas por imóvel)
**Folha 1 — Capa e Identificação:**
- Cabeçalho ABNT completo (logos + hierarquia config_sistema)
- Título do laudo + identificação do imóvel
- KPI cards + conformidade CF
- Tabela de identificação completa (todos os atributos CAR)
- Mapa 1 — Localização Regional

**Folha 2 — Análise Temática:**
- Mapa 2 — Detalhe com todas as camadas carregadas
- Seção 3: Análise PRODES/INPE (barras por ano coloridas por CF + tabela)
- Seção 4: Focos de Calor (barras por ano + correlação PRODES)
- Seção 5: SINAFLOR/IBAMA (tabela de ASVs)

**Folha 3 — Análise Jurídica:**
- Seção 6: Reserva Legal (tabela + barra visual)
- Seção 7: Narrativa de Conformidade (texto completo com artigos CF)
- Seção 8: Conclusão e Recomendação
- Referências legais (9 artigos da Lei 12.651/2012)
- Aviso legal automático + dados do usuário emissor

---

## Mapas — Requisitos ABNT

Cada mapa deve conter os elementos obrigatórios conforme normas CONCAR/ABNT:

| Elemento | Implementação |
|---|---|
| **Título** | Faixa superior escura com texto descritivo |
| **Escala numérica** | Calculada a partir do zoom Leaflet (ex: 1:50.000) |
| **Escala gráfica** | `L.control.scale({imperial:false})` |
| **Seta de norte** | SVG overlay fixo no canto superior direito |
| **Legenda** | Listagem das camadas visíveis com cor/símbolo |
| **Fonte dos dados** | Rodapé do mapa (PRODES/INPE, SICAR/SFB, FIRMS/NASA) |
| **Sistema de referência** | SIRGAS 2000 — no rodapé |
| **Projeção** | Geográfica (lat/lon) — no rodapé |
| **Data de elaboração** | Rodapé (data da emissão do relatório) |
| **Responsável** | Órgão emissor do config_sistema |
| **Moldura** | Border 1.5px solid #374151 ao redor |

### Mapa 1 — Localização Regional
- Centro: centroide do estado do Acre
- Zoom automático para mostrar Acre inteiro + município destacado
- Polígono CAR marcado em vermelho
- Tile: OpenStreetMap

### Mapa 2 — Detalhe do Imóvel
- Bbox: `turf.bbox(carPolygon)` com padding 20%
- Camadas: limite CAR + PRODES anual (colorido por CF) + PRODES histórico + focos de calor + UCs se carregadas
- Escala automática baseada no zoom resultante
- Tile: OpenStreetMap

### Mapa 0 (consolidado — múltiplos imóveis)
- Bbox: engloba todos os imóveis marcados
- Cada imóvel com cor diferente (palette SUBBACIA_PALETTE existente)
- Legenda com nome de cada imóvel

---

## Arquitetura Técnica

### Arquivos a criar

| Arquivo | Responsabilidade |
|---|---|
| `js/relatorio-car.js` | Montagem dos dados + geração do HTML do relatório |
| `css/relatorio-print.css` | Estilos do relatório + `@media print` |

### Arquivos a modificar

| Arquivo | Modificação |
|---|---|
| `pages/mapa.html` | Botão 🖨️ no rodapé do painel CAR + modal de seleção + overlay de preview |

### `js/relatorio-car.js` — Funções principais

```js
// Ponto de entrada: abre modal
function abrirModalRelatorio()

// Constrói objeto de dados para um imóvel
// Usa dados já em _carProdesCache, _carDiagCache, _carDadosLocais, sinaflor_asv
async function montarDadosRelatorio(cod_imovel) → RelatorioData

// Gera HTML completo do relatório (string)
function gerarHTMLRelatorio(dados[], modo, config) → string

// Abre overlay de preview
function abrirPreviewRelatorio(html)

// Abre em nova aba
function abrirNovaAbaRelatorio(html)

// Calcula escala numérica a partir do zoom e latitude
function calcularEscalaLeaflet(zoom, lat) → string  // ex: "1:50.000"

// Gera HTML do mapa ABNT (container, título, atributos cartográficos)
function htmlMapaABNT(id, titulo, altura, camadas, fonte) → string

// Inicializa mapas Leaflet dentro do relatório (chamado após inserir HTML no DOM)
async function inicializarMapasRelatorio(dados[], containerId)
```

### Estrutura de dados `RelatorioData`

```ts
interface RelatorioData {
  // Identificação
  cod_imovel: string
  nom_imovel: string
  nome_compl: string
  cpf_cnpj: string
  nom_munici: string
  area_ha: number
  num_modulo: number
  ind_status: string
  nome_class: string   // Verde/Amarelo/Vermelho
  dat_criaca: string
  pequenaPropriedade: boolean

  // PRODES
  totalGeral_ha: number
  haConsolidado: number
  haAutorizado: number
  haAVerificar: number
  haIrregular: number
  anosAnual: string[]
  porAno: Record<string, number>
  geojsonFeatures: Feature[]  // com propriedade clf por feature

  // Reserva Legal
  exigenciaRL: number
  florestaRemanescente: number
  deficitRL: number

  // Focos
  focosTotal: number
  focosPorAno: {ano: number, total: number}[]
  focosCorrelacionados: number[]  // anos com correlação PRODES

  // SINAFLOR
  asvList: ASV[]
  asvBase: boolean

  // UC
  emUC: boolean
  ucNome: string | null
  areaUC_ha: number

  // Diagnóstico
  recomendacao: string
  narrativaJuridica: string

  // Geometria (para mapas)
  geometry: GeoJSON.Geometry
  bbox: [number, number, number, number]
}
```

### Geração dos mapas no relatório

Os mapas são renderizados via **Leaflet** dentro do HTML do relatório, não como imagens capturadas:

1. `gerarHTMLRelatorio()` insere `<div id="mapa-loc-{cod}" style="height:220px">` no HTML
2. `inicializarMapasRelatorio()` inicializa cada div com um `L.map()` usando os dados já em memória
3. Para impressão: antes de chamar `window.print()`, aguardar todos os tiles carregarem via evento `tileloadend` de cada mapa
4. Estratégia: `map.once('idle', resolve)` + timeout de 3s como fallback — só então chama `window.print()`
5. Se o browser não capturar o canvas corretamente (conhecido em Firefox), converter via `leaflet-image` para `<img>` antes do print

**Cálculo de escala numérica:**
```js
function calcularEscalaLeaflet(zoom, lat) {
  const metersPerPixel = 156543.03392 * Math.cos(lat * Math.PI / 180) / Math.pow(2, zoom)
  const dpi = 96
  const scale = Math.round(metersPerPixel * dpi / 0.0254)
  // Arredonda para escala cartográfica padrão
  const escalas = [1000,2000,5000,10000,25000,50000,100000,250000,500000,1000000,2000000]
  return escalas.reduce((prev, curr) => Math.abs(curr - scale) < Math.abs(prev - scale) ? curr : prev)
}
```

---

## Botão no Painel CAR

Adicionado no rodapé do painel lateral (abaixo dos botões existentes):

```html
<!-- Rodapé do painel CAR — botão imprimir -->
<div style="padding:10px 16px;border-top:1px solid var(--borda);background:var(--cinza-50)">
  <button onclick="abrirModalRelatorio()" 
    style="width:100%;display:flex;align-items:center;justify-content:center;gap:6px;
           padding:9px;background:#fff;border:1px solid var(--borda);border-radius:6px;
           font-size:12px;font-weight:600;color:var(--cinza-700);cursor:pointer">
    🖨️ Gerar Relatório / PDF
  </button>
</div>
```

---

## CSS `@media print`

```css
@media print {
  /* Ocultar tudo exceto o relatório */
  body > *:not(#relatorio-print-root) { display: none !important; }
  
  /* A4: 210mm × 297mm */
  .a4 { 
    width: 210mm; min-height: 297mm; 
    page-break-after: always;
    box-shadow: none; margin: 0;
  }
  
  /* Mapas: forçar altura fixa para evitar quebra */
  .mapa-leaflet { page-break-inside: avoid; }
  
  /* Tamanhos de fonte ajustados para impressão */
  body { font-size: 10pt; }
  .rel-inst .sec { font-size: 10pt; }
}

@page {
  size: A4 portrait;
  margin: 0;
}
```

---

## Número de Protocolo

Formato configurável em `config_sistema.dados.protocolo_formato` (ex: `SIGUC-{ANO}-{SEQ}`).

Geração: RPC Supabase `gerar_protocolo_relatorio()` que incrementa o sequencial atomicamente e retorna o número formatado.

```sql
CREATE OR REPLACE FUNCTION gerar_protocolo_relatorio()
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  seq INT; fmt TEXT; resultado TEXT;
BEGIN
  UPDATE config_sistema 
  SET dados = jsonb_set(dados, '{protocolo_seq}', 
    to_jsonb(COALESCE((dados->>'protocolo_seq')::INT, 0) + 1))
  WHERE id = 1
  RETURNING (dados->>'protocolo_seq')::INT, dados->>'protocolo_formato'
  INTO seq, fmt;
  
  resultado := REPLACE(COALESCE(fmt, 'SIGUC-{ANO}-{SEQ}'), '{ANO}', EXTRACT(YEAR FROM NOW())::TEXT);
  resultado := REPLACE(resultado, '{SEQ}', LPAD(seq::TEXT, 4, '0'));
  RETURN resultado;
END;
$$;
```

---

## Tratamento de Dados Ausentes

| Situação | Comportamento no relatório |
|---|---|
| Aba PRODES não carregada | Seção PRODES mostra: "Dados PRODES não carregados — acesse a aba 🌳 PRODES antes de gerar o relatório" |
| Sem focos (base vazia) | Seção focos: "Nenhum foco registrado — base em construção" |
| SINAFLOR sem dados para o imóvel | Seção ASV: "Nenhuma ASV localizada — verificar IBAMA/SEMA-AC" |
| Config institucional não configurada | Usa valores padrão: "SEMA-AC · DIMA · DEUC" |
| Geometria inválida (mapa) | Mapa renderiza como erro: "Geometria indisponível" |

---

## Arquivos a criar/modificar — Resumo

| Arquivo | Ação | Conteúdo principal |
|---|---|---|
| `supabase/migrations/021_protocolo_relatorio.sql` | Criar | Função `gerar_protocolo_relatorio()` |
| `js/relatorio-car.js` | Criar | Montagem dados + geração HTML |
| `css/relatorio-print.css` | Criar | Estilos A4 + @media print |
| `pages/mapa.html` | Modificar | Botão rodapé + modal + overlay preview |

---

## Fora de Escopo

- Assinatura digital do PDF
- Envio do relatório por e-mail diretamente do modal
- Histórico de relatórios gerados
- Relatório para UCs (só imóveis CAR nesta spec)
- Marca d'água "rascunho" / "oficial"
- Geração server-side de PDF (Puppeteer/wkhtmltopdf) — usar `window.print()` por ora
