-- Permite leitura pública (anon) apenas de UCs estaduais
-- Necessário para o formulário de submissão de pesquisa (pesquisa-publica.html)
CREATE POLICY "uc_public_estadual_select"
  ON unidades_conservacao
  FOR SELECT
  TO anon
  USING (esfera = 'estadual');
