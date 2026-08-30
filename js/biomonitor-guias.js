// ── Biomonitor — conteúdo dos guias do app de campo ─────────────
// DADOS PUROS. O motor (js/guia-app.js) desenha; este arquivo só diz
// o que ensinar — mesmo molde de js/agua-guias.js. Conteúdo no
// código de propósito: precisa abrir offline no primeiro dia, em
// aparelho que nunca sincronizou.
//
// Campo `alvo`: seletor do elemento real. Lido em Configurações (tela
// fechada), o passo vira cartão de texto; lido dentro da tela certa,
// vira destaque sobre o elemento — mesmo conteúdo nos dois casos.
//
// Ao mudar um texto de forma relevante, subir a `versao` do guia:
// quem já concluiu volta a vê-lo como pendente (o histórico no banco
// fica, migration 327 — capacitacao_conclusoes).

const BIOMONITOR_GUIAS = {
  escopo: 'biomonitor-app',
  titulo: 'Ajuda e treinamento',

  guias: [
    {
      slug: 'primeiros-passos', titulo: 'Primeiros passos', icone: 'help', versao: 1,
      resumo: 'Login, PIN, praia monitorada e o que cada aba faz.',
      passos: [
        { titulo: 'Bem-vindo ao Biomonitor', icone: 'binoculo',
          texto: 'Este app registra o monitoramento de quelônios em campo — ninhos, visitas, eclosões, berçário e ocorrências. Ele funciona **sem internet**: você trabalha o dia inteiro offline e sincroniza quando voltar ao sinal.' },
        { titulo: 'Duas credenciais, papéis diferentes', icone: 'key',
          texto: 'Você entra **uma vez** com e-mail e senha. Depois disso, o app pede só um **PIN de 4 dígitos** deste aparelho.',
          nota: 'Se esquecer o PIN, use "Sair / Trocar conta" em Configurações e entre de novo com e-mail e senha.' },
        { titulo: 'Escolha a praia monitorada', icone: 'pin',
          texto: 'Toque no card de praia na Início para escolher onde você está trabalhando. O app **sugere** a praia mais próxima pelo GPS, mas a escolha final é sempre sua — nunca é automática.',
          alvo: '#bio-praia-seletor' },
        { titulo: 'O que cada botão da Início registra', icone: 'home',
          texto: 'Quatro ações no topo da tela.',
          lista: ['**Novo Ninho** — encontro de um ninho novo.',
                  '**Ninhos Abertos** — os que ainda incubam: dali você faz visita, transferência ou eclosão.',
                  '**Histórico** — todos os ninhos já registrados na praia, abertos ou não.',
                  '**Berçário** — lotes de filhotes sob cuidado, até a soltura.'],
          alvo: '.bio-acao-grid' },
        { titulo: 'GPS e conexão', icone: 'clock',
          texto: 'O radar mostra sua posição **enquanto a tela está aberta** — é indicador local, nunca sai do aparelho em tempo real. Só uma leitura é **gravada** por registro, no momento de salvar. A etiqueta de conexão diz se há internet agora; sem ela, tudo continua funcionando normalmente.',
          alvo: '#bio-conn-chip' }
      ]
    },

    {
      slug: 'registrar-ninho', titulo: 'Registrar um ninho novo', icone: 'award', versao: 1,
      resumo: 'Do encontro do ninho ao número gerado automaticamente.',
      passos: [
        { titulo: 'Confira a praia', icone: 'pin',
          texto: 'O ninho nasce vinculado à praia selecionada na Início. Errar a praia aqui significa corrigir depois — confira antes de continuar.',
          alvo: '#bio-form-praia-btn' },
        { titulo: 'GPS do encontro', icone: 'clock',
          texto: 'A posição é lida no momento do registro. Fora do perímetro da praia cadastrada, o app **avisa — não bloqueia**: pode ser um ninho legítimo numa borda ainda não mapeada.',
          alvo: '#bio-form-perimetro-aviso' },
        { titulo: 'Espécie e número do ninho', icone: 'sliders',
          texto: 'Escolha a espécie primeiro — é ela (junto com a praia e a temporada) que **gera o número do ninho sozinho**. Só edite o número manualmente se souber exatamente por quê.',
          alvo: '#bio-especie-grid' },
        { titulo: 'Hora da desova', icone: 'clock',
          texto: 'É a base da **janela segura de transferência** — mexer no ninho fora dessa janela pode matar o embrião. Se não souber a hora exata, estime pela condição do rastro; nunca deixe em branco por pressa.',
          alvo: '#bio-form-hora-desova',
          nota: 'Ao marcar os ovos para uma eventual transferência: sempre no topo, a lápis, e nunca girando o ovo.' },
        { titulo: 'Postura e fotos', icone: 'camera',
          texto: 'Registre a quantidade de ovos postos e as fotos do ninho. Esse número é a referência que a eclosão vai comparar depois — divergência grande entre postura e o total apurado na eclosão é sinal para conferir.' }
      ]
    },

    {
      slug: 'visita', titulo: 'Visita de acompanhamento', icone: 'binoculo', versao: 1,
      resumo: 'Temperatura, status do ninho e o que fazer com perdas.',
      passos: [
        { titulo: 'Para que serve a visita', icone: 'binoculo',
          texto: 'Cada visita atualiza a situação do ninho enquanto ele ainda incuba: temperatura, umidade, sinais de alagamento, predação ou erosão. É o que alimenta os alertas de temperatura da espécie.' },
        { titulo: 'Temperatura do substrato', icone: 'sliders',
          texto: 'A leitura junto ao ninho (não a do ar) é o que entra no cálculo científico de sexagem por temperatura e na previsão de antecipação de eclosão em temporada quente. Meça sempre no mesmo ponto, próximo aos ovos.',
          alvo: '#bio-vis-temp-sub' },
        { titulo: 'Status do ninho', icone: 'check',
          texto: 'Diga o que você encontrou. Alguns status abrem campos extras: escolher "danificado" pede quanto foi perdido e por quê; "destruído" pede a causa.',
          alvo: '#bio-vis-status-grid' },
        { titulo: 'Ovos danificados', icone: 'help',
          texto: 'Registre por CAUSA (predação, alagamento, erosão, ação humana) — nunca um total genérico. É essa quebra por causa que sustenta os relatórios de pressão predatória da praia.',
          alvo: '#bio-vis-danos-wrap' },
        { titulo: 'Alertas de temperatura', icone: 'bell',
          texto: 'Se a leitura passar do limiar da espécie, um aviso aparece na própria tela — feminização de ninhada ou antecipação da eclosão. É informativo: reforça visita e preparo do berçário com antecedência, nunca bloqueia o salvamento.',
          alvo: '#bio-vis-alertas' }
      ]
    },

    {
      slug: 'transferencia', titulo: 'Transferência de ninho', icone: 'map', versao: 1,
      resumo: 'Quando e como mover um ninho de lugar.',
      passos: [
        { titulo: 'Por que transferir', icone: 'map',
          texto: 'Um ninho em risco (erosão, alagamento previsto, área muito exposta) pode ser transferido para um trecho mais seguro da praia ou para outra praia do programa — sempre dentro da janela segura contada a partir da hora da desova.' },
        { titulo: 'A ocupação do destino', icone: 'sliders',
          texto: 'O app mostra quantas posições já estão ocupadas no ponto de destino. **Online**, essa contagem é a fonte de verdade — enxerga ninhos de outros grupos. **Offline**, o app só vê os ninhos do seu próprio grupo, e avisa que a lista é parcial.',
          nota: 'Se estiver offline num destino movimentado, considere revalidar a ocupação assim que sincronizar.' },
        { titulo: 'O ninho original não desaparece', icone: 'check',
          texto: 'A transferência registra o histórico — de onde saiu, para onde foi. O número original do ninho é preservado; é a praia/posição ATUAL que muda.' }
      ]
    },

    {
      slug: 'eclosao', titulo: 'Registro de eclosão', icone: 'award', versao: 1,
      resumo: 'Contagem de filhotes, anomalias e o confronto com a postura.',
      passos: [
        { titulo: 'Confirme a postura apurada', icone: 'sliders',
          texto: 'O app mostra a postura ESTIMADA no encontro do ninho ao lado do total que você está apurando agora na eclosão. Divergência grande entre os dois números merece uma segunda contagem antes de confirmar.',
          alvo: '#bio-ecl-postura-box' },
        { titulo: 'Filhotes vivos', icone: 'check',
          texto: 'Conte os filhotes que saíram vivos do ninho — é a base de todos os cálculos de taxa de eclosão e de viabilidade que os relatórios usam depois.',
          alvo: '#bio-ecl-vivos' },
        { titulo: 'Anomalia é um SUBCONJUNTO dos vivos', icone: 'help',
          texto: 'Filhote com anomalia congênita (casco, membro, corpo, albinismo) **continua sendo filhote vivo** — não é um balde à parte. Marque quantos, dentre os vivos, têm anomalia, e o(s) tipo(s).',
          alvo: '#bio-ecl-anomalia' },
        { titulo: 'Mortos e não nascidos', icone: 'x',
          texto: 'Dois contadores separados: filhotes que morreram já formados, e ovos que nunca chegaram a eclodir. Junto com os vivos, os três fecham a conta da ninhada inteira — é essa soma que valida contra a postura apurada.' },
        { titulo: 'Fotos e salvar', icone: 'camera',
          texto: 'Depois de salvar, os filhotes vivos seguem para a próxima etapa: **Destino dos Filhotes** (soltar direto, ou entrar no berçário) — a eclosão sozinha não conclui o ciclo do ninho.' }
      ]
    },

    {
      slug: 'bercario', titulo: 'Berçário: entrada e soltura', icone: 'clipboard', versao: 1,
      resumo: 'Do lote de filhotes recém-nascidos até a soltura final.',
      passos: [
        { titulo: 'Quando um lote entra no berçário', icone: 'clipboard',
          texto: 'Depois de registrar a eclosão, se os filhotes não forem soltos direto no rio, você escolhe **Berçário** em Destino dos Filhotes. Isso cria um LOTE — o grupo de filhotes daquele ninho, sob cuidado até a soltura.' },
        { titulo: 'Escolher o berçário certo', icone: 'pin',
          texto: 'O berçário é compartilhado pela equipe inteira do grupo — todos veem os mesmos lotes, não só quem registrou. Escolha pela capacidade disponível mostrada na tela, nunca por costume.' },
        { titulo: 'Mortalidade e doença no berçário', icone: 'bell',
          texto: 'Óbito ou doença durante o cuidado é registrado como **ocorrência do lote** (não um recontagem manual do lote inteiro) — é o que mantém o histórico de causa por causa, igual às visitas de ninho.' },
        { titulo: 'Soltura', icone: 'check',
          texto: 'Ao soltar, registre quantos filhotes saem e de qual lote — pode ser soltura parcial (alguns ficam) ou total (fecha o lote). A soltura é o fim do ciclo daquele grupo de filhotes; o histórico completo (postura → eclosão → berçário → soltura) fica ligado ao ninho original.',
          alvo: '#bio-btn-salvar-visita' }
      ]
    },

    {
      slug: 'ocorrencia', titulo: 'Registrar uma ocorrência', icone: 'bell', versao: 1,
      resumo: 'Óbito, doença, biometria ou outro evento fora do fluxo normal.',
      passos: [
        { titulo: 'Para que serve', icone: 'bell',
          texto: 'Ocorrência é qualquer evento que não é uma visita de rotina nem uma soltura — óbito, doença, biometria avulsa, dano a equipamento, achado incomum. Escolha o TIPO primeiro; ele decide quais campos aparecem depois.',
          alvo: '#bio-oc-tipo-grid' },
        { titulo: 'Biometria', icone: 'sliders',
          texto: 'Comprimento e peso MÉDIOS da amostra, e quantos filhotes foram medidos — não é uma medição individual de cada um (essa existe à parte, na tela do indivíduo, para filhotes marcados).',
          alvo: '#bio-oc-sec-biometria' },
        { titulo: 'Mortalidade', icone: 'x',
          texto: 'Quantidade afetada + causa. É esse par (número e motivo) que sustenta o relatório de mortalidade por causa do berçário — nunca só o total.',
          alvo: '#bio-oc-sec-mortalidade' },
        { titulo: 'Fotos e descrição', icone: 'camera',
          texto: 'Sempre que o tipo permitir, uma foto vale mais que a descrição para quem revisa depois — principalmente em dano a equipamento ou achado fora do padrão.' }
      ]
    },

    {
      slug: 'equipamentos', titulo: 'Meus equipamentos', icone: 'clipboard', versao: 1,
      resumo: 'Cautela, prazo de devolução e como reportar defeito.',
      passos: [
        { titulo: 'O que é uma cautela', icone: 'clipboard',
          texto: 'Cautela é o registro de que você está com um ou mais equipamentos da SEMA — GPS, câmera, balança de campo. Ao receber o material, você assina digitalmente e escolhe o prazo de devolução.' },
        { titulo: 'Prazo e aviso de vencimento', icone: 'clock',
          texto: 'O app avisa antes do prazo vencer e no dia do vencimento. Passar do prazo não bloqueia o trabalho — é um lembrete, não uma penalidade automática.' },
        { titulo: 'Reportar dano, defeito ou extravio', icone: 'bell',
          texto: 'A qualquer momento, mesmo com a cautela ainda aberta — não é preciso esperar a devolução para avisar que um equipamento quebrou ou sumiu. Quem valida a cautela e a coordenação são notificados na hora.' },
        { titulo: 'A devolução é sempre pela mesa', icone: 'help',
          texto: 'O app registra a cautela e as ocorrências, mas **quem confirma a devolução física é a gestão**, na tela de administração — decisão de produto, para o recebimento do bem sempre passar por conferência humana.' }
      ]
    },

    {
      slug: 'ninhos-abertos', titulo: 'Abertos, Histórico e Fila — a diferença', icone: 'list', versao: 1,
      resumo: 'Três listas parecidas, três propósitos diferentes.',
      passos: [
        { titulo: 'Ninhos Abertos', icone: 'binoculo',
          texto: 'Só os que ainda incubam — é daqui que você faz visita, transferência ou eclosão. Um ninho some desta lista quando eclode, é perdido ou é solto.',
          alvo: '#bio-btn-reload-abertos' },
        { titulo: 'Histórico', icone: 'clock',
          texto: 'TODOS os ninhos da praia, abertos ou não — é a lista de consulta, não de ação. Serve para conferir um ninho antigo ou revisar dados já fechados.' },
        { titulo: 'Fila (Meus Ninhos)', icone: 'upload',
          texto: 'Não é uma lista de ninhos por status biológico — é o **status de ENVIO**: o que já foi salvo no aparelho e ainda não chegou ao servidor. Pendente aqui não significa erro, significa "aguardando conexão".',
          alvo: '#bio-btn-sync-fila' },
        { titulo: 'Sincronizar', icone: 'upload',
          texto: 'O envio é automático assim que há internet. O botão de sincronizar força na hora — útil ao chegar num ponto com sinal e querer confirmar antes de guardar o aparelho.' }
      ]
    },

    {
      slug: 'modo-treinamento', titulo: 'Praticar sem risco', icone: 'award', versao: 1,
      resumo: 'O modo treinamento: o fluxo inteiro, sem nada chegar ao sistema.',
      passos: [
        { titulo: 'Para que serve', icone: 'award',
          texto: 'Em **Configurações › Modo treinamento** o app inteiro entra em ensaio: registre um ninho, faça uma visita, transfira, registre eclosão, entre com filhotes no berçário e solte — o fluxo COMPLETO, exatamente como de verdade — e nada disso chega ao servidor.',
          alvo: '#bio-btn-modo-treino' },
        { titulo: 'A faixa fica na tela o tempo todo', icone: 'bell',
          texto: 'Uma faixa amarela no topo avisa em todas as telas enquanto o modo está ligado. É de propósito: nunca pode haver dúvida sobre estar treinando ou trabalhando de verdade.' },
        { titulo: 'Isolamento total, não só um filtro', icone: 'shield',
          texto: 'O treino não é um registro "marcado" no meio dos de verdade — é um banco **inteiramente separado** dentro do aparelho. Os dados de treino nunca se misturam com os reais, e a sincronização nem tenta enviá-los.',
          lista: ['Um ninho de treino pode ser visitado, transferido e ter eclosão registrada — o ciclo inteiro funciona.',
                  'Nada disso aparece nunca no Histórico real, na Fila real, nem no banco da SEMA.',
                  'Praias, berçários e equipamentos aparecem com os nomes reais (copiados uma vez ao ligar o modo) só para o exercício parecer de verdade — nada é alterado neles.'] },
        { titulo: 'Ao terminar', icone: 'check',
          texto: 'Desligue pelo botão da faixa ou por Configurações. Os registros de treino são apagados do aparelho e a próxima ação já vale de verdade.',
          nota: 'O modo continua ligado se você fechar o app — é estado, não sessão. Confira a faixa antes de começar o trabalho do dia.' }
      ]
    }
  ],

  verbetes: {
    'gps-continuo': { titulo: 'GPS na tela', guia: 'primeiros-passos',
      texto: 'A posição aparece ao vivo enquanto a tela fica aberta (indicador local), mas só é GRAVADA no momento de salvar o registro. Nunca vira um rastreamento transmitido em tempo real.' },
    'numero-ninho': { titulo: 'Número do ninho', guia: 'registrar-ninho',
      texto: 'Gerado sozinho a partir da praia, espécie e temporada. Editar manualmente é exceção, não regra.' },
    'postura': { titulo: 'Postura estimada', guia: 'eclosao',
      texto: 'O número de ovos contado no encontro do ninho. A eclosão mostra esse número lado a lado com o total apurado agora, para conferir divergência grande antes de confirmar.' },
    'anomalia': { titulo: 'Anomalia em filhote', guia: 'eclosao',
      texto: 'Deformidade congênita (casco, membro, corpo, albinismo). É SUBCONJUNTO dos filhotes vivos, nunca um balde à parte — filhote com anomalia segue o fluxo normal de destino.' },
    'lote': { titulo: 'Lote do berçário', guia: 'bercario',
      texto: 'O grupo de filhotes de um ninho que entrou no berçário. Compartilhado pela equipe inteira do grupo — todos veem os mesmos lotes.' },
    'cautela': { titulo: 'Cautela de equipamento', guia: 'equipamentos',
      texto: 'O registro de que você está responsável por um equipamento da SEMA, com prazo de devolução. A devolução em si é sempre confirmada pela gestão, nunca pelo próprio app.' }
  }
}

if (typeof window !== 'undefined') window.BIOMONITOR_GUIAS = BIOMONITOR_GUIAS
