-- =============================================================================
-- Fondation des ventes en caisse (jalon Q3) : vente comptoir, numérotation, annulation, clôture Z
-- =============================================================================
-- STATUT : PRÉPARÉE, NON TESTÉE (Docker indisponible), NON APPLIQUÉE.
-- NE PAS APPLIQUER sans l'autorisation écrite du propriétaire nommant « pos_sales_foundation ».
--
-- PRÉREQUIS
--   La migration fix_store_audit_trigger_columns doit être appliquée AVANT : le déclencheur
--   d'audit posé sur orders, inventory_movements et payment_transactions écrit aujourd'hui dans
--   des colonnes inexistantes, et ferait échouer toute vente. Le bloc 0 le vérifie et s'arrête sinon.
--
-- CONTENU
--   a) orders : vente comptoir sans client (customer_id, customer_phone facultatifs), canal, caissier,
--      session de caisse, montant remis, monnaie rendue, résumé des paiements, détail des remises.
--      order_items : quantité numérique (kg, m, m²), unité, remise de ligne, coût figé (facultatif).
--      payment_transactions : moyen de paiement et fournisseurs manuels (aucun paiement réel).
--      cash_register_sessions : une seule session ouverte par caisse et par site.
--   b) document_counters + private.next_document_number : numéro continu par site, type et année,
--      au format TICKET-2026-000001, sans trou ni doublon (verrou de ligne, même transaction).
--   c) public.record_sale : vente complète dans une seule transaction, prix relus en base.
--   d) public.void_sale : annulation par propriétaire ou admin, motif obligatoire, contre-passation.
--   e) public.cash_session_summary (X) et public.close_cash_session (Z).
--
-- CHOIX À CONNAÎTRE
--   - Rôles autorisés à vendre : propriétaire, admin, editor. publisher et viewer : refusés (42501).
--   - Remise manuelle : propriétaire et admin jusqu'à 100 % ; editor jusqu'à
--     sites.settings->pos->editor_max_discount_percent (0 par défaut : aucune remise).
--     Toute remise exige un motif et est tracée dans orders.discount_details.
--   - Stock : refus si insuffisant à l'emplacement, sauf products.allow_backorder = true
--     ou sites.settings->pos->allow_negative_stock = true. Produit non suivi (track_inventory = false) :
--     ni contrôle ni mouvement.
--   - Prix : palier valide de l'unité de vente (le plus haut minimum atteint), sinon
--     products.price × conversion. Montants arrondis à l'unité en XOF. Le prix envoyé par le client est ignoré.
--   - TVA : aucune taxe n'est calculée (tax_total = 0). Aucune conformité fiscale n'est revendiquée.
--   - Wave, Orange Money et carte : ENREGISTREMENTS MANUELS (provider manual_wave, manual_orange_money,
--     manual_card). Aucun appel à un fournisseur de paiement. Crédit : paiement en attente (pending).
--   - Numérotation annuelle : le compteur repart à 1 chaque année civile (fuseau Africa/Dakar).
--   - Annulation d'une vente payée en espèces : remboursement inscrit dans la session d'origine si elle
--     est encore ouverte ; sinon aucun mouvement de caisse n'est écrit et le résultat le signale.
--   - Clôture Z : correction (movement_type 'correction') est exclue du calcul attendu et rapportée
--     à part, car son sens (entrée ou sortie) n'est pas défini dans le schéma.
--
-- RETOUR ARRIÈRE (une seule transaction, uniquement si aucune vente n'a été enregistrée)
--   drop function if exists public.close_cash_session(uuid, numeric, text);
--   drop function if exists public.cash_session_summary(uuid);
--   drop function if exists public.void_sale(uuid, text);
--   drop function if exists public.record_sale(uuid, uuid, jsonb, jsonb, jsonb, jsonb);
--   drop function if exists private.next_document_number(uuid, text);
--   drop function if exists private.site_role(uuid);
--   drop table if exists public.document_counters;
--   drop index if exists public.cash_register_sessions_one_open;
--   drop index if exists public.orders_cash_session_idx;
--   drop index if exists public.orders_site_placed_idx;
--   alter table public.payment_transactions drop column if exists payment_method;
--   alter table public.payment_transactions drop constraint payment_transactions_provider_check;
--   alter table public.payment_transactions add constraint payment_transactions_provider_check check (provider = any (array['paydunya','wave','orange_money','free_money','cash_on_delivery','manual','other']));
--   alter table public.order_items drop column if exists unit_id, drop column if exists unit_label,
--     drop column if exists line_discount, drop column if exists cost_price_snapshot;
--   alter table public.order_items drop constraint order_items_quantity_check;
--   alter table public.order_items alter column quantity type integer using quantity::integer;
--   alter table public.order_items add constraint order_items_quantity_check check (quantity >= 1 and quantity <= 999);
--   alter table public.orders drop constraint if exists orders_pos_session_check;
--   alter table public.orders drop column if exists sales_channel, drop column if exists cashier_id,
--     drop column if exists cash_session_id, drop column if exists amount_tendered, drop column if exists change_given,
--     drop column if exists payment_summary, drop column if exists discount_details;
--   alter table public.orders alter column customer_id set not null, alter column customer_phone set not null;
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 0) Prérequis : déclencheur d'audit corrigé
-- -----------------------------------------------------------------------------
do $prereq$
begin
  if position('before_data' in pg_get_functiondef('private.capture_store_audit_event()'::regprocedure)) > 0 then
    raise exception 'Prérequis manquant : appliquer d''abord la migration fix_store_audit_trigger_columns.';
  end if;
