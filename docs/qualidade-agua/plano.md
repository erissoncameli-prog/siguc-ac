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

## Fase 2 — escopo desta entrega

Depende só da Fase 0 (não da Fase 1) — as duas rodaram em paralelo,
em branches separadas. Próxima migration livre: conferir com
`mcp__Supabase__list_migrations` antes de escrever, **não assumir
254** — a Fase 1 já consumiu a 253 sem que esta entrega soubesse
disso de antemão, e pode haver outra migration entre elas por outro
motivo do projeto.

A mesa: cadastro de pontos/laboratórios com CRUD de verdade (hoje só
existe o seed da Fase 0 — 17 pontos, sem tela para editar ou
cadastrar um 18º), lançamento de laudo de laboratório com PDF
anexado, fila de "aguardando laudo". A entrada do módulo no catálogo
já existe (`modulos.chave = 'agua'`, `rota = '../pages/agua-pontos.html'`),
criada inativa pela Fase 0 — Fase 2 é quem cria essa página de fato e
decide quando ativar.

1. **Cadastro de pontos** (`pages/agua-pontos.html` — a rota já
   registrada). CRUD sobre `agua_pontos_coleta`: código ANA, nome,
   município, rio, bacia, altitude, classe de enquadramento, UC
   relacionada (opcional). **Ponto no mapa na hora de salvar** — nota
   de desenho já fechada mais abaixo neste documento, é o que evita
   repetir o erro da Santa Rosa do Purus (coordenada de outro
   município, só visível olhando o mapa). Ganho de propósito: dá para
   também resolver dois itens que a Fase 0/1 deixaram em aberto —
   bacia do Rio Iquiri (NULA, "Iquiri" é grafia errada do Iaco e do
   Abunã em outras linhas) e marcar `coordenada_conferida = true`
   pontualmente, quando alguém confirmar a posição real de uma
   estação (nenhuma das 17 foi conferida em campo ainda).
2. **Cadastro de laboratórios** — CRUD simples sobre
   `agua_laboratorios`. Serve prestação de contas (qual laboratório
   produziu qual resultado), não tem urgência de desenho.
3. **Lançamento de laudo**: escolher uma coleta com
   `status = 'aguardando_lab'`, preencher os parâmetros de
   laboratório, anexar o PDF do laudo. Faixa de validação por
   parâmetro na digitação — bloqueia o fisicamente impossível (mesmos
   limites que a migration 253 usou para quarentena: pH fora de
   0–14, OD acima da saturação por `agua_od_saturacao()`), pede
   confirmação no improvável. **Não reimplementar esses limites numa
   segunda cópia** — se a Fase 1 codificou o critério em SQL na
   migration 253, extrair para uma função reaproveitável
   (`agua_valor_plausivel()` ou similar) em vez de duplicar em JS; é a
   mesma lição de `js/frota-consumo.js`.
4. **Bucket privado para o PDF do laudo** — não existe ainda
   (`config_logos`/`registros-campo`/`pesquisa-documentos`/`frota-*`
   são os buckets hoje; nenhum é do módulo `agua`). Criar
   `agua-laudos` (privado, `allowed_mime_types` incluindo
   `application/pdf` — o precedente mais próximo é o bucket
   `pesquisa-documentos`, que já mistura PDF com imagem). Reaproveitar
   `js/fotos-privadas.js` para assinar a URL na exibição — **não**
   escrever um assinador novo.
5. **Fila de "aguardando laudo"** — lista de `agua_coletas` com
   `status = 'aguardando_lab'`, ordenada por tempo de espera. Fonte:
   `vw_agua_coletas_detalhe` (Fase 0), que já resolve nome do ponto e
   campanha.
6. **Ativar o módulo por último**, depois que a página existir e
   funcionar: `UPDATE modulos SET ativo = true WHERE chave = 'agua'`.
   Antes disso, nada aparece na sidebar de ninguém (nem de quem tem
   `pode_editar`) — só `super_admin` bypassa, porque `nivel_efetivo()`
   devolve `sem_acesso` cedo quando o módulo está inativo. Isso também
   é a chave que hoje trava `pages/agua-conferencia.html` (entregue na
   Fase 1) para todo mundo além de `super_admin` — as duas telas
   passam a valer no mesmo instante em que este UPDATE roda, então não
   tem por que fazer duas ativações separadas.

### Achado: `biologo` não tem permissão padrão no grupo do módulo — RESOLVIDO

O módulo `agua` nasceu no grupo `'Gestão'` (`modulos.grupo`, Fase 0).
Consultado `grupo_permissoes_padrao` para esse grupo: `super_admin`,
`gestor`, `tecnico`, `diretor`, `chefe_departamento`, `gestor_uc` e
`assistente_admin` têm `editar`; `financeiro`, `visualizador` e
`secretario` têm `visualizar`; `brigadista`, `pesquisador_externo`,
`validador_brigada` e `validador_fauna` têm `sem_acesso` (correto,
não deviam mesmo). `biologo` não tinha linha nenhuma — cairia em
`sem_acesso` por padrão, o mesmo caminho de quem não deveria acessar.

**Confirmado nesta entrega**: `tecnico`/`gestor` (que já têm `editar`
no grupo `'Gestão'`) cobrem quem opera a mesa de Qualidade da Água na
SEMA — `biologo` não é o perfil que faltava. Nenhuma linha nova foi
inserida em `grupo_permissoes_padrao`; o módulo foi ativado
diretamente (migration 256).

## Fase 2 — ENTREGUE (migrations 254–255)

Todos os seis passos do escopo foram construídos e testados contra o
banco de produção, com UMA exceção deliberada: o passo 6 (ativar o
módulo) não foi executado — ver a seção logo abaixo, "O que ESTA
entrega deixou pendente de propósito".

- **`agua_valor_plausivel()`** (migration 254): função pura,
  reaproveitando os mesmos limites que a migration 253 já validou
  contra a série histórica — pH fora de 0–14 e OD acima de 150% da
  saturação (`agua_od_saturacao()`) são `'impossivel'`; pH fora de 4–9
  e OD entre 130–150% de saturação são `'improvavel'` (o teto de ~134%
  de supersaturação plausível medido no refino da Fase 0); os demais
  16 parâmetros de laboratório/campo só têm a checagem genérica de
  não-negatividade — inventar faixa "provável" para eles sem dado de
  série que a sustente seria o mesmo erro que a Fase 0 evitou com os
  sólidos em suspensão. Testada por `execute_sql` direto contra os
  casos conhecidos da migration 253 (pH 16,36 e OD 27 mg/L a 25,3 °C
  → `'impossivel'`, batendo com o que a Fase 1 pôs em quarentena) antes
  de qualquer código de tela existir.
- **Bucket `agua-laudos`** (migration 255): privado desde o
  nascimento (nunca esteve público) — os buckets mais antigos do
  projeto nasceram públicos e só viraram privados numa migration
  posterior; este já nasce do jeito certo. PDF + imagem
  (`application/pdf`, `image/*`), 10 MB, RLS por
  `pode_ver`/`pode_editar('agua')`. Só a mesa escreve (sem o par de
  policy que o Frota precisa para o motorista subir a própria foto) —
  não há app de campo do módulo `agua` ainda.
