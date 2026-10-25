// SIGUC-AC · MapBiomas por ano — tile XYZ desenhado a partir do COG oficial
//
// A MapBiomas não publica tiles prontos: o bucket público guarda, por ano,
// um Cloud Optimized GeoTIFF do Brasil inteiro (Coleção 11, 1985–2025,
// EPSG:4326, 30 m, uint8 = código da classe, BigTIFF, blocos 512×512 com
// deflate + predictor 2 e versões reduzidas até ~300 px). Este módulo lê SÓ
// os blocos que caem no tile pedido (requisição por faixa de bytes) e devolve
// um PNG de paleta com as cores oficiais. Nenhuma dependência: zlib do Node.
//
// O prefixo `_` faz a Vercel NÃO transformar este arquivo em função — ele é
// carregado por api/geo.js (svc=tile), que já existia e apontava para tiles
// da Coleção 8 que NÃO existem no bucket (404 em todo pedido, tile vazio em
// silêncio — achado ao planejar a comparação de imagens).
//
// Legenda (códigos e cores) em data/mapbiomas-col11-legenda.json — a MESMA
// que a tela usa para desenhar a legenda; nunca uma segunda tabela de cores.

const zlib = require('zlib');
const LEGENDA = require('../data/mapbiomas-col11-legenda.json');

const TILE_PX = 256;
const CABECALHO_BYTES = 131072;          // as 10 IFDs do arquivo cabem aqui (conferido)

// ── leitura por faixa ───────────────────────────────────────────────
// `ler(inicio, tamanho)` → Buffer. Injetável (o teste usa um TIFF em memória).
function leitorHttp(url, fetchFn = fetch) {
  return async (inicio, tamanho) => {
    const r = await fetchFn(url, {
      headers: { Range: `bytes=${inicio}-${inicio + tamanho - 1}`, 'User-Agent': 'SIGUC-AC/1.0 (SEMA-AC)' },
      signal: AbortSignal.timeout(15000),
    });
    if (r.status !== 206 && r.status !== 200) throw new Error(`cog-http-${r.status}`);
    const b = Buffer.from(await r.arrayBuffer());
    // servidor que ignorou o Range devolve o arquivo todo: recorta
    return r.status === 200 && b.length > tamanho ? b.subarray(inicio, inicio + tamanho) : b;
  };
}

const TAM_TIPO = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8, 16: 8, 17: 8, 18: 8 };

function lerValor(buf, pos, tipo) {
  switch (tipo) {
    case 1: case 7: return buf.readUInt8(pos);
    case 3: return buf.readUInt16LE(pos);
    case 4: return buf.readUInt32LE(pos);
    case 16: return Number(buf.readBigUInt64LE(pos));
    case 12: return buf.readDoubleLE(pos);
    default: throw new Error(`tiff-tipo-${tipo}`);
  }
}

// ── cabeçalho: IFDs (nível 0 + versões reduzidas) ───────────────────
async function lerCabecalho(ler) {
  let cab = await ler(0, CABECALHO_BYTES);
  if (cab.toString('latin1', 0, 2) !== 'II') throw new Error('tiff-nao-little-endian');
  const big = cab.readUInt16LE(2) === 43;
  if (!big && cab.readUInt16LE(2) !== 42) throw new Error('tiff-invalido');
  const garantir = async (fim) => { if (fim > cab.length) cab = Buffer.concat([cab, await ler(cab.length, fim - cab.length + 65536)]); };

  let off = big ? Number(cab.readBigUInt64LE(8)) : cab.readUInt32LE(4);
  const niveis = [];
  while (off && niveis.length < 32) {
    await garantir(off + 16);
    const n = big ? Number(cab.readBigUInt64LE(off)) : cab.readUInt16LE(off);
    const tamEnt = big ? 20 : 12, ini = off + (big ? 8 : 2);
    await garantir(ini + n * tamEnt + 8);
    const tags = {};
    for (let i = 0; i < n; i++) {
      const p = ini + i * tamEnt;
      const tag = cab.readUInt16LE(p), tipo = cab.readUInt16LE(p + 2);
      const cont = big ? Number(cab.readBigUInt64LE(p + 4)) : cab.readUInt32LE(p + 4);
      const posValor = p + (big ? 12 : 8);
      const tam = (TAM_TIPO[tipo] || 1) * cont;
      const cabe = tam <= (big ? 8 : 4);
      const ondeDados = cabe ? posValor : (big ? Number(cab.readBigUInt64LE(posValor)) : cab.readUInt32LE(posValor));
      tags[tag] = { tipo, cont, ondeDados, cabe };
    }
    const um = async (t) => { const x = tags[t]; if (!x) return undefined; await garantir(x.ondeDados + (TAM_TIPO[x.tipo] || 1)); return lerValor(cab, x.ondeDados, x.tipo); };
    const varios = async (t) => { const x = tags[t]; if (!x) return undefined; const s = TAM_TIPO[x.tipo]; await garantir(x.ondeDados + s * x.cont); return Array.from({ length: x.cont }, (_, k) => lerValor(cab, x.ondeDados + k * s, x.tipo)); };
    const nivel = {
      largura: await um(256), altura: await um(257),
      blocoL: await um(322), blocoA: await um(323),
      compressao: await um(259), preditor: (await um(317)) || 1,
      offsets: tags[324], contagens: tags[325],
    };
    if (!nivel.blocoL || !nivel.offsets) throw new Error('tiff-sem-blocos');
    if (nivel.compressao !== 8 && nivel.compressao !== 32946 && nivel.compressao !== 1) throw new Error(`tiff-compressao-${nivel.compressao}`);
    if (niveis.length === 0) {
      const escala = await varios(33550), ponto = await varios(33922);
      if (!escala || !ponto) throw new Error('tiff-sem-georreferencia');
      nivel.geo = { x0: ponto[3] - ponto[0] * escala[0], y0: ponto[4] + ponto[1] * escala[1], dx: escala[0], dy: escala[1] };
    }
    niveis.push(nivel);
    const posProx = ini + n * tamEnt;
    off = big ? Number(cab.readBigUInt64LE(posProx)) : cab.readUInt32LE(posProx);
  }
  // tamanho do pixel de cada versão reduzida, proporcional ao nível 0
  const g = niveis[0].geo;
  for (const nv of niveis) { nv.dx = g.dx * niveis[0].largura / nv.largura; nv.dy = g.dy * niveis[0].altura / nv.altura; }
  return { niveis, geo: g };
}

