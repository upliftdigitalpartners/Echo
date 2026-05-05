-- Echo migration 002. Run after schema.sql.
-- Adds: rate-limit table + RPC, lets creators see their own hidden pins.

-- ===== rate-limit events =====
create table if not exists public.rate_events (
  id          bigserial primary key,
  actor_key   text not null,
  action      text not null,
  created_at  timestamptz not null default now()
);

create index if not exists rate_events_actor_action_idx
  on public.rate_events (actor_key, action, created_at desc);

alter table public.rate_events enable row level security;
-- Nobody but service-role can read/write — there are no policies on purpose.

-- Atomic check+record. Returns true if under the limit (and records the event),
-- false if over the limit (and does not record).
create or replace function public.rate_check(
  p_actor text,
  p_action text,
  p_max int,
  p_window_seconds int
) returns boolean
language plpgsql security definer as $$
declare
  cnt int;
begin
  -- opportunistic cleanup: nothing older than 1h matters for any of our windows
  delete from public.rate_events
   where created_at < now() - interval '1 hour';

  select count(*) into cnt
    from public.rate_events
   where actor_key = p_actor
     and action = p_action
     and created_at > now() - make_interval(secs => p_window_seconds);

  if cnt >= p_max then
    return false;
  end if;

  insert into public.rate_events (actor_key, action) values (p_actor, p_action);
  return true;
end $$;

-- ===== creator can see own hidden pins (for "My Echoes") =====
drop policy if exists pins_select on public.pins;
create policy pins_select on public.pins
  for select using (not hidden or creator_id = auth.uid());
