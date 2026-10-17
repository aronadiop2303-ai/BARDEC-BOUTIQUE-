-- =============================================================================
-- Équipe et comptes (lot C, partie 1/2) : rôles métier par boutique — ADDITIVE
-- =============================================================================
-- STATUT : PRÉPARÉE, NON APPLIQUÉE, NON TESTÉE EN EXÉCUTION.
-- Nature : uniquement de nouveaux objets (2 tables avec RLS activée, fonctions, index). Aucun objet existant
-- n'est modifié, aucune politique ni aucun droit existant n'est changé.
-- Effet seule : aucun changement de comportement des ventes, du stock ni de l'import (les fonctions existantes
-- utilisent toujours private.site_role). L'application des rôles est dans la partie 2/2
-- (20261017160100_team_roles_enforcement), qui exige une autorisation écrite.
--
-- PRÉREQUIS : pos_sales_foundation (private.site_role), private.has_workspace_access existante.
--
-- CONTENU
--   a) public.site_staff : rôle métier d'un utilisateur dans UNE boutique (manager, cashier, stock_keeper, driver),
--      actif ou non, invité par qui. Lecture : soi-même, propriétaire et gérant de la boutique. Aucune écriture directe.
--   b) public.team_audit_events : journal des invitations, changements de rôle, désactivations. Lecture :
--      propriétaire et gérant. Aucune écriture directe.
--   c) private.staff_role_of(site, user) et private.staff_role(site) : rôle effectif.
--        1. propriétaire de l'espace → 'owner' (toujours, ne peut pas être retiré) ;
--        2. sinon ligne site_staff : active → son rôle ; désactivée → null (aucun droit, même avec une adhésion) ;
--        3. sinon ancien rôle de membre : admin → manager, editor → cashier, publisher et viewer → viewer.
--      private.staff_role est exécutable par authenticated (elle ne renvoie que le rôle de l'appelant) : les
--      politiques RESTRICTIVE de la partie 2/2 l'utilisent.
--   d) public.current_staff_role(site) : rôle de l'appelant, pour l'interface.
--   e) public.list_site_staff(site) : équipe (e-mail, nom, rôle, statut), propriétaire et gérant seulement.
--   f) public.set_staff_role(site, user, rôle) et public.set_staff_active(site, user, actif, motif).
--   g) public.staff_lookup_user_id(email) et public.staff_register_invitation(site, user, rôle, invité_par) :
--      réservées à service_role, appelées UNIQUEMENT par l'Edge Function invite-staff.
--
-- RÈGLES (identiques à supabase/functions/_shared/team-rules.ts)
--   - Le propriétaire attribue tous les rôles d'équipe ; un gérant attribue cashier, stock_keeper, driver.
--   - Personne ne modifie son propre rôle ni ne se désactive ; personne ne touche au propriétaire ; un gérant
--     ne modifie pas un autre gérant. Le propriétaire (workspaces.owner_id) n'a jamais de ligne site_staff :
--     le dernier propriétaire ne peut donc pas être retiré.
--   - Invitation : si l'utilisateur n'a aucune adhésion à l'espace, une adhésion 'viewer' est créée (lecture du
--     catalogue par la RLS existante, option 1) et marquée membership_created ; elle est supprimée à la
--     désactivation s'il n'a plus aucun rôle actif dans l'espace, recréée à la réactivation.
--   - Toute action est journalisée dans team_audit_events.
--
-- LIMITE CONNUE (option 1, décision du propriétaire) : l'adhésion 'viewer' donne la lecture des tables couvertes
-- par la RLS existante pour TOUTES les boutiques du même espace. Les tables sensibles sont resserrées par
-- boutique et par rôle dans la partie 2/2.
--
-- RETOUR ARRIÈRE (une seule transaction ; avant tout, supprimer les adhésions créées par invitation :
--   delete from public.workspace_memberships m using public.site_staff s, public.sites t
--     where s.membership_created and t.id = s.site_id and m.workspace_id = t.workspace_id and m.user_id = s.user_id;)
--   drop function if exists public.staff_register_invitation(uuid, uuid, text, uuid);
--   drop function if exists public.staff_lookup_user_id(text);
--   drop function if exists public.set_staff_active(uuid, uuid, boolean, text);
--   drop function if exists public.set_staff_role(uuid, uuid, text);
--   drop function if exists public.list_site_staff(uuid);
--   drop function if exists public.current_staff_role(uuid);
--   drop function if exists private.staff_role(uuid);
--   drop function if exists private.staff_role_of(uuid, uuid);
--   drop function if exists private.can_assign_staff_role(text, text);
--   drop table if exists public.team_audit_events;
--   drop table if exists public.site_staff;
-- =============================================================================


