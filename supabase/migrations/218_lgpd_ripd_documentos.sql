-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · LGPD Fase 4 (2b/2) — conteúdo dos RIPDs
--
-- Separado da 217 porque um novo valor de ENUM só pode ser usado
-- DEPOIS de commitado — na mesma transação, o Postgres recusa com
-- "unsafe use of new value ... New enum values must be committed
-- before they can be used" (confirmado ao aplicar). Rodar a 217
-- primeiro, sempre.
-- ═══════════════════════════════════════════════════════════

INSERT INTO lgpd_documentos (tipo, titulo, exige_aceite, publico) VALUES
  ('ripd_geolocalizacao', 'RIPD — Geolocalização de trabalhador (Brigadas, Biomonitor, Frota)', false, false),
  ('ripd_car',            'RIPD — Base do Cadastro Ambiental Rural (CAR/SICAR)',                 false, false);

INSERT INTO lgpd_documento_versoes (documento_id, versao, vigente_desde, resumo_mudancas, conteudo_md)
SELECT d.id, '1.0', CURRENT_DATE, 'Versão inicial.',
$MD$
# RIPD — Geolocalização de trabalhador de campo

**Tratamentos cobertos (ROPA):** TRAT-005 (registros de campo das
brigadas), TRAT-006 (telemetria de sessão do app Brigadas), TRAT-009
(registros de biomonitoramento), TRAT-011 (viagens, abastecimentos e
inspeções da Frota).

## 1. Descrição do tratamento

Os aplicativos de campo (Brigadas, Biomonitor, Frota) capturam a
localização do aparelho do trabalhador em dois padrões distintos:

- **Pontual, por ação:** ao abrir/encerrar viagem, registrar
  abastecimento, ou lançar um registro de campo/ocorrência. A
  coordenada documenta ONDE o fato ocorreu.
- **Telemetria de sessão** (só Brigadas, TRAT-006): ping periódico de
  sessão do app, para suporte técnico e apuração de integridade.

Em ambos, o titular é um trabalhador identificado (brigadista, monitor
ou motorista) — não um cidadão anônimo.

## 2. Necessidade e proporcionalidade

A coordenada é o único meio de comprovar, de forma objetiva, onde uma
ocorrência de incêndio foi atendida, onde um ninho de quelônio foi
encontrado, ou onde uma viagem oficial começou/terminou — informação
exigida para prestação de contas de política pública (Lei 8.159/1991)
e de uso de bem público (frota). Alternativas menos invasivas
(preenchimento manual de endereço) foram descartadas por serem menos
confiáveis e mais sujeitas a erro/fraude.

## 3. Riscos identificados ao titular

| Risco | Gravidade sem mitigação |
|---|---|
| Reconstituir o itinerário/rotina do trabalhador a partir de pontos acumulados | Alta |
| Uso da localização para controle de jornada/produtividade além da finalidade declarada | Média |
| Exposição da coordenada para além de quem precisa decidir sobre a viagem/ocorrência | Média |

## 4. Medidas de mitigação já implementadas

- **Captura pontual, não contínua**: nenhum dos apps usa
  `watchPosition` em segundo plano; a leitura acontece só no instante
  da ação (ver Aviso de Privacidade dos apps de campo, migration 213).
- **Nunca bloqueia o trabalho**: timeout de 6s: se o GPS falhar, a ação
  segue sem a coordenada. Uma trava técnica não pode se tornar
  impedimento ao serviço público essencial (combate a incêndio).
- **Configurável por categoria** (Frota): `frota_config_gps` liga/
  desliga a captura por tipo de ação, com fail-safe ligado.
- **Visibilidade assimétrica**: a coordenada nunca aparece no app do
  próprio trabalhador — só nas telas de mesa, para quem decide sobre a
  viagem/ocorrência (frota-viagens.html, frota-abastecimentos.html).
- **Retenção curta na telemetria** (TRAT-006): 12 meses, porque aqui a
  finalidade é só suporte técnico — reter mais viraria vigilância sem
  propósito declarado.
- **Transparência ao titular**: Aviso de Privacidade próprio, exibido
  dentro de cada app, em linguagem direta (migration 213) — diz
  explicitamente que não há rastreamento contínuo.
- **Fotos com marca d'água** seguem a mesma regra de bucket privado e
  signed URL (migrations 200/210) — a coordenada embutida na imagem
  tem a mesma proteção de acesso do registro.

## 5. Risco residual e conclusão

Com as medidas acima, o risco residual é **baixo**: a captura é
pontual, tem finalidade declarada e limitada, é configurável, nunca
trava o trabalho e é comunicada ao titular. O maior risco residual é
compartilhamento indevido por quem tem acesso legítimo à tela de mesa
— mitigado pelo controle de perfil/RLS já vigente em cada módulo.

