# Trilha de auditoria do SIGUC-AC — mapear tudo: escopo, desenho e custo

**Status:** plano para decisão. Nada implementado por este documento.
**Data do levantamento:** 28/08/2026, contra o banco de produção
(`atqtybcsvepdabsvgaly`) e as estatísticas de `pg_stat_user_tables`
acumuladas desde **22/05/2026 (98 dias)**. Todo número aqui foi MEDIDO;
onde há projeção, ela está marcada como projeção e mostra a conta.

---

## 1. O que já existe (não começamos do zero)

| Mecanismo | Onde | O que cobre | Lacuna |
|---|---|---|---|
| `trilha_auditoria` (genérica, trigger + cadeia de hash) | migrations 269/270 | **8 tabelas** de 135: as 4 de permissão + as 4 de Água | 127 tabelas fora |
| `auditoria_acessos` | migration 002 | login/logout/falha, bloqueio por tentativa | só autenticação; tela própria (`historico-acessos.html`) |
| `brigadista_sessoes` / `brigadista_log_atividade` | 049 | sessão e atividade no app Brigadas | não conversa com a trilha |
| `monitor_bio_sessoes` | Biomonitor | sessão do monitor | idem |
| `lgpd_acesso_dado_terceiro` | 216 | **leitura** de CPF/nome do CAR | único ponto do sistema onde SELECT é registrado |
| `trilha_auditoria_selos` + cron diário | 269 | selo da cabeça da cadeia | **gerado e gravado, nunca enviado para fora do banco** |

A arquitetura da 269 já foi desenhada para crescer: ligar uma tabela nova
é `CREATE TRIGGER`, não redesenho. **Este plano é sobre escopo, formato e
custo — não sobre reescrever o motor.**

Três fatos do motor atual que importam para as decisões abaixo:

1. **Serialização global.** O trigger toma `pg_advisory_xact_lock(hashtext('trilha_auditoria'))`
   para não bifurcar a cadeia. Toda escrita auditada do sistema inteiro passa
   por essa fila única. É desprezível a 42 escritas/dia; não é a 24 mil.
2. **Verificação é O(n) sequencial.** `trilha_auditoria_verificar()` recomputa
   o sha256 de *todas* as linhas, em ordem, lendo `dados_antes`/`dados_depois`
   inteiros. A 1.146 linhas é instantâneo; a milhões, deixa de ser operável.
3. **`quando` é a hora da GRAVAÇÃO**, não a do fato. Nos 4 apps offline-first
   isso é a hora do sync, que pode ser dias depois do evento em campo.

---

## 2. O custo, medido

### 2.1 Quanto pesa uma linha de trilha

Medido sobre as 1.146 linhas reais de `trilha_auditoria` hoje:

| Formato | Bytes/linha | Base da medição |
|---|---|---|
| Hoje (snapshot `antes` + `depois` da linha inteira) | **2.836 B** | média real dos 1.102 UPDATEs de `agua_coletas` |
| Hoje, incluindo índices | **~3,4 KB** | 3.896 kB de tabela ÷ 1.146 linhas |
| Só o diff (os campos que de fato mudaram) | **104 B** | mesmas 1.102 linhas, recalculadas |

O UPDATE médio do sistema altera **1,2 campo**. `agua_coletas` tem 49
colunas; `ninhos_quelonios`, 44; `registros_campo`, 48; `frota_viagens`, 46.
Guardar a linha inteira duas vezes para registrar a mudança de um campo é de
onde vem 96% do peso: **o diff custa 3,7% do snapshot**.

### 2.2 Quanto o sistema escreve (98 dias reais)

| Grupo | Tabelas | Escritas/dia | Natureza |
|---|---:|---:|---|
| Ingestão automática (FIRMS, DETER, CAR, PurpleAir, notificações) | 9 | **24.128** | robô, sem autor humano |
| Dado de campo (ninhos, filhotes, biometrias, registros, inspeções) | 16 | **477** | app, com autor |
| Núcleo de responsabilidade (permissão, cadastro, frota, laudo, LGPD) | 38 | **42** | mesa, com autor |

