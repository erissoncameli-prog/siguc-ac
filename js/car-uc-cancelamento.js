// ── SIGUC-AC · CAR na UC — pedido ao IMAC (cancelamento / retificação) ─
// Dossiê técnico por imóvel + acompanhamento dos pedidos (migration 368).
// Fonte única da regra "que pedido cabe" (carucDossieTipo), do
// preenchimento do modelo jurídico (carucPreencherModelo) e do PDF do
// dossiê. A página (pages/relatorios.html) só chama:
//   carucSolCarregarUC(ucId)      → pedidos da UC (marca nas linhas)
//   carucDossieBotaoHTML(i)       → botão/selo na linha do imóvel
//   carucDossieAbrir(cod)         → janela de emissão
//   carsolRenderAba(el)           → aba "Solicitações ao IMAC"
//
// Regras que mandam aqui (decisões do usuário, 25/11/2026):
//   • destinatário IMAC; quem assina é o(a) gestor(a) da UC;
//   • nunca pedir cancelamento para tudo: a tese muda com a categoria
//     (SNUC) e com quanto do imóvel está na UC — APA/ARIE/RPPN/MONA/RVS
//     não geram pedido; PCT em RESEX/RDS/FLONA é o cadastro esperado;
//   • o texto jurídico é MINUTA até o Jurídico validar (o PDF diz isso);
//   • números congelados no snapshot; o dossiê NÃO traz nome nem
//     documento do titular (LGPD, necessidade): o nº da inscrição basta
//     para o IMAC.
//
// Depende de: js/car-uc-relatorio.js, js/car-uc-mapa.js, js/config.js
// (db, esc, formatNum, formatData, toast, btnEspera) e, para o PDF, do
// que _carucCarregarExportacao() da página carrega (jsPDF + timbre).

const CARUC_PEDIDO = {
  cancelamento: { rotulo: 'Cancelamento administrativo', chave: 'cancelamento_protecao_integral' },
  retificacao_uso_sustentavel: { rotulo: 'Retificação (adequar a PCT ou excluir a área)', chave: 'retificacao_uso_sustentavel' },
  retificacao_perimetro: { rotulo: 'Retificação de perímetro', chave: 'retificacao_perimetro' },
}

const CARSOL_STATUS = {
  emitido: { rotulo: 'Emitido', badge: 'badge-cinza' },
  enviado_imac: { rotulo: 'Enviado ao IMAC', badge: 'badge-azul' },
  declarante_notificado: { rotulo: 'Declarante notificado', badge: 'badge-roxo' },
  deferido: { rotulo: 'Deferido', badge: 'badge-verde' },
  indeferido: { rotulo: 'Indeferido', badge: 'badge-erro' },
  retificado: { rotulo: 'Retificado pelo declarante', badge: 'badge-verde' },
  arquivado: { rotulo: 'Arquivado', badge: 'badge-cinza' },
}
const CARSOL_ABERTOS = ['emitido', 'enviado_imac', 'declarante_notificado']
const CARSOL_PROXIMOS = {
  emitido: ['enviado_imac', 'arquivado'],
  enviado_imac: ['declarante_notificado', 'deferido', 'indeferido', 'retificado', 'arquivado'],
  declarante_notificado: ['deferido', 'indeferido', 'retificado', 'arquivado'],
}

const CARUC_CATEGORIA_NOME = {
  ESEC: 'Estação Ecológica', REBIO: 'Reserva Biológica', PARNA: 'Parque Nacional', PARES: 'Parque Estadual',
  PE: 'Parque Estadual', FLONA: 'Floresta Nacional', FLOES: 'Floresta Estadual', FLOE: 'Floresta Estadual',
  RESEX: 'Reserva Extrativista', RDS: 'Reserva de Desenvolvimento Sustentável',
}
// Dispositivo do SNUC (Lei 9.985/2000) que declara posse e domínio públicos.
const CARUC_DISPOSITIVO_SNUC = {
  ESEC: 'art. 9º, § 1º', REBIO: 'art. 10, § 1º', PARNA: 'art. 11, § 1º', PARES: 'art. 11, §§ 1º e 4º', PE: 'art. 11, §§ 1º e 4º',
  FLONA: 'art. 17, § 1º', FLOES: 'art. 17, §§ 1º e 6º', FLOE: 'art. 17, §§ 1º e 6º', RESEX: 'art. 18, § 1º', RDS: 'art. 20, § 2º',
}

const _cdN = (v, c = 2) => v == null || !isFinite(Number(v)) ? '—' : Number(v).toLocaleString('pt-BR', { minimumFractionDigits: c, maximumFractionDigits: c })
const _cdData = d => d ? String(d).slice(0, 10).split('-').reverse().join('/') : null

// ── Que pedido cabe ─────────────────────────────────────────────────
// Devolve { permitido, tipo?, motivo }. O banco repete a trava das
// categorias que admitem propriedade privada (car_solicitacao_emitir).
function carucDossieTipo(im, uc, enq) {
  if (!im) return { permitido: false, motivo: 'Imóvel não encontrado.' }
  enq = enq || carucEnquadrarCategoria(uc)
  if (im.local !== 'uc') return { permitido: false, motivo: 'O imóvel está só na zona de amortecimento, que não é território da UC: não cabe pedido por sobreposição.' }
  if (/cancel/.test(carucNorm((im.status || '') + ' ' + (im.situacao || '')))) return { permitido: false, motivo: 'O CAR já está cancelado no SICAR.' }
  if (enq.nivel === 'admitido') return { permitido: false, motivo: `A categoria ${uc?.sigla || ''} admite propriedade privada (SNUC): o CAR é compatível com a UC, sujeito ao plano de manejo. Não cabe pedido por sobreposição.` }
  if (enq.nivel === 'indefinido') return { permitido: false, motivo: 'Categoria sem regra cadastrada no sistema — avaliar com o Jurídico antes de qualquer pedido.' }
  if (!(Number(im.area_analise_ha) >= 0.01)) return { permitido: false, motivo: 'Sobreposição abaixo de 0,01 ha — ruído de desenho entre polígonos.' }
  const pct = Number(im.pct_analise)
  const tipo = String(im.tipo_imovel || '').toUpperCase()
  if (pct < 10) return { permitido: true, tipo: 'retificacao_perimetro', motivo: 'Menos de 10% do imóvel na UC: quase sempre é erro de divisa — o pedido é retificar o perímetro.' }
  if (enq.nivel === 'conflito') {
    return pct >= 95
      ? { permitido: true, tipo: 'cancelamento', motivo: 'UC de proteção integral (posse e domínio públicos) e 95% ou mais do imóvel dentro dela.' }
      : { permitido: true, tipo: 'retificacao_perimetro', motivo: 'UC de proteção integral, mas o imóvel está só parcialmente dentro: o pedido é excluir a área sobreposta.' }
  }
  // 'verificar' — RESEX, RDS, FLONA, FLOE: domínio público com uso por população tradicional.
  if (tipo === 'PCT') return { permitido: false, motivo: 'Território de povos e comunidades tradicionais (PCT) é o cadastro esperado nesta categoria.' }
  if (tipo === 'IRU' && pct >= 50) return { permitido: true, tipo: 'retificacao_uso_sustentavel', motivo: 'Imóvel rural particular (IRU) com a maior parte dentro de UC de domínio público: adequar ao cadastro PCT (se for população tradicional da UC) ou excluir a área; sem isso, cancelamento.' }
  return { permitido: true, tipo: 'retificacao_perimetro', motivo: 'Sobreposição parcial com UC de domínio público: o pedido é excluir a área sobreposta.' }
}

