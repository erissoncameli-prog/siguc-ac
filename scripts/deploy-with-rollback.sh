#!/usr/bin/env bash
# ── SIGUC-AC · Deploy com Rollback Automático (Regra 10) ─────────
set -euo pipefail

HEALTH_URL="${HEALTH_URL:-https://siguc-ac.vercel.app/api/health}"
LIVE_URL="${LIVE_URL:-https://siguc-ac.vercel.app/api/health/live}"
MAX_RETRIES=10
RETRY_INTERVAL=10
SMOKE_TIMEOUT=30

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
log()  { echo -e "${GREEN}[DEPLOY]${NC} $*"; }
warn() { echo -e "${YELLOW}[WARN]${NC}  $*"; }
err()  { echo -e "${RED}[ERROR]${NC} $*"; }

# 1. Salvar deployment atual para rollback
log "Capturando deployment atual para rollback..."
PREVIOUS_DEPLOYMENT=$(vercel ls --limit 2 --json 2>/dev/null | \
  python3 -c "import sys,json; d=json.load(sys.stdin); print(d[1]['uid'] if len(d)>1 else '')" 2>/dev/null || echo "")

if [ -z "$PREVIOUS_DEPLOYMENT" ]; then
  warn "Não foi possível capturar deployment anterior. Rollback manual será necessário em caso de falha."
fi

# 2. Deploy nova versão
log "Iniciando deploy para Vercel..."
DEPLOY_OUTPUT=$(vercel deploy --prod 2>&1)
DEPLOY_URL=$(echo "$DEPLOY_OUTPUT" | grep -oE 'https://[^ ]+\.vercel\.app' | tail -1)

if [ -z "$DEPLOY_URL" ]; then
  err "Deploy falhou — sem URL de deployment."
  exit 1
fi
log "Deploy concluído: $DEPLOY_URL"

# 3. Aguardar health check passar
log "Aguardando health check... (máx ${MAX_RETRIES} tentativas)"
ATTEMPT=0
while [ $ATTEMPT -lt $MAX_RETRIES ]; do
  ATTEMPT=$((ATTEMPT + 1))
  HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "$HEALTH_URL" || echo "000")

  if [ "$HTTP_STATUS" = "200" ] || [ "$HTTP_STATUS" = "207" ]; then
    log "Health check OK (HTTP $HTTP_STATUS) — tentativa $ATTEMPT"
    break
  fi

  warn "Health check retornou HTTP $HTTP_STATUS — tentativa $ATTEMPT/$MAX_RETRIES"
  if [ $ATTEMPT -eq $MAX_RETRIES ]; then
    err "Health check falhou após $MAX_RETRIES tentativas."
    _rollback
    exit 1
  fi
  sleep $RETRY_INTERVAL
done

# 4. Smoke tests
log "Rodando smoke tests..."
SMOKE_OK=true

_smoke_get() {
  local url="$1" expected="$2"
  local status
  status=$(curl -s -o /dev/null -w "%{http_code}" --max-time "$SMOKE_TIMEOUT" "$url" || echo "000")
  if [ "$status" != "$expected" ]; then
    err "Smoke test falhou: GET $url — esperado $expected, obtido $status"
    SMOKE_OK=false
  else
    log "  ✓ GET $url → $status"
  fi
}

_smoke_get "$LIVE_URL"   "200"
_smoke_get "$HEALTH_URL" "200"
_smoke_get "${DEPLOY_URL}/index.html" "200"

if [ "$SMOKE_OK" != "true" ]; then
  err "Smoke tests falharam."
  _rollback
  exit 1
fi

log "Todos os smoke tests passaram. Deploy concluído com sucesso! 🎉"

# ── Rollback ──────────────────────────────────────────────────────
_rollback() {
  err "Iniciando rollback..."
  if [ -n "$PREVIOUS_DEPLOYMENT" ]; then
    vercel alias set "$PREVIOUS_DEPLOYMENT" siguc-ac.vercel.app || \
      err "Rollback automático falhou — reverta manualmente para: $PREVIOUS_DEPLOYMENT"
    log "Rollback concluído para: $PREVIOUS_DEPLOYMENT"
  else
    err "Sem deployment anterior registrado. Rollback manual necessário."
  fi

  # Notificar via webhook se configurado
  if [ -n "${ALERT_WEBHOOK_URL:-}" ]; then
    curl -s -X POST "$ALERT_WEBHOOK_URL" \
      -H 'Content-Type: application/json' \
      -d "{\"text\":\"🚨 [SIGUC-AC] Deploy falhou. Rollback executado para $PREVIOUS_DEPLOYMENT\"}" \
      || true
  fi
}
