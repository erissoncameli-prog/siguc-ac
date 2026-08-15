# Acesso por organograma — arquitetura de permissão do SIGUC

Status: **PLANEJAMENTO — nada implementado.** Documento de arquitetura.
Levantamento feito contra o banco de **produção** em 2026-08-15, não contra
o repositório.

Pedido: ligar o organograma da SEMA aos módulos (Frota, Biomonitor,
Brigadas, Água…), de modo **robusto**, servindo a **todos os módulos
futuros**, e com **mudança de organograma sem mexer no código**. Mais um
mecanismo para quem **não é do setor** poder acessar um módulo quando
houver motivo.

---

## Decisões tomadas (2026-08-15) — não reabrir

1. **Restrição por setor é o padrão.** Confirmada a leitura do §6.5: o
   acesso passa a ser concedido pela **lotação**, e o perfil vira **teto**,
   não concessão (`nivel = min(capacidade, alcance)`). A missão inclui as
   frentes 1–2 e 4, não só o credenciamento.
2. **Quem libera exceção é o super_admin.** O credenciamento (§2.3) é
   concedido **apenas por `super_admin`** — não pelo chefe da unidade dona
   do módulo. Resolve o §6.3 na versão mais restritiva, que é a certa para
   começar: `concedido_por` já fica gravado, então delegar isso a chefes
   depois é ampliar uma checagem, não redesenhar. Continua valendo tudo do
   §2.3: prazo obrigatório, justificativa obrigatória, nunca acima do teto
   do perfil, auditado, com aviso de vencimento.
3. **A virada é módulo a módulo, com impacto medido antes** (§4). Nenhuma
   entrega desta missão muda o acesso de ninguém até alguém ligar
   `exige_lotacao` num módulo específico.

Segue em aberto, e **é trabalho humano, não de código** (§6.1 e §6.2):
lotação dos 20 servidores de mesa e qual unidade é dona de cada módulo.
**Isso não bloqueia o início** — as frentes 1, 2, 3, 6 e 9 constroem o
mecanismo inteiro com `exige_lotacao = false`, sem alterar o comportamento
atual do sistema para ninguém.

---

## 1. Diagnóstico — o que o banco mostra

### 1.1 O organograma já existe. E está desligado da permissão.

`unidades_organizacionais` (25), `cargos` (25), `cargo_ocupacoes` (18),
`delegacoes_temporarias` (0) **estão em produção** — o `CLAUDE.md` ainda
lista o Módulo A como "a implementar". A árvore está montada e correta:

```
SECRETARIA
├── DIMA ──────── DEUC ── DUC ── (9 núcleos de UC) │ DIGAIS ── UGAI-ANTIMARY
│                 DEBIO ── DIVBIO
│                 DERHQA ── DIVRH
│                 DEFLOR · DESIL · JURIDICO
├── DAF ───────── DITLOG   (Transporte e Logística)
└── CIGMA
```

**Mas `nivel_efetivo()` — a função que decide todo acesso — nunca consulta
nenhuma dessas tabelas.** O organograma hoje é documentação: bonito na
tela de Estrutura Organizacional, inerte na hora de autorizar.

### 1.2 Falta a peça que liga pessoa → setor: **lotação**

`usuarios` **não tem coluna de unidade organizacional**. Tem `cargo` como
**texto livre** e `uc_id`. O único vínculo pessoa→estrutura é
`cargo_ocupacoes`, e ele modela **chefia, não lotação**: são 25 cargos
para 25 unidades — exatamente 1 por unidade, o titular. Resultado:

| | |
|---|---|
| Usuários ativos | **69** (49 brigadistas de campo + **20 de mesa**) |
| Com cargo vigente (= chefes) | **10** |
| Com `uc_id` | 5 |
| Lotações registradas | **0 — a tabela não existe** |

Ou seja: **não há como derivar "de que setor é esta pessoa" para metade da
mesa.** Cargo (quem chefia) e lotação (quem trabalha onde) são coisas
diferentes, e só a primeira está modelada. Esta é a peça que falta.

### 1.3 Hoje quem concede acesso é o PERFIL, e ele é global

