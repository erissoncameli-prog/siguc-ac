// ── SIGUC Frota — passageiros da viagem ───────────────────────
//
// Fonte única do editor e da exibição da lista de passageiros, usada
// pelas superfícies que compõem o MESMO fluxo (regra de duplicação
// obrigatória do módulo Frota):
//   - pages/frota-solicitar.html (mesa, solicita)
//   - pages/frota-app.html       (app: solicitante, gestor, motorista)
//   - pages/frota-viagens.html   (mesa, aprova/recusa)
//
// Mesma lição do js/frota-consumo.js: se cada tela montar a sua
// versão, a próxima correção conserta uma e esquece as outras.
//
// MODELO — cada passageiro é uma linha em `frota_viagem_passageiros`
// (migration 235). A view vw_frota_viagens_detalhe já entrega o array
// pronto em `passageiros_lista`; `lista_passageiros` (texto livre da
// migration 184) fica como histórico das viagens antigas e é o
// fallback de leitura aqui.
//
// LGPD — "necessidade específica" é dado de saúde (Art. 5º, II),
// tratado no ROPA como TRAT-017. Duas decisões que vivem NESTE
// arquivo e não devem ser desfeitas sem alinhamento:
//   1. As sugestões de necessidade são uma lista FIXA no código.
//      Nada de alimentar `frota_registrar_sugestao` (o catálogo
//      aprendido da manutenção): ele é global, então a necessidade
//      de um passageiro apareceria no autocompletar de todos os
//      outros solicitantes.
//   2. O formulário sempre exibe o aviso de que o dado é do
//      passageiro, não de quem preenche — transparência do Art. 9º
//      para quem nem usuário do sistema é.

const FP_SEXOS = [
  ['', 'Não informar'],
  ['masculino', 'Masculino'],
  ['feminino', 'Feminino'],
  ['outro', 'Outro'],
]

const FP_SEXO_LABEL = {
  masculino: 'Masculino', feminino: 'Feminino',
  outro: 'Outro', nao_informado: 'Não informado',
}

// Sugestões de acessibilidade — atalho de digitação, não taxonomia
// fechada: o campo continua sendo texto livre.
const FP_NECESSIDADES = [
  'Cadeira de rodas', 'Mobilidade reduzida', 'Gestante',
  'Criança (uso de cadeirinha)', 'Deficiência visual',
  'Deficiência auditiva', 'Pessoa idosa',
]

// Estado do formulário aberto. Uma superfície só tem um formulário de
// solicitação por vez (na mesa ele é estático; no app a tela é
// remontada a cada troca de aba), então um único array basta.
let _fpLista = []

// Estado da busca de passageiro na base de usuários (autocomplete).
// `_fpUltimosResultados` guarda os resultados da última busca — o
// onclick de cada item referencia só o ÍNDICE (nunca dado digitado
// embutido no HTML), pra não abrir brecha de injeção com nome que
// tenha aspas. Achado ao desenhar isto (ver migration 236): a policy
// de leitura de `usuarios` em produção já libera qualquer autenticado
// a ler nome/telefone de qualquer colega — por isso a busca é uma
// consulta comum, sem RPC privilegiada.
let _fpBuscaTimer = null
let _fpUsuarioSelecionado = null
let _fpUltimosResultados = []

function fpLista() { return _fpLista.map(p => Object.assign({}, p)) }

// Payload no formato que a RPC frota_solicitar_viagem espera.
function fpPayload() {
  return _fpLista.map(p => ({
    nome: p.nome,
    sexo: p.sexo || null,
    necessidade_especifica: p.necessidade_especifica || null,
    usuario_id: p.usuario_id || null,
  }))
}

function fpDefinirLista(arr) {
  _fpLista = (arr || [])
    .filter(p => p && (p.nome || '').trim().length >= 2)
    .map(p => ({
      nome: String(p.nome).trim().slice(0, 120),
      sexo: p.sexo && p.sexo !== 'nao_informado' ? p.sexo : null,
      necessidade_especifica: (p.necessidade_especifica || '').trim().slice(0, 200) || null,
      usuario_id: p.usuario_id || null,
    }))
  fpRenderLista()
}

function fpLimpar() { fpDefinirLista([]) }

