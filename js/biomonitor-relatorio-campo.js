// ── SIGUC Biomonitor — PDF de campo (app) + compartilhar ───────────
// Gera a ficha resumida de UM ninho (modo 'resumido' de
// js/biomonitor-relatorio-ninho.js — sem fotos, sem biometria individual
// por filhote) usando o mesmo motor jsPDF do relatório web (bioMontarPdfNinhos)
// e entrega o PDF pra compartilhar direto por WhatsApp/e-mail a partir do
// card de "Ninhos abertos". Exige conexão (mesmo padrão de degradação do
// resto do app).
// Depende de: bioSupabase(), bioToast() (biomonitor-quelonios.js/sync.js);
// bioColetarDadosRelatorioNinhos(), bioMontarPdfNinhos() (biomonitor-relatorio-ninho.js);
// compartilharArquivo() (js/compartilhar-arquivo.js).

const BIOCAMPO_CAB_PADRAO = {
  governo: 'Governo do Estado do Acre', gestao: '',
  secretaria: 'Secretaria de Estado do Meio Ambiente do Acre', siglaSecr: 'SEMA-AC',
  diretoria: 'Diretoria de Meio Ambiente', siglaDiret: 'DIMA',
  departamento: 'Departamento de Biodiversidade', siglaDep: 'DEBIO',
  logoGoverno: null, logoSecr: null,
}

// ── Compartilhar o arquivo já gerado ────────────────────────────────
// Lógica das 3 camadas (nativo → Web Share → baixar) centralizada em
// js/compartilhar-arquivo.js — Água virou o 2º consumidor nesta
// entrega (ficha de coleta em PDF). Mantido como wrapper aqui só para
// não mudar a assinatura já usada pelo resto deste arquivo.
async function bioCompartilharArquivo(blob, filename, titulo) {
  await compartilharArquivo(blob, filename, titulo, msg => bioToast(msg, ''))
}

// Logos institucionais (mesmas de config_sistema.dados.logos usadas na tela
// de login do app — aqui a variante colorida normal, para fundo branco).
async function _biocampoBuscarLogos() {
  try {
    const { data } = await bioSupabase().from('config_sistema').select('dados').eq('id', 1).single()
    const logos = data?.dados?.logos
    return { logoGoverno: logos?.governo_url || null, logoSecr: logos?.secretaria_url || null }
  } catch (e) {
    console.warn('[biomonitor] logos institucionais indisponíveis para o PDF:', e)
    return { logoGoverno: null, logoSecr: null }
  }
}

// ── Ponto de entrada: botão "Gerar PDF" no card do ninho ────────────
async function bioGerarPDFCampo(n) {
  if (!navigator.onLine) { bioToast('Requer conexão para gerar o PDF.', 'err'); return }
  bioToast('Gerando PDF…', '')

  try {
    const [ninhos, logos] = await Promise.all([
      bioColetarDadosRelatorioNinhos(bioSupabase(), [n.id], { modo: 'resumido' }),
      _biocampoBuscarLogos(),
    ])
    if (!ninhos.length) { bioToast('Ninho não encontrado.', 'err'); return }
    const ninho = ninhos[0]

    const cab = {
      ...BIOCAMPO_CAB_PADRAO,
      ...logos,
      responsavel: { nome: BioApp.monitor?.nome_completo || 'Monitor de campo', orgao: 'SEMA-AC' },
    }
    const protocolo = 'CAMPO-' + new Date().toISOString().slice(0, 10).replace(/-/g, '')
    const pdf = await bioMontarPdfNinhos(ninhos, cab, protocolo, 'resumido')

    const filename = `ficha-ninho-${String(ninho.numero_ninho || ninho.id).replace(/[^\w-]+/g, '-')}.pdf`
    const blob = pdf.output('blob')
    await bioCompartilharArquivo(blob, filename, `Ficha do ninho ${ninho.numero_ninho}`)
  } catch (e) {
    console.error('[biomonitor] gerar PDF de campo:', e)
    bioToast('Erro ao gerar PDF: ' + e.message, 'err')
  }
}
