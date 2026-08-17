// ── SIGUC-AC · Qualidade da Água — painel compartilhado (cards + mapa) ─
// Fonte única do DESENHO do painel — mesma lição de js/frota-consumo.js:
// duas telas mostram o mesmo painel (pages/agua-relatorios.html, de
// mesa, e pages/agua-publico.html, pública/sem sessão) e NENHUMA delas
// pode ter sua própria cópia dos cards, senão elas divergem no
// primeiro ajuste futuro. Este arquivo só DESENHA — não busca dado
// (isso é js/agua-relatorio-dados.js, já compartilhado) e não decide
// QUEM pode ver o quê (isso é RLS/RPC no banco, decidido antes deste
// arquivo ser alcançado).
//
// aguaPainelHTML() é pura (recebe o `rel` já montado por aguaRelMontar
// e devolve uma STRING) — quem chama decide onde encaixar no DOM e
// quando rodar bIconsAplicar(). aguaPainelMapaCriar() é a única parte
// com estado (o mapa Leaflet não pode ser recriado a cada filtro, senão
// perde zoom/posição) — devolve um objeto com `.atualizar(rel, geoms)`.
//
// Depende de globals já carregados pela página: esc, bico, formatNum
// (js/config.js), aguaRel* (js/agua-relatorio-dados.js), aguaIqa*
// (js/agua-iqa-visual.js), Leaflet (L).

function aguaPainelChipDelta(delta, sufixo) {
  if (delta == null) return ''
  const classe = Math.abs(delta) < 0.05 ? 'neutro' : (delta > 0 ? '' : 'baixa')
  const icone = Math.abs(delta) < 0.05 ? '' : bico(delta > 0 ? 'arrow-up' : 'arrow-down')
  const sinal = delta > 0 ? '+' : ''
  return `<span class="adash-delta ${classe}">${icone}${sinal}${delta.toFixed(1)}${sufixo || ''}</span>`
}

function aguaPainelNomeCurto(nome) {
  const n = String(nome || '')
  return n.length > 11 ? n.slice(0, 10) + '…' : n
}

