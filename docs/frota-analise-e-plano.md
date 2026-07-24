# Módulo Frota — Análise de ponta a ponta e plano de evolução

Levantamento feito em 24/07/2026 sobre o estado real do código (`pages/frota-*.html`,
`js/frota-*.js`) e do banco de produção (projeto `atqtybcsvepdabsvgaly`, migrations
até a 195). Nada foi alterado — este documento é o plano que precede a implementação.

---

## 1. O que existe hoje

**Superfícies**

| Superfície | Arquivo | Papel |
|---|---|---|
| App de campo/mobile (PWA) | `pages/frota-app.html` (3.376 linhas) | motorista, gestor, solicitante |
| Mesa — solicitar | `pages/frota-solicitar.html` | solicitante |
| Mesa — aprovar/agenda | `pages/frota-viagens.html` (977 linhas, com timeline) | gestor |
| Mesa — administrar (abas em iframe) | `frota-administrar.html` → veículos, manutenção, abastecimentos, contratos | gestor |
| Mesa — painel | `pages/frota-dashboard.html` | gestão/direção |
| Suporte | `js/frota-offline.js`, `frota-sync.js`, `frota-wise.js` | fila IndexedDB, sync, tema |

**Banco:** 19 tabelas `frota_*`, todas com RLS habilitado; 31 funções `frota_*`;
constraints de exclusão GiST reais (`contype = 'x'`) impedindo dupla reserva de
veículo e de motorista em períodos sobrepostos; idempotência por `uuid_cliente`
em viagem direta e abastecimento; índices adequados ao volume atual.

**Volume atual (produção):** 25 viagens, 5 abastecimentos, 4 veículos, 4 motoristas.
Ou seja: o módulo está tecnicamente maduro mas **operacionalmente pré-adoção**. Isso é
uma vantagem — dá para corrigir fundações agora sem migração de dados dolorosa.

O que já está bem resolvido e não deve ser mexido: a defesa em 2 camadas da trava de
veículo no abastecimento; o fail-safe da config de GPS; a idempotência do
abastecimento; o isolamento do cliente Supabase do app; o portão de PIN com saída de
emergência à prova de travamento; o versionamento isolado do service worker por app.

---

## 2. Achados de segurança

### 2.1 Vazamento de dados por RPC `SECURITY DEFINER` sem guarda de sessão — **ALTO**

A `anon key` é pública (vai no `config.js` para o navegador). Qualquer pessoa na
internet pode chamar `/rest/v1/rpc/<função>` com ela. Três funções `SECURITY DEFINER`
do módulo não verificam `auth.uid()` e têm `EXECUTE` concedido ao papel `anon`:

| Função | Corpo | Consequência |
|---|---|---|
| `frota_nome_usuario(uuid)` | `SELECT nome_completo FROM usuarios WHERE id = $1` | lê nome de **qualquer** usuário da plataforma, contornando o RLS de `usuarios` |
| `frota_veiculos_disponiveis(...)` | lista `placa, modelo, setor` | expõe a frota inteira do órgão a não autenticados |
| `frota_motorista_apto(uuid)` | valida CNH/status | oráculo de situação de habilitação |

Os UUIDs não são adivinháveis, o que reduz o alcance de `frota_nome_usuario` — mas
`frota_veiculos_disponiveis` não precisa de UUID nenhum: basta chamar com duas datas.

**Correção:** `REVOKE EXECUTE ... FROM anon` nas três e adicionar guarda explícita
(`IF auth.uid() IS NULL THEN RAISE EXCEPTION`) no corpo, no molde que a migration
189 já usa (`frota_escala_auth_guard`).

### 2.2 Funções de trigger expostas como RPC — **MÉDIO**

A migration 179 revogou `EXECUTE` de duas funções de trigger, mas o mesmo padrão
ficou aberto em outras sete: `frota_gerar_codigo_os`, `frota_notificar_viagem_solicitada`,
`frota_push_dispatch`, `frota_ajustar_saldo_contrato`, `frota_os_sync_veiculo`,
`frota_normaliza_placa`, `frota_inicializar_saldo_contrato`.

Na prática o Postgres recusa chamar função de trigger fora de trigger, então o risco
concreto é baixo — mas `frota_push_dispatch` faz `net.http_post` e lê o `push_secret`,
e é exatamente a classe de superfície que não deveria estar aberta. Fechar as sete de
uma vez, com o mesmo texto da 179.

