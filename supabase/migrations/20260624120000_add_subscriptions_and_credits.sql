do $$ begin
  create type public.subscription_plan as enum ('free', 'plus', 'pro');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.subscription_status as enum ('active', 'inactive', 'past_due', 'canceled', 'trialing');
exception when duplicate_object then null;
end $$;

create table if not exists public.user_subscriptions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  subscription_plan public.subscription_plan not null default 'free',
  subscription_status public.subscription_status not null default 'active',
  payment_provider text check (payment_provider in ('paypal')),
  provider_customer_id text,
  provider_subscription_id text unique,
  current_period_start timestamptz not null default now(),
  current_period_end timestamptz not null default (now() + interval '1 month'),
  uploads_used integer not null default 0 check (uploads_used >= 0),
  chat_messages_used integer not null default 0 check (chat_messages_used >= 0),
  generated_plans_used integer not null default 0 check (generated_plans_used >= 0),
  uploads_limit integer not null default 2 check (uploads_limit > 0),
  chat_messages_limit integer not null default 30 check (chat_messages_limit > 0),
  generated_plans_limit integer not null default 1 check (generated_plans_limit > 0),
  is_admin boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.subscription_usage_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('upload', 'chat_message', 'generated_plan')),
  idempotency_key text,
  created_at timestamptz not null default now(),
  unique (user_id, kind, idempotency_key)
);

alter table public.user_subscriptions enable row level security;
alter table public.subscription_usage_events enable row level security;
drop policy if exists "Users can read only their subscription" on public.user_subscriptions;
create policy "Users can read only their subscription" on public.user_subscriptions for select using (auth.uid() = user_id);

create or replace function public.ensure_user_subscription(p_user_id uuid)
returns setof public.user_subscriptions
language plpgsql security definer set search_path = public
as $$
begin
  if p_user_id is null then raise exception 'user required'; end if;
  insert into public.user_subscriptions(user_id) values (p_user_id) on conflict (user_id) do nothing;
  update public.user_subscriptions
     set subscription_plan = 'free', subscription_status = 'active', payment_provider = null,
         provider_subscription_id = null, uploads_limit = 2, chat_messages_limit = 30,
         generated_plans_limit = 1, uploads_used = 0, chat_messages_used = 0,
         generated_plans_used = 0, current_period_start = now(),
         current_period_end = now() + interval '1 month', updated_at = now()
   where user_id = p_user_id and subscription_status = 'canceled' and current_period_end <= now();
  update public.user_subscriptions
     set uploads_used = 0, chat_messages_used = 0, generated_plans_used = 0,
         current_period_start = now(), current_period_end = now() + interval '1 month', updated_at = now()
   where user_id = p_user_id and subscription_plan = 'free' and current_period_end <= now();
  return query select * from public.user_subscriptions where user_id = p_user_id;
end;
$$;

create or replace function public.consume_subscription_credit(
  p_user_id uuid, p_kind text, p_idempotency_key text default null
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare s public.user_subscriptions; used_count integer; limit_count integer;
begin
  perform public.ensure_user_subscription(p_user_id);
  select * into s from public.user_subscriptions where user_id = p_user_id for update;
  if s.is_admin then return jsonb_build_object('allowed', true, 'unlimited', true); end if;
  if p_kind = 'upload' then used_count := s.uploads_used; limit_count := s.uploads_limit;
  elsif p_kind = 'chat_message' then used_count := s.chat_messages_used; limit_count := s.chat_messages_limit;
  elsif p_kind = 'generated_plan' then used_count := s.generated_plans_used; limit_count := s.generated_plans_limit;
  else raise exception 'unknown usage kind'; end if;
  if p_idempotency_key is not null and exists (
    select 1 from public.subscription_usage_events where user_id=p_user_id and kind=p_kind and idempotency_key=p_idempotency_key
  ) then return jsonb_build_object('allowed', true, 'duplicate', true, 'used', used_count, 'limit', limit_count); end if;
  if used_count >= limit_count then return jsonb_build_object('allowed', false, 'used', used_count, 'limit', limit_count); end if;
  if p_kind = 'upload' then update public.user_subscriptions set uploads_used=uploads_used+1, updated_at=now() where user_id=p_user_id;
  elsif p_kind = 'chat_message' then update public.user_subscriptions set chat_messages_used=chat_messages_used+1, updated_at=now() where user_id=p_user_id;
  else update public.user_subscriptions set generated_plans_used=generated_plans_used+1, updated_at=now() where user_id=p_user_id; end if;
  insert into public.subscription_usage_events(user_id, kind, idempotency_key) values(p_user_id, p_kind, p_idempotency_key);
  return jsonb_build_object('allowed', true, 'used', used_count+1, 'limit', limit_count);
end;
$$;

create or replace function public.create_default_subscription() returns trigger
language plpgsql security definer set search_path=public as $$
begin insert into public.user_subscriptions(user_id) values(new.id) on conflict do nothing; return new; end; $$;
drop trigger if exists on_auth_user_created_subscription on auth.users;
create trigger on_auth_user_created_subscription after insert on auth.users for each row execute function public.create_default_subscription();

revoke all on function public.ensure_user_subscription(uuid) from public, anon, authenticated;
revoke all on function public.consume_subscription_credit(uuid,text,text) from public, anon, authenticated;
grant execute on function public.ensure_user_subscription(uuid) to service_role;
grant execute on function public.consume_subscription_credit(uuid,text,text) to service_role;

-- To make a test administrator, run this manually with a trusted UUID:
-- update public.user_subscriptions set is_admin = true where user_id = '00000000-0000-0000-0000-000000000000';
