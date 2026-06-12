-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Catálogo de módulos + permissões (RBAC + overrides)
-- Fase 1. Data-driven: cada aba = 1 linha em `modulos`.
-- Resolução de nível: override do usuário > padrão do perfil p/ módulo
--   > padrão do perfil p/ grupo > sem_acesso. (super_admin bypassa — ver 057)
-- ═══════════════════════════════════════════════════════════

-- ── Enum de nível de acesso ─────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'nivel_acesso') THEN
    CREATE TYPE nivel_acesso AS ENUM ('sem_acesso', 'visualizar', 'editar');
  END IF;
END $$;

-- ── Catálogo de módulos (1 linha por aba) ───────────────────
CREATE TABLE IF NOT EXISTS modulos (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chave              text NOT NULL UNIQUE,        -- 'monitoramento'
  nome               text NOT NULL,               -- rótulo do menu
  grupo              text NOT NULL,               -- 'Principal'|'Gestão'|'Brigadas'|'Administração'
  icone              text,                        -- chave do iconePills (layout.js)
  rota               text,                        -- '../pages/monitoramento.html'
  ordem              int NOT NULL DEFAULT 0,
  respeita_escopo_uc boolean NOT NULL DEFAULT false,
  ativo              boolean NOT NULL DEFAULT true,
  criado_em          timestamptz DEFAULT now(),
  atualizado_em      timestamptz DEFAULT now()
);

-- ── Padrão por GRUPO (base da herança) ──────────────────────
CREATE TABLE IF NOT EXISTS grupo_permissoes_padrao (
  perfil  perfil_usuario NOT NULL,
  grupo   text           NOT NULL,
  nivel   nivel_acesso   NOT NULL DEFAULT 'sem_acesso',
  PRIMARY KEY (perfil, grupo)
);

-- ── Padrão por MÓDULO (exceções ao grupo) ───────────────────
CREATE TABLE IF NOT EXISTS perfil_permissoes_padrao (
  perfil    perfil_usuario NOT NULL,
  modulo_id uuid           NOT NULL REFERENCES modulos(id) ON DELETE CASCADE,
  nivel     nivel_acesso   NOT NULL DEFAULT 'sem_acesso',
  PRIMARY KEY (perfil, modulo_id)
);

-- ── Override por USUÁRIO (concede/retira individual) ─────────
CREATE TABLE IF NOT EXISTS usuario_permissoes (
  usuario_id    uuid          NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  modulo_id     uuid          NOT NULL REFERENCES modulos(id) ON DELETE CASCADE,
  nivel         nivel_acesso  NOT NULL,
  concedido_por uuid          REFERENCES usuarios(id),
  motivo        text,
  criado_em     timestamptz DEFAULT now(),
  atualizado_em timestamptz DEFAULT now(),
  PRIMARY KEY (usuario_id, modulo_id)
);

-- ── UCs extras (escopo individual concedido pelo admin) ─────
CREATE TABLE IF NOT EXISTS usuario_ucs_extras (
  usuario_id    uuid NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  uc_id         uuid NOT NULL REFERENCES unidades_conservacao(id) ON DELETE CASCADE,
  concedido_por uuid REFERENCES usuarios(id),
  motivo        text,
  criado_em     timestamptz DEFAULT now(),
  PRIMARY KEY (usuario_id, uc_id)
);

CREATE INDEX IF NOT EXISTS idx_perfil_perm_modulo ON perfil_permissoes_padrao (modulo_id);
CREATE INDEX IF NOT EXISTS idx_usuario_perm_user  ON usuario_permissoes (usuario_id);
CREATE INDEX IF NOT EXISTS idx_ucs_extras_user    ON usuario_ucs_extras (usuario_id);

-- ── Triggers de atualizado_em ───────────────────────────────
DROP TRIGGER IF EXISTS trg_modulos_updated ON modulos;
CREATE TRIGGER trg_modulos_updated BEFORE UPDATE ON modulos
  FOR EACH ROW EXECUTE FUNCTION touch_atualizado_em();

DROP TRIGGER IF EXISTS trg_usuario_perm_updated ON usuario_permissoes;
CREATE TRIGGER trg_usuario_perm_updated BEFORE UPDATE ON usuario_permissoes
  FOR EACH ROW EXECUTE FUNCTION touch_atualizado_em();

