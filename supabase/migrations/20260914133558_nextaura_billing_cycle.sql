-- PayPal cadence is separate from the tier. Apply before deploying yearly billing.
alter table public.user_subscriptions
  add column if not exists billing_cycle text not null default 'monthly'
  check (billing_cycle in ('monthly', 'yearly'));
