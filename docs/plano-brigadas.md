# Plano — SIGUC Brigadas (App de Campo Móvel)

> Documento de planejamento para retomar em outra sessão.
> Branch de desenvolvimento: `claude/mobile-firefighter-app-g44187`
> Status: **plano completo e validado** — pronto para implementar (nada codado ainda).

## 1. Visão geral

Um **PWA offline-first** ("SIGUC Brigadas") para **brigadistas comunitários** que atuam
em Unidades de Conservação do Acre registrarem ocorrências em campo (incêndio, prevenção,
educação ambiental, fauna etc.), com **foto carimbada** (coordenada geográfica + data/hora),
funcionando **com ou sem internet**. Ao pegar sinal, o app **descarrega os dados no SIGUC**,
onde aparecem no mapa e nos relatórios.

Substitui uma planilha manual usada hoje (ver `docs/` / Drive) e elimina os erros dela
(coordenadas trocadas, datas malformadas, nomes digitados errado, decimais inconsistentes).

### Por que PWA (e não app nativo / não migrar stack)
- Sem loja de aplicativos: instala por link/QR, atualiza sozinho (crítico p/ comunidades remotas).
- Reaproveita Supabase, Auth e design system existentes — respeita "não migrar para Next.js".
- Offline real: Service Worker (cache do app) + IndexedDB (fila) + Background Sync.

### Inspirações
Forest Watcher (WRI/GFW), SMART Mobile (ICMBio), ODK Collect / KoBoCollect, Survey123 (Esri),
CyberTracker, fluxo das brigadas Prevfogo/IBAMA. Lição: UI de toques grandes, pouca digitação,
uso com uma mão sob sol forte, e o registro nunca se perde sem sinal.

## 2. Decisões fechadas

| Tema | Decisão |
|---|---|
| Plataforma | PWA (sem migrar stack); Android + iOS; instala por QR |
| Login | Supabase + perfil `brigadista`; **chefe + designados** têm login; **PIN** offline |
| Taxonomia | **NATUREZA → ATIVIDADE** (igual à planilha); app **aposenta a planilha** (cobre todos os campos) |
| Fauna | sub-registro rico, catálogo offline + texto livre + foto; detalhe **completo**; alinhado **Darwin Core** |
| Cadastro | brigadas (10 brigadistas + 1 chefe) vinculadas à UC; **UC automática + conferência GPS** |
| Durabilidade | IndexedDB persistente, gravação atômica, **backup 7 dias** + **export manual** |
| Sync | 2 fases, idempotência por `uuid_cliente`, upload resumável (TUS), Background Sync, **compressão adaptativa** |
| Fotos | **alta qualidade (~2400px), até 5 por registro**; cede graciosamente em celular fraco/memória cheia |
| Validação | inbox do gestor, **correção direta** (+ devolver ao chefe), **biólogo** valida fauna, **promover a ocorrência** |
| Relatórios | **3 níveis** (UC/regional/estadual); **PDF + Excel/CSV + Darwin Core + dashboard**; **todos os sincronizados** com selo de status |
| CIGMA/CBMAC | **loop alerta↔veredito** + **aba de tarefas** no app; CBMAC = **flag + relatório** |
| Catálogo fauna | **núcleo curado (~200–400)**; **eu gero a semente, biólogo revisa**; **miniaturas das ameaçadas offline** |

## 3. Modelo de dados (Supabase + PostGIS)

### 3.1 `brigadas`
```
id            uuid PK
nome          text          -- Alfa, Bravo, Charlie...
uc_id         uuid -> unidades_conservacao
regional      enum          -- baixo_acre, purus, jurua, tarauaca_envira, alto_acre
chefe_id      uuid -> brigadistas
base_municipio text
data_formacao date
ativo         boolean
```