end;
$prereq$;


-- -----------------------------------------------------------------------------
-- a) Évolution des tables
-- -----------------------------------------------------------------------------
alter table public.orders
  alter column customer_id drop not null,
  alter column customer_phone drop not null;

alter table public.orders
  add column sales_channel text not null default 'online'
    constraint orders_sales_channel_check check (sales_channel in ('pos', 'online', 'quote')),
  add column cashier_id uuid references auth.users(id) on delete set null,
  add column cash_session_id uuid references public.cash_register_sessions(id) on delete restrict,
  add column amount_tendered numeric(14,2)
    constraint orders_amount_tendered_check check (amount_tendered is null or amount_tendered >= 0),
  add column change_given numeric(14,2)
    constraint orders_change_given_check check (change_given is null or change_given >= 0),
  add column payment_summary jsonb not null default '{}'::jsonb
    constraint orders_payment_summary_check check (jsonb_typeof(payment_summary) = 'object'),
  add column discount_details jsonb not null default '{}'::jsonb
    constraint orders_discount_details_check check (jsonb_typeof(discount_details) = 'object');

alter table public.orders
  add constraint orders_pos_session_check check (sales_channel <> 'pos' or cash_session_id is not null);

create index orders_cash_session_idx on public.orders (cash_session_id) where cash_session_id is not null;
create index orders_site_placed_idx on public.orders (site_id, placed_at desc);

alter table public.order_items drop constraint order_items_quantity_check;
alter table public.order_items alter column quantity type numeric(14,3) using quantity::numeric;
alter table public.order_items
  add constraint order_items_quantity_check check (quantity > 0 and quantity <= 999999);

alter table public.order_items
  add column unit_id uuid references public.product_units(id) on delete restrict,
  add column unit_label text
    constraint order_items_unit_label_check check (unit_label is null or char_length(btrim(unit_label)) between 1 and 60),
  add column line_discount numeric(14,2) not null default 0
    constraint order_items_line_discount_check check (line_discount >= 0),
  add column cost_price_snapshot numeric(14,2)
    constraint order_items_cost_price_snapshot_check check (cost_price_snapshot is null or cost_price_snapshot >= 0);

alter table public.payment_transactions drop constraint payment_transactions_provider_check;
alter table public.payment_transactions add constraint payment_transactions_provider_check check (provider = any (array[
  'paydunya', 'wave', 'orange_money', 'free_money', 'cash_on_delivery', 'manual', 'other',
  'manual_cash', 'manual_wave', 'manual_orange_money', 'manual_card', 'store_credit'
]));
alter table public.payment_transactions
  add column payment_method text
    constraint payment_transactions_payment_method_check
    check (payment_method is null or payment_method in ('cash', 'wave', 'orange_money', 'card', 'credit'));

create unique index cash_register_sessions_one_open
  on public.cash_register_sessions (site_id, register_name) where status = 'open';


-- -----------------------------------------------------------------------------
-- b) Numérotation continue des documents
-- -----------------------------------------------------------------------------
create table public.document_counters (
  site_id uuid not null references public.sites(id) on delete cascade,
  document_type text not null
    constraint document_counters_type_check check (document_type in ('receipt', 'invoice', 'credit_note', 'quote', 'delivery_note')),
  year integer not null constraint document_counters_year_check check (year between 2000 and 2999),
  prefix text not null constraint document_counters_prefix_check check (prefix ~ '^[A-Z]{2,12}$'),
  next_number bigint not null default 1 constraint document_counters_next_check check (next_number >= 1),
  updated_at timestamptz not null default now(),
  primary key (site_id, document_type, year)
);

alter table public.document_counters enable row level security;

create policy document_counters_member_read on public.document_counters
  for select to authenticated
  using (exists (
    select 1 from public.sites s
    where s.id = document_counters.site_id and private.has_workspace_access(s.workspace_id, null)
  ));

revoke all on public.document_counters from anon, authenticated;
grant select on public.document_counters to authenticated;

