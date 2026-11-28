#!/usr/bin/env bash
# Confere, no início de cada sessão do Claude, se esta cópia está igual à do GitHub.
# Roda em Windows (Git Bash), Mac e Linux. Não altera nada: só avisa.
cd "${CLAUDE_PROJECT_DIR:-.}" 2>/dev/null || exit 0
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || exit 0

ramo=$(git branch --show-current 2>/dev/null)
if git fetch -q origin 2>/dev/null; then
  online=1
else
  online=0
fi

atras=$(git rev-list --count HEAD..@{u} 2>/dev/null || echo 0)
afrente=$(git rev-list --count @{u}..HEAD 2>/dev/null || echo 0)
alterados=$(git status --porcelain 2>/dev/null | wc -l | tr -d ' ')

if [ "$online" = 0 ]; then
  aviso="Sem conexão com o GitHub: não deu para conferir se há novidades. Antes de enviar algo, rode git pull."
  contexto="Início de sessão: git fetch falhou (sem rede?). Avise o usuário e faça git pull antes do primeiro push."
elif [ "$atras" = 0 ] && [ "$afrente" = 0 ] && [ "$alterados" = 0 ]; then
  printf '{"systemMessage":"Projeto sincronizado com o GitHub (ramo %s)."}\n' "$ramo"
  exit 0
else
  aviso="Sincronização (ramo $ramo):"
  [ "$atras" != 0 ] && aviso="$aviso $atras atualização(ões) no GitHub ainda não baixada(s)."
  [ "$afrente" != 0 ] && aviso="$aviso $afrente commit(s) deste computador ainda não enviado(s)."
  [ "$alterados" != 0 ] && aviso="$aviso $alterados arquivo(s) alterado(s) sem commit."
  contexto="Início de sessão — $aviso Antes de qualquer outra tarefa: se há atualizações no GitHub, faça git pull --rebase (guarde antes as alterações locais com git stash se for preciso, e devolva depois). Se há commits ou alterações locais sem enviar, conte ao usuário e pergunte se deve fazer commit e push agora. Depois leia o PROGRESSO.md."
fi

printf '{"systemMessage":"%s","hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"%s"}}\n' "$aviso" "$contexto"