// ── Editor ────────────────────────────────────────────────────
// `compacto` = app de campo (campos empilhados; a linha horizontal da
// mesa não cabe em celular).
function fpFormHTML(opts) {
  const compacto = !!(opts && opts.compacto)
  // Campo de nome com busca incremental na base de usuários — quem já
  // é cadastrado no sistema entra com telefone pronto (resolvido ao
  // vivo pela view, nunca copiado pra linha do passageiro).
  const campoNome = `<div style="position:relative">
         <input class="form-control" id="fp-nome" placeholder="Nome do passageiro" maxlength="120"
                autocomplete="off" oninput="fpNomeAlterado()" style="width:100%">
         <div id="fp-resultados" style="display:none;position:absolute;left:0;right:0;top:100%;z-index:20;
              background:#fff;border:1px solid #E5E7EB;border-radius:8px;box-shadow:0 4px 14px rgba(0,0,0,.1);
              max-height:220px;overflow-y:auto;margin-top:2px"></div>
       </div>`
  const linha = compacto
    ? `<div style="display:flex;flex-direction:column;gap:8px">
         ${campoNome}
         <select class="form-control" id="fp-sexo">${FP_SEXOS.map(s => `<option value="${s[0]}">${s[1]}</option>`).join('')}</select>
       </div>`
    : `<div style="display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap">
         <div style="flex:2;min-width:180px">${campoNome}</div>
         <select class="form-control" id="fp-sexo" style="flex:1;min-width:150px">${FP_SEXOS.map(s => `<option value="${s[0]}">${s[1]}</option>`).join('')}</select>
       </div>`

  return `
    <div class="form-group">
      <label class="form-label">Passageiros</label>
      <div id="fp-lista" style="margin-bottom:8px"></div>
      ${linha}
      <label style="display:flex;align-items:center;gap:8px;font-size:13px;color:#374151;margin:10px 0 0;cursor:pointer">
        <input type="checkbox" id="fp-tem-nec" onchange="fpToggleNecessidade()" style="width:16px;height:16px">
        Precisa de necessidade específica (acessibilidade, limitação)
      </label>
      <div id="fp-nec-campo" style="display:none;margin-top:8px">
        <input class="form-control" id="fp-nec" list="dl-fp-necessidades" maxlength="200"
               placeholder="Ex.: cadeira de rodas, mobilidade reduzida...">
        <datalist id="dl-fp-necessidades">${FP_NECESSIDADES.map(n => `<option value="${n}">`).join('')}</datalist>
      </div>
      <button type="button" class="btn btn-secondary btn-sm" onclick="fpAdicionar()"
              style="margin-top:10px${compacto ? ';width:100%' : ''}">Adicionar passageiro</button>
      <div style="font-size:11px;color:#9CA3AF;margin-top:8px;line-height:1.5">
        Informe só o que a viagem exige. A necessidade específica é usada para escalar
        um veículo adequado, fica visível ao motorista escalado e à gestão da frota, e
        é apagada 90 dias depois da viagem.
      </div>
    </div>`
}

function fpToggleNecessidade() {
  const marcado = document.getElementById('fp-tem-nec').checked
  document.getElementById('fp-nec-campo').style.display = marcado ? '' : 'none'
  if (marcado) document.getElementById('fp-nec').focus()
  else document.getElementById('fp-nec').value = ''
}

// ── Busca de passageiro na base de usuários ────────────────────
// Debounced: só busca depois de parar de digitar, e só a partir de 2
// letras (evita disparar consulta a cada tecla e enumeração trivial).
function fpNomeAlterado() {
  _fpUsuarioSelecionado = null
  const termo = document.getElementById('fp-nome').value.trim()
  clearTimeout(_fpBuscaTimer)
  if (termo.length < 2) { fpFecharResultados(); return }
  _fpBuscaTimer = setTimeout(() => fpBuscarUsuarios(termo), 300)
}

async function fpBuscarUsuarios(termo) {
  const { data, error } = await db.from('usuarios')
    .select('id,nome_completo,telefone')
    .eq('ativo', true)
    .ilike('nome_completo', `%${termo}%`)
    .order('nome_completo')
    .limit(8)
  _fpUltimosResultados = (!error && data) ? data : []
  fpRenderResultados()
}

function fpRenderResultados() {
  const el = document.getElementById('fp-resultados')
  if (!el) return
  if (!_fpUltimosResultados.length) { el.innerHTML = ''; el.style.display = 'none'; return }
  el.innerHTML = _fpUltimosResultados.map((u, i) => `
    <div style="padding:7px 10px;cursor:pointer;font-size:13px;border-bottom:1px solid #F3F4F6" onclick="fpEscolherUsuario(${i})">
      ${esc(u.nome_completo)}${u.telefone ? `<span style="color:#9CA3AF"> · ${esc(u.telefone)}</span>` : ''}
    </div>`).join('')
  el.style.display = ''
}

