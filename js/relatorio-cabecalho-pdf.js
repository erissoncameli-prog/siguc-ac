// ── SIGUC-AC · Cabeçalho institucional dos relatórios em PDF (jsPDF) ─
// Fonte única do timbre desenhado com jsPDF (logo Acre + logo SEMA +
// texto institucional + protocolo) — mesma lição de js/frota-consumo.js
// e js/mapa-recorte.js: antes cada relatório (Água, Biomonitor) tinha
// sua própria cópia de _*pdfDesenharCabecalhoPagina, e as duas tinham
// o MESMO defeito — pdf.addImage(logo, fmt, x, y, 11, 11) força
// qualquer logo (não quadrada) num quadrado fixo, espremendo a
// proporção real da imagem, com as duas logos empilhadas do lado
// esquerdo. Corrigido aqui de uma vez: a logo do Governo do Acre fica
// na margem esquerda, a da SEMA na margem direita, cada uma mantendo
// a proporção original (jsPDF getImageProperties → encaixa dentro de
// uma caixa máxima, nunca estica). Regra vale para TODO relatório em
// PDF novo — chamar relatorioPdfDesenharCabecalho() em vez de
// reimplementar o desenho do timbre numa página nova.
//
// Depende só de jsPDF já carregado (pdf.getImageProperties/addImage) —
// sem dependência de domínio de nenhum módulo.

const RELPDF_LOGO_MAX_LARGURA = 20 // mm
const RELPDF_LOGO_MAX_ALTURA = 11  // mm

function _relpdfFormatoImg(dataUrl) {
  return /^data:image\/jpe?g/i.test(dataUrl || '') ? 'JPEG' : 'PNG'
}

// Encaixa a logo dentro de RELPDF_LOGO_MAX_LARGURA×RELPDF_LOGO_MAX_ALTURA
// preservando a proporção real (equivalente a object-fit:contain) —
// nunca deforma a imagem.
function _relpdfEncaixarLogo(pdf, dataUrl) {
  if (!dataUrl) return null
  const props = pdf.getImageProperties(dataUrl)
  const razao = props.width / props.height
  let w = RELPDF_LOGO_MAX_LARGURA, h = w / razao
  if (h > RELPDF_LOGO_MAX_ALTURA) { h = RELPDF_LOGO_MAX_ALTURA; w = h * razao }
  return { w, h, fmt: _relpdfFormatoImg(dataUrl) }
}

// Desenha o cabeçalho institucional no topo da página ATUAL do jsPDF.
// opts: { margem, corFloresta, corMuted, corMuted2, cab, protocolo,
//         logos: { gov, secr } (dataURL), nomePlataforma, linhaModulo }
function relatorioPdfDesenharCabecalho(pdf, opts) {
  const { margem, corFloresta, corMuted, corMuted2, cab, protocolo, logos, nomePlataforma, linhaModulo } = opts
  const W = pdf.internal.pageSize.getWidth()
  const topo = 8

  const boxGov = _relpdfEncaixarLogo(pdf, logos?.gov)
  const boxSecr = _relpdfEncaixarLogo(pdf, logos?.secr)

  // Acre na margem esquerda, SEMA na margem direita — nunca as duas
  // do mesmo lado. Centralizadas verticalmente na faixa reservada.
  if (boxGov) pdf.addImage(logos.gov, boxGov.fmt, margem, topo + (RELPDF_LOGO_MAX_ALTURA - boxGov.h) / 2, boxGov.w, boxGov.h)
  if (boxSecr) pdf.addImage(logos.secr, boxSecr.fmt, W - margem - boxSecr.w, topo + (RELPDF_LOGO_MAX_ALTURA - boxSecr.h) / 2, boxSecr.w, boxSecr.h)

  // Texto institucional centralizado no espaço entre as duas logos.
  const xEsq = margem + (boxGov ? boxGov.w + 4 : 0)
  const xDir = W - margem - (boxSecr ? boxSecr.w + 4 : 0)
  const centro = (xEsq + xDir) / 2
  pdf.setFont('DMSans', 'bold'); pdf.setFontSize(10.5); pdf.setTextColor(...corFloresta)
  pdf.text(`${cab.secretaria} — ${cab.siglaSecr}`, centro, topo + 4.5, { align: 'center' })
  pdf.setFont('DMSans', 'normal'); pdf.setFontSize(7.5); pdf.setTextColor(...corMuted)
  pdf.text(linhaModulo, centro, topo + 8.5, { align: 'center' })

  // Plataforma/protocolo: com a logo da SEMA ocupando o canto superior
  // direito, o texto vai acima dela (faixa livre entre o topo da
  // página e o início das logos), sempre alinhado à margem direita.
  pdf.setFont('DMSans', 'normal'); pdf.setFontSize(7); pdf.setTextColor(...corMuted2)
  pdf.text(nomePlataforma, W - margem, 4, { align: 'right' })
  pdf.text('Prot. ' + protocolo, W - margem, 7.2, { align: 'right' })

  pdf.setDrawColor(...corFloresta); pdf.setLineWidth(0.6)
  pdf.line(margem, topo + RELPDF_LOGO_MAX_ALTURA + 3, W - margem, topo + RELPDF_LOGO_MAX_ALTURA + 3)
}
