# Biomonitor — cálculos de ovos e filhotes (mapa de fontes e regra de atualização)

Este documento existe para UMA coisa: impedir que um cálculo novo sobre
ovos/filhotes entre numa tela do Biomonitor e não chegue às outras —
o mesmo problema encontrado e corrigido na migration `320_biomonitor_
unifica_ovos_filhotes.sql` (24/08/2026). Leia isto ANTES de mexer em
qualquer cálculo de postura, eclosão, descarte, predação ou berçário.

## O que foi corrigido nessa entrega (histórico, para contexto)

1. **Bug real, não só lacuna**: `vw_descartes_ovos` nunca expunha a
   coluna `causa` (existe em `descartes_ovos` desde a migration 123).
   `relatorios-biomonitor.html` já fazia
   `db.from('vw_descartes_ovos').select('motivo,causa,qtd')` — erro
   `42703` (coluna não existe), a chamada falhava inteira, e a seção
   "Descarte de ovos por causa" do relatório sempre voltava zerada,
   em silêncio (sem toast, sem erro visível). Corrigido: `causa`
   adicionada à view (ao FINAL da lista de colunas — `CREATE OR
   REPLACE VIEW` não aceita reordenar uma view existente, só
   acrescentar).
2. `bio_relatorio_completo` recalculava "ovos viáveis" com uma fórmula
   própria em vez de reusar `vw_ninho_ovos` (a view canônica desde a
   124) — unificado, e ganhou a quebra por causa fina (alagamento/
   erosão/humana) que só existia na view.
3. `bio_analise_detalhada.perdas` somava direto de `visitas_ninho`,
   ignorando descartes lançados fora da etapa "visita" — trocado para
   somar de `descartes_ovos.causa` (mesma base de `vw_ninho_ovos`).
4. `bio_analise_praias` contava "eclodidos" só por
   `status='eclodido'`, sem `em_bercario`/`soltado` — padronizado com
   o resto do sistema (regra desde a migration 146).
5. `bio_dados_aba` recalculava mortalidade de berçário na mão, sem o
   piso "nunca menor que o confirmado na soltura" que
   `vw_lotes_bercario_mortalidade` já garante — unificado para ler a
   view.
6. Campos que só existiam em `bio_analise_detalhada` (Análise
   Científica) e nunca chegavam a `bio_relatorio_completo` (relatório
   web + PDFs): `taxa_mortalidade_embrionaria_pct`, descartes por
   etapa, ninhos destruídos por causa, predação por fase. E
   `total_filhotes_vivos_liquido`, que o backend já calculava desde a
   133/150 mas nenhuma tela mostrava — agora exibido no relatório web.
7. `vw_ninhos_validacao` (fonte do PDF por ninho e da tela de
   validação) ganhou as mesmas 3 taxas científicas
   (`taxa_eclosao_pct`/`taxa_fertilidade_pct`/`eficiencia_ninho_pct`)
   calculadas por ninho individual, e a quebra fina de perda
   (`ovos_perda_alagamento`/`ovos_perda_erosao`/`ovos_perda_humana`).

## As 4 fontes de dado — nunca confundir

| Fonte (tabela) | O que registra | View/RPC que agrega |
|---|---|---|
| `ninhos_quelonios` | postura, íntegros, descartados (contagem bruta) | `vw_ninhos_validacao`, `bio_relatorio_completo` |
| `eclosoes_ninho` | filhotes vivos/mortos, ovos não nascidos, predação na eclosão | idem |
| `descartes_ovos` (+ `visitas_ninho`, que alimenta `descartes_ovos` por trigger) | perda de ovos por causa fina (`causa`: predacao/alagamento/erosao/humana) e por etapa (`etapa`: registro/visita/eclosao) | `vw_ninho_ovos` **(canônica)**, `vw_descartes_ovos` (consulta direta do cliente) |
| `filhotes_bercario` (indivíduo) / `ocorrencias_bercario` (lote agregado) / `solturas_filhotes.mortalidade` (legado) | mortalidade e biometria em berçário | `vw_lotes_bercario_mortalidade` **(canônica)**, `vw_filhotes_bercario`, `vw_bercarios_resumo` |

**Regra: "ovos viáveis/perdidos" só tem UMA fórmula, em `vw_ninho_ovos`
(migration 124)**:
```
viaveis = postura − Σ descartes_ovos.qtd (qualquer etapa)
```
Qualquer RPC/view que precise desse número faz `LEFT JOIN vw_ninho_ovos`
— nunca refaz a soma. Isso é o que a migration 320 corrigiu em
`bio_relatorio_completo` (que tinha uma segunda implementação da mesma
conta).

**Regra: "mortalidade em berçário" só tem UMA fórmula, em
`vw_lotes_bercario_mortalidade` (migration 133)**: individual
(`filhotes_bercario.status='morto'`) se o lote tem filhotes rastreados,
senão `ocorrencias_bercario` agregada, nunca abaixo do que já foi
confirmado em `solturas_filhotes.mortalidade`. Qualquer RPC que precise
desse número faz `JOIN vw_lotes_bercario_mortalidade` — nunca soma
`filhotes_bercario`/`ocorrencias_bercario` na mão.