**Conclusão:** tratamento pode prosseguir. Revisar caso a finalidade
mude (ex.: passar a usar a coordenada para avaliação de desempenho) ou
em revisão anual (ver Plano de Governança, migration 218).
$MD$
FROM lgpd_documentos d WHERE d.tipo = 'ripd_geolocalizacao';

INSERT INTO lgpd_documento_versoes (documento_id, versao, vigente_desde, resumo_mudancas, conteudo_md)
SELECT d.id, '1.0', CURRENT_DATE, 'Versão inicial.',
$MD$
# RIPD — Base do Cadastro Ambiental Rural (CAR/SICAR)

**Tratamento coberto (ROPA):** TRAT-013.

## 1. Descrição do tratamento

O SIGUC-AC recebe, por integração institucional, um espelho do Sistema
Nacional de Cadastro Ambiental Rural (SICAR): CPF/CNPJ, identificação
do imóvel e perímetro georreferenciado de dezenas de milhares de
proprietários e possuidores rurais do Acre (~53 mil registros). É
cruzado com limites de unidades de conservação e alertas ambientais
para instruir fiscalização e análise territorial.

## 2. Por que este tratamento é diferente dos demais

Em todo outro tratamento do sistema, o titular tem alguma relação
direta com a SEMA-AC (é servidor, brigadista, pesquisador). Aqui não:
o titular é um proprietário rural que **nunca interagiu com o
sistema** — o dado chegou pronto, de uma integração federal. Isso
afeta diretamente o Art. 9º (informação ao titular): não é viável
notificar individualmente 53 mil pessoas, então a transparência tem
que se dar por outro canal — a Política de Privacidade pública.

## 3. Necessidade e proporcionalidade

O cruzamento geoespacial entre imóvel rural e unidade de conservação é
o núcleo do exercício do poder de polícia ambiental (identificar
sobreposição, invasão, desmatamento em área protegida). Não há como
exercer essa competência sem o dado do imóvel — inclusive sua
identificação, já que a ação de fiscalização recai sobre uma pessoa
concreta, não sobre um polígono anônimo.

## 4. Riscos identificados ao titular

| Risco | Gravidade sem mitigação |
|---|---|
| Exposição pública do CPF/nome do proprietário (ex.: API pública, view sem controle de acesso) | Alta |
| Consulta sem finalidade legítima (curiosidade, interesse particular de servidor) | Média |
| Divergência entre o dado espelhado e a base federal atualizada (dado desatualizado tratado como atual) | Baixa |

## 5. Medidas de mitigação já implementadas

- **Nunca exposto ao papel anon**: `car_dados_locais` não tem grant
  de SELECT para `anon` — só usuário autenticado com `pode_ver('mapa')`
  alcança a tabela.
- **Log de acesso individual** (migration 216): toda vez que um
  servidor abre os dados cadastrais de um imóvel específico no mapa
  (nome + CPF/CNPJ mascarado), a consulta passa pela RPC
  `car_consultar_local`, que grava em `lgpd_acesso_dado_terceiro` quem
  viu os dados de qual imóvel e quando — auditável por
  `super_admin`/`gestor` em Configurações → Privacidade.
- **CPF/CNPJ mascarado na tela** (`_mascaraCpfCnpj`, pages/mapa.html) —
  a exibição já não mostra o número completo.
- **Correção na origem**: como é dado espelho, uma inconsistência é
  resolvida atualizando no SICAR/IBAMA, não editando a cópia local —
  evita que o SIGUC vire fonte de verdade divergente.
- **Transparência coletiva**: a Política de Privacidade pública (Art.
  9º) declara a origem (SICAR), a finalidade e a base legal deste
  tratamento — o canal possível quando a notificação individual é
  inviável pelo volume.

## 6. O que ainda não está coberto (risco residual conhecido)

A busca por nome/CPF/CNPJ (`_consultaCARLocal`, pages/mapa.html) ainda
faz leitura direta da tabela (não passa pela RPC de log): os
resultados da lista NÃO exibem CPF/CNPJ na tela, mas a linha completa
trafega até o navegador do servidor que fez a busca. É risco residual
**baixo** (não há exposição visual, e já exige autenticação +
`pode_ver('mapa')`), mas fica registrado como candidato a
endurecimento futuro caso a auditoria de acesso precise cobrir também
o evento de busca, não só o de abertura do detalhe.

## 7. Risco residual e conclusão

Com as medidas acima, o risco residual é **baixo a médio**: o maior
fator é o volume (53 mil titulares), que por natureza não permite o
mesmo nível de controle individual dos demais tratamentos do sistema.

**Conclusão:** tratamento pode prosseguir, apoiado na competência de
fiscalização ambiental. Revisar a cada sincronização relevante com o
SICAR e na revisão anual (migration 218).
$MD$
FROM lgpd_documentos d WHERE d.tipo = 'ripd_car';