### 3.2 `brigadistas`
```
-- vínculo
id              uuid PK
usuario_id      uuid -> usuarios   (login do app; NULL se não usa o app)
brigada_id      uuid -> brigadas   (define a UC automaticamente)
funcao          enum: chefe_brigada | brigadista
-- dados pessoais
nome_completo   text
sexo            enum: masculino | feminino | outro
data_nascimento date
cpf             text
rg              text
foto_url        text          -- bucket Storage 'brigadistas'
telefone        text
email           text
-- endereço (contexto rural/comunidade)
comunidade      text
logradouro      text
numero          text
bairro          text
municipio       text
uf              text DEFAULT 'AC'
cep             text
ponto_referencia text         -- "ramal do X, km 12"
-- segurança operacional (brigada de incêndio)
tipo_sanguineo  text
alergias        text
contato_emergencia_nome     text
contato_emergencia_telefone text
-- gestão do vínculo
tipo_vinculo    text          -- voluntário, contratado, convênio
data_admissao   date
data_desligamento date
ativo           boolean
criado_em / atualizado_em
```

### 3.3 `registros_campo`
```
id                uuid PK
uuid_cliente      uuid UNIQUE        -- idempotência na sync
natureza          enum: prevencao | combate | monitoramento
atividade         enum: fogo | educacao_ambiental | limpeza | reconhecimento |
                        plantio | primeiros_socorros | queima_controlada | outro
equipe            enum: alfa | bravo | charlie    (ou texto padronizado)
data_inicio       date
data_fim          date               -- atividade multi-dia
pessoas_alcancadas int
localizacao       geometry(Point,4326)   -- GPS automático, índice GIST
precisao_gps_m    numeric
altitude_m        numeric
data_hora_evento  timestamptz
fotos_urls        text[]             -- Storage, coord+data carimbadas
area_estimada_ha  numeric            -- só incêndio
uc_id             uuid -> unidades_conservacao   -- herda da brigada; ST_Within confere
municipio         text
regional          enum
alerta_cigma      boolean
integrada_cbmac   boolean
veiculo           enum: caminhonete | moto | outro
animais_resgatados int               -- contagem rápida (detalhe vai em registro_fauna)
descricao         text
brigadista_id     uuid -> usuarios/brigadistas
origem            text DEFAULT 'app_brigada'
-- validação (gestor)
status_validacao  enum: aguardando | validado | requer_correcao | rejeitado
validado_por      uuid -> usuarios
validado_em       timestamptz
ocorrencia_id     uuid -> ocorrencias   -- quando promovido
-- CIGMA
alerta_id         uuid -> alertas        -- FK opcional (módulo B)
veredito_campo    enum: confirmado | falso_positivo | nao_localizado
-- sync
sincronizado_em   timestamptz
criado_em / atualizado_em
```

### 3.4 `registro_fauna` (1 registro_campo -> N animais; alinhado Darwin Core)
```
id                  uuid PK
registro_campo_id   uuid -> registros_campo
classe              enum: mamifero | ave | reptil | anfibio | peixe | invertebrado | nao_sei
especie_id          uuid -> especies_fauna   (NULL se não identificada)
nome_popular        text
nome_cientifico     text
quantidade          int DEFAULT 1
condicao            enum: integro | ferido | debilitado | queimado | obito
tipo_evento         enum: resgate | avistamento | atropelamento | apreensao | encontrado_morto
causa_aparente      enum: incendio | atropelamento | fio_eletrico | caca | outro | indeterminada
destinacao          enum: solto_no_local | encaminhado_cetas | obito | em_tratamento | outro
sexo                enum: macho | femea | indeterminado
faixa_etaria        enum: filhote | jovem | adulto | indeterminada
ameacada            boolean
fotos_urls          text[]
observacoes         text
identificado_por    uuid -> usuarios
identificacao_confirmada boolean DEFAULT false
criado_em
```

### 3.5 `especies_fauna` (catálogo de referência, cacheado offline)
```
id, nome_cientifico, nomes_populares text[],
classe, ordem, familia,
status_conservacao,        -- MMA Port. 148/2022 / IUCN
ameacada boolean, porte,   -- pequeno/médio/grande
foto_referencia_url,       -- carregada quando online; miniatura das ameaçadas baixada offline
versao_catalogo, ativo
```

### 3.6 `alertas` (esqueleto agora; populado no módulo B)
Tabela mínima para a ligação `registros_campo.alerta_id`. Ingestão DETER-B/BDQueimadas/FIRMS = módulo B.

