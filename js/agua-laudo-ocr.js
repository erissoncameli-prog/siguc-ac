// ── SIGUC Qualidade da Água — leitura assistida do laudo em PDF ──
// Entrega 2 do plano em docs/qualidade-agua/plano-leitura-laudo-e-alertas.md.
//
// O QUE ESTE ARQUIVO FAZ E O QUE ELE NUNCA FAZ
// Lê o PDF do laboratório (imagem escaneada — Achado da Entrega 2:
// os laudos reais do QUILAB não têm camada de texto, são
// digitalização de mesa scanner) e PROPÕE valores, com o recorte da
// imagem de cada célula ao lado. NUNCA grava nada sozinho — quem
// grava é sempre agua_atualizar_coleta, chamada pela página depois
// que o técnico confirma campo a campo. Extração determinística
// (recorte por posição + OCR), nunca por LLM — o laudo é documento de
// prova, um número plausível que não está no papel seria o pior modo
// de falha possível aqui.
//
// POR QUE MOSTRAR O RECORTE DA IMAGEM, NUNCA O TEXTO OCR
// Achado real, medido nesta entrega: OCR de célula limpa leu "3,17"
// como "3,47" (1↔4) sem nenhum sinal de baixa confiança que
// distinguisse o erro dos acertos ao redor. Reexibir o TEXTO lido
// esconderia esse erro atrás de uma aparência de certeza. Reexibir o
// RECORTE deixa o técnico comparar com o próprio olho — é a única
// defesa que funciona contra esse modo de falha.
//
// CASAS DECIMAIS SÃO DO TEMPLATE, NUNCA DO OCR — ver cabeçalho da
// migration 304/305: o glifo da vírgula é pequeno demais em 300 dpi
// para o OCR situar com segurança. Este módulo lê só os DÍGITOS da
// célula e insere o separador na posição fixa que o template declara.
//
// CARREGAMENTO SOB DEMANDA — pdf.js (~1,7 MB) e tesseract.js
// (~8 MB, core wasm + traineddata pt) só entram quando o técnico
// escolhe um arquivo PDF, nunca no carregamento normal da tela
// (mesmo padrão do motor de PDF do Biomonitor/Água — ver
// js/agua-relatorio-pdf.js).

// O gabarito (agua_laudo_templates.campos) foi calibrado a 300 dpi
// sobre uma página A4 real (595 × 841 pt — conferido com `pdfinfo`
// contra o PDF de origem). pdf.js renderiza em PONTOS (72 dpi); a
// escala tem de ser CALCULADA a partir da largura real da página de
// CADA PDF, nunca uma constante fixa — um laudo escaneado em Letter
// (612 pt) ou com margem diferente quebraria silenciosamente se a
// escala fosse fixa (achado ao testar em navegador de verdade: as
// coordenadas do gabarito são FRAÇÃO da página, então a escala em si
// não precisa bater com 300 dpi exato — só precisa ser CONSISTENTE
// para o pdf.js gerar um canvas onde as frações calibradas caem no
// lugar certo, o que só é verdade renderizando na largura real da
// página, não numa constante).
// Renderiza a 2x a largura de referência do gabarito (600 dpi
// equivalentes) — mais pixels por glifo reduz a sensibilidade a
// diferenças sub-pixel entre o decodificador JPEG do navegador e o
// do poppler (usado na calibração offline). As COORDENADAS do
// gabarito são fração da página, então são invariantes à escala; só
// a nitidez muda. Medido: melhora casos limítrofes sem mudar o
// resultado dos campos que já liam bem.
const AGUA_LAUDO_LARGURA_REF_PX = 2480 * 2

let _pdfjsCarregado = null
let _tesseractWorker = null

function aguaLaudoDisponivel() {
  return typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined' || typeof document !== 'undefined'
}

async function _carregarPdfjs() {
  if (_pdfjsCarregado) return _pdfjsCarregado
  _pdfjsCarregado = import('/js/vendor/pdfjs/pdf.min.mjs').then(mod => {
    mod.GlobalWorkerOptions.workerSrc = '/js/vendor/pdfjs/pdf.worker.min.mjs'
    return mod
  })
  return _pdfjsCarregado
}

