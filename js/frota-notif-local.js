// ── SIGUC Frota — notificações locais no APK Android ───────────────
// Web Push (js embutido em pages/frota-app.html, VAPID) não chega no
// app nativo: a WebView do Capacitor não tem processo de push por trás
// (sem FCM registrado no app), então PushManager/inscrição "funcionam"
// mas nunca entregam nada com o app fechado. Aqui usamos
// @capacitor/local-notifications — agendamento nativo (AlarmManager),
// sem servidor novo, sem conta externa:
//   1. Lembretes de viagem (2h/1h/30min antes) são AGENDADOS no
//      aparelho com a hora exata assim que a lista de viagens do
//      motorista/solicitante é carregada — entrega garantida mesmo
//      com o app fechado, porque não depende de o processo estar vivo.
//   2. Outros avisos (aprovação/recusa de viagem etc., tabela
//      `notificacoes`) são notificados na hora durante o tick de sync
//      de 45s que já existe — só chegam com o app aberto/recente, teto
//      do que dá sem um serviço de push nativo (FCM).
// Tudo isolado atrás de fmNotifNativaDisponivel() — no navegador/PWA
// (Safari, Chrome) essas funções são no-op e o Web Push de sempre
// continua sendo o caminho.

function fmNotifNativaDisponivel() {
  return !!(window.Capacitor?.isNativePlatform?.() && window.Capacitor.Plugins?.LocalNotifications)
}

function _fmLN() { return window.Capacitor.Plugins.LocalNotifications }

// 'ativado' | 'ativavel' | 'bloqueado' | 'indisponivel'
async function estadoNotifNativa() {
  if (!fmNotifNativaDisponivel()) return 'indisponivel'
  try {
    const r = await _fmLN().checkPermissions()
    if (r.display === 'granted') return 'ativado'
    if (r.display === 'denied') return 'bloqueado'
    return 'ativavel'
  } catch (e) { return 'indisponivel' }
}

async function ativarNotifNativa() {
  if (!fmNotifNativaDisponivel()) return
  try {
    const r = await _fmLN().requestPermissions()
    if (r.display === 'granted') {
      toast('Notificações ativadas!', 'success')
      fmSincronizarLembretesLocais(_viagens || [], 'motorista')
      fmSincronizarLembretesLocais(_minhasViagens || [], 'solicitante')
    } else if (r.display === 'denied') {
      toast('Permissão bloqueada. Libere as notificações do app nas configurações do Android.', 'error')
    } else {
      toast('Ative as notificações para receber avisos das suas viagens.', 'warning')
    }
  } catch (e) {
    toast('Não foi possível ativar as notificações: ' + (e.message || 'tente novamente'), 'error')
  }
  atualizarItemPushConfig()
}

// ── Hash estável (djb2) → id inteiro exigido pelo plugin nativo ────
function _fmHashId(txt) {
  let h = 5381
  for (let i = 0; i < txt.length; i++) h = ((h * 33) ^ txt.charCodeAt(i)) >>> 0
  return h % 2147483647
}

const F_LEMBRETE_JANELAS = [120, 60, 30] // minutos antes da saída, mesmas janelas do cron (migration 208)

