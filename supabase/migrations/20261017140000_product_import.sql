-- =============================================================================
-- Import de produits (lot B) : fonction transactionnelle, prix d'achat protégé, journal d'import
-- =============================================================================
-- STATUT : PRÉPARÉE, NON APPLIQUÉE, NON TESTÉE EN EXÉCUTION. Ne s'applique qu'avec l'autorisation écrite
-- du propriétaire qui nomme cette migration (20261017140000_product_import).
--
-- PRÉREQUIS (appliqués sur le projet réel) : pos_sales_foundation (private.site_role),
-- stock_entries_foundation (public.record_stock_movement).
--
-- CONTENU
--   a) public.product_costs : prix d'achat par produit, dans une table SÉPARÉE de products. Raison :
--      la politique products_public_read laisse anon lire toutes les colonnes de products des sites publiés ;
--      une colonne products.cost_price y serait publique. Lecture : propriétaire et admin seulement.
--      Aucune écriture directe (aucun droit INSERT/UPDATE/DELETE) : écriture par fonctions SECURITY DEFINER.
--   b) public.product_import_runs : journal des imports (qui, quand, méthode, mode, nombre de lignes,
--      créés, mis à jour, mouvements de stock, résultat, erreurs). Lecture : propriétaire et admin.
--      Aucune écriture directe.
--   c) public.import_products(site, lignes jsonb, mode, source) : SECURITY DEFINER.
--
-- RÈGLES DE import_products
--   - Rôles : propriétaire et admin (private.site_role). editor, publisher, viewer : refusés (42501),
--     le refus n'est pas journalisé (aucune écriture pour un appelant non autorisé).
--   - 1 à 1000 lignes. Mode 'create' (tout SKU ou code-barres déjà connu = erreur) ou 'upsert'
--     (un SKU connu met à jour nom, prix de vente, prix d'achat ; code-barres et catégorie seulement s'ils
--     sont fournis ; l'unité n'est jamais modifiée ; stock initial refusé pour un produit existant).
--   - Tout ou rien : validation complète d'abord ; si une ligne est invalide, rien n'est écrit.
--     Puis écriture dans un sous-bloc : toute erreur (contrainte, stock, droits) annule toutes les écritures
--     du sous-bloc. Dans les deux cas une ligne 'failed' est inscrite au journal et la fonction renvoie
--     les erreurs (elle ne lève pas d'exception, pour que le journal soit conservé).
--   - Prix de vente obligatoire, prix d'achat facultatif : nombres entiers >= 0 (FCFA, sans décimale).
--   - Stock initial >= 0, décimales limitées par product_units.decimal_places de l'unité ; passe par
--     public.record_stock_movement (type initial_stock, motif « Import de produits »), donc mêmes contrôles
--     et même audit que la saisie manuelle.
--   - Unité : une unité de la boutique (unit_id) ; devient l'unité de base du produit (conversion 1, par défaut).
--   - Catégorie : par nom, sans tenir compte de la casse ; créée à la racine si elle n'existe pas.
--   - Emplacement : actif, de la boutique ; obligatoire si stock initial > 0.
--   - Produits créés : statut 'active', stock suivi, type 'physical', slug unique dérivé du nom.
--   - Doublons : SKU (sans casse) et code-barres, dans le fichier et en base. Verrou consultatif par site :
--     deux imports simultanés sur la même boutique s'exécutent l'un après l'autre.
--   - Les valeurs envoyées par le client (product_id, action) sont ignorées : la base résout tout elle-même.
--
-- AUDIT : journal product_import_runs (une ligne par appel autorisé) + déclencheur d'audit existant sur
-- inventory_movements (mouvements de stock initial). La fonction n'écrit pas directement dans
-- store_audit_events : son schéma n'est pas versionné dans ce dépôt.
--
-- RETOUR ARRIÈRE (une seule transaction ; supprime le journal et les prix d'achat saisis)
--   drop function if exists public.import_products(uuid, jsonb, text, text);
--   drop function if exists private.import_slug(text);
--   drop table if exists public.product_import_runs;
--   drop table if exists public.product_costs;
--   (les produits, catégories et mouvements créés par des imports restent : ce sont des données métier.)
-- =============================================================================


-- -----------------------------------------------------------------------------
-- a) Prix d'achat
-- -----------------------------------------------------------------------------
create table public.product_costs (
  product_id uuid primary key references public.products(id) on delete cascade,
  site_id uuid not null references public.sites(id) on delete cascade,
  unit_cost numeric(14,2) not null constraint product_costs_unit_cost_check check (unit_cost >= 0),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

create index product_costs_site_idx on public.product_costs (site_id);

alter table public.product_costs enable row level security;

create policy product_costs_manager_read on public.product_costs
  for select to authenticated
  using (exists (
    select 1 from public.sites s
    where s.id = product_costs.site_id and private.has_workspace_access(s.workspace_id, array['admin'::text])
  ));

revoke all on public.product_costs from anon, authenticated;
grant select on public.product_costs to authenticated;


-- -----------------------------------------------------------------------------
-- b) Journal des imports
-- -----------------------------------------------------------------------------
create table public.product_import_runs (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.sites(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  source text not null
    constraint product_import_runs_source_check check (source in ('csv', 'xlsx', 'paste', 'manual', 'api', 'ocr')),
  mode text not null constraint product_import_runs_mode_check check (mode in ('create', 'upsert')),
  row_count integer not null constraint product_import_runs_row_count_check check (row_count >= 0),
  created_count integer not null default 0,
  updated_count integer not null default 0,
  stock_movement_count integer not null default 0,
  status text not null constraint product_import_runs_status_check check (status in ('succeeded', 'failed')),
  errors jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index product_import_runs_site_idx on public.product_import_runs (site_id, created_at desc);

alter table public.product_import_runs enable row level security;

create policy product_import_runs_manager_read on public.product_import_runs
  for select to authenticated
  using (exists (
    select 1 from public.sites s
    where s.id = product_import_runs.site_id and private.has_workspace_access(s.workspace_id, array['admin'::text])
  ));

revoke all on public.product_import_runs from anon, authenticated;
grant select on public.product_import_runs to authenticated;


-- -----------------------------------------------------------------------------
-- c) Import
-- -----------------------------------------------------------------------------
-- « Câble 2,5 mm² » → « cable-2-5-mm2 » (accents français retirés sans dépendre de l'extension unaccent).
create or replace function private.import_slug(p_text text)
returns text
language sql
immutable
set search_path = ''
as $function$
  select coalesce(nullif(left(btrim(regexp_replace(
    translate(lower(coalesce(p_text, '')), 'àâäáãåçéèêëíìîïñóòôöõúùûüýÿœæ²³', 'aaaaaaceeeeiiiinooooouuuuyyoa23'),
    '[^a-z0-9]+', '-', 'g'), '-'), 80), ''), 'produit');
$function$;

revoke all on function private.import_slug(text) from public, anon, authenticated;

-- p_rows : [{ "line": n, "name": texte, "sku": texte?, "barcode": texte?, "category": texte?, "unit_id": uuid?,
--             "price": entier, "cost": entier?, "initial_stock": nombre?, "location_id": uuid? }]
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
  v_role := private.site_role(p_site_id);
  if v_role is null or v_role not in ('owner', 'admin') then
    raise exception 'Import refusé : réservé au propriétaire et aux administrateurs.' using errcode = '42501';
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
