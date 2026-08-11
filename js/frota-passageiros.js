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

function fpLista() { return _fpLista.map(p => Object.assign({}, p)) }

// Payload no formato que a RPC frota_solicitar_viagem espera.
function fpPayload() {
  return _fpLista.map(p => ({
    nome: p.nome,
    sexo: p.sexo || null,
    necessidade_especifica: p.necessidade_especifica || null,
  }))
}

function fpDefinirLista(arr) {
  _fpLista = (arr || [])
    .filter(p => p && (p.nome || '').trim().length >= 2)
    .map(p => ({
      nome: String(p.nome).trim().slice(0, 120),
      sexo: p.sexo && p.sexo !== 'nao_informado' ? p.sexo : null,
      necessidade_especifica: (p.necessidade_especifica || '').trim().slice(0, 200) || null,
    }))
  fpRenderLista()
}

function fpLimpar() { fpDefinirLista([]) }

// ── Editor ────────────────────────────────────────────────────
// `compacto` = app de campo (campos empilhados; a linha horizontal da
// mesa não cabe em celular).
function fpFormHTML(opts) {
  const compacto = !!(opts && opts.compacto)
  const linha = compacto
    ? `<div style="display:flex;flex-direction:column;gap:8px">
         <input class="form-control" id="fp-nome" placeholder="Nome do passageiro" maxlength="120">
         <select class="form-control" id="fp-sexo">${FP_SEXOS.map(s => `<option value="${s[0]}">${s[1]}</option>`).join('')}</select>
       </div>`
    : `<div style="display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap">
         <input class="form-control" id="fp-nome" placeholder="Nome do passageiro" maxlength="120" style="flex:2;min-width:180px">
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

function fpRenderLista() {
  const el = document.getElementById('fp-lista')
  if (!el) return
  el.innerHTML = !_fpLista.length
    ? '<div style="font-size:12px;color:#9CA3AF">Nenhum passageiro adicionado</div>'
    : _fpLista.map((p, i) => `
      <div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid #F3F4F6;font-size:13px">
        <span style="flex:1;min-width:0">
          <strong>${esc(p.nome)}</strong>${p.sexo ? `<span style="color:#9CA3AF"> · ${FP_SEXO_LABEL[p.sexo] || ''}</span>` : ''}
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
  })
  document.getElementById('fp-nome').value = ''
  document.getElementById('fp-sexo').value = ''
  document.getElementById('fp-tem-nec').checked = false
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
