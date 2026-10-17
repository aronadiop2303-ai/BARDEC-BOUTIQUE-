-- =============================================================================
-- NE JAMAIS EXÉCUTER SUR LE PROJET RÉEL.
-- =============================================================================
-- Test de la migration 20261018060000_barcode_unique.sql.
-- STATUT : NON TESTÉ EN EXÉCUTION (ni Docker ni CLI Supabase disponibles : ce fichier n'a jamais été exécuté).
-- Base locale jetable uniquement, en tant que postgres, après TOUTES les migrations :
--   psql -v ON_ERROR_STOP=1 -f supabase/tests/barcode_unique.test.sql
-- Transaction terminée par ROLLBACK : aucune donnée ne reste.
--
-- Scénarios : même code-barres deux fois dans une boutique refusé ; même code dans deux boutiques accepté ;
-- plusieurs produits sans code (null ou vide) acceptés.
-- =============================================================================

begin;

insert into auth.users (id, email) values ('e0100000-0000-4000-8000-000000000001', 'owner-bc@test.local');
insert into public.workspaces (id, owner_id, name, slug) values
  ('e1100000-0000-4000-8000-000000000000', 'e0100000-0000-4000-8000-000000000001', 'Espace BC', 'espace-bc-test');
insert into public.sites (id, workspace_id, name, slug, site_type) values
  ('e2100000-0000-4000-8000-000000000001', 'e1100000-0000-4000-8000-000000000000', 'Boutique 1', 'boutique-1-bc-test', 'store'),
  ('e2100000-0000-4000-8000-000000000002', 'e1100000-0000-4000-8000-000000000000', 'Boutique 2', 'boutique-2-bc-test', 'store');

insert into public.products (site_id, name, slug, status, price, barcode) values
  ('e2100000-0000-4000-8000-000000000001', 'Marteau', 'marteau-bc-1', 'active', 5000, '4006381333931'),
  ('e2100000-0000-4000-8000-000000000002', 'Marteau', 'marteau-bc-2', 'active', 5000, '4006381333931'),
  ('e2100000-0000-4000-8000-000000000001', 'Sans code 1', 'sans-code-1', 'active', 1, null),
  ('e2100000-0000-4000-8000-000000000001', 'Sans code 2', 'sans-code-2', 'active', 1, null),
  ('e2100000-0000-4000-8000-000000000001', 'Code vide 1', 'code-vide-1', 'active', 1, ''),
  ('e2100000-0000-4000-8000-000000000001', 'Code vide 2', 'code-vide-2', 'active', 1, '');

do $test$
begin
  insert into public.products (site_id, name, slug, status, price, barcode)
  values ('e2100000-0000-4000-8000-000000000001', 'Doublon', 'doublon-bc', 'active', 1, '4006381333931');
  raise exception 'ÉCHEC 1 : code-barres en double accepté dans la même boutique';
exception when unique_violation then
  raise notice 'OK 1 : doublon refusé (%), même code accepté dans une autre boutique, codes vides autorisés', sqlerrm;
end;
$test$;

rollback;