// Prefill do nome + vínculo. O telefone NÃO é copiado pra cá — a
// tela de leitura resolve ele ao vivo (join na view), então continua
// certo se a pessoa trocar de telefone depois de entrar na viagem.
function fpEscolherUsuario(i) {
  const u = _fpUltimosResultados[i]
  if (!u) return
  document.getElementById('fp-nome').value = u.nome_completo.slice(0, 120)
  _fpUsuarioSelecionado = u.id
  fpFecharResultados()
}

function fpFecharResultados() {
  _fpUltimosResultados = []
  const el = document.getElementById('fp-resultados')
  if (el) { el.innerHTML = ''; el.style.display = 'none' }
}

function fpRenderLista() {
  const el = document.getElementById('fp-lista')
  if (!el) return
  el.innerHTML = !_fpLista.length
    ? '<div style="font-size:12px;color:#9CA3AF">Nenhum passageiro adicionado</div>'
    : _fpLista.map((p, i) => `
      <div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid #F3F4F6;font-size:13px">
        <span style="flex:1;min-width:0">
          <strong>${esc(p.nome)}</strong>${p.sexo ? `<span style="color:#9CA3AF"> · ${FP_SEXO_LABEL[p.sexo] || ''}</span>` : ''}${p.usuario_id ? `<span style="color:#059669"> · cadastrado no sistema</span>` : ''}
          ${p.necessidade_especifica ? `<div style="font-size:11px;color:#92400E">Necessidade específica: ${esc(p.necessidade_especifica)}</div>` : ''}
        </span>
        <button type="button" class="btn btn-xs btn-ghost" style="color:#DC2626" onclick="fpRemover(${i})">${bico('trash')}</button>
      </div>`).join('')
  bIconsAplicar(el)
  fpSincronizarContagem()
}

// O nº de passageiros passa a ser derivado da lista quando ela existe
// — o campo continua editável para quem ainda não sabe os nomes. Os
// dois formulários usam o mesmo id (`f-passageiros`), porque um é
// clone do outro.
function fpSincronizarContagem() {
  const campo = document.getElementById('f-passageiros')
  if (!campo || !_fpLista.length) return
  if ((parseInt(campo.value) || 0) < _fpLista.length) campo.value = _fpLista.length
  // `checarPassageiros` é da página (mostra o aviso de "mais de 4") e
  // assume o formulário inteiro montado — só chama com ele em tela.
  if (typeof checarPassageiros === 'function' && document.getElementById('aviso-passageiros')) checarPassageiros()
}

function fpAdicionar() {
  const nome = document.getElementById('fp-nome').value.trim()
  if (nome.length < 2) { toast('Informe o nome do passageiro', 'error'); return }
  const temNec = document.getElementById('fp-tem-nec').checked
  const nec = document.getElementById('fp-nec').value.trim()
  if (temNec && nec.length < 2) { toast('Descreva a necessidade específica ou desmarque a opção', 'error'); return }

  _fpLista.push({
    nome: nome.slice(0, 120),
    sexo: document.getElementById('fp-sexo').value || null,
    necessidade_especifica: temNec ? nec.slice(0, 200) : null,
    usuario_id: _fpUsuarioSelecionado,
  })
  document.getElementById('fp-nome').value = ''
  document.getElementById('fp-sexo').value = ''
  document.getElementById('fp-tem-nec').checked = false
  _fpUsuarioSelecionado = null
  fpFecharResultados()
  fpToggleNecessidade()
  fpRenderLista()
  document.getElementById('fp-nome').focus()
}

function fpRemover(i) {
  _fpLista.splice(i, 1)
  fpRenderLista()
}

// ── Leitura (viagem já salva) ─────────────────────────────────
// Normaliza as duas gerações de dado: `passageiros_lista` (estruturado,
// migration 235) e `lista_passageiros` (texto livre, migration 184).
function fpDaViagem(v) {
  if (!v) return []
  const lista = v.passageiros_lista
  const arr = typeof lista === 'string' ? JSON.parse(lista || '[]') : (lista || [])
  if (arr.length) return arr
  return String(v.lista_passageiros || '')
    .split('\n').map(n => n.trim()).filter(n => n.length >= 2)
    .map(nome => ({ nome, sexo: null, necessidade_especifica: null }))
}

// Uma linha só, para tabelas e cards compactos.
function fpTextoPassageiros(v) {
  return fpDaViagem(v).map(p => p.nome).join(', ')
}

