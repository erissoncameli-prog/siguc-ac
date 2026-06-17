/**
 * Gera a apresentação de treinamento do App Brigadas SIGUC-AC.
 * Uso: node scripts/gerar-pptx.js
 */

const pptxgen = require('pptxgenjs');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const SHOTS = path.join(ROOT, 'tmp', 'slides-screenshots');
const OUT = path.join(ROOT, 'treinamento-app-brigadas-2026.pptx');

// ─── Paleta ───────────────────────────────────────────────────────────────
const C = {
  darkBg:  '0A1A0F',
  darkBg2: '1A3A20',
  darkBg3: '0F2518',
  green:   '52B788',
  greenDk: '2D7A56',
  gold:    'C9A84C',
  goldLt:  'F0CB6A',
  txt:     'F4EFE6',
  combate: 'EF5B3C',
  monitor: '3B82C4',
  bg:      'EFF7F2',
  white:   'FFFFFF',
  muted:   '6B7280',
  mutedDk: '4B5563',
  border:  'D1FAE5',
  cardDk:  '132B1A',
  phone:   '0D1F12',
};

// ─── Dimensões ────────────────────────────────────────────────────────────
const W = 10, H = 5.625;
const M = 0.4;  // margin

// Screenshot do celular: 390×844px → ratio = 2.164
const PW = 2.0, PH = PW * (844 / 390); // 4.33"
const PX = 7.55, PY = (H - PH) / 2;   // centered vertically

// Área de conteúdo (coluna esquerda)
const CW = PX - M - 0.2;  // ~6.95"

// ─── Helpers ──────────────────────────────────────────────────────────────
function img(name) {
  return path.join(SHOTS, `${name}.png`);
}

function addPhone(slide, imgName) {
  const frameX = PX - 0.1, frameY = PY - 0.1;
  const frameW = PW + 0.2, frameH = PH + 0.2;
  // Sombra (shape atrás, levemente maior e deslocada)
  slide.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x: frameX + 0.06, y: frameY + 0.1,
    w: frameW, h: frameH,
    fill: { color: '000000', transparency: 70 },
    line: { color: '000000', width: 0 },
    rectRadius: 0.15,
  });
  // Frame do celular
  slide.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x: frameX, y: frameY, w: frameW, h: frameH,
    fill: { color: C.phone },
    line: { color: '1F3025', width: 2 },
    rectRadius: 0.15,
  });
  // Notch/câmera frontal
  slide.addShape(pres.shapes.OVAL, {
    x: PX + PW / 2 - 0.08, y: PY + 0.06, w: 0.16, h: 0.06,
    fill: { color: '050D07' }, line: { color: '050D07', width: 0 },
  });
  // Screenshot
  slide.addImage({ path: img(imgName), x: PX, y: PY, w: PW, h: PH });
}

function addHeader(slide, title) {
  slide.background = { color: C.bg };
  // Barra superior escura
  slide.addShape(pres.shapes.RECTANGLE, {
    x: 0, y: 0, w: W, h: 0.7,
    fill: { color: C.darkBg }, line: { color: C.darkBg, width: 0 },
  });
  // Linha dourada fina abaixo do header
  slide.addShape(pres.shapes.RECTANGLE, {
    x: 0, y: 0.7, w: W, h: 0.04,
    fill: { color: C.gold }, line: { color: C.gold, width: 0 },
  });
  // Título no header
  slide.addText(title, {
    x: M, y: 0, w: 6.5, h: 0.7,
    fontSize: 24, bold: true, color: C.txt,
    fontFace: 'Georgia', valign: 'middle', margin: 0,
  });
  // Número pequeno SIGUC no canto direito
  slide.addText('SIGUC-AC · SEMA', {
    x: 7.5, y: 0, w: 2.2, h: 0.7,
    fontSize: 9, color: C.green, fontFace: 'Calibri',
    valign: 'middle', align: 'right', margin: 0,
  });
}

function card(slide, x, y, w, h, opts = {}) {
  slide.addShape(pres.shapes.RECTANGLE, {
    x, y, w, h,
    fill: { color: opts.fill || C.white },
    line: { color: opts.border || C.border, width: opts.lineW || 1 },
    shadow: opts.shadow || { type: 'outer', color: '000000', blur: 4, offset: 2, angle: 135, opacity: 0.07 },
  });
}

function dot(slide, x, y, r, color) {
  slide.addShape(pres.shapes.OVAL, {
    x: x - r, y: y - r, w: r * 2, h: r * 2,
    fill: { color }, line: { color, width: 0 },
  });
}

// ─── Início ───────────────────────────────────────────────────────────────
const pres = new pptxgen();
pres.layout = 'LAYOUT_16x9';
pres.title  = 'App Brigadas — Treinamento de Campo';
pres.author = 'DIMA · SEMA-AC';

// ══════════════════════════════════════════════════════════════════════════
// SLIDE 1 — CAPA
// ══════════════════════════════════════════════════════════════════════════
{
  const s = pres.addSlide();
  s.background = { color: C.darkBg };

  // Fundo dividido (parte direita ligeiramente diferente)
  s.addShape(pres.shapes.RECTANGLE, {
    x: 5.5, y: 0, w: 4.5, h: H,
    fill: { color: C.darkBg2 }, line: { color: C.darkBg2, width: 0 },
  });

  // Linha de destaque vertical dourada
  s.addShape(pres.shapes.RECTANGLE, {
    x: 5.45, y: 0.4, w: 0.05, h: H - 0.8,
    fill: { color: C.gold }, line: { color: C.gold, width: 0 },
  });

  // Logo/badge superior
  s.addText('SEMA-AC  ·  DIMA', {
    x: M, y: 0.3, w: 4.8, h: 0.35,
    fontSize: 11, color: C.green, fontFace: 'Calibri', margin: 0,
    charSpacing: 3,
  });

  // Título principal
  s.addText('App Brigadas', {
    x: M, y: 0.75, w: 5.0, h: 1.6,
    fontSize: 58, bold: true, color: C.txt, fontFace: 'Georgia', margin: 0,
  });

  // Subtítulo
  s.addText('Treinamento de Campo', {
    x: M, y: 2.4, w: 5.0, h: 0.65,
    fontSize: 22, color: C.green, fontFace: 'Calibri', margin: 0,
  });

  // Traço dourado
  s.addShape(pres.shapes.RECTANGLE, {
    x: M, y: 3.15, w: 1.2, h: 0.04,
    fill: { color: C.gold }, line: { color: C.gold, width: 0 },
  });

  // Info
  s.addText('Junho 2026', {
    x: M, y: 3.3, w: 4.8, h: 0.4,
    fontSize: 14, color: C.muted, fontFace: 'Calibri', margin: 0,
  });

  // Texto rodapé
  s.addText('Sistema de Gestão de Unidades de Conservação do Acre', {
    x: M, y: H - 0.55, w: 5.0, h: 0.4,
    fontSize: 10, color: '3D6B50', fontFace: 'Calibri', margin: 0,
  });

  // Phone + screenshot
  addPhone(s, '01-login');
}

