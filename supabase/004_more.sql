-- Echo migration 004. Run after 003_features.sql.
-- Adds: optional photo, audio-waveform peaks, full-text search.

-- ===== columns =====
alter table public.pins
  add column if not exists photo_path text,
  add column if not exists peaks      jsonb;

-- ===== full-text search over title + transcript =====
alter table public.pins
  add column if not exists search tsvector
    generated always as (
      setweight(to_tsvector('simple', coalesce(title, '')),      'A') ||
      setweight(to_tsvector('simple', coalesce(transcript, '')), 'B')
    ) stored;

create index if not exists pins_search_gin on public.pins using gin (search);

-- Search RPC: ranks results, applies the same visibility filters as the bbox
-- query so hidden / blocked / expired / time-capsule pins don't leak.
create or replace function public.pins_search(
  q text,
  max_results int default 30
)
returns table (
  id uuid,
  lat double precision,
  lng double precision,
  title text,
  duration_ms int,
  theme text,
  vibe  text,
  audible_from timestamptz,
  created_at timestamptz,
  rank real
)
language sql stable as $$
  with parsed as (
    select websearch_to_tsquery('simple', coalesce(q, '')) as tsq
  )
  select p.id, p.lat, p.lng, p.title, p.duration_ms, p.theme, p.vibe,
         p.audible_from, p.created_at,
         ts_rank(p.search, (select tsq from parsed)) as rank
    from public.pins p, parsed
   where (select tsq from parsed) is not null
     and p.search @@ (select tsq from parsed)
     and not p.hidden
     and p.moderation_status = 'allowed'
     and (p.expires_at is null or p.expires_at > now())
     and (p.audible_from is null or p.audible_from <= now())
   order by rank desc, p.created_at desc
   limit max_results;
$$;

-- ===== storage bucket for photos (private; unlocked by proximity, like audio) =====
insert into storage.buckets (id, name, public)
  values ('photos', 'photos', false)
  on conflict (id) do nothing;

drop policy if exists "photo upload own" on storage.objects;
create policy "photo upload own" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "photo delete own" on storage.objects;
create policy "photo delete own" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