// `estado`: { chipCampanha, pontoSerie, baseLegal } — chipCampanha/
// pontoSerie são só exibição (não alteram o recorte do relatório
// exportado); baseLegal é a lista adicional de atos cadastrada em
// Configurações (config_sistema.dados.agua.base_legal), sempre
// mostrada JUNTO da Resolução CONAMA 357/2005 (fixa, ver
// aguaPainelBaseLegalHTML).
function aguaPainelHTML(rel, estado) {
  if (!rel) return '<div class="adash-vazio">Carregando painel...</div>'
  const { chipCampanha, pontoSerie, baseLegal } = estado || {}
  const r = rel.resumo
  const porCampanha = aguaRelPorCampanha(rel)
  const variacao = aguaRelVariacaoIQA(porCampanha)
  const porPonto = aguaRelIqaPorPonto(rel)
  const ranking = aguaRelViolacoesRanking(r, 6)

  // Card de distribuição: mostra o período inteiro ou só a campanha
  // do chip selecionado.
  const coletasChip = chipCampanha ? rel.coletas.filter(c => c.campanha_id === chipCampanha) : rel.coletas
  const dist = aguaRelDistribuicaoFaixas(coletasChip)
  const boasOuMelhor = (dist.contagem['Ótima'] || 0) + (dist.contagem['Boa'] || 0)
  const pctBoas = dist.comIQA ? (boasOuMelhor / dist.comIQA) * 100 : null

  let html = ''
  const filtrosTxt = aguaRelFiltrosTxt(rel.filtros)
  if (filtrosTxt) {
    html += `<div class="alert alert-info">${bico('search')}<span>Filtrado por: ${esc(filtrosTxt)} — o PDF/PPTX gerado reflete só o que está aqui, não o escopo inteiro.</span><button type="button" class="adash-filtros-limpar" onclick="limparFiltrosBusca()">Limpar filtros</button></div>`
  }
  if (r.quarentena > 0) {
    html += `<div class="adash-aviso">${bico('help')}<span>${r.quarentena} coleta(s) deste período em quarentena — dado preliminar, pendente de conferência humana. Aparecem marcadas no painel, no mapa e nos arquivos gerados.</span></div>`
  }

  if (!rel.coletas.length) {
    return html + '<div class="adash-vazio">Nenhuma coleta encontrada para este recorte.</div>' + aguaPainelBaseLegalHTML(baseLegal)
  }

  // ── Linha 1 ──────────────────────────────────────────────────
  html += '<div class="adash-grid">'

  // Coluna 1: dois KPIs empilhados (o de cima invertido)
  html += `<div class="adash-kpis">
    <div class="adash-card adash-card-escuro">
      <div class="adash-card-topo"><p class="adash-card-tit" style="color:#fff">IQA médio do período</p><span class="adash-card-mais" style="color:rgba(255,255,255,.35)">•••</span></div>
      <div class="adash-num-linha">
        <span class="adash-num">${r.iqaMedio != null ? r.iqaMedio.toFixed(1) : '—'}</span>
        ${variacao ? aguaPainelChipDelta(variacao.delta) : ''}
      </div>
      <p class="adash-card-pe">${r.comIQA} de ${r.totalColetas} coleta(s) com índice calculado${variacao ? ` · variação vs. ${esc(variacao.labelAnterior)}` : ''}</p>
    </div>
    <div class="adash-card">
      <div class="adash-card-topo"><p class="adash-card-tit">Coletas no período</p><span class="adash-card-mais">•••</span></div>
      <div class="adash-num-linha">
        <span class="adash-num">${formatNum(r.totalColetas)}</span>
        <span class="adash-delta neutro">${r.nPontos} ponto${r.nPontos !== 1 ? 's' : ''}</span>
      </div>
      <p class="adash-card-pe">${rel.campanhas.length} campanha(s) no recorte · ${r.quarentena} em conferência</p>
    </div>
  </div>`

  // Coluna 2: distribuição por faixa (rosca), com chips de campanha
  const chips = [`<button type="button" class="adash-chip ${!chipCampanha ? 'ativo' : ''}" onclick="selecionarChipCampanha('')">Período</button>`]
    .concat(porCampanha.map(c => `<button type="button" class="adash-chip ${chipCampanha === c.campanha_id ? 'ativo' : ''}" onclick="selecionarChipCampanha('${esc(c.campanha_id)}')" title="${esc(c.label)}">${esc(c.labelCurto)}</button>`))
    .join('')
  html += `<div class="adash-card">
    <div class="adash-card-topo">
      <div><p class="adash-card-tit">Distribuição por faixa do IQA</p>
        <p class="adash-card-tit-sub">${chipCampanha ? esc(porCampanha.find(c => c.campanha_id === chipCampanha)?.label || '') : 'Todo o período selecionado'}</p></div>
      <span class="adash-card-mais">•••</span>
    </div>
    <div class="adash-chips">${chips}</div>
    ${aguaIqaFaixasRoscaHTML(dist.contagem, dist.semIQA)}
    <p class="adash-card-pe">${pctBoas != null ? `${pctBoas.toFixed(0)}% Boa ou Ótima` : 'Sem coleta com índice neste recorte'}${dist.predominante ? ` · faixa predominante: <strong>${esc(dist.predominante)}</strong>` : ''}</p>
  </div>`

  // Coluna 3: medidor de conformidade CONAMA
  const semLimites = r.totalColetas - r.comConama
  html += `<div class="adash-card">
    <div class="adash-card-topo">
      <div><p class="adash-card-tit">Conformidade CONAMA</p>
        <p class="adash-card-tit-sub">Leitura separada do IQA — um rio pode ter índice bom e ainda violar um limite.</p></div>
      <span class="adash-card-mais">•••</span>
    </div>
    ${aguaIqaGaugeHTML(r.pctConforme, { rotulo: 'das coletas com limite cadastrado', width: 260 })}
    <div style="display:flex;flex-wrap:wrap;gap:8px;justify-content:center;margin-top:6px">
      <span class="adash-delta">${r.conforme} conforme</span>
      <span class="adash-delta baixa">${r.comConama - r.conforme} com violação</span>
      ${semLimites > 0 ? `<span class="adash-delta neutro">${semLimites} sem limites cadastrados</span>` : ''}
    </div>
    <p class="adash-card-pe">"Sem limites cadastrados" não é o mesmo que conforme: a classe de enquadramento desses pontos ainda não tem limites na tabela.</p>
  </div>`

  // ── Linha 2 ──────────────────────────────────────────────────
  const barras = porPonto.slice(0, 7).map(p => ({
    label: aguaPainelNomeCurto(p.nome), valor: p.iqaMedio,
    valorTexto: p.iqaMedio != null ? p.iqaMedio.toFixed(1) : '—',
    titulo: `${p.nome}${p.rio ? ' · ' + p.rio : ''}`, fraco: p.quarentena,
  }))
  html += `<div class="adash-card adash-span2">
    <div class="adash-card-topo">
      <div><p class="adash-card-tit">IQA médio por ponto de coleta</p>
        <p class="adash-card-tit-sub">Média das coletas do recorte, do melhor para o pior${porPonto.length > 7 ? ` · 7 de ${porPonto.length} pontos` : ''}</p></div>
      <span class="adash-card-mais">•••</span>
    </div>
    <div class="adash-barras">
      <div class="adash-barras-resumo">
        <div class="adash-num">${pctBoas != null ? pctBoas.toFixed(0) + '%' : '—'}</div>
        <p class="adash-card-pe" style="margin-top:6px;padding-top:0">das coletas com índice estão em faixa <strong>Boa ou Ótima</strong>${porPonto[0] && porPonto[0].iqaMedio != null ? `. Melhor ponto do período: <strong>${esc(porPonto[0].nome)}</strong>.` : '.'}</p>
      </div>
      <div class="adash-barras-plot">${aguaIqaBarrasHTML(barras, { vazio: 'Nenhum ponto com IQA calculado no recorte' })}</div>
    </div>
  </div>`

  html += `<div class="adash-card">
    <div class="adash-card-topo">
      <div><p class="adash-card-tit">Parâmetros que mais violaram</p>
        <p class="adash-card-tit-sub">Coletas fora do limite da classe, por parâmetro</p></div>
      <span class="adash-card-mais">•••</span>
    </div>
    ${ranking.length ? `<div class="adash-lista">${ranking.map((v, i) => `
      <div class="adash-lista-linha">
        <span class="adash-lista-rank">${i + 1}</span>
        <div style="min-width:0"><div class="adash-lista-nome">${esc(v.label)}</div>
          <div class="adash-lista-sub">${((v.n / (r.comConama || 1)) * 100).toFixed(0)}% das coletas avaliadas</div></div>
        <span class="adash-lista-val">${v.n}</span>
      </div>`).join('')}</div>`
      : '<p style="font-size:12.5px;color:var(--cinza-500);padding:14px 0">Nenhuma violação de limite CONAMA no recorte — ou nenhum ponto com limites cadastrados para a classe.</p>'}
    <p class="adash-card-pe">${r.comConama} coleta(s) avaliadas contra a classe de enquadramento do ponto.</p>
  </div>`

  // ── Linha 3: evolução do IQA de um ponto ─────────────────────
  const pontoSel = pontoSerie
    ? rel.pontos.find(p => p.ponto_id === pontoSerie)
    : rel.pontos.find(p => p.coletas.some(c => c.iqa != null)) || rel.pontos[0]
  const serie = pontoSel ? aguaRelSerieIQA(pontoSel, rel.campanhas) : []
  html += `<div class="adash-card adash-span3">
    <div class="adash-card-topo">
      <div><p class="adash-card-tit">Evolução do IQA por campanha</p>
        <p class="adash-card-tit-sub">${pontoSel ? esc(pontoSel.nome) + (pontoSel.rio ? ' · ' + esc(pontoSel.rio) : '') : 'Sem ponto no recorte'} — campanha sem coleta fica vazada, nunca some do eixo</p></div>
      <span class="adash-card-mais">•••</span>
    </div>
    <div class="adash-chips">${rel.pontos.map(p => `
      <button type="button" class="adash-chip ${pontoSel && p.ponto_id === pontoSel.ponto_id ? 'ativo' : ''}" onclick="selecionarPontoSerie('${esc(p.ponto_id)}')">${esc(p.nome)}</button>`).join('')}</div>
    ${aguaIqaGraficoHTML(serie, { width: 720, height: 210 })}
  </div>`

  // ── Tabela de pontos (o que vai no PDF/PPTX) ─────────────────
  html += `<div class="adash-card adash-span3 adash-tabela">
    <div class="adash-card-topo">
      <div><p class="adash-card-tit">Pontos incluídos no relatório</p>
        <p class="adash-card-tit-sub">É exatamente esta lista que o PDF e o PPTX exportam</p></div>
    </div>
    ${porPonto.map(p => `
      <div class="adash-tabela-linha">
        <div><div class="adash-lista-nome">${esc(p.nome)}</div>
          <div class="adash-lista-sub">${esc([p.rio, p.municipio].filter(Boolean).join(' · '))}</div></div>
        <div>${esc(p.codigo_ana || '—')}</div>
        <div>${p.nColetas} coleta${p.nColetas !== 1 ? 's' : ''}</div>
        <div>${p.iqaMedio != null ? `IQA ${p.iqaMedio.toFixed(1)}` : '<span style="color:var(--cinza-400)">sem índice</span>'}
          ${p.quarentena ? '<span class="badge badge-ouro">quarentena</span>' : ''}</div>
      </div>`).join('')}
  </div>`

  // ── Base legal (fora do .adash-grid — não é dado do recorte, é
  // referência institucional fixa; some fica igual com qualquer filtro) ──
  html += '</div>' // .adash-grid
  html += aguaPainelBaseLegalHTML(baseLegal)
  return html
}

