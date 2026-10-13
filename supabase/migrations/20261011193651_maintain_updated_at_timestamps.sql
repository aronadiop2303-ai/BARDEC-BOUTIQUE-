
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

revoke all on function public.set_updated_at() from public, anon, authenticated;

create trigger set_workspaces_updated_at
before update on public.workspaces
for each row execute function public.set_updated_at();

create trigger set_sites_updated_at
before update on public.sites
for each row execute function public.set_updated_at();

create trigger set_site_pages_updated_at
before update on public.site_pages
for each row execute function public.set_updated_at();
