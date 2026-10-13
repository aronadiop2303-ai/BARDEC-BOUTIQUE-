-- BARDEC-BOUTIQUE — Vérifications RLS (préparées, NON EXÉCUTÉES)
--
-- Ce script doit être exécuté uniquement sur une base de DÉVELOPPEMENT
-- (branche de test Supabase ou base locale), JAMAIS sur la production.
-- Il simule deux utilisateurs authentifiés distincts pour vérifier
-- l'isolation inter-espaces et la matrice de rôles.
--
-- Prérequis : la migration 20261012090000_core_multi_tenant.sql appliquée.
-- Exemple d'exécution (branche de développement uniquement) :
--   psql "$SUPABASE_DB_DEV_URL" -v ON_ERROR_STOP=1 -f supabase/tests/rls_verification.sql
--
-- Statut : PRÉPARÉ, NON EXÉCUTÉ. Tant que ce script n'a pas tourné avec
-- succès sur une base réelle, les politiques RLS ne sont pas considérées
-- comme vérifiées.

\set ON_ERROR_STOP on

begin;

-- Deux utilisateurs de test (auth.users requiert des droits élevés :
-- exécuter avec la connexion owner/admin de la base de développement).
insert into auth.users (id, email, email_confirmed_at, aud, role)
values
  ('00000000-0000-4000-8000-000000000001', 'rls-test-alice@example.test', now(), 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-000000000002', 'rls-test-bob@example.test',   now(), 'authenticated', 'authenticated');

-- ---------------------------------------------------------------------------
-- Scénario 1 — Alice (owner) crée son espace, Bob (intrus) ne voit rien
-- ---------------------------------------------------------------------------
select set_config('role', 'authenticated', true);
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

select public.create_workspace('Espace Alice') as alice_workspace_id \gset

do $$
begin
  if (select count(*) from public.workspaces) <> 1 then
    raise exception 'ECHEC: Alice devrait voir exactement 1 espace';
  end if;
end $$;

-- Bob ne doit voir aucun espace ni aucun membre.
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-000000000002","role":"authenticated"}', true);

do $$
begin
  if (select count(*) from public.workspaces) <> 0 then
    raise exception 'ECHEC: Bob ne doit voir aucun espace (isolation inter-espaces)';
  end if;
  if (select count(*) from public.workspace_memberships) <> 0 then
    raise exception 'ECHEC: Bob ne doit voir aucune appartenance';
  end if;
  if (select count(*) from public.sites) <> 0 then
    raise exception 'ECHEC: Bob ne doit voir aucun site';
  end if;
end $$;

-- Bob ne peut pas modifier un espace qu'il ne voit pas (0 ligne, pas d'erreur).
update public.workspaces set name = 'Piraté' where id = :'alice_workspace_id';
do $$
begin
  if (select count(*) from public.workspaces where name = 'Piraté') <> 0 then
    raise exception 'ECHEC: Bob ne doit pas pouvoir renommer un espace étranger';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Scénario 2 — Alice ajoute Bob comme editor ; les rôles sont respectés
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

select public.add_workspace_member(
  :'alice_workspace_id',
  '00000000-0000-4000-8000-000000000002',
  'editor'
);

-- Alice (owner) crée un site.
insert into public.sites (workspace_id, name, category, created_by)
values (:'alice_workspace_id', 'Boutique Alice', 'Commerce',
        '00000000-0000-4000-8000-000000000001');

-- Bob (editor) voit le site et peut modifier le contenu.
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-000000000002","role":"authenticated"}', true);

do $$
begin
  if (select count(*) from public.sites) <> 1 then
    raise exception 'ECHEC: Bob (editor) devrait voir le site de son espace';
  end if;
end $$;

update public.sites set name = 'Boutique Alice v2'
where name = 'Boutique Alice';
do $$
begin
  if (select count(*) from public.sites where name = 'Boutique Alice v2') <> 1 then
    raise exception 'ECHEC: Bob (editor) devrait pouvoir modifier un site';
  end if;
end $$;

-- L'editor ne peut PAS créer un site (action owner/admin uniquement).
do $$
begin
  begin
    insert into public.sites (workspace_id, name, created_by)
    values ('00000000-0000-4000-8000-000000000001', 'Site interdit',
            '00000000-0000-4000-8000-000000000002');
    raise exception 'ECHEC: un editor ne devrait pas pouvoir créer un site';
  exception when insufficient_privilege or check_violation or raise_exception then
    if sqlerrm like 'ECHEC%' then raise; end if;
    -- rejet attendu
  end;
end $$;

-- L'editor ne peut PAS supprimer un site.
do $$
begin
  begin
    delete from public.sites;
    raise exception 'ECHEC: un editor ne devrait pas pouvoir supprimer un site';
  exception when insufficient_privilege or check_violation or raise_exception then
    if sqlerrm like 'ECHEC%' then raise; end if;
  end;
  if (select count(*) from public.sites) <> 1 then
    raise exception 'ECHEC: le site ne doit pas avoir été supprimé par l''editor';
  end if;
end $$;

-- L'editor ne peut PAS s'auto-promouvoir owner (aucune INSERT directe sur memberships).
do $$
begin
  begin
    insert into public.workspace_memberships (workspace_id, user_id, role)
    values ('00000000-0000-4000-8000-000000000001',
            '00000000-0000-4000-8000-000000000002', 'owner');
    raise exception 'ECHEC: insertion directe sur workspace_memberships devrait être bloquée';
  exception when insufficient_privilege or check_violation or raise_exception then
    if sqlerrm like 'ECHEC%' then raise; end if;
  end;
end $$;

-- L'editor ne peut pas accorder le rôle owner via la fonction (refusée).
do $$
begin
  begin
    perform public.update_workspace_member_role(
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000002', 'owner');
    raise exception 'ECHEC: un editor ne devrait pas pouvoir promouvoir en owner';
  exception when insufficient_privilege or check_violation or raise_exception then
    if sqlerrm like 'ECHEC%' then raise; end if;
  end;
end $$;

-- ---------------------------------------------------------------------------
-- Scénario 3 — pages : l'editor gère les pages, l'isolement tient
-- ---------------------------------------------------------------------------
do $$
declare v_site uuid;
begin
  select id into v_site from public.sites limit 1;
  insert into public.pages (site_id, title, slug)
  values (v_site, 'Accueil', 'accueil');
end $$;

-- Bob ne voit toujours pas les pages d'un site hors de son espace :
-- créer un second espace d'Alice sans Bob pour le vérifier.
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

select public.create_workspace('Espace privé Alice') as alice_private_ws \gset

insert into public.sites (workspace_id, name, created_by)
values (:'alice_private_ws', 'Site privé', '00000000-0000-4000-8000-000000000001');

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-000000000002","role":"authenticated"}', true);

do $$
begin
  if (select count(*) from public.sites) <> 1 then
    raise exception 'ECHEC: Bob ne doit voir que les sites de son espace (1 attendu)';
  end if;
  if (select count(*) from public.sites where name = 'Site privé') <> 0 then
    raise exception 'ECHEC: Bob ne doit pas voir le site privé d''Alice';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Nettoyage (base de développement uniquement) et fin de transaction
-- ---------------------------------------------------------------------------
select set_config('role', 'postgres', true);
delete from auth.users
where id in (
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000002'
);

commit;

select 'TOUS LES TESTS RLS ONT REUSSI' as resultat;
