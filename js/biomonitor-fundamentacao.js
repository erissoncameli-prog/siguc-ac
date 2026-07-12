// ── SIGUC-AC · Biomonitor — Fundamentação científica ───────────
// Camada de REFERÊNCIA (literatura + programa federal) usada pelo
// Relatório Científico da Temporada (pages/analise-cientifica-biomonitor.html
// via js/biomonitor-analise.js). É dado externo, sempre rotulado como
// "referência" e citado — nunca se confunde com o dado observado no
// sistema. Manter os valores auditáveis: cada faixa aponta uma fonte
// em BIO_REFERENCIAS pelo id.
//
// Parâmetros por espécie: nome científico, fenologia de nidificação,
// incubação, tamanho de postura, temperatura pivotal (TSD) e padrão de
// determinação sexual. Onde a pivotal por espécie não tem consenso
// consolidado na literatura, o valor vem marcado como aproximado e a
// leitura de razão sexual é sempre qualitativa e cautelosa.

const BIO_ESPECIES_REF = {
  tartaruga: {
    nome_cientifico: 'Podocnemis expansa',
    nome_popular: 'Tartaruga-da-Amazônia',
    incubacao_dias: [45, 70],
    postura_media: 90,
    postura_faixa: [70, 130],
    temp_pivotal_c: 32.7,
    temp_pivotal_aprox: false,
    tsd_padrao: 'TSD Ia (fêmeas em temperaturas mais altas)',
    periodo_termossensivel: 'terço final da incubação',
    status_nacional: 'Menos preocupante (LC), mas historicamente sobre-explorada',
    refs: ['tsd_expansa', 'pqa'],
    obs: 'Pivotal ~32,7 °C — a mais alta já relatada para um quelônio; ' +
      'desova sincronizada com a vazante em grandes praias.',
  },
  tracaja: {
    nome_cientifico: 'Podocnemis unifilis',
    nome_popular: 'Tracajá',
    incubacao_dias: [55, 70],
    postura_media: 22,
    postura_faixa: [3, 40],
    temp_pivotal_c: 32.0,
    temp_pivotal_aprox: true,
    tsd_padrao: 'TSD Ia (fêmeas em temperaturas mais altas)',
    periodo_termossensivel: 'terço médio/final da incubação',
    status_nacional: 'Vulnerável em várias avaliações regionais',
    refs: ['unifilis_repro', 'unifilis_clima'],
    obs: 'Postura média ~22 ovos (3–40); incubação 55–70 dias, com filhotes ' +
      'podendo aguardar semanas no ninho até as primeiras chuvas. Proposta como ' +
      'indicador biológico de mudança climática.',
  },
  cabecudo: {
    nome_cientifico: 'Podocnemis sextuberculata',
    nome_popular: 'Cabeçudo / Iaçá',
    incubacao_dias: [50, 70],
    postura_media: 12,
    postura_faixa: [6, 20],
    temp_pivotal_c: 33.7,
    temp_pivotal_aprox: false,
    tsd_padrao: 'TSD Ia — faixa transicional estreita (~1,2 °C)',
    periodo_termossensivel: 'terço final da incubação',
    status_nacional: 'Vulnerável (VU)',
    refs: ['tsd_sextuberculata', 'pqa'],
    obs: 'Pivotal ~33,7 °C com faixa transicional estreita (~1,16 °C) — pouca ' +
      'margem evolutiva frente ao aquecimento.',
  },
  pitiU: {
    nome_cientifico: 'Podocnemis erythrocephala',
    nome_popular: 'Pitiú / Irapuca',
    incubacao_dias: [55, 75],
    postura_media: 8,
    postura_faixa: [5, 14],
    temp_pivotal_c: null,
    temp_pivotal_aprox: true,
    tsd_padrao: 'TSD presumida (gênero Podocnemis)',
    periodo_termossensivel: 'terço final da incubação',
    status_nacional: 'Dados insuficientes / atenção regional',
    refs: ['pqa'],
    obs: 'Desova em praias e barrancos de rios de água preta; postura pequena.',
  },
  cupido: {
    nome_cientifico: 'Podocnemis cayennensis',
    nome_popular: 'Cupido',
    incubacao_dias: [55, 75],
    postura_media: 20,
    postura_faixa: [10, 35],
    temp_pivotal_c: null,
    temp_pivotal_aprox: true,
    tsd_padrao: 'TSD presumida (gênero Podocnemis)',
    periodo_termossensivel: 'terço final da incubação',
    status_nacional: 'Atenção regional',
    refs: ['pqa'],
    obs: 'Táxon do complexo Podocnemis; biologia reprodutiva próxima às congêneres.',
  },
  jabuti_pe_elefante: {
    nome_cientifico: 'Chelonoidis denticulatus',
    nome_popular: 'Jabuti-pé-de-elefante / tinga',
    incubacao_dias: [120, 190],
    postura_media: 8,
    postura_faixa: [4, 15],
    temp_pivotal_c: null,
    temp_pivotal_aprox: true,
    tsd_padrao: 'TSD presumida (Testudinidae)',
    periodo_termossensivel: 'terço médio da incubação',
    status_nacional: 'Vulnerável (VU) — pressão de caça',
    refs: ['pqa'],
    obs: 'Quelônio terrestre de floresta; ninhos em serapilheira, incubação longa.',
  },
  jabuti_piranga: {
    nome_cientifico: 'Chelonoidis carbonarius',
    nome_popular: 'Jabuti-piranga',
    incubacao_dias: [120, 190],
    postura_media: 6,
    postura_faixa: [2, 15],
    temp_pivotal_c: null,
    temp_pivotal_aprox: true,
    tsd_padrao: 'TSD presumida (Testudinidae)',
    periodo_termossensivel: 'terço médio da incubação',
    status_nacional: 'Atenção regional — pressão de caça',
    refs: ['pqa'],
    obs: 'Quelônio terrestre; posturas pequenas e escalonadas ao longo do ano.',
  },
  mucua: {
    nome_cientifico: 'Kinosternon scorpioides',
    nome_popular: 'Muçuã / jurará',
    incubacao_dias: [120, 180],
    postura_media: 4,
    postura_faixa: [1, 8],
    temp_pivotal_c: null,
    temp_pivotal_aprox: true,
    tsd_padrao: 'Determinação sexual genotípica/variável (Kinosternidae)',
    periodo_termossensivel: '—',
    status_nacional: 'Atenção regional',
    refs: ['pqa'],
    obs: 'Quelônio de igapós e áreas alagáveis; postura muito pequena, incubação longa.',
  },
  outro: {
    nome_cientifico: '—',
    nome_popular: 'Outra espécie',
    incubacao_dias: null,
    postura_media: null,
    postura_faixa: null,
    temp_pivotal_c: null,
    temp_pivotal_aprox: true,
    tsd_padrao: '—',
    periodo_termossensivel: '—',
    status_nacional: '—',
    refs: [],
    obs: 'Registro sem espécie identificada — reclassificar na validação.',
  },
}

