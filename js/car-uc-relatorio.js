// ── SIGUC-AC · Relatório "CAR na UC" (Gestão › Relatórios) ────────────
// Quais imóveis do CAR estão registrados numa UC, com número, situação,
// titular (CPF/CNPJ mascarado), área sobreposta, zonas de manejo
// atingidas e, opcionalmente, focos, DETER e PRODES na parte do imóvel
// que está na UC. Sem mapa, de propósito (pedido do usuário).
//
// De onde vem cada coisa (decisão do usuário, 30/09/2026):
//   • geometria do imóvel: AO VIVO do WFS do SICAR, pelo mesmo proxy do
//     Mapa das UCs (/api/car-proxy). O banco não guarda polígono de CAR.
//   • atributos cadastrais: planilha SICAR local (car_dados_locais) via
//     RPC car_relatorio_uc_cadastro — CPF/CNPJ mascarado NO SERVIDOR e
//     uma linha de log LGPD por imóvel (migration 350).
//   • zonas: data/uc_zonas_acre.geojson (formato padrão, 6 UCs) e, para
//     UC que não está nele, as camadas "… - Zoneamento" / "… - Zona de
//     Amortecimento" enviadas no Mapa (camadas_mapa, pelo uc_id).
//   • focos/DETER: RPC car_relatorio_uc_ambiental (só agregados).
//   • PRODES: WFS do TerraBrasilis pelo proxy /api/prodes-proxy, em
//     quadrantes (o proxy corta em 2000 feições por pedido).
//
// Funções puras (carucEnquadrar*, carucAgregar, carucAtencoes,
// carucZonasDaUC…) não tocam rede nem DOM — é o que o teste cobre.
// A página só chama carucGerarRelatorio() e desenha o resultado.

const CARUC_WFS_BASE = 'https://geoserver.car.gov.br/geoserver/sicar/wfs'
const CARUC_WFS_PAGINA = 1000
const CARUC_LOTE_AMBIENTAL = 80      // RPC aceita 150; 80 deixa folga no timeout de 8 s
// O agrupamento de titular (migration 351) numera os grupos DENTRO de
// uma chamada: a lista vai inteira, nunca em lotes (cada lote teria o
// seu "Titular 1"). Limite da RPC: 10.000 (medido 2,6 s).
const CARUC_LIMITE_CADASTRO = 10000
const CARUC_SOBREP_HA_MIN = 0.1      // sobreposição entre CARs abaixo disso é desenho de divisa, não conflito
const CARUC_DIVERGENCIA_AREA = 0.10  // área declarada × polígono
const CARUC_PRODES_MARCO = 2009      // PRODES 2009 = ago/2008–jul/2009: 1º ano inteiro após 22/07/2008
const CARUC_PRODES_MAX_FEAT = 2000   // mesmo PRODES_MAX_FEAT do proxy
const CARUC_PRODES_QUADRO = 0.25     // graus
const CARUC_HA_MIN = 0.01            // abaixo disso é ruído de borda entre polígonos

// data/uc_zonas_acre.geojson usa nome curto em `uc_nome`; o vínculo com
// o cadastro é pelo CÓDIGO da UC, nunca por semelhança de nome — "São
// Francisco" desse arquivo é a APA Igarapé São Francisco (conferido pelo
// retângulo do polígono), não a FLONA São Francisco.
const CARUC_ZONAS_ARQUIVO_UC = {
  'Antimary': 'UC-016',
  'Chandles': 'UC-008',
  'Rio Gregório': 'UC-020',
  'Mogno': 'UC-018',
  'Rio Liberdade': 'UC-019',
  'São Francisco': 'UC-012',
}

// Mesmos grupos de pages/mapa.html (_ZONA_GRUPO_PROTECAO/_USO).
const CARUC_ZONA_PROTECAO = new Set(['ZI', 'ZP', 'ZOC', 'ZUP', 'ZUE', 'ZUC', 'ZOP'])
const CARUC_ZONA_USO = new Set(['ZEX', 'ZPR', 'ZPO', 'ZOT', 'ZUEP'])

const CARUC_TIPO_IMOVEL = {
  IRU: 'Imóvel rural',
  AST: 'Assentamento (reforma agrária)',
  PCT: 'Povos e comunidades tradicionais',
}
const CARUC_STATUS = { AT: 'Ativo', PE: 'Pendente', SU: 'Suspenso', CA: 'Cancelado' }

// ── Utilidades puras ────────────────────────────────────────────────
function carucNorm(s) {
  return String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim()
}

function carucTipoImovel(v) {
  if (!v) return 'Não informado'
  const k = String(v).trim().toUpperCase()
  return CARUC_TIPO_IMOVEL[k] || String(v)
}

function carucStatus(v) {
  if (!v) return null
  const k = String(v).trim().toUpperCase()
  return CARUC_STATUS[k] || String(v)
}

// Faixa de tamanho por módulos fiscais (Lei 8.629/1993, art. 4º).
function carucFaixaModulos(m) {
  const n = Number(m)
  if (m == null || m === '' || !isFinite(n) || n <= 0) return 'Sem informação'
  if (n <= 4) return 'Pequena (até 4 MF)'
  if (n <= 15) return 'Média (4 a 15 MF)'
  return 'Grande (acima de 15 MF)'
}

function carucData(v) {
  if (!v) return null
  const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  const d = new Date(v)
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10)
}

// ── Enquadramento pela CATEGORIA da UC (SNUC, Lei 9.985/2000) ───────
// nivel: 'conflito' (domínio público, sem exceção) · 'verificar'
// (domínio público que admite população tradicional) · 'admitido'
// (terras públicas ou privadas).
function carucEnquadrarCategoria(uc) {
  const s = String(uc?.sigla || '').toUpperCase()
  const grupo = uc?.grupo
  if (['PARNA', 'PARES', 'PE', 'ESEC', 'REBIO'].includes(s) || (grupo === 'protecao_integral' && !['MONA', 'RVS'].includes(s))) {
    return {
      nivel: 'conflito', rotulo: 'Proteção integral — posse e domínio públicos',
      texto: 'Nesta categoria a posse e o domínio são públicos; áreas particulares incluídas nos limites devem ser desapropriadas (SNUC, arts. 9º a 11). Todo CAR sobreposto indica situação fundiária a regularizar ou inscrição indevida.',
    }
  }
  if (s === 'RESEX' || s === 'RDS') {
    return {
      nivel: 'verificar', rotulo: 'Uso sustentável — domínio público com uso concedido',
      texto: 'Domínio público com uso concedido às populações tradicionais (SNUC, arts. 18 e 20). É esperado o CAR coletivo de povos e comunidades tradicionais (tipo PCT); CAR de imóvel rural particular (IRU) indica área a desapropriar ou inscrição indevida.',
    }
  }
  if (['FLONA', 'FLOES', 'FLOE'].includes(s)) {
    return {
      nivel: 'verificar', rotulo: 'Floresta — posse e domínio públicos',
      texto: 'Posse e domínio públicos, admitida a permanência de populações tradicionais que já a habitavam (SNUC, art. 17). CAR de imóvel rural particular (IRU) indica área a regularizar.',
    }
  }
  if (['APA', 'ARIE', 'RPPN', 'MONA', 'RVS'].includes(s)) {
    return {
      nivel: 'admitido', rotulo: 'Admite terras públicas ou privadas',
      texto: 'A categoria admite propriedade privada (SNUC, arts. 12, 13, 15, 16 e 21). O CAR é compatível, sujeito ao plano de manejo e ao zoneamento da UC.',
    }
  }
  return { nivel: 'indefinido', rotulo: 'Categoria sem regra cadastrada', texto: 'Avaliar caso a caso pelo ato de criação e pelo plano de manejo.' }
}

