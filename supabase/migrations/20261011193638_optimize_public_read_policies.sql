
drop policy if exists "published_sites_public_select" on public.sites;
create policy "published_sites_anon_select"
on public.sites for select to anon
using (status = 'published');

drop policy if exists "site_owner_select" on public.sites;
create policy "site_owner_or_published_select"
on public.sites for select to authenticated
using (
  status = 'published'
  or exists (
    select 1 from public.workspaces w
    where w.id = workspace_id and w.owner_id = (select auth.uid())
  )
);

drop policy if exists "published_pages_public_select" on public.site_pages;
create policy "published_pages_anon_select"
on public.site_pages for select to anon
using (
  status = 'published'
  and exists (
    select 1 from public.sites s
    where s.id = site_id and s.status = 'published'
  )
);

drop policy if exists "page_owner_select" on public.site_pages;
create policy "page_owner_or_published_select"
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
);