// Faixas de leitura da temperatura de substrato para razão sexual.
// Genéricas ao gênero Podocnemis (TSD Ia): frio → machos; quente → fêmeas.
const BIO_TSD_FAIXAS = [
  { rotulo: 'Frio — tende a machos',        max_ate: 31.0, cor: '#1A6B8C' },
  { rotulo: 'Faixa de transição',           max_ate: 33.0, cor: '#C9A84C' },
  { rotulo: 'Quente — tende a fêmeas',      max_ate: null, cor: '#D97706' },
]

// Referências citadas (numeradas ao renderizar). URLs de fontes reais
// consultadas na elaboração do relatório.
const BIO_REFERENCIAS = {
  tsd_expansa: {
    autores: 'Valenzuela, N. et al.',
    titulo: 'Temperature-sex determination in Podocnemis expansa (Testudines, Podocnemididae)',
    fonte: 'SciELO / Iheringia, Série Zoologia',
    url: 'https://www.scielo.br/j/isz/a/4HhghCYXhnzYCbMT5sgzDXc/',
  },
  tsd_sextuberculata: {
    autores: 'Estudo de TSD em Podocnemis sextuberculata',
    titulo: 'Effects of semi-constant temperature on embryonic and hatchling phenotypes of six-tubercled Amazon River turtles',
    fonte: 'PubMed',
    url: 'https://pubmed.ncbi.nlm.nih.gov/36031213/',
  },
  clima_pulso: {
    autores: 'Eisemberg, C.C.; Balestra, R.A.M.; Famelli, S. et al.',
    titulo: 'Vulnerability of Giant South American Turtle (Podocnemis expansa) nesting habitat to climate-change-induced alterations to fluvial cycles',
    fonte: 'Tropical Conservation Science (SAGE)',
    url: 'https://journals.sagepub.com/doi/10.1177/1940082916667139',
  },
  alagamento: {
    autores: 'Comunidade / conservação de Podocnemis unifilis',
    titulo: 'Community based actions save Yellow-spotted river turtle (Podocnemis unifilis) eggs and hatchlings flooded by rapid river level rises',
    fonte: 'PMC / PLOS',
    url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC7501802/',
  },
  unifilis_repro: {
    autores: 'Reprodução de Podocnemis unifilis',
    titulo: 'Reprodução da taricaya Podocnemis unifilis na várzea do Médio Solimões, Amazonas, Brasil',
    fonte: 'ResearchGate',
    url: 'https://www.researchgate.net/publication/26446750',
  },
  unifilis_clima: {
    autores: 'Embrapa',
    titulo: 'Determinação sexual do tracajá Podocnemis unifilis como indicador biológico de mudança climática',
    fonte: 'Portal Embrapa',
    url: 'https://www.embrapa.br/busca-de-publicacoes/-/publicacao/1176208/',
  },
  pqa: {
    autores: 'IBAMA / ICMBio (RAN)',
    titulo: 'Programa Quelônios da Amazônia (PQA)',
    fonte: 'gov.br/ibama',
    url: 'https://www.gov.br/ibama/pt-br/assuntos/biodiversidade/fauna-silvestre/quelonios-pqa',
  },
  javaes: {
    autores: 'Ferreira Júnior, P.D. et al.',
    titulo: 'Nesting ecology of Podocnemis expansa and Podocnemis unifilis in the Javaés River, Brazil',
    fonte: 'SciELO / Brazilian Journal of Biology',
    url: 'http://www.scielo.br/j/bjb/a/sftPCp6tRNPPrXCQCfgvWzq/?lang=en',
  },
  crescimento_vb: {
    autores: 'Estimativa de idade/tamanho por taxa de crescimento (Podocnemididae)',
    titulo: 'Using growth rates to estimate the minimum age and size — aplicação da equação de von Bertalanffy',
    fonte: 'Journal of Zoo and Aquarium Research (JZAR)',
    url: 'https://jzar.org/jzar/article/download/432/376',
  },
  headstart: {
    autores: 'Demografia e manejo de Podocnemis',
    titulo: 'A Demographic Study of the Arrau Turtle (Podocnemis expansa) — crescimento e recrutamento (headstarting)',
    fonte: 'ResearchGate',
    url: 'https://www.researchgate.net/publication/232685236',
  },
  fusariose: {
    autores: 'Sarmiento-Ramírez, J.M. et al.',
    titulo: 'Beyond Sea Turtles: Fusarium keratoplasticum in Eggshells of Podocnemis unifilis, a Threatened Amazonian Freshwater Turtle',
    fonte: 'Journal of Fungi (MDPI) / PMC',
    url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC8470610/',
  },
  falha_reprodutiva: {
    autores: 'Lavigne, B. et al.',
    titulo: 'Understanding early reproductive failure in turtles and tortoises',
    fonte: 'Animal Conservation (Wiley)',
    url: 'https://zslpublications.onlinelibrary.wiley.com/doi/10.1111/acv.12986',
  },
}

