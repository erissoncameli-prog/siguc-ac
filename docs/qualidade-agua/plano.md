# Módulo Qualidade da Água (IQA) — plano e handoff

Documento de continuidade. Foi escrito para que uma sessão nova de Claude
Code consiga executar a Fase 0 **sem ter acesso à planilha original** —
ela foi anexada num chat e não sobrevive à sessão. Tudo que era preciso
dela está exportado neste diretório.

## Arquivos deste diretório

- `serie-historica.csv` — as 450 coletas de 2016 a 2026, exportadas da
  planilha `Planilha_Série_Histórica_..._CORRIGIDA.xlsx` com os valores
  **exatamente como estavam**, inclusive os errados (`<1`, `2,419,00`,
  pH 16,36). Nada foi limpo na exportação de propósito: quarentena é
  decisão da Fase 1, e apagar evidência antes de alguém olhar seria
  irreversível. A coluna `linha_origem` guarda o número da linha na
  planilha, para conferência com o arquivo físico.
- `curvas-iqa.json` — as curvas `q_i` do IQA CETESB digitalizadas, os
  pesos, os limites das faixas e os limites CONAMA Classe 2.

## Decisões já tomadas (não reabrir)

| # | Decisão | Situação |
|---|---------|----------|
| 1 | **ΔT usa `Temp Ar` como referência** | Decidido pelo diretor DIMA |
| 2 | **CONAMA Classe 2** para todos os pontos, ajustável por ponto | Decidido |
| 3 | Valor censurado (`<1`) = **metade do limite de detecção** | Padrão adotado; trocável numa linha se o laboratório orientar outro |
| — | Módulo **irmão** de Brigadas/Biomonitor/Frota, não aninhado no Biomonitor | `grupos_biomonitor` exige `uc_id NOT NULL` e a maioria dos pontos fica fora de UC |
| — | Mapa em **página própria** (`agua-mapa.html`), não camada do `mapa.html` | O eixo é o tempo sobre pontos fixos, não "o que está onde agora" |

## A fórmula está validada — e a validação é o teste

O método é o IQA CETESB/ANA de 9 parâmetros. Implementei as curvas de
`curvas-iqa.json` e rodei contra as **268 linhas que já têm IQA
calculado** na série histórica:

- erro mediano **1,75 ponto**
- **89%** dentro de ±5 pontos, **99%** dentro de ±10
- correlação **0,946**

Isso é o que autoriza mover o cálculo para o banco: há prova de que ele
não distorce dez anos de série. **Essas 268 linhas viram a suíte de
regressão** (`tests/agua-iqa.test.js`), no padrão dos outros guardas do
projeto. Qualquer mudança futura na fórmula que quebre o histórico falha
antes de chegar à produção.

O erro residual vem da digitalização aproximada das curvas. Refinar até
cair dentro da tolerância acordada faz parte da Fase 0.

### Sobre o ΔT — leia antes de implementar

A referência decidida é `Temp Ar`, coluna que **já existe em 94% da
série** (422 de 450) ao lado de `Temp Amostra` (100%). Os coletores
medem as duas há dez anos; ninguém usava a segunda.

Isso importa porque, se o ΔT só passasse a existir de agora em diante,
toda coleta nova sairia sistematicamente mais baixa que a equivalente
histórica — queda de método parecendo queda de qualidade da água. Com
`Temp Ar`, a década inteira é recalculável e a série fica homogênea.

**Ressalva técnica registrada:** o ΔT do método original detecta
poluição térmica, e a referência canônica é um ponto de controle a
montante, não o ar. Um rio mais frio que o ar à tarde é natural, e o
índice penaliza isso como impacto. Medido nos dados: |ΔT| mediano de
1,7 °C, movendo o IQA ~0,4% — irrelevante no caso típico; a cauda chega
a 15 °C e aí pesa vários pontos. Por isso:

> **Gravar `temp_ar` e `temp_amostra` como dado bruto e derivar o ΔT na
> view.** Se a SEMA adotar ponto de controle a montante no futuro, é
> troca de view, não migração de dados.

Os 6% sem `Temp Ar` usam o q neutro (94) e ficam **marcados como tal** no
registro, para que um gráfico que cruze a fronteira de método possa
avisar.

## Achados na série histórica (definem o escopo)

