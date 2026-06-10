// SIGUC-AC · Loader de configuração pública
// Busca /api/env uma vez e reutiliza via Promise.
// Deve ser carregado ANTES de qualquer script que use loadEnv().

;(function () {
  if (window._sigucEnvPromise) return; // já carregado em outra tag

  window._sigucEnvPromise = fetch('/api/env')
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
