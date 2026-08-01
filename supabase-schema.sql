
-- RSR SHOP V6 SUPABASE SETUP
-- Run this entire file once in Supabase Dashboard -> SQL Editor.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default 'Customer',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.store_settings (
  id integer primary key default 1 check (id = 1),
  instant_stock bigint not null default 50000 check (instant_stock >= 0),
  instant_reserved bigint not null default 0 check (instant_reserved >= 0),
  reservation_minutes integer not null default 60 check (reservation_minutes between 5 and 1440),
  service_online boolean not null default true,
  processing_notice text not null default 'Most orders are reviewed as soon as possible.',
  updated_at timestamptz not null default now()
);
insert into public.store_settings (id) values (1) on conflict (id) do nothing;

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  order_number text unique not null,
  customer_id uuid not null references auth.users(id) on delete cascade,
  access_token text unique not null,
  status text not null default 'Pending Payment Review'
    check (status in ('Pending Payment Review','Payment Verified','Approved','Processing','Ready for Delivery','Completed','Declined','Refund Required')),
  method text not null,
  tax_option text not null default 'N/A',
  amount bigint not null check (amount > 0),
  receive_amount bigint not null default 0,
  required_pass_price bigint not null default 0,
  payment numeric(12,2) not null check (payment >= 0),
  payment_method text not null,
  sender_name text not null,
  reference_number text not null,
  roblox_user_id text not null,
  roblox_username text not null,
  roblox_display_name text not null,
  roblox_avatar_url text,
  game_name text,
  item_name text,
  gift_details text,
  receipt_path text not null,
  reservation_status text not null default 'none'
    check (reservation_status in ('none','reserved','finalized','released')),
  reservation_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists orders_customer_created_idx on public.orders(customer_id, created_at desc);
create index if not exists orders_status_idx on public.orders(status);