async function _carregarTesseract() {
  if (_tesseractWorker) return _tesseractWorker
  const tessMod = await import('/js/vendor/tesseract/tesseract.esm.min.js')
  const createWorker = tessMod.createWorker || tessMod.default.createWorker
  const worker = await createWorker('por', 1, {
    workerPath: '/js/vendor/tesseract/tesseract-worker.min.js',
    corePath: '/js/vendor/tesseract',
    langPath: '/js/vendor/tesseract',
    gzip: true,
  })
  // Calibragem medida nesta entrega (§ migration 305): whitelist
  // numérico + PSM de bloco único — o que deu 40/42 acertos nas 3
  // páginas reais testadas. Trocado por chamada quando o campo é de
  // texto livre (identidade), ver _ocrTexto.
  await worker.setParameters({ tessedit_char_whitelist: '0123456789,.<->' })
  _tesseractWorker = worker
  return worker
}

// ── Renderiza a página do PDF num canvas, na escala do gabarito ──
async function _renderizarPagina(arquivo, numeroPagina = 1) {
  const pdfjs = await _carregarPdfjs()
  const buf = await arquivo.arrayBuffer()
  const doc = await pdfjs.getDocument({ data: buf }).promise
  const pagina = await doc.getPage(numeroPagina)
  const viewportBase = pagina.getViewport({ scale: 1 })   // em pontos (72 dpi)
  const escala = AGUA_LAUDO_LARGURA_REF_PX / viewportBase.width
  const viewport = pagina.getViewport({ scale: escala })
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(viewport.width)
  canvas.height = Math.round(viewport.height)
  const ctx = canvas.getContext('2d')
  await pagina.render({ canvasContext: ctx, viewport }).promise
  return { canvas, paginas: doc.numPages }
}

// Recorta uma caixa (fração 0..1 da página) do canvas renderizado e
// devolve outro canvas só com aquele pedaço.
function _recortar(canvasOrigem, caixa) {
  const w = canvasOrigem.width, h = canvasOrigem.height
  const x = Math.round(caixa.left * w), y = Math.round(caixa.top * h)
  const cw = Math.round(caixa.width * w), ch = Math.round(caixa.height * h)
  const destino = document.createElement('canvas')
  destino.width = Math.max(1, cw)
  destino.height = Math.max(1, ch)
  destino.getContext('2d').drawImage(canvasOrigem, x, y, cw, ch, 0, 0, destino.width, destino.height)
  return destino
}

// ── OCR de um valor numérico (whitelist já ativo no worker) ──
async function _ocrNumero(worker, canvasRecorte) {
  const { data } = await worker.recognize(canvasRecorte)
  return { texto: (data.text || '').trim(), confianca: data.confidence ?? 0 }
}

// ── OCR de texto livre (identidade) — sem whitelist, PSM de linha ──
async function _ocrTexto(worker, canvasRecorte) {
  await worker.setParameters({ tessedit_char_whitelist: '', tessedit_pageseg_mode: '7' })
  const { data } = await worker.recognize(canvasRecorte)
  await worker.setParameters({ tessedit_char_whitelist: '0123456789,.<->', tessedit_pageseg_mode: '3' })
  return (data.text || '').trim()
}

// Converte o texto OCR de uma célula numérica no VALOR, usando
// SEMPRE a casa decimal do template — nunca a posição do separador
// que o OCR relatou (achado da migration 304/305: não é confiável).
// Detecta censurado ('<LQ'): metade do limite na coluna + o limite em
// `censurados` (decisão 3 do plano original, aplicada aqui pela
// primeira vez fora de digitação manual).
function aguaLaudoInterpretarValor(textoOcr, casasDecimais) {
  const bruto = (textoOcr || '').replace(/\s+/g, '')
  if (!bruto) return { valor: null, censurado: false, confiancaBaixa: true }

  const censurado = bruto.includes('<')
  const digitos = bruto.replace(/[^0-9]/g, '')
  if (!digitos) return { valor: null, censurado: false, confiancaBaixa: true }

  const negativo = bruto.trim().startsWith('-')
  const casas = Math.max(0, casasDecimais | 0)
  let inteiro = digitos.slice(0, Math.max(0, digitos.length - casas)) || '0'
  let decimal = digitos.slice(Math.max(0, digitos.length - casas)).padStart(casas, '0')
  const numero = parseFloat(`${inteiro}.${decimal || '0'}`) * (negativo ? -1 : 1)

  if (censurado) {
    // O laudo reportou "<LQ": a coluna guarda METADE do limite (mesma
    // regra de digitação manual — migration 248, decisão 3 do plano),
    // e o limite fica em `censurados` para o laudo continuar
    // reproduzível.
    return { valor: numero / 2, censurado: true, limiteDeteccao: numero, confiancaBaixa: false }
  }
  return { valor: numero, censurado: false, confiancaBaixa: false }
}

