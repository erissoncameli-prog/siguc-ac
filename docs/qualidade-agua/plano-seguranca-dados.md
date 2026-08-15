# Qualidade da Água — Segurança e rastreabilidade dos dados (plano)

Status: **PLANEJAMENTO — nada implementado**. Documento de arquitetura para
a próxima missão. Escrito a partir do código em produção (levantamento em
2026-08-15), não de suposição.

Objetivo do usuário (literal): todo dado inserido tem log com data, hora e
autor; log visível só ao super_admin; alteração grava valor anterior e novo
e exige senha; exclusão exige justificativa.

---

## Decisões tomadas (2026-08-15) — não reabrir

1. **Senha por JANELA na conferência** (uma reautenticação libera N minutos
   de edição; cada gravação da janela carimba a mesma prova na trilha) e
   **por registro nas demais telas** (`agua-laudos`, `agua-pontos`).
   Motivo: 339 coletas em quarentena são editadas em lote; senha por
   gravação inviabilizaria o trabalho, e o custo de errar ali é baixo
   porque tudo fica na trilha. Janela sugerida: 5 min, renovável, e
   **invalidada ao trocar de registro por mais de X minutos ociosa** —
   valor a definir na implementação (ver §7).
2. **A trilha tem de resistir ao super_admin.** Ver §2.1 — o requisito se
   divide em dois adversários com respostas diferentes, e só um deles é
   resolvível dentro do banco.
3. **Escopo: só Qualidade da Água por enquanto.** O trigger e a tabela
   nascem genéricos (recebem `tabela`/`registro_id`, não têm nada de
   `agua` na forma), mas **só são ligados às 4 tabelas do módulo**.
   Estender a Brigadas/Biomonitor/Frota depois é `CREATE TRIGGER`, não
   redesenho — e é decisão de outra missão.

---

## 0. O que existe hoje (fatos verificados)

| Fato | Onde | Consequência |
|---|---|---|
| Reautenticação por senha é 100% cliente | `admin-brigadas.html:928`, `pesquisas.html:466`, `js/perfil.js:476` | O banco nunca sabe que houve senha. Chamada direta ao PostgREST pula a verificação. **Não replicar.** |
| Páginas escrevem direto na tabela | `agua-conferencia.html:201`, `agua-laudos.html:269`, `agua-pontos.html:367/411` | Sem RPC não há onde exigir justificativa nem senha. |
| RLS do módulo é `pode_ver`/`pode_editar('agua')` para `FOR ALL` | migration 248, seção 8 | Uma única policy cobre INSERT/UPDATE/DELETE. Precisa ser fatiada. |
| `is_super_admin()` já existe em `public` | banco de produção | Não criar helper novo. |
| `pgcrypto` vive no schema `extensions` | banco de produção | Função com `SET search_path = public` **não enxerga `crypt`** — qualificar `extensions.crypt`. Erro clássico que só aparece em runtime. |
| 451 coletas, 339 em quarentena | `agua_coletas` | A tela de conferência é edição em massa. Senha por campo inviabiliza o trabalho. |
| App de campo é offline-first | `js/agua-sync.js` | **Nenhum controle novo pode depender de rede no caminho do INSERT.** |
| FK `ponto_id`/`campanha_id` são `ON DELETE RESTRICT` | migration 248 | Ponto com coleta já não pode ser apagado. |

---

## 1. Princípios de desenho

1. **O log é do BANCO, não da tela.** Auditoria por *trigger*, nunca por
   "a página lembra de chamar o log". É a mesma lição das migrations 216
   (log do CAR) e 239 (recorte do Acre): a garantia dura vale para
   qualquer rota — mesa, app, sync, `psql`, página futura ainda não escrita.
2. **INSERT não pede senha.** O pedido é "log" para inserção e "senha" para
   alteração. Exigir senha no INSERT quebraria o app de campo offline —
   e um dado novo não destrói nada, um dado alterado sim.
3. **Excluir não é apagar.** Série histórica ambiental é prestação de
   contas. `DELETE` físico vira exceção de super_admin; o fluxo normal é
   exclusão lógica com justificativa.
4. **Justificativa é regra de banco.** Mínimo de caracteres validado no
   servidor (`RAISE EXCEPTION`), não só no `if` do JavaScript.
5. **A trilha é registro de prova**: sem policy de UPDATE/DELETE, como
   `lgpd_aceites` (migration 212).

---

## 2. Arquitetura em 5 camadas

