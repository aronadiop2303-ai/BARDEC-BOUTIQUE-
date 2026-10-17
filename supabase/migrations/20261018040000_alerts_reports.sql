-- =============================================================================
-- Alertes et rapports (lot I) : seuil de stock bas, liste à réapprovisionner, rapports de ventes, marge — ADDITIVE
-- =============================================================================
-- STATUT : PRÉPARÉE, NON APPLIQUÉE, NON TESTÉE EN EXÉCUTION.
-- Nature : uniquement de nouveaux objets (1 table avec RLS activée, fonctions). Tous les montants sont calculés
-- par la base ; l'interface ne fait que les afficher et les exporter.
--
-- PRÉREQUIS : team_accounts (private.staff_role), product_import (product_costs), sale_returns (retours).
--
-- CHOIX
--   - Seuil : product_stock_thresholds (minimum et quantité de réapprovisionnement conseillée, unité de base).
--     Auparavant aucune colonne de seuil n'existait (vérifié dans le dépôt : StockPage l'indiquait).
--   - Périodes en jours Africa/Dakar ; semaine ISO (lundi) ; mois civil.
--   - Ventes = commandes comptoir (sales_channel 'pos') non annulées ; retours = sale_returns de la période.
--   - Marge : chiffre d'affaires net des retours − quantité vendue (unité de base) × coût moyen ACTUEL
--     (product_costs). Le coût au moment de la vente n'est pas figé (order_items.cost_price_snapshot vide) :
--     la marge est donc une ESTIMATION au coût actuel, ce que les fonctions renvoient explicitement
--     (cost_basis = 'current_average_cost'). Produits sans prix d'achat : exclus de la marge et comptés à part.
--
-- DROITS
--   set_stock_threshold, restock_list : propriétaire, gérant, magasinier (aucun coût renvoyé).
--   sales_report, top_products, sales_by_seller : propriétaire et gérant.
--   margin_report : propriétaire et gérant seulement.
--
-- RETOUR ARRIÈRE (une seule transaction)
--   drop function if exists public.margin_report(uuid, date, date);
--   drop function if exists public.sales_by_seller(uuid, date, date);
--   drop function if exists public.top_products(uuid, date, date, integer);
--   drop function if exists public.sales_report(uuid, date, date, text);
--   drop function if exists public.restock_list(uuid);
--   drop function if exists public.set_stock_threshold(uuid, numeric, numeric);
--   drop function if exists private.report_guard(uuid, text[]);
--   drop table if exists public.product_stock_thresholds;
-- =============================================================================

do $prereq$
begin
  if to_regprocedure('private.staff_role(uuid)') is null or to_regclass('public.product_costs') is null
     or to_regclass('public.sale_returns') is null then
    raise exception 'Prérequis manquant : team_accounts, product_import et sale_returns.';
  end if;
end;
$prereq$;


-- -----------------------------------------------------------------------------
-- a) Seuils
-- -----------------------------------------------------------------------------
create table public.product_stock_thresholds (
  product_id uuid primary key references public.products(id) on delete cascade,
  site_id uuid not null references public.sites(id) on delete cascade,
  min_quantity numeric(14,3) not null constraint product_stock_thresholds_min_check check (min_quantity >= 0),
  reorder_quantity numeric(14,3) constraint product_stock_thresholds_reorder_check check (reorder_quantity is null or reorder_quantity > 0),
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);
create index product_stock_thresholds_site_idx on public.product_stock_thresholds (site_id);
alter table public.product_stock_thresholds enable row level security;
revoke all on public.product_stock_thresholds from anon, authenticated;
create policy product_stock_thresholds_staff_read on public.product_stock_thresholds for select to authenticated
  using (coalesce(private.staff_role(site_id), '') in ('owner', 'manager', 'stock_keeper', 'cashier', 'viewer'));
grant select on public.product_stock_thresholds to authenticated;

create or replace function private.report_guard(p_site_id uuid, p_roles text[])
returns void
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  if auth.uid() is null or not (coalesce(private.staff_role(p_site_id), '') = any (p_roles)) then
    raise exception 'Accès refusé pour votre rôle.' using errcode = '42501';
  end if;
end;
$function$;
revoke all on function private.report_guard(uuid, text[]) from public, anon, authenticated;

