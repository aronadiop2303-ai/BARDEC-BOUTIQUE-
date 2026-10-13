
create unique index if not exists products_site_id_id_uidx on public.products(site_id,id);
create unique index if not exists product_variants_product_id_id_uidx on public.product_variants(product_id,id);
create table if not exists public.product_units (
 id uuid primary key default gen_random_uuid(), site_id uuid not null references public.sites(id) on delete cascade,
 code text not null check(code ~ '^[a-z][a-z0-9_-]{0,23}$'), label text not null check(char_length(trim(label)) between 1 and 80),
 dimension text not null default 'count' check(dimension in ('count','mass','length','volume','area','time','other')),
 decimal_places smallint not null default 0 check(decimal_places between 0 and 3), created_at timestamptz not null default now(),
 unique(site_id,code), unique(site_id,id)
);
create table if not exists public.product_sell_units (
 id uuid primary key default gen_random_uuid(), site_id uuid not null references public.sites(id) on delete cascade,
 product_id uuid not null references public.products(id) on delete cascade, unit_id uuid not null references public.product_units(id) on delete restrict,
 conversion_to_base numeric(14,6) not null default 1 check(conversion_to_base>0), is_default boolean not null default false,
 min_sale_quantity numeric(14,3) not null default 1 check(min_sale_quantity>0), quantity_step numeric(14,3) not null default 1 check(quantity_step>0),
 created_at timestamptz not null default now(), unique(product_id,unit_id),
 foreign key(site_id,product_id) references public.products(site_id,id) on delete cascade,
 foreign key(site_id,unit_id) references public.product_units(site_id,id) on delete restrict
);
create unique index if not exists product_sell_units_one_default_idx on public.product_sell_units(product_id) where is_default;
create table if not exists public.price_tiers (
 id uuid primary key default gen_random_uuid(), site_id uuid not null references public.sites(id) on delete cascade,
 product_id uuid not null references public.products(id) on delete cascade, variant_id uuid references public.product_variants(id) on delete cascade,
 unit_id uuid references public.product_units(id) on delete restrict, min_quantity numeric(14,3) not null check(min_quantity>0),
 unit_price numeric(14,2) not null check(unit_price>=0), currency_code text not null default 'XOF' check(currency_code ~ '^[A-Z]{3}$'),
 valid_from timestamptz, valid_until timestamptz, created_at timestamptz not null default now(),
 foreign key(site_id,product_id) references public.products(site_id,id) on delete cascade,
 foreign key(product_id,variant_id) references public.product_variants(product_id,id) on delete cascade,
 foreign key(site_id,unit_id) references public.product_units(site_id,id) on delete restrict,
 check(valid_until is null or valid_from is null or valid_until>valid_from)
);
create index if not exists price_tiers_product_quantity_idx on public.price_tiers(product_id,min_quantity);
create index if not exists price_tiers_variant_idx on public.price_tiers(variant_id) where variant_id is not null;
create table if not exists public.stock_locations (
 id uuid primary key default gen_random_uuid(), site_id uuid not null references public.sites(id) on delete cascade,
 name text not null check(char_length(trim(name)) between 1 and 120),
 location_type text not null default 'store' check(location_type in ('store','warehouse','shop_floor','vehicle','consignment','other')),
 address text, is_active boolean not null default true, created_at timestamptz not null default now(), unique(site_id,id)
);
alter table public.inventory_movements alter column quantity_delta type numeric(14,3) using quantity_delta::numeric(14,3);
alter table public.inventory_movements add column if not exists stock_location_id uuid, add column if not exists unit_id uuid, add column if not exists unit_quantity numeric(14,3);
do $$ begin
 if not exists(select 1 from pg_constraint where conname='inventory_movements_stock_location_fk') then
  alter table public.inventory_movements add constraint inventory_movements_stock_location_fk foreign key(site_id,stock_location_id) references public.stock_locations(site_id,id) on delete restrict;
 end if;
 if not exists(select 1 from pg_constraint where conname='inventory_movements_unit_fk') then
  alter table public.inventory_movements add constraint inventory_movements_unit_fk foreign key(unit_id) references public.product_units(id) on delete restrict;
 end if;
 if not exists(select 1 from pg_constraint where conname='inventory_movements_unit_quantity_check') then
  alter table public.inventory_movements add constraint inventory_movements_unit_quantity_check check(unit_quantity is null or unit_quantity>0);
 end if;
