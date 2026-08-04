# Diagnóstico Socioeconômico das Famílias Residentes em UCs do Acre
## Análise da especificação e versão ajustada ao SIGUC-AC

> **Status:** especificação ajustada, aguardando validação. Nada implementado.
> **Base:** proposta original recebida em 04/08/2026, confrontada com o código
> real do repositório (225 migrations, 54 páginas, 3 apps de campo).
> **Próximo passo:** plano de execução (só depois do aceite deste documento).

---

## 0. Como ler este documento

A proposta original é boa no **conteúdo temático** (o questionário
socioeconômico em si é sólido e bem pensado para a realidade acreana) e
problemática na **arquitetura**, porque foi escrita como se o SIGUC-AC
fosse um projeto novo. Ele não é: tem 225 migrations aplicadas, RBAC com
escopo por UC, LGPD completa em produção e três aplicativos de campo
offline-first já rodando.

Este documento faz três coisas:

1. **Aponta o que na proposta colide com o sistema existente** (§1) — não
   por preferência, mas porque construir de novo o que já existe cria dois
   sistemas de permissão, duas trilhas de auditoria e duas bases de UC.
2. **Aponta os riscos de conteúdo** (§2) — que são mais graves que os
   técnicos, e alguns não podem ser resolvidos por código.
3. **Entrega a especificação ajustada** (§3 em diante), pronta para virar
   plano de execução.

Convenção deste documento:
`MANTÉM` = vai como está · `AJUSTA` = muda de forma · `REUSA` = já existe,
não construir · `CORTA` = fora do escopo · `DECIDE` = precisa de humano.

---

## 1. Colisões com o sistema existente

### 1.1 `AJUSTA` — Stack: Next.js/TypeScript/Tailwind → HTML/JS vanilla

A §23 pede Next.js + TypeScript + Tailwind + PWA. O `CLAUDE.md` do projeto
abre com: *"Stack atual: HTML/JS Vanilla + Supabase. Não migrar para
Next.js."*

Isso não é teimosia de estilo. O que se perde ao migrar:

| Ativo existente | Linhas | O que faz |
|---|---|---|
| `js/brigada-offline.js` + `brigada-sync.js` | 813 | IndexedDB + fila + retry, provado em campo |
| `js/biomonitor-offline.js` | 897 | idem, com regras de conflito |
| `js/frota-offline.js` + `frota-sync.js` | ~600 | idem, idempotência por `uuid_cliente` |
| `pwa/sw.js` | — | 3 apps, cache isolado por scope |
| `js/config.js` + `layout.js` | 679 | design system, `gerarLayout`, ícones, LGPD gate |
| `js/fotos-privadas.js` | — | assinatura de bucket privado, 3 apps |

Reescrever isso em Next.js é meses de trabalho para chegar onde já
estamos, com o risco de perder o comportamento offline que só se descobre
quebrado em campo, a 300 km de Rio Branco, sem sinal.

**Decisão:** vanilla, reusando os três padrões já provados. O que a §23
realmente quer — PWA instalável, offline, acessível, componentes limpos —
o sistema já entrega. TypeScript e Tailwind são meio, não requisito.

> Se a migração para Next.js for uma decisão institucional que já foi
> tomada em outro fórum, ela precisa ser um projeto próprio, feito de uma
> vez para o sistema inteiro — não pendurado neste módulo. Misturar as
> duas stacks é a pior das três opções.

### 1.2 `AJUSTA` — Nomes de tabelas em inglês → português com prefixo

A §24 lista 40 tabelas em inglês (`households`, `interviews`, `income`…).
O banco inteiro está em português com prefixo por módulo (`frota_*`,
`lgpd_*`, `bio_*`, `registros_campo`). Duas convenções no mesmo schema é
dívida permanente.

**Decisão:** prefixo `diag_`, nomes em português. Ver de-para na §5.

### 1.3 `REUSA` — Metade das tabelas da §24 já existe

| §24 pede | Já existe | Observação |
|---|---|---|
| `organizations` | — | **CORTA.** SEMA-AC é tenant único. Multi-org é abstração prematura; se um dia houver, `unidades_organizacionais` (migration 003) é o gancho. |
| `users`, `roles`, `permissions` | `usuarios`, `modulos`, `perfil_permissoes_padrao`, `grupo_permissoes_padrao`, `usuario_permissoes`, `nivel_efetivo()`, `pode_ver()`, `pode_editar()` | RBAC de 3 níveis (override individual → padrão perfil/módulo → padrão perfil/grupo), já consumido por RLS e frontend |
| `conservation_units` | `unidades_conservacao` (PostGIS, migration 001) | com geometria, categoria, esfera, status |
| `municipalities` | `data/municipios_acre.geojson` | **existe como arquivo, não como tabela** — ver §5.1 |
| `communities` | — | **lacuna real**, ver §5.1 |
| `audit_logs` | `auditoria_acessos` (migration 002) | login/bloqueio; precisa extensão para CRUD e exportação |
| `media`, `signatures` | buckets privados + `js/fotos-privadas.js` | padrão já estabelecido (migrations 200/210) |
| `indicators` | `monitoramento_indicadores` / `_registros` | avaliar reuso vs. tabela própria (§8) |

### 1.4 `AJUSTA` — A contradição central da proposta

A §30 diz:

> *"O questionário deve ser orientado por configuração e banco de dados
> sempre que possível, evitando perguntas hardcoded no frontend."*

