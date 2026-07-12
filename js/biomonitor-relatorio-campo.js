// ── SIGUC Biomonitor — PDF de campo (app) + compartilhar ───────────
// Gera a ficha resumida de UM ninho (modo 'resumido' de
// js/biomonitor-relatorio-ninho.js — sem fotos, sem biometria individual
// por filhote) e entrega um PDF de verdade (não window.print()) para
// compartilhar direto por WhatsApp/e-mail a partir do card de "Ninhos
// abertos". Exige conexão (mesmo padrão de degradação do resto do app).
// Depende de: bioSupabase(), bioToast() (biomonitor-quelonios.js/sync.js);
// bioColetarDadosRelatorioNinhos(), _biorelGerarHTML() (biomonitor-relatorio-ninho.js);
// html2pdf.js carregado sob demanda via CDN.

const BIOCAMPO_CAB_PADRAO = {
  governo: 'Governo do Estado do Acre', gestao: '',
  secretaria: 'Secretaria de Estado do Meio Ambiente do Acre', siglaSecr: 'SEMA-AC',
  diretoria: 'Diretoria de Meio Ambiente', siglaDiret: 'DIMA',
  departamento: 'Departamento de Biodiversidade', siglaDep: 'DEBIO',
  logoGoverno: null, logoSecr: null,
}

// ── html2pdf.js sob demanda (só quando o botão é usado) ─────────────
let _biocampoHtml2pdfPromise = null
function _biocampoCarregarHtml2pdf() {
  if (window.html2pdf) return Promise.resolve()
  if (_biocampoHtml2pdfPromise) return _biocampoHtml2pdfPromise
  _biocampoHtml2pdfPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = 'https://cdn.jsdelivr.net/npm/html2pdf.js@0.10.2/dist/html2pdf.bundle.min.js'
    s.onload = resolve
    s.onerror = () => reject(new Error('Não foi possível carregar o gerador de PDF — verifique a conexão.'))
    document.head.appendChild(s)
  })
  return _biocampoHtml2pdfPromise
}

function _biocampoBlobParaBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onloadend = () => resolve(String(reader.result).split(',')[1])
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}

// ── Compartilhar o arquivo já gerado ────────────────────────────────
// 1) App nativo (Capacitor/APK): grava no cache e abre a folha nativa de
//    compartilhamento (WhatsApp, e-mail, etc. aparecem automaticamente).
// 2) Navegador/PWA com Web Share API de arquivos (Chrome/Android, Safari/iOS).
// 3) Fallback: baixa o PDF e orienta o envio manual.
async function bioCompartilharArquivo(blob, filename, titulo) {
  const nativo = window.Capacitor?.isNativePlatform?.() && window.Capacitor?.Plugins?.Filesystem && window.Capacitor?.Plugins?.Share
  if (nativo) {
    try {
      const base64 = await _biocampoBlobParaBase64(blob)
      const { Filesystem, Share } = window.Capacitor.Plugins
      const gravado = await Filesystem.writeFile({ path: filename, data: base64, directory: 'CACHE' })
      await Share.share({ title: titulo, url: gravado.uri, dialogTitle: 'Compartilhar ficha do ninho' })
      return
    } catch (e) {
      console.warn('[biomonitor] compartilhamento nativo falhou, tentando alternativa:', e)
    }
  }

  const file = new File([blob], filename, { type: 'application/pdf' })
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: titulo })
      return
    } catch (e) {
      if (e?.name === 'AbortError') return
      console.warn('[biomonitor] navigator.share falhou, baixando arquivo:', e)
    }
  }

  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 30000)
  bioToast('PDF baixado — envie manualmente pelo WhatsApp ou e-mail.', '')
}

// Logos institucionais (mesmas de config_sistema.dados.logos usadas na tela
// de login do app — aqui a variante colorida normal, para fundo branco).
async function _biocampoBuscarLogos() {
  try {
    const { data } = await bioSupabase().from('config_sistema').select('dados').eq('id', 1).single()
    const logos = data?.dados?.logos
    return { logoGoverno: logos?.governo_url || null, logoSecr: logos?.secretaria_url || null }
  } catch (e) {
    console.warn('[biomonitor] logos institucionais indisponíveis para o PDF:', e)
    return { logoGoverno: null, logoSecr: null }
  }
}

// ── Ponto de entrada: botão "Gerar PDF" no card do ninho ────────────
async function bioGerarPDFCampo(n) {
  if (!navigator.onLine) { bioToast('Requer conexão para gerar o PDF.', 'err'); return }
  bioToast('Gerando PDF…', '')

  let container
  try {
    const [ninhos, logos] = await Promise.all([
      bioColetarDadosRelatorioNinhos(bioSupabase(), [n.id], { modo: 'resumido' }),
      _biocampoBuscarLogos(),
    ])
    if (!ninhos.length) { bioToast('Ninho não encontrado.', 'err'); return }
    const ninho = ninhos[0]

    const cab = {
      ...BIOCAMPO_CAB_PADRAO,
      ...logos,
      responsavel: { nome: BioApp.monitor?.nome_completo || 'Monitor de campo', orgao: 'SEMA-AC' },
    }
    const protocolo = 'CAMPO-' + new Date().toISOString().slice(0, 10).replace(/-/g, '')
    const html = await _biorelGerarHTML(ninhos, cab, protocolo, 'resumido')

    // Renderiza fora da tela (mesmas classes/estilos rel-a4 já usados no
    // preview de impressão da web) para o html2canvas capturar.
    container = document.createElement('div')
    container.style.cssText = 'position:fixed;left:-9999px;top:0;background:#fff'
    container.innerHTML = html
    document.body.appendChild(container)

    const imgs = [...container.querySelectorAll('img')]
    if (imgs.length) {
      await Promise.allSettled(imgs.map(img =>
        img.complete ? Promise.resolve() :
        new Promise(r => { img.onload = r; img.onerror = r; setTimeout(r, 5000) })
      ))
    }

    await _biocampoCarregarHtml2pdf()

    const folha = container.querySelector('.rel-a4')
    const filename = `ficha-ninho-${String(ninho.numero_ninho || ninho.id).replace(/[^\w-]+/g, '-')}.pdf`
    const blob = await window.html2pdf().set({
      margin: 0,
      filename,
      image: { type: 'jpeg', quality: 0.92 },
      html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff' },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
    }).from(folha).outputPdf('blob')

    await bioCompartilharArquivo(blob, filename, `Ficha do ninho ${ninho.numero_ninho}`)
  } catch (e) {
    console.error('[biomonitor] gerar PDF de campo:', e)
    bioToast('Erro ao gerar PDF: ' + e.message, 'err')
  } finally {
    container?.remove()
  }
}