-- Rôle de l'utilisateur courant sur le site : 'owner', le rôle de membre, ou null.
create or replace function private.site_role(p_site_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $function$
  select case
    when w.owner_id = (select auth.uid()) then 'owner'
    else (
      select m.role from public.workspace_memberships m
      where m.workspace_id = w.id and m.user_id = (select auth.uid())
    )
  end
  from public.sites s
  join public.workspaces w on w.id = s.workspace_id
  where s.id = p_site_id;
$function$;

revoke all on function private.site_role(uuid) from public, anon, authenticated;

-- Le verrou de ligne (UPDATE) sérialise les appels concurrents ; un échec de la transaction
-- annule aussi l'incrément : aucun trou, aucun doublon.
create or replace function private.next_document_number(p_site_id uuid, p_document_type text)
returns text
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_year integer := extract(year from (now() at time zone 'Africa/Dakar'))::integer;
  v_prefix text;
  v_number bigint;
begin
  v_prefix := case p_document_type
    when 'receipt' then 'TICKET'
    when 'invoice' then 'FACT'
    when 'credit_note' then 'AVOIR'
    when 'quote' then 'DEVIS'
    when 'delivery_note' then 'BL'
  end;
  if v_prefix is null then
    raise exception 'Type de document inconnu : %.', p_document_type using errcode = '22023';
  end if;

  insert into public.document_counters (site_id, document_type, year, prefix)
  values (p_site_id, p_document_type, v_year, v_prefix)
  on conflict (site_id, document_type, year) do nothing;

  update public.document_counters
  set next_number = next_number + 1, updated_at = now()
  where site_id = p_site_id and document_type = p_document_type and year = v_year
  returning next_number - 1, prefix into v_number, v_prefix;

  return v_prefix || '-' || v_year::text || '-' || lpad(v_number::text, 6, '0');
end;
$function$;

revoke all on function private.next_document_number(uuid, text) from public, anon, authenticated;


-- -----------------------------------------------------------------------------
-- c) Enregistrement d'une vente
-- -----------------------------------------------------------------------------
-- p_lines    : [{ "product_id": uuid, "unit_id": uuid?, "quantity": nombre, "location_id": uuid?, "discount": montant? }]
--              Tout autre champ (par exemple unit_price) est ignoré.
-- p_payments : [{ "method": "cash"|"wave"|"orange_money"|"card"|"credit", "amount": montant, "reference": texte? }]
--              Les espèces peuvent dépasser le reste à payer : la différence est la monnaie rendue.
-- p_customer : { "name": texte?, "phone": texte? }   (obligatoire en cas de crédit)
-- p_discount : { "type": "amount"|"percent", "value": nombre, "reason": texte }
create or replace function public.record_sale(
  p_site_id uuid,
  p_cash_session_id uuid,
  p_lines jsonb,
  p_payments jsonb,
  p_customer jsonb default '{}'::jsonb,
  p_discount jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_site public.sites%rowtype;
  v_session public.cash_register_sessions%rowtype;
  v_profile public.business_profiles%rowtype;
  v_doc_settings public.store_document_settings%rowtype;
  v_currency text;
  v_decimals integer;
  v_allow_negative boolean;
  v_max_discount_pct numeric;
  v_default_location uuid;
  v_order_id uuid := gen_random_uuid();
  v_line jsonb;
  v_index integer := 0;
  v_product public.products%rowtype;
  v_sell public.product_sell_units%rowtype;
  v_unit public.product_units%rowtype;
  v_location uuid;
  v_qty numeric;
  v_base_qty numeric;
  v_unit_price numeric;
  v_tier_id uuid;
  v_gross numeric;
  v_line_discount numeric;
  v_available numeric;
  v_items jsonb := '[]'::jsonb;
  v_item jsonb;
  v_subtotal numeric := 0;
  v_line_discounts numeric := 0;
  v_order_discount numeric := 0;
  v_discount_total numeric;
  v_grand numeric;
  v_discount_type text;
  v_discount_value numeric;
  v_discount_reason text;
  v_payment jsonb;
  v_method text;
  v_amount numeric;
  v_reference text;
  v_cash numeric := 0;
  v_noncash numeric := 0;
  v_change numeric := 0;
  v_has_credit boolean := false;
  v_summary jsonb := '{}'::jsonb;
  v_payment_lines jsonb := '[]'::jsonb;
  v_customer_name text;
  v_customer_phone text;
  v_cashier_name text;
  v_doc_number text;
  v_doc_id uuid;
  v_snapshot jsonb;
begin
  if v_uid is null then
    raise exception 'Connexion requise.' using errcode = '42501';
  end if;

  v_role := private.site_role(p_site_id);
  if v_role is null or v_role not in ('owner', 'admin', 'editor') then
    raise exception 'Vente refusée : seuls le propriétaire, un administrateur ou un vendeur peuvent encaisser.'
      using errcode = '42501';
  end if;

  select * into v_site from public.sites where id = p_site_id;

  select * into v_session from public.cash_register_sessions
  where id = p_cash_session_id and site_id = p_site_id
  for update;
  if not found then
    raise exception 'Session de caisse introuvable pour cette boutique.' using errcode = '22023';
  end if;
  if v_session.status <> 'open' then
    raise exception 'La session de caisse est fermée.' using errcode = '22023';
  end if;

  -- Tests imbriqués : jsonb_array_length échoue sur une valeur qui n'est pas un tableau.
  if jsonb_typeof(p_lines) is distinct from 'array' then
    raise exception 'Le panier est vide.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_lines) = 0 then
    raise exception 'Le panier est vide.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_lines) > 200 then
    raise exception 'Trop de lignes (200 au plus).' using errcode = '22023';
  end if;
  p_payments := coalesce(p_payments, '[]'::jsonb);
  if jsonb_typeof(p_payments) <> 'array' then
    raise exception 'Paiements invalides.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_payments) > 10 then
    raise exception 'Paiements invalides (10 au plus).' using errcode = '22023';
  end if;

  select * into v_profile from public.business_profiles where site_id = p_site_id;
  select * into v_doc_settings from public.store_document_settings where site_id = p_site_id;
  v_currency := coalesce(v_profile.currency_code, 'XOF');
  v_decimals := case when v_currency = 'XOF' then 0 else 2 end;

  v_allow_negative := coalesce((v_site.settings -> 'pos' ->> 'allow_negative_stock')::boolean, false);
  v_max_discount_pct := case
    when v_role in ('owner', 'admin') then 100
    else least(greatest(coalesce((v_site.settings -> 'pos' ->> 'editor_max_discount_percent')::numeric, 0), 0), 100)
  end;

  select l.id into v_default_location
  from public.stock_locations l
  where l.site_id = p_site_id and l.is_active
  order by (l.location_type = 'store') desc, l.created_at
  limit 1;

  -- Lignes : prix, quantités et stock relus en base.
  for v_line in select value from jsonb_array_elements(p_lines) loop
    v_index := v_index + 1;

    select * into v_product from public.products
    where id = (v_line ->> 'product_id')::uuid and site_id = p_site_id
    for update;
    if not found then
      raise exception 'Ligne % : produit introuvable dans cette boutique.', v_index using errcode = '22023';
    end if;
    if v_product.status <> 'active' then
      raise exception 'Ligne % : « % » n''est pas en vente (statut %).', v_index, v_product.name, v_product.status using errcode = '22023';
    end if;
    if v_product.currency_code <> v_currency then
      raise exception 'Ligne % : devise du produit différente de celle de la boutique.', v_index using errcode = '22023';
    end if;

    if v_line ? 'unit_id' and nullif(v_line ->> 'unit_id', '') is not null then
      select * into v_sell from public.product_sell_units
      where product_id = v_product.id and unit_id = (v_line ->> 'unit_id')::uuid;
    else
      select * into v_sell from public.product_sell_units
      where product_id = v_product.id
      order by is_default desc, (conversion_to_base = 1) desc, created_at
      limit 1;
    end if;
    if not found then
      raise exception 'Ligne % : unité de vente introuvable pour « % ».', v_index, v_product.name using errcode = '22023';
    end if;
    select * into v_unit from public.product_units where id = v_sell.unit_id;

    v_qty := (v_line ->> 'quantity')::numeric;
    if v_qty is null or v_qty <= 0 then
      raise exception 'Ligne % : la quantité doit être supérieure à zéro.', v_index using errcode = '22023';
    end if;
    if v_qty <> round(v_qty, v_unit.decimal_places) then
      raise exception 'Ligne % : l''unité « % » accepte au plus % décimale(s).', v_index, v_unit.label, v_unit.decimal_places using errcode = '22023';
    end if;
    if v_qty < v_sell.min_sale_quantity then
      raise exception 'Ligne % : minimum de vente % %.', v_index, v_sell.min_sale_quantity, v_unit.label using errcode = '22023';
    end if;
    if mod(v_qty, v_sell.quantity_step) <> 0 then
      raise exception 'Ligne % : la quantité doit être un multiple de % %.', v_index, v_sell.quantity_step, v_unit.label using errcode = '22023';
    end if;
    v_base_qty := v_qty * v_sell.conversion_to_base;

    select t.id, t.unit_price into v_tier_id, v_unit_price
    from public.price_tiers t
    where t.product_id = v_product.id
      and t.variant_id is null
      and (t.unit_id = v_sell.unit_id or (t.unit_id is null and v_sell.conversion_to_base = 1))
      and t.min_quantity <= v_qty
      and (t.valid_from is null or t.valid_from <= now())
      and (t.valid_until is null or now() < t.valid_until)
    order by t.min_quantity desc, (t.unit_id is not null) desc
    limit 1;
    if not found then
      v_tier_id := null;
      v_unit_price := v_product.price * v_sell.conversion_to_base;
    end if;

    v_gross := round(v_qty * v_unit_price, v_decimals);
    v_line_discount := coalesce(nullif(v_line ->> 'discount', '')::numeric, 0);
    if v_line_discount < 0 or v_line_discount > v_gross or v_line_discount <> round(v_line_discount, v_decimals) then
      raise exception 'Ligne % : remise de ligne invalide.', v_index using errcode = '22023';
    end if;

    v_location := coalesce(nullif(v_line ->> 'location_id', '')::uuid, v_default_location);
    if v_product.track_inventory then
      if v_location is null or not exists (
        select 1 from public.stock_locations l where l.id = v_location and l.site_id = p_site_id and l.is_active
      ) then
        raise exception 'Ligne % : emplacement de stock introuvable ou désactivé.', v_index using errcode = '22023';
      end if;

      if not (v_product.allow_backorder or v_allow_negative) then
        select coalesce(sum(m.quantity_delta), 0) into v_available
        from public.inventory_movements m
        where m.site_id = p_site_id and m.product_id = v_product.id
          and m.variant_id is null and m.stock_location_id = v_location;
        if v_available < v_base_qty then
          raise exception 'Ligne % : stock insuffisant pour « % » (disponible : %, demandé : %, en unité de base).',
            v_index, v_product.name, v_available, v_base_qty using errcode = '23514';
        end if;
      end if;

      insert into public.inventory_movements (
        site_id, product_id, movement_type, quantity_delta, reference_type, reference_id,
        reason, actor_user_id, stock_location_id, unit_id, unit_quantity
      ) values (
        p_site_id, v_product.id, 'sale', -v_base_qty, 'order', v_order_id,
        'Vente comptoir', v_uid, v_location, v_sell.unit_id, v_qty
      );
    end if;

    v_items := v_items || jsonb_build_object(
      'product_id', v_product.id,
      'name', v_product.name,
      'sku', v_product.sku,
      'quantity', v_qty,
      'unit_id', v_sell.unit_id,
      'unit_label', v_unit.label,
      'unit_price', v_unit_price,
      'tier_id', v_tier_id,
      'gross', v_gross,
      'line_discount', v_line_discount,
      'line_total', v_gross - v_line_discount
    );
    v_subtotal := v_subtotal + v_gross;
    v_line_discounts := v_line_discounts + v_line_discount;
  end loop;

  -- Remise globale et limite par rôle.
  if coalesce(p_discount, '{}'::jsonb) <> '{}'::jsonb then
    v_discount_type := p_discount ->> 'type';
    v_discount_value := coalesce(nullif(p_discount ->> 'value', '')::numeric, 0);
    if v_discount_value < 0 or v_discount_type is null or v_discount_type not in ('amount', 'percent') then
      raise exception 'Remise invalide.' using errcode = '22023';
    end if;
    if v_discount_type = 'percent' then
      if v_discount_value > 100 then
        raise exception 'Remise invalide : plus de 100 %%.' using errcode = '22023';
      end if;
      v_order_discount := round((v_subtotal - v_line_discounts) * v_discount_value / 100, v_decimals);
    else
      v_order_discount := v_discount_value;
      if v_order_discount <> round(v_order_discount, v_decimals) then
        raise exception 'Remise invalide : montant non arrondi.' using errcode = '22023';
      end if;
    end if;
    if v_order_discount > v_subtotal - v_line_discounts then
      raise exception 'Remise supérieure au montant à payer.' using errcode = '22023';
    end if;
  end if;

  v_discount_total := v_line_discounts + v_order_discount;
  v_grand := v_subtotal - v_discount_total;
  v_discount_reason := nullif(btrim(coalesce(p_discount ->> 'reason', '')), '');

  if v_discount_total > 0 then
    if v_discount_reason is null or char_length(v_discount_reason) < 3 then
      raise exception 'Le motif de la remise est obligatoire.' using errcode = '22023';
    end if;
    if v_discount_total * 100 > v_max_discount_pct * v_subtotal then
      raise exception 'Remise refusée : la limite de votre rôle est de % %%.', v_max_discount_pct using errcode = '42501';
    end if;
  end if;

  -- Paiements.
  for v_payment in select value from jsonb_array_elements(coalesce(p_payments, '[]'::jsonb)) loop
    v_method := v_payment ->> 'method';
    v_amount := nullif(v_payment ->> 'amount', '')::numeric;
    if v_method is null or v_method not in ('cash', 'wave', 'orange_money', 'card', 'credit') then
      raise exception 'Moyen de paiement inconnu : %.', coalesce(v_method, '(vide)') using errcode = '22023';
    end if;
    if v_amount is null or v_amount <= 0 or v_amount <> round(v_amount, v_decimals) then
      raise exception 'Montant de paiement invalide.' using errcode = '22023';
    end if;
    if v_method = 'cash' then
      v_cash := v_cash + v_amount;
    else
      v_noncash := v_noncash + v_amount;
      v_has_credit := v_has_credit or v_method = 'credit';
    end if;
  end loop;

  if v_noncash > v_grand then
    raise exception 'Les paiements hors espèces dépassent le total à payer.' using errcode = '22023';
  end if;
  v_change := v_cash - (v_grand - v_noncash);
  if v_change < 0 then
    raise exception 'Paiement insuffisant : il manque % %.', -v_change, v_currency using errcode = '22023';
  end if;

  v_customer_name := nullif(btrim(coalesce(p_customer ->> 'name', '')), '');
  v_customer_phone := nullif(btrim(coalesce(p_customer ->> 'phone', '')), '');
  if v_customer_name is not null and char_length(v_customer_name) > 120 then
    raise exception 'Nom du client trop long (120 caractères au plus).' using errcode = '22023';
  end if;
  if v_customer_phone is not null and char_length(v_customer_phone) not between 3 and 40 then
    raise exception 'Téléphone du client invalide.' using errcode = '22023';
  end if;
  if v_has_credit and v_customer_name is null and v_customer_phone is null then
    raise exception 'Une vente à crédit exige le nom ou le téléphone du client.' using errcode = '22023';
  end if;

  -- Commande et lignes.
  select coalesce(jsonb_object_agg(method, total), '{}'::jsonb) into v_summary
  from (
    select p ->> 'method' as method,
      sum((p ->> 'amount')::numeric) - case when p ->> 'method' = 'cash' then v_change else 0 end as total
    from jsonb_array_elements(coalesce(p_payments, '[]'::jsonb)) p
    group by p ->> 'method'
  ) s;

  insert into public.orders (
    id, site_id, customer_id, status, customer_phone, currency_code,
    subtotal, discount_total, tax_total, shipping_total, grand_total,
    billing_address, placed_at, confirmed_at,
    sales_channel, cashier_id, cash_session_id, amount_tendered, change_given,
    payment_summary, discount_details
  ) values (
    v_order_id, p_site_id, null, 'confirmed', v_customer_phone, v_currency,
    v_subtotal, v_discount_total, 0, 0, v_grand,
    case when v_customer_name is null then '{}'::jsonb else jsonb_build_object('name', v_customer_name) end,
    now(), now(),
    'pos', v_uid, p_cash_session_id,
    case when v_cash > 0 then v_cash end, v_change,
    v_summary,
    case when v_discount_total > 0 then jsonb_build_object(
      'line_discounts', v_line_discounts,
      'order_discount', v_order_discount,
      'type', v_discount_type,
      'value', v_discount_value,
      'reason', v_discount_reason,
      'applied_by', v_uid,
      'role', v_role,
      'role_limit_percent', v_max_discount_pct
    ) else '{}'::jsonb end
  );

  for v_item in select value from jsonb_array_elements(v_items) loop
    insert into public.order_items (
      order_id, product_id, product_name, sku, variant_snapshot, quantity, unit_price, line_total,
      currency_code, unit_id, unit_label, line_discount
    ) values (
      v_order_id, (v_item ->> 'product_id')::uuid, v_item ->> 'name', v_item ->> 'sku',
      jsonb_build_object('tier_id', v_item -> 'tier_id'),
      (v_item ->> 'quantity')::numeric, (v_item ->> 'unit_price')::numeric, (v_item ->> 'line_total')::numeric,
      v_currency, (v_item ->> 'unit_id')::uuid, v_item ->> 'unit_label', (v_item ->> 'line_discount')::numeric
    );
  end loop;

  v_doc_number := private.next_document_number(p_site_id, 'receipt');

  -- Paiements enregistrés : espèces nettes de la monnaie rendue, autres moyens tels quels.
  if v_cash - v_change > 0 then
    insert into public.payment_transactions (order_id, provider, payment_method, status, amount, currency_code, provider_payload, paid_at)
    values (v_order_id, 'manual_cash', 'cash', 'succeeded', v_cash - v_change, v_currency,
      jsonb_build_object('manual', true, 'tendered', v_cash, 'change', v_change, 'recorded_by', v_uid), now());

    insert into public.cash_register_movements (site_id, session_id, actor_user_id, movement_type, amount, currency_code, order_id, reason)
    values (p_site_id, p_cash_session_id, v_uid, 'sale_cash', v_cash - v_change, v_currency, v_order_id, 'Vente ' || v_doc_number);
  end if;
  if v_cash - v_change > 0 then
    v_payment_lines := v_payment_lines || jsonb_build_object('method', 'cash', 'label', 'Espèces', 'amount', v_cash - v_change, 'reference', null);
  end if;

  for v_payment in select value from jsonb_array_elements(coalesce(p_payments, '[]'::jsonb)) loop
    v_method := v_payment ->> 'method';
    continue when v_method = 'cash';
    v_amount := (v_payment ->> 'amount')::numeric;
    v_reference := left(nullif(btrim(coalesce(v_payment ->> 'reference', '')), ''), 100);
    insert into public.payment_transactions (order_id, provider, payment_method, status, amount, currency_code, provider_payload, paid_at)
    values (
      v_order_id,
      case v_method when 'wave' then 'manual_wave' when 'orange_money' then 'manual_orange_money'
                    when 'card' then 'manual_card' else 'store_credit' end,
      v_method,
      case when v_method = 'credit' then 'pending' else 'succeeded' end,
      v_amount, v_currency,
      jsonb_build_object('manual', true, 'reference', v_reference, 'recorded_by', v_uid),
      case when v_method = 'credit' then null else now() end
    );
    v_payment_lines := v_payment_lines || jsonb_build_object(
      'method', v_method,
      'label', case v_method when 'wave' then 'Wave (enregistrement manuel)'
                             when 'orange_money' then 'Orange Money (enregistrement manuel)'
                             when 'card' then 'Carte (enregistrement manuel)'
                             else 'Crédit client' end,
      'amount', v_amount,
      'reference', v_reference
    );
  end loop;

  -- Reçu : instantané complet, figé, relu à l'impression.
  select p.display_name into v_cashier_name from public.profiles p where p.user_id = v_uid;

  v_snapshot := jsonb_build_object(
    'version', 1,
    'document', jsonb_build_object('type', 'receipt', 'number', v_doc_number, 'issued_at', now()),
    'shop', jsonb_build_object(
      'name', coalesce(v_profile.public_name, v_site.name),
      'legal_name', v_profile.legal_name,
      'address', v_profile.address,
      'city', v_profile.city,
      'phone', v_profile.phone,
      'email', v_profile.email
    ),
    'settings', jsonb_build_object(
      'paper', coalesce(v_doc_settings.default_paper, 'thermal_80mm'),
      'footer_text', v_doc_settings.footer_text,
      'legal_details', coalesce(v_doc_settings.legal_details, '{}'::jsonb),
      'show_cashier_name', coalesce(v_doc_settings.show_cashier_name, true),
      'show_customer_details', coalesce(v_doc_settings.show_customer_details, true)
    ),
    'cashier', jsonb_build_object('id', v_uid, 'name', v_cashier_name),
    'customer', case when v_customer_name is null and v_customer_phone is null then null
                     else jsonb_build_object('name', v_customer_name, 'phone', v_customer_phone) end,
    'lines', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'name', i ->> 'name', 'sku', i -> 'sku', 'quantity', i -> 'quantity', 'unit_label', i -> 'unit_label',
        'unit_price', i -> 'unit_price', 'line_discount', i -> 'line_discount', 'line_total', i -> 'line_total'
      )), '[]'::jsonb)
      from jsonb_array_elements(v_items) i
    ),
    'totals', jsonb_build_object(
      'subtotal', v_subtotal, 'discount_total', v_discount_total, 'tax_total', 0,
      'grand_total', v_grand, 'currency', v_currency
    ),
    'discount', case when v_discount_total > 0 then jsonb_build_object('reason', v_discount_reason) else null end,
    'payments', v_payment_lines,
    'cash', jsonb_build_object('tendered', v_cash, 'change', v_change)
  );

  insert into public.store_documents (
    site_id, order_id, document_type, document_number, status, currency_code,
    total_amount, content_snapshot, issued_by
  ) values (
    p_site_id, v_order_id, 'receipt', v_doc_number, 'issued', v_currency,
    v_grand, v_snapshot, v_uid
  )
  returning id into v_doc_id;

  return jsonb_build_object(
    'order_id', v_order_id,
    'document_id', v_doc_id,
    'document_number', v_doc_number,
    'grand_total', v_grand,
    'change_given', v_change,
    'snapshot', v_snapshot
  );