// ── Enquadramento da ZONA ───────────────────────────────────────────
// Código conhecido decide; sem código, o nome decide (camadas enviadas
// no Mapa não seguem o padrão ZI/ZP/…). "Uso Restrito" é proteção:
// as palavras de proteção são testadas ANTES das de uso.
function carucEnquadrarZona(codigo, nome) {
  const c = String(codigo || '').toUpperCase()
  if (c === 'ZOA') return { nivel: 'amortecimento', rotulo: 'Amortecimento' }
  if (CARUC_ZONA_PROTECAO.has(c)) return { nivel: 'protecao', rotulo: 'Proteção' }
  if (CARUC_ZONA_USO.has(c)) return { nivel: 'uso', rotulo: 'Uso' }
  const n = carucNorm(nome)
  if (/amortec/.test(n)) return { nivel: 'amortecimento', rotulo: 'Amortecimento' }
  if (/intang|primitiv|protec|restrit|conserva|preserva/.test(n)) return { nivel: 'protecao', rotulo: 'Proteção' }
  if (/uso|extrativ|produc|popula|ocupa|moderad|caca|pesca|manejo|especial/.test(n)) return { nivel: 'uso', rotulo: 'Uso' }
  return { nivel: 'indefinido', rotulo: 'Sem enquadramento' }
}

// Normaliza as propriedades de uma feição de zona vinda de qualquer
// fonte para { codigo, nome, sub }.
function carucZonaDePropriedades(p) {
  p = p || {}
  const codCru = p.zona_codigo || p.Zona || p.ZONA || null
  const codigo = codCru && /^[A-Z]{2,6}$/.test(String(codCru).trim()) ? String(codCru).trim() : null
  let base = p.zona_nome || p.Zona_1 || p['Descriçã'] || p['Descrição'] || (codigo ? null : (p.Zona || p.ZONA)) || null
  let nome = base ? String(base).trim() : (codigo || 'Zona sem nome')
  if (base && !/^zona\b/i.test(nome)) nome = 'Zona de ' + nome
  const sub = p.zoneamento || p.SubZonas || p.Nome || null
  return { codigo, nome, sub: sub && String(sub) !== codigo ? String(sub) : null }
}

// Zonas e zona de amortecimento de UMA UC, das fontes carregadas.
// arquivo: FeatureCollection de data/uc_zonas_acre.geojson
// camadas: linhas de camadas_mapa { nome, uc_id, geojson }
// Devolve { zonas: Feature[], za: Feature[], fonteZonas, fonteZa }.
// Arquivo padrão tem prioridade sobre camada enviada (FE Rio Liberdade
// tem os dois; o arquivo é o que tem código de zona padronizado).
function carucZonasDaUC(uc, arquivo, camadas) {
  const zonasArq = [], zaArq = []
  for (const f of (arquivo?.features || [])) {
    const cod = CARUC_ZONAS_ARQUIVO_UC[f.properties?.uc_nome]
    if (!cod || cod !== uc?.codigo || !f.geometry) continue
    const z = carucZonaDePropriedades(f.properties)
    const feat = { type: 'Feature', geometry: f.geometry, properties: { ...z, fonte: 'Arquivo de zoneamento do sistema' } }
    ;(z.codigo === 'ZOA' ? zaArq : zonasArq).push(feat)
  }

  const zonasCam = [], zaCam = []
  let nomeCamZonas = null, nomeCamZa = null
  for (const c of (camadas || [])) {
    if (!c || c.uc_id !== uc?.id) continue
    const nomeCam = String(c.nome || '')
    const ehZa = /amortec/i.test(nomeCam)
    const ehZon = /zoneamento/i.test(nomeCam)
    if (!ehZa && !ehZon) continue
    for (const f of (c.geojson?.features || [])) {
      if (!f.geometry || !/Polygon/.test(f.geometry.type)) continue
      const z = carucZonaDePropriedades(f.properties)
      const feat = { type: 'Feature', geometry: f.geometry, properties: { ...z, fonte: `Camada "${nomeCam.replace(/\s+/g, ' ').trim()}"` } }
      if (ehZa) { zaCam.push(feat); nomeCamZa = nomeCam } else { zonasCam.push(feat); nomeCamZonas = nomeCam }
    }
  }

  const zonas = zonasArq.length ? zonasArq : zonasCam
  const za = [...zaArq, ...zaCam]
  return {
    zonas,
    za,
    fonteZonas: zonasArq.length ? 'Arquivo de zoneamento do sistema' : (nomeCamZonas ? `Camada "${nomeCamZonas.replace(/\s+/g, ' ').trim()}" (Mapa das UCs)` : null),
    fonteZa: [zaArq.length ? 'arquivo de zoneamento do sistema' : null, nomeCamZa ? `camada "${nomeCamZa.replace(/\s+/g, ' ').trim()}"` : null].filter(Boolean).join(' + ') || null,
  }
}

// ── Pontos de atenção de um imóvel (regras, nunca opinião) ─────────
function carucAtencoes(im, uc, enqCat) {
  const a = []
  const tipo = String(im.tipo_imovel || '').toUpperCase()
  if (im.local === 'uc') {
    if (enqCat?.nivel === 'conflito') a.push('CAR em UC de proteção integral')
    else if (enqCat?.nivel === 'verificar' && tipo === 'IRU') a.push('Imóvel particular (IRU) em UC de domínio público')
  }
  const criacaoUC = carucData(uc?.data_criacao)
  const inscricao = carucData(im.data_inscricao)
  if (im.local === 'uc' && criacaoUC && inscricao && inscricao > criacaoUC) a.push('Inscrito após a criação da UC')
  if ((im.zonas || []).some(z => z.nivel === 'protecao' && z.ha >= CARUC_HA_MIN)) a.push('Atinge zona de proteção')
  const st = carucNorm(im.status + ' ' + im.situacao)
  if (/cancel|suspens/.test(st)) a.push('CAR cancelado ou suspenso')
  if (im.prodes && im.prodes.pos_marco_ha >= CARUC_HA_MIN) a.push('Desmatamento PRODES após 22/07/2008')
  if (im.ambiental && im.ambiental.deter_alertas > 0) a.push('Alerta DETER')
  if (im.fracionamento) a.push('Possível fracionamento')
  if ((im.sobreposicoes || []).length) a.push('Sobreposição com outro CAR')
  if (im.area_divergente) a.push('Área declarada diverge do polígono')
  return a
}

