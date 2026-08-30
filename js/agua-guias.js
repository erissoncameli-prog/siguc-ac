// ── Qualidade da Água — conteúdo dos guias do app de campo ─────
// DADOS PUROS. O motor (js/guia-app.js) desenha; este arquivo só diz
// o que ensinar. Conteúdo no código de propósito: precisa abrir
// offline no primeiro dia, em aparelho que nunca sincronizou.
//
// Campo `alvo`: seletor do elemento real. Quando o guia é lido em
// Configurações, o alvo está escondido e o passo vira cartão de texto;
// lido dentro da tela certa, vira destaque sobre o elemento. É o mesmo
// conteúdo nos dois casos — nunca duas versões.
//
// Ao mudar um texto de forma relevante, subir a `versao` do guia: quem
// já concluiu volta a vê-lo como pendente (o histórico no banco fica).

const AGUA_GUIAS = {
  escopo: 'agua-app',
  titulo: 'Ajuda e treinamento',

  guias: [
    {
      slug: 'primeiros-passos', titulo: 'Primeiros passos', icone: 'help', versao: 1,
      resumo: 'Como entrar, o PIN de campo e o que funciona sem internet.',
      passos: [
        { titulo: 'Bem-vindo ao app de campo', icone: 'leaf',
          texto: 'Este app registra a coleta de amostras de água para o cálculo do IQA. Ele foi feito para funcionar **sem internet**: você coleta o dia inteiro offline e sincroniza quando voltar ao sinal.' },
        { titulo: 'Duas credenciais, papéis diferentes', icone: 'key',
          texto: 'Você entra **uma vez** com e-mail e senha, os mesmos do sistema no computador. Depois disso, o app pede só um **PIN de 4 dígitos**.',
          lista: ['O PIN é deste aparelho — não é senha do sistema e ninguém o recupera por e-mail.',
                  'Trocar o PIN: Configurações › Alterar PIN de campo.',
                  'Sair e trocar de conta apaga a sessão local; a fila de coletas não enviadas é preservada.'],
          nota: 'Se esquecer o PIN, use "Sair / Trocar conta" e entre de novo com e-mail e senha.' },
        { titulo: 'O que cada aba faz', icone: 'home',
          texto: 'A barra de baixo tem cinco abas.',
          lista: ['**Início** — atalho para a coleta e situação da conexão.',
                  '**Coletar** — o formulário da amostra.',
                  '**Histórico** — o IQA de campanhas passadas por ponto e as suas coletas.',
                  '**Fila** — o que ainda não foi enviado ao servidor.',
                  '**Config** — preparação, etiquetas, PIN e privacidade.'],
          alvo: '#pill-nav' },
        { titulo: 'Conexão', icone: 'clock',
          texto: 'A etiqueta de conexão no Início diz se o aparelho está online. **Offline não impede nada**: a coleta é gravada no aparelho e enviada depois, sozinha, assim que houver rede.',
          alvo: '#conn-chip' }
      ]
    },

    {
      slug: 'antes-de-ir-a-campo', titulo: 'Antes de ir a campo', icone: 'clipboard', versao: 1,
      resumo: 'A preparação que evita descobrir problema no meio do rio.',
      passos: [
        { titulo: 'Três coisas, ainda com internet', icone: 'check',
          texto: 'Faça isso **antes de sair**, enquanto ainda há sinal. Nenhuma delas é possível no meio do campo.',
          lista: ['Atualizar a lista de pontos de coleta.',
                  'Reservar códigos de etiqueta.',
                  'Conferir o espaço de armazenamento do aparelho.'] },
        { titulo: 'Atualizar os pontos', icone: 'pin',
          texto: 'A lista de pontos que aparece no formulário é uma **cópia guardada no aparelho**. Ponto cadastrado hoje na mesa só aparece aqui depois desta atualização.',
          alvo: '#btn-atualizar-pontos', tela: 'tela-config' },
        { titulo: 'Reservar códigos de etiqueta', icone: 'hash',
          texto: 'O código da amostra (COL-2026-0001) é gerado pelo servidor. Para conseguir **imprimir a etiqueta offline**, o app precisa ter códigos reservados de antemão.',
          lista: ['Sem código reservado, a etiqueta só sai depois de sincronizar.',
                  'Reserve com folga: 20 códigos cobrem uma campanha típica.',
                  'Código reservado e não usado não é reciclado — some da numeração, e isso é normal e auditável.'],
          alvo: '#btn-reservar-codigos', tela: 'tela-config' },
        { titulo: 'Espaço no aparelho', icone: 'download',
          texto: 'Cada coleta com foto ocupa espaço até ser enviada. A barra de armazenamento em Configurações mostra quanto resta. Se estiver perto do limite, sincronize antes de sair.',
          alvo: '#quota-fill', tela: 'tela-config' }
      ]
    },

    {
      slug: 'fazer-uma-coleta', titulo: 'Fazer uma coleta', icone: 'leaf', versao: 1,
      resumo: 'O formulário de ponta a ponta: ponto, parâmetros, foto e salvamento.',
      passos: [
        { titulo: 'Comece pelo ponto', icone: 'pin',
          texto: 'Escolha o ponto de coleta na lista. Ele define a classe de enquadramento do rio, os limites do CONAMA que valem ali e o histórico com que suas leituras serão comparadas.',
          alvo: '#f-ponto', tela: 'tela-form' },
        { titulo: 'Data e hora', icone: 'clock',
          texto: 'Já vêm preenchidas com o momento atual. Corrija se estiver lançando uma coleta feita antes — a data entra no cálculo do prazo de preservação da amostra no laboratório.',
          alvo: '#f-data', tela: 'tela-form' },
        { titulo: 'Parâmetros de campo', icone: 'sliders',
          texto: 'Aqui entram só os parâmetros medidos **na hora, com a sonda**: temperatura do ar e da amostra, pH, OD, turbidez e condutividade.',
          lista: ['Os demais (DBO, coliformes, fósforo, nitrogênio…) vêm do laudo do laboratório e são lançados na mesa depois.',
                  'A sonda escolhida fica como padrão neste aparelho, para não reescolher a cada coleta.',
                  'Confira a unidade do rótulo: mg/L, UNT, µS/cm.'],
          alvo: '#f-equipamento', tela: 'tela-form' },
        { titulo: 'Foto do ponto', icone: 'camera',
          texto: 'A foto registra a condição do rio no dia — cor, nível, presença de espuma ou lixo. A **marca d\'água com data, hora e coordenada é aplicada automaticamente**; não é preciso anotar nada na imagem.',
          alvo: '#btn-abrir-camera', tela: 'tela-form' },
        { titulo: 'Salvar', icone: 'check',
          texto: 'Ao salvar, o app lê o GPS, grava a coleta no aparelho e a coloca na fila de envio. **Isso funciona offline** — salvar nunca depende de rede.',
          alvo: '#btn-salvar', tela: 'tela-form',
          nota: 'Se houver código reservado, o app oferece imprimir a etiqueta do frasco logo depois de salvar.' }
      ]
    },

    {
      slug: 'gps-e-foto', titulo: 'GPS e localização', icone: 'map', versao: 1,
      resumo: 'Como o app usa o GPS e o que fazer quando avisa divergência.',
      passos: [
        { titulo: 'A leitura é pontual', icone: 'pin',
          texto: 'O app **não fica rastreando** você. Ele lê a posição uma única vez, no momento de salvar a coleta (ou quando você toca no botão de ler GPS). Fora disso, nenhuma coordenada é registrada.',
          alvo: '#form-gps-card', tela: 'tela-form' },
        { titulo: 'Para que serve', icone: 'shield',
          texto: 'A coordenada comprova que a amostra foi tirada no ponto certo. Ela é comparada com a coordenada cadastrada do ponto — é auditoria da coleta, não monitoramento de pessoa.' },
        { titulo: 'Quando aparece "divergência"', icone: 'help',
          texto: 'Se você estiver a mais de 1 km do ponto cadastrado, o app avisa. **É aviso, não erro — e não impede salvar.**',
          lista: ['Confira se escolheu o ponto certo na lista.',
                  'Se o ponto está certo e o acesso mudou (margem, ponte, cheia), salve assim mesmo e escreva o motivo nas Observações.',
                  'GPS sem céu aberto erra bastante: mata fechada, dentro do carro ou sob ponte.'] },
        { titulo: 'Se o GPS falhar', icone: 'x',
          texto: 'Sem sinal de satélite, a coleta é salva do mesmo jeito, sem coordenada. **Nada no app pode impedir o trabalho de campo** — essa é uma regra do sistema, não uma exceção.' }
      ]
    },

    {
      slug: 'alertas-valor-atipico', titulo: 'Alertas de valor atípico', icone: 'bell', versao: 1,
      resumo: 'O que significa o aviso amarelo abaixo dos parâmetros.',
      passos: [
        { titulo: 'O que o app está comparando', icone: 'sliders',
          texto: 'Enquanto você digita, o app compara cada valor com o **histórico daquele mesmo ponto**, na mesma época do ano (cheia ou seca), e com os outros parâmetros da própria amostra.' },
        { titulo: 'A mensagem diz a base usada', icone: 'help',
          texto: 'Um alerta útil diz de onde veio a régua: "atípico para este ponto (mediana 45, n=31)". Se houver pouca série no ponto, o app declara que usou o rio inteiro ou a série toda — nunca esconde isso.',
          alvo: '#f-alertas', tela: 'tela-form' },
        { titulo: 'Alerta não é proibição', icone: 'check',
          texto: 'No app **nenhum alerta bloqueia o salvamento**, nem valor fisicamente impossível. O aviso pede que você **reconfira a leitura na sonda** — não que apague o número.',
          lista: ['Releu e o valor é esse mesmo? Salve e registre nas Observações.',
                  'Errou de campo ou de vírgula? Corrija antes de salvar.',
                  'Sonda descalibrada ou com bolha? Anote na observação — o laboratório e a conferência precisam saber.'] },
        { titulo: 'Fora do limite do CONAMA é outra coisa', icone: 'shield',
          texto: 'Violação de limite legal **não é alerta de digitação**: pode ser um resultado verdadeiro e grave (turbidez alta em cheia, por exemplo). Ela aparece em bloco separado e nunca deve ser "corrigida" para caber no limite.' }
      ]
    },

    {
      slug: 'etiqueta-e-codigo', titulo: 'Etiqueta e código da amostra', icone: 'hash', versao: 1,
      resumo: 'A regra mais confundida do módulo — quando deixar em branco.',
      passos: [
        { titulo: 'Deixe em branco (o caso normal)', icone: 'hash',
          texto: 'O campo "Código da coleta" deve ficar **vazio** na maioria das vezes. O sistema gera um código único (COL-2026-0001), e é ele que vai na etiqueta do frasco e no laudo do laboratório.',
          alvo: '#f-codigo-amostra', tela: 'tela-form' },
        { titulo: 'Quando preencher', icone: 'edit',
          texto: 'Preencha **só** se o frasco já vier com etiqueta própria (numeração do laboratório ou de outro programa). Nesse caso o app não oferece imprimir etiqueta — não faz sentido colar a nossa por cima de outra.' },
        { titulo: 'Imprimir a etiqueta', icone: 'printer',
          texto: 'Depois de salvar, o app oferece a etiqueta do frasco: código, ponto, rio, coordenada cadastrada, data da coleta e um QR com o código.',
          lista: ['Precisa haver **código reservado** — reserve em Configurações antes de ir a campo.',
                  'Dá para reimprimir a qualquer momento pelo card da coleta na aba Fila.',
                  'Sem código reservado, a etiqueta só fica disponível depois de sincronizar.'] },
        { titulo: 'Por que o código não pode ser provisório', icone: 'shield',
          texto: 'O código escrito no frasco é o mesmo que volta no laudo do laboratório, meses depois. Se fosse provisório, alguém teria de reconciliar frasco físico com registro — é exatamente o erro que a reserva de códigos evita.' }
      ]
    },

    {
      slug: 'fila-e-sincronizacao', titulo: 'Fila e sincronização', icone: 'upload', versao: 1,
      resumo: 'Onde ficam as coletas até chegarem ao servidor.',
      passos: [
        { titulo: 'Pendente não é erro', icone: 'clock',
          texto: 'Toda coleta salva entra na fila como **pendente**. Isso é o funcionamento normal: significa que está guardada no aparelho e ainda não foi enviada.',
          alvo: '#fila-stats', tela: 'tela-fila' },
        { titulo: 'Os três estados', icone: 'list',
          texto: 'A fila mostra em que pé está cada coleta.',
          lista: ['**Pendente** — salva no aparelho, esperando rede.',
                  '**Enviando** — em transmissão agora.',
                  '**Confirmado** — o servidor recebeu. Fica alguns dias no aparelho como backup e depois some sozinho.'] },
        { titulo: 'O envio é automático', icone: 'upload',
          texto: 'Assim que houver conexão, o app envia sozinho. O botão de sincronizar serve para forçar na hora — útil quando você chega ao sinal e quer confirmar antes de guardar o aparelho.',
          alvo: '#btn-sync-fila', tela: 'tela-fila' },
        { titulo: 'Nada se perde', icone: 'shield',
          texto: 'Coleta pendente **nunca é apagada** pelo app, nem por falta de espaço, nem ao fechar. Só desaparece depois de confirmada pelo servidor.',
          nota: '"Zerar fila de coletas", em Configurações, apaga tudo de propósito — use apenas se orientado, e nunca com coletas pendentes.' }
      ]
    },

    {
      slug: 'historico-e-iqa', titulo: 'Entender o histórico e o IQA', icone: 'binoculo', versao: 1,
      resumo: 'Como ler o gráfico do ponto e o que significa "em conferência".',
      passos: [
        { titulo: 'O IQA é calculado, nunca digitado', icone: 'sliders',
          texto: 'O Índice de Qualidade da Água sai de nove parâmetros com pesos diferentes, calculado pelo servidor quando o laudo do laboratório chega. Ninguém escolhe a faixa (Ótima, Boa, Regular, Ruim, Péssima) na mão.' },
        { titulo: 'A linha do ponto', icone: 'binoculo',
          texto: 'Escolha um ponto no Histórico para ver a evolução do IQA campanha a campanha. É assim que se percebe piora ou melhora do rio ao longo dos anos.',
          alvo: '#h-ponto', tela: 'tela-historico' },
        { titulo: '"Em conferência" não é erro', icone: 'help',
          texto: 'Coleta marcada como em conferência (quarentena) tem algum dado ainda sendo confirmado com o laudo físico pela equipe de mesa. Ela **aparece assim mesmo**, com marca — esconder daria a impressão falsa de que não houve coleta.' },
        { titulo: 'Suas coletas', icone: 'user',
          texto: 'Abaixo do gráfico ficam as coletas que você registrou. Tocar em uma abre a ficha completa, com todos os parâmetros, e permite exportar em PDF (isso exige conexão).' }
      ]
    }
  ],

  // ── Verbetes do "?" ao lado dos campos ──────────────────────
  // Texto curto, no instante da dúvida. Mesmo dicionário dos guias —
  // nunca um segundo texto sobre o mesmo assunto.
  verbetes: {
    'ponto': { titulo: 'Ponto de coleta', guia: 'fazer-uma-coleta',
      texto: 'A lista vem de uma cópia guardada no aparelho. Ponto novo cadastrado na mesa só aparece depois de **Configurações › Atualizar lista de pontos**, com internet.' },
    'gps': { titulo: 'GPS da coleta', guia: 'gps-e-foto',
      texto: 'Leitura **pontual**, feita ao salvar — o app não rastreia você. Divergência acima de 1 km é aviso e nunca impede salvar.' },
    'equipamento': { titulo: 'Equipamento de leitura', guia: 'fazer-uma-coleta',
      texto: 'A sonda usada na medição. A última escolhida fica como padrão neste aparelho. Registrar qual sonda foi usada permite rastrear leituras suspeitas até o equipamento.' },
    'parametros': { titulo: 'Parâmetros de campo', guia: 'fazer-uma-coleta',
      texto: 'Só o que se mede na hora, com a sonda. DBO, coliformes, fósforo e nitrogênio vêm do laudo do laboratório e são lançados na mesa depois.',
      lista: ['Temperatura em °C', 'OD em mg/L', 'Turbidez em UNT', 'Condutividade em µS/cm'] },
    'codigo-amostra': { titulo: 'Código da coleta', guia: 'etiqueta-e-codigo',
      texto: 'Deixe **em branco**: o sistema gera o código definitivo (COL-2026-0001), que vai na etiqueta e volta no laudo. Preencha só se o frasco já tiver etiqueta própria de outro programa.' },
    'foto': { titulo: 'Foto do ponto', guia: 'fazer-uma-coleta',
      texto: 'Registra a condição visual do rio no dia. Data, hora e coordenada entram como **marca d\'água automática** — não escreva nada na imagem.' },
    'alertas': { titulo: 'Alertas de valor atípico', guia: 'alertas-valor-atipico',
      texto: 'Comparação com o histórico do próprio ponto. Pede **reconferir a leitura na sonda** — nunca apagar o número, e nunca bloqueia o salvamento.' },
    'observacoes': { titulo: 'Observações', guia: 'fazer-uma-coleta',
      texto: 'Onde registrar o que os números não contam: chuva recente, obra a montante, espuma, mortandade de peixe, sonda com comportamento estranho, motivo de estar longe do ponto cadastrado.' }
  }
}

if (typeof window !== 'undefined') window.AGUA_GUIAS = AGUA_GUIAS