A §24 pede tabelas fixas por assunto: `health`, `education`, `housing`,
`infrastructure`, `income`, `tourism`, `governance`…

**As duas coisas não coexistem.** Se o questionário é dinâmico, o
administrador pode criar a pergunta "possui fossa séptica?" na v2 — e
`infrastructure` não tem essa coluna. Ou o questionário é dinâmico e o
armazenamento é genérico, ou o armazenamento é tipado e o questionário é
fixo em código.

E há um terceiro requisito que aperta ainda mais, a §9:

> *"Entrevistas antigas deverão permanecer vinculadas à versão original do
> questionário. Nunca alterar retroativamente a estrutura de uma entrevista
> já finalizada."*

**Solução: duas camadas, com direção única de dependência.**

```
CAMADA DE CAPTURA (fiel, imutável)
  diag_respostas — uma linha por pergunta respondida,
  amarrada à VERSÃO da pergunta. Nunca reescrita, nunca migrada.
  É o "documento original" da entrevista.
                    │
                    ▼  (projeção versionada, recalculável)
CAMADA ANALÍTICA (estável, tipada)
  diag_vw_* / diag_proj_* — colunas tipadas por assunto,
  derivadas por regra explícita de mapeamento pergunta→coluna.
  É o que Power BI, GIS e IA consomem.
```

Por que isso resolve tudo de uma vez:

- **§9 (imutabilidade)** — a camada de captura nunca muda. Criar a v2 do
  questionário não toca em nenhuma resposta da v1.
- **§30 (sem hardcode)** — perguntas novas entram por configuração; se
  ninguém mapear a pergunta nova para a camada analítica, o dado ainda está
  gravado e íntegro, só não aparece no BI até alguém mapear.
- **§24 (tabelas tipadas)** — entregues como projeção. `diag_vw_habitacao`
  tem as colunas que a §24 quer, com tipo, e comparável entre campanhas.
- **§17/§19 (BI e exportação)** — consomem a camada analítica, que é
  estável mesmo com o questionário evoluindo.

O custo honesto: existe uma **tabela de mapeamento** (`diag_projecoes`)
que precisa ser mantida quando o questionário muda. É trabalho real, mas é
o trabalho que qualquer sistema de survey sério faz — e é o que permite
comparar a campanha de 2026 com a de 2031 sem falsificar nenhuma das duas.

### 1.5 `AJUSTA` — LGPD: a §20 pede "Consentimento", o `CLAUDE.md` proíbe

O `CLAUDE.md` é categórico: *"BASE LEGAL NUNCA É CONSENTIMENTO para o
núcleo do sistema"*, porque construir sobre consentimento cria direito de
revogação que destruiria registros de guarda permanente.

Aqui há **duas coisas diferentes** sendo chamadas de consentimento, e a
proposta as mistura no Módulo C:

**(a) Base legal do tratamento (LGPD).** Não é consentimento.
- Dado comum: **Art. 7º, III** — execução de política pública. O
  diagnóstico subsidia o Plano de Manejo, que é obrigação legal da SEMA
  pelo SNUC (Lei 9.985/2000, art. 27).
- Dado sensível (raça/cor, religião, saúde, deficiência — e a §10 coleta os
  quatro): **Art. 11, II, "b"** — tratamento compartilhado necessário à
  execução de política pública.

Se fosse consentimento, uma família revogando em 2030 obrigaria a apagar o
dado que fundamentou o zoneamento do Plano de Manejo de 2027. Insustentável.

**(b) Consentimento livre e esclarecido (ética em pesquisa).** É o que o
Módulo C descreve de fato. Rege-se pelas Resoluções CNS 466/2012 e
510/2016, não pela LGPD. É obrigação ética e **não** vira base legal LGPD.

**(c) Consentimento LGPD granular, só para o que é genuinamente opcional.**
Aí sim, com direito de revogação real e efeito limitado:
uso de imagem, contato futuro, cessão para pesquisa científica de
terceiros. Revogar desativa aquele uso — não apaga a entrevista.

**Reescrita do Módulo C** — ver §6.3. Em resumo: separar "aceite de
participação" (porta de entrada, encerra a entrevista se negado) de
"autorizações opcionais granulares" (não bloqueiam nada, revogáveis a
qualquer momento pelo canal do titular já existente).

### 1.6 `REUSA` — LGPD já está implementada, não reconstruir

A §20 pede 11 controles. Situação real:

| §20 pede | Situação |
|---|---|
| Consentimento | `lgpd_documentos` + `lgpd_documento_versoes` + `lgpd_aceites` + RPC idempotente |
| Finalidade, minimização | `lgpd_tratamentos` (ROPA vivo, 16 tratamentos apontando tabelas reais) |
| Controle de acesso | `nivel_efetivo()` + RLS em todas as tabelas |
| Logs, auditoria | `auditoria_acessos`, `lgpd_acesso_dado_terceiro` |
| Direito de acesso | `lgpd_meus_dados()` + `lgpd_solicitacoes_titular` + `pages/meus-dados.html` |
| Anonimização, pseudonimização | **parcial** — existe para CAR (migration 221), falta para este módulo |
| Política de retenção | documento versionado existe; regra para este módulo falta |
| Criptografia | TLS + at-rest do Supabase |

**O trabalho aqui é estender, não construir:** novos tratamentos no ROPA,
RIPD próprio (este é o tratamento de maior risco já feito no sistema),
aviso de campo do 4º app, regras de anonimização e retenção.

### 1.7 `MANTÉM` — o que a proposta acerta e vai inteiro