// Quanto do imóvel está dentro da UC. "Borda" (< 10%) quase sempre é
// erro de divisa ou de desenho, não ocupação — separar limpa a análise.
function carucFaixaNaUC(im) {
  if (im.local === 'za') return 'Só na zona de amortecimento'
  const p = Number(im.pct_analise)
  if (!isFinite(p)) return 'Sem cálculo'
  if (p >= 95) return 'Integral (95% ou mais)'
  if (p >= 50) return 'Majoritário (50% a 95%)'
  if (p >= 10) return 'Parcial (10% a 50%)'
  return 'Borda (menos de 10%)'
}

// Prioridade para fiscalização — regra aceita pelo usuário, sempre com
// o MOTIVO ao lado (nunca uma nota sem explicação).
//   Alta: (UC de proteção integral OU zona de proteção) COM desmatamento
//         PRODES após o marco ou alerta DETER — só existe quando esses
//         dados foram pedidos no relatório.
//   Média: CAR em proteção integral, zona de proteção, IRU em UC de
//         domínio público, inscrição após a criação, fracionamento,
//         classe Vermelho ou sobreposição com outro CAR.
//   Baixa: nenhum dos anteriores.
function carucPrioridade(im, enqCat) {
  const naUC = im.local === 'uc'
  const protecao = []
  if (naUC && enqCat?.nivel === 'conflito') protecao.push('UC de proteção integral')
  const zp = (im.zonas || []).filter(z => z.nivel === 'protecao' && z.ha >= CARUC_HA_MIN)
  if (zp.length) protecao.push(zp.map(z => z.nome).join(', '))
  const dano = []
  if (im.prodes && im.prodes.pos_marco_ha >= CARUC_HA_MIN) dano.push(`${im.prodes.pos_marco_ha.toFixed(1).replace('.', ',')} ha PRODES após 2008`)
  if (im.ambiental && im.ambiental.deter_alertas > 0) dano.push(`${im.ambiental.deter_alertas} alerta(s) DETER`)
  if (protecao.length && dano.length) return { nivel: 'alta', motivos: [...protecao, ...dano] }

  const m = [...protecao]
  const tipo = String(im.tipo_imovel || '').toUpperCase()
  if (naUC && enqCat?.nivel === 'verificar' && tipo === 'IRU') m.push('imóvel particular em UC de domínio público')
  if (im.inscricao_vs_uc === 'depois') m.push('inscrito após a criação da UC')
  if (im.fracionamento) m.push('possível fracionamento')
  if (carucNorm(im.classe) === 'vermelho') m.push('classe Vermelho')
  if ((im.sobreposicoes || []).length) m.push('sobreposição com outro CAR')
  if (m.length) return { nivel: 'media', motivos: m }
  return { nivel: 'baixa', motivos: [] }
}

const CARUC_PRIORIDADE_ROTULO = { alta: 'Alta', media: 'Média', baixa: 'Baixa' }

// Classificações que dependem do CONJUNTO (titular repetido, homônimo,
// fracionamento) — calculadas sobre o relatório inteiro, antes de
// qualquer filtro, para o filtro nunca mudar o que um imóvel é.
function carucEnriquecer(imoveis, uc, enqCat) {
  const porGrupo = new Map(), porNome = new Map()
  for (const i of imoveis) {
    if (i.titular_grupo != null) {
      const g = porGrupo.get(i.titular_grupo) || []
      g.push(i); porGrupo.set(i.titular_grupo, g)
    }
    const nome = carucNorm(i.titular)
    if (nome) {
      const g = porNome.get(nome) || []
      g.push(i); porNome.set(nome, g)
    }
  }
  const criacaoUC = carucData(uc?.data_criacao)
  for (const i of imoveis) {
    const g = i.titular_grupo != null ? porGrupo.get(i.titular_grupo) : [i]
    i.titular_cars_relatorio = g.length
    const mesmoNome = porNome.get(carucNorm(i.titular)) || []
    // Mesmo nome com OUTRO documento (ou sem documento): pode ser
    // homônimo, parente ou erro de cadastro — "verificar", nunca "mesma pessoa".
    i.homonimo = mesmoNome.some(o => o !== i && (o.titular_grupo == null || o.titular_grupo !== i.titular_grupo))
    // Fracionamento: só pessoa física (CNPJ de órgão, como o do INCRA,
    // tem milhares de imóveis e não é isso); 2+ imóveis no relatório,
    // todos até 4 MF, somando mais de 4.
    const mods = g.map(x => Number(x.modulos))
    i.fracionamento = i.titular_tipo_doc === 'cpf' && g.length >= 2
      && mods.every(m => isFinite(m) && m > 0 && m <= 4) && mods.reduce((a, b) => a + b, 0) > 4
    const insc = carucData(i.data_inscricao)
    i.inscricao_vs_uc = !insc || !criacaoUC ? 'sem_data' : (insc > criacaoUC ? 'depois' : 'antes')
    const decl = Number(i.area_declarada_ha), calc = Number(i.area_total_ha)
    i.area_divergente = decl > 0 && calc > 0 && Math.abs(decl - calc) / decl > CARUC_DIVERGENCIA_AREA
    i.faixa_uc = carucFaixaNaUC(i)
    i.sobreposicoes = i.sobreposicoes || []
  }
  for (const i of imoveis) {
    i.atencoes = carucAtencoes(i, uc, enqCat)
    i.prioridade = carucPrioridade(i, enqCat)
  }
  return imoveis
}

// Sobreposição entre CARs na área analisada (parte na UC/ZA). Varredura
// ordenada pelo x mínimo: só compara quem se cruza no eixo x, e o
// retângulo antes do polígono. Nada abaixo de CARUC_SOBREP_HA_MIN.
async function carucSobreposicoesEntreCars(imoveis, aoProgresso) {
  const itens = imoveis.filter(i => i._geom).map(i => ({ i, bb: turf.bbox(i._geom) }))
  itens.sort((a, b) => a.bb[0] - b.bb[0])
  for (const x of itens) x.i.sobreposicoes = []
  for (let a = 0; a < itens.length; a++) {
    const A = itens[a]
    for (let b = a + 1; b < itens.length && itens[b].bb[0] <= A.bb[2]; b++) {
      const B = itens[b]
      if (!_carucBboxSobrepoe(A.bb, B.bb)) continue
      const inter = carucInterseccao(A.i._geom, B.i._geom, A.bb)
      const ha = inter ? carucAreaHa(inter) : 0
      if (ha < CARUC_SOBREP_HA_MIN) continue
      const mesmo = A.i.titular_grupo != null && A.i.titular_grupo === B.i.titular_grupo
      A.i.sobreposicoes.push({ cod: B.i.cod, ha, mesmo_titular: mesmo })
      B.i.sobreposicoes.push({ cod: A.i.cod, ha, mesmo_titular: mesmo })
    }
    if (a % 50 === 0) { aoProgresso?.(a, itens.length); await new Promise(r => setTimeout(r, 0)) }
  }
  for (const x of itens) x.i.sobreposicoes.sort((p, q) => q.ha - p.ha)
}

