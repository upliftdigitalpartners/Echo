-- Echo schema. Run this once in the Supabase SQL editor.
-- Idempotent: safe to re-run.

create extension if not exists postgis;

-- ===== pins =====
create table if not exists public.pins (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  creator_id    uuid not null references auth.users(id) on delete cascade,
  lat           double precision not null,
  lng           double precision not null,
  geog          geography(point, 4326) not null,
  audio_path    text not null,
  duration_ms   integer not null check (duration_ms > 0 and duration_ms <= 65000),
  title         text check (char_length(title) <= 40),
  reports_count integer not null default 0,
  hidden        boolean not null default false,
  constraint pins_lat_range check (lat between -90 and 90),
  constraint pins_lng_range check (lng between -180 and 180)
);

create index if not exists pins_geog_gix on public.pins using gist (geog);
create index if not exists pins_created_at_idx on public.pins (created_at desc);
create index if not exists pins_creator_idx on public.pins (creator_id);

-- ===== reports =====
create table if not exists public.reports (
  id          uuid primary key default gen_random_uuid(),
  pin_id      uuid not null references public.pins(id) on delete cascade,
  reporter_id uuid not null references auth.users(id) on delete cascade,
  created_at  timestamptz not null default now(),
  unique (pin_id, reporter_id)
);

-- ===== auto-hide trigger =====
-- Hide a pin once it accumulates 3+ unique reports.
create or replace function public.bump_report_count()
returns trigger language plpgsql security definer as $$
begin
  update public.pins
     set reports_count = reports_count + 1,
         hidden = (reports_count + 1) >= 3
   where id = new.pin_id;
  return new;
end $$;

drop trigger if exists reports_bump on public.reports;
create trigger reports_bump
  after insert on public.reports
  for each row execute function public.bump_report_count();

-- ===== RPC: nearby pins (bounding box) =====
create or replace function public.pins_in_bbox(
  min_lat double precision,
  min_lng double precision,
  max_lat double precision,
  max_lng double precision,
  max_results int default 500
)
returns table (
  id uuid,
  lat double precision,
  lng double precision,
  created_at timestamptz,
  title text,
  duration_ms int
)
language sql stable as $$
  select id, lat, lng, created_at, title, duration_ms
    from public.pins
   where not hidden
     and lat between min_lat and max_lat
     and lng between min_lng and max_lng
   order by created_at desc
   limit max_results;
$$;

-- ===== RPC: distance check (server-authoritative) =====
create or replace function public.pin_distance_meters(
  pin_id uuid,
  user_lat double precision,
  user_lng double precision
) returns double precision
language sql stable as $$
  select st_distance(
           geog,
           st_setsrid(st_makepoint(user_lng, user_lat), 4326)::geography
         )
    from public.pins
   where id = pin_id and not hidden;
$$;

-- ===== RLS =====
alter table public.pins enable row level security;
alter table public.reports enable row level security;

drop policy if exists pins_select on public.pins;
create policy pins_select on public.pins
  for select using (not hidden);

drop policy if exists pins_insert on public.pins;
create policy pins_insert on public.pins
  for insert with check (creator_id = auth.uid());

drop policy if exists pins_delete on public.pins;
create policy pins_delete on public.pins
  for delete using (creator_id = auth.uid());

drop policy if exists reports_insert on public.reports;
create policy reports_insert on public.reports
  for insert with check (reporter_id = auth.uid());

drop policy if exists reports_select on public.reports;
create policy reports_select on public.reports
  for select using (reporter_id = auth.uid());

-- ===== storage =====
insert into storage.buckets (id, name, public)
  values ('audio', 'audio', false)
  on conflict (id) do nothing;

drop policy if exists "audio upload own" on storage.objects;
create policy "audio upload own" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'audio'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "audio delete own" on storage.objects;
create policy "audio delete own" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'audio'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Reads are NOT public. The /api/pins/[id]/listen route mints short-lived
-- signed URLs after verifying the requester is physically near the pin.
