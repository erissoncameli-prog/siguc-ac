# Diagnóstico Socioeconômico — Plano

> **Status:** Fase 1 ENTREGUE (18/10/2026) — migrations 362/362b/362c aplicadas em
> produção, `js/socio-regras.js`, testes em `supabase/tests/socio/rodar.sh`.
> Fase 2 ENTREGUE (18/10/2026) — `pages/socio-questionarios.html` (mesa: catálogo,
> versões com editor e pré-visualização, equipe, pedidos de acesso).
> Fase 3 ENTREGUE (18/10/2026) — `pages/socio-app.html` (app de campo offline, PWA),
> migration 363 (bucket `socio-fotos` + `socio_app_pacote()`). Fases 4–5 a fazer.
> **Origem:** o Diagnóstico Socioambiental do dima-plataforma (`diag_*`,
> migrations `20260926_diag_01` a `20261009_diag_20`). O desenho e as regras
> vêm de lá. O código é portado e adaptado ao SIGUC, não copiado às cegas.

---

## 0. Decisões já tomadas

| Tema | Decisão | Data |
|------|---------|------|
| Nome | **Diagnóstico Socioeconômico**. Módulo `socio` no código, prefixo `socio_` nas tabelas e `fn_socio_` nas funções | 18/10/2026 |
| Dados do DIMA | **começar do zero**: nenhuma ficha migrada. Só a *estrutura* do questionário v7 pode servir de 1º instrumento (§1.4) | 18/10/2026 |
| Vários questionários | sim, quantos forem necessários (instrumento → versão → campanha → ficha, §1) | 18/10/2026 |
| UC | **opcional**: o instrumento não depende de UC. Cada campanha decide se exige UC, município ou nenhum dos dois (§1.3) | 18/10/2026 |
| Dono | **todo instrumento pertence ao departamento que o solicitou** (`unidades_organizacionais`) | 18/10/2026 |
| Acesso | o módulo é **aberto a todos**; um departamento **não vê** o instrumento de outro sem **pedir e receber permissão** (§2) | 18/10/2026 |
| super_admin | administra o catálogo, mas **também pede** para ler ficha (Q1) | 18/10/2026 |
| Chefia acima | **só agregados** (Q2) | 18/10/2026 |
| 1º instrumento | **nenhum vem do DIMA** — nem fichas, nem a estrutura do v7 (Q3) | 18/10/2026 |
| Pedido de acesso | **só por pessoa** na v1 (Q4) | 18/10/2026 |

Regras do projeto que valem aqui sem exceção:
- nada impede o trabalho de campo;
- cálculo num lugar só;
- policy por `TO authenticated`, nunca `USING (true)`;
- toda função nova com `REVOKE … FROM anon` explícito e `SET search_path = public`;
- tabela nova com dado pessoal ganha linha no ROPA na mesma entrega.

---

## 1. Modelo

```
socio_instrumentos (dono: unidade_org_id)
  └─ socio_questionarios (versão, JSON imutável depois de publicado)
       └─ socio_campanhas (onde, quando, quem aplica)
            └─ socio_fichas (+ moradores, identificação, fotos)
```

### 1.1 Instrumento — `socio_instrumentos`
Cada questionário: `codigo` (único, 2–10 letras, vira o prefixo do código da
ficha: `DSA-…`, `PESCA-…`), `titulo`, `finalidade`, `unidade_analise`
(`domicilio | pessoa | comunidade | estabelecimento`) e **`unidade_org_id`
(departamento dono, obrigatório)**. Não se apaga, só se arquiva.

### 1.2 Versão — `socio_questionarios`
Mesmo formato e regras do DIMA:
- `estrutura` jsonb e `aviso_entrevistado`;
- `hash_sha256` GERADO;
- `rascunho → publicado → arquivado`;
- versão publicada é imutável (trigger); correção = versão nova.

