-- =============================================================================
-- Correctif : le déclencheur d'audit écrit dans des colonnes qui n'existent pas
-- =============================================================================
-- STATUT : NON APPLIQUÉE, NON TESTÉE sur base locale. NE PAS APPLIQUER sans accord écrit.
--
-- PROBLÈME (constaté en lecture seule le 16/10/2026 sur le projet réel)
--   private.capture_store_audit_event() insère dans store_audit_events les colonnes
--   event_type, before_data et after_data, absentes de la table, avec source = 'database_trigger',
--   valeur refusée par store_audit_events_source_check.
--   Le déclencheur (AFTER INSERT/UPDATE/DELETE) est posé sur products, product_variants,
--   inventory_movements, orders, payment_transactions, quotes, stock_locations et product_batches.
--   Toute écriture rattachée à un site sur ces tables échoue, et toute la transaction est annulée.
--   Effet observé : l'assistant de configuration a enregistré business_profiles (1 ligne),
--   puis s'est arrêté à stock_locations (0 ligne). store_audit_events est vide.
--
-- CORRECTIF
--   Même corps : mêmes rattachements au site et mêmes champs masqués (provider_payload, adresses,
--   e-mail, téléphone). Seule l'insertion change pour suivre les colonnes réelles :
--     event_key  = '<table>.<insert|update|delete>'  (1 à 120 caractères)
--     severity   = 'info'
--     details    = {"before": …, "after": …}          (jsonb non nul)
--     source     = 'system'                           (valeur autorisée)
--   Signature, SECURITY DEFINER et search_path = '' sont inchangés. Les déclencheurs ne sont pas
--   recréés. Aucune donnée existante n'est modifiée.
--
-- RETOUR ARRIÈRE
--   Recréer la version précédente rétablirait le blocage, donc aucun retour arrière utile.
--   En cas de problème, corriger la fonction de manière ciblée, avec accord écrit.
-- =============================================================================

create or replace function private.capture_store_audit_event()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare v_site_id uuid; v_actor uuid; v_old jsonb; v_new jsonb; v_entity_id uuid; v_event text; v_summary text;
begin
 if TG_OP='DELETE' then v_old:=to_jsonb(OLD); else v_old:=null; end if;
 if TG_OP in ('INSERT','UPDATE') then v_new:=to_jsonb(NEW); else v_new:=null; end if;
 if TG_OP='DELETE' then v_entity_id:=nullif(v_old->>'id','')::uuid; v_site_id:=nullif(v_old->>'site_id','')::uuid;
 else v_entity_id:=nullif(v_new->>'id','')::uuid; v_site_id:=nullif(v_new->>'site_id','')::uuid; end if;
 if v_site_id is null and TG_TABLE_NAME='product_variants' then
  select p.site_id into v_site_id from public.products p where p.id=coalesce(nullif(v_new->>'product_id','')::uuid,nullif(v_old->>'product_id','')::uuid);
 end if;
 if v_site_id is null and TG_TABLE_NAME='payment_transactions' then
  select o.site_id into v_site_id from public.orders o where o.id=coalesce(nullif(v_new->>'order_id','')::uuid,nullif(v_old->>'order_id','')::uuid);
 end if;
 if v_site_id is null and TG_TABLE_NAME='shipments' then
  select o.site_id into v_site_id from public.orders o where o.id=coalesce(nullif(v_new->>'order_id','')::uuid,nullif(v_old->>'order_id','')::uuid);
 end if;
 if v_site_id is null then return coalesce(NEW,OLD); end if;
 v_actor:=auth.uid(); v_event:=lower(TG_OP); v_summary:=TG_TABLE_NAME||' '||v_event;
 insert into public.store_audit_events
   (site_id, actor_user_id, event_key, entity_type, entity_id, severity, summary, details, source)
 values (v_site_id, v_actor, TG_TABLE_NAME||'.'||v_event, TG_TABLE_NAME, v_entity_id, 'info', v_summary,
   jsonb_build_object(
     'before', case when v_old is null then null else v_old-'provider_payload'-'shipping_address'-'billing_address'-'customer_email'-'customer_phone' end,
     'after',  case when v_new is null then null else v_new-'provider_payload'-'shipping_address'-'billing_address'-'customer_email'-'customer_phone' end),
   'system');
 return coalesce(NEW,OLD);
end;
$function$;
