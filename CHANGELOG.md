# Changelog — SIGUC-AC

## Fluxo de Pesquisa — correções, automação e QA

### Banco (migrations 023–028)
- Correção de bugs críticos (INSERT…SELECT), RLS endurecida, gate de
  inadimplência via trigger, numeração com sequências próprias.
- Automação: relatórios automáticos, verificação de prazos (pg_cron),
  envio de e-mail (pg_net + edge function drainer), anti-spam no portal.
- Hardening: PII reduzida em RPC pública, constraints de upload,
  search_path fixo nas funções SECURITY DEFINER.

### Edge functions
- `processar-pesquisa-emails` (drainer da fila), `pesquisa-email` (auth
  interna), `sisbio-sisgen` (CORS travado).

### QA automatizado (CI)
- `qa.yml`: guardrails, gitleaks, semgrep, **trivy**, Playwright smoke.
- `security-review.yml` + `claude-review.yml`: revisão por IA nos PRs
  (ativa com o secret `ANTHROPIC_API_KEY`).
- `scripts/guardrails.sh`, `tests/pesquisa-flow.test.js`, `docs/QA-AUTOMACAO.md`.
