# Frota — Cidade origem/destino + Escala de motorista da vez

> Prompt/especificação para implementação. Escrito antes de codar, com as
> decisões de produto já fechadas. Módulo Frota (Setor de Transporte).

## 1. Objetivo

Estruturar **cidade de origem** e **cidade de destino** na solicitação de
viagem e, com base nisso, oferecer à gestão uma **sugestão automática do
"motorista da vez"** sempre que a viagem for **intermunicipal** (destino ≠
origem). A sugestão é um apoio à decisão — o gestor pode aceitar ou trocar
o motorista livremente.

Motoristas **dedicados** (dono de veículo com `dedicado_setor=true`) **não
entram** na escala.

## 2. Decisões de produto (fechadas)

| Tema | Decisão |
|------|---------|
| **Gatilho da escala** | Viagem **intermunicipal**: `cidade_destino ≠ cidade_origem` (comparação normalizada). Não é "≠ Rio Branco" — origem é editável e uma viagem Sena Madureira → Cruzeiro do Sul também conta. |
| **Ordem da fila** | **LRU** (least recently used): sugere o motorista apto que está **há mais tempo sem fazer viagem intermunicipal**. Motorista que nunca fez vem primeiro (data nula = mais antigo). |
| **Avanço da vez** | A vez é consumida **na conclusão da viagem** (status `concluida`). Recusa/cancelamento **não** movem a fila. |
| **Entrada de cidade** | Combobox com os **22 municípios do Acre** (de `data/municipios_acre.geojson`) + **texto livre** para cidades de outros estados. Origem default = `Rio Branco`, editável. |
| **Natureza** | **Sugestão**, nunca imposição. Pré-seleciona o motorista no `<select>` de aprovação; gestor troca à vontade. |

## 3. Situação atual (para referência)

- **Solicitar viagem**: `pages/frota-solicitar.html` (mesa) ⇄
  `pages/frota-app.html` modo solicitante (`renderModoSolicitante`, ~L1585).
  Hoje só há um campo **Destino** de texto livre → `frota_viagens.destino`.
- **Aprovar viagem**: `pages/frota-viagens.html`
  (`abrirAprovar`/`confirmarAprovar`, L443/L534) ⇄ `pages/frota-app.html`
  modo gestor (`abrirAprovar`/`confirmarAprovar`, L1940/L2028). O gestor
  escolhe veículo + motorista em `<select>` populado por
  `carregarMotoristas()` / `optsMotoristas()`.
- **Motorista dedicado**: `frota_veiculos.dedicado_setor` (154) +
  `frota_veiculos.motorista_padrao_id` (163). Motorista a excluir da escala
  = quem é `motorista_padrao_id` de **algum** veículo com
  `dedicado_setor=true`.
- **Aptidão**: `frota_motorista_apto(id)` (154) — ativo, status `ativo`,
  CNH/habilitação fluvial não vencidas.
- **Status de viagem**: `solicitada | aprovada | recusada | em_andamento |
  concluida | cancelada`.

## 4. Banco — migration `187_frota_cidade_escala.sql`

### 4.1 Colunas novas em `frota_viagens`
```sql
ALTER TABLE frota_viagens
  ADD COLUMN IF NOT EXISTS cidade_origem  text NOT NULL DEFAULT 'Rio Branco',
  ADD COLUMN IF NOT EXISTS cidade_destino text;
```
- `cidade_destino` fica nullable na migration (linhas antigas), mas o
  **frontend passa a exigir** no fluxo novo. `destino` (texto livre do
  local específico: "Sede da UC", endereço) **continua existindo** — cidade
  é o município; destino é o ponto dentro dele. Os dois coexistem.
- Backfill opcional: linhas antigas ficam com `cidade_origem='Rio Branco'`
  e `cidade_destino=NULL` (não intermunicipal para efeito de escala).

