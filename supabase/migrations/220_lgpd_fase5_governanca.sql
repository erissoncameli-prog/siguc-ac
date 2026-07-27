-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · LGPD Fase 5 (2/2) — Plano de Resposta a Incidente
-- (Art. 48) + mecanismo de revisão anual
--
-- Fecha o plano de 5 fases. As quatro anteriores construíram
-- controle preventivo (correções de segurança, ROPA, documentos,
-- canal do titular, RIPD). Esta cobre o que falta: o que fazer
-- QUANDO, apesar disso, algo vazar — e um lembrete que não deixe a
-- governança parar no dia em que foi implantada.
--
-- PLANO DE INCIDENTE COMO DOCUMENTO VERSIONADO
-- Reusa lgpd_documentos pelo mesmo motivo do RIPD (migrations
-- 217/218): é texto estruturado com data de vigência, e a
-- infraestrutura de versionamento+hash já existe. exige_aceite=false
-- (é procedimento interno, não algo que se "aceita") e publico=false.
--
-- REVISÃO ANUAL COMO MECANISMO, NÃO SÓ COMO TEXTO
-- Um plano que diz "revisar anualmente" e não tem cobrança automática
-- vira letra morta no primeiro ano corrido. lgpd_revisoes registra
-- quando a revisão foi feita; um job mensal de pg_cron verifica se já
-- passou de 12 meses desde a última e, se sim, notifica quem edita
-- Configurações → Privacidade — o mesmo padrão de notificação já usado
-- para as solicitações de titular (migration 214).
-- ═══════════════════════════════════════════════════════════

INSERT INTO lgpd_documentos (tipo, titulo, exige_aceite, publico) VALUES
  ('plano_incidente', 'Plano de Resposta a Incidente de Segurança (Art. 48 LGPD)', false, false);

INSERT INTO lgpd_documento_versoes (documento_id, versao, vigente_desde, resumo_mudancas, conteudo_md)
SELECT d.id, '1.0', CURRENT_DATE, 'Versão inicial.',
$MD$
# Plano de Resposta a Incidente de Segurança

Aplica-se a qualquer evento que exponha, altere ou destrua dado
pessoal sem autorização — vazamento, acesso indevido, perda de
disponibilidade relevante. Base legal: Art. 46 (medidas de segurança)
e Art. 48 (comunicação de incidente) da LGPD.

## 1. Detecção

Fontes que podem revelar um incidente:

- **Advisor de segurança do Supabase** (`get_advisors`) — checagem
  recomendada a cada migration que altera RLS, bucket ou GRANT (regra
  já seguida desde a Fase 0 deste plano).
- **`auditoria_acessos`** — bloqueios após tentativas sucessivas,
  padrão de acesso fora do horário/IP habitual.
- **`lgpd_acesso_dado_terceiro`** (migration 216) — volume anômalo de
  consultas ao CAR por um único usuário.
- **Relato de terceiro** — titular, órgão de controle, pesquisador de
  segurança.

Qualquer servidor que suspeitar de um incidente comunica imediatamente
ao Encarregado (contato em Configurações → Privacidade) e ao
super_admin. Não existe "incidente pequeno demais para reportar" nesta
etapa — a triagem de gravidade vem depois, na classificação.

## 2. Classificação de gravidade

| Nível | Critério | Exemplo |
|---|---|---|
| **Crítico** | Dado sensível ou de grande volume exposto publicamente | Bucket privado reaberto; view sem RLS vazando CPF (caso real corrigido na Fase 0 deste plano) |
| **Alto** | Acesso indevido por pessoa identificável, sem exposição pública | Servidor consultando CAR sem finalidade, capturado pelo log da migration 216 |
| **Médio** | Falha de segurança sem evidência de exploração | Advisor aponta política de RLS ausente numa tabela nova, sem uso registrado |
| **Baixo** | Risco teórico, sem dado pessoal envolvido | Configuração subótima sem exposição de titular |

## 3. Contenção imediata

Na ordem, assim que classificado como Crítico ou Alto:

1. **Estancar o vazamento** — revogar GRANT, tornar bucket privado,
   remover view, aplicar migration corretiva. O padrão já praticado
   nas migrations 209/210 deste plano (view pública removida, buckets
   fechados) é o modelo a seguir: corrigir primeiro, documentar depois.
2. **Preservar evidência** — não apagar logs (`auditoria_acessos`,
   `lgpd_acesso_dado_terceiro`, `notificacoes`) antes de exportar o que
   for necessário para apurar extensão e responsabilidade.
3. **Identificar o alcance** — quantos registros, quais titulares,
   qual janela de tempo o dado ficou exposto.

## 4. Comunicação

### 4.1 Interna
Encarregado → Secretário/Diretor da DIMA, no mesmo dia da
classificação como Crítico ou Alto.

### 4.2 ANPD (Art. 48)
Obrigatória quando o incidente **possa acarretar risco ou dano
relevante** aos titulares (regra geral: todo Crítico, e Alto conforme
avaliação do Encarregado). Deve informar, no mínimo:
- natureza dos dados afetados;
- titulares envolvidos (quantidade e categoria — servidor, brigadista,
  proprietário do CAR etc.);
- medidas técnicas de segurança utilizadas (as já vigentes: RLS,
  bucket privado + signed URL, retenção automática);
- riscos relacionados ao incidente;
- medidas adotadas para reverter ou mitigar os efeitos.

