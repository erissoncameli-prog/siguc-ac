# Spec — Configurações Institucionais (SIGUC-AC)
**Data:** 2026-06-06  
**Status:** Aprovado  
**Pré-requisito de:** Spec Relatório de Impressão CAR

---

## Objetivo

Permitir que o `super_admin` configure os dados institucionais (nomes, logos, endereço, hierarquia) usados no cabeçalho de todos os relatórios gerados pelo SIGUC-AC, sem necessidade de alterar código.

---

## Banco de Dados

### Migration `020_config_sistema.sql`

```sql
CREATE TABLE config_sistema (
  id            INT PRIMARY KEY DEFAULT 1,  -- sempre 1 linha
  dados         JSONB NOT NULL DEFAULT '{}',
  atualizado_em TIMESTAMPTZ DEFAULT NOW(),
  atualizado_por UUID REFERENCES usuarios(id)
);

-- Garante linha única
ALTER TABLE config_sistema ADD CONSTRAINT config_unica CHECK (id = 1);

-- RLS: leitura pública (cabeçalho é público), escrita só super_admin
ALTER TABLE config_sistema ENABLE ROW LEVEL SECURITY;
CREATE POLICY "config leitura publica"  ON config_sistema FOR SELECT USING (true);
CREATE POLICY "config escrita admin"    ON config_sistema FOR ALL USING (
  EXISTS (SELECT 1 FROM usuarios WHERE id = auth.uid() AND perfil = 'super_admin')
);
```

### Estrutura do JSONB `dados`

```json
{
  "governo": {
    "nome": "Governo do Estado do Acre",
    "gestao": "2023–2026"
  },
  "secretaria": {
    "nome": "Secretaria de Estado do Meio Ambiente do Acre",
    "sigla": "SEMA-AC",
    "endereco": "Rua Benjamin Constant, 906 — Centro, Rio Branco/AC",
    "cep": "69900-160",
    "telefone": "(68) 3212-3100",
    "email": "sema@sema.ac.gov.br",
    "site": "https://sema.ac.gov.br"
  },
  "diretoria": {
    "nome": "Diretoria de Meio Ambiente",
    "sigla": "DIMA"
  },
  "departamento": {
    "nome": "Departamento de Unidades de Conservação",
    "sigla": "DEUC"
  },
  "logos": {
    "governo_url": null,
    "secretaria_url": null
  },
  "hierarquia_cabecalho": ["governo", "secretaria", "diretoria", "departamento"],
  "rodape_texto": "Documento gerado automaticamente pelo SIGUC-AC. Não substitui vistoria de campo.",
  "aviso_legal": "As informações aqui contidas são de caráter técnico e informativo.",
  "protocolo_formato": "SIGUC-{ANO}-{SEQ}"
}
```

---

## Página: `pages/config-sistema.html`

### Acesso
- Sidebar: item **⚙️ Configurações** (visível só para `super_admin`)
- Rota: `/pages/config-sistema.html`
- Guard: redireciona para `index.html` se perfil ≠ `super_admin`

### Layout
Segue `gerarLayout()` padrão. Conteúdo em card com **5 abas**:

#### Aba 🏛 Identidade
Campos de texto organizados em grid 2 colunas:
- **Governo:** nome, gestão/mandato
- **Secretaria:** nome completo, sigla, endereço, CEP, telefone, e-mail, site
- **Diretoria (DIMA):** nome, sigla
- **Departamento (DEUC):** nome, sigla

#### Aba 🖼 Logos
- Upload de dois arquivos: **Logo do Governo** + **Logo da Secretaria**
- Aceita: PNG, SVG, JPG — máximo 2 MB cada
- Upload → convertido para base64 → salvo no JSONB `logos`
- Preview imediato após upload
- Botão "Remover" para apagar cada logo

#### Aba 🏗 Hierarquia
- Lista drag-and-drop dos 4 níveis: Governo / Secretaria / Diretoria / Departamento
- Ordem define a sequência de aparição no cabeçalho dos relatórios
- Cada item pode ser **ativo/inativo** (toggle) — inativo = não aparece