Todos verificados nos dados, não supostos:

1. **Ponto sem identidade fixa** — `ASSIS BRASIL`, `'ASSIS BRASIL '`,
   `ACRE`, `Acre`; a mesma estação com códigos `13438000`, `13433800`,
   `13488000`; Rio Branco como `1360100` (dígito faltando).
2. **Coordenada em 25% das linhas** — e a coluna diz "UTM" enquanto o
   conteúdo é grau decimal.
3. **Coordenada trocada** — Santa Rosa do Purus gravada na coordenada de
   Porto Walter (`-8.263677845414033, -72.74170231804855`). Bacias
   diferentes, ~400 km. **Corrigir no seed.**
4. **Valores impossíveis** — pH **16,36** (a escala vai a 14), 13,29,
   12,50; 20 das 445 linhas com pH fora de 4–9. OD de **27 mg/L** com
   saturação de ~8 a 26 °C.
5. **Texto em coluna numérica** — 56 `<1` em coliformes; `2,419,00` em
   coliformes totais; fósforo ora número ora texto.
6. **Faixa atribuída à mão** — 9 das 268 classificações divergem do
   próprio valor (IQA 44,15 marcado BOA; IQA 51,12 marcado REGULAR).
   No sistema a faixa é derivada, então isso deixa de ser possível.
7. **Sólidos totais não existem** — só dissolvidos e suspensão
   separados; o IQA precisa da soma.

**Pendência que precisa de conferência humana:** sólidos em suspensão
têm mediana de 0,342 mg/L com turbidez mediana de 90 UNT. Os dois não
podem estar certos ao mesmo tempo — provável mistura de unidade (g/L vs
mg/L) ao longo dos anos. Afeta o peso 0,08 em parte da série. Alguém da
SEMA precisa conferir laudos antigos; **não decidir isso por
algoritmo.**

## Fase 0 — escopo desta entrega

Próxima migration livre: **248** (a última aplicada é a 247).

1. **Migrations** do cadastro, com RLS em todas as tabelas:
   - `agua_pontos_coleta` — código ANA, nome, município, rio, bacia,
     geometria PostGIS, altitude, UC relacionada (opcional), classe de
     enquadramento (default Classe 2).
   - `agua_campanhas` — ano + ordem (1ª/2ª).
   - `agua_coletas` — campo e laboratório na **mesma linha** (é sempre
     1:1; separar obrigaria JOIN no caso comum). Parâmetros de campo
     (`temp_ar`, `temp_amostra`, pH, OD, turbidez, condutividade),
     parâmetros de laboratório como colunas nulas, GPS, foto, status
     (`aguardando_lab` / `completo` / `quarentena`), e para cada
     parâmetro de laboratório a marca de valor censurado + o limite de
     detecção.
   - `agua_laboratorios` — o serviço é terceirizado; saber quem produziu
     qual resultado importa para prestação de contas.
2. **Seed das 20 estações históricas**, com a coordenada de Santa Rosa do
   Purus corrigida.
3. **`agua_calcular_iqa()`** — a função é a definição única do cálculo.
   Nenhuma página reimplementa a conta em JavaScript (mesma lição de
   `js/frota-consumo.js` e `js/mapa-recorte.js`).
4. **View** que deriva ΔT, IQA, faixa e conformidade CONAMA Classe 2.
5. **`tests/agua-iqa.test.js`** — regressão contra as 268 linhas de
   `serie-historica.csv`. Refinar as curvas até o erro ficar dentro da
   tolerância.
6. **Entrada no ROPA da LGPD** (`lgpd_tratamentos`) — o coletor terá GPS
   e foto, e a regra do projeto é registrar na mesma entrega, apontando
   as tabelas reais.

Regras do projeto que se aplicam: migration criada é migration
**aplicada** no banco de produção via `mcp__Supabase__apply_migration`,
seguida de `get_advisors` (type security). Fase 0 não toca arquivos web,
então **não precisa** subir versão em `pwa/sw.js` — isso começa na Fase
2. Quando começar, `VERSOES` ganha a chave `agua`.

## Fase 0 — ENTREGUE (migrations 248–252)