// ══════════════════════════════════════════════════════════════════════════
// SLIDE 2 — O QUE É O APP?
// ══════════════════════════════════════════════════════════════════════════
{
  const s = pres.addSlide();
  addHeader(s, 'O que é o App Brigadas?');

  const features = [
    { icon: '📱', color: C.green,   title: 'App de campo para brigadistas',  desc: 'Registre ocorrências, fauna e atividades diretamente pelo celular, em qualquer lugar da floresta.' },
    { icon: '📡', color: C.gold,    title: 'Funciona SEM internet',           desc: 'Salva os dados no próprio celular. Quando aparecer sinal de Wi-Fi ou 4G, o app envia tudo sozinho.' },
    { icon: '🔒', color: C.monitor, title: 'Seguro e oficial',                desc: 'Seus registros vão direto para a SEMA-AC. Cada brigadista tem login e PIN próprios.' },
  ];

  const blockH = 1.35, blockY0 = 0.9, gap = 0.12;

  features.forEach((f, i) => {
    const by = blockY0 + i * (blockH + gap);

    // Card fundo
    card(s, M, by, W - M * 2, blockH, { fill: C.white, border: C.border });

    // Faixa colorida esquerda
    s.addShape(pres.shapes.RECTANGLE, {
      x: M, y: by, w: 0.08, h: blockH,
      fill: { color: f.color }, line: { color: f.color, width: 0 },
    });

    // Ícone
    s.addText(f.icon, {
      x: M + 0.15, y: by, w: 0.7, h: blockH,
      fontSize: 26, valign: 'middle', align: 'center', margin: 0,
    });

    // Título
    s.addText(f.title, {
      x: M + 0.92, y: by + 0.18, w: CW - 0.92 + PW + 0.5, h: 0.4,
      fontSize: 16, bold: true, color: C.darkBg, fontFace: 'Calibri', margin: 0,
    });

    // Descrição
    s.addText(f.desc, {
      x: M + 0.92, y: by + 0.6, w: CW - 0.92 + PW + 0.5, h: 0.6,
      fontSize: 13, color: C.mutedDk, fontFace: 'Calibri', margin: 0,
    });
  });
}

// ══════════════════════════════════════════════════════════════════════════
// SLIDE 3 — INSTALAÇÃO
// ══════════════════════════════════════════════════════════════════════════
{
  const s = pres.addSlide();
  addHeader(s, 'Como Instalar no Celular');

  // Phone com screenshot de instalação (lado esquerdo desta vez)
  const lPhoneX = M;
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x: lPhoneX + 0.06, y: PY + 0.1, w: PW + 0.2, h: PH + 0.2,
    fill: { color: '000000', transparency: 75 }, line: { color: '000000', width: 0 }, rectRadius: 0.15,
  });
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x: lPhoneX, y: PY, w: PW + 0.2, h: PH + 0.2,
    fill: { color: C.phone }, line: { color: '1F3025', width: 2 }, rectRadius: 0.15,
  });
  s.addImage({ path: img('11-instalar'), x: lPhoneX + 0.1, y: PY + 0.1, w: PW, h: PH });

  // Conteúdo lado direito
  const rx = M + PW + 0.5;
  const rw = W - rx - M;

  const steps = [
    { n: '1', text: 'Abra a câmera do celular e aponte para o QR Code da brigada' },
    { n: '2', text: 'Toque no link que aparecer na tela' },
    { n: '3', text: 'Toque em "Baixar o aplicativo" (botão verde)' },
    { n: '4', text: 'Abra o arquivo baixado e toque em Instalar. Pronto!' },
  ];

  s.addText('Passo a passo:', {
    x: rx, y: 0.85, w: rw, h: 0.35,
    fontSize: 14, bold: true, color: C.darkBg, fontFace: 'Calibri', margin: 0,
  });

  steps.forEach((st, i) => {
    const sy = 1.28 + i * 0.95;

    // Número em círculo
    dot(s, rx + 0.25, sy + 0.25, 0.24, C.green);
    s.addText(st.n, {
      x: rx + 0.01, y: sy, w: 0.48, h: 0.5,
      fontSize: 15, bold: true, color: C.white, fontFace: 'Calibri',
      align: 'center', valign: 'middle', margin: 0,
    });

    // Texto do passo
    s.addText(st.text, {
      x: rx + 0.58, y: sy - 0.05, w: rw - 0.62, h: 0.6,
      fontSize: 13, color: C.mutedDk, fontFace: 'Calibri',
      valign: 'middle', margin: 0,
    });

    // Linha conectora (exceto último)
    if (i < steps.length - 1) {
      s.addShape(pres.shapes.LINE, {
        x: rx + 0.25, y: sy + 0.49, w: 0, h: 0.45,
        line: { color: C.border, width: 2 },
      });
    }
  });

  s.addText('💡 Dica: salve o ícone na tela inicial para abrir mais rápido!', {
    x: rx, y: H - 0.6, w: rw, h: 0.4,
    fontSize: 11, color: C.green, fontFace: 'Calibri', italic: true, margin: 0,
  });
}

