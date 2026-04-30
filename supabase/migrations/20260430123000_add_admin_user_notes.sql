create extension if not exists pgcrypto;

create or replace function public.handle_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

create table if not exists public.admin_user_notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  author_name text not null,
  author_role text not null default 'coach',
  note_category text not null default 'general',
  note_text text not null,
  related_date date null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists admin_user_notes_user_id_idx on public.admin_user_notes(user_id, created_at desc);

alter table public.admin_user_notes enable row level security;

drop trigger if exists set_admin_user_notes_updated_at on public.admin_user_notes;
create trigger set_admin_user_notes_updated_at
before update on public.admin_user_notes
for each row
execute function public.handle_updated_at();