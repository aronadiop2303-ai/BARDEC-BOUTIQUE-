
drop policy if exists quote_items_requester_insert on public.quote_items;
create policy quote_items_requester_insert on public.quote_items for insert to authenticated with check (
 exists (
  select 1 from public.quotes q join public.sites s on s.id=q.site_id
  where q.id=quote_items.quote_id and q.status='requested' and q.requester_user_id=auth.uid() and s.status='published' and s.site_type='store'
 )
);