// ── Base Legal e Conformidade ─────────────────────────────────────
// A Resolução CONAMA nº 357/2005 é texto FIXO — é a mesma fonte que
// `agua_limites_conama.fonte` já registra desde a migration 249 (Art.
// 14/15, limites da Classe 2 aplicados no indicador "Conformidade
// CONAMA" deste painel). `baseLegal` é a lista ADICIONAL, cadastrada
// pela SEMA em Configurações → Qualidade da Água (config_sistema.dados
// .agua.base_legal, sem migration) — nunca inventada aqui.
function aguaPainelBaseLegalHTML(baseLegal) {
  const extras = (baseLegal || []).map(n => `
    <div class="adash-legal-item">
      <span class="adash-legal-norma">${esc(n.titulo)}${n.orgao ? ' · ' + esc(n.orgao) : ''}</span>
      ${n.ementa ? `<span class="adash-legal-ementa">${esc(n.ementa)}</span>` : ''}
      <span class="adash-legal-fonte">${n.data ? formatData(n.data) : ''}${n.link ? ` · <a href="${esc(n.link)}" target="_blank" rel="noopener">ver documento</a>` : ''}</span>
    </div>`).join('')
  return `<div class="adash-card adash-legal" style="margin-top:16px">
    <div class="adash-card-topo">
      <div><p class="adash-card-tit">Base Legal e Conformidade</p>
        <p class="adash-card-tit-sub">Norma que fundamenta os limites usados no indicador "Conformidade CONAMA" deste painel</p></div>
      <span class="adash-card-mais">•••</span>
    </div>
    <div class="adash-legal-item">
      <span class="adash-legal-norma">Resolução CONAMA nº 357, de 17 de março de 2005</span>
      <span class="adash-legal-ementa">Dispõe sobre a classificação dos corpos de água e diretrizes ambientais para o seu enquadramento, bem como estabelece as condições e padrões de qualidade das águas. Art. 14 (Classe 1) e Art. 15 (Classe 2, por remissão ao Art. 14) definem os limites de OD, DBO, turbidez, coliformes termotolerantes, pH e fósforo total usados neste sistema.</span>
      <span class="adash-legal-fonte">DOU nº 053, 18/03/2005, págs. 58-63 — alterada pelas Resoluções CONAMA nº 410/2009 e nº 430/2011</span>
    </div>
    ${extras}
  </div>`
}

// ── "Entenda o cálculo do IQA" — popup ────────────────────────────
// Conteúdo gerado a partir dos MESMOS números de agua_calcular_iqa()/
// agua_iqa_faixa() (migration 249) — nunca uma explicação solta,
// divergente do que o banco de fato calcula. Se os pesos ou as faixas
// mudarem lá, este texto tem que ser atualizado junto.
const AGUA_PAINEL_IQA_PESOS = [
  { label: 'Oxigênio Dissolvido (saturação)', peso: 17 },
  { label: 'Coliformes termotolerantes',      peso: 15 },
  { label: 'pH',                              peso: 12 },
  { label: 'DBO (Demanda Bioquímica de Oxigênio)', peso: 10 },
  { label: 'Nitrogênio total',                peso: 10 },
  { label: 'Fósforo total',                   peso: 10 },
  { label: 'Variação de temperatura (ΔT)',    peso: 10 },
  { label: 'Turbidez',                        peso: 8 },
  { label: 'Sólidos totais',                  peso: 8 },
]

