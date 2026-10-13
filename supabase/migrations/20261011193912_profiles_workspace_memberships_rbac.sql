
create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text check (display_name is null or char_length(display_name) <= 120),
  avatar_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.workspace_memberships (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'viewer'
    check (role in ('admin','editor','publisher','viewer')),
  invited_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (workspace_id, user_id)
);

create index workspace_memberships_user_id_idx on public.workspace_memberships(user_id);
create index workspace_memberships_workspace_role_idx on public.workspace_memberships(workspace_id, role);

alter table public.profiles enable row level security;
alter table public.workspace_memberships enable row level security;

grant select, insert, update on public.profiles to authenticated;
grant select on public.workspace_memberships to authenticated;
grant insert, update, delete on public.workspace_memberships to authenticated;

create policy "profile_select_self"
on public.profiles for select to authenticated
using ((select auth.uid()) = user_id);

create policy "profile_insert_self"
on public.profiles for insert to authenticated
with check ((select auth.uid()) = user_id);

create policy "profile_update_self"
on public.profiles for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "membership_select_workspace_owner_or_self"
on public.workspace_memberships for select to authenticated
using (
  user_id = (select auth.uid())
  or exists (
    select 1 from public.workspaces w
    where w.id = workspace_id and w.owner_id = (select auth.uid())
  )
);

create policy "membership_insert_owner_or_admin"
on public.workspace_memberships for insert to authenticated
with check (
  role <> 'owner'
  and (
    exists (
      select 1 from public.workspaces w
      where w.id = workspace_id and w.owner_id = (select auth.uid())
    )
    or exists (
      select 1 from public.workspace_memberships m
      where m.workspace_id = workspace_id
        and m.user_id = (select auth.uid())
        and m.role = 'admin'
    )
  )
);

create policy "membership_update_owner_or_admin"
on public.workspace_memberships for update to authenticated
using (
  exists (
    select 1 from public.workspaces w
    where w.id = workspace_id and w.owner_id = (select auth.uid())
  )
  or exists (
    select 1 from public.workspace_memberships m
    where m.workspace_id = workspace_id
      and m.user_id = (select auth.uid())
      and m.role = 'admin'
  )
)
with check (
  role <> 'owner'
  and (
    exists (
      select 1 from public.workspaces w
      where w.id = workspace_id and w.owner_id = (select auth.uid())
    )
    or exists (
      select 1 from public.workspace_memberships m
      where m.workspace_id = workspace_id
        and m.user_id = (select auth.uid())
        and m.role = 'admin'
    )
  )
);

create policy "membership_delete_owner_or_admin"
on public.workspace_memberships for delete to authenticated
using (
  exists (
    select 1 from public.workspaces w
    where w.id = workspace_id and w.owner_id = (select auth.uid())
  )
  or exists (
    select 1 from public.workspace_memberships m
    where m.workspace_id = workspace_id
      and m.user_id = (select auth.uid())
      and m.role = 'admin'
  )
);

drop policy if exists "workspace_owner_select" on public.workspaces;
create policy "workspace_owner_or_member_select"
on public.workspaces for select to authenticated
using (
  owner_id = (select auth.uid())
  or exists (
    select 1 from public.workspace_memberships m
    where m.workspace_id = id and m.user_id = (select auth.uid())
  )
);

drop policy if exists "site_owner_or_published_select" on public.sites;
create policy "site_member_or_published_select"
on public.sites for select to authenticated
using (
  status = 'published'
  or exists (
    select 1 from public.workspaces w
    where w.id = workspace_id and w.owner_id = (select auth.uid())
  )
  or exists (
    select 1 from public.workspace_memberships m
    where m.workspace_id = workspace_id and m.user_id = (select auth.uid())
  )
);

drop policy if exists "site_owner_insert" on public.sites;
create policy "site_owner_admin_editor_insert"
on public.sites for insert to authenticated
with check (
  exists (
    select 1 from public.workspaces w
    where w.id = workspace_id and w.owner_id = (select auth.uid())
  )
  or exists (
    select 1 from public.workspace_memberships m
    where m.workspace_id = workspace_id
      and m.user_id = (select auth.uid())
      and m.role in ('admin','editor')
  )
);