§1 objetivo · §2 princípios · §4 hierarquia · §6 campanhas · §7 tipos de
pergunta (menos vídeo) · §8 lógica condicional · §9 versionamento · §10–15
conteúdo do questionário (com os ajustes da §2 deste doc) · §21 auditoria ·
§22 offline · §25 UX · §26 validações · §27 alertas não bloqueantes ·
§28 IA que nunca escreve · §30 execução em fases.

---

## 2. Riscos de conteúdo — mais graves que os técnicos

### 2.1 `DECIDE` — Módulo P (Caça): a proposta levanta o risco e não o resolve

A §10-P diz "registrar de forma agregada e não incriminatória" e "não
registrar informações que possam colocar famílias em risco". Correto. Mas a
§4 lista **"áreas de caça"** entre as áreas de uso da família, e a §18 põe
"áreas de uso" como camada do mapa. **As duas seções se contradizem.**

Um polígono de área de caça, amarrado a uma família identificada, com
espécie e frequência, é um documento que — vazado, requisitado ou
simplesmente exportado por alguém com permissão ampla — incrimina uma
família específica.

Amparo legal para a prática existe (Lei 5.197/67 art. 1º §1º; Lei 9.605/98
art. 37, I — estado de necessidade para saciar fome; uso sustentável por
população tradicional no SNUC). Mas o amparo protege a pessoa em juízo, não
o dado no banco. O risco não é a condenação: é o dado circular.

**Resolução (a favor do §10-P, contra a §4):**

1. **Não georreferenciar área de caça por família.** Cortado da §4 e da §18.
2. Módulo P grava só percepção: finalidade (autoconsumo/conflito com
   fauna), frequência em faixas, espécies **percebidas** na região,
   mudanças na disponibilidade da fauna, conflitos com fauna.
3. Sem quantidade abatida, sem espécie×família, sem data específica.
4. Tabela própria (`diag_percepcao_fauna`), RLS mais estrita que o resto do
   módulo — visível só a `coordenador` e `analista` com permissão explícita.
5. Fora de qualquer exportação não anonimizada, sem exceção.
6. Na agregação, supressão de célula com **n < 5** famílias.
7. O termo de consentimento diz, em linguagem simples, o que é perguntado e
   o que não é.

> Isto é uma decisão de produto que precisa de aval expresso da DIMA e,
> idealmente, da assessoria jurídica. Está aqui como recomendação técnica
> fundamentada, não como fato consumado.

### 2.2 `DECIDE` — Conhecimento tradicional associado (Módulos U e W)

Módulo U coleta plantas medicinais, conhecimentos ecológicos, saberes.
Módulo W coleta percepção comunitária sobre espécies. Isso é
**conhecimento tradicional associado ao patrimônio genético** — Lei
13.123/2015 e Decreto 8.772/2016.

Três pontos que o desenho atual não cobre:

1. **Consentimento prévio informado é da comunidade, não só do indivíduo.**
   O sistema hoje modela consentimento individual. Falta uma camada de
   anuência coletiva (associação/conselho comunitário), registrada antes da
   campanha começar naquela comunidade.
2. **Se houver acesso para pesquisa e desenvolvimento**, cadastro no SISGEN
   é obrigatório. Diagnóstico para gestão pública provavelmente não é
   "acesso" no sentido da lei — mas a §19 prevê exportação e a §28 prevê
   IA analisando o acervo, o que aproxima perigosamente da fronteira.
3. **Titularidade.** O conhecimento não é da SEMA. A política de uso e
   compartilhamento precisa estar escrita antes da primeira entrevista.

**Resolução técnica (o que dá para fazer):** anuência coletiva como
pré-requisito de campanha por comunidade; marcar `diag_saberes` como
categoria própria no ROPA, com política de compartilhamento restrita; não
incluir em exportação genérica. **A parte jurídica precisa de parecer.**

### 2.3 `AJUSTA` — EBIA (Módulo L) não pode entrar no construtor genérico

A EBIA é instrumento validado, com redação fixa e escore calibrado. Um
administrador editando "nos últimos 3 meses" para "no último ano" pelo
construtor de questionários **invalida silenciosamente** a comparabilidade
com PNAD/POF e com as próprias campanhas anteriores — e ninguém percebe,
porque o sistema continua calculando um número.

**Resolução:** EBIA como **bloco selado** — conjunto de perguntas
versionado, marcado `editavel = false`, com escore calculado no banco por
função dedicada. O construtor pode incluir ou não o bloco na campanha; não
pode alterá-lo por dentro.

Detalhe que se resolve de graça: a EBIA tem versão de 14 itens (domicílio
com menor de 18) e de 8 itens (sem menor). O Módulo E já sabe quem mora na
casa — a escolha da versão pode ser automática, e deve ser registrada na
resposta.

### 2.4 `DECIDE` — Dados de menores de idade (Módulo E)

O Módulo E coleta, de cada morador — incluindo crianças — nome, data de
nascimento, escolaridade, frequência escolar, deficiência, doença crônica,
participação na produção e renda.

Art. 14 da LGPD: tratamento de dado de criança e adolescente no seu
**melhor interesse**. Isso é certo aqui, não hipotético (diferente da
pendência já registrada no `CLAUDE.md` para educação ambiental, que é por
precaução).

**Resolução:**
- Base legal segue Art. 7º III / Art. 11 II "b" — política pública é
  interesse do menor quando o objetivo é dimensionar acesso a escola e
  saúde. Consentimento do responsável familiar cobre a coleta.
