// ── SIGUC Biomonitor — Ficha PDF de ninho (cadastro → soltura) ─────
// Gera o PDF de um ou vários ninhos, com a linha do tempo completa
// (postura → transferências → visitas → eclosão → berçário/soltura,
// incluindo filhotes individuais e biometrias) desenhado direto com
// jsPDF (texto/tabelas/imagens) — não é screenshot/print de HTML.
// Motivo: window.print() (CSS page-break) e html2canvas+html2pdf
// (fatia uma imagem inteira a cada 297mm) cortam cards/tabelas/gráficos
// no meio sempre que o conteúdo é mais alto que uma página. Desenhando
// com jsPDF, cada bloco checa o espaço restante e pula de página
// *antes* de começar — nunca no meio.
// Usada em pages/biomonitor-validacao.html (ficha individual),
// pages/relatorios-biomonitor.html (individual, em lote — "todos os
// ninhos da praia" — e no PDF do Painel, que reaproveita os helpers
// _biopdf* daqui pra montar seu próprio conteúdo) e pages/biomonitor.html
// (app de campo, via js/biomonitor-relatorio-campo.js).
// Depende de: esc(), formatData() (js/config.js); getCabecalhoRelatorio(),
// gerarProtocolo() (js/config-sistema.js); bioBuscarEventosServidor(),
// bioMontarHistoricoNinho() (js/biomonitor-timeline.js);
// BIOPDF_FONT_REGULAR_B64/BIOPDF_FONT_BOLD_B64 (js/biomonitor-pdf-fonts.js);
// relatorioPdfDesenharCabecalho() (js/relatorio-cabecalho-pdf.js — timbre
// institucional, fonte única, compartilhada com o relatório da Água);
// jsPDF + jspdf-autotable, carregados sob demanda via CDN.

const BIOREL_ESPECIE = {
  tracaja: 'Tracajá', tartaruga: 'Tartaruga', cabecudo: 'Cabeçudo',
  pitiU: 'Pitiú', cupido: 'Cupido', jabuti_pe_elefante: 'Jabuti-pé-de-elefante',
  jabuti_piranga: 'Jabuti-piranga', mucua: 'Muçuã', outro: 'Outro',
}
const BIOREL_STATUS_NINHO = {
  encontrado: 'Encontrado', transferido: 'Transferido', eclodido: 'Eclodido',
  em_bercario: 'Em berçário', soltado: 'Soltado', perdido: 'Perdido',
}
const BIOREL_STATUS_VALID = {
  pendente: 'Pendente', validado: 'Validado', rejeitado: 'Rejeitado', em_correcao: 'Em correção',
}
const BIOREL_STATUS_FILHOTE = { ativo: 'Ativo', morto: 'Óbito', soltado: 'Soltado' }
const BIOREL_ANOMALIA_TIPO = {
  casco: 'Casco/carapaça deformada', membro: 'Membro ausente/atrofiado',
  corpo: 'Corpo/coluna deformada', albinismo: 'Albinismo', outro: 'Outro',
}
const BIOREL_TIPO_OCORR = {
  alimentacao: 'Alimentação', biometria: 'Biometria (amostragem)', mortalidade: 'Mortalidade',
  doenca: 'Doença', tratamento: 'Tratamento', observacao: 'Observação',
}

// Mesmas cores/rótulos do gráfico de rosca já usado em biomonitor-validacao.html
// (aba de aprovação de ninhos) — reaproveitados aqui para o desfecho dos ovos
// ficar visualmente consistente entre as duas telas.
const BIOREL_DONUT_COR = {
  vivos: '#2A9D6F', mortos: '#9CA3AF', predados: '#ef4444',
  natural: '#1A6B8C', humana: '#7B57B0', viaveis: '#C9A84C',
}
const BIOREL_DONUT_LBL = {
  vivos: 'Vivos', mortos: 'Mortos/não-nasc.', predados: 'Predados',
  natural: 'Perdidos (natural)', humana: 'Perdidos (humano)', viaveis: 'Viáveis (incubando)',
}

// Nome da plataforma mostrado no canto superior direito do cabeçalho — o
// nome/apps do sistema ainda podem mudar; troque só aqui quando acontecer.
const BIOREL_NOME_PLATAFORMA = 'Biomonitor'

const _biorelHora = h => h ? String(h).slice(0, 5) : ''