O que ficou no banco: `agua_pontos_coleta`, `agua_campanhas`,
`agua_coletas`, `agua_laboratorios` e `agua_limites_conama` (todas com
RLS, módulo `agua` registrado em `modulos` como **inativo** até a Fase
2 entregar a página); `agua_calcular_iqa()` + `agua_iqa_q()` +
`agua_od_saturacao()` + `agua_iqa_faixa()` + `agua_conama_violacoes()`;
`vw_agua_coletas_detalhe`; seed das estações e das campanhas; TRAT-018
e TRAT-019 no ROPA. Guarda: `tests/agua-iqa.test.js`.

### Quatro correções ao que este plano supunha

1. **A série histórica foi calculada SEM o ΔT.** Descoberto ao
   reproduzir o baseline: os 1,75 só batem com o ΔT no `q` neutro. Não
   muda a decisão de adotar ΔT — muda o que se pode comparar com o quê.
   A regressão compara com ΔT neutro (mesmo método da planilha) e mede
   o efeito de ligar o termo à parte: **mediana 0,30 ponto**, máximo
   8,33. A view marca `delta_temperatura_neutro` por linha.
2. **São 17 estações, não 20.** Os outros três códigos são as próprias
   grafias erradas que o achado 1 descreve (13433800 e 13488000 por
   13438000; 1360100 por 13601000). Semear 20 criaria três estações
   fantasmas. As grafias ficam em `agua_pontos_coleta.codigos_alias`,
   para a Fase 1 casar as 450 linhas sem inventar ponto.
3. **Santa Rosa do Purus está 279 km de Porto Walter, não ~400.** A
   correção foi feita; a distância medida entre as duas posições é
   279 km em linha reta. A coordenada nova é a **sede municipal**, um
   localizador provisório — não a posição da estação, que ninguém
   levantou. Está marcada como `coordenada_conferida = false`, junto
   com as outras 16 (nenhuma foi conferida em campo).
4. **A planilha traz vírgula decimal dentro de campo com aspas**
   (`"23,00"` em Temp Ar, `"0,050"` em FosforoTotal) e a coordenada
   inteira num campo só. São 143 linhas com aspas: quem for ler o CSV
   na Fase 1 precisa de parser de CSV de verdade, não `split(',')`.

### O refino das curvas

Erro mediano contra as 268 linhas: **1,75 → 0,695**. Dentro de ±5:
89% → 90,3%. Dentro de ±10: 99% → 99,25%. Correlação: 0,946 → 0,960.

Método: ajuste dos valores `q` nos nós, coordenada a coordenada, com
duas restrições — a forma da curva é preservada (monotonicidade por
trecho) e **nenhum nó se afasta mais de 5 pontos** do valor
digitalizado, para a curva continuar sendo a da CETESB e não uma
regressão livre sobre a planilha. O ganho não é sobreajuste: em
validação cruzada (metade treina, metade valida), o erro mediano fora
da amostra cai de 1,72 para 1,21. A curva de ΔT **não se moveu** — a
série nunca a exercitou, então não havia sinal para ajustar, o que
serve de aferição de que o procedimento não inventa ajuste sem
evidência.

O erro máximo continua alto (25,0) e é o esperado: são as linhas com
pH 16,36 e OD de 27 mg/L. Dado impossível não deve ser reproduzido com
fidelidade — vai para quarentena na Fase 1.

### Decisões novas, tomadas aqui

- **Piso de peso.** Abaixo de 0,60 de peso medido, `agua_calcular_iqa`
  devolve NULL em vez de um índice montado com dois parâmetros. A tela
  mostra "sem índice"; um número seria pior que nenhum.
- **Pesos renormalizados** pelo que existe. Sem isso, faltar parâmetro
  puxaria o índice para baixo como se o rio tivesse piorado.
- **Limites CONAMA em tabela** (`agua_limites_conama`), não em `CASE`:
  só a Classe 2 está validada, e as outras entram por INSERT quando
  alguém conferir a resolução. Classe sem limite cadastrado devolve
  NULL — que não é o mesmo que "conforme", e a tela não pode confundir
  os dois.
- **Saturação de OD derivada**, nunca gravada. A coluna "OD (%)" da
  planilha bate com o valor derivado (diferença mediana de 1,03 ponto
  percentual), então ela também era derivada.

### Aprendizados de infraestrutura que valem para o projeto todo