// ── Fatos congelados (sem nome nem documento do titular) ────────────
function carucDossieSnapshot(im, rel) {
  const uc = rel.uc
  const enq = rel.enquadramento || carucEnquadrarCategoria(uc)
  const embV = typeof carucEmbargosVigentes === 'function' ? carucEmbargosVigentes(im) : []
  return {
    cod_imovel: im.cod,
    tipo_imovel: im.tipo_imovel || null,
    status_sicar: im.status || null,
    condicao_sicar: im.situacao || null,
    municipio: im.municipio || null,
    data_inscricao: im.data_inscricao || null,
    inscricao_vs_uc: im.inscricao_vs_uc || null,
    area_declarada_ha: im.area_declarada_ha ?? null,
    area_total_ha: im.area_total_ha ?? null,
    area_uc_ha: im.area_analise_ha ?? null,
    pct_uc: im.pct_analise ?? null,
    pct_da_uc: uc.area_ha ? (im.area_analise_ha || 0) / Number(uc.area_ha) * 100 : null,
    faixa_uc: im.faixa_uc || null,
    zonas: (im.zonas || []).filter(z => z.ha >= 0.01).map(z => ({ nome: z.nome, codigo: z.codigo || null, nivel: z.nivel, ha: z.ha })),
    zoneamento_fonte: rel.zoneamento?.tem ? rel.zoneamento.fonte : null,
    zee: im.zee ? im.zee.map(c => ({ cod: c.cod, nome: c.nome || null, ha: c.ha ?? null })) : null,
    prodes: rel.opcoes?.prodes ? (im.prodes ? { pos_marco_ha: im.prodes.pos_marco_ha, ate2007_ha: im.prodes.ate2007_ha, total_ha: im.prodes.total_ha } : { pos_marco_ha: 0 }) : null,
    deter: rel.opcoes?.deter ? (im.ambiental ? { alertas: im.ambiental.deter_alertas, ha: im.ambiental.deter_ha } : { alertas: 0, ha: 0 }) : null,
    focos: rel.opcoes?.focos ? { de: rel.opcoes.focosDe, ate: rel.opcoes.focosAte, n: im.ambiental?.focos_periodo ?? 0 } : null,
    embargos: (im.embargos || []).map(e => ({ fonte: e.fonte, rotulo: carucEmbargoRotulo(e), situacao: e.situacao, data: e.data_embargo || null, ha: e.ha ?? null })),
    embargos_vigentes: embV.length,
    sobreposicoes_car: (im.sobreposicoes || []).map(s => ({ cod: s.cod, ha: s.ha })),
    fracionamento: !!im.fracionamento,
    enquadramento: { nivel: enq.nivel, rotulo: enq.rotulo, texto: enq.texto },
    uc: { id: uc.id, nome: uc.nome, sigla: uc.sigla, categoria: uc.categoria, esfera: uc.esfera, area_ha: uc.area_ha, data_criacao: uc.data_criacao, ato_criacao: uc.ato_criacao || null, codigo: uc.codigo },
    sicar_consultado_em: rel.gerado_em,
    geom_imovel: im._mapa || null,
  }
}

function _cdFraseInscricao(sn) {
  const d = _cdData(sn.data_inscricao)
  if (!d) return 'A data de inscrição não consta da base consultada.'
  if (sn.inscricao_vs_uc === 'depois') return `A inscrição foi feita em ${d}, depois da criação da unidade.`
  if (sn.inscricao_vs_uc === 'antes') return `A inscrição, de ${d}, é anterior à criação da unidade, circunstância a ser considerada na análise da situação fundiária.`
  return `A inscrição é de ${d}.`
}

function _cdFraseAgravantes(sn) {
  const t = []
  if (sn.prodes && sn.prodes.pos_marco_ha >= 0.01) t.push(`${_cdN(sn.prodes.pos_marco_ha)} ha de desmatamento detectado pelo PRODES/INPE após 22/07/2008`)
  if (sn.deter && sn.deter.alertas > 0) t.push(`${sn.deter.alertas} alerta(s) DETER/INPE (${_cdN(sn.deter.ha, 1)} ha)`)
  if (sn.focos && sn.focos.n > 0) t.push(`${sn.focos.n} foco(s) de calor nas temporadas de ${sn.focos.de} a ${sn.focos.ate}`)
  if (sn.embargos_vigentes) t.push(`${sn.embargos_vigentes} embargo(s) ambiental(is) vigente(s) incidindo no imóvel`)
  if (sn.sobreposicoes_car.length) t.push(`sobreposição com ${sn.sobreposicoes_car.length} outra(s) inscrição(ões) do CAR`)
  const nao = []
  if (!sn.prodes) nao.push('PRODES')
  if (!sn.deter) nao.push('DETER')
  const naoTxt = nao.length ? ` (${nao.join(' e ')} não consultado${nao.length > 1 ? 's' : ''} nesta emissão)` : ''
  if (!t.length) return `Não foram identificados, nas bases consultadas, desmatamento posterior a 22/07/2008, alertas de desmatamento ou embargos vigentes na área${naoTxt}.`
  return `Constam ainda, na parte do imóvel dentro da unidade: ${t.join('; ')}${naoTxt}.`
}

function carucDossieVariaveis(sn) {
  const sigla = String(sn.uc.sigla || '').toUpperCase()
  return {
    uc_nome: sn.uc.nome,
    uc_categoria: CARUC_CATEGORIA_NOME[sigla] ? `${CARUC_CATEGORIA_NOME[sigla]} (${sigla})` : (sigla || sn.uc.categoria || '—'),
    uc_ato_criacao: sn.uc.ato_criacao || 'ato de criação não cadastrado no sistema',
    uc_data_criacao: _cdData(sn.uc.data_criacao) || 'data não cadastrada',
    dispositivo_snuc: CARUC_DISPOSITIVO_SNUC[sigla] ? 'Lei nº 9.985/2000, ' + CARUC_DISPOSITIVO_SNUC[sigla] : 'Lei nº 9.985/2000',
    cod_imovel: sn.cod_imovel,
    tipo_imovel: carucTipoImovel(sn.tipo_imovel),
    municipio: sn.municipio || 'não informado',
    area_total_ha: _cdN(sn.area_total_ha),
    area_uc_ha: _cdN(sn.area_uc_ha),
    pct_uc: _cdN(sn.pct_uc, 1) + '%',
    data_inscricao: _cdData(sn.data_inscricao) || 'não informada',
    frase_inscricao: _cdFraseInscricao(sn),
    frase_agravantes: _cdFraseAgravantes(sn),
    situacao_sicar: [sn.status_sicar, sn.condicao_sicar].filter(Boolean).join(' — ') || 'não informada',
  }
}

// Placeholder sem valor vira "—", nunca o {{nome}} cru no documento.
function carucPreencherModelo(texto, vars) {
  return String(texto || '').replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (_, k) => vars[k] != null && vars[k] !== '' ? String(vars[k]) : '—')
}

// ── Estado (pedidos da UC aberta, modelos) ──────────────────────────
let _carucSolPorCod = new Map()
let _carucModelos = null

function carucSolPodeEditar() {
  const p = appState?.permissoes?.monitoramento
  return appState?.perfil === 'super_admin' || ['editar', 'aprovar', 'admin'].includes(p)
}

async function carucSolCarregarUC(ucId) {
  _carucSolPorCod = new Map()
  const { data, error } = await db.from('vw_car_solicitacoes_imac')
    .select('id,protocolo,cod_imovel,status,tipo_pedido,emitido_em').eq('uc_id', ucId).order('emitido_em', { ascending: false })
  if (error) { console.warn('[carsol] pedidos da UC', error); return }
  for (const s of (data || [])) if (!_carucSolPorCod.has(s.cod_imovel)) _carucSolPorCod.set(s.cod_imovel, s)
}

async function carucModelosCarregar(forcar) {
  if (_carucModelos && !forcar) return _carucModelos
  const { data, error } = await db.from('car_fundamentacao_modelos')
    .select('id,chave,versao,titulo,texto,hash_sha256,situacao,parecer_juridico,validado_em,criado_em').order('versao', { ascending: false })
  if (error) throw new Error('Modelos de fundamentação indisponíveis: ' + error.message)
  const m = {}
  for (const r of (data || [])) if (!m[r.chave]) m[r.chave] = r
  _carucModelos = m
  return m
}

