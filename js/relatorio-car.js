// SIGUC-AC · Relatório de Impressão CAR
// Depende de: config-sistema.js, turf.js (já carregado no mapa.html)
// Leaflet já carregado globalmente como `L`

// ── Utilitários ───────────────────────────────────────────────────────────

const _relEsc = s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const _relF2  = n => Number(n||0).toLocaleString('pt-BR',{maximumFractionDigits:2});
const _relF1  = n => Number(n||0).toLocaleString('pt-BR',{maximumFractionDigits:1});
const _relPct = (v,t) => t>0 ? _relF1(v/t*100) : '0,0';
const _relData = () => new Date().toLocaleDateString('pt-BR');

function _calcularEscalaLeaflet(zoom, lat) {
  const mPx = 156543.03392 * Math.cos((lat||0) * Math.PI / 180) / Math.pow(2, zoom||10);
  const raw  = Math.round(mPx * 96 / 0.0254);
  const escalas = [500,1000,2000,5000,10000,25000,50000,100000,250000,500000,1000000,2000000];
  const nearest = escalas.reduce((p,c) => Math.abs(c-raw)<Math.abs(p-raw)?c:p);
  return `1:${nearest.toLocaleString('pt-BR')}`;
}

// ── Estado do modal ───────────────────────────────────────────────────────

let _relEscopo = 'atual';  // 'atual' | 'marcados'
let _relModo   = 'detalhado'; // 'sintetico' | 'detalhado'

// ── Abrir modal de seleção ─────────────────────────────────────────────────

function abrirModalRelatorio() {
  try {
    if (!_carAbertoCod) { toast('Abra um imóvel CAR primeiro.','warning'); return; }

    const nMarcados = (_carMarcados instanceof Map) ? _carMarcados.size : 0;
    const dadosLocais = (_carDadosLocais instanceof Map) ? _carDadosLocais.get(_carAbertoCod) : null;
    const nomeImovel = _relEsc(
      dadosLocais?.nom_imovel ||
      _carAbertoFeat?.properties?.cod_imovel || _carAbertoCod
    );

  const el = document.createElement('div');
  el.id = 'rel-modal-overlay';
  el.innerHTML = `
  <div id="rel-modal">
    <div class="rm-hdr">
      <h3>🖨️ Gerar Relatório do Imóvel</h3>
      <p>${nomeImovel} · ${_relEsc(_carAbertoCod)}</p>
    </div>
    <div class="rm-body">
      <div class="rm-label">Escopo do relatório</div>
      <div class="rm-opcao ativo" id="rel-esc-atual" onclick="_relSetEscopo('atual')">
        <span class="rm-ic">🏡</span>
        <div class="rm-tx"><h4>Imóvel atual</h4><p>Relatório apenas para este imóvel.</p></div>
      </div>
      <div class="rm-opcao${nMarcados?'':' disabled'}" id="rel-esc-marc"
           style="${nMarcados?'':'opacity:.45;cursor:not-allowed'}"
           onclick="${nMarcados?"_relSetEscopo('marcados')":''}">
        <span class="rm-ic">📌</span>
        <div class="rm-tx">
          <h4>Todos os imóveis marcados</h4>
          <p>Relatório consolidado — cada imóvel vira uma seção com mapa de detalhe próprio.</p>
        </div>
        ${nMarcados?`<span class="rm-badge">${nMarcados} marcado${nMarcados>1?'s':''}</span>`:'<span class="rm-badge" style="background:#f3f4f6;color:#9ca3af;border-color:#e5e7eb">0 marcados</span>'}
      </div>
      <hr class="rm-sep">
      <div class="rm-label">Nível de detalhamento</div>
      <div class="rm-modos">
        <div class="rm-modo" id="rel-modo-sint" onclick="_relSetModo('sintetico')">
          <div class="rm-mi">📋</div><h4>Sintético</h4>
          <p>1–2 páginas por imóvel. KPIs, mapas e conclusão. Ideal para despachos.</p>
        </div>
        <div class="rm-modo ativo" id="rel-modo-det" onclick="_relSetModo('detalhado')">
          <div class="rm-mi">📑</div><h4>Detalhado</h4>
          <p>Laudo técnico completo com gráficos, tabelas e narrativa jurídica.</p>
        </div>
      </div>
    </div>
    <div class="rm-footer">
      <button class="btn btn-secondary" onclick="_fecharModalRelatorio()">Cancelar</button>
      <button class="btn btn-outline"   onclick="_abrirPreviewRelatorio()">👁 Pré-visualizar</button>
      <button class="btn btn-primary"   onclick="_imprimirRelatorio()">🖨️ Imprimir / PDF</button>
    </div>
  </div>`;
  document.body.appendChild(el);
  } catch(err) {
    console.error('[Relatório] Erro ao abrir modal:', err);
    toast('Erro ao abrir relatório: ' + err.message, 'error');
  }
}

function _fecharModalRelatorio() {
  document.getElementById('rel-modal-overlay')?.remove();
}

function _relSetEscopo(v) {
  _relEscopo = v;
  document.getElementById('rel-esc-atual')?.classList.toggle('ativo', v==='atual');
  document.getElementById('rel-esc-marc')?.classList.toggle('ativo', v==='marcados');
}

function _relSetModo(v) {
  _relModo = v;
  document.getElementById('rel-modo-sint')?.classList.toggle('ativo', v==='sintetico');
  document.getElementById('rel-modo-det')?.classList.toggle('ativo', v==='detalhado');
}

// ── Coleta imóveis para o relatório ───────────────────────────────────────

function _relColetarImoveis() {
  if (_relEscopo === 'marcados' && _carMarcados?.size) {
    // Imóveis marcados — usa features do layer CAR
    const cods = [..._carMarcados.keys()];
    return cods.map(cod => {
      const feat = _carFeatures?.find?.(f => f.properties?.cod_imovel === cod);
      return feat || null;
    }).filter(Boolean);
  }
  return _carAbertoFeat ? [_carAbertoFeat] : [];
}

// ── Monta dados de um imóvel (usa caches existentes) ─────────────────────