### 2.3 Buckets públicos e listáveis — **MÉDIO**

`frota-abastecimentos`, `frota-manutencao`, `frota-motoristas` e `frota-veiculos` são
buckets **públicos** com política `SELECT` ampla (`bucket_id = '...'` e nada mais).
Qualquer pessoa com a anon key pode **listar** e baixar todos os objetos: cupons fiscais
de combustível, fotos de hodômetro, fotos de defeito e **fotos de rosto dos motoristas**
(dado pessoal). Bucket público serve URL de objeto sem precisar de política `SELECT`
ampla — a política é o que habilita a listagem.

**Correção:** tornar os quatro buckets privados e passar a servir por *signed URL*
(TTL curto) nas telas de mesa e no app. É a mudança de maior impacto de privacidade
do módulo. Requer tocar os pontos que hoje chamam `getPublicUrl`.

### 2.4 Login do app não é auditado nem tem bloqueio por tentativa — **MÉDIO**

`index.html` chama `verificar_bloqueio` antes e `registrar_tentativa_acesso` depois de
cada tentativa (migration 002: bloqueio após 5 falhas). O `loginFrota()` do
`frota-app.html` **não chama nenhuma das duas**, e o logout não chama
`registrar_saida_acesso`. Resultado: o login por CPF do motorista é o caminho com
**menos** proteção e **nenhum** rastro em `auditoria_acessos` — justamente o perfil que
opera bem/patrimônio público em campo. O mesmo vale, provavelmente, para Brigadas e
Biomonitor (a verificar).

### 2.5 PIN de 4 dígitos sem limitador de tentativas — **BAIXO/MÉDIO**

`fPinHash` = um único `SHA-256(pin + usuario.id)` guardado no IndexedDB. O salt (o id
do usuário) está na sessão em `localStorage`, ao lado. São 10.000 candidatos: quem tem
o aparelho quebra o PIN offline em milissegundos. E a tela aceita tentativas ilimitadas.

O comentário no código está certo ao dizer que o PIN é conveniência, não a fronteira de
auth — a sessão Supabase é. Mas o custo de endurecer é baixo: contador de tentativas
persistido + atraso progressivo + wipe da sessão após N falhas. (PBKDF2 com muitas
iterações ajuda contra o ataque offline, mas não substitui o limitador.)

### 2.6 Fallback de idempotência sem filtro de dono — **BAIXO**

Em `frota_registrar_abastecimento`, o caminho feliz filtra por dono
(`AND motorista_id IN (SELECT ... WHERE usuario_id = auth.uid())`), mas o handler
`EXCEPTION WHEN unique_violation` refaz o `SELECT` **sem** esse filtro e retorna a linha.
Só alcançável em colisão de UUID v4, mas é um `RETURN` de registro alheio. Copiar o
filtro para o handler.

---

## 3. Achados de robustez e fluxo

### 3.1 Pílula envenenada na fila offline — **ALTO (é o que mais dói em campo)**

`frota_checkout_viagem` e `frota_checkin_viagem` **não são idempotentes** (diferente de
`abrir_direta` e `abastecimento`, que têm `uuid_cliente`). Elas transicionam por status:
`WHERE id = $1 AND status = 'aprovada'`.

Cenário real de campo: o motorista faz check-out em área de sinal fraco. A RPC **commita
no servidor**, mas a resposta se perde. O cliente cai no `catch`, `fPareceOffline` diz
"parece rede", a ação vai para a fila. No próximo tick de sync (45 s) o reenvio encontra
a viagem já em `em_andamento` → `RAISE EXCEPTION` → `fSyncUma` devolve a ação para
`pendente`. **Para sempre.** Não há limite de tentativas, nem backoff, nem dead-letter:
a cada 45 s o app reenvia, mostra "1 pendência não pôde ser enviada" e o pontinho de
alerta no Config nunca apaga.

**Correção:** dar `uuid_cliente` a check-out/check-in (mesmo molde da migration 173) e,
no motor de sync, adicionar contagem de tentativas, backoff exponencial e um estado
`falha_permanente` visível na tela de fila, com ação de descarte.

### 3.2 Reenvio de foto do abastecimento provavelmente trava — **MÉDIO (verificar)**