// ── bloco: offset + tamanho + descompressão ─────────────────────────
async function lerBloco(ler, nivel, idx, cacheIdx) {
  const chave = `${nivel.largura}:${idx}`;
  let pos = cacheIdx && cacheIdx.get(chave);
  if (!pos) {
    const o = nivel.offsets, c = nivel.contagens;
    const so = TAM_TIPO[o.tipo], sc = TAM_TIPO[c.tipo];
    const [bo, bc] = await Promise.all([ler(o.ondeDados + idx * so, so), ler(c.ondeDados + idx * sc, sc)]);
    pos = { inicio: lerValor(bo, 0, o.tipo), tamanho: lerValor(bc, 0, c.tipo) };
    if (cacheIdx) cacheIdx.set(chave, pos);
  }
  const n = nivel.blocoL * nivel.blocoA;
  if (!pos.tamanho) return new Uint8Array(n);              // bloco vazio = sem classe
  const bruto = await ler(pos.inicio, pos.tamanho);
  const px = nivel.compressao === 1 ? bruto : zlib.inflateSync(bruto);
  const out = new Uint8Array(px.buffer, px.byteOffset, Math.min(px.length, n));
  if (nivel.preditor === 2) {                               // diferença horizontal, 8 bits
    for (let l = 0; l < nivel.blocoA; l++) {
      const b = l * nivel.blocoL;
      for (let i = 1; i < nivel.blocoL; i++) out[b + i] = (out[b + i] + out[b + i - 1]) & 255;
    }
  }
  return out;
}

// Nível mais grosso cujo pixel ainda é ≤ o pixel do tile pedido (nunca
// "inventa" detalhe; nunca lê mais blocos que o necessário).
function escolherNivel(niveis, grausPorPx) {
  let k = 0;
  for (let i = 1; i < niveis.length; i++) if (niveis[i].dx <= grausPorPx) k = i;
  return k;
}

// lat de cada linha de pixel de um tile Web Mercator (centro do pixel)
function latDoPixel(z, y, py) {
  const n = Math.PI - 2 * Math.PI * (y + (py + 0.5) / TILE_PX) / 2 ** z;
  return 180 / Math.PI * Math.atan(Math.sinh(n));
}