// ── Coleta de dados (servidor) ──────────────────────────────────────
// Reaproveita a mesma fonte/lógica da tela de validação (vw_ninhos_validacao
// + bioBuscarEventosServidor/bioMontarHistoricoNinho) e acrescenta o que
// falta para a ficha: fotos da eclosão, lotes de berçário com ocorrências,
// filhotes individuais e todas as suas biometrias, e a soltura (direta ou
// do lote).
// `opts.modo`: 'completo' (padrão, web — inclui fotos e biometria individual
// por filhote) ou 'resumido' (app de campo — pula fotos da eclosão e a
// biometria individual, mantendo identificação, timeline e destino dos
// filhotes em contagens agregadas; menos consultas, ficha mais leve/rápida).
async function bioColetarDadosRelatorioNinhos(db, ninhoIds, opts = {}) {
  const modo = opts.modo === 'resumido' ? 'resumido' : 'completo'
  const { data: ninhos, error } = await db.from('vw_ninhos_validacao')
    .select('*').in('id', ninhoIds).order('numero_ninho')
  if (error) throw error
  if (!ninhos?.length) return []

  const mapaEventos = await bioBuscarEventosServidor(db, ninhos)

  const [{ data: eclosoes }, { data: lotes }] = await Promise.all([
    modo === 'completo'
      ? db.from('eclosoes_ninho').select('ninho_id,foto_urls,observacoes').in('ninho_id', ninhoIds)
      : Promise.resolve({ data: [] }),
    db.from('lotes_bercario')
      .select('id,ninho_id,bercario_nome,data_entrada,hora_entrada,qtd_entrada,status,observacoes')
      .in('ninho_id', ninhoIds).order('data_entrada'),
  ])
  const loteIds = (lotes || []).map(l => l.id)

  const [{ data: ocorrencias }, { data: filhotes }, { data: solturas }] = await Promise.all([
    loteIds.length
      ? db.from('ocorrencias_bercario')
          .select('id,lote_id,tipo,data_ocorrencia,hora_ocorrencia,comprimento_medio_cm,peso_medio_g,n_amostrados,qtd_afetados,causa,descricao')
          .in('lote_id', loteIds).order('data_ocorrencia')
      : Promise.resolve({ data: [] }),
    loteIds.length
      ? db.from('filhotes_bercario')
          .select('id,lote_id,numero,status,data_obito,causa_obito,doente,anomalia,observacoes')
          .in('lote_id', loteIds).order('numero')
      : Promise.resolve({ data: [] }),
    db.from('solturas_filhotes')
      .select('ninho_id,lote_bercario_id,via_bercario,data_soltura,hora_soltura,qtd_soltada,mortalidade,local_descricao,predacao_soltura,observacoes')
      .in('ninho_id', ninhoIds),
  ])

  const filhoteIds = modo === 'completo' ? (filhotes || []).map(f => f.id) : []
  const { data: biometrias } = filhoteIds.length
    ? await db.from('biometrias_individuais')
        .select('individuo_id,data_medicao,hora_medicao,comprimento_cm,peso_g,largura_carapaca_cm,comprimento_plastrao_cm,observacoes')
        .in('individuo_id', filhoteIds).order('data_medicao')
    : { data: [] }

  return ninhos.map(n => {
    const eclosao = (eclosoes || []).find(e => e.ninho_id === n.id) || null
    const lotesN = (lotes || []).filter(l => l.ninho_id === n.id).map(l => ({
      ...l,
      ocorrencias: (ocorrencias || []).filter(o => o.lote_id === l.id),
      filhotes: (filhotes || []).filter(f => f.lote_id === l.id).map(f => ({
        ...f,
        biometrias: (biometrias || []).filter(b => b.individuo_id === f.id),
      })),
      soltura: (solturas || []).find(s => s.lote_bercario_id === l.id) || null,
    }))
    const solturaDireta = (solturas || []).find(s => s.ninho_id === n.id && !s.via_bercario) || null
    return {
      ...n,
      _eventos: bioMontarHistoricoNinho(n, mapaEventos[n.uuid_cliente]),
      _eclosaoFotos: eclosao?.foto_urls || [],
      _eclosaoObs: eclosao?.observacoes || '',
      _lotes: lotesN,
      _solturaDireta: solturaDireta,
    }
  })
}

// ── Formatação de texto reaproveitada nas tabelas do PDF ────────────
function _biorelDonutSegmentos(n) {
  if (n.qtd_ovos == null) return []
  const eclodiu = !!n.data_nascimento
  return [
    ['vivos',    eclodiu ? (n.filhotes_vivos || 0) : 0],
    ['mortos',   eclodiu ? ((n.filhotes_mortos || 0) + (n.ovos_nao_nascidos || 0)) : 0],
    ['predados', n.descartados_predacao || 0],
    ['natural',  n.descartados_natural || 0],
    ['humana',   n.descartados_humana || 0],
    ['viaveis',  !eclodiu ? (n.ovos_viaveis || 0) : 0],
  ].filter(([, v]) => v > 0)
}

function _biorelPontosCrescimento(ocorrencias, campo) {
  return (ocorrencias || [])
    .filter(o => o.tipo === 'biometria' && o[campo] != null)
    .slice()
    .sort((a, b) => (a.data_ocorrencia || '').localeCompare(b.data_ocorrencia || ''))
    .map(o => ({ v: o[campo], label: formatData(o.data_ocorrencia).slice(0, 5) }))
}

// Arredonda pra 1 casa (mesma precisão de numeric(5,1) no banco) — protege
// contra ponto flutuante (ex.: valores somados/derivados em JS antes de
// chegar aqui) estourando o texto/rótulo do gráfico com dígitos de sobra.
const _biopdfNum1 = v => (Math.round(v * 10) / 10).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })

function _biorelBiometriaTxt(b) {
  return [
    b.comprimento_cm != null ? `${_biopdfNum1(b.comprimento_cm)} cm compr.` : null,
    b.largura_carapaca_cm != null ? `${_biopdfNum1(b.largura_carapaca_cm)} cm larg.` : null,
    b.comprimento_plastrao_cm != null ? `${_biopdfNum1(b.comprimento_plastrao_cm)} cm plastrão` : null,
    b.peso_g != null ? `${_biopdfNum1(b.peso_g)} g` : null,
  ].filter(Boolean).join(' · ') || '—'
}

function _biorelOcorrenciaTxt(o) {
  if (o.tipo === 'biometria') {
    return [
      o.comprimento_medio_cm != null ? `${_biopdfNum1(o.comprimento_medio_cm)} cm médio` : null,
      o.peso_medio_g != null ? `${_biopdfNum1(o.peso_medio_g)} g médio` : null,
      o.n_amostrados ? `${o.n_amostrados} amostrados` : null,
    ].filter(Boolean).join(' · ') || o.descricao || '—'
  }
  if (o.tipo === 'mortalidade' || o.tipo === 'doenca') {
    return [`${o.qtd_afetados || 0} afetado(s)`, o.causa].filter(Boolean).join(' · ') + (o.descricao ? ' — ' + o.descricao : '')
  }
  return o.descricao || '—'
}

function _biorelSolturaTxt(s) {
  if (!s) return null
  return [
    `${s.qtd_soltada} filhote(s) soltos`,
    s.mortalidade ? `${s.mortalidade} morte(s) na soltura` : null,
    s.predacao_soltura ? 'predação observada na soltura' : null,
    s.local_descricao || null,
  ].filter(Boolean).join(' · ')
}

// Resumo agregado dos filhotes de um lote (usado no modo 'resumido' — app
// de campo — no lugar da tabela filhote-a-filhote com biometrias).
function _biorelFilhotesResumoTxt(filhotes) {
  const ativos  = filhotes.filter(f => f.status === 'ativo').length
  const mortos  = filhotes.filter(f => f.status === 'morto').length
  const soltos  = filhotes.filter(f => f.status === 'soltado').length
  const doentes  = filhotes.filter(f => f.doente).length
  const anomalos = filhotes.filter(f => f.anomalia).length
  return [
    `${filhotes.length} filhote(s) numerados`,
    ativos ? `${ativos} ativo(s)` : null,
    soltos ? `${soltos} já soltos` : null,
    mortos ? `${mortos} óbito(s)` : null,
    doentes ? `${doentes} doente(s)` : null,
    anomalos ? `${anomalos} com anomalia` : null,
  ].filter(Boolean).join(' · ')
}

