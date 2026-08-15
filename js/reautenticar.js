// ── SIGUC-AC · Reautenticação por senha (Qualidade da Água) ──────
// docs/qualidade-agua/plano-seguranca-dados.md, Camada 3 — Opção A.
//
// A senha nunca passa pelo `db` da sessão de trabalho: reautentica num
// client Supabase ISOLADO (`persistSession:false`, nada gravado em
// localStorage/sessionStorage). `signInWithPassword` no client isolado
// cria uma sessão nova no GoTrue e carimba `auth.mfa_amr_claims`
// (authentication_method='password', updated_at=now()) para o MESMO
// usuário — é isso que `agua_reauth_valida()` verifica no servidor,
// sem depender de qual sessão fez a chamada. Zero infraestrutura nova.
//
// Uso:
//   const ok = await reautenticar({ janelaMin: 5, motivo: 'salvar a conferência' })
//   if (!ok) return  // cancelado ou senha incorreta — já avisado ao usuário
//
// `janelaMin`: depois de uma reautenticação bem-sucedida, chamadas
// seguintes dentro desse número de minutos NÃO mostram o modal de novo
// (conveniência de tela — a trava de verdade é sempre o servidor, que
// teria aceitado de qualquer forma; isto só evita perguntar de novo).
// Omitir ou usar 0 = sempre pede senha.

let _reautClienteIsolado = null
let _reautValidoAte = 0
let _reautJanelaMin = 0

function _reautCliente() {
  if (_reautClienteIsolado) return _reautClienteIsolado
  _reautClienteIsolado = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
  return _reautClienteIsolado
}

function _reautMontarModal() {
  if (document.getElementById('reaut-overlay')) return
  const el = document.createElement('div')
  el.id = 'reaut-overlay'
  el.className = 'modal-overlay'
  el.innerHTML = `
    <div class="modal" style="max-width:380px">
      <div class="modal-header">
        <div class="modal-title">Confirme sua senha</div>
        <button class="modal-close" onclick="_reautCancelar()">×</button>
      </div>
      <div class="modal-body">
        <p id="reaut-motivo" style="font-size:13px;color:#6B7280;margin:0 0 14px"></p>
        <div class="form-group">
          <label class="form-label">Senha <span class="obrig">*</span></label>
          <input class="form-control" id="reaut-senha" type="password" autocomplete="current-password">
        </div>
        <div id="reaut-erro" style="font-size:12px;color:#DC2626;display:none;margin-top:-8px;margin-bottom:8px"></div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="_reautCancelar()">Cancelar</button>
        <button class="btn btn-primary" id="reaut-btn-confirmar" onclick="_reautConfirmar()">Confirmar</button>
      </div>
    </div>`
  document.body.appendChild(el)
  document.getElementById('reaut-senha').addEventListener('keydown', e => {
    if (e.key === 'Enter') _reautConfirmar()
  })
}

let _reautResolve = null

function reautenticar({ janelaMin = 0, motivo = 'confirmar esta alteração' } = {}) {
  if (janelaMin > 0 && Date.now() < _reautValidoAte) return Promise.resolve(true)
  _reautJanelaMin = janelaMin

  _reautMontarModal()
  document.getElementById('reaut-motivo').textContent = `Por segurança, confirme sua senha para ${motivo}.`
  document.getElementById('reaut-senha').value = ''
  document.getElementById('reaut-erro').style.display = 'none'
  document.getElementById('reaut-overlay').classList.add('aberto')
  setTimeout(() => document.getElementById('reaut-senha')?.focus(), 80)

  return new Promise(resolve => { _reautResolve = resolve })
}

function _reautCancelar() {
  document.getElementById('reaut-overlay')?.classList.remove('aberto')
  if (_reautResolve) { _reautResolve(false); _reautResolve = null }
}

async function _reautConfirmar() {
  const senha = document.getElementById('reaut-senha').value
  const erroEl = document.getElementById('reaut-erro')
  erroEl.style.display = 'none'
  if (!senha) { erroEl.textContent = 'Informe a senha.'; erroEl.style.display = 'block'; return }

  const btn = document.getElementById('reaut-btn-confirmar')
  btn.disabled = true; btn.textContent = 'Confirmando...'
  try {
    const email = appState.usuario?.email
    if (!email) throw new Error('Sessão inválida. Faça login novamente.')
    const { error } = await _reautCliente().auth.signInWithPassword({ email, password: senha })
    if (error) { erroEl.textContent = 'Senha incorreta.'; erroEl.style.display = 'block'; return }

    if (_reautJanelaMin > 0) _reautValidoAte = Date.now() + _reautJanelaMin * 60 * 1000
    document.getElementById('reaut-overlay').classList.remove('aberto')
    if (_reautResolve) { _reautResolve(true); _reautResolve = null }
  } catch (e) {
    erroEl.textContent = e.message || 'Não foi possível confirmar a senha.'
    erroEl.style.display = 'block'
  } finally {
    btn.disabled = false; btn.textContent = 'Confirmar'
  }
}

// Reseta a janela local — usado quando o usuário sai da tela de
// conferência, para não deixar uma janela "aberta" sem contexto.
function reautenticarEncerrarJanela() {
  _reautValidoAte = 0
}
