-- =============================================================================
-- NE JAMAIS EXÉCUTER SUR LE PROJET RÉEL.
-- =============================================================================
-- Test de la migration 20261014213517_core_security_hardening.sql.
-- À exécuter UNIQUEMENT sur une base locale jetable (supabase start), en tant que postgres,
-- après application de toutes les migrations :
--   psql -v ON_ERROR_STOP=1 -f supabase/tests/core_security_hardening.test.sql
-- Tout est fait dans une transaction terminée par ROLLBACK : aucune donnée ne reste.
-- Chaque scénario réussi affiche « OK (n) » ; le premier échec interrompt le script.
--
-- Scénarios :
--   (1) A ne voit ni ne modifie les sites de B
--   (2) un éditeur ne peut ni insérer ni passer un site en published
--   (3) publisher, admin et propriétaire peuvent publier (published_at renseigné)
--   (4) anon ne peut rien écrire et ne voit que les sites published
--   (5) TRUNCATE refusé à authenticated (et à anon)
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- Données de test (rôle postgres : contourne RLS, passe la garde comme rôle serveur)
-- -----------------------------------------------------------------------------
-- A : propriétaire de l'espace A ; B : propriétaire de l'espace B
-- E : éditeur de A ; P : publisher de A ; D : admin de A
insert into auth.users (id, email, aud, role) values
  ('00000000-0000-0000-0000-00000000000a', 'a@test.local', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-00000000000b', 'b@test.local', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-00000000000e', 'e@test.local', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000f0', 'p@test.local', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-00000000000d', 'd@test.local', 'authenticated', 'authenticated');

insert into public.workspaces (id, owner_id, name, slug) values
  ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000a', 'Espace A', 'test-espace-a'),
  ('10000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-00000000000b', 'Espace B', 'test-espace-b');

insert into public.workspace_memberships (workspace_id, user_id, role) values
  ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000e', 'editor'),
  ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000f0', 'publisher'),
  ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000d', 'admin');

insert into public.sites (id, workspace_id, name, slug, status) values
  ('20000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-00000000000a', 'A brouillon 1', 'a-brouillon-1', 'draft'),
  ('20000000-0000-0000-0000-0000000000a2', '10000000-0000-0000-0000-00000000000a', 'A brouillon 2', 'a-brouillon-2', 'draft'),
  ('20000000-0000-0000-0000-0000000000a3', '10000000-0000-0000-0000-00000000000a', 'A brouillon 3', 'a-brouillon-3', 'draft'),
  ('20000000-0000-0000-0000-0000000000b1', '10000000-0000-0000-0000-00000000000b', 'B brouillon', 'b-brouillon', 'draft'),
  ('20000000-0000-0000-0000-0000000000b2', '10000000-0000-0000-0000-00000000000b', 'B publié', 'b-publie', 'published');

-- Le rôle serveur renseigne published_at à la première publication.
do $$
begin
  if (select published_at from public.sites where id = '20000000-0000-0000-0000-0000000000b2') is null then
    raise exception 'ÉCHEC (0) : published_at non renseigné pour un site publié par un rôle serveur';
  end if;
  raise notice 'OK (0) : données de test créées';
end $$;


-- -----------------------------------------------------------------------------
-- (1) A ne voit ni ne modifie les sites de B
-- -----------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);

do $$
declare n int;
begin
  if exists (select 1 from public.sites where id = '20000000-0000-0000-0000-0000000000b1') then
    raise exception 'ÉCHEC (1a) : A voit le brouillon de B';
  end if;

  update public.sites set name = 'piraté' where id = '20000000-0000-0000-0000-0000000000b1';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'ÉCHEC (1b) : A a modifié le brouillon de B'; end if;

  update public.sites set name = 'piraté' where id = '20000000-0000-0000-0000-0000000000b2';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'ÉCHEC (1c) : A a modifié le site publié de B'; end if;

  delete from public.sites where workspace_id = '10000000-0000-0000-0000-00000000000b';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'ÉCHEC (1d) : A a supprimé un site de B'; end if;

  begin
    insert into public.sites (workspace_id, name, slug)
    values ('10000000-0000-0000-0000-00000000000b', 'intrus', 'intrus');
    raise exception 'ÉCHEC (1e) : A a créé un site dans l''espace de B';
  exception when insufficient_privilege then null;  -- RLS : refus attendu
  end;

  raise notice 'OK (1) : A ne voit ni ne modifie les sites de B';