`fSyncUploadFotoAbastecimento` sobe com `upsert: true`. As políticas do bucket permitem
`INSERT` a motorista ativo, mas `UPDATE` só a quem tem `pode_editar('frota')`. Se a foto
subiu e a RPC seguinte falhou, o reenvio grava no mesmo caminho → vira `UPDATE` →
negado para o motorista → a pendência nunca sincroniza. Precisa de um teste dirigido
para confirmar; se confirmado, a correção é pular o upload quando o objeto já existe,
ou liberar `UPDATE` restrito ao próprio prefixo `uuid_cliente/`.

### 3.3 Viagem atrasada libera o motorista para outra escala — **MÉDIO**

As constraints de exclusão usam o período **previsto**
(`data_saida_prevista`, `data_retorno_prevista`). Passado o retorno previsto sem
check-in, a viagem em andamento deixa de bloquear o período. O veículo continua
protegido pelo `status = 'em_viagem'` que `frota_aprovar_viagem` exige — mas o
**motorista não tem guarda equivalente**: `frota_motorista_apto` só olha CNH e status
cadastral. Dá para escalar para uma nova viagem alguém que ainda está na estrada.

**Correção:** recusar aprovação se o motorista tiver viagem `em_andamento`, e mostrar na
mesa uma lista de "viagens vencidas sem check-in" com lembrete ao motorista.

### 3.4 `navigator.onLine` como porta de entrada — **BAIXO**

O próprio `frota-sync.js` documenta que `navigator.onLine` não é confiável e faz um HEAD
real contra o Supabase. Mas `confirmarCheckout`, `confirmarCheckin`,
`confirmarAbastecimento`, `carregarViagensMotorista` e `fmAtualizarConfigGps` decidem
por `if (!navigator.onLine) throw new Error('offline')`. Em captive portal ou sinal
fantasma o app tenta a rede e depende do `catch` — funciona, mas gasta o timeout do
usuário. Vale unificar no teste real de conectividade já existente.

### 3.5 Janela de 120 min do abastecimento sem escape — **BAIXO**

A trava é por veículo, global, sem exceção. Em viagem longa com dois abastecimentos
legítimos próximos, ou em embarcação com tanque auxiliar, o motorista fica sem saída no
campo. Faltam duas coisas: mensagem que ensine o que fazer, e um caminho de exceção com
justificativa que caia como pendência para a gestão validar.

---

## 4. Achados de consistência do repositório

### 4.1 Migration aplicada em produção que não está no repositório — **ALTO**

`supabase_migrations.schema_migrations` tem `20260723034939 · frota_alocacao_proporcional`,
e **não existe arquivo correspondente** em `supabase/migrations/`. O banco de produção
tem estado que o versionamento não descreve — recriar o ambiente do zero produz um banco
diferente do que está no ar. Precisa ser recuperado (`pg_get_functiondef` / dump do
objeto) e commitado.

### 4.2 Numeração duplicada e fora de ordem — **MÉDIO**

No repositório: `183_frota_motoristas_foto.sql` **e** `183_frota_veiculos_motorista.sql`;
`184_frota_lista_passageiros.sql` **e** `184_frota_veiculo_autorizados.sql`. No banco, os
números 185/187/188 aparecem reaproveitados com nomes diferentes, e várias migrations
foram aplicadas sem o prefixo numérico (`frota_trava_medidas`, `frota_comunicado_defeito`).
A regra do `CLAUDE.md` ("migrations numeradas sequencialmente") está sendo violada de
fato, e a ordem de aplicação deixou de ser dedutível pelo nome do arquivo.

Como o histórico já foi aplicado, a saída não é renumerar (quebraria mais): é **congelar
o passado, documentar o mapa arquivo → versão aplicada, e passar a usar o timestamp do
Supabase como número canônico daqui pra frente.**

### 4.3 Paridade mesa ⇄ app quebrada na entrega mais recente — **MÉDIO**

O `CLAUDE.md` tem regra explícita de duplicação obrigatória para o par
`frota-solicitar.html ⇄ frota-app.html`. O commit `f1151b4` entregou no app uma tela de
acompanhamento completa para o solicitante — linha do tempo de status
(`solicitada → aprovada → em_andamento → concluida`) com carimbos de hora, veículo e
motorista com link de WhatsApp, link de mapa do GPS de saída/chegada, avarias e "solicitar
de novo". A mesa (`renderMinhasViagens`) continua com uma tabela plana de 5 colunas, sem
detalhe, sem timeline, sem mapa, sem repetir solicitação.