function aguaPainelExplicacaoIqaHTML() {
  const linhasPeso = AGUA_PAINEL_IQA_PESOS.map(p => `
    <div class="adash-iqa-peso-linha">
      <span class="adash-iqa-peso-label">${esc(p.label)}</span>
      <div class="adash-iqa-peso-barra"><div class="adash-iqa-peso-fill" style="width:${(p.peso / 17 * 100).toFixed(0)}%"></div></div>
      <span class="adash-iqa-peso-valor">${p.peso}%</span>
    </div>`).join('')

  const linhasFaixa = AGUA_IQA_FAIXA_ORDEM.map(f => {
    const rotulo = { 'Ótima': '≥ 79', 'Boa': '51 a 78', 'Regular': '36 a 50', 'Ruim': '19 a 35', 'Péssima': '< 19' }[f]
    return `<div class="adash-iqa-faixa-linha">
      <span class="adash-iqa-faixa-dot" style="background:${AGUA_IQA_FAIXA_COR[f]}"></span>
      <span class="adash-iqa-faixa-nome">${esc(f)}</span>
      <span class="adash-iqa-faixa-valor">${rotulo}</span>
    </div>`
  }).join('')

  return `<div class="modal-header">
      <div class="modal-title">Entenda o cálculo do IQA</div>
      <button class="modal-close" onclick="alternarExplicacaoIqa()">×</button>
    </div>
    <div class="modal-body">
      <p class="adash-iqa-p">O Índice de Qualidade da Água (IQA) usado neste sistema segue o método
        <strong>CETESB/ANA</strong>: uma <strong>média geométrica ponderada</strong> de 9 parâmetros medidos em
        campo e em laboratório. Cada parâmetro entra como uma nota de 0 a 100 (seu "q<sub>i</sub>"), lida numa
        curva de qualidade própria — não é uma média simples dos valores medidos.</p>
      <p class="adash-iqa-p">Nem todo parâmetro pesa igual: quanto mais direto o efeito na saúde do rio e de quem
        usa a água, maior o peso.</p>
      <div class="adash-iqa-pesos">${linhasPeso}</div>
      <p class="adash-iqa-p" style="margin-top:14px">Se faltar mais de 40% do peso total (por exemplo, um laudo
        ainda não chegou), o sistema não calcula o índice — mostra "sem índice" em vez de um número que
        enganaria. Faixa final:</p>
      <div class="adash-iqa-faixas">${linhasFaixa}</div>
      <p class="adash-iqa-p" style="margin-top:14px">A <strong>Conformidade CONAMA</strong> é uma leitura
        SEPARADA do IQA: verifica se cada parâmetro está dentro do limite legal da classe de enquadramento do
        ponto (ver card "Base Legal e Conformidade"). Um ponto pode ter IQA "Boa" e ainda violar um limite
        específico — os dois indicadores respondem perguntas diferentes.</p>
    </div>
    <div class="modal-footer">
      <button class="btn btn-secondary" onclick="alternarExplicacaoIqa()">Fechar</button>
    </div>`
}

