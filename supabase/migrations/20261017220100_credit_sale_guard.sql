-- =============================================================================
-- Clients et crédit (lot F, partie 2/2) : le crédit passe par la fiche client — EXIGE UNE AUTORISATION ÉCRITE
-- =============================================================================
-- STATUT : PRÉPARÉE, NON APPLIQUÉE, NON TESTÉE EN EXÉCUTION.
-- Nature : NON additive. Réécrit public.record_sale (version du lot C, 20261017160100_team_roles_enforcement)
-- avec UN seul ajout : un paiement « credit » est refusé sauf si la transaction a été ouverte par
-- public.record_credit_sale (drapeau local app.credit_sale, posé par set_config(…, true) et inaccessible
-- depuis l'API : PostgREST n'expose pas pg_catalog.set_config).
-- Ne s'applique qu'avec l'autorisation écrite du propriétaire nommant 20261017220100_credit_sale_guard.
--
-- PRÉREQUIS : 20261017160100_team_roles_enforcement et 20261017220000_customers_credit appliquées.
-- AVANT application : comparer la définition réelle (pg_get_functiondef) avec la source ci-dessous.
--
-- EFFET : sans ce correctif, un appel direct à record_sale avec un paiement « credit » contourne la fiche client
-- et le plafond (comportement actuel). Après : seule la vente à crédit par fiche client est possible.
--
-- RETOUR ARRIÈRE : réappliquer le bloc record_sale de 20261017160100_team_roles_enforcement.sql.
-- =============================================================================

do $prereq$
begin
  if to_regprocedure('public.record_credit_sale(uuid,uuid,uuid,jsonb,jsonb,jsonb,text)') is null
     or to_regprocedure('private.staff_role(uuid)') is null then
    raise exception 'Prérequis manquant : appliquer d''abord team_roles_enforcement et customers_credit.';
  end if;
end;
$prereq$;

-- Source : supabase/migrations/20261017160100_team_roles_enforcement.sql (version lot C), un seul ajout.
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
  -- Lot F : le crédit passe par record_credit_sale (fiche client, plafond, grand livre), qui active ce drapeau
  -- pour sa seule transaction. Un appel direct avec un paiement « credit » est refusé.
  if v_has_credit and coalesce(current_setting('app.credit_sale', true), '') <> 'on' then
    raise exception 'Vente à crédit : choisissez une fiche client (record_credit_sale).' using errcode = '22023';
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
