-- =============================================================================
-- NE JAMAIS EXÉCUTER SUR LE PROJET RÉEL.
-- =============================================================================
-- Test de la migration 20261017140000_product_import.sql.
-- STATUT : NON TESTÉ EN EXÉCUTION (ni Docker ni CLI Supabase disponibles : ce fichier n'a jamais été exécuté).
-- Base locale jetable uniquement, en tant que postgres, après TOUTES les migrations (celle-ci comprise) :
--   psql -v ON_ERROR_STOP=1 -f supabase/tests/product_import.test.sql
-- Transaction terminée par ROLLBACK : aucune donnée ne reste.
--
-- Scénarios : prix absent refusé avec message explicite ; import par le propriétaire (catégorie créée, unité, prix d'achat, stock initial via
-- record_stock_movement) ; editor et viewer refusés ; plus de 1000 lignes refusé ; doublon de SKU = rien
-- n'est écrit + journal 'failed' ; échec à l'écriture (contrôle de record_stock_movement) = tout annulé ;
-- mise à jour par SKU ; prix d'achat illisible pour editor et anon ; isolation entre deux boutiques.
-- =============================================================================

begin;

insert into auth.users (id, email) values
  ('10000000-0000-4000-8000-000000000001', 'owner-i@test.local'),
  ('10000000-0000-4000-8000-000000000002', 'editor-i@test.local'),
  ('10000000-0000-4000-8000-000000000003', 'viewer-i@test.local'),
  ('20000000-0000-4000-8000-000000000001', 'owner-j@test.local');

insert into public.workspaces (id, owner_id, name, slug) values
  ('11000000-0000-4000-8000-000000000000', '10000000-0000-4000-8000-000000000001', 'Espace I', 'espace-i-test'),
  ('21000000-0000-4000-8000-000000000000', '20000000-0000-4000-8000-000000000001', 'Espace J', 'espace-j-test');
insert into public.workspace_memberships (workspace_id, user_id, role) values
  ('11000000-0000-4000-8000-000000000000', '10000000-0000-4000-8000-000000000002', 'editor'),
  ('11000000-0000-4000-8000-000000000000', '10000000-0000-4000-8000-000000000003', 'viewer');

insert into public.sites (id, workspace_id, name, slug, site_type) values
  ('12000000-0000-4000-8000-000000000000', '11000000-0000-4000-8000-000000000000', 'Quincaillerie I', 'quincaillerie-i-test', 'store'),
  ('22000000-0000-4000-8000-000000000000', '21000000-0000-4000-8000-000000000000', 'Quincaillerie J', 'quincaillerie-j-test', 'store');

insert into public.stock_locations (id, site_id, name, location_type) values
  ('13000000-0000-4000-8000-000000000000', '12000000-0000-4000-8000-000000000000', 'Magasin', 'store'),
  ('23000000-0000-4000-8000-000000000000', '22000000-0000-4000-8000-000000000000', 'Magasin', 'store');
insert into public.product_units (id, site_id, code, label, dimension, decimal_places) values
  ('14000000-0000-4000-8000-000000000001', '12000000-0000-4000-8000-000000000000', 'u', 'Pièce', 'count', 0),
  ('14000000-0000-4000-8000-000000000002', '12000000-0000-4000-8000-000000000000', 'm', 'Mètre', 'length', 2),
  ('24000000-0000-4000-8000-000000000001', '22000000-0000-4000-8000-000000000000', 'u', 'Pièce', 'count', 0);

create temporary table test_results (name text, payload jsonb) on commit drop;
grant all on test_results to authenticated;

-- -----------------------------------------------------------------------------
-- Propriétaire I
-- -----------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;

-- 1. Import réussi : 2 produits, catégorie « Électricité » créée, prix d'achat, 12,5 m de câble en stock.
insert into test_results select 'import1', public.import_products('12000000-0000-4000-8000-000000000000', '[
  {"line":2,"name":"Câble rigide 2,5 mm²","sku":"CAB-25","category":"Électricité","unit_id":"14000000-0000-4000-8000-000000000002",
   "price":400,"cost":250,"initial_stock":12.5,"location_id":"13000000-0000-4000-8000-000000000000"},
  {"line":3,"name":"Marteau","sku":"MAR-1","barcode":"6001","category":"électricité","unit_id":"14000000-0000-4000-8000-000000000001","price":5000}
]', 'create', 'csv');

do $test$
declare
  v jsonb := (select payload from test_results where name = 'import1');
begin
  if v ->> 'status' <> 'succeeded' or (v ->> 'created')::int <> 2 or (v ->> 'stock_movements')::int <> 1 then
    raise exception 'ÉCHEC 1a : %', v;
  end if;
  if (select count(*) from public.product_categories where site_id = '12000000-0000-4000-8000-000000000000' and lower(name) = 'électricité') <> 1 then
    raise exception 'ÉCHEC 1b : la catégorie doit être créée une seule fois (casse ignorée)';
  end if;
  if (select sum(quantity_delta) from public.inventory_movements m join public.products p on p.id = m.product_id
      where p.sku = 'CAB-25' and m.movement_type = 'initial_stock' and m.reference_type = 'manual_entry') <> 12.5 then
    raise exception 'ÉCHEC 1c : stock initial absent';
  end if;
  if (select unit_cost from public.product_costs c join public.products p on p.id = c.product_id where p.sku = 'CAB-25') <> 250 then
    raise exception 'ÉCHEC 1d : prix d''achat absent';
  end if;
  if (select count(*) from public.product_import_runs where site_id = '12000000-0000-4000-8000-000000000000' and status = 'succeeded'
      and actor_user_id = '10000000-0000-4000-8000-000000000001' and row_count = 2) <> 1 then
    raise exception 'ÉCHEC 1e : journal';
  end if;
  raise notice 'OK 1 : import réussi, catégorie, prix d''achat, stock, journal';
end;
$test$;

-- 2. Doublon de SKU (fichier) : rien n'est écrit, journal 'failed'.
insert into test_results select 'import2', public.import_products('12000000-0000-4000-8000-000000000000', '[
  {"line":2,"name":"Vis A","sku":"VIS-1","unit_id":"14000000-0000-4000-8000-000000000001","price":50},
  {"line":3,"name":"Vis B","sku":"vis-1","unit_id":"14000000-0000-4000-8000-000000000001","price":60}
]', 'create', 'paste');
do $test$
begin
  if (select payload ->> 'status' from test_results where name = 'import2') <> 'failed' then raise exception 'ÉCHEC 2a'; end if;
  if exists (select 1 from public.products where site_id = '12000000-0000-4000-8000-000000000000' and name like 'Vis %') then
    raise exception 'ÉCHEC 2b : une ligne a été écrite malgré l''erreur';
  end if;
  raise notice 'OK 2 : doublon refusé, tout ou rien';
end;
$test$;

-- 2b. Clé « price » absente : erreur explicite, rien n'est écrit.
insert into test_results select 'import2b', public.import_products('12000000-0000-4000-8000-000000000000',
  '[{"line":2,"name":"Sans prix","sku":"NOPRICE-1","unit_id":"14000000-0000-4000-8000-000000000001"}]', 'create', 'csv');
do $test$
declare
  v jsonb := (select payload from test_results where name = 'import2b');
begin
  if v ->> 'status' <> 'failed' then raise exception 'ÉCHEC 2c : import sans prix accepté'; end if;
  if not exists (select 1 from jsonb_array_elements(v -> 'errors') e
                 where e ->> 'message' = 'Prix de vente : entier positif ou nul obligatoire.' and (e ->> 'line')::int = 2) then
    raise exception 'ÉCHEC 2d : message attendu absent : %', v -> 'errors';
  end if;
  if exists (select 1 from public.products where sku = 'NOPRICE-1') then raise exception 'ÉCHEC 2e : produit écrit'; end if;
  raise notice 'OK 2b : prix absent refusé avec le bon message';
end;
$test$;

-- 3. SKU déjà en base en mode create : refusé.
insert into test_results select 'import3', public.import_products('12000000-0000-4000-8000-000000000000',
  '[{"line":2,"name":"Autre marteau","sku":"mar-1","unit_id":"14000000-0000-4000-8000-000000000001","price":1}]', 'create', 'csv');
do $test$
begin
  if (select payload ->> 'status' from test_results where name = 'import3') <> 'failed' then raise exception 'ÉCHEC 3'; end if;
  raise notice 'OK 3 : SKU existant refusé en création';
end;
$test$;

-- 4. Décimales de stock invalides pour la pièce (2,5 pièces) : refusé, aucun produit créé.
insert into test_results select 'import4', public.import_products('12000000-0000-4000-8000-000000000000', '[
  {"line":2,"name":"Pince OK","sku":"PIN-1","unit_id":"14000000-0000-4000-8000-000000000001","price":2000},
  {"line":3,"name":"Pince KO","sku":"PIN-2","unit_id":"14000000-0000-4000-8000-000000000001","price":2000,
   "initial_stock":2.5,"location_id":"13000000-0000-4000-8000-000000000000"}
]', 'create', 'xlsx');
do $test$
begin
  if (select payload ->> 'status' from test_results where name = 'import4') <> 'failed' then raise exception 'ÉCHEC 4a'; end if;
  if exists (select 1 from public.products where sku in ('PIN-1', 'PIN-2')) then raise exception 'ÉCHEC 4b : écriture partielle'; end if;
  raise notice 'OK 4 : décimales refusées, tout ou rien';
end;
$test$;

-- 5. Mise à jour par SKU (upsert) : prix de vente et prix d'achat modifiés, aucun doublon créé.
insert into test_results select 'import5', public.import_products('12000000-0000-4000-8000-000000000000',
  '[{"line":2,"name":"Marteau 500 g","sku":"MAR-1","price":5500,"cost":3900}]', 'upsert', 'manual');
do $test$
begin
  if (select payload ->> 'updated' from test_results where name = 'import5')::int <> 1 then raise exception 'ÉCHEC 5a'; end if;
  if (select price from public.products where sku = 'MAR-1' and site_id = '12000000-0000-4000-8000-000000000000') <> 5500 then raise exception 'ÉCHEC 5b'; end if;
  if (select count(*) from public.products where lower(sku) = 'mar-1') <> 1 then raise exception 'ÉCHEC 5c : doublon créé'; end if;
  if (select barcode from public.products where sku = 'MAR-1') <> '6001' then raise exception 'ÉCHEC 5d : code-barres effacé'; end if;
  raise notice 'OK 5 : mise à jour par SKU';
end;
$test$;

-- 6. Plus de 1000 lignes : refusé (exception, rien n'est écrit).
do $test$
begin
  perform public.import_products('12000000-0000-4000-8000-000000000000',
    (select jsonb_agg(jsonb_build_object('name', 'P' || g, 'price', 1, 'unit_id', '14000000-0000-4000-8000-000000000001')) from generate_series(1, 1001) g),
    'create', 'csv');
  raise exception 'ÉCHEC 6 : 1001 lignes acceptées';
exception when sqlstate '22023' then
  raise notice 'OK 6 : limite de 1000 lignes (%)', sqlerrm;
end;
$test$;

-- -----------------------------------------------------------------------------
-- Editor et viewer I : import refusé, prix d'achat illisible
-- -----------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
do $test$
begin
  perform public.import_products('12000000-0000-4000-8000-000000000000',
    '[{"name":"X","price":1,"unit_id":"14000000-0000-4000-8000-000000000001"}]', 'create', 'csv');
  raise exception 'ÉCHEC 7a : import accepté pour un editor';
exception when sqlstate '42501' then
  raise notice 'OK 7a : editor refusé';
end;
$test$;
do $test$
begin
  if exists (select 1 from public.product_costs) then raise exception 'ÉCHEC 7b : l''editor lit les prix d''achat'; end if;
  if exists (select 1 from public.product_import_runs) then raise exception 'ÉCHEC 7c : l''editor lit le journal d''import'; end if;
  raise notice 'OK 7b : prix d''achat et journal invisibles pour l''editor';
end;
$test$;

select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000003","role":"authenticated"}', true);
do $test$
begin
  perform public.import_products('12000000-0000-4000-8000-000000000000',
    '[{"name":"X","price":1,"unit_id":"14000000-0000-4000-8000-000000000001"}]', 'create', 'csv');
  raise exception 'ÉCHEC 8 : import accepté pour un viewer';
exception when sqlstate '42501' then
  raise notice 'OK 8 : viewer refusé';
end;
$test$;

-- -----------------------------------------------------------------------------
-- Propriétaire J (autre boutique) : ni import chez I, ni lecture des prix d'achat de I
-- -----------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
do $test$
begin
  perform public.import_products('12000000-0000-4000-8000-000000000000',
    '[{"name":"X","price":1,"unit_id":"14000000-0000-4000-8000-000000000001"}]', 'create', 'csv');
  raise exception 'ÉCHEC 9a : import accepté sur une autre boutique';
exception when sqlstate '42501' then
  raise notice 'OK 9a : autre boutique refusée';
end;
$test$;
do $test$
begin
  if exists (select 1 from public.product_costs where site_id = '12000000-0000-4000-8000-000000000000') then
    raise exception 'ÉCHEC 9b : prix d''achat lisibles par une autre boutique';
  end if;
  raise notice 'OK 9b : isolation des prix d''achat';
end;
$test$;

-- -----------------------------------------------------------------------------
-- anon : aucun droit
-- -----------------------------------------------------------------------------
reset role;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
do $test$
begin
  perform 1 from public.product_costs;
  raise exception 'ÉCHEC 10 : anon lit product_costs';
exception when insufficient_privilege then
  raise notice 'OK 10 : anon sans accès à product_costs';
end;
$test$;

rollback;
