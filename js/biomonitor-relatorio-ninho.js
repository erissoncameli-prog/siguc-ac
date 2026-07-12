// ── SIGUC Biomonitor — Ficha PDF de ninho (cadastro → soltura) ─────
// Gera a ficha de impressão de um ou vários ninhos, com a linha do
// tempo completa (postura → transferências → visitas → eclosão →
// berçário/soltura, incluindo filhotes individuais e biometrias).
// Usada em pages/biomonitor-validacao.html (ficha individual) e
// pages/relatorios-biomonitor.html (ficha individual ou em lote —
// "todos os ninhos da praia").
// Depende de: esc(), formatData() (js/config.js); getCabecalhoRelatorio(),
// gerarProtocolo() (js/config-sistema.js); bioBuscarEventosServidor(),
// bioMontarHistoricoNinho() (js/biomonitor-timeline.js);
// css/relatorio-print.css (folha A4, tabelas, assinatura, @media print).

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
          .select('id,lote_id,numero,status,data_obito,causa_obito,doente,observacoes')
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

// ── Cabeçalho / assinatura (mesmo padrão visual do relatório CAR) ───
function _biorelCabecalho(cab, protocolo, data) {
  const logoGov  = cab.logoGoverno ? `<img src="${cab.logoGoverno}" alt="Logo Governo">` : '🌿'
  const logoSecr = cab.logoSecr    ? `<img src="${cab.logoSecr}" alt="Logo Secretaria">` : '🏛'
  return `
  <div class="rel-cabecalho">
    <div class="rel-logos">
      <div class="rel-logo">${logoGov}</div>
      <div class="rel-cab-div"></div>
      <div class="rel-logo">${logoSecr}</div>
    </div>
    <div class="rel-cab-div" style="margin:0 6px"></div>
    <div class="rel-inst">
      <div class="gov">${esc(cab.governo)}${cab.gestao ? ' · ' + esc(cab.gestao) : ''}</div>
      <div class="sec">${esc(cab.secretaria)} — ${esc(cab.siglaSecr)}</div>
      <div class="dir">${esc(cab.diretoria)} · ${esc(cab.departamento)} · Biomonitoramento</div>
    </div>
    <div class="rel-meta">${esc(BIOREL_NOME_PLATAFORMA)}<br>Emitido: ${data}<br>Prot. nº ${esc(protocolo)}</div>
  </div>`
}

function _biorelAssinatura(cab) {
  const r = cab?.responsavel || {}
  const linha2 = [r.cargo, r.registro].filter(Boolean).join(' · ')
  return `<div class="rel-assinatura">
    <div class="rel-assin-linha"></div>
    <div class="rel-assin-nome">${esc(r.nome || '—')}</div>
    ${linha2 ? `<div class="rel-assin-cargo">${esc(linha2)}</div>` : ''}
    ${r.orgao ? `<div class="rel-assin-org">${esc(r.orgao)}</div>` : ''}
  </div>`
}

function _biorelRodape(cab, protocolo, pag) {
  return `<div class="rel-pag-rodape">
    <span>${esc(cab.secretaria)} · ${esc(cab.siglaDiret)} · ${esc(cab.siglaDep)}</span>
    <span>${esc(pag)} · Prot. ${esc(protocolo)}</span>
  </div>`
}

// ── Capa (múltiplos ninhos) ──────────────────────────────────────────
function _biorelFolhaCapa(ninhos, cab, protocolo, data) {
  return `
  <div class="rel-a4">
    ${_biorelCabecalho(cab, protocolo, data)}
    <div class="rel-body">
      <div class="rel-titulo-bloco">
        <div class="rel-tipo-label">Fichas de Monitoramento de Ninhos — Biomonitor</div>
        <div class="rel-nome-imovel">${ninhos.length} ninho${ninhos.length !== 1 ? 's' : ''}</div>
        <div class="rel-cod-imovel">Gerado em ${data}</div>
      </div>
      <div class="rel-secao">
        <div class="rel-secao-titulo">Ninhos incluídos nesta ficha</div>
        <table class="rel-table">
          <tr><th>#</th><th>Nº do ninho</th><th>Espécie</th><th>Praia</th><th>Status</th></tr>
          ${ninhos.map((n, i) => `<tr>
            <td>${i + 1}</td>
            <td>${esc(n.numero_ninho)}</td>
            <td>${esc(BIOREL_ESPECIE[n.especie] || n.especie)}</td>
            <td>${esc(n.praia_atual_nome || n.praia_nome || '—')}</td>
            <td>${esc(BIOREL_STATUS_NINHO[n.status] || n.status)}</td>
          </tr>`).join('')}
        </table>
      </div>
    </div>
    ${_biorelRodape(cab, protocolo, 'Capa')}
  </div>`
}