async function _montarDadosRelatorio(feat) {
  const p    = feat.properties || {};
  const cod  = p.cod_imovel;
  const local= _carDadosLocais?.get?.(cod) || {};
  const pr   = _carProdesCache?.get?.(cod);
  const diag = _carDiagCache?.get?.(cod);

  // Geometria / bbox
  let carPoly, bbox;
  try {
    carPoly = turf.feature(feat.geometry);
    const bb = turf.bbox(carPoly);
    bbox = [bb[0], bb[1], bb[2], bb[3]];
  } catch(e) { bbox = [-73,-11,-66,-7]; }

  const areaCAR = parseFloat(p.area || local.num_area_i || 0) || (carPoly ? turf.area(carPoly)/10000 : 0);

  return {
    // Identificação
    cod_imovel:   cod,
    nom_imovel:   local.nom_imovel  || p.nome || cod,
    nome_compl:   local.nome_compl  || '',
    cpf_cnpj:     local.cpf_cnpj    || p.cpf_cnpj || '—',
    nom_munici:   local.nom_munici  || p.municipio || '—',
    ind_status:   local.ind_status  || p.condicao  || '—',
    nome_class:   local.nome_class  || '—',
    num_modulo:   parseFloat(local.num_modulo || p.num_modulo || 0),
    dat_criaca:   local.dat_criaca  || '—',
    area_ha:      areaCAR,
    pequenaPropriedade: parseFloat(local.num_modulo||0) > 0 && parseFloat(local.num_modulo||0) <= 4,

    // PRODES (pode não estar carregado)
    totalGeral_ha:   pr?.totalGeral    || 0,
    haConsolidado:   pr?.haConsolidado || 0,
    haAutorizado:    pr?.haAutorizado  || 0,
    haAVerificar:    (pr?.haAVerificar||0) + (pr?.haIrregular||0),
    anosAnual:       pr?.anosAnual     || [],
    porAno:          pr?.anual?.porAno || {},
    geojsonFeatAnual:pr?.anual?.geojsonFeatures || [],
    geojsonFeatHist: pr?.historico?.geojsonFeatures || [],
    exigenciaRL:     pr?.exigenciaRL   || areaCAR * 0.8,
    florestaReman:   pr?.florestaRemanescente || Math.max(0, areaCAR - (pr?.totalGeral||0)),
    deficitRL:       pr?.deficitRL     || 0,
    asvList:         pr?.asvList       || [],
    asvBase:         pr?.asvBase       || false,

    // Focos
    focosTotal:        pr?.focos?.total || 0,
    focosPorAno:       pr?.focos?.porAno || [],
    focosCorrelAnos:   pr?.focos?.correlacionados?.map?.(r=>r.ano) || [],
    focosMin:          pr?.focos?.anoMin,
    focosMax:          pr?.focos?.anoMax,

    // UC
    emUC:    diag?.emUC   || false,
    ucNome:  _carUCAtual  || null,
    areaUC:  diag?.areaUC || 0,

    // Geometria
    geometry: feat.geometry,
    bbox,
    centroide: carPoly ? turf.centroid(carPoly).geometry.coordinates : [-70, -9.5],
    prodesCarregado: !!pr && !pr.erro,
  };
}

// ── Gera HTML de um mapa ABNT ─────────────────────────────────────────────

function _htmlMapaABNT({ id, titulo, altura, escala, ref, fonte, camadas }) {
  return `
  <div class="rel-mapa-wrap">
    <div class="rel-mapa-titulo">${_relEsc(titulo)}</div>
    <div id="${id}" class="rel-mapa-div" style="height:${altura||240}px"></div>
    <div class="rel-mapa-rodape">
      <div class="rel-mapa-norte">🧭</div>
      <div class="rel-mapa-info"><strong>Escala</strong>${escala||'1:50.000'}</div>
      <div class="rel-mapa-info"><strong>Ref. Geodésica</strong>SIRGAS 2000<br>Proj. Geográfica</div>
      <div class="rel-mapa-legenda">${(camadas||[]).map(c=>`<span>${c}</span>`).join('')}</div>
      <div class="rel-mapa-fonte">${_relEsc(fonte||'')}<br>Emitido: ${_relData()}</div>
    </div>
  </div>`;
}

// ── Gera HTML completo do relatório ──────────────────────────────────────

async function _gerarHTMLRelatorio(imoveis, modo, cab, protocolo) {
  const folhas = [];

  // Mapa 0 (consolidado) se múltiplos imóveis
  const multi = imoveis.length > 1;
  let mapaConsolidadoId = null;
  if (multi) {
    mapaConsolidadoId = 'rel-mapa-consolidado';
    // Capa consolidada — primeira folha
    folhas.push(_htmlFolhaCapa(imoveis, cab, protocolo, modo, mapaConsolidadoId));
  }

  // Uma folha de análise por imóvel
  for (let i = 0; i < imoveis.length; i++) {
    const d = imoveis[i];
    if (modo === 'sintetico') {
      folhas.push(_htmlFolhaSintetica(d, cab, protocolo, i+1, imoveis.length, multi));
    } else {
      folhas.push(..._htmlFolhasDetalhadas(d, cab, protocolo, i+1, imoveis.length, multi));
    }
  }

  return `
  <div id="rel-print-root">
    <link rel="stylesheet" href="../css/relatorio-print.css">
    ${folhas.join('\n')}
  </div>`;
}

// ── Capa consolidada (múltiplos imóveis) ──────────────────────────────────

function _htmlFolhaCapa(imoveis, cab, protocolo, modo, mapaId) {
  const data = _relData();
  return `
  <div class="rel-a4">
    ${_htmlCabecalho(cab, protocolo, data)}
    <div class="rel-body">
      <div class="rel-titulo-bloco">
        <div class="rel-tipo-label">Laudo Técnico Consolidado — Imóveis CAR</div>
        <div class="rel-nome-imovel">${imoveis.length} Imóveis — ${_relEsc(imoveis[0]?.nom_munici||'Acre')}</div>
        <div class="rel-cod-imovel">Modo: ${modo==='sintetico'?'Sintético':'Detalhado'} · Gerado em ${data}</div>
      </div>
      <div class="rel-secao">
        <div class="rel-secao-titulo">Imóveis incluídos neste relatório</div>
        <table class="rel-table">
          <tr><th>#</th><th>Nome</th><th>Código CAR</th><th>Município</th><th>Área (ha)</th><th>SICAR</th></tr>
          ${imoveis.map((d,i)=>`<tr>
            <td>${i+1}</td>
            <td>${_relEsc(d.nom_imovel)}</td>
            <td style="font-family:monospace;font-size:8px">${_relEsc(d.cod_imovel)}</td>
            <td>${_relEsc(d.nom_munici)}</td>
            <td>${_relF2(d.area_ha)}</td>
            <td>${_badgeClassCAR?.(d.nome_class)||d.nome_class}</td>
          </tr>`).join('')}
        </table>
      </div>
      ${_htmlMapaABNT({ id: mapaId, titulo:'Mapa de Localização Geral — Todos os Imóveis', altura:320,
        escala:'1:500.000', ref:'SIRGAS 2000', fonte:'SICAR/SFB · IBGE · OpenStreetMap',
        camadas:['▬ Limite dos imóveis (colorido por SICAR)','■ Área de estudo'] })}
    </div>
    <div class="rel-pag-rodape">
      <span>${_relEsc(cab.secretaria)} · ${_relEsc(cab.siglaDiret)} · ${_relEsc(cab.siglaDep)}</span>
      <span>Pág. 1 · Prot. ${_relEsc(protocolo)}</span>
    </div>
  </div>`;
}

