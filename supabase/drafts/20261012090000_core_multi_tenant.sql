-- BARDEC-BOUTIQUE — Socle multi-tenant
-- Migration : 20261012090000_core_multi_tenant
-- Statut : PRÉPARÉE LOCALEMENT, NON APPLIQUÉE À AUCUNE BASE À CE JOUR.
--
-- Entités : workspaces, workspace_memberships, sites, pages.
-- Rôles   : owner (propriétaire), admin (administrateur), editor (éditeur).
--
-- Matrice de permissions (côtée serveur, via RLS + fonctions security definer) :
--                         | owner | admin | editor
--   lire l'espace         |   O   |   O   |   O
--   modifier l'espace     |   O   |   O   |   -
--   supprimer l'espace    |   O   |   -   |   -
--   inviter/retrait membre|   O   |   O*  |   -
--   changer un rôle       |   O   |   O*  |   -
--   créer un site         |   O   |   O   |   -
--   modifier un site      |   O   |   O   |   O
--   supprimer un site     |   O   |   O   |   -
--   CRUD des pages        |   O   |   O   |   O
--   * admin ne peut pas toucher au compte owner ni accorder le rôle owner.
--
-- La création d'espace et les transferts de propriété passent par des
-- fonctions security definer : le navigateur ne peut pas s'auto-nommer
-- owner en modifiant un champ d'une requête.

begin;

-- ---------------------------------------------------------------------------
-- Types et tables
-- ---------------------------------------------------------------------------

create type public.workspace_role as enum ('owner', 'admin', 'editor');

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 120),
  owner_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index workspaces_owner_id_idx on public.workspaces (owner_id);

