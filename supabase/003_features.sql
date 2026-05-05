-- Echo migration 003. Run after 002_rate_limits.sql.
-- Adds: themes, time-capsule, expiration, transcript, AI vibe, moderation,
--       plays tracking. Backwards-compatible (all new columns nullable / defaulted).

-- ===== columns =====
alter table public.pins
  add column if not exists theme               text,
  add column if not exists vibe                text,
  add column if not exists transcript          text,
  add column if not exists transcript_language text,
  add column if not exists title_auto          boolean not null default false,
  add column if not exists audible_from        timestamptz,
  add column if not exists expires_at          timestamptz,
  add column if not exists moderation_status   text not null default 'allowed',
  add column if not exists moderation_reason   text;

-- Constrain enums softly (text columns + check). Cheap to extend later.
alter table public.pins drop constraint if exists pins_theme_check;
alter table public.pins
  add constraint pins_theme_check
  check (theme is null or theme in ('love','secret','story','art','advice','warning'));

alter table public.pins drop constraint if exists pins_vibe_check;
alter table public.pins
  add constraint pins_vibe_check
  check (vibe is null or vibe in ('joy','grief','awe','anger','calm','playful','mundane'));

alter table public.pins drop constraint if exists pins_moderation_status_check;
alter table public.pins
  add constraint pins_moderation_status_check
  check (moderation_status in ('pending','allowed','blocked'));

create index if not exists pins_expires_idx on public.pins (expires_at) where expires_at is not null;
create index if not exists pins_audible_from_idx on public.pins (audible_from) where audible_from is not null;

-- ===== plays =====
-- Anonymous count of who heard each pin (hashed actor key — no PII).
create table if not exists public.pin_plays (
  pin_id        uuid not null references public.pins(id) on delete cascade,
  listener_key  text not null,
  created_at    timestamptz not null default now(),
  primary key (pin_id, listener_key)
);

create index if not exists pin_plays_pin_recent_idx
  on public.pin_plays (pin_id, created_at desc);

alter table public.pin_plays enable row level security;
-- No policies: writes go through service role; reads are exposed via RPC below.

create or replace function public.pin_play_stats(p_pin_id uuid)
returns table (plays bigint, last_heard timestamptz)
language sql stable as $$
  select count(*)::bigint as plays,
         max(created_at)  as last_heard
    from public.pin_plays
   where pin_id = p_pin_id;
$$;

-- ===== updated bbox query: hide expired + non-allowed pins =====
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
  duration_ms int,
  theme text,
  vibe  text,
  audible_from timestamptz
)
language sql stable as $$
  select id, lat, lng, created_at, title, duration_ms, theme, vibe, audible_from
    from public.pins
   where not hidden
     and moderation_status = 'allowed'
     and (expires_at is null or expires_at > now())
     and lat between min_lat and max_lat
     and lng between min_lng and max_lng
   order by created_at desc
   limit max_results;
$$;