// ══════════════════════════════════════════════════════════════════════════
// SLIDE 4 — LOGIN
// ══════════════════════════════════════════════════════════════════════════
{
  const s = pres.addSlide();
  addHeader(s, 'Primeiro Acesso: Login');
  addPhone(s, '01-login');

  const callouts = [
    { y: 1.1,  color: C.green,   label: 'Campo E-mail / CPF',  text: 'Use o e-mail ou CPF que o gestor cadastrou para você' },
    { y: 2.15, color: C.gold,    label: 'Campo Senha',          text: 'Senha fornecida pelo gestor. No 1º acesso, o app pede para criar uma nova' },
    { y: 3.2,  color: C.monitor, label: 'Botão Entrar',         text: 'Toque aqui para entrar no sistema' },
  ];

  callouts.forEach(c => {
    card(s, M, c.y, CW, 0.8, { fill: C.white, border: C.border });
    s.addShape(pres.shapes.RECTANGLE, {
      x: M, y: c.y, w: 0.07, h: 0.8,
      fill: { color: c.color }, line: { color: c.color, width: 0 },
    });
    s.addText(c.label, {
      x: M + 0.18, y: c.y + 0.04, w: CW - 0.22, h: 0.25,
      fontSize: 11, bold: true, color: c.color, fontFace: 'Calibri', margin: 0,
    });
    s.addText(c.text, {
      x: M + 0.18, y: c.y + 0.3, w: CW - 0.22, h: 0.42,
      fontSize: 12.5, color: C.mutedDk, fontFace: 'Calibri', margin: 0,
    });
  });

  // Nota rodapé
  s.addShape(pres.shapes.RECTANGLE, {
    x: M, y: H - 0.62, w: CW, h: 0.42,
    fill: { color: 'ECFDF5' }, line: { color: C.green, width: 1 },
  });
  s.addText('✅  Você só precisa fazer o login UMA VEZ. Depois use o PIN de campo.', {
    x: M + 0.12, y: H - 0.62, w: CW - 0.16, h: 0.42,
    fontSize: 12, color: C.greenDk, fontFace: 'Calibri', bold: true,
    valign: 'middle', margin: 0,
  });
}

// ══════════════════════════════════════════════════════════════════════════
// SLIDE 5 — PIN
// ══════════════════════════════════════════════════════════════════════════
{
  const s = pres.addSlide();
  addHeader(s, 'PIN de Campo — Sua Chave Rápida');
  addPhone(s, '02-pin');

  const points = [
    { icon: '🔢', color: C.green,   text: 'O PIN tem apenas 4 números — você escolhe e memoriza' },
    { icon: '⚡',  color: C.gold,    text: 'Use para entrar rapidamente após fechar o app, sem precisar de senha' },
    { icon: '📴',  color: C.monitor, text: 'Funciona mesmo quando não há internet disponível' },
    { icon: '⚠️',  color: C.combate, text: 'Não esqueça o PIN! Se esquecer, toque em "Entrar com senha"' },
  ];

  points.forEach((p, i) => {
    const py = 0.92 + i * 1.05;
    card(s, M, py, CW, 0.82, { fill: C.white, border: C.border });
    s.addText(p.icon, {
      x: M + 0.1, y: py, w: 0.55, h: 0.82,
      fontSize: 22, align: 'center', valign: 'middle', margin: 0,
    });
    s.addShape(pres.shapes.LINE, {
      x: M + 0.68, y: py + 0.15, w: 0, h: 0.52,
      line: { color: C.border, width: 1.5 },
    });
    s.addText(p.text, {
      x: M + 0.8, y: py + 0.1, w: CW - 0.88, h: 0.62,
      fontSize: 13, color: C.mutedDk, fontFace: 'Calibri', valign: 'middle', margin: 0,
    });
  });
}

// ══════════════════════════════════════════════════════════════════════════
// SLIDE 6 — TELA INICIAL
// ══════════════════════════════════════════════════════════════════════════
{
  const s = pres.addSlide();
  addHeader(s, 'Tela Inicial — Seu Painel de Campo');
  addPhone(s, '03-home');

  const labels = [
    { y: 0.95,  color: C.green,   icon: '👤', label: 'Seu nome e foto',  text: 'Exibe sua foto de perfil ou iniciais' },
    { y: 1.8,   color: C.gold,    icon: '🚒', label: 'Sua brigada',       text: 'A brigada à qual você pertence' },
    { y: 2.65,  color: C.monitor, icon: '👥', label: 'Equipe (A / B / C)','text': 'Troque sua equipe tocando no chip' },
    { y: 3.5,   color: C.green,   icon: '📍', label: 'Localização GPS',   text: 'Captura automática de coordenadas' },
    { y: 4.35,  color: C.combate, icon: '▶', label: 'Tipo de atividade', text: 'Toque para iniciar um novo registro' },
  ];

  labels.forEach(l => {
    card(s, M, l.y, CW, 0.72, { fill: C.white, border: C.border });
    s.addShape(pres.shapes.RECTANGLE, {
      x: M, y: l.y, w: 0.06, h: 0.72,
      fill: { color: l.color }, line: { color: l.color, width: 0 },
    });
    s.addText(l.icon, {
      x: M + 0.1, y: l.y, w: 0.45, h: 0.72,
      fontSize: 18, align: 'center', valign: 'middle', margin: 0,
    });
    s.addText(l.label, {
      x: M + 0.62, y: l.y + 0.05, w: CW - 0.66, h: 0.25,
      fontSize: 11, bold: true, color: l.color, fontFace: 'Calibri', margin: 0,
    });
    s.addText(l.text, {
      x: M + 0.62, y: l.y + 0.3, w: CW - 0.66, h: 0.36,
      fontSize: 12, color: C.mutedDk, fontFace: 'Calibri', margin: 0,
    });
  });
}

