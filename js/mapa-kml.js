// ── Mapa das UCs · leitura de KML/KMZ para camada enviada (prefixo kml) ──
// Fonte única da conversão KML → GeoJSON do modal "Nova camada"
// (pages/mapa.html, onNovaCamadaArquivo). A página só chama
// `kmlLerArquivo(file)`; o resultado segue o MESMO caminho do GeoJSON e do
// Shapefile (insert em camadas_mapa → _renderizarCamada).
//
// Conversão: @tmcw/togeojson (js/vendor/togeojson-7.1.2.umd.js). Por cima dela:
// - altitude descartada (o mapa é 2D; o KML vem lon,lat,alt);
// - sem reprojeção: KML é sempre WGS 84 (lon,lat);
// - atributos escondidos numa TABELA HTML da `description` (exportação do
//   Google Earth/ArcGIS/QGIS) viram atributos de verdade — sem isso o popup
//   mostraria HTML e o "colorir por" não teria campo. Isso também faz um CPF
//   escondido na tabela virar a coluna "CPF", que o gatilho da migration 367
//   tira do GeoJSON (a detecção de dado pessoal é pelo NOME da coluna);
// - o resto da descrição vira TEXTO puro: HTML de arquivo enviado nunca é
//   interpretado (DOMParser não executa script; só lemos textContent);
// - a pasta do KML (Folder) vira o atributo `pasta`;
// - estilo do KML (stroke, fill, icon…) é descartado: a cor é a escolhida no
//   modal, como no Shapefile (decisão do usuário);
// - imagem sobreposta (GroundOverlay), link para KML na internet
//   (NetworkLink) e Placemark sem geometria NÃO entram, e são contados para a
//   tela dizer o que ficou de fora.
// KMZ = zip com o KML dentro (JSZip, já carregado pela página). Todos os .kml
// do pacote entram — é assim que um doc.kml que aponta para outros KML
// INTERNOS do pacote (NetworkLink local) sai completo.

const KML_CAMPOS_ESTILO = new Set(['stroke', 'stroke-opacity', 'stroke-width', 'fill', 'fill-opacity',
  'icon', 'icon-color', 'icon-opacity', 'icon-scale', 'icon-heading', 'icon-offset', 'icon-offset-units',
  'label-color', 'label-opacity', 'label-scale', 'styleurl', 'stylehash', 'stylemaphash', 'coordinateproperties',
  'timespan', 'timestamp', 'visibility', '@geometry-type', 'href']);

// Tira a 3ª (e 4ª) coordenada de qualquer geometria, inclusive coleção.
function kmlSem3D(g) {
  if (!g) return g;
  if (g.type === 'GeometryCollection') return { type: g.type, geometries: (g.geometries || []).map(kmlSem3D) };
  const tira = c => (typeof c[0] === 'number' ? [c[0], c[1]] : c.map(tira));
  return { type: g.type, coordinates: tira(g.coordinates) };
}