// Agenda/atualiza os lembretes locais de viagem para o papel informado
// ('motorista' ou 'solicitante'), a partir da lista de viagens já
// carregada (mesmo formato de vw_frota_viagens_detalhe usado pelo app).
// Cancela o que não se aplica mais (viagem concluída/recusada, ou
// horário já passado) comparando com o que foi agendado da última vez.
async function fmSincronizarLembretesLocais(viagens, papel) {
  if (!fmNotifNativaDisponivel()) return
  if (await estadoNotifNativa() !== 'ativado') return
  if (!(await estadoLembreteViagem())) return

  const chaveCache = 'lembretes_agendados_' + papel
  const anteriores = (await fOfflineGetConfig(chaveCache)) || {}
  const novos = {}
  const agendar = []

  for (const v of (viagens || [])) {
    // fvStatus (js/frota-viagens-status.js) porque a viagem que venceu
    // sem check-out não é mais 'aprovada' na prática — não faz sentido
    // agendar lembrete para ela. Guarda de typeof: este arquivo também
    // é carregado por páginas que não trazem o módulo.
    const st = (typeof fvStatus === 'function') ? fvStatus(v) : v.status
    if (st !== 'aprovada' || !v.data_saida_prevista) continue
    const saida = new Date(v.data_saida_prevista).getTime()
    if (isNaN(saida)) continue
    for (const janela of F_LEMBRETE_JANELAS) {
      const hora = saida - janela * 60000
      if (hora <= Date.now()) continue // já passou essa janela
      const chave = `${v.id}:${janela}:${papel}`
      const id = _fmHashId(chave)
      novos[chave] = id
      agendar.push({
        id,
        title: 'Sua viagem está chegando',
        body: `Viagem para ${v.destino || 'destino'} sai em ${janela >= 60 ? (janela / 60) + 'h' : janela + ' min'}.`,
        schedule: { at: new Date(hora) },
        extra: { subtipo: 'lembrete_viagem', viagem_id: v.id, para: papel, minutos_antes: janela },
      })
    }
  }

  const cancelarIds = Object.entries(anteriores)
    .filter(([chave]) => !(chave in novos))
    .map(([, id]) => ({ id }))

  try {
    if (cancelarIds.length) await _fmLN().cancel({ notifications: cancelarIds })
    if (agendar.length) await _fmLN().schedule({ notifications: agendar })
    await fOfflineSetConfig(chaveCache, novos)
  } catch (e) { /* melhor esforço — não bloqueia o carregamento das viagens */ }
}

// ── Avisos "ao vivo" (aprovação/recusa etc.) durante o app aberto ──
// Reaproveita a mesma tabela `notificacoes` já lida por carregarTarefasFrota.
// Lembrete de viagem fica de fora daqui — já coberto (com mais precisão
// e sem depender do app estar aberto) pelo agendamento acima.
async function fmChecarNotifNativas() {
  if (!fmNotifNativaDisponivel()) return
  if (await estadoNotifNativa() !== 'ativado') return
  if (!_usuario) return

  let vistos
  try { vistos = (await fOfflineGetConfig('notif_vistos')) || [] } catch (e) { vistos = [] }
  const vistosSet = new Set(vistos)

  let data
  try {
    const r = await db.from('notificacoes').select('id,titulo,mensagem,meta,status')
      .eq('destinatario_id', _usuario.id).eq('tipo', 'frota')
      .in('status', ['gerada', 'enviada']).order('criado_em', { ascending: false }).limit(20)
    if (r.error) throw r.error
    data = r.data || []
  } catch (e) { return }

  const novas = data.filter(n => n.meta?.subtipo !== 'lembrete_viagem' && !vistosSet.has(n.id))
  if (!novas.length) { return }

  try {
    await _fmLN().schedule({
      notifications: novas.map(n => ({
        id: _fmHashId('tarefa:' + n.id),
        title: n.titulo || 'SIGUC Frota',
        body: n.mensagem || '',
        schedule: { at: new Date(Date.now() + 500) },
        extra: { subtipo: 'tarefa', notif_id: n.id },
      })),
    })
  } catch (e) { /* melhor esforço */ }

  const todosVistos = [...vistosSet, ...novas.map(n => n.id)].slice(-200)
  try { await fOfflineSetConfig('notif_vistos', todosVistos) } catch (e) {}
}

// Toque na notificação nativa → mesma rota usada pelo push web (SW).
function fmInstalarListenerNotifNativa() {
  if (!fmNotifNativaDisponivel()) return
  _fmLN().addListener('localNotificationActionPerformed', ev => {
    const extra = ev?.notification?.extra
    if (!extra) return
    if (extra.subtipo === 'tarefa' && extra.notif_id) {
      if (_usuario) abrirNotificacaoFrota(extra.notif_id)
      else _deepLinkNotif = extra.notif_id
      return
    }
    if (extra.subtipo === 'lembrete_viagem') {
      const acao = () => rotearNotifFrota({ meta: { subtipo: 'lembrete_viagem', para: extra.para, viagem_id: extra.viagem_id } })
      if (_usuario) acao()
      else _deepLinkNotifLembrete = acao
    }
  })
}