// Bloco de leitura para os detalhes da viagem (solicitante, gestor,
// motorista).
function fpResumoHTML(v) {
  const pax = fpDaViagem(v)
  if (!pax.length) return ''
  return `<div style="margin-top:6px">${pax.map(p => `
    <div style="font-size:12px;padding:3px 0">
      ${esc(p.nome)}${p.sexo ? `<span style="color:#9CA3AF"> · ${FP_SEXO_LABEL[p.sexo] || ''}</span>` : ''}
      ${p.necessidade_especifica
        ? `<span style="display:inline-block;background:#FEF3C7;color:#92400E;border-radius:6px;padding:1px 7px;margin-left:6px">${esc(p.necessidade_especifica)}</span>`
        : ''}
    </div>`).join('')}</div>`
}

// Alerta das telas de aprovação — é por causa dele que a necessidade
// é coletada: o gestor precisa disso ANTES de escolher o veículo.
function fpAlertaNecessidadesHTML(v) {
  const comNec = fpDaViagem(v).filter(p => p.necessidade_especifica)
  if (!comNec.length) return ''
  return `<div style="font-size:12px;background:#FEF3C7;color:#92400E;padding:8px 12px;border-radius:8px;margin-bottom:14px">
    <strong>${comNec.length} passageiro(s) com necessidade específica</strong> — considere um veículo adequado.
    ${comNec.map(p => `<div style="margin-top:4px">${esc(p.nome)}: ${esc(p.necessidade_especifica)}</div>`).join('')}
  </div>`
}

// ── Divisão em vários veículos ─────────────────────────────────
// Par obrigatório: frota-viagens.html (modo múltiplo da aprovação) e
// frota-app.html modo gestor. As duas páginas mantêm seu próprio array
// de alocações (_linhasAlocacao / _linhasAlocacaoG) — cada linha é
// {veiculo_id, motorista_id, passageiros, passageiro_ids}. Estas
// funções só operam sobre o array que a página passa; quem chama é
// dono do re-render (cada página tem sua própria render*).

// Distribui os passageiros NOMEADOS da viagem (os que têm `id` —
// vieram de frota_viagem_passageiros, migration 235) entre as linhas.
// Só mexe na composição de nomes: veículo e motorista sugeridos por
// frota_sugerir_alocacao não são tocados — o gestor sempre pode
// corrigir depois pelo seletor de cada chip. Viagem sem lista
// estruturada (antiga, ou só o número preenchido) não é afetada.
//
// A COTA de cada linha manda: é quanto frota_sugerir_alocacao reservou
// para aquele veículo, respeitando a capacidade dele (migration 242).
// Sem isso, o round-robin cego podia pôr 3 nomes num carro de 2
// lugares quando os veículos escalados têm capacidades diferentes.
// Linha sem cota — a que o gestor acabou de adicionar à mão — cai no
// rodízio igualitário de antes, que para veículos iguais dá o mesmo
// resultado (6 passageiros em 2 veículos = 3 e 3).
function fpDistribuirLinhas(linhas, viagem) {
  const pax = fpDaViagem(viagem).filter(p => p.id)
  if (!pax.length || !linhas.length) return
  const cotas = linhas.map(l => l.passageiros || 0)
  const temCota = cotas.some(c => c > 0)
  linhas.forEach(l => { l.passageiro_ids = [] })
  let prox = 0
  pax.forEach(p => {
    let alvo = -1
    if (temCota) {
      // Primeira linha, a partir da última usada, que ainda tem vaga na
      // cota — mantém o rodízio dentro do que cabe.
      for (let k = 0; k < linhas.length; k++) {
        const j = (prox + k) % linhas.length
        if (linhas[j].passageiro_ids.length < cotas[j]) { alvo = j; break }
      }
    }
    // Sem cota, ou cotas todas cheias (frota não cobre o grupo): rodízio
    // simples. O excedente fica visível na tela — cada linha avisa
    // quando passa da capacidade do veículo.
    if (alvo === -1) alvo = prox % linhas.length
    linhas[alvo].passageiro_ids.push(p.id)
    prox = alvo + 1
  })
  linhas.forEach(l => { l.passageiros = l.passageiro_ids.length })
}

// Nenhum veículo elegível no período: o banco não tem o que sugerir e
// a tela já avisa disso. As linhas nascem vazias mas com o grupo
// PARTIDO em dois — antes a primeira linha vinha com o grupo inteiro
// dentro, que é justamente o que se quer evitar.
function fpLinhasVazias(total) {
  const t = Math.max(total || 1, 1)
  const metade = Math.ceil(t / 2)
  return [
    { veiculo_id: null, motorista_id: null, passageiros: metade },
    { veiculo_id: null, motorista_id: null, passageiros: t - metade },
  ]
}

