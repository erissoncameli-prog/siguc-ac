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

## Fase III recebida (26/10/2026)

O usuário compartilhou do Drive do Núcleo do ZEE o `ZEE FASE III.zip` (845 MB,
227 arquivos). Grande demais para o chat: o workflow baixa
(`drive:<id>`, confirmação de arquivo grande do Drive) e o `--inspecionar`
lista o pacote (volume por extensão, maiores arquivos, cada shapefile com os
valores de cada campo — campo com possível dado pessoal só é CONTADO, nunca
impresso, porque log de Actions pode ser público) e imprime o metadado em
texto.

- `MapaGestão_ZEEIII_Mapa_anexos/AC_MapaGestao_ZEE_III_Versao0506.shp`
  (POLYGONZ, WGS 84/UTM 19S, 190 MB): 30 polígonos, `Zona` 1–4, `Zon_label`
  com o código completo (1.1.1 … ; `x.y.0` = subzona sem unidade de manejo —
  segundo o metadado só a Zona 1 tem unidade), `DescrZona`, `DescSubZon`,
  `DescUniman`. **A Fase III renomeou as zonas** (Zona 1 = Sistemas de
  Produção Agropecuários e Florestais Sustentáveis, Zona 4 = Cidades do Acre):
  o nome vem do PRÓPRIO arquivo (`--campo-zona-nome`), não da tabela da Lei
  1.904. Trava nova: um código, um nome (`conferir_nomes`). O metadado não
  informa escala → `escala: null` e a tela diz "não informada".
  Convertido por `--converter … --fase 3 --shp AC_MapaGestao_ZEE_III_Versao0506
  --campo-zona Zona --campo-subzona Zon_label --campo-zona-nome DescrZona
  --campo-subzona-nome DescSubZon --campo-unidade-nome DescUniman --escala nenhuma
  --area-minima-ha 6.25`. Resultado: 30 feições, 4 zonas, 20 subzonas, 13
  unidades de manejo (todas na Zona 1), 99,8% do Acre, 15,1 MB (3,9 MB com
  gzip; o mapa só baixa ao ligar).
- **Por que a conversão passava de 30 min (medido com `--perfil`)**: o arquivo
  veio de raster vetorizado — 5,9 milhões de vértices em 223.876 partes
  (143.555 menores que 0,2 ha) e 142.108 furos (123.603 com menos de 1 ha). O
  simplify topológico passa de 150 s numa feição só (e o `make_valid` e o
  recorte idem); com SVG/pyshp o resto também pesava. Caminho novo
  (`ler_preparar`): pyogrio (WKB → shapely 2 em array), tirar o Z, **tirar
  partes e furos abaixo da área mínima** (`tirar_miudos`; o furo de uma zona é a
  ilha de outra, tirando os dois a área passa para a zona em volta), Douglas-Peucker
  simples na unidade do arquivo (TOLERANCIA/2 em metros), `make_valid` só no
  inválido, reprojeção em bloco e o `recortar` do Meio Físico (sem mudança).
  Conversão inteira em ~70 s.
- **Área mínima 6,25 ha** (= 1 mm² no papel a 1:250 mil), declarada em
  `manifesto.json` (`area_minima_ha`). Medido: 1 ha → 19,3 MB, área −0,06%;
  6,25 ha → 15,1 MB, −0,15%, maior variação numa feição 6,3%; 25 ha → 12,3 MB,
  −0,32%; 100 ha → 9,6 MB, −0,77% (18,8% numa feição). O tamanho quase não cai
  com área maior — o peso está nos contornos —, então ficou a menor perda.
  Outro valor = rodar o `converter` de novo com `--area-minima-ha`.
- Sobreposições finas nas divisas: cada feição é simplificada sozinha, então
  vizinhas se sobrepõem em faixas de metros (257 pares, ~19 mil ha somados,
  0,12% do estado). Mesma natureza da Fase II e do Meio Físico (mesma
  tolerância de 45 m); só some com simplificação de cobertura no `recortar`, que
  é do Meio Físico e não foi mexido.
- No navegador, com o arquivo real: ligar ~0,8 s, clique → popup ~0,1–0,2 s,
  arrastar ~0,4–0,5 s (SVG; canvas medido igual, não entrou).
- `ZEE_ACRE_FUNDIARIO.shp` (1.248 polígonos; metadado:
  `ZEE_Ac_fUNDIARIO_REVISADO_2019`): base fundiária que o ZEE usou — 952
  imóveis rurais (IRU), 156 assentamentos, 84 glebas federais, 32 TIs, 18 UCs
  de uso sustentável, 3 glebas estaduais, 3 UCs de proteção integral.
  **Tem dado pessoal**: `PROPRIET` (nome do proprietário), `MATRICULA`,
  `CERTIF`, `CODIGO` (SIGEF) e `NOME` (nome da propriedade). O
  `--fundiario` grava `data/zee/fase3_fundiario.geojson` só com lista fechada
  de campos (`FUND_CAMPOS`): tipo, subtipo, órgão, fonte, situação,
  sobreposição, zona/subzona e o nome SÓ de área pública (no IRU o nome da
  fazenda costuma ser o do dono). Fica fora do ROPA: o que vai para o arquivo
  não identifica pessoa. Na tela é "camada complementar" da aba ZEE (liga junto
  com qualquer fase, cor por tipo).
