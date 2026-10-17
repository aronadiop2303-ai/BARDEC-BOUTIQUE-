-- =============================================================================
-- NE JAMAIS EXÉCUTER SUR LE PROJET RÉEL.
-- =============================================================================
-- Test de la migration 20261017200000_cash_movements.sql.
-- STATUT : NON TESTÉ EN EXÉCUTION (ni Docker ni CLI Supabase disponibles : ce fichier n'a jamais été exécuté).
-- Base locale jetable uniquement, en tant que postgres, après TOUTES les migrations :
--   psql -v ON_ERROR_STOP=1 -f supabase/tests/cash_movements.test.sql
-- Transaction terminée par ROLLBACK : aucune donnée ne reste.
--
-- Scénarios : apport, dépense, retrait, dépôt par le gérant ; attendu X = fond + ventes espèces − remboursements
-- ± mouvements ; motif obligatoire ; montant > 0 ; session fermée refusée ; sortie au-delà des espèces refusée ;
-- vendeur : dépense sous le plafond acceptée, au-dessus refusée, apport refusé ; magasinier refusé ;
-- autre boutique refusée ; écriture directe refusée ; clôture Z avec les mouvements.
-- =============================================================================

begin;

insert into auth.users (id, email) values
  ('70000000-0000-4000-8000-000000000001', 'owner-c1@test.local'),
  ('70000000-0000-4000-8000-000000000002', 'manager-c1@test.local'),
  ('70000000-0000-4000-8000-000000000003', 'cashier-c1@test.local'),
  ('70000000-0000-4000-8000-000000000004', 'stock-c1@test.local'),
  ('80000000-0000-4000-8000-000000000001', 'owner-c2@test.local');
insert into public.workspaces (id, owner_id, name, slug) values
  ('71000000-0000-4000-8000-000000000000', '70000000-0000-4000-8000-000000000001', 'Espace C1', 'espace-c1-test'),
  ('81000000-0000-4000-8000-000000000000', '80000000-0000-4000-8000-000000000001', 'Espace C2', 'espace-c2-test');
insert into public.workspace_memberships (workspace_id, user_id, role) values
  ('71000000-0000-4000-8000-000000000000', '70000000-0000-4000-8000-000000000002', 'admin'),
  ('71000000-0000-4000-8000-000000000000', '70000000-0000-4000-8000-000000000003', 'editor'),
  ('71000000-0000-4000-8000-000000000000', '70000000-0000-4000-8000-000000000004', 'viewer');
insert into public.sites (id, workspace_id, name, slug, site_type, settings) values
  ('72000000-0000-4000-8000-000000000000', '71000000-0000-4000-8000-000000000000', 'Quincaillerie C1', 'quincaillerie-c1-test', 'store',
   '{"pos":{"cashier_max_expense_amount":3000}}');
insert into public.site_staff (site_id, user_id, staff_role) values
  ('72000000-0000-4000-8000-000000000000', '70000000-0000-4000-8000-000000000004', 'stock_keeper');
insert into public.cash_register_sessions (id, site_id, opened_by, opening_cash) values
  ('76000000-0000-4000-8000-000000000001', '72000000-0000-4000-8000-000000000000', '70000000-0000-4000-8000-000000000003', 10000);
-- Ventes et remboursement existants, écrits comme par record_sale / void_sale.
insert into public.cash_register_movements (site_id, session_id, actor_user_id, movement_type, amount, currency_code, reason) values
  ('72000000-0000-4000-8000-000000000000', '76000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000003', 'sale_cash', 25000, 'XOF', 'Vente test'),
  ('72000000-0000-4000-8000-000000000000', '76000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000001', 'refund_cash', 5000, 'XOF', 'Annulation test');

-- -----------------------------------------------------------------------------
-- 1. Gérant : apport, dépense, retrait, dépôt ; attendu cohérent
-- -----------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"70000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
set local role authenticated;
select public.record_cash_movement('72000000-0000-4000-8000-000000000000', '76000000-0000-4000-8000-000000000001', 'cash_in', 5000, 'Monnaie apportée', null);
select public.record_cash_movement('72000000-0000-4000-8000-000000000000', '76000000-0000-4000-8000-000000000001', 'expense', 2000, 'Achat de sachets', 'REC-1');
select public.record_cash_movement('72000000-0000-4000-8000-000000000000', '76000000-0000-4000-8000-000000000001', 'cash_out', 3000, 'Retrait gérant', null);
select public.record_cash_movement('72000000-0000-4000-8000-000000000000', '76000000-0000-4000-8000-000000000001', 'deposit', 10000, 'Versement banque', 'BORD-9');
do $test$
declare
  v jsonb := public.cash_session_summary('76000000-0000-4000-8000-000000000001');
  b jsonb := public.cash_session_breakdown('76000000-0000-4000-8000-000000000001');
begin
  -- 10 000 + 25 000 − 5 000 + 5 000 − 2 000 − 3 000 − 10 000 = 20 000
  if (v ->> 'expected_cash')::numeric <> 20000 then raise exception 'ÉCHEC 1a : attendu %', v ->> 'expected_cash'; end if;
  if (b -> 'deposit' ->> 'amount')::numeric <> 10000 or (b -> 'expense' ->> 'count')::int <> 1 then raise exception 'ÉCHEC 1b : ventilation %', b; end if;
  if (select receipt_ref from public.cash_movement_details d join public.cash_register_movements m on m.id = d.movement_id where m.movement_type = 'deposit') <> 'BORD-9' then
    raise exception 'ÉCHEC 1c : justificatif';
  end if;
  raise notice 'OK 1 : mouvements du gérant et attendu X';
end;
$test$;

-- 2. Contrôles de saisie.
do $test$
begin
  begin
    perform public.record_cash_movement('72000000-0000-4000-8000-000000000000', '76000000-0000-4000-8000-000000000001', 'expense', 100, '  ', null);
    raise exception 'ÉCHEC 2a : motif vide accepté';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform public.record_cash_movement('72000000-0000-4000-8000-000000000000', '76000000-0000-4000-8000-000000000001', 'expense', 0, 'Zéro', null);
    raise exception 'ÉCHEC 2b : montant nul accepté';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform public.record_cash_movement('72000000-0000-4000-8000-000000000000', '76000000-0000-4000-8000-000000000001', 'expense', 10.5, 'Décimales', null);
    raise exception 'ÉCHEC 2c : décimales en XOF acceptées';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform public.record_cash_movement('72000000-0000-4000-8000-000000000000', '76000000-0000-4000-8000-000000000001', 'correction', 100, 'Type interdit', null);
    raise exception 'ÉCHEC 2d : type non manuel accepté';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform public.record_cash_movement('72000000-0000-4000-8000-000000000000', '76000000-0000-4000-8000-000000000001', 'cash_out', 25000, 'Trop', null);
    raise exception 'ÉCHEC 2e : sortie au-delà des espèces acceptée';
  exception when sqlstate '23514' then null;
  end;
  raise notice 'OK 2 : contrôles de saisie';
end;
$test$;

-- -----------------------------------------------------------------------------
-- 3. Vendeur (ancien rôle editor → cashier) : petites dépenses seulement
-- -----------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"70000000-0000-4000-8000-000000000003","role":"authenticated"}', true);
select public.record_cash_movement('72000000-0000-4000-8000-000000000000', '76000000-0000-4000-8000-000000000001', 'expense', 3000, 'Carburant livraison', null);
do $test$
begin
  begin
    perform public.record_cash_movement('72000000-0000-4000-8000-000000000000', '76000000-0000-4000-8000-000000000001', 'expense', 3001, 'Au-dessus du plafond', null);
    raise exception 'ÉCHEC 3a : plafond dépassé';
  exception when sqlstate '42501' then null;
  end;
  begin
    perform public.record_cash_movement('72000000-0000-4000-8000-000000000000', '76000000-0000-4000-8000-000000000001', 'cash_in', 1000, 'Apport vendeur', null);
    raise exception 'ÉCHEC 3b : apport par un vendeur';
  exception when sqlstate '42501' then null;
  end;
  -- Écriture directe toujours refusée (pos_cash_lockdown).
  begin
    insert into public.cash_register_movements (site_id, session_id, actor_user_id, movement_type, amount, currency_code, reason)
    values ('72000000-0000-4000-8000-000000000000', '76000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000003', 'cash_in', 1, 'XOF', 'direct');
    raise exception 'ÉCHEC 3c : insertion directe acceptée';
  exception when insufficient_privilege then null;
  end;
  raise notice 'OK 3 : vendeur limité aux petites dépenses';