function _kmlTexto(no) {
  return String(no?.textContent || '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
}

// HTML da descrição → { campos:{rótulo:valor}, texto }. Linha de tabela com
// exatamente 2 células (rótulo | valor) vira campo; o resto vira texto puro.
function kmlLerDescricao(html) {
  const s = String(html ?? '').trim();
  if (!s) return { campos: {}, texto: '' };
  if (!/[<&]/.test(s)) return { campos: {}, texto: s };
  const doc = new DOMParser().parseFromString(s, 'text/html');
  doc.querySelectorAll('script,style').forEach(e => e.remove());
  const campos = {};
  for (const tr of Array.from(doc.querySelectorAll('tr'))) {
    if (tr.querySelector('table')) continue; // linha que só embrulha outra tabela
    const cel = Array.from(tr.children).filter(e => /^(td|th)$/i.test(e.tagName));
    if (cel.length !== 2) continue;
    const k = _kmlTexto(cel[0]).replace(/:$/, '');
    if (!k) continue;
    const v = _kmlTexto(cel[1]);
    if (!(k in campos)) campos[k] = v === '<Nulo>' || v === '<Null>' ? '' : v;
    tr.remove();
  }
  // Tabela que rendeu atributos: o que sobrou nela é cabeçalho (nome da
  // camada, no ArcGIS) — sai junto. Sem atributos, a tabela vira texto.
  if (Object.keys(campos).length) doc.querySelectorAll('table').forEach(t => t.remove());
  doc.querySelectorAll('br').forEach(b => b.replaceWith('\n'));
  doc.querySelectorAll('p,div,li,tr,h1,h2,h3,h4').forEach(e => e.append('\n'));
  const texto = String(doc.body?.textContent || '').replace(/ /g, ' ')
    .split('\n').map(l => l.replace(/[ \t]+/g, ' ').trim()).filter(Boolean).join('\n');
  return { campos, texto };
}

function _kmlPropriedades(p, pasta) {
  const out = {};
  let desc = null;
  for (const [k, v] of Object.entries(p || {})) {
    if (KML_CAMPOS_ESTILO.has(k.toLowerCase())) continue;
    if (k === 'description') { desc = v && typeof v === 'object' ? v.value : v; continue; }
    if (v !== null && typeof v === 'object') continue; // nenhum objeto aninhado vai para o banco
    out[k] = v;
  }
  if (desc != null) {
    const { campos, texto } = kmlLerDescricao(desc);
    for (const [k, v] of Object.entries(campos)) {
      if (!(k in out)) out[k] = v;
      else if (String(out[k]) !== v) out[k + ' (descrição)'] = v;
    }
    if (texto) out.descricao = texto;
  }
  if (pasta) out.pasta = pasta;
  return out;
}

function _kmlNovoResultado() {
  return { features: [], ignorados: { sem_geometria: 0, imagem: 0, link: 0 }, nomeDocumento: '' };
}

// Converte o TEXTO de um KML, acumulando em `res`.
function kmlConverterTexto(texto, res = _kmlNovoResultado()) {
  if (typeof toGeoJSON === 'undefined' || typeof toGeoJSON.kmlWithFolders !== 'function') {
    throw new Error('conversor de KML não carregado');
  }
  const xml = new DOMParser().parseFromString(String(texto).replace(/^﻿/, ''), 'text/xml');
  if (xml.getElementsByTagName('parsererror').length || !/kml/i.test(xml.documentElement?.nodeName || '')) {
    throw new Error('arquivo KML inválido');
  }
  if (!res.nomeDocumento) {
    const docNome = Array.from(xml.getElementsByTagName('Document')[0]?.children || []).find(e => e.localName === 'name');
    res.nomeDocumento = _kmlTexto(docNome);
  }
  // NetworkLink para fora do pacote (http/https) não é baixado.
  for (const nl of Array.from(xml.getElementsByTagName('NetworkLink'))) {
    const href = _kmlTexto(nl.getElementsByTagName('href')[0]);
    if (!href || /^[a-z]+:\/\//i.test(href)) res.ignorados.link++;
  }
  const arvore = toGeoJSON.kmlWithFolders(xml);
  const andar = (filhos, caminho) => {
    for (const n of filhos || []) {
      if (n.type === 'folder') {
        const nome = String(n.meta?.name || '').trim();
        andar(n.children, nome ? [...caminho, nome] : caminho);
        continue;
      }
      const tipo = n.properties?.['@geometry-type'];
      if (tipo === 'groundoverlay') { res.ignorados.imagem++; continue; }
      if (tipo === 'networklink') continue; // contado acima, pelo href
      if (!n.geometry) { res.ignorados.sem_geometria++; continue; }
      res.features.push({ type: 'Feature', geometry: kmlSem3D(n.geometry), properties: _kmlPropriedades(n.properties, caminho.join(' / ')) });
    }
  };
  andar(arvore.children, []);
  return res;
}

async function kmlConverterKmz(buffer) {
  if (typeof JSZip === 'undefined') throw new Error('leitor de .zip não carregado');
  const zip = await JSZip.loadAsync(buffer);
  const kmls = Object.keys(zip.files).filter(f => !zip.files[f].dir && /\.kml$/i.test(f))
    // doc.kml (o principal) primeiro, depois o resto por profundidade
    .sort((a, b) => (/(^|\/)doc\.kml$/i.test(b) - /(^|\/)doc\.kml$/i.test(a)) || (a.split('/').length - b.split('/').length));
  if (!kmls.length) throw new Error('nenhum .kml dentro do .kmz');
  const res = _kmlNovoResultado();
  for (const f of kmls) kmlConverterTexto(await zip.files[f].async('string'), res);
  return res;
}

// Ponto de entrada da página. Devolve { geojson, ignorados, nomeDocumento }.
async function kmlLerArquivo(file) {
  const nome = String(file?.name || '').toLowerCase();
  const res = nome.endsWith('.kmz')
    ? await kmlConverterKmz(await file.arrayBuffer())
    : kmlConverterTexto(await file.text());
  return { geojson: { type: 'FeatureCollection', features: res.features }, ignorados: res.ignorados, nomeDocumento: res.nomeDocumento };
}

// Texto curto do que ficou de fora, para a linha de status do modal.
function kmlTextoIgnorados(ig) {
  const p = [];
  if (ig?.imagem) p.push(`${ig.imagem} imagem${ig.imagem > 1 ? 'ns' : ''} sobreposta${ig.imagem > 1 ? 's' : ''}`);
  if (ig?.link) p.push(`${ig.link} link${ig.link > 1 ? 's' : ''} para KML externo`);
  if (ig?.sem_geometria) p.push(`${ig.sem_geometria} marcador${ig.sem_geometria > 1 ? 'es' : ''} sem geometria`);
  return p.length ? `não importado: ${p.join(', ')}` : '';
}