// ── Filtros (definição única: tela, contagens e texto da exportação) ─
// `valores(i)` devolve a lista de rótulos do imóvel naquela dimensão
// (uma dimensão "multi" pode ter vários: um imóvel atinge 2 zonas).
const CARUC_FILTROS = [
  { chave: 'prioridade', rotulo: 'Prioridade', ordem: ['Alta', 'Média', 'Baixa'], valores: i => [CARUC_PRIORIDADE_ROTULO[i.prioridade?.nivel] || 'Baixa'] },
  { chave: 'municipio', rotulo: 'Município', valores: i => [i.municipio || 'Não informado'] },
  { chave: 'situacao', rotulo: 'Situação', valores: i => [i.situacao || 'Não informado'] },
  { chave: 'status', rotulo: 'Status', valores: i => [i.status || 'Não informado'] },
  { chave: 'classe', rotulo: 'Classe SICAR', valores: i => [i.classe || 'Não informado'] },
  { chave: 'tipo', rotulo: 'Tipo de imóvel', valores: i => [carucTipoImovel(i.tipo_imovel)] },
  { chave: 'faixaMF', rotulo: 'Tamanho (módulos fiscais)', ordem: ['Pequena (até 4 MF)', 'Média (4 a 15 MF)', 'Grande (acima de 15 MF)', 'Sem informação'], valores: i => [carucFaixaModulos(i.modulos)] },
  { chave: 'faixaUC', rotulo: 'Quanto está na UC', ordem: ['Integral (95% ou mais)', 'Majoritário (50% a 95%)', 'Parcial (10% a 50%)', 'Borda (menos de 10%)', 'Só na zona de amortecimento'], valores: i => [i.faixa_uc] },
  { chave: 'zona', rotulo: 'Zona de manejo', valores: i => {
      const z = (i.zonas || []).filter(x => x.ha >= CARUC_HA_MIN).map(x => x.nome)
      return z.length ? z : [i.local === 'za' ? 'Só na zona de amortecimento' : 'Fora de zona cadastrada']
    } },
  { chave: 'titular', rotulo: 'Titular', valores: i => {
      const t = []
      if (i.titular_cars_relatorio > 1) t.push('Mais de um CAR nesta UC')
      if (i.titular_cars_estado > i.titular_cars_relatorio) t.push('Tem CARs fora desta UC')
      if (i.homonimo) t.push('Mesmo nome, documento diferente')
      if (i.fracionamento) t.push('Possível fracionamento')
      if (!i.na_planilha) t.push('Sem dados na planilha local')
      return t.length ? t : ['Um CAR só']
    } },
  { chave: 'inscricao', rotulo: 'Inscrição no CAR', valores: i => [{ antes: 'Antes da criação da UC', depois: 'Depois da criação da UC' }[i.inscricao_vs_uc] || 'Sem data'] },
  { chave: 'sobreposicao', rotulo: 'Sobreposição com outro CAR', valores: i => [(i.sobreposicoes || []).length ? 'Com sobreposição' : 'Sem sobreposição'] },
  { chave: 'ambiental', rotulo: 'Dado ambiental', valores: i => {
      const t = []
      if (i.prodes && i.prodes.pos_marco_ha >= CARUC_HA_MIN) t.push('Desmatamento PRODES após 2008')
      if (i.ambiental && i.ambiental.focos_periodo > 0) t.push('Focos no período')
      if (i.ambiental && i.ambiental.deter_alertas > 0) t.push('Alerta DETER')
      return t.length ? t : ['Sem registro']
    } },
  { chave: 'atencao', rotulo: 'Ponto de atenção', valores: i => (i.atencoes || []).length ? i.atencoes : ['Sem ponto de atenção'] },
]

// Opções de cada filtro com a contagem, considerando os OUTROS filtros
// ativos (facetas): escolher "Xapuri" faz o filtro de classe contar só
// dentro de Xapuri, e nenhuma opção promete um recorte vazio.
function carucOpcoesFiltro(imoveis, filtro, busca) {
  const saida = []
  for (const def of CARUC_FILTROS) {
    const outros = { ...filtro }; delete outros[def.chave]
    const base = carucFiltrar(imoveis, outros, busca)
    const cont = new Map()
    for (const i of base) for (const v of new Set(def.valores(i))) cont.set(v, (cont.get(v) || 0) + 1)
    let ops = [...cont.entries()].map(([valor, n]) => ({ valor, n }))
    if (def.ordem) ops.sort((a, b) => (def.ordem.indexOf(a.valor) + 99) % 99 - (def.ordem.indexOf(b.valor) + 99) % 99 || b.n - a.n)
    else ops.sort((a, b) => b.n - a.n || a.valor.localeCompare(b.valor, 'pt-BR'))
    const sel = filtro?.[def.chave]
    if (sel && !cont.has(sel)) ops.unshift({ valor: sel, n: 0 })
    saida.push({ chave: def.chave, rotulo: def.rotulo, opcoes: ops })
  }
  return saida
}

function carucFiltrar(imoveis, filtro, busca) {
  const termo = carucNorm(busca || '')
  const ativos = CARUC_FILTROS.filter(d => filtro?.[d.chave])
  return imoveis.filter(i => {
    for (const d of ativos) if (!d.valores(i).includes(filtro[d.chave])) return false
    if (termo && !carucNorm([i.cod, i.nome_imovel, i.titular, i.municipio].join(' ')).includes(termo)) return false
    return true
  })
}

function carucDescreverFiltros(filtro, busca) {
  const t = CARUC_FILTROS.filter(d => filtro?.[d.chave]).map(d => `${d.rotulo}: ${filtro[d.chave]}`)
  if (busca && busca.trim()) t.push(`Busca: "${busca.trim()}"`)
  return t
}

// Relatório recortado pelo filtro — a MESMA estrutura do completo, com
// o resumo recalculado. É o que a tela desenha e o que se exporta.
// opts.agrupar: ordena a relação por titular e devolve os grupos —
// a tela e as três exportações leem a MESMA ordem.
function carucRelFiltrado(rel, filtro, busca, opts = {}) {
  let imoveis = carucFiltrar(rel.imoveis, filtro, busca)
  const filtros = carucDescreverFiltros(filtro, busca)
  let grupos = null
  if (opts.agrupar) {
    grupos = carucAgruparPorTitular(imoveis)
    imoveis = grupos.flatMap(g => g.imoveis)
    filtros.push('Agrupado por titular')
  }
  return { ...rel, imoveis, grupos, agrupado: !!opts.agrupar, resumo: carucAgregar(imoveis, rel.uc), filtros, total_sem_filtro: rel.imoveis.length }
}

// Agrupa a relação por titular (titular_grupo, que o BANCO atribui por
// documento). Titular com mais imóveis no recorte vem primeiro; imóvel
// sem dado na planilha fica num bloco final — nunca some.
function carucAgruparPorTitular(imoveis) {
  const m = new Map()
  const sem = []
  for (const i of imoveis) {
    if (i.titular_grupo == null) { sem.push(i); continue }
    let g = m.get(i.titular_grupo)
    if (!g) {
      g = { grupo: i.titular_grupo, titular: i.titular, documento: i.documento, cars_uc: i.titular_cars_relatorio,
            cars_estado: i.titular_cars_estado, ha: 0, imoveis: [] }
      m.set(i.titular_grupo, g)
    }
    g.imoveis.push(i); g.ha += i.area_analise_ha || 0
  }
  const lista = [...m.values()].sort((a, b) => b.imoveis.length - a.imoveis.length || b.ha - a.ha || a.grupo - b.grupo)
  for (const g of lista) g.imoveis.sort((a, b) => b.area_analise_ha - a.area_analise_ha)
  if (sem.length) lista.push({ grupo: null, titular: null, documento: null, cars_uc: null, cars_estado: null,
    ha: sem.reduce((s, i) => s + (i.area_analise_ha || 0), 0), imoveis: sem })
  return lista
}

