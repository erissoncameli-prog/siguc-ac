// ── MapBiomas por ano: leitor do COG e desenho do tile (api/_mapbiomas-cog.js) ──
// Executar: npx playwright test tests/mapbiomas-cog.test.js   (sem navegador, sem rede)
//
// Monta um BigTIFF pequeno EM MEMÓRIA, no mesmo formato do COG oficial da
// Coleção 11 (EPSG:4326, uint8, blocos 512×512, deflate + predictor 2, uma
// versão reduzida), com padrão conhecido:
//   coluna < 512 → floresta (3) em cima / água (33) embaixo; coluna ≥ 512 → pastagem (15).
// Trava: escolha da versão reduzida pelo zoom, posição geográfica de cada pixel
// (Web Mercator → lat/lon → linha/coluna), leitura SÓ dos blocos necessários,
// e PNG de paleta válido com a cor oficial da classe e o 0 transparente.

const { test, expect } = require('@playwright/test');
const zlib = require('zlib');
const cog = require('../api/_mapbiomas-cog.js');

const X0 = -70, Y0 = -9, DX = 0.001;      // 1024 px = 1,024° de lado

function codigo(lin, col, escala) {
  const l = lin * escala, c = col * escala;
  if (c >= 512) return 15;
  return l < 512 ? 3 : 33;
}

// bloco 512×512 com predictor 2 (diferença horizontal) + deflate
function blocoComprimido(nivelEscala, bx, by) {
  const raw = Buffer.alloc(512 * 512);
  for (let y = 0; y < 512; y++) {
    let ant = 0;
    for (let x = 0; x < 512; x++) {
      const v = codigo(by * 512 + y, bx * 512 + x, nivelEscala);
      raw[y * 512 + x] = (v - ant) & 255; ant = v;
    }
  }
  return zlib.deflateSync(raw);
}

function bigtiff() {
  const niveis = [{ lado: 1024, escala: 1 }, { lado: 512, escala: 2 }];
  const partes = []; let pos = 16;
  const empurra = b => { const p = pos; partes.push(b); pos += b.length; return p; };
  // dados dos blocos primeiro
  for (const nv of niveis) {
    const n = nv.lado / 512; nv.blocos = [];
    for (let by = 0; by < n; by++) for (let bx = 0; bx < n; bx++) {
      const b = blocoComprimido(nv.escala, bx, by); nv.blocos.push({ off: empurra(b), len: b.length });
    }
  }
  // arrays externos
  for (const nv of niveis) {
    const o = Buffer.alloc(8 * nv.blocos.length), c = Buffer.alloc(4 * nv.blocos.length);
    nv.blocos.forEach((b, i) => { o.writeBigUInt64LE(BigInt(b.off), 8 * i); c.writeUInt32LE(b.len, 4 * i); });
    nv.posO = empurra(o); nv.posC = empurra(c);
  }
  const escala = Buffer.alloc(24); escala.writeDoubleLE(DX, 0); escala.writeDoubleLE(DX, 8);
  const ponto = Buffer.alloc(48); ponto.writeDoubleLE(X0, 24); ponto.writeDoubleLE(Y0, 32);
  const posEsc = empurra(escala), posPto = empurra(ponto);
  // IFDs
  const ifdPos = [];
  const ifds = niveis.map((nv, k) => {
    const ent = [[256, 4, 1, nv.lado], [257, 4, 1, nv.lado], [258, 3, 1, 8], [259, 3, 1, 8], [262, 3, 1, 1],
      [277, 3, 1, 1], [317, 3, 1, 2], [322, 3, 1, 512], [323, 3, 1, 512],
      // com um bloco só, o TIFF guarda o VALOR na própria entrada (cabe em 8 bytes)
      [324, 16, nv.blocos.length, nv.blocos.length === 1 ? nv.blocos[0].off : nv.posO],
      [325, 4, nv.blocos.length, nv.blocos.length === 1 ? nv.blocos[0].len : nv.posC]];
    if (k === 0) ent.push([33550, 12, 3, posEsc], [33922, 12, 6, posPto]);
    if (k > 0) ent.unshift([254, 4, 1, 1]);
    ent.sort((a, b) => a[0] - b[0]);
    const buf = Buffer.alloc(8 + ent.length * 20 + 8);
    buf.writeBigUInt64LE(BigInt(ent.length), 0);
    ent.forEach(([t, ty, c, v], i) => {
      const p = 8 + i * 20; buf.writeUInt16LE(t, p); buf.writeUInt16LE(ty, p + 2); buf.writeBigUInt64LE(BigInt(c), p + 4);
      const tam = ({ 3: 2, 4: 4, 12: 8, 16: 8 })[ty] * c;
      if (tam <= 8 && ty === 3) buf.writeUInt16LE(v, p + 12);
      else if (tam <= 8 && ty === 4) buf.writeUInt32LE(v, p + 12);
      else buf.writeBigUInt64LE(BigInt(v), p + 12);
    });
    return buf;
  });
  ifds.forEach(b => ifdPos.push(empurra(b)));
  ifds.forEach((b, i) => {                       // encadeia
    const prox = i + 1 < ifds.length ? ifdPos[i + 1] : 0;
    b.writeBigUInt64LE(BigInt(prox), b.length - 8);
  });
  const cab = Buffer.alloc(16);
  cab.write('II', 0, 'latin1'); cab.writeUInt16LE(43, 2); cab.writeUInt16LE(8, 4); cab.writeUInt16LE(0, 6);
  cab.writeBigUInt64LE(BigInt(ifdPos[0]), 8);
  return Buffer.concat([cab, ...partes]);
}

