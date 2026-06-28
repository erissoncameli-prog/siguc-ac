/* ════════════════════════════════════════════════════════════
   Biomonitor — Motor de alertas científicos de incubação
   ────────────────────────────────────────────────────────────
   Avalia, no campo e OFFLINE, os dados de ninho/visita à luz da
   biologia térmica dos quelônios amazônicos e sugere a tomada de
   decisão. Espelha as bandas da migration 094_alertas_quelonios.sql.

   Os limiares vêm da tabela editável parametros_incubacao_quelonios
   (baixados no sync e cacheados no IndexedDB). Se nunca houve sync,
   usa os defaults abaixo — idênticos aos seeds do banco.
   ════════════════════════════════════════════════════════════ */

// Providências (mesmos textos dos seeds do banco, enxutos p/ mobile)
const BIO_PROV = {
  frio:          'Verificar friagem; cobrir o ninho à noite para conservar calor; acompanhar diariamente.',
  calor_mod:     'Sombrear o ninho (cobertura vegetal/sombrite) e reforçar as visitas — temperatura puxando para fêmeas.',
  calor_extremo: 'Sombrear + umedecer o substrato agora; se persistir, transferir os ovos para local sombreado/berçário. Risco de morte do embrião.',
  seco:          'Irrigação leve do substrato e sombreamento para evitar dessecação dos ovos.',
  encharcado:    'Drenar/desobstruir o entorno; verificar fungos; avaliar transferência se a saturação persistir.',
  alagamento:    'Transferir os ovos imediatamente para cota mais alta — risco de afogamento total do ninho.',
  predacao:      'Reforçar a vigilância/cercamento do ninho; registrar a perda e avaliar transferir os ovos restantes.',
}

// Limiares-padrão (fallback offline). _base = padrão; demais = ajustes por espécie.
const BIO_ALERTA_DEFAULTS = {
  _base: {
    temp_letal_min: 28, temp_macho_max: 31, temp_pivotal: 32, temp_femea_min: 33, temp_critico_max: 36,
    umidade_min_pct: 6, umidade_max_pct: 90, dist_rio_min_m: 10, incubacao_dias_max: 75, friagem_temp_ar_min: 20,
    prov_frio: BIO_PROV.frio, prov_calor_mod: BIO_PROV.calor_mod, prov_calor_extremo: BIO_PROV.calor_extremo,
    prov_seco: BIO_PROV.seco, prov_encharcado: BIO_PROV.encharcado, prov_alagamento: BIO_PROV.alagamento,
    prov_predacao: BIO_PROV.predacao,
  },
  tartaruga: { temp_pivotal: 32.7, temp_femea_min: 33.5, temp_critico_max: 36.5 },
  tracaja:   { temp_pivotal: 32.0, temp_femea_min: 33.0, temp_critico_max: 36.0 },
}

// Cache dos limiares vindos do banco (null = usar defaults)
let _bioLimiares = null

// Carrega limiares cacheados (IndexedDB) — chamado no boot do app
async function bioCarregarLimiaresCache() {
  try {
    const c = await bioOfflineGetConfig('parametros_incubacao')
    if (c && c._base) _bioLimiares = c
  } catch (_) { /* segue com defaults */ }
}

// Baixa os limiares do servidor e cacheia (chamado junto do sync de praias)
async function bioSyncCacheParametros() {
  if (!navigator.onLine) return
  try {
    const { data, error } = await bioSupabase()
      .from('parametros_incubacao_quelonios').select('*').eq('ativo', true)
    if (error || !data || !data.length) return
    const map = {}
    data.forEach(r => { map[r.especie || '_base'] = r })
    if (map._base) {
      _bioLimiares = map
      await bioOfflineSetConfig('parametros_incubacao', map)
    }
  } catch (_) { /* offline/erro: mantém cache atual */ }
}

