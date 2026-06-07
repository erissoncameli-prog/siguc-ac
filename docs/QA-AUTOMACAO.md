# QA Automatizado — SIGUC-AC

Camadas de validação automática para não depender de teste manual a cada mudança.

## Camadas

| Camada | Ferramenta | Onde | Ativa? |
|--------|-----------|------|--------|
| **Inspeção de código (projeto)** | `scripts/guardrails.sh` | `qa.yml` job `guardrails` | ✅ já funciona |
| **Vazamento de segredos** | Gitleaks | `qa.yml` job `segredos` | ✅ já funciona |
| **SAST (OWASP/JS)** | Semgrep | `qa.yml` job `sast` | ✅ já funciona |
| **Deps / misconfig / segredos** | Trivy (`aquasecurity/trivy-action`) | `qa.yml` job `trivy` | ✅ report (exit-code 0; mude p/ 1 p/ travar) |
| **E2E read-only** | Playwright | `qa.yml` job `e2e` | ✅ contra `siguc-ac.vercel.app` |
| **Revisão de código por IA** | Claude Code Action | `claude-review.yml` | ⚙️ requer `ANTHROPIC_API_KEY` |
| **Revisão de SEGURANÇA por IA** | `anthropics/claude-code-security-review` | `security-review.yml` | ⚙️ requer `ANTHROPIC_API_KEY` |
| **Linter do banco** | Supabase advisors | sob demanda (MCP) / dashboard | ⚙️ manual/agendável |
| **E2E com escrita (fluxo completo)** | Playwright | `tests/pesquisa-flow.test.js` (bloco staging) | ⚙️ requer ambiente de STAGING |

## Como rodar localmente

```bash
bash scripts/guardrails.sh                      # inspeção estática
TEST_BASE_URL=https://siguc-ac.vercel.app \
  npx playwright test tests/                     # smoke + fluxo (read-only)
```

## Ativar as camadas que faltam (uma vez)

1. **Revisão por IA nos PRs** — adicione o secret `ANTHROPIC_API_KEY`
   em *Settings → Secrets and variables → Actions*. O `claude-review.yml`
   passa a comentar bugs/segurança em cada PR (e responde a `@claude`).

2. **E2E do fluxo completo (com escrita)** — crie um **projeto Supabase de
   staging** (cópia das migrations), publique o frontend apontando para ele,
   e rode com `TEST_ALLOW_WRITES=1 TEST_BASE_URL=<url-staging>`. Nunca rodar
   escrita contra produção (polui o banco).

3. **Advisors do banco** — rodar periodicamente o linter de segurança/
   performance do Supabase (RLS, índices). Pode ser via dashboard ou
   agendado.

## Por que esta divisão

- **Determinístico primeiro** (guardrails + gitleaks + semgrep + Playwright):
  rápido, repetível, barato, roda em todo push/PR — é a rede de segurança.
- **IA como segunda camada** (Claude): pega problemas de lógica/contexto que
  scanners não veem (ex.: gate de inadimplência ignorado, etapa errada do
  fluxo), mas não substitui os testes determinísticos.
- **Staging para escrita**: o fluxo de pesquisa grava dados; validar isso
  exige um ambiente isolado, não produção.