// ══════════════════════════════════════════════════════════════════════════
// SLIDE 7 — TIPOS DE ATIVIDADE
// ══════════════════════════════════════════════════════════════════════════
{
  const s = pres.addSlide();
  addHeader(s, 'Escolha o Tipo de Atividade');

  const activities = [
    {
      color:    C.green,
      colorLt:  'D1FAE5',
      icon:     '🛡️',
      title:    'PREVENÇÃO',
      desc:     'Aceiros, roçagem, educação ambiental, fiscalização preventiva e patrulhamento',
      examples: ['Abertura de aceiro', 'Educação ambiental', 'Ronda preventiva'],
    },
    {
      color:    C.combate,
      colorLt:  'FEE2E2',
      icon:     '🔥',
      title:    'COMBATE',
      desc:     'Extinção de incêndios florestais, rescaldo de focos ativos e apoio em sinistros',
      examples: ['Combate a incêndio', 'Rescaldo', 'Uso de bomba costal'],
    },
    {
      color:    C.monitor,
      colorLt:  'DBEAFE',
      icon:     '🔭',
      title:    'MONITORAMENTO',
      desc:     'Levantamento de fauna, flora, monitoramento de áreas e registro de ocorrências',
      examples: ['Avistamento de fauna', 'Monitoramento de área', 'Registro de ocorrência'],
    },
  ];

  const bW = (W - M * 2 - 0.2) / 3, bH = 4.2, bY = 0.85;

  activities.forEach((a, i) => {
    const bX = M + i * (bW + 0.1);

    // Card fundo colorido claro
    card(s, bX, bY, bW, bH, { fill: a.colorLt, border: a.color, lineW: 2, shadow: { type: 'outer', color: '000000', blur: 6, offset: 3, angle: 135, opacity: 0.1 } });

    // Topo colorido escuro
    s.addShape(pres.shapes.RECTANGLE, {
      x: bX, y: bY, w: bW, h: 0.55,
      fill: { color: a.color }, line: { color: a.color, width: 0 },
    });

    // Título no topo
    s.addText(a.title, {
      x: bX + 0.08, y: bY + 0.04, w: bW - 0.16, h: 0.47,
      fontSize: 13, bold: true, color: C.white, fontFace: 'Calibri',
      valign: 'middle', align: 'center', margin: 0,
    });

    // Ícone
    s.addText(a.icon, {
      x: bX, y: bY + 0.6, w: bW, h: 0.7,
      fontSize: 32, align: 'center', valign: 'middle', margin: 0,
    });

    // Descrição
    s.addText(a.desc, {
      x: bX + 0.12, y: bY + 1.35, w: bW - 0.24, h: 1.1,
      fontSize: 12, color: C.mutedDk, fontFace: 'Calibri',
      align: 'center', margin: 0,
    });

    // Exemplos
    a.examples.forEach((ex, j) => {
      s.addShape(pres.shapes.RECTANGLE, {
        x: bX + 0.12, y: bY + 2.55 + j * 0.45, w: bW - 0.24, h: 0.38,
        fill: { color: C.white }, line: { color: a.color, width: 1 },
      });
      s.addText('· ' + ex, {
        x: bX + 0.18, y: bY + 2.55 + j * 0.45, w: bW - 0.3, h: 0.38,
        fontSize: 11, color: C.mutedDk, fontFace: 'Calibri',
        valign: 'middle', margin: 0,
      });
    });
  });

  s.addText('Toque no tipo correto para abrir o formulário de registro', {
    x: 0, y: H - 0.28, w: W, h: 0.24,
    fontSize: 11, color: C.muted, fontFace: 'Calibri', align: 'center', margin: 0,
  });
}

// ══════════════════════════════════════════════════════════════════════════
// SLIDE 8 — FORMULÁRIO PARTE 1
// ══════════════════════════════════════════════════════════════════════════
{
  const s = pres.addSlide();
  addHeader(s, 'Registrando uma Ocorrência');
  addPhone(s, '04-form-p1');

  const fields = [
    { n: '1', color: C.green,   label: 'GPS',                    text: 'A localização é capturada automaticamente — não precisa digitar' },
    { n: '2', color: C.gold,    label: 'Atividade',               text: 'Escolha a atividade específica que foi realizada' },
    { n: '3', color: C.combate, label: 'Como a brigada soube?',   text: 'Denúncia 193, informação de populares, ronda da brigada…' },
    { n: '4', color: C.monitor, label: 'Duração (horas)',         text: 'Quantas horas durou a atividade? (ex.: 3,5 = 3h30min)' },
    { n: '5', color: C.green,   label: 'Área (hectares)',         text: 'Estime a área ou use o botão "Medir" no mapa' },
    { n: '6', color: C.gold,    label: 'Observações',             text: 'Descreva o que aconteceu, as condições do local e o resultado' },
  ];

  const fH = 0.73, gap = 0.04, startY = 0.85;

  fields.forEach((f, i) => {
    const fy = startY + i * (fH + gap);
    card(s, M, fy, CW, fH, { fill: C.white, border: C.border });

    // Número
    dot(s, M + 0.26, fy + fH / 2, 0.2, f.color);
    s.addText(f.n, {
      x: M + 0.06, y: fy, w: 0.4, h: fH,
      fontSize: 13, bold: true, color: C.white, fontFace: 'Calibri',
      align: 'center', valign: 'middle', margin: 0,
    });

    // Label + texto
    s.addText(f.label + '  ', {
      x: M + 0.55, y: fy + 0.06, w: CW - 0.6, h: 0.27,
      fontSize: 11, bold: true, color: f.color, fontFace: 'Calibri', margin: 0,
    });
    s.addText(f.text, {
      x: M + 0.55, y: fy + 0.33, w: CW - 0.6, h: 0.35,
      fontSize: 11.5, color: C.mutedDk, fontFace: 'Calibri', margin: 0,
    });
  });
}

