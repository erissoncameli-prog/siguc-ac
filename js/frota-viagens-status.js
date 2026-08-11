// ── SIGUC-AC · Frota — status e agrupamento de viagens ───────────
// Definição ÚNICA de "em que pé está esta viagem" e "em que bloco da
// lista ela entra". Mesma lição de js/frota-consumo.js e
// js/frota-passageiros.js: antes existiam 4 cópias de STATUS_LABEL
// (frota-app.html, frota-solicitar.html, frota-viagens.html e
// frota-dashboard.html) e nenhuma noção de tempo — a lista era plana,
// misturando o que já aconteceu com o que ainda vai acontecer.
// Nunca remontar esses rótulos numa página.
//
// STATUS EFETIVO (migration 241)
// Uma viagem que passou do retorno previsto sem check-out não
// aconteceu. O banco materializa isso como 'nao_realizada' pelo cron
// horário, com 12h de carência (para o check-out feito offline em
// campo ainda chegar); a view já devolve `status_efetivo` derivado
// SEM carência, para a tela não esperar o cron.
// `fvStatus` repete a derivação no cliente porque nem toda linha vem
// da view: PWA com cache antigo, viagem avulsa ainda na fila offline
// e a lista salva no IndexedDB não têm a coluna.
// REGRA: exibição usa fvStatus(v); `v.status` é o registro, não o que
// se mostra.

const FV_STATUS_LABEL = {
  solicitada: 'Solicitada', aprovada: 'Aprovada', recusada: 'Recusada',
  em_andamento: 'Em andamento', concluida: 'Concluída', cancelada: 'Cancelada',
  nao_realizada: 'Não realizada',
}

// No app do motorista/solicitante "Aprovada" não diz nada sobre o que
// falta acontecer; o rótulo é o próximo passo.
const FV_STATUS_LABEL_APP = Object.assign({}, FV_STATUS_LABEL, { aprovada: 'Aguardando saída' })

const FV_STATUS_BADGE = {
  solicitada: 'fw-badge fw-badge-manutencao', aprovada: 'fw-badge fw-badge-em-rota',
  recusada: 'fw-badge fw-badge-inativo', em_andamento: 'fw-badge fw-badge-em-rota',
  concluida: 'fw-badge fw-badge-disponivel', cancelada: 'badge-cinza',
  nao_realizada: 'badge-cinza',
}

const FV_GRUPO_LABEL = {
  andamento: 'Em andamento',
  futura: 'Próximas',
  passada: 'Passadas',
}

// Status que já encerraram a viagem, com ou sem deslocamento.
const FV_STATUS_FINAIS = ['concluida', 'nao_realizada', 'recusada', 'cancelada']

function fvVencida(v) {
  if (!v || !v.data_retorno_prevista) return false
  return new Date(v.data_retorno_prevista).getTime() < Date.now()
}

// A verdade da tela. Prefere o que a view calculou; deriva quando a
// linha não vem de lá (cache offline, fila de sync, cliente antigo).
function fvStatus(v) {
  if (!v) return ''
  if (v.status_efetivo) return v.status_efetivo
  if ((v.status === 'solicitada' || v.status === 'aprovada') && fvVencida(v)) return 'nao_realizada'
  return v.status
}

// 'sem_aprovacao' = venceu sem a gestão responder;
// 'sem_inicio'    = venceu aprovada, sem check-out do motorista.
function fvMotivoNaoRealizacao(v) {
  if (!v) return null
  if (v.motivo_nao_realizacao) return v.motivo_nao_realizacao
  if (!fvVencida(v)) return null
  if (v.status === 'solicitada') return 'sem_aprovacao'
  if (v.status === 'aprovada') return 'sem_inicio'
  return null
}

function fvLabel(v, contexto) {
  const s = fvStatus(v)
  const mapa = contexto === 'app' ? FV_STATUS_LABEL_APP : FV_STATUS_LABEL
  return mapa[s] || s
}

function fvBadge(v) {
  return FV_STATUS_BADGE[fvStatus(v)] || 'badge-cinza'
}

// Frase curta para o card/detalhe — o badge sozinho não explica por
// que a viagem morreu, e é justamente isso que o solicitante quer
// saber.
function fvExplicacao(v) {
  const s = fvStatus(v)
  if (s !== 'nao_realizada') return ''
  return fvMotivoNaoRealizacao(v) === 'sem_aprovacao'
    ? 'Encerrada sem realização — a solicitação não foi aprovada até a data prevista.'
    : 'Encerrada sem realização — a viagem não foi iniciada pelo motorista.'
}

// Viagem que saiu e passou do retorno previsto sem check-in
// (vw_frota_viagens_vencidas, migration 201). Continua "em andamento":
// o veículo está fora, só que atrasado.
function fvAtrasada(v) {
  return fvStatus(v) === 'em_andamento' && fvVencida(v)
}

// 'andamento' | 'futura' | 'passada'
function fvGrupo(v) {
  const s = fvStatus(v)
  if (s === 'em_andamento') return 'andamento'
  if (FV_STATUS_FINAIS.indexOf(s) >= 0) return 'passada'
  return 'futura'
}

// Separa e ordena. Futuras em ordem CRESCENTE (a mais próxima é a que
// exige ação); passadas em ordem decrescente (a mais recente primeiro).
function fvAgrupar(lista) {
  const g = { andamento: [], futura: [], passada: [] }
  ;(lista || []).forEach(v => { g[fvGrupo(v)].push(v) })
  const ms = v => new Date(v.data_saida_prevista || v.criado_em || 0).getTime()
  g.andamento.sort((a, b) => ms(a) - ms(b))
  g.futura.sort((a, b) => ms(a) - ms(b))
  g.passada.sort((a, b) => ms(b) - ms(a))
  return g
}

// Quantas viagens ainda exigem alguma coisa de alguém — o número dos
// badges de aba. Passada nunca conta.
function fvAtivas(lista) {
  return (lista || []).filter(v => fvGrupo(v) !== 'passada').length
}
