// Frota · helpers do tema Wise (isolado ao módulo Frota)

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
