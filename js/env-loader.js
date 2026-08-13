// SIGUC-AC · Loader de configuração pública
// Busca /api/env uma vez e reutiliza via Promise.
// Deve ser carregado ANTES de qualquer script que use loadEnv().

;(function () {
  if (window._sigucEnvPromise) return; // já carregado em outra tag

  // Em localhost (checkout servido por servidor estático puro, sem a
  // função serverless /api/env — dev sem `vercel dev`, ou o servidor
  // do CI em tests/agua-iqa.test.js e tests/frota-app-barra.test.js)
  // o caminho relativo dá 404 e o cliente nunca fica pronto. Mesmo
  // fallback que js/config.js já usa: nesses casos busca a config
  // pública (URL + anon key, sem segredo nenhum) direto da produção.
  var _envBase = '';
  try {
    if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
      _envBase = 'https://siguc-ac.vercel.app';
    }
  } catch (e) { /* location indisponível — mantém caminho relativo */ }

  window._sigucEnvPromise = fetch(_envBase + '/api/env')
    .then(function (r) {
      if (!r.ok) throw new Error('env ' + r.status);
      return r.json();
    })
    .catch(function (e) {
      console.error('[SIGUC] Falha ao carregar configuração de ambiente:', e);
      return { supabaseUrl: '', supabaseKey: '' };
    });
})();

function loadEnv() {
  return window._sigucEnvPromise;
}