### 4.2 Normalização para comparação
Função imutável para comparar cidades sem sofrer com acento/caixa/espaço
(ex.: "Rio Branco" == "rio branco " == "RIO BRANCO"):
```sql
CREATE OR REPLACE FUNCTION frota_norm_cidade(p text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT lower(btrim(unaccent(coalesce(p,''))))
$$;
```
- Requer extensão `unaccent`. Se ainda não instalada:
  `CREATE EXTENSION IF NOT EXISTS unaccent;` (checar antes; senão usar
  `translate()` para os acentos comuns do PT-BR e documentar).
- "É intermunicipal?" =
  `frota_norm_cidade(cidade_destino) <> frota_norm_cidade(cidade_origem)`
  **e** `cidade_destino IS NOT NULL`.

### 4.3 RPC de sugestão — `frota_sugerir_motorista_escala`
```sql
CREATE OR REPLACE FUNCTION frota_sugerir_motorista_escala(
  p_cidade_origem  text,
  p_cidade_destino text,
  p_inicio         timestamptz,
  p_fim            timestamptz
) RETURNS TABLE (
  motorista_id   uuid,
  nome           text,
  ultima_viagem  timestamptz,   -- última viagem intermunicipal concluída
  total_viagens  int,           -- nº de intermunicipais concluídas (desempate/UI)
  sugerido       boolean        -- true só na 1ª linha (o "da vez")
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH candidatos AS (
    SELECT m.id, m.nome
    FROM frota_motoristas m
    WHERE frota_motorista_apto(m.id)                       -- ativo + apto
      -- exclui dedicados: dono de veículo dedicado ao setor
      AND NOT EXISTS (
        SELECT 1 FROM frota_veiculos v
        WHERE v.motorista_padrao_id = m.id AND v.dedicado_setor AND v.ativo
      )
      -- exclui quem já está alocado no período (aprovada/em_andamento)
      AND NOT EXISTS (
        SELECT 1 FROM frota_viagens fv
        WHERE fv.motorista_id = m.id
          AND fv.status IN ('aprovada','em_andamento')
          AND tstzrange(fv.data_saida_prevista, fv.data_retorno_prevista, '[]')
              && tstzrange(p_inicio, p_fim, '[]')
      )
  ),
  hist AS (
    SELECT fv.motorista_id,
           max(fv.data_retorno_prevista) AS ultima_viagem,
           count(*)                      AS total_viagens
    FROM frota_viagens fv
    WHERE fv.status = 'concluida'
      AND fv.motorista_id IS NOT NULL
      AND fv.cidade_destino IS NOT NULL
      AND frota_norm_cidade(fv.cidade_destino) <> frota_norm_cidade(fv.cidade_origem)
    GROUP BY fv.motorista_id
  )
  SELECT c.id, c.nome, h.ultima_viagem, COALESCE(h.total_viagens,0),
         row_number() OVER (
           ORDER BY h.ultima_viagem ASC NULLS FIRST, c.nome
         ) = 1 AS sugerido
  FROM candidatos c
  LEFT JOIN hist h ON h.motorista_id = c.id
  ORDER BY h.ultima_viagem ASC NULLS FIRST, c.nome;
$$;

REVOKE ALL ON FUNCTION frota_sugerir_motorista_escala(text,text,timestamptz,timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION frota_sugerir_motorista_escala(text,text,timestamptz,timestamptz) TO authenticated;
```
Notas de desenho:
- **SECURITY DEFINER** (padrão das RPCs de frota) porque cruza tabelas com
  RLS; só quem pode aprovar usa, mas a RPC em si é chamável por autenticado
  (a tela de aprovação já é restrita por permissão).
- **LRU**: `ORDER BY ultima_viagem ASC NULLS FIRST` — nunca-viajou primeiro,
  depois quem viajou há mais tempo. `total_viagens` é só informativo/UI.
- Devolve a **lista inteira ordenada** (não só o 1º), para a UI mostrar a
  fila e permitir troca consciente; `sugerido=true` marca o da vez.