/* ════════════════════════════════════════════════════════════════
   GERAÇÃO DO PDF (jsPDF) — layout, paginação e desenho
   ════════════════════════════════════════════════════════════════ */

const BIOPDF_M = 15        // margem lateral (mm)
const BIOPDF_TOPO = 26     // espaço reservado pro cabeçalho em toda página
const BIOPDF_RODAPE = 14   // espaço reservado pro rodapé em toda página
const BIOPDF_COR = {
  texto: [17, 24, 39], muted: [107, 114, 128], muted2: [156, 163, 175],
  floresta: [10, 26, 15], borda: [229, 231, 235], claro: [249, 250, 251],
}

function _biopdfHexParaRGB(hex) {
  const h = hex.replace('#', '')
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}

// ── Bibliotecas sob demanda (só quando o botão de gerar PDF é usado) ──
let _biopdfLibsPromise = null
function _biopdfCarregarLibs() {
  if (window.jspdf?.jsPDF && window.jspdf.jsPDF.API.autoTable) return Promise.resolve()
  if (_biopdfLibsPromise) return _biopdfLibsPromise
  const carregarScript = src => new Promise((res, rej) => {
    const s = document.createElement('script')
    s.src = src; s.onload = res; s.onerror = () => rej(new Error('Falha ao carregar ' + src + ' — verifique a conexão.'))
    document.head.appendChild(s)
  })
  _biopdfLibsPromise = carregarScript('https://cdn.jsdelivr.net/npm/jspdf@2.5.2/dist/jspdf.umd.min.js')
    .then(() => carregarScript('https://cdn.jsdelivr.net/npm/jspdf-autotable@3.8.4/dist/jspdf.plugin.autotable.min.js'))
  return _biopdfLibsPromise
}

// ── Imagens: logos institucionais e fotos (fetch → dataURL) ─────────
// Baixa a imagem para embutir no PDF. Desde a migration 210 as fotos
// de ninho vêm de bucket privado: fetch na URL crua devolve 400, então
// assina antes. O `|| url` cobre o que não é Storage privado — logo do
// governo (bucket config-logos, público) e qualquer URL externa.
async function _biopdfBuscarDataURL(url) {
  if (!url) return null
  try {
    const alvo = await fotoUrlAssinada(url) || url
    const r = await fetch(alvo)
    if (!r.ok) return null
    const blob = await r.blob()
    return await new Promise((res, rej) => {
      const fr = new FileReader()
      fr.onload = () => res(fr.result)
      fr.onerror = rej
      fr.readAsDataURL(blob)
    })
  } catch (e) { return null }
}

// Enquadra (cover) uma imagem num canvas de proporção fixa, igual ao
// object-fit:cover usado antes na grade de fotos em HTML.
function _biopdfImagemCover(dataUrl, larguraPx, alturaPx) {
  return new Promise(resolve => {
    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = larguraPx; canvas.height = alturaPx
      const c = canvas.getContext('2d')
      const escala = Math.max(larguraPx / img.naturalWidth, alturaPx / img.naturalHeight)
      const w = img.naturalWidth * escala, h = img.naturalHeight * escala
      c.drawImage(img, (larguraPx - w) / 2, (alturaPx - h) / 2, w, h)
      resolve(canvas.toDataURL('image/jpeg', 0.85))
    }
    img.onerror = () => resolve(null)
    img.src = dataUrl
  })
}

async function _biopdfPreCarregarFotos(n) {
  const urls = [...(n.foto_urls || []), ...(n._eclosaoFotos || [])]
  if (!urls.length) return []
  const brutos = await Promise.all(urls.map(u => _biopdfBuscarDataURL(u)))
  const validos = []
  for (const b of brutos) {
    if (b) validos.push(await _biopdfImagemCover(b, 400, 300))
  }
  return validos
}

// ── Gráficos: canvas 2D isolado (fora do DOM), viram imagem via toDataURL ──
function _biopdfDesenharDonutCanvas(segs, total) {
  const cv = document.createElement('canvas')
  cv.width = 220; cv.height = 220
  const c = cv.getContext('2d')
  const cx = 110, cy = 110, rOut = 102, rIn = 62, gap = 0.035
  let ang = -Math.PI / 2
  segs.forEach(([k, v]) => {
    const frac = v / total
    const a0 = ang + gap / 2, a1 = ang + frac * Math.PI * 2 - gap / 2
    if (a1 > a0) {
      c.beginPath(); c.arc(cx, cy, rOut, a0, a1); c.arc(cx, cy, rIn, a1, a0, true); c.closePath()
      c.fillStyle = BIOREL_DONUT_COR[k]; c.fill()
    }
    ang += frac * Math.PI * 2
  })
  c.fillStyle = '#111827'
  c.font = 'bold 46px DM Sans, Arial, sans-serif'
  c.textAlign = 'center'; c.textBaseline = 'middle'
  c.fillText(String(total), cx, cy)
  return cv.toDataURL('image/png')
}

function _biopdfDesenharLinhaCanvas(pontos, corHex, sufixo) {
  const cv = document.createElement('canvas')
  cv.width = 480; cv.height = 190
  const c = cv.getContext('2d')
  const W = cv.width, H = cv.height
  const padL = 10, padR = 74, padT = 20, padB = 26
  const vals = pontos.map(p => p.v)
  const min = Math.min(...vals), max = Math.max(...vals)
  const faixa = (max - min) || 1
  const x = i => padL + (i / (pontos.length - 1)) * (W - padL - padR)
  const y = v => padT + (1 - (v - min) / faixa) * (H - padT - padB)

  c.strokeStyle = '#e5e7eb'; c.lineWidth = 1
  c.beginPath(); c.moveTo(padL, H - padB); c.lineTo(W - padR, H - padB); c.stroke()

  c.strokeStyle = corHex; c.lineWidth = 4; c.lineJoin = 'round'; c.lineCap = 'round'
  c.beginPath()
  pontos.forEach((p, i) => { const px = x(i), py = y(p.v); i === 0 ? c.moveTo(px, py) : c.lineTo(px, py) })
  c.stroke()

  const last = pontos[pontos.length - 1]
  const lx = x(pontos.length - 1), ly = y(last.v)
  c.beginPath(); c.arc(lx, ly, 8, 0, Math.PI * 2); c.fillStyle = '#fff'; c.fill()
  c.beginPath(); c.arc(lx, ly, 5, 0, Math.PI * 2); c.fillStyle = corHex; c.fill()

  c.fillStyle = '#111827'
  c.font = 'bold 20px DM Sans, Arial, sans-serif'
  c.textAlign = 'left'; c.textBaseline = 'middle'
  c.fillText(`${_biopdfNum1(last.v)}${sufixo}`, lx + 10, ly)

  c.fillStyle = '#9ca3af'
  c.font = '13px DM Sans, Arial, sans-serif'
  c.textAlign = 'left'; c.fillText(pontos[0].label, padL, H - 6)
  c.textAlign = 'right'; c.fillText(last.label, W - padR, H - 6)
  return cv.toDataURL('image/png')
}