-- ════════════════════════════════════════════════════════════
-- SEED — Catálogo de módulos
-- ════════════════════════════════════════════════════════════
INSERT INTO modulos (chave, nome, grupo, icone, rota, ordem, respeita_escopo_uc) VALUES
  ('dashboard',            'Visão Geral',              'Principal',      'dashboard',                '../pages/dashboard.html',            10, true),
  ('dashboard-executivo',  'Dashboard Executivo',      'Principal',      'dashboard-executivo',      '../pages/dashboard-executivo.html',  20, false),
  ('mapa',                 'Mapa das UCs',             'Principal',      'mapa',                     '../pages/mapa.html',                 30, true),
  ('unidades',             'Unidades de Conservação',  'Principal',      'unidades',                 '../pages/unidades.html',             40, true),
  ('monitoramento',        'Monitoramento',            'Gestão',         'monitoramento',            '../pages/monitoramento.html',        10, true),
  ('netflora',             'Netflora — Inventário',    'Gestão',         'netflora',                 '../pages/netflora.html',             20, true),
  ('alertas-ambientais',   'Alertas Ambientais',       'Gestão',         'alertas-ambientais',       '../pages/alertas-ambientais.html',   30, true),
  ('painel-gestor',        'Painel do Gestor',         'Gestão',         'painel-gestor',            '../pages/painel-gestor.html',        40, true),
  ('pesquisas',            'Pesquisas',                'Gestão',         'pesquisas',                '../pages/pesquisas.html',            50, true),
  ('ocorrencias',          'Ocorrências',              'Gestão',         'ocorrencias',              '../pages/ocorrencias.html',          60, true),
  ('relatorios',           'Relatórios',               'Gestão',         'relatorios',               '../pages/relatorios.html',           70, true),
  ('equipe',               'Equipe',                   'Gestão',         'equipe',                   '../pages/equipe.html',               80, true),
  ('documentos',           'Documentos',               'Gestão',         'documentos',               '../pages/documentos.html',           90, true),
  ('brigadas',             'Brigadas',                 'Brigadas',       'brigadas',                 '../pages/brigadas.html',             10, true),
  ('validacao-campo',      'Validação de Campo',       'Brigadas',       'validacao-campo',          '../pages/validacao-campo.html',      20, true),
  ('relatorios-brigadas',  'Relatórios de Brigadas',   'Brigadas',       'relatorios-brigadas',      '../pages/relatorios-brigadas.html',  30, true),
  ('admin-brigadas',       'Administrar Brigadas',     'Brigadas',       'admin-brigadas',           '../pages/admin-brigadas.html',       40, true),
  ('usuarios',             'Usuários',                 'Administração',  'usuarios',                 '../pages/usuarios.html',             10, false),
  ('estrutura-organizacional','Estrutura Org.',        'Administração',  'estrutura-organizacional', '../pages/estrutura-organizacional.html', 20, false),
  ('configuracoes',        'Configurações',            'Administração',  'configuracoes',            '../pages/configuracoes.html',        30, false),
  ('historico-acessos',    'Histórico de Acessos',     'Administração',  'usuarios',                 '../pages/historico-acessos.html',    40, false)
ON CONFLICT (chave) DO NOTHING;

-- ════════════════════════════════════════════════════════════
-- SEED — Padrões por GRUPO (base; exceções por módulo abaixo)
-- ════════════════════════════════════════════════════════════
INSERT INTO grupo_permissoes_padrao (perfil, grupo, nivel) VALUES
  -- super_admin (bypass na função, mas explícito por clareza)
  ('super_admin','Principal','editar'),('super_admin','Gestão','editar'),('super_admin','Brigadas','editar'),('super_admin','Administração','editar'),
  -- secretario: só leitura executiva, sem administração
  ('secretario','Principal','visualizar'),('secretario','Gestão','visualizar'),('secretario','Brigadas','visualizar'),('secretario','Administração','sem_acesso'),
  -- diretor: edita gestão, vê o resto
  ('diretor','Principal','visualizar'),('diretor','Gestão','editar'),('diretor','Brigadas','visualizar'),('diretor','Administração','visualizar'),
  -- chefe_departamento: opera gestão e brigadas
  ('chefe_departamento','Principal','visualizar'),('chefe_departamento','Gestão','editar'),('chefe_departamento','Brigadas','editar'),('chefe_departamento','Administração','sem_acesso'),
  -- gestor_uc: opera gestão/brigadas (escopo na UC via RLS)
  ('gestor_uc','Principal','visualizar'),('gestor_uc','Gestão','editar'),('gestor_uc','Brigadas','editar'),('gestor_uc','Administração','sem_acesso'),
  -- tecnico: lança dados de campo
  ('tecnico','Principal','visualizar'),('tecnico','Gestão','editar'),('tecnico','Brigadas','visualizar'),('tecnico','Administração','sem_acesso'),
  -- assistente_admin: digitação operacional
  ('assistente_admin','Principal','visualizar'),('assistente_admin','Gestão','editar'),('assistente_admin','Brigadas','editar'),('assistente_admin','Administração','sem_acesso'),
  -- financeiro: leitura geral + pesquisa
  ('financeiro','Principal','visualizar'),('financeiro','Gestão','visualizar'),('financeiro','Brigadas','sem_acesso'),('financeiro','Administração','sem_acesso'),
  -- visualizador: só leitura
  ('visualizador','Principal','visualizar'),('visualizador','Gestão','visualizar'),('visualizador','Brigadas','sem_acesso'),('visualizador','Administração','sem_acesso'),
  -- gestor (legado): equivalente a chefe_departamento
  ('gestor','Principal','visualizar'),('gestor','Gestão','editar'),('gestor','Brigadas','editar'),('gestor','Administração','sem_acesso'),
  -- perfis especializados: base sem_acesso (exceções por módulo abaixo)
  ('pesquisador_externo','Principal','sem_acesso'),('pesquisador_externo','Gestão','sem_acesso'),('pesquisador_externo','Brigadas','sem_acesso'),('pesquisador_externo','Administração','sem_acesso'),
  ('brigadista','Principal','sem_acesso'),('brigadista','Gestão','sem_acesso'),('brigadista','Brigadas','sem_acesso'),('brigadista','Administração','sem_acesso'),
  ('validador_brigada','Principal','sem_acesso'),('validador_brigada','Gestão','sem_acesso'),('validador_brigada','Brigadas','visualizar'),('validador_brigada','Administração','sem_acesso'),
  ('validador_fauna','Principal','sem_acesso'),('validador_fauna','Gestão','sem_acesso'),('validador_fauna','Brigadas','sem_acesso'),('validador_fauna','Administração','sem_acesso')
