-- =============================================================================
-- Données et sécurité (lot K) : export complet, journal d'audit en lecture, sessions de connexion — ADDITIVE
-- =============================================================================
-- STATUT : PRÉPARÉE, NON APPLIQUÉE, NON TESTÉE EN EXÉCUTION.
-- Nature : uniquement de nouvelles fonctions SECURITY DEFINER. Aucune table, politique ni droit existant modifié.
-- Les tables des lots précédents sont lues seulement si elles existent (to_regclass) : la migration s'applique
-- même si certains lots ne le sont pas encore.
--
-- CONTENU
--   a) public.export_site_data(site) : PROPRIÉTAIRE SEULEMENT. Toutes les données de la boutique, table par table
--      (jsonb). Exclus : comptes d'authentification, jetons, mots de passe, sessions, données d'autres boutiques.
--      Limite : 20 000 lignes par table (indiqué dans le résultat si atteint).
--   b) public.audit_log(site, avant, limite) : propriétaire et gérant. « Qui a fait quoi » à partir des journaux
--      existants (équipe, imports, publication, mouvements de caisse et de stock manuels, annulations, retours,
--      réceptions, règlements, dépassements de plafond). Pas de données personnelles sensibles : nom affiché de
--      l'acteur, action, référence, montant éventuel ; ni téléphone, ni e-mail, ni adresse.
--   c) public.my_auth_sessions() : sessions de connexion de L'APPELANT seulement (auth.sessions) : création,
--      dernière activité, navigateur, adresse IP si la version d'Auth les enregistre. Aucune autre personne.
--
-- RETOUR ARRIÈRE (une seule transaction)
--   drop function if exists public.my_auth_sessions();
--   drop function if exists public.audit_log(uuid, timestamptz, integer);
--   drop function if exists public.export_site_data(uuid);
-- =============================================================================

do $prereq$
begin
  if to_regprocedure('private.staff_role(uuid)') is null then
    raise exception 'Prérequis manquant : appliquer d''abord team_accounts.';
  end if;
end;
$prereq$;


