-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · LGPD — documentos dedicados por app (2/3: schema +
-- textos)
--
-- Ver cabeçalho da 222 para o motivo. Resumo do que muda:
--   · lgpd_documentos ganha coluna `app` (NULL = documento geral —
--     Política, Termo, RIPDs, Plano de Incidente; um slug — Aviso de
--     Campo por app). Vocabulário reaproveitado de
--     lgpd_tratamentos.modulo (211): 'brigadas'|'biomonitor'|'frota'|
--     'pesquisa' — uma taxonomia só para ROPA e documentos, não duas.
--   · Constraint UNIQUE(tipo) vira UNIQUE(tipo, coalesce(app,'')) —
--     agora cabem 3 linhas com tipo='aviso_campo'.
--   · O aviso_campo genérico antigo (app IS NULL) é DESATIVADO, não
--     apagado — preserva o histórico real de aceite de quem já usou
--     os 3 apps até aqui. Três documentos novos nascem no lugar dele,
--     cada um com sua própria linha de versionamento a partir da v1.0
--     — são identidades de documento novas, não uma alteração do
--     antigo (diferente do que fizemos com o RIPD do CAR em 218,
--     que era a MESMA identidade ganhando v1.1).
--   · App novo no futuro = inserir uma linha com o `app` dele. Nenhum
--     ALTER TYPE, nenhuma migration de schema.
-- ═══════════════════════════════════════════════════════════

ALTER TABLE lgpd_documentos ADD COLUMN app text;

ALTER TABLE lgpd_documentos DROP CONSTRAINT lgpd_documentos_tipo_key;
CREATE UNIQUE INDEX lgpd_documentos_tipo_app_key
  ON lgpd_documentos (tipo, coalesce(app, ''));

-- vw_lgpd_documentos_vigentes ganha `app` no fim do SELECT — CREATE OR
-- REPLACE VIEW aceita adicionar coluna nova, não aceitaria remover ou
-- reordenar as existentes.
CREATE OR REPLACE VIEW vw_lgpd_documentos_vigentes WITH (security_invoker = true) AS
SELECT DISTINCT ON (d.id)
       d.id   AS documento_id,
       d.tipo, d.titulo, d.exige_aceite, d.publico,
       v.id   AS versao_id,
       v.versao, v.conteudo_md, v.hash_sha256, v.vigente_desde,
       d.app
  FROM lgpd_documentos d
  JOIN lgpd_documento_versoes v
    ON v.documento_id = d.id
   AND v.vigente_desde <= CURRENT_DATE
 WHERE d.ativo
 ORDER BY d.id, v.vigente_desde DESC, v.criado_em DESC;

-- ── Desativa o aviso_campo genérico (preserva histórico) ────────
UPDATE lgpd_documentos SET ativo = false WHERE tipo = 'aviso_campo' AND app IS NULL;

-- ── Três avisos novos, um por app de campo ──────────────────────
INSERT INTO lgpd_documentos (tipo, app, titulo, exige_aceite, publico) VALUES
  ('aviso_campo', 'brigadas',   'Aviso de Privacidade — App Brigadas',   true, false),
  ('aviso_campo', 'biomonitor', 'Aviso de Privacidade — App Biomonitor', true, false),
  ('aviso_campo', 'frota',      'Aviso de Privacidade — App Frota',      true, false);

INSERT INTO lgpd_documento_versoes (documento_id, versao, vigente_desde, resumo_mudancas, conteudo_md)
SELECT d.id, '1.0', CURRENT_DATE, 'Documento novo — antes era um texto único para os 3 apps de campo, listando atividades que não se aplicavam a quem lia (ex.: monitor lendo sobre abastecimento). Passa a existir um aviso por app.',
$MD$
# Sobre seus dados no app Brigadas

Este aplicativo é da **SEMA-AC**, usado pelas brigadas de combate a
incêndio florestal. Para o seu trabalho ser registrado e comprovado,
ele guarda algumas informações suas. Em resumo:

## O que é registrado

- **Sua localização**, consultada continuamente enquanto o app está
  aberto — usada para te mostrar na tela e ficar pronta para gravar
  automaticamente onde você está no momento de registrar uma
  ocorrência, uma área protegida ou uma foto. O que chega até a
  SEMA-AC é a localização de cada registro que você salva, e uma
  localização única no momento em que você entra no app — nunca um
  histórico contínuo dos seus passos.
