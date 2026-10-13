
create extension if not exists pgcrypto;

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 120),
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.sites (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 160),
  slug text not null check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  description text,
  site_type text not null default 'business'
    check (site_type in ('business','store','portfolio','school','real_estate','services','association','media','landing_page','other')),
  status text not null default 'draft'
    check (status in ('draft','published','archived')),
  theme jsonb not null default '{}'::jsonb,
  settings jsonb not null default '{}'::jsonb,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, slug)
);

create table public.site_pages (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.sites(id) on delete cascade,
  title text not null check (char_length(trim(title)) between 1 and 160),
  path text not null default '/',
  status text not null default 'draft'
    check (status in ('draft','published','archived')),
  content jsonb not null default '{"blocks":[]}'::jsonb,
  seo jsonb not null default '{}'::jsonb,
  sort_order integer not null default 0,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (site_id, path),
  check (path = '/' or (path like '/%' and path !~ '[[:space:]]'))
);

create index workspaces_owner_id_idx on public.workspaces(owner_id);
create index sites_workspace_id_idx on public.sites(workspace_id);
create index sites_status_idx on public.sites(status);
create index site_pages_site_id_idx on public.site_pages(site_id);
create index site_pages_status_idx on public.site_pages(status);

alter table public.workspaces enable row level security;
alter table public.sites enable row level security;
alter table public.site_pages enable row level security;

grant select, insert, update, delete on public.workspaces to authenticated;
grant select, insert, update, delete on public.sites to authenticated;
grant select, insert, update, delete on public.site_pages to authenticated;
grant select on public.sites to anon;
grant select on public.site_pages to anon;

create policy "workspace_owner_select"
on public.workspaces for select to authenticated
using ((select auth.uid()) = owner_id);

create policy "workspace_owner_insert"
on public.workspaces for insert to authenticated
with check ((select auth.uid()) = owner_id);

create policy "workspace_owner_update"
on public.workspaces for update to authenticated
using ((select auth.uid()) = owner_id)
with check ((select auth.uid()) = owner_id);

create policy "workspace_owner_delete"
on public.workspaces for delete to authenticated
using ((select auth.uid()) = owner_id);

create policy "site_owner_select"
on public.sites for select to authenticated
using (
  exists (
    select 1 from public.workspaces w
    where w.id = workspace_id and w.owner_id = (select auth.uid())
  )
);

create policy "published_sites_public_select"
on public.sites for select to anon, authenticated
using (status = 'published');

create policy "site_owner_insert"
on public.sites for insert to authenticated
with check (
  exists (
    select 1 from public.workspaces w
    where w.id = workspace_id and w.owner_id = (select auth.uid())
  )
);

create policy "site_owner_update"
on public.sites for update to authenticated
using (
  exists (
    select 1 from public.workspaces w
    where w.id = workspace_id and w.owner_id = (select auth.uid())
  )
)
with check (
  exists (
    select 1 from public.workspaces w
    where w.id = workspace_id and w.owner_id = (select auth.uid())
  )
);

create policy "site_owner_delete"
on public.sites for delete to authenticated
using (
  exists (
    select 1 from public.workspaces w
    where w.id = workspace_id and w.owner_id = (select auth.uid())
  )
);

create policy "page_owner_select"
on public.site_pages for select to authenticated
using (
  exists (
    select 1
    from public.sites s
    join public.workspaces w on w.id = s.workspace_id
    where s.id = site_id and w.owner_id = (select auth.uid())
  )
);

create policy "published_pages_public_select"
on public.site_pages for select to anon, authenticated
using (
  status = 'published'
  and exists (
    select 1 from public.sites s
    where s.id = site_id and s.status = 'published'
  )
);

create policy "page_owner_insert"
on public.site_pages for insert to authenticated
with check (
  exists (
    select 1
    from public.sites s
    join public.workspaces w on w.id = s.workspace_id
    where s.id = site_id and w.owner_id = (select auth.uid())
  )
);

create policy "page_owner_update"
on public.site_pages for update to authenticated
using (
  exists (
    select 1
    from public.sites s
    join public.workspaces w on w.id = s.workspace_id
    where s.id = site_id and w.owner_id = (select auth.uid())
  )
)
with check (
  exists (
    select 1
    from public.sites s
    join public.workspaces w on w.id = s.workspace_id
    where s.id = site_id and w.owner_id = (select auth.uid())
  )
);

create policy "page_owner_delete"
on public.site_pages for delete to authenticated
using (
  exists (
    select 1
    from public.sites s
    join public.workspaces w on w.id = s.workspace_id
    where s.id = site_id and w.owner_id = (select auth.uid())
  )
);
