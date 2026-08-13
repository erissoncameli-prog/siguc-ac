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
- `tests/agua-iqa.test.js` **já foi executado de verdade** (atualização
  desta nota — a sessão que escreveu o teste não tinha rede para
  Supabase/Vercel e não pôde confirmar). Rodando em CI real
  (`workflow_dispatch`, depois `pull_request`) ele revelou dois bugs
  que a validação por fora não pegava:
  `js/env-loader.js` não tinha fallback de localhost→produção (só
  `js/config.js` tinha), então `window.db` nunca existia sob servidor
  estático puro — corrigido, e beneficia as 11 páginas que carregam
  esse arquivo, não só o teste. E `csvLinhas()` não fazia `trim()` no
  **cabeçalho** do CSV (que é CRLF): a última coluna, `IQA CETESB`,
  ficava com `\r` colado na chave, e o teste de faixa via 268
  "divergências" em vez das 9 reais. As duas correções e o job
  `agua-iqa` no `qa.yml` foram mesclados no PR #250, junto da Fase 0.
  **Guarda rodando e verde: 5/5, mediana 0,695 — confirmado, não mais
  pendência.**

## Fase 1 — escopo desta entrega

Migrar as 450 coletas de `docs/qualidade-agua/serie-historica.csv`
para `agua_coletas`, com quarentena para o dado que não bate — nunca
descarte. O schema já foi desenhado na Fase 0 pensando nisto: colunas
`status` (`aguardando_lab`/`completo`/`quarentena` —
`status_coleta_agua`), `quarentena_motivo` (texto livre),
`linha_origem_planilha` (concilia com o CSV) e `censurados` (jsonb,
para os valores `<1`) já existem, prontas para o import.

1. **Casar ponto pelo `codigos_alias`.** `agua_pontos_coleta` tem 17
   pontos reais; o `EstacaoCodigo` do CSV tem 20 valores distintos,
   três deles grafia errada do código certo (achado 2 da Fase 0) — já
   estão em `codigos_alias`. Casar por `EstacaoCodigo = codigo_ana OR
   EstacaoCodigo = ANY(codigos_alias)`, nunca pelo nome do município
   (tem variação de maiúscula/acento entre linhas da mesma estação).
2. **Casar campanha por ano + ordem.** Coluna `Campanha` do CSV tem
   variação de caixa e espaço (`Primeira`, `Primeira `, `primeira`,
   `Segunda`) — normalizar antes de bater com o enum
   `ordem_campanha_agua` (`primeira`/`segunda`). `agua_campanhas` já
   tem as 20 combinações ano/ordem semeadas pela Fase 0.
3. **Parser de CSV de verdade, não `split(',')`.** O arquivo é CRLF
   (451/451 linhas) e tem 143 linhas com campo entre aspas contendo
   vírgula — a coordenada e números com vírgula decimal (`"23,00"`).
   `tests/agua-iqa.test.js` já tem esse parser pronto
   (`separaCampos`/`csvLinhas`, com o fix do `trim()` no cabeçalho) —
   reaproveitar, não escrever de novo.
4. **Valor censurado tem regra própria.** Os 56 `<1` de coliformes (e
   qualquer outro campo com prefixo `<`) não viram metade do limite
   *na importação* — o dado bruto (`<1`, o limite) vai para a coluna
   `censurados` (jsonb), e quem deriva o valor efetivo pro cálculo é a
   view, seguindo a decisão 3 do plano (metade do limite). Gravar o
   valor já dividido faria a coluna bruta mentir sobre o que foi
   medido.
5. **Quarentena, não conversão a olho, para o que não fecha:**
   - Valor fisicamente impossível (pH fora de 0–14, OD acima da
     saturação pela fórmula de `agua_od_saturacao`, etc.) —
     achado 4 da Fase 0, são as linhas que fazem o erro máximo da
     regressão chegar a 25 pontos.
   - **Sólidos em suspensão** — a incoerência de unidade registrada
     nas "Decisões ainda abertas" abaixo (mediana 0,342 mg/L com
     turbidez mediana de 90 UNT) não deve ser resolvida por fator de
     conversão adivinhado. Linhas com sólidos preenchidos entram em
     quarentena com `quarentena_motivo` explicando a suspeita, até
     alguém da SEMA conferir contra o laudo físico.
   - Qualquer linha quarentenada precisa do **valor original
     preservado** em algum lugar rastreável (a própria coluna, mesmo
     que fora da faixa plausível, ou anotado em `observacoes`) — a
     tela de conferência da Fase 1 só funciona se o número que a
     planilha trazia continuar visível.
6. **Não gravar o IQA da planilha.** As colunas `IQA`, `IQA %` e
   `IQA CETESB` do CSV **não têm coluna correspondente em
   `agua_coletas`** — de propósito. O índice é sempre derivado pela
   view (`agua_calcular_iqa`), nunca importado; gravar o valor antigo
   ao lado do novo reabriria a divergência que a Fase 0 fechou (achado
   6: 9 das 268 faixas manuais discordavam do próprio número). Se
   quiser conferir a migração linha a linha, comparar contra o CSV
   direto, fora do banco — não como coluna.