// Botão/selo na linha do imóvel da tabela da UC.
function carucDossieBotaoHTML(i) {
  const s = _carucSolPorCod.get(i.cod)
  if (s) {
    const st = CARSOL_STATUS[s.status] || { rotulo: s.status, badge: 'badge-cinza' }
    return `<span class="caruc-nota" style="display:block;margin-top:4px">Pedido ${esc(s.protocolo)} · <span class="badge ${st.badge}">${esc(st.rotulo)}</span></span>`
      + (CARSOL_ABERTOS.includes(s.status) || !carucSolPodeEditar() ? '' : `<button type="button" class="btn btn-xs btn-secondary" style="margin-top:4px" data-dossie="${esc(i.cod)}">Novo pedido ao IMAC</button>`)
  }
  if (!carucSolPodeEditar() || !_carucRel) return ''
  const t = carucDossieTipo(i, _carucRel.uc, _carucRel.enquadramento)
  if (!t.permitido) return ''
  return `<button type="button" class="btn btn-xs btn-secondary" style="margin-top:4px" data-dossie="${esc(i.cod)}" title="${esc(t.motivo)}">Pedido ao IMAC</button>`
}

// ── Janela genérica ─────────────────────────────────────────────────
function _cdModal(id, titulo, corpo, rodape, largura = 760) {
  document.getElementById(id)?.remove()
  const el = document.createElement('div')
  el.className = 'modal-overlay aberto'
  el.id = id
  el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-labelledby', id + '-t')
  el.innerHTML = `<div class="modal" style="max-width:${largura}px">
    <div class="modal-header"><div class="modal-title" id="${id}-t">${titulo}</div><button type="button" class="modal-close" aria-label="Fechar" data-fechar>×</button></div>
    <div class="modal-body">${corpo}</div>
    <div class="modal-footer">${rodape}</div></div>`
  document.body.appendChild(el)
  const fechar = () => { el.remove(); document.removeEventListener('keydown', esc_) }
  const esc_ = ev => { if (ev.key === 'Escape') fechar() }
  document.addEventListener('keydown', esc_)
  el.addEventListener('click', ev => { if (ev.target === el || ev.target.closest('[data-fechar]')) fechar() })
  setTimeout(() => el.querySelector('input,textarea,select,button:not([data-fechar])')?.focus(), 0)
  return { el, fechar }
}

function _cdMsgErro(e) { return String(e?.message || e).replace(/^.*?ERROR:\s*/, '') }

// ── Emissão ─────────────────────────────────────────────────────────
async function carucDossieAbrir(cod) {
  const rel = _carucRel
  const im = rel?.imoveis.find(i => i.cod === cod)
  if (!im) return
  const tipo = carucDossieTipo(im, rel.uc, rel.enquadramento)
  if (!tipo.permitido) { toast(tipo.motivo, 'warning'); return }
  let modelos
  try { modelos = await carucModelosCarregar(true) } catch (e) { toast(_cdMsgErro(e), 'error'); return }
  const mod = modelos[CARUC_PEDIDO[tipo.tipo].chave]
  if (!mod) { toast('Modelo de fundamentação não cadastrado para este tipo de pedido.', 'error'); return }
  const sn = carucDossieSnapshot(im, rel)
  const texto = carucPreencherModelo(mod.texto, carucDossieVariaveis(sn))
  const mapa = _cdMapaVetor(rel, im)
  const u = appState?.usuario || {}
  const corpo = `
    <div class="caruc-enq ${esc(rel.enquadramento.nivel)}" style="margin-bottom:10px"><strong>${esc(CARUC_PEDIDO[tipo.tipo].rotulo)}.</strong> ${esc(tipo.motivo)}</div>
    ${mod.situacao !== 'validado' ? `<div class="caruc-aviso" style="margin-bottom:10px">Fundamentação em <strong>minuta</strong> (modelo v${mod.versao}), ainda não validada pelo Jurídico da SEMA — o PDF sai marcado como minuta. A validação é feita na aba "Solicitações ao IMAC".</div>` : ''}
    <div class="table-wrap"><table class="caruc-mini"><tbody>
      <tr><td>Nº do CAR</td><td><strong>${esc(sn.cod_imovel)}</strong></td></tr>
      <tr><td>Tipo · situação no SICAR</td><td>${esc(carucTipoImovel(sn.tipo_imovel))} · ${esc([sn.status_sicar, sn.condicao_sicar].filter(Boolean).join(' — ') || '—')}</td></tr>
      <tr><td>Área do imóvel (polígono)</td><td>${_cdN(sn.area_total_ha)} ha</td></tr>
      <tr><td>Área dentro da UC</td><td><strong>${_cdN(sn.area_uc_ha)} ha · ${_cdN(sn.pct_uc, 1)}% do imóvel</strong>${sn.pct_da_uc != null ? ` · ${_cdN(sn.pct_da_uc, 3)}% da UC` : ''}</td></tr>
      <tr><td>Inscrição</td><td>${esc(_cdFraseInscricao(sn))}</td></tr>
      <tr><td>Zonas atingidas</td><td>${sn.zonas.length ? sn.zonas.map(z => `${esc(z.nome)} (${_cdN(z.ha)} ha)`).join('; ') : (sn.zoneamento_fonte ? 'Nenhuma zona cadastrada atingida' : 'UC sem zoneamento cadastrado')}</td></tr>
    </tbody></table></div>
    <div class="caruc-mapa" style="margin:10px 0">${mapa || '<div class="caruc-nota" style="padding:12px">Imóvel sem polígono para o mapa.</div>'}</div>
    <details style="margin:8px 0"><summary style="cursor:pointer;font-weight:600;font-size:13px;min-height:24px">Fundamentação jurídica (prévia)</summary>
      <div style="white-space:pre-wrap;font-size:12.5px;line-height:1.5;max-height:280px;overflow:auto;border:1px solid #E5E7EB;border-radius:6px;padding:10px;margin-top:6px">${esc(texto)}</div></details>
    <div class="grid-2" style="gap:10px;margin-top:10px">
      <div><label class="caruc-rot" for="cd-ass-nome">Quem assina (gestor/a da UC)</label><input class="form-control" id="cd-ass-nome" value="${esc(u.nome_completo || '')}" maxlength="120"></div>
      <div><label class="caruc-rot" for="cd-ass-cargo">Cargo</label><input class="form-control" id="cd-ass-cargo" value="Gestor(a) da ${esc(rel.uc.nome)}" maxlength="160"></div>
    </div>
    <label class="caruc-check" style="margin-top:10px"><input type="checkbox" id="cd-conferi"><span>Conferi os números, o mapa e o tipo de pedido<small>Ao emitir, o pedido recebe protocolo, os dados ficam congelados e o PDF é guardado no sistema (não pode ser substituído).</small></span></label>
    <p class="caruc-nota">O dossiê não traz nome nem CPF/CNPJ do titular — o nº da inscrição identifica o registro para o IMAC.</p>`
  const m = _cdModal('cd-modal', 'Pedido ao IMAC — ' + esc(cod), corpo,
    `<button type="button" class="btn btn-secondary" data-fechar>Cancelar</button><button type="button" class="btn btn-primary" id="cd-emitir">Emitir dossiê e baixar PDF</button>`)
  m.el.querySelector('#cd-emitir').addEventListener('click', ev => carucDossieEmitir(ev.currentTarget, { rel, im, tipo: tipo.tipo, mod, sn, texto, fechar: m.fechar }))
}

function _cdMapaDados(rel, im) {
  return { uc: rel.geo?.uc || null, zonas: rel.geo?.zonas || [], cars: im._mapa ? [{ rot: '1', cod: im.cod, geom: im._mapa }] : [], fora: [], acre: null }
}
const CARUC_DOSSIE_ROTULO_MAPA = 'Imóvel do CAR objeto do pedido (1)'

