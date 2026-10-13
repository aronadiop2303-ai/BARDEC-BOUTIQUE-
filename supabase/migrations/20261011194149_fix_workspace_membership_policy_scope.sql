
drop policy if exists "workspace_owner_or_member_select" on public.workspaces;
create policy "workspace_owner_or_member_select"
on public.workspaces for select to authenticated
using (public.has_workspace_access(id, null));

drop policy if exists "site_member_or_published_select" on public.sites;
create policy "site_member_or_published_select"
on public.sites for select to authenticated
using (
  status = 'published'
  or public.has_workspace_access(workspace_id, null)
);

drop policy if exists "site_owner_admin_editor_insert" on public.sites;
create policy "site_owner_admin_editor_insert"
on public.sites for insert to authenticated
with check (
  public.has_workspace_access(workspace_id, array['admin','editor'])
);

drop policy if exists "site_owner_admin_editor_update" on public.sites;
create policy "site_owner_admin_editor_update"
on public.sites for update to authenticated
using (
  public.has_workspace_access(workspace_id, array['admin','editor','publisher'])
)
with check (
  public.has_workspace_access(workspace_id, array['admin','editor','publisher'])
);

drop policy if exists "site_owner_admin_delete" on public.sites;
create policy "site_owner_admin_delete"
on public.sites for delete to authenticated
using (
  public.has_workspace_access(workspace_id, array['admin'])
);

drop policy if exists "inquiries_public_insert" on public.business_inquiries;
create policy "inquiries_public_insert"
on public.business_inquiries for insert to anon, authenticated
with check (
  exists (
    select 1 from public.sites s
    where s.id = business_inquiries.site_id and s.status = 'published'
  )
  and (
    offering_id is null
    or exists (
      select 1 from public.business_offerings o
      where o.id = business_inquiries.offering_id
        and o.site_id = business_inquiries.site_id
        and o.is_public = true
    )
  )
  and (
    sender_user_id is null
    or sender_user_id = (select auth.uid())
  )
);

drop policy if exists "inquiries_member_select" on public.business_inquiries;
create policy "inquiries_member_select"
on public.business_inquiries for select to authenticated
using (
  exists (
    select 1 from public.sites s
    where s.id = business_inquiries.site_id
      and public.has_workspace_access(s.workspace_id, array['admin','editor','publisher','viewer'])
  )
);

drop policy if exists "inquiries_member_update" on public.business_inquiries;
create policy "inquiries_member_update"
on public.business_inquiries for update to authenticated
using (
  exists (
    select 1 from public.sites s
    where s.id = business_inquiries.site_id
      and public.has_workspace_access(s.workspace_id, array['admin','editor','publisher'])
  )
)
with check (
  exists (
    select 1 from public.sites s
    where s.id = business_inquiries.site_id
      and public.has_workspace_access(s.workspace_id, array['admin','editor','publisher'])
  )
);

drop policy if exists "inquiries_member_delete" on public.business_inquiries;
create policy "inquiries_member_delete"
on public.business_inquiries for delete to authenticated
using (
  exists (
    select 1 from public.sites s
    where s.id = business_inquiries.site_id
      and public.has_workspace_access(s.workspace_id, array['admin'])
  )
);
