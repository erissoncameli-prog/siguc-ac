// Frota · helpers do tema Wise (isolado ao módulo Frota)

// Municípios do Acre (fonte: data/municipios_acre.geojson) — usados nos
// comboboxes de cidade origem/destino da solicitação de viagem. O campo é
// combobox (input + datalist): permite escolher da lista OU digitar cidade
// de outro estado (texto livre).
const MUNICIPIOS_AC = [
  'Acrelândia', 'Assis Brasil', 'Brasiléia', 'Bujari', 'Capixaba',
  'Cruzeiro do Sul', 'Epitaciolândia', 'Feijó', 'Jordão', 'Mâncio Lima',
  'Manoel Urbano', 'Marechal Thaumaturgo', 'Plácido de Castro', 'Porto Acre',
  'Porto Walter', 'Rio Branco', 'Rodrigues Alves', 'Santa Rosa do Purus',
  'Sena Madureira', 'Senador Guiomard', 'Tarauacá', 'Xapuri'
];

// <datalist> com os municípios do AC para um <input list="id">.
function fwDatalistCidades(id) {
  return `<datalist id="${id}">` +
    MUNICIPIOS_AC.map(m => `<option value="${m}"></option>`).join('') +
    `</datalist>`;
}

// Avatar do motorista (foto redonda com fallback de iniciais). Usado na
// sugestão da escala (motorista da vez) — nome + foto. esc/iniciais vêm
// do config.js (carregado antes deste arquivo).
//
// O bucket frota-motoristas é privado (migration 200): o <img> sai sem
// src, só marcado, e quem chamou precisa rodar frotaAssinarFotos() no
// contêiner depois de inserir o HTML. Se a assinatura falhar (offline,
// por exemplo), o data-frota-fallback faz virar as iniciais — o mesmo
// que já aparece quando não há foto.
function fwAvatarMotorista(foto, nome, size) {
  size = size || 28;
  const base = `width:${size}px;height:${size}px;border-radius:50%;flex-shrink:0;vertical-align:middle`;
  const ini = esc(iniciais(nome || ''));
  const marca = (typeof frotaFotoAttr === 'function') ? frotaFotoAttr(foto, iniciais(nome || '')) : '';
  return marca
    ? `<img ${marca} alt="" style="${base};object-fit:cover;display:inline-block;font-size:${Math.round(size * 0.4)}px">`
    : `<span class="sidebar-avatar" style="${base};font-size:${Math.round(size * 0.4)}px;display:inline-flex;align-items:center;justify-content:center">${ini}</span>`;
}

function fwAnimateNumber(el, valorFinal, opts) {
  opts = opts || {};
  const duracao = opts.duracao || 900;
  const casas = opts.casas ?? 0;
  const prefixo = opts.prefixo || '';
  const sufixo = opts.sufixo || '';
  const formatar = opts.formatar || (n => n.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas }));

  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    el.textContent = prefixo + formatar(valorFinal) + sufixo;
    return;
  }

  const valorInicial = 0;
  const inicio = performance.now();
  function passo(agora) {
    const t = Math.min(1, (agora - inicio) / duracao);
    const ease = 1 - Math.pow(1 - t, 3);
    const atual = valorInicial + (valorFinal - valorInicial) * ease;
    el.textContent = prefixo + formatar(atual) + sufixo;
    if (t < 1) requestAnimationFrame(passo);
  }
  requestAnimationFrame(passo);
}

function fwSkeleton(alturaPx, larguraCss) {
  return `<div class="fw-skeleton" style="height:${alturaPx || 16}px;width:${larguraCss || '100%'}"></div>`;
}

// Toca a animação de troca de tela num contêiner cujo conteúdo acabou de
// ser trocado (innerHTML já novo). direcao: 'avancar' | 'voltar' | 'fade'.
//
// #fm-conteudo é irmão (não ancestral) da barra inferior position:fixed
// (.fm-pill-nav) dentro de .fm-shell. Ainda assim, animar `transform`
// nele (translateX/scale das classes fw-tela-*) dispara um bug real de
// composição do WebKit/Chrome mobile: qualquer elemento da página
// animando transform pode fazer um irmão position:fixed “grudar” no
// scroll, sumir e ficar com a área de toque desalinhada até o próximo
// reflow — mesmo sem relação de ancestralidade no DOM. will-change
// isolando só a barra não foi suficiente na prática. Mesma classe de
// bug documentada em css/brigada.css (ali evitada não usando transform
// nenhum na tela). Por isso troca de ABA (sempre em #fm-conteudo) usa
// as variantes -leve, só opacidade — sem transform, o bug não dispara.
// Troca de MODO (motorista/gestor/solicitante, .fm-shell inteiro) pode
// seguir com o slide de transform: a barra é descendente do próprio
// elemento animado ali, então desliza junto de propósito.
function fwTransicaoTela(idOuEl, direcao) {
  const el = typeof idOuEl === 'string' ? document.getElementById(idOuEl) : idOuEl;
  if (!el) return;
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const semTransform = (typeof idOuEl === 'string' && idOuEl === 'fm-conteudo') || el.id === 'fm-conteudo';
  const sufixo = semTransform ? '-leve' : '';
  const classe = (direcao === 'voltar' ? 'fw-tela-voltar' : direcao === 'fade' ? 'fw-tela-fade' : 'fw-tela-avancar') + sufixo;
  el.classList.remove('fw-tela-avancar', 'fw-tela-voltar', 'fw-tela-fade',
    'fw-tela-avancar-leve', 'fw-tela-voltar-leve', 'fw-tela-fade-leve');
  void el.offsetWidth; // força reflow para reiniciar a animação
  el.classList.add(classe);
}