Quem solicita viagem no computador — a maioria dos servidores — está com a experiência
pior. É a regra do projeto sendo cobrada.

### 4.4 `CLAUDE.md` desatualizado — **BAIXO**

O arquivo documenta o módulo Frota até a migration 181 e não menciona: saldo de contrato
(185/188), veículo dedicado (186), escala por cidade e multivagas (187-190), deep-link de
push (191), trava de medidas (192), comunicado de defeito com fotos (193/194), notificação
ao solicitante no check-out/check-in (195), nem as páginas `frota-dashboard.html` e
`instalar-frota.html`. Quem entrar no projeto pelo `CLAUDE.md` tem um mapa de ~15 entregas
atrás do território.

---

## 5. Benchmark: o que as plataformas modernas fazem que aqui falta

Comparando com Fleetio (referência em manutenção-first) e Samsara (referência em
telemetria), o SIGUC-Frota já cobre solicitação/aprovação/escala, check-out/check-in com
medidor e GPS, abastecimento com validação por contrato, OS e plano de manutenção,
comunicado de defeito com fotos, offline-first e push. As lacunas relevantes:

1. **Checklist de inspeção pré/pós-viagem (DVIR).** É o padrão do setor: o app obriga o
   motorista a passar por uma lista de itens (pneus, freios, luzes, extintor, documentos,
   nível de óleo) antes de liberar o veículo, com foto e carimbo de hora; item reprovado
   vira automaticamente pendência de manutenção. Hoje o SIGUC captura avaria só **no
   check-in**, em texto livre — ou seja, descobre o problema depois da viagem. Esta é a
   maior lacuna funcional e a de melhor custo-benefício, porque a infraestrutura
   (comunicado de defeito → OS, migrations 193/194) **já existe**: falta a etapa de
   checklist na saída alimentando esse mesmo funil.
2. **Leitura assistida do hodômetro/cupom.** Fleetio confirma a leitura do odômetro a
   partir da foto do recibo. Aqui o motorista digita e a foto só serve de prova posterior.
   Um passo intermediário barato: pré-preencher com a última leitura conhecida e alertar
   sobre saltos improváveis (hoje só valida "não pode ser menor").
3. **Documentos com vencimento e alerta.** Existe `frota_veiculo_documentos` (0 linhas) —
   a tabela está lá, o fluxo não. CRLV, seguro, CNH: alerta antes de vencer é higiene
   básica e o módulo de notificação já existe.
4. **Custo por km/hora consolidado.** Hoje o dashboard tem consumo (km/L pelo método
   tanque-cheio) e gasto por fonte, mas não o custo total de propriedade por veículo
   (combustível + manutenção + multas ÷ km). É o número que a direção pede.
5. **Telemetria de veículo.** Samsara/Fleetio puxam hodômetro e diagnóstico direto do
   veículo. Fora de escopo (exige hardware), mas é o teto do que dá para automatizar sem
   ele — vale registrar a decisão.

---

## 6. Plano proposto

Ordem pensada para entregar o que protege dado e o que o campo sente primeiro, e para não
misturar correção com feature na mesma entrega.

### Fase 1 — Fechar o banco (só migrations, sem tocar UI) — ✅ CONCLUÍDA em 24/07/2026

1. ✅ `196_frota_hardening_rpc.sql`: `REVOKE` de `PUBLIC`/`anon` + guarda `auth.uid()` em
   `frota_nome_usuario` e `frota_veiculos_disponiveis`; `REVOKE` total de
   `frota_motorista_apto` (só chamada por funções `SECURITY DEFINER`); `REVOKE` nas sete
   funções de trigger; `SET search_path` nas três funções `frota_*` mutáveis; filtro de
   dono no handler `unique_violation` de `frota_registrar_abastecimento`.
2. ✅ `197_frota_revoke_anon_rpcs.sql` — **ampliação do escopo original**. Depois da 196
   ainda restavam **16** RPCs `SECURITY DEFINER` invocáveis por `anon`: as de ação
   (aprovar, recusar, check-out, check-in, abastecer, validar, reportar defeito…). Todas
   já tinham guarda interna, então não vazavam dado — mas continuavam invocáveis sem
   sessão, servindo de oráculo pelas mensagens de erro. Fechadas todas de uma vez.
   Resultado: **zero** funções `frota_*` `SECURITY DEFINER` executáveis por `anon`.