// Resolve os limiares efetivos para uma espécie (espécie sobrepõe o padrão)
function bioLimiaresPara(especie) {
  const src  = _bioLimiares || BIO_ALERTA_DEFAULTS
  const base = src._base || BIO_ALERTA_DEFAULTS._base
  const esp  = (especie && src[especie]) ? src[especie] : {}
  return { ...BIO_ALERTA_DEFAULTS._base, ...base, ...esp }
}

function _bioAlerta(parametro, faixa, severidade, explicacao, providencia, decisao) {
  return { parametro, faixa, severidade, explicacao, providencia: providencia || '', decisao: decisao || null }
}

const _bioNum = x => { const n = parseFloat(x); return isNaN(n) ? null : n }

/* Avalia um contexto e devolve a lista de alertas.
   ctx = { contexto:'ninho'|'visita', especie, valores:{...} }
   severidade: 'ideal' | 'media' | 'alta' | 'critica'                       */
function bioAvaliarQuelonio(ctx) {
  const L   = bioLimiaresPara(ctx?.especie)
  const v   = ctx?.valores || {}
  const ehVisita = ctx?.contexto === 'visita'
  const out = []

  // ── Temperatura do substrato ──────────────────────────────
  const t = _bioNum(ehVisita ? v.temperatura_substrato_c : v.temperatura_c)
  if (t != null) {
    if (t < L.temp_letal_min) {
      out.push(_bioAlerta('temp', 'Letal por frio', 'critica',
        `Substrato a ${t} °C, abaixo de ${L.temp_letal_min} °C: desenvolvimento interrompido e morte por frio.`,
        L.prov_frio, 'transferir'))
    } else if (t >= L.temp_critico_max) {
      out.push(_bioAlerta('temp', 'Calor extremo', 'critica',
        `Substrato a ${t} °C: feminização total e risco de morte do embrião (letal ~38 °C).`,
        L.prov_calor_extremo, 'transferir'))
    } else if (t >= L.temp_femea_min) {
      out.push(_bioAlerta('temp', 'Tendência a fêmeas', 'media',
        `Acima do pivotal (~${L.temp_pivotal} °C): nascem predominantemente fêmeas.`,
        L.prov_calor_mod))
    } else if (t >= L.temp_macho_max) {
      out.push(_bioAlerta('temp', 'Faixa ideal', 'ideal',
        `${t} °C — próximo do pivotal (~${L.temp_pivotal} °C): razão sexual equilibrada.`, ''))
    } else {
      out.push(_bioAlerta('temp', 'Tendência a machos', 'ideal',
        `${t} °C — abaixo do pivotal (~${L.temp_pivotal} °C): predominância de machos, faixa viável.`, ''))
    }
  }

  // ── Umidade do substrato ──────────────────────────────────
  if (ehVisita) {
    const ue = v.umidade_estado
    if (ue === 'seco') out.push(_bioAlerta('umidade', 'Substrato seco', 'alta',
      'Substrato seco: risco de dessecação dos ovos.', L.prov_seco))
    else if (ue === 'encharcado') out.push(_bioAlerta('umidade', 'Substrato encharcado', 'alta',
      'Substrato encharcado: risco de hipóxia/afogamento e fungos.', L.prov_encharcado, 'transferir'))
    else if (ue === 'umido') out.push(_bioAlerta('umidade', 'Umidade adequada', 'ideal',
      'Substrato úmido: condição ideal de incubação.', ''))
  } else {
    const u = _bioNum(v.umidade_pct)
    if (u != null) {
      if (u < L.umidade_min_pct) out.push(_bioAlerta('umidade', 'Substrato seco', 'alta',
        `Umidade ${u}% abaixo do mínimo (${L.umidade_min_pct}%): risco de dessecação.`, L.prov_seco))
      else if (u > L.umidade_max_pct) out.push(_bioAlerta('umidade', 'Substrato encharcado', 'alta',
        `Umidade ${u}% acima do máximo (${L.umidade_max_pct}%): risco de hipóxia/fungos.`, L.prov_encharcado, 'transferir'))
      else out.push(_bioAlerta('umidade', 'Umidade adequada', 'ideal',
        `Umidade ${u}% dentro da faixa ideal.`, ''))
    }
  }

  // ── Distância ao rio (só no encontro do ninho) ────────────
  if (!ehVisita) {
    const d = _bioNum(v.dist_rio_m)
    if (d != null) {
      if (d < L.dist_rio_min_m) out.push(_bioAlerta('dist_rio', 'Muito perto do rio', 'alta',
        `A ${d} m do rio (mínimo seguro ${L.dist_rio_min_m} m): risco de alagamento.`, L.prov_alagamento, 'transferir'))
      else out.push(_bioAlerta('dist_rio', 'Distância segura', 'ideal', `A ${d} m do rio — cota segura.`, ''))
    }
  }

  // ── Alagamento / integridade / predação (só na visita) ────
  if (ehVisita) {
    if (v.sinal_alagamento || v.status_ninho === 'alagado') {
      out.push(_bioAlerta('alagamento', 'Alagamento', 'critica',
        'Sinal de alagamento: ninho em risco de afogamento.', L.prov_alagamento, 'transferir'))
    }
    if (v.status_ninho === 'destruido') {
      out.push(_bioAlerta('status', 'Ninho destruído', 'critica',
        'Ninho destruído.', L.prov_predacao))
    } else if (v.status_ninho === 'parcial_predado' || v.status_ninho === 'perturbado') {
      out.push(_bioAlerta('status', 'Ninho perturbado', 'alta',
        'Ninho perturbado/parcialmente predado.', L.prov_predacao))
    }
    if (v.predacao_incubacao === 'por_animais' || v.predacao_incubacao === 'por_pessoas') {
      out.push(_bioAlerta('predacao', 'Predação', 'alta',
        `Predação ${v.predacao_incubacao === 'por_pessoas' ? 'por pessoas' : 'por animais'} durante a incubação.`,
        L.prov_predacao))
    }
  }

  return out
}