function carucGrupoRotulo(g) {
  if (g.grupo == null) return `Sem titular identificado na planilha local · ${g.imoveis.length} imóvel(is)`
  const partes = [`Titular nº ${g.grupo}`, g.titular || 'nome não informado']
  if (g.documento) partes.push(g.documento)
  partes.push(`${g.cars_uc} CAR(s) nesta UC`)
  if (g.cars_estado != null) partes.push(`${g.cars_estado} no Acre`)
  partes.push(`${g.ha.toFixed(2).replace('.', ',')} ha`)
  return partes.join(' · ')
}

// ── Agregação do resumo (pura) ──────────────────────────────────────
function _carucContar(lista, chave) {
  const m = new Map()
  for (const x of lista) {
    const k = chave(x) || 'Não informado'
    const g = m.get(k) || { rotulo: k, n: 0, ha: 0 }
    g.n++; g.ha += x.area_analise_ha || 0
    m.set(k, g)
  }
  return [...m.values()].sort((a, b) => b.n - a.n || b.ha - a.ha)
}

function carucAgregar(imoveis, uc) {
  const naUC = imoveis.filter(i => i.local === 'uc')
  const soZa = imoveis.filter(i => i.local === 'za')
  const somaHa = naUC.reduce((s, i) => s + (i.area_analise_ha || 0), 0)
  const areaUC = Number(uc?.area_ha) || null

  const porZona = new Map()
  for (const i of naUC) {
    for (const z of (i.zonas || [])) {
      if (z.ha < CARUC_HA_MIN) continue
      const k = z.nome
      const g = porZona.get(k) || { codigo: z.codigo, nome: z.nome, nivel: z.nivel, n: 0, ha: 0 }
      g.n++; g.ha += z.ha
      porZona.set(k, g)
    }
  }
  const semZona = naUC.filter(i => !(i.zonas || []).some(z => z.ha >= CARUC_HA_MIN))

  const comAmb = imoveis.filter(i => i.ambiental)
  const comProdes = imoveis.filter(i => i.prodes)
  return {
    total: imoveis.length,
    na_uc: naUC.length,
    so_za: soZa.length,
    soma_sobreposicao_ha: somaHa,
    pct_soma_da_uc: areaUC ? somaHa / areaUC * 100 : null,
    // Contam o MESMO conjunto que o filtro recorta (UC + zona de
    // amortecimento, quando incluída): a linha do quadro é clicável e o
    // número dela tem de ser o número de imóveis depois do clique.
    por_situacao: _carucContar(imoveis, i => i.situacao),
    por_classe: _carucContar(imoveis, i => i.classe),
    por_tipo: _carucContar(imoveis, i => carucTipoImovel(i.tipo_imovel)),
    por_faixa: _carucContar(imoveis, i => carucFaixaModulos(i.modulos)),
    por_zona: [...porZona.values()].sort((a, b) => b.ha - a.ha),
    por_prioridade: ['alta', 'media', 'baixa'].map(k => {
      const l = imoveis.filter(i => (i.prioridade?.nivel || 'baixa') === k)
      return { rotulo: CARUC_PRIORIDADE_ROTULO[k], nivel: k, n: l.length, ha: l.reduce((s, i) => s + (i.area_analise_ha || 0), 0) }
    }),
    por_faixa_uc: _carucContar(imoveis, i => i.faixa_uc),
    por_municipio: _carucContar(imoveis, i => i.municipio),
    titulares_multi: new Set(imoveis.filter(i => i.titular_cars_relatorio > 1).map(i => i.titular_grupo)).size,
    imoveis_titular_multi: imoveis.filter(i => i.titular_cars_relatorio > 1).length,
    fracionamento: imoveis.filter(i => i.fracionamento).length,
    homonimos: imoveis.filter(i => i.homonimo).length,
    com_sobreposicao: imoveis.filter(i => (i.sobreposicoes || []).length).length,
    area_divergente: imoveis.filter(i => i.area_divergente).length,
    sem_zona: semZona.length,
    com_atencao: imoveis.filter(i => (i.atencoes || []).length).length,
    sem_planilha: imoveis.filter(i => !i.na_planilha).length,
    focos_total: comAmb.length ? comAmb.reduce((s, i) => s + (i.ambiental.focos_periodo || 0), 0) : null,
    deter_alertas: comAmb.length ? comAmb.reduce((s, i) => s + (i.ambiental.deter_alertas || 0), 0) : null,
    deter_ha: comAmb.length ? comAmb.reduce((s, i) => s + Number(i.ambiental.deter_ha || 0), 0) : null,
    prodes_total_ha: comProdes.length ? comProdes.reduce((s, i) => s + i.prodes.total_ha, 0) : null,
    prodes_pos_marco_ha: comProdes.length ? comProdes.reduce((s, i) => s + i.prodes.pos_marco_ha, 0) : null,
    prodes_ate2007_ha: comProdes.length ? comProdes.reduce((s, i) => s + i.prodes.ate2007_ha, 0) : null,
  }
}

// Soma de focos no período escolhido a partir do {ano: n} da RPC.
function carucFocosNoPeriodo(porAno, de, ate) {
  let s = 0
  for (const [ano, n] of Object.entries(porAno || {})) {
    const a = Number(ano)
    if ((de == null || a >= de) && (ate == null || a <= ate)) s += Number(n) || 0
  }
  return s
}

// ── Geometria (turf) ────────────────────────────────────────────────
function carucAreaHa(f) {
  try { return turf.area(f) / 10000 } catch (_) { return 0 }
}

function _carucBboxSobrepoe(a, b) {
  return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1]
}

// Interseção de `a` com `b`, recortando `b` pelo retângulo de `a`
// antes: a UC inteira (10 mil vértices na Chico Mendes) contra cada
// imóvel seria lento demais; o recorte deixa só o pedaço que importa.
function carucInterseccao(a, b, bboxA) {
  try {
    const bb = bboxA || turf.bbox(a)
    if (!_carucBboxSobrepoe(bb, turf.bbox(b))) return null
    const bCorte = turf.bboxClip(b, bb)
    if (!bCorte?.geometry?.coordinates?.length) return null
    return turf.intersect(a, bCorte)
  } catch (_) {
    return null
  }
}