### Camada 1 — Trilha de auditoria (`agua_auditoria`)

Tabela única para as 4 tabelas do módulo (`agua_coletas`,
`agua_pontos_coleta`, `agua_campanhas`, `agua_laboratorios`).

```
id             uuid pk
tabela         text            -- 'agua_coletas'
registro_id    uuid
operacao       text            -- INSERT | UPDATE | DELETE
dados_antes    jsonb           -- NULL no INSERT
dados_depois   jsonb           -- NULL no DELETE
campos_alterados text[]        -- diff calculado no trigger (só UPDATE)
usuario_id     uuid            -- auth.uid()
usuario_nome   text            -- SNAPSHOT do nome no momento
usuario_email  text            -- snapshot
perfil         text            -- snapshot
quando         timestamptz default now()
justificativa  text            -- exigida em UPDATE/DELETE
reauth_prova   jsonb           -- como a identidade foi confirmada (camada 3)
origem         text            -- 'mesa' | 'app' | 'sync' | 'migration'
ip             inet            -- request.headers -> x-forwarded-for
user_agent     text
hash_anterior  text            -- encadeamento (ver "integridade")
hash           text
```

- **Snapshot do nome de propósito**: o log tem de continuar legível se o
  usuário for desativado ou renomeado. `usuario_id` sozinho vira `NULL`
  numa FK `ON DELETE SET NULL` e a trilha perde o autor.
- **`campos_alterados`**: diff calculado no trigger comparando
  `to_jsonb(OLD)`/`to_jsonb(NEW)`, ignorando `atualizado_em` (ruído puro).
  Sem isso, ler 22 parâmetros para achar o que mudou é inviável na tela.
- **Geometria**: `to_jsonb(NEW)` transforma `geometry` em hexadecimal WKB,
  ilegível. Substituir a chave por `ST_AsGeoJSON` no trigger.
- **Índices**: `(tabela, registro_id, quando DESC)` e `(usuario_id, quando DESC)`.
- **`origem` e `ip`** saem de `current_setting('request.headers', true)::jsonb`
  — disponível no PostgREST, `NULL` fora dele (cron/psql), e isso é
  informação, não falha.

### 2.1 Integridade da trilha — dois adversários, duas respostas

Decisão 2 diz "a trilha resiste ao super_admin". Mas "super_admin" no
SIGUC é **um perfil na tabela `usuarios`**, não o dono do painel do
Supabase. São ameaças diferentes e só uma delas se resolve dentro do banco.

**Adversário A — o super_admin do sistema** (entra pelo navegador, JWT
`authenticated`, é o Erisson e quem mais tiver o perfil). Contra ele a
trilha fica **de fato imutável, não apenas auditável**:

- RLS com policy **só de SELECT**; nenhuma de INSERT/UPDATE/DELETE.
- `REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON agua_auditoria FROM authenticated, anon;`
- Quem grava é a função de trigger, `SECURITY DEFINER`, dona `postgres`,
  **sem EXECUTE para `authenticated`/`anon`** (padrão da migration 179).
- Sem RPC de escrita na trilha. Não existe caminho pelo PostgREST.

Isso é garantia dura: o perfil mais alto da aplicação pode ler tudo e não
pode alterar nem apagar uma linha. **É o que a decisão 2 pedia, e está
resolvido.**

**Adversário B — quem tem o painel do Supabase / `service_role`.** Esse
papel ignora RLS por definição; pode reescrever linhas, desligar o trigger
(`ALTER TABLE ... DISABLE TRIGGER`), remover o cron ou dar `TRUNCATE`.
Nenhum controle *dentro* do mesmo banco o alcança — dizer o contrário seria
mentir. A resposta é em duas partes:

1. **Encadeamento de hash** (`hash = sha256(hash_anterior || conteúdo
   canônico da linha)`, carimbado por trigger `BEFORE INSERT`) + RPC
   `agua_auditoria_verificar()` que percorre a cadeia e aponta a primeira
   linha adulterada, reordenada ou removida. Sozinho isso ainda não basta:
   quem reescreve uma linha pode **recalcular a cadeia inteira** a partir
   dali. Falta o ponto fixo externo.