## Onde cada cálculo deve aparecer (checklist de "todas as telas")

Cálculo relacionado a ovos/filhotes tem, no mínimo, estas superfícies —
**ao adicionar um cálculo novo, marque explicitamente quais destas
foram tocadas antes de considerar a tarefa concluída**:

- [ ] **App de campo** (`pages/biomonitor.html` → `js/biomonitor-quelonios.js`,
  RPC `bio_dados_aba`) — o que o monitor vê na aba Dados.
- [ ] **Mesa/admin** (`pages/admin-biomonitor.html`, view
  `vw_praias_biomonitor`) — dashboard por praia.
- [ ] **Relatório web** (`pages/relatorios-biomonitor.html`, RPC
  `bio_relatorio_completo`) — é o relatório "oficial" da mesa, com
  filtro completo (temporada/programa/UC/praia/localização).
- [ ] **PDF por ninho** (`js/biomonitor-relatorio-ninho.js`, lido de
  `vw_ninhos_validacao`) — ficha individual, usada também pela ficha
  de campo resumida (`js/biomonitor-relatorio-campo.js`) e pela tela
  de validação (`pages/biomonitor-validacao.html`).
- [ ] **Análise Científica** (`pages/analise-cientifica-biomonitor.html`
  → `js/biomonitor-analise.js`/`biomonitor-analise-comparativa.js`, RPCs
  `bio_analise_cientifica`/`bio_analise_detalhada`/`bio_analise_praias`)
  — a mais granular; historicamente ganha os cálculos NOVOS primeiro
  e demora a chegar às outras — foi exatamente essa demora que gerou
  o problema corrigido nesta entrega.
- [ ] **Tela de Berçários** (`pages/biomonitor-bercarios.html`) — só se
  o cálculo for específico de mortalidade/biometria em berçário.

Um cálculo que nasce só na Análise Científica (a mais fácil de estender,
por ser a mais recente e a mais lida por completo) é o padrão de falha
mais comum aqui — ela tende a "puxar na frente" e as outras telas ficam
para trás. Ao adicionar algo lá, pare e pergunte: isso também deveria
estar no relatório oficial (`bio_relatorio_completo`) e no PDF por
ninho? Normalmente sim.

## Regra permanente

1. **Nunca reimplementar uma fórmula de ovos/filhotes numa RPC ou view
   nova.** Se a conta já existe em `vw_ninho_ovos` (viáveis/perdas) ou
   `vw_lotes_bercario_mortalidade` (mortalidade em berçário), faça
   `JOIN`. Se a conta é nova, crie-a UMA vez (view ou função SQL) e
   reuse — nunca em JavaScript, nunca copiada em duas RPCs.
2. **Toda RPC que devolve JSON com campos de ovos/filhotes usa o MESMO
   nome de chave em todas as RPCs** (ex.: `taxa_eclosao_pct`,
   `total_ovos_viaveis`) — divergência de nome entre `bio_dados_aba` e
   `bio_relatorio_completo` já causou confusão (ver D6 no diagnóstico
   original desta entrega, no histórico do chat).
3. **Ao criar uma coluna nova numa view existente
   (`vw_ninhos_validacao`, `vw_descartes_ovos`, `vw_ninho_ovos`), ela
   entra SEMPRE ao final da lista de colunas.** `CREATE OR REPLACE
   VIEW` rejeita com erro `42P16` qualquer tentativa de inserir uma
   coluna no meio ou reordenar — mesma lição já documentada no
   CLAUDE.md para `DROP FUNCTION` antes de mudar assinatura de RPC.
4. **Ao adicionar um cálculo em `bio_analise_detalhada` (Análise
   Científica), pergunte explicitamente se `bio_relatorio_completo`
   (relatório oficial) e `vw_ninhos_validacao`/PDF por ninho também
   precisam dele.** Não é automático — mas é o ponto onde esta
   entrega encontrou a maior divergência.
5. **Testar a query do cliente contra o schema real antes de assumir
   que "existe".** O bug do item 1 (coluna `causa` ausente da view)
   só foi encontrado rodando a query de verdade contra produção
   (`SELECT causa FROM vw_descartes_ovos` → erro), não lendo o código.
   Uma chamada Supabase que falha (`.select()` com coluna inexistente)
   não lança exceção JS visível — só devolve `data: null, error: {...}`
   e, se o código não checa `error` explicitamente (como não checava
   aqui), o card/seção fica silenciosamente vazio.
6. **Nova migration que mexa em `descartes_ovos`, `eclosoes_ninho`,
   `ninhos_quelonios` (campos de ovos), `filhotes_bercario` ou
   `ocorrencias_bercario`**: releia a checklist acima antes de aplicar
   — é sinal de que um cálculo de ovos/filhotes está mudando e as
   superfícies precisam ser revisadas juntas.
