-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Registros de Campo — parte 1: enums
-- Deve ser commitado antes de 046 usar os valores.
-- ═══════════════════════════════════════════════════════════

-- ── Registro de campo ────────────────────────────────────────
CREATE TYPE natureza_registro AS ENUM (
  'prevencao', 'combate', 'monitoramento'
);

CREATE TYPE atividade_campo AS ENUM (
  'fogo', 'educacao_ambiental', 'limpeza', 'reconhecimento',
  'plantio', 'primeiros_socorros', 'queima_controlada', 'outro'
);

CREATE TYPE status_validacao AS ENUM (
  'aguardando', 'validado', 'requer_correcao', 'rejeitado'
);

CREATE TYPE veredito_campo AS ENUM (
  'confirmado', 'falso_positivo', 'nao_localizado'
);

-- ── Fauna ────────────────────────────────────────────────────
CREATE TYPE classe_fauna AS ENUM (
  'mamifero', 'ave', 'reptil', 'anfibio', 'peixe', 'invertebrado', 'nao_sei'
);

CREATE TYPE condicao_fauna AS ENUM (
  'integro', 'ferido', 'debilitado', 'queimado', 'obito'
);

CREATE TYPE tipo_evento_fauna AS ENUM (
  'resgate', 'avistamento', 'atropelamento', 'apreensao', 'encontrado_morto'
);

CREATE TYPE causa_fauna AS ENUM (
  'incendio', 'atropelamento', 'fio_eletrico', 'caca', 'outro', 'indeterminada'
);

CREATE TYPE destinacao_fauna AS ENUM (
  'solto_no_local', 'encaminhado_cetas', 'obito', 'em_tratamento', 'outro'
);

CREATE TYPE faixa_etaria_fauna AS ENUM (
  'filhote', 'jovem', 'adulto', 'indeterminada'
);

CREATE TYPE porte_fauna AS ENUM ('pequeno', 'medio', 'grande');
