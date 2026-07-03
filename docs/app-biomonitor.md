# SIGUC Biomonitor — App nativo (Capacitor)

App Android do monitoramento de quelônios, gerado a partir **dos mesmos
arquivos** da versão web (`pages/biomonitor.html` + `js/biomonitor-*.js` +
`css/biomonitor.css`). Nenhuma lógica é duplicada: o projeto em
`app-biomonitor/` apenas empacota o código web num shell nativo — o mesmo
padrão do app Brigadas (`app/`), porém com `appId` próprio
(`br.gov.ac.sema.siguc.biomonitor`), então os dois apps convivem no mesmo
aparelho.

## Por que app nativo em vez de só PWA

| Problema da PWA | Como o app resolve |
|---|---|
| Navegador pode apagar o IndexedDB (limpeza de dados, falta de espaço) | Dados ficam no sandbox do aplicativo |
| Service worker preso em versão velha / cache incompleto | Arquivos embarcados no APK — sempre completos e da versão certa |
| Instalação confusa ("adicionar à tela inicial") | Ícone normal de app, instalado uma vez |
| Depende de CDN (supabase-js, Google Fonts) no primeiro acesso | Tudo embarcado: funciona offline desde a primeira abertura |

## Estrutura

```
app-biomonitor/
├── capacitor.config.json   # appId br.gov.ac.sema.siguc.biomonitor
├── package.json            # Capacitor 8 + deps embarcadas (supabase-js, fontes, camera)
├── package-lock.json       # deps idênticas ao app Brigadas
├── scripts/
│   ├── build-www.mjs       # monta www/ a partir de pages/ js/ css/ do repo
│   └── gerar-icones.mjs    # gera mipmaps + splash a partir de icon-biomonitor-512.png
├── android/                # projeto nativo (commitado)
└── www/                    # gerado — NÃO editar (gitignored)
```

O `build-www.mjs` copia `biomonitor.html` → `index.html` aplicando rewrites:
supabase-js do CDN → bundle local, Google Fonts → woff2 locais, remove o
manifest PWA. O registro do service worker é pulado dentro do app
(guard `!window.Capacitor` no próprio `biomonitor.html`). A versão do APK é
carimbada em `window.BIO_BUILD` e lida por `bioVersaoBuild()`.

**Regra de ouro: toda alteração no app é feita nos arquivos web
(`pages/biomonitor.html`, `js/biomonitor-*.js`, `css/biomonitor.css`). O app
herda automaticamente no próximo build.**

## Como gerar o APK

### Pelo GitHub Actions (recomendado — não precisa de Android Studio)

Workflow **Biomonitor APK** (`.github/workflows/biomonitor-apk.yml`). **Sempre
publica um Release** com o `.apk` anexado (link direto, sem ZIP e sem login),
tanto no disparo manual quanto por tag. O `.apk` também fica como *artifact*.

- **Disparo manual:** aba *Actions* → **Biomonitor APK** → *Run workflow*.
  - Informe a **versão** (ex.: `1.1.0`) → publica `biomonitor-v1.1.0`.
  - Deixe **vazio** → auto-incrementa o patch do último Release.
- **Por tag:**

  ```bash
  git tag biomonitor-v1.0.0 && git push origin biomonitor-v1.0.0
  ```

O link fixo
`https://github.com/erissoncameli-prog/siguc-ac/releases/latest/download/siguc-biomonitor.apk`
sempre aponta para a versão mais nova — é o link usado pela página
`/pages/instalar-biomonitor.html` e pelo updater dentro do app.

> ⚠️ Todo disparo gera um Release. Para um build descartável, baixe o `.apk`
> pelo *artifact* do run (mas a versão também terá sido publicada).

### Localmente (precisa de Android Studio / SDK)

```bash
cd app-biomonitor
npm install
npm run apk:debug      # APK em app-biomonitor/android/app/build/outputs/apk/debug/
```

## Assinatura

O workflow **reutiliza os secrets do Brigadas** (`ANDROID_KEYSTORE_B64`,
`ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`).
Como o `applicationId` é diferente, não há conflito com o app Brigadas e cada
build atualiza o anterior sem precisar desinstalar. Sem os secrets, o APK sai
com chave de debug (instala, mas a assinatura muda a cada build).

## Compatibilidade / offline

- **minSdk 24** (Android 7.0+) — cobre praticamente todos os aparelhos em uso.
- **APK universal** (uma ABI única) — o mesmo `.apk` instala em qualquer
  arquitetura (arm64/arm32/x86).
- **Offline total:** supabase-js, fontes e ícones embarcados; nada de CDN. O
  IndexedDB (`siguc_biomonitor_v1`) fica no sandbox do app. Câmera e GPS usam
  o plugin nativo (`@capacitor/camera` + permissões no `AndroidManifest.xml`).

## Atualizações do app instalado

Cada release tem `versionCode` maior (número do run do GitHub Actions).

- **No APK (Capacitor):** ao tocar em *Config → "Verificar atualização"*, o app
  checa a *GitHub Releases API* por um `biomonitor-vX.Y.Z` maior que a versão
  instalada e oferece o download direto do `.apk`.
- **Na web/PWA (inclui iPhone):** a atualização vem pelo ciclo do service
  worker.

O monitor instala o `.apk` novo por cima do atual — os dados locais e a fila
de envio são preservados. Para a detecção funcionar, **publique sempre como
Release** (o link `/releases/latest/download` ignora *artifacts* avulsos).