-- p_min_quantity null : seuil supprimé.
create or replace function public.set_stock_threshold(p_product_id uuid, p_min_quantity numeric, p_reorder_quantity numeric default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_product public.products%rowtype;
begin
  select * into v_product from public.products where id = p_product_id;
  if not found then
    raise exception 'Produit introuvable.' using errcode = '22023';
  end if;
  perform private.report_guard(v_product.site_id, array['owner', 'manager', 'stock_keeper']);
  if p_min_quantity is null then
    delete from public.product_stock_thresholds where product_id = p_product_id;
    return jsonb_build_object('product_id', p_product_id, 'min_quantity', null);
  end if;
  if p_min_quantity < 0 or (p_reorder_quantity is not null and p_reorder_quantity <= 0) then
    raise exception 'Seuil invalide : minimum positif ou nul, réapprovisionnement supérieur à zéro.' using errcode = '22023';
  end if;
  insert into public.product_stock_thresholds (product_id, site_id, min_quantity, reorder_quantity, updated_by)
  values (p_product_id, v_product.site_id, p_min_quantity, p_reorder_quantity, auth.uid())
  on conflict (product_id) do update set min_quantity = excluded.min_quantity, reorder_quantity = excluded.reorder_quantity,
    updated_by = excluded.updated_by, updated_at = now();
  return jsonb_build_object('product_id', p_product_id, 'min_quantity', p_min_quantity, 'reorder_quantity', p_reorder_quantity);
end;
$function$;
revoke all on function public.set_stock_threshold(uuid, numeric, numeric) from public, anon;
grant execute on function public.set_stock_threshold(uuid, numeric, numeric) to authenticated;


-- -----------------------------------------------------------------------------
-- b) À réapprovisionner (aucun coût)
-- -----------------------------------------------------------------------------
create or replace function public.restock_list(p_site_id uuid)
returns table (product_id uuid, product_name text, sku text, unit_label text, stock numeric, min_quantity numeric, suggested_quantity numeric)
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  perform private.report_guard(p_site_id, array['owner', 'manager', 'stock_keeper']);
  return query
    with levels as (
      select m.product_id as pid, coalesce(sum(m.quantity_delta), 0) as qty
      from public.inventory_movements m where m.site_id = p_site_id and m.variant_id is null group by m.product_id
    )
    select p.id, p.name, p.sku,
      (select u.label from public.product_sell_units su join public.product_units u on u.id = su.unit_id
       where su.product_id = p.id and su.conversion_to_base = 1 order by su.is_default desc limit 1),
      coalesce(l.qty, 0), t.min_quantity,
      greatest(coalesce(t.reorder_quantity, 0), t.min_quantity - coalesce(l.qty, 0))
    from public.product_stock_thresholds t
    join public.products p on p.id = t.product_id
    left join levels l on l.pid = p.id
    where t.site_id = p_site_id and p.status = 'active' and p.track_inventory and coalesce(l.qty, 0) <= t.min_quantity
    order by coalesce(l.qty, 0) - t.min_quantity, p.name;
end;
$function$;
revoke all on function public.restock_list(uuid) from public, anon;
grant execute on function public.restock_list(uuid) to authenticated;


-- -----------------------------------------------------------------------------
-- c) Rapports de ventes (propriétaire, gérant)
-- -----------------------------------------------------------------------------
create or replace function public.sales_report(p_site_id uuid, p_from date, p_to date, p_granularity text default 'day')
returns table (period date, sales_count bigint, gross_total numeric, returns_total numeric, net_total numeric)
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  perform private.report_guard(p_site_id, array['owner', 'manager']);
  if p_granularity is null or p_granularity not in ('day', 'week', 'month') then
    raise exception 'Période inconnue : day, week ou month.' using errcode = '22023';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 731 then
    raise exception 'Intervalle invalide (2 ans au plus).' using errcode = '22023';
  end if;
  return query
    with sales as (
      select date_trunc(p_granularity, (o.placed_at at time zone 'Africa/Dakar'))::date as d, count(*) as n, sum(o.grand_total) as total
      from public.orders o
      where o.site_id = p_site_id and o.sales_channel = 'pos' and o.status <> 'cancelled'
        and (o.placed_at at time zone 'Africa/Dakar')::date between p_from and p_to
      group by 1
    ), rets as (
      select date_trunc(p_granularity, (r.created_at at time zone 'Africa/Dakar'))::date as d, sum(r.refund_amount) as total
      from public.sale_returns r
      where r.site_id = p_site_id and (r.created_at at time zone 'Africa/Dakar')::date between p_from and p_to
      group by 1
    )
    select coalesce(s.d, r.d), coalesce(s.n, 0), coalesce(s.total, 0), coalesce(r.total, 0), coalesce(s.total, 0) - coalesce(r.total, 0)
    from sales s full join rets r on r.d = s.d
    order by 1;
end;
$function$;
revoke all on function public.sales_report(uuid, date, date, text) from public, anon;
grant execute on function public.sales_report(uuid, date, date, text) to authenticated;