// ── Mapa dos pontos de coleta ────────────────────────────────────
// Container vive fora do bloco que `aguaPainelHTML` reconstrói — nasce
// uma vez só e só troca marcador, preservando zoom/posição entre
// filtros (mesma regra de pages/agua-relatorios.html desde a Fase 5).
// Estilo de marcador vem de js/agua-iqa-visual.js (aguaIqaEstiloMarcador)
// — nunca reimplementado aqui.
// Mapa base (ruas) e satélite — MESMA fonte de imagem de satélite já
// usada em pages/mapa.html. Satélite usa o mosaico HÍBRIDO do Google
// (lyrs=y — o mesmo id do botão "Híbrido" de pages/mapa.html e do
// minimapa de lá, _adicionarMiniMapa), não o satélite puro (lyrs=s):
// pedido do usuário — satélite puro não tem rótulo nenhum, o híbrido
// já traz nome de rio/lugar nativo, sem depender só da geometria da
// WMS de hidrografia. Nunca uma segunda fonte de tile.
const AGUA_PAINEL_TILE_RUAS = { url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', opts: { maxZoom: 18, attribution: '© OpenStreetMap' } }
const AGUA_PAINEL_TILE_SATELITE = { url: 'https://{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}', opts: { maxZoom: 20, subdomains: ['mt0', 'mt1', 'mt2', 'mt3'] } }

// Hidrografia — MESMO serviço WMS de pages/mapa.html (HIDRO_WMS_URL/
// HIDRO_WMS_LAYERS), nunca uma segunda fonte. Lá é uma camada
// opcional (toggle); aqui entra SEMPRE ligada — pedido do usuário
// para o satélite (que não tem nome de rio/via nenhum) já nascer com
// o contexto geográfico pronto, sem precisar de um menu de camadas
// que este card pequeno não tem espaço para oferecer.
const AGUA_PAINEL_HIDRO_WMS_URL = 'https://geoservicos.ibge.gov.br/geoserver/ows'
const AGUA_PAINEL_HIDRO_WMS_LAYERS = 'CCAR:BC250_Massa_Dagua_A,CCAR:BC250_Trecho_Drenagem_L'

// Configuração das delimitações (cor/espessura do limite do Acre e dos
// municípios, mostrar/ocultar o nome do município) — pedido do
// usuário. Persistida por navegador (mesmo padrão de
// siguc_nav_grupos/siguc_resumo_largura): é preferência de EXIBIÇÃO,
// não dado do banco, então localStorage é o lugar certo, sem RPC nova.
const AGUA_PAINEL_CAMADAS_CHAVE = 'siguc_agua_painel_camadas'
// Padrão pedido pelo usuário: linha contínua amarela nas duas
// delimitações, limite do Acre 30% mais espesso que os municípios
// (2,6 vs 2 — a mesma proporção pedida, só arredondada pro décimo).
const AGUA_PAINEL_CAMADAS_PADRAO = { acreCor: '#FACC15', acrePeso: 2.6, munCor: '#FACC15', munPeso: 2, munNomes: true }
function _aguaPainelCamadasCarregar() {
  try {
    const salvo = JSON.parse(localStorage.getItem(AGUA_PAINEL_CAMADAS_CHAVE) || '{}')
    return Object.assign({}, AGUA_PAINEL_CAMADAS_PADRAO, salvo)
  } catch (e) { return Object.assign({}, AGUA_PAINEL_CAMADAS_PADRAO) }
}
function _aguaPainelCamadasSalvar(cfg) {
  try { localStorage.setItem(AGUA_PAINEL_CAMADAS_CHAVE, JSON.stringify(cfg)) } catch (e) { /* modo privado/quota — segue sem persistir */ }
}

// Rosa dos ventos — MESMO desenho/SVG de pages/mapa.html
// (_adicionarRosaDosVentos), reaproveitado aqui pela regra do projeto
// de nunca duplicar um componente cartográfico "oficial" com desenho
// próprio numa tela nova.
function _aguaPainelRosaDosVentos() {
  const Ctrl = L.Control.extend({ options: { position: 'bottomleft' }, onAdd() {
    const div = L.DomUtil.create('div', 'rosa-norte'); div.title = 'Norte'
    div.innerHTML = `<svg viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg">
      <circle cx="22" cy="22" r="20" fill="none" stroke="#e5e7eb" stroke-width="1"/>
      <polygon points="22,3 26,22 22,19 18,22" fill="#dc2626"/>
      <polygon points="22,41 18,22 22,25 26,22" fill="#9ca3af"/>
      <circle cx="22" cy="22" r="3" fill="#1f2937"/>
      <text x="22" y="14" text-anchor="middle" font-size="6" font-weight="700" font-family="DM Sans,sans-serif" fill="#dc2626">N</text>
      <text x="22" y="43" text-anchor="middle" font-size="5.5" font-weight="600" font-family="DM Sans,sans-serif" fill="#6b7280">S</text>
      <text x="41" y="23.5" text-anchor="middle" font-size="5.5" font-weight="600" font-family="DM Sans,sans-serif" fill="#6b7280">L</text>
      <text x="3" y="23.5" text-anchor="middle" font-size="5.5" font-weight="600" font-family="DM Sans,sans-serif" fill="#6b7280">O</text>
    </svg>`
    L.DomEvent.disableClickPropagation(div); return div
  } })
  return new Ctrl()
}

// Legenda oficial (IQA + CONAMA) — MESMAS categorias de
// pages/agua-mapa.html (`#amapa-legenda`), nunca uma segunda cópia:
// preenchimento = faixa do IQA, borda = conformidade CONAMA,
// preenchimento fraco = coleta em quarentena.
// `cfg` (opcional) é a configuração ao vivo de _aguaPainelCamadasCarregar
// — os chips de "Camadas de referência" refletem a cor escolhida pelo
// usuário no painel de configuração, nunca ficam presos ao padrão.
function _aguaPainelLegendaHTML(cfg) {
  const c = cfg || AGUA_PAINEL_CAMADAS_PADRAO
  const chipsIqa = AGUA_IQA_FAIXA_ORDEM.map(f => `<span class="adash-mapa-legenda-chip"><span class="adash-mapa-legenda-dot" style="background:${AGUA_IQA_FAIXA_COR[f]}"></span>${esc(f)}</span>`).join('')
  return `<div class="adash-mapa-legenda-tit">IQA (preenchimento)</div>
    <div class="adash-mapa-legenda-linha">${chipsIqa}</div>
    <div class="adash-mapa-legenda-tit" style="margin-top:6px">CONAMA (borda)</div>
    <div class="adash-mapa-legenda-linha">
      <span class="adash-mapa-legenda-chip"><span class="adash-mapa-legenda-dot" style="background:#fff;border:2px solid #16A34A"></span>Conforme</span>
      <span class="adash-mapa-legenda-chip"><span class="adash-mapa-legenda-dot" style="background:#fff;border:3px solid #DC2626"></span>Violação</span>
    </div>
    <div class="adash-mapa-legenda-linha" style="margin-top:4px">
      <span class="adash-mapa-legenda-chip">Preenchimento fraco = em conferência</span>
    </div>
    <div class="adash-mapa-legenda-tit" style="margin-top:6px">Camadas de referência (só satélite)</div>
    <div class="adash-mapa-legenda-linha">
      <span class="adash-mapa-legenda-chip"><span class="adash-mapa-legenda-linha-cor" style="background:${c.acreCor}"></span>Limite do Acre</span>
      <span class="adash-mapa-legenda-chip"><span class="adash-mapa-legenda-linha-cor" style="background:${c.munCor};opacity:.6"></span>Municípios</span>
      <span class="adash-mapa-legenda-chip"><span class="adash-mapa-legenda-linha-cor" style="background:#2563eb"></span>Rios (IBGE)</span>
    </div>`
}

function _aguaPainelControleLegenda(cfg) {
  const Ctrl = L.Control.extend({ options: { position: 'bottomright' }, onAdd() {
    const div = L.DomUtil.create('div', 'adash-mapa-legenda')
    div.innerHTML = _aguaPainelLegendaHTML(cfg)
    L.DomEvent.disableClickPropagation(div); return div
  } })
  return new Ctrl()
}

// Painel "Configurar camadas" — cor/espessura do limite do Acre e dos
// municípios, e mostrar/ocultar o nome do município. `cfgInicial` vem
// de _aguaPainelCamadasCarregar (já com a preferência salva);
// `aoMudar(cfg)` é chamado a cada alteração, ao vivo (sem botão
// "Aplicar" — mesmo espírito dos outros controles do painel).
function _aguaPainelControleConfigCamadas(cfgInicial, aoMudar) {
  const Ctrl = L.Control.extend({ options: { position: 'topright' }, onAdd() {
    const div = L.DomUtil.create('div', 'adash-mapa-config-ctrl')
    div.innerHTML = `
      <button type="button" class="adash-mapa-config-btn" title="Configurar camadas" aria-label="Configurar camadas">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="3"/>
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z"/>
        </svg>
      </button>
      <div class="adash-mapa-config-painel" hidden>
        <p class="adash-mapa-config-tit">Limite do Acre</p>
        <label class="adash-mapa-config-linha">Cor <input type="color" class="amcfg-acre-cor" value="${cfgInicial.acreCor}"></label>
        <label class="adash-mapa-config-linha">Espessura <input type="range" min="1" max="5" step="0.1" class="amcfg-acre-peso" value="${cfgInicial.acrePeso}"><span class="amcfg-acre-peso-val">${cfgInicial.acrePeso}</span></label>
        <p class="adash-mapa-config-tit" style="margin-top:10px">Municípios</p>
        <label class="adash-mapa-config-linha">Cor <input type="color" class="amcfg-mun-cor" value="${cfgInicial.munCor}"></label>
        <label class="adash-mapa-config-linha">Espessura <input type="range" min="1" max="5" step="0.1" class="amcfg-mun-peso" value="${cfgInicial.munPeso}"><span class="amcfg-mun-peso-val">${cfgInicial.munPeso}</span></label>
        <label class="adash-mapa-config-check"><input type="checkbox" class="amcfg-mun-nomes" ${cfgInicial.munNomes ? 'checked' : ''}> Mostrar nomes dos municípios</label>
      </div>`
    const btn = div.querySelector('.adash-mapa-config-btn')
    const painel = div.querySelector('.adash-mapa-config-painel')
    btn.addEventListener('click', () => { painel.hidden = !painel.hidden })
    const acrePesoVal = div.querySelector('.amcfg-acre-peso-val')
    const munPesoVal = div.querySelector('.amcfg-mun-peso-val')
    function ler() {
      return {
        acreCor: div.querySelector('.amcfg-acre-cor').value,
        acrePeso: Number(div.querySelector('.amcfg-acre-peso').value),
        munCor: div.querySelector('.amcfg-mun-cor').value,
        munPeso: Number(div.querySelector('.amcfg-mun-peso').value),
        munNomes: div.querySelector('.amcfg-mun-nomes').checked,
      }
    }
    div.querySelectorAll('input').forEach(inp => inp.addEventListener('input', () => {
      const cfg = ler()
      acrePesoVal.textContent = cfg.acrePeso
      munPesoVal.textContent = cfg.munPeso
      aoMudar(cfg)
    }))
    L.DomEvent.disableClickPropagation(div)
    return div
  } })
  return new Ctrl()
}

// Alternar Mapa/Satélite — MESMA fonte de tile do seletor de basemap
// de pages/mapa.html, só que reduzido a um toggle de 2 estados (o
// widget aqui é pequeno demais para o painel completo de basemaps).
function _aguaPainelControleSatelite(aoTrocar) {
  const Ctrl = L.Control.extend({ options: { position: 'topright' }, onAdd() {
    const div = L.DomUtil.create('div', 'adash-mapa-sat-ctrl')
    div.innerHTML = `<button type="button" class="adash-mapa-sat-btn ativo" data-modo="ruas">Mapa</button><button type="button" class="adash-mapa-sat-btn" data-modo="satelite">Satélite</button>`
    div.querySelectorAll('.adash-mapa-sat-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        div.querySelectorAll('.adash-mapa-sat-btn').forEach(b => b.classList.toggle('ativo', b === btn))
        aoTrocar(btn.dataset.modo)
      })
    })
    L.DomEvent.disableClickPropagation(div); return div
  } })
  return new Ctrl()
}