- `REVOKE ... FROM PUBLIC` **não fecha função nenhuma** no Supabase: o
  `ALTER DEFAULT PRIVILEGES` do projeto concede EXECUTE a `anon` por
  NOME em toda função nova do schema `public`. Tem que revogar do papel
  pelo nome. Pego no `proacl` depois de aplicar a 249, corrigido na 252.
- O advisor reclamou de `search_path` mutável nas cinco funções novas.
  Toda função deste projeto precisa nascer com `SET search_path =
  public` (corrigido na 252 e no arquivo da 249).

### O que a Fase 0 deixou em aberto (além do que já estava)

- **Bacia do Rio Iquiri** (Senador Guiomard) ficou NULA: "Iquiri"
  aparece na planilha também como grafia errada do Iaco e do Abunã, e o
  nome não basta para decidir. Campo editável na Fase 2.
- **Altitude de Porto Walter** aparece como 201 m e 192 m para a mesma
  coordenada; adotado 192 m (o das linhas mais recentes).
- **RIPD de geolocalização** (migration 217) precisa citar TRAT-018 na
  próxima revisão — mesmo mecanismo da pendência já registrada na 220.
- `tests/agua-iqa.test.js` **não foi executado** na sessão que o
  escreveu: o ambiente bloqueia a saída para o Supabase e para a
  Vercel. A regressão que ele afirma foi conferida rodando as mesmas
  268 linhas contra a função em produção por outro caminho, e o parser
  do teste foi conferido linha a linha contra a leitura de referência.
  Rodar o arquivo de fato, num ambiente com rede, é o primeiro passo da
  Fase 1.

## Fases seguintes (resumo)

| Fase | Entrega | Depende de |
|------|---------|-----------|
| 1 | Migração das 450 coletas, com **quarentena em vez de descarte** e tela de conferência | Fase 0 |
| 2 | Mesa: cadastro de pontos/laboratórios, lançamento de laudo com PDF anexado, fila de "aguardando laudo" | Fase 0 |
| 3 | App de campo offline-first + shell Capacitor (`app-agua/`) | Fase 2 |
| 4 | `agua-mapa.html` — mapa dedicado | Fase 1; **e obter GeoJSON de hidrografia**, que não existe em `data/` |
| 5 | Relatório automático por bacia, reaproveitando `scripts/gerar-pptx.js` | Fase 1 |

### Notas de desenho já fechadas

- **App de campo serve os dois casos** (técnico que também usa a mesa e
  coletor dedicado): login Supabase por e-mail e senha + PIN, no molde do
  `brigada.html`; tabela de coletores com vínculo opcional ao usuário de
  mesa, como `brigadistas.usuario_id`.
- **Laudo chega por e-mail, de laboratório terceirizado.** O PDF fica
  anexado à coleta **sempre** (bucket privado, URL assinada por
  `js/fotos-privadas.js` — regra do projeto). Faixa de validação por
  parâmetro na digitação: bloqueia o impossível, pede confirmação no
  improvável. Leitura automática do PDF **não** entra na v1 — parser que
  erra em silêncio é pior que digitação.
- **Mapa:** eixo temporal como controle principal; ponto sem coleta na
  campanha aparece **vazado, não some** (a lacuna de monitoramento é
  informação); clique abre **gaveta lateral**, nunca modal com overlay
  (regra do sistema em `pages/mapa.html`); reaproveita
  `js/mapa-recorte.js` inteiro — `geoUCEm()` dá "está dentro de UC?" de
  graça; faixa de `z-index` 600–800 fica livre para o painel funcionar no
  modo tela cheia.
- **O IQA não é a única leitura.** A conformidade CONAMA é uma segunda
  visão, por parâmetro: um rio pode ter IQA "Boa" e violar o limite de
  turbidez. As duas aparecem lado a lado — o índice para a série
  histórica e a comunicação, a conformidade para o papel de fiscalização.

## Decisões ainda abertas (não travam a Fase 0)

- **Sólidos em suspensão** — a incoerência de unidade acima. Entra na
  Fase 1.
- **Quem coleta, nominalmente** — quantas pessoas e de qual setor.
  Dimensiona o cadastro de coletores e a entrada no ROPA. Entra na Fase 3.
- **Hidrografia** — existe shapefile de rios do Acre na SEMA, ou buscar
  na ANA? Entra na Fase 4.