- 3 `.rar` internos (`Mapa_gestao_ZEE_FaseIII_AJ2020`, `FUNDIARIO`,
  `Mapas_relatorio`) = cópias do que já está solto no pacote. O 7z do runner
  não abre RAR5 (sai com −11); a extração quebrada é descartada.
- PDFs/JPGs: mapa A0 em PDF, resumo executivo (já publicado no site da SEMA),
  minuta de lei de 2021, apresentação de 2023, metadados, mapas por zona em JPG.
  Não copiados para o repositório; o pacote inteiro entrou como link em
  `documentos.json` (grupo Fase III).

### Quadro de áreas, classes e relatórios do CAR (26/10/2026)

- `data/zee/fase3_quantificacoes.json`: 37 classes (4 zonas, 20 subzonas, 13
  unidades) com área 2007 e 2020, da planilha de quantificações da SEMA e da
  tabela de atributos. Zonas 2020 somam 16.431.092 ha (SIG) contra 16.422.136 ha
  oficiais do estado; o % do Acre usa o oficial. Unidades 1.1.8, 1.2.3, 1.3.2 e
  subzonas 3.3–3.5 são novas na Fase III ("nova" no quadro). A unidade 1.3.1 de
  2007 = subzona 1.3 inteira (a Fase II não a dividia).
- Aba ZEE: árvore de classes com mostrar/ocultar e área, colorir por unidade,
  quadro 2007 × 2020, popup com área oficial ao lado da área do desenho.
- Relatórios "CAR na UC" e do imóvel: zona/subzona/unidade que o imóvel atinge,
  com hectares e % (`js/zee-imovel.js`).

### Mapa A0 e clique (27/10/2026)

- `MAPA_ZEE_ACRE_FASEIII.pdf` (72,6 MB, 1 página) examinado no runner (`zee_acre.py
  --pdf`): gerado pelo Adobe Illustrator CS6 como PDF/X-1 (arquivo de gráfica), sem
  georreferência (nem ISO 32000 nem OGC), sem camadas OCG, sem árvore de estrutura; o
  GDAL não acha camada vetorial. O mapa é uma imagem CMYK de 5710 × 4006 px (150 dpi)
  com ~220 imagens pequenas (ícones da legenda). Nada para extrair: UGAI, pistas de pouso,
  sedes etc. só existem desenhados.
- Clique nos polígonos não abria nada quando UC/TI ou CAR estavam ligados (panes por
  cima). Agora o ZEE responde pelo ponto clicado e entra no popup das outras camadas.

## Fase II recebida (26/10/2026)

O usuário enviou `ZEE_II.rar` (RAR5 — o `unar` 1.10 falha nos `.shp`; extrair com
`7z` do pacote `7zip-rar`). Conteúdo:

- `Zonas_Gestao_Consolidada.shp` (QGIS, 14/10/2016, WGS 84): 4 multipolígonos,
  campos `Label` ("Zona 01"…"Zona 04") e `Zonas` (nome sem acento). **Só zonas,
  sem subzonas nem unidades de manejo.** Convertido por
  `zee_acre.py --converter … --fase 2 --campo-zona Label --escala 1:250.000`:
  cobre 99,9% do Acre — Z1 4.181.601 ha (25,5%), Z2 7.907.922 ha (48,2%),
  Z3 4.292.043 ha (26,2%), Z4 26.612 ha (0,2%).
- `FUNDIARIO_250.shp` (Lambert/SAD 69, 2021): 459 polígonos de situação
  fundiária (arrecadada, assentamento, discriminada, particular, TI, UC, sem
  estudo). Não é zona do ZEE; não carregado — decisão pendente do usuário.

Pendência que continua: subzonas da Fase II (pedir à SEMA o shapefile com
subzonas/unidades de manejo, se existir).

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
  - `--area-minima-ha N`: tira partes e furos menores que N antes de
    simplificar (arquivo vindo de raster). Fica no manifesto.
  - Modos de diagnóstico do workflow: `extrair` (artefato só com o `.shp`
    escolhido — o blob storage do GitHub dá 403 nas sessões, então serve para
    baixar de fora) e `perfil` (mede a conversão inteira por área mínima, sem
    gravar). `timeout-minutes: 90` só por segurança; log sem buffer
    (`PYTHONUNBUFFERED`), então um job cancelado mostra até onde chegou.

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
- ~~Subzona do ZEE no relatório "CAR na UC" e no relatório do imóvel~~ —
  entregue em 26/10/2026 (`js/zee-imovel.js`).
- Mapas oficiais (JPG por zona, A0 em PDF), metadados, minuta de lei de 2021 e
  apresentação de 2023: estão só dentro do pacote de 845 MB. Para listar cada
  um em `documentos.json` falta um link público por arquivo (a regra é não
  copiar PDF para o SIGUC) ou a decisão de hospedá-los.
