-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · LGPD Fase 2 — Política de Privacidade, Termo de Uso,
-- versionamento e registro de aceite
--
-- POR QUE VERSIONAR COM HASH
-- "O usuário aceitou os termos" não vale nada se não der para provar
-- QUAL texto ele aceitou. Aqui cada versão guarda o conteúdo integral
-- e um hash SHA-256 gerado pelo próprio banco (coluna GENERATED), que
-- não pode divergir do texto nem ser preenchido errado pela aplicação.
-- O aceite aponta para a VERSÃO, não para o documento — então editar a
-- política no futuro não reescreve o passado: cria versão nova e quem
-- já aceitou a anterior volta a ser cobrado.
--
-- O QUE É CADA DOCUMENTO (não são a mesma coisa)
--   · Política de Privacidade — informação ao titular (Art. 9º).
--     Pública, legível sem login, porque também fala de quem NÃO é
--     usuário do sistema (proprietário rural do CAR, participante de
--     atividade). É o instrumento de transparência do TRAT-013.
--   · Termo de Uso e Responsabilidade — obrigações de quem opera o
--     sistema (sigilo, uso da credencial, finalidade). Não é
--     "consentimento para tratar dados": a base legal do SIGUC é
--     política pública (ver migration 211), e pedir consentimento
--     criaria um direito de revogação que quebraria o sistema.
--
-- ENCARREGADO (DPO)
-- O texto remete à seção de contato da página, que é renderizada a
-- partir de config_sistema. Assim a designação por portaria entra pela
-- tela de Configurações, sem migration nem deploy. Deliberadamente NÃO
-- se usou marcador de template ({{...}}) dentro do texto legal: se a
-- substituição falhar, o cidadão veria o marcador cru.
-- ═══════════════════════════════════════════════════════════

CREATE TYPE lgpd_tipo_documento AS ENUM (
  'politica_privacidade',
  'termo_uso',
  'aviso_campo'   -- aviso curto para os apps de campo (Fase 2b)
);

