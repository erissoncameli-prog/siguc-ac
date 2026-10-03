-- ════════════════════════════════════════════════════════════════
-- 354 — Biomonitor: renumera os 18 ninhos "PR-TR-2026-…" da Praia da
--       Curva Grande para "PRCG-TR-2026-…" e devolve os 25 para validação
-- ════════════════════════════════════════════════════════════════
-- Contexto (investigação da migration 353): em 24/09/2026 os 25 ninhos
-- da praia foram devolvidos "em correção" com o motivo "CORRIGIR CODIGO
-- DO NINHO". O código errado era o PREFIXO: 18 ninhos registrados em
-- 18/09 saíram "PR-" em vez de "PRCG-" (sigla da praia), porque o app
-- gerou o número com a cópia local desatualizada da praia — corrigido
-- no app na 353 (bioGerarNumeroNinho lê a sigla do servidor).
--
-- Decisão do usuário (03/10/2026): não existe placa física — o número
-- do sistema É a identidade do ninho, então a correção é feita aqui.
--
-- Regra aplicada:
--   • PR-TR-2026-NNN → PRCG-TR-2026-(NNN+6): os tracajás da praia já
--     usam PRCG-TR-2026-001…006, e a ordem original (que é a ordem de
--     registro) se mantém — 001…018 viram 007…024.
--   • Os 7 ninhos PRCG-* NÃO mudam de número. PRCG-C-2026-007 (pitiú)
--     segue a sigla antiga "C" do pitiú (o catálogo hoje diz "IA"), como
--     outros 4 pitiús de outras praias — trocar só este criaria
--     inconsistência; fica registrado, não "corrigido" por suposição.
--   • Os 25 voltam para 'pendente': quem pediu a correção revalida.
--
-- numero_atual acompanha sozinho (trg_ninhos_sincronizar_atual, 352).
-- O histórico grava a troca (trg_ninhos_historico_validacao, 353); como
-- a mudança roda sem usuário logado, a linha é anotada no fim com quem
-- pediu e por quê, para nunca virar "Usuário não identificado".
-- Conferido antes: nenhum outro ninho usa PRCG-TR-2026-007…024.
-- ════════════════════════════════════════════════════════════════

DO $$
DECLARE
  v_praia uuid;
  v_n     int;
BEGIN
  SELECT id INTO v_praia FROM praias_monitoramento
   WHERE nome = 'Praia da Curva Grande' AND sigla = 'PRCG';
  IF v_praia IS NULL THEN
    RAISE EXCEPTION '354: Praia da Curva Grande (PRCG) não encontrada';
  END IF;

  -- Trava: o alvo tem de estar livre em todo o banco
  SELECT count(*) INTO v_n FROM ninhos_quelonios
   WHERE numero_ninho ~ '^PRCG-TR-2026-0(0[7-9]|1[0-9]|2[0-4])$'
      OR numero_atual ~ '^PRCG-TR-2026-0(0[7-9]|1[0-9]|2[0-4])$';
  IF v_n > 0 THEN
    RAISE EXCEPTION '354: % ninho(s) já usam PRCG-TR-2026-007…024', v_n;
  END IF;

  SELECT count(*) INTO v_n FROM ninhos_quelonios
   WHERE praia_id = v_praia AND numero_ninho ~ '^PR-TR-2026-[0-9]{3}$';
  IF v_n <> 18 THEN
    RAISE EXCEPTION '354: esperava 18 ninhos PR-TR-2026-…, achei %', v_n;
  END IF;

  UPDATE ninhos_quelonios
     SET numero_ninho = 'PRCG-TR-2026-' ||
           lpad((substring(numero_ninho from '([0-9]{3})$')::int + 6)::text, 3, '0')
   WHERE praia_id = v_praia AND numero_ninho ~ '^PR-TR-2026-[0-9]{3}$';

  UPDATE ninhos_quelonios
     SET status_validacao = 'pendente',
         motivo_rejeicao  = NULL,
         validado_por     = NULL,
         validado_em      = NULL
   WHERE praia_id = v_praia AND status_validacao = 'em_correcao';

  -- Anota as linhas que o trigger acabou de gravar (sem usuário logado)
  UPDATE ninhos_validacao_historico h
     SET usuario_nome = 'Correção administrativa no banco (pedido da Diretoria DIMA)',
         perfil       = 'sistema',
         motivo       = CASE WHEN h.numero_de IS NOT NULL
                             THEN 'Prefixo PR- corrigido para PRCG- (migration 354)'
                             ELSE 'Devolvido para validação após a correção dos códigos (migration 354)'
                        END
    FROM ninhos_quelonios n
   WHERE n.id = h.ninho_id AND n.praia_id = v_praia
     AND h.usuario_id IS NULL AND h.em >= now() - interval '1 minute';
END $$;