-- -----------------------------------------------------------------------------
-- a) Export complet (propriétaire)
-- -----------------------------------------------------------------------------
create or replace function public.export_site_data(p_site_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_limit constant integer := 20000;
  v_result jsonb := '{}'::jsonb;
  v_truncated jsonb := '[]'::jsonb;
  v_rows jsonb;
  v_count integer;
  v_spec record;
begin
  if auth.uid() is null or coalesce(private.staff_role(p_site_id), '') <> 'owner' then
    raise exception 'Export réservé au propriétaire de la boutique.' using errcode = '42501';
  end if;

  -- Tables portant site_id, ou rattachées par une table parente (filtre SQL fixe, aucune saisie de l'appelant).
  for v_spec in
    select * from (values
      ('sites', 'select to_jsonb(t) - ''settings'' - ''theme'' as row from public.sites t where t.id = $1'),
      ('business_profiles', 'select to_jsonb(t) as row from public.business_profiles t where t.site_id = $1'),
      ('store_document_settings', 'select to_jsonb(t) as row from public.store_document_settings t where t.site_id = $1'),
      ('stock_locations', 'select to_jsonb(t) as row from public.stock_locations t where t.site_id = $1'),
      ('product_categories', 'select to_jsonb(t) as row from public.product_categories t where t.site_id = $1'),
      ('product_units', 'select to_jsonb(t) as row from public.product_units t where t.site_id = $1'),
      ('products', 'select to_jsonb(t) as row from public.products t where t.site_id = $1'),
      ('product_sell_units', 'select to_jsonb(t) as row from public.product_sell_units t where t.site_id = $1'),
      ('price_tiers', 'select to_jsonb(t) as row from public.price_tiers t where t.site_id = $1'),
      ('product_costs', 'select to_jsonb(t) as row from public.product_costs t where t.site_id = $1'),
      ('product_images', 'select to_jsonb(t) as row from public.product_images t where t.site_id = $1'),
      ('product_stock_thresholds', 'select to_jsonb(t) as row from public.product_stock_thresholds t where t.site_id = $1'),
      ('inventory_movements', 'select to_jsonb(t) as row from public.inventory_movements t where t.site_id = $1'),
      ('orders', 'select to_jsonb(t) as row from public.orders t where t.site_id = $1'),
      ('order_items', 'select to_jsonb(t) as row from public.order_items t join public.orders o on o.id = t.order_id where o.site_id = $1'),
      ('payment_transactions', 'select to_jsonb(t) - ''provider_payload'' as row from public.payment_transactions t join public.orders o on o.id = t.order_id where o.site_id = $1'),
      ('store_documents', 'select to_jsonb(t) as row from public.store_documents t where t.site_id = $1'),
      ('cash_register_sessions', 'select to_jsonb(t) as row from public.cash_register_sessions t where t.site_id = $1'),
      ('cash_register_movements', 'select to_jsonb(t) as row from public.cash_register_movements t where t.site_id = $1'),
      ('cash_movement_details', 'select to_jsonb(t) as row from public.cash_movement_details t where t.site_id = $1'),
      ('store_customers', 'select to_jsonb(t) as row from public.store_customers t where t.site_id = $1'),
      ('customer_ledger', 'select to_jsonb(t) as row from public.customer_ledger t where t.site_id = $1'),
      ('sale_returns', 'select to_jsonb(t) as row from public.sale_returns t where t.site_id = $1'),
      ('sale_return_lines', 'select to_jsonb(t) as row from public.sale_return_lines t where t.site_id = $1'),
      ('suppliers', 'select to_jsonb(t) as row from public.suppliers t where t.site_id = $1'),
      ('purchase_orders', 'select to_jsonb(t) as row from public.purchase_orders t where t.site_id = $1'),
      ('purchase_order_lines', 'select to_jsonb(t) as row from public.purchase_order_lines t where t.site_id = $1'),
      ('purchase_receipts', 'select to_jsonb(t) as row from public.purchase_receipts t where t.site_id = $1'),
      ('purchase_receipt_lines', 'select to_jsonb(t) as row from public.purchase_receipt_lines t where t.site_id = $1'),
      ('supplier_ledger', 'select to_jsonb(t) as row from public.supplier_ledger t where t.site_id = $1'),
      ('product_import_runs', 'select to_jsonb(t) as row from public.product_import_runs t where t.site_id = $1'),
      ('site_staff', 'select to_jsonb(t) - ''membership_created'' as row from public.site_staff t where t.site_id = $1'),
      ('team_audit_events', 'select to_jsonb(t) as row from public.team_audit_events t where t.site_id = $1'),
      ('storefront_publication_events', 'select to_jsonb(t) as row from public.storefront_publication_events t where t.site_id = $1')
    ) as s(name, query)
  loop
    continue when to_regclass('public.' || v_spec.name) is null;
    execute format('select coalesce(jsonb_agg(q.row), ''[]''::jsonb), count(*) from (%s limit %s) q', v_spec.query, v_limit + 1)
      into v_rows, v_count using p_site_id;
    if v_count > v_limit then
      v_rows := v_rows - v_limit;
      v_truncated := v_truncated || to_jsonb(v_spec.name);
    end if;
    v_result := v_result || jsonb_build_object(v_spec.name, v_rows);
  end loop;

  return jsonb_build_object(
    'format', 'bardec-boutique-export', 'version', 1, 'site_id', p_site_id, 'exported_at', now(),
    'row_limit_per_table', v_limit, 'truncated_tables', v_truncated, 'tables', v_result
  );
end;
$function$;
revoke all on function public.export_site_data(uuid) from public, anon;
grant execute on function public.export_site_data(uuid) to authenticated;


-- -----------------------------------------------------------------------------
-- b) Journal d'audit (propriétaire, gérant)
-- -----------------------------------------------------------------------------
create or replace function public.audit_log(p_site_id uuid, p_before timestamptz default null, p_limit integer default 100)
returns table (occurred_at timestamptz, actor_name text, category text, action text, reference text, amount numeric)
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_sql text := '';
  v_parts text[] := array[]::text[];
  v_limit integer := least(greatest(coalesce(p_limit, 100), 1), 500);
begin
  if auth.uid() is null or coalesce(private.staff_role(p_site_id), '') not in ('owner', 'manager') then
    raise exception 'Journal d''audit réservé au propriétaire et au gérant.' using errcode = '42501';
  end if;

  if to_regclass('public.team_audit_events') is not null then
    v_parts := v_parts || 'select e.created_at, e.actor_user_id, ''Équipe'', e.action, coalesce(e.details ->> ''staff_role'', e.details ->> ''to''), null::numeric from public.team_audit_events e where e.site_id = $1';
  end if;
  if to_regclass('public.product_import_runs') is not null then
    v_parts := v_parts || 'select r.created_at, r.actor_user_id, ''Import'', ''import_'' || r.status, r.row_count || '' ligne(s), '' || r.source, null::numeric from public.product_import_runs r where r.site_id = $1';
  end if;
  if to_regclass('public.storefront_publication_events') is not null then
    v_parts := v_parts || 'select p.created_at, p.actor_user_id, ''Site public'', p.action, null, null::numeric from public.storefront_publication_events p where p.site_id = $1';
  end if;
  v_parts := v_parts || 'select m.created_at, m.actor_user_id, ''Caisse'', m.movement_type, left(m.reason, 120), m.amount from public.cash_register_movements m where m.site_id = $1 and m.movement_type in (''expense'', ''cash_in'', ''cash_out'', ''deposit'', ''refund_cash'')';
  v_parts := v_parts || 'select m.created_at, m.actor_user_id, ''Stock'', m.movement_type, left(m.reason, 120), m.quantity_delta from public.inventory_movements m where m.site_id = $1 and m.reference_type in (''manual_entry'', ''order_void'')';
  v_parts := v_parts || 'select coalesce(o.cancelled_at, o.updated_at), null::uuid, ''Ventes'', ''void_sale'', d.document_number, o.grand_total from public.orders o left join public.store_documents d on d.order_id = o.id and d.document_type = ''receipt'' where o.site_id = $1 and o.status = ''cancelled'' and o.sales_channel = ''pos''';
  if to_regclass('public.sale_returns') is not null then
    v_parts := v_parts || 'select r.created_at, r.created_by, ''Ventes'', ''return'', r.document_number, r.refund_amount from public.sale_returns r where r.site_id = $1';
  end if;
  if to_regclass('public.purchase_receipts') is not null then
    v_parts := v_parts || 'select r.created_at, r.received_by, ''Achats'', ''receive_purchase'', po.number, null::numeric from public.purchase_receipts r join public.purchase_orders po on po.id = r.purchase_order_id where r.site_id = $1';
  end if;
  if to_regclass('public.supplier_ledger') is not null then
    v_parts := v_parts || 'select l.created_at, l.recorded_by, ''Achats'', ''supplier_payment'', l.reference, l.amount from public.supplier_ledger l where l.site_id = $1 and l.entry_type = ''payment''';
  end if;
  if to_regclass('public.customer_ledger') is not null then
    v_parts := v_parts || 'select l.created_at, l.recorded_by, ''Crédit'', case when l.override_reason is not null then ''credit_limit_override'' else l.entry_type end, coalesce(l.document_number, l.reference), l.amount from public.customer_ledger l where l.site_id = $1';
  end if;

  v_sql := format(
    'select a.at, coalesce(p.display_name, case when a.actor is null then null else ''Compte sans nom'' end), a.cat, a.act, a.ref, a.amt
     from (%s) as a(at, actor, cat, act, ref, amt)
     left join public.profiles p on p.user_id = a.actor
     where ($2 is null or a.at < $2)
     order by a.at desc
     limit %s',
    array_to_string(v_parts, ' union all '), v_limit);
  return query execute v_sql using p_site_id, p_before;
end;
$function$;
revoke all on function public.audit_log(uuid, timestamptz, integer) from public, anon;
grant execute on function public.audit_log(uuid, timestamptz, integer) to authenticated;


-- -----------------------------------------------------------------------------
-- c) Sessions de connexion de l'appelant
-- -----------------------------------------------------------------------------
create or replace function public.my_auth_sessions()
returns table (session_id uuid, created_at timestamptz, last_activity_at timestamptz, user_agent text, ip text)
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_has_ua boolean;
  v_has_ip boolean;
begin
  if auth.uid() is null then
    raise exception 'Connexion requise.' using errcode = '42501';
  end if;
  if to_regclass('auth.sessions') is null then
    return;
  end if;
  select exists (select 1 from information_schema.columns where table_schema = 'auth' and table_name = 'sessions' and column_name = 'user_agent'),
         exists (select 1 from information_schema.columns where table_schema = 'auth' and table_name = 'sessions' and column_name = 'ip')
  into v_has_ua, v_has_ip;
  return query execute format(
    'select s.id, s.created_at, coalesce(s.updated_at, s.created_at), %s, %s from auth.sessions s where s.user_id = $1 order by 3 desc limit 50',
    case when v_has_ua then 's.user_agent::text' else 'null::text' end,
    case when v_has_ip then 'host(s.ip)::text' else 'null::text' end)
  using auth.uid();
end;
$function$;
revoke all on function public.my_auth_sessions() from public, anon;
grant execute on function public.my_auth_sessions() to authenticated;
