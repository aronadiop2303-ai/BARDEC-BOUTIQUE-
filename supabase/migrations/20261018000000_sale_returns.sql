-- =============================================================================
-- Retours partiels (lot G, partie 1/2) : retour, remise en stock ou casse, avoir numéroté, remboursement — ADDITIVE
-- =============================================================================
-- STATUT : PRÉPARÉE, NON APPLIQUÉE, NON TESTÉE EN EXÉCUTION.
-- Nature : uniquement de nouveaux objets (2 tables avec RLS activée, 2 fonctions, index). Aucune fonction existante
-- n'est réécrite. LIMITE tant que la partie 2/2 (20261018000100_void_after_return_guard, autorisation requise)
-- n'est pas appliquée : void_sale sur une vente déjà partiellement retournée rembourserait et remettrait en stock
-- une seconde fois. L'interface masque « Annuler » pour une vente qui a un retour ; la base ne l'interdit pas encore.
--
-- PRÉREQUIS : pos_sales_foundation (next_document_number, type credit_note), team_accounts, cash_movements.
--
-- RÈGLES DE record_return(site, vente, lignes, motif, mode de remboursement, session)
--   - Vente comptoir (sales_channel 'pos') de la boutique, non annulée.
--   - Lignes : [{ "order_item_id": uuid, "quantity": nombre, "disposition": "restock" | "damage" }] ;
--     quantité > 0, décimales de l'unité vendue, au plus la quantité vendue moins les retours déjà faits.
--   - Montant remboursé par ligne : part du montant réellement payé (line_total × quantité / quantité vendue,
--     multiplié par grand_total / somme des line_total pour répartir la remise globale), arrondi à la devise.
--     Le cumul des retours ne dépasse jamais le total de la vente.
--   - restock : mouvement de stock 'return' (positif) à l'emplacement de la sortie d'origine, même conversion.
--     damage (casse) : aucun retour en stock (la sortie de la vente reste), la ligne est tracée comme casse.
--   - Avoir : numéro AVOIR-AAAA-NNNNNN (private.next_document_number 'credit_note'), document store_documents
--     'credit_note' avec instantané figé (relu à l'impression, jamais recalculé).
--   - Remboursement : cash (session ouverte de la boutique, espèces attendues suffisantes, mouvement 'refund_cash'
--     compté dans le rapport X/Z), wave, orange_money, card (enregistrements manuels, aucun paiement réel).
--   - Rôles : propriétaire, gérant ; vendeur si le montant ≤ sites.settings->pos->cashier_max_return_amount
--     (0 par défaut : aucun retour par un vendeur). Autres : refusés.
--   - Motif obligatoire (3 à 500 caractères).
--   - payment_transactions n'est pas modifiée (le statut 'refunded' signifie un remboursement total).
--
-- RETOUR ARRIÈRE (une seule transaction, uniquement si aucun retour n'a été enregistré)
--   drop function if exists public.returnable_lines(uuid);
--   drop function if exists public.record_return(uuid, uuid, jsonb, text, text, uuid);
--   drop table if exists public.sale_return_lines;
--   drop table if exists public.sale_returns;
-- =============================================================================

do $prereq$
declare
  v_def text;
begin
  if to_regprocedure('private.next_document_number(uuid,text)') is null or to_regprocedure('private.staff_role(uuid)') is null
     or to_regclass('public.cash_movement_details') is null then
    raise exception 'Prérequis manquant : appliquer d''abord pos_sales_foundation, team_accounts et cash_movements.';
  end if;
  select string_agg(pg_get_constraintdef(c.oid), ' ') into v_def
  from pg_constraint c where c.conrelid = 'public.store_documents'::regclass and c.contype = 'c';
  if v_def is not null and position('document_type' in v_def) > 0 and position('credit_note' in v_def) = 0 then
    raise exception 'store_documents.document_type n''accepte pas credit_note : %', v_def;
  end if;
end;
$prereq$;


-- -----------------------------------------------------------------------------
-- a) Tables
-- -----------------------------------------------------------------------------
create table public.sale_returns (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.sites(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete restrict,
  document_id uuid references public.store_documents(id) on delete restrict,
  document_number text not null,
  refund_method text not null constraint sale_returns_method_check check (refund_method in ('cash', 'wave', 'orange_money', 'card')),
  refund_amount numeric(14,2) not null constraint sale_returns_amount_check check (refund_amount >= 0),
  currency_code text not null,
  reason text not null constraint sale_returns_reason_check check (char_length(reason) between 3 and 500),
  cash_session_id uuid references public.cash_register_sessions(id) on delete restrict,
  cash_movement_id uuid references public.cash_register_movements(id) on delete restrict,
  created_by uuid references auth.users(id) on delete set null,
  created_role text,
  created_at timestamptz not null default now()
);

create index sale_returns_order_idx on public.sale_returns (order_id);
create index sale_returns_site_idx on public.sale_returns (site_id, created_at desc);

create table public.sale_return_lines (
  id uuid primary key default gen_random_uuid(),
  return_id uuid not null references public.sale_returns(id) on delete cascade,
  site_id uuid not null references public.sites(id) on delete cascade,
  order_item_id uuid not null references public.order_items(id) on delete restrict,
  product_id uuid,
  product_name text not null,
  quantity numeric(14,3) not null constraint sale_return_lines_quantity_check check (quantity > 0),
  unit_label text,
  refund_amount numeric(14,2) not null constraint sale_return_lines_refund_check check (refund_amount >= 0),
  disposition text not null constraint sale_return_lines_disposition_check check (disposition in ('restock', 'damage')),
  stock_location_id uuid references public.stock_locations(id) on delete restrict
);

create index sale_return_lines_item_idx on public.sale_return_lines (order_item_id);

alter table public.sale_returns enable row level security;
alter table public.sale_return_lines enable row level security;
revoke all on public.sale_returns, public.sale_return_lines from anon, authenticated;

-- Même visibilité que les ventes : propriétaire, gérant, lecture seule ; vendeur : retours de ses ventes ou faits par lui.
create policy sale_returns_staff_read on public.sale_returns
  for select to authenticated
  using (
    coalesce(private.staff_role(site_id), '') in ('owner', 'manager', 'viewer')
    or (private.staff_role(site_id) = 'cashier' and (created_by = (select auth.uid())
        or exists (select 1 from public.orders o where o.id = sale_returns.order_id and o.cashier_id = (select auth.uid()))))
  );
create policy sale_return_lines_follow_return on public.sale_return_lines
  for select to authenticated
  using (exists (select 1 from public.sale_returns r where r.id = sale_return_lines.return_id));
grant select on public.sale_returns, public.sale_return_lines to authenticated;


-- -----------------------------------------------------------------------------
-- b) Lignes retournables d'une vente
-- -----------------------------------------------------------------------------
create or replace function public.returnable_lines(p_order_id uuid)
returns table (
  order_item_id uuid, product_id uuid, product_name text, unit_label text, decimal_places integer,
  quantity_sold numeric, quantity_returned numeric, quantity_returnable numeric, unit_refund numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_order public.orders%rowtype;
  v_factor numeric;
begin
  select * into v_order from public.orders where id = p_order_id;
  if not found or coalesce(private.staff_role(v_order.site_id), '') not in ('owner', 'manager', 'cashier') then
    raise exception 'Vente introuvable.' using errcode = '22023';
  end if;
  select v_order.grand_total / nullif(sum(i.line_total), 0) into v_factor from public.order_items i where i.order_id = p_order_id;
  return query
    select i.id, i.product_id, i.product_name, i.unit_label, coalesce(u.decimal_places, 0),
           i.quantity,
           coalesce((select sum(l.quantity) from public.sale_return_lines l where l.order_item_id = i.id), 0),
           i.quantity - coalesce((select sum(l.quantity) from public.sale_return_lines l where l.order_item_id = i.id), 0),
           round(i.line_total / nullif(i.quantity, 0) * coalesce(v_factor, 0), 2)
    from public.order_items i
    left join public.product_units u on u.id = i.unit_id
    where i.order_id = p_order_id
    order by i.id;
end;
$function$;

revoke all on function public.returnable_lines(uuid) from public, anon;
grant execute on function public.returnable_lines(uuid) to authenticated;


-- -----------------------------------------------------------------------------
-- c) Retour
-- -----------------------------------------------------------------------------
create or replace function public.record_return(
  p_site_id uuid,
  p_order_id uuid,
  p_lines jsonb,
  p_reason text,
  p_refund_method text,
  p_cash_session_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_role text := private.staff_role(p_site_id);
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_order public.orders%rowtype;
  v_site public.sites%rowtype;
  v_session public.cash_register_sessions%rowtype;
  v_profile public.business_profiles%rowtype;
  v_doc_settings public.store_document_settings%rowtype;
  v_receipt_number text;
  v_decimals integer;
  v_factor numeric;
  v_line jsonb;
  v_item public.order_items%rowtype;
  v_unit_decimals integer;
  v_qty numeric;
  v_returned numeric;
  v_disposition text;
  v_refund numeric;
  v_total numeric := 0;
  v_already numeric;
  v_return_id uuid := gen_random_uuid();
  v_lines jsonb := '[]'::jsonb;
  v_snapshot_lines jsonb := '[]'::jsonb;
  v_sale_move record;
  v_location uuid;
  v_cap numeric;
  v_expected numeric;
  v_movement uuid;
  v_doc_number text;
  v_doc_id uuid;
  v_cashier_name text;
  v_snapshot jsonb;
  v_label text;
begin
  if v_uid is null then
    raise exception 'Connexion requise.' using errcode = '42501';
  end if;
  if v_role is null or v_role not in ('owner', 'manager', 'cashier') then
    raise exception 'Retour refusé pour votre rôle.' using errcode = '42501';
  end if;
  if v_reason is null or char_length(v_reason) < 3 or char_length(v_reason) > 500 then
    raise exception 'Le motif du retour est obligatoire (3 à 500 caractères).' using errcode = '22023';
  end if;
  if p_refund_method is null or p_refund_method not in ('cash', 'wave', 'orange_money', 'card') then
    raise exception 'Mode de remboursement inconnu : %.', coalesce(p_refund_method, '(vide)') using errcode = '22023';
  end if;
  if jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines) = 0 or jsonb_array_length(p_lines) > 200 then
    raise exception 'Aucune ligne à retourner.' using errcode = '22023';
  end if;

  -- Verrou sur la vente : sérialise les retours concurrents (contrôle des quantités).
  select * into v_order from public.orders where id = p_order_id and site_id = p_site_id for update;
  if not found or v_order.sales_channel <> 'pos' then
    raise exception 'Vente comptoir introuvable dans cette boutique.' using errcode = '22023';
  end if;
  if v_order.status = 'cancelled' then
    raise exception 'Vente annulée : aucun retour possible.' using errcode = '22023';
  end if;

  select * into v_site from public.sites where id = p_site_id;
  v_decimals := case when v_order.currency_code = 'XOF' then 0 else 2 end;
  select v_order.grand_total / nullif(sum(i.line_total), 0) into v_factor from public.order_items i where i.order_id = p_order_id;
  v_factor := coalesce(v_factor, 0);

  for v_line in select value from jsonb_array_elements(p_lines) loop
    if jsonb_typeof(v_line -> 'quantity') <> 'number' then
      raise exception 'Quantité de retour invalide.' using errcode = '22023';
    end if;
    select * into v_item from public.order_items
    where id = case when jsonb_typeof(v_line -> 'order_item_id') = 'string' then (v_line ->> 'order_item_id')::uuid end
      and order_id = p_order_id;
    if not found then
      raise exception 'Ligne introuvable dans cette vente.' using errcode = '22023';
    end if;
    v_qty := (v_line ->> 'quantity')::numeric;
    v_disposition := coalesce(v_line ->> 'disposition', 'restock');
    if v_disposition not in ('restock', 'damage') then
      raise exception 'Destination inconnue : %.', v_disposition using errcode = '22023';
    end if;
    select coalesce(u.decimal_places, 0) into v_unit_decimals from public.product_units u where u.id = v_item.unit_id;
    v_unit_decimals := coalesce(v_unit_decimals, 0);
    if v_qty <= 0 or v_qty <> round(v_qty, v_unit_decimals) then
      raise exception '« % » : quantité invalide (% décimale(s) au plus).', v_item.product_name, v_unit_decimals using errcode = '22023';
    end if;
    select coalesce(sum(l.quantity), 0) into v_returned from public.sale_return_lines l where l.order_item_id = v_item.id;
    -- Retours déjà faits + lignes précédentes de cette demande pour le même article.
    v_returned := v_returned + coalesce((select sum((x ->> 'quantity')::numeric) from jsonb_array_elements(v_lines) x
                                          where (x ->> 'order_item_id')::uuid = v_item.id), 0);
    if v_returned + v_qty > v_item.quantity then
      raise exception '« % » : retour supérieur à la quantité vendue (vendu %, déjà retourné %).',
        v_item.product_name, v_item.quantity, v_returned using errcode = '23514';
    end if;
    v_refund := round(v_item.line_total * v_qty / v_item.quantity * v_factor, v_decimals);
    v_total := v_total + v_refund;
    v_lines := v_lines || jsonb_build_object('order_item_id', v_item.id, 'product_id', v_item.product_id, 'name', v_item.product_name,
      'quantity', v_qty, 'unit_label', v_item.unit_label, 'unit_id', v_item.unit_id, 'refund', v_refund, 'disposition', v_disposition,
      'unit_price', round(v_item.line_total / v_item.quantity * v_factor, v_decimals));
  end loop;

  select coalesce(sum(refund_amount), 0) into v_already from public.sale_returns where order_id = p_order_id;
  if v_already + v_total > v_order.grand_total then
    v_total := greatest(v_order.grand_total - v_already, 0);  -- arrondis cumulés : jamais plus que le total payé
  end if;

  if v_role = 'cashier' then
    v_cap := greatest(coalesce((v_site.settings -> 'pos' ->> 'cashier_max_return_amount')::numeric, 0), 0);
    if v_total > v_cap then
      raise exception 'Retour supérieur au plafond autorisé pour un vendeur (% %) : faites-le valider par le gérant.',
        v_cap, v_order.currency_code using errcode = '42501';
    end if;
  end if;

  if p_refund_method = 'cash' and v_total > 0 then
    select * into v_session from public.cash_register_sessions where id = p_cash_session_id and site_id = p_site_id for update;
    if not found or v_session.status <> 'open' then
      raise exception 'Remboursement en espèces : une caisse ouverte de la boutique est obligatoire.' using errcode = '22023';
    end if;
    v_expected := (public.cash_session_summary(v_session.id) ->> 'expected_cash')::numeric;
    if v_expected < v_total then
      raise exception 'Espèces insuffisantes en caisse pour rembourser (% attendus).', v_expected using errcode = '23514';
    end if;
  end if;

  v_doc_number := private.next_document_number(p_site_id, 'credit_note');
  select document_number into v_receipt_number from public.store_documents
  where order_id = p_order_id and document_type = 'receipt' order by issued_at limit 1;

  insert into public.sale_returns (id, site_id, order_id, document_number, refund_method, refund_amount, currency_code, reason,
    cash_session_id, created_by, created_role)
  values (v_return_id, p_site_id, p_order_id, v_doc_number, p_refund_method, v_total, v_order.currency_code, v_reason,
    case when p_refund_method = 'cash' and v_total > 0 then v_session.id end, v_uid, v_role);

  for v_line in select value from jsonb_array_elements(v_lines) loop
    v_location := null;
    if v_line ->> 'disposition' = 'restock' and v_line ->> 'product_id' is not null then
      select m.stock_location_id, m.unit_id, -m.quantity_delta / nullif(m.unit_quantity, 0) as conversion into v_sale_move
      from public.inventory_movements m
      where m.reference_type = 'order' and m.reference_id = p_order_id and m.movement_type = 'sale'
        and m.product_id = (v_line ->> 'product_id')::uuid
      order by (m.unit_id is not distinct from (v_line ->> 'unit_id')::uuid) desc
      limit 1;
      if found then
        v_location := v_sale_move.stock_location_id;
        insert into public.inventory_movements (site_id, product_id, movement_type, quantity_delta, reference_type, reference_id,
          reason, actor_user_id, stock_location_id, unit_id, unit_quantity)
        values (p_site_id, (v_line ->> 'product_id')::uuid, 'return', (v_line ->> 'quantity')::numeric * coalesce(v_sale_move.conversion, 1),
          'order_return', v_return_id, left('Retour ' || v_doc_number || ' : ' || v_reason, 500), v_uid, v_location,
          v_sale_move.unit_id, (v_line ->> 'quantity')::numeric);
      end if;
    end if;
    insert into public.sale_return_lines (return_id, site_id, order_item_id, product_id, product_name, quantity, unit_label,
      refund_amount, disposition, stock_location_id)
    values (v_return_id, p_site_id, (v_line ->> 'order_item_id')::uuid, (v_line ->> 'product_id')::uuid, v_line ->> 'name',
      (v_line ->> 'quantity')::numeric, v_line ->> 'unit_label', (v_line ->> 'refund')::numeric, v_line ->> 'disposition', v_location);
    v_snapshot_lines := v_snapshot_lines || jsonb_build_object(
      'name', v_line ->> 'name', 'sku', null, 'quantity', (v_line ->> 'quantity')::numeric, 'unit_label', v_line ->> 'unit_label',
      'unit_price', (v_line ->> 'unit_price')::numeric, 'line_discount', 0, 'line_total', (v_line ->> 'refund')::numeric,
      'disposition', v_line ->> 'disposition');
  end loop;

  if p_refund_method = 'cash' and v_total > 0 then
    insert into public.cash_register_movements (site_id, session_id, actor_user_id, movement_type, amount, currency_code, order_id, reason)
    values (p_site_id, v_session.id, v_uid, 'refund_cash', v_total, v_order.currency_code, p_order_id, left('Avoir ' || v_doc_number, 300))
    returning id into v_movement;
    update public.sale_returns set cash_movement_id = v_movement where id = v_return_id;
  end if;

  select * into v_profile from public.business_profiles where site_id = p_site_id;
  select * into v_doc_settings from public.store_document_settings where site_id = p_site_id;
  select p.display_name into v_cashier_name from public.profiles p where p.user_id = v_uid;
  v_label := case p_refund_method when 'cash' then 'Remboursement espèces'
                                  when 'wave' then 'Remboursement Wave (enregistrement manuel)'
                                  when 'orange_money' then 'Remboursement Orange Money (enregistrement manuel)'
                                  else 'Remboursement carte (enregistrement manuel)' end;

  v_snapshot := jsonb_build_object(
    'version', 1,
    'document', jsonb_build_object('type', 'credit_note', 'number', v_doc_number, 'issued_at', now(), 'original_number', v_receipt_number),
    'shop', jsonb_build_object('name', coalesce(v_profile.public_name, v_site.name), 'legal_name', v_profile.legal_name,
      'address', v_profile.address, 'city', v_profile.city, 'phone', v_profile.phone, 'email', v_profile.email),
    'settings', jsonb_build_object('paper', coalesce(v_doc_settings.default_paper, 'thermal_80mm'), 'footer_text', v_doc_settings.footer_text,
      'legal_details', coalesce(v_doc_settings.legal_details, '{}'::jsonb),
      'show_cashier_name', coalesce(v_doc_settings.show_cashier_name, true), 'show_customer_details', false),
    'cashier', jsonb_build_object('id', v_uid, 'name', v_cashier_name),
    'customer', null,
    'lines', v_snapshot_lines,
    'totals', jsonb_build_object('subtotal', v_total, 'discount_total', 0, 'tax_total', 0, 'grand_total', v_total, 'currency', v_order.currency_code),
    'payments', jsonb_build_array(jsonb_build_object('method', p_refund_method, 'label', v_label, 'amount', v_total, 'reference', null)),
    'cash', jsonb_build_object('tendered', 0, 'change', 0),
    'return', jsonb_build_object('reason', v_reason, 'original_number', v_receipt_number)
  );

  insert into public.store_documents (site_id, order_id, document_type, document_number, status, currency_code, total_amount, content_snapshot, issued_by)
  values (p_site_id, p_order_id, 'credit_note', v_doc_number, 'issued', v_order.currency_code, v_total, v_snapshot, v_uid)
  returning id into v_doc_id;
  update public.sale_returns set document_id = v_doc_id where id = v_return_id;

  return jsonb_build_object('return_id', v_return_id, 'document_id', v_doc_id, 'document_number', v_doc_number,
    'refund_amount', v_total, 'refund_method', p_refund_method, 'snapshot', v_snapshot);
end;
$function$;

revoke all on function public.record_return(uuid, uuid, jsonb, text, text, uuid) from public, anon;
grant execute on function public.record_return(uuid, uuid, jsonb, text, text, uuid) to authenticated;
