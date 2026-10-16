-- =============================================================================
-- Entrées de stock (jalon Q2) : inventaire initial, réception, ajustement, perte, par fonction contrôlée
-- =============================================================================
-- STATUT : APPLIQUÉE le 16/10/2026 sur le projet réel (version 20261016065722), sur autorisation écrite du
-- propriétaire ; non testée en exécution (aucun mouvement enregistré, test SQL jamais exécuté).
-- Vérifiée en lecture seule. Le SQL appliqué est celui de ce fichier avant la mise à jour de ces lignes
-- d'en-tête (empreinte MD5 identique, fins de ligne LF).
--
-- ÉTAT VÉRIFIÉ (lecture seule, 16/10/2026)
--   inventory_movements : seule politique inventory_movements_store_member_read (SELECT), RLS active, 0 ligne ;
--   authenticated détient encore INSERT, UPDATE, DELETE au niveau table (sans effet faute de politique).
--   Déclencheur d'audit audit_inventory_movements actif (correctif 20261016004129 appliqué).
--
-- CONTENU
--   - public.record_stock_movement : seul chemin d'écriture manuelle du registre de stock.
--   - public.stock_entries_version : sonde sans effet, permet à l'interface de savoir si la migration est appliquée.
--   - Retrait de INSERT, UPDATE, DELETE sur inventory_movements à anon et authenticated (seconde barrière ;
--     les ventes écrivent via record_sale et void_sale, SECURITY DEFINER, non concernées).
--
-- RÈGLES DE record_stock_movement
--   - Rôles : propriétaire et admin. editor, publisher, viewer : refusés (42501).
--   - Types : initial_stock, restock (quantité > 0) ; damage (quantité > 0, sortie) ; adjustment (positif ou négatif).
--     Les autres types (sale, return, reservation, release) restent réservés aux fonctions de vente.
--   - Produit du site, statut 'active', stock suivi (track_inventory) ; emplacement du site, actif.
--   - Unité : une unité de vente du produit (conversion vers l'unité de base) ; sans unité, l'unité de base
--     (conversion 1). Décimales limitées par product_units.decimal_places.
--   - Sortie (adjustment négatif, damage) : refus si le stock de l'emplacement deviendrait négatif, sauf
--     products.allow_backorder = true ou sites.settings->pos->allow_negative_stock = true.
--   - Motif obligatoire (3 à 500 caractères) pour adjustment et damage ; facultatif sinon (500 au plus).
--   - initial_stock refusé s'il existe déjà un mouvement pour ce produit à cet emplacement : utiliser adjustment.
--   - Mouvement écrit avec reference_type 'manual_entry' ; le déclencheur d'audit existant journalise l'écriture.
--
-- NON TRAITÉ (décision à prendre)
--   - Coût d'achat : PAS de colonne products.cost_price. La politique products_public_read laisse anon lire
--     toutes les colonnes des produits des sites publiés : un coût d'achat y serait public. Proposition :
--     table séparée (product_costs) lisible par propriétaire et admin seulement.
--
-- RETOUR ARRIÈRE (une seule transaction)
--   drop function if exists public.record_stock_movement(uuid, uuid, uuid, text, numeric, uuid, text);
--   drop function if exists public.stock_entries_version();
--   grant insert, update, delete on public.inventory_movements to authenticated;
--   (anon détient aussi ces droits aujourd'hui, sans politique donc sans effet : le retour ne les rétablit pas.)
-- =============================================================================


revoke insert, update, delete on public.inventory_movements from anon, authenticated;


create or replace function public.stock_entries_version()
returns integer
language sql
immutable
set search_path = ''
as $function$
  select 1;
$function$;

revoke all on function public.stock_entries_version() from public, anon;
grant execute on function public.stock_entries_version() to authenticated;


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

  v_role := private.site_role(p_site_id);
  if v_role is null or v_role not in ('owner', 'admin') then
    raise exception 'Mouvement de stock refusé : réservé au propriétaire et aux administrateurs.' using errcode = '42501';
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
