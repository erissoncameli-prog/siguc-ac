-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Perfil do usuário — foto única + edição do próprio cadastro
--
-- Contexto: o rodapé da sidebar tinha dois links soltos ("Meus Dados" e
-- "Alterar Senha") e nenhum lugar onde o servidor editasse os próprios
-- dados. Tudo passa a abrir num modal a partir do bloco do nome
-- (js/perfil.js + js/layout.js). Esta migration é o lado do banco.
--
-- ── 1. UMA FOTO SÓ, PROPAGADA — não resolvida por join ──────────
-- Hoje cada app de campo guarda o próprio avatar: brigadistas.foto_url,
-- frota_motoristas.foto_url, monitores_biodiversidade.foto_url — as
-- três ligadas à conta por `usuario_id`. `usuarios.foto_url` nasce aqui
-- como a fonte que a pessoa edita, e `perfil_atualizar_foto` COPIA o
-- endereço para as linhas de identidade dela.
--
-- Cópia, e não join na hora de exibir, por dois motivos medidos:
--   a) os três apps são offline-first e já leem `foto_url` da própria
--      linha, que vem no cache do IndexedDB — um join resolvido no
--      servidor sumiria com o avatar sempre que o aparelho estivesse
--      sem rede, justamente o cenário de campo;
--   b) brigadista e monitor podem existir SEM conta (`usuario_id` nulo,
--      entram por PIN) e nesses casos a foto própria continua sendo a
--      única que existe — um join não teria o que resolver.
-- O preço da cópia é a defasagem entre a troca e o próximo sync do
-- aparelho, que é aceitável para um avatar.
--
-- Qualidade da Água não entra na propagação: o app usa `auth.uid()`
-- direto, sem tabela de identidade própria (ver "Fase 3" no
-- docs/qualidade-agua/plano.md), então lê `usuarios.foto_url`.
--
-- ── 2. BUCKET PRIVADO DESDE O NASCIMENTO ────────────────────────
-- Regra do sistema (migrations 200/210): bucket com imagem de pessoa é
-- privado, e quem exibe assina na hora com js/fotos-privadas.js. Nunca
-- existe uma janela em que `avatares` seja público.
-- Escrita restrita à PRÓPRIA pasta (`avatares/<uid>/…`): sem isso, um
-- autenticado poderia sobrescrever a foto de qualquer colega.
-- Leitura liberada a qualquer autenticado porque o avatar aparece para
-- os colegas — chefe de brigada vê a equipe, gestor vê o motorista da
-- viagem, a lista de passageiros mostra quem vai.
--
-- ── 3. ACHADO AO CONSTRUIR ISTO — escalada de privilégio ─────────
-- A policy `usuarios_self_update` em produção é
-- `USING (auth.uid() = id)` SEM `WITH CHECK` — e no Postgres, UPDATE
-- sem WITH CHECK reaproveita a expressão do USING como verificação da
-- linha NOVA. Como `id` não muda, a linha nova passa: qualquer
-- autenticado podia fazer `update usuarios set perfil='super_admin'`
-- na própria linha e virar administrador do sistema. A policy é
-- anterior a esta entrega (não está em migration nenhuma do
-- repositório — mesmo drift já registrado no CLAUDE.md a propósito de
-- `usuarios_auth_select`), mas esta é a primeira tela que faz o usuário
-- comum escrever na própria linha, então fecha-se aqui.
--
-- RLS não sabe restringir COLUNA, e GRANT por coluna não serve porque
-- admin e usuário comum são o mesmo papel do Postgres (`authenticated`)
-- — o que os separa é a policy. A trava é então um trigger que devolve
-- os campos sensíveis ao valor antigo quando quem edita a própria linha
-- não é staff. Segunda camada, no mesmo espírito da trava de veículo do
-- Frota (migration 180): a tela não manda esses campos, e o banco
-- garante que não adianta mandar.
--
-- `deve_trocar_senha` fica DE FORA da trava de propósito: o fluxo de
-- troca obrigatória de senha (pages/trocar-senha.html, brigada.html,
-- agua-app.html, biomonitor) baixa essa flag como o próprio usuário
-- depois de trocar a senha de verdade. Travá-la quebraria o primeiro
-- login de todo mundo, e o que ela protege é um lembrete, não um
-- privilégio.
-- ═══════════════════════════════════════════════════════════

-- ── 1. Coluna ───────────────────────────────────────────────

ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS foto_url text;

COMMENT ON COLUMN usuarios.foto_url IS
  'Avatar único da pessoa (bucket privado `avatares`). Fonte da verdade: '
  'perfil_atualizar_foto() copia este endereço para brigadistas, '
  'frota_motoristas e monitores_biodiversidade da mesma conta.';

-- ── 2. Trava de escalada no auto-update ─────────────────────

