// ── SIGUC-AC · Edge Function: sisbio-sisgen ──────────────────
// Valida números de autorização nas APIs do IBAMA (SISBIO) e CGEN (SISGEN)
// Chamada pelo frontend — credenciais ficam seguras no servidor

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Allowlist de origens. Se ALLOWED_ORIGINS (env) existir, usa match exato.
// Caso contrário, libera o domínio oficial, qualquer preview *.vercel.app
// e localhost — bloqueando sites de terceiros.
const ALLOWED = (Deno.env.get('ALLOWED_ORIGINS') ?? '')
  .split(',').map(o => o.trim()).filter(Boolean)
const DEFAULT_ALLOW = [
  'https://siguc.sema.ac.gov.br',
  'https://siguc-ac.vercel.app',
]
function origemPermitida(origin: string): boolean {
  if (!origin) return false
  if (ALLOWED.length) return ALLOWED.includes(origin)
  if (DEFAULT_ALLOW.includes(origin)) return true
  if (/^https:\/\/[a-z0-9-]+\.vercel\.app$/.test(origin)) return true
  if (/^http:\/\/localhost(:\d+)?$/.test(origin)) return true
  return false
}

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': DEFAULT_ALLOW[0],
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Vary': 'Origin',
}

function aplicarCors(req: Request) {
  const origin = req.headers.get('origin') ?? ''
  CORS['Access-Control-Allow-Origin'] = origemPermitida(origin) ? origin : (ALLOWED[0] ?? DEFAULT_ALLOW[0])
}

// ── Endpoints das APIs governamentais ────────────────────────
// SISBIO: consulta pública de licenças IBAMA
const SISBIO_URL = 'https://servicos.ibama.gov.br/phpmyfaq/index.php'
// SISBIO autenticada (requer credenciais institucionais IBAMA)
const SISBIO_API_URL = Deno.env.get('SISBIO_API_URL') ??
  'https://servicos.ibama.gov.br/ctf/publico/arh/ConsultaPublicaARH.php'
// SISGEN: Sistema Nacional de Gestão do Patrimônio Genético
const SISGEN_API_URL = Deno.env.get('SISGEN_API_URL') ??
  'https://sisgen.gov.br/api/consulta-cadastro'

const IBAMA_USER = Deno.env.get('IBAMA_USER') ?? ''
const IBAMA_PASS = Deno.env.get('IBAMA_PASS') ?? ''

// ── Validação SISBIO ─────────────────────────────────────────
async function validarSISBIO(numero: string): Promise<{
  valido: boolean
  dados: Record<string, unknown>
  erro?: string
}> {
  try {
    // Consulta pública de ARH (Autorização de Remessa para Herbário) / licenças
    // A API real exige Basic Auth com credenciais institucionais IBAMA
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    }
    if (IBAMA_USER && IBAMA_PASS) {
      headers['Authorization'] = 'Basic ' + btoa(`${IBAMA_USER}:${IBAMA_PASS}`)
    }

    const resp = await fetch(`${SISBIO_API_URL}?numeroLicenca=${encodeURIComponent(numero)}`, {
      headers,
      signal: AbortSignal.timeout(10_000),
    })

    if (!resp.ok) {
      // Fallback: se a API não estiver disponível, registra como pendente de validação manual
      return {
        valido: false,
        dados: { numero, httpStatus: resp.status },
        erro: `API SISBIO retornou status ${resp.status}. Validação manual necessária.`,
      }
    }

    const body = await resp.json()

    // Interpreta resposta (estrutura real a ajustar conforme documentação IBAMA)
    const ativo   = body.situacao === 'VIGENTE' || body.status === 'ATIVO'
    const validade = body.dataVencimento || body.validade || null

    return {
      valido: ativo,
      dados: {
        numero,
        titular:   body.titular   || body.nomePesquisador || null,
        validade,
        uc:        body.localColeta || body.unidadeConservacao || null,
        especie:   body.grupoTaxonomico || null,
        situacao:  body.situacao || body.status || null,
        raw:       body,
      },
    }
  } catch (err) {
    return {
      valido: false,
      dados: { numero },
      erro: `Erro ao consultar SISBIO: ${(err as Error).message}`,
    }
  }
}

// ── Validação SISGEN ─────────────────────────────────────────
async function validarSISGEN(numero: string): Promise<{
  valido: boolean
  dados: Record<string, unknown>
  erro?: string
}> {
  try {
    const resp = await fetch(`${SISGEN_API_URL}/${encodeURIComponent(numero)}`, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(10_000),
    })

    if (!resp.ok) {
      return {
        valido: false,
        dados: { numero, httpStatus: resp.status },
        erro: `API SISGEN retornou status ${resp.status}. Validação manual necessária.`,
      }
    }

    const body = await resp.json()
    const ativo = body.situacaoCadastro === 'ATIVO' || body.ativo === true

    return {
      valido: ativo,
      dados: {
        numero,
        titular:  body.titular || body.responsavel || null,
        objetivo: body.objetivoCadastro || null,
        situacao: body.situacaoCadastro || null,
        raw:      body,
      },
    }
  } catch (err) {
    return {
      valido: false,
      dados: { numero },
      erro: `Erro ao consultar SISGEN: ${(err as Error).message}`,
    }
  }
}

// ── Handler principal ─────────────────────────────────────────
serve(async (req) => {
  aplicarCors(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    // Valida autenticação Supabase
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Não autorizado' }), {
        status: 401, headers: { ...CORS, 'Content-Type': 'application/json' },
      })
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    )
    const { data: { user }, error: authErr } = await supabase.auth.getUser()
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: 'Sessão inválida' }), {
        status: 401, headers: { ...CORS, 'Content-Type': 'application/json' },
      })
    }

    const { sistema, numero, pesquisa_id } = await req.json() as {
      sistema: 'sisbio' | 'sisgen'
      numero: string
      pesquisa_id?: string
    }

    if (!sistema || !numero) {
      return new Response(JSON.stringify({ error: 'Parâmetros obrigatórios: sistema, numero' }), {
        status: 400, headers: { ...CORS, 'Content-Type': 'application/json' },
      })
    }

    // Executa validação
    const resultado = sistema === 'sisbio'
      ? await validarSISBIO(numero.trim())
      : await validarSISGEN(numero.trim())

    // Se pesquisa_id fornecido, persiste o resultado no banco
    if (pesquisa_id) {
      const supabaseAdmin = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      )
      const campo = sistema === 'sisbio' ? {
        sisbio_status:      resultado.valido ? 'validado' : (resultado.erro ? 'invalido' : 'pendente'),
        sisbio_dados:       resultado.dados,
        sisbio_validado_em: new Date().toISOString(),
        sisbio_validade:    (resultado.dados.validade as string) || null,
      } : {
        sisgen_status:      resultado.valido ? 'validado' : (resultado.erro ? 'invalido' : 'pendente'),
        sisgen_dados:       resultado.dados,
        sisgen_validado_em: new Date().toISOString(),
      }
      await supabaseAdmin.from('pesquisas').update(campo).eq('id', pesquisa_id)
    }

    return new Response(JSON.stringify(resultado), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }
})