`focos_calor_ac` sozinha responde por 2,2 milhões das 2,4 milhões de escritas
do período. **98,3% do volume de escrita do SIGUC-AC não tem autor humano.**

### 2.3 Projeção anual da trilha, por escopo e formato

| Escopo | Linhas de trilha/ano | Formato snapshot (hoje) | Formato diff |
|---|---:|---:|---:|
| **A** — núcleo de responsabilidade | 15.479 | 50 MB | **9 MB** |
| **A+B** — + dado de campo | 174.116 | 565 MB | **100 MB** |
| **C** — + ingestão automática | 8.806.787 | **28 GB** | 5 GB |

### 2.4 Quanto isso custa em dinheiro

**O ponto de partida não é neutro:** a organização está no plano **Free**, e o
banco já tem **745 MB** — contra a cota de **500 MB** do Free. O projeto está
`ACTIVE_HEALTHY` e em modo leitura-e-escrita hoje, mas já opera acima da cota,
sujeito à política de uso justo. Storage de arquivos: 108 MB de 1 GB.

**A migração para o Pro é uma decisão já vencida, independente da trilha.**

Preços vigentes (Supabase, consultados na documentação oficial em 28/08/2026):

- Pro: **US$ 25/mês** por organização, com US$ 10 de crédito de compute.
- Disco: **8 GB inclusos por projeto**, depois **US$ 0,125/GB/mês** (gp3).
- Egress: 250 GB inclusos, depois US$ 0,09/GB. Storage de arquivos: 100 GB
  inclusos, depois US$ 0,021/GB. Nenhum dos dois é pressionado pela trilha
  (trilha é escrita muito, lida raramente).

Custo **marginal** da trilha, somado ao Pro:

| Cenário | Disco no ano 1 | Disco no ano 5 | Custo marginal/mês |
|---|---:|---:|---|
| A+B, diff (recomendado) | 0,85 GB | 1,2 GB | **US$ 0** — cabe nos 8 GB por mais de uma década |
| A+B, snapshot | 1,3 GB | 3,6 GB | **US$ 0** até ~ano 10 |
| C, diff | 5,7 GB | 26 GB | US$ 0 no ano 1; ~US$ 2,25/mês no ano 5 |
| C, snapshot | 29 GB | 141 GB | ~US$ 2,60/mês no ano 1; **~US$ 16,60/mês no ano 5** |

Em dólar, mesmo o pior cenário é modesto. **Não é o dinheiro que decide o
escopo — é o parágrafo seguinte.**

### 2.5 O custo que não aparece na fatura

1. **Latência da ingestão.** O `pg_advisory_xact_lock` do trigger serializa
   toda escrita auditada. A carga histórica de `focos_calor_ac` foram 953 mil
   INSERTs; auditá-los significa 953 mil aquisições sequenciais do mesmo lock,
   mais ~3 KB de WAL cada. O cron diário de focos passaria de segundos para
   minutos, e uma recarga histórica ficaria inviável. **Custo de compute e de
   janela operacional, não de disco.**
2. **A verificação da cadeia deixa de rodar.** `trilha_auditoria_verificar()`
   é sequencial e recomputa tudo. Com 8,8 milhões de linhas/ano, a única
   garantia real contra o adversário com `service_role` vira uma consulta que
   ninguém consegue esperar terminar. Auditoria que não é verificável não é
   auditoria.
3. **Ruído afoga o sinal.** 8,8 milhões de linhas de robô por ano escondem as
   ~15 mil linhas de ação humana que existem para responder "quem mudou este
   laudo, quando e por quê". Esse é o custo mais caro e o menos visível.
4. **Backup e restauração.** A trilha entra em todo dump e em todo PITR.

---

## 3. As três opções

### Opção 1 — Escopo A: núcleo de responsabilidade
**~38 tabelas · 42 escritas/dia · 9 MB/ano (diff) · US$ 0 marginal**