// ══════════════════════════════════════════════════════════════════════════
// SLIDE 9 — FORMULÁRIO PARTE 2 (fotos + fauna + salvar)
// ══════════════════════════════════════════════════════════════════════════
{
  const s = pres.addSlide();
  addHeader(s, 'Fotos e Fauna — Documente Tudo');
  addPhone(s, '05-form-p2');

  const tips = [
    { icon: '📷', color: C.green,   title: 'Fotos (até 5)',            text: 'Use a câmera ou escolha da galeria. O app adiciona localização e hora automaticamente na foto.' },
    { icon: '🦎', color: C.gold,    title: 'Fauna registrada',          text: 'Se encontrar animais: toque em "+ Animal", escolha a classe e preencha o que aconteceu (resgate, avistamento…).' },
    { icon: '💾', color: C.combate, title: 'Salvar o registro',         text: 'Sempre toque em "Salvar Registro" antes de sair. O registro fica guardado no celular mesmo sem internet.' },
  ];

  const tH = 1.38, tGap = 0.1, startY = 0.88;

  tips.forEach((t, i) => {
    const ty = startY + i * (tH + tGap);
    card(s, M, ty, CW, tH, { fill: C.white, border: C.border });

    // Faixa lateral
    s.addShape(pres.shapes.RECTANGLE, {
      x: M, y: ty, w: 0.08, h: tH,
      fill: { color: t.color }, line: { color: t.color, width: 0 },
    });

    // Ícone
    s.addText(t.icon, {
      x: M + 0.14, y: ty, w: 0.6, h: tH,
      fontSize: 28, align: 'center', valign: 'middle', margin: 0,
    });

    // Conteúdo
    s.addText(t.title, {
      x: M + 0.82, y: ty + 0.12, w: CW - 0.88, h: 0.35,
      fontSize: 14, bold: true, color: C.darkBg, fontFace: 'Calibri', margin: 0,
    });
    s.addText(t.text, {
      x: M + 0.82, y: ty + 0.48, w: CW - 0.88, h: 0.78,
      fontSize: 12.5, color: C.mutedDk, fontFace: 'Calibri', margin: 0,
    });
  });
}

// ══════════════════════════════════════════════════════════════════════════
// SLIDE 10 — FAUNA
// ══════════════════════════════════════════════════════════════════════════
{
  const s = pres.addSlide();
  addHeader(s, 'Fauna: Registrando Animais');
  addPhone(s, '06-fauna');

  const steps = [
    { n: '1', color: C.green,   text: 'Toque na classe do animal — mamífero, ave, réptil, anfíbio, peixe ou invertebrado' },
    { n: '2', color: C.gold,    text: 'Digite o nome do animal (popular ou científico) e selecione da lista' },
    { n: '3', color: C.combate, text: 'Informe o tipo de evento: resgate, avistamento, atropelamento, apreensão…' },
    { n: '4', color: C.monitor, text: 'Condição do animal: íntegro, ferido, queimado, debilitado ou óbito' },
    { n: '5', color: C.gold,    text: 'Para onde foi: solto no local, encaminhado ao CETAS, em tratamento…' },
  ];

  const sH = 0.82, gap = 0.08, sy0 = 0.9;

  steps.forEach((st, i) => {
    const sy = sy0 + i * (sH + gap);
    card(s, M, sy, CW, sH, { fill: C.white, border: C.border });

    dot(s, M + 0.26, sy + sH / 2, 0.22, st.color);
    s.addText(st.n, {
      x: M + 0.04, y: sy, w: 0.44, h: sH,
      fontSize: 14, bold: true, color: C.white,
      align: 'center', valign: 'middle', margin: 0,
    });

    s.addText(st.text, {
      x: M + 0.56, y: sy + 0.08, w: CW - 0.62, h: sH - 0.16,
      fontSize: 12.5, color: C.mutedDk, fontFace: 'Calibri', valign: 'middle', margin: 0,
    });
  });

  // Nota
  s.addText('💡 Se não souber a espécie, escolha "Não sei" — registre assim mesmo!', {
    x: M, y: H - 0.45, w: CW, h: 0.35,
    fontSize: 11.5, color: C.greenDk, fontFace: 'Calibri', italic: true, margin: 0,
  });
}

// ══════════════════════════════════════════════════════════════════════════
// SLIDE 11 — FILA (SEM INTERNET)
// ══════════════════════════════════════════════════════════════════════════
{
  const s = pres.addSlide();
  addHeader(s, 'Sem Sinal? Sem Problema!');
  addPhone(s, '07-fila');

  // Fluxo visual
  const flowY = 1.0, flowH = 0.62;
  const steps = [
    { icon: '🌲', label: 'No campo',     sub: '(sem sinal)',   color: C.darkBg3 },
    { icon: '📱', label: 'Salva local',  sub: 'no celular',    color: C.greenDk },
    { icon: '📡', label: 'Sinal chega',  sub: '(Wi-Fi / 4G)',  color: C.monitor },
    { icon: '✅', label: 'Enviado!',     sub: 'ao servidor',   color: C.green   },
  ];

  const sw = (CW - M * 0.5) / 4 - 0.12;
  const sx0 = M;

  steps.forEach((st, i) => {
    const sx = sx0 + i * (sw + 0.12);

    card(s, sx, flowY, sw, flowH + 0.5, { fill: st.color, border: st.color, shadow: { type: 'outer', color: '000000', blur: 4, offset: 2, angle: 135, opacity: 0.12 } });

    s.addText(st.icon, {
      x: sx, y: flowY + 0.02, w: sw, h: 0.4,
      fontSize: 20, align: 'center', margin: 0,
    });
    s.addText(st.label, {
      x: sx, y: flowY + 0.42, w: sw, h: 0.28,
      fontSize: 11, bold: true, color: C.white, fontFace: 'Calibri',
      align: 'center', margin: 0,
    });
    s.addText(st.sub, {
      x: sx, y: flowY + 0.7, w: sw, h: 0.22,
      fontSize: 9, color: 'CCDDCC', fontFace: 'Calibri',
      align: 'center', margin: 0,
    });

    // Seta (exceto último)
    if (i < steps.length - 1) {
      s.addText('→', {
        x: sx + sw + 0.01, y: flowY + 0.15, w: 0.12, h: 0.35,
        fontSize: 14, bold: true, color: C.muted,
        align: 'center', valign: 'middle', margin: 0,
      });
    }
  });

  // Fila - status explicados
  const statusY = 2.0;
  const statuses = [
    { color: C.gold,    label: 'Pendente',   text: 'Salvo no celular, aguardando sinal para enviar' },
    { color: C.monitor, label: 'Enviando…',  text: 'Sendo transferido para o servidor agora' },
    { color: C.green,   label: 'Confirmado', text: 'Enviado com sucesso e registrado na SEMA-AC' },
  ];

  statuses.forEach((st, i) => {
    const iy = statusY + i * 0.88;
    card(s, M, iy, CW, 0.74, { fill: C.white, border: C.border });
    dot(s, M + 0.22, iy + 0.37, 0.15, st.color);
    s.addText(st.label, {
      x: M + 0.44, y: iy + 0.04, w: 1.3, h: 0.3,
      fontSize: 12, bold: true, color: st.color, fontFace: 'Calibri', margin: 0,
    });
    s.addText(st.text, {
      x: M + 0.44, y: iy + 0.36, w: CW - 0.5, h: 0.3,
      fontSize: 11.5, color: C.mutedDk, fontFace: 'Calibri', margin: 0,
    });
  });
}

