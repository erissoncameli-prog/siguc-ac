# Perfis v2 — Reestruturação ancorada no organograma SEMA-AC

> Spec de design. Status: **decisões fechadas, pronto para implementação.**
> Data: 2026-06-12

## Decisões travadas

| Decisão | Escolha |
|---|---|
| Escopo por UC | **Sim** — gestor_uc e tecnico veem/editam só a(s) UC(s) vinculada(s) |
| Perfil x cargo | **Derivar do cargo** (módulo 003) automaticamente, fonte única de verdade |
| Populações nesta rodada | Internos + pesquisadores externos + brigadistas/validador |
| Secretário | **Só leitura + executivo** (não opera) |
| Migração dos `gestor` atuais | Tem `usuarios.uc_id` → `gestor_uc`; sem → `chefe_departamento` |
| Modelo de permissão | **RBAC + overrides individuais** — perfil é template; super_admin concede/retira acesso por usuário e por módulo (ver seção "Permissões dinâmicas") |
| Catálogo de módulos | **Data-driven** — cada aba é linha em `modulos`; nova aba não exige código de permissão |

> Atualização (2026-06-12, tarde): o sistema deve permitir ao super_admin conceder/
> retirar acesso a QUALQUER usuário, em qualquer módulo, no nível Visualizar ou Editar,
> de forma individual no cadastro. Os 13 perfis viram TEMPLATES (padrões), não gaiolas.
> Ver seção "Permissões dinâmicas (v3)".

## Problema que estamos resolvendo

Existem duas hierarquias paralelas que não se conversam:
- `perfil_usuario` (5 papéis achatados) → controla permissão via RLS.
- `nivel_hierarquico` (7 níveis em `cargos`) → apenas descritivo, ignorado nas permissões.

Resultado: um gestor de 1 UC tem o mesmo poder que o chefe do DEUC. Pesquisadores
externos e brigadistas (que já têm login próprio) não têm perfil formal.

## Conjunto final de perfis

| Perfil | Origem | Escopo | Observação |
|---|---|---|---|
| `super_admin` | manual | Global | TI/DIMA — configura o sistema |
| `secretario` | cargo | Global | Executivo, só leitura + aprovação alto nível |
| `diretor` | cargo | Global | Diretor DIMA — vê tudo, aprova |
| `chefe_departamento` | cargo | Departamento (N UCs) | Chefe DEUC / Coord. CIGMA |
| `gestor_uc` | cargo | 1 UC | Opera só a UC dele |
| `tecnico` | cargo | UC ou global | Analista — lança dados de campo |
| `assistente_admin` | cargo | Setor/lotação | Lotável em qualquer setor; opera o sistema inserindo dados |
| `financeiro` | manual | Global | Módulo financeiro/pesquisa |
| `visualizador` | manual | Global | Só leitura |
| `pesquisador_externo` | cargo/auto | Próprios projetos | Portal de pesquisa |
| `brigadista` | função login | Própria brigada | App de campo |
| `validador_brigada` | manual | UCs/brigadas designadas | Valida ocorrências reportadas pelas brigadas |
| `validador_fauna` | manual | Especialidade (global) | Especialista/biólogo — valida fauna identificada |
| ~~`gestor`~~ (legado) | — | — | Migra → chefe_departamento ou gestor_uc |
| ~~`validador_campo`~~ | — | — | Desmembrado em validador_brigada + validador_fauna |

## Derivação cargo → perfil

```
secretario               → secretario
diretor                  → diretor
coordenador              → chefe_departamento
chefe_deuc               → chefe_departamento
gestor_uc                → gestor_uc          (+ escopo = cargos.uc_id)
analista_uc              → tecnico            (+ escopo = cargos.uc_id)
assistente_administrativo→ assistente_admin   (+ escopo = unidade_org / uc da lotação)
pesquisador_externo      → pesquisador_externo
```

