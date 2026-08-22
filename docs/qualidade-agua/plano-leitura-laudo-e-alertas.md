# Qualidade da Água — leitura automática do laudo + alertas comparativos

Plano arquitetural. Escrito antes de qualquer código, contra o código real
(`pages/agua-laudos.html`, `pages/agua-app.html`, migrations 248–274) e
contra o banco de produção (consultas rodadas nesta sessão, números em §1).

Duas entregas que se sustentam mutuamente e por isso são planejadas juntas:

1. **Ler o PDF do laboratório e propor o preenchimento** do lançamento de
   laudo na mesa (`pages/agua-laudos.html`).
2. **Alertas comparativos no momento do lançamento**, na mesa e no app de
   campo — o sistema comparando o valor digitado com o histórico do próprio
   ponto, com os demais parâmetros da mesma amostra e com a própria
   campanha, para o técnico não gravar dado errado.

A ordem importa: o parser aumenta muito o volume de dado que entra de uma
vez só, sem ninguém digitar número a número. Sem a malha de alertas, isso
é um amplificador de erro — um template mal casado preenche 16 campos
errados em silêncio. **O parser não deve ir a produção antes dos alertas.**

---

## §1 Levantamento contra produção (não é suposição)

Rodado nesta sessão contra `atqtybcsvepdabsvgaly`:

| Fato | Número | Consequência de projeto |
|---|---|---|
| Coletas | 452 (115 `completo`, 337 `quarentena`, **0 `aguardando_lab`**) | A fila de `agua-laudos.html` está **vazia hoje**. A entrega precisa de um caminho de teste próprio (§9), não dá para "ver funcionando" só abrindo a tela. |
| Pontos | 17 | Baseline por ponto é viável e barato (452 linhas — cabe em consulta ao vivo, sem materialização). |
| Coletas por ponto | 13 pontos com 29–33; 3 pontos com 13–14; 1 ponto com 4 | Baseline por ponto **não pode assumir n grande**: precisa degradar para rio/bacia e para a série toda, dizendo qual base usou. |
| DBO preenchida | 310 de 452 (~22 por ponto) | Parâmetro de laboratório tem ~⅔ da amostra do de campo — a estatística por ponto/parâmetro é desigual e o alerta tem de expor o `n`. |
| Laboratórios cadastrados | **1** (ACQUALIMP/QUILAB) | Decide a estratégia do parser (§3.2): um template real vale mais que um extrator genérico. |
| Laudos anexados | **2 PDFs** no bucket `agua-laudos` | Existem amostras reais em produção — são o insumo obrigatório do §9.0. |
| Turbidez | mediana 90 UNT · p05 13 · p95 588 · máx 1002 | A variabilidade natural é enorme (cheia × seca). Faixa fixa global seria inútil; baseline tem de ser **por ponto e estratificado por campanha**. |
| Série | 2016-08 a 2026-10 | 10 anos: há base para estatística robusta na maioria dos pontos. |

---

## §2 Postura: o laudo é prova, não é fonte de dado autocompletável

O PDF do laboratório é o documento que sustenta juridicamente o resultado
(prestação de contas, fiscalização, eventual processo). Isso impõe três
regras que valem para todo o resto deste plano:

1. **Nada entra no banco sem confirmação humana.** O parser **propõe**; o
   técnico confere lado a lado com o trecho extraído e aceita. Preencher
   direto seria trocar um erro de digitação (raro, e que o técnico enxerga)
   por um erro de casamento de template (silencioso, e que ninguém revê).
2. **Toda proveniência fica gravada.** Qual campo veio do parser, de qual
   template/versão, de que página/trecho, e o que o humano alterou depois.
   Sem isso, daqui a dois anos ninguém sabe se um valor esquisito foi
   digitado ou extraído.
3. **Nada de extração por LLM.** Seria uma quarta fonte de verdade, capaz
   de devolver um número plausível que não está no documento — exatamente
   o modo de falha que este módulo inteiro foi construído para impedir
   (a Fase 1 pôs 337 linhas em quarentena em vez de adivinhar unidade).
   A extração é determinística: regex/âncora de tabela sobre a camada de
   texto do PDF, e o que não casar fica em branco, visível.

---

## §3 Arquitetura da leitura do PDF

### 3.1 Onde roda a extração — decisão: **no navegador, com `pdf.js` vendorizado**

