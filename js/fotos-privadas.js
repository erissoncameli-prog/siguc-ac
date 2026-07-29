// ── SIGUC — exibição de fotos de bucket privado (URL assinada) ──
//
// Compartilhado pelos três apps (Frota, Brigadas, Biomonitor). Nasceu
// no Frota (migration 200) e foi promovido a genérico na Fase 0 do
// plano de LGPD, quando os buckets `brigadistas`, `registros-campo` e
// `biomonitor-fotos` também deixaram de ser públicos (migration 210):
// eram fotos de rosto e imagens de campo com GPS na marca d'água
// servidas sem autenticação para quem tivesse a URL.
//
// Uma implementação só, de propósito — a lição do js/frota-consumo.js
// (três cópias do mesmo bloco, com o mesmo bug). Os nomes antigos
// `frota*` seguem exportados como alias no fim do arquivo, então os
// call sites do Frota não precisaram ser tocados.
//
// Bucket privado não serve mais o arquivo pela URL pública: quem
// exibe foto precisa gerar uma signed URL, que é uma chamada de rede
// assíncrona — e as telas montam HTML com template literal síncrono.
//
// Padrão adotado (o mesmo de bIconsAplicar, em js/config.js): o
// render continua síncrono e só marca o elemento com
// `data-foto-privada`; depois de jogar o HTML na tela, chama-se
// `assinarFotos(container)`, que resolve tudo de uma vez —
// agrupando por bucket, uma chamada por bucket em vez de uma por
// imagem.
//
// O que fica gravado no banco (foto_url, foto_cupom_url, fotos_urls)
// continua sendo a URL pública: ela deixa de servir o arquivo mas
// segue valendo como endereço, e é dela que se extrai bucket +
// caminho. Assim as linhas antigas continuam funcionando sem
// migração de dados.
//
// Fotos ainda não sincronizadas (blob:/data: da fila offline dos apps
// de campo) não são URL de Storage: fotoRef devolve null e o chamador
// trata como "não há o que assinar", exibindo a imagem local direto.

const FOTO_TTL = 3600 // 1 h — cobre a sessão de uma tela sem re-assinar

// Cliente Supabase a usar para assinar. A resolução mora em
// js/config.js (sigucDb), que é carregado antes deste arquivo em todas
// as telas — uma implementação só, pelo mesmo motivo do
// js/frota-consumo.js. O fallback cobre o caso de este arquivo ser
// carregado sem o config.js.
function _fotoDb() {
  if (typeof sigucDb === 'function') return sigucDb()
  // Fallback com a MESMA ordem de sigucDb: `db` antes de `window.db`
  // — ver o comentário lá para o porquê.
  if (window._bioDB_client) return window._bioDB_client
  if (typeof db !== 'undefined' && db) return db
  return window.db || null
}

// URL pública gravada no banco → { bucket, path }.
// Formato: .../storage/v1/object/public/<bucket>/<caminho>[?query]
// A query existe porque o app anexa ?t=<timestamp> ao trocar a foto
// do motorista (cache-busting) — precisa ser descartada.
function fotoRef(url) {
  if (!url || typeof url !== 'string') return null
  const m = url.match(/\/storage\/v1\/object\/(?:public\/)?([^/]+)\/(.+)$/)
  if (!m) return null
  const bucket = m[1]
  const bruto = m[2].split('?')[0].split('#')[0]
  // decodeURIComponent lança URIError em '%' solto. Um caminho estranho
  // não pode derrubar o template que está sendo montado — devolve nulo,
  // que o chamador já trata como "sem foto".
  let path
  try { path = decodeURIComponent(bruto) } catch (e) { path = bruto }
  if (!bucket || !path) return null
  return { bucket, path }
}

// Atributos para um <img> ou <a> que aponta para foto de bucket
// privado. Devolve string vazia quando a URL não é de Storage (nada a
// assinar — o chamador trata como "sem foto").
//
// `fallback`: iniciais a mostrar se a assinatura falhar (offline, sem
// permissão). Sem isso, uma foto que não assina vira ícone de imagem
// quebrada.
function fotoAttr(url, fallback) {
  const ref = fotoRef(url)
  if (!ref) return ''
  const fb = fallback ? ` data-foto-fallback="${esc(fallback)}"` : ''
  return `data-foto-privada="${esc(ref.bucket + '|' + ref.path)}"${fb}`
}

// Assina UMA URL — para uso imperativo (definir .src na mão, abrir em
// nova aba). Devolve null se não der para assinar; o chamador decide o
// que fazer. Nos casos em massa prefira assinarFotos, que agrupa
// por bucket em vez de uma chamada por foto.
async function fotoUrlAssinada(url) {
  const ref = fotoRef(url)
  const sb  = _fotoDb()
  if (!ref || !sb) return null
  try {
    const { data, error } = await sb.storage.from(ref.bucket).createSignedUrl(ref.path, FOTO_TTL)
    if (error) throw error
    return data?.signedUrl || null
  } catch (e) {
    console.warn('[fotos-privadas] falha ao assinar', ref.bucket, e?.message || e)
    return null
  }
}