// Pino "gota d'água" (Opção A aprovada pelo usuário num Artifact de
// comparação, antes de codar) — substitui o círculo simples. Cor de
// preenchimento/borda continua vindo de aguaIqaEstiloMarcador
// (js/agua-iqa-visual.js), nunca reimplementada aqui: só a FORMA do
// marcador mudou, a semântica de cor (faixa do IQA/conformidade
// CONAMA/quarentena) é a mesma de antes.
function _aguaPainelPinSVG(estilo) {
  const { fillColor, color, weight, dashArray, fillOpacity } = estilo
  return `<svg viewBox="0 0 30 38" xmlns="http://www.w3.org/2000/svg" style="opacity:${fillOpacity == null ? 1 : fillOpacity}">
    <path d="M15 1C7 1 1 7.5 1 15c0 9.5 12 20.5 13.3 21.7.4.4 1 .4 1.4 0C17 35.5 29 24.5 29 15 29 7.5 23 1 15 1Z"
      fill="${fillColor}" stroke="${color}" stroke-width="${weight}" ${dashArray ? `stroke-dasharray="${dashArray}"` : ''}/>
    <circle cx="15" cy="15" r="7.2" fill="#fff"/>
    <path d="M15 9.5c1.8 2.4 4 5.3 4 7.7a4 4 0 1 1-8 0c0-2.4 2.2-5.3 4-7.7Z" fill="${fillColor}"/>
  </svg>`
}
function _aguaPainelPinIcon(estilo) {
  return L.divIcon({
    className: 'adash-mapa-pin',
    html: _aguaPainelPinSVG(estilo),
    iconSize: [30, 38],
    iconAnchor: [15, 38],
    popupAnchor: [0, -34],
  })
}