// ── Seção: identificação e postura ───────────────────────────────────
function _biorelIdentificacao(n) {
  const linha = (l, v) => v != null && v !== '' ? `<tr><td>${esc(l)}</td><td>${v}</td></tr>` : ''
  const gps = n.lat != null
    ? `${Number(n.lat).toFixed(5)}, ${Number(n.lng).toFixed(5)}${n.precisao_gps_m ? ` (±${n.precisao_gps_m} m)` : ''}`
    : '<span style="color:#dc2626">Sem GPS registrado</span>'

  return `
  <div class="rel-secao">
    <div class="rel-secao-titulo">Identificação e Postura</div>
    <table class="rel-table">
      ${linha('Espécie', esc(BIOREL_ESPECIE[n.especie] || n.especie))}
      ${linha('Praia de origem', esc(n.praia_nome))}
      ${n.praia_atual_nome && n.praia_atual_nome !== n.praia_nome ? linha('Praia atual', esc(n.praia_atual_nome)) : ''}
      ${linha('Nº na praia atual', n.numero_atual && n.numero_atual !== n.numero_ninho ? esc(n.numero_atual) : null)}
      ${linha('Temporada', esc(n.temporada_nome))}
      ${linha('Monitor responsável', esc(n.monitor_nome))}
      ${linha('Grupo', esc(n.grupo_nome))}
      ${linha('Data/hora do encontro', `${formatData(n.data_encontro)}${n.hora_desova ? ' · ' + _biorelHora(n.hora_desova) : ''}`)}
      ${linha('Coordenadas GPS', gps)}
      ${linha('Distância ao rio', n.dist_rio_m != null ? `${n.dist_rio_m} m (${n.dist_rio_metodo === 'tracker' ? 'GPS tracker' : 'estimativa'})` : null)}
      ${linha('Condições ambientais', (n.temperatura_c != null || n.umidade_pct != null || n.profundidade_cm != null)
        ? [n.temperatura_c != null ? `${n.temperatura_c}°C` : null,
           n.umidade_pct != null ? `${n.umidade_pct}% umidade` : null,
           n.profundidade_cm != null ? `${n.profundidade_cm} cm de profundidade` : null].filter(Boolean).join(' · ')
        : null)}
      ${linha('Status do ninho', esc(BIOREL_STATUS_NINHO[n.status] || n.status))}
      ${linha('Status de validação', esc(BIOREL_STATUS_VALID[n.status_validacao] || n.status_validacao))}
      ${n.motivo_rejeicao ? linha('Motivo (rejeição/correção)', esc(n.motivo_rejeicao)) : ''}
      ${n.data_prevista_eclosao ? linha('Previsão de eclosão', formatData(n.data_prevista_eclosao)) : ''}
    </table>
  </div>
  <div class="rel-secao">
    <div class="rel-secao-titulo">Balanço de Ovos</div>
    <table class="rel-table rel-table-sm">
      <tr><th>Total na postura</th><th>Íntegros</th><th>Descartados no registro</th><th>Perdidos (depois)</th><th>Viáveis</th></tr>
      <tr>
        <td>${n.qtd_ovos ?? '—'}</td>
        <td>${n.ovos_integros ?? '—'}</td>
        <td>${n.ovos_descartados ?? 0}</td>
        <td>${n.ovos_perdidos_total ?? 0}</td>
        <td>${n.ovos_viaveis ?? '—'}</td>
      </tr>
    </table>
    ${(n.descartados_natural || n.descartados_predacao || n.descartados_humana) ? `
    <table class="rel-table rel-table-sm" style="margin-top:6px">
      <tr><th>Perdas — natural</th><th>Perdas — predação</th><th>Perdas — humana</th></tr>
      <tr><td>${n.descartados_natural || 0}</td><td>${n.descartados_predacao || 0}</td><td>${n.descartados_humana || 0}</td></tr>
    </table>` : ''}
  </div>
  ${_biorelSecaoDonut(n)}`
}