function _cdMapaVetor(rel, im) {
  if (!im._mapa || typeof carucMapaVistas !== 'function') return ''
  const dados = _cdMapaDados(rel, im), vistas = carucMapaVistas(dados)
  return carucMapaSVGs(dados, vistas, { fundo: 'sem' }).zoom || ''
}

async function _sha256Hex(buf) {
  const h = await crypto.subtle.digest('SHA-256', buf)
  return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, '0')).join('')
}

async function carucDossieEmitir(btn, c) {
  const nome = document.getElementById('cd-ass-nome').value.trim()
  const cargo = document.getElementById('cd-ass-cargo').value.trim()
  if (nome.length < 3 || cargo.length < 3) { toast('Informe nome e cargo de quem assina.', 'warning'); return }
  if (!document.getElementById('cd-conferi').checked) { toast('Marque que conferiu os dados antes de emitir.', 'warning'); return }
  const restaurar = btnEspera(btn)
  let sol = null, blob = null, nomeArq = null
  try {
    // 1º o que pode falhar devagar (bibliotecas e mapas), SÓ DEPOIS o protocolo.
    if (typeof _carucCarregarExportacao === 'function') await _carucCarregarExportacao()
    await _agpdfCarregarLibs()
    const mapas = await _cdMapasParaPdf(c.rel, c.im)
    const cab = await getCabecalhoRelatorio('monitoramento')
    const logos = {
      gov: cab.logoGoverno ? await _agpdfBuscarDataURL(cab.logoGoverno) : null,
      secr: cab.logoSecr ? await _agpdfBuscarDataURL(cab.logoSecr) : null,
    }
    const { data, error } = await db.rpc('car_solicitacao_emitir', {
      p_uc_id: c.rel.uc.id, p_cod_imovel: c.im.cod, p_tipo: c.tipo, p_modelo_id: c.mod.id,
      p_fundamentacao: c.texto, p_snapshot: c.sn, p_assinante_nome: nome, p_assinante_cargo: cargo,
    })
    if (error) throw error
    const r = Array.isArray(data) ? data[0] : data
    sol = { id: r.id, protocolo: r.protocolo, emitido_em: new Date().toISOString(), tipo_pedido: c.tipo,
      modelo_versao: c.mod.versao, modelo_situacao: c.mod.situacao, modelo_hash: c.mod.hash_sha256,
      fundamentacao_texto: c.texto, snapshot: c.sn, assinante_nome: nome, assinante_cargo: cargo }
    const pdf = carucDossieMontarPdf(sol, { cab, logos, mapas })
    blob = pdf.output('blob')
    nomeArq = `dossie-car-imac_${sol.protocolo}.pdf`
    carucBaixarBlob(blob, nomeArq)
    const hash = await _sha256Hex(await blob.arrayBuffer())
    const caminho = `${c.rel.uc.id}/${sol.id}.pdf`
    const up = await db.storage.from('car-dossies').upload(caminho, blob, { contentType: 'application/pdf', upsert: false })
    if (up.error) throw new Error('PDF baixado, mas não foi guardado no sistema: ' + up.error.message)
    const rp = await db.rpc('car_solicitacao_registrar_pdf', { p_id: sol.id, p_path: caminho, p_sha256: hash })
    if (rp.error) throw new Error('PDF guardado, mas o registro do hash falhou: ' + rp.error.message)
    toast(`Pedido ${sol.protocolo} emitido. PDF baixado e guardado no sistema.`, 'success')
    c.fechar()
  } catch (e) {
    console.error('[carsol] emitir', e)
    toast(sol ? `Pedido ${sol.protocolo} criado, mas: ${_cdMsgErro(e)}` : _cdMsgErro(e), 'error')
    if (sol) c.fechar()
  } finally {
    restaurar()
    if (sol) {
      await carucSolCarregarUC(c.rel.uc.id)
      if (typeof carucAtualizar === 'function') carucAtualizar()
    }
  }
}

// Mapas rasterizados ANTES do protocolo: zoom no imóvel + UC inteira, no
// fundo escolhido na consulta (satélite cai para sem fundo se falhar).
async function _cdMapasParaPdf(rel, im) {
  if (!im._mapa || typeof carucMapaVistas !== 'function') return null
  const dados = _cdMapaDados(rel, im), vistas = carucMapaVistas(dados)
  const querSat = (rel.opcoes?.fundoMapa || 'satelite') === 'satelite'
  let imagemZoom = null, imagemUC = null
  if (querSat) [imagemZoom, imagemUC] = await Promise.all([
    vistas.zoom ? carucMapaFundoSatelite(vistas.zoom) : null,
    vistas.uc ? carucMapaFundoSatelite(vistas.uc) : null,
  ])
  const sat = querSat && !!imagemZoom && (!vistas.uc || !!imagemUC)
  const fundo = sat ? 'satelite' : 'sem'
  const svgs = carucMapaSVGs(dados, vistas, { fundo, imagemZoom, imagemUC })
  const rodape = carucMapaRodapeSVG(dados, vistas, { fundo: querSat ? 'satelite' : 'sem', semSatelite: querSat && !sat, rotuloCar: CARUC_DOSSIE_ROTULO_MAPA, largura: 860 })
  const out = { sat, semSatelite: querSat && !sat }
  if (svgs.zoom) out.zoom = await carucMapaSvgParaImagem(svgs.zoom, 2, sat)
  if (svgs.uc) out.uc = await carucMapaSvgParaImagem(svgs.uc, 2, sat)
  if (rodape) out.rodape = await carucMapaSvgParaImagem(rodape, 2, false)
  return out
}

// ── PDF do dossiê (retrato) ─────────────────────────────────────────
// Usa os primitivos do PDF da Água (timbre único, tabela, rodapé com
// protocolo) — nenhum layout de PDF novo.
function _cdLinhas(ctx, texto, opts = {}) {
  const { pdf } = ctx
  const tam = opts.tam || 9, lh = tam * 0.47, x = AGPDF_M + (opts.recuo || 0)
  pdf.setFont('DMSans', opts.bold ? 'bold' : 'normal'); pdf.setFontSize(tam)
  pdf.setTextColor(...(opts.cor || AGPDF_COR.texto))
  for (const l of pdf.splitTextToSize(texto, ctx.W - AGPDF_M * 2 - (opts.recuo || 0))) {
    _agpdfGarantirEspaco(ctx, lh + 1)
    pdf.setFont('DMSans', opts.bold ? 'bold' : 'normal'); pdf.setFontSize(tam); pdf.setTextColor(...(opts.cor || AGPDF_COR.texto))
    pdf.text(l, x, ctx.y)
    ctx.y += lh
  }
  ctx.y += opts.depois ?? 2
}