### Perfis / Enums novos
- `perfil_usuario`: adicionar **`brigadista`** e **`biologo`**.
- Novos enums: `natureza`, `atividade_campo`, `status_validacao`, `veredito_campo`,
  `regional`, `sexo`, e os enums de fauna (classe/condicao/tipo_evento/causa/destinacao/sexo/faixa_etaria).
- Todas as tabelas novas com **RLS habilitado**.
  - brigadista: insere/vê os seus; chefe: vê/edita sua brigada; gestor/técnico: UC/regional; biólogo: registros de fauna; admin: tudo.

### Buckets Storage
- `brigadistas` (fotos de cadastro)
- `registros-campo` (fotos das ocorrências)

## 4. Robustez (BYOD, qualquer modelo, offline)

### Durabilidade no celular
- IndexedDB (não cache comum) + `navigator.storage.persist()` (impede despejo automático).
- Instalar o PWA na tela inicial (armazenamento mais protegido).
- Gravação **atômica** numa transação antes de tudo (à prova de crash/bateria).
- Estados: `pendente -> enviando -> confirmado`. Nada é apagado antes do servidor confirmar.
- Confirmados retidos **~7 dias** como backup (purgados antes se faltar memória; pendentes nunca).
- Fila sempre visível + **export manual** dos pendentes (arquivo/WhatsApp).
- Honestidade: desinstalar/limpar dados manualmente pode perder — daí sync cedo + backup.

### Transmissão sem perdas
- Idempotência por `uuid_cliente` (servidor faz upsert; reenvio não duplica).
- Sync em **2 fases**: sobe foto -> verifica integridade -> insere a linha -> "OK" do servidor -> `confirmado`.
- Upload **resumável (TUS)** do Supabase Storage para redes fracas.
- **Background Sync** (Android reenvia até com app fechado); fallback em primeiro plano (iOS).
- Backoff exponencial; esgotou -> fica `pendente` (jamais descarta).

### Memória cheia
- Compressão de imagem (Web Worker, fora da thread principal); compressão **adaptativa**
  (reduz resolução/quantidade quando RAM baixa ou storage > 80%).
- `navigator.storage.estimate()` -> aviso em ~80%.
- Se não couber a foto: salva **dados + GPS** (KB) e marca "foto pendente"; nunca trava.
- `QuotaExceededError` capturado e tratado.
- Tela de **diagnóstico** (persistência concedida? % usado? pendentes? última sync?).

## 5. Instalação & Distribuição
- Hospedado na **Vercel**, rota/subdomínio dedicado (ex.: `brigada.siguc…`).
- **Cartão impresso com QR + link** por brigada; **chefe ajuda os designados** a instalar/logar **na base, antes de ir a campo**.
- Onboarding: instalar -> permissões (câmera, GPS, armazenamento persistente, avisos) ->
  1º login (com internet) -> trocar senha provisória -> criar **PIN** -> baixar dados offline.
- **1º login exige internet**; depois destrava por **PIN** offline; token renova ao pegar sinal.
- Detecção iOS/Android com instruções específicas.
  - iOS: instalação manual ("Compartilhar -> Adicionar à Tela de Início"); **sem Background Sync**
    (sync só com app aberto) — dados não se perdem, mas dependem de abrir o app perto do sinal.
- Service Worker com atualização automática **preservando a fila pendente** (IndexedDB versionado).

## 6. Fluxo do brigadista (campo)
```
1. Abre o app (offline) -> botões grandes por NATUREZA:
   🛡️ Prevenção   🔥 Combate   📊 Monitoramento   (e a ATIVIDADE dentro de cada)
2. App captura GPS (lat/lon/precisão) + data/hora automaticamente
3. 📷 Foto(s) -> coordenada + data/hora carimbadas na imagem e gravadas no registro
4. Mínimo de digitação: atividade, pessoas alcançadas, descrição (ou voz), [+ Fauna]
5. SALVAR -> IndexedDB. Fila: "3 registros aguardando envio"
6. Pegou sinal -> sincroniza sozinho -> aparece no mapa do SIGUC ✅
```
Sub-fluxo **Fauna** ([+ Fauna]): classe (ícones) ou "não sei" -> espécie (catálogo) ou
"não identificada" + foto -> quantidade/condição (inclui 🔥 queimado)/evento/causa/destinação -> foto.