// Classifica UM imóvel do WFS contra a UC, as zonas e a ZA.
function carucAnalisarGeometria(feat, ucFeat, zonas, za) {
  const bb = turf.bbox(feat)
  const areaTotal = carucAreaHa(feat)
  const naUC = carucInterseccao(feat, ucFeat, bb)
  const haUC = naUC ? carucAreaHa(naUC) : 0

  if (haUC >= CARUC_HA_MIN) {
    const zonasHa = []
    for (const z of zonas) {
      const inter = carucInterseccao(naUC, z)
      if (!inter) continue
      const ha = carucAreaHa(inter)
      if (ha < CARUC_HA_MIN) continue
      const enq = carucEnquadrarZona(z.properties.codigo, z.properties.nome)
      const ja = zonasHa.find(x => x.nome === z.properties.nome)
      if (ja) ja.ha += ha
      else zonasHa.push({ codigo: z.properties.codigo, nome: z.properties.nome, nivel: enq.nivel, ha })
    }
    zonasHa.sort((x, y) => y.ha - x.ha)
    return { local: 'uc', area_total_ha: areaTotal, area_analise_ha: haUC, pct_analise: areaTotal ? haUC / areaTotal * 100 : null, geomAnalise: naUC, zonas: zonasHa }
  }

  for (const z of (za || [])) {
    const inter = carucInterseccao(feat, z, bb)
    const ha = inter ? carucAreaHa(inter) : 0
    if (ha >= CARUC_HA_MIN) {
      return { local: 'za', area_total_ha: areaTotal, area_analise_ha: ha, pct_analise: areaTotal ? ha / areaTotal * 100 : null, geomAnalise: inter, zonas: [] }
    }
  }
  return null
}

// Geometria enxuta para mandar ao banco (a RPC refaz a validade).
function carucGeometriaParaEnvio(f) {
  let g = f
  try { g = turf.simplify(f, { tolerance: 0.00015, highQuality: false }) } catch (_) {}
  try { g = turf.truncate(g, { precision: 6, coordinates: 2 }) } catch (_) {}
  return g.geometry || g
}

// ── Rede ────────────────────────────────────────────────────────────
async function _carucFetchWfs(url) {
  const r = await fetch(`/api/car-proxy?url=${encodeURIComponent(url)}`)
  const texto = await r.text()
  if (texto.trim().startsWith('<')) {
    const msg = texto.match(/<ows:ExceptionText>([\s\S]*?)<\/ows:ExceptionText>/)?.[1] || `resposta XML (HTTP ${r.status})`
    throw new Error('SICAR: ' + msg.trim().slice(0, 160))
  }
  if (!r.ok) throw new Error(`SICAR indisponível (HTTP ${r.status})`)
  return JSON.parse(texto)
}

// Todos os imóveis do SICAR que caem no retângulo, em páginas.
async function carucBuscarImoveisSicar(bbox, aoProgresso) {
  const base = `${CARUC_WFS_BASE}?service=WFS&version=1.1.0&request=GetFeature`
    + `&typeName=sicar:sicar_imoveis_ac&outputFormat=application/json`
    + `&BBOX=${bbox.join(',')},EPSG:4326&maxFeatures=${CARUC_WFS_PAGINA}`
  const p0 = await _carucFetchWfs(base + '&startIndex=0')
  const total = p0.numberMatched || p0.totalFeatures || (p0.features || []).length
  const feats = [...(p0.features || [])]
  const npag = Math.ceil(total / CARUC_WFS_PAGINA)
  for (let i = 1; i < npag; i += 3) {
    const lote = []
    for (let k = i; k < Math.min(i + 3, npag); k++) lote.push(_carucFetchWfs(base + `&startIndex=${k * CARUC_WFS_PAGINA}`))
    const pags = await Promise.all(lote)
    pags.forEach(p => feats.push(...(p.features || [])))
    aoProgresso?.(Math.min(feats.length, total), total)
  }
  // O mesmo imóvel pode vir em duas páginas se o servidor reordenar.
  const vistos = new Set()
  return { total, features: feats.filter(f => {
    const c = f.properties?.cod_imovel
    if (!c || !f.geometry || vistos.has(c)) return false
    vistos.add(c); return true
  }) }
}

async function carucBuscarCadastro(ucId, cods) {
  if (cods.length > CARUC_LIMITE_CADASTRO) {
    throw new Error(`${cods.length} imóveis passam do limite de ${CARUC_LIMITE_CADASTRO} por relatório.`)
  }
  const mapa = new Map()
  const { data, error } = await db.rpc('car_relatorio_uc_cadastro', { p_uc_id: ucId, p_cod_imoveis: cods })
  if (error) throw new Error('Planilha SICAR local: ' + error.message)
  for (const r of (data || [])) mapa.set(r.cod_imovel, r)
  return mapa
}

async function carucBuscarAmbiental(ucId, lista, aoProgresso) {
  const mapa = new Map()
  let falhas = 0
  for (let i = 0; i < lista.length; i += CARUC_LOTE_AMBIENTAL) {
    const lote = lista.slice(i, i + CARUC_LOTE_AMBIENTAL)
    const { data, error } = await db.rpc('car_relatorio_uc_ambiental', {
      p_uc_id: ucId,
      p_imoveis: lote.map(x => ({ cod: x.cod, geom: carucGeometriaParaEnvio(x.geom) })),
    })
    if (error) { falhas += lote.length; console.warn('[caruc] ambiental', error.message) }
    for (const r of (data || [])) mapa.set(r.cod_imovel, r)
    aoProgresso?.(Math.min(i + lote.length, lista.length), lista.length)
  }
  return { mapa, falhas }
}

// PRODES em quadrantes: cada pedido ao proxy devolve no máximo 2000
// feições por camada; quadrante que bate no teto (ou falha) é dividido
// em 4, até 3 níveis. Quadrante que continua falhando entra na conta
// de falhas — a tela DIZ que o PRODES ficou incompleto, nunca soma zero.
async function carucBuscarProdes(bboxes, aoProgresso) {
  const [x0, y0, x1, y1] = bboxes.reduce((a, b) => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])], [180, 90, -180, -90])
  const fila = []
  for (let x = x0; x < x1; x += CARUC_PRODES_QUADRO) {
    for (let y = y0; y < y1; y += CARUC_PRODES_QUADRO) {
      const q = [x, y, Math.min(x + CARUC_PRODES_QUADRO, x1), Math.min(y + CARUC_PRODES_QUADRO, y1)]
      if (bboxes.some(b => _carucBboxSobrepoe(q, b))) fila.push({ bb: q, nivel: 0 })
    }
  }
  const anual = new Map(), hist = new Map()
  let feitos = 0, totalQ = fila.length, falhas = 0

  const guardar = (m, feats) => {
    for (const f of (feats || [])) {
      if (!f.geometry) continue
      const k = f.id || JSON.stringify(f.properties) + JSON.stringify(turf.bbox(f))
      if (!m.has(k)) m.set(k, f)
    }
  }
  const dividir = (item) => {
    const [a, b, c, d] = item.bb, mx = (a + c) / 2, my = (b + d) / 2
    for (const q of [[a, b, mx, my], [mx, b, c, my], [a, my, mx, d], [mx, my, c, d]]) {
      if (bboxes.some(bx => _carucBboxSobrepoe(q, bx))) { fila.push({ bb: q, nivel: item.nivel + 1 }); totalQ++ }
    }
  }

  async function trabalhador() {
    while (fila.length) {
      const item = fila.shift()
      let ok = false, cheio = false
      try {
        const r = await fetch('/api/prodes-proxy', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ bbox: item.bb }), signal: AbortSignal.timeout(58000),
        })
        const j = await r.json()
        if (!r.ok || j.error || j.anual?._error || j.historico?._error) throw new Error(j.error || j.anual?._error || j.historico?._error || 'HTTP ' + r.status)
        cheio = (j.anual?.features?.length || 0) >= CARUC_PRODES_MAX_FEAT || (j.historico?.features?.length || 0) >= CARUC_PRODES_MAX_FEAT
        if (!cheio || item.nivel >= 3) { guardar(anual, j.anual?.features); guardar(hist, j.historico?.features) }
        if (cheio && item.nivel >= 3) falhas++
        ok = true
      } catch (e) {
        console.warn('[caruc] PRODES quadrante', item.bb, e.message)
      }
      if ((!ok || cheio) && item.nivel < 3) dividir(item)
      else if (!ok) falhas++
      feitos++
      aoProgresso?.(feitos, totalQ)
    }
  }
  await Promise.all([trabalhador(), trabalhador(), trabalhador()])
  const indexar = m => [...m.values()].map(f => ({ f, bb: turf.bbox(f) }))
  return { anual: indexar(anual), historico: indexar(hist), falhas, quadrantes: totalQ }
}

