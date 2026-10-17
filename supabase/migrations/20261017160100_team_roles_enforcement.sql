-- =============================================================================
-- Équipe et comptes (lot C, partie 2/2) : application des rôles métier — EXIGE UNE AUTORISATION ÉCRITE
-- =============================================================================
-- STATUT : PRÉPARÉE, NON APPLIQUÉE, NON TESTÉE EN EXÉCUTION.
-- Nature : NON additive. Réécrit des fonctions existantes (record_sale, void_sale, cash_session_summary,
-- close_cash_session, open_cash_session, record_stock_movement, import_products) et ajoute des politiques
-- RESTRICTIVE qui réduisent la lecture existante. Ne s'applique qu'avec l'autorisation écrite du propriétaire
-- nommant 20261017160100_team_roles_enforcement.
--
-- PRÉREQUIS : 20261017160000_team_accounts (private.staff_role) et 20261017140000_product_import appliquées.
--
-- SOURCE DES FONCTIONS : définitions versionnées dans ce dépôt (en-têtes : « empreinte MD5 identique au SQL
-- appliqué »). Les définitions RÉELLES n'ont pas pu être relues en lecture seule depuis ce poste (aucun accès
-- administrateur à la base). AVANT application, comparer avec :
--   select pg_get_functiondef('public.record_sale(uuid,uuid,jsonb,jsonb,jsonb,jsonb)'::regprocedure);  -- etc.
-- Seuls changent les contrôles de rôle (diff : docs/TEAM-RLS-AUDIT.md) :
--   private.site_role → private.staff_role ;
--   vente, ouverture de caisse : owner, admin, editor → owner, manager, cashier (mêmes personnes pour les anciens
--     rôles : admin → manager, editor → cashier) ;
--   remise illimitée : owner, admin → owner, manager ; le vendeur reste plafonné par editor_max_discount_percent ;
--   annulation : owner, admin → owner, manager ;
--   rapport X : tout rôle non nul → owner, manager, cashier, viewer (magasinier et livreur exclus) ;
--   clôture Z : owner, admin, ou l'ouvreur editor/publisher → owner, manager, ou l'ouvreur cashier ;
--   stock : owner, admin → owner, manager, stock_keeper (NOUVEAU : le magasinier saisit le stock) ;
--   import : owner, admin → owner, manager.
--   Changement de comportement pour les anciens rôles : un publisher qui aurait ouvert une caisse ne peut plus
--   la clôturer (il ne pouvait déjà plus l'ouvrir depuis pos_cash_lockdown).
--
-- POLITIQUES RESTRICTIVE (s'ajoutent aux politiques existantes, qui ne sont ni supprimées ni modifiées) :
--   store_documents        : propriétaire, gérant, lecture seule ; vendeur : uniquement les documents qu'il a émis.
--   orders                 : propriétaire, gérant, lecture seule ; vendeur : uniquement ses ventes (cashier_id).
--   order_items, payment_transactions : suivent la visibilité de la commande.
--   cash_register_sessions, cash_register_movements : magasinier et livreur exclus.
--   inventory_movements    : livreur exclu.
--   product_costs, product_import_runs : propriétaire et gérant seulement.
--
-- RETOUR ARRIÈRE (une seule transaction)
--   Réappliquer les blocs de fonctions des migrations sources (pos_sales_foundation, pos_cash_lockdown,
--   stock_entries_foundation, product_import), puis :
--   drop policy if exists store_documents_staff_scope on public.store_documents;
--   drop policy if exists orders_staff_scope on public.orders;
--   drop policy if exists order_items_staff_scope on public.order_items;
--   drop policy if exists payment_transactions_staff_scope on public.payment_transactions;
--   drop policy if exists cash_register_sessions_staff_scope on public.cash_register_sessions;
--   drop policy if exists cash_register_movements_staff_scope on public.cash_register_movements;
--   drop policy if exists inventory_movements_staff_scope on public.inventory_movements;
--   drop policy if exists product_costs_staff_scope on public.product_costs;
--   drop policy if exists product_import_runs_staff_scope on public.product_import_runs;
-- =============================================================================

do $prereq$
begin
  if to_regprocedure('private.staff_role(uuid)') is null or to_regprocedure('public.import_products(uuid,jsonb,text,text)') is null then
    raise exception 'Prérequis manquant : appliquer d''abord team_accounts et product_import.';
  end if;
end;
$prereq$;


-- Source : supabase/migrations/20261016014204_pos_sales_foundation.sql (définition versionnée), seuls les contrôles de rôle changent.
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

  v_role := private.staff_role(p_site_id);
  if v_role is null or v_role not in ('owner', 'manager', 'cashier') then
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
    when v_role in ('owner', 'manager') then 100
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
  -- p_discount peut ne porter que le motif ({"reason": …}) quand seules des remises de ligne sont appliquées.
  p_discount := coalesce(p_discount, '{}'::jsonb);
  v_discount_value := coalesce(nullif(p_discount ->> 'value', '')::numeric, 0);
  if v_discount_value < 0 then
    raise exception 'Remise invalide.' using errcode = '22023';
  end if;
  if v_discount_value > 0 then
    v_discount_type := p_discount ->> 'type';
    if v_discount_type is null or v_discount_type not in ('amount', 'percent') then
      raise exception 'Remise invalide : type attendu amount ou percent.' using errcode = '22023';
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


-- Source : supabase/migrations/20261016014204_pos_sales_foundation.sql (définition versionnée), seuls les contrôles de rôle changent.
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

  v_role := private.staff_role(v_order.site_id);
  if v_role is null or v_role not in ('owner', 'manager') then
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


-- Source : supabase/migrations/20261016014204_pos_sales_foundation.sql (définition versionnée), seuls les contrôles de rôle changent.
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
  if not found or coalesce(private.staff_role(v_session.site_id), '') not in ('owner', 'manager', 'cashier', 'viewer') then
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


-- Source : supabase/migrations/20261016014204_pos_sales_foundation.sql (définition versionnée), seuls les contrôles de rôle changent.
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
  v_role := private.staff_role(v_session.site_id);
  if v_role is null or not (v_role in ('owner', 'manager') or (v_session.opened_by = v_uid and v_role = 'cashier')) then
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


-- Source : supabase/migrations/20261016065800_pos_cash_lockdown.sql (définition versionnée), seuls les contrôles de rôle changent.
create or replace function public.open_cash_session(
  p_site_id uuid,
  p_opening_cash numeric,
  p_register_name text default 'Caisse principale',
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_currency text;
  v_name text := btrim(coalesce(p_register_name, ''));
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'Connexion requise.' using errcode = '42501';
  end if;

  v_role := private.staff_role(p_site_id);
  if v_role is null or v_role not in ('owner', 'manager', 'cashier') then
    raise exception 'Ouverture refusée : seuls le propriétaire, un administrateur ou un vendeur ouvrent la caisse.'
      using errcode = '42501';
  end if;

  select coalesce(bp.currency_code, 'XOF') into v_currency from public.business_profiles bp where bp.site_id = p_site_id;
  v_currency := coalesce(v_currency, 'XOF');

  if p_opening_cash is null or p_opening_cash < 0
     or p_opening_cash <> round(p_opening_cash, case when v_currency = 'XOF' then 0 else 2 end) then
    raise exception 'Fond de caisse invalide.' using errcode = '22023';
  end if;
  if char_length(v_name) not between 1 and 80 then
    raise exception 'Nom de caisse invalide (1 à 80 caractères).' using errcode = '22023';
  end if;

  begin
    insert into public.cash_register_sessions (site_id, opened_by, register_name, status, opening_cash, currency_code, opening_note)
    values (p_site_id, v_uid, v_name, 'open', p_opening_cash, v_currency, nullif(left(btrim(coalesce(p_note, '')), 1000), ''))
    returning id into v_id;
  exception when unique_violation then
    raise exception 'Une caisse « % » est déjà ouverte pour cette boutique.', v_name using errcode = '23505';
  end;

  return v_id;
end;
$function$;

revoke all on function public.open_cash_session(uuid, numeric, text, text) from public, anon;
grant execute on function public.open_cash_session(uuid, numeric, text, text) to authenticated;


-- Source : supabase/migrations/20261016065722_stock_entries_foundation.sql (définition versionnée), seuls les contrôles de rôle changent.
create or replace function public.record_stock_movement(
  p_site_id uuid,
  p_product_id uuid,
  p_location_id uuid,
  p_movement_type text,
  p_quantity numeric,
  p_unit_id uuid default null,
  p_reason text default null
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
  v_product public.products%rowtype;
  v_sell public.product_sell_units%rowtype;
  v_unit public.product_units%rowtype;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_delta numeric;
  v_available numeric;
  v_allow_negative boolean;
  v_movement_id uuid;
begin
  if v_uid is null then
    raise exception 'Connexion requise.' using errcode = '42501';
  end if;

  v_role := private.staff_role(p_site_id);
  if v_role is null or v_role not in ('owner', 'manager', 'stock_keeper') then
    raise exception 'Mouvement de stock refusé : réservé au propriétaire, au gérant et au magasinier.' using errcode = '42501';
  end if;

  if p_movement_type is null or p_movement_type not in ('initial_stock', 'restock', 'adjustment', 'damage') then
    raise exception 'Type de mouvement non autorisé ici : %.', coalesce(p_movement_type, '(vide)') using errcode = '22023';
  end if;

  -- Verrou sur le produit : sérialise les mouvements concurrents du même produit (contrôle du stock négatif).
  select * into v_product from public.products where id = p_product_id and site_id = p_site_id for update;
  if not found then
    raise exception 'Produit introuvable dans cette boutique.' using errcode = '22023';
  end if;
  if v_product.status <> 'active' then
    raise exception 'Le produit « % » n''est pas actif (statut %).', v_product.name, v_product.status using errcode = '22023';
  end if;
  if not v_product.track_inventory then
    raise exception 'Le stock du produit « % » n''est pas suivi.', v_product.name using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.stock_locations l where l.id = p_location_id and l.site_id = p_site_id and l.is_active
  ) then
    raise exception 'Emplacement introuvable ou désactivé.' using errcode = '22023';
  end if;

  if p_unit_id is not null then
    select * into v_sell from public.product_sell_units where product_id = v_product.id and unit_id = p_unit_id;
  else
    select * into v_sell from public.product_sell_units
    where product_id = v_product.id and conversion_to_base = 1
    order by is_default desc, created_at
    limit 1;
  end if;
  if not found then
    raise exception 'Unité introuvable pour « % » : choisissez une de ses unités de vente.', v_product.name using errcode = '22023';
  end if;
  select * into v_unit from public.product_units where id = v_sell.unit_id;

  if p_quantity is null or p_quantity = 0 then
    raise exception 'La quantité ne peut pas être nulle.' using errcode = '22023';
  end if;
  if p_movement_type in ('initial_stock', 'restock', 'damage') and p_quantity < 0 then
    raise exception 'La quantité doit être positive pour ce type de mouvement.' using errcode = '22023';
  end if;
  if p_quantity <> round(p_quantity, v_unit.decimal_places) then
    raise exception 'L''unité « % » accepte au plus % décimale(s).', v_unit.label, v_unit.decimal_places using errcode = '22023';
  end if;

  if p_movement_type in ('adjustment', 'damage') and (v_reason is null or char_length(v_reason) < 3) then
    raise exception 'Le motif est obligatoire (3 caractères au moins).' using errcode = '22023';
  end if;
  if v_reason is not null and char_length(v_reason) > 500 then
    raise exception 'Motif trop long (500 caractères au plus).' using errcode = '22023';
  end if;

  v_delta := p_quantity * v_sell.conversion_to_base;
  if p_movement_type = 'damage' then
    v_delta := -v_delta;
  end if;

  select coalesce(sum(m.quantity_delta), 0) into v_available
  from public.inventory_movements m
  where m.site_id = p_site_id and m.product_id = v_product.id
    and m.variant_id is null and m.stock_location_id = p_location_id;

  if p_movement_type = 'initial_stock' and exists (
    select 1 from public.inventory_movements m
    where m.site_id = p_site_id and m.product_id = v_product.id and m.stock_location_id = p_location_id
  ) then
    raise exception 'Inventaire initial impossible : ce produit a déjà des mouvements à cet emplacement. Utilisez un ajustement.'
      using errcode = '22023';
  end if;

  select * into v_site from public.sites where id = p_site_id;
  v_allow_negative := v_product.allow_backorder
    or coalesce((v_site.settings -> 'pos' ->> 'allow_negative_stock')::boolean, false);
  if v_delta < 0 and v_available + v_delta < 0 and not v_allow_negative then
    raise exception 'Stock insuffisant : % disponible(s) à cet emplacement, sortie de % (unité de base).',
      v_available, -v_delta using errcode = '23514';
  end if;

  insert into public.inventory_movements (
    site_id, product_id, movement_type, quantity_delta, reference_type, reference_id,
    reason, actor_user_id, stock_location_id, unit_id, unit_quantity
  ) values (
    p_site_id, v_product.id, p_movement_type, v_delta, 'manual_entry', null,
    v_reason, v_uid, p_location_id, v_sell.unit_id, abs(p_quantity)
  )
  returning id into v_movement_id;

  return jsonb_build_object(
    'movement_id', v_movement_id,
    'quantity_delta', v_delta,
    'stock_before', v_available,
    'stock_after', v_available + v_delta,
    'unit_label', v_unit.label
  );
end;
$function$;

revoke all on function public.record_stock_movement(uuid, uuid, uuid, text, numeric, uuid, text) from public, anon;
grant execute on function public.record_stock_movement(uuid, uuid, uuid, text, numeric, uuid, text) to authenticated;


-- Source : supabase/migrations/20261017140000_product_import.sql (définition versionnée), seuls les contrôles de rôle changent.
create or replace function public.import_products(
  p_site_id uuid,
  p_rows jsonb,
  p_mode text,
  p_source text default 'csv'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_count integer;
  v_row jsonb;
  v_index integer := 0;
  v_line integer;
  v_errors jsonb := '[]'::jsonb;
  v_name text;
  v_sku text;
  v_barcode text;
  v_category text;
  v_unit public.product_units%rowtype;
  v_price numeric;
  v_cost numeric;
  v_stock numeric;
  v_location uuid;
  v_existing uuid;
  v_product_id uuid;
  v_category_id uuid;
  v_slug text;
  v_attempt integer;
  v_step numeric;
  v_created integer := 0;
  v_updated integer := 0;
  v_movements integer := 0;
  v_failed_line integer;
  v_message text;
  v_run_id uuid;
begin
  if v_uid is null then
    raise exception 'Connexion requise.' using errcode = '42501';
  end if;
  v_role := private.staff_role(p_site_id);
  if v_role is null or v_role not in ('owner', 'manager') then
    raise exception 'Import refusé : réservé au propriétaire et au gérant.' using errcode = '42501';
  end if;
  if p_mode is null or p_mode not in ('create', 'upsert') then
    raise exception 'Mode d''import inconnu : %.', coalesce(p_mode, '(vide)') using errcode = '22023';
  end if;
  if p_source is null or p_source not in ('csv', 'xlsx', 'paste', 'manual', 'api', 'ocr') then
    raise exception 'Méthode d''import inconnue : %.', coalesce(p_source, '(vide)') using errcode = '22023';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'Les lignes doivent être un tableau JSON.' using errcode = '22023';
  end if;
  v_count := jsonb_array_length(p_rows);
  if v_count = 0 then
    raise exception 'Aucune ligne à importer.' using errcode = '22023';
  end if;
  if v_count > 1000 then
    raise exception 'Import limité à 1000 lignes (% reçues) : découpez le fichier.', v_count using errcode = '22023';
  end if;

  -- Un import à la fois par boutique : les contrôles de doublons restent valables jusqu'à l'écriture.
  perform pg_advisory_xact_lock(hashtextextended('import_products:' || p_site_id::text, 0));

  -- ── 1. Validation complète, sans écriture ─────────────────────────────────
  for v_row in select value from jsonb_array_elements(p_rows) loop
    v_index := v_index + 1;
    v_line := coalesce(case when jsonb_typeof(v_row -> 'line') = 'number' then (v_row ->> 'line')::integer end, v_index);
    if jsonb_typeof(v_row) <> 'object' then
      v_errors := v_errors || jsonb_build_object('line', v_line, 'message', 'Ligne illisible.');
      continue;
    end if;
    v_name := nullif(btrim(regexp_replace(coalesce(v_row ->> 'name', ''), '\s+', ' ', 'g')), '');
    v_sku := nullif(btrim(coalesce(v_row ->> 'sku', '')), '');
    v_barcode := nullif(regexp_replace(coalesce(v_row ->> 'barcode', ''), '\s', '', 'g'), '');
    v_category := nullif(btrim(coalesce(v_row ->> 'category', '')), '');

    if v_name is null or char_length(v_name) > 180 then
      v_errors := v_errors || jsonb_build_object('line', v_line, 'message', 'Nom obligatoire (180 caractères au plus).');
    end if;
    if char_length(coalesce(v_sku, '')) > 64 or char_length(coalesce(v_barcode, '')) > 64 or char_length(coalesce(v_category, '')) > 120 then
      v_errors := v_errors || jsonb_build_object('line', v_line, 'message', 'SKU, code-barres ou catégorie trop long.');
    end if;

    if jsonb_typeof(v_row -> 'price') <> 'number' or (v_row ->> 'price')::numeric < 0
       or (v_row ->> 'price')::numeric <> trunc((v_row ->> 'price')::numeric) then
      v_errors := v_errors || jsonb_build_object('line', v_line, 'message', 'Prix de vente : entier positif ou nul obligatoire.');
    end if;
    if v_row ? 'cost' and jsonb_typeof(v_row -> 'cost') <> 'null' and (
         jsonb_typeof(v_row -> 'cost') <> 'number' or (v_row ->> 'cost')::numeric < 0
         or (v_row ->> 'cost')::numeric <> trunc((v_row ->> 'cost')::numeric)) then
      v_errors := v_errors || jsonb_build_object('line', v_line, 'message', 'Prix d''achat : entier positif ou nul attendu.');
    end if;

    -- Doublons dans le fichier.
    if v_sku is not null and (
      select count(*) from jsonb_array_elements(p_rows) r where lower(btrim(r ->> 'sku')) = lower(v_sku)
    ) > 1 then
      v_errors := v_errors || jsonb_build_object('line', v_line, 'message', format('SKU « %s » en double dans le fichier.', v_sku));
    end if;
    if v_barcode is not null and (
      select count(*) from jsonb_array_elements(p_rows) r where regexp_replace(coalesce(r ->> 'barcode', ''), '\s', '', 'g') = v_barcode
    ) > 1 then
      v_errors := v_errors || jsonb_build_object('line', v_line, 'message', format('Code-barres « %s » en double dans le fichier.', v_barcode));
    end if;

    -- Doublons en base.
    v_existing := null;
    if v_sku is not null then
      select p.id into v_existing from public.products p where p.site_id = p_site_id and lower(p.sku) = lower(v_sku) limit 1;
      if v_existing is not null and p_mode = 'create' then
        v_errors := v_errors || jsonb_build_object('line', v_line, 'message', format('SKU « %s » déjà utilisé dans la boutique.', v_sku));
      end if;
    end if;
    if v_barcode is not null and exists (
      select 1 from public.products p
      where p.site_id = p_site_id and p.barcode = v_barcode and p.id is distinct from (case when p_mode = 'upsert' then v_existing end)
    ) then
      v_errors := v_errors || jsonb_build_object('line', v_line, 'message', format('Code-barres « %s » déjà utilisé dans la boutique.', v_barcode));
    end if;

    -- Unité (nouveau produit) et stock initial.
    v_unit := null;
    if v_existing is null or p_mode = 'create' then
      select * into v_unit from public.product_units u
      where u.site_id = p_site_id and u.id = case when jsonb_typeof(v_row -> 'unit_id') = 'string' then (v_row ->> 'unit_id')::uuid end;
      if not found then
        v_errors := v_errors || jsonb_build_object('line', v_line, 'message', 'Unité introuvable dans cette boutique.');
      end if;
    end if;

    if v_row ? 'initial_stock' and jsonb_typeof(v_row -> 'initial_stock') <> 'null' then
      if jsonb_typeof(v_row -> 'initial_stock') <> 'number' or (v_row ->> 'initial_stock')::numeric < 0 then
        v_errors := v_errors || jsonb_build_object('line', v_line, 'message', 'Stock initial : nombre positif ou nul attendu.');
      elsif (v_row ->> 'initial_stock')::numeric > 0 then
        if v_existing is not null and p_mode = 'upsert' then
          v_errors := v_errors || jsonb_build_object('line', v_line, 'message', 'Stock initial impossible pour un produit existant : utilisez un ajustement.');
        elsif v_unit.id is not null and (v_row ->> 'initial_stock')::numeric <> round((v_row ->> 'initial_stock')::numeric, v_unit.decimal_places) then
          v_errors := v_errors || jsonb_build_object('line', v_line, 'message',
            format('Stock initial : %s décimale(s) au plus pour l''unité « %s ».', v_unit.decimal_places, v_unit.label));
        end if;
        if not exists (
          select 1 from public.stock_locations l
          where l.site_id = p_site_id and l.is_active
            and l.id = case when jsonb_typeof(v_row -> 'location_id') = 'string' then (v_row ->> 'location_id')::uuid end
        ) then
          v_errors := v_errors || jsonb_build_object('line', v_line, 'message', 'Emplacement introuvable ou désactivé pour le stock initial.');
        end if;
      end if;
    end if;
  end loop;

  if jsonb_array_length(v_errors) > 0 then
    insert into public.product_import_runs (site_id, actor_user_id, source, mode, row_count, status, errors)
    values (p_site_id, v_uid, p_source, p_mode, v_count, 'failed', v_errors)
    returning id into v_run_id;
    return jsonb_build_object('import_id', v_run_id, 'status', 'failed', 'row_count', v_count,
      'created', 0, 'updated', 0, 'stock_movements', 0, 'errors', v_errors);
  end if;

  -- ── 2. Écriture, tout ou rien ─────────────────────────────────────────────
  begin
    v_index := 0;
    for v_row in select value from jsonb_array_elements(p_rows) loop
      v_index := v_index + 1;
      v_failed_line := coalesce(case when jsonb_typeof(v_row -> 'line') = 'number' then (v_row ->> 'line')::integer end, v_index);
      v_name := btrim(regexp_replace(v_row ->> 'name', '\s+', ' ', 'g'));
      v_sku := nullif(btrim(coalesce(v_row ->> 'sku', '')), '');
      v_barcode := nullif(regexp_replace(coalesce(v_row ->> 'barcode', ''), '\s', '', 'g'), '');
      v_category := nullif(btrim(coalesce(v_row ->> 'category', '')), '');
      v_price := (v_row ->> 'price')::numeric;
      v_cost := case when jsonb_typeof(v_row -> 'cost') = 'number' then (v_row ->> 'cost')::numeric end;
      v_stock := case when jsonb_typeof(v_row -> 'initial_stock') = 'number' then (v_row ->> 'initial_stock')::numeric end;
      v_location := case when jsonb_typeof(v_row -> 'location_id') = 'string' then (v_row ->> 'location_id')::uuid end;

      v_category_id := null;
      if v_category is not null then
        select c.id into v_category_id from public.product_categories c
        where c.site_id = p_site_id and lower(c.name) = lower(v_category)
        order by c.parent_id nulls first, c.sort_order, c.name
        limit 1;
        if v_category_id is null then
          v_slug := private.import_slug(v_category);
          v_attempt := 0;
          while exists (select 1 from public.product_categories c where c.site_id = p_site_id and c.slug = v_slug) loop
            v_attempt := v_attempt + 1;
            if v_attempt > 5 then
              raise exception 'Impossible de créer la catégorie « % » : adresse déjà prise.', v_category using errcode = '23505';
            end if;
            v_slug := left(private.import_slug(v_category), 72) || '-' || substr(md5(random()::text), 1, 6);
          end loop;
          insert into public.product_categories (site_id, name, slug, is_active)
          values (p_site_id, v_category, v_slug, true)
          returning id into v_category_id;
        end if;
      end if;

      v_product_id := null;
      if p_mode = 'upsert' and v_sku is not null then
        select p.id into v_product_id from public.products p
        where p.site_id = p_site_id and lower(p.sku) = lower(v_sku) limit 1 for update;
      end if;

      if v_product_id is not null then
        update public.products p set
          name = v_name,
          price = v_price,
          barcode = coalesce(v_barcode, p.barcode),
          category_id = coalesce(v_category_id, p.category_id)
        where p.id = v_product_id;
        v_updated := v_updated + 1;
      else
        select * into v_unit from public.product_units u
        where u.site_id = p_site_id and u.id = (v_row ->> 'unit_id')::uuid;
        v_slug := private.import_slug(v_name);
        v_attempt := 0;
        while exists (select 1 from public.products p where p.site_id = p_site_id and p.slug = v_slug) loop
          v_attempt := v_attempt + 1;
          if v_attempt > 5 then
            raise exception 'Impossible de trouver une adresse libre pour « % ».', v_name using errcode = '23505';
          end if;
          v_slug := left(private.import_slug(v_name), 72) || '-' || substr(md5(random()::text), 1, 6);
        end loop;
        insert into public.products (site_id, name, slug, sku, barcode, category_id, status, price, track_inventory, product_type)
        values (p_site_id, v_name, v_slug, v_sku, v_barcode, v_category_id, 'active', v_price, true, 'physical')
        returning id into v_product_id;

        v_step := case when v_unit.decimal_places > 0 then power(10::numeric, -v_unit.decimal_places) else 1 end;
        insert into public.product_sell_units (site_id, product_id, unit_id, conversion_to_base, is_default, min_sale_quantity, quantity_step)
        values (p_site_id, v_product_id, v_unit.id, 1, true, v_step, v_step);
        v_created := v_created + 1;
      end if;

      if v_cost is not null then
        insert into public.product_costs (product_id, site_id, unit_cost, updated_by)
        values (v_product_id, p_site_id, v_cost, v_uid)
        on conflict (product_id) do update set unit_cost = excluded.unit_cost, updated_at = now(), updated_by = excluded.updated_by;
      end if;

      if v_stock is not null and v_stock > 0 then
        perform public.record_stock_movement(p_site_id, v_product_id, v_location, 'initial_stock', v_stock, v_unit.id, 'Import de produits');
        v_movements := v_movements + 1;
      end if;
    end loop;
  exception when others then
    get stacked diagnostics v_message = message_text;
    v_errors := jsonb_build_array(jsonb_build_object('line', v_failed_line, 'message', v_message));
    insert into public.product_import_runs (site_id, actor_user_id, source, mode, row_count, status, errors)
    values (p_site_id, v_uid, p_source, p_mode, v_count, 'failed', v_errors)
    returning id into v_run_id;
    return jsonb_build_object('import_id', v_run_id, 'status', 'failed', 'row_count', v_count,
      'created', 0, 'updated', 0, 'stock_movements', 0, 'errors', v_errors);
  end;

  insert into public.product_import_runs (site_id, actor_user_id, source, mode, row_count, created_count, updated_count, stock_movement_count, status)
  values (p_site_id, v_uid, p_source, p_mode, v_count, v_created, v_updated, v_movements, 'succeeded')
  returning id into v_run_id;

  return jsonb_build_object('import_id', v_run_id, 'status', 'succeeded', 'row_count', v_count,
    'created', v_created, 'updated', v_updated, 'stock_movements', v_movements, 'errors', '[]'::jsonb);
end;
$function$;

revoke all on function public.import_products(uuid, jsonb, text, text) from public, anon;
grant execute on function public.import_products(uuid, jsonb, text, text) to authenticated;


-- -----------------------------------------------------------------------------
-- Politiques RESTRICTIVE : une ligne n'est lisible que si AU MOINS une politique permissive existante l'autorise
-- ET toutes les politiques restrictives ci-dessous l'autorisent.
-- -----------------------------------------------------------------------------
create policy store_documents_staff_scope on public.store_documents
  as restrictive for select to authenticated
  using (
    coalesce(private.staff_role(site_id), '') in ('owner', 'manager', 'viewer')
    or (private.staff_role(site_id) = 'cashier' and issued_by = (select auth.uid()))
  );

create policy orders_staff_scope on public.orders
  as restrictive for select to authenticated
  using (
    coalesce(private.staff_role(site_id), '') in ('owner', 'manager', 'viewer')
    or (private.staff_role(site_id) = 'cashier' and cashier_id = (select auth.uid()))
  );

create policy order_items_staff_scope on public.order_items
  as restrictive for select to authenticated
  using (exists (select 1 from public.orders o where o.id = order_items.order_id));

create policy payment_transactions_staff_scope on public.payment_transactions
  as restrictive for select to authenticated
  using (exists (select 1 from public.orders o where o.id = payment_transactions.order_id));

create policy cash_register_sessions_staff_scope on public.cash_register_sessions
  as restrictive for select to authenticated
  using (coalesce(private.staff_role(site_id), '') in ('owner', 'manager', 'cashier', 'viewer'));

create policy cash_register_movements_staff_scope on public.cash_register_movements
  as restrictive for select to authenticated
  using (coalesce(private.staff_role(site_id), '') in ('owner', 'manager', 'cashier', 'viewer'));

create policy inventory_movements_staff_scope on public.inventory_movements
  as restrictive for select to authenticated
  using (coalesce(private.staff_role(site_id), '') in ('owner', 'manager', 'cashier', 'stock_keeper', 'viewer'));

create policy product_costs_staff_scope on public.product_costs
  as restrictive for select to authenticated
  using (coalesce(private.staff_role(site_id), '') in ('owner', 'manager'));

create policy product_import_runs_staff_scope on public.product_import_runs
  as restrictive for select to authenticated
  using (coalesce(private.staff_role(site_id), '') in ('owner', 'manager'));