CREATE OR REPLACE FUNCTION usuarios_travar_campos_sensiveis()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Só interessa quem edita a PRÓPRIA linha sem ser staff. Admin
  -- (gestor/super_admin) segue passando pela policy usuarios_admin_update.
  IF auth.uid() IS NOT NULL
     AND NEW.id = auth.uid()
     AND NOT usuario_atual_eh_staff() THEN
    NEW.perfil := OLD.perfil;
    NEW.ativo  := OLD.ativo;
    NEW.uc_id  := OLD.uc_id;
    NEW.email  := OLD.email;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION usuarios_travar_campos_sensiveis() FROM anon, authenticated;

DROP TRIGGER IF EXISTS trg_usuarios_travar_campos_sensiveis ON usuarios;
CREATE TRIGGER trg_usuarios_travar_campos_sensiveis
  BEFORE UPDATE ON usuarios
  FOR EACH ROW EXECUTE FUNCTION usuarios_travar_campos_sensiveis();

-- ── 3. Bucket privado dos avatares ──────────────────────────

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('avatares', 'avatares', false, 5242880,
  ARRAY['image/jpeg','image/jpg','image/png','image/webp','image/heic','image/heif'])
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS avatares_read ON storage.objects;
CREATE POLICY avatares_read ON storage.objects
  FOR SELECT USING (bucket_id = 'avatares' AND auth.uid() IS NOT NULL);

-- Escrita só na própria pasta: avatares/<uid>/<arquivo>
DROP POLICY IF EXISTS avatares_insert ON storage.objects;
CREATE POLICY avatares_insert ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'avatares'
    AND auth.uid() IS NOT NULL
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS avatares_update ON storage.objects;
CREATE POLICY avatares_update ON storage.objects
  FOR UPDATE USING (
    bucket_id = 'avatares'
    AND auth.uid() IS NOT NULL
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS avatares_delete ON storage.objects;
CREATE POLICY avatares_delete ON storage.objects
  FOR DELETE USING (
    bucket_id = 'avatares'
    AND auth.uid() IS NOT NULL
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- ── 4. RPC de propagação ────────────────────────────────────
-- SECURITY DEFINER porque escreve em brigadistas / frota_motoristas /
-- monitores_biodiversidade, tabelas em que o dono da conta não tem
-- (nem deve ter) UPDATE aberto — o único campo que ela altera nessas
-- três é `foto_url`, e sempre da linha vinculada a auth.uid().
--
-- p_url NULL = remover a foto (o objeto no Storage é apagado pelo
-- cliente, que conhece o caminho; aqui só se limpa o endereço).
CREATE OR REPLACE FUNCTION perfil_atualizar_foto(p_url text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Sessão não autenticada';
  END IF;

  -- Aceita só endereço do bucket de avatares, e só da própria pasta.
  -- Sem isso a RPC viraria um jeito de gravar qualquer URL (inclusive
  -- de fora do sistema) no avatar que os colegas veem.
  IF p_url IS NOT NULL
     AND p_url !~ ('/storage/v1/object/(public/)?avatares/' || v_uid::text || '/') THEN
    RAISE EXCEPTION 'Endereço de foto inválido para este usuário';
  END IF;

  UPDATE usuarios SET foto_url = p_url, atualizado_em = now() WHERE id = v_uid;

  UPDATE brigadistas              SET foto_url = p_url WHERE usuario_id = v_uid;
  UPDATE frota_motoristas         SET foto_url = p_url WHERE usuario_id = v_uid;
  UPDATE monitores_biodiversidade SET foto_url = p_url WHERE usuario_id = v_uid;

  RETURN p_url;
END;
$$;

REVOKE EXECUTE ON FUNCTION perfil_atualizar_foto(text) FROM anon;
GRANT EXECUTE ON FUNCTION perfil_atualizar_foto(text) TO authenticated;

-- ── 5. ROPA — a foto entra no tratamento que já existe ──────
-- TRAT-001 (cadastro de usuários) passa a materializar também o
-- avatar. Não é tratamento novo: é o mesmo cadastro, com um campo a
-- mais. A base legal, porém, é diferente da do resto da linha — foto
-- de perfil é opcional e sai por vontade da pessoa, então é o caso raro
-- de consentimento (Art. 7º, I), como já registrado no plano de LGPD.
UPDATE lgpd_tratamentos
   SET categorias_dados = array(
         SELECT DISTINCT unnest(categorias_dados || ARRAY['foto de perfil (opcional)'])
       ),
       observacoes = coalesce(observacoes || ' ', '') ||
       'A foto de perfil (usuarios.foto_url, bucket privado `avatares`) é campo '
       'OPCIONAL, baseado em consentimento (Art. 7º, I) — diferente do restante '
       'deste tratamento, que se apoia no Art. 7º, III. É removível pelo próprio '
       'titular em Perfil → Foto, e a remoção apaga o arquivo no Storage, não '
       'apenas o endereço gravado.'
 WHERE codigo = 'TRAT-001'
   AND position('foto de perfil' in coalesce(observacoes, '')) = 0;