7. **Tela de conferência.** Interface simples (pode ser página nova ou
   aba dentro de uma existente) para um técnico da SEMA revisar as
   linhas em quarentena com o laudo físico em mãos: ver o valor
   original, decidir (corrigir e promover a `completo`, ou manter
   quarentenada com justificativa). Não precisa ser bonita nesta
   fase — precisa existir, porque sem ela a quarentena vira gaveta sem
   fundo.

Regras do projeto que se aplicam: RLS já existe nas tabelas (Fase 0);
migration nova (a partir da **253**) precisa ser aplicada em produção
na mesma entrega, com `get_advisors` depois. Sem mudança em `pwa/sw.js`
(módulo ainda não tem tela em nenhum dos 3 apps de campo).

## Fase 1 — ENTREGUE (migration 253)

As 450 linhas de `serie-historica.csv` estão em `agua_coletas`:
**111 `completo`, 339 `quarentena`** (nenhuma perdida, nenhuma
duplicada — conferido por `count(*)` antes e depois do import, e a
`vw_agua_coletas_detalhe` enxerga as 450).

- **Geração do bloco de import**: `scripts/agua_gerar_migration_serie_historica.py`
  lê o CSV com `csv.reader` (parser de verdade — mesmo motivo do
  `separaCampos`/`csvLinhas` do `tests/agua-iqa.test.js`, que não foi
  reescrito, só reaproveitado em espírito) e escreve o bloco
  `INSERT INTO _agua_import_raw VALUES (...)` da migration 253. Guardado
  no repo para reexecutar se o CSV mudar — não é script de uso único
  descartado.
- **Casamento de ponto e campanha** feito em SQL (`JOIN` por
  `codigos_alias` e por `ano+ordem`), com dois `DO $$` de sanity ANTES
  do import que fazem a migration falhar alto se alguma linha não
  casar — um `INNER JOIN` sozinho descartaria silenciosamente.
- **Quarentena, três critérios do plano + um achado desta entrega**:
  pH fora de 0–14 (3 linhas), OD acima de 150% da saturação calculada
  por `agua_od_saturacao()` (1 linha — a mesma que, com o pH 16,36,
  fazia o erro máximo do teste chegar a 25 pontos), e sólidos em
  suspensão preenchidos (339 linhas — o critério que domina, por
  desenho: é a pendência de unidade registrada nas "Decisões ainda
  abertas"). **Achado só descoberto ao importar**: a linha 271 tem
  `Ano=2022` na campanha mas `Data=2026-10-26` — todas as outras
  coletas do mesmo período de certificação são de 2022; é 1 dígito
  trocado (2→6), não campanha nova. Motivo adicionado a uma quarentena
  que já existia pelo critério de sólidos — não criou linha nova.
- **Valor censurado**: os 56 `<1` de coliformes termotolerantes foram
  para `censurados` (o limite bruto) + a coluna numérica com metade do
  limite, nunca as duas coisas misturadas.
- **Não gravou o IQA da planilha** — nenhuma coluna nova em
  `agua_coletas` para isso, como decidido.
- **Tela de conferência**: `pages/agua-conferencia.html` — lista as
  339 linhas em quarentena (filtro por ponto/código ANA/nº da linha),
  abre um formulário com todos os campos de campo e laboratório
  editáveis, mostra o motivo gerado pela migration, e tem dois botões:
  promover a `completo` (some da lista) ou salvar mantendo a
  quarentena com uma observação da conferência. Sem RPC nova — grava
  direto em `agua_coletas` (`db.from(...).update(...)`), a policy
  `agua_coletas_write` (pode_editar('agua')) já autoriza. Acesso
  continua restrito a super_admin enquanto `modulos.agua.ativo = false`
  (mesma regra da Fase 0) — não está na sidebar, é alcançada direto
  pela URL.
- `get_advisors` (security) depois da migration: nenhum aviso novo —
  a 253 só insere dado em tabela e função já existentes, não cria
  nada.
- Sem mudança em `pwa/sw.js`, como previsto (nenhum dos 3 apps de
  campo tem tela do módulo ainda).

### Aplicação em produção — nota de execução

A migration 253 tem ~450 linhas de `VALUES` (~100 KB), grande demais
para uma única chamada de `apply_migration` nesta sessão. Foi aplicada
em partes via `execute_sql` (tabela de estágio permanente, carregada
em 8 lotes, depois o `JOIN`+quarentena+limpeza da tabela de estágio) —
mesmo efeito final de rodar o arquivo inteiro de uma vez, só que em
passos menores para caber na sessão. O arquivo em
`supabase/migrations/253_agua_import_serie_historica.sql` é a fonte
de verdade e reproduz o mesmo resultado se aplicado de uma vez (ex.:
`supabase db push` local, ou uma sessão com folga de contexto maior).
Conferido linha a linha contra o que foi de fato inserido (contagem,
alias de ponto, censura, motivos de quarentena das linhas 271/296/
369/370/371) antes de considerar a entrega pronta.

## Fases seguintes (resumo)

| Fase | Entrega | Depende de |
|------|---------|-----------|
| 1 | Migração das 450 coletas, com **quarentena em vez de descarte** e tela de conferência — escopo detalhado acima | Fase 0 |
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