3. ✅ `frota_alocacao_proporcional` recuperada do banco e commitada como
   `192b_frota_alocacao_proporcional.sql` (não reaplicar — ver o mapa).
4. ✅ `docs/frota-migrations-mapa.md`: mapa arquivo ⇄ versão aplicada e nova convenção.

*Verificação executada:* 13 asserções em dois blocos de teste, com `SET ROLE` real —
`anon` bloqueado nas 4 RPCs antes expostas e em `frota_pode_operar_viagem`;
`authenticated` seguindo com as 18 RPCs, as duas views `SECURITY INVOKER` resolvendo
nomes (25 e 1 linha), `frota_sugerir_alocacao` (gestor) e
`frota_veiculos_ativos_abastecimento` (motorista) executando. Conferido também que
nenhuma das funções recriadas gerou overload duplicado (lição da 178) e que
`sem_search_path = 0`. Nenhuma mudança de comportamento para usuário autenticado.

*Fora do escopo desta fase, registrado:* os avisos do advisor em objetos não-Frota
(`spatial_ref_sys`, `cargos_atuais`, `v_aap_publica`, `brigadas_resumo`,
`vw_registros_validacao`, `minhas_permissoes`, ~46 funções de outros módulos com
search_path mutável) continuam abertos — mesma classe de defeito, módulos diferentes.

### Fase 2 — Fila offline confiável — ✅ CONCLUÍDA em 24/07/2026

4. ✅ `198_frota_checkout_checkin_idempotente.sql`: colunas `checkout_uuid_cliente` e
   `checkin_uuid_cliente` em `frota_viagens` (+ índices únicos parciais) e parâmetro
   `p_uuid_cliente` nas duas RPCs. São duas colunas porque check-out e check-in são
   duas ações distintas sobre a mesma viagem — o `uuid_cliente` que já existia
   identifica a viagem criada por viagem direta, não a ação. `DROP FUNCTION` antes de
   recriar (lição da 178, já que a lista de parâmetros muda) e reaplicação dos
   `REVOKE`/`GRANT` das 196/197, que o `DROP` zera.
5. ✅ `frota-sync.js`: `F_MAX_TENTATIVAS = 5` com backoff (1, 2, 5, 15, 60 min), estado
   `falha_permanente`, e memória das fotos já enviadas (`fotos_enviadas`) para o
   reenvio não re-subir o que já está no Storage.
6. ✅ `frota-app.html`: fila em Config → Envio de registros, com estado por item
   ("aguardando", "nova tentativa em ~N min", "não foi aceito"), motivo da recusa e
   botões **Tentar de novo** / **Descartar** por item — antes a única saída era zerar
   a fila inteira, perdendo junto o que ainda ia sincronizar.
7. ✅ §3.2 **confirmado**, não era hipótese. A política de `INSERT` dos buckets aceita
   motorista ativo, mas a de `UPDATE` exige `pode_editar('frota')` — e `upsert` num
   caminho existente vira `UPDATE`. Verificado contra os motoristas reais: dos três
   ativos, **Gabriel Araújo Santiago** não é gestor e seria barrado; os outros dois
   também são gestores, e é por isso que o bug nunca apareceu em teste. Corrigido no
   cliente sem mexer em política: `upsert: false` + se o upload falhar, confere se o
   objeto já está lá e reaproveita a URL (o caminho é determinístico).
8. ✅ Extra não previsto: ação presa em `enviando` (app fechado no meio do envio) não
   aparecia como pendente nem como falha — sumia da fila e nunca mais era tentada.
   `fOfflineRecuperarEnviando()` devolve esses itens à fila no início de cada sync,
   o que só é seguro porque agora todas as RPCs são idempotentes.

*Verificação executada:* 12 asserções contra o banco de produção com dados fabricados
e `RAISE` final para forçar rollback (confirmado depois: 4 veículos e 25 viagens
intactos, nenhuma linha de teste). Cobriu o reenvio de check-out e de check-in
(idempotentes, sem erro e sem duplicar efeito), **os dois ramos do `CASE`** de status
do veículo — sem avaria → `disponivel`, com avaria → `em_manutencao` (lição da 181) —,
o cliente antigo sem `p_uuid_cliente` ainda sendo barrado corretamente, ausência de
overload duplicado e as permissões preservadas após o `DROP`.