// ── Documento + contexto de paginação ────────────────────────────────
function _biopdfNovoDocumento() {
  const { jsPDF } = window.jspdf
  const pdf = new jsPDF({ unit: 'mm', format: 'a4', compress: true })
  pdf.addFileToVFS('DMSans-Regular.ttf', BIOPDF_FONT_REGULAR_B64)
  pdf.addFont('DMSans-Regular.ttf', 'DMSans', 'normal')
  pdf.addFileToVFS('DMSans-Bold.ttf', BIOPDF_FONT_BOLD_B64)
  pdf.addFont('DMSans-Bold.ttf', 'DMSans', 'bold')
  pdf.setFont('DMSans', 'normal')
  return pdf
}

function _biopdfCtx(pdf, cab, protocolo) {
  return {
    pdf, cab, protocolo,
    W: pdf.internal.pageSize.getWidth(),
    H: pdf.internal.pageSize.getHeight(),
    y: BIOPDF_TOPO,
    ninhoAtualTxt: null,
    paginaParaNinho: {},
  }
}

// Registra a que ninho pertence a página atual (usado no rodapé, na
// passada final) — chamado sempre que uma página nova é criada, seja
// por _biopdfNovaPagina ou pelo didDrawPage do autoTable.
function _biopdfRegistrarPagina(ctx) {
  ctx.paginaParaNinho[ctx.pdf.internal.getNumberOfPages()] = ctx.ninhoAtualTxt
}
function _biopdfNovaPagina(ctx) {
  ctx.pdf.addPage()
  ctx.y = BIOPDF_TOPO
  _biopdfRegistrarPagina(ctx)
}
// Pula de página *antes* de desenhar se o bloco não couber inteiro no
// espaço restante — é isso que evita cortar cards/tabelas/gráficos.
function _biopdfGarantirEspaco(ctx, altura) {
  if (ctx.y + altura > ctx.H - BIOPDF_RODAPE) _biopdfNovaPagina(ctx)
}

function _biopdfTitulo(ctx, texto) {
  _biopdfGarantirEspaco(ctx, 10)
  const { pdf } = ctx
  pdf.setFont('DMSans', 'bold'); pdf.setFontSize(9.5); pdf.setTextColor(...BIOPDF_COR.floresta)
  pdf.text(texto.toUpperCase(), BIOPDF_M, ctx.y)
  pdf.setDrawColor(...BIOPDF_COR.floresta); pdf.setLineWidth(0.5)
  pdf.line(BIOPDF_M, ctx.y + 1.8, ctx.W - BIOPDF_M, ctx.y + 1.8)
  ctx.y += 7
}

function _biopdfSubtitulo(ctx, texto) {
  _biopdfGarantirEspaco(ctx, 8)
  const { pdf } = ctx
  pdf.setFont('DMSans', 'bold'); pdf.setFontSize(8); pdf.setTextColor(...BIOPDF_COR.muted)
  pdf.text(texto.toUpperCase(), BIOPDF_M, ctx.y)
  ctx.y += 5
}

function _biopdfParagrafo(ctx, texto, opts = {}) {
  const { pdf } = ctx
  pdf.setFont('DMSans', 'normal'); pdf.setFontSize(8.3)
  pdf.setTextColor(...(opts.muted ? BIOPDF_COR.muted2 : BIOPDF_COR.texto))
  const linhas = pdf.splitTextToSize(texto, ctx.W - BIOPDF_M * 2)
  const altura = linhas.length * 4
  _biopdfGarantirEspaco(ctx, altura + 2)
  pdf.text(linhas, BIOPDF_M, ctx.y)
  ctx.y += altura + 3
}
const _biopdfParagrafoMuted = (ctx, texto) => _biopdfParagrafo(ctx, texto, { muted: true })

// Tabela (jspdf-autotable) — paginação e cabeçalho repetido já resolvidos
// pela própria lib; aqui só padronizamos o estilo e mantemos ctx.y coerente.
function _biopdfTabela(ctx, opts) {
  const { pdf } = ctx
  pdf.autoTable({
    startY: ctx.y,
    margin: { left: BIOPDF_M, right: BIOPDF_M, top: BIOPDF_TOPO, bottom: BIOPDF_RODAPE },
    styles: { font: 'DMSans', fontSize: 8.3, textColor: BIOPDF_COR.texto, cellPadding: 1.6, lineColor: BIOPDF_COR.borda, lineWidth: 0.1, overflow: 'linebreak' },
    headStyles: { fillColor: BIOPDF_COR.floresta, textColor: 255, fontStyle: 'bold', fontSize: 7.3 },
    alternateRowStyles: { fillColor: BIOPDF_COR.claro },
    didDrawPage: () => _biopdfRegistrarPagina(ctx),
    ...opts,
  })
  ctx.y = pdf.lastAutoTable.finalY + 5
}