function carucDossieMontarPdf(sol, { cab, logos, mapas }) {
  const { jsPDF } = window.jspdf
  const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: true })
  pdf.addFileToVFS('DMSans-Regular.ttf', BIOPDF_FONT_REGULAR_B64); pdf.addFont('DMSans-Regular.ttf', 'DMSans', 'normal')
  pdf.addFileToVFS('DMSans-Bold.ttf', BIOPDF_FONT_BOLD_B64); pdf.addFont('DMSans-Bold.ttf', 'DMSans', 'bold')
  pdf.setFont('DMSans', 'normal')
  const ctx = _agpdfCtx(pdf, cab, sol.protocolo)
  ctx.linhaModulo = 'Pedido ao IMAC — CAR em UC'
  const sn = sol.snapshot
  const minuta = sol.modelo_situacao !== 'validado'
  const kv = body => _agpdfTabela(ctx, { body, theme: 'plain', styles: { font: 'DMSans', fontSize: 8.4, cellPadding: 1.2 }, columnStyles: { 0: { fontStyle: 'bold', cellWidth: 58 } } })

  pdf.setFont('DMSans', 'bold'); pdf.setFontSize(13); pdf.setTextColor(...AGPDF_COR.floresta)
  pdf.text('Dossiê técnico de sobreposição de CAR em Unidade de Conservação', AGPDF_M, ctx.y + 2)
  ctx.y += 7
  _cdLinhas(ctx, `${CARUC_PEDIDO[sol.tipo_pedido].rotulo} · Pedido nº ${sol.protocolo}`, { tam: 10, bold: true, cor: AGPDF_COR.texto, depois: 3 })
  if (minuta) {
    pdf.setFillColor(254, 242, 242); pdf.setDrawColor(185, 28, 28); pdf.setLineWidth(0.4)
    pdf.roundedRect(AGPDF_M, ctx.y - 1, ctx.W - AGPDF_M * 2, 10, 1.5, 1.5, 'FD')
    pdf.setFont('DMSans', 'bold'); pdf.setFontSize(8.6); pdf.setTextColor(153, 27, 27)
    pdf.text(`MINUTA — fundamentação jurídica (modelo v${sol.modelo_versao}) pendente de validação pelo Jurídico da SEMA.`, AGPDF_M + 3, ctx.y + 3.4)
    pdf.setFont('DMSans', 'normal'); pdf.setFontSize(7.6)
    pdf.text('Não encaminhar ao IMAC antes da validação; os trechos [CONFERIR …] precisam ser resolvidos.', AGPDF_M + 3, ctx.y + 7.4)
    ctx.y += 14
  }
  kv([
    ['Destinatário', 'Instituto de Meio Ambiente do Acre – IMAC'],
    ['Remetente', `${cab.secretaria || 'Secretaria de Estado do Meio Ambiente'} — gestão da ${sn.uc.nome}`],
    ['Assunto', `${CARUC_PEDIDO[sol.tipo_pedido].rotulo} da inscrição ${sn.cod_imovel} no SICAR, por incidir em unidade de conservação`],
    ['Emissão', new Date(sol.emitido_em).toLocaleString('pt-BR')],
  ])

  _agpdfTitulo(ctx, '1. Identificação do imóvel')
  kv([
    ['Nº da inscrição no CAR', sn.cod_imovel],
    ['Tipo de imóvel', carucTipoImovel(sn.tipo_imovel)],
    ['Situação no SICAR', [sn.status_sicar, sn.condicao_sicar].filter(Boolean).join(' — ') || '—'],
    ['Município', sn.municipio || '—'],
    ['Data de inscrição', _cdData(sn.data_inscricao) || 'não informada'],
    ['Área declarada', sn.area_declarada_ha != null ? _cdN(sn.area_declarada_ha) + ' ha' : '—'],
    ['Titular', 'Identificado no SICAR pelo nº da inscrição. Nome e CPF/CNPJ omitidos neste dossiê (LGPD, art. 6º, III — necessidade).'],
  ])

  _agpdfTitulo(ctx, '2. Unidade de conservação')
  kv([
    ['Unidade', `${sn.uc.nome}${sn.uc.codigo ? ' (' + sn.uc.codigo + ')' : ''}`],
    ['Categoria · esfera', `${carucDossieVariaveis(sn).uc_categoria} · ${sn.uc.esfera || '—'}`],
    ['Ato de criação', sn.uc.ato_criacao || 'não cadastrado no sistema'],
    ['Data de criação', _cdData(sn.uc.data_criacao) || '—'],
    ['Área oficial', sn.uc.area_ha ? _cdN(sn.uc.area_ha, 0) + ' ha' : '—'],
    ['Regime (SNUC)', `${sn.enquadramento.rotulo}. ${sn.enquadramento.texto}`],
  ])
  if (sn.uc.esfera === 'federal') _cdLinhas(ctx, 'UC de gestão federal: recomenda-se dar ciência deste pedido ao órgão gestor (ICMBio).', { tam: 8, cor: AGPDF_COR.muted2 })

  _agpdfTitulo(ctx, '3. Quantificação da sobreposição')
  kv([
    ['Área do imóvel (polígono no SICAR)', _cdN(sn.area_total_ha) + ' ha'],
    ['Área do imóvel dentro da UC', _cdN(sn.area_uc_ha) + ' ha'],
    ['Percentual do imóvel na UC', _cdN(sn.pct_uc, 1) + '%' + (sn.faixa_uc ? ` (${sn.faixa_uc})` : '')],
    ['Percentual da UC ocupado pelo imóvel', sn.pct_da_uc != null ? _cdN(sn.pct_da_uc, 3) + '%' : '—'],
    ['Inscrição × criação da UC', _cdFraseInscricao(sn)],
  ])
  if (sn.zonas.length) {
    _agpdfTabela(ctx, { head: [['Zona de manejo atingida', 'Enquadramento', 'Área (ha)']],
      body: sn.zonas.map(z => [z.nome, carucEnquadrarZona(z.codigo, z.nome).rotulo, _cdN(z.ha)]), columnStyles: { 2: { halign: 'right' } } })
    if (sn.zoneamento_fonte) _cdLinhas(ctx, 'Zoneamento: ' + sn.zoneamento_fonte + '.', { tam: 7.6, cor: AGPDF_COR.muted2 })
  } else _cdLinhas(ctx, sn.zoneamento_fonte ? 'O imóvel não atinge nenhuma zona de manejo cadastrada.' : 'UC sem zoneamento cadastrado no sistema.', { tam: 8, cor: AGPDF_COR.muted2 })
  if (sn.zee?.length) _cdLinhas(ctx, 'ZEE Fase III (parte na UC): ' + sn.zee.map(z => z.cod + (z.ha != null ? ` (${_cdN(z.ha)} ha)` : '')).join('; ') + '.', { tam: 8 })

  if (mapas && (mapas.zoom || mapas.uc)) {
    const larg = ctx.W - AGPDF_M * 2
    const imgs = [mapas.zoom, mapas.uc].filter(Boolean)
    const alt = 78
    const ws = imgs.map(im => alt * im.w / im.h)
    const escala = Math.min(1, (larg - 3 * (imgs.length - 1)) / ws.reduce((a, b) => a + b, 0))
    // Título e mapas na mesma página: o título nunca fica sozinho no pé.
    _agpdfGarantirEspaco(ctx, alt * escala + 18)
    _agpdfTitulo(ctx, '4. Mapas')
    let x = AGPDF_M
    imgs.forEach((im, k) => {
      const w = ws[k] * escala, h = alt * escala
      pdf.addImage(im.dataUrl, mapas.sat ? 'JPEG' : 'PNG', x, ctx.y, w, h)
      pdf.setDrawColor(...AGPDF_COR.borda); pdf.setLineWidth(0.2); pdf.rect(x, ctx.y, w, h)
      x += w + 3
    })
    ctx.y += alt * escala + 4.5
    _cdLinhas(ctx, 'À esquerda, o imóvel (1) com o limite e as zonas da UC; à direita, a UC inteira com a área ampliada marcada.', { tam: 7.6, cor: AGPDF_COR.muted2 })
    if (mapas.rodape) {
      const h = larg * mapas.rodape.h / mapas.rodape.w
      _agpdfGarantirEspaco(ctx, h + 2)
      pdf.addImage(mapas.rodape.dataUrl, 'PNG', AGPDF_M, ctx.y, larg, h)
      ctx.y += h + 4
    }
  }

  _agpdfTitulo(ctx, `${mapas ? 5 : 4}. Outras informações das bases oficiais`)
  const amb = []
  amb.push(['Desmatamento PRODES/INPE após 22/07/2008', sn.prodes ? _cdN(sn.prodes.pos_marco_ha) + ' ha' : 'não consultado nesta emissão'])
  amb.push(['Alertas DETER/INPE', sn.deter ? `${sn.deter.alertas} (${_cdN(sn.deter.ha, 1)} ha)` : 'não consultado nesta emissão'])
  if (sn.focos) amb.push([`Focos de calor ${sn.focos.de}–${sn.focos.ate}`, String(sn.focos.n)])
  amb.push(['Embargos ambientais (IBAMA/IMAC)', sn.embargos.length ? sn.embargos.map(e => `${e.rotulo} — ${CARUC_EMBARGO_SITUACAO[e.situacao] || e.situacao}`).join('; ') : 'nenhum incidente'])
  amb.push(['Sobreposição com outros CARs (≥ 0,1 ha)', sn.sobreposicoes_car.length ? sn.sobreposicoes_car.slice(0, 8).map(s => `${s.cod} (${_cdN(s.ha, 1)} ha)`).join('; ') + (sn.sobreposicoes_car.length > 8 ? ` e mais ${sn.sobreposicoes_car.length - 8}` : '') : 'nenhuma'])
  if (sn.fracionamento) amb.push(['Possível fracionamento', 'mesmo titular com 2+ imóveis pequenos somando mais de 4 módulos fiscais nesta UC'])
  kv(amb)

  _agpdfTitulo(ctx, `${mapas ? 6 : 5}. Fundamentação e pedido`)
  for (const linha of String(sol.fundamentacao_texto).split('\n')) {
    const l = linha.trim()
    if (!l) continue
    if (l.startsWith('## ')) { ctx.y += 1; _cdLinhas(ctx, l.slice(3), { tam: 9.4, bold: true, cor: AGPDF_COR.floresta, depois: 1 }); continue }
    if (/^\d+\.\s/.test(l)) { _cdLinhas(ctx, l, { tam: 9, recuo: 4, depois: 1.2 }); continue }
    _cdLinhas(ctx, l, { tam: 9, depois: 2.4 })
  }

  // Assinatura (manual) do(a) gestor(a) da UC.
  _agpdfGarantirEspaco(ctx, 42)
  ctx.y += 6
  const hoje = new Date(sol.emitido_em).toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'America/Rio_Branco' })
  _cdLinhas(ctx, `Rio Branco – AC, ${hoje}.`, { tam: 9, depois: 18 })
  const cx = ctx.W / 2
  pdf.setDrawColor(...AGPDF_COR.texto); pdf.setLineWidth(0.3); pdf.line(cx - 45, ctx.y, cx + 45, ctx.y)
  pdf.setFont('DMSans', 'bold'); pdf.setFontSize(9); pdf.setTextColor(...AGPDF_COR.texto)
  pdf.text(sol.assinante_nome, cx, ctx.y + 4.5, { align: 'center' })
  pdf.setFont('DMSans', 'normal'); pdf.setFontSize(8.2)
  pdf.text(pdf.splitTextToSize(sol.assinante_cargo, 120), cx, ctx.y + 8.8, { align: 'center' })
  ctx.y += 18

  _agpdfTitulo(ctx, 'Notas e fontes')
  const notas = [
    `Geometria do imóvel e situação: WFS público do SICAR, consultado em ${new Date(sn.sicar_consultado_em).toLocaleString('pt-BR')}. Áreas e percentuais: interseção do polígono do imóvel com o limite da UC, calculada no SIGUC-AC (medida do desenho, não registral).`,
    'Os dados deste dossiê ficam congelados no SIGUC-AC no momento da emissão; o arquivo PDF é guardado sem possibilidade de substituição e o seu hash SHA-256 fica registrado no pedido.',
    `Fundamentação: modelo "${CARUC_PEDIDO[sol.tipo_pedido].chave}" v${sol.modelo_versao} (${minuta ? 'minuta, pendente de validação jurídica' : 'validado pelo Jurídico'}) · hash do modelo ${String(sol.modelo_hash || '').slice(0, 16)}…`,
  ]
  if (mapas?.sat && typeof CARUC_MAPA_CREDITO !== 'undefined') notas.push(CARUC_MAPA_CREDITO + '.')
  notas.forEach(n => _cdLinhas(ctx, n, { tam: 7.6, cor: AGPDF_COR.muted2 }))

  _agpdfAplicarCabecalhoRodapeGlobal(ctx, logos)
  return pdf
}

