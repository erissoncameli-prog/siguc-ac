# Biomonitor Quelônios — Perfis de Acesso e Funcionalidades por Usuário
**SIGUC-AC · SEMA-AC / DIMA · Versão 2026**

---

## Resumo dos Perfis

O sistema Biomonitor contempla **três perfis de usuário**, cada um com escopo, ferramentas e responsabilidades distintos:

| Perfil | Papel | Acesso principal | Escopo de dados |
|--------|-------|-----------------|-----------------|
| **Monitor** | Trabalho de campo | App móvel (biomonitor.html) | Apenas seu grupo |
| **Pesquisador** | Análise e validação científica | Relatórios + validação web | Grupos autorizados |
| **Administrador** | Gestão e supervisão | SIGUC completo + relatórios | Todos os grupos e UCs |

---

## 1. Monitor de Campo

> Pessoa que atua diretamente nas praias de monitoramento. Registra ninhos, visitas, eclosões e o destino dos filhotes em condições de campo, frequentemente sem acesso à internet.

### 1.1 Onde acessa

| Interface | URL / Arquivo | Descrição |
|-----------|--------------|-----------|
| App de campo | `/pages/biomonitor.html` | PWA offline-first; funciona sem internet |
| Instalação | `/pages/instalar-biomonitor.html` | Página pública de instalação / atualização |

> O monitor **não tem acesso** ao painel administrativo do SIGUC (dashboard, mapas, gestão de UCs).

---

### 1.2 Autenticação

| Recurso | Disponível |
|---------|-----------|
| Login com e-mail e senha | Sim |
| Troca de senha obrigatória no 1.º acesso | Sim |
| PIN de campo de 4 dígitos | Sim — desbloqueia o app offline sem internet |
| Sessão persistente em localStorage | Sim — permanece logado entre sessões |
| Zerar PIN / reconfigurar | Sim — via tela de configuração |

---

### 1.3 Registros de campo — o que pode criar

| Registro | Pode criar? | Observação |
|----------|------------|------------|
| Ninho de quelônio | Sim | Com GPS, espécie, ovos, condições ambientais, fotos |
| Visita de acompanhamento | Sim | Status do ninho, temperatura, predação, intervenção |
| Transferência de ninho | Sim | Com alerta de janela crítica (semáforo) |
| Eclosão | Sim | Filhotes vivos/mortos/não nascidos, predação |
| Entrada de filhotes no berçário | Sim | Vincula ao berçário cadastrado |
| Ocorrência em berçário | Sim | Alimentação, biometria, mortalidade, doença, tratamento |
| Soltura de filhotes | Sim | Direta no rio ou saída do berçário |

---

### 1.4 Registros — o que pode visualizar

| Dado | Pode ver? | Escopo |
|------|-----------|--------|
| Ninhos | Sim | Apenas ninhos do **próprio grupo** de monitoramento |
| Transferências | Sim | Do próprio grupo |
| Eclosões | Sim | Do próprio grupo |
| Visitas | Sim | Apenas as **próprias** visitas |
| Lotes de berçário | Sim | Apenas os **próprios** lotes |
| Solturas | Sim | Apenas as **próprias** solturas |
| Ocorrências de berçário | Sim | Apenas as **próprias** |
| Ninhos de outros monitores do grupo | Sim | Via pull do servidor (tela Histórico) |
| Ninhos de outros grupos | Não | Bloqueado por RLS |
| Dados de outros programas / UCs | Não | — |

---

### 1.5 Funcionalidades do app de campo

#### Dashboard (Home)
- Chip de status de conexão (online/offline)
- Praia selecionada com código e informações
- Radar GPS em tempo real com precisão
- Botões de ação: Novo Ninho, Ninhos Abertos, Histórico, Berçário
- Badge de contagem de ninhos na fila (pendentes de sync)

#### Ninhos Abertos
- Lista de ninhos não eclodidos da praia selecionada
- Filtro por status (encontrado, transferido)
- Ações por ninho: Registrar Eclosão, Transferir, Visita, Ver Detalhe

#### Histórico de Ninhos
- Todos os ninhos da praia (todos os status)
- Ordenado por data de encontro

#### Berçário
- Lista de lotes ativos agrupados por berçário
- Detalhe do lote com timeline de ocorrências
- Ações: registrar ocorrência, registrar soltura

#### Fila de Envio (Meus Ninhos)
- Todos os itens criados localmente com status de sync:
  - Pendente → Enviando → Confirmado
- Exibe tipo, data da ocorrência, data do envio
- Botão de retry manual