O interpretador é portado com o teste cruzado SQL × JS:
- no SQL: `fn_socio_aplicaveis`, `_normalizar_respostas`, `_calcular_alertas`, `_derivar`, `_cond`, `max_marcar`, `maior_nivel`;
- no JS: `js/socio-regras.js`.

Nova é a validação da própria estrutura antes de publicar
(`fn_socio_validar_estrutura`: chaves únicas, salto apontando para pergunta
anterior, opções de `unica`/`multipla`), porque agora quem escreve
questionário são vários departamentos, não uma equipe só.

### 1.3 Campanha — `socio_campanhas`
Uma aplicação concreta de uma **versão publicada**. Guarda:
- período (`inicio`, `fim`) e situação (`planejada | aberta | encerrada`);
- **escopo territorial configurável**: `exige_uc` / `exige_municipio` (booleanos) e, opcionalmente, a lista de UCs e municípios permitidos;
- equipe de campo: `socio_campanha_aplicadores`.

O app de campo só baixa as campanhas **abertas** em que a pessoa é aplicadora.

**Território na ficha:**

| Campo | Obrigatório? |
|-------|--------------|
| `cd_mun` (de `municipios_acre`) | conforme a campanha |
| `uc_id` | conforme a campanha |
| `comunidade_id` (`socio_comunidades`: nome + município + UC opcional, cadastro comum a todos os departamentos) | opcional, ou texto novo como no DIMA |

### 1.4 Ficha — `socio_fichas` e satélites
Mesmo desenho do DIMA, já testado em campo:
- `uuid_cliente` UNIQUE CONSTRAINT, que é a idempotência da fila (índice parcial não serve, lição da 257b);
- envio só pela RPC `socio_enviar_ficha` (transação única);
- mudança de status só por `socio_mudar_status`;
- **identificação separada**: `socio_fichas_identificacao`, `socio_moradores_identificacao`, `socio_fotos` em bucket privado `socio-fotos`;
- modo treino (`treino`, código `TRE-`), fora de todo indicador;
- histórico de status imutável.

**Nada vem do DIMA** (decisão de 18/10/2026): cada departamento escreve o seu
instrumento do zero. A lista do domicílio mora em `socio_fichas.linhas` (jsonb,
sem identificação) e em `socio_fichas_identificacao.linhas` (as colunas marcadas
`identificacao`) — sem tabela de moradores, para nunca precisar apagar linha ao
reenviar.

### 1.5 Formato da estrutura (o "questionário como dado")
```json
{
  "identificacao": {"nome": "nao|opcional", "gps": "nao|opcional"},
  "texto_max_len": 2000, "outro_max_len": 120,
  "lista": {"titulo": "...", "max_linhas": 30, "minimo": 1, "marca_entrevistado": true,
            "colunas": [{"chave": "idade", "rotulo": "Idade", "tipo": "unica|inteiro|texto|booleano",
                         "opcoes": [{"v": "...", "r": "...", "nivel": "..."}], "min": 0, "max": 120,
                         "max_len": 120, "identificacao": false}]},
  "coerencia": [{"tipo": "igual_total_linhas", "chave": "qtd_moradores"},
                {"tipo": "nega_linha", "chave": "atividades_mulheres", "valor": "nao_ha_mulheres",
                 "onde": {"coluna": "sexo", "op": "=", "valor": "mulher"}}],
  "blocos": [{"id": "agua", "titulo": "Água", "perguntas": [
    {"n": 8, "rotulo": "8", "chave": "agua_fonte", "tipo": "unica|multipla|inteiro|decimal|texto|texto_longo|tabela",
     "texto": "...", "opcoes": [{"v": "outro", "r": "Outro", "especificar": true, "exclusiva": false}],
     "mostrar_se": {"se": "chave_anterior", "op": "=|!=|in|contem|nao_contem", "valor": "..."},
     "opcional": false, "min": 0, "max": 10, "aviso_min": 18, "aviso_max": 15, "max_len": 80, "max_marcar": 3,
     "derivada": {"tipo": "total_linhas"}}]}]
}
```
- `mostrar_se` aceita `{"todas": [...]}`; só referencia pergunta **anterior**.
- `derivada`: `total_linhas` (inteiro), `existe_linha` + `onde` (única com sim/não),
  `maior_nivel` + `coluna` (única; `nivel` da opção da coluna = opção da pergunta).