// ── Cabeçalho ABNT reutilizável ───────────────────────────────────────────

function _htmlCabecalho(cab, protocolo, data, mini=false) {
  if (mini) return `
  <div class="rel-cabecalho-mini">
    <span class="sec">${_relEsc(cab.siglaSecr)} · ${_relEsc(cab.siglaDiret)} · Laudo Técnico · Prot. ${_relEsc(protocolo)} · Pág.</span>
  </div>`;

  const logoGov  = cab.logoGoverno  ? `<img src="${cab.logoGoverno}"  alt="Logo Governo">` : '🌿';
  const logoSecr = cab.logoSecr     ? `<img src="${cab.logoSecr}"     alt="Logo Secretaria">` : '🏛';
  return `
  <div class="rel-cabecalho">
    <div class="rel-logos">
      <div class="rel-logo">${logoGov}</div>
      <div class="rel-cab-div"></div>
      <div class="rel-logo">${logoSecr}</div>
    </div>
    <div class="rel-cab-div" style="margin:0 6px"></div>
    <div class="rel-inst">
      <div class="gov">${_relEsc(cab.governo)}${cab.gestao?' · '+cab.gestao:''}</div>
      <div class="sec">${_relEsc(cab.secretaria)} — ${_relEsc(cab.siglaSecr)}</div>
      <div class="dir">${_relEsc(cab.diretoria)} · ${_relEsc(cab.departamento)}</div>
    </div>
    <div class="rel-meta">SIGUC-AC<br>Emitido: ${data}<br>Prot. nº ${_relEsc(protocolo)}</div>
  </div>`;
}

// ── Badges auxiliares ─────────────────────────────────────────────────────

function _relBadgeSICAR(classe) {
  const map = {
    'Verde':          'background:#dcfce7;color:#166534;border-color:#86efac',
    'Amarelo':        'background:#fef9c3;color:#854d0e;border-color:#fde047',
    'Vermelho':       'background:#fee2e2;color:#991b1b;border-color:#fca5a5',
    'Não Classificado':'background:#f3f4f6;color:#6b7280;border-color:#e5e7eb',
  };
  const s = map[classe] || map['Não Classificado'];
  const emoji = classe==='Verde'?'🟢':classe==='Amarelo'?'🟡':classe==='Vermelho'?'🔴':'⚪';
  return `<span class="rel-badge" style="${s}">${emoji} ${_relEsc(classe)} — SICAR</span>`;
}

// ── Folha SINTÉTICA ───────────────────────────────────────────────────────

function _htmlFolhaSintetica(d, cab, protocolo, idx, total, multi) {
  const data = _relData();
  const mapLocId  = `rel-mapa-loc-${d.cod_imovel.replace(/\W/g,'_')}`;
  const mapDetId  = `rel-mapa-det-${d.cod_imovel.replace(/\W/g,'_')}`;
  const pctDesMat = _relPct(d.totalGeral_ha, d.area_ha);
  const pctIl     = _relPct(d.haAVerificar, d.area_ha);

  // Recomendação automática
  const rec = _gerarRecomendacao(d);

  return `
  <div class="rel-a4">
    ${multi ? _htmlCabecalho(cab, protocolo, data, true) : _htmlCabecalho(cab, protocolo, data)}
    <div class="rel-body">
      ${!multi?`
      <div class="rel-titulo-bloco">
        <div class="rel-tipo-label">Laudo Técnico de Análise Ambiental — CAR</div>
        <div class="rel-nome-imovel">${_relEsc(d.nom_imovel)}</div>
        <div class="rel-cod-imovel">${_relEsc(d.cod_imovel)} · ${_relEsc(d.nom_munici)}/AC · Bioma Amazônia</div>
        <div class="rel-badges">
          ${_relBadgeSICAR(d.nome_class)}
          ${d.pequenaPropriedade?`<span class="rel-badge" style="background:#f5f3ff;color:#6d28d9;border-color:#c4b5fd">⚖️ ${_relF1(d.num_modulo)} módulos fiscais</span>`:''}
        </div>
      </div>`:'<div style="font-weight:700;font-size:13px;padding:8px 0">'+(idx)+'. '+_relEsc(d.nom_imovel)+'</div>'}

      <!-- KPIs -->
      <div class="rel-kpi-grid">
        <div class="rel-kpi kpi-lrnj"><div class="kl">Área declarada</div><div class="kv">${_relF2(d.area_ha)}<span style="font-size:9px"> ha</span></div><div class="ks">Fonte: SICAR</div></div>
        <div class="rel-kpi ${d.totalGeral_ha>0?'kpi-verm':'kpi-verde'}"><div class="kl">Desmatamento total</div><div class="kv">${_relF2(d.totalGeral_ha)}<span style="font-size:9px"> ha</span></div><div class="ks">PRODES/INPE · ${pctDesMat}%</div></div>
        <div class="rel-kpi ${d.deficitRL>0?'kpi-verm':'kpi-verde'}"><div class="kl">Déficit Reserva Legal</div><div class="kv">${_relF2(d.deficitRL)}<span style="font-size:9px"> ha</span></div><div class="ks">Exig. 80% = ${_relF2(d.exigenciaRL)} ha</div></div>
        <div class="rel-kpi ${d.focosTotal>0?'kpi-lrnj':'kpi-verde'}"><div class="kl">Focos de calor</div><div class="kv">${d.focosTotal}</div><div class="ks">${d.focosMin&&d.focosMax?d.focosMin+'–'+d.focosMax:'—'}</div></div>
      </div>
      <!-- Conformidade -->
      <div class="rel-conf-grid">
        <div class="rel-conf conf-cons"><div class="cl">🟡 Consolidado pré-2008</div><div class="cv">${_relF2(d.haConsolidado)} ha</div><div class="cs">Art. 61-A CF · ${_relPct(d.haConsolidado,d.totalGeral_ha)}%</div></div>
        <div class="rel-conf conf-aut" ><div class="cl">✅ Autorizado (ASV)</div><div class="cv">${_relF2(d.haAutorizado)} ha</div><div class="cs">Arts. 26-27 CF · ${_relPct(d.haAutorizado,d.totalGeral_ha)}%</div></div>
        <div class="rel-conf conf-il"  ><div class="cl">🔴 A verificar / Ilegal</div><div class="cv">${_relF2(d.haAVerificar)} ha</div><div class="cs">Art. 38 CF · ${_relPct(d.haAVerificar,d.totalGeral_ha)}%</div></div>
      </div>

      <!-- Mapas lado a lado -->
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        ${_htmlMapaABNT({ id: mapLocId, titulo:'Mapa 1 — Localização Regional', altura:200,
          escala:'1:1.500.000', fonte:'IBGE · OpenStreetMap · SICAR/SFB',
          camadas:['▬ Imóvel CAR (vermelho)','■ Município destacado'] })}
        ${_htmlMapaABNT({ id: mapDetId, titulo:'Mapa 2 — Detalhe do Imóvel', altura:200,
          escala:'calculada', fonte:'PRODES/INPE · FIRMS/NASA · SICAR/SFB',
          camadas:['▬ Limite CAR','■ PRODES (colorido CF)','● Focos calor'] })}
      </div>

      <!-- Recomendação -->
      <div class="rel-secao">
        <div class="rel-secao-titulo">Recomendação</div>
        <div class="rel-narrativa" style="font-size:10px">${rec}</div>
        <div class="rel-refs"><strong>Base legal:</strong> Arts. 12/I · 26 · 38 · 61-A · 66 · 67 · 78-A — Lei nº 12.651/2012</div>
      </div>
    </div>
    <div class="rel-pag-rodape">
      <span>${_relEsc(cab.secretaria)} · ${_relEsc(cab.siglaDiret)} · ${_relEsc(cab.siglaDep)}</span>
      <span>Pág. ${multi?idx+1:1}${total>1?' · Imóvel '+idx+'/'+total:''} · Prot. ${_relEsc(protocolo)}</span>
    </div>
  </div>`;
}