function carucProdesDoImovel(geom, prodes) {
  const bb = turf.bbox(geom)
  const porAno = {}
  let total = 0, posMarco = 0, ate2007 = 0
  for (const { f, bb: fb } of prodes.anual) {
    if (!_carucBboxSobrepoe(bb, fb)) continue
    const inter = carucInterseccao(geom, f, bb)
    const ha = inter ? carucAreaHa(inter) : 0
    if (ha < CARUC_HA_MIN) continue
    const ano = Number(f.properties?.year || f.properties?.ano || String(f.properties?.data_detec || '').slice(0, 4)) || null
    if (ano) porAno[ano] = (porAno[ano] || 0) + ha
    total += ha
    if (ano && ano >= CARUC_PRODES_MARCO) posMarco += ha
  }
  for (const { f, bb: fb } of prodes.historico) {
    if (!_carucBboxSobrepoe(bb, fb)) continue
    const inter = carucInterseccao(geom, f, bb)
    const ha = inter ? carucAreaHa(inter) : 0
    if (ha >= CARUC_HA_MIN) ate2007 += ha
  }
  return { por_ano: porAno, total_ha: total, pos_marco_ha: posMarco, ate2007_ha: ate2007 }
}

// ── Orquestração ────────────────────────────────────────────────────
// opcoes: { incluirZa, focos, deter, prodes, focosDe, focosAte }
// aoEtapa(texto, feito?, total?) informa o progresso.
async function carucGerarRelatorio(uc, ucGeom, fontesZonas, opcoes, aoEtapa) {
  const etapa = (t, a, b) => aoEtapa?.(t, a, b)
  const ucFeat = { type: 'Feature', geometry: ucGeom, properties: {} }
  const { zonas, za, fonteZonas, fonteZa } = carucZonasDaUC(uc, fontesZonas.arquivo, fontesZonas.camadas)
  const usarZa = !!(opcoes.incluirZa && za.length)

  let bbox = turf.bbox(ucFeat)
  if (usarZa) for (const z of za) {
    const b = turf.bbox(z)
    bbox = [Math.min(bbox[0], b[0]), Math.min(bbox[1], b[1]), Math.max(bbox[2], b[2]), Math.max(bbox[3], b[3])]
  }

  etapa('Buscando imóveis no SICAR…')
  const sicar = await carucBuscarImoveisSicar(bbox, (a, b) => etapa('Buscando imóveis no SICAR…', a, b))

  etapa('Cruzando imóveis com a UC e as zonas…', 0, sicar.features.length)
  const analisados = []
  for (let i = 0; i < sicar.features.length; i++) {
    const f = sicar.features[i]
    const g = carucAnalisarGeometria(f, ucFeat, zonas, usarZa ? za : [])
    if (g) analisados.push({ f, g })
    if (i % 25 === 0) {
      etapa('Cruzando imóveis com a UC e as zonas…', i, sicar.features.length)
      await new Promise(r => setTimeout(r, 0)) // devolve a vez para a tela
    }
  }

  etapa('Completando com a planilha SICAR local…')
  const cods = analisados.map(x => x.f.properties.cod_imovel)
  const cadastro = cods.length ? await carucBuscarCadastro(uc.id, cods) : new Map()

  const imoveis = analisados.map(({ f, g }) => {
    const p = f.properties || {}
    const l = cadastro.get(p.cod_imovel)
    return {
      cod: p.cod_imovel,
      local: g.local,
      na_planilha: !!l,
      nome_imovel: l?.nom_imovel || null,
      titular: l?.nome_compl || null,
      documento: l?.cpf_cnpj_mascarado || null,
      municipio: l?.nom_munici || p.municipio || null,
      situacao: l?.condicao_i || p.condicao || null,
      status: carucStatus(l?.ind_status || p.status_imovel || p.ind_status),
      classe: l?.nome_class || null,
      tipo_imovel: p.tipo_imovel || null,
      modulos: l?.num_modulo ?? p.mod_fiscal ?? null,
      area_declarada_ha: l?.num_area_i != null ? Number(l.num_area_i) : (parseFloat(p.area) || null),
      data_inscricao: carucData(l?.dat_criaca || p.dat_criacao),
      relacao_juridica: l?.tipo_docum || null,
      titular_grupo: l?.titular_grupo ?? null,
      titular_cars_estado: l?.titular_cars_estado ?? null,
      titular_tipo_doc: l?.titular_tipo_doc ?? null,
      area_total_ha: g.area_total_ha,
      area_analise_ha: g.area_analise_ha,
      pct_analise: g.pct_analise,
      zonas: g.zonas,
      _geom: g.geomAnalise,
    }
  })

  let falhasAmbiental = 0
  if ((opcoes.focos || opcoes.deter) && imoveis.length) {
    etapa('Somando focos e alertas DETER…', 0, imoveis.length)
    const { mapa, falhas } = await carucBuscarAmbiental(uc.id, imoveis.map(i => ({ cod: i.cod, geom: i._geom })),
      (a, b) => etapa('Somando focos e alertas DETER…', a, b))
    falhasAmbiental = falhas
    for (const i of imoveis) {
      const r = mapa.get(i.cod)
      if (!r) continue
      i.ambiental = {
        focos_por_ano: r.focos_por_ano || {},
        focos_periodo: carucFocosNoPeriodo(r.focos_por_ano, opcoes.focosDe, opcoes.focosAte),
        deter_alertas: r.deter_alertas || 0,
        deter_ha: Number(r.deter_ha || 0),
        deter_ultimo: r.deter_ultimo || null,
      }
    }
  }

  let prodesInfo = null
  if (opcoes.prodes && imoveis.length) {
    etapa('Consultando PRODES/INPE…')
    const prodes = await carucBuscarProdes(imoveis.map(i => turf.bbox(i._geom)), (a, b) => etapa('Consultando PRODES/INPE…', a, b))
    etapa('Cruzando PRODES com os imóveis…')
    for (let k = 0; k < imoveis.length; k++) {
      imoveis[k].prodes = carucProdesDoImovel(imoveis[k]._geom, prodes)
      if (k % 25 === 0) await new Promise(r => setTimeout(r, 0))
    }
    prodesInfo = { falhas: prodes.falhas, quadrantes: prodes.quadrantes }
  }

  etapa('Verificando sobreposição entre os CARs…', 0, imoveis.length)
  await carucSobreposicoesEntreCars(imoveis, (a, b) => etapa('Verificando sobreposição entre os CARs…', a, b))

  const enqCat = carucEnquadrarCategoria(uc)
  carucEnriquecer(imoveis, uc, enqCat)
  for (const i of imoveis) delete i._geom
  imoveis.sort((a, b) => (a.local === b.local ? 0 : a.local === 'uc' ? -1 : 1) || b.area_analise_ha - a.area_analise_ha)

  return {
    uc, opcoes, gerado_em: new Date().toISOString(),
    enquadramento: enqCat,
    zoneamento: { tem: zonas.length > 0, fonte: fonteZonas, temZa: za.length > 0, fonteZa, usouZa: usarZa },
    sicar_no_retangulo: sicar.total,
    imoveis,
    resumo: carucAgregar(imoveis, uc),
    falhas: { ambiental: falhasAmbiental, prodes: prodesInfo?.falhas || 0, prodes_quadrantes: prodesInfo?.quadrantes || 0 },
  }
}