// ── Trava de identidade (§3.3 do plano) ───────────────────────
// Compara o que o PDF diz sobre a amostra com a coleta ABERTA na
// tela. Divergiu qualquer um: NÃO preenche nada — devolve o confronto
// para a tela mostrar. Normalização tolerante a acento/maiúscula
// porque é o laboratório digitando à mão, não um sistema.
function _normalizar(s) {
  return (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()
}

function aguaLaudoConferirIdentidade(lido, coletaAberta, ponto) {
  const problemas = []

  // Data da coleta: dd/mm/aaaa no laudo × data_coleta (ISO) na tela.
  const m = (lido.data_coleta || '').match(/(\d{2})\/(\d{2})\/(\d{4})/)
  if (m && coletaAberta.data_coleta) {
    const doPdf = `${m[3]}-${m[2]}-${m[1]}`
    if (doPdf !== coletaAberta.data_coleta) {
      problemas.push({ campo: 'data_coleta', pdf: `${m[1]}/${m[2]}/${m[3]}`, tela: coletaAberta.data_coleta })
    }
  } else if (coletaAberta.data_coleta) {
    problemas.push({ campo: 'data_coleta', pdf: lido.data_coleta || '(não lido)', tela: coletaAberta.data_coleta, semData: true })
  }

  // Procedência: precisa mencionar o nome do ponto OU o rio OU algum
  // alias — nunca o inverso (o laudo escreve livre, "Rio X / Bairro
  // Y"), então basta achar QUALQUER identificador do ponto no texto.
  const texto = _normalizar(lido.procedencia)
  const candidatos = [ponto?.nome, ponto?.rio, ponto?.municipio, ...(ponto?.codigos_alias || [])]
    .filter(Boolean).map(_normalizar)
  const bate = candidatos.some(c => c && (texto.includes(c) || c.includes(texto)))
  if (!bate && texto) {
    problemas.push({ campo: 'procedencia', pdf: lido.procedencia || '(não lido)', tela: `${ponto?.nome || ''} (${ponto?.rio || ''})` })
  }

  return { ok: problemas.length === 0, problemas }
}

// ── Orquestra o pipeline inteiro ──────────────────────────────
// `template` vem de agua_laudo_templates.campos/campos_identidade
// (RPC/select já feito pela página). `coletaAberta`/`ponto` são o que
// a tela de lançamento já tem carregado — nunca uma consulta nova.
// Devolve SEMPRE os recortes em dataURL (para a conferência lado a
// lado) e NUNCA grava nada.
async function aguaLaudoProcessarPdf(arquivo, { template, coletaAberta, ponto, onProgresso } = {}) {
  onProgresso?.('Abrindo o PDF…')
  const { canvas } = await _renderizarPagina(arquivo)

  onProgresso?.('Lendo a identificação da amostra…')
  const worker = await _carregarTesseract()
  const lidoIdentidade = {}
  const recortesIdentidade = {}
  for (const [campo, caixa] of Object.entries(template.campos_identidade || {})) {
    const canvasRecorte = _recortar(canvas, caixa)
    lidoIdentidade[campo] = await _ocrTexto(worker, canvasRecorte)
    recortesIdentidade[campo] = canvasRecorte.toDataURL('image/png')
  }

  const identidade = aguaLaudoConferirIdentidade(lidoIdentidade, coletaAberta || {}, ponto || {})

  const campos = {}
  const total = Object.keys(template.campos || {}).length
  let i = 0
  for (const [campo, caixa] of Object.entries(template.campos || {})) {
    i++
    onProgresso?.(`Lendo parâmetros… (${i}/${total})`)
    const canvasRecorte = _recortar(canvas, caixa)
    const { texto, confianca } = await _ocrNumero(worker, canvasRecorte)
    const interpretado = aguaLaudoInterpretarValor(texto, caixa.casas_decimais)
    campos[campo] = {
      ...interpretado,
      textoLido: texto,
      confianca,
      recorteDataURL: canvasRecorte.toDataURL('image/png'),
    }
  }

  return {
    identidade: { ...identidade, lido: lidoIdentidade, recortes: recortesIdentidade },
    campos,
    numeroLaudo: lidoIdentidade.numero_laudo || null,
  }
}

// Libera o worker do Tesseract (a página deve chamar ao fechar o
// modal — o worker fica ~8 MB de wasm carregado em memória).
async function aguaLaudoLiberar() {
  if (_tesseractWorker) {
    await _tesseractWorker.terminate()
    _tesseractWorker = null
  }
}
