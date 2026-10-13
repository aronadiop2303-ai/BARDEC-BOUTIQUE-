
create table public.product_categories (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.sites(id) on delete cascade,
  parent_id uuid references public.product_categories(id) on delete set null,
  name text not null check (char_length(trim(name)) between 1 and 120),
  slug text not null check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  description text,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (site_id, slug),
  unique (id, site_id)
);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.sites(id) on delete cascade,
  category_id uuid,
  name text not null check (char_length(trim(name)) between 1 and 180),
  slug text not null check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  description text,
  product_type text not null default 'physical'
    check (product_type in ('physical','digital','service','booking')),
  status text not null default 'draft'
    check (status in ('draft','active','archived')),
  price numeric(12,2) not null default 0 check (price >= 0),
  compare_at_price numeric(12,2) check (compare_at_price is null or compare_at_price >= price),
  currency_code text not null default 'XOF' check (currency_code ~ '^[A-Z]{3}$'),
  sku text,
  barcode text,
  track_inventory boolean not null default true,
  inventory_quantity integer not null default 0 check (inventory_quantity >= 0),
  allow_backorder boolean not null default false,
  media jsonb not null default '[]'::jsonb check (jsonb_typeof(media) = 'array'),
  attributes jsonb not null default '{}'::jsonb check (jsonb_typeof(attributes) = 'object'),
  seo jsonb not null default '{}'::jsonb check (jsonb_typeof(seo) = 'object'),
  sort_order integer not null default 0,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (site_id, slug),
  unique (site_id, sku),
  constraint products_category_same_site_fk
    foreign key (category_id, site_id)
    references public.product_categories(id, site_id)
    on delete set null (category_id)
);

create table public.product_variants (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 120),
  sku text,
  options jsonb not null default '{}'::jsonb check (jsonb_typeof(options) = 'object'),
  price_delta numeric(12,2) not null default 0,
  inventory_quantity integer not null default 0 check (inventory_quantity >= 0),
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (product_id, sku)
);

create index product_categories_site_idx on public.product_categories(site_id, sort_order);
create index products_site_status_idx on public.products(site_id, status, sort_order);
create index products_category_idx on public.products(category_id);
create index product_variants_product_idx on public.product_variants(product_id, sort_order);

alter table public.product_categories enable row level security;
alter table public.products enable row level security;
alter table public.product_variants enable row level security;

grant select, insert, update, delete on public.product_categories to authenticated;
grant select, insert, update, delete on public.products to authenticated;
grant select, insert, update, delete on public.product_variants to authenticated;
grant select on public.product_categories, public.products, public.product_variants to anon;

create policy "categories_public_read"
on public.product_categories for select to anon
using (
  is_active and exists (
    select 1 from public.sites s where s.id = site_id and s.status = 'published'
  )
);

create policy "categories_member_read"
on public.product_categories for select to authenticated
using (
  exists (
    select 1 from public.sites s
    where s.id = site_id and (
      s.status = 'published' or public.has_workspace_access(s.workspace_id, null)
    )
  )
);

create policy "categories_member_insert"
on public.product_categories for insert to authenticated
with check (
  exists (
    select 1 from public.sites s
    where s.id = site_id and public.has_workspace_access(s.workspace_id, array['admin','editor'])
  )
);

create policy "categories_member_update"
on public.product_categories for update to authenticated
using (
  exists (
    select 1 from public.sites s
    where s.id = site_id and public.has_workspace_access(s.workspace_id, array['admin','editor'])
  )
)
with check (
  exists (
    select 1 from public.sites s
    where s.id = site_id and public.has_workspace_access(s.workspace_id, array['admin','editor'])
  )
);

create policy "categories_admin_delete"
on public.product_categories for delete to authenticated
using (
  exists (
    select 1 from public.sites s
    where s.id = site_id and public.has_workspace_access(s.workspace_id, array['admin'])
  )
);

create policy "products_public_read"
on public.products for select to anon
using (
  status = 'active' and exists (
    select 1 from public.sites s where s.id = site_id and s.status = 'published'
  )
);

create policy "products_member_read"
on public.products for select to authenticated
using (
  (status = 'active' and exists (
    select 1 from public.sites s where s.id = site_id and s.status = 'published'
  ))
  or exists (
    select 1 from public.sites s
    where s.id = site_id and public.has_workspace_access(s.workspace_id, null)
  )
);

create policy "products_member_insert"
on public.products for insert to authenticated
with check (
  exists (
    select 1 from public.sites s
    where s.id = site_id and public.has_workspace_access(s.workspace_id, array['admin','editor'])
  )
);

create policy "products_member_update"
on public.products for update to authenticated
using (
  exists (
    select 1 from public.sites s
    where s.id = site_id and public.has_workspace_access(s.workspace_id, array['admin','editor','publisher'])
  )
)
with check (
  exists (
    select 1 from public.sites s
    where s.id = site_id and public.has_workspace_access(s.workspace_id, array['admin','editor','publisher'])
  )
);

create policy "products_admin_delete"
on public.products for delete to authenticated
using (
  exists (
    select 1 from public.sites s
    where s.id = site_id and public.has_workspace_access(s.workspace_id, array['admin'])
  )
);

create policy "variants_public_read"
on public.product_variants for select to anon
using (
  is_active and exists (
    select 1 from public.products p join public.sites s on s.id = p.site_id
    where p.id = product_id and p.status = 'active' and s.status = 'published'
  )
);

create policy "variants_member_read"
on public.product_variants for select to authenticated
using (
  exists (
    select 1 from public.products p join public.sites s on s.id = p.site_id
    where p.id = product_id and (
      (p.status = 'active' and s.status = 'published')
      or public.has_workspace_access(s.workspace_id, null)
    )
  )
);

create policy "variants_member_insert"
on public.product_variants for insert to authenticated
with check (
  exists (
    select 1 from public.products p join public.sites s on s.id = p.site_id
    where p.id = product_id and public.has_workspace_access(s.workspace_id, array['admin','editor'])
  )
);

create policy "variants_member_update"
on public.product_variants for update to authenticated
using (
  exists (
    select 1 from public.products p join public.sites s on s.id = p.site_id
    where p.id = product_id and public.has_workspace_access(s.workspace_id, array['admin','editor','publisher'])
  )
)
with check (
  exists (
    select 1 from public.products p join public.sites s on s.id = p.site_id
    where p.id = product_id and public.has_workspace_access(s.workspace_id, array['admin','editor','publisher'])
  )
);

create policy "variants_admin_delete"
on public.product_variants for delete to authenticated
using (
  exists (
    select 1 from public.products p join public.sites s on s.id = p.site_id
    where p.id = product_id and public.has_workspace_access(s.workspace_id, array['admin'])
  )
);

create trigger set_product_categories_updated_at before update on public.product_categories
for each row execute function public.set_updated_at();
create trigger set_products_updated_at before update on public.products
for each row execute function public.set_updated_at();
create trigger set_product_variants_updated_at before update on public.product_variants
for each row execute function public.set_updated_at();