CREATE TABLE lgpd_documentos (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo         lgpd_tipo_documento NOT NULL UNIQUE,
  titulo       text NOT NULL,
  -- exige_aceite: entra no bloqueio de login até ser aceito.
  exige_aceite boolean NOT NULL DEFAULT false,
  -- publico: legível sem autenticação (papel anon).
  publico      boolean NOT NULL DEFAULT false,
  ativo        boolean NOT NULL DEFAULT true,
  criado_em    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE lgpd_documento_versoes (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  documento_id uuid NOT NULL REFERENCES lgpd_documentos(id) ON DELETE CASCADE,
  versao       text NOT NULL,
  conteudo_md  text NOT NULL,
  -- Gerado pelo banco: impossível o hash divergir do texto.
  hash_sha256  text GENERATED ALWAYS AS (encode(sha256(conteudo_md::bytea), 'hex')) STORED,
  vigente_desde   date NOT NULL DEFAULT CURRENT_DATE,
  resumo_mudancas text,
  publicado_por   uuid REFERENCES usuarios(id),
  criado_em       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (documento_id, versao)
);

CREATE INDEX idx_lgpd_versoes_doc ON lgpd_documento_versoes(documento_id, vigente_desde DESC);

CREATE TABLE lgpd_aceites (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Referencia auth.users, não usuarios: é o único âncora comum a
  -- TODOS os perfis. Brigadista, monitor e motorista têm conta própria
  -- (brigadistas.usuario_id, monitores_biodiversidade.usuario_id,
  -- frota_motoristas.usuario_id) e o pesquisador externo tem
  -- pesquisadores.user_id — mas nem todos têm linha em `usuarios`.
  usuario_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  versao_id  uuid NOT NULL REFERENCES lgpd_documento_versoes(id) ON DELETE CASCADE,
  aceito_em  timestamptz NOT NULL DEFAULT now(),
  user_agent text,
  UNIQUE (usuario_id, versao_id)
);

CREATE INDEX idx_lgpd_aceites_usuario ON lgpd_aceites(usuario_id);

-- ── Versão vigente de cada documento ───────────────────────────
-- DISTINCT ON pega a versão mais recente já em vigor. Publicar uma
-- versão com vigente_desde no futuro é suportado de propósito: dá para
-- preparar a atualização e ela entra sozinha na data marcada.
CREATE VIEW vw_lgpd_documentos_vigentes WITH (security_invoker = true) AS
SELECT DISTINCT ON (d.id)
       d.id   AS documento_id,
       d.tipo, d.titulo, d.exige_aceite, d.publico,
       v.id   AS versao_id,
       v.versao, v.conteudo_md, v.hash_sha256, v.vigente_desde
  FROM lgpd_documentos d
  JOIN lgpd_documento_versoes v
    ON v.documento_id = d.id
   AND v.vigente_desde <= CURRENT_DATE
 WHERE d.ativo
 ORDER BY d.id, v.vigente_desde DESC, v.criado_em DESC;

-- ── RLS ────────────────────────────────────────────────────────
ALTER TABLE lgpd_documentos        ENABLE ROW LEVEL SECURITY;
ALTER TABLE lgpd_documento_versoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE lgpd_aceites           ENABLE ROW LEVEL SECURITY;

CREATE POLICY lgpd_doc_select ON lgpd_documentos FOR SELECT
  USING (publico OR auth.uid() IS NOT NULL);

CREATE POLICY lgpd_doc_write ON lgpd_documentos FOR ALL
  USING (EXISTS (SELECT 1 FROM usuarios u
                  WHERE u.id = auth.uid() AND u.perfil IN ('super_admin','gestor') AND u.ativo));

CREATE POLICY lgpd_versao_select ON lgpd_documento_versoes FOR SELECT
  USING (EXISTS (SELECT 1 FROM lgpd_documentos d
                  WHERE d.id = documento_id AND d.ativo
                    AND (d.publico OR auth.uid() IS NOT NULL)));

CREATE POLICY lgpd_versao_write ON lgpd_documento_versoes FOR ALL
  USING (EXISTS (SELECT 1 FROM usuarios u
                  WHERE u.id = auth.uid() AND u.perfil IN ('super_admin','gestor') AND u.ativo));

-- O titular vê os próprios aceites (Art. 18, II — direito de acesso);
-- super_admin vê todos, porque o aceite é a prova de conformidade que
-- o órgão precisa exibir em auditoria.
CREATE POLICY lgpd_aceite_select ON lgpd_aceites FOR SELECT
  USING (usuario_id = auth.uid()
         OR EXISTS (SELECT 1 FROM usuarios u
                     WHERE u.id = auth.uid() AND u.perfil = 'super_admin' AND u.ativo));

-- Sem policy de INSERT/UPDATE/DELETE de propósito: aceite só entra
-- pela RPC abaixo, e nunca é alterado nem apagado — é registro de
-- prova. Revogar um aceite seria falsear o histórico; o caminho certo
-- é publicar versão nova.

-- ── RPC: o que falta o usuário aceitar ─────────────────────────
CREATE OR REPLACE FUNCTION lgpd_pendencias_aceite()
RETURNS TABLE (
  versao_id uuid, documento_id uuid, tipo lgpd_tipo_documento,
  titulo text, versao text, conteudo_md text, hash_sha256 text
)
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public
AS $$
  SELECT v.versao_id, v.documento_id, v.tipo, v.titulo, v.versao, v.conteudo_md, v.hash_sha256
    FROM vw_lgpd_documentos_vigentes v
   WHERE v.exige_aceite
     AND auth.uid() IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM lgpd_aceites a
        WHERE a.versao_id = v.versao_id AND a.usuario_id = auth.uid()
     )
   ORDER BY v.tipo;
$$;

