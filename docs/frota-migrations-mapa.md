# Migrations do módulo Frota — mapa arquivo ⇄ versão aplicada

Levantado em 24/07/2026 comparando `supabase/migrations/*.sql` com
`supabase_migrations.schema_migrations` do projeto de produção
(`atqtybcsvepdabsvgaly`). Documento de referência: o histórico até aqui está
congelado, o que muda é a convenção daqui pra frente (§4).

---

## 1. Por que o número do arquivo não bate com o que está aplicado

Três desvios se acumularam. Nenhum é grave isoladamente; juntos, tornaram a ordem
de aplicação indedutível pelo nome do arquivo.

**a) Correção de follow-up mesclada no arquivo original.** O padrão dominante: uma
migration é aplicada, aparece uma correção logo em seguida, e a correção é aplicada
como uma **nova versão no banco** mas **editada dentro do arquivo já existente** no
repositório. Um arquivo passa a corresponder a N migrations aplicadas:

| Arquivo no repo | Versões aplicadas no banco |
|---|---|
| `162_frota_notificacoes.sql` | `frota_notificacoes`, `frota_notificacoes_para` |
| `168_frota_os_codigo.sql` | `frota_os_codigo`, `frota_os_detalhe_refresh_codigo_v2` |
| `184_frota_lista_passageiros.sql` | `frota_lista_passageiros_fix`, `frota_lista_passageiros_coluna` |
| `185_frota_saldo_contrato.sql` | `185_frota_saldo_contrato_view_fix`, `185_frota_saldo_contrato_core`, `187_frota_saldo_contrato_backfill`, `188_frota_config_saldo` |

Isso **reproduz o estado final correto** (o arquivo mesclado é a verdade), mas faz o
número de arquivos divergir do número de migrations, e o nome aplicado deixar de
apontar para um arquivo.

**b) Número reaproveitado.** No repositório: `183_frota_motoristas_foto.sql` e
`183_frota_veiculos_motorista.sql`; `184_frota_lista_passageiros.sql` e
`184_frota_veiculo_autorizados.sql`. No banco, `187` e `188` aparecem duas vezes com
conteúdos diferentes — a dupla saldo de contrato (21/07 01h) e a dupla escala
(21/07 18h). Os arquivos `187`/`188` do repositório são os da escala.

**c) Nome aplicado sem o prefixo numérico.** As migrations de 18/07 e as de 23–24/07
foram aplicadas só com o nome (`frota_base`, `frota_trava_medidas`,
`frota_comunicado_defeito`…), enquanto as de 19–21/07 levaram o número
(`174_frota_fontes_contratos`…). Duas convenções no mesmo histórico.

---

## 2. A divergência real (corrigida)

Os desvios do §1 são de forma. Havia **uma** de conteúdo:

`frota_alocacao_proporcional`, versão `20260723034939`, aplicada em produção em
23/07/2026 e **nunca commitada**. Não era um follow-up mesclado em outro arquivo: ela
substituiu o corpo de `frota_sugerir_alocacao`, trocando a distribuição gulosa de
passageiros (lotar o 1º veículo, sobrar 1 no 2º) pela proporcional à capacidade
(*largest remainder method*). O repositório continuava descrevendo a versão gulosa —
ou seja, **recriar o banco a partir do repositório produziria um comportamento
diferente do que está no ar**.

Recuperada de `schema_migrations.statements` e commitada como
`192b_frota_alocacao_proporcional.sql`. O sufixo `b` preserva a posição real na ordem
de aplicação (entre a 192 e a 193) sem renumerar arquivos já aplicados.

**Este arquivo não deve ser reaplicado** — seu conteúdo já está em produção desde
23/07 sob a versão `20260723034939`. Reaplicar só duplicaria a linha no histórico.
É a única exceção conhecida à regra "toda migration criada deve ser aplicada" do
`CLAUDE.md`, e existe justamente porque a regra foi quebrada na direção oposta.

Dois outros nomes aplicados sem arquivo homônimo — `frota_notificacoes_para` e
`frota_os_detalhe_refresh_codigo_v2` — foram conferidos objeto a objeto e **não** são
divergência: seu conteúdo está integralmente nos arquivos `162` e `168` (caso "a"
acima). A definição de `frota_os_sync_veiculo` no repositório, por exemplo, é
byte a byte a que está no banco.

---

## 3. Estado atual

47 arquivos `*frota*.sql` no repositório, 53 migrations `%frota%` aplicadas — a
diferença é explicada pelos casos "a" da tabela do §1, mais as duas migrations de
endurecimento aplicadas hoje (`196`, `197`).

Verificação de que o repositório descreve o banco: feita objeto a objeto para todos
os pontos onde os nomes divergiam. Nenhuma pendência conhecida além da já corrigida.

---

## 4. Convenção daqui pra frente

1. **Uma migration nova por mudança.** Correção de migration já aplicada nunca é
   editada dentro do arquivo original — vira arquivo novo com o próximo número. O
   arquivo aplicado é histórico, não rascunho. (Foi assim que as migrations 178 e
   181 nasceram, e é o padrão certo.)
2. **O número do arquivo é sequencial e nunca se repete.** Antes de criar, conferir
   o maior número existente com `ls supabase/migrations/ | sort -V | tail -1`.
3. **O nome aplicado é igual ao nome do arquivo, com o número.** Ao chamar
   `apply_migration`, usar `196_frota_hardening_rpc`, não `frota_hardening_rpc`. É o
   que torna o mapa arquivo ⇄ banco trivial.
4. **A versão canônica é o timestamp do Supabase.** O número do arquivo serve para
   leitura e ordenação humana; em caso de conflito entre os dois, o timestamp em
   `schema_migrations` é quem manda — foi o que permitiu reconstruir este mapa.
5. **Toda migration criada é aplicada na mesma entrega** (regra já existente no
   `CLAUDE.md`), e toda migration aplicada é commitada na mesma entrega — a segunda
   metade é o que faltava.

Conferência rápida a qualquer momento, para pegar cedo o que aconteceu aqui:

```sql
select version, name from supabase_migrations.schema_migrations
where name ilike '%frota%' order by version;
```