Sub-fluxo **UC automática**: `uc_id` herda da brigada; se o GPS cair em outra UC, o app pede confirmação.

Sub-aba **Tarefas/Alertas (CIGMA)**: focos a verificar baixados quando online, navegáveis offline
pelo croqui; brigadista dá o **veredito** (confirmado/falso positivo/não localizado).

## 7. Validação (gestor + biólogo)
- **Inbox** `pages/validacao-campo.html`: cards (miniatura, natureza/atividade, equipe, data, mini-mapa),
  badges de prioridade (🔥 combate, 🐾 ameaçada, 🔥 queimado, 🚨 CIGMA), filtros, contador.
- **Detalhe**: fotos carimbadas, ponto no mapa, todos os campos; conferência da UC (ST_Within);
  ações: Validar / Corrigir e validar / Devolver ao chefe / Rejeitar (motivo); histórico (jsonb).
- **Validação em lote** (educação ambiental etc.).
- **Fauna**: papel **`biologo`** confirma/corrige espécie, status de ameaça, `identificacao_confirmada`.
- **Promover a ocorrência**: botão (manual, 1 clique) cria linha em `ocorrencias`
  (`fogo->incendio`, severidade, localização, data, fotos, uc_id, descrição, responsável),
  liga `registros_campo.ocorrencia_id` <-> origem; idempotente. App apenas **sugere** para combate/fogo.

## 8. Mapa
- Nova camada em `js/mapa-cartografia.js` plotando `registros_campo` por natureza/atividade
  (🔥/🛡️/📊) e fauna (destaque para ameaçadas e condição `queimado`). Índice GIST já existe.

## 9. Relatórios & Indicadores
- **3 níveis**: UC / regional / estadual (DIMA/Secretaria) — `pages/relatorios-brigadas.html`.
- Cards + gráficos (Chart.js via CDN, mantendo vanilla) + mapa de calor (PostGIS).
- Indicadores: atividades por natureza; combates (série temporal — pico jul–out);
  educação ambiental + **pessoas alcançadas**; produtividade por equipe; por UC/regional/município;
  veículos; operações **CBMAC**; alertas **CIGMA**; área afetada (ha);
  fauna (total, por espécie/classe, ameaçadas, condição/queimado, destinação, causa); comparativo anual.
- **Saídas**: dashboard + PDF + Excel/CSV + Darwin Core (fauna -> SiBBr/GBIF).
- **Fonte**: todos os registros sincronizados, com **selo de status** (validado/aguardando) e filtro.
- Views/funções SQL: ex. `vw_indicadores_brigadas`.

## 10. CIGMA / CBMAC
- **CIGMA (loop)**: satélite detecta foco -> alerta atribuído à brigada -> app recebe tarefa ->
  croqui guia -> registro com `alerta_cigma` + `alerta_id` + `veredito_campo` -> CIGMA vê ground-truth.
  Ingestão automática (DETER-B/BDQueimadas/FIRMS) = **módulo B** (futuro). Painel CIGMA junto do módulo B.
- **CBMAC**: flag `integrada_cbmac` + relatório de operações conjuntas. Sem integração em tempo real.

## 11. Catálogo de espécies do Acre
- **Núcleo curado (~200–400)**: ameaçadas do AC + mais encontradas/resgatadas; texto livre cobre o resto.
- **Semente gerada por mim** (espécie + nomes populares/regionais + status MMA/IUCN), revisada pelo **biólogo** (CRUD no SIGUC).
- App baixa **JSON versionado** (texto leve); **miniaturas das ameaçadas offline**; demais fotos só online.
- Busca por nome popular/regional (`nomes_populares[]`), filtro por classe, ameaçadas em destaque.
- Fontes: MMA Port. 148/2022 ∩ AC, IUCN, SiBBr/GBIF, ICMBio.