- **`pages/agua-pontos.html`** (a rota que a Fase 0 já registrava
  inativa): abas "Pontos de coleta" e "Laboratórios", CRUD de verdade
  sobre `agua_pontos_coleta`/`agua_laboratorios`. O ponto aparece num
  mapa Leaflet (OpenStreetMap, sem chave de API) desde a abertura do
  formulário — clique ou arraste o marcador, ou digite lat/lng à mão
  (os dois lados ficam sincronizados) — exatamente para pegar de
  imediato o tipo de erro que a Santa Rosa do Purus só revelou meses
  depois (coordenada de outro município, só visível olhando o mapa).
  Campo `bacia` editável (resolve o Rio Iquiri quando alguém confirmar
  a hidrografia) e `coordenada_conferida` marcável por ponto. Geometria
  gravada como EWKT (`SRID=4326;POINT(lng lat)`) direto do cliente —
  mesmo padrão já usado em produção por `pages/admin-biomonitor.html`
  para a área da praia; não foi necessária RPC nova. Leitura de
  `p.geom` via `geoLatLngDeGeom()` (`js/mapa-recorte.js`) — a mesma
  função que `pages/alertas-ambientais.html` já usa para ler geometria
  de tabela crua, nunca reimplementada aqui.
- **`pages/agua-laudos.html`**: fila de `agua_coletas` com
  `status = 'aguardando_lab'` (lida de `vw_agua_coletas_detalhe`,
  ordenada pela mais antiga), com selo de dias de espera. "Lançar
  laudo" abre um formulário com as duas metades da coleta — Campo
  (para conferir/corrigir, já que é possível editar embora normalmente
  venha preenchido pelo app de campo da Fase 3) e Laboratório (a
  preencher) — mais laboratório responsável e upload do PDF/imagem
  para o bucket `agua-laudos`. Cada campo numérico é checado ao perder
  o foco via RPC `agua_valor_plausivel`; salvar recalcula tudo em
  paralelo (não confia só no evento de blur — colar valor ou
  autopreenchimento não dispara) e BLOQUEIA se algum campo vier
  `'impossivel'`, ou pede confirmação explícita (`confirm()`, mesmo
  padrão já usado em `frota-veiculos.html`) se algum vier
  `'improvavel'`. Ao salvar, o status vira `'completo'` — a view deriva
  IQA e conformidade CONAMA na hora, sem passo extra (conferido por
  `execute_sql`: uma coleta de teste, inserida `aguardando_lab`,
  atualizada exatamente como o formulário monta o payload, saiu com
  IQA 76,23/"Boa" e `conama_conforme = true`).
  Upload segue o MESMO padrão já em produção no Frota
  (`db.storage.from(bucket).upload()` + `getPublicUrl()` grava o
  endereço; quem exibe assina com `js/fotos-privadas.js`,
  `fotoRef()`/`assinarFotos()` reaproveitados sem alteração).
