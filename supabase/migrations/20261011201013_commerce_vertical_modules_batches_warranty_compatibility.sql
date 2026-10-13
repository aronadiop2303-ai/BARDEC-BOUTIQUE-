
create table if not exists public.site_commerce_modules (
 id uuid primary key default gen_random_uuid(),
 site_id uuid not null references public.sites(id) on delete cascade,
 module_key text not null check(module_key in (
  'general_retail','hardware_building','wholesale','grocery_fresh','fashion','electronics_appliances',
  'furniture_home','automotive_parts','beauty_care','professional_equipment','restaurant','rental','booking'
 )),
 is_enabled boolean not null default true,
 settings jsonb not null default '{}'::jsonb,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(site_id,module_key)
);
create table if not exists public.product_batches (
 id uuid primary key default gen_random_uuid(),
 site_id uuid not null references public.sites(id) on delete cascade,
 product_id uuid not null references public.products(id) on delete cascade,
 variant_id uuid references public.product_variants(id) on delete set null,
 stock_location_id uuid,
 batch_code text not null,
 quantity_received numeric(14,3) not null check(quantity_received>=0),
 quantity_remaining numeric(14,3) not null check(quantity_remaining>=0 and quantity_remaining<=quantity_received),
 manufacture_date date,
 expiry_date date,
 received_at timestamptz not null default now(),
 status text not null default 'available' check(status in ('available','quarantined','expired','recalled','depleted')),
 notes text,
 created_at timestamptz not null default now(),
 unique(site_id,product_id,batch_code),
 foreign key(site_id,stock_location_id) references public.stock_locations(site_id,id) on delete restrict,
 foreign key(product_id,variant_id) references public.product_variants(product_id,id) on delete set null
);
create index if not exists product_batches_expiry_idx on public.product_batches(site_id,expiry_date) where expiry_date is not null;
create index if not exists product_batches_product_status_idx on public.product_batches(product_id,status);
create table if not exists public.product_service_profiles (
 id uuid primary key default gen_random_uuid(),
 site_id uuid not null references public.sites(id) on delete cascade,
 product_id uuid not null references public.products(id) on delete cascade,
 variant_id uuid references public.product_variants(id) on delete cascade,
 warranty_duration_days integer check(warranty_duration_days is null or warranty_duration_days>=0),
 warranty_terms text,
 serial_tracking boolean not null default false,
 requires_installation boolean not null default false,
 installation_notes text,
 return_window_days integer check(return_window_days is null or return_window_days>=0),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 foreign key(site_id,product_id) references public.products(site_id,id) on delete cascade,
 foreign key(product_id,variant_id) references public.product_variants(product_id,id) on delete cascade
);
create unique index if not exists product_service_profiles_product_idx on public.product_service_profiles(product_id) where variant_id is null;
create unique index if not exists product_service_profiles_variant_idx on public.product_service_profiles(variant_id) where variant_id is not null;
create table if not exists public.product_compatibilities (
 id uuid primary key default gen_random_uuid(),
 site_id uuid not null references public.sites(id) on delete cascade,
 product_id uuid not null references public.products(id) on delete cascade,
 compatible_product_id uuid not null references public.products(id) on delete cascade,
 relation_type text not null default 'compatible_with' check(relation_type in ('compatible_with','replacement_for','accessory_for','required_with','not_compatible_with')),
 notes text,
 created_at timestamptz not null default now(),
 check(product_id<>compatible_product_id),
 unique(product_id,compatible_product_id,relation_type),
 foreign key(site_id,product_id) references public.products(site_id,id) on delete cascade,
 foreign key(site_id,compatible_product_id) references public.products(site_id,id) on delete cascade
);
create index if not exists product_compatibilities_reverse_idx on public.product_compatibilities(compatible_product_id,relation_type);

alter table public.product_batches enable row level security;
alter table public.product_service_profiles enable row level security;
alter table public.product_compatibilities enable row level security;
alter table public.site_commerce_modules enable row level security;
alter table public.inventory_movements add column if not exists batch_id uuid;
do $$ begin
 if not exists(select 1 from pg_constraint where conname='inventory_movements_batch_fk') then
  alter table public.inventory_movements add constraint inventory_movements_batch_fk foreign key(batch_id) references public.product_batches(id) on delete restrict;
 end if;
end $$;

create policy site_commerce_modules_member_read on public.site_commerce_modules for select to authenticated using (
 exists(select 1 from public.sites s where s.id=site_commerce_modules.site_id and private.has_workspace_access(s.workspace_id,null::text[]))
);
create policy site_commerce_modules_admin_write on public.site_commerce_modules for all to authenticated using (
 exists(select 1 from public.sites s where s.id=site_commerce_modules.site_id and private.has_workspace_access(s.workspace_id,array['admin']::text[]))
) with check (
 exists(select 1 from public.sites s where s.id=site_commerce_modules.site_id and private.has_workspace_access(s.workspace_id,array['admin']::text[]))
);
create policy product_batches_member_read on public.product_batches for select to authenticated using (
 exists(select 1 from public.sites s where s.id=product_batches.site_id and private.has_workspace_access(s.workspace_id,null::text[]))
);
create policy product_batches_editor_write on public.product_batches for all to authenticated using (
 exists(select 1 from public.sites s where s.id=product_batches.site_id and private.has_workspace_access(s.workspace_id,array['admin','editor']::text[]))
) with check (
 exists(select 1 from public.sites s where s.id=product_batches.site_id and private.has_workspace_access(s.workspace_id,array['admin','editor']::text[]))
);
create policy product_service_profiles_public_or_member_read on public.product_service_profiles for select using (
 exists(select 1 from public.products p join public.sites s on s.id=p.site_id where p.id=product_service_profiles.product_id and ((p.status='active' and s.status='published') or private.has_workspace_access(s.workspace_id,null::text[])))
);
create policy product_service_profiles_editor_write on public.product_service_profiles for all to authenticated using (
 exists(select 1 from public.sites s where s.id=product_service_profiles.site_id and private.has_workspace_access(s.workspace_id,array['admin','editor']::text[]))
) with check (
 exists(select 1 from public.sites s where s.id=product_service_profiles.site_id and private.has_workspace_access(s.workspace_id,array['admin','editor']::text[]))
);
create policy product_compatibilities_public_or_member_read on public.product_compatibilities for select using (
 exists(select 1 from public.products p join public.sites s on s.id=p.site_id where p.id=product_compatibilities.product_id and ((p.status='active' and s.status='published') or private.has_workspace_access(s.workspace_id,null::text[])))
);
create policy product_compatibilities_editor_write on public.product_compatibilities for all to authenticated using (
 exists(select 1 from public.sites s where s.id=product_compatibilities.site_id and private.has_workspace_access(s.workspace_id,array['admin','editor']::text[]))
) with check (
 exists(select 1 from public.sites s where s.id=product_compatibilities.site_id and private.has_workspace_access(s.workspace_id,array['admin','editor']::text[]))
);
create index if not exists inventory_movements_batch_idx on public.inventory_movements(batch_id) where batch_id is not null;
