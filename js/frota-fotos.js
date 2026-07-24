// ── SIGUC Frota — exibição de fotos com URL assinada ───────────
//
// Os buckets do módulo Frota são privados (migration 200): a URL
// pública não serve mais o arquivo. Quem exibe foto precisa gerar uma
// signed URL, o que é uma chamada de rede assíncrona — e o resto do
// módulo monta tela com template literal síncrono.
//
// Padrão adotado (o mesmo de bIconsAplicar, em js/config.js): o
// render continua síncrono e só marca o elemento com
// `data-frota-foto`; depois de jogar o HTML na tela, chama-se
// `frotaAssinarFotos(container)`, que resolve tudo de uma vez —
// agrupando por bucket, uma chamada por bucket em vez de uma por
// imagem.
//
// O que fica gravado no banco (foto_url, foto_cupom_url, fotos_urls)
// continua sendo a URL pública: ela deixa de servir o arquivo mas
// segue valendo como endereço, e é dela que se extrai bucket +
// caminho. Assim as linhas antigas continuam funcionando sem
// migração de dados.

const FROTA_FOTO_TTL = 3600 // 1 h — cobre a sessão de uma tela sem re-assinar

// URL pública gravada no banco → { bucket, path }.
// Formato: .../storage/v1/object/public/<bucket>/<caminho>[?query]
// A query existe porque o app anexa ?t=<timestamp> ao trocar a foto
// do motorista (cache-busting) — precisa ser descartada.
function frotaFotoRef(url) {
  if (!url || typeof url !== 'string') return null
  const m = url.match(/\/storage\/v1\/object\/(?:public\/)?([^/]+)\/(.+)$/)
  if (!m) return null
  const bucket = m[1]
  const path = decodeURIComponent(m[2].split('?')[0].split('#')[0])
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
function frotaFotoAttr(url, fallback) {
  const ref = frotaFotoRef(url)
  if (!ref) return ''
  const fb = fallback ? ` data-frota-fallback="${esc(fallback)}"` : ''
  return `data-frota-foto="${esc(ref.bucket + '|' + ref.path)}"${fb}`
}

// Assina UMA URL — para uso imperativo (definir .src na mão, abrir em
// nova aba). Devolve null se não der para assinar; o chamador decide o
// que fazer. Nos casos em massa prefira frotaAssinarFotos, que agrupa
// por bucket em vez de uma chamada por foto.
async function frotaFotoUrlAssinada(url) {
  const ref = frotaFotoRef(url)
  if (!ref || !window.db) return null
  try {
    const { data, error } = await db.storage.from(ref.bucket).createSignedUrl(ref.path, FROTA_FOTO_TTL)
    if (error) throw error
    return data?.signedUrl || null
  } catch (e) {
    console.warn('[frota-fotos] falha ao assinar', ref.bucket, e?.message || e)
    return null
  }
}

// Assina tudo que estiver marcado dentro de `root` (ou do documento).
// Em <img> preenche src; em <a> preenche href; em qualquer outro
// elemento, define como background-image.
async function frotaAssinarFotos(root) {
  const alvo = (typeof root === 'string' ? document.getElementById(root) : root) || document
  const els = Array.from(alvo.querySelectorAll('[data-frota-foto]'))
  if (!els.length || !window.db) return

  // Agrupa por bucket: uma chamada de rede por bucket, não por foto.
  const porBucket = new Map()
  for (const el of els) {
    const [bucket, ...resto] = (el.dataset.frotaFoto || '').split('|')
    const path = resto.join('|')
    if (!bucket || !path) continue
    if (!porBucket.has(bucket)) porBucket.set(bucket, [])
    porBucket.get(bucket).push({ el, path })
  }

  await Promise.all(Array.from(porBucket.entries()).map(async ([bucket, itens]) => {
    let assinadas = {}
    try {
      const paths = [...new Set(itens.map(i => i.path))]
      const { data, error } = await db.storage.from(bucket).createSignedUrls(paths, FROTA_FOTO_TTL)
      if (error) throw error
      for (const d of (data || [])) {
        if (d?.signedUrl && !d.error) assinadas[d.path] = d.signedUrl
      }
    } catch (e) {
      console.warn('[frota-fotos] falha ao assinar', bucket, e?.message || e)
    }
    for (const { el, path } of itens) {
      const url = assinadas[path]
      if (url) _frotaAplicarUrl(el, url)
      else _frotaFalhouFoto(el)
    }
  }))
}

function _frotaAplicarUrl(el, url) {
  el.removeAttribute('data-frota-foto')
  if (el.tagName === 'IMG') {
    // Se a imagem ainda assim não carregar (URL expirada numa tela
    // aberta há muito tempo), cai no mesmo fallback.
    el.addEventListener('error', () => _frotaFalhouFoto(el), { once: true })
    el.src = url
  } else if (el.tagName === 'A') {
    el.href = url
  } else {
    el.style.backgroundImage = `url("${url}")`
  }
}

// Sem foto exibível: troca por iniciais quando o chamador informou o
// fallback (avatares), senão só esconde — melhor um espaço vazio que
// um ícone de imagem quebrada.
function _frotaFalhouFoto(el) {
  el.removeAttribute('data-frota-foto')
  const fb = el.dataset.frotaFallback
  if (fb && el.tagName === 'IMG') {
    const span = document.createElement('span')
    span.className = 'sidebar-avatar'
    span.style.cssText = el.getAttribute('style') || ''
    span.style.display = 'inline-flex'
    span.style.alignItems = 'center'
    span.style.justifyContent = 'center'
    span.textContent = fb
    el.replaceWith(span)
    return
  }
  if (el.tagName === 'IMG') el.style.display = 'none'
}
