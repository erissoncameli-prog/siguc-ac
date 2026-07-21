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
function fwTransicaoTela(idOuEl, direcao) {
  const el = typeof idOuEl === 'string' ? document.getElementById(idOuEl) : idOuEl;
  if (!el) return;
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const classe = direcao === 'voltar' ? 'fw-tela-voltar' : direcao === 'fade' ? 'fw-tela-fade' : 'fw-tela-avancar';
  el.classList.remove('fw-tela-avancar', 'fw-tela-voltar', 'fw-tela-fade');
  void el.offsetWidth; // força reflow para reiniciar a animação
  el.classList.add(classe);
}