// ── Seções ────────────────────────────────────────────────────────
function _biopdfSecaoIdentificacao(ctx, n) {
  _biopdfTitulo(ctx, 'Identificação e Postura')
  const linha = (l, v) => (v != null && v !== '') ? [l, String(v)] : null
  const gps = n.lat != null
    ? `${Number(n.lat).toFixed(5)}, ${Number(n.lng).toFixed(5)}${n.precisao_gps_m ? ` (±${n.precisao_gps_m} m)` : ''}`
    : 'Sem GPS registrado'
  const linhas = [
    linha('Espécie', BIOREL_ESPECIE[n.especie] || n.especie),
    linha('Praia de origem', n.praia_nome),
    (n.praia_atual_nome && n.praia_atual_nome !== n.praia_nome) ? linha('Praia atual', n.praia_atual_nome) : null,
    (n.numero_atual && n.numero_atual !== n.numero_ninho) ? linha('Nº na praia atual', n.numero_atual) : null,
    linha('Temporada', n.temporada_nome),
    linha('Monitor responsável', n.monitor_nome),
    linha('Grupo', n.grupo_nome),
    linha('Data/hora do encontro', `${formatData(n.data_encontro)}${n.hora_desova ? ' · ' + _biorelHora(n.hora_desova) : ''}`),
    linha('Coordenadas GPS', gps),
    n.dist_rio_m != null ? linha('Distância ao rio', `${n.dist_rio_m} m (${n.dist_rio_metodo === 'tracker' ? 'GPS tracker' : 'estimativa'})`) : null,
    (n.temperatura_c != null || n.umidade_pct != null || n.profundidade_cm != null) ? linha('Condições ambientais',
      [n.temperatura_c != null ? `${n.temperatura_c}°C` : null,
       n.umidade_pct != null ? `${n.umidade_pct}% umidade` : null,
       n.profundidade_cm != null ? `${n.profundidade_cm} cm de profundidade` : null].filter(Boolean).join(' · ')) : null,
    linha('Status do ninho', BIOREL_STATUS_NINHO[n.status] || n.status),
    linha('Status de validação', BIOREL_STATUS_VALID[n.status_validacao] || n.status_validacao),
    n.motivo_rejeicao ? linha('Motivo (rejeição/correção)', n.motivo_rejeicao) : null,
    n.data_prevista_eclosao ? linha('Previsão de eclosão', formatData(n.data_prevista_eclosao)) : null,
    (n.dias_antecipacao_estimados != null && n.dias_antecipacao_estimados >= 3) ? linha('Possível antecipação (temperatura)',
      `~${n.dias_antecipacao_estimados} dia(s) — nova estimativa ${formatData(n.data_prevista_eclosao_ajustada)} (média ${n.temp_media_observada}°C)`) : null,
  ].filter(Boolean)

  _biopdfTabela(ctx, {
    body: linhas, theme: 'plain',
    columnStyles: { 0: { fontStyle: 'bold', textColor: BIOPDF_COR.muted, cellWidth: 48 } },
  })
}

function _biopdfSecaoBalancoOvos(ctx, n) {
  _biopdfTitulo(ctx, 'Balanço de Ovos')
  _biopdfTabela(ctx, {
    head: [['Total na postura', 'Íntegros', 'Descartados no registro', 'Perdidos (depois)', 'Viáveis']],
    body: [[n.qtd_ovos ?? '—', n.ovos_integros ?? '—', n.ovos_descartados ?? 0, n.ovos_perdidos_total ?? 0, n.ovos_viaveis ?? '—']],
  })
  if (n.descartados_natural || n.descartados_predacao || n.descartados_humana) {
    _biopdfTabela(ctx, {
      head: [['Perdas — natural', 'Perdas — predação', 'Perdas — humana']],
      body: [[n.descartados_natural || 0, n.descartados_predacao || 0, n.descartados_humana || 0]],
    })
  }
  // Quebra fina de causa (alagamento/erosão), além de predação/humana já
  // exibidas acima — vem de vw_ninhos_validacao (ovos_perda_alagamento/
  // ovos_perda_erosao/ovos_perda_humana), fonte canônica única
  // (vw_ninho_ovos), nunca recalculada aqui.
  if (n.ovos_perda_alagamento || n.ovos_perda_erosao) {
    _biopdfTabela(ctx, {
      head: [['Perdas — alagamento', 'Perdas — erosão']],
      body: [[n.ovos_perda_alagamento || 0, n.ovos_perda_erosao || 0]],
    })
  }
  // Anomalia congênita (subconjunto de filhotes_vivos) — vw_ninhos_validacao
  if (n.filhotes_anomalia) {
    const tipos = (n.anomalia_tipos || []).map(t => BIOREL_ANOMALIA_TIPO[t] || t).join(', ') || '—'
    _biopdfTabela(ctx, {
      head: [['Filhotes com anomalia', 'Tipos observados']],
      body: [[n.filhotes_anomalia, tipos]],
    })
  }
  // Taxas científicas do ninho individual — mesma fórmula do relatório
  // agregado (bio_relatorio_completo), calculada na view, nunca em JS.
  if (n.taxa_eclosao_pct != null || n.taxa_fertilidade_pct != null || n.eficiencia_ninho_pct != null) {
    _biopdfTabela(ctx, {
      head: [['Taxa de eclosão', 'Taxa de fertilidade', 'Eficiência do ninho']],
      body: [[
        n.taxa_eclosao_pct != null ? `${n.taxa_eclosao_pct}%` : '—',
        n.taxa_fertilidade_pct != null ? `${n.taxa_fertilidade_pct}%` : '—',
        n.eficiencia_ninho_pct != null ? `${n.eficiencia_ninho_pct}%` : '—',
      ]],
    })
  }
}

function _biopdfSecaoDonut(ctx, n) {
  const segs = _biorelDonutSegmentos(n)
  const total = segs.reduce((s, [, v]) => s + v, 0)
  if (!total) return
  const alturaBloco = Math.max(28, segs.length * 5.2 + 4)
  _biopdfGarantirEspaco(ctx, alturaBloco + 10)
  _biopdfTitulo(ctx, 'Desfecho dos Ovos')
  const { pdf } = ctx
  const tam = 26
  pdf.addImage(_biopdfDesenharDonutCanvas(segs, total), 'PNG', BIOPDF_M, ctx.y, tam, tam)
  let ly = ctx.y + 3
  const lx = BIOPDF_M + tam + 8
  segs.forEach(([k, v]) => {
    pdf.setFillColor(...(_biopdfHexParaRGB(BIOREL_DONUT_COR[k])))
    pdf.circle(lx + 1, ly - 1, 1.1, 'F')
    pdf.setFont('DMSans', 'normal'); pdf.setFontSize(8); pdf.setTextColor(...BIOPDF_COR.muted)
    pdf.text(BIOREL_DONUT_LBL[k], lx + 5, ly)
    pdf.setFont('DMSans', 'bold'); pdf.setTextColor(...BIOPDF_COR.texto)
    pdf.text(String(v), ctx.W - BIOPDF_M, ly, { align: 'right' })
    ly += 5.4
  })
  ctx.y += alturaBloco
}