- `onde` (filtro de linha): `=`, `!=`, `in`, `entre` `[mín, máx]`; valor ausente só casa com `!=`.
- A pergunta `tipo: "tabela"` só marca ONDE a lista aparece (uma por questionário).
- Conferência: `fn_socio_validar_estrutura(jsonb)` devolve a lista de erros legíveis;
  rascunho salva com erro, publicar não.

---

## 2. Acesso por departamento (o ponto novo)

### 2.1 Princípio
Ter o módulo não dá acesso a instrumento nenhum. O acesso a cada instrumento
vem de **pertencer ao departamento dono** ou de uma **permissão concedida pelo
dono**. É uma regra própria do módulo, escrita numa função só:
`fn_socio_papel(instrumento_id) → 'gestor' | 'aplicador' | 'leitor' | 'agregados' | null`.
Toda policy e RPC do módulo passa por ela. Nenhuma página decide acesso.

### 2.2 Quem é do departamento
Usa a fonte única do organograma, `usuario_unidades()` (lotação **+ cargo
ocupado**), com a mesma herança de `alcance_por_lotacao()`:
- lotado na unidade dona **ou num descendente** (divisão, núcleo) = membro;
- lotado num **ancestral** (diretoria, secretaria = chefia acima) = `leitor` de agregados, nunca de ficha identificada.

### 2.3 Papéis dentro do instrumento — `socio_instrumento_membros`

| Papel | Pode | Como se ganha |
|-------|------|---------------|
| `gestor` | editar e publicar versões, abrir campanhas, validar e devolver fichas, exportar, aprovar pedidos de outros departamentos | **automático para o titular do cargo de chefia da unidade dona** (`cargo_ocupacoes`); o gestor designa outros |
| `aplicador` | aplicar no app, ver as **próprias** fichas | designado pelo gestor (por campanha) |
| `leitor` | ver fichas **sem identificação** e indicadores | designado pelo gestor |
| membro sem papel | ver o instrumento e os indicadores agregados | estar no departamento (§2.2) |

### 2.4 Outro departamento — pedir permissão
- **Catálogo comum:** todos veem *que* o instrumento existe (título, departamento dono, finalidade, situação). Não veem perguntas, fichas nem números. É isso que permite pedir.
- **Pedido** (`socio_acessos`): quem pede escolhe o nível (`agregados | leitor | aplicador`), escreve a justificativa (mínimo de 20 caracteres, conferido no banco) e o prazo (`data_fim` obrigatória, mesma regra de `credenciamentos`).
- **Decisão:** **o gestor do departamento dono** decide (nunca quem pediu), com parecer obrigatório na recusa.
- **Avisos:** no sino, ao pedir e ao decidir.
- **Revogação e histórico:** vencido ou revogado, o acesso cai sozinho. O registro não se apaga e entra na `trilha_auditoria`.
- **Teto:** `aplicador` de outro departamento não recebe identificação de fichas alheias. Nenhum pedido dá `gestor`.

### 2.5 super_admin
Administra o catálogo, **troca o departamento dono** e corrige papéis (com
justificativa), mas **por padrão não lê fichas identificadas** de instrumento
algum. Se precisar, pede como qualquer outro. *(Ver pergunta Q1.)*