// ── Folhas DETALHADAS (retorna array de strings) ───────────────────────────

function _htmlFolhasDetalhadas(d, cab, protocolo, idx, total, multi) {
  const data    = _relData();
  const mapLocId = `rel-mapa-loc-${d.cod_imovel.replace(/\W/g,'_')}`;
  const mapDetId = `rel-mapa-det-${d.cod_imovel.replace(/\W/g,'_')}`;
  const pag = (n) => `Pág. ${multi?idx+n:n}${total>1?' · Imóvel '+idx+'/'+total:''} · Prot. ${_relEsc(protocolo)}`;

  // ── FOLHA 1: Capa, identificação, mapa de localização ──────────────────
  const f1 = `
  <div class="rel-a4">
    ${_htmlCabecalho(cab, protocolo, data)}
    <div class="rel-body">
      <div class="rel-titulo-bloco">
        <div class="rel-tipo-label">Laudo Técnico de Análise Ambiental — CAR</div>
        <div class="rel-nome-imovel">${_relEsc(d.nom_imovel)}</div>
        <div class="rel-cod-imovel">${_relEsc(d.cod_imovel)} · ${_relEsc(d.nom_munici)}/AC · Bioma Amazônia</div>
        <div class="rel-badges">
          ${_relBadgeSICAR(d.nome_class)}
          ${d.emUC?`<span class="rel-badge" style="background:#fef9c3;color:#854d0e;border-color:#fde047">⚠️ Sobreposição com UC</span>`:''}
          ${d.pequenaPropriedade?`<span class="rel-badge" style="background:#f5f3ff;color:#6d28d9;border-color:#c4b5fd">⚖️ ${_relF1(d.num_modulo)} módulos fiscais</span>`:''}
          ${!d.prodesCarregado?`<span class="rel-badge" style="background:#fef2f2;color:#991b1b;border-color:#fca5a5">⚠️ Dados PRODES não carregados</span>`:''}
        </div>
      </div>

      <div class="rel-kpi-grid">
        <div class="rel-kpi kpi-lrnj"><div class="kl">Área declarada</div><div class="kv">${_relF2(d.area_ha)}<span style="font-size:9px"> ha</span></div><div class="ks">SICAR</div></div>
        <div class="rel-kpi ${d.totalGeral_ha>0?'kpi-verm':'kpi-verde'}"><div class="kl">Desmatamento total</div><div class="kv">${_relF2(d.totalGeral_ha)}<span style="font-size:9px"> ha</span></div><div class="ks">PRODES/INPE · ${_relPct(d.totalGeral_ha,d.area_ha)}%</div></div>
        <div class="rel-kpi ${d.deficitRL>0?'kpi-verm':'kpi-verde'}"><div class="kl">Déficit Reserva Legal</div><div class="kv">${_relF2(d.deficitRL)}<span style="font-size:9px"> ha</span></div><div class="ks">Exig. 80% = ${_relF2(d.exigenciaRL)} ha</div></div>
        <div class="rel-kpi ${d.focosTotal>0?'kpi-lrnj':'kpi-verde'}"><div class="kl">Focos de calor</div><div class="kv">${d.focosTotal}</div><div class="ks">${d.focosMin&&d.focosMax?d.focosMin+'–'+d.focosMax:'—'}</div></div>
      </div>
      <div class="rel-conf-grid">
        <div class="rel-conf conf-cons"><div class="cl">🟡 Consolidado pré-2008</div><div class="cv">${_relF2(d.haConsolidado)} ha</div><div class="cs">Art. 61-A CF</div></div>
        <div class="rel-conf conf-aut"><div class="cl">✅ Autorizado (ASV)</div><div class="cv">${_relF2(d.haAutorizado)} ha</div><div class="cs">Arts. 26-27 CF</div></div>
        <div class="rel-conf conf-il"><div class="cl">🔴 A verificar / Ilegal</div><div class="cv">${_relF2(d.haAVerificar)} ha</div><div class="cs">Art. 38 CF</div></div>
      </div>

      <div class="rel-secao">
        <div class="rel-secao-titulo">1. Identificação do Imóvel</div>
        <table class="rel-table">
          <tr><td>Código CAR</td><td style="font-family:monospace;font-size:9px">${_relEsc(d.cod_imovel)}</td></tr>
          <tr><td>Nome do Imóvel</td><td>${_relEsc(d.nom_imovel)}</td></tr>
          ${d.nome_compl?`<tr><td>Proprietário</td><td>${_relEsc(d.nome_compl)}</td></tr>`:''}
          <tr><td>CPF/CNPJ</td><td>${_relEsc(d.cpf_cnpj)}</td></tr>
          <tr><td>Município</td><td>${_relEsc(d.nom_munici)} — Acre</td></tr>
          <tr><td>Área declarada</td><td>${_relF2(d.area_ha)} ha</td></tr>
          <tr><td>Módulos fiscais</td><td>${d.num_modulo>0?_relF1(d.num_modulo)+' módulos'+(d.pequenaPropriedade?' (pequena propriedade — Art. 67 CF)':''):'—'}</td></tr>
          <tr><td>Situação CAR</td><td>${_relEsc(d.ind_status)}</td></tr>
          <tr><td>Classificação SICAR</td><td>${d.nome_class==='Vermelho'?'<strong style="color:#dc2626">🔴 Vermelho — Art. 78-A CF aplicável</strong>':_relEsc(d.nome_class)}</td></tr>
          ${d.dat_criaca&&d.dat_criaca!=='—'?`<tr><td>Data de cadastro</td><td>${_relEsc(d.dat_criaca)}</td></tr>`:''}
          ${d.emUC?`<tr><td>Sobreposição com UC</td><td><strong style="color:#d97706">⚠️ ${_relEsc(d.ucNome||'UC do Acre')} — ${_relF2(d.areaUC)} ha sobrepostos</strong></td></tr>`:''}
        </table>
      </div>

      <div class="rel-secao">
        <div class="rel-secao-subtitulo">Mapa 1 — Localização Regional</div>
        ${_htmlMapaABNT({ id: mapLocId, titulo:'Mapa de Localização — Estado do Acre · '+d.nom_munici, altura:230,
          escala:'1:1.500.000', fonte:'IBGE · OpenStreetMap · SICAR/SFB · Elaborado: SIGUC-AC/SEMA-AC',
          camadas:['▬ Imóvel CAR (vermelho)','■ Município de '+d.nom_munici,'▬ Limite do Acre'] })}
      </div>
    </div>
    <div class="rel-pag-rodape">
      <span>${_relEsc(cab.secretaria)} · ${_relEsc(cab.siglaDiret)} · ${_relEsc(cab.siglaDep)}</span>
      <span>${pag(1)}</span>
    </div>
  </div>`;

  // ── FOLHA 2: Mapa detalhe + PRODES + Focos + ASV ─────────────────────
  const maxProdes = Math.max(...Object.values(d.porAno), 0.01);
  const barrasProdes = d.anosAnual.map(ano => {
    const ha  = d.porAno[ano] || 0;
    const pct = Math.round(ha/maxProdes*100);
    const clf = d.geojsonFeatAnual.find(f=>f.properties?.ano===ano)?.properties?.clf;
    const cor = clf?.cor || '#dc2626';
    const ico = clf?.tipo==='autorizado'?'✅':clf?.tipo==='irregular'?'🟠':'🔴';
    return `<div class="rel-barra-row">
      <span class="rel-barra-ano">${ano}</span>
      <div class="rel-barra-bg"><div class="rel-barra-fill" style="width:${pct}%;background:${cor}"></div></div>
      <span class="rel-barra-val">${_relF2(ha)} ha</span>
      <span class="rel-barra-clf">${ico}</span>
    </div>`;
  }).join('');

  const maxFocos = Math.max(...d.focosPorAno.map(r=>r.total), 1);
  const barrasFocos = d.focosPorAno.map(r => {
    const pct = Math.round(r.total/maxFocos*100);
    const corr = d.focosCorrelAnos.includes(r.ano);
    return `<div class="rel-barra-row">
      <span class="rel-barra-ano">${r.ano}</span>
      <div class="rel-barra-bg"><div class="rel-barra-fill" style="width:${pct}%;background:#f97316"></div></div>
      <span class="rel-barra-val">${r.total}</span>
      <span class="rel-barra-clf">${corr?'⚠️':''}</span>
    </div>`;
  }).join('');

  const f2 = `
  <div class="rel-a4">
    ${_htmlCabecalho(cab, protocolo, data, true)}
    <div class="rel-body">
      <div class="rel-secao">
        <div class="rel-secao-subtitulo">Mapa 2 — Detalhe do Imóvel com Camadas Temáticas</div>
        ${_htmlMapaABNT({ id: mapDetId, titulo:'Mapa Temático — PRODES · Focos de Calor · Imóvel CAR', altura:280,
          escala:'calculada', fonte:'PRODES/INPE · FIRMS/NASA · BDQueimadas · SICAR/SFB · Elaborado: SIGUC-AC',
          camadas:['▬ Limite CAR','■ PRODES Anual (✅ autorizado · 🟠 irreg. · 🔴 ilegal)','■ Acumulado Pré-2008','● Focos de Calor (laranja)'] })}
      </div>

      <div class="rel-secao">
        <div class="rel-secao-titulo">3. Análise de Desmatamento — PRODES/INPE</div>
        ${d.prodesCarregado ? `
        <div style="font-size:8px;color:#9ca3af;margin-bottom:6px">✅ autorizado · 🟠 irregular · 🔴 ilegal/a verificar · ⚠️ foco de calor no mesmo ano</div>
        <div class="rel-barras">${barrasProdes||'<div style="font-size:9px;color:#9ca3af">Nenhum polígono PRODES detectado.</div>'}</div>
        <table class="rel-table rel-table-sm" style="margin-top:8px">
          <tr><th>Categoria</th><th>Área (ha)</th><th>% da área</th><th>Base legal</th></tr>
          <tr><td>Acumulado pré-2008</td><td>${_relF2(d.haConsolidado)}</td><td>${_relPct(d.haConsolidado,d.area_ha)}%</td><td>Art. 61-A CF</td></tr>
          <tr><td>Autorizado (ASV)</td><td>${_relF2(d.haAutorizado)}</td><td>${_relPct(d.haAutorizado,d.area_ha)}%</td><td>Arts. 26-27 CF</td></tr>
          <tr><td>A verificar / Ilegal</td><td>${_relF2(d.haAVerificar)}</td><td>${_relPct(d.haAVerificar,d.area_ha)}%</td><td>Art. 38 CF</td></tr>
          <tr><td><strong>Total</strong></td><td><strong>${_relF2(d.totalGeral_ha)}</strong></td><td><strong>${_relPct(d.totalGeral_ha,d.area_ha)}%</strong></td><td>—</td></tr>
        </table>`:`<div style="font-size:10px;color:#9ca3af;padding:8px 0">⚠️ Dados PRODES não carregados — acesse a aba 🌳 PRODES antes de gerar o relatório.</div>`}
      </div>

      <div class="rel-secao">
        <div class="rel-secao-titulo">4. Focos de Calor — BDQueimadas/INPE · FIRMS/NASA</div>
        ${d.focosPorAno.length ? `
        <div style="font-size:8px;color:#9ca3af;margin-bottom:5px">⚠️ = correlação temporal com desmatamento PRODES no mesmo ano</div>
        <div class="rel-barras">${barrasFocos}</div>`
        :`<div style="font-size:10px;color:#9ca3af;padding:8px 0">Nenhum foco de calor registrado na base atual para este imóvel.</div>`}
      </div>

      <div class="rel-secao">
        <div class="rel-secao-titulo">5. Autorizações de Supressão — SINAFLOR/IBAMA</div>
        ${d.asvList.length ? `
        <table class="rel-table rel-table-sm">
          <tr><th>Nº ASV</th><th>Emissão</th><th>Validade</th><th>Área (ha)</th><th>Tipo</th><th>Status</th></tr>
          ${d.asvList.map(a=>`<tr>
            <td style="font-family:monospace">${_relEsc(a.num_asv||'—')}</td>
            <td>${a.data_emissao?new Date(a.data_emissao).toLocaleDateString('pt-BR'):'—'}</td>
            <td>${a.data_validade?new Date(a.data_validade).toLocaleDateString('pt-BR'):'—'}</td>
            <td>${_relF2(a.area_ha)}</td>
            <td>${_relEsc(a.tipo_supressao||'—')}</td>
            <td><span class="asv-badge asv-${a.status||'vigente'}">${_relEsc(a.status||'vigente')}</span></td>
          </tr>`).join('')}
        </table>`
        :`<div style="font-size:10px;color:#9ca3af;padding:8px 0">${d.asvBase?'Nenhuma ASV localizada para este imóvel.':'⚠️ Base SINAFLOR não carregada — verificar IBAMA/SEMA-AC.'}</div>`}
        <div style="font-size:7px;color:#9ca3af;margin-top:4px">Fonte: IBAMA Dados Abertos · Atualizado: ${_relData()}</div>
      </div>
    </div>
    <div class="rel-pag-rodape">
      <span>${_relEsc(cab.secretaria)} · ${_relEsc(cab.siglaDiret)} · ${_relEsc(cab.siglaDep)}</span>
      <span>${pag(2)}</span>
    </div>
  </div>`;

  // ── FOLHA 3: Reserva Legal + Narrativa + Conclusão ─────────────────────
  const narrativa = _gerarNarrativaJuridica(d);
  const rec       = _gerarRecomendacao(d);
  const pctRL     = Math.min(100, d.florestaReman > 0 ? Math.round(d.florestaReman/d.exigenciaRL*100) : 0);

  const f3 = `
  <div class="rel-a4">
    ${_htmlCabecalho(cab, protocolo, data, true)}
    <div class="rel-body">
      <div class="rel-secao">
        <div class="rel-secao-titulo">6. Reserva Legal — Art. 12, I · Lei 12.651/2012</div>
        <div style="font-size:9px;color:#6b7280;margin-bottom:8px">Amazônia: exigência de 80% da área total cadastrada${d.pequenaPropriedade?' · Pequena propriedade (Art. 67 CF — regras diferenciadas)':''}</div>
        <table class="rel-table" style="margin-bottom:10px">
          <tr><td>Área total declarada</td><td><strong>${_relF2(d.area_ha)} ha</strong></td></tr>
          <tr><td>Exigência de Reserva Legal (80%)</td><td><strong>${_relF2(d.exigenciaRL)} ha</strong></td></tr>
          <tr><td>Desmatamento total detectado</td><td><strong style="color:#dc2626">${_relF2(d.totalGeral_ha)} ha</strong></td></tr>
          <tr><td>Floresta remanescente (estimada)</td><td><strong style="color:#16a34a">${_relF2(d.florestaReman)} ha</strong></td></tr>
          <tr><td>Déficit de Reserva Legal</td><td><strong style="${d.deficitRL>0?'color:#dc2626':'color:#16a34a'}">${_relF2(d.deficitRL)} ha${d.deficitRL<=0?' (sem déficit)':''}</strong></td></tr>
        </table>
        <div style="font-size:8px;color:#6b7280;margin-bottom:3px">Cobertura remanescente estimada vs. exigência legal (${pctRL}%):</div>
        <div class="rel-rl-barra">
          <div class="rel-rl-fill" style="width:${pctRL}%"></div>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:7px;color:#9ca3af">
          <span>Remanescente: ${_relF2(d.florestaReman)} ha</span>
          ${d.deficitRL>0?`<span style="color:#dc2626">Déficit: ${_relF2(d.deficitRL)} ha</span>`:'<span style="color:#16a34a">✅ Sem déficit</span>'}
        </div>
      </div>

      <div class="rel-secao">
        <div class="rel-secao-titulo">7. Análise de Conformidade — Lei 12.651/2012</div>
        <div class="rel-narrativa">${narrativa}</div>
        <div class="rel-refs">
          <strong>Referências legais:</strong> Art. 3/II (APP) · Art. 3/III (Reserva Legal) · Art. 12/I (RL 80% Amazônia) · Art. 26 (vedação supressão sem autorização) · Art. 38 (crime de desmatamento ilegal) · Art. 61-A (áreas consolidadas — corte 22/07/2008) · Art. 66 (obrigação de recomposição de RL) · Art. 67 (pequenas propriedades — ≤4 módulos fiscais) · Art. 78-A (restrição de crédito para imóveis irregulares) — Lei nº 12.651, de 25 de maio de 2012
        </div>
      </div>

      <div class="rel-secao">
        <div class="rel-secao-titulo">8. Conclusão e Recomendação</div>
        <table class="rel-table rel-table-sm">
          <tr><th colspan="2" style="background:${d.haAVerificar>0?'#991b1b':d.deficitRL>0?'#92400e':'#166534'}">
            ${d.haAVerificar>0?'Situação de Não Conformidade — Ação Recomendada':d.deficitRL>0?'Regularização Pendente':'Situação Regular'}
          </th></tr>
          <tr><td>Prioridade</td><td>${d.haAVerificar>0&&d.focosCorrelAnos.length?'🔴 Alta':'🟡 Média'}</td></tr>
          <tr><td>Recomendação</td><td>${rec}</td></tr>
          ${d.nome_class==='Vermelho'?`<tr><td>Crédito rural</td><td>Art. 78-A CF: restrição aplicável até regularização</td></tr>`:''}
        </table>
      </div>

      <div class="rel-aviso">
        Documento gerado automaticamente pelo SIGUC-AC em ${data} por ${_relEsc(appState.usuario?.nome_completo||appState.usuario?.email||'Usuário')} (${_relEsc(appState.perfil||'—')}).<br>
        ${_relEsc(cab.rodapeTxt||'')} As análises são baseadas em dados de sensoriamento remoto com margem de erro de 5–15%.<br>
        ${_relEsc(cab.secretaria)} · ${_relEsc(cab.siglaDiret)} · ${_relEsc(cab.siglaDep)} · ${_relEsc(cab.telefone)} · ${_relEsc(cab.email)} · ${_relEsc(cab.site)}
      </div>
    </div>
    <div class="rel-pag-rodape">
      <span>${_relEsc(cab.secretaria)} · ${_relEsc(cab.siglaDiret)} · ${_relEsc(cab.siglaDep)}</span>
      <span>${pag(3)}</span>
    </div>
  </div>`;

  return [f1, f2, f3];
}