#### Aba de Dados — Estatísticas pessoais
| Indicador | Descrição |
|-----------|-----------|
| Meus ninhos / Ninhos do grupo | Totais da temporada |
| Ninhos eclodidos | Quantidade com sucesso |
| Total de filhotes vivos | — |
| **9 taxas científicas** (PQRA/TAMAR/ICMBio) | Taxa de eclosão, sucesso de nidificação, fertilidade, eficiência do ninho, predação, transferência, incubação média, sobrevivência e mortalidade em berçário |
| Gráficos por espécie | Ninhos e filhotes por espécie |
| Fenologia mensal | Ninhos × filhotes por mês |
| Top praias | Praias com mais ninhos |
| Berçário | Lotes, entradas, solturas, mortalidade |
| Biometria | Curva de crescimento comprimento/peso |

#### Configurações
| Recurso | Descrição |
|---------|-----------|
| QR de instalação | Compartilha link do app |
| Verificar atualização | Checa nova versão manualmente |
| Alterar PIN | Troca o PIN de campo |
| Catálogo de espécies | Referência offline com fotos e info |
| Zerar fila local | Apaga dados não sincronizados (irreversível) |
| Sair | Encerra sessão |

---

### 1.6 O que o monitor NÃO pode fazer

| Ação | Motivo |
|------|--------|
| Validar ou rejeitar ninhos | Competência do pesquisador / administrador |
| Cadastrar ou editar berçários | Somente gestor/técnico |
| Criar programas ou grupos de monitoramento | Somente administrador |
| Criar ou editar praias de monitoramento | Somente administrador |
| Criar temporadas | Somente administrador |
| Ver dados de outros grupos | Bloqueado por RLS |
| Acessar o painel SIGUC (dashboard, mapas, UCs) | Perfil não autorizado |
| Exportar relatórios completos | Não disponível no app de campo |
| Gerenciar outros monitores | Não disponível |

---

## 2. Pesquisador / Biólogo

> Profissional científico — biólogo, pesquisador do ICMBio, IBAMA ou parceiro externo — com acesso analítico ao sistema. Valida registros de campo, realiza análises e gera relatórios, mas **não registra dados diretamente em campo**.

### 2.1 Onde acessa

| Interface | URL / Arquivo | Descrição |
|-----------|--------------|-----------|
| Relatórios Biomonitor | `/pages/relatorios-biomonitor.html` | Análise científica completa |
| SIGUC (visualizador) | `/pages/dashboard.html` e demais | Visão institucional |

> O pesquisador acessa pela **interface web do SIGUC**, não pelo app de campo.

---

### 2.2 Autenticação

| Recurso | Disponível |
|---------|-----------|
| Login com e-mail e senha (SIGUC) | Sim |
| Perfil no sistema | `biologo` |
| PIN de campo | Não — não usa o app de campo |

---

### 2.3 O que pode visualizar

| Dado | Pode ver? | Escopo |
|------|-----------|--------|
| Ninhos de quelônios | Sim | Todos os ninhos dos grupos autorizados |
| Transferências | Sim | Dos grupos autorizados |
| Eclosões | Sim | Dos grupos autorizados |
| Visitas | Não | Política RLS atual não inclui `biologo` |
| Lotes de berçário | Não | Política RLS atual não inclui `biologo` |
| Solturas | Não | Política RLS atual não inclui `biologo` |
| View de validação (`vw_validacao_biomonitor`) | Sim | Com status, monitor, dados completos |

---

### 2.4 O que pode validar e editar

| Ação | Pode? | Observação |
|------|-------|------------|
| Validar ninho (status_validacao → validado) | Sim | Campo `validado_por` e `validado_em` preenchidos |
| Rejeitar ninho com motivo | Sim | Preenche `motivo_rejeicao` |
| Marcar ninho em correção | Sim | Status → `em_correcao` |
| Editar dados do ninho | Sim | Update autorizado pelo RLS |
| Editar transferências | Sim | — |
| Editar eclosões | Sim | — |
| Criar novos registros de campo | Não | Sem permissão de INSERT |

---

### 2.5 Página de Relatórios Científicos

Acesso completo a todos os filtros e análises:

#### Filtros disponíveis
| Filtro | Descrição |
|--------|-----------|
| Temporada | Seleciona a temporada de monitoramento |
| Programa | Filtra por programa (PQRA, TAMAR...) |
| Unidade de Conservação | Filtra praias em cascata |
| Praia | Análise específica por praia |

#### Seções e gráficos

| Seção | Conteúdo |
|-------|----------|
| **Visão Geral** | 12 KPIs + doughnut de status dos ninhos + desfecho dos ovos |
| **Taxas Científicas** | 9 indicadores PQRA/TAMAR/ICMBio com barra de progresso |
| **Fenologia** | Curva ninhos+filhotes por mês; tendência interanual por ano |
| **Por Espécie** | Barras agrupadas + gráfico radar multidimensional + tabela detalhada |
| **Por Praia e UC** | Top praias (barras h) + ninhos por UC + tabelas com densidade ninhos/km |
| **Berçário** | KPIs de lotes, curva de crescimento (biometria), destino dos filhotes |
| **Desempenho por Monitor** | Ranking de monitores; útil para gestão da equipe |

