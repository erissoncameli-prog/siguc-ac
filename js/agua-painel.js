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
function aguaPainelMapaCriar(mapaElId, subElId) {
  const mapa = L.map(mapaElId, { attributionControl: false }).setView([-9.5, -70.0], 6)
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, attribution: '© OpenStreetMap' }).addTo(mapa)
  ;(async function desenharLimiteAcre() {
    try {
      const r = await fetch('../data/acre_estado.geojson')
      if (!r.ok) throw new Error('HTTP ' + r.status)
      const gj = await r.json()
      L.geoJSON(gj, { style: { color: '#1F4E2C', weight: 2, fill: false, opacity: .5 }, interactive: false }).addTo(mapa)
    } catch (e) { console.warn('[agua-painel] limite do Acre indisponível para desenho:', e.message) }
  })()

  let marcadores = {}

  // `pontosGeomPorId`: { [ponto_id]: [lat, lng] }. `rel` pode ser null
  // (erro de carga) — mostra o que já se sabe (a lista de pontos
  // cadastrados, sem coleta) em vez de esconder o mapa.
  function atualizar(rel, pontosGeomPorId) {
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
      const m = L.circleMarker(ll, Object.assign({ radius: 8 }, aguaIqaEstiloMarcador(ultima)))
      const iqaTxt = ultima && ultima.iqa != null
        ? `IQA ${ultima.iqa.toFixed(0)} (${ultima.iqa_faixa || 'sem faixa'})`
        : 'Sem coleta com índice no recorte'
      m.bindTooltip(`<strong>${esc(p.nome)}</strong><br>${esc(iqaTxt)}`, { direction: 'top', offset: [0, -8] })
      m.addTo(mapa)
      marcadores[p.ponto_id] = m
      bounds.push(ll)
    })
    const sub = document.getElementById(subElId)
    if (sub) {
      sub.textContent = bounds.length
        ? `${bounds.length} ponto${bounds.length !== 1 ? 's' : ''} no recorte atual — cor pela coleta mais recente do período`
        : 'Nenhum ponto no recorte atual'
    }
    if (bounds.length === 1) mapa.setView(bounds[0], 10)
    else if (bounds.length > 1) mapa.fitBounds(bounds, { padding: [28, 28], maxZoom: 9 })
  }

  return { mapa, atualizar }
}
