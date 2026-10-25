# ZEE do Acre no Mapa das UCs — plano e situação

Pedido do usuário (25/10/2026): carregar no Mapa das UCs as camadas do
Zoneamento Ecológico-Econômico do Acre (ZEE) e disponibilizar os documentos
do ZEE para download.

## O que é o ZEE do Acre

| | Fase II | Fase III |
|---|---|---|
| Situação legal | **Em vigor** — Lei Estadual nº 1.904, de 05/06/2007 | Mapa aprovado pelo CEMAF; consulta pública encerrada em mar/2019; repositório da SEMA marca "em revisão". Não foi achada lei nova. |
| Produto | Mapa de Gestão Territorial, 1:250.000 (20 cartas) | Mapa de Subsídio à Gestão Territorial e Ambiental |
| Estrutura | 4 zonas → subzonas → (às vezes) unidades de manejo | idem, foco na Zona 3 |

Zonas (art. 4º da Lei 1.904/2007 e Documento Síntese da Fase II):
1. Consolidação de sistemas de produção sustentáveis (influência da BR-364/BR-317);
2. Uso sustentável dos recursos naturais e proteção ambiental (UCs, TIs, PAE/PDS/PAF);
3. Áreas prioritárias para o ordenamento territorial;
4. Cidades florestais (as 22 cidades, subzonas por sub-bacia).

A Fase I (1999–2000) é 1:1.000.000 e serve só como documento histórico.

A Fase II montou um banco SIG: o "CD Documento final" trazia o documento
síntese e 15 mapas temáticos estruturados. **O arquivo vetorial existe na
SEMA** — é ele que destrava a camada.

## Fontes

- Pasta pública da SEMA no Drive (`O_ZONEAMENTO_ECOLOGICO_ECONOMICO_DO_ACRE_ZEE`,
  dona `sema.acre856@gmail.com`, id `1K3MH1K6fenD7_e33EH1biwRS_ykU2RWa`).
  Visível nesta sessão: só o *Volume 2 — Aspectos Socioeconômicos* da Fase I
  (PDF, 163 MB). O resto da pasta é listado pelo modo `descobrir` do workflow.
- sema.ac.gov.br/zee-acre, /zee-ac-repositorio, /zee-fase-iii.
- GeoServer da INDE/MMA — a descoberta procura camadas com zee/zoneamento/acre.
- ⚠️ `*.ac.gov.br`, `drive.google.com`, a INDE e o FAOLEX respondem 403/DNS
  nas sessões de desenvolvimento. O runner do GitHub alcança: por isso a
  descoberta e a conversão a partir de URL rodam no workflow.

## O que foi entregue (sem o dado vetorial)

- **Aba "ZEE"** na barra de camadas (`js/mapa-zee.js`, prefixo `zee`):
  - Fase II e Fase III como camadas exclusivas (nunca as duas no mapa);
  - situação legal sempre escrita (Fase II = lei; Fase III = subsídio);
  - cor por zona (Okabe-Ito: 1 #E69F00 · 2 #009E73 · 3 #CC79A7 · 4 #0072B2)
    ou por subzona (tons da cor da zona), opacidade, legenda de tela e de
    impressão, preferências em `localStorage['siguc_zee']`;
  - pane `zeePane` (z 360): acima do Meio Físico, abaixo de UC/TI/CAR;
  - popup pelo `ccfPopupHTML` da Fase 3, com subzona, diretriz, fonte,
    escala e "não substitui a análise do imóvel".
- **Sem o arquivo**: a aba diz que o Mapa de Gestão ainda não foi recebido,
  as caixas ficam desabilitadas e os documentos continuam disponíveis.
- **Documentos para download**: `data/zee/documentos.json` (pasta da SEMA,
  Volume 2 da Fase I, páginas do ZEE, repositório, Fase III, Lei 1.904).
  Só link público, abre na origem — o SIGUC não copia o arquivo (163 MB não
  cabe no repositório e a SEMA segue dona). Documento novo = uma linha no JSON.
- **`scripts/zee_acre.py`** + **`.github/workflows/zee-acre.yml`**:
  - `--descobrir`: lista a pasta do Drive (inclusive subpastas), os links de
    arquivo das páginas do ZEE e as camadas da INDE/MMA. Roda a cada push do
    script/workflow.
  - `--inspecionar ARQ`: campos, projeção e valores de um shapefile.
  - `--converter ARQ --fase 2|3`: lê o código de zona/subzona/unidade (aceita
    "Zona 1", "SZ 2.3.1", 1.2…), junta nome e diretriz de um CSV de legenda
    opcional (`subzona;nome;diretriz`), reprojeta pelo `.prj` (SAD 69 →
    SIRGAS 2000), recorta pelo mesmo `data/acre_estado.geojson`, simplifica
    ~45 m e grava `data/zee/<fase>_gestao.geojson` + `manifesto.json`.
  - Travas: sem `.prj` → para; feição sem zona → para e lista os valores;
    cobertura fora de 95–105% do estado → nada gravado.
  - ARQ pode ser `.zip`, pasta, `.shp`, URL ou `drive:<id>`.

## Como ligar quando o dado chegar

1. Rodar o workflow "ZEE do Acre" em `inspecionar` com o arquivo (ou rodar
   `python scripts/zee_acre.py --inspecionar arquivo.zip` localmente) e
   conferir os campos.
2. Rodar em `converter` com a fase (e `--campo-*` se o palpite errar). O
   workflow grava `data/zee/` no branch.
3. Se as subzonas vierem só com código, montar o CSV de legenda a partir do
   Documento Síntese / anexos da lei.

## Pendências

- O arquivo vetorial (pedir ao Núcleo de ZEE da SEMA o conteúdo do "CD
  Documento final" da Fase II, com `.prj`).
- Nomes e diretrizes das subzonas (anexos da Lei 1.904/2007).
- Depois: subzona do ZEE no relatório "CAR na UC" e no relatório do imóvel.
