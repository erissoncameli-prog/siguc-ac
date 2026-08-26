# Skills de UI/UX — conteúdo de terceiro, versionado no repositório

Origem: https://github.com/nextlevelbuilder/ui-ux-pro-max-skill
Licença: MIT (Copyright (c) 2024 Next Level Builder — ver LICENSE no repositório de origem)
Commit importado: e353a508767c6d39f0e7698b084dbfc8699fffd3 (25/08/2026)

Cópia integral de `.claude/skills/` daquele repositório, 7 skills. Ficam
versionadas aqui (e não instaladas como plugin) para valer em qualquer
sessão — inclusive as sessões web, cujo container é efêmero — e para todo
mundo que trabalha no SIGUC-AC.

## A skill principal

`ui-ux-pro-max` é um buscador local em Python (só stdlib, sem dependência
externa) sobre CSVs de diretrizes. Rodar sempre da RAIZ do repositório:

    python .claude/skills/ui-ux-pro-max/scripts/search.py "<consulta>" --domain <dominio>

Domínios: `ux`, `style`, `product`, `color`, `typography`, `icons`,
`chart`, `gsap`. Também aceita `--stack <stack>` e `--design-system`.

## Alterações locais feitas na importação

Os `SKILL.md` vinham com caminhos que só funcionam quando a skill é
instalada como PLUGIN, e que quebram numa skill de projeto:

1. `ui-ux-pro-max/SKILL.md` — `${CLAUDE_PLUGIN_ROOT}` só é definida pelo
   instalador de plugin. Fora dele a variável expande para vazio e o
   caminho vira `/.claude/skills/...` (absoluto, inexistente). Trocado
   pelo caminho relativo à raiz do repositório.
2. `brand`, `design-system`, `design`, `ui-styling`, `slides` — chamadas
   `node scripts/x.cjs` / `python scripts/x.py` assumiam que o diretório
   de trabalho era o da própria skill. Prefixadas com o caminho completo.

Nenhum dado (CSV/JSON) foi alterado.

## Limitações conhecidas — conferidas, não supostas

- **Não existe stack `html-vanilla` nem `css-puro`.** As 22 stacks são
  React/Next/Vue/Svelte/Flutter/SwiftUI etc.; a mais próxima do
  SIGUC-AC é `html-tailwind`, e este projeto é CSS puro com design
  system próprio. O valor aqui está nos domínios agnósticos (`ux`,
  `color`, `typography`, `chart`), não em `--stack`.
- **`banner-design` não funciona.** O `SKILL.md` dela chama três skills
  que não existem nesta cópia (`ai-artist`, `ai-multimodal`,
  `chrome-devtools`) e um virtualenv `.claude/skills/.venv`. Importada
  por completude; usar apenas como texto de referência.
- A skill traz recomendações genéricas de fonte/paleta. **O design
  system do SIGUC-AC manda** — ver `CLAUDE.md` (variáveis `--floresta`/
  `--verde-c`/`--ouro`, Fraunces + DM Sans, Fraunces nunca em número de
  KPI, ícone sempre SVG de traço via `BICON_PATHS`/`bico()`, paletas de
  faixa já validadas contra daltonismo). Onde as duas discordarem, vale
  o `CLAUDE.md`.

## Atualizar

    git clone --depth 1 https://github.com/nextlevelbuilder/ui-ux-pro-max-skill.git /tmp/uiux
    cp -r /tmp/uiux/.claude/skills/. .claude/skills/

E reaplicar as duas correções de caminho acima (elas voltam a quebrar a
cada atualização).
