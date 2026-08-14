# SIGUC Água — App nativo (Capacitor)

App Android do módulo Qualidade da Água (coleta de campo), gerado a
partir **dos mesmos arquivos** da versão web (`pages/agua-app.html` +
`js/agua-offline.js` + `js/agua-sync.js` + `js/brigada-captura.js`
reaproveitado + `css/agua-app.css`). Nenhuma lógica é duplicada: o
projeto em `app-agua/` apenas empacota o código web num shell nativo —
mesmo padrão dos apps Brigadas (`app/`), Biomonitor (`app-biomonitor/`)
e Frota (`app-frota/`), com `appId` próprio
(`br.gov.ac.sema.siguc.agua`), então os quatro apps convivem no mesmo
aparelho.

O app cobre um único fluxo: login (e-mail/senha do SIGUC + PIN de
campo), escolher um ponto de coleta cadastrado, registrar os
parâmetros de campo (temperatura do ar/amostra, pH, OD, turbidez,
condutividade), fotografar o ponto e sincronizar quando houver
conexão. Não há papéis distintos (solicitante/motorista/gestor como o
Frota) — quem usa o app são os mesmos técnicos que já operam a mesa
(`pages/agua-pontos.html`/`agua-laudos.html`), sem cadastro de
identidade próprio.

## Por que app nativo em vez de só PWA

| Problema da PWA | Como o app resolve |
|---|---|
| Navegador pode apagar o IndexedDB (limpeza de dados, falta de espaço) | Dados ficam no sandbox do aplicativo |
| Service worker preso em versão velha / cache incompleto | Arquivos embarcados no APK — sempre completos e da versão certa |
| Instalação confusa ("adicionar à tela inicial") | Ícone normal de app, instalado uma vez |
| Depende de CDN (supabase-js, Google Fonts) no primeiro acesso | Tudo embarcado: funciona offline desde a primeira abertura |

## Estrutura

```
app-agua/
├── capacitor.config.json   # appId br.gov.ac.sema.siguc.agua
├── package.json            # Capacitor 8 + deps embarcadas (supabase-js, câmera, fontes)
├── package-lock.json       # gerado por `npm install`
├── scripts/
│   └── build-www.mjs       # monta www/ a partir de pages/ js/ css/ do repo
├── android/                # projeto nativo (commitado)
└── www/                    # gerado — NÃO editar (gitignored)
```

O `build-www.mjs` copia `agua-app.html` → `index.html` aplicando
rewrites: supabase-js do CDN → bundle local, Google Fonts (DM Sans/DM
Mono/Fraunces) → woff2 locais, remove o manifest PWA, embarca as
credenciais públicas do Supabase como `window.__SIGUC_ENV` (buscadas
uma vez no momento do build, via `/api/env` de produção — o app nativo
não alcança esse endpoint em runtime). A versão do build fica em
`window.AGUA_BUILD` (lida por `verificarUpdateAndroid()` em
`agua-app.html`, comparando com os Releases `agua-v*` do GitHub).

**Regra de ouro: toda alteração no app é feita nos arquivos web
(`pages/agua-app.html`, `js/agua-offline.js`, `js/agua-sync.js`,
`css/agua-app.css`). O app herda automaticamente no próximo build.**
Testado nesta entrega: `npm install` + `node scripts/build-www.mjs`
rodam de ponta a ponta neste repositório, produzindo um `www/` válido
(transpilado para ES2017, sem CDN, credenciais embarcadas).

### Com câmera nativa

Como o Brigadas e o Biomonitor (e diferente do Frota), o app usa o
plugin `@capacitor/camera` — `bCameraNativaCapturar()` em
`js/brigada-captura.js`, o mesmo arquivo dos outros dois, sem cópia
nem adaptação. Fora do APK (web/iOS), a foto vem por
`<input type="file" capture="environment">`, mesmo pipeline de
marca d'água via canvas.

**GPS é PONTUAL** (`bGpsUmaLeitura()`, `getCurrentPosition`), não
contínuo como Brigadas/Biomonitor — a única leitura serve para
comparar com a coordenada cadastrada do ponto (auditoria da coleta),
não para um indicador ao vivo na tela. Ver `docs/qualidade-agua/plano.md`,
seção "Fase 3 — ENTREGUE", para o raciocínio completo.

## Como gerar o APK

**Nenhum APK foi gerado por esta entrega** — regra do projeto (só
gerar quando pedido ou já houver acúmulo suficiente). A infraestrutura
abaixo está pronta e testada (build local), só falta disparar.

### Pelo GitHub Actions (recomendado — não precisa de Android Studio)

Workflow **Água APK** (`.github/workflows/agua-apk.yml`). **Sempre
publica um Release** com o `.apk` anexado (link direto, sem ZIP e sem
login), tanto no disparo manual quanto por tag. O `.apk` também fica
como *artifact*.

- **Disparo manual:** aba *Actions* → **Água APK** → *Run workflow*.
  - Informe a **versão** (ex.: `1.0.0`) → publica `agua-v1.0.0`.
  - Deixe **vazio** → auto-incrementa o patch do último Release.
- **Por tag:**

  ```bash
  git tag agua-v1.0.0 && git push origin agua-v1.0.0
  ```

### Localmente (precisa de Android Studio / SDK)

```bash
cd app-agua
npm install
npm run apk:debug      # APK em app-agua/android/app/build/outputs/apk/debug/
```

## Assinatura

O workflow **reutiliza os secrets dos outros apps** (`ANDROID_KEYSTORE_B64`,
`ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`).
Como o `applicationId` é diferente, não há conflito com Brigadas/
Biomonitor/Frota, e cada build atualiza o anterior sem precisar
desinstalar. Sem os secrets, o APK sai com chave de debug (instala,
mas a assinatura muda a cada build).

## Compatibilidade / offline

- **minSdk 24** (Android 7.0+) — cobre praticamente todos os aparelhos em uso.
- **APK universal** (uma ABI única) — o mesmo `.apk` instala em qualquer
  arquitetura (arm64/arm32/x86).
- **Offline total:** supabase-js, fontes embarcados; nada de CDN. A
  fila offline (IndexedDB, `js/agua-offline.js`) fica no sandbox do app.

## Ícones e arte

**Pendência conhecida**: o launcher Android (`app-agua/android/app/src/main/res/mipmap-*`)
ainda usa o placeholder genérico gerado pelo `@capacitor/cli` na
criação do shell — nenhuma arte própria (ícone gota d'água, tela de
splash) foi gerada nesta entrega, porque a sessão que criou o shell
não tinha uma ferramenta de geração de imagem disponível. Trocar antes
do primeiro APK real (mesmo processo do Biomonitor: arte fonte em
`app-agua/resources/`, mipmaps + splash gerados por um script próprio
— ou reaproveitar o padrão mais simples do Frota, reamostrando um PNG
já pronto de `pwa/icons/`).
