// ── SIGUC Biomonitor · figura "onde medir o filhote" ──────────
// Fonte única do desenho usado na Ajuda da biometria individual
// (verbetes "?" do formulário e passo do guia "Berçário"). SVG
// esquemático de um filhote genérico de Podocnemis, desenhado no
// próprio código: abre offline e não depende de imagem baixada.
//
// Carapaça = medidas por CIMA (A comprimento, B largura).
// Plastrão = medidas da BARRIGA (C comprimento, D largura).
// A largura do plastrão é medida própria (migration 366) — a figura
// mostra a da carapaça tracejada embaixo para lembrar que é maior.
//
// bioBiometriaFiguraHTML(destaque): destaque 'A'|'B'|'C'|'D' acende só
// aquela medida e apaga as demais; sem destaque, mostra as quatro.

const BIO_BIOMETRIA_MEDIDAS = {
  A: { nome: 'Comprimento da carapaça', vista: 'cima' },
  B: { nome: 'Largura da carapaça',     vista: 'cima' },
  C: { nome: 'Comprimento do plastrão', vista: 'barriga' },
  D: { nome: 'Largura do plastrão',     vista: 'barriga' },
}

const _BIO_FIG_COR = {
  pele: '#B9AE92', casco: '#E7DCC3', borda: '#A48A5A', plastrao: '#F4ECD8',
  cara: '#1A6B8C', plas: '#B45309',
}

// Cabeça, nadadeiras e cauda — iguais nas duas vistas.
function _bioFigCorpo(c) {
  return `
    <ellipse cx="100" cy="36" rx="15" ry="19" fill="${c.pele}"/>
    <path d="M44 78 C22 70 14 86 28 96 C38 102 46 98 52 92 Z" fill="${c.pele}"/>
    <path d="M156 78 C178 70 186 86 172 96 C162 102 154 98 148 92 Z" fill="${c.pele}"/>
    <path d="M52 172 C34 176 30 194 44 196 C54 197 60 188 62 180 Z" fill="${c.pele}"/>
    <path d="M148 172 C166 176 170 194 156 196 C146 197 140 188 138 180 Z" fill="${c.pele}"/>
    <path d="M94 200 L100 222 L106 200 Z" fill="${c.pele}"/>`
}

// Seta de medida (linha + duas pontas + selo com a letra).
function _bioFigMedida(letra, cor, x1, y1, x2, y2, sx, sy, apagada) {
  const vert = x1 === x2
  const pontas = vert
    ? `M${x1 - 7} ${y1 + 6} L${x1} ${y1 - 4} L${x1 + 7} ${y1 + 6} Z M${x2 - 7} ${y2 - 6} L${x2} ${y2 + 4} L${x2 + 7} ${y2 - 6} Z`
    : `M${x1 + 6} ${y1 - 7} L${x1 - 4} ${y1} L${x1 + 6} ${y1 + 7} Z M${x2 - 6} ${y2 - 7} L${x2 + 4} ${y2} L${x2 - 6} ${y2 + 7} Z`
  return `
    <g class="bio-fig-med${apagada ? ' apagada' : ''}" data-med="${letra}">
      <line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${cor}" stroke-width="3"/>
      <path d="${pontas}" fill="${cor}"/>
      <circle cx="${sx}" cy="${sy}" r="11" fill="${cor}"/>
      <text x="${sx}" y="${sy + 4.5}" text-anchor="middle" font-size="13" font-weight="700"
        fill="#fff" font-family="DM Sans,Arial,sans-serif">${letra}</text>
    </g>`
}