// ── Narrativa jurídica automática ─────────────────────────────────────────

function _gerarNarrativaJuridica(d) {
  const nome = `<strong>${_relEsc(d.nom_imovel)}</strong>`;
  const total = `<strong>${_relF2(d.totalGeral_ha)} ha</strong>`;
  const cons  = `<strong>${_relF2(d.haConsolidado)} ha</strong>`;
  const pos   = `<strong>${_relF2(d.totalGeral_ha - d.haConsolidado)} ha</strong>`;
  const aut   = `<strong>${_relF2(d.haAutorizado)} ha</strong>`;
  const il    = `<strong>${_relF2(d.haAVerificar)} ha</strong>`;
  const nFoc  = d.focosTotal;
  const nCorr = d.focosCorrelAnos.length;

  let sinaf = d.asvBase
    ? `Dos ${pos} suprimidos após 2008, ${aut} possuem ASV vigente no SINAFLOR (Arts. 26-27, Lei 12.651/2012)${d.haAVerificar>0?` e ${il} não possuem autorização localizada`:'.'}`
    : `Dos ${pos} suprimidos após 2008, nenhuma autorização de supressão (ASV) foi localizada na base local — situação a verificar junto ao IBAMA/SEMA-AC (Arts. 26-27, Lei 12.651/2012).`;

  let focoTxt = nFoc > 0
    ? `Foram detectados <strong>${nFoc}</strong> focos de calor dentro do imóvel${d.focosMin?` entre ${d.focosMin} e ${d.focosMax}`:''}${nCorr>0?`, com <strong>correlação temporal em ${nCorr} ano(s)</strong> com polígonos de desmatamento PRODES — indício de incêndio associado a supressão ilegal`:'.'}`
    : 'Não foram detectados focos de calor históricos dentro do imóvel na base atual.';

  let rlTxt = d.deficitRL > 0
    ? `O imóvel apresenta <strong>déficit estimado de Reserva Legal de ${_relF2(d.deficitRL)} ha</strong> (exigência: 80% = ${_relF2(d.exigenciaRL)} ha — Art. 12, I, CF${d.pequenaPropriedade?'; pequena propriedade — Art. 67 CF':''}).`
    : `A cobertura remanescente estimada atende à exigência de Reserva Legal de 80% (Art. 12, I, CF${d.pequenaPropriedade?'; pequena propriedade — Art. 67 CF':''}).`;

  let sicarTxt = d.nome_class === 'Vermelho'
    ? `O imóvel está classificado como <strong>Vermelho</strong> no SICAR — <strong>Art. 78-A CF: restrição de crédito rural aplicável</strong>.`
    : `O imóvel está classificado como <strong>${_relEsc(d.nome_class)}</strong> no SICAR.`;

  return `${nome} (${_relEsc(d.cod_imovel)}) possui ${total} de desmatamento detectado pelo PRODES/INPE. Desses, ${cons} foram suprimidos antes de 22/07/2008 (área consolidada — Art. 61-A, Lei 12.651/2012). ${sinaf}<br><br>${focoTxt}<br><br>${sicarTxt} ${rlTxt}`;
}