- **As fotos** da ocorrência, da área e da fauna resgatada, com data,
  hora e marca d'água.
- **Seu cadastro**: nome, CPF, contato de emergência e foto de perfil.
- **Datas e horários** de uso do aplicativo.

## O que NÃO é feito

- A localização só é consultada enquanto o app está **aberto e você
  logado** — nunca em segundo plano, com o app fechado ou minimizado,
  nem depois que você sai.
- **Sua foto não é usada para reconhecimento facial.** Ela serve para
  identificar você no sistema, e nada além disso.
- **Se o GPS não pegar, o trabalho continua.** O registro é salvo do
  mesmo jeito, sem a localização. O aplicativo nunca vai travar seu
  trabalho por causa de sinal.

## Para que serve

Para comprovar **onde e quando a ocorrência aconteceu** — o incêndio,
o desmatamento, a invasão — e a área que sua brigada protegeu. É
exigência de prestação de contas do combate a incêndio florestal.
**Não serve para vigiar o seu deslocamento** fora de um registro.

## Seus direitos

Você pode pedir para ver, corrigir ou saber com quem seus dados são
compartilhados. Fale com a coordenação da sua brigada ou com o
Encarregado de Dados da SEMA-AC. O prazo de resposta é de 15 dias.

Registro de ocorrência de incêndio é documento público e tem guarda
obrigatória por lei — não pode ser apagado a seu pedido.

## Texto completo

A Política de Privacidade completa está em
**siguc-ac.vercel.app/pages/privacidade.html**
$MD$
FROM lgpd_documentos d WHERE d.tipo = 'aviso_campo' AND d.app = 'brigadas';

INSERT INTO lgpd_documento_versoes (documento_id, versao, vigente_desde, resumo_mudancas, conteudo_md)
SELECT d.id, '1.0', CURRENT_DATE, 'Documento novo — mesmo motivo do aviso do Brigadas: um texto por app, em vez de um texto genérico listando atividades de apps que o monitor nunca usa.',
$MD$
# Sobre seus dados no app Biomonitor

Este aplicativo é da **SEMA-AC**, usado pelos monitores de
biodiversidade no acompanhamento de quelônios e outros programas de
conservação. Para o seu trabalho ser registrado e comprovado, ele
guarda algumas informações suas. Em resumo:

## O que é registrado

- **Sua localização**, consultada continuamente enquanto o app está
  aberto — usada para te mostrar na tela, verificar se você está perto
  de uma praia ou ninho cadastrado, e gravar automaticamente onde você
  está ao registrar um ninho, uma transferência, uma eclosão ou uma
  soltura. O que chega até a SEMA-AC é a localização de cada registro
  que você salva, e uma localização única no momento em que você entra
  no app — nunca um histórico contínuo dos seus passos.
- **As fotos** dos ninhos, filhotes e ocorrências, com data, hora e
  marca d'água.
- **Seu cadastro**: nome, CPF, contato e foto de perfil.
- **Datas e horários** de uso do aplicativo.

## O que NÃO é feito

- A localização só é consultada enquanto o app está **aberto e você
  logado** — nunca em segundo plano, com o app fechado ou minimizado,
  nem depois que você sai.
- **Sua foto não é usada para reconhecimento facial.** Ela serve para
  identificar você no sistema, e nada além disso.
- **Se o GPS não pegar, o trabalho continua.** O registro é salvo do
  mesmo jeito, sem a localização. O aplicativo nunca vai travar seu
  trabalho por causa de sinal.

## Para que serve

Para comprovar **onde e quando** cada ninho, transferência, eclosão ou
soltura aconteceu — dado científico da conservação de quelônios.
**Não serve para vigiar o seu deslocamento** fora de um registro.

## Seus direitos

Você pode pedir para ver, corrigir ou saber com quem seus dados são
compartilhados. Fale com a coordenação do seu programa ou com o
Encarregado de Dados da SEMA-AC. O prazo de resposta é de 15 dias.

Registro de ninho, transferência, eclosão e soltura é dado científico
de guarda permanente — não pode ser apagado a seu pedido.

