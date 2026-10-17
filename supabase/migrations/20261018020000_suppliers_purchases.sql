-- =============================================================================
-- Fournisseurs et achats (lot H) : fournisseurs, bons de commande, réception, dette, règlements, coût moyen — ADDITIVE
-- =============================================================================
-- STATUT : PRÉPARÉE, NON APPLIQUÉE, NON TESTÉE EN EXÉCUTION.
-- Nature : uniquement de nouveaux objets (tables avec RLS activée, fonctions, index). Aucune fonction existante
-- n'est réécrite. La réception appelle public.record_stock_movement (type restock) : un MAGASINIER ne peut
-- réceptionner qu'une fois 20261017160100_team_roles_enforcement appliquée (sinon refus 42501 de cette fonction).
--
-- PRÉREQUIS : stock_entries_foundation, product_import (product_costs), team_accounts, cash_movements.
--
-- CHOIX
--   - Prix d'achat visibles du propriétaire et du gérant SEULEMENT : purchase_order_lines, purchase_receipt_lines,
--     supplier_ledger et les montants des bons ne sont lisibles que par eux. Le magasinier passe par
--     receivable_purchase_orders et receivable_purchase_lines, qui ne renvoient ni coût ni montant.
--   - Numéro de bon : BC-AAAA-NNNNNN par boutique et par année (compteur dédié purchase_order_counters : la
--     contrainte de document_counters n'accepte pas ce type et n'est pas modifiée).
--   - Coût unitaire d'achat saisi par unité d'achat (une unité de vente du produit) ; converti en unité de base.
--   - Coût moyen pondéré (product_costs.unit_cost, unité de base) à chaque réception :
--       nouveau = (stock avant × coût actuel + quantité reçue × coût reçu) / (stock avant + quantité reçue) ;
--     sans coût actuel ou avec un stock avant ≤ 0 : le coût reçu. Arrondi à 2 décimales.
--   - Dette fournisseur : supplier_ledger (débit à la réception = quantité × coût du bon ; crédit au règlement).
--     Règlement en espèces : sortie cash_out de la caisse ouverte (comptée dans le rapport X/Z), refusée si les
--     espèces attendues deviendraient négatives. Autres moyens : enregistrements manuels.
--
-- DROITS
--   save_supplier, create_purchase_order, cancel_purchase_order, record_supplier_payment, supplier_balances :
--   propriétaire et gérant. receive_purchase, receivable_* : propriétaire, gérant, magasinier.
--
-- RETOUR ARRIÈRE (une seule transaction, uniquement si aucune réception n'a été enregistrée)
--   drop function if exists public.supplier_balances(uuid);
--   drop function if exists public.record_supplier_payment(uuid, uuid, numeric, text, uuid, text, text);
--   drop function if exists public.receive_purchase(uuid, jsonb, text);
--   drop function if exists public.receivable_purchase_lines(uuid);
--   drop function if exists public.receivable_purchase_orders(uuid);
--   drop function if exists public.cancel_purchase_order(uuid, text);
--   drop function if exists public.create_purchase_order(uuid, uuid, jsonb, text);
--   drop function if exists public.save_supplier(uuid, uuid, text, text, text, text, boolean);
--   drop function if exists private.supplier_balance(uuid);
--   drop table if exists public.supplier_ledger, public.purchase_receipt_lines, public.purchase_receipts,
--     public.purchase_order_lines, public.purchase_orders, public.purchase_order_counters, public.suppliers;
-- =============================================================================

do $prereq$
begin
  if to_regprocedure('public.record_stock_movement(uuid,uuid,uuid,text,numeric,uuid,text)') is null
     or to_regclass('public.product_costs') is null or to_regprocedure('private.staff_role(uuid)') is null
     or to_regclass('public.cash_movement_details') is null then
    raise exception 'Prérequis manquant : stock_entries_foundation, product_import, team_accounts, cash_movements.';
  end if;
end;
$prereq$;


-- -----------------------------------------------------------------------------
-- a) Tables
-- -----------------------------------------------------------------------------
create table public.suppliers (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.sites(id) on delete cascade,
  name text not null constraint suppliers_name_check check (char_length(btrim(name)) between 1 and 120),
  phone text constraint suppliers_phone_check check (phone is null or char_length(phone) between 3 and 40),
  address text constraint suppliers_address_check check (address is null or char_length(address) <= 300),
  notes text constraint suppliers_notes_check check (notes is null or char_length(notes) <= 500),
  is_active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index suppliers_site_idx on public.suppliers (site_id, lower(name));

create table public.purchase_order_counters (
  site_id uuid not null references public.sites(id) on delete cascade,
  year integer not null,
  next_number bigint not null default 1,
  primary key (site_id, year)
);

create table public.purchase_orders (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.sites(id) on delete cascade,
  supplier_id uuid not null references public.suppliers(id) on delete restrict,
  number text not null,
  status text not null default 'ordered'
    constraint purchase_orders_status_check check (status in ('ordered', 'partially_received', 'received', 'cancelled')),
  currency_code text not null default 'XOF',
  total_amount numeric(14,2) not null default 0 constraint purchase_orders_total_check check (total_amount >= 0),
  note text constraint purchase_orders_note_check check (note is null or char_length(note) <= 500),
  cancel_reason text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (site_id, number)
);
create index purchase_orders_site_idx on public.purchase_orders (site_id, created_at desc);

create table public.purchase_order_lines (
  id uuid primary key default gen_random_uuid(),
  purchase_order_id uuid not null references public.purchase_orders(id) on delete cascade,
  site_id uuid not null references public.sites(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete restrict,
  product_name text not null,
  unit_id uuid not null references public.product_units(id) on delete restrict,
  unit_label text,
  conversion_to_base numeric not null constraint purchase_order_lines_conversion_check check (conversion_to_base > 0),
  quantity numeric(14,3) not null constraint purchase_order_lines_quantity_check check (quantity > 0),
  received_quantity numeric(14,3) not null default 0 constraint purchase_order_lines_received_check check (received_quantity >= 0),
  unit_cost numeric(14,2) not null constraint purchase_order_lines_cost_check check (unit_cost >= 0),
  constraint purchase_order_lines_not_over_received check (received_quantity <= quantity)
);
create index purchase_order_lines_po_idx on public.purchase_order_lines (purchase_order_id);

create table public.purchase_receipts (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.sites(id) on delete cascade,
  purchase_order_id uuid not null references public.purchase_orders(id) on delete restrict,
  total_amount numeric(14,2) not null,
  note text constraint purchase_receipts_note_check check (note is null or char_length(note) <= 500),
  received_by uuid references auth.users(id) on delete set null,
  received_role text,
  created_at timestamptz not null default now()
);

create table public.purchase_receipt_lines (
  id uuid primary key default gen_random_uuid(),
  receipt_id uuid not null references public.purchase_receipts(id) on delete cascade,
  site_id uuid not null references public.sites(id) on delete cascade,
  purchase_order_line_id uuid not null references public.purchase_order_lines(id) on delete restrict,
  product_id uuid not null references public.products(id) on delete restrict,
  quantity numeric(14,3) not null constraint purchase_receipt_lines_quantity_check check (quantity > 0),
  unit_cost numeric(14,2) not null,
  stock_location_id uuid not null references public.stock_locations(id) on delete restrict,
  stock_movement_id uuid,
  average_cost_before numeric(14,2),
  average_cost_after numeric(14,2)
);

create table public.supplier_ledger (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.sites(id) on delete cascade,
  supplier_id uuid not null references public.suppliers(id) on delete restrict,
  entry_type text not null constraint supplier_ledger_type_check check (entry_type in ('purchase', 'payment')),
  amount numeric(14,2) not null constraint supplier_ledger_amount_check check (amount > 0),
  receipt_id uuid references public.purchase_receipts(id) on delete restrict,
  purchase_order_number text,
  payment_method text constraint supplier_ledger_method_check check (payment_method is null or payment_method in ('cash', 'wave', 'orange_money', 'card', 'bank_transfer')),
  cash_movement_id uuid references public.cash_register_movements(id) on delete restrict,
  reference text constraint supplier_ledger_reference_check check (reference is null or char_length(reference) <= 100),
  note text constraint supplier_ledger_note_check check (note is null or char_length(note) <= 300),
  recorded_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index supplier_ledger_supplier_idx on public.supplier_ledger (supplier_id, created_at);

alter table public.suppliers enable row level security;
alter table public.purchase_order_counters enable row level security;
alter table public.purchase_orders enable row level security;
alter table public.purchase_order_lines enable row level security;
alter table public.purchase_receipts enable row level security;
alter table public.purchase_receipt_lines enable row level security;
alter table public.supplier_ledger enable row level security;
revoke all on public.suppliers, public.purchase_order_counters, public.purchase_orders, public.purchase_order_lines,
  public.purchase_receipts, public.purchase_receipt_lines, public.supplier_ledger from anon, authenticated;

-- Noms des fournisseurs : propriétaire, gérant, magasinier. Tout ce qui porte un coût : propriétaire et gérant.
create policy suppliers_staff_read on public.suppliers for select to authenticated
  using (coalesce(private.staff_role(site_id), '') in ('owner', 'manager', 'stock_keeper'));
create policy purchase_orders_manager_read on public.purchase_orders for select to authenticated
  using (coalesce(private.staff_role(site_id), '') in ('owner', 'manager'));
create policy purchase_order_lines_manager_read on public.purchase_order_lines for select to authenticated
  using (coalesce(private.staff_role(site_id), '') in ('owner', 'manager'));
create policy purchase_receipts_manager_read on public.purchase_receipts for select to authenticated
  using (coalesce(private.staff_role(site_id), '') in ('owner', 'manager'));
create policy purchase_receipt_lines_manager_read on public.purchase_receipt_lines for select to authenticated
  using (coalesce(private.staff_role(site_id), '') in ('owner', 'manager'));
create policy supplier_ledger_manager_read on public.supplier_ledger for select to authenticated
  using (coalesce(private.staff_role(site_id), '') in ('owner', 'manager'));
grant select on public.suppliers, public.purchase_orders, public.purchase_order_lines, public.purchase_receipts,
  public.purchase_receipt_lines, public.supplier_ledger to authenticated;


-- -----------------------------------------------------------------------------
-- b) Fournisseurs
-- -----------------------------------------------------------------------------
create or replace function private.supplier_balance(p_supplier_id uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $function$
  select coalesce(sum(case when entry_type = 'purchase' then amount else -amount end), 0)
  from public.supplier_ledger where supplier_id = p_supplier_id;
$function$;
revoke all on function private.supplier_balance(uuid) from public, anon, authenticated;

create or replace function public.save_supplier(
  p_site_id uuid, p_supplier_id uuid, p_name text, p_phone text, p_address text, p_notes text, p_is_active boolean default true
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_name text := nullif(btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g')), '');
  v_id uuid;
begin
  if v_uid is null or coalesce(private.staff_role(p_site_id), '') not in ('owner', 'manager') then
    raise exception 'Fournisseurs réservés au propriétaire et au gérant.' using errcode = '42501';
  end if;
  if v_name is null or char_length(v_name) > 120 then
    raise exception 'Nom du fournisseur obligatoire (120 caractères au plus).' using errcode = '22023';
  end if;
  if p_supplier_id is null then
    insert into public.suppliers (site_id, name, phone, address, notes, created_by)
    values (p_site_id, v_name, nullif(btrim(coalesce(p_phone, '')), ''), nullif(btrim(coalesce(p_address, '')), ''),
            nullif(btrim(coalesce(p_notes, '')), ''), v_uid)
    returning id into v_id;
  else
    update public.suppliers set name = v_name, phone = nullif(btrim(coalesce(p_phone, '')), ''),
      address = nullif(btrim(coalesce(p_address, '')), ''), notes = nullif(btrim(coalesce(p_notes, '')), ''),
      is_active = coalesce(p_is_active, is_active), updated_at = now()
    where id = p_supplier_id and site_id = p_site_id
    returning id into v_id;
    if v_id is null then
      raise exception 'Fournisseur introuvable dans cette boutique.' using errcode = '22023';
    end if;
  end if;
  return v_id;
end;
$function$;
revoke all on function public.save_supplier(uuid, uuid, text, text, text, text, boolean) from public, anon;
grant execute on function public.save_supplier(uuid, uuid, text, text, text, text, boolean) to authenticated;


-- -----------------------------------------------------------------------------
-- c) Bons de commande
-- -----------------------------------------------------------------------------
-- p_lines : [{ "product_id": uuid, "unit_id": uuid?, "quantity": nombre, "unit_cost": entier }]
create or replace function public.create_purchase_order(p_site_id uuid, p_supplier_id uuid, p_lines jsonb, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_year integer := extract(year from (now() at time zone 'Africa/Dakar'))::integer;
  v_seq bigint;
  v_number text;
  v_po_id uuid := gen_random_uuid();
  v_line jsonb;
  v_product public.products%rowtype;
  v_sell public.product_sell_units%rowtype;
  v_unit public.product_units%rowtype;
  v_qty numeric;
  v_cost numeric;
  v_total numeric := 0;
begin
  if v_uid is null or coalesce(private.staff_role(p_site_id), '') not in ('owner', 'manager') then
    raise exception 'Bons de commande réservés au propriétaire et au gérant.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.suppliers s where s.id = p_supplier_id and s.site_id = p_site_id and s.is_active) then
    raise exception 'Fournisseur introuvable ou désactivé.' using errcode = '22023';
  end if;
  if jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines) = 0 or jsonb_array_length(p_lines) > 200 then
    raise exception 'Le bon de commande doit contenir 1 à 200 lignes.' using errcode = '22023';
  end if;
  if char_length(coalesce(p_note, '')) > 500 then
    raise exception 'Note trop longue (500 caractères au plus).' using errcode = '22023';
  end if;

  insert into public.purchase_order_counters (site_id, year) values (p_site_id, v_year) on conflict do nothing;
  update public.purchase_order_counters set next_number = next_number + 1
  where site_id = p_site_id and year = v_year returning next_number - 1 into v_seq;
  v_number := 'BC-' || v_year || '-' || lpad(v_seq::text, 6, '0');

  insert into public.purchase_orders (id, site_id, supplier_id, number, note, created_by)
  values (v_po_id, p_site_id, p_supplier_id, v_number, nullif(btrim(coalesce(p_note, '')), ''), v_uid);

  for v_line in select value from jsonb_array_elements(p_lines) loop
    select * into v_product from public.products
    where id = case when jsonb_typeof(v_line -> 'product_id') = 'string' then (v_line ->> 'product_id')::uuid end and site_id = p_site_id;
    if not found then
      raise exception 'Produit introuvable dans cette boutique.' using errcode = '22023';
    end if;
    if jsonb_typeof(v_line -> 'unit_id') = 'string' then
      select * into v_sell from public.product_sell_units where product_id = v_product.id and unit_id = (v_line ->> 'unit_id')::uuid;
    else
      select * into v_sell from public.product_sell_units where product_id = v_product.id and conversion_to_base = 1 order by is_default desc limit 1;
    end if;
    if not found then
      raise exception '« % » : unité d''achat introuvable (choisissez une unité de vente du produit).', v_product.name using errcode = '22023';
    end if;
    select * into v_unit from public.product_units where id = v_sell.unit_id;
    if jsonb_typeof(v_line -> 'quantity') <> 'number' or jsonb_typeof(v_line -> 'unit_cost') <> 'number' then
      raise exception '« % » : quantité et coût obligatoires.', v_product.name using errcode = '22023';
    end if;
    v_qty := (v_line ->> 'quantity')::numeric;
    v_cost := (v_line ->> 'unit_cost')::numeric;
    if v_qty <= 0 or v_qty <> round(v_qty, v_unit.decimal_places) then
      raise exception '« % » : quantité invalide (% décimale(s) au plus).', v_product.name, v_unit.decimal_places using errcode = '22023';
    end if;
    if v_cost < 0 or v_cost <> round(v_cost, 0) then
      raise exception '« % » : coût d''achat invalide (entier positif ou nul).', v_product.name using errcode = '22023';
    end if;
    insert into public.purchase_order_lines (purchase_order_id, site_id, product_id, product_name, unit_id, unit_label, conversion_to_base, quantity, unit_cost)
    values (v_po_id, p_site_id, v_product.id, v_product.name, v_unit.id, v_unit.label, v_sell.conversion_to_base, v_qty, v_cost);
    v_total := v_total + round(v_qty * v_cost, 0);
  end loop;

  update public.purchase_orders set total_amount = v_total where id = v_po_id;
  return jsonb_build_object('purchase_order_id', v_po_id, 'number', v_number, 'total_amount', v_total);
end;
$function$;
revoke all on function public.create_purchase_order(uuid, uuid, jsonb, text) from public, anon;
grant execute on function public.create_purchase_order(uuid, uuid, jsonb, text) to authenticated;

create or replace function public.cancel_purchase_order(p_purchase_order_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_po public.purchase_orders%rowtype;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  select * into v_po from public.purchase_orders where id = p_purchase_order_id for update;
  if not found or auth.uid() is null or coalesce(private.staff_role(v_po.site_id), '') not in ('owner', 'manager') then
    raise exception 'Bon de commande introuvable.' using errcode = '42501';
  end if;
  if v_po.status <> 'ordered' then
    raise exception 'Seul un bon sans aucune réception peut être annulé (statut %).', v_po.status using errcode = '22023';
  end if;
  if v_reason is null or char_length(v_reason) < 3 or char_length(v_reason) > 300 then
    raise exception 'Motif d''annulation obligatoire (3 à 300 caractères).' using errcode = '22023';
  end if;
  update public.purchase_orders set status = 'cancelled', cancel_reason = v_reason, updated_at = now() where id = v_po.id;
  return jsonb_build_object('purchase_order_id', v_po.id, 'status', 'cancelled');
end;
$function$;
revoke all on function public.cancel_purchase_order(uuid, text) from public, anon;
grant execute on function public.cancel_purchase_order(uuid, text) to authenticated;


-- -----------------------------------------------------------------------------
-- d) Réception (magasinier compris) : AUCUN coût ni montant renvoyé
-- -----------------------------------------------------------------------------
create or replace function public.receivable_purchase_orders(p_site_id uuid)
returns table (purchase_order_id uuid, number text, supplier_name text, status text, created_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  if coalesce(private.staff_role(p_site_id), '') not in ('owner', 'manager', 'stock_keeper') then
    raise exception 'Réception réservée au propriétaire, au gérant et au magasinier.' using errcode = '42501';
  end if;
  return query
    select po.id, po.number, s.name, po.status, po.created_at
    from public.purchase_orders po join public.suppliers s on s.id = po.supplier_id
    where po.site_id = p_site_id and po.status in ('ordered', 'partially_received')
    order by po.created_at;
end;
$function$;
revoke all on function public.receivable_purchase_orders(uuid) from public, anon;
grant execute on function public.receivable_purchase_orders(uuid) to authenticated;

create or replace function public.receivable_purchase_lines(p_purchase_order_id uuid)
returns table (line_id uuid, product_id uuid, product_name text, unit_label text, decimal_places integer,
               quantity_ordered numeric, quantity_received numeric, quantity_remaining numeric)
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_site uuid;
begin
  select po.site_id into v_site from public.purchase_orders po where po.id = p_purchase_order_id;
  if v_site is null or coalesce(private.staff_role(v_site), '') not in ('owner', 'manager', 'stock_keeper') then
    raise exception 'Bon de commande introuvable.' using errcode = '22023';
  end if;
  return query
    select l.id, l.product_id, l.product_name, l.unit_label, coalesce(u.decimal_places, 0),
           l.quantity, l.received_quantity, l.quantity - l.received_quantity
    from public.purchase_order_lines l left join public.product_units u on u.id = l.unit_id
    where l.purchase_order_id = p_purchase_order_id
    order by l.product_name;
end;
$function$;
revoke all on function public.receivable_purchase_lines(uuid) from public, anon;
grant execute on function public.receivable_purchase_lines(uuid) to authenticated;

-- p_lines : [{ "line_id": uuid, "quantity": nombre, "location_id": uuid }]. Les coûts viennent du bon (non modifiables ici).
create or replace function public.receive_purchase(p_purchase_order_id uuid, p_lines jsonb, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_po public.purchase_orders%rowtype;
  v_role text;
  v_line jsonb;
  v_pol public.purchase_order_lines%rowtype;
  v_qty numeric;
  v_decimals integer;
  v_location uuid;
  v_receipt_id uuid := gen_random_uuid();
  v_total numeric := 0;
  v_stock_before numeric;
  v_cost_before numeric;
  v_cost_base numeric;
  v_cost_after numeric;
  v_base_qty numeric;
  v_movement jsonb;
  v_count integer := 0;
begin
  select * into v_po from public.purchase_orders where id = p_purchase_order_id for update;
  if not found then
    raise exception 'Bon de commande introuvable.' using errcode = '22023';
  end if;
  v_role := private.staff_role(v_po.site_id);
  if v_uid is null or coalesce(v_role, '') not in ('owner', 'manager', 'stock_keeper') then
    raise exception 'Réception réservée au propriétaire, au gérant et au magasinier.' using errcode = '42501';
  end if;
  if v_po.status not in ('ordered', 'partially_received') then
    raise exception 'Bon % : réception impossible (statut %).', v_po.number, v_po.status using errcode = '22023';
  end if;
  if jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'Aucune ligne reçue.' using errcode = '22023';
  end if;
  if char_length(coalesce(p_note, '')) > 500 then
    raise exception 'Note trop longue (500 caractères au plus).' using errcode = '22023';
  end if;

  insert into public.purchase_receipts (id, site_id, purchase_order_id, total_amount, note, received_by, received_role)
  values (v_receipt_id, v_po.site_id, v_po.id, 0, nullif(btrim(coalesce(p_note, '')), ''), v_uid, v_role);

  for v_line in select value from jsonb_array_elements(p_lines) loop
    select * into v_pol from public.purchase_order_lines
    where id = case when jsonb_typeof(v_line -> 'line_id') = 'string' then (v_line ->> 'line_id')::uuid end
      and purchase_order_id = v_po.id for update;
    if not found then
      raise exception 'Ligne introuvable dans ce bon.' using errcode = '22023';
    end if;
    if jsonb_typeof(v_line -> 'quantity') <> 'number' then
      raise exception '« % » : quantité invalide.', v_pol.product_name using errcode = '22023';
    end if;
    v_qty := (v_line ->> 'quantity')::numeric;
    continue when v_qty = 0;
    select coalesce(u.decimal_places, 0) into v_decimals from public.product_units u where u.id = v_pol.unit_id;
    if v_qty < 0 or v_qty <> round(v_qty, coalesce(v_decimals, 0)) then
      raise exception '« % » : quantité invalide.', v_pol.product_name using errcode = '22023';
    end if;
    if v_pol.received_quantity + v_qty > v_pol.quantity then
      raise exception '« % » : réception supérieure au restant à recevoir (% restant).', v_pol.product_name,
        v_pol.quantity - v_pol.received_quantity using errcode = '23514';
    end if;
    v_location := case when jsonb_typeof(v_line -> 'location_id') = 'string' then (v_line ->> 'location_id')::uuid end;

    -- Coût moyen pondéré, en unité de base, calculé AVANT l'entrée en stock.
    select coalesce(sum(m.quantity_delta), 0) into v_stock_before
    from public.inventory_movements m where m.site_id = v_po.site_id and m.product_id = v_pol.product_id and m.variant_id is null;
    select c.unit_cost into v_cost_before from public.product_costs c where c.product_id = v_pol.product_id;
    v_base_qty := v_qty * v_pol.conversion_to_base;
    v_cost_base := v_pol.unit_cost / v_pol.conversion_to_base;
    v_cost_after := round(case
      when v_cost_before is null or v_stock_before <= 0 then v_cost_base
      else (v_stock_before * v_cost_before + v_base_qty * v_cost_base) / (v_stock_before + v_base_qty)
    end, 2);

    -- Entrée de stock par la fonction contrôlée (rôle, emplacement actif, décimales, audit).
    v_movement := public.record_stock_movement(v_po.site_id, v_pol.product_id, v_location, 'restock', v_qty, v_pol.unit_id,
      left('Réception ' || v_po.number, 500));

    insert into public.product_costs (product_id, site_id, unit_cost, updated_by)
    values (v_pol.product_id, v_po.site_id, v_cost_after, v_uid)
    on conflict (product_id) do update set unit_cost = excluded.unit_cost, updated_at = now(), updated_by = excluded.updated_by;

    update public.purchase_order_lines set received_quantity = received_quantity + v_qty where id = v_pol.id;
    insert into public.purchase_receipt_lines (receipt_id, site_id, purchase_order_line_id, product_id, quantity, unit_cost,
      stock_location_id, stock_movement_id, average_cost_before, average_cost_after)
    values (v_receipt_id, v_po.site_id, v_pol.id, v_pol.product_id, v_qty, v_pol.unit_cost, v_location,
      (v_movement ->> 'movement_id')::uuid, v_cost_before, v_cost_after);
    v_total := v_total + round(v_qty * v_pol.unit_cost, 0);
    v_count := v_count + 1;
  end loop;

  if v_count = 0 then
    raise exception 'Aucune quantité reçue.' using errcode = '22023';
  end if;

  update public.purchase_receipts set total_amount = v_total where id = v_receipt_id;
  if v_total > 0 then
    insert into public.supplier_ledger (site_id, supplier_id, entry_type, amount, receipt_id, purchase_order_number, recorded_by)
    values (v_po.site_id, v_po.supplier_id, 'purchase', v_total, v_receipt_id, v_po.number, v_uid);
  end if;
  update public.purchase_orders set
    status = case when exists (select 1 from public.purchase_order_lines l where l.purchase_order_id = v_po.id and l.received_quantity < l.quantity)
                  then 'partially_received' else 'received' end,
    updated_at = now()
  where id = v_po.id;

  -- Aucun montant dans la réponse : le magasinier peut appeler cette fonction.
  return jsonb_build_object('receipt_id', v_receipt_id, 'purchase_order_id', v_po.id, 'lines_received', v_count,
    'status', (select status from public.purchase_orders where id = v_po.id));
end;
$function$;
revoke all on function public.receive_purchase(uuid, jsonb, text) from public, anon;
grant execute on function public.receive_purchase(uuid, jsonb, text) to authenticated;


-- -----------------------------------------------------------------------------
-- e) Règlements et dettes
-- -----------------------------------------------------------------------------
create or replace function public.record_supplier_payment(
  p_site_id uuid, p_supplier_id uuid, p_amount numeric, p_method text,
  p_cash_session_id uuid default null, p_reference text default null, p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_role text := private.staff_role(p_site_id);
  v_supplier public.suppliers%rowtype;
  v_session public.cash_register_sessions%rowtype;
  v_balance numeric;
  v_expected numeric;
  v_movement uuid;
  v_entry uuid;
begin
  if v_uid is null or coalesce(v_role, '') not in ('owner', 'manager') then
    raise exception 'Règlements fournisseurs réservés au propriétaire et au gérant.' using errcode = '42501';
  end if;
  if p_method is null or p_method not in ('cash', 'wave', 'orange_money', 'card', 'bank_transfer') then
    raise exception 'Moyen de règlement inconnu : %.', coalesce(p_method, '(vide)') using errcode = '22023';
  end if;
  if p_amount is null or p_amount <= 0 or p_amount <> round(p_amount, 0) then
    raise exception 'Montant invalide : entier supérieur à zéro.' using errcode = '22023';
  end if;
  if char_length(coalesce(p_reference, '')) > 100 or char_length(coalesce(p_note, '')) > 300 then
    raise exception 'Référence (100) ou note (300) trop longue.' using errcode = '22023';
  end if;
  select * into v_supplier from public.suppliers where id = p_supplier_id and site_id = p_site_id for update;
  if not found then
    raise exception 'Fournisseur introuvable dans cette boutique.' using errcode = '22023';
  end if;
  v_balance := private.supplier_balance(v_supplier.id);
  if p_amount > v_balance then
    raise exception 'Règlement supérieur à la dette (% XOF).', v_balance using errcode = '22023';
  end if;

  if p_method = 'cash' then
    select * into v_session from public.cash_register_sessions where id = p_cash_session_id and site_id = p_site_id for update;
    if not found or v_session.status <> 'open' then
      raise exception 'Règlement en espèces : une caisse ouverte de la boutique est obligatoire.' using errcode = '22023';
    end if;
    v_expected := (public.cash_session_summary(v_session.id) ->> 'expected_cash')::numeric;
    if v_expected < p_amount then
      raise exception 'Espèces insuffisantes en caisse (% attendus).', v_expected using errcode = '23514';
    end if;
    insert into public.cash_register_movements (site_id, session_id, actor_user_id, movement_type, amount, currency_code, reason)
    values (p_site_id, v_session.id, v_uid, 'cash_out', p_amount, v_session.currency_code, left('Règlement fournisseur ' || v_supplier.name, 300))
    returning id into v_movement;
    insert into public.cash_movement_details (movement_id, site_id, session_id, receipt_ref, recorded_by, recorded_role)
    values (v_movement, p_site_id, v_session.id, nullif(btrim(coalesce(p_reference, '')), ''), v_uid, v_role);
  end if;

  insert into public.supplier_ledger (site_id, supplier_id, entry_type, amount, payment_method, cash_movement_id, reference, note, recorded_by)
  values (p_site_id, v_supplier.id, 'payment', p_amount, p_method, v_movement,
          nullif(btrim(coalesce(p_reference, '')), ''), nullif(btrim(coalesce(p_note, '')), ''), v_uid)
  returning id into v_entry;
  return jsonb_build_object('entry_id', v_entry, 'balance', v_balance - p_amount);
end;
$function$;
revoke all on function public.record_supplier_payment(uuid, uuid, numeric, text, uuid, text, text) from public, anon;
grant execute on function public.record_supplier_payment(uuid, uuid, numeric, text, uuid, text, text) to authenticated;

create or replace function public.supplier_balances(p_site_id uuid)
returns table (supplier_id uuid, name text, phone text, balance numeric, purchases_total numeric, payments_total numeric)
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  if coalesce(private.staff_role(p_site_id), '') not in ('owner', 'manager') then
    raise exception 'Dettes fournisseurs réservées au propriétaire et au gérant.' using errcode = '42501';
  end if;
  return query
    select s.id, s.name, s.phone,
      coalesce(sum(case when l.entry_type = 'purchase' then l.amount else -l.amount end), 0),
      coalesce(sum(l.amount) filter (where l.entry_type = 'purchase'), 0),
      coalesce(sum(l.amount) filter (where l.entry_type = 'payment'), 0)
    from public.suppliers s left join public.supplier_ledger l on l.supplier_id = s.id
    where s.site_id = p_site_id
    group by s.id, s.name, s.phone
    order by s.name;
end;
$function$;
revoke all on function public.supplier_balances(uuid) from public, anon;
grant execute on function public.supplier_balances(uuid) to authenticated;