function _gerarRecomendacao(d) {
  if (!d.prodesCarregado) return 'Carregar dados PRODES antes de gerar o relatório para análise completa.';
  if (d.totalGeral_ha === 0) return 'Imóvel sem registro de desmatamento no PRODES — manter monitoramento periódico.';
  if (d.haAVerificar > 0 && d.focosCorrelAnos.length > 0)
    return `Instaurar procedimento administrativo — desmatamento ilegal correlacionado com focos de calor (Arts. 38 e 50 CF). Verificar necessidade de embargo e PRA (Arts. 59-68 CF)${d.nome_class==='Vermelho'?' · Restrição de crédito rural (Art. 78-A CF)':''}.`;
  if (d.haAVerificar > 0)
    return `Verificar ASVs vigentes no SINAFLOR${d.asvBase?'':' (base local vazia)'}. Desmatamento pós-2008 sem autorização configura infração (Art. 38 CF). Avaliar PRA (Arts. 59-68 CF).`;
  if (d.deficitRL > 0 && !d.pequenaPropriedade)
    return `Déficit de Reserva Legal de ${_relF2(d.deficitRL)} ha — recomposição obrigatória (Art. 66 CF).`;
  if (d.nome_class === 'Vermelho')
    return 'Imóvel Vermelho no SICAR — regularização obrigatória para acesso ao crédito rural (Art. 78-A CF). Orientar adesão ao PRA.';
  return 'Regularização em andamento. Monitorar prazo de adesão ao PRA e recomposição de Reserva Legal.';
}