2. **Âncora diária fora do banco** (é isto que fecha o buraco). Um
   `pg_cron` diário publica, para fora do Supabase, um selo com:
   `data`, `total de linhas`, `id e timestamp da última linha`, `hash da
   cabeça da cadeia`. Uma cadeia reescrita passa a **divergir de um selo
   que o adversário não controla**, e a divergência é datada — dá para
   dizer *quando* a adulteração aconteceu.

   Destinos propostos, os dois com infraestrutura que o projeto **já tem**:
   - **E-mail institucional via Resend** (`RESEND_API_KEY` já existe, é o
     mesmo caminho dos alertas ambientais). Cópia numa caixa que o
     administrador do banco não controla, com timestamp do provedor.
     Prova simples e suficiente para uso administrativo.
   - **Commit num arquivo append-only do repositório GitHub** (endpoint
     novo na Vercel, `api/agua-selo.js`, com token de repo). Histórico do
     GitHub é datado e reescrevê-lo é visível. Mais forte que o e-mail e
     mais trabalhoso — **avaliar na implementação; e-mail é o mínimo
     obrigatório, o commit é o desejável.**

   O selo é **público quanto ao hash e mudo quanto ao conteúdo**: não
   vazam dados da trilha, só o resumo criptográfico e as contagens.

3. **Silenciamento também vira anomalia visível.** Desligar o trigger não
   adultera nada — apenas faz a trilha parar de crescer. Por isso o selo
   carrega `total de linhas` e `timestamp da última linha`: um dia sem
   selo, ou um selo com contagem estagnada num período de trabalho normal,
   é o sinal. A tela de auditoria mostra "último selo emitido em…" no topo.

**Limite que fica registrado, porque é real:** com acesso ao `service_role`
é possível apagar a trilha inteira e cancelar o cron. O que o desenho
garante é que isso **não passa despercebido** — o histórico de selos
externos denuncia a lacuna. Imutabilidade absoluta contra o administrador
da própria infraestrutura exigiria escrever a trilha, em tempo real, num
sistema sob outra chave e outro dono (outro projeto Supabase com
credencial separada, ou storage WORM contratado). Isso é decisão
orçamentária e institucional, não de código, e **não está incluída nesta
missão** — mas o encadeamento de hash já deixa a porta pronta: mudar o
destino do selo depois não altera nada do que foi gravado.

### Camada 2 — Só super_admin lê

```sql
ALTER TABLE agua_auditoria ENABLE ROW LEVEL SECURITY;
CREATE POLICY agua_aud_select ON agua_auditoria FOR SELECT USING (is_super_admin());
-- SEM policy de INSERT/UPDATE/DELETE: quem grava é o trigger (SECURITY DEFINER).
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON agua_auditoria FROM authenticated, anon;
```

Ler é privilégio do super_admin; escrever não é privilégio de ninguém pelo
PostgREST. Ver §2.1 — é isto que torna a trilha imutável para o
super_admin do sistema.

Tela: `pages/agua-auditoria.html`, link na sidebar dentro do grupo
"Qualidade da Água" **renderizado só para super_admin** (`js/layout.js` já
recebe o perfil). Filtros por tabela / registro / usuário / período, e
visualização **antes → depois campo a campo**, não dois blocos de JSON
crus. Da tela de detalhe de uma coleta (mesa e app), botão "Histórico
deste registro" — visível só ao super_admin.

### Camada 3 — Senha vinculada ao servidor (o ponto difícil)

O cliente não pode ser a autoridade. Três caminhos possíveis, em ordem de
preferência:

**Opção A — prova via claim `amr` do JWT (preferida, exige validação).**
O cliente reautentica num **cliente Supabase isolado** (nunca no `db` da
sessão de trabalho — `signInWithPassword` rotaciona a sessão e, num app
offline-first, isso é risco real) e usa o token recém-emitido na chamada da
RPC. A RPC verifica em `auth.jwt()` que a última autenticação foi por
`password` e ocorreu há menos de N segundos. Vantagens: a senha nunca passa
pelo nosso código nem pelos nossos logs; zero infraestrutura nova.
**Pré-requisito: confirmar em produção que o `amr` (ou equivalente) está
presente no JWT deste projeto.** Se não estiver, cai para B.

**Opção B — Edge Function `agua-reautenticar` + ticket de uso único.**
A função recebe `{senha, acao, tabela, registro_id}`, valida a senha contra
o GoTrue e, com `service_role`, insere uma linha em `agua_reautenticacoes`
(TTL de ~2 min, uso único, amarrada a usuário + ação + registro). A RPC de
escrita consome o ticket e o marca como usado. A senha trafega por TLS ao
endpoint de auth e não entra em log nenhum nosso.