// ── Linhas planas para exportação (CSV/Excel/PDF usam a MESMA lista) ─
// Cada coluna: { rotulo, valor(i), casas? } — `casas` definido = coluna
// numérica (Excel grava número; CSV/PDF formatam com vírgula decimal).
function carucColunasExportacao(rel) {
  const o = rel.opcoes || {}
  const n = v => (v == null || v === '' || !isFinite(Number(v))) ? null : Number(v)
  const cols = [
    { rotulo: 'Nº do CAR', valor: i => i.cod },
    { rotulo: 'Localização', valor: i => i.local === 'uc' ? 'Na UC' : 'Só na zona de amortecimento' },
    { rotulo: 'Imóvel', valor: i => i.nome_imovel || '' },
    { rotulo: 'Titular', valor: i => i.titular || '' },
    { rotulo: 'CPF/CNPJ (mascarado)', valor: i => i.documento || '' },
    { rotulo: 'Titular nº (neste relatório)', valor: i => i.titular_grupo ?? null, casas: 0 },
    { rotulo: 'CARs do titular nesta UC', valor: i => i.titular_grupo != null ? i.titular_cars_relatorio : null, casas: 0 },
    { rotulo: 'CARs do titular no Acre', valor: i => i.titular_cars_estado ?? null, casas: 0 },
    { rotulo: 'Município', valor: i => i.municipio || '' },
    { rotulo: 'Situação', valor: i => i.situacao || '' },
    { rotulo: 'Status', valor: i => i.status || '' },
    { rotulo: 'Classe SICAR', valor: i => i.classe || '' },
    { rotulo: 'Tipo', valor: i => carucTipoImovel(i.tipo_imovel) },
    { rotulo: 'Módulos fiscais', valor: i => n(i.modulos), casas: 2 },
    { rotulo: 'Área total (ha)', valor: i => n(i.area_total_ha), casas: 2 },
    { rotulo: 'Área na UC/ZA (ha)', valor: i => n(i.area_analise_ha), casas: 2 },
    { rotulo: '% do imóvel na UC/ZA', valor: i => n(i.pct_analise), casas: 1 },
    { rotulo: 'Quanto está na UC', valor: i => i.faixa_uc || '' },
    { rotulo: 'Área declarada (ha)', valor: i => n(i.area_declarada_ha), casas: 2 },
    { rotulo: 'Sobreposição com outros CARs', valor: i => (i.sobreposicoes || []).map(o => `${o.cod} (${Number(o.ha).toFixed(2).replace('.', ',')} ha${o.mesmo_titular ? ', mesmo titular' : ''})`).join('; ') },
    { rotulo: 'Zonas atingidas', valor: i => (i.zonas || []).map(z => `${z.nome} (${Number(z.ha).toFixed(2).replace('.', ',')} ha)`).join('; ') },
    { rotulo: 'Inscrição no CAR', valor: i => i.data_inscricao ? i.data_inscricao.split('-').reverse().join('/') : '' },
  ]
  if (o.focos) cols.push({ rotulo: `Focos ${o.focosDe}–${o.focosAte}`, valor: i => i.ambiental ? i.ambiental.focos_periodo : null, casas: 0 })
  if (o.deter) {
    cols.push({ rotulo: 'Alertas DETER', valor: i => i.ambiental ? i.ambiental.deter_alertas : null, casas: 0 })
    cols.push({ rotulo: 'DETER (ha)', valor: i => i.ambiental ? n(i.ambiental.deter_ha) : null, casas: 2 })
  }
  if (o.prodes) {
    cols.push({ rotulo: 'PRODES 2008+ total (ha)', valor: i => i.prodes ? i.prodes.total_ha : null, casas: 2 })
    cols.push({ rotulo: 'PRODES após o marco (ha)', valor: i => i.prodes ? i.prodes.pos_marco_ha : null, casas: 2 })
    cols.push({ rotulo: 'Desmatado até 2007 (ha)', valor: i => i.prodes ? i.prodes.ate2007_ha : null, casas: 2 })
  }
  cols.push({ rotulo: 'Prioridade', valor: i => CARUC_PRIORIDADE_ROTULO[i.prioridade?.nivel] || '' })
  cols.push({ rotulo: 'Motivo da prioridade', valor: i => (i.prioridade?.motivos || []).join('; ') })
  cols.push({ rotulo: 'Pontos de atenção', valor: i => (i.atencoes || []).join('; ') })
  return cols
}

function carucFormatarValor(v, casas) {
  if (v == null || v === '') return ''
  if (casas == null) return String(v)
  return Number(v).toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas })
}

function carucCsv(rel) {
  const cols = carucColunasExportacao(rel)
  const esc = v => {
    const s = String(v ?? '')
    return /[;"\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
  }
  const linhas = rel.imoveis.map(i => cols.map(c => {
    const v = c.valor(i)
    // CSV sem separador de milhar: planilha abre como número.
    return c.casas != null && v != null ? Number(v).toFixed(c.casas).replace('.', ',') : v
  }))
  return '\uFEFF' + [cols.map(c => c.rotulo), ...linhas].map(l => l.map(esc).join(';')).join('\r\n')
}

if (typeof module !== 'undefined') {
  module.exports = {
    carucNorm, carucTipoImovel, carucStatus, carucFaixaModulos, carucEnquadrarCategoria,
    carucEnquadrarZona, carucZonaDePropriedades, carucZonasDaUC, carucAtencoes, carucAgregar,
    carucFocosNoPeriodo, carucColunasExportacao, carucFormatarValor, carucCsv, CARUC_ZONAS_ARQUIVO_UC,
    carucFaixaNaUC, carucPrioridade, carucEnriquecer, carucOpcoesFiltro, carucFiltrar,
    carucDescreverFiltros, carucRelFiltrado, CARUC_FILTROS, carucAgruparPorTitular, carucGrupoRotulo,
  }
}