create or replace function public.top_products(p_site_id uuid, p_from date, p_to date, p_limit integer default 20)
returns table (product_id uuid, product_name text, unit_label text, quantity_sold numeric, quantity_returned numeric, revenue numeric)
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  perform private.report_guard(p_site_id, array['owner', 'manager']);
  if p_from is null or p_to is null or p_to < p_from then
    raise exception 'Intervalle invalide.' using errcode = '22023';
  end if;
  return query
    with items as (
      select i.id, i.product_id as pid, i.product_name as pname, i.unit_label as ulabel, i.quantity, i.line_total,
             o.grand_total / nullif(sum(i.line_total) over (partition by o.id), 0) as factor
      from public.order_items i join public.orders o on o.id = i.order_id
      where o.site_id = p_site_id and o.sales_channel = 'pos' and o.status <> 'cancelled'
        and (o.placed_at at time zone 'Africa/Dakar')::date between p_from and p_to
    ), rets as (
      select l.order_item_id, sum(l.quantity) as qty, sum(l.refund_amount) as amount
      from public.sale_return_lines l join public.sale_returns r on r.id = l.return_id
      where r.site_id = p_site_id group by l.order_item_id
    )
    select it.pid, max(it.pname), max(it.ulabel), sum(it.quantity), coalesce(sum(rt.qty), 0),
           round(sum(it.line_total * coalesce(it.factor, 1)) - coalesce(sum(rt.amount), 0), 0)
    from items it left join rets rt on rt.order_item_id = it.id
    group by it.pid
    order by 6 desc nulls last
    limit least(greatest(coalesce(p_limit, 20), 1), 100);
end;
$function$;
revoke all on function public.top_products(uuid, date, date, integer) from public, anon;
grant execute on function public.top_products(uuid, date, date, integer) to authenticated;

create or replace function public.sales_by_seller(p_site_id uuid, p_from date, p_to date)
returns table (cashier_id uuid, cashier_name text, sales_count bigint, total numeric)
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  perform private.report_guard(p_site_id, array['owner', 'manager']);
  if p_from is null or p_to is null or p_to < p_from then
    raise exception 'Intervalle invalide.' using errcode = '22023';
  end if;
  return query
    select o.cashier_id, coalesce(max(p.display_name), 'Compte sans nom'), count(*), sum(o.grand_total)
    from public.orders o left join public.profiles p on p.user_id = o.cashier_id
    where o.site_id = p_site_id and o.sales_channel = 'pos' and o.status <> 'cancelled'
      and (o.placed_at at time zone 'Africa/Dakar')::date between p_from and p_to
    group by o.cashier_id
    order by 4 desc;
end;
$function$;
revoke all on function public.sales_by_seller(uuid, date, date) from public, anon;
grant execute on function public.sales_by_seller(uuid, date, date) to authenticated;


-- -----------------------------------------------------------------------------
-- d) Marge estimée (propriétaire, gérant)
-- -----------------------------------------------------------------------------
create or replace function public.margin_report(p_site_id uuid, p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_result jsonb;
begin
  perform private.report_guard(p_site_id, array['owner', 'manager']);
  if p_from is null or p_to is null or p_to < p_from then
    raise exception 'Intervalle invalide.' using errcode = '22023';
  end if;
  with items as (
    select i.id, i.product_id, i.quantity, i.line_total,
           o.grand_total / nullif(sum(i.line_total) over (partition by o.id), 0) as factor,
           coalesce(su.conversion_to_base, 1) as conversion
    from public.order_items i join public.orders o on o.id = i.order_id
    left join public.product_sell_units su on su.product_id = i.product_id and su.unit_id = i.unit_id
    where o.site_id = p_site_id and o.sales_channel = 'pos' and o.status <> 'cancelled'
      and (o.placed_at at time zone 'Africa/Dakar')::date between p_from and p_to
  ), net as (
    select it.product_id,
      it.line_total * coalesce(it.factor, 1) - coalesce((select sum(l.refund_amount) from public.sale_return_lines l where l.order_item_id = it.id), 0) as revenue,
      (it.quantity - coalesce((select sum(l.quantity) from public.sale_return_lines l where l.order_item_id = it.id and l.disposition = 'restock'), 0)) * it.conversion as base_qty
    from items it
  )
  select jsonb_build_object(
    'cost_basis', 'current_average_cost',
    'revenue_with_cost', coalesce(round(sum(n.revenue) filter (where c.unit_cost is not null), 0), 0),
    'cost', coalesce(round(sum(n.base_qty * c.unit_cost) filter (where c.unit_cost is not null), 0), 0),
    'margin', coalesce(round(sum(n.revenue - n.base_qty * c.unit_cost) filter (where c.unit_cost is not null), 0), 0),
    'revenue_without_cost', coalesce(round(sum(n.revenue) filter (where c.unit_cost is null), 0), 0),
    'products_without_cost', count(distinct n.product_id) filter (where c.unit_cost is null)
  ) into v_result
  from net n left join public.product_costs c on c.product_id = n.product_id;
  return v_result;
end;
$function$;
revoke all on function public.margin_report(uuid, date, date) from public, anon;
grant execute on function public.margin_report(uuid, date, date) to authenticated;
