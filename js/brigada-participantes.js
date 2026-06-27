// ── SIGUC Brigadas — Sub-formulário de Participantes ──────────
// Educação ambiental: lista nominal de participantes alcançados.
// Mantém os registros em memória antes de salvar a ocorrência.

let _participantesList = []   // participantes do registro atual em edição

// ── Estado ────────────────────────────────────────────────────
function bPartGetLista()      { return [..._participantesList] }
function bPartLimpar()        { _participantesList = [] }
function bPartCarregar(lista) { _participantesList = lista ? [...lista] : [] }

// ── CRUD em memória ───────────────────────────────────────────
function bPartAdicionar(item) {
  _participantesList.push({ ...item, _id: crypto.randomUUID() })
  return _participantesList.length - 1
}

function bPartAtualizar(idx, item) {
  if (idx < 0 || idx >= _participantesList.length) return
  _participantesList[idx] = { ..._participantesList[idx], ...item }
}

function bPartRemover(idx) {
  _participantesList.splice(idx, 1)
}

// ── CPF: máscara + validação de dígitos verificadores ─────────
// Só dígitos são guardados; a máscara é aplicada apenas na exibição.
function bPartCpfDigitos(v) { return (v || '').replace(/\D/g, '').slice(0, 11) }

function bPartCpfMascara(v) {
  const d = bPartCpfDigitos(v)
  if (!d) return ''
  return d
    .replace(/^(\d{3})(\d)/, '$1.$2')
    .replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/^(\d{3})\.(\d{3})\.(\d{3})(\d)/, '$1.$2.$3-$4')
}

// Aplica a máscara ao vivo enquanto o brigadista digita.
function bPartCpfBindMascara(inputEl) {
  inputEl.addEventListener('input', () => {
    inputEl.value = bPartCpfMascara(inputEl.value)
  })
}

// true para CPF válido OU vazio (CPF é opcional). Rejeita só os
// preenchidos incorretamente, evitando travar o registro em campo.
function bPartCpfValido(v) {
  const cpf = bPartCpfDigitos(v)
  if (!cpf) return true
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false
  const dig = cpf.split('').map(Number)
  for (let t = 9; t < 11; t++) {
    let soma = 0
    for (let i = 0; i < t; i++) soma += dig[i] * (t + 1 - i)
    let resto = (soma * 10) % 11
    if (resto === 10) resto = 0
    if (resto !== dig[t]) return false
  }
  return true
}

// ── Labels ────────────────────────────────────────────────────
function bPartLabelSexo(v) {
  const m = { masculino: 'Masculino', feminino: 'Feminino',
              outro: 'Outro', nao_informado: 'Não informado' }
  return m[v] || '—'
}

function bPartIdade(dataNasc) {
  if (!dataNasc) return null
  const n = new Date(dataNasc)
  if (isNaN(n)) return null
  const hoje = new Date()
  let idade = hoje.getFullYear() - n.getFullYear()
  const m = hoje.getMonth() - n.getMonth()
  if (m < 0 || (m === 0 && hoje.getDate() < n.getDate())) idade--
  return idade >= 0 && idade < 130 ? idade : null
}

// ── Renderizar lista resumida na UI ───────────────────────────
function bPartRenderLista(containerEl, onEditar, onRemover) {
  if (!_participantesList.length) {
    containerEl.innerHTML = '<p class="fauna-vazia">Nenhum participante cadastrado</p>'
    return
  }

  containerEl.innerHTML = _participantesList.map((p, i) => {
    const det = []
    if (p.cpf)             det.push(bPartCpfMascara(p.cpf))
    const idade = bPartIdade(p.data_nascimento)
    if (idade != null)     det.push(`${idade} anos`)
    if (p.sexo)            det.push(bPartLabelSexo(p.sexo))
    return `
      <div class="fauna-item" data-i="${i}">
        <span class="fauna-icon">${bico('user')}</span>
        <div class="fauna-info">
          <strong>${esc(p.nome || 'Sem nome')}</strong>
          <span>${esc(det.join(' · ') || '—')}</span>
        </div>
        <div class="fauna-acoes">
          <button class="btn-part-edit" data-i="${i}" aria-label="Editar" data-icon="edit"></button>
          <button class="btn-part-del" data-i="${i}" aria-label="Remover" data-icon="trash"></button>
        </div>
      </div>
    `
  }).join('')

  bIconsAplicar(containerEl)

  containerEl.querySelectorAll('.btn-part-edit').forEach(btn => {
    btn.addEventListener('click', () => onEditar && onEditar(Number(btn.dataset.i)))
  })
  containerEl.querySelectorAll('.btn-part-del').forEach(btn => {
    btn.addEventListener('click', () => {
      bPartRemover(Number(btn.dataset.i))
      bPartRenderLista(containerEl, onEditar, onRemover)
      if (onRemover) onRemover()
    })
  })
}