## Texto completo

A Política de Privacidade completa está em
**siguc-ac.vercel.app/pages/privacidade.html**
$MD$
FROM lgpd_documentos d WHERE d.tipo = 'aviso_campo' AND d.app = 'biomonitor';

INSERT INTO lgpd_documento_versoes (documento_id, versao, vigente_desde, resumo_mudancas, conteudo_md)
SELECT d.id, '1.0', CURRENT_DATE, 'Documento novo — mesmo motivo dos demais: um texto por app. Este é o único dos 3 onde a leitura de GPS já era mesmo pontual (getCurrentPosition, sem watchPosition) — o texto genérico anterior estava certo aqui, só não devia ser o mesmo texto do Brigadas/Biomonitor.',
$MD$
# Sobre seus dados no app Frota

Este aplicativo é da **SEMA-AC**, usado por motoristas do Setor de
Transporte. Para o uso do veículo oficial ser registrado e comprovado,
ele guarda algumas informações suas. Em resumo:

## O que é registrado

- **Sua localização**, lida **só no instante** em que você inicia ou
  encerra uma viagem, ou registra um abastecimento — o app não fica
  consultando o GPS o resto do tempo.
- **As fotos** do cupom de abastecimento, do hodômetro e de eventuais
  defeitos do veículo, com data, hora e marca d'água.
- **Seu cadastro**: nome, CPF, matrícula, CNH e foto de perfil.
- **Datas e horários** de uso do aplicativo.

## O que NÃO é feito

- **Você não é rastreado.** Fora do momento de iniciar/encerrar uma
  viagem ou registrar um abastecimento, o app não consulta sua
  localização — nem em segundo plano, nem com o app fechado.
- **Sua foto não é usada para reconhecimento facial.** Ela serve para
  comprovar o cupom, o hodômetro ou o defeito relatado, e nada além
  disso.
- **Se o GPS não pegar, o trabalho continua.** A viagem ou o
  abastecimento são registrados do mesmo jeito, sem a localização.

## Para que serve

Para comprovar o uso do veículo oficial — de onde saiu, onde chegou,
onde abasteceu. É exigência de prestação de contas do uso de bem
público. **Não serve para vigiar o seu deslocamento** fora de uma
viagem oficial.

## Seus direitos

Você pode pedir para ver, corrigir ou saber com quem seus dados são
compartilhados. Fale com a gestão do Setor de Transporte ou com o
Encarregado de Dados da SEMA-AC. O prazo de resposta é de 15 dias.

Registros de viagem e abastecimento ficam guardados por 5 anos, para
prestação de contas do uso do veículo oficial, e não podem ser
apagados antes disso.

## Texto completo

A Política de Privacidade completa está em
**siguc-ac.vercel.app/pages/privacidade.html**
$MD$
FROM lgpd_documentos d WHERE d.tipo = 'aviso_campo' AND d.app = 'frota';

-- ── Aviso — Pesquisa (portal do pesquisador) ────────────────────
INSERT INTO lgpd_documentos (tipo, app, titulo, exige_aceite, publico) VALUES
  ('aviso_pesquisa', 'pesquisa', 'Aviso de Privacidade — Portal do Pesquisador', true, false);

INSERT INTO lgpd_documento_versoes (documento_id, versao, vigente_desde, resumo_mudancas, conteudo_md)
SELECT d.id, '1.0', CURRENT_DATE, 'Documento novo — o portal só mostrava Política e Termo genéricos, sem nada específico sobre o que de fato é coletado ali (CPF/RG/documentos do projeto, sem GPS nem foto).',
$MD$
# Sobre seus dados no Portal do Pesquisador

Este portal é da **SEMA-AC**, usado para submeter e acompanhar pedidos
de autorização de pesquisa científica em unidades de conservação. Para
processar seu pedido, ele guarda:

## O que é registrado

- **Seu cadastro**: nome, CPF, RG, e-mail, telefone, instituição,
  titulação e, se você informar, endereço.
- **Os documentos do seu projeto**: proposta, currículo Lattes,
  relatórios, e o histórico de tramitação do seu pedido.
- **Datas e horários** de acesso ao portal.

## O que NÃO é feito