// Fatos-âncora do contexto regional/programático (camada de referência).
const BIO_CONTEXTO = {
  pqa_criacao: 1979,
  pqa_filhotes_acumulados: 107092055,   // filhotes manejados/soltos desde 1979 (PQA)
  flood_mortalidade_unifilis: '10–100% dos ovos conforme a duração do alagamento',
  flood_limiar_nivel_m: 1.5,             // +1,5 m já reduz exposição abaixo do mínimo em 50% da área
  exposicao_minima_dias: 55,             // dias acima d'água exigidos para incubação/eclosão
  incubacao_ref_dias: [55, 70],          // faixa típica de incubação (Podocnemis de rio)
  // Crescimento / headstarting (camada de referência):
  crescimento_dobra_1ano: true,          // filhotes podem dobrar o tamanho de casco no 1º ano
  headstart_casco_mm: 62.7,              // casco médio de filhotes headstarted na soltura (lit.)
  soltura_direta_casco_mm: 36.3,         // casco médio de filhotes de soltura direta (lit.)
  tamanho_soltura_ideal_cm: [5.0, 7.0],  // faixa-alvo de casco p/ soltura pós-headstarting (ref.)
  crescimento_ref_mm_ano: 56.8,          // ganho anual de casco de referência (Podocnemididae)
}

