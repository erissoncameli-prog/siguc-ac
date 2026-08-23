-- 317_bacias_rota_unifica_relatorios.sql
--
-- pages/rh-bacias.html (comparativo entre bacias) se fundiu em
-- pages/agua-relatorios.html como um MODO da própria tela de
-- Relatórios (segmented control "Painel" / "Comparar bacias") — pedido
-- do usuário: as duas eram formas diferentes de olhar o MESMO
-- relatório, sem razão pra viverem em páginas separadas. A rota
-- cadastrada em `modulos` para a chave 'bacias' (304) apontava pro
-- arquivo antigo; corrige para a URL unificada, com `?visao=bacias`
-- abrindo já no modo Comparar (pra quem chega por link direto, fora do
-- menu — o subgrupo "Bacias Hidrográficas" da sidebar não linka mais
-- pra cá, ver js/layout.js).

UPDATE modulos
   SET rota = '../pages/agua-relatorios.html?visao=bacias',
       atualizado_em = now()
 WHERE chave = 'bacias';