// ══════════════════════════════════════════════════════════════════════════
// SLIDE 12 — MEUS RESULTADOS
// ══════════════════════════════════════════════════════════════════════════
{
  const s = pres.addSlide();
  addHeader(s, 'Acompanhe Seus Resultados');
  addPhone(s, '08-dados-kpis');

  // KPIs grandes
  const kpis = [
    { n: '47', label: 'Registros',    color: C.green   },
    { n: '12', label: 'Neste mês',    color: C.gold    },
    { n: '183', label: 'Área (ha)',   color: C.monitor },
    { n: '28',  label: 'Animais',     color: C.combate },
  ];

  const kw = (CW - M * 0.5 - 0.15) / 2 - 0.08;
  const kpositions = [
    { x: M,            y: 0.86 },
    { x: M + kw + 0.1, y: 0.86 },
    { x: M,            y: 0.86 + 1.25 },
    { x: M + kw + 0.1, y: 0.86 + 1.25 },
  ];

  kpis.forEach((k, i) => {
    const { x, y } = kpositions[i];
    card(s, x, y, kw, 1.1, { fill: C.white, border: C.border, shadow: { type: 'outer', color: '000000', blur: 4, offset: 2, angle: 135, opacity: 0.08 } });
    s.addShape(pres.shapes.RECTANGLE, {
      x, y, w: kw, h: 0.08,
      fill: { color: k.color }, line: { color: k.color, width: 0 },
    });
    s.addText(k.n, {
      x: x + 0.1, y: y + 0.1, w: kw - 0.2, h: 0.65,
      fontSize: 38, bold: true, color: k.color, fontFace: 'Georgia',
      align: 'center', margin: 0,
    });
    s.addText(k.label, {
      x: x + 0.1, y: y + 0.74, w: kw - 0.2, h: 0.3,
      fontSize: 12, color: C.muted, fontFace: 'Calibri',
      align: 'center', margin: 0,
    });
  });

  // Texto motivador
  card(s, M, 3.55, CW, 1.5, { fill: C.darkBg2, border: C.darkBg2 });
  s.addText('📊  Veja seu histórico completo na aba "Meus Resultados"', {
    x: M + 0.2, y: 3.62, w: CW - 0.4, h: 0.5,
    fontSize: 14, bold: true, color: C.txt, fontFace: 'Calibri', margin: 0,
  });
  s.addText('Cada registro conta! Registros validados entram nos relatórios oficiais da SEMA-AC.', {
    x: M + 0.2, y: 4.12, w: CW - 0.4, h: 0.7,
    fontSize: 12, color: C.green, fontFace: 'Calibri', margin: 0,
  });
}

// ══════════════════════════════════════════════════════════════════════════
// SLIDE 13 — RANKING DA BRIGADA
// ══════════════════════════════════════════════════════════════════════════
{
  const s = pres.addSlide();
  addHeader(s, 'Ranking da Brigada');
  addPhone(s, '09-dados-ranking');

  // Banner motivador
  card(s, M, 0.86, CW, 0.75, { fill: C.darkBg2, border: C.darkBg2 });
  s.addText('🏆  Veja como sua equipe e você estão no ranking da brigada', {
    x: M + 0.2, y: 0.86, w: CW - 0.3, h: 0.75,
    fontSize: 14, bold: true, color: C.txt, fontFace: 'Calibri', valign: 'middle', margin: 0,
  });

  // Por equipe
  s.addText('Por equipe:', {
    x: M, y: 1.78, w: CW, h: 0.3,
    fontSize: 12, bold: true, color: C.mutedDk, fontFace: 'Calibri', margin: 0,
  });

  const equipes = [
    { rank: '🥇', name: 'Equipe A', n: 19, color: C.gold,    pct: 75 },
    { rank: '🥈', name: 'Equipe B', n: 16, color: C.muted,   pct: 60 },
    { rank: '🥉', name: 'Equipe C', n: 12, color: 'CD7F32',  pct: 45 },
  ];

  equipes.forEach((e, i) => {
    const ey = 2.12 + i * 0.52;
    s.addText(`${e.rank} ${e.name}`, {
      x: M, y: ey, w: 1.8, h: 0.28,
      fontSize: 12, color: C.mutedDk, fontFace: 'Calibri', margin: 0,
    });
    s.addText(String(e.n) + ' reg.', {
      x: M + 1.85, y: ey, w: 0.8, h: 0.28,
      fontSize: 12, bold: true, color: e.color, fontFace: 'Calibri', margin: 0,
    });
    // Barra fundo
    s.addShape(pres.shapes.RECTANGLE, {
      x: M + 2.7, y: ey + 0.05, w: CW - 2.74, h: 0.18,
      fill: { color: C.border }, line: { color: C.border, width: 0 },
    });
    // Barra preenchida
    const barW = (CW - 2.74) * (e.pct / 100);
    s.addShape(pres.shapes.RECTANGLE, {
      x: M + 2.7, y: ey + 0.05, w: barW, h: 0.18,
      fill: { color: e.color }, line: { color: e.color, width: 0 },
    });
  });

  // Por brigadista
  s.addText('Por brigadista:', {
    x: M, y: 3.75, w: CW, h: 0.3,
    fontSize: 12, bold: true, color: C.mutedDk, fontFace: 'Calibri', margin: 0,
  });

  const brigadistas = [
    { rank: '1.', name: 'Ana Lima',            n: 11, color: C.gold,    pct: 85, you: false },
    { rank: '2.', name: 'João Pedro Silva ★',  n: 9,  color: C.green,   pct: 70, you: true  },
    { rank: '3.', name: 'Carlos Souza',        n: 8,  color: C.muted,   pct: 62, you: false },
  ];

  brigadistas.forEach((b, i) => {
    const by = 4.1 + i * 0.42;
    s.addText(`${b.rank} ${b.name}`, {
      x: M, y: by, w: 2.8, h: 0.28,
      fontSize: 11, color: b.you ? C.green : C.mutedDk, fontFace: 'Calibri',
      bold: b.you, margin: 0,
    });
    s.addText(String(b.n), {
      x: M + 2.85, y: by, w: 0.5, h: 0.28,
      fontSize: 12, bold: true, color: b.color, fontFace: 'Calibri', margin: 0,
    });
    s.addShape(pres.shapes.RECTANGLE, {
      x: M + 3.4, y: by + 0.05, w: CW - 3.44, h: 0.15,
      fill: { color: C.border }, line: { color: C.border, width: 0 },
    });
    const bW2 = (CW - 3.44) * (b.pct / 100);
    s.addShape(pres.shapes.RECTANGLE, {
      x: M + 3.4, y: by + 0.05, w: bW2, h: 0.15,
      fill: { color: b.color }, line: { color: b.color, width: 0 },
    });
  });
}