*Versionamento:* `pwa/sw.js` — frota v45 → v46.

### Fase 3 — Privacidade das fotos — ⚠️ CÓDIGO PRONTO, FALTA APLICAR A 200

8. ✅ `js/frota-fotos.js` (novo): assina URLs de bucket privado. O render segue
   síncrono e só marca o elemento com `data-frota-foto`; depois do HTML na tela,
   `frotaAssinarFotos(container)` resolve tudo agrupando por bucket — uma chamada de
   rede por bucket, não por imagem. Mesmo padrão do `bIconsAplicar`.
9. ✅ 13 pontos de exibição convertidos, nas duas superfícies: detalhe do abastecimento
   e comunicados na mesa, comunicados no modo gestor do app, avatar do motorista na
   tela inicial, visualizador de foto em tela cheia, prévia da escala (app **e**
   `frota-solicitar.html`), fila da escala, listas de veículos e motoristas, e os dois
   previews de edição de `frota-veiculos.html`.
10. ✅ `199_frota_motoristas_fotos_escrita.sql` **aplicada**: as políticas de
    INSERT/UPDATE/DELETE do bucket `frota-motoristas` eram `auth.uid() IS NOT NULL` —
    qualquer usuário autenticado da plataforma podia sobrescrever ou apagar a foto de
    qualquer motorista. Agora exigem gestão do módulo ou a própria pasta.
11. ⏳ `200_frota_buckets_privados.sql` **criada mas NÃO aplicada** — ver abaixo.

**Por que a 200 não foi aplicada junto.** É a única migration do módulo incompatível
com o cliente anterior: ela derruba a URL pública, e quem exibe foto passa a precisar
do `frota-fotos.js`. Como este trabalho está numa branch, a produção ainda serve o
cliente antigo — aplicar agora deixaria **toda foto do módulo quebrada** até o merge.
A ordem correta é: merge + deploy do Vercel → só então aplicar a 200. Nessa ordem não
há janela de quebra, porque o cliente novo funciona nos dois mundos (`createSignedUrl`
vale igual em bucket público e privado, e há fallback para a URL crua).

Isso abre uma exceção consciente à regra "toda migration criada é aplicada na mesma
entrega" do `CLAUDE.md`. O motivo está no cabeçalho da própria 200, para quem for
aplicar não precisar reconstruir o raciocínio.

*Verificação executada:* o extrator de caminho foi testado contra **as 11 URLs reais
gravadas hoje no banco** (não só casos sintéticos), cobrindo o sufixo `?t=` do
cache-busting da foto do motorista e caminhos com escape de URL, e ignorando
corretamente `blob:` e `data:` (previews locais, que não devem ser assinados). As
políticas da 199 foram testadas com 5 asserções, incluindo uma **pré-condição
explícita** de que o sujeito do teste realmente não edita Frota — a primeira rodada
tinha passado por engano num usuário que já tinha a permissão, e 14 dos 67 usuários
ativos têm.

*Versionamento:* `pwa/sw.js` — frota v46 → v47, e `/js/frota-fotos.js` somado ao
`SHELLS.frota`.

*Nota:* `brigadistas`, `registros-campo`, `biomonitor-fotos` e `config-logos` têm o
aviso idêntico e seguem públicos — mesma classe, outros módulos, entrega separada.

### Fase 4 — Paridade e auditoria — ✅ CONCLUÍDA em 24/07/2026

9. ✅ Tela de acompanhamento portada para `frota-solicitar.html`: linha do tempo
   (solicitada → aprovada → em andamento → concluída) com carimbos, card de veículo e
   motorista com WhatsApp, links de mapa do GPS, avarias e "solicitar de novo". Linha
   da tabela virou clicável. Regra de duplicação cumprida.
10. ✅ Login do App Frota auditado: `verificar_bloqueio` antes,
    `registrar_tentativa_acesso` depois (com aviso de tentativas restantes e bloqueio
    de 30 min na 5ª), e `registrar_saida_acesso` no logout. O acesso por CPF do
    motorista era o caminho com menos proteção e sem rastro em `auditoria_acessos`.