| Opção | A favor | Contra |
|---|---|---|
| **Navegador (pdf.js)** ✅ | O PDF já está na mão do técnico; nada sobe antes de ele confirmar; zero infra nova; funciona com o bucket privado como está; nenhuma chave nova | ~1,3 MB de biblioteca vendorizada; extração depende do navegador |
| Edge Function (Deno) | Servidor uniforme | Exige subir o arquivo antes da conferência, deploy novo, e a lib de PDF em Deno é mais frágil que o pdf.js |
| Serviço externo de OCR/extração | "Resolve" PDF escaneado | Manda laudo institucional para fora, chave nova, custo, e §2.3 |

`pdfjs-dist` foi confirmado acessível pelo registro npm nesta sessão (o CDN
`jsdelivr`/`unpkg` está bloqueado pela política de rede — mesma limitação já
documentada nos testes do módulo). Vendorizar em `js/vendor/`, como já foi
feito com jsPDF/pptxgenjs/turf/proj4 — **não usar CDN**.

Carregamento **sob demanda** (só quando o técnico escolhe o arquivo), como
o app de campo já faz com o motor de PDF: `agua-laudos.html` é tela de mesa,
mas não se paga 1,3 MB em quem só está olhando a fila.

### 3.2 O template do laudo vive em TABELA, não em código

`agua_laudo_templates` (por laboratório, versionado, `ativo`):
âncoras de identificação do lab, expressão de casamento por parâmetro,
unidade declarada no laudo, fator de conversão para a unidade do banco,
e como o laudo escreve valor censurado (`<0,1`, `< LQ`, `ND`).

Motivo: é a mesma lição de `agua_limites_conama` (limite em tabela, não em
código) e de `config_sistema.dados` (Encarregado, base legal). Laboratório
novo — ou o QUILAB mudando o layout do relatório — é **INSERT/UPDATE de uma
linha**, feito por quem tem `editar('agua')`, sem migration e sem deploy.
Com regex em JS, cada troca de layout viraria uma sessão de código.

Tela de cadastro: aba nova em `pages/agua-pontos.html` (que já administra
laboratórios) — não uma página nova.

### 3.3 Pipeline (falha em cada etapa é visível, nunca silenciosa)

```
arquivo escolhido
  → 1. camada de texto (pdf.js)     → sem texto? PDF escaneado: avisa e cai no manual (§3.5)
  → 2. identifica o laboratório      → nenhum template casa? avisa, oferece lançar manual
  → 3. CASA A IDENTIDADE DA AMOSTRA  → divergiu? BLOQUEIA o autofill (§3.4)
  → 4. extrai pares parâmetro/valor/unidade
  → 5. normaliza (vírgula decimal, milhar, notação científica, unidade→fator)
  → 6. censurados: "<LQ" → metade do LQ na coluna + LQ em `censurados` (decisão 3 do plano)
  → 7. datas de coleta/recebimento/análise → prazo de preservação (§4.6)
  → 8. tela de conferência lado a lado
```

**Etapa 3 é a que protege tudo.** O parser confere o que o PDF diz sobre
código da amostra, nome/código do ponto e data da coleta contra a coleta
aberta na tela. Divergiu qualquer um: não preenche nada, mostra o que o PDF
diz × o que a coleta diz e pergunta. É a trava contra o erro mais caro
possível aqui — lançar o laudo do ponto A na coleta do ponto B, que passaria
por todos os outros controles sem levantar suspeita.

Normalização de unidade (etapa 5) não é detalhe: é exatamente onde nasceram
as 337 linhas em quarentena da série histórica (mistura g/L × mg/L). O
fator vem do template, e quando a unidade lida no PDF **não bate** com a
declarada no template, o campo é marcado como baixa confiança e não vem
pré-aceito.

### 3.4 Conferência lado a lado — o coração da entrega

Cada parâmetro extraído vira uma linha: **valor atual · valor proposto ·
trecho literal do PDF · unidade lida · confiança**, com aceitar/rejeitar
por campo e "aceitar todos os de alta confiança". Campos com alerta de §4
aparecem já sinalizados aqui — a conferência do parser e a malha de alertas
são a mesma tela, não duas etapas.

Gravação: `agua_coletas.origem_dados jsonb` guarda, por campo, se veio de
`parser`/`digitado`/`corrigido_apos_parser`, o template e a versão. O
gravar continua sendo **exclusivamente** `agua_atualizar_coleta` (migration
270/271), com reautenticação e trilha — o parser não abre caminho novo de
escrita.

### 3.5 Modos de falha previstos (todos com saída manual)