create table if not exists public.order_messages (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  sender_role text not null check (sender_role in ('customer','admin','system')),
  sender_id uuid references auth.users(id) on delete set null,
  message text not null check (char_length(message) between 1 and 1500),
  read_by_customer boolean not null default false,
  read_by_admin boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists messages_order_created_idx on public.order_messages(order_id, created_at);

create table if not exists public.order_status_history (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  status text not null,
  note text,
  changed_by text not null default 'system',
  created_at timestamptz not null default now()
);

create table if not exists public.stock_reservations (
  id uuid primary key default gen_random_uuid(),
  order_id uuid unique not null references public.orders(id) on delete cascade,
  amount bigint not null check (amount > 0),
  status text not null default 'reserved' check (status in ('reserved','finalized','released','expired')),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.saved_roblox_accounts (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references auth.users(id) on delete cascade,
  roblox_user_id text not null,
  username text not null,
  display_name text not null,
  avatar_url text,
  is_default boolean not null default true,
  created_at timestamptz not null default now(),
  unique(customer_id, roblox_user_id)
);

create table if not exists public.reviews (
  id uuid primary key default gen_random_uuid(),
  order_id uuid unique not null references public.orders(id) on delete cascade,
  customer_id uuid not null references auth.users(id) on delete cascade,
  rating integer not null check (rating between 1 and 5),
  comment text not null check (char_length(comment) between 3 and 600),
  approved boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references auth.users(id) on delete cascade,
  order_id uuid references public.orders(id) on delete cascade,
  type text not null,
  title text not null,
  body text not null,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists notifications_customer_idx on public.notifications(customer_id, created_at desc);

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  insert into public.profiles(id, full_name)
  values(new.id, coalesce(new.raw_user_meta_data->>'full_name','Customer'))
  on conflict(id) do nothing;
  return new;
end;
$$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
for each row execute procedure public.handle_new_user();

create or replace function public.release_expired_reservations()
returns integer language plpgsql security definer set search_path = public
as $$
declare released_count integer := 0;
begin
  with expired as (
    update public.stock_reservations
    set status='expired', updated_at=now()
    where status='reserved' and expires_at <= now()
    returning order_id, amount
  )
  update public.store_settings s
  set instant_reserved = greatest(0, s.instant_reserved - coalesce((select sum(amount) from expired),0)),
      updated_at=now()
  where s.id=1;

  update public.orders o
  set reservation_status='released', updated_at=now()
  where o.id in (select order_id from public.stock_reservations where status='expired')
    and o.reservation_status='reserved';

  get diagnostics released_count = row_count;
  return released_count;
end;
$$;

create or replace function public.reserve_instant_stock(p_order_id uuid, p_amount bigint)
returns void language plpgsql security definer set search_path = public
as $$
declare s public.store_settings%rowtype;
declare expiry timestamptz;
begin
  perform public.release_expired_reservations();
  select * into s from public.store_settings where id=1 for update;
  if p_amount < 10 then raise exception 'Instant minimum is 10 Robux'; end if;
  if (s.instant_stock - s.instant_reserved) < p_amount then
    raise exception 'Not enough Instant stock';
  end if;
  expiry := now() + make_interval(mins => s.reservation_minutes);
  update public.store_settings set instant_reserved=instant_reserved+p_amount,updated_at=now() where id=1;
  insert into public.stock_reservations(order_id,amount,status,expires_at)
  values(p_order_id,p_amount,'reserved',expiry);
  update public.orders set reservation_status='reserved',reservation_expires_at=expiry,updated_at=now() where id=p_order_id;
end;
$$;

create or replace function public.finalize_instant_stock(p_order_id uuid)
returns void language plpgsql security definer set search_path = public
as $$
declare r public.stock_reservations%rowtype;
begin
  select * into r from public.stock_reservations where order_id=p_order_id for update;
  if not found or r.status='finalized' then return; end if;
  if r.status <> 'reserved' then raise exception 'Reservation is not active'; end if;
  update public.store_settings
  set instant_stock=greatest(0,instant_stock-r.amount),
      instant_reserved=greatest(0,instant_reserved-r.amount),updated_at=now()
  where id=1;
  update public.stock_reservations set status='finalized',updated_at=now() where id=r.id;
  update public.orders set reservation_status='finalized',updated_at=now() where id=p_order_id;
end;
$$;

create or replace function public.release_instant_stock(p_order_id uuid)
returns void language plpgsql security definer set search_path = public
as $$
declare r public.stock_reservations%rowtype;
begin
  select * into r from public.stock_reservations where order_id=p_order_id for update;
  if not found or r.status in ('released','expired') then return; end if;
  if r.status='reserved' then
    update public.store_settings set instant_reserved=greatest(0,instant_reserved-r.amount),updated_at=now() where id=1;
  elsif r.status='finalized' then
    update public.store_settings set instant_stock=instant_stock+r.amount,updated_at=now() where id=1;
  end if;
  update public.stock_reservations set status='released',updated_at=now() where id=r.id;
  update public.orders set reservation_status='released',updated_at=now() where id=p_order_id;
end;
$$;

alter table public.profiles enable row level security;
alter table public.orders enable row level security;
alter table public.order_messages enable row level security;
alter table public.order_status_history enable row level security;
alter table public.stock_reservations enable row level security;
alter table public.saved_roblox_accounts enable row level security;
alter table public.reviews enable row level security;
alter table public.notifications enable row level security;
alter table public.store_settings enable row level security;

drop policy if exists "profiles own select" on public.profiles;
create policy "profiles own select" on public.profiles for select using (auth.uid()=id);
drop policy if exists "profiles own update" on public.profiles;
create policy "profiles own update" on public.profiles for update using (auth.uid()=id);

drop policy if exists "orders own select" on public.orders;
create policy "orders own select" on public.orders for select using (auth.uid()=customer_id);
drop policy if exists "messages own order select" on public.order_messages;
create policy "messages own order select" on public.order_messages for select using (
  exists(select 1 from public.orders o where o.id=order_id and o.customer_id=auth.uid())
);
drop policy if exists "reviews public select" on public.reviews;
create policy "reviews public select" on public.reviews for select using (approved=true);
drop policy if exists "settings public select" on public.store_settings;
create policy "settings public select" on public.store_settings for select using (true);

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('payment-receipts','payment-receipts',false,5242880,array['image/png','image/jpeg'])
on conflict(id) do update set public=false,file_size_limit=5242880,allowed_mime_types=array['image/png','image/jpeg'];

-- Optional scheduled cleanup. Enable Supabase Cron first, then uncomment:
-- select cron.schedule('release-expired-rsr-stock','*/5 * * * *','select public.release_expired_reservations();');


-- ==============================
-- RSR SHOP V7 MARKETPLACE UPGRADE
-- ==============================

create table if not exists public.promo_codes (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  discount_percent numeric(5,2) not null check (discount_percent > 0 and discount_percent <= 100),
  active boolean not null default true,
  usage_limit integer,
  used_count integer not null default 0,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.admin_presence (
  id integer primary key default 1 check (id = 1),
  is_online boolean not null default false,
  status_text text not null default 'Support is currently offline',
  updated_at timestamptz not null default now()
);
insert into public.admin_presence(id) values(1) on conflict(id) do nothing;

alter table public.orders
  add column if not exists promo_code text,
  add column if not exists discount_amount numeric(12,2) not null default 0,
  add column if not exists original_payment numeric(12,2);

create or replace view public.sales_analytics as
select
  count(*) filter (where status <> 'Declined') as total_orders,
  count(*) filter (where status = 'Pending Payment Review') as pending_orders,
  count(*) filter (where status = 'Completed') as completed_orders,
  coalesce(sum(payment) filter (where status in ('Payment Verified','Approved','Processing','Ready for Delivery','Completed')),0) as total_revenue,
  coalesce(sum(payment) filter (where created_at >= date_trunc('day', now()) and status <> 'Declined'),0) as today_revenue,
  coalesce(sum(payment) filter (where created_at >= date_trunc('month', now()) and status <> 'Declined'),0) as month_revenue
from public.orders;

alter table public.promo_codes enable row level security;
alter table public.admin_presence enable row level security;

drop policy if exists "public active promo read" on public.promo_codes;
create policy "public active promo read" on public.promo_codes for select using (
  active=true and (expires_at is null or expires_at > now())
);

drop policy if exists "public admin presence read" on public.admin_presence;
create policy "public admin presence read" on public.admin_presence for select using (true);

-- Example promo:
-- insert into public.promo_codes(code,discount_percent,usage_limit)
-- values('WELCOME5',5,100);
