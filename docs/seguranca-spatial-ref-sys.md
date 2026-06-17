# Advisor de segurança: `spatial_ref_sys` (PostGIS)

## Resumo
O Security Advisor do Supabase (e o e-mail automático de segurança)
sinaliza `rls_disabled_in_public` para a tabela **`public.spatial_ref_sys`**.

- É uma tabela criada pela extensão **PostGIS**: catálogo de sistemas de
  referência espacial (códigos EPSG / projeções), ~8.500 linhas de dados
  de referência **públicos**.
- **Não contém nenhum dado do projeto** (usuários, UCs, ocorrências,
  brigadas, pesquisas etc.).
- O advisor confirma que essa é a **única** tabela sem RLS — todas as
  tabelas reais do SIGUC já têm RLS habilitado.

## Por que não corrigimos por migration/SQL
A tabela pertence ao papel `supabase_admin`. Nosso acesso (papel
`postgres`) não é dono nem membro, então:

- `ALTER TABLE public.spatial_ref_sys ENABLE ROW LEVEL SECURITY;`
  → `ERROR: 42501: must be owner of table spatial_ref_sys`
- `REVOKE ... ON public.spatial_ref_sys FROM anon, authenticated;`
  → no-op (as permissões foram concedidas pelo `supabase_admin`).

Por isso **não** criamos migration para isso (falharia no `apply` e
sujaria o histórico).

## Ação recomendada (imediata)
Marcar o aviso como reconhecido no painel:
**Supabase → projeto SIGUC-AC → Advisors → Security Advisor →
`spatial_ref_sys` → Dismiss / Acknowledge.**

## Risco residual e ticket de suporte (opcional)
Os papéis `anon` e `authenticated` têm INSERT/UPDATE/DELETE nessa tabela
(padrão do PostGIS). Risco baixo (não vaza dado; no máximo alguém com a
anon key poderia apagar linhas e quebrar conversões de coordenadas do
mapa — recuperável). Para travar isso é preciso executar como owner,
o que só o Supabase Support faz.

### Texto pronto para o ticket (Supabase Support)

> **Assunto:** Restringir permissões do `anon`/`authenticated` em
> `public.spatial_ref_sys` (PostGIS)
>
> **Projeto:** SIGUC-AC — ref `atqtybcsvepdabsvgaly`
>
> Hi team,
>
> The Security Advisor flags `rls_disabled_in_public` on
> `public.spatial_ref_sys`. I understand this is the PostGIS reference
> table and RLS can't be enabled on it from the `postgres` role
> (`must be owner of table`). However, the `anon` and `authenticated`
> roles currently hold INSERT/UPDATE/DELETE on it (default PostGIS
> grants), which exposes the table to writes through the public API.
>
> Could you please run, as the table owner (`supabase_admin`):
>
> ```sql
> REVOKE INSERT, UPDATE, DELETE, TRUNCATE
>   ON public.spatial_ref_sys FROM anon, authenticated;
> ```
>
> (SELECT can stay so PostGIS coordinate transforms keep working.)
> Alternatively, enable RLS on the table on your side. Thanks!

> **Tradução (PT):** O Security Advisor sinaliza `rls_disabled_in_public`
> em `public.spatial_ref_sys`. Sabemos que é a tabela do PostGIS e que
> não dá para habilitar RLS pelo papel `postgres` ("must be owner of
> table"). Porém os papéis `anon` e `authenticated` têm
> INSERT/UPDATE/DELETE nela (concessões padrão do PostGIS), o que expõe
> a tabela a escrita pela API pública. Poderiam executar, como dono da
> tabela (`supabase_admin`), o `REVOKE` acima (mantendo o SELECT para as
> conversões de coordenadas continuarem funcionando)? Ou, alternativa,
> habilitar RLS na tabela do lado de vocês. Obrigado!

## Verificação (estado em 2026-06-17)
- `spatial_ref_sys`: RLS desabilitado, owner `supabase_admin`, 8.500 linhas.
- `anon`: SELECT/INSERT/UPDATE/DELETE = true (todas).
- Demais tabelas do projeto: RLS habilitado (advisor sem outras
  ocorrências de `rls_disabled_in_public`).
