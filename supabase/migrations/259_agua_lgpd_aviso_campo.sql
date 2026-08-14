-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Qualidade da Água — Aviso de Privacidade do app de campo
-- Fase 3 do plano em docs/qualidade-agua/plano.md (app-agua/).
--
-- Mesmo mecanismo das migrations 222/223 (Aviso de Campo por app):
-- uma linha nova em `lgpd_documentos` com `app = 'agua'` — a coluna já
-- é texto livre desde a 222, então isto é só INSERT, zero migration de
-- schema. `js/lgpd-campo.js` (compartilhado pelos 4 apps agora) lê
-- `window.LGPD_CAMPO_APP`, que `pages/agua-app.html` declara antes de
-- carregar o script.
--
-- ROPA — SEM ENTRADA NOVA
-- A migration 251 (Fase 0) já registrou TRAT-018 ("Coletas de
-- qualidade da água com geolocalização e foto") antecipando esta fase
-- e já descrevendo o padrão adotado: leitura PONTUAL (getCurrentPosition,
-- não watchPosition), no molde do Frota — não da leitura contínua de
-- Brigadas/Biomonitor. Este app segue exatamente essa decisão: só usa
-- `bGpsUmaLeitura()` (js/brigada-captura.js), nunca `bGpsIniciar()`.
-- Por isso não há TRAT novo aqui — só a materialização, em texto, do
-- que o ROPA já previa.
--
-- POR QUE PONTUAL, E NÃO CONTÍNUO
-- Diferente de Brigadas (indicador de GPS ao vivo na tela + checagem
-- de proximidade) e Biomonitor (checagem de proximidade de praia/
-- ninho), o app da Água não precisa mostrar "onde você está" na tela:
-- a única leitura de posição serve para comparar com a coordenada
-- cadastrada do PONTO (auditoria da coleta), uma finalidade pontual
-- por natureza. Não há uso concreto para leitura contínua aqui — regra
-- do projeto de não desenhar para requisito hipotético.
-- ═══════════════════════════════════════════════════════════

INSERT INTO lgpd_documentos (tipo, app, titulo, exige_aceite, publico) VALUES
  ('aviso_campo', 'agua', 'Aviso de Privacidade — App Qualidade da Água', true, false)
ON CONFLICT (tipo, coalesce(app, '')) DO NOTHING;

INSERT INTO lgpd_documento_versoes (documento_id, versao, vigente_desde, resumo_mudancas, conteudo_md)
SELECT d.id, '1.0', CURRENT_DATE,
  'Documento novo — Fase 3 do módulo Qualidade da Água entrega o app de campo, que passa a coletar geolocalização pontual e foto do ponto.',
$MD$
# Sobre seus dados no app Qualidade da Água

Este aplicativo é da **SEMA-AC**, usado por servidores e colaboradores
que fazem a coleta de amostras de água nas estações de monitoramento do
Estado. Para a coleta ser registrada e comprovada, ele guarda algumas
informações suas. Em resumo:

## O que é registrado

- **Sua localização**, lida **só no instante** em que você salva uma
  coleta — o app não fica consultando o GPS o resto do tempo, nem em
  segundo plano. Ela é comparada com a coordenada já cadastrada da
  estação, só para conferência da coleta — não é usada para
  acompanhar seu deslocamento.
- **A foto** do ponto de coleta, com data, hora e marca d'água.
- **Seu cadastro**: nome e vínculo com sua conta de usuário do SIGUC.
- **Datas e horários** de uso do aplicativo.

## O que NÃO é feito

- **Você não é rastreado.** Fora do momento de salvar uma coleta, o
  app não consulta sua localização.
- **Sua foto não é usada para reconhecimento facial.** Ela serve para
  comprovar o estado do ponto de coleta no momento da amostra, e nada
  além disso.
- **Se o GPS não pegar, o trabalho continua.** A coleta é salva do
  mesmo jeito, sem a localização do aparelho — nunca sem os
  parâmetros medidos.

## Para que serve

Para comprovar **onde e quando** cada amostra foi coletada, compondo a
série histórica de qualidade da água do Estado — atribuição da SEMA-AC
como órgão ambiental estadual. **Não serve para vigiar o seu
deslocamento** fora de uma coleta.

## Seus direitos

Você pode pedir para ver, corrigir ou saber com quem seus dados são
compartilhados. Fale com a coordenação do seu setor ou com o
Encarregado de Dados da SEMA-AC. O prazo de resposta é de 15 dias.

Registros de coleta integram uma série histórica ambiental de guarda
permanente e não podem ser apagados a pedido do titular.

## Texto completo

A Política de Privacidade completa está em
**siguc-ac.vercel.app/pages/privacidade.html**
$MD$
FROM lgpd_documentos d WHERE d.tipo = 'aviso_campo' AND d.app = 'agua'
ON CONFLICT DO NOTHING;