- **Não** grava nada nem trava a escolha — é consulta pura.

### 4.4 View de detalhe
Recriar `vw_frota_viagens_detalhe` (a partir da versão da **186**)
acrescentando `fv.*` já traz `cidade_origem`/`cidade_destino`. Só adicionar
um campo derivado se útil na mesa:
```sql
  (fv.cidade_destino IS NOT NULL
   AND frota_norm_cidade(fv.cidade_destino) <> frota_norm_cidade(fv.cidade_origem))
     AS intermunicipal,
```
> ⚠️ Como `fv.*` já expõe as colunas novas, **recriar a view é obrigatório**
> só se quisermos o campo `intermunicipal` calculado; senão o `SELECT fv.*`
> existente já passa a trazer as cidades automaticamente. Decidir na hora:
> se recriar, seguir o molde exato da 186 (security_invoker) e não perder
> nenhum campo já exposto (lição das migrations 178/181).

## 5. Frontend

### 5.1 Solicitação (par obrigatório mesa ⇄ app)
Nas DUAS superfícies, na **mesma entrega**:
- `pages/frota-solicitar.html`
- `pages/frota-app.html` → `renderModoSolicitante`

Adicionar:
- **Cidade de origem**: combobox (`<input list>` ou `<select>` + opção
  "Outra…") pré-preenchido `Rio Branco`, editável, lista = 22 municípios AC.
- **Cidade de destino**: mesmo combobox, **obrigatório**, sem default.
- Manter o campo **Destino** atual (ponto específico) como está, agora
  rotulado de forma que não confunda com cidade (ex.: "Local / ponto de
  destino"). Enviar `cidade_origem` e `cidade_destino` no `insert` de
  `frota_viagens` (e no payload do app).
- Fonte da lista: carregar nomes de `data/municipios_acre.geojson`
  (propriedade `nome`) ou embutir o array fixo dos 22 municípios num helper
  compartilhado (ex.: `MUNICIPIOS_AC` em `js/config.js` ou `js/frota-wise.js`)
  — preferir helper para os dois lados (mesa + app) usarem a mesma fonte.
- Aviso leve na tela: quando destino ≠ origem, informar que "a gestão
  receberá sugestão de motorista pela escala" (opcional, informativo).

### 5.2 Aprovação (par obrigatório mesa ⇄ app)
Nas DUAS superfícies, na **mesma entrega**:
- `pages/frota-viagens.html` → `abrirAprovar` (L443)
- `pages/frota-app.html` modo gestor → `abrirAprovar` (L1940)

Comportamento:
1. Ao abrir a aprovação de uma viagem **intermunicipal**, chamar
   `frota_sugerir_motorista_escala(cidade_origem, cidade_destino,
   data_saida_prevista, data_retorno_prevista)`.
2. **Pré-selecionar** no `<select>` de motorista (`optsMotoristas`) o
   `motorista_id` com `sugerido=true`.
3. Mostrar um selo/nota discreta: *"Sugestão da escala: {nome} — há mais
   tempo sem viagem intermunicipal"* (usar ícone SVG `bico(...)`, **nunca
   emoji**). Incluir link/afford "ver fila" que lista a ordem devolvida.
4. Gestor pode trocar o motorista à vontade — a sugestão nunca bloqueia.
5. Viagem **não** intermunicipal (destino == origem, ou sem cidade):
   comportamento atual, sem sugestão.
- Não alterar as RPCs `frota_aprovar_viagem` /
  `frota_aprovar_viagem_multipla` (186) — a escala é só sugestão de UI; o
  que é gravado continua sendo a escolha do gestor. Se no futuro quisermos
  travar/registrar que a sugestão foi seguida, aí sim mexe em RPC (fora do
  escopo desta entrega).