function _biopdfSecaoTimeline(ctx, n) {
  const evs = n._eventos || []
  if (!evs.length) return
  _biopdfTitulo(ctx, 'Linha do Tempo — Cadastro à Soltura')
  _biopdfTabela(ctx, {
    head: [['Data', 'Evento', 'Perda de ovos', 'Saldo viável']],
    body: evs.map(ev => [
      formatData(ev.data) + (ev.hora ? ' ' + _biorelHora(ev.hora) : ''),
      ev.txt,
      ev.delta > 0 ? '−' + ev.delta : '—',
      ev.saldo != null ? String(ev.saldo) : '—',
    ]),
    columnStyles: { 1: { cellWidth: 95 } },
  })
}

function _biopdfSecaoCrescimento(ctx, l) {
  const pontosComp = _biorelPontosCrescimento(l.ocorrencias, 'comprimento_medio_cm')
  const pontosPeso = _biorelPontosCrescimento(l.ocorrencias, 'peso_medio_g')
  if (pontosComp.length < 2 && pontosPeso.length < 2) return
  _biopdfSubtitulo(ctx, 'Crescimento (biometria por amostragem)')
  const largura = (ctx.W - BIOPDF_M * 2 - 6) / 2
  const altura = largura * (190 / 480)
  _biopdfGarantirEspaco(ctx, altura + 6)
  const { pdf } = ctx
  let x = BIOPDF_M
  if (pontosComp.length >= 2) {
    pdf.setFont('DMSans', 'normal'); pdf.setFontSize(7); pdf.setTextColor(...BIOPDF_COR.muted)
    pdf.text('COMPRIMENTO MÉDIO (CM)', x, ctx.y)
    pdf.addImage(_biopdfDesenharLinhaCanvas(pontosComp, '#52B788', ' cm'), 'PNG', x, ctx.y + 1.5, largura, altura)
  }
  if (pontosPeso.length >= 2) {
    const x2 = pontosComp.length >= 2 ? x + largura + 6 : x
    pdf.setFont('DMSans', 'normal'); pdf.setFontSize(7); pdf.setTextColor(...BIOPDF_COR.muted)
    pdf.text('PESO MÉDIO (G)', x2, ctx.y)
    pdf.addImage(_biopdfDesenharLinhaCanvas(pontosPeso, '#C9A84C', ' g'), 'PNG', x2, ctx.y + 1.5, largura, altura)
  }
  ctx.y += altura + 8
}

function _biopdfSecaoDestinoFilhotes(ctx, n, modo) {
  if (n._lotes?.length) {
    n._lotes.forEach(l => {
      _biopdfTitulo(ctx, `Berçário — ${l.bercario_nome}`)
      _biopdfTabela(ctx, {
        head: [['Entrada', 'Quantidade', 'Status do lote']],
        body: [[formatData(l.data_entrada) + (l.hora_entrada ? ' ' + _biorelHora(l.hora_entrada) : ''), l.qtd_entrada, l.status]],
      })
      if (l.observacoes) _biopdfParagrafoMuted(ctx, l.observacoes)

      if (l.ocorrencias.length) {
        _biopdfSubtitulo(ctx, 'Ocorrências no berçário')
        _biopdfTabela(ctx, {
          head: [['Data', 'Tipo', 'Detalhes']],
          body: l.ocorrencias.map(o => [
            formatData(o.data_ocorrencia) + (o.hora_ocorrencia ? ' ' + _biorelHora(o.hora_ocorrencia) : ''),
            BIOREL_TIPO_OCORR[o.tipo] || o.tipo,
            _biorelOcorrenciaTxt(o),
          ]),
        })
      }

      _biopdfSecaoCrescimento(ctx, l)

      if (l.filhotes.length) {
        if (modo === 'completo') {
          _biopdfSubtitulo(ctx, `Filhotes individuais (${l.filhotes.length})`)
          _biopdfTabela(ctx, {
            head: [['Nº', 'Status', 'Doente', 'Anomalia', 'Óbito', 'Biometrias registradas']],
            body: l.filhotes.map(f => [
              String(f.numero),
              BIOREL_STATUS_FILHOTE[f.status] || f.status,
              f.doente ? 'Sim' : '—',
              f.anomalia ? 'Sim' : '—',
              f.data_obito ? formatData(f.data_obito) + (f.causa_obito ? ' — ' + f.causa_obito : '') : '—',
              f.biometrias.length ? f.biometrias.map(b => `${formatData(b.data_medicao)}: ${_biorelBiometriaTxt(b)}`).join('\n') : '—',
            ]),
            columnStyles: { 5: { cellWidth: 52 } },
          })
        } else {
          _biopdfSubtitulo(ctx, 'Filhotes individuais')
          _biopdfParagrafo(ctx, _biorelFilhotesResumoTxt(l.filhotes))
        }
      }

      if (l.soltura) {
        _biopdfSubtitulo(ctx, 'Soltura do lote')
        _biopdfTabela(ctx, {
          head: [['Data', 'Detalhes']],
          body: [[formatData(l.soltura.data_soltura) + (l.soltura.hora_soltura ? ' ' + _biorelHora(l.soltura.hora_soltura) : ''), _biorelSolturaTxt(l.soltura)]],
        })
      } else {
        _biopdfParagrafoMuted(ctx, 'Ainda não há registro de soltura para este lote.')
      }
    })
  }

  if (n._solturaDireta) {
    const s = n._solturaDireta
    _biopdfTitulo(ctx, 'Soltura Direta (sem passagem por berçário)')
    _biopdfTabela(ctx, {
      head: [['Data', 'Detalhes']],
      body: [[formatData(s.data_soltura) + (s.hora_soltura ? ' ' + _biorelHora(s.hora_soltura) : ''), _biorelSolturaTxt(s)]],
    })
    if (s.observacoes) _biopdfParagrafoMuted(ctx, s.observacoes)
  }

  if (!n._lotes?.length && !n._solturaDireta) {
    _biopdfTitulo(ctx, 'Destino dos Filhotes')
    _biopdfParagrafoMuted(ctx, 'Sem registro de destino ainda (ninho em incubação ou sem eclosão registrada).')
  }
}

