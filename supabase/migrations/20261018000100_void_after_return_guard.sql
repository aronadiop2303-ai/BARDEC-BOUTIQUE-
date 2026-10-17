-- =============================================================================
-- Retours (lot G, partie 2/2) : pas d'annulation d'une vente déjà retournée — EXIGE UNE AUTORISATION ÉCRITE
-- =============================================================================
-- STATUT : PRÉPARÉE, NON APPLIQUÉE, NON TESTÉE EN EXÉCUTION.
-- Nature : NON additive. Réécrit public.void_sale (version du lot C, 20261017160100_team_roles_enforcement) avec
-- UN seul ajout : refus si la vente a au moins un retour (sale_returns). Sans ce correctif, void_sale contre-passe
-- TOUTE la vente (stock et espèces) même après un retour partiel : double remise en stock, double remboursement.
-- Ne s'applique qu'avec l'autorisation écrite du propriétaire nommant 20261018000100_void_after_return_guard.
--
-- PRÉREQUIS : 20261017160100_team_roles_enforcement et 20261018000000_sale_returns appliquées.
-- AVANT application : comparer la définition réelle (pg_get_functiondef) avec la source ci-dessous.
-- RETOUR ARRIÈRE : réappliquer le bloc void_sale de 20261017160100_team_roles_enforcement.sql.
-- =============================================================================

do $prereq$
begin
  if to_regclass('public.sale_returns') is null or to_regprocedure('private.staff_role(uuid)') is null then
    raise exception 'Prérequis manquant : appliquer d''abord team_roles_enforcement et sale_returns.';
  end if;
end;
$prereq$;

-- Source : supabase/migrations/20261017160100_team_roles_enforcement.sql (version lot C), un seul ajout.
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
  -- Lot G : une vente qui a déjà un retour ne s'annule pas (double remboursement et double remise en stock).
  if exists (select 1 from public.sale_returns r where r.order_id = v_order.id) then
    raise exception 'Cette vente a déjà un retour (avoir) : annulation impossible, faites un retour des articles restants.'
      using errcode = '22023';
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