- **Minimizar:** nunca CPF de menor. "Participação na produção" e "renda"
  de menor precisam de justificativa explícita (trabalho infantil é achado
  relevante para política pública, mas exige cuidado no registro e no uso).
- Tratamento próprio no ROPA, marcado `dado_de_menor = true`, e **RIPD
  obrigatório** (Art. 38).

### 2.5 `AJUSTA` — CPF: coletar só com finalidade declarada

A §26 pede validação de CPF, mas nenhuma seção diz por que ele é
necessário. Minimização (Art. 6º, III) não é opcional.

**Resolução:** CPF **apenas do responsável familiar**, **opcional**, com
finalidade declarada no ROPA. Se a finalidade concreta for cruzamento com
CadÚnico, benefícios ou elegibilidade a PSA, coleta-se e escreve-se isso no
termo. Se não houver finalidade hoje, **não coletar** — nome + nascimento +
comunidade + UC já identifica a família para gestão. O campo pode nascer
desabilitado e ser ligado quando a finalidade existir.

### 2.6 `CORTA` — Vídeo (§7)

Vídeo em entrevista domiciliar na Amazônia: arquivo de dezenas de MB, em
IndexedDB, sincronizando por 3G intermitente, competindo com fotos que já
são o gargalo dos apps atuais. Custo alto, uso previsto: nenhum.