function _biopdfSecaoFotos(ctx, fotosDataUrl) {
  if (!fotosDataUrl?.length) return
  const cols = 3, gap = 4
  const largura = (ctx.W - BIOPDF_M * 2 - gap * (cols - 1)) / cols
  const altura = largura * 0.75
  _biopdfGarantirEspaco(ctx, 10 + altura + 2) // título + pelo menos 1 linha de fotos juntos
  _biopdfTitulo(ctx, 'Registro Fotográfico')
  let col = 0
  fotosDataUrl.forEach(u => {
    if (col === 0) _biopdfGarantirEspaco(ctx, altura + 2)
    const x = BIOPDF_M + col * (largura + gap)
    ctx.pdf.addImage(u, 'JPEG', x, ctx.y, largura, altura)
    col++
    if (col === cols) { col = 0; ctx.y += altura + gap }
  })
  if (col !== 0) ctx.y += altura + gap
}

function _biopdfAssinatura(ctx) {
  _biopdfGarantirEspaco(ctx, 24)
  const r = ctx.cab.responsavel || {}
  const { pdf } = ctx
  const cx = ctx.W / 2, largura = 80
  ctx.y += 6
  pdf.setDrawColor(...BIOPDF_COR.texto); pdf.setLineWidth(0.2)
  pdf.line(cx - largura / 2, ctx.y, cx + largura / 2, ctx.y)
  ctx.y += 4
  pdf.setFont('DMSans', 'bold'); pdf.setFontSize(8.5); pdf.setTextColor(...BIOPDF_COR.floresta)
  pdf.text(r.nome || '—', cx, ctx.y, { align: 'center' })
  ctx.y += 4
  const linha2 = [r.cargo, r.registro].filter(Boolean).join(' · ')
  if (linha2) {
    pdf.setFont('DMSans', 'normal'); pdf.setFontSize(7.5); pdf.setTextColor(...BIOPDF_COR.muted)
    pdf.text(linha2, cx, ctx.y, { align: 'center' }); ctx.y += 3.5
  }
  if (r.orgao) {
    pdf.setFontSize(7.5); pdf.setTextColor(...BIOPDF_COR.muted2)
    pdf.text(r.orgao, cx, ctx.y, { align: 'center' }); ctx.y += 3.5
  }
}

function _biopdfFolhaCapa(ctx, ninhos) {
  ctx.ninhoAtualTxt = null
  _biopdfRegistrarPagina(ctx)
  const { pdf } = ctx
  pdf.setFont('DMSans', 'bold'); pdf.setFontSize(9); pdf.setTextColor(...BIOPDF_COR.muted2)
  pdf.text('FICHAS DE MONITORAMENTO DE NINHOS — BIOMONITOR', BIOPDF_M, ctx.y)
  ctx.y += 8
  pdf.setFontSize(20); pdf.setTextColor(...BIOPDF_COR.floresta)
  pdf.text(`${ninhos.length} ninho${ninhos.length !== 1 ? 's' : ''}`, BIOPDF_M, ctx.y)
  ctx.y += 10
  _biopdfTitulo(ctx, 'Ninhos incluídos nesta ficha')
  _biopdfTabela(ctx, {
    head: [['#', 'Nº do ninho', 'Espécie', 'Praia', 'Status']],
    body: ninhos.map((n, i) => [
      String(i + 1), n.numero_ninho, BIOREL_ESPECIE[n.especie] || n.especie,
      n.praia_atual_nome || n.praia_nome || '—', BIOREL_STATUS_NINHO[n.status] || n.status,
    ]),
  })
}

async function _biopdfFolhaNinho(ctx, n, idx, total, modo) {
  ctx.ninhoAtualTxt = `Ninho ${idx}/${total} · ${n.numero_ninho}`
  if (idx > 1 || total > 1) _biopdfNovaPagina(ctx)
  else _biopdfRegistrarPagina(ctx)

  const { pdf } = ctx
  pdf.setFont('DMSans', 'bold'); pdf.setFontSize(8.5); pdf.setTextColor(...BIOPDF_COR.muted2)
  pdf.text(`FICHA DE MONITORAMENTO DE NINHO — BIOMONITOR${modo === 'resumido' ? ' (CAMPO)' : ''}`, ctx.W / 2, ctx.y, { align: 'center' })
  ctx.y += 6
  pdf.setFontSize(19); pdf.setTextColor(...BIOPDF_COR.floresta)
  pdf.text(n.numero_ninho || '—', ctx.W / 2, ctx.y, { align: 'center' })
  ctx.y += 6
  pdf.setFont('DMSans', 'normal'); pdf.setFontSize(8.5); pdf.setTextColor(...BIOPDF_COR.muted)
  const subt = [BIOREL_ESPECIE[n.especie] || n.especie, n.praia_atual_nome || n.praia_nome || '—', n.uc_nome].filter(Boolean).join(' · ')
  pdf.text(subt, ctx.W / 2, ctx.y, { align: 'center' })
  ctx.y += 8

  _biopdfSecaoIdentificacao(ctx, n)
  _biopdfSecaoBalancoOvos(ctx, n)
  _biopdfSecaoDonut(ctx, n)
  _biopdfSecaoTimeline(ctx, n)
  _biopdfSecaoDestinoFilhotes(ctx, n, modo)
  if (n.observacoes) {
    const linhas = ctx.pdf.splitTextToSize(n.observacoes, ctx.W - BIOPDF_M * 2)
    _biopdfGarantirEspaco(ctx, 10 + linhas.length * 4) // título + parágrafo inteiro juntos
    _biopdfTitulo(ctx, 'Observações')
    _biopdfParagrafo(ctx, n.observacoes)
  }
  if (modo === 'completo') _biopdfSecaoFotos(ctx, n._fotosDataUrl)
  _biopdfAssinatura(ctx)
}

// ── Cabeçalho/rodapé — desenhados numa passada final sobre todas as
// páginas já existentes (só assim dá pra saber o total de páginas para
// "Pág. X/Y", e evita desenhar 2x nas páginas que o autoTable cria) ──
function _biopdfDesenharCabecalhoPagina(pdf, cab, protocolo, logos) {
  relatorioPdfDesenharCabecalho(pdf, {
    margem: BIOPDF_M,
    corFloresta: BIOPDF_COR.floresta, corMuted: BIOPDF_COR.muted, corMuted2: BIOPDF_COR.muted2,
    cab, protocolo, logos,
    nomePlataforma: BIOREL_NOME_PLATAFORMA,
    linhaModulo: 'Biomonitoramento',
  })
}