function aguaPainelMapaCriar(mapaElId, subElId) {
  const mapa = L.map(mapaElId, { attributionControl: false }).setView([-9.5, -70.0], 6)
  let camadaBase = L.tileLayer(AGUA_PAINEL_TILE_RUAS.url, AGUA_PAINEL_TILE_RUAS.opts).addTo(mapa)

  // Limite do Acre, municípios e hidrografia só fazem sentido no
  // satélite — pedido do usuário: o mapa de ruas já tem seus próprios
  // rótulos/divisas (OSM), essas camadas de referência existem pra
  // compensar a falta deles na imagem de satélite. Guardado à parte
  // (nunca dentro do mapa) porque os 3 desenhos terminam de carregar
  // de forma assíncrona, em momentos diferentes do toggle de basemap.
  let _modoAtual = 'ruas'
  const _camadasReferencia = []
  function _registrarCamadaReferencia(layer) {
    _camadasReferencia.push(layer)
    _atualizarCamadasReferencia()
  }
  function _atualizarCamadasReferencia() {
    const visivel = _modoAtual === 'satelite'
    _camadasReferencia.forEach(l => {
      if (visivel && !mapa.hasLayer(l)) l.addTo(mapa)
      else if (!visivel && mapa.hasLayer(l)) mapa.removeLayer(l)
    })
  }
  function _trocarBase(modo) {
    mapa.removeLayer(camadaBase)
    const t = modo === 'satelite' ? AGUA_PAINEL_TILE_SATELITE : AGUA_PAINEL_TILE_RUAS
    camadaBase = L.tileLayer(t.url, t.opts).addTo(mapa)
    camadaBase.bringToBack()
    _modoAtual = modo
    _atualizarCamadasReferencia()
  }

  // Componentes cartográficos oficiais — mesmos do Mapa das UCs
  // (pages/mapa.html): rosa dos ventos, escala métrica, legenda,
  // alternância de imagem de satélite, configuração das delimitações.
  let _cfgCamadas = _aguaPainelCamadasCarregar()
  let _acreLayer = null
  let _munLayer = null
  const _legendaCtl = _aguaPainelControleLegenda(_cfgCamadas).addTo(mapa)
  const _legendaDiv = _legendaCtl.getContainer()

  _aguaPainelRosaDosVentos().addTo(mapa)
  L.control.scale({ position: 'bottomleft', metric: true, imperial: false, maxWidth: 110 }).addTo(mapa)
  _aguaPainelControleSatelite(_trocarBase).addTo(mapa)
  _aguaPainelControleConfigCamadas(_cfgCamadas, (novoCfg) => {
    _cfgCamadas = novoCfg
    _aguaPainelCamadasSalvar(novoCfg)
    if (_acreLayer) _acreLayer.setStyle({ color: novoCfg.acreCor, weight: novoCfg.acrePeso })
    if (_munLayer) {
      _munLayer.setStyle({ color: novoCfg.munCor, weight: novoCfg.munPeso, fillColor: novoCfg.munCor })
      _munLayer.eachLayer(layer => {
        const nome = layer.feature?.properties?.name || layer.feature?.properties?.nome || layer.feature?.properties?.NM_MUN || 'Município'
        layer.unbindTooltip()
        layer.bindTooltip(nome, { permanent: novoCfg.munNomes, direction: 'center', className: 'adash-mapa-mun-label' })
        if (novoCfg.munNomes) layer.openTooltip()
      })
    }
    if (_legendaDiv) _legendaDiv.innerHTML = _aguaPainelLegendaHTML(novoCfg)
  }).addTo(mapa)

  ;(async function desenharLimiteAcre() {
    try {
      const r = await fetch('../data/acre_estado.geojson')
      if (!r.ok) throw new Error('HTTP ' + r.status)
      const gj = await r.json()
      _acreLayer = L.geoJSON(gj, { style: { color: _cfgCamadas.acreCor, weight: _cfgCamadas.acrePeso, fill: false, opacity: .5 }, interactive: false })
      _registrarCamadaReferencia(_acreLayer)
    } catch (e) { console.warn('[agua-painel] limite do Acre indisponível para desenho:', e.message) }
  })()

  // Municípios — MESMO arquivo de pages/mapa.html (data/municipios_acre.
  // geojson), com o nome de cada um em tooltip permanente. Lá é um
  // toggle (#mun-toggle); aqui nasce SÓ na visão satélite (pode ser
  // ocultado de vez pelo painel "Configurar camadas" acima) — o mapa
  // de ruas já tem os próprios limites/rótulos do OSM.
  ;(async function desenharMunicipios() {
    try {
      const r = await fetch('../data/municipios_acre.geojson')
      if (!r.ok) throw new Error('HTTP ' + r.status)
      const gj = await r.json()
      _munLayer = L.geoJSON(gj, {
        // Linha contínua (sem dashArray) — pedido do usuário, mesmo
        // padrão visual do limite do Acre.
        style: { color: _cfgCamadas.munCor, weight: _cfgCamadas.munPeso, opacity: .8, fillColor: _cfgCamadas.munCor, fillOpacity: .02 },
        interactive: false,
        onEachFeature(f, layer) {
          const nome = f.properties?.name || f.properties?.nome || f.properties?.NM_MUN || 'Município'
          layer.bindTooltip(nome, { permanent: _cfgCamadas.munNomes, direction: 'center', className: 'adash-mapa-mun-label' })
        },
      })
      _registrarCamadaReferencia(_munLayer)
    } catch (e) { console.warn('[agua-painel] municípios indisponíveis para desenho:', e.message) }
  })()

  // Hidrografia (rios/massas d'água) — MESMO serviço WMS de
  // pages/mapa.html (ver AGUA_PAINEL_HIDRO_WMS_URL). Fica acima da
  // base (ruas/satélite) e abaixo dos pinos: _trocarBase() já chama
  // bringToBack() na base nova, então trocar pra satélite nunca cobre
  // esta camada. Só satélite (ver _registrarCamadaReferencia acima) —
  // o mosaico híbrido já traz nome de rio/lugar como rótulo nativo, a
  // WMS complementa com a geometria exata dos corpos d'água.
  _registrarCamadaReferencia(L.tileLayer.wms(AGUA_PAINEL_HIDRO_WMS_URL, {
    layers: AGUA_PAINEL_HIDRO_WMS_LAYERS, format: 'image/png', transparent: true, version: '1.1.1',
    opacity: .6, maxZoom: 22, maxNativeZoom: 16, attribution: 'Hidrografia · IBGE (BC250)',
    errorTileUrl: 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==',
  }))

  let marcadores = {}

  // `pontosGeomPorId`: { [ponto_id]: [lat, lng] }. `rel` pode ser null
  // (erro de carga) — mostra o que já se sabe (a lista de pontos
  // cadastrados, sem coleta) em vez de esconder o mapa. `onClique(ponto,
  // ultimaColeta)` (opcional) — cada página decide o que "clicar no
  // pino" abre (o popup de detalhe, ver aguaPainelColetaDetalheHTML).
  function atualizar(rel, pontosGeomPorId, onClique) {
    Object.values(marcadores).forEach(m => mapa.removeLayer(m))
    marcadores = {}
    const bounds = []
    const pontos = rel ? rel.pontos : []
    pontos.forEach(p => {
      const ll = pontosGeomPorId[p.ponto_id]
      if (!ll) return
      // Coleta mais recente do ponto DENTRO do recorte já filtrado —
      // as coletas de cada ponto já vêm em ordem cronológica de
      // aguaRelMontar. Nunca a média classificada numa faixa.
      const ultima = p.coletas.length ? p.coletas[p.coletas.length - 1] : null
      const m = L.marker(ll, { icon: _aguaPainelPinIcon(aguaIqaEstiloMarcador(ultima)) })
      const iqaTxt = ultima && ultima.iqa != null
        ? `IQA ${ultima.iqa.toFixed(0)} (${ultima.iqa_faixa || 'sem faixa'})`
        : 'Sem coleta com índice no recorte'
      m.bindTooltip(`<strong>${esc(p.nome)}</strong><br>${esc(iqaTxt)}`, { direction: 'top', offset: [0, -30] })
      if (onClique) m.on('click', () => onClique(p, ultima))
      m.addTo(mapa)
      marcadores[p.ponto_id] = m
      bounds.push(ll)
    })
    const sub = document.getElementById(subElId)
    if (sub) {
      sub.textContent = bounds.length
        ? `${bounds.length} ponto${bounds.length !== 1 ? 's' : ''} no recorte atual — toque num ponto para ver os detalhes`
        : 'Nenhum ponto no recorte atual'
    }
    if (bounds.length === 1) mapa.setView(bounds[0], 10)
    else if (bounds.length > 1) mapa.fitBounds(bounds, { padding: [28, 28], maxZoom: 9 })
  }

  return { mapa, atualizar }
}

