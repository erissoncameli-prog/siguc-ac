# Prompt — próxima missão (segurança dos dados de Qualidade da Água)

Colar como primeira mensagem da sessão. Responder às 5 decisões do plano
ANTES de colar, ou o Claude vai perguntar (o que também está certo).

---

Atue como arquiteto de software deste projeto. Missão: **rastreabilidade e
controle de escrita no módulo Qualidade da Água**.

Leia primeiro `docs/qualidade-agua/plano-seguranca-dados.md` — é o plano
arquitetural desta missão, já validado contra o código e o banco de
produção. Leia também a seção "Qualidade da Água" do `CLAUDE.md`. Não
refaça o levantamento: siga o plano, e se discordar de alguma decisão dele,
diga por quê antes de mudar.

## O que entregar

1. **Trilha de auditoria no BANCO, por trigger** (`agua_auditoria`),
   cobrindo INSERT/UPDATE/DELETE das 4 tabelas do módulo. Data, hora,
   usuário (com snapshot de nome/e-mail/perfil), valor anterior, valor
   novo, campos alterados, justificativa, origem, IP. Trigger, nunca
   chamada da página — tem de valer para mesa, app, sync e psql.
2. **Leitura só para super_admin** (`is_super_admin()`, já existe), sem
   policy de UPDATE/DELETE — é registro de prova, como `lgpd_aceites`.
   Mais o encadeamento de hash e a RPC de verificação descritos no plano.
3. **UPDATE/DELETE por RPC**, com justificativa validada no banco (não só
   no JS) e prova de reautenticação por senha **verificada no servidor**.
   INSERT continua direto e sem senha — o app de campo é offline-first e
   nada pode quebrar isso.
4. **Exclusão lógica** com justificativa; expurgo físico só por
   super_admin, também auditado.
5. **`pages/agua-auditoria.html`** com diff antes→depois campo a campo, e
   link na sidebar visível só ao super_admin.
6. Migrar `agua-conferencia.html`, `agua-laudos.html` e `agua-pontos.html`
   para as RPCs.

## Restrições inegociáveis

- **Não replique o padrão de reautenticação atual do projeto**
  (`admin-brigadas.html:928`, `pesquisas.html:466`, `js/perfil.js:476`):
  ele valida a senha só no cliente e o banco nunca fica sabendo. A prova
  tem de chegar ao servidor. Use a opção A do plano se o claim `amr`
  existir no JWT deste projeto — **verifique isso em produção antes de
  escolher**, não presuma — e caia para a opção B (Edge Function + ticket)
  se não existir. A opção C (senha como parâmetro de RPC) só com o risco
  de log declarado por escrito.
- `pgcrypto` está no schema `extensions`: função com
  `SET search_path = public` **não enxerga `crypt`**. Qualifique.
- Pegue o número da migration com `list_migrations` **no banco de
  produção**, não pelo que está no repositório local.
- Toda função nova: `SET search_path = public` + `REVOKE EXECUTE FROM anon`
  pelo nome do papel. Função de trigger não executável pelo cliente.
  Se mudar a lista de parâmetros de uma RPC existente, `DROP FUNCTION`
  antes.
- Aplique as migrations em produção na mesma entrega e rode
  `get_advisors` (security) depois.
- A migration que **fecha a escrita direta** derruba cliente em cache:
  entregue-a com `_APLICAR_APOS_DEPLOY` no nome, como as 200/210/245.
- Entrada nova no ROPA (`lgpd_tratamentos`, TRAT-019) com prazo de
  retenção — a trilha guarda dado pessoal.
- `pwa/sw.js`: subir só `VERSOES.agua`.
- Guarda de teste: `tests/agua-auditoria.test.js`.

## Como trabalhar

Entregue por frentes, na ordem do plano (trilha → soft delete → RPCs →
reautenticação → telas → página de auditoria → ROPA → testes), commitando
e fazendo push a cada frente concluída. Não parta para a próxima frente com
a anterior meio pronta. Ao terminar, atualize `CLAUDE.md` (seção do módulo
Água) e a seção "Fase 6" do plano com o que foi entregue e o que ficou de
fora — inclusive as decisões que mudarem de rumo no meio do caminho.