function _biopdfDesenharRodapePagina(pdf, cab, protocolo, ninhoTxt, numeroPagina, totalPaginas) {
  const W = pdf.internal.pageSize.getWidth(), H = pdf.internal.pageSize.getHeight()
  const y = H - 8
  pdf.setDrawColor(...BIOPDF_COR.borda); pdf.setLineWidth(0.2)
  pdf.line(BIOPDF_M, y - 3, W - BIOPDF_M, y - 3)
  pdf.setFont('DMSans', 'normal'); pdf.setFontSize(7); pdf.setTextColor(...BIOPDF_COR.muted2)
  pdf.text(`${cab.secretaria} · ${cab.siglaDiret} · ${cab.siglaDep}`, BIOPDF_M, y)
  const direita = `${ninhoTxt ? ninhoTxt + ' · ' : ''}Pág. ${numeroPagina}/${totalPaginas} · Prot. ${protocolo}`
  pdf.text(direita, W - BIOPDF_M, y, { align: 'right' })
}

function _biopdfAplicarCabecalhoRodapeGlobal(ctx, logos) {
  const { pdf } = ctx
  const total = pdf.internal.getNumberOfPages()
  for (let i = 1; i <= total; i++) {
    pdf.setPage(i)
    _biopdfDesenharCabecalhoPagina(pdf, ctx.cab, ctx.protocolo, logos)
    _biopdfDesenharRodapePagina(pdf, ctx.cab, ctx.protocolo, ctx.paginaParaNinho[i], i, total)
  }
}

// ── Montagem completa (1..N ninhos) → devolve o objeto jsPDF ────────
async function bioMontarPdfNinhos(ninhos, cab, protocolo, modo = 'completo') {
  await _biopdfCarregarLibs()
  const pdf = _biopdfNovoDocumento()
  const ctx = _biopdfCtx(pdf, cab, protocolo)

  const logos = {
    gov: cab.logoGoverno ? await _biopdfBuscarDataURL(cab.logoGoverno) : null,
    secr: cab.logoSecr ? await _biopdfBuscarDataURL(cab.logoSecr) : null,
  }

  if (modo === 'completo') {
    await Promise.all(ninhos.map(async n => { n._fotosDataUrl = await _biopdfPreCarregarFotos(n) }))
  }

  if (ninhos.length > 1) _biopdfFolhaCapa(ctx, ninhos)
  for (let i = 0; i < ninhos.length; i++) {
    await _biopdfFolhaNinho(ctx, ninhos[i], i + 1, ninhos.length, modo)
  }

  _biopdfAplicarCabecalhoRodapeGlobal(ctx, logos)
  return pdf
}

/* ════════════════════════════════════════════════════════════════
   ENTRADA WEB — abre um preview (iframe com o PDF) + baixar
   ════════════════════════════════════════════════════════════════ */

window.bioFecharPreviewRelatorio = () => {
  const overlay = document.getElementById('rel-preview-overlay')
  const url = overlay?.dataset.blobUrl
  if (url) URL.revokeObjectURL(url)
  overlay?.remove()
}

function _biopdfAbrirPreview(pdf, filename) {
  bioFecharPreviewRelatorio()
  const url = URL.createObjectURL(pdf.output('blob'))
  const overlay = document.createElement('div')
  overlay.id = 'rel-preview-overlay'
  overlay.dataset.blobUrl = url
  overlay.style.cssText = 'position:fixed;inset:0;background:#374151;z-index:1100;display:flex;flex-direction:column'
  overlay.innerHTML = `
    <div style="background:#1F4E2C;padding:10px 20px;display:flex;align-items:center;gap:10px;flex-shrink:0;box-shadow:0 2px 8px rgba(0,0,0,.3)">
      <span style="color:#fff;font-size:13px;font-weight:700;flex:1">${esc(filename)}</span>
      <button class="btn btn-secondary" style="font-size:11px" onclick="bioFecharPreviewRelatorio()">← Fechar</button>
      <a class="btn btn-primary" style="font-size:11px;text-decoration:none" href="${url}" download="${esc(filename)}">Baixar PDF</a>
    </div>
    <iframe src="${url}" style="flex:1;border:0;background:#fff" title="${esc(filename)}"></iframe>`
  document.body.appendChild(overlay)
}

// Ponto de entrada principal — busca os dados, monta o PDF e abre o
// preview. `ninhoIds` pode ter 1 ou N ids.
async function bioAbrirRelatorioNinhos(db, ninhoIds) {
  if (!ninhoIds?.length) { toast('Selecione ao menos um ninho.', 'warning'); return }
  toast('Gerando PDF…', 'info')

  try {
    // Departamento vem de modulo_departamento('biomonitor') — DEBIO,
    // pelo organograma (migration 265/299) — não mais hardcoded aqui.
    const [cab, protocolo] = await Promise.all([getCabecalhoRelatorio('biomonitor'), gerarProtocolo()])
    cab.responsavel = {
      nome: appState.usuario?.nome_completo || appState.usuario?.email || 'Usuário',
      cargo: appState.perfil || '', registro: '', orgao: cab.siglaSecr,
    }
    cab.gestao = '' // período de gestão não aparece na ficha do Biomonitor

    const ninhos = await bioColetarDadosRelatorioNinhos(db, ninhoIds)
    if (!ninhos.length) { toast('Nenhum ninho encontrado.', 'warning'); return }

    const pdf = await bioMontarPdfNinhos(ninhos, cab, protocolo, 'completo')
    const titulo = ninhos.length === 1 ? ninhos[0].numero_ninho : `${ninhos.length}-ninhos`
    _biopdfAbrirPreview(pdf, `ficha-ninho-${String(titulo).replace(/[^\w-]+/g, '-')}.pdf`)
  } catch (e) {
    toast('Erro ao gerar PDF: ' + e.message, 'error')
  }
}

async function bioAbrirRelatorioNinho(db, ninhoId) {
  return bioAbrirRelatorioNinhos(db, [ninhoId])
}
