// ── SIGUC Brigadas — Sub-formulário de Fauna ──────────────────
// Gerencia a lista de registros de fauna em memória antes de salvar

let _faunaList = []       // fauna do registro atual em edição
let _faunaEditIdx = null  // índice sendo editado (-1 = novo)

// ── Estado ────────────────────────────────────────────────────
function bFaunaGetLista() { return [..._faunaList] }

function bFaunaLimpar() {
  _faunaList    = []
  _faunaEditIdx = null
}

function bFaunaCarregar(lista) { _faunaList = lista ? [...lista] : [] }

// ── CRUD em memória ───────────────────────────────────────────
function bFaunaAdicionar(item) {
  _faunaList.push({ ...item, _id: crypto.randomUUID() })
  return _faunaList.length - 1
}

function bFaunaAtualizar(idx, item) {
  if (idx < 0 || idx >= _faunaList.length) return
  _faunaList[idx] = { ..._faunaList[idx], ...item }
}

function bFaunaRemover(idx) {
  _faunaList.splice(idx, 1)
}

// ── Renderizar lista resumida na UI ───────────────────────────
function bFaunaRenderLista(containerEl, onEditar, onRemover) {
  if (!_faunaList.length) {
    containerEl.innerHTML = '<p class="fauna-vazia">Nenhum animal registrado</p>'
    return
  }

  containerEl.innerHTML = _faunaList.map((f, i) => {
    const nome  = f.nome_popular || f.especie_nome_cientifico || 'Espécie não identificada'
    const cond  = bFaunaLabelCondicao(f.condicao)
    const tipo  = bFaunaLabelTipo(f.tipo_evento)
    const icon  = bFaunaIconeClasse(f.classe)
    return `
      <div class="fauna-item" data-i="${i}">
        <span class="fauna-icon">${icon}</span>
        <div class="fauna-info">
          <strong>${esc(nome)}</strong>
          <span>${tipo} · ${cond}</span>
        </div>
        <div class="fauna-acoes">
          <button class="btn-fauna-edit" data-i="${i}" aria-label="Editar">✏️</button>
          <button class="btn-fauna-del" data-i="${i}" aria-label="Remover">🗑</button>
        </div>
      </div>
    `
  }).join('')

  containerEl.querySelectorAll('.btn-fauna-edit').forEach(btn => {
    btn.addEventListener('click', () => onEditar && onEditar(Number(btn.dataset.i)))
  })
  containerEl.querySelectorAll('.btn-fauna-del').forEach(btn => {
    btn.addEventListener('click', () => {
      bFaunaRemover(Number(btn.dataset.i))
      bFaunaRenderLista(containerEl, onEditar, onRemover)
      if (onRemover) onRemover()
    })
  })
}

// ── Busca de espécies (offline-first) ────────────────────────
async function bFaunaBuscar(query) {
  // Tenta o catálogo local primeiro
  const local = await bOfflineBuscarEspecies(query)
  if (local.length) return local

  // Fallback: busca no Supabase (só quando online)
  if (!navigator.onLine) return []
  try {
    const { data } = await db
      .from('especies_fauna')
      .select('id, nome_cientifico, nomes_populares, classe, status_conservacao')
      .or(`nome_cientifico.ilike.%${query}%`)
      .limit(10)
    return data || []
  } catch { return [] }
}

// ── Autocompletar espécie ─────────────────────────────────────
function bFaunaBindAutocompletar(inputEl, listaEl, onSelect) {
  let debounce = null
  inputEl.addEventListener('input', () => {
    clearTimeout(debounce)
    const q = inputEl.value.trim()
    if (q.length < 2) { listaEl.innerHTML = ''; return }
    debounce = setTimeout(async () => {
      const resultados = await bFaunaBuscar(q)
      listaEl.innerHTML = resultados.map(e => {
        const pop = (e.nomes_populares || []).slice(0,2).join(', ')
        return `<li data-id="${e.id}" data-nome="${esc(e.nome_cientifico)}" data-pop="${esc(pop)}" data-classe="${esc(e.classe || '')}">${esc(e.nome_cientifico)}${pop ? ' — ' + esc(pop) : ''}</li>`
      }).join('')
      listaEl.querySelectorAll('li').forEach(li => {
        li.addEventListener('click', () => {
          onSelect && onSelect({
            especie_id: li.dataset.id,
            especie_nome_cientifico: li.dataset.nome,
            nome_popular: li.dataset.pop,
            classe: li.dataset.classe,
          })
          listaEl.innerHTML = ''
          inputEl.value = li.dataset.nome
        })
      })
    }, 280)
  })
}

// ── Labels ────────────────────────────────────────────────────
function bFaunaLabelCondicao(v) {
  const m = { integro:'Íntegro', ferido:'Ferido', debilitado:'Debilitado',
              queimado:'Queimado', obito:'Óbito' }
  return m[v] || v || '—'
}

function bFaunaLabelTipo(v) {
  const m = { resgate:'Resgate', avistamento:'Avistamento', atropelamento:'Atropelamento',
              apreensao:'Apreensão', encontrado_morto:'Encontrado morto' }
  return m[v] || v || '—'
}

function bFaunaIconeClasse(v) {
  const m = { mamifero:'🦌', ave:'🦜', reptil:'🦎', anfibio:'🐸',
              peixe:'🐟', invertebrado:'🦋', nao_sei:'❓' }
  return m[v] || '🐾'
}