- O portal **não usa geolocalização nem câmera** — nada aqui
  identifica onde você está.
- Seus dados **não são usados para nenhuma outra finalidade** além de
  processar sua autorização de pesquisa.
- A Autorização de Acesso e Pesquisa (AAP), quando emitida, pode ser
  validada publicamente por QR code — mas esse QR **nunca expõe seu
  CPF ou e-mail**, só o número, a validade e a situação da autorização.

## Para que serve

Para analisar seu pedido, emitir a autorização quando aprovada, e
manter o histórico de pesquisas realizadas nas unidades de conservação
— parte da gestão pública dessas áreas.

## Seus direitos

Você pode pedir para ver, corrigir ou saber com quem seus dados são
compartilhados na aba "Seus dados e seus direitos" do seu perfil, ou
falando com o Encarregado de Dados da SEMA-AC. O prazo de resposta é
de 15 dias.

## Texto completo

A Política de Privacidade completa está em
**siguc-ac.vercel.app/pages/privacidade.html**
$MD$
FROM lgpd_documentos d WHERE d.tipo = 'aviso_pesquisa';

-- ── Termo de Uso — v1.1, generalizado ────────────────────────────
-- Mesma identidade de documento (não é linha nova) — só remove a
-- citação nominal a Brigadas/Biomonitor/Frota da seção 4, para não
-- precisar editar o Termo toda vez que um app novo nascer. O detalhe
-- de cada app agora mora no aviso_campo dedicado dele.
INSERT INTO lgpd_documento_versoes (documento_id, versao, vigente_desde, resumo_mudancas, conteudo_md)
SELECT d.id, '1.1', CURRENT_DATE,
  'Seção 4 generalizada: deixa de citar Brigadas/Biomonitor/Frota por nome (cada um ganhou aviso de privacidade próprio, migration 223) — assim o Termo não precisa ser editado a cada app de campo novo.',
$MD$
# Termo de Uso e Responsabilidade

**Sistema:** SIGUC-AC — Sistema de Gestão de Unidades de Conservação do Acre
**Órgão:** Secretaria de Estado de Meio Ambiente do Acre (SEMA-AC)
**Versão:** 1.1

Este termo estabelece as condições de uso do SIGUC-AC e as responsabilidades de
quem o acessa. **Ele não é um consentimento para tratamento de dados**: o
tratamento realizado pela SEMA-AC se baseia em execução de política pública e em
cumprimento de obrigação legal, conforme a Política de Privacidade.

## 1. Acesso

O acesso é **pessoal e intransferível**, concedido em razão de vínculo funcional
ou contratual e limitado ao perfil atribuído.

## 2. Suas responsabilidades

Ao usar o SIGUC-AC, você se compromete a:

1. **Guardar sigilo** sobre os dados a que tiver acesso, inclusive após o
   encerramento do vínculo;
2. **Não compartilhar sua senha, PIN ou dispositivo autenticado** com terceiros;
3. **Usar os dados apenas para a finalidade do seu trabalho** — é vedado
   consultar informação de pessoa por interesse particular, curiosidade ou
   qualquer motivo alheio à atividade funcional;
4. **Não extrair, copiar, fotografar ou divulgar** dados pessoais para fora do
   sistema sem autorização formal;
5. **Registrar informação verdadeira**, em especial em registros de campo,
   quilometragem, abastecimento e inspeção veicular;
6. **Comunicar imediatamente** à administração do sistema qualquer suspeita de
   acesso indevido, perda de dispositivo ou vazamento.

## 3. Registro de atividade

Todo acesso e toda ação relevante são registrados, com identificação do usuário,
data, hora, endereço IP e navegador. Esses registros existem para segurança e
prestação de contas, ficam guardados por 5 anos e podem instruir apuração
administrativa.

## 4. Aplicativos de campo

Alguns aplicativos do SIGUC, usados em campo, registram a localização do
aparelho ao executar ações específicas. Cada um tem seu próprio Aviso de
Privacidade, exibido dentro do aplicativo, com o detalhamento do que é
coletado e como. A localização nunca é usada para rastreamento contínuo em
segundo plano, nem depois que o aplicativo é fechado.

## 5. Uso indevido

