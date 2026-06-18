-- 064_preferencias_mapa.sql
-- Preferências de visualização do mapa por usuário (persiste entre dispositivos)

create table if not exists preferencias_mapa (
  usuario_id   uuid primary key references auth.users(id) on delete cascade,
  dados        jsonb not null default '{}',
  atualizado_em timestamptz not null default now()
);

alter table preferencias_mapa enable row level security;

-- Cada usuário só acessa a própria linha
create policy "pref_mapa_select" on preferencias_mapa
  for select using (auth.uid() = usuario_id);

create policy "pref_mapa_insert" on preferencias_mapa
  for insert with check (auth.uid() = usuario_id);

create policy "pref_mapa_update" on preferencias_mapa
  for update using (auth.uid() = usuario_id);
