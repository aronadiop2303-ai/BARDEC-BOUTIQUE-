
create or replace function public.has_workspace_access(
  target_workspace uuid,
  allowed_roles text[] default null
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.workspaces w
    where w.id = target_workspace
      and w.owner_id = (select auth.uid())
  )
  or exists (
    select 1
    from public.workspace_memberships m
    where m.workspace_id = target_workspace
      and m.user_id = (select auth.uid())
      and (allowed_roles is null or m.role = any(allowed_roles))
  );
$$;

revoke all on function public.has_workspace_access(uuid, text[]) from public, anon;
grant execute on function public.has_workspace_access(uuid, text[]) to authenticated;

drop policy if exists "membership_select_workspace_owner_or_self" on public.workspace_memberships;
create policy "membership_select_owner_admin_or_self"
on public.workspace_memberships for select to authenticated
using (
  user_id = (select auth.uid())
  or public.has_workspace_access(workspace_id, array['admin'])
);

drop policy if exists "membership_insert_owner_or_admin" on public.workspace_memberships;
create policy "membership_insert_owner_or_admin"
on public.workspace_memberships for insert to authenticated
with check (
  role <> 'owner'
  and public.has_workspace_access(workspace_id, array['admin'])
);

drop policy if exists "membership_update_owner_or_admin" on public.workspace_memberships;
create policy "membership_update_owner_or_admin"
on public.workspace_memberships for update to authenticated
using (public.has_workspace_access(workspace_id, array['admin']))
with check (
  role <> 'owner'
  and public.has_workspace_access(workspace_id, array['admin'])
);

drop policy if exists "membership_delete_owner_or_admin" on public.workspace_memberships;
create policy "membership_delete_owner_or_admin"
on public.workspace_memberships for delete to authenticated
using (public.has_workspace_access(workspace_id, array['admin']));

create table public.business_profiles (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null unique references public.sites(id) on delete cascade,
  public_name text not null check (char_length(trim(public_name)) between 1 and 180),
  legal_name text,
  category text not null default 'general',
  description text,
  phone text,
  whatsapp text,
  email text,
  currency_code text not null default 'XOF' check (currency_code ~ '^[A-Z]{3}$'),
  country_code text not null default 'SN' check (country_code ~ '^[A-Z]{2}$'),
  city text,
  address text,
  opening_hours jsonb not null default '{}'::jsonb,
  contact_preferences jsonb not null default '{"phone":true,"whatsapp":true,"email":false}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.business_offerings (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.sites(id) on delete cascade,
  kind text not null default 'service' check (kind in ('product','service','rental','property','event','package')),
  title text not null check (char_length(trim(title)) between 1 and 180),
  slug text not null check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  description text,
  price numeric(14,2) check (price is null or price >= 0),
  currency_code text not null default 'XOF' check (currency_code ~ '^[A-Z]{3}$'),
  price_unit text,
  availability_status text not null default 'available' check (availability_status in ('available','unavailable','on_request','sold','rented')),
  media jsonb not null default '[]'::jsonb,
  attributes jsonb not null default '{}'::jsonb,
  is_public boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(site_id, slug)
);

create table public.business_inquiries (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.sites(id) on delete cascade,
  offering_id uuid references public.business_offerings(id) on delete set null,
  sender_user_id uuid references auth.users(id) on delete set null,
  sender_name text,
  sender_phone text,
  sender_email text,
  channel text not null default 'website' check (channel in ('website','phone','whatsapp','email','other')),
  message text not null check (char_length(trim(message)) between 1 and 5000),
  status text not null default 'new' check (status in ('new','in_progress','answered','closed','spam')),
  created_at timestamptz not null default now()
);

create index business_offerings_site_id_idx on public.business_offerings(site_id);
create index business_offerings_public_idx on public.business_offerings(site_id, is_public, availability_status);
create index business_inquiries_site_created_idx on public.business_inquiries(site_id, created_at desc);
create index business_inquiries_sender_user_id_idx on public.business_inquiries(sender_user_id);

alter table public.business_profiles enable row level security;
alter table public.business_offerings enable row level security;
alter table public.business_inquiries enable row level security;

grant select, insert, update, delete on public.business_profiles to authenticated;
grant select, insert, update, delete on public.business_offerings to authenticated;
grant select, insert, update, delete on public.business_inquiries to authenticated;
grant select on public.business_profiles to anon;
grant select on public.business_offerings to anon;

create policy "business_profile_public_select"
on public.business_profiles for select to anon
using (exists (select 1 from public.sites s where s.id = site_id and s.status = 'published'));

create policy "business_profile_member_select"
on public.business_profiles for select to authenticated
using (
  exists (select 1 from public.sites s where s.id = site_id and s.status = 'published')
  or exists (
    select 1 from public.sites s
    where s.id = site_id and public.has_workspace_access(s.workspace_id, null)
  )
);

create policy "business_profile_member_insert"
on public.business_profiles for insert to authenticated
with check (
  exists (
    select 1 from public.sites s
    where s.id = site_id and public.has_workspace_access(s.workspace_id, array['admin','editor'])
  )
);

create policy "business_profile_member_update"
on public.business_profiles for update to authenticated
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

create policy "business_profile_member_delete"
on public.business_profiles for delete to authenticated
using (
  exists (
    select 1 from public.sites s
    where s.id = site_id and public.has_workspace_access(s.workspace_id, array['admin'])
  )
);

create policy "offerings_public_select"
on public.business_offerings for select to anon
using (
  is_public
  and exists (select 1 from public.sites s where s.id = site_id and s.status = 'published')
);

create policy "offerings_member_select"
on public.business_offerings for select to authenticated
using (
  (is_public and exists (select 1 from public.sites s where s.id = site_id and s.status = 'published'))
  or exists (
    select 1 from public.sites s
    where s.id = site_id and public.has_workspace_access(s.workspace_id, null)
  )
);

create policy "offerings_member_insert"
on public.business_offerings for insert to authenticated
with check (
  exists (
    select 1 from public.sites s
    where s.id = site_id and public.has_workspace_access(s.workspace_id, array['admin','editor'])
  )
);

create policy "offerings_member_update"
on public.business_offerings for update to authenticated
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

create policy "offerings_member_delete"
on public.business_offerings for delete to authenticated
using (
  exists (
    select 1 from public.sites s
    where s.id = site_id and public.has_workspace_access(s.workspace_id, array['admin'])
  )
);

create policy "inquiries_member_select"
on public.business_inquiries for select to authenticated
using (
  exists (
    select 1 from public.sites s
    where s.id = site_id and public.has_workspace_access(s.workspace_id, array['admin','editor','publisher','viewer'])
  )
);

create policy "inquiries_public_insert"
on public.business_inquiries for insert to anon, authenticated
with check (
  exists (
    select 1 from public.sites s
    where s.id = site_id and s.status = 'published'
  )
  and (
    offering_id is null
    or exists (
      select 1 from public.business_offerings o
      where o.id = offering_id and o.site_id = site_id and o.is_public
    )
  )
  and (sender_user_id is null or sender_user_id = (select auth.uid()))
);

create policy "inquiries_member_update"
on public.business_inquiries for update to authenticated
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

create policy "inquiries_member_delete"
on public.business_inquiries for delete to authenticated
using (
  exists (
    select 1 from public.sites s
    where s.id = site_id and public.has_workspace_access(s.workspace_id, array['admin'])
  )
);

create trigger set_business_profiles_updated_at
before update on public.business_profiles
for each row execute function public.set_updated_at();

create trigger set_business_offerings_updated_at
before update on public.business_offerings
for each row execute function public.set_updated_at();