**Opção C — RPC `SECURITY DEFINER` com `extensions.crypt` contra
`auth.users`.** Funciona e é a mais simples, mas **a senha vira parâmetro
de uma chamada SQL** e pode aparecer nos logs de query do Supabase. Só usar
se A e B estiverem descartados, e com a limitação registrada por escrito.

**Granularidade — DECIDIDO (decisão 1):** janela na conferência, por
registro nas demais telas. Consequências de desenho:

- A janela é **do servidor, não do JavaScript**. Um `_janelaAberta = true`
  no cliente seria o mesmo teatro que se está corrigindo. Na opção A
  (JWT), a janela é a própria validade que a RPC aceita para a
  autenticação por senha; na opção B (ticket), o ticket deixa de ser de
  uso único na conferência e passa a ter `expira_em` + `usos`.
- A janela é **por usuário e por tela** (`acao = 'conferencia'`), nunca um
  passe livre para o módulo inteiro: reautenticar na conferência não pode
  liberar exclusão em `agua-pontos`.
- **Toda gravação da janela carimba `reauth_prova` na trilha**, com o id da
  janela e o horário em que a senha foi de fato digitada. O log tem de
  permitir dizer "estas 40 edições vieram de uma única confirmação às
  14h03" — senão a janela vira um buraco na prova.
- A tela mostra a janela ativa e o tempo restante, e oferece encerrá-la.
  Fechar a página encerra. Ociosidade prolongada encerra (valor em §7).

### Camada 4 — Escrita passa a ser RPC

```
agua_atualizar_coleta(p_id, p_campos jsonb, p_justificativa text, p_prova ...)
agua_excluir_coleta  (p_id, p_justificativa text, p_prova ...)
agua_atualizar_ponto / agua_excluir_ponto        (mesma forma)
agua_atualizar_campanha / agua_atualizar_laboratorio
```

- Validam permissão (`pode_editar('agua')` — **não** ampliam privilégio),
  a prova de reautenticação e a justificativa (mínimo ~20 caracteres,
  no banco).
- Publicam a justificativa/prova em variáveis de sessão
  (`set_config('app.justificativa', …, true)`) que o trigger da camada 1 lê
  — assim o trigger continua sendo o único ponto que grava a trilha.
- `p_campos jsonb` com **lista branca de colunas**: nunca deixar o cliente
  escrever `id`, `criado_por`, `excluido_*`.
- RLS reescrita: `FOR SELECT`/`FOR INSERT` continuam abertas a
  `pode_ver`/`pode_editar`; **`FOR UPDATE`/`FOR DELETE` só ao `postgres`**
  (isto é, via RPC). O INSERT do app de campo segue direto e offline,
  intocado.
- Regra do projeto: se a lista de parâmetros de uma RPC existente mudar,
  `DROP FUNCTION` antes de recriar (lições das migrations 178/224).

### Camada 5 — Exclusão que não perde dado

`excluido_em`, `excluido_por`, `exclusao_justificativa` nas 4 tabelas;
views (`vw_agua_coletas_detalhe`) e todas as telas passam a filtrar. O
`DELETE` físico fica disponível só ao super_admin, por RPC própria, também
com justificativa e também auditado (a linha `dados_antes` da trilha vira o
último vestígio do registro — motivo a mais para o encadeamento de hash).

⚠ `CREATE OR REPLACE VIEW` só aceita **acrescentar** coluna ao final —
enumerar as colunas explicitamente, como já se aprendeu na migration 260.

---

## 3. Frentes de trabalho (ordem sugerida)

| # | Entrega | Toca |
|---|---|---|
| 1 | Trilha + trigger genérico + RLS super_admin + hash encadeado | migration nova |
| 2 | Soft delete nas 4 tabelas + views atualizadas | migration + telas de leitura |
| 3 | RPCs de UPDATE/DELETE + fatiamento da RLS | migration |
| 4 | Reautenticação (opção escolhida) + helper único `js/reautenticar.js` | Edge Function (se B) + JS |
| 5 | Migração das 4 telas de mesa para as RPCs | `agua-conferencia`, `agua-laudos`, `agua-pontos` |
| 6 | `pages/agua-auditoria.html` + link condicionado na sidebar | página nova + `js/layout.js` |
| 7 | **Selo diário externo** (pg_cron → e-mail Resend; commit GitHub se couber) + RPC `agua_auditoria_verificar()` + "último selo" na tela | migration + `api/` |
| 8 | ROPA (TRAT-019) + retenção da trilha | migration LGPD |
| 9 | Testes + `pwa/sw.js` (agua vN→vN+1) | `tests/agua-auditoria.test.js` |

