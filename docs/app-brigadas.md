# SIGUC Brigadas — App nativo (Capacitor)

App Android (e futuramente iOS) do registro de campo das brigadas, gerado a
partir **dos mesmos arquivos** da versão web (`pages/brigada.html` + `js/brigada-*.js`).
Nenhuma lógica é duplicada: o projeto em `app/` apenas empacota o código web
num shell nativo.

## Por que app nativo em vez de PWA

| Problema da PWA | Como o app resolve |
|---|---|
| Navegador pode apagar IndexedDB (limpeza de dados, falta de espaço) | Dados ficam no sandbox do aplicativo |
| Service worker preso em versão velha / cache incompleto | Arquivos embarcados no APK — sempre completos e da versão certa |
| Instalação confusa ("adicionar à tela inicial") | Ícone normal de app, instalado uma vez |
| Depende de CDN (supabase-js, Google Fonts) no primeiro acesso | Tudo embarcado: funciona offline desde a primeira abertura |

## Estrutura

```
app/
├── capacitor.config.json   # appId br.gov.ac.sema.siguc.brigadas
├── package.json            # Capacitor 8 + deps embarcadas (supabase-js, fontes)
├── scripts/
│   ├── build-www.mjs       # monta www/ a partir de pages/ js/ css/ do repo
│   └── gerar-icones.mjs    # gera ícones Android + pwa/icons (sem dependências)
├── android/                # projeto nativo (commitado)
└── www/                    # gerado — NÃO editar (gitignored)
```

O `build-www.mjs` copia `brigada.html` → `index.html` aplicando 3 rewrites:
supabase-js do CDN → bundle local, Google Fonts → woff2 locais, remove o
manifest PWA. O registro do service worker é pulado dentro do app
(guard `!window.Capacitor` no próprio `brigada.html`).

**Regra de ouro: toda alteração no app de campo é feita nos arquivos web
(`pages/brigada.html`, `js/brigada-*.js`, `css/brigada.css`). O app herda
automaticamente no próximo build.**

## Como gerar o APK

### Pelo GitHub Actions (recomendado — não precisa de Android Studio)

O workflow **Brigadas APK** **sempre publica um Release** com o `.apk`
anexado (link direto, sem ZIP e sem login) — tanto no disparo manual quanto
por tag. O `.apk` também fica como *artifact* do run (para download interno).

- **Disparo manual:** aba *Actions* → workflow **Brigadas APK** → *Run workflow*.
  - Informe a **versão** no campo (ex.: `1.16.0`) → publica `brigadas-v1.16.0`.
  - Deixe **vazio** → o workflow **auto-incrementa o patch** do último Release
    (ex.: se o último é `1.16.0`, gera `1.16.1`).
- **Por tag:** criar uma tag `brigadas-vX.Y.Z` também publica o Release:

  ```bash
  git tag brigadas-v1.0.0 && git push origin brigadas-v1.0.0
  ```

O link fixo
`https://github.com/erissoncameli-prog/siguc-ac/releases/latest/download/siguc-brigadas.apk`
sempre aponta para a versão mais nova — é esse link que a página
`/pages/instalar-brigadas.html` usa e que o app oferece na atualização.

> ⚠️ Não dispare "só para testar" sem querer publicar: **todo disparo gera um
> Release**. Para um build descartável, baixe o `.apk` pelo *artifact* do run
> (mas a versão também terá sido publicada).

### Localmente (precisa de Android Studio / SDK)

```bash
cd app
npm install
npm run apk:debug      # APK em app/android/app/build/outputs/apk/debug/
```

## Assinatura (fazer UMA vez antes do primeiro release oficial)

Sem assinatura própria, o APK sai com chave de debug e **a assinatura muda a
cada build** — o Android obriga a desinstalar para atualizar. Para evitar isso:

1. Gerar a keystore (guardar o arquivo e as senhas em local seguro — perder a
   keystore significa não conseguir mais atualizar o app instalado):

   ```bash
   keytool -genkeypair -v -keystore siguc-brigadas.keystore \
     -alias brigadas -keyalg RSA -keysize 2048 -validity 10000 \
     -dname "CN=SEMA-AC, OU=DIMA, O=Governo do Acre, L=Rio Branco, ST=AC, C=BR"
   ```

2. Cadastrar 4 secrets no GitHub (*Settings → Secrets and variables → Actions*):

   | Secret | Valor |
   |---|---|
   | `ANDROID_KEYSTORE_B64` | `base64 -w0 siguc-brigadas.keystore` |
   | `ANDROID_KEYSTORE_PASSWORD` | senha da keystore |
   | `ANDROID_KEY_ALIAS` | `brigadas` |
   | `ANDROID_KEY_PASSWORD` | senha da chave |

## Distribuição

- **Página para os brigadistas:** `https://siguc-ac.vercel.app/pages/instalar-brigadas.html`
  (instruções passo a passo + botão de download do APK + instalação PWA no iPhone).
- **Google Play (futuro):** taxa única de US$ 25; elimina o aviso de "fonte
  desconhecida" e dá atualização automática.
- **iOS (futuro):** exige Apple Developer Program (US$ 99/ano — verificar
  isenção para órgãos governamentais). Até lá, iPhone usa a PWA instalada
  pela tela inicial do Safari.

## Atualizações do app instalado

Cada release tem `versionCode` maior que o anterior — o workflow usa o número
do run do GitHub Actions automaticamente, então cada build novo já é maior.

Como o app detecta e oferece a atualização (lógica em `pages/brigada.html`):

- **No APK (Capacitor):** ao abrir, checa a *GitHub Releases API* no máximo
  **1×/dia**; se houver um `brigadas-vX.Y.Z` maior que a versão instalada,
  mostra o **banner "Nova versão disponível"** (e um pontinho no item *Config*).
  Em *Config → "Verificar atualização do app"* a checagem é imediata. Ao
  aceitar, abre o `browser_download_url` do `.apk` (download direto).
- **Na web/PWA (inclui iPhone):** a atualização vem pelo ciclo do service
  worker (botão "Verificar atualização" chama `registration.update()`).

O brigadista instala o `.apk` novo por cima do atual — os dados locais e a
fila de envio são preservados. Para a detecção funcionar, **publique sempre
como Release** (o updater e o link `/releases/latest/download` ignoram
*artifacts* de run avulsos).