| Falha | Comportamento |
|---|---|
| PDF sem camada de texto (escaneado) | Mensagem explícita ("este laudo é imagem; digite manualmente"). **OCR não entra na v1** — ver §10 |
| Nenhum template casa | Oferece lançar manual e registra o caso para cadastrar template depois |
| Parâmetro no PDF que o banco não tem coluna | Ignorado, listado no rodapé da conferência (evidência de que o laudo traz mais do que o sistema guarda) |
| Identidade divergente | Bloqueia autofill, mostra o confronto |
| Valor não numérico / faixa ("6,0–7,5") | Não preenche; mostra o trecho para digitação |

---

## §4 Alertas comparativos

### 4.1 Taxonomia — seis tipos, e o que cada um faz

| Tipo | Pergunta que responde | Nível | Mesa | App de campo |
|---|---|---|---|---|
| **Físico** (já existe, `agua_valor_plausivel`) | Esse valor existe no mundo? | `impossivel` | **bloqueia** | avisa, nunca bloqueia |
| **Faixa da série** (já existe) | Está fora do range típico da série? | `improvavel` | confirma | avisa |
| **Atípico para o ponto** (novo) | Esse rio, historicamente, dá isso? | `atipico` | confirma | avisa |
| **Coerência interna** (novo) | Os parâmetros da mesma amostra se contradizem? | `incoerente` | confirma | avisa |
| **Erro de unidade** (novo) | Isso parece mg/L lançado como g/L (ou ×1000)? | `unidade` | confirma | avisa |
| **Prazo de análise** (novo, só com laudo) | O laboratório analisou dentro do prazo de preservação? | `prazo` | informa | — |

E, separado de todos eles: **violação CONAMA nunca é alerta de digitação.**
Turbidez de 300 UNT num rio amazônico em cheia é resultado verdadeiro e
grave; tratá-la como suspeita de erro ensina o técnico a ignorar avisos.
Conformidade continua sendo leitura própria (`agua_conama_violacoes`),
exibida em bloco separado, como o painel já faz.

### 4.2 Baseline por ponto — robusto, estratificado e honesto sobre si mesmo

- **Mediana + MAD**, não média + desvio padrão: a série tem outliers reais
  (turbidez p95 = 588 contra mediana 90) e média/DP seriam arrastados por
  eles, alargando a faixa até não alertar nada.
- **Estratificado por `campanha.ordem`** (1ª/2ª), que é o melhor proxy
  disponível do regime hidrológico (cheia × seca) no dado que existe. Sem
  isso, a faixa do ponto é a união de dois regimes e não alerta nada útil.
- **Degradação graciosa e declarada**: `n ≥ 8` na estratificação → usa;
  senão ponto sem estratificar; senão rio/bacia; senão série global. O
  retorno **diz qual base usou e com que n** — "atípico para este ponto
  (mediana 45, n=31)" é acionável; "valor atípico" não é.
- Sem materialização: 452 linhas, consulta ao vivo. Materializar seria
  otimizar o que não dói e criar um cache para envelhecer.

### 4.3 Coerência interna — o que a química da amostra obriga

Relações que, violadas, indicam erro de lançamento (não poluição):

| Regra | Fundamento |
|---|---|
| `escherichia_coli ≤ coliformes_termotolerantes ≤ coliformes_totais` | Subconjuntos por definição |
| `nitratos + nitrogenio_amoniacal ≤ nitrogenio_total` (com folga) | Frações do total |
| `ortofosfato_dissolvido ≤ fosforo_total` | Fração do total |
| `solidos_dissolvidos_totais ≈ 0,55–0,75 × condutividade_eletrica` | Correlação clássica em água doce — o **melhor detector de erro de unidade em sólidos** que este banco permite |
| `condutividade_eletrica` (campo) ≈ `condutividade_especifica` (lab) | Mesma grandeza medida duas vezes |
| `solidos_suspensao_totais` vs `turbidez` (razão fora de ordem de grandeza) | Ataca diretamente a pendência das 337 quarentenas |
| `dbo ≤ carbono_organico_total × k` | Coerência de carga orgânica |
| `od` vs saturação em `temp_amostra` | Já coberto por `agua_valor_plausivel` |
| `ph` muito baixo com `alcalinidade_total` alta | Contradição de tamponamento |

Cada regra vem com folga explícita (não é igualdade exata: são métodos
analíticos diferentes, com incerteza própria) e cita, na mensagem, os dois
valores que se contradizem — nunca só "incoerente".

### 4.4 Contexto de campanha — não gritar durante a cheia