// Maior severidade de uma lista
const _BIO_SEV_ORDEM = { ideal: 0, media: 1, alta: 2, critica: 3 }
function bioAlertaMaxSeveridade(alertas) {
  return (alertas || []).reduce((m, a) =>
    (_BIO_SEV_ORDEM[a.severidade] > _BIO_SEV_ORDEM[m] ? a.severidade : m), 'ideal')
}

// Snapshot para rastreabilidade (gravado no registro; visível ao gestor)
function bioAlertaSnapshot(alertas) {
  const relevantes = (alertas || []).filter(a => a.severidade !== 'ideal')
  if (!relevantes.length) return null
  return {
    severidade_max:  bioAlertaMaxSeveridade(relevantes),
    faixas:          relevantes.map(a => ({ p: a.parametro, f: a.faixa, s: a.severidade })),
    reconhecido_em:  new Date().toISOString(),
  }
}

// Confirmação consciente ao salvar quando há alerta crítico
function bioConfirmarCriticos(alertas) {
  const crit = (alertas || []).filter(a => a.severidade === 'critica')
  if (!crit.length) return true
  const txt = crit.map(a => `• ${a.faixa}: ${a.providencia}`).join('\n\n')
  return confirm(`⚠ Faixa crítica detectada:\n\n${txt}\n\nRegistrar mesmo assim?`)
}

// ── Renderização dos cartões ──────────────────────────────────
const BIO_SEV_COR = { ideal: 'verde', media: 'ouro', alta: 'alerta', critica: 'perigo' }