Requer novo valor no enum `nivel_hierarquico`: `assistente_administrativo`
(abaixo de analista_uc). O assistente herda o escopo da unidade onde está lotado
(cargos.unidade_org_id) — se a lotação estiver vinculada a uma UC, escopo = aquela UC;
se for um departamento (DEUC/CIGMA), escopo = todas as UCs do departamento.

Fora da derivação (atribuídos à mão): super_admin, financeiro, visualizador,
brigadista, validador_brigada, validador_fauna.

Mecânica: trigger em `cargo_ocupacoes` e `delegacoes_temporarias` recalcula
`usuarios.perfil` e o escopo quando titular/substituto entra ou sai.

Escopo multi-UC: VIEW `usuario_ucs_visiveis` (usuário → UCs via cargos vigentes
+ delegações). RLS passa a checar `uc_id IN (SELECT ... FROM usuario_ucs_visiveis)`.

## Matriz módulo × perfil — perfis gerais (internos)

Legenda: ✅ edita · 👁️ vê · 🔒 vê só do escopo (UC/lotação) · — sem acesso

| Módulo | super_admin | secretario | diretor | chefe_depto | gestor_uc | tecnico | assist_admin | financeiro | visualiz. |
|---|---|---|---|---|---|---|---|---|---|
| Dashboard / Mapa | ✅ | 👁️ | 👁️ | 👁️ | 🔒 | 🔒 | 🔒 | 👁️ | 👁️ |
| Dashboard Executivo | ✅ | 👁️ | 👁️ | 👁️ | — | — | — | 👁️ | — |
| Unidades (UCs) | ✅ | 👁️ | ✅ | ✅ | 🔒✅ | 🔒👁️ | 🔒👁️ | 👁️ | 👁️ |
| Monitoramento | ✅ | 👁️ | 👁️ | ✅ | 🔒✅ | 🔒✅ | 🔒✅ | 👁️ | 👁️ |
| Netflora (inventário) | ✅ | 👁️ | 👁️ | ✅ | 🔒✅ | 🔒✅ | 🔒✅ | — | 👁️ |
| Alertas Ambientais | ✅ | 👁️ | 👁️ | ✅ | 🔒✅ | 🔒👁️ | 🔒👁️ | — | 👁️ |
| Painel do Gestor (inbox) | ✅ | 👁️ | ✅ | ✅ | 🔒✅ | — | — | — | — |
| Ocorrências | ✅ | 👁️ | ✅ | ✅ | 🔒✅ | 🔒✅ | 🔒✅ | — | 👁️ |
| Pesquisas (gestão interna) | ✅ | 👁️ | ✅ | ✅ | 🔒👁️ | 🔒👁️ | 🔒✅ | 🔒✅* | — |
| Relatórios | ✅ | 👁️ | 👁️ | 👁️ | 🔒 | 🔒 | 🔒 | 👁️ | 👁️ |
| Equipe | ✅ | 👁️ | ✅ | ✅ | 🔒👁️ | — | 🔒✅ | — | 👁️ |
| Documentos | ✅ | 👁️ | ✅ | ✅ | 🔒✅ | 🔒✅ | 🔒✅ | 👁️ | 👁️ |
| Brigadas (gestão) | ✅ | 👁️ | 👁️ | ✅ | 🔒✅ | 🔒👁️ | 🔒✅ | — | — |
| Relatórios Brigadas | ✅ | 👁️ | 👁️ | ✅ | 🔒 | 🔒 | 🔒 | — | — |
| Admin: Usuários | ✅ | — | 👁️ | 👁️ | — | — | — | — | — |
| Admin: Estrutura Org. | ✅ | 👁️ | ✅ | 👁️ | — | — | — | — | — |
| Admin: Configurações | ✅ | — | — | — | — | — | — | — | — |
| Admin: Histórico Acessos | ✅ | — | 👁️ | — | — | — | — | — | — |

\* financeiro: apenas sub-fluxo financeiro/inadimplência de pesquisa.

