# Biomonitor Quelônios — Documentação Completa de Funcionalidades
**SIGUC-AC · SEMA-AC / DIMA · Versão 2026**

---

## Índice

1. [Visão Geral](#1-visão-geral)
2. [Arquitetura Técnica](#2-arquitetura-técnica)
3. [Autenticação e Controle de Acesso](#3-autenticação-e-controle-de-acesso)
4. [Telas do Aplicativo de Campo](#4-telas-do-aplicativo-de-campo)
5. [Formulários — Campos Detalhados](#5-formulários--campos-detalhados)
6. [Fluxos de Navegação](#6-fluxos-de-navegação)
7. [Banco de Dados — Tabelas e Relações](#7-banco-de-dados--tabelas-e-relações)
8. [Funções RPC (Supabase)](#8-funções-rpc-supabase)
9. [Funcionalidade Offline](#9-funcionalidade-offline)
10. [Motor de Sincronização](#10-motor-de-sincronização)
11. [GPS e Câmera](#11-gps-e-câmera)
12. [Página de Relatórios Científicos](#12-página-de-relatórios-científicos)
13. [Taxas e Indicadores Científicos](#13-taxas-e-indicadores-científicos)
14. [Regras de Negócio](#14-regras-de-negócio)
15. [Design System](#15-design-system)
16. [Estrutura de Arquivos](#16-estrutura-de-arquivos)

---

## 1. Visão Geral

O **Biomonitor Quelônios** é um aplicativo web progressivo (PWA) offline-first para monitoramento de ninhos de quelônios em praias de rios amazônicos, seguindo o protocolo PQRA/TAMAR/ICMBio. Permite que monitores de campo registrem eventos em locais sem cobertura de internet e sincronizem com o servidor ao recuperar conexão.

### Componentes do módulo

| Componente | Arquivo | Descrição |
|---|---|---|
| App de Campo | `pages/biomonitor.html` | Interface do monitor; funciona offline |
| Relatórios | `pages/relatorios-biomonitor.html` | Análise científica para gestores |
| Lógica principal | `js/biomonitor-quelonios.js` | Auth, formulários, navegação |
| Persistência offline | `js/biomonitor-offline.js` | IndexedDB, PIN, configuração |
| Sincronização | `js/biomonitor-sync.js` | Upload, retry, pull do servidor |
| Estilos | `css/biomonitor.css` | Design system "Rio" |

### Espécies monitoradas

| Código | Nome popular |
|--------|-------------|
| `tracaja` | Tracajá |
| `tartaruga` | Tartaruga-da-Amazônia |
| `cabecudo` | Cabeçudo |
| `pitiU` | Pitiú |
| `mucua` | Muçuã |
| `jabuti_pe_elefante` | Jabuti-pé-de-elefante |
| `jabuti_piranga` | Jabuti-piranga |
| `cupido` | Cupido |
| `outro` | Outra espécie |

---

## 2. Arquitetura Técnica

```
┌─────────────────────────────────────────────────────┐
│  App de Campo (PWA + Service Worker)                 │
│                                                      │
│  ┌─────────────────┐    ┌────────────────────────┐   │
│  │  biomonitor.html│    │  biomonitor-quelonios   │   │
│  │  (16 telas)     │◄──►│  .js  (lógica/UI)      │   │
│  └─────────────────┘    └────────────────────────┘   │
│           │                         │                │
│           │              ┌──────────▼────────────┐   │
│           │              │ biomonitor-offline.js  │   │
│           │              │ (IndexedDB / 9 stores) │   │
│           │              └──────────┬────────────┘   │
│           │                         │                │
│           │              ┌──────────▼────────────┐   │
│           │              │  biomonitor-sync.js    │   │
│           │              │  (upload / pull)       │   │
│           │              └──────────┬────────────┘   │
└──────────────────────────────────── │ ───────────────┘
                                      │ HTTPS (quando online)
                    ┌─────────────────▼──────────────────┐
                    │  Supabase (PostgreSQL + PostGIS)     │
                    │  Auth · Storage · RLS · RPC          │
                    └─────────────────────────────────────┘
```

**Princípios fundamentais:**
- **Offline-first**: todos os registros vão ao IndexedDB antes de qualquer operação de rede
- **Cliente Supabase isolado**: `window._bioDB_client` com sessão em `localStorage`, independente do app principal SIGUC
- **PIN de campo**: hash SHA-256 armazenado localmente; desbloqueia o app sem necessidade de internet
- **Sincronização automática**: iniciada ao abrir o app e ao reconectar a internet

---

## 3. Autenticação e Controle de Acesso

### Fluxo completo de autenticação

```
DOMContentLoaded
    │
    ▼
bioIniciar()
    ├── Aguarda cliente Supabase isolado (_bioDB_client)
    ├── getSession() — sem sessão? → tela-login
    ├── getSession() — com sessão?
    │       ├── RPC bio_monitor_atual()
    │       │       └── monitor não encontrado? → tela-login com erro
    │       ├── monitor.deve_trocar_senha?
    │       │       └── Sim → tela-trocar-senha (obrigatório)
    │       ├── bioOfflineTemPin()?
    │       │       └── Não → tela-config-pin
    │       └── Sim → tela-bloqueio (PIN de 4 dígitos)
    │                       └── PIN correto → bioEntrarNaHome()
    └── bioEntrarNaHome()
            ├── Carrega praias (sync + IndexedDB)
            ├── Carrega berçários (sync + IndexedDB)
            ├── Registra sessão (RPC bio_monitor_iniciar_sessao)
            ├── Inicia sync automático (bioSyncTudo)
            └── Navega para tela-home
```

### Telas de autenticação

| Tela | ID | Descrição |
|------|----|-----------|
| Login | `tela-login` | E-mail + senha via Supabase Auth |
| Criar nova senha | `tela-trocar-senha` | Obrigatório ao 1.º acesso |
| Configurar PIN | `tela-config-pin` | Define o PIN de 4 dígitos para campo |
| Desbloqueio | `tela-bloqueio` | PIN de 4 dígitos; sem internet necessária |

### Segurança

- Sessão em `localStorage` (persiste entre aberturas do navegador)
- PIN de campo em SHA-256 no IndexedDB (autenticação local offline)
- Todas as tabelas com RLS (Row Level Security) no Supabase
- Funções RPC com `SECURITY DEFINER SET search_path = public`
- `SERVICE_ROLE_KEY` nunca exposta no frontend

---

## 4. Telas do Aplicativo de Campo

O app possui **16 telas** organizadas em 4 grupos:

### 4.1 Telas principais (com nav flutuante)

| Tela | ID | Descrição |
|------|----|-----------|
| Home | `tela-home` | Dashboard com GPS, praia selecionada e botões de ação |
| Ninhos Abertos | `tela-abertos` | Lista de ninhos não eclodidos (filtros: praia, status) |
| Histórico | `tela-historico` | Todos os ninhos da praia (todos os status) |
| Fila / Meus Ninhos | `tela-fila` | Itens locais com status de sincronização |
| Berçário | `tela-bercarios` | Lotes de filhotes ativos agrupados por berçário |

### 4.2 Telas de formulário

| Tela | ID | Acessada por |
|------|----|-------------|
| Novo Ninho | `tela-form-ninho` | Botão "Registrar" na home |
| Transferência de Ninho | `tela-form-transf` | Ação no card do ninho |
| Registro de Eclosão | `tela-form-eclosao` | Ação no card do ninho |
| Visita de Acompanhamento | `tela-form-visita` | Ação no card do ninho |
| Destino dos Filhotes | `tela-destino-filhotes` | Automático após salvar eclosão |
| Seletor de Berçário | `tela-seletor-bercario` | Botão "Levar ao Berçário" |
| Entrada no Berçário | `tela-form-entrada-bercario` | Após selecionar berçário |
| Soltura de Filhotes | `tela-form-soltura` | Botão "Soltar no Rio" ou "Soltar lote" |
| Nova Ocorrência | `tela-form-ocorrencia` | Dentro do detalhe de lote |
| Detalhe do Lote | `tela-detalhe-lote` | Card de lote em tela-bercarios |

### 4.3 Tela de configuração

| Tela | ID | Descrição |
|------|----|-----------|
| Configurações | `tela-config` | QR de instalação, atualização, alterar PIN, catálogo de espécies, zerar fila, sair |

### 4.4 Navegação flutuante

A **pill nav** (barra flutuante) possui 5 botões:

| Botão | ID | Destino |
|-------|----|---------|
| Mapa / GPS | `nav-gps` | — (abre mapa ou mostra GPS) |
| Ninhos Abertos | `nav-abertos` | `tela-abertos` |
| Novo Ninho (central) | `bio-nav-cam` | `tela-form-ninho` |
| Fila de Envio | `nav-fila` | `tela-fila` |
| Dados / Estatísticas | `nav-dados` | Aba de dados com gráficos |

---

## 5. Formulários — Campos Detalhados

### 5.1 Formulário: Novo Ninho

| Campo | ID | Tipo | Obrig. | Observação |
|-------|----|------|--------|------------|
| Praia | `bio-form-praia-label` | Seletor (sheet) | Sim | Pré-preenchida com praia selecionada |
| Coordenadas GPS | `bio-form-gps-coords` | Texto (somente leitura) | Não | Captura automática; média de N leituras |
| N.º do ninho/placa | `bio-form-numero` | Texto | Sim | Auto-gerado: `SIGLA_PRAIA-SIGLA_ESP-SEQ` |
| Data de encontro | `bio-form-data` | Data | Sim | Padrão: hoje; não aceita data futura |
| Hora da desova | `bio-form-hora-desova` | Hora | Não | Usada para calcular a janela crítica de transferência |
| Espécie | `bio-especie-chip` | Chip (seleção única) | Sim | 8 opções + outro |
| Total de ovos | `bio-form-qtd-ovos` | Número | Não | 0–999 |
| Ovos íntegros | `bio-form-ovos-integros` | Número | Não | 0–999 |
| Ovos descartados | `bio-form-ovos-descartados` | Número | Não | 0–999 |
| Método distância ao rio | `bio-dist-chip` | Toggle | Não | tracker / estimativa |
| Marcar margem do rio | `bio-btn-marcar-rio` | Botão GPS | Não | Captura ponto na margem para calcular distância |
| Distância ao rio (m) | `bio-form-dist-rio` | Número | Não | 0–9999 |
| Temperatura substrato (°C) | `bio-form-temperatura` | Número decimal | Não | 0–60 |
| Umidade (%) | `bio-form-umidade` | Número decimal | Não | 0–100 |
| Profundidade (cm) | `bio-form-profundidade` | Número decimal | Não | 0–200 |
| Fotos | `bio-form-input-foto` | Arquivo (câmera/galeria) | Não | Máx. 3 fotos; enviadas para Storage |
| Observações | `bio-form-obs` | Textarea | Não | Até 1.000 caracteres |

### 5.2 Formulário: Transferência de Ninho

| Campo | ID | Tipo | Obrig. | Observação |
|-------|----|------|--------|------------|
| Ninho (contexto) | `bio-transf-ninho-num` | Texto RO | — | Carregado automaticamente |
| Data da transferência | `bio-transf-data` | Data | Sim | Não pode ser anterior à data de encontro |
| Hora do reenterro | `bio-transf-hora` | Hora | Não | Padrão 06:00 |
| Janela crítica (alerta) | `bio-transf-janela` | Info (semáforo) | — | Verde ≤ 6h · Amarelo 6–12h · Vermelho > 12h |
| Quantidade de ovos | `bio-transf-ovos` | Número | Sim | 1 até qtd. da postura |
| Praia de destino | `bio-transf-praia-btn` | Seletor (sheet) | Sim | Inclui praias experimentais |
| N.º do ninho no destino | `bio-transf-numero` | Texto | Sim | Auto-sugerido pela sequência da praia de destino (`SIGLA_DEST-SIGLA_ESP-SEQ`) ao escolher a praia; editável. Grava em `ninho.numero_atual` |
| Motivo | `bio-transf-motivo` | Select | Não | risco_inundacao / predacao / erosao / concentracao_manejo / pesquisa / outro |
| Sub-local / berçário | `bio-transf-local` | Texto | Não | Ex.: "Berçário 1, quadra A" |
| Observações | `bio-transf-obs` | Textarea | Não | Até 500 caracteres |

### 5.3 Formulário: Registro de Eclosão

| Campo | ID | Tipo | Obrig. | Observação |
|-------|----|------|--------|------------|
| Ninho (contexto) | `bio-ecl-ninho-num` | Texto RO | — | Carregado automaticamente |
| Data de nascimento | `bio-ecl-data` | Data | Sim | Não pode ser anterior à data de encontro |
| Filhotes vivos | `bio-ecl-vivos` | Contador (±) | Não | 0–9999 |
| Filhotes mortos | `bio-ecl-mortos` | Contador (±) | Não | 0–9999 |
| Ovos não nascidos | `bio-ecl-nao-nasc` | Contador (±) | Não | 0–9999 |
| Predação | `bio-pred-opt` | Rádio estilizado | Não | nenhuma / por_pessoas / por_animais |
| Fotos | `bio-ecl-input-foto` | Arquivo | Não | Máx. 3 fotos |

**Ação ao salvar:** ninho.status → `eclodido` · navega para `tela-destino-filhotes`

### 5.4 Formulário: Visita de Acompanhamento

| Campo | ID | Tipo | Obrig. | Observação |
|-------|----|------|--------|------------|
| Ninho (contexto) | `bio-vis-ninho-num` | Texto RO | — | Carregado automaticamente |
| Data da visita | `bio-vis-data` | Data | Sim | Não pode ser anterior à data de encontro |
| Hora da visita | `bio-vis-hora` | Hora | Não | — |
| Status do ninho | `bio-chip-sel` | Chip (seleção única) | Sim | integro / perturbado / parcial_predado / destruido / alagado |
| Temperatura substrato (°C) | `bio-vis-temp-sub` | Número | Não | 20–50 |
| Temperatura ar (°C) | `bio-vis-temp-ar` | Número | Não | 10–50 |
| Umidade do substrato | `bio-chip-sel` | Chip | Não | seco / umido / encharcado |
| Predação durante incubação | `bio-pred-opt` | Rádio | Não | nenhuma / por_animais / por_pessoas / desconhecida |
| Ovos predados | `bio-vis-ovos-pred` | Contador (±) | Condicional | Exibido apenas se predação ≠ nenhuma |
| Sinal de alagamento | `bio-vis-alagamento` | Checkbox | Não | — |
| Intervenção realizada | `bio-vis-intervencao` | Texto | Não | Até 200 caracteres |
| Observações | `bio-vis-obs` | Textarea | Não | Até 500 caracteres |

### 5.5 Formulário: Destino dos Filhotes

Tela intermediária exibida automaticamente após salvar eclosão com filhotes vivos > 0.

| Opção | ID | Descrição |
|-------|----|-----------|
| Soltar no Rio | `bio-dest-rio` | Abre formulário de soltura (via_bercario = false) |
| Levar ao Berçário | `bio-dest-bercario` | Abre seletor de berçário → formulário de entrada |

### 5.6 Formulário: Entrada no Berçário

| Campo | ID | Tipo | Obrig. | Observação |
|-------|----|------|--------|------------|
| Ninho (contexto) | `bio-berc-ninho-num` | Texto RO | — | Carregado automaticamente |
| Berçário | `bio-berc-nome-btn` | Seletor (sheet) | Sim | Lista berçários ativos do servidor |
| Data de entrada | `bio-berc-data` | Data | Sim | Padrão: hoje |
| Hora de entrada | `bio-berc-hora` | Hora | Não | Padrão: hora atual |
| Quantidade de filhotes | `bio-berc-qtd` | Contador (±) | Sim | Pré-preenchido com filhotes_vivos da eclosão |
| Observações | `bio-berc-obs` | Textarea | Não | Até 500 caracteres |

### 5.7 Formulário: Soltura de Filhotes

| Campo | ID | Tipo | Obrig. | Observação |
|-------|----|------|--------|------------|
| Ninho (contexto) | `bio-sol-ninho-num` | Texto RO | — | Carregado automaticamente |
| Data da soltura | `bio-sol-data` | Data | Sim | Padrão: hoje |
| Hora da soltura | `bio-sol-hora` | Hora | Não | Padrão: 06:00 (amanhecer) |
| Filhotes soltados | `bio-sol-qtd` | Contador (±) | Sim | Pré-preenchido com qtd. do lote ou eclosão |
| Mortalidade | `bio-sol-mort` | Contador (±) | Não | Mortes durante período no berçário |
| Ponto de soltura (GPS) | `bio-sol-gps-coords` | Texto RO | Não | Captura automática; salvo como geometry(Point, 4326) |
| Local de soltura | `bio-sol-local` | Texto | Não | Até 200 caracteres |
| Houve predação | `bio-sol-predacao` | Checkbox | Não | — |
| Observações | `bio-sol-obs` | Textarea | Não | Até 500 caracteres |

### 5.8 Formulário: Ocorrência em Berçário

| Campo | ID | Tipo | Obrig. | Observação |
|-------|----|------|--------|------------|
| Tipo | `bio-oc-chip` | Chip (seleção única) | Sim | alimentacao / biometria / mortalidade / doenca / tratamento / observacao |
| Data | `bio-oc-data` | Data | Sim | Padrão: hoje |
| Hora | `bio-oc-hora` | Hora | Não | — |
| Comprimento médio (cm) | `bio-oc-comp` | Número decimal | Condicional | Só exibido se tipo = biometria |
| Peso médio (g) | `bio-oc-peso` | Número decimal | Condicional | Só exibido se tipo = biometria |
| N.º amostrados | `bio-oc-amostrados` | Número | Condicional | Só exibido se tipo = biometria |
| Qtd. afetados | `bio-oc-afetados` | Contador (±) | Condicional | Para mortalidade / doença |
| Causa | `bio-oc-causa` | Texto | Condicional | Para mortalidade / doença |
| Descrição | `bio-oc-descricao` | Textarea | Sim | Até 1.000 caracteres |

---

## 6. Fluxos de Navegação

### 6.1 Fluxo do ciclo de vida de um ninho

```
1. ENCONTRO
   Monitor encontra ninho → Formulário Novo Ninho → Salva offline
   Ninho.status = 'encontrado'

2. INCUBAÇÃO (0–n visitas)
   Visita de Acompanhamento → Registra temperatura, umidade,
   status do ninho, predação, intervenção → Salva offline

3a. TRANSFERÊNCIA (opcional)
   Motivo (inundação, predação, pesquisa...) → Janela crítica calculada
   → Registra praia de destino e condições → Salva offline
   Ninho.praia_atual_id = praia_destino_id

3b. ECLOSÃO
   Registra filhotes vivos/mortos/não nascidos, predação → Salva offline
   Ninho.status = 'eclodido'
   → Tela Destino dos Filhotes

4a. SOLTURA DIRETA NO RIO
   via_bercario = false → Salva offline
   Filhotes liberados

4b. BERÇÁRIO
   Seleciona berçário → Registra entrada → Lote.status = 'ativo'
   ↓
   Ocorrências periódicas (alimentação, biometria, mortalidade...)
   ↓
   Registro de Soltura → via_bercario = true → Lote.status = 'soltado'
```

### 6.2 Fluxo de sincronização

```
App abre ou internet reconecta
    │
    ▼
bioSyncTudo()
    ├── bioSyncNinhos()       → upload fotos → upsert ninhos_quelonios
    ├── bioSyncTransferencias()→ upsert transferencias_ninho
    ├── bioSyncEclosoes()     → upload fotos → upsert eclosoes_ninho
    ├── bioSyncVisitas()      → upsert visitas_ninho
    ├── bioSyncLotes()        → upsert lotes_bercario
    ├── bioSyncSolturas()     → upsert solturas_filhotes
    ├── bioSyncOcorrencias()  → upsert ocorrencias_bercario
    └── bioOfflineLimparConfirmados() → remove registros > 7 dias
```

---

## 7. Banco de Dados — Tabelas e Relações

### 7.1 ninhos_quelonios

Tabela central do módulo. Representa um ninho desde o encontro até o destino final dos filhotes.

| Coluna | Tipo | Obrig. | Descrição |
|--------|------|--------|-----------|
| `id` | uuid | PK | Gerado pelo servidor |
| `uuid_cliente` | uuid | UNIQUE NOT NULL | Gerado offline; chave de upsert |
| `numero_ninho` | text | NOT NULL | Placa de ORIGEM (ex.: ARJ-TA-001). Identidade, IMUTÁVEL |
| `numero_atual` | text | — | Placa na praia atual; muda a cada transferência (sequência do destino). Default = `numero_ninho` |
| `praia_id` | uuid | NOT NULL | Praia onde desovou (IMUTÁVEL) |
| `praia_atual_id` | uuid | — | Localização atual (muda com transferências) |
| `especie` | enum | NOT NULL | Ver lista de espécies |
| `data_encontro` | date | NOT NULL | — |
| `hora_desova` | time | — | Base para janela crítica |
| `qtd_ovos` | smallint | — | Total na postura |
| `ovos_integros` | smallint | — | Ovos sem dano |
| `ovos_descartados` | smallint | — | Descartados antes de incubar |
| `dist_rio_m` | numeric(7,2) | — | Distância medida ao rio |
| `dist_rio_metodo` | text | — | tracker / estimativa |
| `temperatura_c` | numeric(4,1) | — | Temperatura do substrato (°C) |
| `umidade_pct` | numeric(5,1) | — | Umidade (%) |
| `profundidade_cm` | numeric(5,1) | — | Profundidade do ninho (cm) |
| `foto_urls` | jsonb | — | Array de URLs no Storage |
| `ponto_gps` | geometry(Point, 4326) | — | Coordenadas do ninho |
| `status` | enum | DEFAULT 'encontrado' | encontrado / transferido / eclodido / perdido |
| `status_validacao` | enum | DEFAULT 'pendente' | pendente / validado / rejeitado |
| `motivo_rejeicao` | text | — | Motivo se rejeitado |
| `uc_id` | uuid | — | FK → unidades_conservacao |
| `grupo_id` | uuid | — | FK → grupos_biomonitor |
| `monitor_id` | uuid | — | FK → monitores_biodiversidade |
| `temporada_id` | uuid | — | FK → temporadas_monitoramento |
| `criado_em` | timestamptz | NOT NULL | — |
| `sincronizado_em` | timestamptz | — | Timestamp do último sync |

### 7.2 transferencias_ninho

Registra cada movimentação de ninho entre praias.

| Coluna | Tipo | Obrig. | Descrição |
|--------|------|--------|-----------|
| `id` | uuid | PK | — |
| `uuid_cliente` | uuid | UNIQUE NOT NULL | — |
| `ninho_id` | uuid | FK ninhos | — |
| `data_transferencia` | date | NOT NULL | — |
| `hora_transferencia` | time | — | — |
| `qtd_ovos` | smallint | NOT NULL | Quantidade transferida |
| `praia_destino_id` | uuid | FK praias | — |
| `motivo` | enum | — | risco_inundacao / predacao / erosao / concentracao_manejo / pesquisa / outro |
| `local_destino` | text | — | Descrição (berçário, quadra...) |
| `observacoes` | text | — | — |
| `monitor_id` | uuid | FK monitores | — |
| `criado_em` | timestamptz | NOT NULL | — |

### 7.3 eclosoes_ninho

Resultado da abertura do ninho.

| Coluna | Tipo | Obrig. | Descrição |
|--------|------|--------|-----------|
| `id` | uuid | PK | — |
| `uuid_cliente` | uuid | UNIQUE NOT NULL | — |
| `ninho_id` | uuid | FK ninhos | — |
| `data_nascimento` | date | NOT NULL | — |
| `filhotes_vivos` | smallint | NOT NULL | — |
| `filhotes_mortos` | smallint | NOT NULL | — |
| `ovos_nao_nascidos` | smallint | NOT NULL | — |
| `predacao` | enum | DEFAULT 'nenhuma' | nenhuma / por_pessoas / por_animais |
| `foto_urls` | jsonb | — | Array de URLs |
| `observacoes` | text | — | — |
| `monitor_id` | uuid | FK monitores | — |
| `criado_em` | timestamptz | NOT NULL | — |

### 7.4 visitas_ninho

Monitoramento periódico durante a incubação.

| Coluna | Tipo | Obrig. | Descrição |
|--------|------|--------|-----------|
| `id` | uuid | PK | — |
| `uuid_cliente` | uuid | UNIQUE NOT NULL | — |
| `ninho_id` | uuid | FK ninhos | — |
| `data_visita` | date | NOT NULL | — |
| `hora_visita` | time | — | — |
| `status_ninho` | enum | DEFAULT 'integro' | integro / perturbado / parcial_predado / destruido / alagado |
| `temperatura_substrato_c` | numeric(4,1) | — | — |
| `temperatura_ar_c` | numeric(4,1) | — | — |
| `umidade` | enum | — | seco / umido / encharcado |
| `predacao_incubacao` | enum | DEFAULT 'nenhuma' | nenhuma / por_animais / por_pessoas / desconhecida |
| `ovos_predados_n` | smallint | — | — |
| `sinal_alagamento` | boolean | DEFAULT false | — |
| `intervencao` | text | — | Ação realizada pelo monitor |
| `observacoes` | text | — | — |
| `monitor_id` | uuid | FK monitores | — |

### 7.5 bercarios

Cadastro dos berçários de campo.

| Coluna | Tipo | Obrig. | Descrição |
|--------|------|--------|-----------|
| `id` | uuid | PK | — |
| `nome` | text | NOT NULL | Ex.: "Berçário 1" |
| `tipo` | enum | DEFAULT 'tanque_fibra' | tanque_fibra / piscina_alvenaria / viveiro / outro |
| `capacidade_max` | smallint | — | Capacidade máxima de filhotes |
| `localizacao_descricao` | text | — | Descrição do local |
| `uc_id` | uuid | FK UCs | — |
| `responsavel_id` | uuid | FK monitores | — |
| `status` | boolean | DEFAULT true | true = ativo |
| `observacoes` | text | — | — |
| `criado_em` | timestamptz | NOT NULL | — |

### 7.6 lotes_bercario

Grupo de filhotes de um ninho que entrou em berçário.

| Coluna | Tipo | Obrig. | Descrição |
|--------|------|--------|-----------|
| `id` | uuid | PK | — |
| `uuid_cliente` | uuid | UNIQUE NOT NULL | — |
| `ninho_id` | uuid | FK ninhos | — |
| `bercario_id` | uuid | FK bercarios | — |
| `bercario_nome` | text | NOT NULL | Nome do berçário (texto livre para compatibilidade offline) |
| `data_entrada` | date | NOT NULL | — |
| `hora_entrada` | time | — | — |
| `qtd_entrada` | smallint | NOT NULL | Quantidade de filhotes |
| `status` | enum | DEFAULT 'ativo' | ativo / soltado / cancelado |
| `observacoes` | text | — | — |
| `monitor_id` | uuid | FK monitores | — |

### 7.7 solturas_filhotes

Evento de liberação dos filhotes (direta ou via berçário).

| Coluna | Tipo | Obrig. | Descrição |
|--------|------|--------|-----------|
| `id` | uuid | PK | — |
| `uuid_cliente` | uuid | UNIQUE NOT NULL | — |
| `ninho_id` | uuid | FK ninhos | — |
| `lote_bercario_id` | uuid | FK lotes | Preenchido apenas se via_bercario = true |
| `via_bercario` | boolean | NOT NULL | false = soltura direta; true = saída do berçário |
| `data_soltura` | date | NOT NULL | — |
| `hora_soltura` | time | — | — |
| `qtd_soltada` | smallint | NOT NULL | — |
| `mortalidade` | smallint | DEFAULT 0 | Mortes no período do berçário |
| `ponto_soltura` | geometry(Point, 4326) | — | Coordenadas GPS do local de soltura |
| `local_descricao` | text | — | — |
| `predacao_soltura` | boolean | DEFAULT false | Houve predação durante a soltura |
| `observacoes` | text | — | — |
| `monitor_id` | uuid | FK monitores | — |

### 7.8 ocorrencias_bercario

Eventos periódicos registrados enquanto os filhotes estão no berçário.

| Coluna | Tipo | Obrig. | Descrição |
|--------|------|--------|-----------|
| `id` | uuid | PK | — |
| `uuid_cliente` | uuid | UNIQUE NOT NULL | — |
| `lote_id` | uuid | FK lotes | — |
| `tipo` | enum | NOT NULL | alimentacao / biometria / mortalidade / doenca / tratamento / observacao |
| `data_ocorrencia` | date | NOT NULL | — |
| `hora_ocorrencia` | time | — | — |
| `comprimento_medio_cm` | numeric(5,1) | — | Para tipo biometria |
| `peso_medio_g` | numeric(6,1) | — | Para tipo biometria |
| `n_amostrados` | smallint | — | Para tipo biometria |
| `qtd_afetados` | smallint | DEFAULT 0 | Para mortalidade / doença |
| `causa` | text | — | Para mortalidade / doença |
| `descricao` | text | NOT NULL | Descrição / observações |
| `monitor_id` | uuid | FK monitores | — |

### 7.9 Outras tabelas de suporte

| Tabela | Descrição |
|--------|-----------|
| `monitores_biodiversidade` | Perfis dos monitores com vinculo a grupo e usuário |
| `grupos_biomonitor` | Grupos de monitoramento ligados a programas e UCs |
| `programas_monitoramento` | Programas (PQRA, TAMAR, etc.) |
| `praias_monitoramento` | Cadastro de praias com geometria, comprimento_m, código |
| `temporadas_monitoramento` | Temporadas anuais de monitoramento |
| `unidades_conservacao` | UCs com geometria PostGIS |

---

## 8. Funções RPC (Supabase)

### 8.1 bio_monitor_atual()

```sql
RETURNS TABLE (
  id, usuario_id, nome_completo, grupo_id, grupo_nome,
  programa_id, programa_nome, uc_id, foto_url, deve_trocar_senha
)
```

Chamada no início de cada sessão para verificar se o usuário autenticado é um monitor ativo e carregar seus dados.

### 8.2 bio_monitor_iniciar_sessao(p_dispositivo, p_app_versao)

```sql
RETURNS uuid  -- sessao_id para auditoria
```

Registra a abertura da sessão com dispositivo e versão do app.

### 8.3 bio_dados_aba(p_temporada_id uuid DEFAULT NULL)

```sql
RETURNS jsonb {
  -- KPIs individuais do monitor
  meus_ninhos, grupo_ninhos, eclodidos, filhotes_vivos,
  total_ovos_postura, total_filhotes_mortos, total_ovos_nao_nascidos,

  -- 9 taxas científicas (0–100, arredondadas)
  taxa_eclosao_pct,
  taxa_sucesso_nidificacao_pct,
  taxa_fertilidade_pct,
  eficiencia_ninho_pct,
  taxa_predacao_pct,
  taxa_transferencia_pct,
  incubacao_media_dias,
  taxa_sobrevivencia_bercario_pct,
  taxa_mortalidade_bercario_pct,

  -- Séries para gráficos
  por_especie: [...],
  por_mes:     [...],
  top_praias:  [...],

  -- Berçário
  bercario_total_lotes, bercario_total_entrada,
  bercario_total_soltado, bercario_mortalidade,
  ocorrencias_tipos: [...],
  biometria_serie:   [...]
}
```

Usada na **aba Dados** do app de campo.

### 8.4 bio_relatorio_completo(p_temporada_id, p_programa_id, p_uc_id, p_praia_id)

```sql
-- Todos os parâmetros são opcionais (DEFAULT NULL = sem filtro)
RETURNS jsonb {
  kpis: {
    -- Contagens
    total_ninhos, eclodidos, perdidos, transferidos, pendentes,
    total_ovos_postura, total_ovos_integros, total_ovos_descartados,
    total_filhotes_vivos, total_filhotes_mortos, total_ovos_nao_nascidos,

    -- Médias ambientais
    media_ovos_postura, dist_rio_media_m, temp_media_c,
    umidade_media_pct, profundidade_media_cm, incubacao_media_dias,

    -- 9 taxas científicas
    taxa_eclosao_pct, taxa_sucesso_nidificacao_pct, taxa_fertilidade_pct,
    eficiencia_ninho_pct, taxa_predacao_pct, taxa_transferencia_pct,
    taxa_sobrevivencia_bercario_pct, taxa_mortalidade_bercario_pct,

    -- Berçário
    bercario_total_lotes, bercario_total_entrada,
    bercario_total_soltado, bercario_mortalidade,
    solturas_direto_rio, solturas_via_bercario,

    -- Predação detalhada
    predacao_pessoas, predacao_animais, sem_predacao
  },

  -- Séries temporais e por dimensão
  por_mes:          [{mes, ninhos, eclodidos, filhotes, media_ovos}],
  por_ano:          [{ano, ninhos, eclodidos, filhotes, taxa_eclosao_pct}],
  por_especie:      [{especie, total, eclodidos, filhotes_vivos,
                       taxa_eclosao_pct, eficiencia_pct,
                       incubacao_media_dias, dist_rio_media_m, temp_media_c}],
  por_praia:        [{praia_nome, ninhos_total, eclodidos, filhotes_vivos,
                       taxa_eclosao_pct, densidade_ninhos_km, media_ovos}],
  por_uc:           [{uc_nome, uc_sigla, ninhos_total, eclodidos,
                       filhotes_vivos, taxa_eclosao_pct, media_ovos}],
  por_monitor:      [{monitor_nome, grupo_nome, ninhos, eclodidos,
                       filhotes_vivos, taxa_eclosao_pct}],
  biometria_serie:  [{data, comp_medio, peso_medio, n_amostrados}],
  ocorrencias_tipos:[{tipo, total}]
}
```

Usada na **página de relatórios**. Implementada com CTE `base_ids` para eficiência com filtros compostos.

---

## 9. Funcionalidade Offline

### 9.1 IndexedDB — Stores

| Store | keyPath | Índices | Conteúdo |
|-------|---------|---------|----------|
| `ninhos` | `uuid_cliente` | status, status_sync, praia_id, criado_em | Ninhos de quelônios |
| `transferencias` | `uuid_cliente` | ninho_uuid, status_sync | Transferências |
| `eclosoes` | `uuid_cliente` | ninho_uuid, status_sync | Eclosões |
| `visitas` | `uuid_cliente` | ninho_uuid, status_sync | Visitas de acompanhamento |
| `lotes` | `uuid_cliente` | ninho_uuid, status_sync, status | Lotes de berçário |
| `solturas` | `uuid_cliente` | ninho_uuid, lote_uuid, status_sync | Solturas |
| `ocorrencias` | `uuid_cliente` | lote_uuid, status_sync | Ocorrências de berçário |
| `praias` | `id` | uc_id, programa_id | Cache de praias do servidor |
| `bercarios_cache` | `id` | status | Cache de berçários do servidor |
| `config` | `chave` | — | Configurações e PIN |

### 9.2 Estados de sincronização

| Estado | Descrição |
|--------|-----------|
| `pendente` | Criado offline; aguardando envio |
| `enviando` | Upload em progresso (bloqueio contra duplicata) |
| `confirmado` | Recebido pelo servidor; retido 7 dias localmente |

### 9.3 Armazenamento persistente

Solicita `navigator.storage.persist()` na inicialização para prevenir que o browser apague os dados em situações de pressão de memória.

### 9.4 Configurações no store `config`

| Chave | Conteúdo |
|-------|----------|
| `pin_hash` | Hash SHA-256 do PIN de 4 dígitos |
| `monitor` | Dados completos do monitor (nome, grupo, foto) |
| `praia_selecionada` | ID da última praia usada |
| `praias_ultima_sync` | Timestamp do último pull de praias |
| `ninhos_ultima_sync` | Timestamp do último pull de ninhos |
| `persistencia_concedida` | Booleano: storage persistente concedido |
| `bio_logos_cache_v1` | Cache dos logos para tela de login |

---

## 10. Motor de Sincronização

### 10.1 bioSyncTudo — ordem de execução

```
1. bioSyncNinhos()
   ├── Para cada ninho pendente:
   │   ├── Upload de fotos (dataURL → Storage bucket 'biomonitor-fotos')
   │   │   Caminho: ninhos/{uuid}/{index}.{jpg|png}
   │   └── UPSERT ninhos_quelonios ON CONFLICT (uuid_cliente)
   │
2. bioSyncTransferencias()
   └── UPSERT transferencias_ninho (depende de ninho.server_id)
   
3. bioSyncEclosoes()
   ├── Upload de fotos
   │   Caminho: eclosoes/{uuid}/{index}.{jpg|png}
   └── UPSERT eclosoes_ninho
   
4. bioSyncVisitas()
   └── UPSERT visitas_ninho
   
5. bioSyncLotes()
   └── UPSERT lotes_bercario
   
6. bioSyncSolturas()
   └── UPSERT solturas_filhotes
   
7. bioSyncOcorrencias()
   └── UPSERT ocorrencias_bercario
   
8. bioOfflineLimparConfirmados()
   └── Remove registros com status_sync = 'confirmado' > 7 dias
```

### 10.2 Cache do servidor (pull)

| Função | Descrição | Quando chamada |
|--------|-----------|----------------|
| `bioSyncCachePraias(grupoId)` | Atualiza IndexedDB com praias do servidor | Na abertura do app (aguarda se online) |
| `bioSyncCacheBercarios()` | Atualiza IndexedDB com berçários ativos | Na abertura do app (em paralelo com praias) |
| `bioSyncPullNinhos(grupoId)` | Importa ninhos de outros monitores do grupo | Invocado pelo usuário ou sync periódico |

### 10.3 Gatilhos de sincronização

- Abertura do app (se online)
- Reconexão à internet (`window.addEventListener('online', ...)`)
- Após salvar qualquer registro (sync imediato em background)
- Botão de reload manual na tela de berçário e fila

---

## 11. GPS e Câmera

### 11.1 GPS

| Função | Descrição |
|--------|-----------|
| `watchPosition()` | Monitoramento contínuo; atualiza card na home |
| `bioCapturarPosicaoMedia(n, intervalo, onProgresso)` | Captura n leituras, filtra outliers e retorna média |

**Configuração de captura:**
- Modo padrão: 5 leituras com intervalo de 3 s
- Modo preciso: 10 leituras com intervalo de 4 s
- Filtro: mediana ± 2 desvios-padrão (remove leituras anômalas)
- Resultado: latitude, longitude, precisão média (m)

### 11.2 Câmera

| Contexto | Método | Observação |
|----------|--------|------------|
| Web / PWA | `<input type="file" capture="environment" accept="image/*">` | Abre câmera nativa do SO |
| APK Android | Plugin Capacitor Camera | Permissões CAMERA + PHOTOS |
| Galeria | Mesmo input sem `capture` | Seleção de arquivo existente |

**Limites:**
- Máx. 3 fotos por ninho / eclosão
- Fotos armazenadas como `dataURL` no IndexedDB até a sincronização
- Upload para bucket `biomonitor-fotos` no Supabase Storage
- Fotos já com URL HTTP passam direto (sem re-upload)

---

## 12. Página de Relatórios Científicos

**Arquivo:** `pages/relatorios-biomonitor.html`  
**RPC:** `bio_relatorio_completo`

### 12.1 Filtros

| Filtro | Descrição |
|--------|-----------|
| Temporada | Temporada de monitoramento (select) |
| Programa | Programa de monitoramento (PQRA, TAMAR...) |
| Unidade de Conservação | Filtra praias em cascata |
| Praia | Cascata: lista apenas praias da UC selecionada |

### 12.2 Ações

| Botão | Função |
|-------|--------|
| Aplicar | Chama RPC e renderiza todos os gráficos e tabelas |
| Imprimir / PDF | `window.print()` com `@media print` configurado |
| Exportar CSV | Gera CSV com dados de praias e espécies |

### 12.3 Seções e gráficos

#### Seção 1 — Visão Geral

| Elemento | Tipo | Dados |
|----------|------|-------|
| 12 cards KPI | Cards | Total ninhos, ovos, filhotes, médias ambientais |
| Status dos ninhos | Doughnut | encontrado / transferido / eclodido / perdido |
| Desfecho dos ovos | Doughnut | filhotes vivos / mortos / não nascidos / descartados |

#### Seção 2 — Taxas Científicas

8 cards com barra de progresso (0–100%) para cada taxa. Ver seção 13 deste documento.

#### Seção 3 — Fenologia

| Gráfico | Tipo | Eixos |
|---------|------|-------|
| Ninhos e filhotes por mês | Linha (eixo duplo) | Eixo Y1: ninhos; Eixo Y2: filhotes |
| Tendência interanual | Barras agrupadas | Ninhos + filhotes por ano |

#### Seção 4 — Análise por Espécie

| Elemento | Tipo | Dados |
|----------|------|-------|
| Total por espécie | Barras verticais agrupadas | Total de ninhos + eclodidos por espécie |
| Comparativo multidimensional | Radar | 5 eixos: taxa eclosão, eficiência, incubação média, média ovos, filhotes vivos |
| Tabela detalhada | Tabela (12 colunas) | Total, eclodidos, perdidos, transferidos, filhotes, taxas, médias ambientais |

Cores por espécie:

| Espécie | Cor |
|---------|-----|
| tracaja | `#2A9D6F` (verde-água) |
| tartaruga | `#1A6B8C` (azul-rio) |
| cabecudo | `#C9A84C` (ouro) |
| pitiU | `#7ECEE8` (ciano) |
| cupido | `#D97706` (âmbar) |
| jabuti_pe_elefante | `#6366f1` (índigo) |
| jabuti_piranga | `#8b5cf6` (violeta) |
| mucua | `#ec4899` (rosa) |
| outro | `#9CA3AF` (cinza) |

#### Seção 5 — Por Praia e UC

| Elemento | Tipo | Dados |
|----------|------|-------|
| Top 10 praias | Barras horizontais (dinâmicas) | Ninhos por praia; cor por taxa de eclosão |
| Ninhos por UC | Barras horizontais | Total por unidade de conservação |
| Tabela de praias | Tabela (11 colunas) | Inclui densidade ninhos/km |
| Tabela de UCs | Tabela (8 colunas) | — |

**Métrica exclusiva: Densidade de ninhos por km de praia**
```
densidade_ninhos_km = 1000 × total_ninhos / comprimento_m_da_praia
```

#### Seção 6 — Gestão de Berçário

| Elemento | Tipo | Dados |
|----------|------|-------|
| 4 cards KPI | Cards | Lotes, entrada total, soltados, mortalidade |
| Destino dos filhotes | Doughnut | Soltura direta × via berçário |
| Ocorrências por tipo | Barras verticais | alimentação / biometria / mortalidade / doença / tratamento |
| Curva de crescimento | Linha (eixo duplo) | Comprimento médio (cm) + peso médio (g) ao longo do tempo |

#### Seção 7 — Desempenho por Monitor

| Elemento | Tipo | Dados |
|----------|------|-------|
| Top 15 monitores | Barras horizontais | Ninhos registrados por monitor |
| Tabela | Tabela (6 colunas) | Monitor, grupo, ninhos, eclodidos, filhotes vivos, taxa eclosão |

---

## 13. Taxas e Indicadores Científicos

Protocolo baseado em PQRA / TAMAR / ICMBio.

| Taxa | Fórmula | Interpretação |
|------|---------|---------------|
| **Taxa de Eclosão** | `filhotes_vivos / (vivos + mortos + não_nascidos) × 100` | Proporção de ovos que resultaram em filhotes vivos |
| **Sucesso de Nidificação** | `ninhos_eclodidos / total_ninhos × 100` | Proporção de ninhos que eclodiram com sucesso |
| **Taxa de Fertilidade** | `ovos_íntegros / ovos_postura × 100` | Proporção de ovos potencialmente férteis na postura |
| **Eficiência do Ninho** | `filhotes_vivos / ovos_íntegros × 100` | Filhotes gerados por ovo íntegro incubado |
| **Taxa de Predação** | `ninhos_perdidos / total_ninhos × 100` | Proporção de ninhos destruídos ou predados |
| **Taxa de Transferência** | `ninhos_transferidos / total_ninhos × 100` | Proporção de ninhos que precisaram ser movidos |
| **Incubação Média** | `AVG(data_nascimento − data_encontro)` em dias | Período médio de desenvolvimento embrionário |
| **Sobrevivência no Berçário** | `filhotes_soltados / filhotes_entrada × 100` | Taxa de sobrevida no berçário até a soltura |
| **Mortalidade no Berçário** | `mortalidade_total / filhotes_entrada × 100` | Taxa de mortes durante permanência no berçário |

---

## 14. Regras de Negócio

### 14.1 Janela crítica de transferência

A transferência de ovos deve ocorrer antes que o embrião passe por gastrulação (diferenciação celular), fase em que o manuseio causa morte embrionária.

| Horas desde a desova | Semáforo | Mensagem |
|---------------------|----------|----------|
| ≤ 6 h | Verde | Janela segura |
| 6–12 h | Amarelo | Atenção — transfira o quanto antes |
| > 12 h | Vermelho | Fora da janela — risco de morte embrionária |

**Cálculo:** `(data_transferência + hora_reenterro) − (data_encontro + hora_desova)`. Se hora_desova não foi informada, usa-se 06:00 (padrão para ambiente diurno).

### 14.2 Geração automática do número do ninho

```
SIGLA_PRAIA-SIGLA_ESPECIE-NÚMERO_SEQUENCIAL
```
Exemplo: `ARJ-TA-047` (praia Ariquemes, tracajá, ninho 47)

### 14.3 Precedência praia de origem vs. localização atual

- `praia_id` — Onde a fêmea desovou. **Imutável.** Usado para cálculo de densidade de ninhos por km.
- `praia_atual_id` — Onde os ovos estão incubando agora. Atualizado a cada transferência.

### 14.4 Status do ninho

| Status | Transição | Condição |
|--------|-----------|----------|
| `encontrado` | Estado inicial | — |
| `transferido` | `encontrado` → `transferido` | Ao salvar transferência |
| `eclodido` | qualquer → `eclodido` | Ao salvar eclosão |
| `perdido` | — | Via visita (status_ninho = destruido) ou eclosão com 0 filhotes |

### 14.5 Validação científica

Ninhos têm `status_validacao` (pendente / validado / rejeitado / em_correcao) com `motivo_rejeicao` opcional. Validação por gestor ou técnico em `biomonitor-validacao.html` (filtro abre em "Todos" para não esconder os devolvidos).

**Ciclo de correção (app de campo):** quando o gestor marca `em_correcao`, o app de campo:
- baixa a mudança no sync (`bioSyncPullNinhos`, agora chamado dentro de `bioSyncTudo`);
- mostra um card "X ninhos precisam de correção" na home (`bio-correcao-card`) que abre a lista filtrada;
- exibe o motivo no card do ninho + botão **Corrigir**, que abre o formulário pré-preenchido;
- ao reenviar, o ninho volta a `status_validacao = 'pendente'` (motivo limpo) e re-sincroniza.

### 14.6 Lote de berçário — controle de status

| Status | Significado |
|--------|-------------|
| `ativo` | Filhotes ainda no berçário |
| `soltado` | Todos os filhotes foram soltos |
| `cancelado` | Lote cancelado pelo monitor |

### 14.7 Fotos — pipeline

```
Câmera / Galeria → dataURL no IndexedDB
    ↓ (na sync)
Upload para Storage (biomonitor-fotos)
    ↓
URL pública salva no array foto_urls (jsonb) do registro
    ↓
IndexedDB atualizado com URLs (evita re-upload)
```

---

## 15. Design System

### 15.1 Paleta de cores "Rio"

| Token CSS | Valor | Uso |
|-----------|-------|-----|
| `--bio-prim` | `#1A6B8C` | Azul-rio; botões primários, headers, foco |
| `--bio-verde` | `#2A9D6F` | Verde-água; positivo, eclosão, sucesso |
| `--bio-ouro` | `#C9A84C` | Neutro; ovos, avisos leves |
| `--bio-alerta` | `#D97706` | Âmbar; warning moderado |
| `--bio-perigo` | `#DC2626` | Vermelho; erro, crítico, perdido |
| `--bio-soft` | `#7ECEE8` | Ciano; realces, GPS ativo, berçário |
| `--bio-app-bg` | `#F2F7FA` | Fundo geral |
| `--bio-surface` | `#FFFFFF` | Cards, modais |
| `--bio-ink` | `#0D1E27` | Texto escuro principal |
| `--bio-muted` | `#6B7280` | Texto secundário |
| `--bio-border` | `#E5EBF0` | Bordas de cards |

### 15.2 Tipografia

| Fonte | Uso |
|-------|-----|
| `DM Sans` | Toda a UI (labels, body, botões) |
| `DM Mono` | Números (KPIs, coordenadas, contadores) |

### 15.3 Componentes principais

| Componente | Classe CSS | Descrição |
|------------|------------|-----------|
| Tela bloqueio | `.bio-lock` | Gradiente verde-azul com animação |
| Header da home | `.bio-home-header` | Avatar do monitor + saudação + chip de conexão |
| Card GPS | `.bio-gps-card` | Radar animado + coordenadas |
| Seletor de praia | `.bio-praia-seletor` | Chip clicável com nome e código |
| Botão de ação | `.bio-acao-btn` | Buttons grandes com ícone + badge de contagem |
| Seção de formulário | `.bio-form-section` | Card com label + conteúdo |
| Chip de espécie | `.bio-especie-chip` | Seletor com sigla + nome |
| Contador | `.bio-counter-row` | Botões ± com valor central |
| Predação radio | `.bio-pred-opt` | Radio estilizado em card |
| Nav flutuante | `.bio-pill-nav` | 5 botões + botão central elevado |
| Card de ninho | `.bio-nfc` | Borda colorida por status + info do ninho |
| Bottom sheet | `.bio-sheet` | Modal inferior com backdrop |
| Toast | `.bio-toast` | Notificação flutuante (ok / err / warn) |
| Banner atualização | `.bio-update-banner` | Aviso de nova versão disponível |
| Aba de dados | `.bio-dados-tab` | Tabs Taxas / Ninhos / Berçário |
| Card de taxa | `.bio-rate-card` | Label + valor percentual + barra de progresso |
| Card de gráfico | `.bio-chart-card` | Wrapper para canvas Chart.js |

---

## 16. Estrutura de Arquivos

```
siguc-ac/
├── pages/
│   ├── biomonitor.html                  App de campo (16 telas)
│   └── relatorios-biomonitor.html       Relatórios científicos
│
├── js/
│   ├── biomonitor-quelonios.js          Lógica principal (~2.900 linhas)
│   ├── biomonitor-offline.js            IndexedDB / armazenamento offline
│   └── biomonitor-sync.js               Motor de sincronização
│
├── css/
│   └── biomonitor.css                   Design system "Rio" (~1.500 linhas)
│
├── pwa/
│   ├── manifest-biomonitor.json         Manifesto PWA
│   ├── sw.js                            Service worker (cache versionado)
│   └── icons/
│       ├── biomonitor-logo.png
│       ├── mascote.png
│       └── mascote-copa.png
│
└── supabase/migrations/
    ├── 074_biomonitor_quelonios.sql      Base: monitores, ninhos, eclosões
    ├── 078_praias_biomonitor.sql         Views de praias
    ├── 080_transferencia_entre_praias.sql
    ├── 081_janela_critica_transferencia.sql
    ├── 082_ninho_praia_atual_default.sql
    ├── 083_vw_praias_geojson.sql
    ├── 084_educacao_ambiental.sql
    ├── 085_praia_localizacao_livre.sql
    ├── 086_visitas_ninho.sql
    ├── 087_pos_eclosao.sql               lotes_bercario + solturas_filhotes
    ├── 088_bercarios.sql                 Tabela bercarios + FK no lote
    ├── 089_ocorrencias_bercario.sql      Eventos no berçário
    ├── 090_bio_dados_aba.sql             RPC bio_dados_aba
    ├── 091_bio_relatorio_rpc.sql         RPC bio_relatorio_completo
    └── 092_ninho_numero_atual.sql        numero_atual (placa na praia de destino)
```

---

*Documento gerado em 27/06/2026. Sistema SIGUC-AC — SEMA-AC / DIMA.*
