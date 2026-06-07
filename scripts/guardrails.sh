#!/usr/bin/env bash
# ── SIGUC-AC · Guardrails estáticos ──────────────────────────────
# Inspeção rápida de código em busca de erros e falhas de segurança
# comuns neste projeto. Roda na CI (workflow qa.yml) e localmente:
#   bash scripts/guardrails.sh
#
# Falha (exit 1) apenas em violações CRÍTICAS (ex.: vazamento de chave
# de serviço no frontend). O resto é reportado como AVISO.

set -uo pipefail
cd "$(dirname "$0")/.."

vermelho() { printf '\033[31m%s\033[0m\n' "$1"; }
amarelo()  { printf '\033[33m%s\033[0m\n' "$1"; }
verde()    { printf '\033[32m%s\033[0m\n' "$1"; }

FALHAS=0
AVISOS=0

echo "── Guardrails SIGUC-AC ───────────────────────────────"

# 1. CRÍTICO: chave de SERVICE ROLE no frontend (a chave anon é pública/ok).
# Detecta o formato novo (sb_secret_) e JWTs cujo payload contenha service_role.
LEAK=0
if grep -rnoE "sb_secret_[A-Za-z0-9]+" js/ pages/ index.html 2>/dev/null; then LEAK=1; fi
while IFS= read -r jwt; do
  [ -z "$jwt" ] && continue
  payload="${jwt#*.}"; payload="${payload%%.*}"
  pad=$(( (4 - ${#payload} % 4) % 4 ))
  b64="${payload}$(printf '%*s' "$pad" '' | tr ' ' '=')"
  dec=$(printf '%s' "$b64" | tr '_-' '/+' | base64 -d 2>/dev/null)
  if printf '%s' "$dec" | grep -q "service_role"; then
    vermelho "  JWT com role=service_role embutido no frontend!"; LEAK=1
  fi
done < <(grep -rhoE "eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+" js/ pages/ index.html 2>/dev/null | sort -u)
if [ "$LEAK" -ne 0 ]; then
  vermelho "✗ CRÍTICO: chave de serviço (service_role) exposta no frontend."
  FALHAS=$((FALHAS+1))
else
  verde "✓ Nenhuma chave de serviço no frontend (anon é ok)."
fi

# 3. AVISO: políticas RLS permissivas demais em migrations
if grep -rnE "WITH CHECK \(true\)|USING \(true\)" supabase/migrations/ 2>/dev/null; then
  amarelo "⚠ AVISO: política RLS sempre-verdadeira (revisar se é intencional)."
  AVISOS=$((AVISOS+1))
fi

# 4. AVISO: funções SECURITY DEFINER sem search_path fixo na mesma migration
for f in supabase/migrations/*.sql; do
  if grep -qiE "SECURITY DEFINER" "$f" && ! grep -qiE "search_path" "$f"; then
    amarelo "⚠ AVISO: $f tem SECURITY DEFINER sem 'SET search_path'."
    AVISOS=$((AVISOS+1))
  fi
done

# 5. AVISO: CREATE TABLE sem ENABLE ROW LEVEL SECURITY no mesmo arquivo
for f in supabase/migrations/*.sql; do
  if grep -qiE "CREATE TABLE" "$f" && ! grep -qiE "ENABLE ROW LEVEL SECURITY" "$f"; then
    amarelo "⚠ AVISO: $f cria tabela(s) e não habilita RLS no mesmo arquivo."
    AVISOS=$((AVISOS+1))
  fi
done

# 6. AVISO: console.log deixado no JS de produção
N=$(grep -rnoE "console\.log" js/ pages/ 2>/dev/null | wc -l | tr -d ' ')
if [ "$N" -gt 0 ]; then
  amarelo "⚠ AVISO: $N ocorrência(s) de console.log em js/ ou pages/."
  AVISOS=$((AVISOS+1))
fi

echo "──────────────────────────────────────────────────────"
echo "Falhas críticas: $FALHAS | Avisos: $AVISOS"

[ "$FALHAS" -eq 0 ] || { vermelho "Guardrails: REPROVADO"; exit 1; }
verde "Guardrails: OK"
