// ── SIGUC — compartilhar arquivo gerado no app (PDF/imagem) ────────
// 3 camadas, da melhor pra pior experiência:
// 1) App nativo (Capacitor): grava no cache e abre a folha nativa de
//    compartilhamento (plugins Filesystem + Share).
// 2) Navegador/PWA com Web Share API de arquivos (Chrome/Android,
//    Safari/iOS).
// 3) Fallback: baixa o arquivo (<a download>) e avisa por toast.
//
// Extraído de js/biomonitor-relatorio-campo.js nesta entrega — a
// Qualidade da Água (ficha de coleta em PDF) virou o 2º consumidor da
// mesma lógica, mesma lição de js/frota-consumo.js: na segunda vez
// que o mesmo bloco reaparece, centraliza em vez de copiar.
//
// `avisoFallback(mensagem)` só é chamado no caminho 3 — cada app usa
// sua própria função de toast (toast() em config.js, bioToast() no
// Biomonitor), então quem chama decide como avisar em vez deste
// arquivo depender de um toast específico.

function _compArqBlobParaBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onloadend = () => resolve(String(reader.result).split(',')[1])
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}

async function compartilharArquivo(blob, filename, titulo, avisoFallback) {
  const nativo = window.Capacitor?.isNativePlatform?.() && window.Capacitor?.Plugins?.Filesystem && window.Capacitor?.Plugins?.Share
  if (nativo) {
    try {
      const base64 = await _compArqBlobParaBase64(blob)
      const { Filesystem, Share } = window.Capacitor.Plugins
      const gravado = await Filesystem.writeFile({ path: filename, data: base64, directory: 'CACHE' })
      await Share.share({ title: titulo, url: gravado.uri, dialogTitle: titulo })
      return
    } catch (e) {
      console.warn('[compartilhar-arquivo] nativo falhou, tentando alternativa:', e)
    }
  }

  const file = new File([blob], filename, { type: blob.type || 'application/octet-stream' })
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: titulo })
      return
    } catch (e) {
      if (e?.name === 'AbortError') return
      console.warn('[compartilhar-arquivo] navigator.share falhou, baixando:', e)
    }
  }

  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 30000)
  avisoFallback?.('Arquivo baixado — envie manualmente pelo WhatsApp ou e-mail.')
}
