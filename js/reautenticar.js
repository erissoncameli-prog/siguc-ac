// ── SIGUC-AC · Reautenticação por senha + justificativa (Água) ──
// docs/qualidade-agua/plano-seguranca-dados.md, Camadas 3 e 4 — Opção A.
//
// A senha nunca passa pelo `db` da sessão de trabalho: reautentica num
// client Supabase ISOLADO (`persistSession:false`, nada gravado em
// localStorage/sessionStorage). `signInWithPassword` no client isolado
// cria uma sessão nova no GoTrue e carimba `auth.mfa_amr_claims`
// (authentication_method='password', updated_at=now()) para o MESMO
// usuário — é isso que `agua_reauth_valida()` verifica no servidor,
// sem depender de qual sessão fez a chamada. Zero infraestrutura nova.
//
// Senha e justificativa saem do MESMO modal — toda RPC de escrita
// (agua_atualizar_coleta etc.) exige as duas juntas, então pedir em
// dois passos separados só adicionaria clique sem adicionar segurança.
//
// Uso:
//   const r = await reautenticar({ janelaMin: 5, motivo: 'salvar a conferência' })
//   if (!r) return  // cancelado ou senha incorreta — já avisado ao usuário
//   await db.rpc('agua_atualizar_coleta', { p_id, p_campos, p_justificativa: r.justificativa })
//
// `janelaMin`: depois de uma reautenticação bem-sucedida, chamadas
// seguintes dentro desse número de minutos pulam o campo de SENHA (o
// modal ainda pede justificativa — cada gravação tem a sua). A trava de
// verdade é sempre o servidor (`agua_reauth_valida`), que aceitaria de
// qualquer forma; isto só evita digitar a senha de novo a cada linha
// da conferência em lote. Omitir ou usar 0 = sempre pede senha.

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
    <div class="modal" style="max-width:420px">
      <div class="modal-header">
        <div class="modal-title">Confirmar alteração</div>
        <button class="modal-close" onclick="_reautCancelar()">×</button>
      </div>
      <div class="modal-body">
        <p id="reaut-motivo" style="font-size:13px;color:#6B7280;margin:0 0 14px"></p>
        <div class="form-group" id="reaut-bloco-senha">
          <label class="form-label">Sua senha <span class="obrig">*</span></label>
          <input class="form-control" id="reaut-senha" type="password" autocomplete="current-password">
        </div>
        <div class="form-group">
          <label class="form-label">Justificativa <span class="obrig">*</span></label>
          <textarea class="form-control" id="reaut-justificativa" rows="2" placeholder="Por que esta alteração? (mínimo 20 caracteres)"></textarea>
        </div>
        <div id="reaut-erro" style="font-size:12px;color:#DC2626;display:none;margin-bottom:4px"></div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="_reautCancelar()">Cancelar</button>
        <button class="btn btn-primary" id="reaut-btn-confirmar" onclick="_reautConfirmar()">Confirmar</button>
      </div>
    </div>`
  document.body.appendChild(el)
}

let _reautResolve = null

function reautenticar({ janelaMin = 0, motivo = 'confirmar esta alteração' } = {}) {
  _reautJanelaMin = janelaMin
  const pulaSenha = janelaMin > 0 && Date.now() < _reautValidoAte

  _reautMontarModal()
  document.getElementById('reaut-motivo').textContent = `Por segurança, confirme para ${motivo}.`
  document.getElementById('reaut-bloco-senha').style.display = pulaSenha ? 'none' : ''
  document.getElementById('reaut-senha').value = ''
  document.getElementById('reaut-justificativa').value = ''
  document.getElementById('reaut-erro').style.display = 'none'
  document.getElementById('reaut-overlay').classList.add('aberto')
  setTimeout(() => document.getElementById(pulaSenha ? 'reaut-justificativa' : 'reaut-senha')?.focus(), 80)

  return new Promise(resolve => { _reautResolve = resolve })
}

function _reautCancelar() {
  document.getElementById('reaut-overlay')?.classList.remove('aberto')
  if (_reautResolve) { _reautResolve(null); _reautResolve = null }
}

async function _reautConfirmar() {
  const pulaSenha = document.getElementById('reaut-bloco-senha').style.display === 'none'
  const senha = document.getElementById('reaut-senha').value
  const justificativa = document.getElementById('reaut-justificativa').value.trim()
  const erroEl = document.getElementById('reaut-erro')
  erroEl.style.display = 'none'

  if (!pulaSenha && !senha) { erroEl.textContent = 'Informe a senha.'; erroEl.style.display = 'block'; return }
  if (justificativa.length < 20) { erroEl.textContent = 'Justificativa precisa de pelo menos 20 caracteres.'; erroEl.style.display = 'block'; return }

  const btn = document.getElementById('reaut-btn-confirmar')
  btn.disabled = true; btn.textContent = 'Confirmando...'
  try {
    if (!pulaSenha) {
      const email = appState.usuario?.email
      if (!email) throw new Error('Sessão inválida. Faça login novamente.')
      const { error } = await _reautCliente().auth.signInWithPassword({ email, password: senha })
      if (error) { erroEl.textContent = 'Senha incorreta.'; erroEl.style.display = 'block'; return }
      if (_reautJanelaMin > 0) _reautValidoAte = Date.now() + _reautJanelaMin * 60 * 1000
    }

    document.getElementById('reaut-overlay').classList.remove('aberto')
    if (_reautResolve) { _reautResolve({ justificativa }); _reautResolve = null }
  } catch (e) {
    erroEl.textContent = e.message || 'Não foi possível confirmar.'
    erroEl.style.display = 'block'
  } finally {
    btn.disabled = false; btn.textContent = 'Confirmar'
  }
}

// Encerra a janela local — chamar ao sair da tela de conferência, para
// não deixar uma janela "aberta" sem contexto na próxima visita.
function reautenticarEncerrarJanela() {
  _reautValidoAte = 0
}