end $$;


-- -----------------------------------------------------------------------------
-- (2) Un éditeur ne peut ni insérer ni passer un site en published
-- -----------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000e","role":"authenticated"}', true);

do $$
begin
  begin
    insert into public.sites (workspace_id, name, slug, status)
    values ('10000000-0000-0000-0000-00000000000a', 'E publié', 'e-publie', 'published');
    raise exception 'ÉCHEC (2a) : un éditeur a inséré un site publié';
  exception when insufficient_privilege then
    if sqlerrm not like 'Publication refusée%' then
      raise exception 'ÉCHEC (2a) : refus inattendu (%)', sqlerrm;
    end if;
  end;

  begin
    update public.sites set status = 'published' where id = '20000000-0000-0000-0000-0000000000a1';
    raise exception 'ÉCHEC (2b) : un éditeur a publié un brouillon';
  exception when insufficient_privilege then
    if sqlerrm not like 'Publication refusée%' then
      raise exception 'ÉCHEC (2b) : refus inattendu (%)', sqlerrm;
    end if;
  end;

  -- L'éditeur peut toujours créer et modifier des brouillons…
  insert into public.sites (workspace_id, name, slug)
  values ('10000000-0000-0000-0000-00000000000a', 'E brouillon', 'e-brouillon');
  update public.sites set name = 'A brouillon 1 renommé' where id = '20000000-0000-0000-0000-0000000000a1';

  -- …mais ne peut pas fixer published_at lui-même.
  update public.sites set published_at = now() where id = '20000000-0000-0000-0000-0000000000a1';
  if (select published_at from public.sites where id = '20000000-0000-0000-0000-0000000000a1') is not null then
    raise exception 'ÉCHEC (2c) : un éditeur a fixé published_at';
  end if;

  if (select status from public.sites where id = '20000000-0000-0000-0000-0000000000a1') <> 'draft' then
    raise exception 'ÉCHEC (2d) : le brouillon a changé de statut';
  end if;

  raise notice 'OK (2) : l''éditeur ne peut ni insérer ni passer un site en published';
end $$;


-- -----------------------------------------------------------------------------
-- (3) Publisher, admin et propriétaire peuvent publier
-- -----------------------------------------------------------------------------
-- Publisher : passe un brouillon en published.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000f0","role":"authenticated"}', true);
do $$
begin
  update public.sites set status = 'published' where id = '20000000-0000-0000-0000-0000000000a1';
  if (select published_at from public.sites where id = '20000000-0000-0000-0000-0000000000a1') is null then
    raise exception 'ÉCHEC (3a) : publication par le publisher sans published_at';
  end if;
  raise notice 'OK (3a) : le publisher publie';
end $$;

-- Admin : insère directement un site publié.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000d","role":"authenticated"}', true);
do $$
begin
  insert into public.sites (workspace_id, name, slug, status)
  values ('10000000-0000-0000-0000-00000000000a', 'D publié', 'd-publie', 'published');
  if (select published_at from public.sites where slug = 'd-publie') is null then
    raise exception 'ÉCHEC (3b) : insertion publiée par l''admin sans published_at';
  end if;
  update public.sites set status = 'published' where id = '20000000-0000-0000-0000-0000000000a2';
  raise notice 'OK (3b) : l''admin publie';
end $$;

-- Propriétaire : publie, archive puis republie ; la date de première publication est conservée.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);
do $$
declare first_published timestamptz;
begin
  update public.sites set status = 'published' where id = '20000000-0000-0000-0000-0000000000a3';
  select published_at into first_published from public.sites where id = '20000000-0000-0000-0000-0000000000a3';
  if first_published is null then
    raise exception 'ÉCHEC (3c) : publication par le propriétaire sans published_at';
  end if;
  update public.sites set status = 'archived' where id = '20000000-0000-0000-0000-0000000000a3';
  update public.sites set status = 'published', published_at = '2000-01-01' where id = '20000000-0000-0000-0000-0000000000a3';
  if (select published_at from public.sites where id = '20000000-0000-0000-0000-0000000000a3') is distinct from first_published then
    raise exception 'ÉCHEC (3d) : la date de première publication n''est pas conservée';
  end if;
  raise notice 'OK (3) : publisher, admin et propriétaire publient';
end $$;