// ══════════════════════════════════════════════════════════════════════
// Aba "Solicitações ao IMAC" — acompanhamento + modelos jurídicos
// ══════════════════════════════════════════════════════════════════════
let _carsolLista = []
let _carsolFiltro = { uc: '', status: 'abertos' }

async function carsolRenderAba(el) {
  el.innerHTML = `
    <div class="card" style="margin-bottom:16px">
      <div class="card-header"><div><div class="card-title">Pedidos ao IMAC — CAR em UC</div>
        <div class="card-subtitle">Cancelamento ou retificação de inscrições que incidem em unidade de conservação. O pedido nasce na aba "CAR na UC", pelo botão de cada imóvel.</div></div>
        <button type="button" class="btn btn-sm btn-secondary" id="carsol-conferir">Conferir situação no SICAR</button></div>
      <div class="card-body">
        <div class="filter-bar" style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:12px">
          <select class="form-control" id="carsol-f-uc" style="max-width:320px" aria-label="Filtrar por UC"><option value="">Todas as UCs</option></select>
          <select class="form-control" id="carsol-f-status" style="max-width:240px" aria-label="Filtrar por situação">
            <option value="abertos">Em andamento</option><option value="">Todos</option>
            ${Object.entries(CARSOL_STATUS).map(([k, v]) => `<option value="${k}">${esc(v.rotulo)}</option>`).join('')}
          </select>
        </div>
        <div id="carsol-lista">${skeletonTabelaHTML(7, 4)}</div>
      </div>
    </div>
    <div class="card" style="margin-bottom:20px">
      <div class="card-header"><div><div class="card-title">Modelos de fundamentação jurídica</div>
        <div class="card-subtitle">Editar cria uma versão nova. A validação pelo Jurídico exige resolver todas as marcas [CONFERIR …].</div></div></div>
      <div class="card-body" id="carsol-modelos">${skeletonBlocoHTML(3)}</div>
    </div>`
  el.querySelector('#carsol-f-uc').addEventListener('change', ev => { _carsolFiltro.uc = ev.target.value; _carsolDesenharLista() })
  el.querySelector('#carsol-f-status').addEventListener('change', ev => { _carsolFiltro.status = ev.target.value; _carsolDesenharLista() })
  el.querySelector('#carsol-conferir').addEventListener('click', ev => carsolConferirSicar(ev.currentTarget))
  el.querySelector('#carsol-lista').addEventListener('click', ev => {
    const b = ev.target.closest('[data-acao]')
    if (!b) return
    const s = _carsolLista.find(x => x.id === b.dataset.id)
    if (!s) return
    if (b.dataset.acao === 'pdf') carsolBaixarPdf(s, b)
    else if (b.dataset.acao === 'status') carsolAbrirStatus(s)
    else if (b.dataset.acao === 'hist') carsolAbrirHistorico(s)
  })
  el.querySelector('#carsol-modelos').addEventListener('click', ev => {
    const b = ev.target.closest('[data-modelo]')
    if (b) carsolAbrirModelo(b.dataset.modelo, b.dataset.acao)
  })
  await Promise.all([carsolCarregar(), carsolDesenharModelos()])
}

async function carsolCarregar() {
  const { data, error } = await db.from('vw_car_solicitacoes_imac')
    .select('id,protocolo,uc_id,uc_nome,uc_sigla,cod_imovel,tipo_pedido,status,modelo_versao,modelo_situacao,snapshot->area_uc_ha,snapshot->pct_uc,assinante_nome,pdf_path,pdf_sha256,numero_oficio,numero_processo,situacao_sicar_emissao,situacao_sicar_atual,sicar_conferido_em,emitido_por_nome,emitido_em,ultimo_evento_em')
    .order('emitido_em', { ascending: false }).limit(1000)
  const box = document.getElementById('carsol-lista')
  if (error) { box.innerHTML = `<div class="caruc-aviso">Não foi possível carregar os pedidos: ${esc(error.message)}</div>`; return }
  _carsolLista = data || []
  const sel = document.getElementById('carsol-f-uc')
  const ucs = [...new Map(_carsolLista.map(s => [s.uc_id, s.uc_nome])).entries()].sort((a, b) => a[1].localeCompare(b[1]))
  sel.innerHTML = '<option value="">Todas as UCs</option>' + ucs.map(([id, n]) => `<option value="${esc(id)}"${_carsolFiltro.uc === id ? ' selected' : ''}>${esc(n)}</option>`).join('')
  _carsolDesenharLista()
}

