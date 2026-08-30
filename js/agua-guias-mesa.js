// ── Qualidade da Água — guias das telas de MESA ────────────────
// Contraparte de js/agua-guias.js (app de campo). Mesmo motor
// (js/guia-app.js), escopo próprio: 'agua-mesa'.
//
// Um catálogo só para as cinco telas do módulo, e não um por página:
// quem opera a mesa transita entre elas o dia inteiro, e a dúvida
// costuma ser sobre o ENCADEAMENTO ("por que essa coleta não aparece
// na fila de laudos?"), não sobre um botão isolado. Passo cujo alvo
// não existe na página aberta vira cartão de texto — é o motor que
// resolve isso, sem duas versões do conteúdo.

const AGUA_GUIAS_MESA = {
  escopo: 'agua-mesa',
  titulo: 'Ajuda e treinamento — Qualidade da Água',

  guias: [
    {
      slug: 'caminho-do-dado', titulo: 'O caminho de uma coleta', icone: 'list', versao: 1,
      resumo: 'Do frasco no rio até o painel público — quem faz o quê, e onde.',
      passos: [
        { titulo: 'Cinco etapas, cinco telas', icone: 'list',
          texto: 'Entender a ordem resolve a maior parte das dúvidas do módulo. Cada etapa tem uma tela e um responsável diferente.',
          lista: ['**Campo** — o técnico registra a coleta no app e etiqueta o frasco.',
                  '**Laboratório** — analisa a amostra e devolve o laudo em PDF.',
                  '**Laudos** — a mesa lança os resultados do laudo na coleta.',
                  '**Conferência** — resolve o que ficou em quarentena.',
                  '**Relatórios / Painel público** — leitura do resultado.'] },
        { titulo: 'O IQA aparece no fim, não no começo', icone: 'sliders',
          texto: 'O Índice de Qualidade da Água só pode ser calculado quando os parâmetros de laboratório chegam. Coleta recém-vinda do campo aparece **sem IQA** — isso é o esperado, não é falha de cálculo.' },
        { titulo: 'O cálculo vive no banco', icone: 'shield',
          texto: 'IQA e conformidade CONAMA são calculados por funções do banco de dados, com base nos valores medidos. **Nenhuma tela recalcula nem permite digitar a faixa** — é o que impede que dois lugares do sistema discordem sobre o mesmo rio.' },
        { titulo: 'IQA e CONAMA são leituras separadas', icone: 'help',
          texto: 'Um rio pode ter IQA "Boa" e ainda assim violar o limite de turbidez da sua classe. São perguntas diferentes: o IQA resume a qualidade geral; o CONAMA compara parâmetro a parâmetro com o limite legal do enquadramento.',
          nota: 'Existe um terceiro estado: ponto cuja classe não tem limites cadastrados. Isso NÃO é "conforme" — é "não avaliado", e aparece assim.' }
      ]
    },

    {
      slug: 'lancar-laudo', titulo: 'Lançar o laudo do laboratório', icone: 'clipboard', versao: 1,
      resumo: 'A fila de coletas aguardando laudo e a leitura assistida do PDF.',
      passos: [
        { titulo: 'A fila', icone: 'list',
          texto: 'A tela lista as coletas com status **aguardando laboratório**: já vieram do campo e ainda não têm os resultados analíticos.',
          alvo: '#tbody-fila' },
        { titulo: 'Achar a coleta certa', icone: 'search',
          texto: 'Você pode filtrar por texto ou, se o navegador permitir, **ler o QR da etiqueta do frasco** com a câmera — o app abre direto a coleta daquele frasco.',
          alvo: '#lz-btn-scan',
          nota: 'Sem suporte a leitura de código no navegador, o botão simplesmente não aparece e a busca por texto continua valendo.' },
        { titulo: 'Leitura assistida do PDF', icone: 'upload',
          texto: 'Ao anexar o PDF do laudo, o sistema tenta ler os valores e **propõe** o preenchimento, campo a campo, mostrando o recorte da imagem ao lado de cada número.',
          lista: ['Os laudos são digitalizados — o sistema faz reconhecimento óptico, que erra às vezes.',
                  'Nada é gravado sem sua confirmação campo a campo.',
                  'A conferência mostra a **imagem** do laudo, não o texto lido — texto errado reexibido pareceria tão correto quanto o certo.'],
          alvo: '#lz-parser-area' },
        { titulo: 'A trava de identidade', icone: 'shield',
          texto: 'Se a data da coleta ou a procedência do laudo divergirem da coleta aberta na tela, **nenhum valor é proposto** — só o confronto aparece. É a defesa contra lançar o laudo do ponto A na coleta do ponto B.',
          alvo: '#lz-identidade-alerta' },
        { titulo: 'Prazo de preservação', icone: 'clock',
          texto: 'O sistema compara o intervalo entre a coleta e o recebimento no laboratório com o prazo de cada parâmetro (Standard Methods). Estourar o prazo é **aviso, nunca bloqueio**: o resultado não é falso, é de validade comprometida — e isso precisa ficar registrado.',
          alvo: '#lz-prazo-alerta' },
        { titulo: 'Alertas ao salvar', icone: 'bell',
          texto: 'Valores são comparados com o histórico do próprio ponto. Aqui na mesa, diferente do app de campo, valor **fisicamente impossível bloqueia** o salvamento; valor apenas improvável pede confirmação.',
          alvo: '#lz-alertas' }
      ]
    },

    {
      slug: 'conferir-quarentena', titulo: 'Conferência de quarentena', icone: 'search', versao: 1,
      resumo: 'O que é quarentena e como resolver uma linha suspeita.',
      passos: [
        { titulo: 'O que é quarentena', icone: 'help',
          texto: 'Coleta em quarentena tem algum dado que o sistema não conseguiu dar por confirmado — valor fora de faixa física, unidade suspeita, data incoerente. **Não é lixo e não é erro do operador**: é dado que precisa de um humano com o laudo físico na mão.' },
        { titulo: 'Ela nunca é escondida', icone: 'eye',
          texto: 'Coleta em quarentena aparece nos relatórios, no mapa e no painel público, **marcada como preliminar**. Escondê-la daria a impressão falsa de que não houve coleta naquela campanha — boa parte da série recente ainda está aqui.' },
        { titulo: 'Corrigir campo a campo', icone: 'edit',
          texto: 'Abra a linha, confira cada valor contra o laudo físico e corrija o que estiver errado. O motivo original da quarentena fica visível o tempo todo.',
          alvo: '#ag-motivo' },
        { titulo: 'Promover ou manter', icone: 'check',
          texto: 'Duas saídas, e as duas são legítimas.',
          lista: ['**Promover** — o dado foi conferido e passa a valer como completo. Exige resolver os bloqueios pendentes.',
                  '**Manter em quarentena** — você conferiu e a dúvida continua. Registre a observação; é melhor que promover no escuro.'],
          alvo: '#btn-promover' }
      ]
    },

    {
      slug: 'cadastros-agua', titulo: 'Cadastros e etiquetas', icone: 'pin', versao: 1,
      resumo: 'Pontos, laboratórios, equipamentos, gabaritos de laudo e etiquetas em lote.',
      passos: [
        { titulo: 'Pontos de coleta', icone: 'pin',
          texto: 'O ponto define a coordenada oficial, a bacia, o rio e a **classe de enquadramento** — que por sua vez define quais limites do CONAMA valem ali. Ponto novo só aparece no app depois que o coletor atualizar a lista no aparelho.',
          alvo: '#aba-pontos' },
        { titulo: 'Laboratórios', icone: 'clipboard',
          texto: 'Cada laudo aponta o laboratório que o produziu. Isso permite rastrear mudança de patamar da série que decorra de troca de prestador — e não apenas do rio.',
          alvo: '#aba-labs' },
        { titulo: 'Gabaritos de laudo', icone: 'sliders',
          texto: 'O gabarito diz **onde**, na página do PDF, fica cada valor daquele laboratório. É o que permite a leitura assistida. Medir as posições é trabalho de quem está olhando o laudo real; esta aba cadastra o resultado dessa medição.',
          alvo: '#aba-templates',
          nota: 'Editar um gabarito muda o que o sistema propõe em todo lançamento futuro — por isso a edição pede reautenticação e justificativa.' },
        { titulo: 'Etiquetas em lote', icone: 'printer',
          texto: 'Gera o PDF das etiquetas de coletas já sincronizadas. É o **plano B** para quando a impressora térmica falha em campo. Aqui também fica o relatório de códigos reservados que nunca viraram coleta.',
          alvo: '#aba-etiquetas' }
      ]
    },

    {
      slug: 'ler-o-painel', titulo: 'Ler o painel de relatórios', icone: 'binoculo', versao: 1,
      resumo: 'Escopo, filtros, cada gráfico e a exportação.',
      passos: [
        { titulo: 'Começa no Acre todo', icone: 'map',
          texto: 'O painel abre com o estado inteiro — não é preciso escolher bacia para ver alguma coisa. Recortar por bacia, rio, período ou faixa é passo seguinte, na gaveta de filtros.',
          alvo: '#rl-btn-filtros' },
        { titulo: 'Os números do topo', icone: 'sliders',
          texto: 'Os KPIs resumem o recorte ativo. O IQA médio aparece como **número, sem faixa**: classificar uma média seria recalcular o índice — e a faixa vale para uma coleta, não para a média de várias.' },
        { titulo: 'Conformidade CONAMA', icone: 'shield',
          texto: 'O medidor separa três estados, nunca dois: conforme, com violação, e **sem limites cadastrados** para a classe do ponto. O terceiro não é conformidade — é ausência de parâmetro de comparação.' },
        { titulo: 'O mapa', icone: 'map',
          texto: 'O preenchimento do pino é a faixa do IQA, a borda é a conformidade CONAMA, e o preenchimento fraco marca coleta em conferência. Clicar no pino abre o detalhe da coleta mais recente daquele ponto.',
          lista: ['Limite do Acre, municípios e hidrografia aparecem na visão de satélite.',
                  'Cor e espessura das delimitações são ajustáveis pela engrenagem — é preferência do seu navegador, não do sistema.'],
          alvo: '#rl-mapa' },
        { titulo: 'Exportar', icone: 'download',
          texto: 'O mesmo painel sai em PDF (documento de registro, com timbre e protocolo), PPTX (apresentação, com gráficos editáveis) e planilha.',
          alvo: '#rl-btn-export' },
        { titulo: 'A versão pública', icone: 'share',
          texto: 'Existe um painel gêmeo, sem login, para publicar no site da SEMA. Ele mostra os mesmos gráficos, mas **nunca** coletor, GPS do aparelho, fotos, laudos nem observações internas.' }
      ]
    },

    {
      slug: 'mapa-das-coletas', titulo: 'O mapa das coletas', icone: 'map', versao: 1,
      resumo: 'Eixo por campanha e o que significa um ponto vazado.',
      passos: [
        { titulo: 'O eixo é por campanha', icone: 'clock',
          texto: 'A linha do tempo anda por **campanha real** (ano e ordem — primeira ou segunda), não por intervalo contínuo de datas: só existem cerca de vinte campanhas em toda a série.',
          alvo: '#amapa-tl-slider' },
        { titulo: 'Ponto vazado', icone: 'help',
          texto: 'Ponto sem coleta na campanha escolhida fica **vazado, nunca some**. Sumir daria a impressão de que o ponto foi desativado; vazado diz o que de fato aconteceu — não houve coleta ali naquela campanha.' },
        { titulo: 'A gaveta lateral', icone: 'layers',
          texto: 'Clicar num ponto abre a gaveta com IQA e conformidade em blocos separados. Ela **não é modal**: o mapa continua utilizável com a gaveta aberta, e ela fecha só no ✕.',
          alvo: '#amapa-gaveta' }
      ]
    }
  ],

  verbetes: {
    'iqa': { titulo: 'IQA', guia: 'caminho-do-dado',
      texto: 'Índice de Qualidade da Água: nove parâmetros com pesos, resumidos num número de 0 a 100 e numa faixa (Ótima, Boa, Regular, Ruim, Péssima). **Calculado pelo banco**, nunca digitado.' },
    'conama': { titulo: 'Conformidade CONAMA', guia: 'caminho-do-dado',
      texto: 'Compara cada parâmetro com o limite legal da classe de enquadramento do ponto (Resolução 357/2005). Três estados: conforme, com violação, e sem limites cadastrados — o último não é conformidade.' },
    'quarentena': { titulo: 'Quarentena', guia: 'conferir-quarentena',
      texto: 'Coleta com algum dado ainda não confirmado. Aparece em todo lugar, marcada como preliminar, até alguém conferir com o laudo físico.' },
    'gabarito': { titulo: 'Gabarito de laudo', guia: 'cadastros-agua',
      texto: 'Diz em que posição da página do PDF daquele laboratório fica cada valor. É o que permite a leitura assistida propor o preenchimento.' },
    'prazo-preservacao': { titulo: 'Prazo de preservação', guia: 'lancar-laudo',
      texto: 'Tempo máximo entre a coleta e a análise para cada parâmetro (Standard Methods). Estourar é **aviso**: o resultado tem validade comprometida, e isso fica registrado — nunca bloqueia o lançamento.' },
    'classe-enquadramento': { titulo: 'Classe de enquadramento', guia: 'cadastros-agua',
      texto: 'A classificação legal do trecho do rio. Ela define quais limites do CONAMA valem naquele ponto — por isso é cadastro do ponto, não do laudo.' }
  }
}

if (typeof window !== 'undefined') window.AGUA_GUIAS_MESA = AGUA_GUIAS_MESA
