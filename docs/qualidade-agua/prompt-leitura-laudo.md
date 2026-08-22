# Prompt — próxima missão (leitura do laudo + alertas comparativos)

Versão melhorada do pedido original ("ler o PDF do laboratório e preencher
automaticamente, com alertas comparativos"). Colar como primeira mensagem
da sessão. O levantamento já foi feito e está em
`docs/qualidade-agua/plano-leitura-laudo-e-alertas.md` — a sessão nova não
deve refazê-lo.

> **Antes de colar:** anexe (ou deixe no bucket) **3 a 5 laudos reais do
> QUILAB** e a **lista de limites de quantificação (LQ) por parâmetro**.
> Sem amostra real, a Entrega 2 não começa — ver §9.0 do plano. A Entrega 1
> (alertas) não depende disso e pode ser feita já.

---

Atue como arquiteto de software deste projeto, com a leitura de um
engenheiro sanitarista/ambiental sobre o dado. Missão: **leitura assistida
do laudo do laboratório e malha de alertas comparativos no lançamento**, no
módulo Qualidade da Água.

Leia primeiro `docs/qualidade-agua/plano-leitura-laudo-e-alertas.md` — é o
plano arquitetural desta missão, validado contra o código e contra o banco
de produção. Leia também a seção "Qualidade da Água" do `CLAUDE.md` e
`docs/qualidade-agua/plano-seguranca-dados.md` (escrita por RPC,
reautenticação e trilha, que esta missão não pode contornar). Não refaça o
levantamento: siga o plano, e se discordar de alguma decisão dele, diga por
quê **antes** de mudar.

## O que entregar (nesta ordem — a ordem é parte do requisito)

### Entrega 1 — alertas comparativos (não depende de PDF nenhum)

1. **`agua_avaliar_coleta(...)` no banco**, ao lado de
   `agua_valor_plausivel`: os seis tipos de alerta de §4.1 do plano
   (físico, faixa da série, atípico para o ponto, coerência interna, erro
   de unidade, prazo de análise), devolvendo lista de
   `{parametro, nivel, tipo, mensagem, referencia, base, n}`. Nenhum limiar
   novo em JavaScript — regra do projeto.
2. **`vw_agua_baseline_ponto`**: mediana + MAD por ponto × parâmetro ×
   ordem de campanha, com **degradação declarada** (ponto estratificado →
   ponto → rio/bacia → série), sempre dizendo qual base usou e com que `n`.
   Nada de média + desvio padrão (§4.2 explica).
3. **Contexto de campanha** (§4.4): atípico acompanhado pelos demais pontos
   da mesma campanha é rebaixado a informativo. Sem isso a primeira cheia
   dispara 17 alertas falsos.
4. **`js/agua-alertas.js`**: avaliador fino e ÚNICO, compartilhado pela
   mesa e pelo app (o app aplica os números cacheados no IndexedDB porque é
   offline-first — exceção documentada em §4.6). Ele **não** define
   limiar: só aplica e renderiza.
5. **Três telas na mesma entrega**: `agua-laudos.html`, `agua-app.html` e
   `agua-conferencia.html`.
6. **Violação CONAMA nunca é alerta de digitação** — bloco separado, como
   o painel já faz. Isso é requisito, não estilo.
7. **No app, alerta nunca bloqueia.** Na mesa, só `impossivel` bloqueia
   (comportamento de hoje, não regredir).

### Entrega 2 — leitura do PDF

8. **`pdf.js` vendorizado** em `js/vendor/` (o CDN está bloqueado pela
   política de rede; o registro npm funciona), carregado **sob demanda**.
9. **Template de laudo em TABELA** (`agua_laudo_templates`), versionado por
   laboratório — laboratório novo ou layout novo é INSERT, não deploy.
10. **Pipeline de §3.3**, com a etapa de **casamento de identidade** como
    trava dura: código da amostra / ponto / data do PDF divergindo da
    coleta aberta ⇒ **não preenche nada** e mostra o confronto.
11. **Conferência lado a lado** (valor atual · proposto · trecho literal do
    PDF · unidade lida · confiança), aceitar por campo ou aceitar todos os
    de alta confiança. **Nada entra no banco sem confirmação humana.**
12. **`<LQ` vira metade do LQ na coluna + o LQ em `censurados`** (decisão 3
    do plano original), automaticamente — hoje isso depende de o técnico
    lembrar da regra.
13. **`origem_dados jsonb`** por campo (parser / digitado / corrigido após
    parser, com template e versão). Recriar `vw_agua_coletas_detalhe`
    **enumerando colunas** (armadilha da migration 260).
14. **Modos de falha de §3.5 todos com saída manual e mensagem explícita** —
    especialmente PDF escaneado (sem camada de texto).

### Entrega 3

15. Cadastro de templates (aba em `agua-pontos.html`) e
    `agua_prazos_analise` (prazos de preservação em tabela).

## Decisões já tomadas (seguir, não reabrir)

- **Extração determinística, nunca por LLM.** O laudo é prova; um número
  plausível que não está no documento é o pior modo de falha possível aqui.
- **Extração no navegador**, não em Edge Function nem serviço externo: o
  arquivo não sobe antes da conferência e nada sai para fora.
- **Alertas antes do parser.** O parser preenche 16 campos de uma vez; sem
  a malha, é amplificador de erro.
- **Escrita continua só por `agua_atualizar_coleta`**, com reautenticação e
  trilha. O parser não abre caminho novo de escrita.
- **`agua_publico_*` não ganha nada disto** — whitelist de coluna é decisão
  explícita, nunca herdada.
- **OCR, segundo laboratório e a pendência dos sólidos em suspensão ficam
  fora** (§10). Não implemente e não peça a decisão de novo.

## Cuidados de projeto que já custaram caro antes

- `list_migrations` **antes** de numerar (a última aplicada é a 301 —
  conferir, não assumir pelo repositório).
- Assinatura de função mudou ⇒ **`DROP FUNCTION` antes**, nunca
  `CREATE OR REPLACE` (173/178/224/297/300).
- Função nova nasce com `SET search_path = public` e **`REVOKE EXECUTE ...
  FROM anon` explícito** (`REVOKE FROM PUBLIC` não fecha nada neste
  projeto).
- Migration criada é migration **aplicada** em produção na mesma entrega,
  seguida de `get_advisors` (security).
- `pwa/sw.js`: subir **só** `VERSOES.agua` (o app de campo é tocado; os
  outros três não).
- Guardas em `tests/agua-alertas.test.js` e `tests/agua-laudo-parser.test.js`,
  mais a **medição da taxa de disparo** sobre as 452 linhas de produção:
  mais de ~15% em `atipico` é limiar mal calibrado, não série ruim.

## Como validar antes de dizer que está pronto

- Fila `aguardando_lab` está **vazia** em produção — não dá para "abrir a
  tela e ver". Criar coleta de teste com dado sintético e apagá-la ao
  final (padrão da Fase 3), ou testar por fixture local.
- Para o parser: rodar contra os laudos reais e mostrar, campo a campo, o
  que casou e o que não casou. "Não lançou exceção" não é validação.
