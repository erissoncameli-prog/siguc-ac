# Prompt — missão: acesso por organograma

Colar como primeira mensagem da sessão. A direção já está decidida (seção
"Decisões tomadas" do plano); o que segue em aberto é dado humano e **não
bloqueia o início**.

---

Atue como arquiteto de software deste projeto. Missão: **fazer o
organograma da SEMA governar o acesso aos módulos**.

Leia primeiro `docs/acesso-por-organograma.md` — é o plano arquitetural
desta missão, levantado contra o banco de produção, com os números que
justificam cada escolha. Não refaça o levantamento. Se discordar de alguma
decisão dele, diga por quê antes de mudar.

## O modelo (resumo; o detalhe está no plano)

Três eixos ortogonais, hoje colapsados num só:
**capacidade** (perfil = teto), **alcance** (lotação × organograma ×
módulo = concessão), **exceção** (credenciamento com prazo).
Regra: `nivel = min(capacidade_do_perfil, alcance_da_lotação)`, elevado por
credenciamento vigente. **O perfil deixa de conceder e passa a limitar.**

## Decisões travadas (seguir, não reabrir)

- **Restrição por setor é o padrão** — a missão inclui as frentes 1–2 e 4,
  não só o credenciamento.
- **Só `super_admin` concede credenciamento.** Prazo e justificativa
  obrigatórios; nunca acima do teto do perfil; auditado; aviso de
  vencimento por `pg_cron` (molde: migration 205 / 229, com dedupe por
  `ref`).
- **A virada é módulo a módulo**, via `modulos.exige_lotacao`, com
  `vw_impacto_lotacao` rodada antes de cada uma.

## Ordem de entrega

Comece pelas frentes que **não mudam o acesso de ninguém** (todas com
`exige_lotacao = false`, o padrão):

1. `usuario_lotacoes` + derivação a partir de `cargo_ocupacoes` + tela de
   lotação (Usuários / Estrutura Organizacional), com destaque e filtro
   para quem está **sem lotação**.
2. `modulo_unidades` + herança pela árvore (descendente herda o nível;
   ancestral herda **só `visualizar`**) + tela de amarração módulo↔setor.
3. `credenciamentos` + tela + cron de vencimento + revogação.
6. `biomonitor` no catálogo de `modulos`. O módulo existe e é usado
   (`admin-biomonitor.html` e cia.), mas **não tem chave em `modulos`** —
   é autorizado por `perfil = ANY(...)` direto nas policies, e as de
   SELECT são `USING (true)` (qualquer autenticado lê tudo). Entrar no
   catálogo é pré-requisito para governá-lo; revisar essas leituras vem
   junto, e serve de modelo para a frente 5.

Só então:

4. `nivel_efetivo()` v2 + `modulos.exige_lotacao` + `vw_impacto_lotacao`.
5. Inventário das **133 policies que checam `perfil` direto** e conversão
   por lotes, classificando cada uma antes (acesso a módulo → converter;
   dono do próprio registro → fica; app de campo → fica).
7. Trilha de auditoria genérica sobre as tabelas de permissão.
9. Regra no `CLAUDE.md` + `tests/permissao-organograma.test.js`.

A frente 8 (ligar `exige_lotacao` por módulo) **depende de dado humano** —
lotação dos 20 servidores de mesa e dono de cada módulo — e não deve ser
executada sem esse dado nem sem o relatório de impacto.

## Restrições inegociáveis

- **`pode_ver`/`pode_editar` não mudam de assinatura.** As 41 policies que
  já os usam têm de ganhar o organograma sem serem tocadas.
- **Nada de regressão no dia da migration**: `exige_lotacao` nasce `false`
  em todos os módulos existentes.
- **`usuario_permissoes` (override individual) continua funcionando** como
  válvula de escape acima da lotação.
- **Apps de campo ficam de fora** (49 dos 69 usuários): brigadista,
  monitor e motorista não passam por `nivel_efetivo`. Não tente incluí-los.
- **Escopo por UC é o quarto eixo e não se funde com este**: setor responde
  *que módulo*; UC responde *quais registros*.
- **Lotação ≠ cargo.** `cargo_ocupacoes` modela chefia (1 cargo por
  unidade) e continua existindo; quem ocupa cargo é lotado por derivação,
  nunca digitado duas vezes.
- Migration: número vem de `list_migrations` **em produção**; toda função
  com `SET search_path = public` e `REVOKE EXECUTE FROM anon` pelo nome do
  papel; `DROP FUNCTION` antes de recriar RPC com lista de parâmetros
  diferente; `get_advisors` (security) depois de aplicar.
- Commits em português, pequenos, com push a cada frente concluída.

## Ao terminar

Atualizar o `CLAUDE.md`: o Módulo A (Estrutura Organizacional) está
listado como "a implementar" mas **as tabelas já estão em produção** —
corrigir isso e documentar o modelo novo, incluindo a regra permanente:
*policy nova decide acesso a módulo por `pode_ver`/`pode_editar`;
`perfil = '...'` dentro de policy é dívida técnica e exige justificativa
escrita.*