#### Aba 📄 Cabeçalho
- Preview ao vivo e em tempo real do cabeçalho
- Mostra exatamente como ficará no relatório impresso (logos + textos + rodapé)
- Botão "Imprimir preview" para teste

#### Aba 📋 Relatórios
- **Texto de rodapé padrão** (textarea)
- **Aviso legal** (textarea)
- **Formato do número de protocolo** (ex: `SIGUC-{ANO}-{SEQ}`)
- **Sequencial atual** (número, resetável)

### Preview ao vivo
- Componente `_renderPreviewCabecalho()` usado em todas as abas
- Atualiza em tempo real via `input` events nos campos
- Mesma função usada nos relatórios de impressão

---

## Helper Global: `js/config-sistema.js`

```js
// Cache da config — carregado uma vez por sessão
let _configSistema = null;

async function getConfigSistema() {
  if (_configSistema) return _configSistema;
  const { data } = await db.from('config_sistema').select('dados').eq('id', 1).single();
  _configSistema = data?.dados || {};
  return _configSistema;
}

function invalidarConfigCache() { _configSistema = null; }

// Retorna objeto cabeçalho pronto para uso nos relatórios
async function getCabecalhoRelatorio() {
  const cfg = await getConfigSistema();
  return {
    governo:     cfg.governo?.nome || 'Governo do Estado do Acre',
    gestao:      cfg.governo?.gestao || '',
    secretaria:  cfg.secretaria?.nome || 'SEMA-AC',
    siglaSecr:   cfg.secretaria?.sigla || 'SEMA-AC',
    diretoria:   cfg.diretoria?.nome || '',
    siglaDiret:  cfg.diretoria?.sigla || '',
    departamento:cfg.departamento?.nome || '',
    siglaDep:    cfg.departamento?.sigla || '',
    endereco:    cfg.secretaria?.endereco || '',
    cep:         cfg.secretaria?.cep || '',
    telefone:    cfg.secretaria?.telefone || '',
    email:       cfg.secretaria?.email || '',
    site:        cfg.secretaria?.site || '',
    logoGoverno: cfg.logos?.governo_url || null,
    logoSecr:    cfg.logos?.secretaria_url || null,
    rodapeTxt:   cfg.rodape_texto || '',
    avisoLegal:  cfg.aviso_legal || '',
  };
}
```

`js/config-sistema.js` é carregado via `<script>` em todas as páginas que precisam do cabeçalho (incluído em `layout.js` ou via tag direta nos relatórios).

---

## Fluxo de Dados

```
super_admin edita campos
      ↓
JS coleta formData → monta objeto JSONB
      ↓
db.from('config_sistema').upsert({ id:1, dados:..., atualizado_por:uid })
      ↓
toast "Configurações salvas"
invalidarConfigCache()
      ↓
Preview ao vivo atualiza imediatamente
```

---

## Tratamento de Erros

| Situação | Comportamento |
|---|---|
| Upload de logo > 2 MB | Toast warning, arquivo rejeitado |
| Formato inválido (não PNG/SVG/JPG) | Toast warning |
| Falha no save (RLS / rede) | Toast error com mensagem detalhada |
| Config não encontrada no banco | Usa valores padrão hardcoded (SEMA-AC) |
| super_admin não logado | Redirect para index.html |

---

## Arquivos a criar/modificar

| Arquivo | Ação |
|---|---|
| `supabase/migrations/020_config_sistema.sql` | Criar |
| `pages/config-sistema.html` | Criar |
| `js/config-sistema.js` | Criar |
| `css/sidebar.css` ou `layout.js` | Adicionar item "Configurações" na sidebar (só super_admin) |

---

## Fora de Escopo

- Múltiplos temas visuais
- Histórico de versões da config
- Aprovação em 4 olhos
- Configuração por UC individual