// ══════════════════════════════════════════════════════════════════════════
// SLIDE 14 — CONFIGURAÇÕES
// ══════════════════════════════════════════════════════════════════════════
{
  const s = pres.addSlide();
  addHeader(s, 'Configurações do App');
  addPhone(s, '10-config');

  const rows = [
    { icon: '🔑', label: 'Alterar PIN',           text: 'Mude seus 4 dígitos quando quiser',     danger: false },
    { icon: '🌿', label: 'Atualizar catálogo',     text: 'Baixar novas espécies de fauna',         danger: false },
    { icon: '📲', label: 'Instalar (QR)',           text: 'Passar o app para outro celular',        danger: false },
    { icon: '⬇️', label: 'Verificar atualização',  text: 'Ver se há versão nova disponível',       danger: false },
    { icon: '🗑️', label: 'Zerar fila',              text: '⚠️ Apaga registros NÃO enviados!',      danger: true  },
    { icon: '🚪', label: 'Sair',                   text: 'Encerra sessão / troca de conta',       danger: false },
  ];

  const rH = 0.68, startY = 0.85, gap = 0.07;

  rows.forEach((r, i) => {
    const ry = startY + i * (rH + gap);
    card(s, M, ry, CW, rH, {
      fill: r.danger ? 'FFF5F5' : C.white,
      border: r.danger ? C.combate : C.border,
    });

    s.addText(r.icon, {
      x: M + 0.1, y: ry, w: 0.5, h: rH,
      fontSize: 18, align: 'center', valign: 'middle', margin: 0,
    });
    s.addText(r.label, {
      x: M + 0.68, y: ry + 0.06, w: 1.7, h: 0.28,
      fontSize: 12, bold: true, color: r.danger ? C.combate : C.darkBg,
      fontFace: 'Calibri', margin: 0,
    });
    s.addText(r.text, {
      x: M + 0.68, y: ry + 0.36, w: CW - 0.74, h: 0.28,
      fontSize: 11, color: r.danger ? C.combate : C.muted,
      fontFace: 'Calibri', margin: 0,
    });
  });
}

// ══════════════════════════════════════════════════════════════════════════
// SLIDE 15 — ATUALIZAÇÕES
// ══════════════════════════════════════════════════════════════════════════
{
  const s = pres.addSlide();
  addHeader(s, 'Como o App se Atualiza');

  // Card PWA / Navegador
  const cW = (W - M * 2 - 0.3) / 2;

  card(s, M, 0.88, cW, 3.8, { fill: C.white, border: C.green, lineW: 2, shadow: { type: 'outer', color: '000000', blur: 5, offset: 3, angle: 135, opacity: 0.08 } });
  s.addShape(pres.shapes.RECTANGLE, {
    x: M, y: 0.88, w: cW, h: 0.55,
    fill: { color: C.green }, line: { color: C.green, width: 0 },
  });
  s.addText('📱  PWA / Navegador', {
    x: M + 0.15, y: 0.88, w: cW - 0.3, h: 0.55,
    fontSize: 14, bold: true, color: C.white, fontFace: 'Calibri', valign: 'middle', margin: 0,
  });
  s.addText([
    { text: 'Um banner verde aparece na tela:', options: { breakLine: true, bold: true } },
    { text: '"Atualização disponível"', options: { breakLine: true, italic: true } },
    { text: '\nO que fazer:', options: { breakLine: true, bold: true } },
    { text: 'Toque em "Atualizar agora" e aguarde recarregar.', options: {} },
  ], {
    x: M + 0.18, y: 1.55, w: cW - 0.35, h: 2.9,
    fontSize: 13, color: C.mutedDk, fontFace: 'Calibri', margin: 0,
  });

  // Card APK Android
  const c2x = M + cW + 0.3;
  card(s, c2x, 0.88, cW, 3.8, { fill: C.white, border: C.monitor, lineW: 2, shadow: { type: 'outer', color: '000000', blur: 5, offset: 3, angle: 135, opacity: 0.08 } });
  s.addShape(pres.shapes.RECTANGLE, {
    x: c2x, y: 0.88, w: cW, h: 0.55,
    fill: { color: C.monitor }, line: { color: C.monitor, width: 0 },
  });
  s.addText('📦  APK Android', {
    x: c2x + 0.15, y: 0.88, w: cW - 0.3, h: 0.55,
    fontSize: 14, bold: true, color: C.white, fontFace: 'Calibri', valign: 'middle', margin: 0,
  });
  s.addText([
    { text: 'Um pontinho vermelho aparece em Configurações.', options: { breakLine: true, bold: true } },
    { text: '\nO que fazer:', options: { breakLine: true, bold: true } },
    { text: 'Abra Configurações → toque em "Verificar atualização" → baixe e instale o novo arquivo .apk.', options: {} },
  ], {
    x: c2x + 0.18, y: 1.55, w: cW - 0.35, h: 2.9,
    fontSize: 13, color: C.mutedDk, fontFace: 'Calibri', margin: 0,
  });

  // Nota rodapé
  s.addShape(pres.shapes.RECTANGLE, {
    x: M, y: H - 0.55, w: W - M * 2, h: 0.42,
    fill: { color: 'ECFDF5' }, line: { color: C.green, width: 1 },
  });
  s.addText('✅  Sempre aceite as atualizações — elas trazem melhorias e correções importantes', {
    x: M + 0.15, y: H - 0.55, w: W - M * 2 - 0.3, h: 0.42,
    fontSize: 12, color: C.greenDk, fontFace: 'Calibri', bold: true,
    valign: 'middle', margin: 0,
  });
}