11. ✅ Limitador de tentativas do PIN: contador persistido no IndexedDB (não some ao
    fechar o app), espera progressiva a partir da 3ª falha (5s → 10 min) e derrubada da
    sessão na 10ª — daí em diante só com senha. Zerado ao acertar, ao definir PIN novo,
    no "esqueci o PIN" e na troca de dono do aparelho.
12. ✅ `201_frota_motorista_viagem_vencida.sql`: guarda `frota_checar_motorista_livre`
    nas duas RPCs de aprovação + view `vw_frota_viagens_vencidas`. Painel de vencidas
    em `frota-viagens.html` e marcação de atraso na aba "Em andamento" do modo gestor
    do app (as duas superfícies).

**Sobre a regra do item 12.** O bloqueio é para viagem em andamento **já vencida**
(retorno previsto no passado), não para qualquer viagem em andamento. Enquanto a viagem
corre dentro do prazo, a constraint de exclusão já impede sobreposição; escalar hoje,
para o mês que vem, um motorista que está em viagem dentro do prazo é legítimo. O
bloqueio vale exatamente para o estado que a constraint não enxerga — e o teste 2 da
verificação confirma isso, checando que os períodos do caso testado de fato **não** se
sobrepõem, ou seja, a constraint sozinha não pegaria.

**Bug encontrado e corrigido de passagem** (`202_frota_viagens_detalhe_motorista_telefone.sql`):
a tela de acompanhamento do app (commit `f1151b4`) monta um link de WhatsApp a partir
de `v.motorista_telefone`, mas `vw_frota_viagens_detalhe` **nunca expôs essa coluna**.
O campo chegava `undefined`, a condicional era sempre falsa e o link nunca aparecia —
falha silenciosa, sem erro no console. Descoberto ao portar a tela para a mesa, onde a
mesma linha seria copiada com o mesmo defeito. A coluna foi adicionada no fim da view,
o que conserta as duas superfícies sem tocar em nenhuma delas.

*Verificação executada:* 5 asserções para a 201 (com dados fabricados e `RAISE` para
rollback) — bloqueio da escala com motorista atrasado, confirmação de que a constraint
sozinha não pegaria, ausência de bloqueio indevido para viagem dentro do prazo, a view
listando a viagem atrasada, e `anon` seguindo fechado. Mais 7 asserções de estado após
a 202. Sintaxe conferida nas três páginas alteradas e todos os símbolos novos
resolvidos.

*Versionamento:* `pwa/sw.js` — frota v47 → v48.

*Observação registrada:* `obterIP()` no `index.html` chama `api.ipify.org`, que não
está no `connect-src` do CSP (`vercel.json`) — a chamada é bloqueada e o IP chega nulo
na auditoria da plataforma inteira, silenciosamente (há `try/catch`). No App Frota o IP
vai nulo de propósito, sem pagar o custo da requisição. Corrigir o `index.html` (liberar
o domínio no CSP ou tirar a chamada) fica fora do escopo do módulo Frota.

### Fase 5 — Checklist de inspeção (a feature)

13. Migration: `frota_checklist_itens` (configurável por tipo de veículo) e
    `frota_inspecoes` (viagem, momento saída/chegada, item, conforme/não conforme, foto,
    observação).
14. App: etapa de checklist obrigatória antes do check-out e opcional no check-in; item
    não conforme gera automaticamente um comunicado de defeito no funil que já existe.
15. Mesa: aba de inspeções em `frota-administrar.html`, com o carve-out de
    `frame-ancestors 'self'` no `vercel.json` se virar página embutida.

### Fase 6 — Painel e documentos

16. Vencimento de documentos (CRLV, seguro, CNH) com alerta pelo módulo de notificação.
17. Custo por km/hora por veículo no `frota-dashboard.html`.
18. Atualizar o `CLAUDE.md` do Frota — idealmente a cada fase, não só no fim.

---

## 7. Recomendação de sequência

Fases 1 e 2 primeiro, e juntas: a primeira fecha superfície exposta a não autenticados, a
segunda tira do campo um bug que hoje deixa pendência presa para sempre no aparelho do
motorista. As duas são pequenas, verificáveis e não alteram o que o usuário vê.

A Fase 5 (checklist) é a que mais muda o valor do módulo — mas depende de uma fila offline
confiável, porque adiciona fotos e passos ao caminho crítico do check-out. Fazer antes da
Fase 2 seria construir sobre a trinca.