// Leitura QUALITATIVA da razão sexual da coorte a partir da temperatura
// média de substrato observada, ancorada na pivotal da espécie (ou na
// genérica do gênero). Cautelosa por natureza: a determinação ocorre no
// período termossensível, não na média bruta.
function bioEstimativaSexoCoorte(especie, tempMedia) {
  const ref = BIO_ESPECIES_REF[especie] || null
  const piv = (ref && ref.temp_pivotal_c) || 32.0        // fallback genérico
  const aprox = !ref || ref.temp_pivotal_aprox
  if (tempMedia == null || isNaN(tempMedia)) {
    return { tendencia: 'indefinida', delta: null, pivotal: piv, aprox,
      texto: 'Sem medições de temperatura suficientes para leitura de razão sexual.' }
  }
  const delta = +(tempMedia - piv).toFixed(1)
  let tendencia, texto
  if (delta >= 1.0)      { tendencia = 'femeas'; texto = 'Temperaturas acima da pivotal — coorte tende a produzir mais fêmeas.' }
  else if (delta <= -1.0){ tendencia = 'machos'; texto = 'Temperaturas abaixo da pivotal — coorte tende a produzir mais machos.' }
  else                   { tendencia = 'equilibrio'; texto = 'Temperaturas próximas à pivotal — razão sexual provavelmente equilibrada.' }
  return { tendencia, delta, pivotal: piv, aprox, texto }
}

// HTML da lista de referências (numerada), para a seção de fontes.
function bioReferenciasHTML(ids) {
  const chaves = (ids && ids.length) ? ids : Object.keys(BIO_REFERENCIAS)
  return chaves.map((k, i) => {
    const r = BIO_REFERENCIAS[k]
    if (!r) return ''
    return `<li class="ac-ref">
      <span class="ac-ref-n">${i + 1}</span>
      <span class="ac-ref-txt">
        <strong>${esc(r.autores)}</strong>. ${esc(r.titulo)}. <em>${esc(r.fonte)}</em>.
        <a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.url)}</a>
      </span></li>`
  }).join('')
}

// Exposição global (páginas carregam via <script>, sem módulos ES).
if (typeof window !== 'undefined') {
  window.BIO_ESPECIES_REF = BIO_ESPECIES_REF
  window.BIO_TSD_FAIXAS = BIO_TSD_FAIXAS
  window.BIO_REFERENCIAS = BIO_REFERENCIAS
  window.BIO_CONTEXTO = BIO_CONTEXTO
  window.bioEstimativaSexoCoorte = bioEstimativaSexoCoorte
  window.bioReferenciasHTML = bioReferenciasHTML
}