// ── desenho: z/x/y → matriz de códigos 256×256 ──────────────────────
async function codigosDoTile(ler, cab, z, x, y, cacheIdx) {
  const { niveis, geo } = cab;
  const lonOeste = x / 2 ** z * 360 - 180;
  const grausPorPx = 360 / (TILE_PX * 2 ** z);
  const nivel = niveis[escolherNivel(niveis, grausPorPx)];
  const cols = new Int32Array(TILE_PX), linhas = new Int32Array(TILE_PX);
  for (let p = 0; p < TILE_PX; p++) {
    cols[p] = Math.floor((lonOeste + (p + 0.5) * grausPorPx - geo.x0) / nivel.dx);
    linhas[p] = Math.floor((geo.y0 - latDoPixel(z, y, p)) / nivel.dy);
  }
  const nbx = Math.ceil(nivel.largura / nivel.blocoL), nby = Math.ceil(nivel.altura / nivel.blocoA);
  const precisa = new Map();
  for (let py = 0; py < TILE_PX; py++) {
    const l = linhas[py]; if (l < 0 || l >= nivel.altura) continue;
    for (let px = 0; px < TILE_PX; px++) {
      const c = cols[px]; if (c < 0 || c >= nivel.largura) continue;
      const idx = Math.floor(l / nivel.blocoA) * nbx + Math.floor(c / nivel.blocoL);
      if (!precisa.has(idx)) precisa.set(idx, null);
    }
  }
  if (precisa.size > 16) throw new Error('cog-blocos-demais');   // proteção: nunca deveria passar de 4
  await Promise.all([...precisa.keys()].map(async idx => { precisa.set(idx, await lerBloco(ler, nivel, idx, cacheIdx)); }));
  const saida = new Uint8Array(TILE_PX * TILE_PX);
  for (let py = 0; py < TILE_PX; py++) {
    const l = linhas[py]; if (l < 0 || l >= nivel.altura) continue;
    const by = Math.floor(l / nivel.blocoA), ly = l - by * nivel.blocoA;
    for (let px = 0; px < TILE_PX; px++) {
      const c = cols[px]; if (c < 0 || c >= nivel.largura) continue;
      const bx = Math.floor(c / nivel.blocoL);
      const bloco = precisa.get(by * nbx + bx);
      saida[py * TILE_PX + px] = bloco[ly * nivel.blocoL + (c - bx * nivel.blocoL)];
    }
  }
  return { codigos: saida, vazio: precisa.size === 0, nby };
}

// ── PNG de paleta (tipo 3) com transparência no código 0 ────────────
const TABELA_CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(buf) { let c = 0xFFFFFFFF; for (let i = 0; i < buf.length; i++) c = TABELA_CRC[(c ^ buf[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
function bloco(tipo, dados) {
  const t = Buffer.from(tipo, 'latin1'), len = Buffer.alloc(4), crc = Buffer.alloc(4);
  len.writeUInt32BE(dados.length); crc.writeUInt32BE(crc32(Buffer.concat([t, dados])));
  return Buffer.concat([len, t, dados, crc]);
}

// paleta: índice 0 = transparente; código → índice
const PALETA = (() => {
  const idx = new Uint8Array(256);           // código → índice da paleta (0 = vazio)
  const cores = [[0, 0, 0]];
  for (const c of LEGENDA.classes) {
    const h = c.cor.replace('#', '');
    idx[c.valor] = cores.length;
    cores.push([parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]);
  }
  return { idx, cores };
})();

function pngDosCodigos(codigos) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(TILE_PX, 0); ihdr.writeUInt32BE(TILE_PX, 4);
  ihdr[8] = 8; ihdr[9] = 3; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const plte = Buffer.from(PALETA.cores.flat());
  const trns = Buffer.from(PALETA.cores.map((_, i) => (i === 0 ? 0 : 255)));
  const linhas = Buffer.alloc(TILE_PX * (TILE_PX + 1));
  for (let y = 0; y < TILE_PX; y++) {
    linhas[y * (TILE_PX + 1)] = 0;
    for (let x = 0; x < TILE_PX; x++) linhas[y * (TILE_PX + 1) + 1 + x] = PALETA.idx[codigos[y * TILE_PX + x]];
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    bloco('IHDR', ihdr), bloco('PLTE', plte), bloco('tRNS', trns),
    bloco('IDAT', zlib.deflateSync(linhas, { level: 6 })), bloco('IEND', Buffer.alloc(0)),
  ]);
}

// ── cache por instância quente da função (cabeçalho e índice de blocos) ─
const _cabecalhos = new Map();
const _indices = new Map();

function urlDoAno(ano) { return LEGENDA.url_ano.replace('{ano}', String(ano)); }
function anoValido(ano) { return Number.isInteger(ano) && ano >= LEGENDA.ano_min && ano <= LEGENDA.ano_max; }

async function mbTilePng(ano, z, x, y, { ler } = {}) {
  const leitor = ler || leitorHttp(urlDoAno(ano));
  let cab = ler ? null : _cabecalhos.get(ano);
  if (!cab) { cab = await lerCabecalho(leitor); if (!ler) _cabecalhos.set(ano, cab); }
  let cacheIdx = ler ? new Map() : _indices.get(ano);
  if (!cacheIdx) { cacheIdx = new Map(); _indices.set(ano, cacheIdx); }
  if (cacheIdx.size > 50000) cacheIdx.clear();
  const { codigos } = await codigosDoTile(leitor, cab, z, x, y, cacheIdx);
  return pngDosCodigos(codigos);
}

module.exports = { mbTilePng, anoValido, urlDoAno, lerCabecalho, codigosDoTile, escolherNivel, pngDosCodigos, LEGENDA };
