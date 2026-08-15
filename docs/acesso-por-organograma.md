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

No cliente o quadro é bom: só 12 checagens de perfil hard-coded, em 6
arquivos. **O acoplamento está no SQL, não no JavaScript.**

### 1.5 Biomonitor não existe no catálogo de módulos

Há 23 módulos em `modulos`; **nenhum com chave `biomonitor`** (nem
`pode_ver('biomonitor')` em migration alguma). Um módulo inteiro — com app
de campo, equipamentos, cautelas — fora do sistema de permissão. Enquanto
estiver fora, ele não pode ser governado por organograma nenhum: não há o
que amarrar. Frota (`frota`), Brigadas (`brigadas` + 3) e Água (`agua`)
estão no catálogo.

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
3. **Quem pode conceder credenciamento?** Só super_admin, ou também o
   chefe da unidade dona do módulo? (recomendação: chefe da unidade dona
   concede, super_admin concede em qualquer, ambos auditados).
4. **Prazo padrão do credenciamento** (sugestão: 90 dias).
5. **Interpretação a confirmar**: li o pedido como *"o padrão passa a ser
   restrição por setor, e existe um mecanismo controlado para dar acesso a
   quem é de fora quando houver motivo"*. Se a intenção for só a segunda
   metade (abrir exceções sem mexer no padrão de hoje), a missão encolhe
   para §2.3 + tela, e as frentes 1–2 e 4 saem.

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

| # | Entrega | Depende de |
|---|---|---|
| 1 | `usuario_lotacoes` + derivação a partir de `cargo_ocupacoes` + tela de lotação em Usuários/Estrutura Org. | — |
| 2 | `modulo_unidades` + herança pela árvore + tela de amarração módulo↔setor | 1 |
| 3 | `credenciamentos` + tela + cron de vencimento + revogação | — (pode ir em paralelo) |
| 4 | `nivel_efetivo()` v2 + `modulos.exige_lotacao` + `vw_impacto_lotacao` | 1, 2, 3 |
| 5 | Inventário das 133 policies + conversão por lotes | 4 |
| 6 | `biomonitor` no catálogo de módulos (§1.5) | — |
| 7 | Trilha de auditoria genérica sobre as tabelas de permissão | §5 |
| 8 | Virada módulo a módulo (Frota → Água → …), com relatório de impacto | tudo |
| 9 | Regra permanente no `CLAUDE.md` + `tests/permissao-organograma.test.js` | — |

A frente 6 é pequena e destrava governar o Biomonitor. As frentes 1 e 3
são as que dão valor mais cedo (lotação visível; exceções com prazo), e
nenhuma delas muda o comportamento atual do sistema — a mudança de
comportamento acontece só na frente 8, módulo a módulo, com impacto
medido antes.