function bioRenderAlertas(container, alertas, opts) {
  if (!container) return
  opts = opts || {}
  const ninho = opts.ninho
  if (!alertas || !alertas.length) { container.innerHTML = ''; return }

  container.innerHTML = alertas.map((a, i) => {
    const cor = BIO_SEV_COR[a.severidade] || 'alerta'
    const cta = (a.decisao === 'transferir' && ninho)
      ? `<button type="button" class="bio-alerta-cta" data-i="${i}">Transferir ovos agora</button>` : ''
    return `<div class="bio-alerta-card sev-${cor}">
      <div class="bio-alerta-faixa">${esc(a.faixa)}</div>
      <div class="bio-alerta-exp">${esc(a.explicacao)}</div>
      ${a.providencia ? `<div class="bio-alerta-prov"><strong>O que fazer:</strong> ${esc(a.providencia)}</div>` : ''}
      ${cta}
    </div>`
  }).join('')

  if (ninho) {
    container.querySelectorAll('.bio-alerta-cta').forEach(btn => {
      btn.addEventListener('click', () => {
        if (typeof bioAbrirFormTransf === 'function') bioAbrirFormTransf(ninho)
      })
    })
  }
}

/* ── Integração com os formulários ───────────────────────────── */

// NINHO (encontro) — não há ninho salvo ainda, então sem CTA de transferência
function bioAlertaContextoNinho() {
  return {
    contexto: 'ninho',
    especie:  document.querySelector('.bio-especie-chip.sel')?.dataset.esp,
    valores: {
      temperatura_c: document.getElementById('bio-form-temperatura')?.value,
      umidade_pct:   document.getElementById('bio-form-umidade')?.value,
      dist_rio_m:    document.getElementById('bio-form-dist-rio')?.value,
    },
  }
}
function bioAtualizarAlertasNinho() {
  bioRenderAlertas(document.getElementById('bio-form-alertas'),
    bioAvaliarQuelonio(bioAlertaContextoNinho()), {})
}
function bioIniciarAlertasNinho() {
  ;['bio-form-temperatura', 'bio-form-umidade', 'bio-form-dist-rio'].forEach(id =>
    document.getElementById(id)?.addEventListener('input', bioAtualizarAlertasNinho))
  document.querySelectorAll('.bio-especie-chip').forEach(c =>
    c.addEventListener('click', () => setTimeout(bioAtualizarAlertasNinho, 0)))
}

// VISITA — o ninho já existe (BioApp.formNinhoAtualizar) → CTA habilitada
function bioAlertaContextoVisita() {
  const ninho = BioApp.formNinhoAtualizar
  return {
    contexto: 'visita',
    especie:  ninho?.especie,
    valores: {
      temperatura_substrato_c: document.getElementById('bio-vis-temp-sub')?.value,
      umidade_estado:          document.querySelector('#bio-vis-umidade-grid .bio-chip-sel.ativo')?.dataset.val || '',
      status_ninho:            document.querySelector('#bio-vis-status-grid .bio-chip-sel.ativo')?.dataset.val || 'integro',
      predacao_incubacao:      document.querySelector('#bio-vis-pred-grid .bio-pred-opt.sel')?.dataset.pred || 'nenhuma',
      sinal_alagamento:        document.getElementById('bio-vis-alagamento')?.checked || false,
    },
  }
}
function bioAtualizarAlertasVisita() {
  bioRenderAlertas(document.getElementById('bio-vis-alertas'),
    bioAvaliarQuelonio(bioAlertaContextoVisita()), { ninho: BioApp.formNinhoAtualizar })
}
function bioIniciarAlertasVisita() {
  document.getElementById('bio-vis-temp-sub')?.addEventListener('input', bioAtualizarAlertasVisita)
  document.getElementById('bio-vis-alagamento')?.addEventListener('change', bioAtualizarAlertasVisita)
  document.querySelectorAll(
    '#bio-vis-umidade-grid .bio-chip-sel, #bio-vis-status-grid .bio-chip-sel, #bio-vis-pred-grid .bio-pred-opt'
  ).forEach(c => c.addEventListener('click', () => setTimeout(bioAtualizarAlertasVisita, 0)))
}