function _carsolDesenharLista() {
  const box = document.getElementById('carsol-lista')
  if (!box) return
  const f = _carsolFiltro
  const lista = _carsolLista.filter(s => (!f.uc || s.uc_id === f.uc)
    && (!f.status || (f.status === 'abertos' ? CARSOL_ABERTOS.includes(s.status) : s.status === f.status)))
  if (!lista.length) {
    box.innerHTML = `<p class="caruc-nota" style="padding:12px 0">${_carsolLista.length ? 'Nenhum pedido com esses filtros.' : 'Nenhum pedido emitido ainda. Gere o relatório "CAR na UC" e use o botão "Pedido ao IMAC" na linha do imóvel.'}</p>`
    return
  }
  const pode = carucSolPodeEditar()
  box.innerHTML = `<div class="table-wrap"><table class="table">
    <thead><tr><th>Protocolo</th><th>UC · CAR</th><th>Pedido</th><th class="num">Na UC</th><th>Situação do pedido</th><th>SICAR (emissão → agora)</th><th>Emitido</th><th>Ações</th></tr></thead>
    <tbody>${lista.map(s => {
      const st = CARSOL_STATUS[s.status] || { rotulo: s.status, badge: 'badge-cinza' }
      const mudouSicar = s.situacao_sicar_atual && s.situacao_sicar_atual !== s.situacao_sicar_emissao
      return `<tr>
        <td style="white-space:nowrap"><strong>${esc(s.protocolo)}</strong>${s.modelo_situacao !== 'validado' ? '<br><span class="badge badge-erro" title="Fundamentação não validada pelo Jurídico na emissão">minuta</span>' : ''}</td>
        <td>${esc(s.uc_nome)}<br><span class="caruc-cod">${esc(s.cod_imovel)}</span></td>
        <td>${esc(CARUC_PEDIDO[s.tipo_pedido]?.rotulo || s.tipo_pedido)}</td>
        <td class="num">${_cdN(s.area_uc_ha)} ha<br><span class="caruc-nota">${_cdN(s.pct_uc, 1)}%</span></td>
        <td><span class="badge ${st.badge}">${esc(st.rotulo)}</span>${s.numero_oficio ? `<br><span class="caruc-nota">Ofício: ${esc(s.numero_oficio)}</span>` : ''}${s.numero_processo ? `<br><span class="caruc-nota">Processo: ${esc(s.numero_processo)}</span>` : ''}</td>
        <td>${esc(s.situacao_sicar_emissao || '—')} → <strong${mudouSicar ? ' style="color:#BE123C"' : ''}>${esc(s.situacao_sicar_atual || '—')}</strong>${s.sicar_conferido_em ? `<br><span class="caruc-nota">conferido em ${formatData(s.sicar_conferido_em)}</span>` : ''}</td>
        <td>${formatData(s.emitido_em)}<br><span class="caruc-nota">${esc(s.emitido_por_nome || '')}</span></td>
        <td style="white-space:nowrap">
          ${s.pdf_path ? `<button type="button" class="btn btn-xs btn-secondary" data-acao="pdf" data-id="${s.id}">PDF</button>` : '<span class="caruc-nota" title="O PDF não chegou a ser guardado. Arquive este pedido e emita outro.">sem PDF</span>'}
          <button type="button" class="btn btn-xs btn-secondary" data-acao="hist" data-id="${s.id}">Histórico</button>
          ${pode && CARSOL_PROXIMOS[s.status] ? `<button type="button" class="btn btn-xs btn-primary" data-acao="status" data-id="${s.id}">Atualizar</button>` : ''}
        </td></tr>`
    }).join('')}</tbody></table></div>
    <p class="caruc-nota">Situação no SICAR: o botão "Conferir situação no SICAR" consulta o SICAR ao vivo para os pedidos em andamento. CAR que aparece cancelado avisa quem emitiu, mas o status do pedido só muda quando alguém registra a decisão do IMAC.</p>`
}

async function carsolBaixarPdf(s, btn) {
  const restaurar = btnEspera(btn)
  try {
    const { data, error } = await db.storage.from('car-dossies').createSignedUrl(s.pdf_path, 300)
    if (error) throw error
    window.open(data.signedUrl, '_blank', 'noopener')
  } catch (e) { toast('Não foi possível abrir o PDF: ' + _cdMsgErro(e), 'error') } finally { restaurar() }
}

const CARSOL_DOC_ROTULO = {
  enviado_imac: 'Nº do ofício ou processo do envio (obrigatório)',
  declarante_notificado: 'Nº da notificação / processo no IMAC',
  deferido: 'Nº do ato / processo da decisão', indeferido: 'Nº do ato / processo da decisão', retificado: 'Referência da retificação (opcional)', arquivado: 'Referência (opcional)',
}

function carsolAbrirStatus(s) {
  const prox = CARSOL_PROXIMOS[s.status] || []
  const corpo = `<p style="margin-top:0">Pedido <strong>${esc(s.protocolo)}</strong> · CAR ${esc(s.cod_imovel)} · hoje: ${esc(CARSOL_STATUS[s.status]?.rotulo || s.status)}</p>
    <label class="caruc-rot" for="carsol-novo">Nova situação</label>
    <select class="form-control" id="carsol-novo">${prox.map(k => `<option value="${k}">${esc(CARSOL_STATUS[k].rotulo)}</option>`).join('')}</select>
    <label class="caruc-rot" for="carsol-doc" id="carsol-doc-rot" style="margin-top:10px">${esc(CARSOL_DOC_ROTULO[prox[0]] || 'Referência')}</label>
    <input class="form-control" id="carsol-doc" maxlength="120">
    <label class="caruc-rot" for="carsol-obs" style="margin-top:10px">Observação <span class="caruc-nota">(obrigatória para deferido, indeferido, retificado e arquivado)</span></label>
    <textarea class="form-control" id="carsol-obs" rows="4" maxlength="2000"></textarea>`
  const m = _cdModal('carsol-modal-status', 'Atualizar pedido', corpo,
    `<button type="button" class="btn btn-secondary" data-fechar>Cancelar</button><button type="button" class="btn btn-primary" id="carsol-salvar">Salvar</button>`, 560)
  m.el.querySelector('#carsol-novo').addEventListener('change', ev => { m.el.querySelector('#carsol-doc-rot').textContent = CARSOL_DOC_ROTULO[ev.target.value] || 'Referência' })
  m.el.querySelector('#carsol-salvar').addEventListener('click', async ev => {
    const restaurar = btnEspera(ev.currentTarget)
    try {
      const { error } = await db.rpc('car_solicitacao_mudar_status', {
        p_id: s.id, p_status: m.el.querySelector('#carsol-novo').value,
        p_observacao: m.el.querySelector('#carsol-obs').value, p_documento_ref: m.el.querySelector('#carsol-doc').value,
      })
      if (error) throw error
      toast('Pedido atualizado.', 'success')
      m.fechar()
      await carsolCarregar()
    } catch (e) { toast(_cdMsgErro(e), 'error') } finally { restaurar() }
  })
}

