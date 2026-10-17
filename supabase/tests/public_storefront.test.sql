-- =============================================================================
-- NE JAMAIS EXÉCUTER SUR LE PROJET RÉEL.
-- =============================================================================
-- Test des migrations 20261017180000_public_storefront.sql (et 20261017180100_storefront_anon_lockdown.sql
-- pour le scénario 6).
-- STATUT : NON TESTÉ EN EXÉCUTION (ni Docker ni CLI Supabase disponibles : ce fichier n'a jamais été exécuté).
-- Base locale jetable uniquement, en tant que postgres, après TOUTES les migrations :
--   psql -v ON_ERROR_STOP=1 -f supabase/tests/public_storefront.test.sql
-- Transaction terminée par ROLLBACK : aucune donnée ne reste.
--
-- Scénarios : site non publié → zéro ligne pour anon ; publication refusée au gérant, à un autre propriétaire,
-- sans confirmation exacte ; publication par le propriétaire ; seuls les produits actifs ; aucune colonne sensible
-- (prix d'achat, stock exact) dans les résultats ; disponibilité sans quantité ; anon sans accès aux tables brutes.
-- =============================================================================

begin;

insert into auth.users (id, email) values
  ('50000000-0000-4000-8000-000000000001', 'owner-v@test.local'),
  ('50000000-0000-4000-8000-000000000002', 'manager-v@test.local'),
  ('60000000-0000-4000-8000-000000000001', 'owner-w@test.local');
insert into public.workspaces (id, owner_id, name, slug) values
  ('51000000-0000-4000-8000-000000000000', '50000000-0000-4000-8000-000000000001', 'Espace V', 'espace-v-test'),
  ('61000000-0000-4000-8000-000000000000', '60000000-0000-4000-8000-000000000001', 'Espace W', 'espace-w-test');
insert into public.workspace_memberships (workspace_id, user_id, role) values
  ('51000000-0000-4000-8000-000000000000', '50000000-0000-4000-8000-000000000002', 'admin');
insert into public.sites (id, workspace_id, name, slug, site_type, status) values
  ('52000000-0000-4000-8000-000000000000', '51000000-0000-4000-8000-000000000000', 'Quincaillerie V', 'quincaillerie-v-test', 'store', 'draft');
insert into public.business_profiles (site_id, public_name, phone, whatsapp, city) values
  ('52000000-0000-4000-8000-000000000000', 'Quincaillerie V', '338200000', '771234567', 'Pikine');
insert into public.stock_locations (id, site_id, name, location_type) values
  ('53000000-0000-4000-8000-000000000000', '52000000-0000-4000-8000-000000000000', 'Magasin', 'store');
insert into public.product_categories (id, site_id, name, slug) values
  ('54000000-0000-4000-8000-000000000000', '52000000-0000-4000-8000-000000000000', 'Outillage', 'outillage-v-test');
insert into public.products (id, site_id, category_id, name, slug, status, price) values
  ('55000000-0000-4000-8000-000000000001', '52000000-0000-4000-8000-000000000000', '54000000-0000-4000-8000-000000000000', 'Marteau', 'marteau', 'active', 5000),
  ('55000000-0000-4000-8000-000000000002', '52000000-0000-4000-8000-000000000000', '54000000-0000-4000-8000-000000000000', 'Scie', 'scie', 'active', 7000),
  ('55000000-0000-4000-8000-000000000003', '52000000-0000-4000-8000-000000000000', '54000000-0000-4000-8000-000000000000', 'Brouillon', 'brouillon', 'draft', 1);
insert into public.inventory_movements (site_id, product_id, movement_type, quantity_delta, stock_location_id) values
  ('52000000-0000-4000-8000-000000000000', '55000000-0000-4000-8000-000000000001', 'initial_stock', 37, '53000000-0000-4000-8000-000000000000');
insert into public.product_costs (product_id, site_id, unit_cost) values
  ('55000000-0000-4000-8000-000000000001', '52000000-0000-4000-8000-000000000000', 3500);

-- -----------------------------------------------------------------------------
-- 1. Site non publié : anon ne reçoit rien
-- -----------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
do $test$
begin
  if public.storefront_shop('52000000-0000-4000-8000-000000000000') is not null then raise exception 'ÉCHEC 1a : boutique visible'; end if;
  if exists (select 1 from public.storefront_products('52000000-0000-4000-8000-000000000000')) then raise exception 'ÉCHEC 1b : produits visibles'; end if;
  if exists (select 1 from public.storefront_categories('52000000-0000-4000-8000-000000000000')) then raise exception 'ÉCHEC 1c : familles visibles'; end if;
  if public.storefront_product('52000000-0000-4000-8000-000000000000', 'marteau') is not null then raise exception 'ÉCHEC 1d : fiche visible'; end if;
  raise notice 'OK 1 : site non publié, zéro ligne pour anon';
end;
$test$;

-- -----------------------------------------------------------------------------
-- 2. Publication : refusée au gérant, à un autre propriétaire, sans confirmation exacte
-- -----------------------------------------------------------------------------
reset role;
select set_config('request.jwt.claims', '{"sub":"50000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
set local role authenticated;
do $test$
begin
  -- Aperçu autorisé au gérant.
  if public.storefront_shop('52000000-0000-4000-8000-000000000000') is null then raise exception 'ÉCHEC 2a : aperçu refusé au gérant'; end if;
  begin
    perform public.set_storefront_published('52000000-0000-4000-8000-000000000000', true, 'Quincaillerie V');
    raise exception 'ÉCHEC 2b : publication par le gérant';
  exception when sqlstate '42501' then null;
  end;
  raise notice 'OK 2a : gérant : aperçu oui, publication non';
end;
$test$;

select set_config('request.jwt.claims', '{"sub":"60000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
do $test$
begin
  if public.storefront_shop('52000000-0000-4000-8000-000000000000') is not null then raise exception 'ÉCHEC 2c : aperçu pour un autre propriétaire'; end if;
  begin
    perform public.set_storefront_published('52000000-0000-4000-8000-000000000000', true, 'Quincaillerie V');
    raise exception 'ÉCHEC 2d : publication par un autre propriétaire';
  exception when sqlstate '42501' then null;
  end;
  raise notice 'OK 2b : autre propriétaire refusé';
end;
$test$;

select set_config('request.jwt.claims', '{"sub":"50000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
do $test$
begin
  begin
    perform public.set_storefront_published('52000000-0000-4000-8000-000000000000', true, 'quincaillerie v');
    raise exception 'ÉCHEC 2e : confirmation inexacte acceptée';
  exception when sqlstate '22023' then null;
  end;
  if (select status from public.sites where id = '52000000-0000-4000-8000-000000000000') <> 'draft' then raise exception 'ÉCHEC 2f'; end if;
  raise notice 'OK 2c : confirmation exacte exigée';
end;
$test$;

-- 3. Publication par le propriétaire, journalisée.
select public.set_storefront_published('52000000-0000-4000-8000-000000000000', true, 'Quincaillerie V');
do $test$
begin
  if (select status from public.sites where id = '52000000-0000-4000-8000-000000000000') <> 'published' then raise exception 'ÉCHEC 3a'; end if;
  if (select count(*) from public.storefront_publication_events where site_id = '52000000-0000-4000-8000-000000000000' and action = 'publish') <> 1 then
    raise exception 'ÉCHEC 3b : journal';
  end if;
  raise notice 'OK 3 : publication par le propriétaire';
end;
$test$;

-- -----------------------------------------------------------------------------
-- 4. anon sur le site publié : produits actifs seulement, aucune colonne sensible
-- -----------------------------------------------------------------------------
reset role;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
do $test$
declare
  v_product jsonb := public.storefront_product('52000000-0000-4000-8000-000000000000', 'marteau');
  v_shop jsonb := public.storefront_shop('52000000-0000-4000-8000-000000000000');
begin
  if (select count(*) from public.storefront_products('52000000-0000-4000-8000-000000000000')) <> 2 then
    raise exception 'ÉCHEC 4a : seuls les 2 produits actifs doivent apparaître';
  end if;
  if public.storefront_product('52000000-0000-4000-8000-000000000000', 'brouillon') is not null then raise exception 'ÉCHEC 4b : brouillon visible'; end if;
  if v_product ->> 'availability' <> 'in_stock' then raise exception 'ÉCHEC 4c : disponibilité %', v_product ->> 'availability'; end if;
  if (select availability from public.storefront_products('52000000-0000-4000-8000-000000000000') where slug = 'scie') <> 'out_of_stock' then
    raise exception 'ÉCHEC 4d : rupture attendue';
  end if;
  -- Aucune clé sensible dans la fiche ni dans la boutique ; 37 (stock) et 3500 (coût) n'apparaissent nulle part.
  if v_product ?| array['cost', 'unit_cost', 'cost_price', 'inventory_quantity', 'stock', 'quantity', 'margin']
     or v_shop ?| array['settings', 'theme', 'workspace_id', 'owner_id'] then
    raise exception 'ÉCHEC 4e : colonne sensible exposée';
  end if;
  if v_product::text like '%3500%' or v_product::text like '%37%' then raise exception 'ÉCHEC 4f : coût ou stock exact exposé'; end if;
  if exists (
    select 1 from information_schema.routines r
    join information_schema.parameters p on p.specific_name = r.specific_name
    where r.routine_schema = 'public' and r.routine_name = 'storefront_products' and p.parameter_mode = 'OUT'
      and p.parameter_name in ('unit_cost', 'cost', 'inventory_quantity', 'quantity', 'stock')
  ) then
    raise exception 'ÉCHEC 4g : colonne sensible dans la signature de storefront_products';
  end if;
  raise notice 'OK 4 : vitrine publique limitée aux colonnes publiques';
end;
$test$;

-- 5. anon : aucune lecture des tables sensibles.
do $test$
begin
  begin
    perform 1 from public.product_costs;
    raise exception 'ÉCHEC 5a : anon lit product_costs';
  exception when insufficient_privilege then null;
  end;
  begin
    perform 1 from public.product_images;
    raise exception 'ÉCHEC 5b : anon lit product_images';
  exception when insufficient_privilege then null;
  end;
  if exists (select 1 from public.inventory_movements) or exists (select 1 from public.store_documents) then
    raise exception 'ÉCHEC 5c : anon lit le stock ou les ventes';
  end if;
  raise notice 'OK 5 : tables brutes fermées à anon';
end;
$test$;

-- 6. (après 20261017180100_storefront_anon_lockdown) anon ne lit plus products directement.
do $test$
begin
  if to_regprocedure('public.storefront_shop(uuid)') is not null and not has_table_privilege('anon', 'public.products', 'select') then
    raise notice 'OK 6 : lecture directe de products retirée à anon';
  else
    raise notice 'INFO 6 : partie 2/2 non appliquée — anon lit encore products par products_public_read';
  end if;
end;
$test$;

-- 7. Dépublication : de nouveau zéro ligne.
reset role;
select set_config('request.jwt.claims', '{"sub":"50000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select public.set_storefront_published('52000000-0000-4000-8000-000000000000', false, 'Quincaillerie V');
reset role;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
do $test$
begin
  if public.storefront_shop('52000000-0000-4000-8000-000000000000') is not null
     or exists (select 1 from public.storefront_products('52000000-0000-4000-8000-000000000000')) then
    raise exception 'ÉCHEC 7 : site dépublié encore visible';
  end if;
  raise notice 'OK 7 : dépublication effective';
end;
$test$;

rollback;