// Segmentos do desfecho dos ovos — mesma lógica de donutOvosHtml em
// biomonitor-validacao.html (vivos/mortos só depois de eclodir; viáveis só antes).
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

// Gráfico de rosca (canvas, não conic-gradient) — o app de campo captura a
// ficha via html2canvas, que não renderiza conic-gradient de forma confiável;
// um <canvas> já desenhado é copiado como bitmap e funciona nos dois casos
// (impressão web e PDF do app). Desenho real acontece em _biorelDesenharGraficos,
// depois que este HTML já está no DOM.
function _biorelSecaoDonut(n) {
  const segs = _biorelDonutSegmentos(n)
  const total = segs.reduce((s, [, v]) => s + v, 0)
  if (!total) return ''
  const legenda = segs.map(([k, v]) => `
    <div style="display:flex;align-items:center;gap:6px;font-size:9px">
      <span style="width:9px;height:9px;border-radius:50%;background:${BIOREL_DONUT_COR[k]};flex-shrink:0"></span>
      <span style="color:#4b5563">${esc(BIOREL_DONUT_LBL[k])}</span>
      <strong style="margin-left:auto">${v}</strong>
    </div>`).join('')
  return `
  <div class="rel-secao">
    <div class="rel-secao-titulo">Desfecho dos Ovos</div>
    <div style="display:flex;gap:16px;align-items:center">
      <canvas id="rel-donut-${n.id}" width="140" height="140" style="width:70px;height:70px;flex-shrink:0"></canvas>
      <div style="flex:1;display:grid;gap:4px">${legenda}</div>
    </div>
  </div>`
}

// ── Seção: linha do tempo ────────────────────────────────────────────
function _biorelTimeline(n) {
  const evs = n._eventos || []
  if (!evs.length) return ''
  return `
  <div class="rel-secao">
    <div class="rel-secao-titulo">Linha do Tempo — Cadastro à Soltura</div>
    <table class="rel-table rel-table-sm">
      <tr><th>Data</th><th>Evento</th><th>Perda de ovos</th><th>Saldo viável</th></tr>
      ${evs.map(ev => `<tr>
        <td>${formatData(ev.data)}${ev.hora ? ' ' + _biorelHora(ev.hora) : ''}</td>
        <td>${esc(ev.txt)}</td>
        <td>${ev.delta > 0 ? '−' + ev.delta : '—'}</td>
        <td>${ev.saldo != null ? ev.saldo : '—'}</td>
      </tr>`).join('')}
    </table>
  </div>`
}

// Pontos ordenados por data de uma métrica de biometria por amostragem
// (ocorrencias_bercario tipo='biometria') — usado tanto para montar o HTML
// (rótulos/condição de existir) quanto para desenhar depois.
function _biorelPontosCrescimento(ocorrencias, campo) {
  return (ocorrencias || [])
    .filter(o => o.tipo === 'biometria' && o[campo] != null)
    .slice()
    .sort((a, b) => (a.data_ocorrencia || '').localeCompare(b.data_ocorrencia || ''))
    .map(o => ({ v: o[campo], label: formatData(o.data_ocorrencia).slice(0, 5) }))
}

// Gráficos de crescimento (comprimento) e peso do lote, a partir das
// amostragens já registradas em "Ocorrências no berçário" — comprimento e
// peso NUNCA no mesmo eixo (escalas muito diferentes), mesmo padrão já usado
// em relatorios-biomonitor.html. Desenho real em _biorelDesenharGraficos.
function _biorelSecaoCrescimento(l) {
  const pontosComp = _biorelPontosCrescimento(l.ocorrencias, 'comprimento_medio_cm')
  const pontosPeso = _biorelPontosCrescimento(l.ocorrencias, 'peso_medio_g')
  if (pontosComp.length < 2 && pontosPeso.length < 2) return ''
  return `
  <div class="rel-secao-subtitulo">Crescimento (biometria por amostragem)</div>
  <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:6px">
    ${pontosComp.length >= 2 ? `
    <div style="flex:1;min-width:180px">
      <div style="font-size:8px;color:#6b7280;margin-bottom:2px;text-transform:uppercase;letter-spacing:.04em">Comprimento médio (cm)</div>
      <canvas id="rel-graf-compr-${l.id}" width="360" height="140" style="width:100%;height:70px"></canvas>
    </div>` : ''}
    ${pontosPeso.length >= 2 ? `
    <div style="flex:1;min-width:180px">
      <div style="font-size:8px;color:#6b7280;margin-bottom:2px;text-transform:uppercase;letter-spacing:.04em">Peso médio (g)</div>
      <canvas id="rel-graf-peso-${l.id}" width="360" height="140" style="width:100%;height:70px"></canvas>
    </div>` : ''}
  </div>`
}

