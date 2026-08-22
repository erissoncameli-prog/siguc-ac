// ═══════════════════════════════════════════════════════════
// SIGUC-AC · Edge Function — ingestão das estações da ANA
// HidroWebService (telemetria: nível, chuva, vazão) → rh_medicoes.
//
// ESTADO: pronta e DESLIGADA. Sem as credenciais da ANA nos secrets
// (ANA_HIDROWEB_ID / ANA_HIDROWEB_SENHA) a função devolve
// `{ ok:false, motivo:'sem-credencial' }` e não grava nada — de
// propósito, para poder ser publicada antes de a SEMA concluir o
// cadastro no HidroWeb. Medido nesta entrega, do próprio banco
// (pg_net): a API responde 401 sem credencial e o serviço SOAP antigo
// (telemetriaws1) não responde mais — não há via anônima.
//
// Como ligar, quando as credenciais existirem:
//   1. Painel do Supabase → Edge Functions → Secrets:
//      ANA_HIDROWEB_ID e ANA_HIDROWEB_SENHA (nunca no frontend, nunca
//      no repositório).
//   2. Agendar no pg_cron (a migration 307 já deixa o job criado e
//      desabilitado — basta habilitar).
//
// Idempotente: grava via RPC rh_registrar_medicoes, que faz upsert por
// (estacao_id, data_hora, origem). Reprocessar a mesma janela nunca
// duplica leitura.
// ═══════════════════════════════════════════════════════════

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SUPABASE_SRK = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const ANA_ID       = Deno.env.get('ANA_HIDROWEB_ID') ?? ''
const ANA_SENHA    = Deno.env.get('ANA_HIDROWEB_SENHA') ?? ''

const ANA_BASE = 'https://www.ana.gov.br/hidrowebservice'
const HORAS_JANELA = 30   // reprocessa um pouco mais que 24h: leitura atrasada da telemetria entra na próxima rodada

const db = createClient(SUPABASE_URL, SUPABASE_SRK)

// Token da ANA — vale ~1h; pedimos um por execução (a função roda 1×/dia).
async function autenticar(): Promise<string> {
  const r = await fetch(`${ANA_BASE}/EstacoesTelemetricas/OAUth/v1`, {
    headers: { Identificador: ANA_ID, Senha: ANA_SENHA },
    signal: AbortSignal.timeout(20000),
  })
  if (!r.ok) throw new Error(`OAuth ANA HTTP ${r.status}`)
  const j = await r.json()
  const token = j?.items?.tokenautenticacao ?? j?.tokenautenticacao
  if (!token) throw new Error('Resposta da ANA sem token de autenticação')
  return token
}

function ymd(d: Date): string { return d.toISOString().slice(0, 10) }

// Série telemétrica adotada (dado já consistido pela ANA quando existe;
// cai para a série bruta se a adotada vier vazia).
async function buscarSerie(token: string, codigo: string, desde: Date): Promise<any[]> {
  const url = `${ANA_BASE}/EstacoesTelemetricas/HidroinfoanaSerieTelemetricaAdotada/v1`
    + `?Código da Estação=${encodeURIComponent(codigo)}`
    + `&Tipo Filtro Data=DATA_LEITURA`
    + `&Data de Busca (yyyy-MM-dd)=${ymd(desde)}`
    + `&Range Intervalo de busca=HORA_2`
  const r = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(30000),
  })
  if (!r.ok) throw new Error(`Série ${codigo}: HTTP ${r.status}`)
  const j = await r.json()
  return j?.items ?? []
}

// A ANA nomeia os campos de forma diferente entre endpoints; aceitar as
// variações aqui é mais barato que descobrir em produção que a coluna
// mudou de nome e a série parou de entrar.
function campo(item: any, nomes: string[]): number | null {
  for (const n of nomes) {
    const v = item?.[n]
    if (v !== undefined && v !== null && String(v).trim() !== '') {
      const num = Number(String(v).replace(',', '.'))
      if (isFinite(num)) return num
    }
  }
  return null
}

function dataHora(item: any): string | null {
  const d = item?.Data_Hora_Medicao ?? item?.data_hora_medicao ?? item?.Data_Hora ?? item?.dataHora
  if (!d) return null
  const s = String(d).trim().replace(' ', 'T')
  const dt = new Date(s.endsWith('Z') || /[+-]\d{2}:?\d{2}$/.test(s) ? s : `${s}Z`)
  return isNaN(dt.getTime()) ? null : dt.toISOString()
}

Deno.serve(async (req) => {
  const inicio = Date.now()
  try {
    if (!ANA_ID || !ANA_SENHA) {
      // Não é erro: é o estado esperado enquanto a SEMA não conclui o
      // cadastro na ANA. Responder 200 evita alarme falso no cron.
      return Response.json({
        ok: false, motivo: 'sem-credencial',
        detalhe: 'Defina ANA_HIDROWEB_ID e ANA_HIDROWEB_SENHA nos secrets para ligar a ingestão.',
      })
    }

    // Só estações da ANA com código e telemetria — as demais são
    // alimentadas por importação de planilha ou digitação.
    const { data: estacoes, error } = await db
      .from('rh_estacoes')
      .select('id, codigo_ana, nome')
      .eq('ativo', true).eq('telemetrica', true)
      .not('codigo_ana', 'is', null)
    if (error) throw error

    const desde = new Date(Date.now() - HORAS_JANELA * 3600 * 1000)
    const token = await autenticar()

    let gravadas = 0
    const falhas: string[] = []

    for (const e of estacoes ?? []) {
      try {
        const itens = await buscarSerie(token, e.codigo_ana, desde)
        const medicoes = itens.map((it: any) => {
          const dh = dataHora(it)
          if (!dh) return null
          return {
            estacao_id: e.id,
            data_hora: dh,
            // Nível vem em cm na telemetria da ANA; vazão em m³/s;
            // chuva acumulada do intervalo, em mm.
            nivel_cm:  campo(it, ['Cota_Adotada', 'cota_adotada', 'Cota', 'cota']),
            chuva_mm:  campo(it, ['Chuva_Adotada', 'chuva_adotada', 'Chuva', 'chuva']),
            vazao_m3s: campo(it, ['Vazao_Adotada', 'vazao_adotada', 'Vazao', 'vazao']),
            origem: 'telemetria',
            bruto: it,
          }
        }).filter(Boolean)

        if (medicoes.length) {
          const { data: n, error: err2 } = await db.rpc('rh_registrar_medicoes', { p_medicoes: medicoes })
          if (err2) throw err2
          gravadas += Number(n ?? 0)
        }
      } catch (err) {
        falhas.push(`${e.nome} (${e.codigo_ana}): ${err.message}`)
      }
    }

    // Passar as cotas em revisão logo depois de ingerir: quem acabou de
    // subir acima da cota é notificado na mesma rodada, sem esperar o
    // cron seguinte.
    let notificadas = 0
    try {
      const { data: n } = await db.rpc('rh_checar_cotas')
      notificadas = Number(n ?? 0)
    } catch (err) {
      falhas.push(`checar cotas: ${err.message}`)
    }

    return Response.json({
      ok: true,
      estacoes: estacoes?.length ?? 0,
      medicoes_gravadas: gravadas,
      notificacoes: notificadas,
      falhas,
      ms: Date.now() - inicio,
    })
  } catch (err) {
    return Response.json({ ok: false, erro: err.message }, { status: 500 })
  }
})
