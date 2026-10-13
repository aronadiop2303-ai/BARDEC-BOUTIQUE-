
create table public.customer_addresses (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references auth.users(id) on delete cascade,
  label text not null default 'Principal' check (char_length(trim(label)) between 1 and 80),
  recipient_name text not null check (char_length(trim(recipient_name)) between 1 and 160),
  phone text not null check (char_length(trim(phone)) between 3 and 40),
  country_code text not null default 'SN' check (country_code ~ '^[A-Z]{2}$'),
  city text not null check (char_length(trim(city)) between 1 and 120),
  address_line text not null check (char_length(trim(address_line)) between 1 and 240),
  additional_directions text,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index customer_addresses_one_default_idx
on public.customer_addresses(customer_id) where is_default = true;

create table public.carts (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.sites(id) on delete cascade,
  customer_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'active' check (status in ('active','converted','abandoned')),
  currency_code text not null default 'XOF' check (currency_code ~ '^[A-Z]{3}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index carts_one_active_per_customer_site_idx
on public.carts(site_id, customer_id) where status = 'active';
create index carts_customer_idx on public.carts(customer_id);

create table public.cart_items (
  id uuid primary key default gen_random_uuid(),
  cart_id uuid not null references public.carts(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete restrict,
  variant_id uuid references public.product_variants(id) on delete restrict,
  quantity integer not null check (quantity between 1 and 999),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index cart_items_unique_selection_idx
on public.cart_items(cart_id, product_id, coalesce(variant_id, '00000000-0000-0000-0000-000000000000'::uuid));
create index cart_items_product_idx on public.cart_items(product_id);

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  order_number text not null unique default ('B-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12))),
  site_id uuid not null references public.sites(id) on delete restrict,
  customer_id uuid not null references auth.users(id) on delete restrict,
  cart_id uuid references public.carts(id) on delete set null,
  status text not null default 'pending_payment'
    check (status in ('pending_payment','confirmed','processing','ready_for_pickup','shipped','delivered','cancelled','refunded')),
  customer_email text,
  customer_phone text not null check (char_length(trim(customer_phone)) between 3 and 40),
  currency_code text not null default 'XOF' check (currency_code ~ '^[A-Z]{3}$'),
  subtotal numeric(12,2) not null check (subtotal >= 0),
  discount_total numeric(12,2) not null default 0 check (discount_total >= 0),
  tax_total numeric(12,2) not null default 0 check (tax_total >= 0),
  shipping_total numeric(12,2) not null default 0 check (shipping_total >= 0),
  grand_total numeric(12,2) not null check (grand_total >= 0),
  shipping_address jsonb not null default '{}'::jsonb check (jsonb_typeof(shipping_address) = 'object'),
  billing_address jsonb not null default '{}'::jsonb check (jsonb_typeof(billing_address) = 'object'),
  customer_note text,
  internal_note text,
  placed_at timestamptz not null default now(),
  confirmed_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (grand_total = subtotal - discount_total + tax_total + shipping_total)
);

create index orders_site_created_idx on public.orders(site_id, created_at desc);
create index orders_customer_created_idx on public.orders(customer_id, created_at desc);
create index orders_status_idx on public.orders(status, created_at desc);

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  variant_id uuid references public.product_variants(id) on delete set null,
  product_name text not null check (char_length(trim(product_name)) between 1 and 180),
  sku text,
  variant_snapshot jsonb not null default '{}'::jsonb check (jsonb_typeof(variant_snapshot) = 'object'),
  quantity integer not null check (quantity between 1 and 999),
  unit_price numeric(12,2) not null check (unit_price >= 0),
  line_total numeric(12,2) generated always as (quantity * unit_price) stored,
  currency_code text not null default 'XOF' check (currency_code ~ '^[A-Z]{3}$'),
  created_at timestamptz not null default now()
);

create index order_items_order_idx on public.order_items(order_id);
create index order_items_product_idx on public.order_items(product_id);

create table public.payment_transactions (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete restrict,
  provider text not null check (provider in ('paydunya','wave','orange_money','free_money','cash_on_delivery','manual','other')),
  provider_reference text,
  status text not null default 'pending'
    check (status in ('pending','requires_action','succeeded','failed','cancelled','partially_refunded','refunded')),
  amount numeric(12,2) not null check (amount >= 0),
  currency_code text not null default 'XOF' check (currency_code ~ '^[A-Z]{3}$'),
  provider_payload jsonb not null default '{}'::jsonb check (jsonb_typeof(provider_payload) = 'object'),
  failure_code text,
  failure_message text,
  paid_at timestamptz,
  refunded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, provider_reference)
);

create index payment_transactions_order_idx on public.payment_transactions(order_id, created_at desc);
create index payment_transactions_status_idx on public.payment_transactions(status, created_at desc);

create table public.shipments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending','ready_for_pickup','picked_up','in_transit','delivered','failed','returned','cancelled')),
  carrier text,
  tracking_reference text,
  delivery_method text not null default 'delivery'
    check (delivery_method in ('delivery','pickup','point_relais','digital')),
  recipient_name text,
  recipient_phone text,
  shipping_address jsonb not null default '{}'::jsonb check (jsonb_typeof(shipping_address) = 'object'),
  estimated_delivery_at timestamptz,
  shipped_at timestamptz,
  delivered_at timestamptz,
  proof_of_delivery jsonb not null default '{}'::jsonb check (jsonb_typeof(proof_of_delivery) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index shipments_order_idx on public.shipments(order_id);
create index shipments_status_idx on public.shipments(status, created_at desc);

create table public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.sites(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  variant_id uuid references public.product_variants(id) on delete set null,
  movement_type text not null
    check (movement_type in ('initial_stock','sale','restock','return','adjustment','damage','reservation','release')),
  quantity_delta integer not null check (quantity_delta <> 0),
  reference_type text,
  reference_id uuid,
  reason text,
  actor_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index inventory_movements_site_created_idx on public.inventory_movements(site_id, created_at desc);
create index inventory_movements_product_idx on public.inventory_movements(product_id, created_at desc);

alter table public.customer_addresses enable row level security;
alter table public.carts enable row level security;
alter table public.cart_items enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.payment_transactions enable row level security;
alter table public.shipments enable row level security;
alter table public.inventory_movements enable row level security;

grant select, insert, update, delete on public.customer_addresses to authenticated;
grant select, insert, update, delete on public.carts to authenticated;
grant select, insert, update, delete on public.cart_items to authenticated;
grant select on public.orders, public.order_items, public.payment_transactions, public.shipments, public.inventory_movements to authenticated;

create policy "addresses_customer_all"
on public.customer_addresses for all to authenticated
using (customer_id = (select auth.uid()))
with check (customer_id = (select auth.uid()));

create policy "carts_customer_select"
on public.carts for select to authenticated
using (customer_id = (select auth.uid()));

create policy "carts_customer_insert"
on public.carts for insert to authenticated
with check (
  customer_id = (select auth.uid())
  and status = 'active'
  and exists (select 1 from public.sites s where s.id = site_id and s.status = 'published' and s.site_type = 'store')
);

create policy "carts_customer_update"
on public.carts for update to authenticated
using (customer_id = (select auth.uid()) and status = 'active')
with check (customer_id = (select auth.uid()) and status in ('active','abandoned'));

create policy "carts_customer_delete"
on public.carts for delete to authenticated
using (customer_id = (select auth.uid()) and status = 'active');

create policy "cart_items_customer_select"
on public.cart_items for select to authenticated
using (exists (select 1 from public.carts c where c.id = cart_id and c.customer_id = (select auth.uid())));

create policy "cart_items_customer_insert"
on public.cart_items for insert to authenticated
with check (
  exists (
    select 1 from public.carts c
    join public.products p on p.site_id = c.site_id
    join public.sites s on s.id = c.site_id
    where c.id = cart_id and c.customer_id = (select auth.uid()) and c.status = 'active'
      and p.id = product_id and p.status = 'active' and s.status = 'published'
      and (variant_id is null or exists (
        select 1 from public.product_variants v
        where v.id = variant_id and v.product_id = p.id and v.is_active
      ))
  )
);

create policy "cart_items_customer_update"
on public.cart_items for update to authenticated
using (exists (select 1 from public.carts c where c.id = cart_id and c.customer_id = (select auth.uid()) and c.status = 'active'))
with check (
  exists (
    select 1 from public.carts c
    join public.products p on p.site_id = c.site_id
    join public.sites s on s.id = c.site_id
    where c.id = cart_id and c.customer_id = (select auth.uid()) and c.status = 'active'
      and p.id = product_id and p.status = 'active' and s.status = 'published'
      and (variant_id is null or exists (
        select 1 from public.product_variants v
        where v.id = variant_id and v.product_id = p.id and v.is_active
      ))
  )
);

create policy "cart_items_customer_delete"
on public.cart_items for delete to authenticated
using (exists (select 1 from public.carts c where c.id = cart_id and c.customer_id = (select auth.uid()) and c.status = 'active'));

create policy "orders_customer_or_store_member_read"
on public.orders for select to authenticated
using (
  customer_id = (select auth.uid())
  or exists (
    select 1 from public.sites s
    where s.id = site_id and private.has_workspace_access(s.workspace_id, array['admin','editor','publisher','viewer'])
  )
);

create policy "order_items_customer_or_store_member_read"
on public.order_items for select to authenticated
using (
  exists (
    select 1 from public.orders o
    where o.id = order_id and (
      o.customer_id = (select auth.uid())
      or exists (
        select 1 from public.sites s
        where s.id = o.site_id and private.has_workspace_access(s.workspace_id, array['admin','editor','publisher','viewer'])
      )
    )
  )
);

create policy "payments_customer_or_store_member_read"
on public.payment_transactions for select to authenticated
using (
  exists (
    select 1 from public.orders o
    where o.id = order_id and (
      o.customer_id = (select auth.uid())
      or exists (
        select 1 from public.sites s
        where s.id = o.site_id and private.has_workspace_access(s.workspace_id, array['admin','editor','publisher','viewer'])
      )
    )
  )
);

create policy "shipments_customer_or_store_member_read"
on public.shipments for select to authenticated
using (
  exists (
    select 1 from public.orders o
    where o.id = order_id and (
      o.customer_id = (select auth.uid())
      or exists (
        select 1 from public.sites s
        where s.id = o.site_id and private.has_workspace_access(s.workspace_id, array['admin','editor','publisher','viewer'])
      )
    )
  )
);

create policy "inventory_movements_store_member_read"
on public.inventory_movements for select to authenticated
using (private.has_workspace_access((select s.workspace_id from public.sites s where s.id = site_id), array['admin','editor','publisher','viewer']));

create trigger set_customer_addresses_updated_at before update on public.customer_addresses
for each row execute function public.set_updated_at();
create trigger set_carts_updated_at before update on public.carts
for each row execute function public.set_updated_at();
create trigger set_cart_items_updated_at before update on public.cart_items
for each row execute function public.set_updated_at();
create trigger set_payment_transactions_updated_at before update on public.payment_transactions
for each row execute function public.set_updated_at();
create trigger set_shipments_updated_at before update on public.shipments
for each row execute function public.set_updated_at();