end;
$function$;

revoke all on function public.record_sale(uuid, uuid, jsonb, jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.record_sale(uuid, uuid, jsonb, jsonb, jsonb, jsonb) to authenticated;


-- -----------------------------------------------------------------------------
-- d) Annulation d'une vente
-- -----------------------------------------------------------------------------
create or replace function public.void_sale(p_order_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_order public.orders%rowtype;
  v_role text;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_session_status text;
  v_cash numeric;
  v_cash_recorded boolean := false;
  v_movements integer;
  v_documents integer;
begin
  if v_uid is null then
    raise exception 'Connexion requise.' using errcode = '42501';
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'Vente introuvable.' using errcode = '22023';
  end if;

  v_role := private.site_role(v_order.site_id);
  if v_role is null or v_role not in ('owner', 'admin') then
    raise exception 'Annulation refusée : réservée au propriétaire et aux administrateurs.' using errcode = '42501';
  end if;
  if v_order.sales_channel <> 'pos' then
    raise exception 'Seules les ventes en caisse s''annulent ici.' using errcode = '22023';
  end if;
  if v_order.status = 'cancelled' then
    raise exception 'Cette vente est déjà annulée.' using errcode = '22023';
  end if;
  if char_length(v_reason) < 3 or char_length(v_reason) > 500 then
    raise exception 'Le motif d''annulation est obligatoire (3 à 500 caractères).' using errcode = '22023';
  end if;

  -- Contre-passation du stock : mouvement inverse de chaque sortie de la vente.
  insert into public.inventory_movements (
    site_id, product_id, variant_id, movement_type, quantity_delta, reference_type, reference_id,
    reason, actor_user_id, stock_location_id, unit_id, unit_quantity, batch_id
  )
  select m.site_id, m.product_id, m.variant_id, 'return', -m.quantity_delta, 'order_void', v_order.id,
    left('Annulation : ' || v_reason, 500), v_uid, m.stock_location_id, m.unit_id, m.unit_quantity, m.batch_id
  from public.inventory_movements m
  where m.site_id = v_order.site_id and m.reference_type = 'order' and m.reference_id = v_order.id
    and m.movement_type = 'sale';
  get diagnostics v_movements = row_count;

  select coalesce(sum(amount), 0) into v_cash
  from public.payment_transactions
  where order_id = v_order.id and payment_method = 'cash' and status = 'succeeded';

  update public.payment_transactions
  set status = case when status = 'pending' then 'cancelled' else 'refunded' end,
      refunded_at = case when status = 'succeeded' then now() else refunded_at end
  where order_id = v_order.id and status in ('succeeded', 'pending');

  if v_cash > 0 then
    select status into v_session_status from public.cash_register_sessions
    where id = v_order.cash_session_id for update;
    if v_session_status = 'open' then
      insert into public.cash_register_movements (site_id, session_id, actor_user_id, movement_type, amount, currency_code, order_id, reason)
      values (v_order.site_id, v_order.cash_session_id, v_uid, 'refund_cash', v_cash, v_order.currency_code, v_order.id,
        left('Annulation : ' || v_reason, 500));
      v_cash_recorded := true;
    end if;
  end if;

  update public.orders
  set status = 'cancelled',
      cancelled_at = now(),
      updated_at = now(),
      internal_note = left(coalesce(internal_note || E'\n', '') || 'Annulée : ' || v_reason, 2000)
  where id = v_order.id;

  -- Le document n'est jamais supprimé : il est marqué annulé.
  update public.store_documents
  set status = 'void', voided_at = now(), void_reason = v_reason
  where order_id = v_order.id and status <> 'void';
  get diagnostics v_documents = row_count;

  return jsonb_build_object(
    'order_id', v_order.id,
    'stock_movements_reversed', v_movements,
    'documents_voided', v_documents,
    'cash_refund', v_cash,
    'cash_refund_recorded', v_cash_recorded,
    'cash_session_closed', v_cash > 0 and not v_cash_recorded
  );
end;
$function$;

revoke all on function public.void_sale(uuid, text) from public, anon;
grant execute on function public.void_sale(uuid, text) to authenticated;


-- -----------------------------------------------------------------------------
-- e) Rapport de caisse (X) et clôture (Z)
-- -----------------------------------------------------------------------------
create or replace function public.cash_session_summary(p_session_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_session public.cash_register_sessions%rowtype;
  v_in numeric;
  v_out numeric;
  v_corrections numeric;
  v_by_method jsonb;
  v_sales integer;
  v_voided integer;
begin
  select * into v_session from public.cash_register_sessions where id = p_session_id;
  if not found or private.site_role(v_session.site_id) is null then
    raise exception 'Session de caisse introuvable.' using errcode = '22023';
  end if;

  select
    coalesce(sum(amount) filter (where movement_type in ('sale_cash', 'cash_in')), 0),
    coalesce(sum(amount) filter (where movement_type in ('refund_cash', 'expense', 'cash_out', 'withdrawal', 'deposit')), 0),
    coalesce(sum(amount) filter (where movement_type = 'correction'), 0)
  into v_in, v_out, v_corrections
  from public.cash_register_movements
  where session_id = p_session_id;

  select coalesce(jsonb_object_agg(method, jsonb_build_object('count', n, 'amount', total)), '{}'::jsonb) into v_by_method
  from (
    select p.payment_method as method, count(*) as n, sum(p.amount) as total
    from public.payment_transactions p
    join public.orders o on o.id = p.order_id
    where o.cash_session_id = p_session_id and o.status <> 'cancelled' and p.status in ('succeeded', 'pending')
    group by p.payment_method
  ) s;

  select count(*) filter (where status <> 'cancelled'), count(*) filter (where status = 'cancelled')
  into v_sales, v_voided
  from public.orders where cash_session_id = p_session_id;

  return jsonb_build_object(
    'session_id', v_session.id,
    'register_name', v_session.register_name,
    'status', v_session.status,
    'opened_at', v_session.opened_at,
    'closed_at', v_session.closed_at,
    'currency', v_session.currency_code,
    'opening_cash', v_session.opening_cash,
    'cash_in', v_in,
    'cash_out', v_out,
    'corrections_excluded', v_corrections,
    'expected_cash', v_session.opening_cash + v_in - v_out,
    'counted_cash', v_session.counted_cash,
    'discrepancy', v_session.discrepancy,
    'by_method', v_by_method,
    'sales_count', v_sales,
    'voided_count', v_voided
  );
end;
$function$;

revoke all on function public.cash_session_summary(uuid) from public, anon;
grant execute on function public.cash_session_summary(uuid) to authenticated;

create or replace function public.close_cash_session(p_session_id uuid, p_counted_cash numeric, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_session public.cash_register_sessions%rowtype;
  v_role text;
  v_summary jsonb;
  v_expected numeric;
begin
  if v_uid is null then
    raise exception 'Connexion requise.' using errcode = '42501';
  end if;

  select * into v_session from public.cash_register_sessions where id = p_session_id for update;
  if not found then
    raise exception 'Session de caisse introuvable.' using errcode = '22023';
  end if;
  v_role := private.site_role(v_session.site_id);
  if v_role is null or not (v_role in ('owner', 'admin') or (v_session.opened_by = v_uid and v_role in ('editor', 'publisher'))) then
    raise exception 'Clôture refusée : réservée au propriétaire, aux administrateurs et à la personne qui a ouvert la caisse.'
      using errcode = '42501';
  end if;
  if v_session.status <> 'open' then
    raise exception 'Cette session de caisse est déjà fermée.' using errcode = '22023';
  end if;
  if p_counted_cash is null or p_counted_cash < 0 then
    raise exception 'Le montant compté doit être positif ou nul.' using errcode = '22023';
  end if;

  v_summary := public.cash_session_summary(p_session_id);
  v_expected := (v_summary ->> 'expected_cash')::numeric;

  update public.cash_register_sessions
  set status = 'closed',
      closed_by = v_uid,
      closed_at = now(),
      expected_cash = v_expected,
      counted_cash = p_counted_cash,
      discrepancy = p_counted_cash - v_expected,
      closing_note = nullif(left(btrim(coalesce(p_note, '')), 1000), ''),
      updated_at = now()
  where id = p_session_id;

  return public.cash_session_summary(p_session_id);
end;
$function$;

revoke all on function public.close_cash_session(uuid, numeric, text) from public, anon;
grant execute on function public.close_cash_session(uuid, numeric, text) to authenticated;