### 5.3 Exibição
- Mostrar cidade origem → destino na lista de viagens (mesa e "minhas
  solicitações"), ex.: `Rio Branco → Cruzeiro do Sul`.

## 6. Checklist de conclusão (regras do CLAUDE.md)

- [ ] Migration `187_frota_cidade_escala.sql` (RLS já herdada; RPC com
      REVOKE/GRANT; view só recriada se necessário, seguindo molde 186).
- [ ] Extensão `unaccent` garantida (ou fallback `translate`).
- [ ] **Par solicitar**: `frota-solicitar.html` **e** `frota-app.html`
      (`renderModoSolicitante`) — ambos tocados.
- [ ] **Par aprovar**: `frota-viagens.html` **e** `frota-app.html` (modo
      gestor) — ambos tocados.
- [ ] Ícones SVG (`bico`/`data-icon`), zero emoji.
- [ ] **Bump PWA**: `pwa/sw.js` → `VERSOES.frota` 29 → 30 (entrega toca
      arquivos web do app Frota). Mencionar no commit.
- [ ] Design system intocado (variáveis CSS).
- [ ] Commits em português, pequenos e descritivos.
- [ ] Testar: viagem intermunicipal (sugere e ordena por LRU), viagem
      intramunicipal (sem sugestão), motorista dedicado nunca aparece,
      motorista já alocado no período fica de fora, motorista nunca-viajou
      vem primeiro, conclusão de viagem move a fila.

## 6.1 Extensão — motorista da vez também para o SOLICITANTE (implementado)

Além da sugestão na aprovação, o **solicitante** já vê o motorista da vez
ao preencher a solicitação (mesa `frota-solicitar.html` ⇄ app
`frota-app.html` modo solicitante), como box informativo "a confirmar
pela gestão de frota". Quando a viagem precisa de **2+ veículos**
(passageiros não cabem em um), mostra **um motorista por veículo**.

Banco:
- **188_frota_escala_multivagas.sql**: `frota_sugerir_motorista_escala`
  ganha `p_passageiros smallint DEFAULT NULL`. Com passageiros, calcula
  quantos veículos a viagem exige (greedy por capacidade sobre
  `frota_veiculos_disponiveis`, dedicados fora) e marca `sugerido=true`
  nos **N primeiros** da fila LRU (N = veículos). Sem o parâmetro (chamada
  da aprovação simples) → N=1, comportamento anterior. DROP antes de
  recriar (assinatura muda, lição 178/181).
- **189_frota_escala_auth_guard.sql**: a função é SECURITY DEFINER e não
  checa permissão de módulo (o solicitante pode ter só 'visualizar'), mas
  toda função em `public` nasce executável por `anon` (default privileges
  do Supabase — `REVOKE FROM PUBLIC` não tira o grant do anon). Guarda:
  exige `auth.uid()` não nulo (bloqueia anon, libera qualquer logado).

Frontend:
- Solicitante: box `#preview-escala` + `atualizarPreviewEscala()`
  (debounce 400ms) disparado por cidade/datas/passageiros.
- Gestor (confirmação): em modo múltiplo, `preencherMotoristasEscala()`
  pré-preenche cada linha de alocação com o motorista da vez (um por
  veículo) — sugestão, o gestor confirma/troca antes de aprovar.

> Numeração: `188_frota_escala_multivagas` colide em número com um
> `188_frota_config_saldo` de outra branch ainda não mergeada (mesma
> situação dos 183/184 já duplicados no repo) — sem conflito de
> dependência. As 3 migrations já foram aplicadas em produção.

## 7. Pontos em aberto / decisões futuras (fora do escopo desta v1)

- Registrar/auditar se a sugestão foi seguida (hoje não grava nada).
- Escala por **tipo de veículo/habilitação** (ex.: embarcação exige arrais)
  — v1 usa `frota_motorista_apto` genérico; refinar depois se necessário.
- Janela temporal do histórico LRU (hoje = todo o histórico concluído).
- Considerar viagem **avulsa/direta** (`frota_abrir_viagem_direta`) no
  histórico da escala — v1 conta qualquer `concluida` intermunicipal com
  motorista, inclusive avulsa.