Tudo que tem consequência jurídica ou administrativa: permissão e lotação (já
coberto), cadastro de pessoas (`usuarios`, `brigadistas`,
`monitores_biodiversidade`, `frota_motoristas`), organograma
(`cargo_ocupacoes`, `unidades_organizacionais`), patrimônio e contrato
(`frota_veiculos`, `frota_contratos_combustivel`, `frota_fontes_recurso`,
`biomonitor_equipamentos`, `biomonitor_cautelas`), documentos e configuração
(`documentos`, `config_sistema`), LGPD, e o que Água já tem.

Responde: *quem deu acesso a quem, quem mudou o contrato, quem trocou o
laudo, quem alterou a configuração institucional.* É o escopo que um TCE ou
a ANPD pede.

**Não responde:** quem alterou o dado científico de campo.

### Opção 2 — Escopo A+B: responsabilidade + dado de campo  ⟵ **recomendada**
**~54 tabelas · 477 escritas/dia · 100 MB/ano (diff) · US$ 0 marginal**

Acrescenta o dado que os apps produzem: `registros_campo`, `ninhos_quelonios`,
`visitas_ninho`, `eclosoes_ninho`, `filhotes_bercario`,
`biometrias_individuais`, `lotes_bercario`, `solturas_filhotes`,
`descartes_ovos`, `frota_inspecoes`, `frota_viagem_passageiros`,
`frota_manutencoes`.

Responde também: *este ninho tinha 120 ovos e agora tem 95 — quem mudou,
quando, e o valor era esse mesmo?* É o que dá defensabilidade científica ao
dado, que é a razão de o Biomonitor existir.

Custo real: 100 MB/ano em disco e ~477 aquisições de lock por dia distribuídas
ao longo do dia — irrelevante para ambos.

### Opção 3 — Escopo C: tudo, inclusive a ingestão automática
**~135 tabelas · 24.128 escritas/dia · 5 a 28 GB/ano**

**Recomendo não fazer**, e a razão não é o preço: é que auditar um robô que
grava o que outro sistema publicou não responde a nenhuma pergunta de
responsabilidade, ao custo de tornar a ingestão lenta e a verificação da
cadeia impraticável (§2.5).