end;
$test$;

-- 4. Magasinier et autre boutique : refusés.
select set_config('request.jwt.claims', '{"sub":"70000000-0000-4000-8000-000000000004","role":"authenticated"}', true);
do $test$
begin
  perform public.record_cash_movement('72000000-0000-4000-8000-000000000000', '76000000-0000-4000-8000-000000000001', 'expense', 100, 'Magasinier', null);
  raise exception 'ÉCHEC 4a : magasinier accepté';
exception when sqlstate '42501' then
  raise notice 'OK 4a : magasinier refusé';
end;
$test$;
select set_config('request.jwt.claims', '{"sub":"80000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
do $test$
begin
  perform public.record_cash_movement('72000000-0000-4000-8000-000000000000', '76000000-0000-4000-8000-000000000001', 'cash_in', 100, 'Autre boutique', null);
  raise exception 'ÉCHEC 4b : autre boutique acceptée';
exception when sqlstate '42501' then
  raise notice 'OK 4b : autre boutique refusée';
end;
$test$;

-- -----------------------------------------------------------------------------
-- 5. Clôture Z par le propriétaire, puis session fermée refusée
-- -----------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"70000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
do $test$
declare
  v jsonb := public.close_cash_session('76000000-0000-4000-8000-000000000001', 17000, 'Clôture test');
begin
  -- 20 000 − 3 000 (dépense du vendeur) = 17 000 attendus ; compté 17 000 → écart 0.
  if (v ->> 'expected_cash')::numeric <> 17000 or (v ->> 'discrepancy')::numeric <> 0 then raise exception 'ÉCHEC 5a : %', v; end if;
  begin
    perform public.record_cash_movement('72000000-0000-4000-8000-000000000000', '76000000-0000-4000-8000-000000000001', 'cash_in', 100, 'Après clôture', null);
    raise exception 'ÉCHEC 5b : mouvement sur session fermée';
  exception when sqlstate '22023' then null;
  end;
  raise notice 'OK 5 : clôture Z intégrant les mouvements';
end;
$test$;

rollback;
