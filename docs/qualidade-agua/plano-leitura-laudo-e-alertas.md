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
