# SIGUC Frota — App nativo (Capacitor)

App Android do módulo Frota (Setor de Transporte), gerado a partir **dos
mesmos arquivos** da versão web (`pages/frota-app.html` +
`js/frota-*.js` + `css/frota-wise-theme.css` + `css/global.css`). Nenhuma
lógica é duplicada: o projeto em `app-frota/` apenas empacota o código web
num shell nativo — o mesmo padrão dos apps Brigadas (`app/`) e Biomonitor
(`app-biomonitor/`), porém com `appId` próprio
(`br.gov.ac.sema.siguc.frota`), então os três apps convivem no mesmo
aparelho.

O app cobre os três modos do `frota-app.html`: **solicitante** (pedir
viagem), **motorista** (check-out/check-in, abastecimento, checklist de
inspeção/DVIR) e **gestor** (aprovar/recusar viagem).

## Por que app nativo em vez de só PWA

| Problema da PWA | Como o app resolve |
|---|---|
| Navegador pode apagar o IndexedDB (limpeza de dados, falta de espaço) | Dados ficam no sandbox do aplicativo |
| Service worker preso em versão velha / cache incompleto | Arquivos embarcados no APK — sempre completos e da versão certa |
| Instalação confusa ("adicionar à tela inicial") | Ícone normal de app, instalado uma vez |
| Depende de CDN (supabase-js, Google Fonts) no primeiro acesso | Tudo embarcado: funciona offline desde a primeira abertura |

## Estrutura

```
app-frota/
├── capacitor.config.json   # appId br.gov.ac.sema.siguc.frota
├── package.json            # Capacitor 8 + deps embarcadas (supabase-js, fontes)
├── package-lock.json       # gerado por `npm install`
├── scripts/
│   ├── build-www.mjs       # monta www/ a partir de pages/ js/ css/ do repo
│   └── gerar-icones.mjs    # gera mipmaps + splash a partir de pwa/icons/icon-frota-*.png
├── android/                # projeto nativo (commitado)
└── www/                    # gerado — NÃO editar (gitignored)
```

O `build-www.mjs` copia `frota-app.html` → `index.html` aplicando rewrites:
supabase-js do CDN → bundle local, Google Fonts (Archivo/Inter do tema Frota
+ DM Sans/DM Mono/Fraunces do `global.css` base) → woff2 locais, remove o
manifest PWA, e reescreve os caminhos relativos (`../css/`, `../js/`) para
absolutos (`/css/`, `/js/`), já que `index.html` passa a viver na raiz do
`www/` em vez de `pages/`. A versão do build fica em `window.FROTA_BUILD`
(carimbada, mas ainda não lida por nenhuma tela — ver "Lacunas" abaixo).

**Regra de ouro: toda alteração no app é feita nos arquivos web
(`pages/frota-app.html`, `js/frota-*.js`, `css/frota-wise-theme.css`,
`css/global.css`). O app herda automaticamente no próximo build.**

### Sem câmera nativa

Diferente do Brigadas e do Biomonitor, o Frota **não usa o plugin
`@capacitor/camera`**: as fotos (cupom/hodômetro do abastecimento, defeito
do checklist) usam `<input type="file" capture="environment">`, que aciona
o app de câmera do sistema via intent — funciona igual dentro da WebView do
shell nativo, sem precisar de plugin nem da permissão `CAMERA` no
`AndroidManifest.xml`. GPS usa `navigator.geolocation` (Web API padrão), só
com as permissões `ACCESS_FINE_LOCATION`/`ACCESS_COARSE_LOCATION`.

## Como gerar o APK

### Pelo GitHub Actions (recomendado — não precisa de Android Studio)

Workflow **Frota APK** (`.github/workflows/frota-apk.yml`). **Sempre
publica um Release** com o `.apk` anexado (link direto, sem ZIP e sem login),
tanto no disparo manual quanto por tag. O `.apk` também fica como *artifact*.

- **Disparo manual:** aba *Actions* → **Frota APK** → *Run workflow*.
  - Informe a **versão** (ex.: `1.1.0`) → publica `frota-v1.1.0`.
  - Deixe **vazio** → auto-incrementa o patch do último Release.
- **Por tag:**

  ```bash
  git tag frota-v1.0.0 && git push origin frota-v1.0.0
  ```

> ⚠️ Todo disparo gera um Release. Para um build descartável, baixe o `.apk`
> pelo *artifact* do run (mas a versão também terá sido publicada).

### Localmente (precisa de Android Studio / SDK)

```bash
cd app-frota
npm install
npm run apk:debug      # APK em app-frota/android/app/build/outputs/apk/debug/
```

## Assinatura

O workflow **reutiliza os secrets do Brigadas** (`ANDROID_KEYSTORE_B64`,
`ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`).
Como o `applicationId` é diferente, não há conflito com os apps Brigadas e
Biomonitor, e cada build atualiza o anterior sem precisar desinstalar. Sem
os secrets, o APK sai com chave de debug (instala, mas a assinatura muda a
cada build).

## Compatibilidade / offline

- **minSdk 24** (Android 7.0+) — cobre praticamente todos os aparelhos em uso.
- **APK universal** (uma ABI única) — o mesmo `.apk` instala em qualquer
  arquitetura (arm64/arm32/x86).
- **Offline total:** supabase-js, fontes e ícones embarcados; nada de CDN. A
  fila offline (IndexedDB, `js/frota-offline.js`) fica no sandbox do app.

## Ícones e arte

Diferente do Biomonitor (que recorta um emblema circular de uma arte fonte
em `resources/`), o Frota já tinha ícones PWA prontos e opacos em
`pwa/icons/` (`icon-frota-512.png`, `icon-frota-maskable-512.png`,
`logo-frota.png`, `apple-touch-icon-frota.png`) — `gerar-icones.mjs` só
reamostra essas duas primeiras artes para os tamanhos do Android (mipmaps +
splash), sem detecção de círculo nem composição.

## Lacunas conhecidas (ver relatório da entrega que criou este shell)

- `pages/frota-app.html` ainda **não tem** a checagem de atualização por
  GitHub Releases que Brigadas/Biomonitor têm (o comentário no HTML dizia
  "app Frota é PWA, sem shell Capacitor ainda" — agora desatualizado). Se
  quiser paridade de UX de atualização com os outros dois apps, é preciso
  implementar essa checagem em `frota-app.html`/`js/frota-wise.js` lendo
  `window.FROTA_BUILD` (já carimbado pelo build) contra a *GitHub Releases
  API* (`frota-vX.Y.Z`) — fora do escopo desta entrega, que criou só a
  infraestrutura do shell nativo.
- `pages/instalar-frota.html` segue apontando só para a instalação do PWA;
  se o app nativo for para produção, considerar adicionar o link do `.apk`
  (`https://github.com/<owner>/<repo>/releases/latest/download/siguc-frota.apk`)
  nessa página, como as páginas equivalentes do Brigadas/Biomonitor fazem.