ON CONFLICT (perfil, grupo) DO NOTHING;

-- ════════════════════════════════════════════════════════════
-- SEED — Exceções por MÓDULO (apenas onde difere do grupo)
-- ════════════════════════════════════════════════════════════
-- Helper inline: insere (perfil, modulo por chave, nivel)
INSERT INTO perfil_permissoes_padrao (perfil, modulo_id, nivel)
SELECT v.perfil::perfil_usuario, m.id, v.nivel::nivel_acesso
FROM (VALUES
  -- secretario: vê Estrutura Org; não vê config/usuarios/historico
  ('secretario','estrutura-organizacional','visualizar'),
  -- diretor: gestão é editar, mas alguns módulos só leitura
  ('diretor','monitoramento','visualizar'),
  ('diretor','netflora','visualizar'),
  ('diretor','alertas-ambientais','visualizar'),
  ('diretor','relatorios','visualizar'),
  ('diretor','estrutura-organizacional','editar'),
  ('diretor','configuracoes','sem_acesso'),
  -- chefe_departamento: vê usuarios e estrutura
  ('chefe_departamento','relatorios','visualizar'),
  ('chefe_departamento','usuarios','visualizar'),
  ('chefe_departamento','estrutura-organizacional','visualizar'),
  -- gestor_uc
  ('gestor_uc','pesquisas','visualizar'),
  ('gestor_uc','equipe','visualizar'),
  ('gestor_uc','relatorios','visualizar'),
  ('gestor_uc','relatorios-brigadas','visualizar'),
  -- tecnico
  ('tecnico','dashboard-executivo','sem_acesso'),
  ('tecnico','unidades','visualizar'),
  ('tecnico','alertas-ambientais','visualizar'),
  ('tecnico','painel-gestor','sem_acesso'),
  ('tecnico','pesquisas','visualizar'),
  ('tecnico','relatorios','visualizar'),
  ('tecnico','equipe','sem_acesso'),
  ('tecnico','brigadas','visualizar'),
  -- assistente_admin
  ('assistente_admin','dashboard-executivo','sem_acesso'),
  ('assistente_admin','unidades','visualizar'),
  ('assistente_admin','alertas-ambientais','visualizar'),
  ('assistente_admin','painel-gestor','sem_acesso'),
  ('assistente_admin','relatorios','visualizar'),
  ('assistente_admin','equipe','editar'),
  ('assistente_admin','validacao-campo','sem_acesso'),
  ('assistente_admin','relatorios-brigadas','visualizar'),
  ('assistente_admin','admin-brigadas','sem_acesso'),
  -- financeiro: só pesquisa edita
  ('financeiro','netflora','sem_acesso'),
  ('financeiro','alertas-ambientais','sem_acesso'),
  ('financeiro','painel-gestor','sem_acesso'),
  ('financeiro','ocorrencias','sem_acesso'),
  ('financeiro','pesquisas','editar'),
  ('financeiro','equipe','sem_acesso'),
  ('financeiro','dashboard-executivo','visualizar'),
  -- visualizador
  ('visualizador','dashboard-executivo','sem_acesso'),
  ('visualizador','painel-gestor','sem_acesso'),
  ('visualizador','pesquisas','sem_acesso'),
  -- gestor (legado) = chefe
  ('gestor','relatorios','visualizar'),
  ('gestor','usuarios','visualizar'),
  ('gestor','estrutura-organizacional','visualizar'),
  -- validador_brigada: valida campo, vê relatórios de brigada
  ('validador_brigada','validacao-campo','editar'),
  ('validador_brigada','relatorios-brigadas','visualizar'),
  -- validador_fauna: edita monitoramento (RLS restringe aos campos de validação)
  ('validador_fauna','monitoramento','editar')
) AS v(perfil, chave, nivel)
JOIN modulos m ON m.chave = v.chave
ON CONFLICT (perfil, modulo_id) DO NOTHING;