-- ── RPC: registrar o aceite ────────────────────────────────────
-- SECURITY DEFINER porque a tabela não tem policy de INSERT: o aceite
-- só pode nascer por aqui, com o usuário e o horário carimbados pelo
-- servidor. O cliente informa apenas o user_agent (que é dele mesmo) e
-- a versão — nunca quem aceitou nem quando.
CREATE OR REPLACE FUNCTION lgpd_registrar_aceite(
  p_versao_id  uuid,
  p_user_agent text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_id  uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;

  -- Só aceita versão de documento ativo que de fato exige aceite —
  -- impede registrar aceite de um id arbitrário.
  IF NOT EXISTS (
    SELECT 1 FROM lgpd_documento_versoes v
      JOIN lgpd_documentos d ON d.id = v.documento_id
     WHERE v.id = p_versao_id AND d.ativo AND d.exige_aceite
  ) THEN
    RAISE EXCEPTION 'Versão de documento inválida ou que não exige aceite';
  END IF;

  -- Idempotente: reapertar o botão (ou reenviar offline) não duplica
  -- nem sobrescreve a data do aceite original, que é a que vale.
  INSERT INTO lgpd_aceites (usuario_id, versao_id, user_agent)
  VALUES (v_uid, p_versao_id, left(p_user_agent, 400))
  ON CONFLICT (usuario_id, versao_id) DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    SELECT id INTO v_id FROM lgpd_aceites
     WHERE usuario_id = v_uid AND versao_id = p_versao_id;
  END IF;

  RETURN v_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION lgpd_registrar_aceite(uuid, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION lgpd_registrar_aceite(uuid, text) TO authenticated;

REVOKE EXECUTE ON FUNCTION lgpd_pendencias_aceite() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION lgpd_pendencias_aceite() TO authenticated;

-- ── Documentos ─────────────────────────────────────────────────
INSERT INTO lgpd_documentos (tipo, titulo, exige_aceite, publico) VALUES
  ('politica_privacidade', 'Política de Privacidade e Proteção de Dados Pessoais', true,  true),
  ('termo_uso',            'Termo de Uso e Responsabilidade',                      true,  false);

INSERT INTO lgpd_documento_versoes (documento_id, versao, vigente_desde, resumo_mudancas, conteudo_md)
SELECT d.id, '1.0', CURRENT_DATE, 'Versão inicial.',
$MD$
# Política de Privacidade e Proteção de Dados Pessoais

**Sistema:** SIGUC-AC — Sistema de Gestão de Unidades de Conservação do Acre
**Controlador:** Secretaria de Estado de Meio Ambiente do Acre (SEMA-AC)
**Versão:** 1.0

## 1. A quem esta política se aplica

Esta política explica como a SEMA-AC trata dados pessoais no SIGUC-AC. Ela vale
para três grupos:

1. **Quem usa o sistema** — servidores, brigadistas, monitores de biodiversidade,
   motoristas e pesquisadores com acesso.
2. **Quem é registrado pelo sistema** — participantes de atividades de educação
   ambiental e pessoas eventualmente retratadas em fotografias de campo.
3. **Quem nunca acessou o sistema, mas tem dados nele** — proprietários e
   possuidores de imóveis rurais, cujos dados chegam de bases federais. Veja a
   seção 5.

## 2. Em que a SEMA-AC se baseia para tratar seus dados

A SEMA-AC é órgão público. O tratamento **não se baseia no seu consentimento**,
e sim nas hipóteses legais aplicáveis à administração pública:

- **Execução de política pública** (art. 7º, III, da LGPD) — gestão de unidades
  de conservação, combate a incêndios florestais, conservação da biodiversidade,
  controle da frota oficial e fiscalização ambiental.
- **Cumprimento de obrigação legal** (art. 7º, II) — trilhas de auditoria, guarda
  documental (Lei 8.159/1991) e prestação de contas aos órgãos de controle.
- **Execução de procedimento a pedido do titular** (art. 7º, V) — solicitações de
  autorização de pesquisa.

O consentimento é usado **apenas para o que é opcional**, como a foto de perfil e
as notificações push, e pode ser retirado a qualquer momento sem prejuízo do uso
do sistema.

## 3. Que dados são tratados

Conforme o seu vínculo com a SEMA-AC:

| Grupo | Dados tratados |
|---|---|
| Servidores e usuários | nome, e-mail, telefone, matrícula, perfil de acesso, registros de acesso (IP, data/hora, navegador) |
| Brigadistas e monitores | nome, CPF, RG, data de nascimento, telefone, e-mail, fotografia, contato de emergência |
| Motoristas | os itens acima e mais número, categoria e validade da CNH |
| Pesquisadores | nome, CPF, RG, e-mail, telefone, instituição e documentos do projeto |
| Participantes de atividades | nome, CPF, data de nascimento e lista de presença |
| Imóveis rurais | CPF ou CNPJ, identificação e perímetro georreferenciado do imóvel |

**Fotografias** são usadas para identificação visual e comprovação documental.
A SEMA-AC **não** faz reconhecimento facial nem trata dado biométrico.

## 4. Localização e registros de campo

Os aplicativos de campo (Brigadas, Biomonitor e Frota) registram a **localização
do aparelho no momento de uma ação específica** — abrir ou encerrar uma viagem,
registrar um abastecimento, lançar uma ocorrência ou um registro de campo.

O que isso significa na prática:

- A captura acontece **apenas no instante da ação**. Não há rastreamento
  contínuo, nem em segundo plano, nem com o aplicativo fechado.
- A finalidade é **comprovar onde o fato ocorreu**, e não acompanhar o
  deslocamento de quem trabalha.
- Se o GPS falhar, for negado ou demorar, **a ação é concluída do mesmo jeito**,
  sem a coordenada.
- No módulo Frota a captura pode ser **desligada por categoria** pela gestão.

## 5. Dados obtidos de outras bases públicas

O SIGUC-AC recebe, por integração automatizada, dados de sistemas federais:

- **SICAR** — Sistema Nacional de Cadastro Ambiental Rural, com CPF/CNPJ e
  perímetro de imóveis rurais.
- **SINAFLOR e DOF** — autorizações de supressão vegetal e transporte de produto
  florestal.

Esses dados são usados **exclusivamente** para cruzar imóveis com limites de
unidades de conservação e com alertas ambientais, instruindo a análise territorial
e a fiscalização — competências legais da SEMA-AC. Como se trata de base espelho,
**a correção do dado deve ser feita na origem** (SICAR ou IBAMA), e será refletida
aqui na sincronização seguinte.

## 6. Com quem os dados são compartilhados

- **Corpo de Bombeiros Militar do Acre (CBMAC)** — em operações integradas de
  combate a incêndio.
- **DETRAN** — em caso de infração de trânsito com veículo oficial.
- **Órgãos de controle, fiscalização e Ministério Público** — quando requisitado
  ou para instruir procedimento.

A SEMA-AC **não vende, não aluga e não cede dados pessoais para fins comerciais
ou publicitários**.

## 7. Onde os dados ficam e por quanto tempo

O banco de dados do SIGUC-AC está hospedado em **território nacional** (São
Paulo). O envio de e-mails automáticos é feito por prestador de serviço que pode
ter infraestrutura no exterior — é a única transferência internacional mapeada, e
alcança apenas o endereço de e-mail e o conteúdo da mensagem.

Prazos de guarda:

- **Registros de acesso e auditoria:** 5 anos, com expurgo automático.
- **Telemetria dos aplicativos de campo:** 12 meses.
- **Cadastros de pessoal:** durante o vínculo e por 5 anos após o encerramento.
- **Registros de campo, ocorrências e autorizações de pesquisa:** guarda
  permanente, por serem documentos públicos de comprovação de política pública
  (Lei 8.159/1991).

## 8. Seus direitos

Você pode, a qualquer momento, solicitar (art. 18 da LGPD):

- confirmação de que existe tratamento e acesso aos seus dados;
- correção de dados incompletos, inexatos ou desatualizados;
- anonimização, bloqueio ou eliminação de dados desnecessários ou tratados em
  desconformidade;
- portabilidade e informação sobre compartilhamentos;
- revogação do consentimento, no que for baseado em consentimento.

**Limite importante e transparente:** quando o tratamento se baseia em política
pública ou obrigação legal, a exclusão pode ser negada — é o caso de registros de
campo, ocorrências e trilhas de auditoria, que são documentos públicos de guarda
obrigatória. Nesses casos você receberá resposta fundamentada.

O prazo de resposta é de **15 dias**.

## 9. Segurança

São adotadas, entre outras medidas: controle de acesso por perfil e por unidade,
isolamento de dados por regras no banco (RLS), trilha de auditoria com bloqueio
após tentativas sucessivas de acesso indevido, tráfego cifrado, arquivos de
imagem e documento em repositório privado com link temporário, e expurgo
automático conforme os prazos da seção 7.

Em caso de incidente de segurança relevante, a SEMA-AC comunicará a Autoridade
Nacional de Proteção de Dados (ANPD) e os titulares afetados, na forma do art. 48
da LGPD.

## 10. Como falar com a SEMA-AC

Pedidos relativos a dados pessoais devem ser dirigidos ao Encarregado pelo
Tratamento de Dados Pessoais, cujos dados de contato constam na seção **Contato**
ao final desta página.

## 11. Alterações

Esta política pode ser atualizada. Cada alteração gera uma nova versão, com data
de vigência e registro do que mudou; as versões anteriores permanecem
arquivadas. Quando a mudança for relevante, será solicitada nova ciência no
primeiro acesso ao sistema.
$MD$
FROM lgpd_documentos d WHERE d.tipo = 'politica_privacidade';

INSERT INTO lgpd_documento_versoes (documento_id, versao, vigente_desde, resumo_mudancas, conteudo_md)
SELECT d.id, '1.0', CURRENT_DATE, 'Versão inicial.',
$MD$
# Termo de Uso e Responsabilidade

**Sistema:** SIGUC-AC — Sistema de Gestão de Unidades de Conservação do Acre
**Órgão:** Secretaria de Estado de Meio Ambiente do Acre (SEMA-AC)
**Versão:** 1.0

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

Nos aplicativos Brigadas, Biomonitor e Frota, ao executar determinadas ações o
aplicativo registra a **localização do aparelho naquele momento**, para comprovar
onde o fato ocorreu. Não há rastreamento contínuo nem em segundo plano, e a
ausência de sinal de GPS não impede a conclusão da ação. Os detalhes estão na
seção 4 da Política de Privacidade.

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

COMMENT ON TABLE lgpd_aceites IS
  'Prova de aceite. Aponta para a VERSÃO do documento, não para o documento: publicar versão nova volta a cobrar o aceite. Sem policy de UPDATE/DELETE — registro de prova não se altera.';
