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
  **Listada pelo modo `descobrir` do workflow em 25/10/2026**: 10 seções
  (outras publicações, ZEE nacional, ZEE Acre, Fase I, Fase II, livros
  temáticos, mapas temáticos, guia do uso da terra, arcabouço técnico-jurídico,
  sinopse) e ~65 PDFs. **Nenhum arquivo vetorial** (.shp/.zip/.gpkg/.kmz).
- O repositório do ZEE no site da SEMA (`/zee-ac-repositorio/`) publica os
  MESMOS PDFs com link direto (`/wp-content/uploads/2025/05/…`); a página da
  Fase III tem o resumo executivo. É para lá que os links apontam.
- INDE: nenhuma camada de ZEE do Acre (só zoneamentos de UCs do RJ e afins);
  o workspace MMA não tem ZEE.
- sema.ac.gov.br/zee-acre, /zee-ac-repositorio, /zee-fase-iii.
- GeoServer da INDE/MMA — a descoberta procura camadas com zee/zoneamento/acre.
- ⚠️ `*.ac.gov.br`, `drive.google.com`, a INDE e o FAOLEX respondem 403/DNS
  nas sessões de desenvolvimento. O runner do GitHub alcança: por isso a
  descoberta e a conversão a partir de URL rodam no workflow.

## Busca na internet pelo arquivo vetorial (25/10/2026) — nada público

Rodado pelo modo `descobrir` (log do workflow "ZEE do Acre") + buscas na web:

| Fonte | Resultado |
|---|---|
| Pasta da SEMA no Drive e repositório do site da SEMA | só PDF (~65 arquivos) |
| INDE (`geoservicos.inde.gov.br`, inclusive o workspace MMA) | nenhuma camada de ZEE do Acre |
| GeoInfo/Embrapa (`geoinfo.dados.embrapa.br`) — herdou parte do projeto UZEE-AML | do Acre, só solos/aptidão agrícola do UZEE (`geonode:acre_aptidao_agric`, 2017) e TerraClass; **sem zonas de gestão** |
| SIAGEO/Embrapa (`amazonia.cnptia.embrapa.br/i3geo`, ~650 camadas dos ZEE estaduais) | **fora do ar** — o domínio não existe mais |
| i3Geo do MMA (`mapas.mma.gov.br`, "Mapa Integrado dos ZEE estaduais") | não responde (timeout) |
| Wayback Machine (mapas.mma, seiam.ac.gov.br, semapi, sema.ac, SIAGEO, zeeamazonia) | ~34 mil URLs arquivadas; nenhum shapefile do ZEE |
| ArcGIS Online | nada |

Conclusão: o arquivo vetorial do Mapa de Gestão hoje só existe na SEMA
(Núcleo de ZEE) — e talvez na Embrapa Informática Agropecuária, que coordenou
o SIAGEO (equipe de João Vila). Pedir a um dos dois.

**Camada entregue enquanto o Mapa de Gestão não chega**: `geonode:acre_aptidao_agric`
(WFS da GeoInfo/Embrapa, projeto UZEE-AML, 2017) virou o tema "Aptidão agrícola —
ZEE/UZEE" da aba Meio Físico (`data/meio_fisico/aptidao_agricola.geojson`, gerado
por `scripts/meio_fisico.py`). Conferido na fonte (metadados do GeoNode,
dataset 1301): 257 polígonos, atributo único `class_apt` (B/P 175, B/A 48, R/P 17,
R/A 12, N/R 4, agua 1); cobre só as regiões de consolidação e expansão do MacroZEE
(47,2% do Acre) — por isso a trava é de CONTAGEM, não de área. **A Embrapa não
publica a legenda por extenso** (estilo de uma cor só, GetLegendGraphic sem
regras): a tela mostra o código da fonte e diz isso. Quando o significado for
confirmado (ex.: Documento Síntese, mapa APTIDAO.pdf), entra como rótulo — nunca
antes.

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
  Documento final" da Fase II, com `.prj`). Não está na pasta pública nem no
  site. O `SUBSIDIOS_A_GESTAO_TERRITORIAL.pdf` é imagem do mapa: vetorizar a
  partir dele não serve (deformação e perda de precisão em 1:250 mil).
- Nomes e diretrizes das subzonas (anexos da Lei 1.904/2007).
- Depois: subzona do ZEE no relatório "CAR na UC" e no relatório do imóvel.
