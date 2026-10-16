-- =============================================================================
-- NE JAMAIS EXÉCUTER SUR LE PROJET RÉEL.
-- =============================================================================
-- Test de la migration 20261016065800_pos_cash_lockdown.sql.
-- STATUT : NON TESTÉE (Docker indisponible : ce fichier n'a jamais été exécuté).
-- Base locale jetable uniquement, en tant que postgres, après TOUTES les migrations :
--   psql -v ON_ERROR_STOP=1 -f supabase/tests/pos_cash_lockdown.test.sql
-- Transaction terminée par ROLLBACK.
-- =============================================================================

begin;

insert into auth.users (id, email) values
  ('c0000000-0000-4000-8000-000000000001', 'owner-c@test.local'),
  ('c0000000-0000-4000-8000-000000000002', 'editor-c@test.local'),
  ('c0000000-0000-4000-8000-000000000003', 'publisher-c@test.local');
insert into public.workspaces (id, owner_id, name, slug) values
  ('c1000000-0000-4000-8000-000000000000', 'c0000000-0000-4000-8000-000000000001', 'Espace C', 'espace-c-test');
insert into public.workspace_memberships (workspace_id, user_id, role) values
  ('c1000000-0000-4000-8000-000000000000', 'c0000000-0000-4000-8000-000000000002', 'editor'),
  ('c1000000-0000-4000-8000-000000000000', 'c0000000-0000-4000-8000-000000000003', 'publisher');
insert into public.sites (id, workspace_id, name, slug, site_type) values
  ('c2000000-0000-4000-8000-000000000000', 'c1000000-0000-4000-8000-000000000000', 'Quincaillerie C', 'quincaillerie-c-test', 'store');

create temporary table lock_results (k text, v uuid) on commit drop;
grant all on lock_results to authenticated;

-- Publisher : ouverture refusée (directe ou par fonction).
select set_config('request.jwt.claims', '{"sub":"c0000000-0000-4000-8000-000000000003","role":"authenticated"}', true);
set local role authenticated;
do $test$
begin
  perform public.open_cash_session('c2000000-0000-4000-8000-000000000000', 0);
  raise exception 'ÉCHEC 1 : ouverture acceptée pour un publisher';
exception when sqlstate '42501' then raise notice 'OK 1 : publisher refusé';
end;
$test$;
reset role;

-- Editor : insertion directe refusée, ouverture par fonction acceptée, double ouverture refusée,
-- mouvement direct et modification directe refusés.
select set_config('request.jwt.claims', '{"sub":"c0000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
set local role authenticated;
do $test$
begin
  insert into public.cash_register_sessions (site_id, opened_by, opening_cash)
  values ('c2000000-0000-4000-8000-000000000000', 'c0000000-0000-4000-8000-000000000002', 0);
  raise exception 'ÉCHEC 2 : ouverture directe acceptée';
exception when insufficient_privilege then raise notice 'OK 2 : ouverture directe refusée';
end;
$test$;

insert into lock_results select 'session', public.open_cash_session('c2000000-0000-4000-8000-000000000000', 5000, 'Caisse principale', 'Matin');

do $test$
begin
  perform public.open_cash_session('c2000000-0000-4000-8000-000000000000', 0);
  raise exception 'ÉCHEC 3 : deuxième session ouverte acceptée';
exception when unique_violation then raise notice 'OK 3 : double ouverture refusée';
end;
$test$;

do $test$
begin
  insert into public.cash_register_movements (site_id, session_id, actor_user_id, movement_type, amount)
  values ('c2000000-0000-4000-8000-000000000000', (select v from lock_results where k = 'session'),
    'c0000000-0000-4000-8000-000000000002', 'cash_out', 1000);
  raise exception 'ÉCHEC 4 : mouvement de caisse direct accepté';
exception when insufficient_privilege then raise notice 'OK 4 : mouvement direct refusé';
end;
$test$;

do $test$
begin
  update public.cash_register_sessions set opening_cash = 0 where id = (select v from lock_results where k = 'session');
  raise exception 'ÉCHEC 5 : modification directe acceptée';
exception when insufficient_privilege then raise notice 'OK 5 : modification directe refusée';
end;
$test$;

do $test$
begin
  perform public.open_cash_session('c2000000-0000-4000-8000-000000000000', 10.5, 'Caisse 2');
  raise exception 'ÉCHEC 6 : fond de caisse non arrondi accepté';
exception when sqlstate '22023' then raise notice 'OK 6 : fond non arrondi refusé';
end;
$test$;

-- La clôture par fonction reste possible pour la personne qui a ouvert.
select public.close_cash_session((select v from lock_results where k = 'session'), 5000, 'Fin');
reset role;

do $test$
begin
  assert (select opening_cash from public.cash_register_sessions where id = (select v from lock_results where k = 'session')) = 5000,
    'fond de caisse modifié';
  assert (select status from public.cash_register_sessions where id = (select v from lock_results where k = 'session')) = 'closed',
    'clôture par fonction';
  assert not exists (select 1 from pg_policies where schemaname = 'public'
    and policyname in ('cash_movements_member_insert', 'cash_sessions_member_insert', 'cash_sessions_owner_or_opener_update')),
    'politiques d''écriture directe encore présentes';
  raise notice 'OK : toutes les vérifications sont passées.';
end;
$test$;

rollback;