// Aviso do topo do modal de aprovação: quem decide se o grupo cabe em
// um veículo é a frota (frota_sugerir_alocacao, migration 242), não um
// número fixo no HTML. `capacidadeTotal` é a soma da capacidade dos
// veículos sugeridos — quando não cobre o grupo, o gestor precisa
// saber ANTES de aprovar. `preSelecionado` diz se os veículos já vêm
// escolhidos (só intermunicipal, onde existe rodízio) ou se o gestor
// ainda vai escolher — o texto não pode prometer o que a tela não fez.
function fpAvisoDivisaoHTML(veiculos, total, capacidadeTotal, preSelecionado) {
  if (!veiculos || veiculos < 2) return ''
  const falta = (total || 0) - (capacidadeTotal || 0)
  return `<strong>${total} passageiros não cabem em um veículo só.</strong>
    ${preSelecionado
      ? `Já escalamos ${veiculos} veículos com os passageiros divididos entre eles — confira abaixo e ajuste se precisar.`
      : `Dividimos o grupo em ${veiculos} veículos com os passageiros já repartidos — escolha o veículo e o motorista de cada um abaixo.`}
    ${falta > 0 ? `<div style="margin-top:4px">Atenção: ainda faltam lugares para ${falta} passageiro(s) — não há veículo disponível suficiente nesse período.</div>` : ''}`
}

// Move um passageiro pra `novoIndice`. Resincroniza só a contagem das
// linhas de origem e destino — uma linha sem passageiro nomeado nenhum
// mantém o número que o gestor digitou à mão (headcount sem nome).
function fpMoverPassageiro(linhas, idPassageiro, novoIndice) {
  linhas.forEach(l => {
    const pos = (l.passageiro_ids || []).indexOf(idPassageiro)
    if (pos !== -1) { l.passageiro_ids.splice(pos, 1); l.passageiros = l.passageiro_ids.length }
  })
  const alvo = linhas[novoIndice]
  if (!alvo) return
  alvo.passageiro_ids = alvo.passageiro_ids || []
  alvo.passageiro_ids.push(idPassageiro)
  alvo.passageiros = alvo.passageiro_ids.length
}

// Ao remover uma linha, os passageiros dela não podem ficar órfãos:
// caem na linha 0 — mesmo destino padrão de quem nunca foi remanejado
// (ver frota_aprovar_viagem_multipla, migration 236).
function fpRemoverLinhaComPassageiros(linhas, i) {
  const [removida] = linhas.splice(i, 1)
  if (removida && removida.passageiro_ids && removida.passageiro_ids.length && linhas[0]) {
    linhas[0].passageiro_ids = (linhas[0].passageiro_ids || []).concat(removida.passageiro_ids)
    linhas[0].passageiros = linhas[0].passageiro_ids.length
  }
}

// Chips dos passageiros de UMA linha, com seletor pra mover pra outra
// linha. `onMoverFn` é o NOME (string) da função global que a página
// expõe pra reagir ao onchange e re-renderizar — cada página tem seu
// próprio array de alocações, então quem sabe redesenhar a tela é ela.
function fpChipsLinhaHTML(linhas, i, viagem, onMoverFn) {
  const l = linhas[i]
  if (!l || !l.passageiro_ids || !l.passageiro_ids.length) return ''
  const porId = {}
  fpDaViagem(viagem).forEach(p => { if (p.id) porId[p.id] = p })
  return `<div style="margin:6px 0 8px;display:flex;flex-direction:column;gap:4px">` +
    l.passageiro_ids.map(id => {
      const p = porId[id]
      if (!p) return ''
      return `<div style="display:flex;align-items:center;gap:6px;font-size:12px;background:#F9FAFB;border-radius:6px;padding:4px 8px">
        <span style="flex:1;min-width:0">${esc(p.nome)}${p.necessidade_especifica ? `<span style="color:#92400E"> · ${esc(p.necessidade_especifica)}</span>` : ''}</span>
        <select style="font-size:11px;padding:2px 4px;width:auto" onchange="${onMoverFn}('${id}', parseInt(this.value))">
          ${linhas.map((_, j) => `<option value="${j}" ${j === i ? 'selected' : ''}>Veículo ${j + 1}</option>`).join('')}
        </select>
      </div>`
    }).join('') + `</div>`
}
