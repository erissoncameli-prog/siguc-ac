// ── SIGUC-AC · Monitor de APIs (avisos de falha) ─────────────────
// Intercepta window.fetch e avisa, em qualquer mapa/relatório/tela,
// quando uma API externa (proxies) ou o Supabase falham — com o
// motivo e a solução sugerida. Carregado globalmente via config.js.
//
// Opt-out: defina window.__API_MONITOR_OFF = true antes do config.js
// (ex.: pages/saude-sistema.html, que provoca 400 de propósito).

const ApiMonitor = (() => {
  const COOLDOWN_MS   = 20_000;  // 1 aviso por fonte a cada 20s
  const AUTO_FECHA_MS = 9_000;   // o card some sozinho
  const MAX_CARDS     = 3;

  const _ultimoAviso = new Map(); // fonte → timestamp
  let _wrapInstalado = false;

  const SUPA_HOST = (() => {
    try { return new URL(window.SUPABASE_URL || 'https://atqtybcsvepdabsvgaly.supabase.co').host; }
    catch { return 'atqtybcsvepdabsvgaly.supabase.co'; }
  })();

  // ── Registro fonte → nome amigável + solução ──────────────────
  const FONTES = [
    { teste: u => /\/api\/car-proxy/.test(u),    nome: 'CAR / SICAR',
      solucao: 'O serviço do SICAR (gov.br) está instável. As camadas de CAR podem não carregar — o restante do mapa continua funcionando. Tente novamente em alguns minutos.' },
    { teste: u => /\/api\/prodes-proxy/.test(u), nome: 'PRODES / TerraBrasilis (INPE)',
      solucao: 'O TerraBrasilis/INPE está indisponível. Os polígonos de desmatamento podem não aparecer agora. Tente recarregar mais tarde.' },
    { teste: u => /\/api\/focos-proxy/.test(u),  nome: 'Focos de calor (FIRMS/NASA)',
      solucao: 'O serviço de focos de calor está fora do ar. Os focos recentes podem não ser exibidos. O restante do mapa segue normal.' },
    { teste: u => /\/api\/dof-proxy/.test(u),    nome: 'DOF / IBAMA',
      solucao: 'O portal de Dados Abertos do IBAMA está indisponível. Consultas de DOF ficam temporariamente sem resposta.' },
    { teste: u => /\/api\/health/.test(u),       nome: 'API interna (health)',
      solucao: 'O endpoint de saúde do sistema não respondeu. Pode ser uma instabilidade momentânea do servidor.' },
    { teste: u => u.includes(SUPA_HOST),         nome: 'Banco de dados (Supabase)',
      solucao: 'Falha ao consultar o banco de dados. Verifique sua conexão. Se persistir, a base pode estar em manutenção — avise a equipe técnica.' },
    { teste: u => /\/api\//.test(u),             nome: 'API interna',
      solucao: 'Um serviço interno respondeu com erro. Se o problema continuar, abra a Saúde do Sistema para diagnosticar.' },
  ];

  function _classificarFonte(url) {
    const f = FONTES.find(f => { try { return f.teste(url); } catch { return false; } });
    return f || null;
  }

  function _isMonitorada(url) {
    if (!url) return false;
    // só monitora os proxies internos e o host do Supabase — evita
    // disparar por falha de tiles de mapa, CDNs e afins.
    return /\/api\//.test(url) || url.includes(SUPA_HOST);
  }

  function _motivoLegivel(motivo) {
    if (motivo === 'sem-conexao') return 'Você está sem conexão com a internet';
    if (motivo === 'timeout')     return 'Tempo de resposta esgotado (timeout)';
    if (motivo === 'rede')        return 'O servidor não respondeu';
    if (/^HTTP/.test(motivo))     return `O serviço respondeu com erro (${motivo})`;
    return motivo || 'Falha desconhecida';
  }

  // ── Report (pode ser chamado manualmente também) ──────────────
  function report({ url = '', motivo = 'rede' } = {}) {
    if (window.__API_MONITOR_OFF) return;
    const fonte = _classificarFonte(url) || { nome: 'Serviço externo', solucao: 'Tente novamente em alguns instantes.' };

    const offline = !navigator.onLine;
    const chave = offline ? '__offline__' : fonte.nome;
    const agora = Date.now();
    if (agora - (_ultimoAviso.get(chave) || 0) < COOLDOWN_MS) return;
    _ultimoAviso.set(chave, agora);

    if (offline) {
      _card({
        titulo: 'Sem conexão com a internet',
        motivo: 'Não foi possível falar com os servidores',
        solucao: 'Verifique sua rede Wi-Fi ou dados móveis. Os dados serão carregados assim que a conexão voltar.',
      });
      return;
    }
    _card({ titulo: fonte.nome, motivo: _motivoLegivel(motivo), solucao: fonte.solucao });
  }

  // ── Card visual (canto inferior direito, empilhável) ──────────
  function _container() {
    let c = document.getElementById('apimon-stack');
    if (!c) {
      c = document.createElement('div');
      c.id = 'apimon-stack';
      c.style.cssText = 'position:fixed;bottom:18px;right:18px;z-index:99998;display:flex;flex-direction:column;gap:10px;max-width:360px;pointer-events:none';
      (document.body || document.documentElement).appendChild(c);
    }
    return c;
  }

  function _card({ titulo, motivo, solucao }) {
    const c = _container();
    while (c.children.length >= MAX_CARDS) c.removeChild(c.firstChild);

    const el = document.createElement('div');
    el.style.cssText = [
      'pointer-events:auto', 'background:#fff', 'border:1px solid #FECACA',
      'border-left:4px solid #EF4444', 'border-radius:12px',
      'box-shadow:0 8px 28px rgba(0,0,0,.16)', 'padding:13px 14px',
      "font-family:'DM Sans',system-ui,sans-serif", 'opacity:0',
      'transform:translateY(8px)', 'transition:opacity .2s,transform .2s',
    ].join(';');

    el.innerHTML = `
      <div style="display:flex;align-items:flex-start;gap:10px">
        <div style="width:30px;height:30px;border-radius:8px;background:#FEF2F2;display:flex;align-items:center;justify-content:center;flex-shrink:0">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#DC2626" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>
        </div>
        <div style="flex:1;min-width:0">
          <div style="font-size:13px;font-weight:700;color:#111827;line-height:1.3">Falha em ${_esc(titulo)}</div>
          <div style="font-size:12px;color:#B91C1C;margin-top:2px">${_esc(motivo)}</div>
          <div style="font-size:12px;color:#4B5563;margin-top:6px;line-height:1.5">${_esc(solucao)}</div>
          <a href="/pages/saude-sistema.html" style="display:inline-flex;align-items:center;gap:5px;margin-top:9px;font-size:12px;font-weight:600;color:#047857;text-decoration:none">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>
            Abrir Saúde do Sistema
          </a>
        </div>
        <button aria-label="Fechar" style="background:none;border:none;cursor:pointer;color:#9CA3AF;font-size:18px;line-height:1;padding:0 2px;flex-shrink:0">×</button>
      </div>`;

    const fechar = () => {
      el.style.opacity = '0'; el.style.transform = 'translateY(8px)';
      setTimeout(() => el.remove(), 220);
    };
    el.querySelector('button').addEventListener('click', fechar);
    c.appendChild(el);
    requestAnimationFrame(() => { el.style.opacity = '1'; el.style.transform = 'translateY(0)'; });
    setTimeout(fechar, AUTO_FECHA_MS);
  }

  function _esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // ── Interceptação do window.fetch ─────────────────────────────
  function _instalarWrap() {
    if (_wrapInstalado || typeof window.fetch !== 'function') return;
    _wrapInstalado = true;
    const _orig = window.fetch.bind(window);

    window.fetch = async function (input, init) {
      const url = typeof input === 'string' ? input : (input && input.url) || '';
      try {
        const resp = await _orig(input, init);
        // 5xx = falha de servidor/upstream; 4xx é erro esperado de cliente.
        if (_isMonitorada(url) && resp.status >= 500) {
          report({ url, motivo: `HTTP ${resp.status}` });
        }
        return resp;
      } catch (err) {
        if (_isMonitorada(url)) {
          const motivo = !navigator.onLine ? 'sem-conexao'
            : (err && (err.name === 'AbortError' || /abort/i.test(err.message || '')) ? 'timeout' : 'rede');
          report({ url, motivo });
        }
        throw err; // repassa: a página continua tratando o erro normalmente
      }
    };
  }

  function init() {
    if (window.__API_MONITOR_OFF) return;
    _instalarWrap();
    window.addEventListener('online', () => {
      try { toast && toast('Conexão restabelecida.', 'success'); } catch (_) {}
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  }
  init();

  return { init, report, _classificarFonte };
})();