### 2.6 ⚠️ Pré-requisito medido: lotação
Em produção (18/10/2026), **14 dos 71 usuários ativos têm lotação** e 53 não
têm. Com a regra acima, quem não tem lotação nem cargo não é membro de
departamento nenhum. Não perde acesso a nada que já tem, mas só entra no
Diagnóstico por pedido. Mitigação:
- a tela diz isso claramente ("sem lotação cadastrada — peça à administração", com o link da aba Lotações);
- antes de abrir a 1ª campanha, conferir a lotação de quem vai aplicar (`vw_usuarios_sem_lotacao`);
- **nenhum fail-open aqui**: diferente de `nivel_efetivo()`, cair no padrão abriria o instrumento de um departamento para todos, que é exatamente o que a decisão proíbe.

---

## 3. Telas

**Mesa:** grupo próprio na sidebar, "Diagnóstico Socioeconômico", visível a
todos (sem `modulo:` de gate). As páginas são:

| Página | Conteúdo |
|--------|----------|
| `socio-instrumentos.html` | "Do meu departamento" e "Catálogo" (com o botão **Pedir acesso**); editor de versão (JSON + pré-visualização + validação, no molde dos "Gabaritos de laudo"); publicação; membros; pedidos recebidos |
| `socio-campanhas.html` | período, escopo territorial, aplicadores |
| `socio-validacao.html` | fila do gestor; ficha aberta; validar, devolver ou descartar |
| `socio-indicadores.html` | por instrumento, campanha, UC e município, gerados a partir do JSON; supressão abaixo de 5 fichas; exportação registrada (ExcelJS) |

**Campo:** `pages/socio-app.html`, 5º app offline:
- PWA primeiro, com `VERSOES.socio` e `SHELLS.socio` em `pwa/sw.js`;
- reaproveita `pin-baralho`, `luz-nav`, `guia-app`, `foto-otimizar`, `brigada-captura` (GPS pontual), `fotos-privadas` e `lgpd-campo` (slug `socio`);
- APK Capacitor (`app-socio/`) numa fase própria, porque o contador em `VERSOES` dispara o build automático assim que existir workflow.

---

## 4. LGPD
- **ROPA:** novo `TRAT-0xx` "Diagnóstico Socioeconômico", com as tabelas reais. Dado sensível possível (saúde, filiação), titulares terceiros e menores (lista de moradores). Base legal: art. 7º III / art. 11 II "b", **nunca consentimento**. O entrevistado é avisado e pode recusar.
- **Aviso por instrumento:** `aviso_entrevistado` é versionado com o questionário, porque cada departamento coleta coisas diferentes.
- **Retenção:** identificação e fotos apagadas 2 anos após a validação (como no DIMA). Prazo lido do ROPA, cron diário. Arquivo removido do Storage por fila.
- **Log de acesso:** fichas identificadas lidas por outro departamento (acesso concedido) são registradas em `lgpd_acesso_dado_terceiro`, com `origem = 'socio'`.

---

## 5. Fases

| Fase | Entrega | Guarda |
|------|---------|--------|
| **1** | Banco: instrumentos, versões, campanhas, comunidades, fichas e satélites, `fn_socio_papel`, pedidos de acesso, RLS, ROPA, interpretador SQL + `js/socio-regras.js` | teste cruzado SQL × JS (porte do `supabase/tests/diagnostico`); testes de acesso como membro, como outro departamento antes e depois da concessão, como sem lotação e como `anon` |
| **2** | `socio-instrumentos.html` (catálogo, editor, membros, pedidos) | Playwright com stub |
| **3** | App de campo offline + envio + treino | Playwright: salvar offline, reenviar sem duplicar, treino isolado |
| **4** | Campanhas + validação | — |
| **5** | Indicadores + exportação + retenção | — |
| depois | áudio + transcrição local, editor visual, APK, visita com vários instrumentos no mesmo domicílio | — |

---

## 6. Perguntas — respondidas em 18/10/2026

As 4 propostas foram aceitas: super_admin pede para ler ficha (Q1), chefia acima
vê só agregados (Q2), nada vem do DIMA (Q3), pedido só por pessoa (Q4).

## 7. Desvios da proposta, decididos ao codar (Fase 1)