A frente 4 pode rodar em paralelo à 1–3; a 5 depende das duas. A frente 7
depende só da 1 — e **não é opcional**: sem ela o encadeamento de hash
protege contra corrupção acidental, não contra adulteração deliberada (ver
§2.1).

---

## 4. Obrigações do projeto que esta missão precisa cumprir

- **Número da migration vem de `list_migrations` em produção**, nunca do
  que está no repositório local (regra do CLAUDE.md; o repo local já
  divergiu antes).
- Toda função nova nasce com `SET search_path = public` **e**
  `REVOKE EXECUTE ... FROM anon` **pelo nome do papel** (`REVOKE FROM
  PUBLIC` não fecha nada neste projeto).
- Função de trigger não deve ser executável pelo cliente (padrão da
  migration 179).
- Rodar `get_advisors` (security) depois de aplicar.
- **LGPD**: a trilha guarda `usuario_id` + IP + user-agent → entrada nova
  em `lgpd_tratamentos` (TRAT-019, base legal Art. 7º, II — obrigação
  legal de prestação de contas), com prazo de retenção declarado (sugestão:
  5 anos, alinhado à prestação de contas) e coluna `tabelas` apontando
  `agua_auditoria`. Tabela com dado pessoal sem entrada no ROPA é dívida
  na mesma entrega, não depois.
- **Reversibilidade**: o passo que fatia a RLS (frente 3) **derruba as
  telas antigas em cache**. Aplicar na ordem "deploy do código que usa RPC
  → migration que fecha a escrita direta", exatamente como as migrations
  200/210/245 já ensinaram (`_APLICAR_APOS_DEPLOY` no nome do arquivo).

---

## 5. Riscos e como cada um é tratado

| Risco | Tratamento |
|---|---|
| Página nova esquece de logar | Trigger no banco — impossível esquecer |
| Super_admin do sistema adultera a trilha | Impedido: RLS só de SELECT + REVOKE + trigger `SECURITY DEFINER` sem EXECUTE (§2.1, adversário A) |
| Quem tem `service_role` adultera a trilha | Detectável: hash encadeado + selo diário fora do banco (§2.1, adversário B). Impedir exigiria infra sob outra chave — fora desta missão |
| Trigger desligado em silêncio | Selo carrega contagem e data da última linha; estagnação/ausência de selo é o sinal |
| Senha em log de query | Opção A/B evitam; C fica documentada como limitação |
| Janela de senha vira passe livre | Janela por usuário **e por tela**, com prazo do servidor; toda gravação carimba a prova e o horário da senha |
| App de campo quebra offline | INSERT não passa por RPC nem por reauth |
| Conferência em massa fica lenta | Reauth por janela, não por campo |
| Trilha cresce sem controle | `dados_antes/depois` só das colunas do diff em UPDATE (INSERT/DELETE guardam a linha inteira) + política de retenção |
| Cliente antigo em cache quebra | Migration de fechamento sai depois do deploy |

---

## 6. Decisões ainda em aberto (não bloqueiam o início)

1. **Expurgo físico**: exclusão lógica com justificativa é suficiente, ou o
   super_admin precisa mesmo poder apagar de vez? O plano prevê as duas;
   na dúvida, entregar só a lógica — acrescentar o expurgo depois é uma
   RPC, remover um dado apagado não é nada.
2. **Alteração feita pelo próprio app de campo** (correção de coleta ainda
   na fila offline) entra na regra de senha? Recomendação: **não** —
   enquanto não sincronizou não existe dado no banco para auditar, e a
   trava mataria o trabalho offline. Depois de sincronizada, a coleta só
   se altera pela mesa, com as regras de todos.
3. **Destino do selo**: e-mail institucional (mínimo) + commit no GitHub
   (desejável)? Definir qual endereço institucional recebe.

## 7. Detalhes a fixar na implementação

- Duração da janela de senha (sugestão: 5 min) e ociosidade que a encerra
  (sugestão: 2 min sem gravar).
- Tamanho mínimo da justificativa (sugestão: 20 caracteres) — validado no
  banco.
- Retenção da trilha (sugestão: 5 anos) e o que acontece ao expirar:
  **expurgo quebra a cadeia de hash**, então a política tem de ser
  "arquivar o trecho com o selo correspondente", nunca `DELETE` solto.
- Horário do cron do selo (evitar colidir com os crons já existentes).