create table public.workspace_memberships (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.workspace_role not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create index workspace_memberships_user_id_idx on public.workspace_memberships (user_id);

create table public.sites (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 200),
  category text not null default 'Custom' check (char_length(category) <= 80),
  status text not null default 'draft' check (status in ('draft', 'published')),
  settings jsonb not null default '{}'::jsonb,
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index sites_workspace_id_idx on public.sites (workspace_id);

create table public.pages (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.sites (id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 200),
  slug text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  content jsonb not null default '{}'::jsonb,
  position integer not null default 0,
  is_homepage boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (site_id, slug)
);

create index pages_site_id_idx on public.pages (site_id);

-- ---------------------------------------------------------------------------
-- Triggers de cohérence
-- ---------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger workspaces_set_updated_at
  before update on public.workspaces
  for each row execute function public.set_updated_at();

create trigger workspace_memberships_set_updated_at
  before update on public.workspace_memberships
  for each row execute function public.set_updated_at();

create trigger sites_set_updated_at
  before update on public.sites
  for each row execute function public.set_updated_at();

create trigger pages_set_updated_at
  before update on public.pages
  for each row execute function public.set_updated_at();

-- L'appartenance d'un site ne peut pas être réassignée après création.
create or replace function public.prevent_site_workspace_reassignment()
returns trigger
language plpgsql
as $$
begin
  if new.workspace_id is distinct from old.workspace_id then
    raise exception 'workspace_id of a site cannot be changed';
  end if;
  return new;
end;
$$;

create trigger sites_prevent_workspace_reassignment
  before update on public.sites
  for each row execute function public.prevent_site_workspace_reassignment();

-- L'appartenance d'une page à un site ne peut pas être réassignée.
create or replace function public.prevent_page_site_reassignment()
returns trigger
language plpgsql
as $$
begin
  if new.site_id is distinct from old.site_id then
    raise exception 'site_id of a page cannot be changed';
  end if;
  return new;
end;
$$;

create trigger pages_prevent_site_reassignment
  before update on public.pages
  for each row execute function public.prevent_page_site_reassignment();

-- Le propriétaire d'un espace ne peut être modifié qu'en base, via la
-- fonction de transfert (transfer_workspace_ownership) qui applique les
-- gardes-fous. Toute tentative via une requête directe est rejetée.
create or replace function public.prevent_workspace_owner_reassignment()
returns trigger
language plpgsql
as $$
begin
  if new.owner_id is distinct from old.owner_id then
    raise exception 'owner_id must be changed through transfer_workspace_ownership';
  end if;
  return new;
end;
$$;

create trigger workspaces_prevent_owner_reassignment
  before update on public.workspaces
  for each row execute function public.prevent_workspace_owner_reassignment();

-- ---------------------------------------------------------------------------
-- Fonctions d'autorisation (security definer, search_path verrouillé)
-- Contournent la RLS pour éviter les politiques récursives entre tables liées.
-- ---------------------------------------------------------------------------

create or replace function public.is_workspace_member(p_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.workspace_memberships m
    where m.workspace_id = p_workspace_id
      and m.user_id = auth.uid()
  );
$$;

create or replace function public.workspace_role_of(p_workspace_id uuid)
returns public.workspace_role
language sql
stable
security definer
set search_path = ''
as $$
  select m.role
  from public.workspace_memberships m
  where m.workspace_id = p_workspace_id
    and m.user_id = auth.uid();
$$;

create or replace function public.can_manage_workspace(p_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.workspace_role_of(p_workspace_id) in ('owner', 'admin');
$$;

create or replace function public.can_create_sites(p_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.workspace_role_of(p_workspace_id) in ('owner', 'admin');
$$;

create or replace function public.can_edit_sites(p_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.workspace_role_of(p_workspace_id) in ('owner', 'admin', 'editor');
$$;

create or replace function public.can_delete_sites(p_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.workspace_role_of(p_workspace_id) in ('owner', 'admin');
$$;

create or replace function public.can_access_site(p_site_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.sites s
    join public.workspace_memberships m on m.workspace_id = s.workspace_id
    where s.id = p_site_id
      and m.user_id = auth.uid()
  );
$$;

create or replace function public.can_edit_page(p_site_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.sites s
    join public.workspace_memberships m on m.workspace_id = s.workspace_id
    where s.id = p_site_id
      and m.user_id = auth.uid()
  );
$$;

-- ---------------------------------------------------------------------------
-- Fonctions métier security definer (opérations sensibles)
-- ---------------------------------------------------------------------------

-- Création d'un espace : le créateur devient owner dans la même transaction.
-- Aucune insertion directe sur workspaces n'est permise par la RLS.
create or replace function public.create_workspace(p_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_workspace_id uuid;
begin
  if v_uid is null then
    raise exception 'authentication required';
  end if;
  if char_length(btrim(coalesce(p_name, ''))) = 0 then
    raise exception 'workspace name is required';
  end if;

  insert into public.workspaces (name, owner_id)
  values (btrim(p_name), v_uid)
  returning id into v_workspace_id;

  insert into public.workspace_memberships (workspace_id, user_id, role)
  values (v_workspace_id, v_uid, 'owner');

  return v_workspace_id;
end;
$$;

-- Inviter / ajouter un membre : owner ou admin, rôle owner interdit,
-- double appartenance interdit. L'utilisateur cible doit exister dans auth.users.
create or replace function public.add_workspace_member(
  p_workspace_id uuid,
  p_user_id uuid,
  p_role public.workspace_role
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.workspace_role := public.workspace_role_of(p_workspace_id);
begin
  if v_actor is null then
    raise exception 'not a member of this workspace';
  end if;
  if v_actor not in ('owner', 'admin') then
    raise exception 'insufficient role to add members';
  end if;
  if p_role = 'owner' then
    raise exception 'owner role can only be granted through transfer_workspace_ownership';
  end if;
  if not exists (select 1 from auth.users u where u.id = p_user_id) then
    raise exception 'target user does not exist';
  end if;
  if exists (
    select 1 from public.workspace_memberships m
    where m.workspace_id = p_workspace_id and m.user_id = p_user_id
  ) then
    raise exception 'user is already a member';
  end if;

  insert into public.workspace_memberships (workspace_id, user_id, role)
  values (p_workspace_id, p_user_id, p_role);
end;
$$;

-- Modification de rôle : owner seul pour toucher un owner ou promouvoir
-- en owner ; admin peut gérer editor/admin mais jamais le owner.
create or replace function public.update_workspace_member_role(
  p_workspace_id uuid,
  p_user_id uuid,
  p_role public.workspace_role
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.workspace_role := public.workspace_role_of(p_workspace_id);
  v_target public.workspace_role;
begin
  if v_actor is null then
    raise exception 'not a member of this workspace';
  end if;

  select m.role into v_target
  from public.workspace_memberships m
  where m.workspace_id = p_workspace_id and m.user_id = p_user_id;

  if v_target is null then
    raise exception 'target user is not a member';
  end if;

  if p_role = 'owner' and v_actor <> 'owner' then
    raise exception 'only the owner can grant the owner role';
  end if;
  if v_target = 'owner' and v_actor <> 'owner' then
    raise exception 'only the owner can change the owner role';
  end if;
  if v_actor not in ('owner', 'admin') then
    raise exception 'insufficient role to update members';
  end if;

  update public.workspace_memberships m
  set role = p_role
  where m.workspace_id = p_workspace_id and m.user_id = p_user_id;
end;
$$;

-- Retrait d'un membre : owner/admin peuvent retirer les non-owner ;
-- chacun peut se retirer soi-même (sauf dernier owner, protégé plus bas).
create or replace function public.remove_workspace_member(
  p_workspace_id uuid,
  p_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.workspace_role := public.workspace_role_of(p_workspace_id);
  v_target public.workspace_role;
begin
  if v_actor is null then
    raise exception 'not a member of this workspace';
  end if;

  select m.role into v_target
  from public.workspace_memberships m
  where m.workspace_id = p_workspace_id and m.user_id = p_user_id;

  if v_target is null then
    raise exception 'target user is not a member';
  end if;

  if v_target = 'owner' and v_actor <> 'owner' then
    raise exception 'only the owner can remove the owner';
  end if;
  if v_actor not in ('owner', 'admin') and p_user_id <> auth.uid() then
    raise exception 'insufficient role to remove other members';
  end if;

  delete from public.workspace_memberships m
  where m.workspace_id = p_workspace_id and m.user_id = p_user_id;
end;
$$;

-- Transfert de propriété : l'owner actuel nomme un nouveau owner.
-- L'ancien owner devient admin. workspaces.owner_id est mis à jour ici
-- (le trigger blocke toute autre voie).
create or replace function public.transfer_workspace_ownership(
  p_workspace_id uuid,
  p_new_owner_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.workspace_role := public.workspace_role_of(p_workspace_id);
begin
  if v_actor <> 'owner' then
    raise exception 'only the owner can transfer ownership';
  end if;
  if p_new_owner_id = auth.uid() then
    raise exception 'new owner must be a different user';
  end if;
  if not exists (
    select 1 from public.workspace_memberships m
    where m.workspace_id = p_workspace_id and m.user_id = p_new_owner_id
  ) then
    raise exception 'new owner must already be a member';
  end if;

  update public.workspaces
  set owner_id = p_new_owner_id
  where id = p_workspace_id;

  update public.workspace_memberships
  set role = 'owner'
  where workspace_id = p_workspace_id and user_id = p_new_owner_id;

  update public.workspace_memberships
  set role = 'admin'
  where workspace_id = p_workspace_id and user_id = auth.uid();
end;
$$;

-- Garde-fou : un espace ne peut jamais se retrouver sans owner.
create or replace function public.assert_workspace_has_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' and old.role = 'owner' then
    if not exists (
      select 1 from public.workspace_memberships m
      where m.workspace_id = old.workspace_id and m.role = 'owner'
        and m.user_id <> old.user_id
    ) then
      raise exception 'a workspace must keep at least one owner (use transfer_workspace_ownership)';
    end if;
  end if;
  if tg_op = 'UPDATE' and old.role = 'owner' and new.role <> 'owner' then
    if not exists (
      select 1 from public.workspace_memberships m
      where m.workspace_id = old.workspace_id and m.role = 'owner'
        and m.user_id <> old.user_id
    ) then
      raise exception 'a workspace must keep at least one owner (use transfer_workspace_ownership)';
    end if;
  end if;
  return coalesce(new, old);
end;
$$;

create trigger workspace_memberships_assert_has_owner
  before delete or update on public.workspace_memberships
  for each row execute function public.assert_workspace_has_owner();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.workspaces enable row level security;
alter table public.workspace_memberships enable row level security;
alter table public.sites enable row level security;
alter table public.pages enable row level security;

-- workspaces : lecture réservée aux membres ; modification owner/admin ;
-- suppression owner ; insertion uniquement via create_workspace().
create policy workspaces_select_members on public.workspaces
  for select to authenticated
  using (public.is_workspace_member(id));

create policy workspaces_update_managers on public.workspaces
  for update to authenticated
  using (public.can_manage_workspace(id))
  with check (public.can_manage_workspace(id));

create policy workspaces_delete_owner on public.workspaces
  for delete to authenticated
  using (public.workspace_role_of(id) = 'owner');

-- workspace_memberships : lecture pour les membres ; écriture via fonctions
-- métier uniquement (pas de policy INSERT/UPDATE/DELETE directe) afin que
-- chaque mutation passe par les gardes-fous centralisés.
create policy workspace_memberships_select_members on public.workspace_memberships
  for select to authenticated
  using (public.is_workspace_member(workspace_id));

-- sites : membres en lecture ; owner/admin en création, owner/admin en
-- suppression ; owner/admin/editor en modification (champ workspace figé).
create policy sites_select_members on public.sites
  for select to authenticated
  using (public.is_workspace_member(workspace_id));

create policy sites_insert_managers on public.sites
  for insert to authenticated
  with check (
    public.can_create_sites(workspace_id)
    and created_by = auth.uid()
  );

create policy sites_update_editors on public.sites
  for update to authenticated
  using (public.can_edit_sites(workspace_id))
  with check (public.can_edit_sites(workspace_id));

create policy sites_delete_managers on public.sites
  for delete to authenticated
  using (public.can_delete_sites(workspace_id));

-- pages : membres du workspace parent du site, tous rôles (editor inclus).
create policy pages_select_members on public.pages
  for select to authenticated
  using (public.can_access_site(site_id));

create policy pages_insert_editors on public.pages
  for insert to authenticated
  with check (public.can_edit_page(site_id));

create policy pages_update_editors on public.pages
  for update to authenticated
  using (public.can_edit_page(site_id))
  with check (public.can_edit_page(site_id));

create policy pages_delete_editors on public.pages
  for delete to authenticated
  using (public.can_edit_page(site_id));

-- ---------------------------------------------------------------------------
-- Privileges : les fonctions security definer ne sont pas exécutables
-- par anon ni par le rôle public par défaut.
-- ---------------------------------------------------------------------------

revoke execute on function public.is_workspace_member(uuid) from public, anon;
revoke execute on function public.workspace_role_of(uuid) from public, anon;
revoke execute on function public.can_manage_workspace(uuid) from public, anon;
revoke execute on function public.can_create_sites(uuid) from public, anon;
revoke execute on function public.can_edit_sites(uuid) from public, anon;
revoke execute on function public.can_delete_sites(uuid) from public, anon;
revoke execute on function public.can_access_site(uuid) from public, anon;
revoke execute on function public.can_edit_page(uuid) from public, anon;
revoke execute on function public.create_workspace(text) from public, anon;
revoke execute on function public.add_workspace_member(uuid, uuid, public.workspace_role) from public, anon;
revoke execute on function public.update_workspace_member_role(uuid, uuid, public.workspace_role) from public, anon;
revoke execute on function public.remove_workspace_member(uuid, uuid) from public, anon;
revoke execute on function public.transfer_workspace_ownership(uuid, uuid) from public, anon;

grant execute on function public.is_workspace_member(uuid) to authenticated;
grant execute on function public.workspace_role_of(uuid) to authenticated;
grant execute on function public.can_manage_workspace(uuid) to authenticated;
grant execute on function public.can_create_sites(uuid) to authenticated;
grant execute on function public.can_edit_sites(uuid) to authenticated;
grant execute on function public.can_delete_sites(uuid) to authenticated;
grant execute on function public.can_access_site(uuid) to authenticated;
grant execute on function public.can_edit_page(uuid) to authenticated;
grant execute on function public.create_workspace(text) to authenticated;
grant execute on function public.add_workspace_member(uuid, uuid, public.workspace_role) to authenticated;
grant execute on function public.update_workspace_member_role(uuid, uuid, public.workspace_role) to authenticated;
grant execute on function public.remove_workspace_member(uuid, uuid) to authenticated;
grant execute on function public.transfer_workspace_ownership(uuid, uuid) to authenticated;

commit;