`assistente_admin` = operador de digitação com escopo na lotação: insere dados nos
módulos operacionais do seu setor, mas não aprova, não valida e não acessa admin.

Nuance de UX: no Mapa, gestor_uc/tecnico/assist_admin continuam vendo o contorno de
todas as UCs (camada GeoJSON pública), mas só editam os dados do seu escopo.

## Perfis especializados (acesso estreito)

- **`pesquisador_externo`** — só o Portal do Pesquisador; edita/acompanha apenas os
  próprios projetos. Sem acesso ao sistema interno.
- **`brigadista`** — só o App de Campo (brigada.html); registra ocorrências/atividades
  da própria brigada. Sem acesso ao painel web.
- **`validador_brigada`** — módulo Validação de Campo restrito às **ocorrências
  reportadas pelas brigadas** das UCs/brigadas designadas; vê Relatórios de Brigadas.
  Valida/rejeita o reporte operacional.
- **`validador_fauna`** (especialista/biólogo) — valida os **registros de fauna do
  módulo de Monitoramento/Biodiversidade** que aguardam identificação. Escopo
  **global por especialidade**: vê fauna pendente de qualquer UC (há poucos
  especialistas; escopo estadual). Confirma/corrige a espécie.

  Estrutura necessária no Monitoramento: marcar registros de fauna que precisam de
  validação (ex.: campo `requer_validacao_especialista` + `status_validacao`
  pendente/confirmado/corrigido + `validado_por`/`validado_em`). A fila do
  validador_fauna = registros de monitoramento de fauna com status pendente.

## Plano de migrations

1. `055_perfis_v2.sql` — ALTER TYPE perfil_usuario ADD VALUE (secretario, diretor,
   chefe_departamento, gestor_uc, assistente_admin, pesquisador_externo, brigadista,
   validador_brigada, validador_fauna) + ALTER TYPE nivel_hierarquico ADD VALUE
   'assistente_administrativo'. Atenção: ADD VALUE não roda na mesma transação que o
   uso — separar COMMIT (provável split em 055a/055b).
2. `056_escopo_uc.sql` — VIEW usuario_ucs_visiveis (SECURITY DEFINER / função estável
   para evitar recursão de RLS, ver bug histórico em 050).
3. `057_derivar_perfil_cargo.sql` — função + triggers cargo_ocupacoes / delegacoes.
4. `058_rls_escopo.sql` — reescrever policies de unidades_conservacao, monitoramento_*,
   ocorrencias, documentos, brigadas para respeitar escopo.
5. `059_perfis_especiais.sql` — formalizar pesquisador_externo, brigadista,
   validador_brigada e validador_fauna; migrar o "biologo" do código para
   validador_fauna.
   - validador_brigada: fila = ocorrências reportadas pelas brigadas (Validação de Campo).
   - validador_fauna: adicionar a monitoramento_registros os campos de validação por
     especialista (requer_validacao_especialista, status_validacao, validado_por,
     validado_em); RLS dá UPDATE desses campos ao validador_fauna em qualquer UC.
6. Frontend — atualizar navGroups em js/layout.js (perfis por item) e
   pages/usuarios.html (novos perfis); atualizar i18n.perfis em js/config.js.

## Migração de dados (decisão travada)

```sql
-- gestor atual com UC vinculada → gestor_uc
UPDATE usuarios SET perfil = 'gestor_uc'
WHERE perfil = 'gestor' AND uc_id IS NOT NULL;
-- gestor atual sem UC → chefe_departamento
UPDATE usuarios SET perfil = 'chefe_departamento'
WHERE perfil = 'gestor' AND uc_id IS NULL;
```

## Riscos

- RLS recursiva (ver 050_fix_brigadistas_rls_recursion.sql) — VIEW de escopo precisa
  de função estável/SECURITY DEFINER.
- ALTER TYPE ADD VALUE fora de transação — pode exigir 2 migrations.
- Pesquisadores e brigadistas têm fluxo de login próprio — não quebrar o existente.