async function carsolAbrirHistorico(s) {
  const m = _cdModal('carsol-modal-hist', 'Histórico — ' + esc(s.protocolo), skeletonBlocoHTML(3), '<button type="button" class="btn btn-secondary" data-fechar>Fechar</button>', 640)
  const { data, error } = await db.from('vw_car_solicitacoes_imac_historico').select('status_de,status_para,observacao,documento_ref,por_nome,em')
    .eq('solicitacao_id', s.id).order('em')
  m.el.querySelector('.modal-body').innerHTML = error ? `<div class="caruc-aviso">${esc(error.message)}</div>`
    : `<ol style="padding-left:18px;margin:0">${(data || []).map(h => `<li style="margin-bottom:10px"><strong>${esc(CARSOL_STATUS[h.status_para]?.rotulo || h.status_para)}</strong> · ${esc(new Date(h.em).toLocaleString('pt-BR'))} · ${esc(h.por_nome || '—')}
        ${h.documento_ref ? `<br><span class="caruc-nota">Referência: ${esc(h.documento_ref)}</span>` : ''}${h.observacao ? `<br>${esc(h.observacao)}` : ''}</li>`).join('')}</ol>
       ${s.pdf_sha256 ? `<p class="caruc-nota">SHA-256 do PDF guardado: <code style="word-break:break-all">${esc(s.pdf_sha256)}</code></p>` : ''}`
}

// Consulta o SICAR (WFS, via /api/car-proxy) para os pedidos em andamento.
async function carsolConferirSicar(btn) {
  const abertos = _carsolLista.filter(s => CARSOL_ABERTOS.includes(s.status))
  if (!abertos.length) { toast('Nenhum pedido em andamento para conferir.', 'info'); return }
  const restaurar = btnEspera(btn)
  try {
    const geo = await carucBuscarGeomsPorCodigos([...new Set(abertos.map(s => s.cod_imovel))])
    let mudou = 0, falhou = 0
    for (const s of abertos) {
      const w = geo.get(s.cod_imovel)
      const sit = w ? carucSituacaoAtual(null, w.properties) : null
      const txt = !w ? 'Não encontrado no SICAR' : (sit.status || sit.situacao || 'Não informado')
      const { error } = await db.rpc('car_solicitacao_conferir_sicar', { p_id: s.id, p_situacao: txt })
      if (error) falhou++
      else if (txt !== s.situacao_sicar_atual) mudou++
    }
    toast(`${abertos.length} pedido(s) conferido(s) no SICAR · ${mudou} com situação nova${falhou ? ` · ${falhou} falha(s)` : ''}.`, falhou ? 'warning' : 'success')
    await carsolCarregar()
  } catch (e) { toast('SICAR indisponível: ' + _cdMsgErro(e), 'error') } finally { restaurar() }
}

async function carsolDesenharModelos() {
  const box = document.getElementById('carsol-modelos')
  if (!box) return
  let m
  try { m = await carucModelosCarregar(true) } catch (e) { box.innerHTML = `<div class="caruc-aviso">${esc(_cdMsgErro(e))}</div>`; return }
  const pode = carucSolPodeEditar()
  box.innerHTML = `<div class="table-wrap"><table class="caruc-mini"><thead><tr><th>Modelo</th><th>Versão</th><th>Situação</th><th>Marcas [CONFERIR]</th><th>Ações</th></tr></thead><tbody>
    ${Object.values(CARUC_PEDIDO).map(p => {
      const r = m[p.chave]
      if (!r) return `<tr><td>${esc(p.rotulo)}</td><td colspan="4" class="caruc-nota">não cadastrado</td></tr>`
      const marcas = (r.texto.match(/\[CONFERIR/g) || []).length
      return `<tr><td>${esc(r.titulo)}</td><td>v${r.versao}</td>
        <td>${r.situacao === 'validado' ? `<span class="badge badge-verde">validado</span><br><span class="caruc-nota">${esc(r.parecer_juridico || '')}</span>` : '<span class="badge badge-erro">minuta</span>'}</td>
        <td class="num">${marcas}</td>
        <td style="white-space:nowrap"><button type="button" class="btn btn-xs btn-secondary" data-modelo="${r.chave}" data-acao="ver">${pode ? 'Ver / editar' : 'Ver'}</button>
          ${pode && r.situacao !== 'validado' ? `<button type="button" class="btn btn-xs btn-primary" data-modelo="${r.chave}" data-acao="validar"${marcas ? ' disabled title="Resolva as marcas [CONFERIR …] antes"' : ''}>Validar (Jurídico)</button>` : ''}</td></tr>`
    }).join('')}</tbody></table></div>
    <p class="caruc-nota">Campos que o sistema preenche: {{uc_nome}}, {{uc_categoria}}, {{uc_ato_criacao}}, {{uc_data_criacao}}, {{dispositivo_snuc}}, {{cod_imovel}}, {{tipo_imovel}}, {{municipio}}, {{area_total_ha}}, {{area_uc_ha}}, {{pct_uc}}, {{data_inscricao}}, {{frase_inscricao}}, {{frase_agravantes}}, {{situacao_sicar}}. Linha iniciada por "## " vira subtítulo; "1. " vira item do pedido.</p>`
}

function carsolAbrirModelo(chave, acao) {
  const r = _carucModelos?.[chave]
  if (!r) return
  const pode = carucSolPodeEditar()
  if (acao === 'validar') {
    const m = _cdModal('carsol-modal-val', 'Validar modelo — ' + esc(r.titulo),
      `<p style="margin-top:0">Versão v${r.versao}. A validação registra quem validou e o parecer. Pedidos emitidos depois disso saem sem a marca de minuta.</p>
       <label class="caruc-rot" for="carsol-parecer">Parecer / nota do Jurídico (nº e data)</label><input class="form-control" id="carsol-parecer" maxlength="300">`,
      `<button type="button" class="btn btn-secondary" data-fechar>Cancelar</button><button type="button" class="btn btn-primary" id="carsol-val-ok">Validar</button>`, 560)
    m.el.querySelector('#carsol-val-ok').addEventListener('click', async ev => {
      const restaurar = btnEspera(ev.currentTarget)
      try {
        const { error } = await db.rpc('car_modelo_validar', { p_id: r.id, p_parecer: m.el.querySelector('#carsol-parecer').value })
        if (error) throw error
        toast('Modelo validado.', 'success'); m.fechar(); await carsolDesenharModelos()
      } catch (e) { toast(_cdMsgErro(e), 'error') } finally { restaurar() }
    })
    return
  }
  const m = _cdModal('carsol-modal-mod', esc(r.titulo) + ` — v${r.versao}`,
    `<label class="caruc-rot" for="carsol-mod-tit">Título</label><input class="form-control" id="carsol-mod-tit" value="${esc(r.titulo)}" ${pode ? '' : 'readonly'}>
     <label class="caruc-rot" for="carsol-mod-txt" style="margin-top:10px">Texto</label>
     <textarea class="form-control" id="carsol-mod-txt" rows="20" style="font-size:12.5px;line-height:1.5" ${pode ? '' : 'readonly'}>${esc(r.texto)}</textarea>
     <p class="caruc-nota">Hash SHA-256 desta versão: <code style="word-break:break-all">${esc(r.hash_sha256)}</code></p>`,
    `<button type="button" class="btn btn-secondary" data-fechar>Fechar</button>${pode ? '<button type="button" class="btn btn-primary" id="carsol-mod-salvar">Salvar como nova versão</button>' : ''}`, 900)
  m.el.querySelector('#carsol-mod-salvar')?.addEventListener('click', async ev => {
    const texto = m.el.querySelector('#carsol-mod-txt').value
    if (texto === r.texto) { toast('O texto não mudou.', 'info'); return }
    const restaurar = btnEspera(ev.currentTarget)
    try {
      const { error } = await db.rpc('car_modelo_salvar_versao', { p_chave: chave, p_titulo: m.el.querySelector('#carsol-mod-tit').value, p_texto: texto })
      if (error) throw error
      toast(`Versão v${r.versao + 1} salva como minuta.`, 'success'); m.fechar(); await carsolDesenharModelos()
    } catch (e) { toast(_cdMsgErro(e), 'error') } finally { restaurar() }
  })
}

if (typeof module !== 'undefined') {
  module.exports = { carucDossieTipo, carucDossieSnapshot, carucDossieVariaveis, carucPreencherModelo, CARUC_PEDIDO, CARSOL_PROXIMOS }
}
