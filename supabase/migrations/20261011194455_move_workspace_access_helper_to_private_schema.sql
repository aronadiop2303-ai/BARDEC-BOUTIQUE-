
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create or replace function private.has_workspace_access(target_workspace uuid, allowed_roles text[] default null)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1 from public.workspaces w
    where w.id = target_workspace
      and w.owner_id = (select auth.uid())
  )
  or exists (
    select 1 from public.workspace_memberships m
    where m.workspace_id = target_workspace
      and m.user_id = (select auth.uid())
      and (allowed_roles is null or m.role = any(allowed_roles))
  );
$function$;

revoke all on function private.has_workspace_access(uuid,text[]) from public, anon;
grant execute on function private.has_workspace_access(uuid,text[]) to authenticated;

do $$
declare
  p record;
  q text;
  c text;
begin
  for p in
    select schemaname, tablename, policyname, qual, with_check
    from pg_policies
    where schemaname = 'public'
      and (
        coalesce(qual, '') like '%has_workspace_access%'
        or coalesce(with_check, '') like '%has_workspace_access%'
      )
  loop
    q := case when p.qual is null then null else regexp_replace(replace(p.qual, 'public.has_workspace_access(', 'private.has_workspace_access('), '(^|[^.])has_workspace_access\(', '\1private.has_workspace_access(', 'g') end;
    c := case when p.with_check is null then null else regexp_replace(replace(p.with_check, 'public.has_workspace_access(', 'private.has_workspace_access('), '(^|[^.])has_workspace_access\(', '\1private.has_workspace_access(', 'g') end;
    if q is not null and c is not null then
      execute format('alter policy %I on %I.%I using (%s) with check (%s)', p.policyname, p.schemaname, p.tablename, q, c);
    elsif q is not null then
      execute format('alter policy %I on %I.%I using (%s)', p.policyname, p.schemaname, p.tablename, q);
    elsif c is not null then
      execute format('alter policy %I on %I.%I with check (%s)', p.policyname, p.schemaname, p.tablename, c);
    end if;
  end loop;
end $$;

drop function public.has_workspace_access(uuid,text[]);