// ── Seção: destino dos filhotes (berçário ou soltura direta) ────────
function _biorelBiometriaTxt(b) {
  return [
    b.comprimento_cm != null ? `${b.comprimento_cm} cm compr.` : null,
    b.largura_carapaca_cm != null ? `${b.largura_carapaca_cm} cm larg.` : null,
    b.comprimento_plastrao_cm != null ? `${b.comprimento_plastrao_cm} cm plastrão` : null,
    b.peso_g != null ? `${b.peso_g} g` : null,
  ].filter(Boolean).join(' · ') || '—'
}

function _biorelOcorrenciaTxt(o) {
  if (o.tipo === 'biometria') {
    return [
      o.comprimento_medio_cm != null ? `${o.comprimento_medio_cm} cm médio` : null,
      o.peso_medio_g != null ? `${o.peso_medio_g} g médio` : null,
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
  const doentes = filhotes.filter(f => f.doente).length
  return [
    `${filhotes.length} filhote(s) numerados`,
    ativos ? `${ativos} ativo(s)` : null,
    soltos ? `${soltos} já soltos` : null,
    mortos ? `${mortos} óbito(s)` : null,
    doentes ? `${doentes} doente(s)` : null,
  ].filter(Boolean).join(' · ')
}

function _biorelDestinoFilhotes(n, modo = 'completo') {
  const partes = []

  if (n._lotes?.length) {
    n._lotes.forEach(l => {
      partes.push(`
      <div class="rel-secao">
        <div class="rel-secao-titulo">Berçário — ${esc(l.bercario_nome)}</div>
        <table class="rel-table rel-table-sm">
          <tr><th>Entrada</th><th>Quantidade</th><th>Status do lote</th></tr>
          <tr>
            <td>${formatData(l.data_entrada)}${l.hora_entrada ? ' ' + _biorelHora(l.hora_entrada) : ''}</td>
            <td>${l.qtd_entrada}</td>
            <td>${esc(l.status)}</td>
          </tr>
        </table>
        ${l.observacoes ? `<p style="font-size:9px;color:#6b7280;font-style:italic;margin:5px 0 0">${esc(l.observacoes)}</p>` : ''}

        ${l.ocorrencias.length ? `
        <div class="rel-secao-subtitulo">Ocorrências no berçário</div>
        <table class="rel-table rel-table-sm">
          <tr><th>Data</th><th>Tipo</th><th>Detalhes</th></tr>
          ${l.ocorrencias.map(o => `<tr>
            <td>${formatData(o.data_ocorrencia)}${o.hora_ocorrencia ? ' ' + _biorelHora(o.hora_ocorrencia) : ''}</td>
            <td>${esc(BIOREL_TIPO_OCORR[o.tipo] || o.tipo)}</td>
            <td>${esc(_biorelOcorrenciaTxt(o))}</td>
          </tr>`).join('')}
        </table>` : ''}
        ${_biorelSecaoCrescimento(l)}

        ${l.filhotes.length ? (modo === 'completo' ? `
        <div class="rel-secao-subtitulo">Filhotes individuais (${l.filhotes.length})</div>
        <table class="rel-table rel-table-sm">
          <tr><th>Nº</th><th>Status</th><th>Doente</th><th>Óbito</th><th>Biometrias registradas</th></tr>
          ${l.filhotes.map(f => `<tr>
            <td>${f.numero}</td>
            <td>${esc(BIOREL_STATUS_FILHOTE[f.status] || f.status)}</td>
            <td>${f.doente ? 'Sim' : '—'}</td>
            <td>${f.data_obito ? formatData(f.data_obito) + (f.causa_obito ? ' — ' + esc(f.causa_obito) : '') : '—'}</td>
            <td>${f.biometrias.length
              ? f.biometrias.map(b => `${formatData(b.data_medicao)}: ${esc(_biorelBiometriaTxt(b))}`).join('<br>')
              : '—'}</td>
          </tr>`).join('')}
        </table>` : `
        <div class="rel-secao-subtitulo">Filhotes individuais</div>
        <p style="font-size:10px;color:#374151">${esc(_biorelFilhotesResumoTxt(l.filhotes))}</p>`) : ''}

        ${l.soltura ? `
        <div class="rel-secao-subtitulo">Soltura do lote</div>
        <table class="rel-table rel-table-sm">
          <tr><th>Data</th><th>Detalhes</th></tr>
          <tr>
            <td>${formatData(l.soltura.data_soltura)}${l.soltura.hora_soltura ? ' ' + _biorelHora(l.soltura.hora_soltura) : ''}</td>
            <td>${esc(_biorelSolturaTxt(l.soltura))}</td>
          </tr>
        </table>` : `<p style="font-size:9px;color:#9ca3af;margin-top:6px">Ainda não há registro de soltura para este lote.</p>`}
      </div>`)
    })
  }

  if (n._solturaDireta) {
    const s = n._solturaDireta
    partes.push(`
      <div class="rel-secao">
        <div class="rel-secao-titulo">Soltura Direta (sem passagem por berçário)</div>
        <table class="rel-table rel-table-sm">
          <tr><th>Data</th><th>Detalhes</th></tr>
          <tr>
            <td>${formatData(s.data_soltura)}${s.hora_soltura ? ' ' + _biorelHora(s.hora_soltura) : ''}</td>
            <td>${esc(_biorelSolturaTxt(s))}</td>
          </tr>
        </table>
        ${s.observacoes ? `<p style="font-size:9px;color:#6b7280;font-style:italic;margin:5px 0 0">${esc(s.observacoes)}</p>` : ''}
      </div>`)
  }

  if (!partes.length) {
    partes.push(`<div class="rel-secao">
      <div class="rel-secao-titulo">Destino dos Filhotes</div>
      <p style="font-size:10px;color:#9ca3af">Sem registro de destino ainda (ninho em incubação ou sem eclosão registrada).</p>
    </div>`)
  }

  return partes.join('')
}

// ── Seção: fotos ──────────────────────────────────────────────────
function _biorelFotos(n) {
  const fotos = [...(n.foto_urls || []), ...(n._eclosaoFotos || [])]
  if (!fotos.length) return ''
  return `
  <div class="rel-secao" style="page-break-inside:auto">
    <div class="rel-secao-titulo">Registro Fotográfico</div>
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px">
      ${fotos.map(u => `<img src="${esc(u)}" style="width:100%;aspect-ratio:4/3;object-fit:cover;border-radius:4px;border:1px solid #e5e7eb">`).join('')}
    </div>
  </div>`
}

// ── Desenho dos gráficos (canvas 2D, chamado depois do HTML já estar no DOM) ──
// Canvas — em vez de CSS conic-gradient ou SVG — porque o app de campo captura
// a ficha com html2canvas para gerar o PDF; um <canvas> já pintado é copiado
// como bitmap de forma confiável nos dois destinos (impressão web e PDF do
// app), diferente de gradientes/SVG complexos.
function _biorelDesenharDonut(canvasId, segs, total) {
  const cv = document.getElementById(canvasId)
  if (!cv || !total) return
  const ctx = cv.getContext('2d')
  const W = cv.width, H = cv.height
  const cx = W / 2, cy = H / 2
  const rOut = Math.min(W, H) / 2 - 4
  const rIn = rOut * 0.6
  const gap = 0.035 // rad — equivalente ao "surface gap" entre segmentos

  ctx.clearRect(0, 0, W, H)
  let ang = -Math.PI / 2
  segs.forEach(([k, v]) => {
    const frac = v / total
    const a0 = ang + gap / 2
    const a1 = ang + frac * Math.PI * 2 - gap / 2
    if (a1 > a0) {
      ctx.beginPath()
      ctx.arc(cx, cy, rOut, a0, a1)
      ctx.arc(cx, cy, rIn, a1, a0, true)
      ctx.closePath()
      ctx.fillStyle = BIOREL_DONUT_COR[k]
      ctx.fill()
    }
    ang += frac * Math.PI * 2
  })

  ctx.fillStyle = '#111827'
  ctx.font = 'bold 30px DM Sans, Arial, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(String(total), cx, cy)
}

// Linha de tendência simples: 1 série, eixo único, ponto final com anel
// branco (surface ring) e valor rotulado direto na ponta (mark specs do
// skill de dataviz: linha 2px, marcador ≥8px, rótulo no fim, nunca dual-axis).
function _biorelDesenharLinha(canvasId, pontos, cor, sufixo) {
  const cv = document.getElementById(canvasId)
  if (!cv || pontos.length < 2) return
  const ctx = cv.getContext('2d')
  const W = cv.width, H = cv.height
  const padL = 8, padR = 50, padT = 16, padB = 20
  const vals = pontos.map(p => p.v)
  const min = Math.min(...vals), max = Math.max(...vals)
  const faixa = (max - min) || 1
  const x = i => padL + (i / (pontos.length - 1)) * (W - padL - padR)
  const y = v => padT + (1 - (v - min) / faixa) * (H - padT - padB)

  ctx.clearRect(0, 0, W, H)

  ctx.strokeStyle = '#e5e7eb'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(padL, H - padB)
  ctx.lineTo(W - padR, H - padB)
  ctx.stroke()

  ctx.strokeStyle = cor
  ctx.lineWidth = 3
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  ctx.beginPath()
  pontos.forEach((p, i) => {
    const px = x(i), py = y(p.v)
    i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py)
  })
  ctx.stroke()

  const last = pontos[pontos.length - 1]
  const lx = x(pontos.length - 1), ly = y(last.v)
  ctx.beginPath(); ctx.arc(lx, ly, 6, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill()
  ctx.beginPath(); ctx.arc(lx, ly, 4, 0, Math.PI * 2); ctx.fillStyle = cor; ctx.fill()

  ctx.fillStyle = '#111827'
  ctx.font = 'bold 14px DM Sans, Arial, sans-serif'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  ctx.fillText(`${last.v}${sufixo}`, lx + 8, ly)

  ctx.fillStyle = '#9ca3af'
  ctx.font = '10px DM Sans, Arial, sans-serif'
  ctx.textAlign = 'left'
  ctx.fillText(pontos[0].label, padL, H - 4)
  ctx.textAlign = 'right'
  ctx.fillText(last.label, W - padR, H - 4)
}

// Chamar depois que o HTML da ficha já está no DOM (preview web ou container
// off-screen do app de campo) e antes de imprimir/capturar — os canvases só
// existem como elementos vazios até aqui.
function _biorelDesenharGraficos(ninhos) {
  ninhos.forEach(n => {
    const segs = _biorelDonutSegmentos(n)
    const total = segs.reduce((s, [, v]) => s + v, 0)
    _biorelDesenharDonut(`rel-donut-${n.id}`, segs, total)

    ;(n._lotes || []).forEach(l => {
      const pontosComp = _biorelPontosCrescimento(l.ocorrencias, 'comprimento_medio_cm')
      const pontosPeso = _biorelPontosCrescimento(l.ocorrencias, 'peso_medio_g')
      _biorelDesenharLinha(`rel-graf-compr-${l.id}`, pontosComp, '#52B788', ' cm')
      _biorelDesenharLinha(`rel-graf-peso-${l.id}`, pontosPeso, '#C9A84C', ' g')
    })
  })
}

// ── Monta uma folha (.rel-a4) por ninho ──────────────────────────────
function _biorelFolhaNinho(n, cab, protocolo, data, idx, total, modo = 'completo') {
  return `
  <div class="rel-a4">
    ${_biorelCabecalho(cab, protocolo, data)}
    <div class="rel-body">
      <div class="rel-titulo-bloco">
        <div class="rel-tipo-label">Ficha de Monitoramento de Ninho — Biomonitor${modo === 'resumido' ? ' (campo)' : ''}</div>
        <div class="rel-nome-imovel">${esc(n.numero_ninho)}</div>
        <div class="rel-cod-imovel">${esc(BIOREL_ESPECIE[n.especie] || n.especie)} · ${esc(n.praia_atual_nome || n.praia_nome || '—')}${n.uc_nome ? ' · ' + esc(n.uc_nome) : ''}</div>
      </div>
      ${_biorelIdentificacao(n)}
      ${_biorelTimeline(n)}
      ${_biorelDestinoFilhotes(n, modo)}
      ${n.observacoes ? `<div class="rel-secao"><div class="rel-secao-titulo">Observações</div><p style="font-size:10px;color:#374151;font-style:italic">${esc(n.observacoes)}</p></div>` : ''}
      ${modo === 'completo' ? _biorelFotos(n) : ''}
      ${_biorelAssinatura(cab)}
    </div>
    ${_biorelRodape(cab, protocolo, `Ninho ${idx}/${total}`)}
  </div>`
}

// ── Geração completa (1..N ninhos) ───────────────────────────────────
async function _biorelGerarHTML(ninhos, cab, protocolo, modo = 'completo') {
  const data = new Date().toLocaleDateString('pt-BR')
  const folhas = []
  if (ninhos.length > 1) folhas.push(_biorelFolhaCapa(ninhos, cab, protocolo, data))
  ninhos.forEach((n, i) => folhas.push(_biorelFolhaNinho(n, cab, protocolo, data, i + 1, ninhos.length, modo)))
  return `<div id="rel-print-root"><link rel="stylesheet" href="../css/relatorio-print.css">${folhas.join('\n')}</div>`
}

// ── Overlay de preview + impressão (mesmo padrão do relatório CAR) ──
async function _biorelExecutarPrint() {
  const area = document.getElementById('rel-preview-area')
  if (area) {
    const imgs = [...area.querySelectorAll('img')]
    if (imgs.length) {
      await Promise.allSettled(imgs.map(img =>
        img.complete ? Promise.resolve() :
        new Promise(r => { img.onload = r; img.onerror = r; setTimeout(r, 8000) })
      ))
    }
  }
  await new Promise(r => setTimeout(r, 200))
  window.print()
}

window.bioFecharPreviewRelatorio = () => document.getElementById('rel-preview-overlay')?.remove()

// Ponto de entrada principal — busca os dados, monta o HTML e abre o
// overlay de pré-visualização/impressão. `ninhoIds` pode ter 1 ou N ids.
async function bioAbrirRelatorioNinhos(db, ninhoIds) {
  if (!ninhoIds?.length) { toast('Selecione ao menos um ninho.', 'warning'); return }
  toast('Gerando ficha…', 'info')

  let cab, protocolo, ninhos
  try {
    [cab, protocolo] = await Promise.all([getCabecalhoRelatorio(), gerarProtocolo()])
    cab.responsavel = {
      nome: appState.usuario?.nome_completo || appState.usuario?.email || 'Usuário',
      cargo: appState.perfil || '', registro: '', orgao: cab.siglaSecr,
    }
    // Biomonitor é vinculado ao Departamento de Biodiversidade, não ao DEUC
    // (config_sistema.departamento é global e compartilhado com o relatório
    // CAR — sobrescrever só aqui, depois de resolvido, evita mudar o CAR).
    cab.departamento = 'Departamento de Biodiversidade'
    cab.siglaDep = 'DEBIO'
    cab.gestao = '' // período de gestão não aparece na ficha do Biomonitor
    ninhos = await bioColetarDadosRelatorioNinhos(db, ninhoIds)
  } catch (e) {
    toast('Erro ao gerar ficha: ' + e.message, 'error')
    return
  }
  if (!ninhos.length) { toast('Nenhum ninho encontrado.', 'warning'); return }

  const html = await _biorelGerarHTML(ninhos, cab, protocolo)
  const titulo = ninhos.length === 1 ? ninhos[0].numero_ninho : `${ninhos.length} ninhos`

  document.getElementById('rel-preview-overlay')?.remove()
  const overlay = document.createElement('div')
  overlay.id = 'rel-preview-overlay'
  overlay.innerHTML = `
  <div id="rel-preview-toolbar">
    <span class="rel-tb-titulo">Ficha de Ninho — ${esc(titulo)}</span>
    <span class="rel-tb-modo">${ninhos.length} ninho${ninhos.length !== 1 ? 's' : ''}</span>
    <button class="btn btn-secondary" style="font-size:11px" onclick="bioFecharPreviewRelatorio()">← Fechar</button>
    <button class="btn btn-primary" style="font-size:11px" onclick="_biorelExecutarPrint()">Imprimir / Salvar PDF</button>
  </div>
  <div id="rel-preview-area">${html}</div>`
  document.body.appendChild(overlay)
  _biorelDesenharGraficos(ninhos)
}

async function bioAbrirRelatorioNinho(db, ninhoId) {
  return bioAbrirRelatorioNinhos(db, [ninhoId])
}