// Assina tudo que estiver marcado dentro de `root` (ou do documento).
// Em <img> preenche src; em <a> preenche href; em qualquer outro
// elemento, define como background-image.
async function assinarFotos(root) {
  const alvo = (typeof root === 'string' ? document.getElementById(root) : root) || document
  const els = Array.from(alvo.querySelectorAll('[data-foto-privada]'))
  const sb  = _fotoDb()
  if (!els.length || !sb) return

  // Agrupa por bucket: uma chamada de rede por bucket, não por foto.
  const porBucket = new Map()
  for (const el of els) {
    const [bucket, ...resto] = (el.dataset.fotoPrivada || '').split('|')
    const path = resto.join('|')
    if (!bucket || !path) continue
    if (!porBucket.has(bucket)) porBucket.set(bucket, [])
    porBucket.get(bucket).push({ el, path })
  }

  await Promise.all(Array.from(porBucket.entries()).map(async ([bucket, itens]) => {
    let assinadas = {}
    try {
      const paths = [...new Set(itens.map(i => i.path))]
      const { data, error } = await sb.storage.from(bucket).createSignedUrls(paths, FOTO_TTL)
      if (error) throw error
      const resp = data || []
      resp.forEach((d, i) => {
        const url = d?.signedUrl || d?.signedURL   // v2 usa signedUrl; tolera a grafia antiga
        if (!url || d?.error) return
        // Casa pelo path devolvido e, por segurança, também pela
        // posição: se o Storage devolver o path normalizado de forma
        // diferente da enviada, o casamento por chave falharia e TODAS
        // as fotos sumiriam em silêncio.
        if (d.path) assinadas[d.path] = url
        if (paths[i] != null) assinadas[paths[i]] = url
      })
    } catch (e) {
      console.warn('[fotos-privadas] falha ao assinar', bucket, e?.message || e)
    }
    for (const { el, path } of itens) {
      const url = assinadas[path]
      if (url) _fotoAplicarUrl(el, url)
      else _fotoFalhou(el)
    }
  }))
}

function _fotoAplicarUrl(el, url) {
  el.removeAttribute('data-foto-privada')
  if (el.tagName === 'IMG') {
    // Se a imagem ainda assim não carregar (URL expirada numa tela
    // aberta há muito tempo), cai no mesmo fallback.
    el.addEventListener('error', () => _fotoFalhou(el), { once: true })
    el.src = url
  } else if (el.tagName === 'A') {
    el.href = url
  } else {
    el.style.backgroundImage = `url("${url}")`
  }
}

// Sem foto exibível. Avatar vira iniciais (o chamador informa o
// fallback); qualquer outra imagem vira um marcador visível com
// tooltip.
//
// O marcador é deliberado: antes a imagem era só escondida, então uma
// falha de assinatura ficava indistinguível de "não há foto" — e o
// usuário via um card sem nada, sem pista do que aconteceu. Agora
// sobra um sinal na tela e um aviso no console.
function _fotoFalhou(el) {
  el.removeAttribute('data-foto-privada')
  const fb = el.dataset.fotoFallback

  if (el.tagName === 'A') {
    // Link sem href não faz nada ao ser clicado — pior que não existir.
    el.removeAttribute('target')
    el.style.cursor = 'default'
    return
  }
  if (el.tagName !== 'IMG') return

  const span = document.createElement('span')
  span.style.cssText = el.getAttribute('style') || ''
  span.style.display = 'inline-flex'
  span.style.alignItems = 'center'
  span.style.justifyContent = 'center'
  if (fb) {
    span.className = 'sidebar-avatar'
    span.textContent = fb
  } else {
    span.style.background = 'rgba(0,0,0,.06)'
    span.style.color = '#9CA3AF'
    span.style.fontSize = '10px'
    span.style.textAlign = 'center'
    span.style.lineHeight = '1.2'
    span.textContent = 'foto indisponível'
    span.title = 'Não foi possível carregar a foto. Verifique a conexão e recarregue a página.'
  }
  el.replaceWith(span)
}

// ── Aliases de compatibilidade — módulo Frota ──────────────────
// O helper nasceu como js/frota-fotos.js e é chamado por estes nomes
// em ~65 pontos do módulo. Manter os aliases evita churn sem criar uma
// segunda implementação: são o MESMO objeto de função, não uma cópia.
const frotaFotoRef        = fotoRef
const frotaFotoAttr       = fotoAttr
const frotaFotoUrlAssinada = fotoUrlAssinada
const frotaAssinarFotos   = assinarFotos