const ARQ = bigtiff();
function leitor() {
  const chamadas = [];
  const ler = async (ini, tam) => { chamadas.push([ini, tam]); return ARQ.subarray(ini, Math.min(ARQ.length, ini + tam)); };
  return { ler, chamadas };
}

function tileDe(lon, lat, z) {
  const n = 2 ** z, r = lat * Math.PI / 180;
  const fx = (lon + 180) / 360 * n, fy = (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * n;
  return { x: Math.floor(fx), y: Math.floor(fy), px: Math.floor((fx % 1) * 256), py: Math.floor((fy % 1) * 256) };
}

test('cabeçalho: dois níveis, georreferência do nível 0 e pixel do reduzido proporcional', async () => {
  const { ler } = leitor();
  const cab = await cog.lerCabecalho(ler);
  expect(cab.niveis).toHaveLength(2);
  expect(cab.geo).toEqual({ x0: X0, y0: Y0, dx: DX, dy: DX });
  expect(cab.niveis[1].dx).toBeCloseTo(0.002, 9);
  // zoom 10 → 0,00137°/px: só o nível 0 (0,001) é ≤; zoom 8 → 0,0055: usa o reduzido
  expect(cog.escolherNivel(cab.niveis, 360 / (256 * 2 ** 10))).toBe(0);
  expect(cog.escolherNivel(cab.niveis, 360 / (256 * 2 ** 8))).toBe(1);
});

test('cada pixel do tile cai na classe certa do lugar certo, nos dois níveis', async () => {
  for (const z of [8, 10, 11]) {
    const { ler } = leitor();
    const cab = await cog.lerCabecalho(ler);
    // floresta: coluna ~200 (lon -69.8), linha ~200 (lat -9.2)
    for (const [lon, lat, esperado] of [[-69.8, -9.2, 3], [-69.8, -9.8, 33], [-69.2, -9.3, 15], [-71, -9.5, 0], [-69.5, -8.5, 0]]) {
      const t = tileDe(lon, lat, z);
      const { codigos } = await cog.codigosDoTile(ler, cab, z, t.x, t.y, new Map());
      expect(codigos[t.py * 256 + t.px], `z${z} ${lon},${lat}`).toBe(esperado);
    }
  }
});

test('lê só os blocos que o tile toca (não o arquivo)', async () => {
  const { ler, chamadas } = leitor();
  const cab = await cog.lerCabecalho(ler);
  const n0 = chamadas.length;
  const t = tileDe(-69.8, -9.2, 11);           // tile pequeno, dentro do bloco (0,0) do nível 0
  await cog.codigosDoTile(ler, cab, 11, t.x, t.y, new Map());
  const dados = chamadas.slice(n0).filter(([, tam]) => tam > 16);
  expect(dados.length).toBeLessThanOrEqual(2);
  const lidos = chamadas.slice(n0).reduce((s, [, tam]) => s + tam, 0);
  expect(lidos).toBeLessThan(ARQ.length / 3);
});

test('PNG de paleta: cor oficial da classe e código 0 transparente', async () => {
  const codigos = new Uint8Array(256 * 256);
  codigos[0] = 3; codigos[1] = 15; codigos[2] = 0;
  const png = cog.pngDosCodigos(codigos);
  expect(png.subarray(1, 4).toString('latin1')).toBe('PNG');
  // percorre os blocos
  let p = 8; const blocos = {};
  while (p < png.length) {
    const len = png.readUInt32BE(p), tipo = png.toString('latin1', p + 4, p + 8);
    blocos[tipo] = (blocos[tipo] || []).concat([png.subarray(p + 8, p + 8 + len)]); p += 12 + len;
  }
  expect(blocos.IHDR[0][9]).toBe(3);                           // tipo paleta
  const plte = blocos.PLTE[0], trns = blocos.tRNS[0];
  const linhas = zlib.inflateSync(Buffer.concat(blocos.IDAT));
  const idx = i => linhas[1 + i];                              // 1ª linha, após o byte de filtro
  const cor = i => '#' + [...plte.subarray(3 * i, 3 * i + 3)].map(v => v.toString(16).padStart(2, '0')).join('').toUpperCase();
  const leg = c => cog.LEGENDA.classes.find(x => x.valor === c).cor;
  expect(cor(idx(0))).toBe(leg(3));
  expect(cor(idx(1))).toBe(leg(15));
  expect(trns[idx(2)]).toBe(0);
  expect(trns[idx(0)]).toBe(255);
});

test('legenda única: anos 1985 → último publicado e URL por ano', () => {
  expect(cog.LEGENDA.ano_min).toBe(1985);
  expect(cog.LEGENDA.ano_max).toBeGreaterThanOrEqual(2025);
  expect(cog.anoValido(1984)).toBe(false);
  expect(cog.anoValido(cog.LEGENDA.ano_max)).toBe(true);
  expect(cog.urlDoAno(2000)).toMatch(/classification_2000\.tif$/);
  expect(new Set(cog.LEGENDA.classes.map(c => c.valor)).size).toBe(cog.LEGENDA.classes.length);
});