// ══════════════════════════════════════════════════════════════════════════
// SLIDE 16 — DICAS PRÁTICAS
// ══════════════════════════════════════════════════════════════════════════
{
  const s = pres.addSlide();
  addHeader(s, 'Dicas para Usar no Campo');

  const tips = [
    { icon: '🔋', color: C.green,   title: 'Bateria',      text: 'Leve o celular bem carregado. O GPS usa bastante bateria — leve um carregador portátil' },
    { icon: '📡', color: C.monitor, title: 'Sinal',         text: 'Sem sinal funciona normal. O app guarda tudo e envia quando você voltar a ter sinal' },
    { icon: '📍', color: C.gold,    title: 'GPS',           text: 'Aguarde o ícone GPS ficar verde antes de salvar. Isso garante localização precisa' },
    { icon: '📷', color: C.combate, title: 'Fotos',         text: 'Fotografe antes de mexer no local ou no animal. Mostre o contexto da ocorrência' },
    { icon: '🔒', color: C.green,   title: 'PIN seguro',    text: 'Não compartilhe seu PIN. Cada brigadista tem o seu — isso protege seus registros' },
    { icon: '💾', color: C.gold,    title: 'Sempre salvar', text: 'Sempre toque em "Salvar Registro" antes de fechar o app ou guardar o celular' },
  ];

  const cols = 3, rows = 2;
  const tW = (W - M * 2 - (cols - 1) * 0.15) / cols;
  const tH = (H - 0.95 - 0.2 - (rows - 1) * 0.12) / rows;

  tips.forEach((t, i) => {
    const col = i % cols, row = Math.floor(i / cols);
    const tx = M + col * (tW + 0.15);
    const ty = 0.9 + row * (tH + 0.12);

    card(s, tx, ty, tW, tH, { fill: C.white, border: C.border, shadow: { type: 'outer', color: '000000', blur: 4, offset: 2, angle: 135, opacity: 0.07 } });

    // Topo colorido
    s.addShape(pres.shapes.RECTANGLE, {
      x: tx, y: ty, w: tW, h: 0.06,
      fill: { color: t.color }, line: { color: t.color, width: 0 },
    });

    s.addText(t.icon, {
      x: tx + 0.1, y: ty + 0.08, w: 0.45, h: 0.45,
      fontSize: 20, align: 'center', valign: 'middle', margin: 0,
    });
    s.addText(t.title, {
      x: tx + 0.58, y: ty + 0.12, w: tW - 0.65, h: 0.35,
      fontSize: 13, bold: true, color: t.color, fontFace: 'Calibri', margin: 0,
    });
    s.addText(t.text, {
      x: tx + 0.12, y: ty + 0.55, w: tW - 0.22, h: tH - 0.65,
      fontSize: 11.5, color: C.mutedDk, fontFace: 'Calibri', margin: 0,
    });
  });
}

// ══════════════════════════════════════════════════════════════════════════
// SLIDE 17 — ENCERRAMENTO
// ══════════════════════════════════════════════════════════════════════════
{
  const s = pres.addSlide();
  s.background = { color: C.darkBg };

  // Faixa diagonal decorativa
  s.addShape(pres.shapes.RECTANGLE, {
    x: 5.5, y: 0, w: 4.5, h: H,
    fill: { color: C.darkBg2 }, line: { color: C.darkBg2, width: 0 },
  });
  s.addShape(pres.shapes.RECTANGLE, {
    x: 5.45, y: 0.4, w: 0.05, h: H - 0.8,
    fill: { color: C.gold }, line: { color: C.gold, width: 0 },
  });

  // Mascote Copa (junho 2026 = modo copa ativo)
  const mascotePath = path.join(ROOT, 'pwa', 'icons', 'mascote-copa.png');
  const mascoteFile = fs.existsSync(mascotePath) ? mascotePath : path.join(ROOT, 'pwa', 'icons', 'mascote.png');
  s.addImage({ path: mascoteFile, x: 6.2, y: 0.6, w: 3.4, h: 3.4 });

  // Título
  s.addText('Prontos para\no Campo!', {
    x: M, y: 0.5, w: 5.0, h: 1.8,
    fontSize: 46, bold: true, color: C.txt, fontFace: 'Georgia', margin: 0,
  });

  // Linha dourada
  s.addShape(pres.shapes.RECTANGLE, {
    x: M, y: 2.4, w: 1.4, h: 0.04,
    fill: { color: C.gold }, line: { color: C.gold, width: 0 },
  });

  // Frase motivadora
  s.addText('"O registro correto protege a floresta\ne reconhece o trabalho da brigada."', {
    x: M, y: 2.55, w: 5.0, h: 1.1,
    fontSize: 16, color: C.green, fontFace: 'Calibri', italic: true, margin: 0,
  });

  // Contato
  card(s, M, 3.8, 4.8, 1.35, { fill: C.darkBg3, border: C.green, lineW: 1 });
  s.addText('Dúvidas? Fale com seu chefe de brigada\nou com a equipe DIMA — SEMA-AC', {
    x: M + 0.2, y: 3.85, w: 4.4, h: 1.2,
    fontSize: 13, color: C.txt, fontFace: 'Calibri', valign: 'middle', margin: 0,
  });
}

// ─── Salvar ───────────────────────────────────────────────────────────────
pres.writeFile({ fileName: OUT }).then(() => {
  const size = (fs.statSync(OUT).size / 1024).toFixed(0);
  console.log(`✅ Apresentação criada: ${OUT}`);
  console.log(`   Tamanho: ${size} KB · ${pres.slides.length} slides`);
}).catch(err => {
  console.error('❌ Erro ao gerar PPTX:', err.message);
  process.exit(1);
});