## 12. Estrutura de arquivos prevista (padrão do projeto)
```
supabase/migrations/004_brigadas.sql
supabase/migrations/005_registros_campo.sql      (+ fauna, catálogo, validação, alerta_id)
pwa/manifest.json
pwa/sw.js
pages/brigada.html                  (captura — botões grandes)
pages/validacao-campo.html          (inbox/validação do gestor + biólogo)
pages/relatorios-brigadas.html      (dashboards 3 níveis + exportações)
pages/admin-brigadas.html           (CRUD brigadas/brigadistas + gerar login + gerar QR)
js/brigada-captura.js               (câmera + GPS + carimbo)
js/brigada-fauna.js                 (catálogo offline + detalhe)
js/brigada-offline.js               (IndexedDB, persist, atômico, retenção, cota, export)
js/brigada-sync.js                  (2 fases, idempotência, TUS, Background Sync, backoff)
js/brigada-croqui.js                (bússola/posição offline + tarefas CIGMA)
js/mapa-cartografia.js              (nova camada registros_campo/fauna)
```
> Numeração das migrations a confirmar na implementação (CLAUDE.md reservava 003 = estrutura
> organizacional, 005 = alertas; pode ser preciso renumerar). Migrations com RLS, funções com
> SECURITY DEFINER quando acessarem `auth.*`. Commits em português, pequenos e descritivos.

## 13. Ordem de implementação
1. `004_brigadas.sql` — brigadas + brigadistas + segurança + fotos + perfis (`brigadista`, `biologo`)
2. `005_registros_campo.sql` — registros + fauna + catálogo + validação + alerta_id (Darwin Core) + RLS + buckets
3. Página admin de brigadas/brigadistas (+ gerar login, gerar QR)
4. PWA robusto (offline durável + sync confiável + memória adaptativa)
5. Onboarding/instalação/PIN/atualização (Android + iOS)
6. Captura -> fauna -> croqui -> aba de tarefas/alertas
7. Inbox e validação do gestor + biólogo + promover a ocorrência
8. Camadas no mapa do SIGUC
9. Relatórios e indicadores (3 níveis + exportações)
10. Semente do catálogo de espécies (gerada e revisada pelo biólogo)
11. *(futuro)* Módulo B (ingestão de alertas) + Painel CIGMA · import do histórico 2025

## 14. Origem dos dados (planilha atual)
Planilha manual (Google Drive). Colunas: DATA INÍCIO/FINAL, EQUIPE, PESSOAS ALCANÇADAS,
NATUREZA, ATIVIDADE, LONG/LAT (DMS e decimal), UC, MUNICÍPIO, REGIONAL, ANO,
ALERTA CIGMA (S/N), INTEGRADA CBMAC (S/N), Nº VEÍCULOS, ANIMAL RESGATADO.
Equipes: Alfa, Bravo, Charlie. UCs vistas: Antimary, APA São Francisco, APA Amapá, ARIE, CFERG.
Regionais: Baixo Acre, Purus, Juruá, Tarauacá/Envira.
Problemas que o app elimina na origem: coords trocadas/W-S invertidos, decimal vírgula×ponto,
datas malformadas, nomes de equipe digitados errado, coords copiadas de outra linha, espaços/lixo.
Import do histórico 2025: **não agora** (script de limpeza fica para depois, se desejado).

## 15. Direção de Design — "Instrumento de Campo"

Objetivo: app **moderno, autoral e sem cara de IA**. Estende o design system existente
(NÃO altera `--floresta/--verde-c/--ouro/--t1` nem Fraunces/DM Sans — só **acrescenta** tokens,
o que requer alinhamento antes de codar).

### 15.1 Conceito-norte
**Instrumento de Campo**: o app parece um **equipamento de guarda-parque / GPS robusto**
cruzado com a elegância institucional da SEMA — não um dashboard SaaS genérico.
Princípios: dados como leitura de instrumento, identidade geográfica do Acre, robustez tátil,
honestidade de estados (GPS/offline/sync), tipografia editorial para o toque humano.

### 15.2 Tema
- **Automático**: segue claro/escuro do sistema do celular.
  - Escuro = "operacional" (floresta quase preto, OLED-friendly, glare/noite).
  - Claro = creme/floresta (unidade com o SIGUC web).