Prazo: comunicação em **prazo razoável**, sem prazo fixo em lei —
prática recomendada é não ultrapassar 2 dias úteis da confirmação
(não da suspeita) do incidente Crítico.

### 4.3 Titulares afetados
Quando o incidente representar risco ou dano relevante, comunicar
diretamente os titulares identificáveis (via `notificacoes`, se
tiverem conta no sistema) ou, para titulares sem conta (ex.: base do
CAR), por aviso na Política de Privacidade pública, com data e
descrição do ocorrido.

## 5. Documentação do incidente

Cada incidente Crítico ou Alto gera um registro com: data de detecção,
classificação, tabelas/buckets afetados, quantidade estimada de
titulares, ação de contenção, data de comunicação à ANPD (se houve) e
aos titulares, e responsável pela apuração. Guardado como anexo a esta
seção (fora do banco, junto ao processo administrativo correspondente
— este documento descreve o procedimento, não substitui o registro
processual formal).

## 6. Revisão pós-incidente

Depois de contido, todo incidente Crítico ou Alto gera uma entrada em
`lgpd_revisoes` (ver seção de revisão anual) com o que mudou no
sistema para que o mesmo vetor não se repita — o equivalente aos
"achados corrigidos" que já assinalam este próprio plano de LGPD
(view pública sem `security_invoker`, bucket público com política de
listagem ampla).

## 7. Papéis

- **Encarregado**: recebe o alerta, decide a comunicação à ANPD,
  contato cadastrado em Configurações → Privacidade.
- **super_admin**: contenção técnica (migrations corretivas, revogar
  acesso).
- **Secretário/Diretor DIMA**: informados de todo incidente Crítico.
$MD$
FROM lgpd_documentos d WHERE d.tipo = 'plano_incidente';

-- ── Revisão anual — mecanismo, não só texto ─────────────────────
CREATE TABLE lgpd_revisoes (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  revisado_em  timestamptz NOT NULL DEFAULT now(),
  revisado_por uuid REFERENCES usuarios(id),
  observacoes  text,
  criado_em    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE lgpd_revisoes ENABLE ROW LEVEL SECURITY;

CREATE POLICY lgpd_revisoes_select ON lgpd_revisoes FOR SELECT
  USING (EXISTS (SELECT 1 FROM usuarios u
                  WHERE u.id = auth.uid() AND u.perfil IN ('super_admin','gestor') AND u.ativo));

CREATE POLICY lgpd_revisoes_insert ON lgpd_revisoes FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM usuarios u
                        WHERE u.id = auth.uid() AND u.perfil IN ('super_admin','gestor') AND u.ativo));

-- Sem UPDATE/DELETE: cada revisão é um registro de que aconteceu,
-- igual aos aceites — não se edita o passado, só se soma uma nova.

-- ── Job mensal: cobra a revisão que passou de 12 meses ─────────
-- Dedupe pelo mesmo padrão já usado em frota (migration 207): só
-- insere notificação nova se não houver uma pendente do mesmo
-- subtipo — senão notificaria todo mês até alguém marcar a revisão.
CREATE OR REPLACE FUNCTION lgpd_checar_revisao_anual()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_ultima  timestamptz;
  v_pendente boolean;
  r record;
BEGIN
  SELECT max(revisado_em) INTO v_ultima FROM lgpd_revisoes;

  IF v_ultima IS NOT NULL AND v_ultima > now() - interval '12 months' THEN
    RETURN; -- revisão em dia
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM notificacoes
     WHERE tipo = 'sistema' AND status <> 'resolvida'
       AND meta->>'subtipo' = 'lgpd_revisao_anual'
  ) INTO v_pendente;
  IF v_pendente THEN RETURN; END IF;

  FOR r IN SELECT id FROM usuarios WHERE ativo AND perfil IN ('super_admin','gestor') LOOP
    INSERT INTO notificacoes (tipo, status, titulo, mensagem, destinatario_id, meta)
    VALUES ('sistema', 'gerada', 'Revisão anual de LGPD pendente',
      CASE WHEN v_ultima IS NULL
        THEN 'Nenhuma revisão de governança de LGPD foi registrada ainda. Revise ROPA, RIPD, políticas e o log de acesso ao CAR em Configurações → Privacidade.'
        ELSE format('Já se passaram mais de 12 meses desde a última revisão (%s). Revise ROPA, RIPD, políticas e o log de acesso ao CAR.', to_char(v_ultima, 'DD/MM/YYYY'))
      END,
      r.id, jsonb_build_object('modulo','lgpd','subtipo','lgpd_revisao_anual'));
  END LOOP;
END;
$$;

REVOKE EXECUTE ON FUNCTION lgpd_checar_revisao_anual() FROM PUBLIC, anon, authenticated;

SELECT cron.schedule(
  'lgpd-revisao-anual',
  '0 9 1 * *',   -- dia 1 de cada mês, 09h UTC — mesma janela dos outros jobs diários
  $$SELECT lgpd_checar_revisao_anual();$$
);

COMMENT ON TABLE lgpd_revisoes IS
  'Registro de quando a governança de LGPD (ROPA, RIPD, políticas, log de acesso a terceiro) foi revisada. Alimenta o lembrete automático de lgpd_checar_revisao_anual — sem isso, "revisar anualmente" ficaria só no papel.';