end $$;
create index if not exists inventory_movements_stock_location_idx on public.inventory_movements(stock_location_id,created_at desc);
create table if not exists public.quotes (
 id uuid primary key default gen_random_uuid(), site_id uuid not null references public.sites(id) on delete cascade, quote_number text not null,
 requester_user_id uuid references auth.users(id) on delete set null, requester_name text, requester_phone text, requester_email text,
 status text not null default 'requested' check(status in ('requested','draft','sent','accepted','rejected','expired','converted','cancelled')),
 currency_code text not null default 'XOF' check(currency_code ~ '^[A-Z]{3}$'), subtotal numeric(14,2) not null default 0 check(subtotal>=0),
 discount_total numeric(14,2) not null default 0 check(discount_total>=0), tax_total numeric(14,2) not null default 0 check(tax_total>=0),
 total numeric(14,2) not null default 0 check(total>=0), customer_note text, seller_note text, valid_until timestamptz,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(site_id,quote_number)
);
create table if not exists public.quote_items (
 id uuid primary key default gen_random_uuid(), quote_id uuid not null references public.quotes(id) on delete cascade,
 product_id uuid references public.products(id) on delete set null, variant_id uuid references public.product_variants(id) on delete set null,
 description text not null check(char_length(trim(description)) between 1 and 500), quantity numeric(14,3) not null check(quantity>0),
 unit_label text, unit_price numeric(14,2) not null default 0 check(unit_price>=0), line_total numeric(14,2) not null default 0 check(line_total>=0),
 created_at timestamptz not null default now()
);
alter table public.product_units enable row level security;
alter table public.product_sell_units enable row level security;
alter table public.price_tiers enable row level security;
alter table public.stock_locations enable row level security;
alter table public.quotes enable row level security;
alter table public.quote_items enable row level security;
create policy product_units_public_or_member_read on public.product_units for select using (exists(select 1 from public.sites s where s.id=product_units.site_id and (s.status='published' or private.has_workspace_access(s.workspace_id,null::text[]))));
create policy product_units_member_write on public.product_units for all to authenticated using (exists(select 1 from public.sites s where s.id=product_units.site_id and private.has_workspace_access(s.workspace_id,array['admin','editor']::text[]))) with check (exists(select 1 from public.sites s where s.id=product_units.site_id and private.has_workspace_access(s.workspace_id,array['admin','editor']::text[])));
create policy product_sell_units_public_or_member_read on public.product_sell_units for select using (exists(select 1 from public.products p join public.sites s on s.id=p.site_id where p.id=product_sell_units.product_id and ((p.status='active' and s.status='published') or private.has_workspace_access(s.workspace_id,null::text[]))));
create policy product_sell_units_member_write on public.product_sell_units for all to authenticated using (exists(select 1 from public.sites s where s.id=product_sell_units.site_id and private.has_workspace_access(s.workspace_id,array['admin','editor']::text[]))) with check (exists(select 1 from public.sites s where s.id=product_sell_units.site_id and private.has_workspace_access(s.workspace_id,array['admin','editor']::text[])));
create policy price_tiers_public_or_member_read on public.price_tiers for select using (exists(select 1 from public.products p join public.sites s on s.id=p.site_id where p.id=price_tiers.product_id and ((p.status='active' and s.status='published') or private.has_workspace_access(s.workspace_id,null::text[]))));
create policy price_tiers_member_write on public.price_tiers for all to authenticated using (exists(select 1 from public.sites s where s.id=price_tiers.site_id and private.has_workspace_access(s.workspace_id,array['admin','editor']::text[]))) with check (exists(select 1 from public.sites s where s.id=price_tiers.site_id and private.has_workspace_access(s.workspace_id,array['admin','editor']::text[])));
create policy stock_locations_member_read on public.stock_locations for select to authenticated using (exists(select 1 from public.sites s where s.id=stock_locations.site_id and private.has_workspace_access(s.workspace_id,null::text[])));
create policy stock_locations_member_write on public.stock_locations for all to authenticated using (exists(select 1 from public.sites s where s.id=stock_locations.site_id and private.has_workspace_access(s.workspace_id,array['admin','editor']::text[]))) with check (exists(select 1 from public.sites s where s.id=stock_locations.site_id and private.has_workspace_access(s.workspace_id,array['admin','editor']::text[])));
create policy quotes_requester_or_member_read on public.quotes for select to authenticated using (requester_user_id=auth.uid() or exists(select 1 from public.sites s where s.id=quotes.site_id and private.has_workspace_access(s.workspace_id,null::text[])));
create policy quotes_public_request_insert on public.quotes for insert to authenticated with check (status='requested' and (requester_user_id is null or requester_user_id=auth.uid()) and exists(select 1 from public.sites s where s.id=quotes.site_id and s.status='published' and s.site_type='store'));
create policy quotes_member_update on public.quotes for update to authenticated using (exists(select 1 from public.sites s where s.id=quotes.site_id and private.has_workspace_access(s.workspace_id,array['admin','editor','publisher']::text[]))) with check (exists(select 1 from public.sites s where s.id=quotes.site_id and private.has_workspace_access(s.workspace_id,array['admin','editor','publisher']::text[])));
create policy quote_items_requester_or_member_read on public.quote_items for select to authenticated using (exists(select 1 from public.quotes q where q.id=quote_items.quote_id and (q.requester_user_id=auth.uid() or exists(select 1 from public.sites s where s.id=q.site_id and private.has_workspace_access(s.workspace_id,null::text[])))));
create policy quote_items_member_write on public.quote_items for all to authenticated using (exists(select 1 from public.quotes q join public.sites s on s.id=q.site_id where q.id=quote_items.quote_id and private.has_workspace_access(s.workspace_id,array['admin','editor']::text[]))) with check (exists(select 1 from public.quotes q join public.sites s on s.id=q.site_id where q.id=quote_items.quote_id and private.has_workspace_access(s.workspace_id,array['admin','editor']::text[])));
create index if not exists quotes_site_status_created_idx on public.quotes(site_id,status,created_at desc);
create index if not exists quotes_requester_created_idx on public.quotes(requester_user_id,created_at desc);
create index if not exists quote_items_quote_idx on public.quote_items(quote_id);
