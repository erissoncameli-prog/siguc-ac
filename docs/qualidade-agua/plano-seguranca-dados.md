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

**Integridade da própria trilha (honestidade necessária):** um super_admin
com acesso ao painel do Supabase pode editar qualquer tabela, inclusive
esta. Não existe "log inviolável" dentro do mesmo banco. O que dá para
fazer, e que proponho: encadeamento de hash (`hash = sha256(hash_anterior
|| conteúdo da linha)`, carimbado por trigger `BEFORE INSERT`) mais uma RPC
`agua_auditoria_verificar()` que percorre a cadeia e aponta a primeira
linha adulterada ou removida. Não impede a adulteração — **torna-a
detectável**, que é o máximo alcançável sem exportar a trilha para fora do
banco. Se o requisito real for "nem o super_admin pode mexer", isso é uma
conversa sobre destino externo (bucket WORM / outro projeto Supabase) e
deve ser decidido explicitamente, não presumido.

### Camada 2 — Só super_admin lê

```sql
ALTER TABLE agua_auditoria ENABLE ROW LEVEL SECURITY;
CREATE POLICY agua_aud_select ON agua_auditoria FOR SELECT USING (is_super_admin());
-- SEM policy de INSERT/UPDATE/DELETE: quem grava é o trigger (SECURITY DEFINER).
REVOKE INSERT, UPDATE, DELETE ON agua_auditoria FROM authenticated, anon;
```

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

**Granularidade — decisão sua (item 6.1):** por *registro* salvo ou por
*janela de sessão de edição* (uma senha libera N minutos de edição, e cada
gravação da janela registra o mesmo `reauth_prova`). Com 339 coletas em
conferência, "por campo" está fora de questão; minha recomendação é
**janela curta (5 min) na conferência em massa e por registro nas demais
telas**, porque o custo de errar em conferência é baixo (tudo fica na
trilha) e o de travar o trabalho é alto.

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
| 7 | ROPA (TRAT-019) + retenção da trilha | migration LGPD |
| 8 | Testes + `pwa/sw.js` (agua vN→vN+1) | `tests/agua-auditoria.test.js` |

A frente 4 pode rodar em paralelo à 1–3; a 5 depende das duas.

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
| Super_admin adultera a trilha | Hash encadeado + verificador; destino externo é decisão à parte |
| Senha em log de query | Opção A/B evitam; C fica documentada como limitação |
| App de campo quebra offline | INSERT não passa por RPC nem por reauth |
| Conferência em massa fica lenta | Reauth por janela, não por campo |
| Trilha cresce sem controle | `dados_antes/depois` só das colunas do diff em UPDATE (INSERT/DELETE guardam a linha inteira) + política de retenção |
| Cliente antigo em cache quebra | Migration de fechamento sai depois do deploy |

---

## 6. Decisões que preciso de você antes de codar

1. **Granularidade da senha**: por registro salvo ou janela de 5 min?
   (recomendação: janela na conferência, por registro nas demais).
2. **Exclusão**: lógica com justificativa é suficiente, ou o super_admin
   precisa mesmo do expurgo físico?
3. **A trilha precisa ser inviolável até para o super_admin?** Se sim, o
   escopo cresce (destino externo) e vira frente própria.
4. **Escopo**: só Qualidade da Água agora, ou já desenhar o trigger de
   auditoria genérico para reuso em Brigadas/Biomonitor/Frota depois?
   (o desenho acima já é genérico de propósito — muda só quanto se aplica).
5. **Alteração feita pelo próprio app de campo** (correção de coleta ainda
   na fila offline) entra na mesma regra de senha? (recomendação: não —
   enquanto não sincronizou, não há dado no banco para auditar).
