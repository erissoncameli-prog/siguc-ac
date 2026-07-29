-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · LGPD Fase 2b — Aviso de Privacidade dos apps de campo
--
-- POR QUE UM DOCUMENTO SEPARADO
-- Brigadista, monitor e motorista são a população de MAIOR risco do
-- sistema: são deles a geolocalização e a foto (TRAT-005, TRAT-006,
-- TRAT-009 e TRAT-011 do ROPA, quatro dos cinco tratamentos de alto
-- risco). São também quem tem menos condição de ler um documento de
-- sete páginas — celular, sol, campo, muitas vezes sem sinal.
--
-- Um texto longo exibido nessas condições não informa ninguém: cumpre
-- a formalidade e falha na finalidade do Art. 9º. Daí um aviso curto,
-- em linguagem direta, que cabe numa tela e diz o que de fato importa
-- para quem está sendo geolocalizado — inclusive o que o sistema NÃO
-- faz.
--
-- POR QUE NÃO ENTRA NO GATE DE MESA
-- `lgpd_pendencias_aceite()` alimenta o bloqueio das 38 telas de mesa.
-- Se o aviso de campo entrasse nela, todo servidor administrativo
-- passaria a ver um aviso sobre GPS de brigadista — ruído que corrói a
-- credibilidade do próprio mecanismo de ciência. A função passa a
-- excluir explicitamente o tipo, e os apps usam `lgpd_aviso_campo()`.
--
-- O aviso NÃO substitui a Política de Privacidade: é a porta de
-- entrada dela, e remete ao texto completo.
-- ═══════════════════════════════════════════════════════════

-- ── 1. O gate de mesa ignora o aviso de campo ──────────────────
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
     AND v.tipo <> 'aviso_campo'   -- superfície própria: lgpd_aviso_campo()
     AND auth.uid() IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM lgpd_aceites a
        WHERE a.versao_id = v.versao_id AND a.usuario_id = auth.uid()
     )
   ORDER BY v.tipo;
$fn$;

-- ── 2. RPC do aviso de campo ───────────────────────────────────
-- Devolve SEMPRE a versão vigente, com `ja_ciente` dizendo se este
-- usuário já deu ciência. Não filtra o já-visto no servidor de
-- propósito: o app precisa do texto em mãos para poder cachear e
-- reexibir offline, na tela de configurações, sem depender de rede.
CREATE OR REPLACE FUNCTION lgpd_aviso_campo()
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
     AND auth.uid() IS NOT NULL;
$fn$;

REVOKE EXECUTE ON FUNCTION lgpd_aviso_campo() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION lgpd_aviso_campo() TO authenticated;

-- ── 3. O documento ─────────────────────────────────────────────
INSERT INTO lgpd_documentos (tipo, titulo, exige_aceite, publico) VALUES
  ('aviso_campo', 'Aviso de Privacidade — Aplicativos de Campo', true, false);

INSERT INTO lgpd_documento_versoes (documento_id, versao, vigente_desde, resumo_mudancas, conteudo_md)
SELECT d.id, '1.0', CURRENT_DATE, 'Versão inicial.',
$MD$
# Sobre seus dados neste aplicativo

Este aplicativo é da **SEMA-AC**. Para o seu trabalho ser registrado e
comprovado, ele guarda algumas informações suas. Em resumo:

## O que é registrado

- **Sua localização** no momento exato em que você faz uma ação —
  abrir ou encerrar uma viagem, registrar um abastecimento, lançar uma
  ocorrência ou um registro de campo.
- **As fotos** que você tira pelo aplicativo, com data, hora e marca
  d'água.
- **Seu cadastro**: nome, CPF, contato e foto de perfil.
- **Datas e horários** de uso do aplicativo.

## O que NÃO é feito

- **Você não é rastreado.** A localização é lida só no instante da
  ação. Não há acompanhamento contínuo, nem com o aplicativo fechado
  ou no bolso.
- **Sua foto não é usada para reconhecimento facial.** Ela serve para
  identificar você no sistema, e nada além disso.
- **Se o GPS não pegar, o trabalho continua.** A ação é concluída do
  mesmo jeito, sem a localização. O aplicativo nunca vai travar seu
  registro por causa de sinal.

## Para que serve

Para comprovar **onde e quando o fato aconteceu** — o incêndio, o
ninho, a viagem. É exigência de prestação de contas do serviço
público. **Não serve para vigiar o seu deslocamento.**

## Seus direitos

Você pode pedir para ver, corrigir ou saber com quem seus dados são
compartilhados. Fale com a coordenação da sua equipe ou com o
Encarregado de Dados da SEMA-AC. O prazo de resposta é de 15 dias.

Alguns registros não podem ser apagados a seu pedido: registro de
combate a incêndio e de ocorrência são documento público e têm guarda
obrigatória por lei.

## Texto completo

A Política de Privacidade completa está em
**siguc-ac.vercel.app/pages/privacidade.html**
$MD$
FROM lgpd_documentos d WHERE d.tipo = 'aviso_campo';

-- ── 4. ROPA: o aviso é a medida de transparência dos apps ──────
UPDATE lgpd_tratamentos
   SET observacoes = observacoes ||
       ' Transparência ao titular implementada pelo Aviso de Privacidade exibido nos apps de campo (migration 213).'
 WHERE codigo IN ('TRAT-005', 'TRAT-006', 'TRAT-009', 'TRAT-011');