`nivel_efetivo()` resolve nesta ordem: super_admin → override individual →
padrão perfil×módulo → padrão perfil×grupo → sem_acesso. Nada disso conhece
setor. Consequência medida:

> `gestor` tem `editar` nos grupos **Gestão, Frota e Brigadas**.
> São **10 pessoas** que editam tudo — inclusive módulos de setores onde
> não trabalham. É exatamente o problema que motivou este pedido.

### 1.4 O buraco maior: **só 15% da superfície passa pelo catálogo**

| Políticas RLS vivas em produção | 270 |
|---|---|
| Que decidem via `pode_ver`/`pode_editar`/`nivel_efetivo` | **41 (15%)** |
| Que checam `perfil = '...'` **direto na policy** | **133 (49%)** |

**Isto reordena a missão.** Um modelo de organograma perfeito plugado em
`nivel_efetivo()` governaria 15% do sistema; nos outros 49% a regra
continuaria escrita à mão em cada policy, imune ao organograma e só
alterável por migration — o oposto de "ajustar sem mexer no código".

### 1.4b A sidebar também não usa o catálogo (correção)

Uma primeira contagem sugeriu que o cliente estava limpo ("12 checagens
`perfil === '...'` em 6 arquivos"). **Está errado, e o erro importa**: a
sidebar não compara strings — ela declara **listas de perfis** por item de
menu (`perfis: ['gestor','tecnico','super_admin']`), forma que aquela busca
não pegava.

| Itens de menu em `js/layout.js` | 39 |
|---|---|
| Com lista de perfis fixa no código | **12** |
| Consultas a `minhas_permissoes` em `layout.js` + `config.js` | **0** |

A view `minhas_permissoes`, criada justamente para o frontend, **não é
consultada por ninguém na navegação**. Ou seja: o menu inteiro é decidido
por perfil hard-coded, e mudar o organograma não mexeria em um único link.
Migrar a sidebar para `minhas_permissoes` passa a ser frente própria —
sem ela, a restrição por setor valeria no banco e não apareceria na tela.

### 1.5 Biomonitor: existe no sistema, **não existe no catálogo**

O módulo está no ar e é usado (`admin-biomonitor.html`,
`biomonitor-validacao`, `-bercarios`, `-equipamentos`, relatórios, app de
campo, tabelas próprias, migrations 226–230). O que **não** existe é linha
com chave `biomonitor` em `modulos` — o catálogo de permissões. Ele é
autorizado por outro caminho, e o caminho é o do §1.4:

```sql
-- policy real, em produção (grupos_biomonitor, programas_biomonitoramento,
-- temporadas_biomonitor, biomonitor_equipamentos, cautelas…)
USING (EXISTS (SELECT 1 FROM usuarios WHERE id = auth.uid()
       AND perfil = ANY (ARRAY['tecnico','gestor','super_admin'])  AND ativo))
```

Duas consequências, ambas relevantes para esta missão:

1. **Não há o que amarrar ao organograma** enquanto a chave não existir —
   `pode_ver('biomonitor')` não resolve para nada. Entrar no catálogo é
   pré-requisito, não melhoria.
2. **As policies de SELECT dessas tabelas são `USING (true)`** — qualquer
   usuário autenticado lê todo o dado do Biomonitor. Restrição por setor no
   Biomonitor exige, além do catálogo, revisar essas leituras. É o exemplo
   mais concreto do que a frente 5 (§3) tem de resolver, e vale como
   modelo para os demais módulos.

Frota (`frota`), Brigadas (`brigadas` + 3) e Água (`agua`) estão no
catálogo.

---

## 2. O modelo proposto — três eixos ortogonais

O erro de fundo hoje é usar **um** eixo (perfil) para responder **três**
perguntas diferentes. A proposta separa:

| Eixo | Pergunta | Origem | Muda quando |
|---|---|---|---|
| **Capacidade** | O que a pessoa *sabe/pode* fazer? | `perfil` (já existe) | Muda de função |
| **Alcance** | A *que* ela chega por trabalhar onde trabalha? | **lotação × organograma × módulo** | Muda de setor / muda o organograma |
| **Exceção** | O que ela pode fora do seu setor, por quanto tempo e por quê? | **credenciamento** (novo) | Caso a caso, com prazo |

E a regra que amarra tudo:

> **`nivel = min(capacidade_do_perfil, alcance_da_lotação)`, elevado por
> credenciamento vigente.**

Isto inverte o papel do perfil: hoje ele **concede**; passa a **limitar**.
Quem concede é a lotação. Um `gestor` continua sendo gestor, mas gestor
*do seu setor*. É essa inversão que resolve o pedido — e é também a parte
que exige cuidado para não trancar ninguém para fora (ver §4).

### 2.1 Peça nova 1 — `usuario_lotacoes` (pessoa → unidade)

```
usuario_id, unidade_org_id, principal boolean,
data_inicio, data_fim (NULL = vigente), portaria, observacoes
```

- **Histórico, não estado**: linha nova a cada mudança de setor; nada é
  sobrescrito. "Onde fulano estava em março?" é consultável.
- **Múltipla lotação é permitida** (uma `principal`): na prática existe
  gente servindo a dois setores, e negar isso empurraria o problema para
  as exceções.
- **Não substitui `cargo_ocupacoes`** — chefia continua sendo cargo. Quem
  ocupa cargo é automaticamente lotado na unidade do cargo (derivado, não
  digitado duas vezes).

### 2.2 Peça nova 2 — `modulo_unidades` (módulo → setor dono)

O ponto de amarração, e a resposta a "sem mexer no código":

```
modulo_id, unidade_org_id, nivel_concedido ('visualizar'|'editar'),
inclui_descendentes boolean default true, observacoes
```

Exemplos do que a SEMA preencheria (a definir com as áreas — §6):

| Módulo | Unidade dona | Efeito |
|---|---|---|
| `frota` | **DITLOG** | quem é lotado em DITLOG edita frota |
| `agua` | **DERHQA** (e DIVRH abaixo) | Recursos Hídricos edita água |
| `brigadas` | a definir (DEUC? CIGMA?) | §6 |
| biomonitor | **DEBIO** | depois de entrar no catálogo (§1.5) |

**Herança pela árvore, calculada, nunca digitada:**
- **Para baixo** — lotado em unidade *descendente* da dona herda o mesmo
  nível (DIVRH herda de DERHQA). É o que faz reorganização funcionar
  sozinha.
- **Para cima** — lotado em unidade *ancestral* da dona recebe
  `visualizar`, nunca `editar`. O diretor da DIMA enxerga o que seus
  departamentos fazem sem poder operar por eles. ("Quem manda, enxerga.")
- Um módulo pode ter **mais de uma unidade dona** (linhas múltiplas) —
  Brigadas plausivelmente é assim.

**Mudou o organograma? `UPDATE unidades_organizacionais SET pai_id = …`** e
todo o alcance se recalcula, porque a herança é derivada da árvore em
tempo de consulta. Nenhuma linha de código, nenhuma migration.

### 2.3 Peça nova 3 — `credenciamentos` (a exceção pedida)

Para quem **não é do setor** e precisa acessar assim mesmo:

```
usuario_id, modulo_id, nivel, data_inicio, data_fim NOT NULL,
justificativa NOT NULL, concedido_por, portaria, revogado_em, revogado_por
```

Decisões de desenho, todas deliberadas:

- **`data_fim` obrigatória.** Acesso de exceção que não expira sozinho vira
  acesso permanente por esquecimento — é assim que todo sistema apodrece.
  Padrão sugerido: 90 dias, renovável com um clique (que gera **linha
  nova**, não estende a antiga — o histórico mostra quantas vezes foi
  renovado).
- **`justificativa` obrigatória**, no banco.
- **Aviso de vencimento** por `pg_cron` ao concedente e ao credenciado
  (molde pronto: `frota_checar_vencimentos`, migration 205, e
  `biomonitor_checar_cautelas_vencidas`, 229 — com dedupe por `ref`).
- **Nunca eleva acima do teto do perfil** — um `visualizador` credenciado
  em Frota vê Frota; não vira editor. Exceção de *alcance*, não de
  *capacidade*.
- **Concedido apenas por `super_admin`** (decisão 2). A tabela guarda
  `concedido_por` desde o início, então estender a concessão aos chefes
  das unidades donas no futuro é ampliar uma checagem — não redesenhar.
- Toda concessão/renovação/revogação é **auditada** — e aqui a missão
  anterior encaixa: é o mesmo mecanismo de trilha desenhado em
  `docs/qualidade-agua/plano-seguranca-dados.md`, agora com um segundo
  consumidor. Vale generalizá-lo nesta missão (§5).
- Nome novo de propósito: `delegacoes_temporarias` (0 linhas, já existe)
  é sobre **substituir o titular de um cargo** — outra coisa. Não
  sobrecarregar a tabela com dois significados.

### 2.4 A nova `nivel_efetivo()` — ordem de precedência

```
0. usuário inativo                        → sem_acesso
1. super_admin                            → editar
2. credenciamento vigente                 → min(nivel, teto_do_perfil)
3. override individual (usuario_permissoes) → mantido (compatibilidade)
4. módulo NÃO exige lotação (§4)          → comportamento de hoje (perfil)
5. alcance por lotação × modulo_unidades  → min(alcance, teto_do_perfil)
6. ocupa cargo de chefia acima da unidade dona → visualizar
7.                                        → sem_acesso
```

`pode_ver`/`pode_editar` **não mudam de assinatura** — as 41 policies que
já os usam ganham o organograma de graça, sem tocar em nenhuma delas.

---

## 3. Fechar o buraco das 133 policies

Sem esta frente, o resto é fachada. Não é conversão às cegas — é
inventário e depois decisão caso a caso:

1. **Inventariar** as 133 (`pg_policies`), classificando cada uma:
   (a) é acesso a **módulo** → converter para `pode_ver`/`pode_editar`;
   (b) é regra de **dono do registro** (`usuario_id = auth.uid()`) →
   legítima, fica como está — organograma não tem nada a ver com "meus
   próprios dados";
   (c) é regra de **app de campo** (brigadista/monitor/motorista) → fica;
   esses 49 usuários não passam por organograma (§7).
2. **Converter as do tipo (a)**, em lotes por módulo, cada lote com o
   `vw_impacto` do §4 rodado antes.
3. **Regra permanente no `CLAUDE.md`**: *policy nova decide acesso a módulo
   por `pode_ver`/`pode_editar`; `perfil = '...'` dentro de policy é dívida
   técnica e precisa de justificativa escrita.* É isso que impede o
   problema de voltar no módulo seguinte.

---

## 4. Como virar a chave sem trancar a SEMA para fora

Ligar `min(perfil, lotação)` de uma vez, com **0 lotações cadastradas**,
tira o acesso de todo mundo. Por isso a adoção é **por módulo e por dado**,
não por interruptor geral:

- **`modulos.exige_lotacao boolean DEFAULT false`.** Enquanto `false`, o
  módulo se comporta exatamente como hoje. Nenhuma regressão no dia da
  migration. Módulos novos nascem `true`.
- **Ordem de adoção**: cadastrar lotações → `modulo_unidades` → rodar o
  relatório de impacto → ligar módulo a módulo, começando por **Frota**
  (dono óbvio: DITLOG; e é o módulo com mais gente de fora do setor
  mexendo hoje).
- **`vw_impacto_lotacao`** — obrigatória antes de cada virada: para o
  módulo X, lista quem **perde** e quem **ganha** acesso. Ninguém liga a
  chave às cegas.
- **Válvula de escape**: `usuario_permissoes` (override individual)
  continua funcionando acima da lotação. Se a virada pegar alguém de
  surpresa, o super_admin resolve em segundos, sem migration nem deploy.
- **Ninguém fica sem lotação por acidente**: usuário sem lotação em módulo
  `exige_lotacao` cai em `sem_acesso`, e a tela de Usuários mostra
  **"sem lotação"** em destaque, com filtro próprio. Silêncio aqui vira
  chamado de suporte.

---

## 5. Sinergia com a missão de auditoria (já planejada)

`docs/qualidade-agua/plano-seguranca-dados.md` desenhou trilha de auditoria
por trigger, com hash encadeado e selo externo, para as 4 tabelas de Água.
As tabelas desta missão (`usuario_lotacoes`, `modulo_unidades`,
`credenciamentos`) são **exatamente do tipo que exige a mesma trilha**:
mudar quem alcança o quê é tão sensível quanto mudar um resultado de
laboratório.

Recomendação: **inverter a ordem de entrega das duas missões** — construir
a trilha já genérica (é o que o plano de Água prevê: `tabela`/`registro_id`,
nada de `agua` na forma), aplicá-la a Água **e** às tabelas de permissão. A
decisão "só Água por enquanto" foi tomada quando o segundo consumidor não
existia; agora ele existe, e o custo de generalizar é `CREATE TRIGGER`.

---

## 6. O que depende de decisão humana (não é código)

1. **Qual unidade é dona de cada módulo.** Frota→DITLOG e Água→DERHQA são
   quase evidentes; **Brigadas** não (DEUC? CIGMA? unidade própria?), e
   módulos transversais (`mapa`, `dashboard`, `documentos`, `relatorios`)
   provavelmente **não devem ter dono** — ficam `exige_lotacao = false`
   para sempre, e isso é resposta legítima, não pendência.
2. **Lotação de cada servidor.** 20 pessoas de mesa; só 10 têm cargo. É
   trabalho de RH/chefia, não de código, e **é o pré-requisito de tudo**.
3. ~~Quem pode conceder credenciamento?~~ **DECIDIDO: só `super_admin`**
   (ver "Decisões tomadas").
4. **Prazo padrão do credenciamento** (sugestão: 90 dias) — pode ser
   fixado na implementação e ajustado depois em Configurações.
5. ~~Interpretação a confirmar~~ **DECIDIDO: restrição por setor é o
   padrão**, com liberação por super_admin.

---

## 7. Limites explícitos do modelo

- **Apps de campo ficam de fora.** Brigadista, monitor e motorista (49 dos
  69 usuários) autorizam por tabelas próprias e PIN, não por
  `nivel_efetivo`. Organograma não os alcança, e tentar seria quebrar o
  trabalho offline por nada.
- **Escopo por UC (`respeita_escopo_uc`, `usuario_ucs_extras`) é o quarto
  eixo e continua existindo**, ortogonal a este: setor responde *que
  módulo*, UC responde *quais registros*. Não fundir os dois.
- **`usuarios.cargo` (texto livre) vira dívida declarada**: passa a ser
  rótulo de exibição, e a autoridade é `cargo_ocupacoes` + lotação. Não
  apagar agora; marcar no `COMMENT`.
- Este modelo **não** resolve segregação de funções (quem aprova ≠ quem
  solicita) — isso é regra de fluxo, dentro de cada módulo, e já existe
  em Frota.

---

## 8. Frentes de trabalho

Progresso (2026-08-15): **1 entregue** (migration 262 + aba "Lotações" em
`estrutura-organizacional.html` — banner "sem lotação" via
`vw_usuarios_sem_lotacao`, cadastro/encerramento via `usuario_lotacoes`;
visível a quem acessa a página, ações restritas a `super_admin`/`diretor`
porque é quem `pode_editar('estrutura-organizacional')` de fato resolve
hoje — checado em `perfil_permissoes_padrao`, não copiado do padrão
`['super_admin','gestor']` que outras abas da mesma página usam, que não
bate com a RLS real deste módulo), **2 entregue**
(migration 265 + aba "Acesso por Setor" em `estrutura-organizacional.html`,
restrita a super_admin), **3 entregue** (migration 266 — tabela
`credenciamentos`, cron de vencimento com dedupe, aba "Credenciamentos"
com conceder/renovar/revogar, tudo restrito a super_admin), **6 entregue**
(migrations 263/264 — Biomonitor no catálogo, com correção de regressão
do fallback de grupo, verificada por consulta a `nivel_efetivo()` antes de
fechar). Nenhuma delas mudou o acesso de ninguém: `alcance_por_lotacao()`
e `credenciamento_vigente()` existem e foram testadas (herança 4/4,
credenciamento 7/7 casos — vigência, dedupe do cron, revogação e as
constraints de justificativa/prazo — em transação com ROLLBACK) mas
`nivel_efetivo()` ainda não as chama — isso só acontece na frente 4.

**Frente 4 entregue** (migration 267): `nivel_efetivo()` agora é um
wrapper fino sobre `nivel_efetivo_calc()` (mesma assinatura de sempre —
`pode_ver`/`pode_editar`/`minhas_permissoes` não mudaram). A engrenagem
está ligada; `modulos.exige_lotacao` nasce `false` em TODOS os módulos
existentes, então nada muda até a frente 8 ligar módulo a módulo.
Verificação, não só afirmação: snapshot de `nivel_efetivo()` para os 69
usuários ativos × 24 módulos ativos (1656 combinações) tirado ANTES da
migration e comparado DEPOIS — **0 divergências**. `vw_impacto_lotacao()`
testada em duas pontas, dentro de `BEGIN`/`ROLLBACK`: sem dono cadastrado
em `modulo_unidades`, tudo "igual" (fail-open); com um dono simulado
(DERHQA em 'agua'), a lista de "perde" apareceu corretamente para quem
tinha acesso pelo caminho antigo e não está lotado ali — exatamente o
que a ferramenta existe para mostrar antes de qualquer virada real.

**Decisão de implementação registrada** (não estava fechada no plano
original): "teto do perfil" — usado para capar credenciamento e alcance
por lotação — foi definido como `teto_do_perfil(perfil)` = o maior nível
que aquele perfil já alcança em QUALQUER módulo hoje
(`perfil_permissoes_padrao` ∪ `grupo_permissoes_padrao`), não um valor
fixo por perfil. Motivo: o mesmo perfil tem `editar` num grupo e
`visualizar` noutro (ex.: `tecnico` edita em Gestão, só visualiza em
Frota) — não existe teto único correto sem inventar um número. Se essa
definição não for a desejada, corrige-se com UPDATE no catálogo
existente, não com redesenho de código.

| # | Entrega | Depende de |
|---|---|---|
| 1 | ✅ `usuario_lotacoes` + derivação a partir de `cargo_ocupacoes` (migration 262) + tela de lotação (aba "Lotações" em `estrutura-organizacional.html`) | — |
| 2 | ✅ `modulo_unidades` + herança pela árvore + tela de amarração módulo↔setor (migration 265 + aba "Acesso por Setor") | 1 |
| 3 | ✅ `credenciamentos` + tela + cron de vencimento + revogação (migration 266 + aba "Credenciamentos") | — (pode ir em paralelo) |
| 4 | ✅ `nivel_efetivo()` v2 + `modulos.exige_lotacao` + `vw_impacto_lotacao` (migration 267) | 1, 2, 3 |
| 5 | Inventário das 133 policies + conversão por lotes | 4 |
| 6 | ✅ `biomonitor` no catálogo de módulos + revisar os `USING (true)` das 4 tabelas de configuração (migrations 263/264). Tabelas de dado de campo (cautelas, ocorrências) ficaram de fora — são §3 (§1.5) | — |
| 6b | **Sidebar passa a ler `minhas_permissoes`** em vez das listas de perfis fixas (§1.4b) | 4 |
| 7 | Trilha de auditoria genérica sobre as tabelas de permissão | §5 |
| 8 | Virada módulo a módulo (Frota → Água → …), com relatório de impacto | tudo |
| 9 | Regra permanente no `CLAUDE.md` + `tests/permissao-organograma.test.js` | — |

A frente 6 é pequena e destrava governar o Biomonitor. As frentes 1 e 3
são as que dão valor mais cedo (lotação visível; exceções com prazo), e
nenhuma delas muda o comportamento atual do sistema — a mudança de
comportamento acontece só na frente 8, módulo a módulo, com impacto
medido antes.