Antes de acusar "atípico para o ponto", olhar os **demais pontos da mesma
campanha**: se a maioria subiu junto, é evento hidrológico, e o alerta é
rebaixado a informativo ("acima do usual, mas 9 dos 12 pontos desta
campanha também subiram"). Sem isso, uma cheia gera 17 alertas simultâneos,
todos falsos, e a malha inteira perde a credibilidade na primeira semana.

### 4.5 Prazo de preservação (só possível porque o PDF é lido)

Com as datas de coleta / recebimento / análise extraídas do laudo, dá para
conferir os prazos de preservação do Standard Methods (coliformes ~24 h,
DBO ~48 h refrigerado, etc.). Estourado, o resultado não é "errado": é
**resultado com validade analítica comprometida**, e isso precisa ficar
registrado na coleta, não descoberto numa auditoria. Alerta informativo, com
os prazos em **tabela** (`agua_prazos_analise`), pelo mesmo motivo de §3.2.

### 4.6 Onde a regra mora (e a exceção deliberada para o app)

- A **regra e os números** moram no banco: `agua_avaliar_coleta(ponto,
  campanha, valores jsonb) → jsonb[]` de alertas, ao lado de
  `agua_valor_plausivel`. Nenhuma tela reimplementa faixa nenhuma — regra
  do projeto (`js/frota-consumo.js`, `js/mapa-recorte.js`).
- O **app de campo é offline-first** e não pode depender de RPC para
  avisar. Exceção documentada: uma view `vw_agua_baseline_ponto` publica os
  **números** (mediana, MAD, faixa, n, base usada) por ponto/parâmetro; o
  app cacheia isso no IndexedDB no sync (17 pontos — poucos KB) e um
  avaliador **fino e único**, `js/agua-alertas.js`, aplica os números.
  A mesa usa o mesmo `js/agua-alertas.js` para renderizar, e a RPC como
  autoridade. O que nunca pode acontecer é limiar escrito em JS.
- Ao sincronizar, o servidor reavalia. Divergência entre o que o app avisou
  offline e o que o servidor conclui não bloqueia nada — anota em
  `quarentena_motivo`, no espírito da Fase 1 (quarentenar, nunca descartar).

### 4.7 A regra que não se negocia

**No app, alerta nunca bloqueia.** "Nada pode impedir o trabalho de campo"
já é regra do sistema (aviso de LGPD, GPS divergente, checklist do Frota).
Na mesa, só `impossivel` bloqueia — como hoje.

---

## §5 Superfícies tocadas (todas na mesma entrega)

| Superfície | O que muda |
|---|---|
| `pages/agua-laudos.html` (mesa) | Parser + conferência lado a lado + malha de alertas |
| `pages/agua-app.html` (campo) | Malha de alertas nos 6 parâmetros de campo, offline, nunca bloqueante |
| `pages/agua-conferencia.html` (mesa) | Mesma malha ao editar linha em quarentena — é a tela que existe para corrigir dado suspeito; seria incoerente ela não avisar |
| `pages/agua-pontos.html` (mesa) | Aba de templates de laudo (§3.2) |

---

## §6 Banco — migration 302 em diante

Numeração conferida contra produção nesta sessão: a última aplicada é
**301**. Rodar `list_migrations` de novo antes de criar (regra do projeto).

1. `agua_coletas.origem_dados jsonb NOT NULL DEFAULT '{}'` — proveniência
   por campo (§3.4). Colunas novas exigem **recriar
   `vw_agua_coletas_detalhe` enumerando as colunas** — armadilha já
   documentada (migration 260): `c.*` expande na criação da view.
2. `agua_laudo_templates` — template por laboratório, versionado, RLS por
   `pode_ver`/`pode_editar('agua')`.
3. `agua_prazos_analise` — prazos de preservação por parâmetro.
4. `vw_agua_baseline_ponto` — mediana/MAD/n/base por ponto × parâmetro ×
   ordem de campanha.
5. `agua_avaliar_coleta(...)` — a malha de §4, `STABLE`, `SET search_path =
   public`, `REVOKE ... FROM anon` explícito (o `ALTER DEFAULT PRIVILEGES`
   do projeto concede EXECUTE a `anon` por nome — lição das 165/249/252b/
   297/299).
6. Se qualquer assinatura existente mudar: **`DROP FUNCTION` antes**, nunca
   `CREATE OR REPLACE` com lista de parâmetros diferente (lição
   173/178/224/297/300).
7. Aplicar em produção na mesma entrega e checar `get_advisors` (security).

---

## §7 Segurança, LGPD e auditoria

- O parser **não** cria caminho de escrita: continua tudo por
  `agua_atualizar_coleta`, com reautenticação e trilha (270/271).
- O PDF continua no bucket privado `agua-laudos`, exibido por
  `js/fotos-privadas.js`. A extração acontece no navegador, sobre o arquivo
  que o técnico já tem — **nenhum dado sai para serviço externo**.
- Laudo traz nome e assinatura de responsável técnico do laboratório (dado
  pessoal de terceiro). Já está coberto pelo bucket privado; a extração não
  deve gravar esses nomes em coluna nova sem entrada no ROPA. Se o
  responsável técnico for capturado, é **entrada nova em
  `lgpd_tratamentos`, na mesma entrega** (regra do projeto).
- `agua_publico_coletas()` (migrations 297/300) **não** ganha `origem_dados`
  nem nada do parser: whitelist de coluna é decisão explícita, nunca
  herdada por acidente.

---

## §8 Guardas

| Teste | O que trava |
|---|---|
| `tests/agua-laudo-parser.test.js` | PDF-fixture real (anonimizado) → valores esperados; identidade divergente **não** preenche; `<LQ` vira metade do LQ + `censurados`; unidade divergente marca baixa confiança |
| `tests/agua-alertas.test.js` | Cada tipo de §4.1 dispara e não dispara; CONAMA **não** vira alerta de digitação; contexto de campanha rebaixa o atípico; baseline degrada e declara a base |
| `tests/agua-app-fluxo.test.js` (existente) | App alerta offline e **salva mesmo assim** |
| Regressão SQL | As 452 linhas de produção não podem virar um mar de alertas: medir a taxa de disparo antes de subir; > ~15% em `atipico` significa limiar mal calibrado, não série ruim |

---

## §9 Faseamento

**§9.0 — bloqueio humano, antes de escrever o parser.** São necessários
**3 a 5 laudos reais** do QUILAB (anos diferentes, de preferência um antigo
e um recente), mais a **lista de LQ por parâmetro** do laboratório. Já
existem 2 PDFs no bucket em produção — começar por eles. Escrever regex sem
amostra real é ficção; é o que separa esta entrega de um protótipo.

1. **Entrega 1 — alertas** (banco + `js/agua-alertas.js` + 3 telas). Vale
   sozinha, sem depender de PDF nenhum, e é a rede de proteção do parser.
2. **Entrega 2 — parser + conferência**, com o template do QUILAB.
3. **Entrega 3 — cadastro de templates** na mesa e prazos de análise.

Como a fila `aguardando_lab` está vazia (§1), a Entrega 2 precisa de um
caminho de teste: gerar coleta de teste em produção com dado sintético e
apagá-la ao final (padrão já usado na Fase 3) ou testar por fixture local.

---

## §10 Fora de escopo (explícito)

- **OCR de laudo escaneado** — infra e custo próprios; primeiro medir
  quantos laudos reais são imagem.
- **Extração por LLM** — §2.3.
- **Múltiplos laboratórios** — a estrutura de template já suporta; só não
  há um segundo laboratório para modelar hoje.
- **Fechar a pendência dos sólidos em suspensão** — os alertas de §4.3
  ajudam a detectar, mas a decisão sobre as 337 linhas continua sendo
  conferência humana com o laudo físico.

---

# Entrega 1 — ENTREGUE (migrations 302/302b)

Malha de alertas comparativos em produção, nas três superfícies. O
parser (Entrega 2) continua bloqueado pelas amostras de laudo (§9.0).

## O que foi construído

| Peça | Onde |
|---|---|
| Escala por parâmetro (log × linear) | `agua_parametro_log()` (302) |
| Valores em formato longo, já filtrados | `vw_agua_valores_longos` (302) |
| Faixa esperada por ponto × parâmetro × campanha | `vw_agua_baseline_ponto` (302) |
| A malha (6 tipos de alerta) | `agua_avaliar_coleta()` (302, corrigida na 302b) |
| Número com vírgula decimal | `agua_num_br()` (302b) |
| Avaliador/renderizador único do cliente | `js/agua-alertas.js` |
| Mesa — lançamento de laudo | `pages/agua-laudos.html` |
| Mesa — conferência de quarentena | `pages/agua-conferencia.html` |
| App de campo (offline) | `pages/agua-app.html` |
| Guarda | `tests/agua-alertas.test.js` (12 testes, todos passando) |

`pwa/sw.js`: agua 19 → 20. `app-agua/scripts/build-www.mjs` atualizado.

## Calibragem: medida contra produção, não arbitrada

A barreira é de Tukey (quartis ± k×IQR) em escala log para os
parâmetros multiplicativos. `k` saiu de medir a taxa de disparo sobre
as 452 coletas reais, separadas pelo que já se sabe delas:

| k | dispara em `completo` (limpas) | em `quarentena` (suspeitas) | razão |
|---|---|---|---|
| 3,0 | **12,2%** | 22,0% | 1,8× |
| 4,0 | 6,1% | 13,9% | 2,3× |
| 5,0 | 1,7% | 8,6% | 4,9× |

Em todos os cortes a barreira dispara ~2× mais na população já
suspeita — o sinal é real, não ruído. **k = 3,0 adotado**: fica sob o
teto de 15% de falso alarme em dado limpo que o plano fixou. Subir
para 4,0 é editar uma linha do CASE se aparecer fadiga de alerta.

## Dois achados de dado, nenhum deles previsto no plano

**1. Ortofosfato dissolvido maior que fósforo total em 273 de 310
coletas (88%).** O ortofosfato é uma FRAÇÃO do fósforo total — a
relação está invertida na série quase inteira. Investigado antes de
concluir: **não é** a conversão PO₄ ↔ P (que daria fator fixo de
3,07); a razão mediana é 8,6, com quartis 2,9 e 30,9 e p90 em 194, e
persiste em todos os anos (4× a 15×, com 2019 em 365×). Ou seja: não é
mudança de unidade num ano, é sistemático. **Não corrigi nada** — é
conferência humana com o laudo físico, exatamente como os sólidos em
suspensão. Fica como pendência nova, do mesmo tipo.

**2. Sólidos em suspensão × turbidez dispara em 52 de 60 coletas
recentes** — todas já em quarentena, todas pelo mesmo motivo. É a
pendência conhecida da Fase 1 (g/L × mg/L) sendo detectada pela regra
nova: confirmação de que o detector funciona, não achado novo.

## Achado de engenharia: view que agrega série não pode ir dentro de laço

`vw_agua_baseline_ponto` custa 200 ms por avaliação (EXPLAIN ANALYZE em
produção). A 302 consultava a view DENTRO do laço de parâmetros — até
22 vezes por chamada, ~4 s por coleta; um lote de 452 estourou o
timeout de 60 s, que foi como o defeito apareceu. A 302b lê uma vez o
baseline do ponto e uma vez o contexto de campanha, ambos em jsonb, e
itera em memória: **750 ms**. Vale para qualquer RPC futura do projeto.

Medida e **não adotada**: unir as duas leituras numa CTE `MATERIALIZED`
leva a 399 ms. Não compensa duplicar o corpo inteiro da função numa
terceira migration — a tela avalia a coleta inteira de uma vez, com
debounce, e 750 ms nessa interação não se distingue de 400 ms. Fica
registrado com o número para quem precisar reabrir.

## Decisões de desenho que valem revisitar antes da Entrega 2

- **Avaliação da coleta INTEIRA, com debounce de 500 ms — nunca uma
  chamada por campo.** As regras de coerência só existem olhando o
  conjunto, e uma RPC por campo multiplicaria por 20 o custo.
- **O app nunca bloqueia, nem em valor fisicamente impossível.** O
  coletor pode estar com a sonda descalibrada a 200 km de Rio Branco;
  perder a coleta é pior que gravar um número que a mesa vai conferir.
  É o teste mais importante da suíte.
- **Promover de quarentena a `completo` exige resolver os bloqueios**
  (`agua-conferencia.html`). Manter em quarentena continua permitido em
  qualquer estado — é o registro de "conferi, o laudo diz isso mesmo".
- **Baseline offline cacheado no store `config` do IndexedDB**, não em
  store nova: evita bump de versão do banco local do app.
- Os rótulos de parâmetro estão em `js/agua-alertas.js` duplicando
  `CONAMA_PARAM_LABEL`/`AGUA_REL_PARAM_LABEL` — o app de campo não
  carrega os outros. Unificar os três é limpeza para outra entrega,
  registrada aqui de propósito.

## Pendências novas para humano (não são código)

1. **Ortofosfato × fósforo total** (achado 1 acima): alguém da SEMA
   precisa conferir com o laudo físico e com o laboratório qual
   grandeza cada coluna guarda. Até lá, a regra alerta — corretamente.
2. Continua valendo a pendência anterior dos **sólidos em suspensão**.

---

# Entrega 2 — ENTREGUE (migrations 304/305/306)

Leitura assistida do laudo em PDF, em produção. Trabalha em cima da
Entrega 1 (alertas comparativos) — a conferência lado a lado usa a
mesma malha para sinalizar valores propostos que fujam do histórico.

## Achado que mudou a arquitetura logo na abertura

Os laudos reais enviados pelo usuário (17 páginas, mesmo lote) são
**100% digitalização de mesa scanner** (Epson Scan 2, 200 dpi) —
**zero objeto `/Font`** no PDF inteiro, confirmado objeto a objeto.
O §3.1 do plano original prevendo "texto extraível, OCR fora do
escopo v1" foi descartado nesta entrega: não existe texto para
extrair. `pdf.js` (renderiza a página em canvas) + `tesseract.js`
(OCR sobre o canvas) substituem o parser de texto que o plano
original desenhou.

## Calibração — medida, não estimada

Gabarito por POSIÇÃO FIXA (fração da página, não busca de texto):
medido nas 17 páginas do lote, a posição de cada linha varia no
máximo ~17 px numa página de 3508 px (300 dpi) — ruído do próprio
scanner, não do conteúdo. Duas descobertas concretas decidiram o
desenho final:

1. **A borda da tabela fica colada acima de cada valor.** Um recorte
   que a inclua faz o Tesseract fundir régua + dígitos num blob só e
   devolver STRING VAZIA — medido: "3,17" virou "" com a borda
   dentro do recorte; sem ela, "3,17" a 87% de confiança. Por isso
   toda caixa do gabarito começa ABAIXO do rótulo (deslocamento
   positivo), nunca em cima.
2. **Casas decimais são constante do TEMPLATE, nunca lidas do OCR.**
   O glifo da vírgula é pequeno demais em 300 dpi para o OCR situar
   com segurança — achado real: célula limpa "3,17" foi lida "3,47"
   (troca 1↔4) num teste de página inteira, sem nenhum sinal de baixa
   confiança que distinguisse o erro dos acertos ao redor. O parser
   lê só os DÍGITOS e insere o separador na posição fixa que o
   template declara (fósforo total e sólidos em suspensão têm 3
   casas nesse laboratório; os demais têm 2 — confirmado visualmente
   em 3 páginas, não inferido de uma só).

Resultado medido, testando o motor de verdade (não uma cópia) contra
os 14 parâmetros × 3 páginas reais: **40 de 42 corretos (95%)** em
teste offline (Python + poppler); **10–11 de 14 (71–79%)** no
navegador real (Playwright + Chromium), a diferença vindo do
decodificador de imagem JPEG do navegador divergir sutilmente do
poppler em casos-limite. Nas duas medições, TODA falha foi
STRING VAZIA — nunca um número errado silencioso nos testes
automatizados (a exceção real observada, sólidos em suspensão lido
0,257 em vez de 0,297, é exatamente por isso que a conferência exige
o recorte da imagem, nunca confia no texto sozinho).

## O que foi construído

| Peça | Onde |
|---|---|
| Gabarito do laboratório (posição + casas decimais) | `agua_laudo_templates` (304) |
| Proveniência por campo (parser/digitado/corrigido) | `agua_coletas.origem_dados` (304) |
| Gabarito calibrado do QUILAB | seed em `agua_laudo_templates` (305) |
| `agua_atualizar_coleta` aceita `origem_dados` | 306 (mudança cirúrgica no corpo, assinatura intacta) |
| Pipeline (render → recorte → OCR → interpretação → identidade) | `js/agua-laudo-ocr.js` |
| `pdf.js` vendorizado (render de página em canvas) | `js/vendor/pdfjs/` |
| `tesseract.js` vendorizado (core LSTM+SIMD, traineddata pt) | `js/vendor/tesseract/` |
| Conferência lado a lado na mesa | `pages/agua-laudos.html` |
| Guarda (pipeline real, navegador real, fixtures reais) | `tests/agua-laudo-parser.test.js` (10 testes) |
| Fixtures — páginas reais extraídas do lote enviado | `tests/fixtures/laudos/*.pdf` |

## Decisões de desenho

- **Extração determinística, nunca por LLM** (mantido do plano
  original) — o laudo é prova; um número plausível que não está no
  papel é o pior modo de falha possível aqui.
- **O recorte da imagem é o que a conferência mostra — nunca o texto
  OCR re-digitado.** Um texto errado reexibido pareceria tão correto
  quanto um certo; a imagem deixa o técnico comparar com o próprio
  olho.
- **Trava de identidade bloqueia autofill, nunca preenchimento
  parcial.** Data ou procedência divergente da coleta aberta: nada é
  proposto, só o confronto aparece. Testado com o cenário que a trava
  existe para pegar (laudo de uma data lançado contra coleta de
  outra).
- **`js/vendor/tesseract/` só tem a variante SIMD** (quase universal
  em navegadores atuais) — sem fallback não-SIMD nesta entrega;
  registrado como limitação conhecida, não bloqueante.
- **Carregamento sob demanda**: ~10 MB entre pdf.js e tesseract.js só
  entram quando o técnico escolhe um PDF, nunca no load normal da
  tela — mesmo padrão do motor de PDF do Biomonitor/Água.
- Sem mudança em `pwa/sw.js`: `agua-laudos.html` é tela de mesa, não
  app de campo — `js/agua-laudo-ocr.js` não entra em nenhum shell.

## Pendências para a Entrega 3 (não bloqueiam esta)

- Cadastro de templates pela mesa (hoje é SQL direto — `agua-pontos.html`
  ganharia uma aba, como o plano original previa).
- `agua_prazos_analise` (prazo de preservação por parâmetro).
- Segundo laboratório: a estrutura já suporta (um template por
  `laboratorio_id`), só não há amostra de um segundo laboratório para
  calibrar.
- OCR não-SIMD (navegador antigo) — sem amostra de necessidade real
  ainda.

---

# Entrega 3 — ENTREGUE (migrations 307/308/308b/309)

Duas das quatro pendências da Entrega 2 eram codificáveis sem dado
novo do usuário; as outras duas (segundo laboratório, OCR não-SIMD)
continuam sem amostra/necessidade real e ficam registradas como estão.

## O que foi construído

| Peça | Onde |
|---|---|
| RPC de edição do gabarito (reauth + justificativa) | `agua_atualizar_laudo_template` (307) |
| Cadastro/edição de gabarito pela mesa | aba "Gabaritos de laudo" em `pages/agua-pontos.html` |
| Prazo de preservação por parâmetro (Standard Methods) | `agua_prazos_analise`, 18 parâmetros seedados (308) |
| `agua_coletas.data_recebimento_laboratorio` | coluna nova (308) |
| A malha do prazo | `agua_prazo_preservacao_alertas()` (308, formatação pt-BR corrigida em 308b) |
| Campo "Recebimento no laboratório" + alerta | `pages/agua-laudos.html` |
| Extração da data de recebimento, com validação de plausibilidade | `js/agua-laudo-ocr.js` (`aguaLaudoExtrairDataPlausivel`) |
| Gabarito do QUILAB ganha o campo `recebimento` | seed (309) |
| Guarda | +2 testes em `tests/agua-laudo-parser.test.js` (12 no total) |

## Decisões de desenho

- **Cadastro de gabarito é um editor de JSON, não um calibrador visual
  de posição.** Medir onde cada campo fica na página de um laudo real
  é trabalho de quem está olhando o PDF (como a Entrega 2 fez para o
  QUILAB) — a tela serve para CADASTRAR o resultado dessa medição, não
  para fazer a medição. Validação de FORMA (top/left/width/height 0–1,
  casas_decimais inteiro) acontece ao vivo, mas não confere se a
  posição está certa contra um laudo de verdade.
- **Editar (não criar) um gabarito passa por reauth + justificativa**,
  mesmo tratamento de `agua_atualizar_ponto`/`agua_atualizar_laboratorio`
  (migration 270) — mudar o gabarito muda o que o parser propõe em
  todo lançamento futuro daquele laboratório, é mudança de
  comportamento do sistema, não cadastro comum.
- **Recebimento no laboratório é proxy de "início da análise"**, não o
  dado real (este laudo não imprime data de análise em si) —
  aproximação FAVORÁVEL: a análise só pode ocorrer depois do
  recebimento, então um alerta disparado por essa conta é piso do
  atraso real, nunca alarme inflado.
- **Recebimento NUNCA entra na trava de identidade (§3.3).** Validado
  com OCR de verdade contra as duas fixtures: dia/mês saem corretos,
  mas o ano erra ocasionalmente um dígito (mesmo modo de falha já
  documentado na Entrega 2) — bloquear autofill por causa desse campo
  geraria falso bloqueio com frequência inaceitável.
  `aguaLaudoExtrairDataPlausivel` só propõe a data quando o ano
  extraído cai num intervalo plausível (2015 até ano atual+1); fora
  disso devolve `null` e o texto lido fica só como referência.
- **Prazo é sempre informativo (nível `informar`), nunca bloqueia** —
  mesmo espírito de toda a malha de alertas: estourar o prazo não é
  "resultado errado", é "resultado com validade comprometida", e isso
  tem de ficar registrado, não impedir o lançamento.
- **Prazos em Standard Methods 24ª ED** (a mesma norma que o laudo do
  QUILAB cita), em tabela — parâmetro de referência normativa, nunca
  código, mesmo motivo de `agua_limites_conama`/`agua_laudo_templates`.
