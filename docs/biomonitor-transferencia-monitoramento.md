# BioMonitor — Transferência inteligente e monitoramento de eclosão

Análise arquitetural e plano de implementação do módulo de transferência de
ninhos e monitoramento de eclosão dos quelônios (Podocnemis e afins).

> Documento exigido pela seção 6 da proposta ("Análise arquitetural antes da
> implementação"). Escrito **antes** do código. Serve de referência para as
> migrations 117–119 e para as alterações em `js/biomonitor-quelonios.js` e
> `pages/biomonitor.html`.

---

## 0. Ponto de partida — o que já existe

O módulo Quelônios é maduro. Boa parte do "backbone" pedido na proposta já
está implementado e **não deve ser reconstruído**:

| Recurso já existente | Onde |
|---|---|
| Transferência **entre praias** (origem × praia_atual) | mig. 080 |
| Janela crítica de translocação (semáforo desova→reenterro) | mig. 081, `bioCalcularJanelaHoras` |
| `numero_atual` (placa na praia de destino) | mig. 092 |
| Numeração por temporada+ano `proximo_numero_ninho()` | mig. 096 |
| Catálogo editável de espécies `especies_quelonio_catalogo` | mig. 110 |
| Temporada como âncora de ciclo (congela anterior) | mig. 096 |
| Estatísticas por praia `vw_praias_biomonitor` | mig. 074/080 |
| KPIs da aba Dados / relatório `bio_dados_aba`, `bio_relatorio_completo` | mig. 090/091 |
| Visitas de incubação (status, alagamento, predação de ovos) | mig. 086/105 |
| Eclosão (`eclosoes_ninho`), berçário, soltura | mig. 074/088/109 |

### Lacunas reais que esta entrega cobre

1. **Transferência**: hoje o app sugere o próximo número livre no destino,
   porém **não lista os ninhos ocupados** da praia de destino, **não mostra o
   intervalo** de numeração, **não tem busca** por número e **não bloqueia**
   gravar um número já ocupado (`bioSalvarTransf` só valida a quantidade de
   ovos). Risco atual: dois ninhos com a mesma placa física no berçário.
2. **Previsão de eclosão por espécie**: não existe. Não há período de
   incubação parametrizável por espécie, nem data prevista, dias restantes,
   faixa de risco ou situação armazenada. Só existe a incubação **real**
   (calculada a posteriori a partir da data de nascimento).
3. **Painel de monitoramento de eclosão**: os cálculos de previsão não
   alimentam nenhum painel (próximos, hoje, atrasados, previsto × real).
4. **Dashboard por praia com filtros**: `vw_praias_biomonitor` traz totais,
   mas não há um cartão por praia filtrável por temporada/espécie/comunidade/
   UC/município/período nem os indicadores de inundado/predado/falha.
5. **Validações inteligentes** na transferência (destino existe, número livre,
   temporada consistente, espécie compatível, sem duplicidade).

---

## 1. Fluxograma — processo de transferência (alvo)

```
[Ninho encontrado/transferido]
        │  usuário toca "+ Transferência"
        ▼
[Form de transferência]
        │  seleciona PRAIA DE DESTINO
        ▼
┌───────────────────────────────────────────────────────────┐
│ CONSULTA bio_ninhos_ocupados(destino, temporada, espécie)  │  (SECURITY DEFINER)
│  → ocupados[], intervalo{min,max}, proximo_livre           │
└───────────────────────────────────────────────────────────┘
        ▼
[Painel de ocupação do destino]
  • lista de ninhos já ocupados (número + espécie + status)
  • intervalo de numeração usado (ex.: 001–042)
  • próximo número livre sugerido (pré-preenchido)
  • busca por número específico
        │
        ▼
[Usuário confirma/edita o Nº do ninho no destino]
        │
        ▼
┌──────────── VALIDAÇÕES (client + DB) ─────────────┐
│ destino existe?                       (client+DB) │
│ número livre no destino/temporada?    (client+DB) │──não──► ALERTA + sugere próximo livre
│ temporada ativa e consistente?        (client+DB) │        (aceitar com 1 clique)
│ espécie compatível (catálogo ativo)?  (client)    │
│ ovos ≤ íntegros do ninho?             (client+DB) │
│ janela crítica (semáforo)?            (client)    │
│ sem duplicidade (uuid idempotente)?   (DB)        │
└───────────────────────────────────────────────────┘
        │ tudo ok
        ▼
[Grava transferência offline] ──sync──► [transferencias_ninho]
        │                                        │ trigger AFTER INSERT
        ▼                                        ▼
[ninho: status=transferido,           [guard duplicidade numero_atual
 praia_atual_id=destino,               no destino/temporada — BEFORE INSERT]
 numero_atual=nº informado]                     │ conflito → EXCEPTION
        │                                        ▼
        ▼                              [recalcula previsão de eclosão
[recalcula previsão (trigger)]          se a base de cálculo mudou]
```

---

## 2. Modelagem — entidades e mudanças

### 2.1 `especies_quelonio_catalogo` (mig. 117) — período de incubação

Tabela de parâmetros por espécie, já editável por biólogo/gestor. Adicionar:

| coluna | tipo | uso |
|---|---|---|
| `incubacao_dias_min` | smallint | limite inferior da faixa |
| `incubacao_dias_media` | smallint | base do cálculo da data prevista |
| `incubacao_dias_max` | smallint | limite superior / início do "atrasado" |

Seed com valores de literatura (Podocnemis, condições amazônicas):

| espécie | min | média | max |
|---|---|---|---|
| Tracajá (P. unifilis) | 60 | 68 | 75 |
| Tartaruga-da-amazônia (P. expansa) | 45 | 55 | 65 |
| Cabeçudo/Iaçá (P. sextuberculata) | 45 | 52 | 60 |
| Pitiú (P. erythrocephala) | 60 | 70 | 80 |
| Cupido (P. cayennensis) | 60 | 68 | 75 |
| Muçuã (K. scorpioides) | 120 | 135 | 160 |
| Jabuti-pé-de-elefante | 120 | 140 | 160 |
| Jabuti-piranga | 120 | 140 | 160 |
| Outro | 55 | 65 | 75 (fallback) |

> Valores parametrizáveis — o biólogo ajusta em `admin` sem migration. O
> cálculo usa o catálogo em tempo de gravação; `outro`/sem parâmetro cai no
> default de 65 dias, registrado como estimativa genérica.

### 2.2 `ninhos_quelonios` (mig. 117) — previsão **armazenada**

| coluna | tipo | uso |
|---|---|---|
| `data_prevista_eclosao` | date | `data_encontro + incubacao_dias_previstos` |
| `incubacao_dias_previstos` | smallint | copiado do catálogo no momento do cálculo |

- **Data de postura = `data_encontro`** (o app registra a desova no dia do
  achado). A `hora_desova` refina a janela crítica, não a previsão.
- `data_prevista_eclosao` e `incubacao_dias_previstos` são **armazenados** para
  permitir consulta histórica e análise previsto × real, exatamente como pede
  a proposta ("essas informações deverão ser armazenadas").
- **Dias restantes** e **faixa de risco** são derivados de `CURRENT_DATE` — não
  se armazenam (mudam todo dia); ficam na view `vw_ninhos_previsao_eclosao`.

**Recálculo** (trigger `BEFORE INSERT OR UPDATE OF especie, data_encontro`):
sempre que a data de postura ou a espécie mudar, `data_prevista_eclosao` e
`incubacao_dias_previstos` são recomputados. A transferência **não** muda a
base de cálculo (mesma desova, mesma espécie), então não altera a previsão —
correto biologicamente.

### 2.3 Faixa de risco (derivada em view)

Referência = dias até `data_prevista_eclosao` a partir de hoje, para ninhos
ainda **não** eclodidos/soltos/perdidos:

| faixa | regra |
|---|---|
| `normal` | faltam > 7 dias |
| `atencao` | faltam entre 0 e 7 dias (janela de eclosão próxima) |
| `hoje` | data prevista = hoje |
| `atrasado` | passou de `data_encontro + incubacao_dias_max` sem eclosão |

`situacao` textual: "Faltam N dias", "Prevista para hoje", "Atrasada há N dias".

### 2.4 Impacto em views/RPCs existentes

- `vw_ninhos_validacao` — adicionar `data_prevista_eclosao`,
  `incubacao_dias_previstos`, `dias_para_eclosao`, `faixa_risco`.
- `bio_dados_aba` / `bio_relatorio_completo` — já calculam incubação **real**;
  passam a expor também previsto × real (agregado por espécie).
- `vw_praias_biomonitor` — não é alterada destrutivamente; o dashboard novo
  usa uma RPC dedicada (`bio_dashboard_praias`) para suportar filtros.

Nenhuma coluna é removida. Tudo aditivo.

---

## 3. Índices novos

- `ninhos_quelonios (praia_atual_id, temporada_id, numero_atual)` — já existe
  parcialmente (`idx_ninhos_numero_atual` em `(praia_atual_id, numero_atual)`);
  ampliar para incluir `temporada_id` acelera `bio_ninhos_ocupados` e o guard.
- `ninhos_quelonios (data_prevista_eclosao)` parcial `WHERE status IN
  ('encontrado','transferido')` — acelera o painel de eclosão (próximos/hoje/
  atrasados varrem só ninhos em incubação).

---

## 4. Regras de negócio

1. Um número (`numero_atual`) é único por **praia atual + temporada** entre
   ninhos ativos (não eclodidos/soltos/perdidos). É o invariante que impede
   duas placas iguais no mesmo berçário no mesmo ciclo.
2. A placa de **origem** (`numero_ninho`) é imutável — identidade do ninho.
3. Transferência muda `praia_atual_id` e `numero_atual`; **não** muda a
   previsão de eclosão (mesma desova/espécie).
4. Não se transfere mais ovos do que os íntegros encontrados (já existe).
5. Previsão sempre recalculada ao mudar espécie ou data de postura.
6. Espécie compatível = espécie ativa no catálogo. Espécie inativa/fora de
   distribuição (ex.: cupido no Acre) gera aviso, não bloqueio rígido, porque
   dados históricos podem existir.
7. Temporada consistente = a temporada do ninho está `em_andamento`/`atual`;
   temporada congelada não recebe transferência (já garantido pelo guard de
   ninhos; estendido à transferência).

---

## 5. Validações inteligentes (seção 5 da proposta)

| validação | camada | ação em falha |
|---|---|---|
| destino existe | client + RLS | bloqueia, pede seleção |
| número livre no destino | client (`bio_ninhos_ocupados`) + trigger DB | bloqueia + sugere próximo livre (1 clique) |
| temporada consistente | client + guard DB | bloqueia com mensagem |
| espécie compatível | client (catálogo ativo) | aviso |
| integridade do monitoramento (ovos ≤ íntegros) | client + CHECK | bloqueia |
| duplicidade (idempotência) | `uuid_cliente UNIQUE` | ignora reenvio |

Sempre que possível a correção é **sugerida** (próximo número livre com
aceite em 1 clique), não apenas apontada.

---

## 6. Casos de uso

- **UC-1** Transferir ninho para berçário com numeração própria → app sugere o
  próximo número livre do berçário na temporada; monitor confere placa física.
- **UC-2** Monitor digita número já ocupado → bloqueio + alerta + botão "usar
  próximo livre (NNN)".
- **UC-3** Biólogo ajusta incubação média do tracajá de 68 → 70 dias → novas
  posturas passam a prever com 70; históricas mantêm o previsto gravado.
- **UC-4** Gestor abre painel de eclosão → vê ninhos previstos para hoje, os
  próximos 7 dias e os atrasados, por praia/temporada.
- **UC-5** Análise científica → compara incubação prevista × real por espécie.

## 7. Cenários de erro

- Offline ao selecionar destino: `bio_ninhos_ocupados` cai para o cálculo
  local (IndexedDB) — mesma lógica de `bioGerarNumeroNinho`. Ocupação de
  praias de **outros grupos** só aparece online (RLS local não tem esses
  ninhos); nesse caso o app avisa "lista parcial (offline)".
- Duas transferências offline concorrentes para o mesmo número → o guard DB
  rejeita a segunda no sync; o app mostra o erro e reabre com o próximo livre.
- Espécie sem parâmetro de incubação → usa default e marca a previsão como
  estimada.
- Data de postura futura/impossível → previsão calculada mesmo assim, mas a
  faixa de risco sinaliza inconsistência (dias negativos).

## 8. Impacto em dashboards e relatórios

- Novo RPC `bio_dashboard_praias(filtros)` → cartões por praia com: total,
  ativos, transferidos, eclodidos, perdidos, predados (visita/eclosão),
  inundados (visita alagado), falha de eclosão (eclodido com 0 vivos),
  próximos da eclosão, % sucesso, filhotes produzidos, ovos monitorados.
  Filtros: temporada, espécie, praia, comunidade, UC, município, período.
- Novo RPC `bio_monitoramento_eclosao(temporada)` → contadores e listas de
  próximos/hoje/atrasados, taxa de sucesso e incubação real por espécie,
  previsto × real.
- `bio_dados_aba`/`bio_relatorio_completo` mantêm-se; ganham o previsto × real.

## 9. Estratégia de migração de dados

- **Aditiva**. Nenhuma tabela recriada, nenhum dado apagado.
- Backfill de `especies_quelonio_catalogo` com faixas de incubação (UPDATE por
  código).
- Backfill de `ninhos_quelonios.incubacao_dias_previstos` /
  `data_prevista_eclosao` para ninhos existentes via a função de cálculo.
- Ninhos já transferidos com `numero_atual` duplicado no destino (herdados de
  antes da feature) **não** são renumerados em massa (a placa é decisão de
  campo); o guard de duplicidade só vale para **novas** transferências
  (`NOT VALID` semântico: valida o futuro, tolera o legado). Um relatório de
  conflitos existentes fica disponível via `bio_ninhos_ocupados`.

## 10. Testes (regressão)

Playwright + verificação de SQL:

1. `bio_ninhos_ocupados` retorna ocupados/intervalo/próximo corretos numa
   praia com ninhos 001,002,004 → próximo = 003? (política: menor livre) —
   **decisão**: sugerir `max+1` (005) para bater com placas físicas
   sequenciais, mas a busca permite achar o "buraco" 003. Documentado.
3. Transferir para número ocupado → bloqueio + sugestão.
4. Mudar espécie/data recalcula `data_prevista_eclosao`.
5. Ninho eclodido sai dos "próximos/atrasados".
6. Dashboard respeita filtros (temporada/espécie/UC).
7. Fluxo offline: cálculo local do próximo número quando sem sinal.
8. Idempotência: reenviar a mesma transferência (mesmo `uuid_cliente`) não
   duplica.

---

## 11. Entregáveis desta iteração

- `supabase/migrations/117_especies_incubacao_previsao.sql`
- `supabase/migrations/118_bio_monitoramento_eclosao.sql`
- `supabase/migrations/119_transferencia_integridade.sql`
- `js/biomonitor-quelonios.js` — ocupação do destino, bloqueio de duplicidade
  com sugestão de 1 clique, exibição de previsão nos cards, painel de eclosão.
- `pages/biomonitor.html` — painel de ocupação no form de transferência e
  bloco de previsão.
- `pwa/sw.js` — incremento do cache.