O descumprimento deste termo pode acarretar suspensão ou cancelamento do acesso,
sem prejuízo da responsabilidade administrativa, civil e penal cabível, nos
termos da Lei 8.112/1990 e legislação estadual correlata, da Lei 12.527/2011 (Lei
de Acesso à Informação) e da Lei 13.709/2018 (LGPD).

## 6. Disponibilidade

A SEMA-AC empenha-se em manter o sistema disponível, podendo interrompê-lo para
manutenção. Os aplicativos de campo funcionam sem conexão e sincronizam quando a
rede é restabelecida; é responsabilidade do usuário **confirmar o envio dos
registros pendentes** assim que houver conexão.

## 7. Vigência

Este termo vigora enquanto durar o acesso. Alterações relevantes geram nova
versão, cuja ciência será solicitada no primeiro acesso seguinte.
$MD$
FROM lgpd_documentos d WHERE d.tipo = 'termo_uso';

-- ── RPCs ──────────────────────────────────────────────────────
-- Gate de mesa passa a excluir os dois avisos com superfície própria
-- (campo E pesquisa) — mesmo raciocínio da migration 213: um gestor
-- não deve ver aviso sobre GPS de brigadista, nem um servidor comum
-- deve ver o aviso do portal do pesquisador.
CREATE OR REPLACE FUNCTION lgpd_pendencias_aceite()
RETURNS TABLE (
  versao_id uuid, documento_id uuid, tipo lgpd_tipo_documento,
  titulo text, versao text, conteudo_md text, hash_sha256 text
)
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public
AS $fn$
  SELECT v.versao_id, v.documento_id, v.tipo, v.titulo, v.versao, v.conteudo_md, v.hash_sha256
    FROM vw_lgpd_documentos_vigentes v
   WHERE v.exige_aceite
     AND v.tipo NOT IN ('aviso_campo', 'aviso_pesquisa')
     AND auth.uid() IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM lgpd_aceites a
        WHERE a.versao_id = v.versao_id AND a.usuario_id = auth.uid()
     )
   ORDER BY v.tipo;
$fn$;

-- p_app com DEFAULT NULL: um cliente antigo em cache (PWA) que ainda
-- chame sem argumento não quebra — só deixa de achar o documento
-- genérico (desativado nesta migration) e volta vazio, nunca erro.
-- Fail-open, mesmo princípio do restante do arquivo — nunca travar o
-- trabalho de campo.
CREATE OR REPLACE FUNCTION lgpd_aviso_campo(p_app text DEFAULT NULL)
RETURNS TABLE (
  versao_id uuid, titulo text, versao text,
  conteudo_md text, hash_sha256 text, ja_ciente boolean
)
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public
AS $fn$
  SELECT v.versao_id, v.titulo, v.versao, v.conteudo_md, v.hash_sha256,
         EXISTS (
           SELECT 1 FROM lgpd_aceites a
            WHERE a.versao_id = v.versao_id AND a.usuario_id = auth.uid()
         ) AS ja_ciente
    FROM vw_lgpd_documentos_vigentes v
   WHERE v.tipo = 'aviso_campo'
     AND v.app = p_app
     AND auth.uid() IS NOT NULL;
$fn$;

-- Espelha lgpd_aviso_campo, mas sem a complexidade offline — o portal
-- do pesquisador sempre tem conexão quando carrega, ao contrário dos
-- 3 apps de campo.
CREATE OR REPLACE FUNCTION lgpd_aviso_pesquisa()
RETURNS TABLE (
  versao_id uuid, titulo text, versao text,
  conteudo_md text, hash_sha256 text, ja_ciente boolean
)
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public
AS $fn$
  SELECT v.versao_id, v.titulo, v.versao, v.conteudo_md, v.hash_sha256,
         EXISTS (
           SELECT 1 FROM lgpd_aceites a
            WHERE a.versao_id = v.versao_id AND a.usuario_id = auth.uid()
         ) AS ja_ciente
    FROM vw_lgpd_documentos_vigentes v
   WHERE v.tipo = 'aviso_pesquisa'
     AND auth.uid() IS NOT NULL;
$fn$;

REVOKE EXECUTE ON FUNCTION lgpd_aviso_pesquisa() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION lgpd_aviso_pesquisa() TO authenticated;
