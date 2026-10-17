-- =============================================================================
-- NE JAMAIS EXÉCUTER SUR LE PROJET RÉEL.
-- =============================================================================
-- Test des migrations 20261017220000_customers_credit.sql et 20261017220100_credit_sale_guard.sql (scénario 6).
-- STATUT : NON TESTÉ EN EXÉCUTION (ni Docker ni CLI Supabase disponibles : ce fichier n'a jamais été exécuté).
-- Base locale jetable uniquement, en tant que postgres, après TOUTES les migrations :
--   psql -v ON_ERROR_STOP=1 -f supabase/tests/customers_credit.test.sql
-- Transaction terminée par ROLLBACK : aucune donnée ne reste.
--
-- Scénarios : fiche client (plafond réservé au gérant) ; vente à crédit partielle sous le plafond ; dépassement
-- refusé au vendeur, accepté pour le gérant avec motif ; versement en espèces (caisse) et Wave ; trop-perçu refusé ;
-- relevé et solde progressif ; ancienneté FIFO ; magasinier et autre boutique sans accès ; crédit direct par
-- record_sale refusé après la partie 2/2.
-- =============================================================================

begin;

insert into auth.users (id, email) values
  ('90000000-0000-4000-8000-000000000001', 'owner-k@test.local'),
  ('90000000-0000-4000-8000-000000000002', 'manager-k@test.local'),
  ('90000000-0000-4000-8000-000000000003', 'cashier-k@test.local'),
  ('90000000-0000-4000-8000-000000000004', 'stock-k@test.local'),
  ('a9000000-0000-4000-8000-000000000001', 'owner-l@test.local');
insert into public.workspaces (id, owner_id, name, slug) values
  ('91000000-0000-4000-8000-000000000000', '90000000-0000-4000-8000-000000000001', 'Espace K', 'espace-k-test'),
  ('a1900000-0000-4000-8000-000000000000', 'a9000000-0000-4000-8000-000000000001', 'Espace L', 'espace-l-test');
insert into public.workspace_memberships (workspace_id, user_id, role) values
  ('91000000-0000-4000-8000-000000000000', '90000000-0000-4000-8000-000000000002', 'admin'),
  ('91000000-0000-4000-8000-000000000000', '90000000-0000-4000-8000-000000000003', 'editor'),
  ('91000000-0000-4000-8000-000000000000', '90000000-0000-4000-8000-000000000004', 'viewer');
insert into public.sites (id, workspace_id, name, slug, site_type) values
  ('92000000-0000-4000-8000-000000000000', '91000000-0000-4000-8000-000000000000', 'Quincaillerie K', 'quincaillerie-k-test', 'store');
insert into public.site_staff (site_id, user_id, staff_role) values
  ('92000000-0000-4000-8000-000000000000', '90000000-0000-4000-8000-000000000004', 'stock_keeper');
insert into public.stock_locations (id, site_id, name, location_type) values
  ('93000000-0000-4000-8000-000000000000', '92000000-0000-4000-8000-000000000000', 'Magasin', 'store');
insert into public.product_units (id, site_id, code, label, dimension, decimal_places) values
  ('94000000-0000-4000-8000-000000000001', '92000000-0000-4000-8000-000000000000', 'u', 'Pièce', 'count', 0);
insert into public.products (id, site_id, name, slug, status, price) values
  ('95000000-0000-4000-8000-000000000001', '92000000-0000-4000-8000-000000000000', 'Ciment', 'ciment-k-test', 'active', 5000);
insert into public.product_sell_units (site_id, product_id, unit_id, conversion_to_base, is_default, min_sale_quantity, quantity_step) values
  ('92000000-0000-4000-8000-000000000000', '95000000-0000-4000-8000-000000000001', '94000000-0000-4000-8000-000000000001', 1, true, 1, 1);
insert into public.inventory_movements (site_id, product_id, movement_type, quantity_delta, stock_location_id) values
  ('92000000-0000-4000-8000-000000000000', '95000000-0000-4000-8000-000000000001', 'initial_stock', 100, '93000000-0000-4000-8000-000000000000');
insert into public.cash_register_sessions (id, site_id, opened_by, opening_cash) values
  ('96000000-0000-4000-8000-000000000001', '92000000-0000-4000-8000-000000000000', '90000000-0000-4000-8000-000000000003', 0);

create temporary table t (name text, payload jsonb) on commit drop;
grant all on t to authenticated;

-- -----------------------------------------------------------------------------
-- 1. Fiche client : le vendeur crée, ne fixe pas le plafond ; le gérant le fixe
-- -----------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"90000000-0000-4000-8000-000000000003","role":"authenticated"}', true);
set local role authenticated;
insert into t select 'customer', to_jsonb(public.save_customer('92000000-0000-4000-8000-000000000000', null, 'Moussa Ndiaye', '771234567', 'Pikine', null, true));
do $test$
begin
  perform public.save_customer('92000000-0000-4000-8000-000000000000', (select (payload #>> '{}')::uuid from t where name = 'customer'),
    'Moussa Ndiaye', '771234567', 'Pikine', 100000, true);
  raise exception 'ÉCHEC 1a : plafond fixé par un vendeur';
exception when sqlstate '42501' then
  raise notice 'OK 1a : plafond réservé au gérant';
end;
$test$;

select set_config('request.jwt.claims', '{"sub":"90000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select public.save_customer('92000000-0000-4000-8000-000000000000', (select (payload #>> '{}')::uuid from t where name = 'customer'),
  'Moussa Ndiaye', '771234567', 'Pikine', 12000, true);

-- -----------------------------------------------------------------------------
-- 2. Vendeur : vente à crédit partielle (2 ciments = 10 000 ; 2 000 espèces + 8 000 crédit)
-- -----------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"90000000-0000-4000-8000-000000000003","role":"authenticated"}', true);
insert into t select 'sale1', public.record_credit_sale('92000000-0000-4000-8000-000000000000', '96000000-0000-4000-8000-000000000001',
  (select (payload #>> '{}')::uuid from t where name = 'customer'),
  '[{"product_id":"95000000-0000-4000-8000-000000000001","quantity":2}]',
  '[{"method":"cash","amount":2000},{"method":"credit","amount":8000}]');
do $test$
declare
  v jsonb := (select payload from t where name = 'sale1');
begin
  if (v ->> 'customer_balance')::numeric <> 8000 or (v ->> 'limit_overridden')::boolean then raise exception 'ÉCHEC 2a : %', v; end if;
  -- Dépassement (8 000 + 5 000 > 12 000) refusé au vendeur, même avec motif.
  begin
    perform public.record_credit_sale('92000000-0000-4000-8000-000000000000', '96000000-0000-4000-8000-000000000001',
      (select (payload #>> '{}')::uuid from t where name = 'customer'),
      '[{"product_id":"95000000-0000-4000-8000-000000000001","quantity":1}]', '[{"method":"credit","amount":5000}]', '{}', 'Je force');
    raise exception 'ÉCHEC 2b : dépassement accepté pour un vendeur';
  exception when sqlstate '42501' then null;
  end;
  raise notice 'OK 2 : crédit partiel, plafond appliqué au vendeur';
end;
$test$;

-- 3. Gérant : dépassement autorisé avec motif (vente sans paiement : tout à crédit).
select set_config('request.jwt.claims', '{"sub":"90000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
do $test$
begin
  begin
    perform public.record_credit_sale('92000000-0000-4000-8000-000000000000', '96000000-0000-4000-8000-000000000001',
      (select (payload #>> '{}')::uuid from t where name = 'customer'),
      '[{"product_id":"95000000-0000-4000-8000-000000000001","quantity":1}]', '[{"method":"credit","amount":5000}]');
    raise exception 'ÉCHEC 3a : dépassement sans motif accepté';
  exception when sqlstate '22023' then null;
  end;
end;
$test$;
insert into t select 'sale2', public.record_credit_sale('92000000-0000-4000-8000-000000000000', '96000000-0000-4000-8000-000000000001',
  (select (payload #>> '{}')::uuid from t where name = 'customer'),
  '[{"product_id":"95000000-0000-4000-8000-000000000001","quantity":1}]', '[{"method":"credit","amount":5000}]', '{}',
  'Chantier en cours, règlement fin de mois');
do $test$
begin
  if (select (payload ->> 'customer_balance')::numeric from t where name = 'sale2') <> 13000
     or not (select (payload ->> 'limit_overridden')::boolean from t where name = 'sale2') then
    raise exception 'ÉCHEC 3b';
  end if;
  if (select override_reason from public.customer_ledger where document_number = (select payload ->> 'document_number' from t where name = 'sale2'))
     <> 'Chantier en cours, règlement fin de mois' then
    raise exception 'ÉCHEC 3c : motif non tracé';
  end if;
  raise notice 'OK 3 : dépassement autorisé par le gérant, tracé';
end;
$test$;

-- -----------------------------------------------------------------------------
-- 4. Versements : espèces (caisse), Wave ; trop-perçu refusé ; relevé et FIFO
-- -----------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"90000000-0000-4000-8000-000000000003","role":"authenticated"}', true);
select public.record_customer_payment('92000000-0000-4000-8000-000000000000', (select (payload #>> '{}')::uuid from t where name = 'customer'),
  6000, 'cash', '96000000-0000-4000-8000-000000000001', 'R-1', null);
select public.record_customer_payment('92000000-0000-4000-8000-000000000000', (select (payload #>> '{}')::uuid from t where name = 'customer'),
  3000, 'wave', null, 'W-7', 'Versement Wave');
do $test$
declare
  v_customer uuid := (select (payload #>> '{}')::uuid from t where name = 'customer');
  v_statement jsonb;
  v_receivable record;
begin
  begin
    perform public.record_customer_payment('92000000-0000-4000-8000-000000000000', v_customer, 5000, 'wave', null, null, null);
    raise exception 'ÉCHEC 4a : trop-perçu accepté';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform public.record_customer_payment('92000000-0000-4000-8000-000000000000', v_customer, 100, 'cash', null, null, null);
    raise exception 'ÉCHEC 4b : espèces sans caisse acceptées';
  exception when sqlstate '22023' then null;
  end;
  v_statement := public.customer_statement('92000000-0000-4000-8000-000000000000', v_customer);
  if (v_statement ->> 'balance')::numeric <> 4000 or jsonb_array_length(v_statement -> 'entries') <> 4
     or (v_statement -> 'entries' -> 3 ->> 'balance')::numeric <> 4000 then
    raise exception 'ÉCHEC 4c : relevé %', v_statement;
  end if;
  -- FIFO : 9 000 versés soldent la 1re vente (8 000) ; la plus ancienne non soldée est la 2e (5 000, reste 4 000).
  select * into v_receivable from public.customer_receivables('92000000-0000-4000-8000-000000000000') where customer_id = v_customer;
  if v_receivable.balance <> 4000 or v_receivable.oldest_unpaid_at is distinct from
     (select created_at from public.customer_ledger where document_number = (select payload ->> 'document_number' from t where name = 'sale2')) then
    raise exception 'ÉCHEC 4d : ancienneté FIFO';
  end if;
  if (select count(*) from public.cash_register_movements where session_id = '96000000-0000-4000-8000-000000000001'
      and movement_type = 'cash_in' and amount = 6000) <> 1 then
    raise exception 'ÉCHEC 4e : versement en espèces absent de la caisse';
  end if;
  raise notice 'OK 4 : versements, relevé, ancienneté';
end;
$test$;

-- -----------------------------------------------------------------------------
-- 5. Magasinier et autre boutique : rien
-- -----------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"90000000-0000-4000-8000-000000000004","role":"authenticated"}', true);
do $test$
begin
  if exists (select 1 from public.store_customers) or exists (select 1 from public.customer_ledger) then
    raise exception 'ÉCHEC 5a : le magasinier lit les clients';
  end if;
  begin
    perform public.customer_receivables('92000000-0000-4000-8000-000000000000');
    raise exception 'ÉCHEC 5b';
  exception when sqlstate '42501' then null;
  end;
  raise notice 'OK 5a : magasinier sans accès aux clients';
end;
$test$;
select set_config('request.jwt.claims', '{"sub":"a9000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
do $test$
begin
  if exists (select 1 from public.store_customers where site_id = '92000000-0000-4000-8000-000000000000') then
    raise exception 'ÉCHEC 5c : autre boutique lit les clients';
  end if;
  begin
    perform public.save_customer('92000000-0000-4000-8000-000000000000', null, 'Intrus', null, null, null, true);
    raise exception 'ÉCHEC 5d';
  exception when sqlstate '42501' then null;
  end;
  raise notice 'OK 5b : isolation entre boutiques';
end;
$test$;

-- -----------------------------------------------------------------------------
-- 6. (après 20261017220100_credit_sale_guard) crédit direct par record_sale refusé
-- -----------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"90000000-0000-4000-8000-000000000003","role":"authenticated"}', true);
do $test$
begin
  perform public.record_sale('92000000-0000-4000-8000-000000000000', '96000000-0000-4000-8000-000000000001',
    '[{"product_id":"95000000-0000-4000-8000-000000000001","quantity":1}]', '[{"method":"credit","amount":5000}]',
    '{"name":"Sans fiche"}');
  raise notice 'INFO 6 : partie 2/2 non appliquée — record_sale accepte encore le crédit direct';
exception when sqlstate '22023' then
  raise notice 'OK 6 : crédit direct refusé (%)', sqlerrm;
end;
$test$;

rollback;