drop policy if exists "site_owner_update" on public.sites;
create policy "site_owner_admin_editor_update"
on public.sites for update to authenticated
using (
  exists (
    select 1 from public.workspaces w
    where w.id = workspace_id and w.owner_id = (select auth.uid())
  )
  or exists (
    select 1 from public.workspace_memberships m
    where m.workspace_id = workspace_id
      and m.user_id = (select auth.uid())
      and m.role in ('admin','editor','publisher')
  )
)
with check (
  exists (
    select 1 from public.workspaces w
    where w.id = workspace_id and w.owner_id = (select auth.uid())
  )
  or exists (
    select 1 from public.workspace_memberships m
    where m.workspace_id = workspace_id
      and m.user_id = (select auth.uid())
      and m.role in ('admin','editor','publisher')
  )
);

drop policy if exists "site_owner_delete" on public.sites;
create policy "site_owner_admin_delete"
on public.sites for delete to authenticated
using (
  exists (
    select 1 from public.workspaces w
    where w.id = workspace_id and w.owner_id = (select auth.uid())
  )
  or exists (
    select 1 from public.workspace_memberships m
    where m.workspace_id = workspace_id
      and m.user_id = (select auth.uid())
      and m.role = 'admin'
  )
);

drop policy if exists "page_owner_or_published_select" on public.site_pages;
create policy "page_member_or_published_select"
on public.site_pages for select to authenticated
using (
  (
    status = 'published'
    and exists (
      select 1 from public.sites s
      where s.id = site_id and s.status = 'published'
    )
  )
  or exists (
    select 1
    from public.sites s
    join public.workspaces w on w.id = s.workspace_id
    where s.id = site_id and w.owner_id = (select auth.uid())
  )
  or exists (
    select 1
    from public.sites s
    join public.workspace_memberships m on m.workspace_id = s.workspace_id
    where s.id = site_id and m.user_id = (select auth.uid())
  )
);

drop policy if exists "page_owner_insert" on public.site_pages;
create policy "page_owner_admin_editor_insert"
on public.site_pages for insert to authenticated
with check (
  exists (
    select 1
    from public.sites s
    join public.workspaces w on w.id = s.workspace_id
    where s.id = site_id and w.owner_id = (select auth.uid())
  )
  or exists (
    select 1
    from public.sites s
    join public.workspace_memberships m on m.workspace_id = s.workspace_id
    where s.id = site_id and m.user_id = (select auth.uid()) and m.role in ('admin','editor')
  )
);

drop policy if exists "page_owner_update" on public.site_pages;
create policy "page_owner_admin_editor_publisher_update"
on public.site_pages for update to authenticated
using (
  exists (
    select 1
    from public.sites s
    join public.workspaces w on w.id = s.workspace_id
    where s.id = site_id and w.owner_id = (select auth.uid())
  )
  or exists (
    select 1
    from public.sites s
    join public.workspace_memberships m on m.workspace_id = s.workspace_id
    where s.id = site_id and m.user_id = (select auth.uid()) and m.role in ('admin','editor','publisher')
  )
)
with check (
  exists (
    select 1
    from public.sites s
    join public.workspaces w on w.id = s.workspace_id
    where s.id = site_id and w.owner_id = (select auth.uid())
  )
  or exists (
    select 1
    from public.sites s
    join public.workspace_memberships m on m.workspace_id = s.workspace_id
    where s.id = site_id and m.user_id = (select auth.uid()) and m.role in ('admin','editor','publisher')
  )
);

drop policy if exists "page_owner_delete" on public.site_pages;
create policy "page_owner_admin_delete"
on public.site_pages for delete to authenticated
using (
  exists (
    select 1
    from public.sites s
    join public.workspaces w on w.id = s.workspace_id
    where s.id = site_id and w.owner_id = (select auth.uid())
  )
  or exists (
    select 1
    from public.sites s
    join public.workspace_memberships m on m.workspace_id = s.workspace_id
    where s.id = site_id and m.user_id = (select auth.uid()) and m.role = 'admin'
  )
);

create trigger set_profiles_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();