#### Exportações
| Recurso | Disponível |
|---------|-----------|
| Imprimir / Salvar PDF | Sim — com CSS de impressão (oculta filtros e nav) |
| Exportar CSV | Sim — dados de praias + espécies |

---

### 2.6 O que o pesquisador NÃO pode fazer

| Ação | Motivo |
|------|--------|
| Registrar ninhos / eclosões / visitas | Sem permissão de INSERT nos stores de campo |
| Cadastrar ou editar berçários | Somente gestor/técnico/admin |
| Criar programas, grupos ou praias | Somente administrador |
| Criar temporadas | Somente administrador |
| Gerenciar monitores | Somente administrador |
| Acessar funcionalidades administrativas do SIGUC | Perfil `biologo` sem acesso a gestão de UCs e usuários |

---

## 3. Administrador (Gestor / Super Admin)

> Servidor da SEMA-AC responsável pela gestão do programa de monitoramento. Configura toda a estrutura (programas, grupos, praias, berçários, temporadas), supervisiona os monitores e acompanha os resultados via relatórios.

### 3.1 Onde acessa

| Interface | URL | Descrição |
|-----------|-----|-----------|
| SIGUC completo | `/pages/dashboard.html` | Painel executivo |
| Relatórios Biomonitor | `/pages/relatorios-biomonitor.html` | Análise científica |
| Gestão de usuários | `/pages/usuarios.html` | Cria e gerencia monitores |
| Todas as demais páginas do SIGUC | — | Mapa, UCs, equipe, documentos, ocorrências... |

---

### 3.2 Autenticação

| Recurso | Disponível |
|---------|-----------|
| Login com e-mail e senha (SIGUC) | Sim |
| Perfis autorizados | `gestor`, `super_admin`, `tecnico` |
| Auditoria de acesso | Sim — registrado em `auditoria_acessos` |

---

### 3.3 Gestão de estrutura (cadastros)

| Cadastro | Criar | Editar | Desativar |
|----------|-------|--------|-----------|
| Programas de biomonitoramento | Sim | Sim | Sim |
| Grupos de monitoramento | Sim | Sim | Sim |
| Monitores de biodiversidade | Sim | Sim | Sim |
| Praias de monitoramento | Sim | Sim | Sim |
| Berçários | Sim | Sim | Sim |
| Temporadas de monitoramento | Sim | Sim | Sim |
| Espécies no catálogo | Sim | Sim | — |

---

### 3.4 Visibilidade de dados

| Dado | Escopo |
|------|--------|
| Ninhos | **Todos** os ninhos de todos os grupos e UCs |
| Transferências | Todas |
| Eclosões | Todas |
| Visitas | Todas |
| Lotes de berçário | Todos |
| Solturas | Todas |
| Ocorrências de berçário | Todas |
| View de validação | Completa |

---

### 3.5 Validação e qualidade de dados

| Ação | Disponível |
|------|-----------|
| Validar ninho | Sim — status_validacao → `validado` |
| Rejeitar ninho com motivo | Sim — preenche `motivo_rejeicao` |
| Marcar como em correção | Sim |
| Editar qualquer registro | Sim — UPDATE em todos os stores |
| Ver fila de pendentes de validação | Sim — via `vw_validacao_biomonitor` |

---

### 3.6 Relatórios — acesso completo

Acesso idêntico ao pesquisador, com a capacidade adicional de filtrar por **qualquer UC, programa ou grupo** sem restrição de escopo.

| Seção | Acesso |
|-------|--------|
| Visão Geral (KPIs) | Sim |
| Taxas Científicas | Sim |
| Fenologia | Sim |
| Por Espécie | Sim |
| Por Praia e UC | Sim — inclui densidade ninhos/km |
| Berçário | Sim |
| Desempenho por Monitor | Sim — útil para gestão de equipe e contratos |
| Exportar CSV | Sim |
| Imprimir / PDF | Sim |

---

### 3.7 Gestão de usuários e monitores

| Ação | Disponível |
|------|-----------|
| Criar conta de monitor | Sim — via /pages/usuarios.html |
| Vincular monitor a grupo | Sim |
| Alterar função do monitor (coordenador / monitor / auxiliar) | Sim |
| Afastar ou encerrar monitor | Sim — status_monitor: afastado / encerrado |
| Resetar senha de monitor | Sim |
| Criar conta de pesquisador/biólogo | Sim |

---

### 3.8 O que o administrador NÃO pode fazer (limitações intencionais)