- **Log de `lgpd_acesso_dado_terceiro` não foi criado** (§4): pela regra final,
  ninguém de outro departamento lê identificação — nem o leitor, nem o aplicador
  de fora (só a da própria ficha). Não há leitura de terceiro para registrar.
- **Notificação usa `tipo = 'sistema'`** com `meta.modulo = 'socio'` e
  `meta.subtipo` (acesso_pedido/aprovado/recusado/revogado, acesso_sem_gestor,
  ficha_devolvida): evita uma migration só de `ALTER TYPE ... ADD VALUE`.
- **Fichas fora da trilha de auditoria**: a trilha copia a linha inteira e o
  super_admin a lê — seria ler ficha sem pedir. O histórico de status
  (`socio_fichas_historico`) cobre a ficha.
- **Bucket `socio-fotos` fica para a Fase 3** (app de campo). A RPC de envio já
  confere o caminho `socio-fotos/<uuid_cliente da ficha>/…`.
- **Departamento sem chefe nem gestor**: pedido de acesso avisa o super_admin,
  que designa um gestor (`socio_definir_papel`, com justificativa na trilha).

## 8. Fase 3 — app de campo (18/10/2026)

- **Uma chamada traz tudo**: `socio_app_pacote()` devolve campanhas em que a
  pessoa está na equipe (abertas, ou encerradas ainda nos 15 dias de carência —
  `aceita_nova` diz se pode começar entrevista nova), a versão do questionário de
  cada uma (estrutura + aviso + hash), instrumentos em que pode treinar (versão
  mais nova não arquivada, rascunho incluído), comunidades, municípios, UCs e as
  próprias fichas dos últimos 120 dias (para mostrar devolvida/validada). Fica
  guardado no aparelho; o app abre e entrevista sem rede.
- **A ficha guarda a cópia da versão com que foi aplicada**: mudar o pacote
  depois (versão nova publicada) não altera entrevista em andamento.
- **Foto sobe antes da ficha** para `socio-fotos/<uuid_cliente da ficha>/<uuid
  da foto>.<ext>`. A policy de envio aceita pasta de ficha que ainda não existe
  (para quem pode treinar ou aplicar algum instrumento) e, se a ficha existe, só
  do próprio entrevistador e com a ficha enviada ou devolvida. Leitura = quem lê
  a identificação. Sem policy de alteração nem de remoção: reenvio que acha o
  arquivo trata o 409 como sucesso; expurgo é da Fase 5.
- **Erro `socio:<codigo>` = problema de conteúdo** (fora do período, sem
  permissão…): a ficha vai para "Com problema" com o texto do banco e um botão
  Corrigir; nunca some. Outro erro (rede, sessão) = continua pendente e a fila
  tenta de novo (ao abrir, ao voltar a rede, ao voltar do segundo plano e a cada
  minuto). `codigo_duplicado` gera outro código e reenvia uma vez.
- **Correção mantém uuid, código e `finalizada_em`** — o banco confere o período
  pela hora em que a entrevista terminou, não pela hora da correção.
- **Nada obrigatório para avançar** nos blocos: pendência aparece na revisão e o
  banco a guarda como alerta. Só se trava o que o banco recusaria de qualquer
  jeito (município/UC exigidos pela campanha, aviso lido, aceite) e valor que a
  estrutura não aceita (fora do intervalo) — este mostrado na revisão.
- **Identificação só quando o instrumento pede** (`identificacao.nome/gps`): o
  app nem mostra o campo, e o envio não manda o que não foi pedido.
- Aviso de campo do aplicador (`lgpd-campo`, slug `socio`): sem documento
  cadastrado o app segue (fail-open). Cadastrar o texto em `lgpd_documentos`
  (`tipo = 'aviso_campo'`, `app = 'socio'`) quando a redação estiver pronta.
- **Ainda não**: APK (`app-socio/`), guia de treinamento (motor `guia-app`),
  página de instalação, GPS contínuo (só leitura pontual, por decisão), áudio.
