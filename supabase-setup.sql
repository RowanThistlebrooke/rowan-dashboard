-- ============================================================
-- Goals & Daily Schedule — Supabase schema
-- Run this ONCE in your Supabase project:
--   Dashboard → SQL Editor → New query → paste → Run.
--
-- NOTE ON ACCESS: this app has no login, so the policies below
-- allow the public "anon" role to read/write. That means anyone
-- with your project URL + anon key could read/write this data.
-- Fine for a personal tool; ask me to add auth + per-user rows
-- if you want it private.
-- ============================================================

create extension if not exists "pgcrypto";

-- ---------- goals (long-term + short-term) ----------
create table if not exists public.goals (
  id          uuid primary key default gen_random_uuid(),
  type        text not null check (type in ('long','short')),
  title       text not null,
  created_at  timestamptz not null default now(),
  deadline    timestamptz,
  done        boolean not null default false
);

-- ---------- daily schedule items ----------
create table if not exists public.schedule_items (
  id            uuid primary key default gen_random_uuid(),
  day           date not null,
  text          text not null,
  done          boolean not null default false,
  from_goal_id  uuid references public.goals(id) on delete set null,
  created_at    timestamptz not null default now()
);

-- ---------- brain-dump ideas ----------
create table if not exists public.ideas (
  id          uuid primary key default gen_random_uuid(),
  text        text not null,
  created_at  timestamptz not null default now()
);

-- ---------- Row-Level Security: open to anon (no-auth personal app) ----------
alter table public.goals          enable row level security;
alter table public.schedule_items enable row level security;
alter table public.ideas          enable row level security;

create policy "anon all - goals"    on public.goals          for all to anon using (true) with check (true);
create policy "anon all - schedule" on public.schedule_items for all to anon using (true) with check (true);
create policy "anon all - ideas"    on public.ideas          for all to anon using (true) with check (true);