**Resolução:** cortar de v1. Áudio fica, com limite rígido (≤ 2 min,
comprimido) e uso definido: registro de consentimento verbal de não
alfabetizado (§2.7) e história oral no Módulo U. Foto reusa o pipeline já
provado (`brigada-captura.js`, marca d'água, bucket privado).

### 2.7 `AJUSTA` — "Assinatura digital" é assinatura manuscrita capturada

A §7 e a §29 falam em "assinatura digital". O que o sistema vai capturar é
**assinatura manuscrita em tela** (imagem em canvas) — que tem valor
probatório de indício, mas **não** é assinatura digital ICP-Brasil. Chamar
pelo nome certo importa no termo e no laudo.

E há um problema de campo que a proposta não trata: **parte da população
alvo não é alfabetizada.** Um fluxo que exige assinatura exclui essas
famílias ou produz assinatura de terceiro, que é pior.

**Resolução:** três formas de registro de aceite, com valor equivalente:
1. Assinatura manuscrita em tela;
2. **Consentimento verbal gravado em áudio** (≤ 2 min), com o entrevistador
   lendo o termo em voz alta antes;
3. Aceite verbal com **testemunha identificada** (nome e vínculo).

Sempre com carimbo de data, hora, entrevistador e GPS. Nunca impressão
digital — biometria é dado sensível e resolveria um problema criando outro.

### 2.8 `AJUSTA` — 30 módulos é uma entrevista de 2 a 4 horas

Somando A–Z mais os módulos especiais das §11–§15, são 30+ blocos. Numa
estimativa conservadora, 250–400 perguntas. Isso é 2h30 a 4h por família,
com tabela repetitiva por morador e por área de uso.

O efeito prático é conhecido: fadiga do respondente, respostas de
conveniência na segunda metade, abandono, e um dado que **parece** completo
e não é. O risco é pior que não coletar, porque um dado ruim com aparência
de bom entra no índice e no Plano de Manejo.

**Resolução:** o motor já é dinâmico, então isso é configuração — mas
precisa ser decisão explícita:

- **Núcleo obrigatório** (toda campanha): A, B, C, D, E, G, H, I, Q, §15
  (demandas prioritárias). ~50 min.
- **Blocos ativáveis por campanha:** todos os demais, escolhidos pelo
  coordenador conforme o objetivo daquele levantamento.
- A tela de criação de campanha **mostra a estimativa de duração** somando
  os blocos ativos, e avisa acima de 90 min.
- Alternativa a considerar: entrevista em duas visitas, com retomada —
  o modelo de rascunho persistente já suporta.

### 2.9 `DECIDE` — Índices (§16): pesos e cortes não podem ser inventados

A §16 pede cinco índices e lista seus componentes, mas **não define pesos,
normalização nem pontos de corte**. Uma sessão de Claude Code pode escolher
"média aritmética simples com min-max" — e produziria um número com
aparência de indicador oficial, que iria para o dashboard, para o relatório
e para o Plano de Manejo, sem que ninguém tivesse validado a metodologia.

Isso é o mesmo princípio já registrado no `CLAUDE.md` sobre as pendências
LGPD: fabricar o dado é pior que deixar o campo vazio.

**Resolução:**
- Motor de indicadores **dirigido por configuração versionada**
  (`diag_indicadores` + `diag_indicador_versoes`): fórmula, pesos,
  normalização e cortes vivem no banco, versionados como o questionário.
- Entrega com uma fórmula de referência marcada **`PROVISÓRIA`**, visível
  na interface como tal.
- **Nenhum índice é publicado em relatório ou dashboard sem versão de
  metodologia carimbada e marcada como validada** por responsável nomeado.
- Todo número exibido carrega a versão da metodologia que o gerou.

Referências úteis para a validação humana: IVS/IPEA, IDHM, EBIA (já
validada), IPM (Alkire-Foster) para índice multidimensional.

### 2.10 `AJUSTA` — Mapa e anonimização (§18) precisam ser concretos

"Diferentes níveis de precisão e anonimização" não é implementável como
está. Concretizando em três níveis, resolvidos por RLS e RPC:

| Nível | Quem | O que vê |
|---|---|---|
| **Exato** | escopo na UC + permissão de dado pessoal | ponto da residência, nome da família |
| **Agregado** | demais usuários autenticados | centroide da comunidade, contagens |
| **Grade** | dashboards, exportação, público | célula de 1 km, **supressão se n < 5** |

O deslocamento nunca é feito no frontend — é a RPC que devolve a geometria
já degradada, conforme o nível do chamador. Mesmo princípio da migration
221 (busca do CAR sem CPF no retorno): o dado que não pode ser visto não
chega ao navegador.

### 2.11 `AJUSTA` — Offline com polígonos (§10-V + §22)

Desenhar polígono no mapa offline exige base cartográfica local. Basemap
raster pré-cacheado por UC é grande demais para o aparelho do entrevistador.

**Resolução:** desenho sobre **camada vetorial local** — limite da UC,
hidrografia principal e limite municipal, todos já disponíveis como GeoJSON
no `data/` e simplificados para o app. Mais duas formas de captura que
funcionam melhor em campo que desenhar na tela:
- **Rastro caminhado** (o entrevistador anda o perímetro, GPS grava);
- **Ponto + área declarada** (mais realista para a maioria dos casos —
  "quantos hectares?" com um ponto de referência).

Basemap raster fica como opção de download por UC, sob demanda, fora do
shell do PWA.

### 2.12 `MANTÉM` — Alerta de GPS fora da UC (§27)

Correto e barato: com o polígono simplificado da UC no IndexedDB, o teste
ponto-em-polígono roda offline em milissegundos. Alerta, nunca bloqueio —
a proposta acerta em cheio ao justificar isso metodologicamente.

### 2.13 `AJUSTA` — Exportação Word (§19)

PDF: já existe pipeline no projeto. CSV/XLSX/JSON/GeoJSON: diretos.
**Word (.docx)**: gerar `.docx` real no navegador exige biblioteca pesada.

**Resolução:** entregar **PDF + HTML** em v1 (o HTML abre no Word e é
editável, que é o que o usuário de fato quer: mexer no texto do relatório).
`.docx` nativo só se for requisito firme — e aí como geração no servidor.

---

## 3. Escopo ajustado — o que será construído

### 3.1 Nome e identidade do módulo

- Prefixo de tabelas: **`diag_`**
- Chave no catálogo `modulos`: **`diagnostico`** (`respeita_escopo_uc = true`)
- Chave de administração: **`diagnostico-admin`** (construtor, campanhas,
  indicadores — `respeita_escopo_uc = false`)
- App de campo: **`pages/diagnostico-app.html`** — 4º PWA do sistema
- Migrations a partir de **226**

### 3.2 Superfícies

| Superfície | Arquivo | Para quem |
|---|---|---|
| App de campo (PWA offline) | `pages/diagnostico-app.html` | Entrevistador |
| Construtor de questionários | `pages/diagnostico-questionarios.html` | Administrador |
| Campanhas e equipes | `pages/diagnostico-campanhas.html` | Coordenador |
| Validação de entrevistas | `pages/diagnostico-validacao.html` | Coordenador |
| Famílias e comunidades | `pages/diagnostico-familias.html` | Gestor de UC |
| Dashboard | `pages/diagnostico-dashboard.html` | Gestor estadual |
| Instalação do app | `pages/instalar-diagnostico.html` | público |
| Mapa | `pages/mapa.html` (camadas novas) | conforme nível |

A **regra de duplicação obrigatória** do `CLAUDE.md` (Frota) se aplica ao
par validação-de-mesa ⇄ app: se o coordenador puder validar pelo celular,
os dois lados mudam na mesma entrega. Recomendação para v1: **validação só
na mesa**, e registrar a assimetria como decisão de produto, no mesmo
molde da exceção de Abastecimento.

### 3.3 Perfis — sem enum novo

A §3 define seis perfis. O RBAC existente resolve cinco deles **sem tocar
no enum `perfil_usuario`** (o que evita a armadilha já documentada:
`ALTER TYPE ... ADD VALUE` exige migration própria antes de qualquer uso):

| §3 pede | Como resolver |
|---|---|
| Administrador do Sistema | `super_admin` + `diagnostico-admin: editar` |
| Gestor Estadual | perfil existente + `diagnostico: visualizar`, sem UC extra |
| Gestor da UC | `gestor_uc` + `usuario_ucs_extras` (já existe) |
| Coordenador de Pesquisa | perfil existente + `diagnostico-admin: editar` |
| Analista | perfil existente + `diagnostico: visualizar` + permissão de export |
| **Entrevistador** | **tabela `diag_entrevistadores`** ligada a `auth.users` |

O entrevistador segue o padrão dos três apps de campo (`brigadistas`,
`monitores_biodiversidade`, `frota_motoristas`): identidade própria,
login por e-mail + PIN, sessão persistente isolada, **sem acesso à mesa**.
É o padrão certo e já provado três vezes.

### 3.4 Campanha ≠ "Pesquisas"

O módulo `pesquisas` existente é **autorização de pesquisa científica
externa** (AAP, SISBIO, pesquisador externo, portal público). Coisa
diferente. Nomear sempre **"campanha de diagnóstico"** para não confundir
usuário nem desenvolvedor.

---

## 4. Modelo de dados ajustado

### 4.1 Entidades territoriais — a lacuna real

```
unidades_conservacao  (EXISTE, PostGIS)
municipios            (NOVO — hoje só GeoJSON; vira tabela com geometria)
diag_comunidades      (NOVO — nome, UC, município, tipo, geometria, população)
diag_localidades      (NOVO — colocação, ramal, rio, igarapé, seringal)
```

`municipios` e `diag_comunidades` são **transversais**, não exclusivos
deste módulo: Brigadas e Biomonitor hoje guardam comunidade como **texto
livre**, o que impede qualquer cruzamento. Criar a entidade aqui abre a
porta para normalizar os outros dois depois — sem quebrá-los agora (o texto
livre continua funcionando; a referência entra como coluna opcional).

> Como `municipios` não tem o prefixo `diag_`, ele é infraestrutura
> compartilhada. Decisão consciente: prefixar por módulo algo que serve o
> sistema inteiro seria pior.

### 4.2 Núcleo social

```
diag_familias           — unidade social; código estável; UC + comunidade
diag_domicilios         — 1 família : N domicílios; geometria do ponto
diag_moradores          — composição familiar; pseudonimizável
diag_areas_uso          — polígono/ponto por tipo (SEM tipo "caça", §2.1)
```

> **`DECIDE`** — A §4 define "Família/Domicílio" como um nível só, mas
> depois separa. Precisa de decisão metodológica: **a entrevista é por
> família ou por domicílio?** O padrão de censo (IBGE) é por domicílio, com
> a família como agrupamento dentro dele. O modelo acima suporta os dois,
> mas a unidade de análise dos índices depende dessa escolha.

### 4.3 Motor de questionários

```
diag_questionarios          — identidade lógica
diag_questionario_versoes   — versão, status, publicação, autor, hash
diag_secoes                 — módulos A–Z, ordem, condição de exibição
diag_perguntas              — código (B001…), tipo, obrigatória, validação,
                              editavel (false p/ blocos selados: EBIA)
diag_opcoes                 — listas de escolha, versionadas
diag_regras_condicionais    — SE pergunta OP valor ENTÃO ação
diag_blocos_selados         — EBIA e afins: instrumento fechado + escore
```

Status: `rascunho → em_revisao → aprovado → publicado → arquivado`.
**Publicado é imutável.** Alteração cria versão nova. Entrevista aponta
para a versão, sempre.

### 4.4 Captura (camada fiel)

```
diag_entrevistas       — campanha, versão do questionário, família,
                         entrevistador, status, tempos, GPS, uuid_cliente
diag_respostas         — entrevista × pergunta(versão) × valor tipado
diag_respostas_repet   — tabelas repetitivas (moradores, áreas, produção)
diag_midias            — foto/áudio, bucket privado, assinado na hora
diag_aceites           — participação + autorizações granulares + forma
diag_percepcao_fauna   — Módulo P, isolado e com RLS estrita (§2.1)
diag_saberes           — Módulos U/W, política de uso restrita (§2.2)
```

`uuid_cliente` para idempotência de sync — mesma lição da migration 198
(check-out/check-in idempotentes acabaram com a "pílula envenenada" na fila
offline do Frota). Um app de entrevista com 300 respostas por envio precisa
disso desde o primeiro dia.

### 4.5 Análise (camada de projeção)

```
diag_projecoes            — mapeamento pergunta(versão) → coluna analítica
diag_vw_*                 — views tipadas por assunto (§24)
diag_indicadores          — definição do índice
diag_indicador_versoes    — fórmula, pesos, normalização, cortes, status
diag_indicador_valores    — resultado calculado + versão da metodologia
```

### 4.6 Operação

```
diag_campanhas            — UC, período, questionário+versão, meta, status
diag_equipes              — coordenador + entrevistadores
diag_atribuicoes          — distribuição de entrevistas
diag_validacoes           — aceite/correção, com histórico
diag_sync_log             — auditoria de sincronização
diag_anuencias            — anuência coletiva por comunidade (§2.2)
```

---

## 5. Requisitos que a proposta não trouxe

Lacunas encontradas na análise, que precisam entrar:

1. **Reentrevista e painel longitudinal.** A §1 quer plataforma de longo
   prazo, mas nada diz sobre revisitar a mesma família em 2031. Sem chave
   estável de família e regra de "o que muda vs. o que persiste", não há
   série temporal — e um diagnóstico sem série temporal não mede política
   pública. **Entra: `diag_familias` com código estável, e entrevista
   sempre vinculada à família, não solta.**
2. **Fluxo de recusa e de ausência.** A §10-C só trata "não aceita →
   encerrar". Falta registrar recusa, ausência após N tentativas, domicílio
   desocupado — que são dados de cobertura, essenciais para saber se a
   amostra vale alguma coisa.
3. **Controle de cobertura da campanha.** Meta de entrevistas existe (§6),
   mas não há como saber quais famílias faltam. Precisa de listagem prévia
   (arrolamento) ou de mapa de progresso por comunidade.
4. **Retenção e descarte.** A §20 cita política de retenção, sem regra.
   Proposta: guarda **permanente** para o dado analítico (subsidia Plano de
   Manejo, documento de arquivo público) e **anonimização** — não exclusão —
   do dado identificável após o ciclo de uso definido.
5. **Correção pós-envio.** A §3.5 diz que o entrevistador não exclui, mas
   nada diz sobre corrigir erro detectado depois. Precisa de fluxo:
   correção cria **versão da resposta**, preservando a original, com autor e
   motivo — nunca sobrescreve.
6. **Transferência de entrevista entre entrevistadores.** O Biomonitor já
   resolveu problema análogo (`docs/biomonitor-transferencia-monitoramento.md`)
   — reusar o padrão.
7. **Perda ou troca de aparelho com fila não sincronizada.** Risco real: o
   trabalho de uma semana em campo mora só no IndexedDB de um celular.
   Precisa de sync parcial oportunista e de aviso de fila antiga.

---

## 6. Ajustes pontuais no questionário

### 6.1 Módulo A — Identificação
`MANTÉM`, com um ajuste: "Colocação / Lote / Ramal / Rio / Igarapé" viram
referência a `diag_localidades`, não texto livre — senão a mesma colocação
aparece grafada de cinco formas e nenhum cruzamento funciona.

### 6.2 Módulo B — Geolocalização
`MANTÉM`. Reusa `fmObterGps` (Frota) como referência, com a diferença de
que aqui a precisão importa: registrar `accuracy` e alertar se > 30 m.
Segue a regra do sistema: captura silenciosa, nunca bloqueia, timeout curto.

### 6.3 Módulo C — Consentimento → **Aceite e autorizações**
`AJUSTA` conforme §1.5. Nova estrutura:

**Bloco 1 — Participação (porta de entrada).**
Leitura do termo (texto versionado em `lgpd_documentos`), pergunta única de
aceite. Negativa → registra recusa e **encerra**.

**Bloco 2 — Autorizações granulares (opcionais, revogáveis).**
Cada uma independente, nenhuma bloqueia a entrevista:
- uso de imagem (foto da família/moradia);
- contato futuro;
- cessão para pesquisa científica de terceiros;
- divulgação de resultado nominal em relatório.

**Bloco 3 — Forma de registro do aceite.** Assinatura em tela, áudio ou
testemunha (§2.7), com data, hora, entrevistador e GPS.

**Fora do Módulo C:** "autoriza uso dos dados" e "autoriza uso da
localização" **saem**. São o tratamento em si, cuja base legal é política
pública (§1.5) — perguntar sugere que o titular pode negar, e ele não pode,
o que é pior do que não perguntar. O termo explica isso em linguagem clara,
junto com os direitos que ele **tem** (acesso, correção, oposição, canal do
titular já existente no sistema).

### 6.4 Módulos D–Z
`MANTÉM` o conteúdo, com: CPF conforme §2.5 · EBIA selada conforme §2.3 ·
Módulo P conforme §2.1 · Módulos U/W conforme §2.2 · área de caça removida
da §4/§18 · vídeo cortado (§2.6) · núcleo vs. opcional conforme §2.8.

---

## 7. Critérios de aceite ajustados

A §29 lista critérios como "GPS funcionar", que não é testável. Versão
verificável — cada linha vira teste Playwright ou consulta SQL:

**Segurança e acesso**
1. Entrevistador autenticado não lê entrevista de equipe alheia (RLS, não UI).
2. Gestor sem `usuario_ucs_extras` da UC X não lê nenhuma família de X.
3. Nenhuma função `diag_*` SECURITY DEFINER executável por `anon`
   (mesmo teste da migration 197).
4. Buckets `diag-*` privados; `getPublicUrl` não serve arquivo.
5. `get_advisors(security)` sem aviso novo após cada migration.

**Motor de questionários**
6. Publicar v2 não altera nenhuma linha de `diag_respostas` da v1
   (verificável por hash do conjunto).
7. Regra condicional que encerra a entrevista impede resposta a pergunta
   posterior, no app e no banco.
8. Bloco selado (EBIA) rejeita alteração pelo construtor.

**Offline**
9. Entrevista completa com foto e GPS, em modo avião, persiste após
   fechar e reabrir o app.
10. Reenvio do mesmo `uuid_cliente` não duplica entrevista.
11. Fila de 30 entrevistas sincroniza com queda de conexão no meio, sem
    perda e sem duplicação.

**Privacidade**
12. Exportação por usuário sem permissão de dado pessoal não contém nome,
    CPF, telefone nem coordenada exata.
13. Camada de mapa em nível "grade" suprime célula com n < 5.
14. `diag_percepcao_fauna` não aparece em nenhuma exportação não anonimizada.
15. Solicitação pelo canal do titular retorna os dados da família.

**Indicadores**
16. Índice sem versão de metodologia validada não é exibido em dashboard
    nem em relatório.
17. Todo valor de índice exibido carrega a versão que o gerou.

**Auditoria**
18. Login, criação, edição, exclusão lógica, exportação, alteração de
    permissão e alteração de questionário geram registro.
19. Usuário comum não consegue apagar registro de auditoria (testado por
    tentativa direta, não por ausência de botão).

---

## 8. Fases ajustadas

A §30 propõe 12 fases. Três já estão prontas no sistema (auth, RBAC,
cadastro de UC). Fases reais:

| # | Fase | Entrega |
|---|---|---|
| 0 | Fundação territorial | `municipios`, `diag_comunidades`, `diag_localidades` + telas de cadastro |
| 1 | Identidade e permissão | módulos no catálogo, `diag_entrevistadores`, escopo por UC |
| 2 | Motor de questionários | tabelas, construtor, versionamento, condicional, blocos selados |
| 3 | Campanhas e equipes | campanha, equipe, atribuição, cobertura, anuência coletiva |
| 4 | App de campo offline | 4º PWA, IndexedDB, sync idempotente, GPS, foto, áudio, aceite |
| 5 | Questionário socioeconômico | carga dos módulos A–Z como configuração, não como código |
| 6 | Validação e correção | fila do coordenador, correção versionada, transferência |
| 7 | Camada analítica | projeções, views tipadas, motor de indicadores |
| 8 | Mapa e anonimização | camadas, três níveis de precisão, supressão |
| 9 | Dashboard e exportação | painéis, filtros, exportação por permissão |
| 10 | LGPD do módulo | ROPA, RIPD, aviso de campo do 4º app, retenção, anonimização |
| 11 | Testes e endurecimento | Playwright dos 19 critérios, advisors, carga |

**A fase 10 não é a última de verdade.** Cada fase que cria tabela com dado
pessoal já entra com RLS e com sua linha no ROPA, na mesma entrega — regra
que o `CLAUDE.md` já estabelece. A fase 10 fecha RIPD, retenção e
anonimização, que só fazem sentido com o conjunto pronto.

O detalhamento de cada fase — arquivos, migrations, ordem, dependências e
pontos de verificação — é o **plano de execução**, próximo documento.

---

## 9. Pendências que dependem de decisão humana

Mesmo padrão da seção de pendências LGPD do `CLAUDE.md`: não é falta de
tempo, é que preencher qualquer uma delas por conta própria seria simular
uma decisão que não foi tomada.

| # | Pendência | Quem decide | Bloqueia |
|---|---|---|---|
| 1 | Stack: confirmar vanilla (§1.1) | DIMA / TI | tudo |
| 2 | Unidade de análise: família ou domicílio (§4.2) | metodologia | fases 2 e 7 |
| 3 | Módulo P — desenho não incriminatório (§2.1) | DIMA + jurídico | fase 5 |
| 4 | Conhecimento tradicional — anuência e política de uso (§2.2) | jurídico + comunidades | fases 3 e 5 |
| 5 | CPF: coletar? com que finalidade? (§2.5) | DIMA | fase 5 |
| 6 | Pesos e cortes dos 5 índices (§2.9) | metodologia | fase 7 |
| 7 | Núcleo obrigatório vs. opcional (§2.8) | coordenação de campo | fase 5 |
| 8 | Ética em pesquisa: submete a CEP/CONEP? | DIMA + jurídico | início do campo |
| 9 | Retenção: prazo do dado identificável (§5.4) | DIMA + DPO | fase 10 |
| 10 | Validação de entrevista: só mesa, ou também app? (§3.2) | coordenação | fase 6 |

As pendências 1 e 2 bloqueiam o plano de execução. As demais bloqueiam
fases específicas e podem ser resolvidas em paralelo ao desenvolvimento.

---

## 10. Regras do projeto que valem para este módulo

Do `CLAUDE.md`, aplicadas aqui:

- **`pwa/sw.js`**: o 4º app entra em `VERSOES` e `SHELLS`, com scope
  próprio (`/pages/diagnostico-app.html`). Toda entrega que toque arquivo
  web do app incrementa **só** o contador dele.
- **Migrations sempre aplicadas** em produção na mesma entrega, seguidas de
  `get_advisors(security)`.
- **`DROP FUNCTION` antes de recriar RPC com lista de parâmetros
  diferente** — erro já cometido três vezes no projeto (173, 178, 224).
- **Ao recriar RPC, partir do `CREATE OR REPLACE` mais recente**, nunca do
  original (lição da 181, que reintroduziu um bug já corrigido).
- **Ícones**: SVG em `BICON_PATHS`, nunca emoji.
- **Design system**: `--floresta`, `--verde-c`, `--ouro`, Fraunces + DM Sans.
- **Fotos**: bucket privado + `js/fotos-privadas.js`, nunca `getPublicUrl`.
- **Cliente Supabase**: `sigucDb()`, nunca `window.db`.
- **`window.LGPD_CAMPO_APP = 'diagnostico'`** antes de `lgpd-campo.js`, e
  documento de aviso de campo próprio (padrão das migrations 222/223).
- **APK** só quando pedido ou quando houver acúmulo que justifique.

### Correção necessária no `CLAUDE.md`
O arquivo está desatualizado e induz a erro: descreve 60 migrations quando
há 225, e lista como "a implementar" os módulos A (estrutura
organizacional), B (alertas ambientais), C (painel do gestor) e D (gestão
de pesquisa) — todos já em produção. Atualizar isso é pré-requisito, senão
a próxima sessão reconstrói o que existe.

---

## 11. Avaliação honesta do esforço

Este módulo é maior que Frota e Biomonitor **somados**. O que a proposta
pede é um construtor de formulários dinâmicos com lógica condicional,
versionamento imutável, sincronização offline e camada analítica — ou seja,
o núcleo de um ODK/KoboToolbox — mais um questionário de 30 módulos, mais
indicadores compostos, mais anonimização geográfica.

Vale registrar que **ODK/Kobo existem e fazem 80% disso**. O que eles não
fazem é o que justifica construir aqui: integração nativa com o cadastro de
UCs, com o RBAC de escopo por UC, com o mapa, com a LGPD já implementada e
com a operação da SEMA. E há um argumento institucional legítimo: o dado
fica em casa, no mesmo banco do resto.

A recomendação é construir — mas construir **escopo enxuto no motor**: só
os tipos de pergunta que os 30 módulos de fato usam, não os 22 tipos da §7
por completude. Cada tipo de pergunta custa app + mesa + validação +
projeção + teste. Tipo que ninguém usa é dívida pura.

---

*Documento de análise e especificação ajustada. Não implementa nada.
Sujeito a alteração conforme as decisões da §9.*
