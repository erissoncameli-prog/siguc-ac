# Segurança — alertas do Supabase Advisor (agosto/2026)

Disparado pelo e-mail do Supabase de 03/08/2026 ("These issues require your
immediate attention"), que cobrava 5 erros críticos. O advisor completo trazia
**332 achados**. Este documento registra o que foi corrigido, o que ficou aberto
e por quê.

Migrations desta entrega: **226, 227, 228, 229**. Código: `api/dof-proxy.js`.

## Resultado

| Aviso | Antes | Depois |
|---|---:|---:|
| ERROR `security_definer_view` | 4 | **0** |
| ERROR `rls_disabled_in_public` | 1 | 1 |
| WARN `anon_security_definer_function_executable` | 125 | **12** |
| WARN `function_search_path_mutable` | 47 | **0** |
| WARN `authenticated_security_definer_function_executable` | 147 | 131 |
| WARN `extension_in_public` | 3 | 3 |
| WARN `auth_leaked_password_protection` | 1 | 1 |
| INFO `rls_enabled_no_policy` | 4 | 4 |
| **Total** | **332** | **153** |

Os 12 `anon_*` restantes são intencionais: as 8 funções dos fluxos sem login
(mais uma sobrecarga de `focos_por_ano`) e as 3 sobrecargas de
`st_estimatedextent`, que pertencem ao PostGIS.

## O que foi corrigido

### 1. Quatro views ignoravam a RLS (226) — os erros do e-mail

`cargos_atuais`, `brigadas_resumo`, `vw_registros_validacao` e
`minhas_permissoes` rodavam com os privilégios do dono, ou seja, **liam as
tabelas de base sem passar pela RLS**. Como toda view em `public` é exposta pelo
PostgREST, qualquer pessoa com a anon key (que é pública, vai no frontend) lia o
conteúdo inteiro sem login. Confirmado em produção com `SET ROLE anon`: 2
registros de campo com nome de brigadista e GPS, 5 brigadas, 56 brigadistas,
nome e e-mail dos titulares de cargo.

Verificação de regressão feita ANTES de aplicar, com JWT real de cada perfil.
`chefe_brigada` e `visualizador` passam a ver menos, mas isso não é regressão:
os dois já têm `nivel_efetivo = sem_acesso` nos módulos brigadas,
admin-brigadas, validacao-campo e relatorios-brigadas, então o sistema de
permissões nunca abriu para eles as páginas que leem essas views. A RLS passou a
concordar com a permissão do módulo em vez de contradizê-la.

### 2. 113 RPCs executáveis sem login (227/228)

A anon key é pública. "Executável por `anon`" significa executável por qualquer
pessoa na internet. Entre as expostas havia RPCs de **ação**, não só de leitura:
`zerar_registros_campo`, `promover_registro_a_ocorrencia`,
`gestor_vincular_brigada`, `marcar_inadimplencia`, `regularizar_pesquisador`,
`avancar_etapa_pesquisa`, os 10 `despachar_*`, `ativar_temporada` /
`encerrar_temporada`, e 4 sobrecargas mortas de `submeter_pesquisa_publica`
(nenhuma usada pelo frontend).

Continuam abertas só as 8 que sustentam fluxo genuinamente sem login, levantadas
cruzando cada função com quem a chama:

| Função | Fluxo |
|---|---|
| `verificar_bloqueio`, `registrar_tentativa_acesso` | tela de login (`index.html`), antes de existir sessão |
| `verificar_pesquisador_duplicado` | `cadastro-pesquisador.html` |
| `buscar_pesquisa_por_token`, `anexar_documento_publico` | `pesquisa-status.html` (acompanhamento por token) |
| `buscar_aap_por_token` | `validar-aap.html` (validação por QR) |
| `dof_volume_por_produto`, `focos_por_ano` | `/api/dof-proxy` e `/api/focos-proxy`, que rodam com a anon key — agregados, sem dado pessoal |

As funções de **trigger** perderam EXECUTE de `anon` e de `authenticated`: só
devem rodar via trigger. Mesmo padrão das migrations 165 e 179.

> ⚠️ **A 227 nasceu errada e não teve efeito nenhum.** Ela revogava EXECUTE de
> `anon`, mas o privilégio real vinha do grant que o Postgres dá a `PUBLIC` por
> padrão em toda função. Depois de aplicada, `has_function_privilege('anon', …)`
> seguia `true` nas 122 funções — o comando roda, o banco não reclama, e a
> intenção não se realiza. Mesma família do erro da 178 (recriar função sem
> `DROP`) e da 224 (mudar assinatura sem `DROP`). A 228 corrigiu, com
> `FROM PUBLIC` **e** reconcedendo a `authenticated`/`service_role` no mesmo
> passo — porque PUBLIC também era o que dava acesso a `authenticated` em parte
> das funções, e revogar sem reconceder derrubaria o sistema inteiro junto.
>
> **Regra permanente: REVOKE em função é sempre `FROM PUBLIC`, nunca só
> `FROM anon`.** E toda migration de REVOKE deve terminar com asserção que
> falhe se a intenção não se realizou — foi o que pegou este erro.

### 3. INSERT anônimo irrestrito em `focos_calor_ac` (227)

A policy `focos_import_tmp` era `INSERT` para `anon` com `WITH CHECK (true)`:
qualquer pessoa com a anon key podia inserir linhas ilimitadas na base de focos
de calor (953 mil linhas hoje) — envenenamento de dado e crescimento de
armazenamento, sem login. O nome ("tmp") indica sobra de uma importação manual;
nenhum código do repositório insere nessa tabela. **Este achado não aparece no
advisor** — foi encontrado varrendo as policies que citam `anon`.

### 4. `/api/dof-proxy` servia nome de emitente publicamente

`dof_dentro_uc` e `dof_sem_asv` devolvem `nome_emitente`, e `sem_asv` é
literalmente uma lista de indício de irregularidade (transporte de produto
florestal sem ASV). O endpoint não pedia autenticação, respondia com
`Access-Control-Allow-Origin: *` e ainda mandava `Cache-Control: public,
max-age=1800` — ou seja, `GET /api/dof-proxy?action=sem_asv` de qualquer lugar
do mundo devolvia a lista com nomes. **Também não aparece no advisor**, que só
enxerga o banco.

Nenhuma página do sistema chama essas duas ações (só o probe de saúde toca o
endpoint, sem `action`), então exigir autenticação não quebra nada. As duas
ações passam a exigir o JWT do usuário logado, repassado ao Supabase, e a
resposta deixa de ser cacheável. As ações agregadas (`recursos`, `stats`)
seguem abertas.

### 5. `search_path` mutável em 46 funções (229)

Sem `search_path` fixo, o Postgres resolve nomes não qualificados usando o
`search_path` de quem chama — e `pg_temp` entra implicitamente na frente. Num
`SECURITY DEFINER` isso é escalada de privilégio: basta criar `pg_temp.usuarios`
para que um `SELECT ... FROM usuarios` dentro da função leia a tabela falsa, com
os privilégios do dono. Fixado em `public, pg_temp` (nesta ordem) via `ALTER
FUNCTION` — nenhum corpo de função foi recriado.

## O que ficou aberto, e por quê

### 1. `spatial_ref_sys` sem RLS — não corrigível por migration

É o erro que sobrou do e-mail. A tabela é do PostGIS, pertence a
`supabase_admin`, e **`anon` tem `arwdDxtm` (todos os privilégios) por grant
feito por `supabase_admin`**. Confirmado em teste com rollback: `anon` consegue
`DELETE FROM spatial_ref_sys WHERE srid = 4326` — o SRID que o sistema inteiro
usa. Apagá-lo quebraria todo `ST_Transform` e todo cast para `geography`.

Não dá para corrigir daqui: `postgres` não é superusuário nem membro de
`supabase_admin`, então o `REVOKE` roda sem erro **e sem efeito** (só o
concedente pode revogar), e `ENABLE ROW LEVEL SECURITY` exige ser dono. Testado,
não é suposição.

Caminhos possíveis, os dois fora do alcance de uma migration:
- abrir chamado no suporte do Supabase pedindo o `REVOKE` das permissões de
  escrita de `anon`/`authenticated` sobre `spatial_ref_sys`;
- reinstalar o PostGIS num schema dedicado — inviável na prática, com dezenas de
  colunas `geometry` em produção dependendo dele.

Risco real: negação de serviço na camada geográfica por quem tiver a anon key.
Não há vazamento de dado (a tabela só contém definições de sistemas de
coordenadas, informação pública do EPSG).

### 2. Bucket `pesquisa-documentos` legível por `anon`

O bucket é privado (`public = false`), mas há duas policies em `storage.objects`
— `pesq_docs_read_anon` e `pesq_docs_upload_anon` — que dão a `anon` SELECT e
INSERT sobre o **bucket inteiro**, sem filtro. Na prática qualquer pessoa com a
anon key pode listar e baixar todos os documentos de projeto de pesquisa
(que incluem CPF e RG, conforme o ROPA). Contradiz a regra de bucket privado do
`CLAUDE.md`.

Não corrigido aqui porque não é um `REVOKE`: `pesquisa-status.html` é uma página
sem login que assina URL dos documentos da pesquisa a partir de um token, e a
assinatura exige SELECT. Fechar direito significa mover a assinatura para uma
RPC `SECURITY DEFINER` que valide o token no servidor e devolva a URL assinada —
mudança no portal público do pesquisador, com decisão de produto envolvida.
Deve ser a próxima entrega de segurança.

### 3. Proteção contra senha vazada (`auth_leaked_password_protection`)

Configuração do Auth (checagem contra o HaveIBeenPwned), não de banco — não sai
por migration. Ligar em **Authentication → Policies → Password protection** no
painel do Supabase.

### 4. `extension_in_public` (postgis, btree_gist, pg_net)

Mover o PostGIS de schema quebraria todas as colunas `geometry` do sistema. O
ganho é organizacional, o risco é total. Decisão consciente de não mexer.

### 5. `authenticated_security_definer_function_executable` (131)

Informativo. Uma função `SECURITY DEFINER` chamável por quem está logado é o
modo normal de operação — o que importa é a guarda interna de cada uma. Reduzir
esse número exigiria auditar função por função; fica registrado como possível
trabalho futuro, sem urgência.

### 6. `rls_enabled_no_policy` (4) — INFO

`frota_abast_contador`, `frota_os_contador`, `ocorrencia_seq` e
`frota_push_config` têm RLS ligada e nenhuma policy, ou seja, negam tudo para
`anon`/`authenticated`. É o comportamento desejado: são contadores e
configuração tocados só por trigger e por `service_role`.