- **Field Mode** (sob demanda): alto contraste, tipografia ampliada, alvos enormes
  (uso com luva, sol forte). Toggle persistente por dispositivo.

### 15.3 Tokens novos a acrescentar (precisa de alinhamento)
- **Cores funcionais por natureza/tipo:**
  - combate/fogo = brasa/âmbar-quente (ex.: `--brasa:#E2562B`)
  - prevenção = verde do sistema (`--verde-c`)
  - monitoramento = azul instrumento (ex.: `--instr-azul:#3A7CA5`)
  - fauna = acento próprio (ex.: terracota/ocre distinto do ouro institucional)
  - estados: ameaçada (destaque), queimado, óbito
- **Tokens do tema escuro/operacional** (superfícies, contornos, texto sobre floresta).
- **Fonte monospace** para dados de instrumento (coordenadas, precisão GPS, data/hora, IDs).
  Sugestões: IBM Plex Mono / JetBrains Mono / Space Mono.

### 15.4 Linguagem visual
- **Monospace** em todo "readout" (lat/lon, precisão em m, timestamp, código do registro)
  → cara de aparelho, não de app genérico.
- **Textura de curvas de nível topográficas** (relevo do Acre) sutil ao fundo; grade de
  coordenadas e silhueta das UCs como motivo gráfico (assinatura de lugar, não decoração).
- **Carimbo na foto** desenhado como documento oficial: coord + data/hora + UC + brigada,
  com hierarquia tipográfica (não timestamp default de câmera).
- **Cards de campo** com "espinha" lateral colorida por natureza (combate/prevenção/monitoramento),
  cantos levemente suaves, estados de toque tácteis (pressed), sem sombra genérica.
- **Fraunces** para títulos/momentos editoriais (institucional, humano); **DM Sans** na UI.

### 15.5 Ícones
- **Set de linha curado** (Phosphor ou Lucide), **customizado** nas cores/peso do projeto.
- **Zero emoji em produção** (emojis no md são só referência).
- Cor do ícone segue a cor funcional do tipo.

### 15.6 Interações-assinatura (diferenciais)
- **Trava de GPS viva**: leitura de precisão em metros + animação de "lock"; o botão de captura
  só "arma" com sinal bom (ou avisa explicitamente).
- **Captura em 2 toques**, com confirmação por **háptico + som** (funciona com luva/sol).
- **Sincronização como elemento de design**: fila tipo "caixa de saída" com pulso de status e
  progresso real (pendente → enviando → confirmado); nunca um spinner genérico.
- **Estados honestos** instrumentados: offline, armazenamento %, persistência concedida,
  última sync — apresentados como leituras de painel.
- **Motion com restrição**: micro-interações com significado (captura, lock, sync), nunca decorativas.

### 15.7 Checklist "sem cara de IA" (guia de implementação)
EVITAR: degradê roxo/índigo · glassmorphism em excesso · emoji como ícone · cards genéricos com
sombra · layout centralizado com "blob" · fonte de sistema padrão · simetria sem intenção.
BUSCAR: monospace para dados · ícones de traço próprios · textura topográfica do Acre · Field Mode
alto contraste · estados-vazios/ilustração autorais · foto real · assimetria com propósito · grid consistente.

### 15.8 Dois "universos" coerentes
- **App de campo (brigadista)**: Instrumento de Campo, tema automático + Field Mode, mobile-first.
- **SIGUC web (gestor/relatórios/validação)**: institucional/editorial (creme/floresta/ouro),
  mapa-forward, mantendo o mesmo vocabulário visual (monospace nos dados, ícones, motivos do Acre).

### 15.9 Impacto na implementação
- Criar `css/brigada.css` (tokens novos + temas + Field Mode) sem tocar nas variáveis core.
- Carregar fonte monospace e o set de ícones (curado) junto ao app.
- Componentes do PWA (captura, fila, fauna, tarefas) já nascem nesta linguagem.
- Antes de codar tokens novos: **alinhar as cores funcionais e a monospace** com o responsável pelo design.