**Substituto proposto, que cobre a mesma preocupação por 1/1000 do volume:**
um log de EXECUÇÃO do ingestor — uma linha por rodada de cron, não por foco:
fonte, janela consultada, quantas linhas vieram, quantas foram descartadas
pelo recorte do Acre, quantas gravadas, duração, erro. São ~20 linhas/dia em
vez de 24 mil, e é o que de fato se quer saber ("por que faltou foco no dia
12?"). Esse log não precisa de cadeia de hash: não há adversário humano.

---

## 4. Decisões de desenho, com recomendação

### 4.1 Formato: diff em vez de snapshot — **híbrido**
`UPDATE` grava só os campos alterados (antes/depois); `INSERT` e `DELETE`
gravam a linha inteira (não há como reconstruir uma linha apagada a partir de
um diff). Guarda 95% da economia sem perder nada que se possa precisar.

**Trade-off honesto:** com diff, reconstruir o estado da linha numa data
passada exige *replay* a partir do estado atual, para trás. Hoje, com
snapshot, basta ler uma linha. A pergunta operacional real ("o que mudou e
quem mudou") é respondida melhor pelo diff; a pergunta "como estava em
01/03" fica mais cara. Se essa segunda pergunta for requisito, a alternativa
é snapshot só nas tabelas do Escopo A (50 MB/ano) e diff no B.

### 4.2 A hora do fato ≠ a hora da gravação
Nos 4 apps offline-first, `quando` registra o sync. Proposta: coluna
`ocorrido_em`, preenchida a partir do carimbo que o cliente já manda
(`registros_campo.data_hora_evento` já existe; `uuid_cliente` já dá a
idempotência), com `quando` preservado ao lado. Sem isso, a trilha vai
"mentir" por omissão sobre o momento do trabalho de campo.

Junto: `origem` hoje só distingue `mesa_ou_app` × `servidor`. Separar em
`mesa` / `app:<slug>` / `cron` / `edge` — a informação existe no
User-Agent e no caminho da chamada, só não está sendo classificada.

### 4.3 Leitura de dado sensível (SELECT) — a lacuna real
Trigger não dispara em SELECT. Registrar leitura só é possível pelo padrão
que a migration 216 já criou: a tela chama uma RPC em vez de `.from().select()`.
Isso tem custo de implementação por tela, então a lista precisa ser **curta e
justificada**. Candidatas: CPF/documento de brigadista e monitor, ficha de
saúde/necessidade de passageiro (dado de saúde, TRAT-017), laudo assinado, e
o CAR (já feito). **Não** propor para leitura agregada ou pública.

### 4.4 Retenção — pendência que depende de decisão humana, não de código
Hoje a trilha nunca expira. Todo número deste documento assume crescimento
perpétuo. Definir prazo (a prestação de contas de 5 anos é a referência usada
no resto do projeto; o dado científico tende a guarda permanente) é decisão de
governança da SEMA, não de uma sessão de desenvolvimento — fica registrada
como pendência, como as 3 pendências de LGPD já registradas no `CLAUDE.md`.

### 4.5 O selo externo continua pendente desde a 269
A cadeia protege contra o super_admin do sistema (resolvido). Contra quem tem
`service_role`, ela só *detecta* — e a detecção depende de um ponto de
referência guardado **fora** do banco, que nunca foi enviado. Caminho viável
sem embutir `SERVICE_ROLE_KEY` num cron: guardar a credencial no Vault do
Postgres e disparar por `pg_net`, ou publicar o selo diário num destino
público de escrita-única. É trabalho pequeno e destrava a única garantia que
hoje está pela metade.

### 4.6 Onde isso aparece na tela
Sem superfície, trilha é só custo. Três lugares, em ordem de valor:
1. **"Histórico deste registro"** no detalhe de cada cadastro — é onde a
   pergunta nasce. Um componente único (`js/trilha-historico.js`), nunca uma
   cópia por página, na mesma disciplina de `js/frota-consumo.js`.
2. **Página "Trilha de auditoria"** (mesa, só super_admin) — filtro por
   pessoa, tabela, período; botão de verificar a cadeia; estado do selo.
3. **Linha do tempo por pessoa** — unificando `auditoria_acessos`,
   sessões de app e trilha, que hoje são quatro registros que não se falam.

---

## 5. Entrega proposta (se a Opção 2 for aprovada)

| Fase | Conteúdo | Migrations |
|---|---|---|
| 1 | Formato híbrido diff/snapshot + `ocorrido_em` + `origem` classificada. Retrocompatível: as 8 tabelas já ligadas continuam funcionando. | 1 |
| 2 | Escopo A — ligar as ~30 tabelas restantes de responsabilidade. Só `CREATE TRIGGER`. | 1 |
| 3 | Telas: componente "Histórico deste registro" + página da Trilha. | 0 |
| 4 | Escopo B — ligar as 16 tabelas de dado de campo, com a coluna de hora do fato já pronta da Fase 1. | 1 |
| 5 | Log de execução do ingestor (substituto do Escopo C) + envio do selo externo. | 1–2 |
| 6 | Leitura de dado sensível (§4.3), lista curta, uma RPC por caso. | 1 |

Fases 1 e 2 já entregam o valor de auditoria administrativa. As demais são
incrementais e nenhuma depende de reescrever o que já existe.

## 6. O que precisa de decisão antes de codar

1. **Escopo:** 1, 2 ou 3 (recomendação: **2**).
2. **Formato:** híbrido diff/snapshot (recomendação) ou snapshot integral no
   Escopo A pela pergunta "como estava na data X".
3. **Retenção:** prazo de guarda da trilha — decisão de governança.
4. **Plano Supabase:** a migração para o Pro já é necessária hoje (745 MB
   contra 500 MB de cota do Free), independentemente desta entrega.
5. **Lista de leituras sensíveis** (§4.3), se a Fase 6 entrar.