function _bioFigCima(dest) {
  const c = _BIO_FIG_COR
  const ap = l => !!dest && dest !== l
  return `
  <svg viewBox="0 0 200 250" role="img" aria-label="Filhote visto de cima: medidas A e B da carapaça">
    ${_bioFigCorpo(c)}
    <circle cx="93" cy="30" r="2" fill="#2B2B2B"/><circle cx="107" cy="30" r="2" fill="#2B2B2B"/>
    <ellipse cx="100" cy="126" rx="62" ry="80" fill="${c.casco}" stroke="${c.borda}" stroke-width="2"/>
    <ellipse cx="100" cy="126" rx="50" ry="67" fill="none" stroke="${c.borda}" stroke-width="1.2"/>
    <path d="M88 64 L112 64 L118 82 L112 98 L88 98 L82 82 Z M88 98 L112 98 L118 116 L112 134 L88 134 L82 116 Z M88 134 L112 134 L118 152 L112 170 L88 170 L82 152 Z M88 170 L112 170 L116 186 L100 192 L84 186 Z" fill="none" stroke="${c.borda}" stroke-width="1.2"/>
    <path d="M82 82 L52 88 M82 116 L50 120 M82 152 L52 156 M118 82 L148 88 M118 116 L150 120 M118 152 L148 156" stroke="${c.borda}" stroke-width="1.2"/>
    ${_bioFigMedida('A', c.cara, 100, 50, 100, 202, 126, 70, ap('A'))}
    ${_bioFigMedida('B', c.cara, 42, 126, 158, 126, 70, 144, ap('B'))}
  </svg>`
}

function _bioFigBarriga(dest) {
  const c = _BIO_FIG_COR
  const ap = l => !!dest && dest !== l
  // A largura da carapaça só aparece (tracejada) junto da largura do plastrão.
  const mostraFant = !dest || dest === 'D'
  return `
  <svg viewBox="0 0 200 250" role="img" aria-label="Filhote de barriga para cima: medidas C e D do plastrão">
    ${_bioFigCorpo(c)}
    <ellipse cx="100" cy="126" rx="62" ry="80" fill="${c.casco}" stroke="${c.borda}" stroke-width="2"/>
    <path d="M56 108 L40 104 M56 142 L40 148 M144 108 L160 104 M144 142 L160 148" stroke="${c.borda}" stroke-width="1.4"/>
    <path d="M100 60 C125 60 138 72 138 92 L144 108 L144 142 L136 158 C136 178 126 192 112 196 L100 188 L88 196 C74 192 64 178 64 158 L56 142 L56 108 L62 92 C62 72 75 60 100 60 Z" fill="${c.plastrao}" stroke="${c.borda}" stroke-width="2"/>
    <path d="M100 62 L100 188 M66 82 L134 82 M58 106 L142 106 M58 140 L142 140 M66 162 L134 162 M76 182 L124 182" stroke="${c.borda}" stroke-width="1"/>
    <g class="bio-fig-med${mostraFant ? '' : ' apagada'}" data-med="B-ref">
      <line x1="40" y1="214" x2="160" y2="214" stroke="${c.cara}" stroke-width="2" stroke-dasharray="4 4" opacity=".6"/>
      <text x="100" y="236" text-anchor="middle" font-size="10.5" fill="${c.cara}"
        font-family="DM Sans,Arial,sans-serif">larg. da carapaça (B)</text>
    </g>
    ${_bioFigMedida('C', c.plas, 100, 64, 100, 190, 122, 72, ap('C'))}
    ${_bioFigMedida('D', c.plas, 60, 124, 140, 124, 78, 152, ap('D'))}
  </svg>`
}

function bioBiometriaFiguraHTML(destaque) {
  const d = BIO_BIOMETRIA_MEDIDAS[destaque] ? destaque : null
  return `
    <div class="bio-fig-biometria">
      <figure><figcaption>Carapaça · cima</figcaption>${_bioFigCima(d)}</figure>
      <figure><figcaption>Plastrão · barriga</figcaption>${_bioFigBarriga(d)}</figure>
    </div>`
}

if (typeof window !== 'undefined') {
  window.bioBiometriaFiguraHTML = bioBiometriaFiguraHTML
  window.BIO_BIOMETRIA_MEDIDAS = BIO_BIOMETRIA_MEDIDAS
}