| Ação | Motivo |
|------|--------|
| Apagar ninhos ou eclosões (DELETE) | Não existe política de DELETE; integridade dos dados científicos |
| Acessar SERVICE_ROLE_KEY pelo frontend | Por segurança (nunca exposta) |
| Editar o banco diretamente pela interface | Operações via RLS/RPC apenas |

---

## 4. Matriz de Permissões — Visão Geral

### 4.1 Registros de campo

| Ação | Monitor | Pesquisador | Administrador |
|------|---------|-------------|---------------|
| Criar ninho | Sim (próprio grupo) | Não | Sim |
| Criar visita | Sim (próprio) | Não | Sim |
| Criar transferência | Sim (próprio) | Não | Sim |
| Criar eclosão | Sim (próprio) | Não | Sim |
| Criar lote de berçário | Sim (próprio) | Não | Sim |
| Criar ocorrência de berçário | Sim (próprio) | Não | Sim |
| Criar soltura | Sim (próprio) | Não | Sim |
| Ver ninhos do próprio grupo | Sim | Sim | Sim |
| Ver ninhos de todos os grupos | Não | Sim (autorizado) | Sim |
| Editar ninho | Sim (próprio, sem validar) | Sim (qualquer) | Sim (qualquer) |
| Validar / rejeitar ninho | Não | Sim | Sim |

### 4.2 Cadastros e estrutura

| Ação | Monitor | Pesquisador | Administrador |
|------|---------|-------------|---------------|
| Gerenciar programas | Não | Não | Sim |
| Gerenciar grupos de monitoramento | Não | Não | Sim |
| Gerenciar praias | Não | Não | Sim |
| Gerenciar berçários | Não | Não | Sim |
| Gerenciar temporadas | Não | Não | Sim |
| Gerenciar monitores | Não | Não | Sim |

### 4.3 Relatórios e exportação

| Recurso | Monitor | Pesquisador | Administrador |
|---------|---------|-------------|---------------|
| Aba de dados no app | Sim (próprio grupo) | Não | Não |
| Página de relatórios científicos | Não | Sim (filtros autorizados) | Sim (sem restrição) |
| Exportar CSV | Não | Sim | Sim |
| Imprimir / PDF | Não | Sim | Sim |

### 4.4 Interfaces

| Interface | Monitor | Pesquisador | Administrador |
|-----------|---------|-------------|---------------|
| App de campo (biomonitor.html) | Sim | Não | Não |
| Relatórios Biomonitor | Não | Sim | Sim |
| Dashboard SIGUC | Não | Visualizador | Sim (gestor) |
| Mapa de UCs | Não | Visualizador | Sim |
| Gestão de usuários | Não | Não | Sim |
| Outras páginas do SIGUC | Não | Visualizador | Sim |

---

## 5. Fluxo de Colaboração entre Perfis

```
Monitor de Campo                Pesquisador / Biólogo           Administrador
─────────────────               ─────────────────────           ─────────────
     │                                    │                           │
1. Registra ninhos no app                 │                           │
   (offline-first)                        │                           │
     │                                    │                    2. Configura estrutura
     │                             ◄──────┤                       (programas, praias,
3. Sync automático ao                     │                        berçários, temporadas)
   reconectar internet                    │                           │
     │                                    │                           │
     ├──────────────────────────────────► │                           │
     │                          4. Valida / rejeita                   │
     │                             registros                          │
     │                             (status_validacao)                 │
     │                                    │                           │
     │                                    ├──────────────────────────►│
     │                          5. Gera relatórios              6. Supervisiona
     │                             científicos                    resultados e
     │                             (por espécie,                  desempenho
     │                             praia, UC,                     de monitores
     │                             fenologia...)                     │
     │                                    │                           │
     └────────────────────────────────────┴───────────────────────────┘
                          Ciclo do monitoramento
```

---

## 6. Estrutura de Perfis no Banco de Dados

| Perfil (tabela `usuarios`) | Mapeamento no Biomonitor |
|---------------------------|--------------------------|
| `super_admin` | Administrador com acesso irrestrito |
| `gestor` | Administrador com acesso a todas as UCs |
| `tecnico` | Acesso de leitura/escrita; gerencia cadastros |
| `biologo` | Pesquisador — leitura + validação; sem INSERT |
| `visualizador` | Apenas leitura (sem acesso ao Biomonitor por padrão) |
| — (entry na `monitores_biodiversidade`) | Monitor de campo — acesso exclusivo pelo app |

> **Nota:** O monitor de campo é identificado pela existência de um registro ativo em `monitores_biodiversidade` com `usuario_id` correspondente, e não pelo campo `perfil` da tabela `usuarios`. Um monitor pode ter qualquer perfil na tabela `usuarios`, mas o acesso ao app é controlado pela RPC `bio_monitor_atual()`.

---

*Documento gerado em 27/06/2026. Sistema SIGUC-AC — SEMA-AC / DIMA.*