- **Sidebar** (`js/layout.js`): grupo novo "Qualidade da Água" com os
  três links (Pontos e Laboratórios / Lançar Laudos / Conferência —
  esta última já existia da Fase 1, só não tinha entrada na sidebar
  ainda). Sem filtro de `perfis` no grupo, no mesmo padrão do grupo
  "Gestão" — o controle de verdade é `nivel_efetivo('agua')` dentro de
  cada página (como `pages/agua-conferencia.html` já fazia); um perfil
  sem permissão vê o link e recebe a tela de acesso negado, não um
  item de menu ausente. Ícone novo (gota d'água) em `iconePills`.
- **Validação de verdade, não só leitura de código**: as duas páginas
  foram carregadas com Playwright contra um servidor estático local —
  zero erro JS/referência nos scripts próprios (os únicos erros de
  console vieram de CDN bloqueado pelo proxy do ambiente — Supabase JS,
  Leaflet, fontes —, não de código deste repositório); todo recurso
  local (`js/*.js`, `css/*.css`) respondeu 200. Os dois blocos
  `<script>` passaram por `node --check`. `bash scripts/guardrails.sh`
  rodou limpo (0 falhas críticas; os 32 avisos são todos pré-existentes,
  nenhum introduzido por esta entrega). `mcp__Supabase__get_advisors`
  (security) depois das migrations 254/255: nenhum aviso novo.

### Ativação do módulo (migration 256) — feita após confirmação

A pergunta em aberto ("`biologo` precisa de permissão antes de
ativar?") foi respondida: `tecnico`/`gestor` já cobrem quem opera a
mesa. `UPDATE modulos SET ativo = true WHERE chave = 'agua'`
(migration 256) rodou em produção — `pages/agua-pontos.html`,
`pages/agua-laudos.html` e `pages/agua-conferencia.html` (Fase 1)
passam a valer para todo mundo com permissão no grupo `'Gestão'`, não
só `super_admin`. Conferido por `nivel_efetivo()`: um usuário
`tecnico` de teste resolve `'editar'` no módulo `agua` depois do
UPDATE (antes, `sem_acesso`). `get_advisors` (security) depois da
migration: nenhum achado novo.

## Fase 4 — ENTREGUE (sem migration nova; `pages/agua-mapa.html`)

A Fase 3 (app de campo) foi **pulada de propósito** por decisão do
usuário — a Fase 4 entrou primeiro. Nenhuma tabela/coluna nova: a tela
só lê o que as Fases 0–2 já expõem (`agua_pontos_coleta`,
`agua_campanhas`, `vw_agua_coletas_detalhe`). RLS de leitura já estava
coberta por `pode_ver('agua')` — confirmado antes de escrever qualquer
coisa, nenhuma policy nova foi necessária.

- **Eixo temporal = lista real de campanhas**, não um intervalo
  contínuo de anos como em `pages/mapa.html` (`_tlRenderAno`): só
  existem ~20 campanhas no banco (2016–2026, primeira/segunda por ano),
  uma barra de 25 anos ficaria cheia de posições sem dado. Slider por
  índice + botões anterior/próxima, rótulo "AAAA · 1ª/2ª campanha".
- **Ponto sem coleta na campanha fica vazado** (`fillOpacity: 0`, borda
  tracejada, raio igual ao de um ponto com dado) — nunca é removido do
  mapa. Testado com Leaflet real stubado (ver "Validação" abaixo).
- **Clique abre gaveta lateral** (`#amapa-gaveta`, `z-index: 650`,
  dentro da faixa 600–800 documentada em "painéis na tela cheia do
  mapa" no `CLAUDE.md`) — fecha só pelo ✕ (`fecharGaveta()`), nunca por
  clique fora; sem overlay cobrindo o mapa. Elemento static no `<body>`,
  fora do bloco `<script>` de autenticação — mesmo padrão de
  `#malerta-panel`/`#resumo-panel` em `pages/mapa.html`, o que permite
  testar a mecânica da gaveta sem precisar de sessão Supabase real.
- **IQA (preenchimento do marcador) e conformidade CONAMA (cor da
  borda) são dois canais visuais separados** — um rio "Boa" que viola
  turbidez mostra as duas coisas ao mesmo tempo, nunca uma escondendo a
  outra. Terceiro estado tratado à parte: `conama_violacoes IS NULL`
  ("sem limites cadastrados para a classe") não é a mesma coisa que
  conforme — teria virado bug se os dois caíssem no mesmo badge verde.
  `status = 'quarentena'` reduz a opacidade do preenchimento (dado em
  conferência, não escondido). Tudo isso é repetido em texto na gaveta
  — nunca só na cor (regra do projeto).
- **Achado ao validar com os 17 pontos reais**: a "regra do sistema —
  recorte pelo limite do Acre" (sempre ligada, sem toggle, em
  `pages/mapa.html`/`pages/alertas-ambientais.html`) existe porque
  FIRMS/DETER são ingeridos por bounding box e trazem alertas de fora
  do estado sem checagem nenhuma. `agua_pontos_coleta` é o oposto:
  17 pontos cadastrados um a um por servidor da SEMA, com mapa na hora
  de salvar (`pages/agua-pontos.html`). Aplicar o mesmo filtro mesmo
  assim faria Assis Brasil — estação real na fronteira Acre-Peru-
  Bolívia — sumir do mapa: ela cai ~72 m fora do polígono simplificado
  de `data/acre_estado.geojson` (medido com Shapely,
  `geom.exterior.distance(ponto) ≈ 0,00064°`), precisão de polígono, não
  erro de cadastro. `pages/agua-mapa.html` usa `js/mapa-recorte.js`
  (`geoAcreCarregar`/`geoNoAcre`) só para DESENHAR a linha do limite do
  estado (contexto visual) — nunca para descartar um ponto de coleta. A
  UC de cada ponto vem do `uc_id` já cadastrado (autoritativo), não
  recalculada por `geoUCEm()` — evita carregar `uc_acre.geojson` (4,7
  MB) só para confirmar o que o cadastro já sabe.
- **Camada de hidrografia (rios) NÃO entrou nesta entrega.** O plano
  prescrevia buscar a Base Hidrográfica Ottocodificada da ANA
  (SNIRH/dados abertos) e, se a fonte estivesse inacessível, parar e
  documentar em vez de simular a geometria — foi exatamente o que
  aconteceu. Fontes tentadas nesta sessão, todas devolvendo 403 na
  política de rede do ambiente de execução (confirmado por `WebFetch` E
  por `curl` direto ao proxy — `CONNECT tunnel failed, response 403` em
  todas, não um erro de DNS/timeout que sugerisse tentar de novo):
  `portal1.snirh.gov.br` (MapServer ArcGIS REST da ANA, o candidato mais
  promissor — suporta consulta por bbox/UF e devolve GeoJSON direto,
  sem precisar converter shapefile), `dadosabertos.ana.gov.br`,
  `www.ana.gov.br`, `servicodados.ibge.gov.br`, `geoservicos.ibge.gov.br`,
  `dadosabertos.mma.gov.br`, `terrabrasilis.dpi.inpe.br`,
  `sema.ac.gov.br`, `geoaplicada.com`. Domínios de infraestrutura
  (`github.com`, `registry.npmjs.org`, `pypi.org`) continuaram
  acessíveis no mesmo ambiente — não é uma falha de rede genérica, é uma
  política que bloqueia especificamente domínios de dado geoespacial/
  governo não listados. **Pendência explícita para a próxima sessão com
  esses domínios liberados**: baixar a BHO (ou o serviço MapServer da
  ANA, que evitaria a conversão shapefile→GeoJSON), recortar pelo limite
  do Acre reaproveitando `js/mapa-recorte.js`/`data/acre_estado.geojson`
  (script único em `scripts/`, guardado no repo para reexecução, mesmo
  padrão de `scripts/agua_gerar_migration_serie_historica.py`),
  simplificar para peso de arquivo (mapshaper — já testado disponível
  neste ambiente) e só então adicionar a camada com toggle. O mapa
  funciona inteiro sem essa camada; nenhuma geometria foi inventada.
- **Validação de verdade**: as 5 novas linhas de sidebar/ícone
  (`js/layout.js`) e a página foram carregadas com Playwright contra
  servidor estático local. `tests/agua-mapa.test.js` (5 testes) —
  limite do Acre carrega e bate com os 16 pontos não-fronteiriços
  (Assis Brasil documentado à parte, ver acima); `montarMarcadores` não
  descarta ponto curado; gaveta não é modal e fecha só pelo ✕; IQA e
  CONAMA continuam lado a lado em três cenários (violação, conforme,
  sem limites); ponto sem coleta fica vazado sem sumir. Os dois testes
  que dependem de Leaflet de verdade (`unpkg.com`, bloqueado pela MESMA
  política de rede do parágrafo acima) foram confirmados à parte com um
  stub local de `L.circleMarker` — `fillOpacity`/`color`/`dashArray`
  saem exatamente como o código espera (0,92 sólido para completo/
  conforme, 0,5 para quarentena, 0 e tracejado para vazado) — e devem
  passar de verdade em qualquer ambiente com acesso normal ao unpkg.com
  (o mesmo do qual `pages/agua-pontos.html` já depende). `bash
  scripts/guardrails.sh`: 0 falhas críticas, mesmos 32 avisos
  pré-existentes, nenhum novo.
- Sem migration nesta entrega — `mcp__Supabase__list_migrations`
  confirmou a última como `256_agua_ativar_modulo` antes de começar;
  como não foi preciso schema novo, não há `257_*` para aplicar.

## Fase 5 — ENTREGUE (sem migration nova; `pages/agua-relatorios.html`)

Relatório automático por bacia hidrográfica, nos DOIS formatos pedidos
pelo usuário: **PDF** (documento de registro/fiscalização) e **PPTX**
(apresentação executiva), gerados da mesma tela de mesa a partir da
mesma fonte de dados. Fecha o plano original de 5 fases.

### Correção ao que o plano original previa

"Reaproveitando `scripts/gerar-pptx.js`" — investigado antes de
desenhar esta fase: aquele arquivo é o gerador do deck de
**treinamento** do app Brigadas (`node scripts/gerar-pptx.js`, monta
slides com mockup de celular a partir de `tmp/slides-screenshots/`,
ferramenta de desenvolvedor, não algo que um usuário aciona no
navegador). Não é o motor certo para copiar — reaproveitada dele só a
**paleta de cores e convenções visuais** (header escuro + barra
dourada, cards com sombra suave), documentado em
`js/agua-relatorio-pptx.js`. O padrão de verdade para "relatório que o
técnico gera na hora, no navegador" é o do Biomonitor
(`js/biomonitor-relatorio-ninho.js`): timbre oficial via
`getCabecalhoRelatorio()`/`gerarProtocolo()` (js/config-sistema.js),
jsPDF desenhado direto (nunca screenshot/print de HTML), paginação que
nunca corta um bloco no meio. O desenho visual do PDF é copiado desse
padrão (não dá pra chamar as funções de lá, que são específicas de
ninho); a fonte DM Sans embutida (`BIOPDF_FONT_REGULAR_B64`/
`BIOPDF_FONT_BOLD_B64`, `js/biomonitor-pdf-fonts.js`, 150 KB de
base64) é **reaproveitada por `<script src>`, sem cópia** — é só um
recurso de fonte, não lógica de domínio do Biomonitor.

### Fonte única dos dados: `js/agua-relatorio-dados.js`

Nenhum dos dois geradores recalcula IQA/CONAMA — tudo já vem pronto de
`vw_agua_coletas_detalhe` (`agua_calcular_iqa()`/
`agua_conama_violacoes()`, migration 249), mesma lição de
`js/frota-consumo.js` e `js/mapa-recorte.js`. Este arquivo é a ÚNICA
agregação (bacias presentes, campanhas de uma bacia, recorte por
intervalo de campanhas, agrupamento por ponto, resumo), consumida
pelos DOIS geradores — evita a quinta cópia dos rótulos de parâmetro
que já existiam em `agua-laudos.html`/`agua-conferencia.html`/
`agua-mapa.html` (consolidados em `AGUA_REL_PARAM_LABEL`, também
compartilhado entre PDF e PPTX). Funções puras (recebem array já
buscado), separadas das que tocam rede — testável sem sessão Supabase,
mesmo padrão de `montarCorpoGaveta` em `agua-mapa.html`.

- **Sem RPC nova.** O plano original cogitava que agregação por bacia
  "pode genuinamente precisar de SQL"; na prática,
  `vw_agua_coletas_detalhe` filtrada por `ponto_bacia` no cliente
  (`pode_ver('agua')` já cobre a leitura, confirmado antes de escrever
  qualquer coisa) foi suficiente — a agregação em si (agrupar, ordenar
  campanha, somar/calcular média de valores JÁ prontos) não é a
  fórmula do IQA, é só apresentação, e cabe em JS puro sem duplicar
  cálculo nenhum.
- **Um relatório = uma bacia + um recorte de campanhas**, como
  decidido: seletor de bacia (`agua_pontos_coleta.bacia`, com
  **bacia NULA tratada como "Sem bacia definida"**, nunca descartada —
  é o caso do Rio Iquiri, pendência de conferência da Fase 2) + dois
  seletores de campanha (inicial/final, populados só com as campanhas
  que a bacia escolhida realmente tem, ordenados por ano+ordem).
- **Coleta em quarentena aparece MARCADA**, nunca escondida nem
  apresentada como completa: badge no resumo da tela, coluna "Status"
  com destaque em laranja na tabela do PDF, e o texto de aviso deixa
  explícito que o IQA/CONAMA dela é preliminar.
- **Série do IQA nunca omite uma campanha sem coleta** — vira `null`
  (gap no gráfico do PPTX), mesmo espírito do ponto "vazado" da Fase 4.

### PDF (`js/agua-relatorio-pdf.js`)

Capa com KPIs da bacia (pontos, coletas, campanhas, IQA médio,
conformidade CONAMA, quarentena) + aviso de quarentena/violações
quando existem, seguida de uma seção por ponto com tabela
(Campanha/Data/Status/IQA/Faixa/CONAMA) — IQA e conformidade CONAMA
**lado a lado na mesma linha**, nunca um escondendo o outro (regra do
módulo, já em `agua-mapa.html`). Cores da faixa do IQA copiadas por
VALOR de `IQA_FAIXA_COR` (`agua-mapa.html`) — mesma paleta validada
para daltonismo, não uma nova.

### PPTX (`js/agua-relatorio-pptx.js`)

4 slides: capa, resumo (KPIs em cards), evolução do IQA por ponto
(**gráfico de linha nativo do pptxgenjs** — `ppt/charts/chart1.xml`
real dentro do arquivo, não uma imagem rasterizada) e conformidade
CONAMA (tabela de parâmetros violados). Paleta e convenções visuais
copiadas por VALOR de `scripts/gerar-pptx.js` (`C.darkBg`/`C.gold`/
etc.), não a lógica de slide de celular.

### Bibliotecas — vendorizadas, não CDN (deviação documentada)

O padrão do Biomonitor carrega jsPDF/autotable por CDN
(`cdn.jsdelivr.net`); esta entrega vendorizou as DUAS (mesma versão —
jsPDF 2.5.2 + autotable 3.8.4 — só o transporte muda) em `js/vendor/`,
no mesmo padrão de `turf-6.5.0.min.js`/`proj4-2.11.0.min.js`. Motivo:
a pptxgenjs **já precisava** ser vendorizada (`js/vendor/
pptxgenjs-4.0.1.bundle.js`, a partir do bundle de browser em
`node_modules/pptxgenjs/dist/`, mesma versão que
`scripts/gerar-pptx.js` usa) — instrução explícita desta entrega — e
a sessão que construiu isto rodava numa política de rede que bloqueava
`cdn.jsdelivr.net`/`unpkg.com` (mesma restrição já documentada na Fase
4 para Leaflet/hidrografia), então vendorizar jsPDF também foi o que
permitiu **validar de verdade** os dois geradores nesta sessão, em vez
de só ler o código. `jspdf`/`jspdf-autotable` foram instalados
temporariamente via npm só para extrair o bundle UMD (não entraram
como dependência do projeto — mesmo tratamento que turf/proj4, que
também não aparecem no `package.json`). O código de
`js/agua-relatorio-pdf.js` não tem nenhuma dependência de CDN
específica; se algum dia o projeto padronizar em vendorizar tudo (ou
voltar pro CDN), é só trocar as duas linhas de `_agpdfCarregarLibs()`.

### Validação de verdade — arquivos reais, não só "não lançou exceção"

`tests/agua-relatorios.test.js` (Playwright, servidor estático local,
Chromium explícito — mesmo contorno de `tests/agua-app-fluxo.test.js`
para o `chrome-headless-shell` que não vem pré-instalado): 3 testes de
agregação pura (bacia NULA vira "Sem bacia definida"; recorte por
campanha soma certo; série do IQA preenche gap com `null`) + 4 testes
que geram os arquivos de verdade contra uma fixture no formato exato
de `vw_agua_coletas_detalhe` (bacia "Rio Acre" com 2 pontos, 3
campanhas, 1 coleta em quarentena, 1 violação CONAMA, 1 gap de série;
e a bacia NULA/Rio Iquiri, separada):

- **PDF**: aberto de verdade com `pdf-parse` (a lib migrou pra API por
  classe na v2 — `getInfo()`/`getText()`, não a função da v1) — o texto
  extraído bate exatamente com os dados da fixture (nomes dos pontos,
  bacia, IQA, "Quarentena", protocolo, timbre "SEMA-AC"), com 2 páginas
  (capa + pontos). Tamanho real observado: ~27 KB (a fonte embutida
  domina o peso; `compress:true` no jsPDF já reduz bastante).
- **PPTX**: aberto de verdade com `jszip` (PPTX é um zip OOXML) — 4
  partes `ppt/slides/slideN.xml`, `ppt/charts/chart1.xml` presente
  (confirma que o gráfico nativo foi de fato criado, não só chamado), e
  o texto dos slides contém os mesmos dados esperados. ~120 KB.
- As duas bibliotecas de verificação (`pdf-parse`, `jszip`) entraram
  como **devDependencies** (`package.json`) — mesmo tratamento que
  `pptxgenjs` já tinha (usada por `scripts/gerar-pptx.js`, também
  devDependency). O projeto commita `node_modules/` (674 arquivos já
  antes desta entrega — confirmado antes de decidir), então isso soma
  ao repositório; a alternativa (confiar só em "não lançou exceção",
  sem confirmar que o PDF/PPTX abrem e têm o texto certo) não
  atenderia ao pedido explícito de validar de verdade.
- `bash scripts/guardrails.sh`: 0 falhas críticas, mesmos 32 avisos
  pré-existentes, nenhum novo (sem migration nesta entrega, nada pra
  security advisor checar).

### Sidebar e ícone

`js/layout.js`: novo item "Relatórios" no grupo "Qualidade da Água"
(`agua-relatorios.html`, 5º link do grupo) + ícone próprio
(`iconePills['agua-relatorios']`). `js/config.js`: ícone `monitor`
novo em `BICON_PATHS` (tela + suporte, estilo Feather, mesmo padrão de
todos os outros — reaproveitado também no botão "Gerar PPTX" da
tela). Sem mudança em `pwa/sw.js` — página de mesa, não toca nenhum
arquivo compartilhado pelos 3 apps de campo.

### Departamento no timbre — sem override

Diferente do Biomonitor (que sobrescreve `departamento`/`siglaDep`
para "Departamento de Biodiversidade"/DEBIO, decisão registrada na
fase de origem daquele módulo), o relatório da Água usa o
`departamento` PADRÃO de `getCabecalhoRelatorio()` (Departamento de
Unidades de Conservação/DEUC) sem sobrescrever — não foi encontrada,
em `lgpd_tratamentos` (TRAT-018/019) nem no `CLAUDE.md`, nenhuma
atribuição documentada do módulo `agua` a CIGMA ou outro departamento
específico, e inventar um seria o mesmo erro que o projeto já evita em
outras pendências (ex.: bacia do Rio Iquiri). Se a SEMA confirmar a
atribuição correta no futuro, é a mesma troca de duas linhas que o
Biomonitor fez.

### Melhoria pós-Fase 5: filtros de busca (rio, status, faixa do IQA, CONAMA)

Pedido do usuário, feito depois do plano fechado: "inserir mais campos
para busca. tipo por rio, por status e outros". Antes de codar,
analisei os dados reais (`execute_sql` contra produção) pra não supor:
a bacia Purus tem 3 rios (Rio Acre, Rio Iaco, Rio Purus) e Juruá tem 4
— filtrar por rio DENTRO da bacia escolhida é útil de verdade, não
redundante. E 75% das coletas (339 de 450) estão em quarentena — poder
excluir (ou isolar) isso do relatório é um caso de uso concreto, não
cosmético.

Três arquiteturas foram apresentadas ao usuário antes de codar (A:
refinar dentro do fluxo "uma bacia" atual; B: busca livre sem bacia
obrigatória, exigiria redesenhar a capa do PDF/PPTX; C: híbrido, aba
de consulta separada) — escolhida **A**, com os 4 campos: rio, status,
faixa do IQA, conformidade CONAMA.

- **`js/agua-relatorio-dados.js`**: `aguaRelMontar()` ganhou os opts
  `rio`/`status`/`iqaFaixa`/`conamaStatus` — filtram "E" entre si,
  aplicados DEPOIS do recorte por campanha, ANTES de agrupar por
  ponto. O eixo `campanhas` continua vindo do intervalo inteiro (não é
  recalculado pelos filtros de busca) — mesmo espírito do ponto
  "vazado" em `agua-mapa.html`: um filtro que esvazia uma campanha não
  redesenha o eixo temporal. Funções novas: `aguaRelRiosDe()` (rios
  distintos de uma lista de coletas, pra popular o seletor dependente
  da bacia), `aguaRelConamaStatus()` (deriva conforme/violação/sem
  limites — mesmo terceiro estado que `agua-mapa.html` já trata),
  `aguaRelFiltrosTxt()` (texto legível dos filtros ativos,
  compartilhado pela tela E pelos dois geradores — não virou uma
  terceira cópia da formatação).
- **A capa do PDF e do PPTX avisam quando há filtro ativo**
  ("Filtros aplicados: Rio: X · Status: Y") — decisão deliberada: sem
  isso, um documento filtrado poderia ser confundido com "a bacia
  inteira". `_agpptxSlideCapa()` passou a receber o texto de filtros
  como parâmetro extra; `_agpdfCapa()` já tinha acesso a
  `relatorio.filtros` (embutido no retorno de `aguaRelMontar()`, não
  precisou mudar a assinatura de `aguaRelMontarPdf()`).
- **Tela** (`pages/agua-relatorios.html`): 4 selects novos na barra de
  filtros — Rio é repopulado a cada troca de bacia (`aguaRelRiosDe`
  sobre as coletas já carregadas, sem nova consulta); Status/Faixa
  IQA/CONAMA são fixos. Aviso azul (`.alert.alert-info`, classe já
  existente no design system, reaproveitada) mostra os filtros ativos
  com botão "Limpar filtros" acima do resumo, sempre que algum estiver
  setado.
- **Sem RPC/migration nova** — os filtros operam em JS puro sobre o
  que `aguaRelBuscarColetasDaBacia()` já buscou; nenhuma consulta nova
  ao banco.
- **Testes**: `tests/agua-relatorios.test.js` ganhou uma fixture nova
  (`fixtureColetasPurusMultiRio`, 3 pontos em 3 rios da bacia Purus,
  espelhando o dado real que motivou o filtro) cobrindo os 4 filtros
  isolados e combinados, mais 2 testes de geração REAL (PDF e PPTX)
  confirmando que "Filtros aplicados" aparece no documento e que o
  ponto fora do filtro não aparece no texto extraído. 11/11 passando;
  `bash scripts/guardrails.sh` sem novo achado.

## Fase 5 concluída — plano original fechado

Todas as 5 fases do plano original (`docs/qualidade-agua/plano.md`)
estão entregues, aplicadas em produção (onde havia schema) e validadas
com Playwright/`execute_sql` contra o banco real. O que fica pendente,
todo já registrado no lugar certo deste documento, e nenhum é tarefa
de código de uma sessão de Claude Code:

1. **Camada de hidrografia (rios) no mapa** — bloqueada por política de
   rede da sessão que tentou (Fase 4); domínios candidatos já
   identificados (`portal1.snirh.gov.br` da ANA).
2. **Ícone do launcher do app Água** — `app-agua/android` usa o
   placeholder genérico do Capacitor; trocar antes do primeiro APK real
   (Fase 3).
3. **Sólidos em suspensão** — 339 coletas em quarentena por suspeita de
   mistura de unidade (g/L vs mg/L); só alguém da SEMA com o laudo
   físico resolve, pela tela `pages/agua-conferencia.html` (Fase 1).

Nenhuma dessas três é reaberta pela Fase 5. Qualquer trabalho futuro no
módulo — RPC nova, tela nova, App Água com APK — é extensão do que já
está entregue, não retomada de fase.

## Fases seguintes (resumo)

| Fase | Entrega | Depende de |
|------|---------|-----------|
| 1 | Migração das 450 coletas, com **quarentena em vez de descarte** e tela de conferência — escopo detalhado acima | Fase 0 |
| 2 | Mesa: cadastro de pontos/laboratórios, lançamento de laudo com PDF anexado, fila de "aguardando laudo" — escopo detalhado acima | Fase 0 |
| 3 | App de campo offline-first + shell Capacitor (`app-agua/`) — **ENTREGUE**, ver "Fase 3 — ENTREGUE" | Fase 2 |
| 4 | `agua-mapa.html` — mapa dedicado — **ENTREGUE** (sem a camada de hidrografia, ver abaixo) | Fase 1 |
| 5 | Relatório automático por bacia — **ENTREGUE**, ver "Fase 5 — ENTREGUE" | Fase 1 |

### Notas de desenho já fechadas

- **App de campo**: login Supabase por e-mail e senha + PIN, no molde
  do `brigada.html`. ~~Tabela de coletores com vínculo opcional ao
  usuário de mesa~~ — decisão revista na Fase 3: não existe população
  de coletores sem conta administrativa (diferente do Brigadas), quem
  coleta já é usuário de mesa (`tecnico`/`gestor`/`biologo`). Sem
  tabela de identidade nova — ver "Fase 3 — ENTREGUE".
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

## Fase 3 — ENTREGUE (migrations 257–260; `app-agua/`, `pages/agua-app.html`)

App de campo offline-first para a coleta de amostras, no molde do
Brigadas (`pages/brigada.html` + `js/brigada-offline.js` +
`js/brigada-sync.js`, adaptados/simplificados) — login Supabase por
e-mail e senha, PIN de 4 dígitos para reentrada rápida, fila em
IndexedDB, sincronização por `uuid_cliente`.

### A decisão que estava em aberto — RESOLVIDA

"Quem coleta, nominalmente" (pendência registrada acima desde a Fase
0): **o usuário perguntou e respondeu nesta rodada — quem coleta água
hoje são os MESMOS técnicos que já usam a mesa** (perfil
`tecnico`/`gestor`/`biologo`, DIMA/CIGMA), não uma população de campo
sem conta administrativa (diferente do Brigadas, onde essa população
existe de fato e por isso tem `brigadistas` como identidade paralela).

Implicação de desenho: **nenhuma tabela de identidade nova.** O app
loga com a MESMA conta Supabase Auth de `usuarios` que já opera
`pages/agua-pontos.html`/`agua-laudos.html` — `agua_coletas.coletor_id`
(que já existia desde a Fase 0, `REFERENCES usuarios(id)`) é
preenchido com `auth.uid()` direto, sem tabela intermediária tipo
`brigadistas.usuario_id`. `pode_editar('agua')` (já em produção desde a
Fase 0) já é a permissão certa para o app gravar — nenhuma policy nova.

### O que foi construído

- **`pages/agua-app.html`** — shell próprio (sem `gerarLayout()`, como
  os outros 3 apps de campo): login e-mail/senha com cliente Supabase
  isolado (`storageKey: 'siguc-agua-session'`, mesmo padrão do
  Brigadas), PIN de 4 dígitos (hash SHA-256 salgado pelo próprio id do
  usuário, `js/agua-offline.js`), tela Home, **Nova coleta** (ponto de
  uma lista cacheada — nunca digitado —, data/hora, 6 parâmetros de
  campo com checagem de plausibilidade via `agua_valor_plausivel()`
  RPC — a mesma função da Fase 2, nunca reimplementada —, código da
  amostra opcional, foto do ponto, observações), Fila (offline queue),
  Config (trocar PIN, instalar por QR, verificar atualização, aviso de
  privacidade, zerar fila, sair). Só UMA foto por coleta (não até 5
  como o Brigadas) — o app registra o estado do ponto, não uma galeria
  de evidências.
- **`js/agua-offline.js` / `js/agua-sync.js`** — molde direto de
  `brigada-offline.js`/`brigada-sync.js`, simplificado: sem filhos
  (fauna/participantes) porque uma coleta é uma linha só (mesmo desenho
  1:1 de `agua_coletas` desde a Fase 0). Idempotência por
  `uuid_cliente` com `.upsert(payload,{onConflict:'uuid_cliente'})` —
  molde do Brigadas (upsert simples), não da RPC SECURITY DEFINER do
  Frota: aqui não há elevação de privilégio a proteger, o coletor já
  tem `pode_editar('agua')` como usuário de mesa. Mesma lição de Blob
  → base64 antes de gravar no IndexedDB (Blob do IndexedDB fica
  inválido depois que o app vai para background no iOS).
- **Câmera/GPS/marca d'água: `js/brigada-captura.js` reaproveitado sem
  alteração** (o app não escreve captura própria — regra do projeto).
  **GPS é PONTUAL** (`bGpsUmaLeitura()`, `getCurrentPosition`), não
  contínuo como Brigadas/Biomonitor (`watchPosition`) — decisão nova
  desta entrega, documentada no Aviso de Privacidade (migration 259):
  a única leitura de posição serve para comparar com a coordenada
  CADASTRADA do ponto (auditoria da coleta), finalidade pontual por
  natureza, sem uso concreto para indicador de GPS ao vivo na tela.
  Divergência > 1 km entre o GPS do momento e a coordenada do ponto
  vira AVISO não bloqueante (`atualizarDivergenciaGps()`) — "nada pode
  impedir o trabalho de campo" (regra do sistema).
- **Bucket `agua-fotos-campo`** (migration 258) — PRIVADO desde o
  nascimento, diferente de `agua-laudos` (PDF/imagem do laudo,
  lançado pela mesa): fotos de campo são capturadas pelo coletor no
  momento da coleta, mesma família da foto de ocorrência do
  Brigadas/cupom do Frota — conceitos diferentes não dividem bucket,
  mesmo sendo o mesmo módulo. Sem policy dupla tipo Frota (motorista
  sem acesso de mesa): aqui quem coleta já tem `pode_editar('agua')`.
- **`uuid_cliente`/`codigo_amostra`** (migration 257, corrigida pela
  257b): `agua_coletas` ganhou as duas colunas. **Achado ao testar
  contra o banco de verdade**: o índice UNIQUE inicial era PARCIAL
  (`WHERE uuid_cliente IS NOT NULL`, para permitir múltiplas linhas
  NULL das coletas lançadas pela mesa) — mas o Postgres só infere um
  índice parcial como alvo de `ON CONFLICT (coluna)` quando a cláusula
  repete o MESMO predicado, o que o upsert do PostgREST/supabase-js
  não faz. Toda sincronização falharia com "there is no unique or
  exclusion constraint matching the ON CONFLICT specification". Não
  precisava de índice parcial: UNIQUE padrão do Postgres já trata
  múltiplos NULL como não-conflitantes — corrigido na 257b para um
  UNIQUE CONSTRAINT normal.
- **`vw_agua_coletas_detalhe` atualizada** (migration 260) — **achado
  ao validar de ponta a ponta contra o banco**: a view usa `c.*` para
  trazer as colunas de `agua_coletas`, mas `SELECT *` numa view é
  expandido no momento em que ela é CRIADA, não a cada consulta —
  colunas adicionadas depois na tabela base (`uuid_cliente`/
  `codigo_amostra`, migration 257) não apareciam na view até ela ser
  recriada. Sem isso, `pages/agua-laudos.html` nunca veria o código da
  amostra que o coletor escreveu no app. Corrigido enumerando
  explicitamente as colunas de `agua_coletas` (mesma ordem da migration
  248) e acrescentando só `codigo_amostra` no FIM da lista de saída —
  `CREATE OR REPLACE VIEW` só aceita adicionar coluna ao final, nunca
  no meio (`uuid_cliente` ficou de fora de propósito: é chave interna
  do app, sem uso na mesa).
- **Aviso de Privacidade — variante `agua`** (migration 259): mesmo
  mecanismo das migrations 222/223 — uma linha nova em `lgpd_documentos`
  com `app='agua'`, zero migration de schema. **ROPA sem entrada nova**:
  a migration 251 (Fase 0) já tinha registrado TRAT-018 antecipando
  esta fase, e já descrevendo exatamente o padrão adotado (leitura
  pontual, não contínua) — esta entrega só materializa em texto o que
  o ROPA já previa.
- **Infraestrutura do shell nativo pronta, APK NÃO gerado** (regra do
  projeto): `app-agua/` (`capacitor.config.json` com `appId
  br.gov.ac.sema.siguc.agua`, `package.json`, `scripts/build-www.mjs`
  molde do Brigadas, `android/` copiado de `app/android` com o pacote
  Java/`applicationId` renomeados), `.github/workflows/agua-apk.yml`
  (não disparado), `pages/instalar-agua.html`, `pwa/manifest-agua.json`.
  `pwa/sw.js`: novo branch de `APP` por scope
  (`/pages/agua-app.html`), `VERSOES.agua = 1`, `SHELLS.agua`. Ícone do
  launcher Android ainda é o placeholder genérico do Capacitor (sem
  arte própria nesta entrega — não bloqueia o app nascer, só falta
  quando alguém gerar o primeiro APK de verdade).
- **`npm install` + `node scripts/build-www.mjs` rodados de verdade**
  nesta sessão (com `SUPABASE_URL`/`SUPABASE_ANON_KEY` explícitos, já
  que `/api/env` da produção está fora da política de rede do
  ambiente de execução) — confirma que o pipeline de build do app
  nativo funciona de ponta a ponta: transpila para ES2017, embarca
  Supabase UMD + fontes, reescreve `agua-app.html` para `index.html`,
  passa nas checagens de sanidade (nenhum `<script src="/js/…">` sem
  embarcar, nenhum resquício de CDN, credenciais embarcadas).

### Achado ao validar com Playwright — bug real na geração do CSS

`css/agua-app.css` nasceu de um `sed` que trocava o cabeçalho de
`css/brigada.css` (classe raiz `.brigada-app` → `.agua-app`). O
primeiro `sed` assumiu que o comentário de cabeçalho tinha 3 linhas;
na verdade tinha 5. O resultado: as linhas 4–5 do comentário original
sobraram como TEXTO CRU fora de qualquer `/* … */` (a substituição já
tinha fechado um comentário novo, mais curto, na linha 4) — um "radius
ousado, DM Mono nos dados…" solto no meio do CSS, seguido de uma linha
de `───` decorativa. Isso quebrou o parser CSS bem no início do
arquivo, e o parser não voltou a sincronizar antes da regra
`[hidden] { display: none !important; }` — que existe especificamente
para forçar telas escondidas a sumirem mesmo com CSS custom
concorrente. Com essa regra descartada, TODAS as telas do app (login,
PIN, home, formulário…) ficavam com `display` vindo de outras regras
(`.lock-screen{display:flex}` etc.) e apareciam **simultaneamente**,
sobrepostas — só visível checando `getComputedStyle` de verdade
(`hidden=true` mas `display:flex`), não pela leitura do arquivo. Um
bug de produção real, não só de teste — encontrado, isolado com um
harness mínimo (`performance.now()` + log dentro da própria página,
para eliminar o atraso de entrega assíncrona das mensagens de console
via CDP como fonte de confusão) e corrigido regenerando o CSS com a
substituição de cabeçalho correta (5 linhas). Lição para qualquer
`sed`/geração de CSS por script neste projeto: conferir a extensão
REAL do bloco substituído, não assumir pelo número de linhas do
cabeçalho novo.

### Validação

`tests/agua-app-fluxo.test.js` (Playwright, servidor estático local,
`chromium` explícito — o `chrome-headless-shell` que o Playwright
1.61 pediria não está pré-instalado neste ambiente): salva uma coleta
completa (ponto, data, 6 parâmetros, foto com marca d'água real via
canvas do Chromium, código da amostra, observações), confirma a forma
exata do registro no IndexedDB (foto em base64, nunca Blob cru), a
fila mostrando "Pendente", e o badge de contagem; um segundo teste
sobe um cliente Supabase stub (rede real para `*.supabase.co`
bloqueada pelo proxy do ambiente, confirmado por `curl` antes de
escrever o teste) e confere que `aSyncRodar()` monta exatamente o
payload esperado (campanha resolvida, localização em EWKT, nenhum
campo interno do IndexedDB vazando para o banco) e move o registro
para `confirmado`.

**Contrato do lado do banco conferido à parte, contra produção**
(mesmo padrão da Fase 2 — "uma coleta de teste, inserida e conferida
via `execute_sql`", não fabricado em JS): inserida uma coleta com a
forma exata do payload que `js/agua-sync.js` produziria (incluindo o
upsert de campanha por `ano+ordem`, replicado linha a linha), conferido
que `vw_agua_coletas_detalhe` devolve `status='aguardando_lab'` com
todos os campos certos (foi esse passo que revelou a lacuna do
`codigo_amostra`, migration 260) e que a query exata de
`carregarFila()` em `pages/agua-laudos.html`
(`.eq('status','aguardando_lab').order('data_coleta')`) enxerga a
linha. Linha de teste apagada ao final (`DELETE … WHERE uuid_cliente
= …`); a campanha 2026/segunda criada no processo é dado real
(qualquer coleta real desse período a reaproveitaria) e foi mantida.

`mcp__Supabase__get_advisors` (security) depois de cada migration
(257, 257b, 258, 259, 260): nenhum achado novo — mesmos 165 avisos
pré-existentes do projeto. `bash scripts/guardrails.sh`: 0 falhas
críticas, mesmos 32 avisos pré-existentes.

## Pós-lançamento — Painel visual em `pages/agua-relatorios.html`

Fora do plano de 5 fases. A tela de Relatórios era um formulário
(bacia + campanhas + 4 filtros) com 6 KPIs e uma lista de pontos; virou
um **painel** — layout de cards inspirado num modelo de dashboard
trazido pelo usuário (cabeçalho com pílulas à direita, coluna estreita
de KPIs com o primeiro card invertido, medidor semicircular, barras com
o valor rotulado acima, card de lista com ranking). Só o **estilo** veio
do modelo: cores, fontes e componentes são os do design system do
projeto.

O que o painel mostra, e por quê:
- **IQA médio do período** (card escuro) com variação vs. a campanha
  anterior — `aguaRelVariacaoIQA` devolve `null` com menos de duas
  campanhas com índice: sem duas medições não existe tendência, e
  mostrar um chip de "+0" sugeriria estabilidade que ninguém mediu.
- **Coletas no período** (pontos, campanhas, quantas em conferência).
- **Distribuição por faixa do IQA** — barra segmentada, a única leitura
  em que as 5 cores de faixa aparecem juntas. Chips de campanha
  recortam **só a exibição** deste card; o recorte do relatório (e do
  PDF/PPTX) continua sendo o dos filtros do topo.
- **Conformidade CONAMA** em medidor semicircular, com os três estados
  separados (conforme / violação / sem limites cadastrados) — nunca
  substitui o IQA, nem é substituído por ele.
- **IQA médio por ponto** em barras + **parâmetros que mais violaram**
  em ranking; **evolução por campanha** de um ponto (gráfico de linha
  que já existia, com o ponto escolhido por chip).
- A lista de pontos continua embaixo, dizendo explicitamente que é o
  que o PDF/PPTX exportam.

Regras que a entrega respeitou (e que valem para qualquer tela nova do
módulo):
- **Nada de IQA/CONAMA recalculado no cliente.** As agregações novas
  (`aguaRelPorCampanha`, `aguaRelIqaPorPonto`, `aguaRelDistribuicaoFaixas`,
  `aguaRelVariacaoIQA`, `aguaRelViolacoesRanking`) só contam e somam o
  que `vw_agua_coletas_detalhe` já entregou. **Classificar uma MÉDIA
  numa faixa seria recalcular** — por isso as barras de magnitude usam
  uma escala de um tom só (verde institucional) em vez da paleta de
  faixa, e o KPI de IQA médio mostra o número sem rótulo de faixa.
- **Gráfico mora em `js/agua-iqa-visual.js`**, nunca na página:
  `aguaIqaGaugeHTML`, `aguaIqaBarrasHTML` e `aguaIqaFaixasBarraHTML`
  entraram lá, ao lado do `aguaIqaGraficoHTML` que já existia.
- **Coleta em quarentena nunca é escondida**: entra na distribuição,
  esmaece a barra do ponto e continua com selo na lista.

**Paleta do IQA corrigida nesta entrega**: `Péssima` era `#9F1239` e,
contra `Ruim` (`#C2410C`), dava ΔE 12,3 para visão **normal** — abaixo
do piso 15 do validador do skill de dataviz. Nunca tinha aparecido
porque no mapa e no app as duas faixas jamais se encostavam; na barra
segmentada, encostam. Passou a `#86198F` (passa os 5 checks em modo
claro) e o badge de mapa acompanhou (`badge-erro` → `badge-roxo`):
marcador e badge não podem discordar na mesma tela.

Duas armadilhas de layout, resolvidas e documentadas no código:
- `.adash-filtros`/`.adash-pill-n` definem `display`, o que **vence o
  `[hidden]`** de `global.css` (mesma especificidade, folha posterior) —
  precisam de regra `[hidden]` própria.
- Card é `flex-column` esticado pela grade; sem `flex-shrink:0` nos
  filhos, o conteúdo encolhe e **vaza por cima do vizinho** (era o
  rótulo do medidor aparecendo atrás dos chips). O SVG do medidor
  também precisa de `display:block; height:auto` — inline, herda
  `line-height` e a caixa fica mais alta que o desenho.

Guarda: `tests/agua-relatorios.test.js` ganhou 8 testes — 3 de
agregação pura e 5 de render de ponta a ponta, com o cliente Supabase
substituído por stub via `addInitScript` (e o CDN do supabase-js
**bloqueado por `page.route`**, senão ele sobrescreve o stub em máquina
com internet e a página cai no redirect de login). O `require` do
`pdf-parse` virou preguiçoso: ele depende de binding nativo
(`@napi-rs/canvas`) que não carrega em toda máquina, e no topo do
arquivo derrubava a coleta inteira ("No tests found"), levando junto
testes que nada têm a ver com PDF.

`pwa/sw.js`: agua v11 → v12 (`agua-iqa-visual.js` e
`agua-relatorio-dados.js` estão no shell); e brigadas 262 → 263,
biomonitor 30 → 31, frota 86 → 87 porque `js/config.js` (3 ícones
novos: `chevron-down`, `arrow-up`, `arrow-down`) está no shell dos
quatro apps.

### O painel também é a primeira página do PDF

Pedido do usuário logo depois da entrega acima. A capa do relatório era
identificação + 6 números soltos; passou a ser **o mesmo painel**, na
mesma ordem de leitura (KPIs → distribuição por faixa → conformidade
CONAMA + ranking de violações → IQA por ponto → evolução por campanha).
Quem abre o PDF vê o que viu na tela; da página 2 em diante segue o
detalhamento ponto a ponto de sempre.

- **Desenhado com os primitivos do jsPDF**, não exportado da tela:
  rasterizar o SVG exigiria canvas e sairia serrilhado no impresso. Os
  DADOS vêm das mesmas funções de `js/agua-relatorio-dados.js` que
  alimentam o painel — nenhuma agregação nova, nada de IQA/CONAMA
  recalculado.
- Uma diferença deliberada: na tela, a evolução do IQA é de **um ponto**
  escolhido por chip; no PDF não há chip, e um gráfico por ponto encheria
  o documento — imprime-se a **média da bacia por campanha**. Campanha
  sem coleta continua virando GAP (linha quebrada), nunca interpolada.
- O gráfico de barras se limita aos **10 melhores pontos** e o título diz
  "(10 de N)"; o detalhamento das páginas seguintes continua trazendo
  todos.
- O parágrafo "parâmetros com violação: …" saiu: virou o ranking. Só a
  ressalva da quarentena continua em texto — é advertência sobre a
  confiabilidade do dado, não leitura de painel.
- **Bug corrigido de tabela**: `AGPDF_IQA_COR` era uma cópia da paleta
  que havia DIVERGIDO da tela — 'Boa' saía lima (#84CC16) contra o verde
  (#059669) do mapa/app/painel, e 'Péssima' ficou no vermelho antigo
  depois da correção de daltonismo. Agora a cor vem de
  `AGUA_IQA_FAIXA_COR` convertida para RGB, com fallback local só para
  quem carregar o PDF sem o arquivo de visual. Relatório impresso é o
  pior lugar para a cor discordar da tela.
- **Página em branco**: `aguaRelMontarPdf` chamava `_agpdfNovaPagina`
  incondicionalmente depois da capa. Com a capa agora cheia, a nota de
  quarentena pode transbordar sozinha para a folha seguinte — e a
  chamada incondicional inseriria uma folha vazia no meio. Passou a ser
  condicional (`if (ctx.y > AGPDF_TOPO + 2)`), com o teste travando a
  contagem exata de páginas.

Guarda: `tests/agua-relatorios.test.js` — asserções novas no teste de
PDF que já existia (os cinco títulos de bloco, a legenda com contagem,
as médias rotuladas nas barras e a linha do medidor) e um teste novo com
fixture de 12 pontos para a contagem exata de páginas. ⚠️ Detalhe do
texto extraído: a legenda sai colada na seguinte ("…Boa 2Regular 1…"),
então `\b` **não** serve depois do número — usar `(?!\d)`; e títulos de
bloco/seção estão em CAIXA ALTA no documento.

`pwa/sw.js`: agua v12 → v13 (`agua-relatorio-pdf.js` está no shell).

## Decisões ainda abertas (não travam a Fase 0)

- **Sólidos em suspensão** — a incoerência de unidade acima. Entra na
  Fase 1 (pendência de conferência humana, ver `pages/agua-conferencia.html`).
- **Hidrografia** — decisão tomada: buscar na ANA (não usar shapefile
  da SEMA). Tentado na Fase 4 e bloqueado por política de rede da
  sessão que executou — ver "Fase 4 — ENTREGUE" para os domínios já
  identificados (o MapServer ArcGIS da ANA em `portal1.snirh.gov.br` é
  o mais promissor, devolve GeoJSON direto por bbox/UF). Fica pendente
  para uma sessão com esses domínios liberados.
- ~~**Ícone do app Água**~~ — **resolvido.** Arte gerada por IA a partir
  de um prompt calibrado na identidade visual dos outros 3 apps (fundo
  verde-floresta `#0A1A0F`, arco de luz diagonal, ilustração central,
  título + subtítulo, selos de função — molde do Frota, não o badge
  circular do Biomonitor). A imagem bruta veio num canvas preto de
  1254×1254 com o ícone (squircle arredondado) inset; recorte por
  flood-fill de conectividade a partir das bordas (não por chave de
  cor — evita furar áreas escuras internas da própria arte, como o
  cabo preto da sonda) gerou `pwa/icons/icon-agua-512.png` e
  `icon-agua-192.png` (cantos transparentes, uso "any") e
  `icon-agua-maskable-512.png` (fundo `#0A1A0F` full-bleed, conteúdo a
  ~78% de escala — mesma proporção de `icon-frota-maskable-512.png`,
  medida diretamente no arquivo existente) e
  `apple-touch-icon-agua.png` (180×180, achatado sobre o mesmo verde,
  padrão do Biomonitor). `app-agua/scripts/gerar-icones.mjs` — mesmo
  molde sem dependências de `app-frota/scripts/gerar-icones.mjs` — já
  rodou de verdade e substituiu o placeholder do Capacitor em
  `app-agua/android/app/src/main/res/mipmap-*` e nas 11 telas de
  splash. `pwa/manifest-agua.json` passou a apontar para os ícones
  próprios (3 entradas — `any` 192/512 + `maskable` 512, mesmo formato
  do manifest do Frota, não mais o `icon-192.png`/`icon-512.png`
  genérico); `pages/agua-app.html` ganhou o
  `<link rel="apple-touch-icon">` que faltava. `sw.js`: agua v5 → v6.