-- -----------------------------------------------------------------------------
-- a) Rôles par boutique
-- -----------------------------------------------------------------------------
create table public.site_staff (
  site_id uuid not null references public.sites(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  staff_role text not null
    constraint site_staff_role_check check (staff_role in ('manager', 'cashier', 'stock_keeper', 'driver')),
  is_active boolean not null default true,
  membership_created boolean not null default false,
  invited_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deactivated_at timestamptz,
  deactivated_by uuid references auth.users(id) on delete set null,
  primary key (site_id, user_id)
);

create index site_staff_user_idx on public.site_staff (user_id);

alter table public.site_staff enable row level security;
revoke all on public.site_staff from anon, authenticated;


-- -----------------------------------------------------------------------------
-- b) Journal d'équipe
-- -----------------------------------------------------------------------------
create table public.team_audit_events (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.sites(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  target_user_id uuid references auth.users(id) on delete set null,
  action text not null
    constraint team_audit_events_action_check check (action in ('invite', 'role_change', 'deactivate', 'reactivate')),
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index team_audit_events_site_idx on public.team_audit_events (site_id, created_at desc);

alter table public.team_audit_events enable row level security;
revoke all on public.team_audit_events from anon, authenticated;


-- -----------------------------------------------------------------------------
-- c) Rôle effectif
-- -----------------------------------------------------------------------------
create or replace function private.staff_role_of(p_site_id uuid, p_user_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $function$
  select case
    when p_user_id is null then null
    when w.owner_id = p_user_id then 'owner'
    when st.user_id is not null then case when st.is_active then st.staff_role end
    else case m.role
      when 'admin' then 'manager'
      when 'editor' then 'cashier'
      when 'publisher' then 'viewer'
      when 'viewer' then 'viewer'
    end
  end
  from public.sites s
  join public.workspaces w on w.id = s.workspace_id
  left join public.site_staff st on st.site_id = s.id and st.user_id = p_user_id
  left join public.workspace_memberships m on m.workspace_id = w.id and m.user_id = p_user_id
  where s.id = p_site_id;
$function$;

revoke all on function private.staff_role_of(uuid, uuid) from public, anon, authenticated;

create or replace function private.staff_role(p_site_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $function$
  select private.staff_role_of(p_site_id, (select auth.uid()));
$function$;

revoke all on function private.staff_role(uuid) from public, anon;
grant execute on function private.staff_role(uuid) to authenticated;

create or replace function private.can_assign_staff_role(p_caller_role text, p_target_role text)
returns boolean
language sql
immutable
set search_path = ''
as $function$
  select p_target_role in ('manager', 'cashier', 'stock_keeper', 'driver')
     and (p_caller_role = 'owner' or (p_caller_role = 'manager' and p_target_role <> 'manager'));
$function$;

revoke all on function private.can_assign_staff_role(text, text) from public, anon, authenticated;

-- Politiques de lecture des deux nouvelles tables (créées après la fonction qu'elles appellent).
create policy site_staff_self_or_manager_read on public.site_staff
  for select to authenticated
  using (user_id = (select auth.uid()) or private.staff_role(site_id) in ('owner', 'manager'));
grant select on public.site_staff to authenticated;

create policy team_audit_events_manager_read on public.team_audit_events
  for select to authenticated
  using (private.staff_role(site_id) in ('owner', 'manager'));
grant select on public.team_audit_events to authenticated;


-- -----------------------------------------------------------------------------
-- d) Rôle de l'appelant
-- -----------------------------------------------------------------------------
create or replace function public.current_staff_role(p_site_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $function$
  select private.staff_role(p_site_id);
$function$;

revoke all on function public.current_staff_role(uuid) from public, anon;
grant execute on function public.current_staff_role(uuid) to authenticated;


-- -----------------------------------------------------------------------------
-- e) Liste de l'équipe (propriétaire et gérant)
-- -----------------------------------------------------------------------------
create or replace function public.list_site_staff(p_site_id uuid)
returns table (
  user_id uuid, email text, display_name text, staff_role text, is_active boolean,
  invited_by_name text, created_at timestamptz, last_sign_in_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  if coalesce(private.staff_role(p_site_id), '') not in ('owner', 'manager') then
    raise exception 'Équipe réservée au propriétaire et au gérant.' using errcode = '42501';
  end if;
  return query
    select w.owner_id, u.email::text, p.display_name, 'owner'::text, true, null::text, w.created_at, u.last_sign_in_at
    from public.sites s
    join public.workspaces w on w.id = s.workspace_id
    left join auth.users u on u.id = w.owner_id
    left join public.profiles p on p.user_id = w.owner_id
    where s.id = p_site_id
    union all
    select st.user_id, u.email::text, p.display_name, st.staff_role, st.is_active, ip.display_name, st.created_at, u.last_sign_in_at
    from public.site_staff st
    left join auth.users u on u.id = st.user_id
    left join public.profiles p on p.user_id = st.user_id
    left join public.profiles ip on ip.user_id = st.invited_by
    where st.site_id = p_site_id;
end;
$function$;

revoke all on function public.list_site_staff(uuid) from public, anon;
grant execute on function public.list_site_staff(uuid) to authenticated;


-- -----------------------------------------------------------------------------
-- f) Changement de rôle, désactivation
-- -----------------------------------------------------------------------------
-- Contrôles communs : appelant connecté, cible ≠ appelant, cible ≠ propriétaire, cible membre de l'équipe.
create or replace function public.set_staff_role(p_site_id uuid, p_user_id uuid, p_staff_role text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_caller text := private.staff_role(p_site_id);
  v_staff public.site_staff%rowtype;
begin
  if v_uid is null then
    raise exception 'Connexion requise.' using errcode = '42501';
  end if;
  if p_user_id = v_uid then
    raise exception 'Vous ne pouvez pas modifier votre propre rôle.' using errcode = '42501';
  end if;
  if private.staff_role_of(p_site_id, p_user_id) = 'owner' then
    raise exception 'Le propriétaire ne peut pas être modifié.' using errcode = '42501';
  end if;
  select * into v_staff from public.site_staff where site_id = p_site_id and user_id = p_user_id for update;
  if not found then
    raise exception 'Cette personne ne fait pas partie de l''équipe de la boutique.' using errcode = '22023';
  end if;
  if not private.can_assign_staff_role(v_caller, p_staff_role)
     or (v_caller = 'manager' and v_staff.staff_role = 'manager') then
    raise exception 'Changement de rôle refusé pour votre rôle.' using errcode = '42501';
  end if;

  update public.site_staff set staff_role = p_staff_role, updated_at = now()
  where site_id = p_site_id and user_id = p_user_id;
  insert into public.team_audit_events (site_id, actor_user_id, target_user_id, action, details)
  values (p_site_id, v_uid, p_user_id, 'role_change', jsonb_build_object('from', v_staff.staff_role, 'to', p_staff_role));
  return jsonb_build_object('user_id', p_user_id, 'staff_role', p_staff_role);
end;
$function$;

revoke all on function public.set_staff_role(uuid, uuid, text) from public, anon;
grant execute on function public.set_staff_role(uuid, uuid, text) to authenticated;

create or replace function public.set_staff_active(p_site_id uuid, p_user_id uuid, p_active boolean, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_caller text := private.staff_role(p_site_id);
  v_staff public.site_staff%rowtype;
  v_workspace uuid;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if v_uid is null then
    raise exception 'Connexion requise.' using errcode = '42501';
  end if;
  if p_active is null then
    raise exception 'Statut manquant.' using errcode = '22023';
  end if;
  if p_user_id = v_uid then
    raise exception 'Vous ne pouvez pas modifier votre propre accès.' using errcode = '42501';
  end if;
  if private.staff_role_of(p_site_id, p_user_id) = 'owner' then
    raise exception 'Le propriétaire ne peut pas être désactivé.' using errcode = '42501';
  end if;
  select * into v_staff from public.site_staff where site_id = p_site_id and user_id = p_user_id for update;
  if not found then
    raise exception 'Cette personne ne fait pas partie de l''équipe de la boutique.' using errcode = '22023';
  end if;
  if v_caller is null or v_caller not in ('owner', 'manager') or (v_caller = 'manager' and v_staff.staff_role = 'manager') then
    raise exception 'Action refusée pour votre rôle.' using errcode = '42501';
  end if;
  if char_length(coalesce(v_reason, '')) > 300 then
    raise exception 'Motif trop long (300 caractères au plus).' using errcode = '22023';
  end if;
  if v_staff.is_active = p_active then
    return jsonb_build_object('user_id', p_user_id, 'is_active', p_active, 'changed', false);
  end if;

  select workspace_id into v_workspace from public.sites where id = p_site_id;
  update public.site_staff set
    is_active = p_active,
    updated_at = now(),
    deactivated_at = case when p_active then null else now() end,
    deactivated_by = case when p_active then null else v_uid end
  where site_id = p_site_id and user_id = p_user_id;

  if v_staff.membership_created then
    if p_active then
      insert into public.workspace_memberships (workspace_id, user_id, role)
      values (v_workspace, p_user_id, 'viewer')
      on conflict do nothing;
    elsif not exists (
      select 1 from public.site_staff o join public.sites t on t.id = o.site_id
      where o.user_id = p_user_id and o.is_active and t.workspace_id = v_workspace
    ) then
      delete from public.workspace_memberships
      where workspace_id = v_workspace and user_id = p_user_id and role = 'viewer';
    end if;
  end if;

  insert into public.team_audit_events (site_id, actor_user_id, target_user_id, action, details)
  values (p_site_id, v_uid, p_user_id, case when p_active then 'reactivate' else 'deactivate' end,
          jsonb_build_object('staff_role', v_staff.staff_role, 'reason', v_reason));
  return jsonb_build_object('user_id', p_user_id, 'is_active', p_active, 'changed', true);
end;
$function$;

revoke all on function public.set_staff_active(uuid, uuid, boolean, text) from public, anon;
grant execute on function public.set_staff_active(uuid, uuid, boolean, text) to authenticated;


-- -----------------------------------------------------------------------------
-- g) Invitation : appelée uniquement par l'Edge Function (service_role)
-- -----------------------------------------------------------------------------
create or replace function public.staff_lookup_user_id(p_email text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $function$
  select u.id from auth.users u where lower(u.email) = lower(btrim(p_email)) limit 1;
$function$;

revoke all on function public.staff_lookup_user_id(text) from public, anon, authenticated;
grant execute on function public.staff_lookup_user_id(text) to service_role;

-- p_invited_by : utilisateur vérifié par l'Edge Function (jeton de l'appelant) ; ses droits sont recontrôlés ici.
create or replace function public.staff_register_invitation(p_site_id uuid, p_user_id uuid, p_staff_role text, p_invited_by uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_caller text := private.staff_role_of(p_site_id, p_invited_by);
  v_workspace uuid;
  v_existing public.site_staff%rowtype;
  v_membership_created boolean := false;
begin
  if p_invited_by is null or p_user_id is null then
    raise exception 'Invitation incomplète.' using errcode = '22023';
  end if;
  if p_user_id = p_invited_by then
    raise exception 'Vous ne pouvez pas vous inviter vous-même.' using errcode = '42501';
  end if;
  if not private.can_assign_staff_role(v_caller, p_staff_role) then
    raise exception 'Invitation refusée : votre rôle ne permet pas d''attribuer ce rôle.' using errcode = '42501';
  end if;
  if private.staff_role_of(p_site_id, p_user_id) = 'owner' then
    raise exception 'Cette personne est déjà propriétaire de la boutique.' using errcode = '22023';
  end if;

  select workspace_id into v_workspace from public.sites where id = p_site_id;
  select * into v_existing from public.site_staff where site_id = p_site_id and user_id = p_user_id for update;
  if found then
    if v_caller = 'manager' and v_existing.staff_role = 'manager' then
      raise exception 'Invitation refusée : cette personne est gérante.' using errcode = '42501';
    end if;
    raise exception 'Cette personne fait déjà partie de l''équipe : changez son rôle ou réactivez-la.' using errcode = '23505';
  end if;

  if not exists (select 1 from public.workspace_memberships where workspace_id = v_workspace and user_id = p_user_id) then
    insert into public.workspace_memberships (workspace_id, user_id, role) values (v_workspace, p_user_id, 'viewer');
    v_membership_created := true;
  end if;

  insert into public.site_staff (site_id, user_id, staff_role, membership_created, invited_by)
  values (p_site_id, p_user_id, p_staff_role, v_membership_created, p_invited_by);
  insert into public.team_audit_events (site_id, actor_user_id, target_user_id, action, details)
  values (p_site_id, p_invited_by, p_user_id, 'invite', jsonb_build_object('staff_role', p_staff_role, 'membership_created', v_membership_created));

  return jsonb_build_object('user_id', p_user_id, 'staff_role', p_staff_role, 'membership_created', v_membership_created);
end;
$function$;

revoke all on function public.staff_register_invitation(uuid, uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.staff_register_invitation(uuid, uuid, text, uuid) to service_role;