// ── Detalhe do ponto (popup ao clicar no pino) ──────────────────
// Pura — devolve string, quem chama decide onde injetar e como abrir/
// fechar (mesmo padrão de aguaPainelExplicacaoIqaHTML). `c` é a coleta
// mais recente do ponto no recorte (linha crua de agua_coletas via
// vw_agua_coletas_detalhe na mesa, ou de agua_publico_coletas() no
// público — mesma forma, colunas a mais ou a menos). Campos que só
// existem na mesa (coletor_nome, laboratorio_nome, quarentena_motivo,
// observacoes) usam `!== undefined` para sumir de vez no público
// (ausência de coluna) em vez de aparecer como "—" (campo existe, só
// está vazio) — mesma distinção que o resto do projeto já usa.
const AGUA_PAINEL_CLASSE_LABEL = { especial: 'Especial', classe_1: 'Classe 1', classe_2: 'Classe 2', classe_3: 'Classe 3', classe_4: 'Classe 4' }

function aguaPainelColetaDetalheHTML(ponto, c) {
  if (!c) {
    return `<div class="modal-header">
        <div class="modal-title">${esc(ponto.nome)}</div>
        <button class="modal-close" onclick="fecharDetalheColetaPainel()">×</button>
      </div>
      <div class="modal-body"><p class="adet-hint">Nenhuma coleta registrada para este ponto no recorte atual.</p></div>
      <div class="modal-footer"><button class="btn btn-secondary" onclick="fecharDetalheColetaPainel()">Fechar</button></div>`
  }

  const semLimites = c.conama_violacoes == null
  const violou = !semLimites && c.conama_violacoes.length > 0
  const statusLabel = c.status === 'completo' ? 'Completo'
    : c.status === 'quarentena' ? 'Em conferência (quarentena)' : 'Aguardando laudo'
  const params = Object.entries(AGUA_REL_PARAM_LABEL).filter(([campo]) => c[campo] != null)

  return `<div class="modal-header">
      <div>
        <div class="modal-title">${esc(c.ponto_nome)}${c.codigo_ana ? ' · ' + esc(c.codigo_ana) : ''}</div>
        <p class="adet-sub">${esc(aguaRelLabelCampanha(c))}</p>
      </div>
      <button class="modal-close" onclick="fecharDetalheColetaPainel()">×</button>
    </div>
    <div class="modal-body">
      ${(c.ponto_rio || c.ponto_municipio) ? `<div class="adet-linha"><span>Local</span><strong>${esc([c.ponto_rio, c.ponto_municipio].filter(Boolean).join(' · '))}</strong></div>` : ''}
      ${c.classe_enquadramento ? `<div class="adet-linha"><span>Classe de enquadramento</span><strong>${esc(AGUA_PAINEL_CLASSE_LABEL[c.classe_enquadramento] || c.classe_enquadramento)}</strong></div>` : ''}
      <div class="adet-linha"><span>Data da coleta</span><strong>${formatData(c.data_coleta)}</strong></div>
      ${c.coletor_nome !== undefined ? `<div class="adet-linha"><span>Coletor</span><strong>${esc(c.coletor_nome || '—')}</strong></div>` : ''}
      ${c.laboratorio_nome !== undefined ? `<div class="adet-linha"><span>Laboratório</span><strong>${esc(c.laboratorio_nome || '—')}</strong></div>` : ''}
      <div class="adet-linha"><span>Status</span><strong>${esc(statusLabel)}</strong></div>
      ${c.status === 'quarentena' ? `<p class="adet-hint">Dado preliminar, pendente de conferência humana.${c.quarentena_motivo ? ' ' + esc(c.quarentena_motivo) : ''}</p>` : ''}

      <div class="adet-cards">
        <div class="adet-card">
          <span class="adet-card-tit">IQA</span>
          <strong class="adet-card-valor" style="color:${AGUA_IQA_FAIXA_COR[c.iqa_faixa] || AGUA_SEM_IQA_COR}">${c.iqa != null ? Number(c.iqa).toFixed(1) : '—'}</strong>
          <span class="adet-card-sub">${esc(c.iqa_faixa || 'Sem dado suficiente')}</span>
        </div>
        <div class="adet-card">
          <span class="adet-card-tit">CONAMA</span>
          <strong class="adet-card-valor" style="color:${violou ? '#C2410C' : semLimites ? '#9CA3AF' : '#059669'}">${semLimites ? 'Sem limites' : violou ? `${c.conama_violacoes.length} ${c.conama_violacoes.length > 1 ? 'violações' : 'violação'}` : 'Conforme'}</strong>
          ${violou ? `<span class="adet-card-sub">${esc(c.conama_violacoes.map(v => AGUA_REL_PARAM_LABEL[v] || v).join(', '))}</span>` : ''}
        </div>
      </div>

      ${params.length ? `
        <p class="adet-params-tit">Parâmetros medidos</p>
        <div class="adet-params">
          ${params.map(([campo, rotulo]) => `
            <div class="adet-param-linha${c.conama_violacoes?.includes(campo) ? ' adet-param-violado' : ''}">
              <span>${esc(rotulo)}</span><strong>${Number(c[campo]).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}</strong>
            </div>`).join('')}
        </div>` : '<p class="adet-hint">Ainda sem parâmetros lançados — aguardando laudo do laboratório.</p>'}

      ${c.observacoes ? `<p class="adet-params-tit">Observações</p><p class="adet-obs">${esc(c.observacoes)}</p>` : ''}
    </div>
    <div class="modal-footer">
      <button class="btn btn-secondary" onclick="fecharDetalheColetaPainel()">Fechar</button>
      <button class="btn btn-primary" id="adet-btn-exportar" onclick="exportarFichaColetaPainel()" data-icon="download">Exportar PDF</button>
    </div>`
}