// ── Inicializar mapas Leaflet dentro do relatório ─────────────────────────

async function _inicializarMapasRelatorio(imoveis, multi) {
  const TILE = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
  const OSM_ATTR = '© OpenStreetMap';

  // Helper: aguarda tiles carregarem
  const aguardarMapa = (m) => new Promise(resolve => {
    let done = false;
    const ok = () => { if (!done) { done = true; resolve(); } };
    m.once('load', ok);
    setTimeout(ok, 4000); // fallback 4s
  });

  const mapPromises = [];

  // Mapa consolidado
  if (multi) {
    const elC = document.getElementById('rel-mapa-consolidado');
    if (elC) {
      const bboxAll = imoveis.reduce((acc,d)=>{
        return [Math.min(acc[0],d.bbox[0]),Math.min(acc[1],d.bbox[1]),Math.max(acc[2],d.bbox[2]),Math.max(acc[3],d.bbox[3])];
      }, [Infinity,Infinity,-Infinity,-Infinity]);
      const mc = L.map(elC,{zoomControl:false,attributionControl:false});
      L.tileLayer(TILE,{attribution:OSM_ATTR}).addTo(mc);
      imoveis.forEach((d,i) => {
        try {
          const cor = ['#dc2626','#2563eb','#16a34a','#d97706','#7c3aed','#0891b2'][i%6];
          L.geoJSON({type:'Feature',geometry:d.geometry},{style:{color:cor,weight:2,fillOpacity:.2}}).addTo(mc);
        } catch(_) {}
      });
      mc.fitBounds([[bboxAll[1],bboxAll[0]],[bboxAll[3],bboxAll[2]]],{padding:[20,20]});
      L.control.scale({imperial:false,metric:true,position:'bottomleft'}).addTo(mc);
      mapPromises.push(aguardarMapa(mc));
    }
  }

  for (const d of imoveis) {
    const codKey = d.cod_imovel.replace(/\W/g,'_');

    // Mapa de localização
    const elLoc = document.getElementById(`rel-mapa-loc-${codKey}`);
    if (elLoc) {
      const mLoc = L.map(elLoc,{zoomControl:false,attributionControl:false}).setView([-9.5,-70.5],6);
      L.tileLayer(TILE,{attribution:OSM_ATTR}).addTo(mLoc);
      try { L.geoJSON({type:'Feature',geometry:d.geometry},{style:{color:'#dc2626',weight:2,fillColor:'#dc2626',fillOpacity:.25}}).addTo(mLoc); } catch(_){}
      L.control.scale({imperial:false,metric:true,position:'bottomleft'}).addTo(mLoc);
      // Atualizar escala no rodapé
      mLoc.once('zoomend moveend', () => {
        const el = elLoc.closest('.rel-mapa-wrap')?.querySelector('.rel-mapa-info');
        if (el) { const c=mLoc.getCenter(); el.innerHTML=`<strong>Escala</strong>${_calcularEscalaLeaflet(mLoc.getZoom(),c.lat)}`; }
      });
      mapPromises.push(aguardarMapa(mLoc));
    }

    // Mapa de detalhe
    const elDet = document.getElementById(`rel-mapa-det-${codKey}`);
    if (elDet && d.bbox) {
      const mDet = L.map(elDet,{zoomControl:true,attributionControl:false});
      L.tileLayer(TILE,{attribution:OSM_ATTR}).addTo(mDet);
      // Limite CAR
      try { L.geoJSON({type:'Feature',geometry:d.geometry},{style:{color:'#1F4E2C',weight:2.5,fillOpacity:.05,dashArray:'6 3'}}).addTo(mDet); } catch(_){}
      // PRODES anual (colorido por CF)
      if (d.geojsonFeatAnual.length) {
        L.geoJSON({type:'FeatureCollection',features:d.geojsonFeatAnual},{
          style(f){ const cor=f.properties?.clf?.cor||'#dc2626'; return {fillColor:cor,fillOpacity:.5,color:cor,weight:1}; },
          onEachFeature(f,l){ const p=f.properties||{}; l.bindTooltip(`PRODES ${p.ano||'—'} · ${_relF2(p.ha_calc||0)} ha`); }
        }).addTo(mDet);
      }
      // PRODES pré-2008
      if (d.geojsonFeatHist.length) {
        L.geoJSON({type:'FeatureCollection',features:d.geojsonFeatHist},{
          style:{fillColor:'#c2410c',fillOpacity:.4,color:'#c2410c',weight:1}
        }).addTo(mDet);
      }
      mDet.fitBounds([[d.bbox[1],d.bbox[0]],[d.bbox[3],d.bbox[2]]],{padding:[20,20]});
      L.control.scale({imperial:false,metric:true,position:'bottomleft'}).addTo(mDet);
      // Escala dinâmica
      mDet.once('zoomend moveend', () => {
        const el = elDet.closest('.rel-mapa-wrap')?.querySelectorAll('.rel-mapa-info')[0];
        if (el) { const c=mDet.getCenter(); el.innerHTML=`<strong>Escala</strong>${_calcularEscalaLeaflet(mDet.getZoom(),c.lat)}`; }
      });
      mapPromises.push(aguardarMapa(mDet));
    }
  }

  await Promise.allSettled(mapPromises);
}

