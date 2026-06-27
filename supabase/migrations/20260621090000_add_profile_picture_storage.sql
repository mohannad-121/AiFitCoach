alter table public.profiles
add column if not exists avatar_url text;

create table if not exists public.profile_pictures (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  storage_path text not null,
  public_url text not null,
  original_filename text,
  mime_type text not null default 'image/jpeg',
  size_bytes bigint check (size_bytes is null or size_bytes >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id)
);

alter table public.profile_pictures enable row level security;

do $$
begin
  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('profile-pictures', 'profile-pictures', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
  on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
exception
  when undefined_table then
    null;
end $$;

drop policy if exists "Users can view own profile picture metadata" on public.profile_pictures;
create policy "Users can view own profile picture metadata"
on public.profile_pictures
for select
using (auth.uid() = user_id);

drop policy if exists "Users can upsert own profile picture metadata" on public.profile_pictures;
create policy "Users can upsert own profile picture metadata"
on public.profile_pictures
for insert
with check (auth.uid() = user_id);

drop policy if exists "Users can update own profile picture metadata" on public.profile_pictures;
create policy "Users can update own profile picture metadata"
on public.profile_pictures
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users can delete own profile picture metadata" on public.profile_pictures;
create policy "Users can delete own profile picture metadata"
on public.profile_pictures
for delete
using (auth.uid() = user_id);

drop policy if exists "Users can view profile pictures" on storage.objects;
create policy "Users can view profile pictures"
on storage.objects
for select
using (bucket_id = 'profile-pictures');

drop policy if exists "Users can upload own profile pictures" on storage.objects;
create policy "Users can upload own profile pictures"
on storage.objects
for insert to authenticated
with check (bucket_id = 'profile-pictures' and auth.uid()::text = (storage.foldername(name))[1]);

drop policy if exists "Users can update own profile pictures" on storage.objects;
create policy "Users can update own profile pictures"
on storage.objects
for update to authenticated
using (bucket_id = 'profile-pictures' and auth.uid()::text = (storage.foldername(name))[1])
with check (bucket_id = 'profile-pictures' and auth.uid()::text = (storage.foldername(name))[1]);

drop policy if exists "Users can delete own profile pictures" on storage.objects;
create policy "Users can delete own profile pictures"
on storage.objects
for delete to authenticated
using (bucket_id = 'profile-pictures' and auth.uid()::text = (storage.foldername(name))[1]);

create index if not exists profile_pictures_user_id_idx
on public.profile_pictures(user_id);