-- -----------------------------------------------------------------------------
-- (4) anon ne peut rien écrire et ne voit que les sites published
-- -----------------------------------------------------------------------------
reset role;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;

do $$
begin
  if exists (select 1 from public.sites where status <> 'published') then
    raise exception 'ÉCHEC (4a) : anon voit un site non publié';
  end if;
  if not exists (select 1 from public.sites where id = '20000000-0000-0000-0000-0000000000b2') then
    raise exception 'ÉCHEC (4b) : anon ne voit pas un site publié';
  end if;

  begin
    insert into public.sites (workspace_id, name, slug)
    values ('10000000-0000-0000-0000-00000000000a', 'anon', 'anon');
    raise exception 'ÉCHEC (4c) : anon a inséré un site';
  exception when insufficient_privilege then null;
  end;

  begin
    update public.sites set name = 'anon' where id = '20000000-0000-0000-0000-0000000000b2';
    raise exception 'ÉCHEC (4d) : anon a pu exécuter UPDATE sur sites';
  exception when insufficient_privilege then null;
  end;

  begin
    delete from public.sites where id = '20000000-0000-0000-0000-0000000000b2';
    raise exception 'ÉCHEC (4e) : anon a pu exécuter DELETE sur sites';
  exception when insufficient_privilege then null;
  end;

  begin
    insert into public.workspaces (owner_id, name, slug)
    values ('00000000-0000-0000-0000-00000000000a', 'anon', 'anon-ws');
    raise exception 'ÉCHEC (4f) : anon a créé un espace';
  exception when insufficient_privilege then null;
  end;

  begin
    insert into public.profiles (user_id) values ('00000000-0000-0000-0000-00000000000a');
    raise exception 'ÉCHEC (4g) : anon a créé un profil';
  exception when insufficient_privilege then null;
  end;

  begin
    insert into public.site_pages (site_id, title)
    values ('20000000-0000-0000-0000-0000000000b2', 'anon');
    raise exception 'ÉCHEC (4h) : anon a créé une page';
  exception when insufficient_privilege then null;
  end;

  begin
    insert into public.workspace_memberships (workspace_id, user_id, role)
    values ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000b', 'admin');
    raise exception 'ÉCHEC (4i) : anon a créé une adhésion';
  exception when insufficient_privilege then null;
  end;

  raise notice 'OK (4) : anon ne peut rien écrire et ne voit que les sites publiés';
end $$;


-- -----------------------------------------------------------------------------
-- (5) TRUNCATE refusé à authenticated (et à anon)
-- -----------------------------------------------------------------------------
do $$
begin
  begin
    truncate public.sites cascade;
    raise exception 'ÉCHEC (5a) : anon a vidé la table sites';
  exception when insufficient_privilege then null;
  end;
  raise notice 'OK (5a) : TRUNCATE refusé à anon';
end $$;

reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);

do $$
begin
  begin
    truncate public.sites cascade;
    raise exception 'ÉCHEC (5b) : authenticated a vidé la table sites';
  exception when insufficient_privilege then null;
  end;
  begin
    truncate public.business_inquiries;
    raise exception 'ÉCHEC (5c) : authenticated a vidé business_inquiries';
  exception when insufficient_privilege then null;
  end;
  raise notice 'OK (5) : TRUNCATE refusé à authenticated';
end $$;


-- -----------------------------------------------------------------------------
-- Vérification statique des droits (rôle postgres)
-- -----------------------------------------------------------------------------
reset role;
do $$
declare r record;
begin
  for r in
    select c.relname, g.grantee, g.privilege_type
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
    join information_schema.role_table_grants g
      on g.table_schema = 'public' and g.table_name = c.relname
    where c.relkind in ('r', 'p')
      and g.grantee in ('anon', 'authenticated')
      and g.privilege_type in ('TRUNCATE', 'TRIGGER', 'REFERENCES')
  loop
    raise exception 'ÉCHEC (6a) : % a encore % sur %', r.grantee, r.privilege_type, r.relname;
  end loop;

  if has_table_privilege('anon', 'public.business_inquiries', 'INSERT') is not true then
    raise exception 'ÉCHEC (6b) : le formulaire de contact invité (business_inquiries) a été cassé';
  end if;

  raise notice 'OK (6) : plus aucun TRUNCATE/TRIGGER/REFERENCES pour anon/authenticated ; contact invité intact';
end $$;

rollback;