// ── Preview overlay ───────────────────────────────────────────────────────

async function _abrirPreviewRelatorio() {
  _fecharModalRelatorio();
  const imovelFeats = _relColetarImoveis();
  if (!imovelFeats.length) { toast('Nenhum imóvel selecionado.','warning'); return; }

  toast('Gerando relatório…','info');

  const [dadosList, cab, protocolo] = await Promise.all([
    Promise.all(imovelFeats.map(_montarDadosRelatorio)),
    getCabecalhoRelatorio(),
    gerarProtocolo(),
  ]);

  const html = await _gerarHTMLRelatorio(dadosList, _relModo, cab, protocolo);

  // Criar overlay
  const overlay = document.createElement('div');
  overlay.id = 'rel-preview-overlay';
  const nomeImovel = dadosList[0]?.nom_imovel || 'Imóvel';
  overlay.innerHTML = `
  <div id="rel-preview-toolbar">
    <span class="rel-tb-titulo">📑 ${_relEsc(nomeImovel)}${dadosList.length>1?' + '+(dadosList.length-1)+' imóveis':''}</span>
    <span class="rel-tb-modo">${_relModo==='sintetico'?'SINTÉTICO':'DETALHADO'}</span>
    <button class="btn btn-outline" style="font-size:11px" onclick="document.getElementById('rel-preview-overlay').remove()">← Fechar</button>
    <button class="btn btn-outline" style="font-size:11px" onclick="_abrirNovaAba()">↗ Nova aba</button>
    <button class="btn btn-primary" style="font-size:11px" onclick="_executarPrint()">🖨️ Imprimir / Salvar PDF</button>
  </div>
  <div id="rel-preview-area">${html}</div>`;

  document.body.appendChild(overlay);
  await _inicializarMapasRelatorio(dadosList, dadosList.length > 1);
}

async function _imprimirRelatorio() {
  _fecharModalRelatorio();
  await _abrirPreviewRelatorio();
  // Pequeno delay para mapas renderizarem
  setTimeout(_executarPrint, 2500);
}

async function _executarPrint() {
  // Aguarda tiles antes de imprimir
  await new Promise(r => setTimeout(r, 800));
  window.print();
}

async function _abrirNovaAba() {
  const imovelFeats = _relColetarImoveis();
  const [dadosList, cab, protocolo] = await Promise.all([
    Promise.all(imovelFeats.map(_montarDadosRelatorio)),
    getCabecalhoRelatorio(),
    gerarProtocolo(),
  ]);
  const html = await _gerarHTMLRelatorio(dadosList, _relModo, cab, protocolo);
  const win = window.open('', '_blank');
  if (!win) { toast('Popup bloqueado — use o botão Imprimir.','warning'); return; }
  win.document.write(`<!DOCTYPE html><html lang="pt-BR"><head>
    <meta charset="UTF-8">
    <title>Relatório SIGUC-AC</title>
    <link rel="stylesheet" href="${location.origin}/css/relatorio-print.css">
    <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
    <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"><\/script>
    <style>body{background:#374151;padding:20px;font-family:'DM Sans',system-ui,sans-serif}</style>
  </head><body>${html}</body></html>`);
  win.document.close();
}
