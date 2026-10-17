-- =============================================================================
-- NE JAMAIS EXÉCUTER SUR LE PROJET RÉEL.
-- =============================================================================
-- Test du lot A (ticket, reçu, historique des ventes). Aucune migration nouvelle : le test vérifie
-- que ce que l'écran lit existe bien dans store_documents, après TOUTES les migrations existantes.
-- STATUT : NON TESTÉ EN EXÉCUTION (ni Docker ni CLI Supabase disponibles : ce fichier n'a jamais été exécuté).
-- Base locale jetable uniquement, en tant que postgres :
--   psql -v ON_ERROR_STOP=1 -f supabase/tests/receipt_history.test.sql
-- Transaction terminée par ROLLBACK : aucune donnée ne reste.
--
-- Scénarios : instantané complet (boutique, legal_details, caissier, lignes avec unité, paiement,
-- remis/rendu, pied de page, aucune taxe) ; numéro TICKET-AAAA-NNNNNN ; annulation qui laisse
-- l'instantané intact (réimpression ANNULÉ) ; requête de l'historique (période + numéro) pour l'editor ;
-- isolation : le propriétaire d'un autre site ne lit aucun reçu.
-- =============================================================================

begin;

insert into auth.users (id, email) values
  ('c0000000-0000-4000-8000-000000000001', 'owner-c@test.local'),
  ('c0000000-0000-4000-8000-000000000002', 'editor-c@test.local'),
  ('f0000000-0000-4000-8000-000000000001', 'owner-f@test.local');

insert into public.profiles (user_id, display_name) values
  ('c0000000-0000-4000-8000-000000000002', 'Awa Caisse')
on conflict (user_id) do update set display_name = excluded.display_name;

insert into public.workspaces (id, owner_id, name, slug) values
  ('c1000000-0000-4000-8000-000000000000', 'c0000000-0000-4000-8000-000000000001', 'Espace C', 'espace-c-test'),
  ('f1000000-0000-4000-8000-000000000000', 'f0000000-0000-4000-8000-000000000001', 'Espace F', 'espace-f-test');
insert into public.workspace_memberships (workspace_id, user_id, role) values
  ('c1000000-0000-4000-8000-000000000000', 'c0000000-0000-4000-8000-000000000002', 'editor');

insert into public.sites (id, workspace_id, name, slug, site_type) values
  ('c2000000-0000-4000-8000-000000000000', 'c1000000-0000-4000-8000-000000000000', 'Quincaillerie C', 'quincaillerie-c-test', 'store'),
  ('f2000000-0000-4000-8000-000000000000', 'f1000000-0000-4000-8000-000000000000', 'Quincaillerie F', 'quincaillerie-f-test', 'store');

insert into public.business_profiles (site_id, public_name, phone, address, city) values
  ('c2000000-0000-4000-8000-000000000000', 'Quincaillerie C', '770000000', 'Route de Rufisque', 'Pikine');

insert into public.store_document_settings (site_id, default_paper, footer_text, legal_details) values
  ('c2000000-0000-4000-8000-000000000000', 'thermal_80mm', 'Merci de votre visite', '{"ninea":"0012345","rccm":"SN-DKR-2026-B-1"}');

insert into public.stock_locations (id, site_id, name, location_type) values
  ('c3000000-0000-4000-8000-000000000000', 'c2000000-0000-4000-8000-000000000000', 'Magasin', 'store');
insert into public.product_units (id, site_id, code, label, dimension, decimal_places) values
  ('c4000000-0000-4000-8000-000000000001', 'c2000000-0000-4000-8000-000000000000', 'm', 'Mètre', 'length', 2);
insert into public.products (id, site_id, name, slug, status, price) values
  ('c5000000-0000-4000-8000-000000000001', 'c2000000-0000-4000-8000-000000000000', 'Câble 2,5 mm²', 'cable-c-test', 'active', 400);
insert into public.product_sell_units (site_id, product_id, unit_id, conversion_to_base, is_default, min_sale_quantity, quantity_step) values
  ('c2000000-0000-4000-8000-000000000000', 'c5000000-0000-4000-8000-000000000001', 'c4000000-0000-4000-8000-000000000001', 1, true, 0.5, 0.5);
insert into public.inventory_movements (site_id, product_id, movement_type, quantity_delta, stock_location_id) values
  ('c2000000-0000-4000-8000-000000000000', 'c5000000-0000-4000-8000-000000000001', 'initial_stock', 100, 'c3000000-0000-4000-8000-000000000000');
insert into public.cash_register_sessions (id, site_id, opened_by, opening_cash) values
  ('c6000000-0000-4000-8000-000000000000', 'c2000000-0000-4000-8000-000000000000', 'c0000000-0000-4000-8000-000000000002', 0);

create temporary table test_results (sale text, payload jsonb) on commit drop;
grant all on test_results to authenticated;

-- -----------------------------------------------------------------------------
-- Editor C : vente de 2,5 m de câble (1 000), 5 000 remis en espèces.
-- -----------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"c0000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
set local role authenticated;

insert into test_results select 'sale1', public.record_sale(
  'c2000000-0000-4000-8000-000000000000', 'c6000000-0000-4000-8000-000000000000',
  '[{"product_id":"c5000000-0000-4000-8000-000000000001","quantity":2.5}]',
  '[{"method":"cash","amount":5000}]');

-- 1. Instantané complet, lu tel quel par l'impression.
do $test$
declare
  v jsonb := (select payload -> 'snapshot' from test_results where sale = 'sale1');
begin
  if v -> 'shop' ->> 'name' <> 'Quincaillerie C' or v -> 'shop' ->> 'city' <> 'Pikine' then raise exception 'ÉCHEC 1a : boutique %', v -> 'shop'; end if;
  if v -> 'settings' -> 'legal_details' ->> 'ninea' <> '0012345' then raise exception 'ÉCHEC 1b : legal_details %', v -> 'settings'; end if;
  if v -> 'settings' ->> 'footer_text' <> 'Merci de votre visite' then raise exception 'ÉCHEC 1c : pied de page'; end if;
  if v -> 'cashier' ->> 'name' <> 'Awa Caisse' then raise exception 'ÉCHEC 1d : caissier %', v -> 'cashier'; end if;
  if (v -> 'lines' -> 0 ->> 'quantity')::numeric <> 2.5 or v -> 'lines' -> 0 ->> 'unit_label' is null
     or (v -> 'lines' -> 0 ->> 'unit_price')::numeric <> 400 or (v -> 'lines' -> 0 ->> 'line_discount') is null then
    raise exception 'ÉCHEC 1e : ligne %', v -> 'lines' -> 0;
  end if;
  if (v -> 'totals' ->> 'grand_total')::numeric <> 1000 or (v -> 'totals' ->> 'tax_total')::numeric <> 0 then raise exception 'ÉCHEC 1f : totaux %', v -> 'totals'; end if;
  if (v -> 'cash' ->> 'tendered')::numeric <> 5000 or (v -> 'cash' ->> 'change')::numeric <> 4000 then raise exception 'ÉCHEC 1g : remis/rendu %', v -> 'cash'; end if;
  if v -> 'payments' -> 0 ->> 'label' <> 'Espèces' then raise exception 'ÉCHEC 1h : paiement %', v -> 'payments'; end if;
  raise notice 'OK 1 : instantané complet';
end;
$test$;

-- 2. Numéro au format TICKET-AAAA-NNNNNN, identique dans le document et l'instantané.
do $test$
declare
  v_number text := (select payload ->> 'document_number' from test_results where sale = 'sale1');
begin
  if v_number !~ '^TICKET-[0-9]{4}-[0-9]{6}$' then raise exception 'ÉCHEC 2 : numéro %', v_number; end if;
  if (select content_snapshot -> 'document' ->> 'number' from public.store_documents where document_number = v_number) <> v_number then
    raise exception 'ÉCHEC 2b : numéro différent dans content_snapshot';
  end if;
  raise notice 'OK 2 : numéro %', v_number;
end;
$test$;

-- 3. Requête de l'historique (période du jour à Dakar, recherche par numéro), telle que l'écran l'envoie.
do $test$
declare
  v_number text := (select payload ->> 'document_number' from test_results where sale = 'sale1');
  v_from timestamptz := date_trunc('day', now() at time zone 'Africa/Dakar') at time zone 'Africa/Dakar';
  v_count integer;
begin
  select count(*) into v_count from public.store_documents
  where site_id = 'c2000000-0000-4000-8000-000000000000' and document_type = 'receipt'
    and issued_at >= v_from and issued_at < v_from + interval '1 day'
    and document_number ilike '%' || right(v_number, 6) || '%';
  if v_count <> 1 then raise exception 'ÉCHEC 3 : % reçu(s) trouvé(s) pour l''editor', v_count; end if;
  raise notice 'OK 3 : historique lisible par l''editor';
end;
$test$;

-- -----------------------------------------------------------------------------
-- Propriétaire C : annulation ; l'instantané ne change pas.
-- -----------------------------------------------------------------------------
reset role;
create temporary table snapshot_before on commit drop as
  select content_snapshot from public.store_documents
  where document_number = (select payload ->> 'document_number' from test_results where sale = 'sale1');
grant select on snapshot_before to authenticated;

select set_config('request.jwt.claims', '{"sub":"c0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select public.void_sale((select (payload ->> 'order_id')::uuid from test_results where sale = 'sale1'), 'Test réimpression');

do $test$
declare
  v_doc public.store_documents%rowtype;
begin
  select * into v_doc from public.store_documents
  where document_number = (select payload ->> 'document_number' from test_results where sale = 'sale1');
  if v_doc.status <> 'void' then raise exception 'ÉCHEC 4a : statut %', v_doc.status; end if;
  if v_doc.content_snapshot is distinct from (select content_snapshot from snapshot_before) then
    raise exception 'ÉCHEC 4b : instantané modifié par l''annulation';
  end if;
  raise notice 'OK 4 : reçu annulé, instantané intact (réimpression ANNULÉ possible)';
end;
$test$;

-- -----------------------------------------------------------------------------
-- Propriétaire F (autre boutique) : aucun reçu de C visible.
-- -----------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"f0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
do $test$
begin
  if exists (select 1 from public.store_documents where site_id = 'c2000000-0000-4000-8000-000000000000') then
    raise exception 'ÉCHEC 5 : un autre propriétaire lit les reçus de la boutique C';
  end if;
  raise notice 'OK 5 : isolation entre boutiques';
end;
$test$;

rollback;
