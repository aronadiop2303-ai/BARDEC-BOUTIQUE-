-- =============================================================================
-- Site public de la boutique (lot D, partie 1/2) : vitrine en lecture seule — ADDITIVE
-- =============================================================================
-- STATUT : PRÉPARÉE, NON APPLIQUÉE, NON TESTÉE EN EXÉCUTION.
-- Nature : uniquement de nouveaux objets (2 tables avec RLS activée, fonctions). Aucun objet, politique ou droit
-- existant n'est modifié. Aucune table brute n'est ouverte à anon.
--
-- PRÉREQUIS : 20261017160000_team_accounts (private.staff_role).
--
-- CONTENU
--   a) public.product_images : photo d'un produit (adresse https), écrite par set_product_image (owner, manager).
--      Aucune lecture ni écriture directe pour anon ou authenticated : lue par les fonctions de vitrine et par
--      propriétaire/gérant.
--   b) public.storefront_publication_events : journal des publications et dépublications.
--   c) Fonctions de vitrine, SECURITY DEFINER, exécutables par anon :
--        storefront_shop(site), storefront_categories(site), storefront_products(site, catégorie, recherche, limite,
--        décalage), storefront_product(site, slug).
--      Elles ne renvoient des données QUE si le site est publié (sites.status = 'published'), ou pour l'aperçu,
--      si l'appelant connecté est propriétaire ou gérant de la boutique. Sinon : zéro ligne / null.
--      Produits : seulement status = 'active'. Colonnes renvoyées : identifiant, slug, nom, famille, prix de vente,
--      devise, photo, unité de base, disponibilité ('in_stock' | 'out_of_stock' | 'on_order' | 'available'),
--      description et attributs pour la fiche. JAMAIS : prix d'achat, stock exact, marges, mouvements, ventes,
--      clients, réglages internes du site.
--      Boutique : nom public, téléphone, WhatsApp, e-mail, adresse, ville, horaires (texte), devise.
--   d) public.set_storefront_published(site, publier, nom_de_confirmation) : PROPRIÉTAIRE SEULEMENT
--      (workspaces.owner_id), confirmation explicite = nom exact de la boutique ; publie (status 'published',
--      published_at conservé s'il existe) ou dépublie (status 'draft'). Journalisé. Rien n'est publié
--      automatiquement : seul cet appel, déclenché par le bouton du propriétaire, change le statut.
--   e) public.set_product_image(produit, url) : propriétaire et gérant ; https uniquement, 500 caractères au plus.
--
-- EXPOSITION EXISTANTE, NON CORRIGÉE ICI (voir partie 2/2, autorisation requise) : products_public_read laisse
-- anon lire toutes les colonnes de products des sites publiés (dont inventory_quantity) ;
-- published_sites_anon_select expose toutes les colonnes de sites (dont settings, theme).
--
-- RETOUR ARRIÈRE (une seule transaction)
--   drop function if exists public.set_product_image(uuid, text);
--   drop function if exists public.set_storefront_published(uuid, boolean, text);
--   drop function if exists public.storefront_product(uuid, text);
--   drop function if exists public.storefront_products(uuid, uuid, text, integer, integer);
--   drop function if exists public.storefront_categories(uuid);
--   drop function if exists public.storefront_shop(uuid);
--   drop function if exists private.storefront_visible(uuid);
--   drop function if exists private.storefront_availability(uuid, uuid);
--   drop table if exists public.storefront_publication_events;
--   drop table if exists public.product_images;
--   (un site publié par set_storefront_published le reste : le dépublier avant si nécessaire.)
-- =============================================================================

do $prereq$
begin
  if to_regprocedure('private.staff_role(uuid)') is null then
    raise exception 'Prérequis manquant : appliquer d''abord team_accounts.';
  end if;
end;
$prereq$;


-- -----------------------------------------------------------------------------
-- a) Photos produits
-- -----------------------------------------------------------------------------
create table public.product_images (
  product_id uuid primary key references public.products(id) on delete cascade,
  site_id uuid not null references public.sites(id) on delete cascade,
  url text not null constraint product_images_url_check check (url ~ '^https://[^\s]+$' and char_length(url) <= 500),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

create index product_images_site_idx on public.product_images (site_id);
alter table public.product_images enable row level security;
revoke all on public.product_images from anon, authenticated;

create policy product_images_manager_read on public.product_images
  for select to authenticated
  using (private.staff_role(site_id) in ('owner', 'manager'));
grant select on public.product_images to authenticated;


-- -----------------------------------------------------------------------------
-- b) Journal de publication
-- -----------------------------------------------------------------------------
create table public.storefront_publication_events (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.sites(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  action text not null constraint storefront_publication_events_action_check check (action in ('publish', 'unpublish')),
  created_at timestamptz not null default now()
);

create index storefront_publication_events_site_idx on public.storefront_publication_events (site_id, created_at desc);
alter table public.storefront_publication_events enable row level security;
revoke all on public.storefront_publication_events from anon, authenticated;

create policy storefront_publication_events_manager_read on public.storefront_publication_events
  for select to authenticated
  using (private.staff_role(site_id) in ('owner', 'manager'));
grant select on public.storefront_publication_events to authenticated;


-- -----------------------------------------------------------------------------
-- c) Vitrine
-- -----------------------------------------------------------------------------
-- Site visible : publié, ou aperçu par son propriétaire ou son gérant connecté.
create or replace function private.storefront_visible(p_site_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (select 1 from public.sites s where s.id = p_site_id and s.status = 'published')
      or coalesce(private.staff_role(p_site_id), '') in ('owner', 'manager');
$function$;

revoke all on function private.storefront_visible(uuid) from public, anon, authenticated;

-- Disponibilité sans quantité : stock non suivi → available ; > 0 → in_stock ; sinon on_order si commande
-- possible (allow_backorder), out_of_stock autrement.
create or replace function private.storefront_availability(p_site_id uuid, p_product_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $function$
  select case
    when not p.track_inventory then 'available'
    when coalesce((select sum(m.quantity_delta) from public.inventory_movements m
                   where m.site_id = p_site_id and m.product_id = p.id and m.variant_id is null), 0) > 0 then 'in_stock'
    when p.allow_backorder then 'on_order'
    else 'out_of_stock'
  end
  from public.products p
  where p.id = p_product_id and p.site_id = p_site_id;
$function$;

revoke all on function private.storefront_availability(uuid, uuid) from public, anon, authenticated;

create or replace function public.storefront_shop(p_site_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  select jsonb_build_object(
    'id', s.id,
    'name', coalesce(nullif(btrim(bp.public_name), ''), s.name),
    'phone', bp.phone,
    'whatsapp', bp.whatsapp,
    'email', bp.email,
    'address', bp.address,
    'city', bp.city,
    'opening_hours', bp.opening_hours ->> 'text',
    'currency', coalesce(bp.currency_code, 'XOF'),
    'published', s.status = 'published'
  )
  from public.sites s
  left join public.business_profiles bp on bp.site_id = s.id
  where s.id = p_site_id and private.storefront_visible(s.id);
$function$;

create or replace function public.storefront_categories(p_site_id uuid)
returns table (id uuid, parent_id uuid, name text, slug text, product_count bigint)
language sql
stable
security definer
set search_path = ''
as $function$
  select c.id, c.parent_id, c.name, c.slug, count(p.id)
  from public.product_categories c
  join public.products p on p.category_id = c.id and p.site_id = c.site_id and p.status = 'active'
  where c.site_id = p_site_id and c.is_active and private.storefront_visible(p_site_id)
  group by c.id, c.parent_id, c.name, c.slug, c.sort_order
  order by c.sort_order, c.name;
$function$;

create or replace function public.storefront_products(
  p_site_id uuid,
  p_category_id uuid default null,
  p_search text default null,
  p_limit integer default 48,
  p_offset integer default 0
)
returns table (
  id uuid, slug text, name text, category_id uuid, price numeric, currency_code text,
  image_url text, unit_label text, availability text
)
language sql
stable
security definer
set search_path = ''
as $function$
  select p.id, p.slug, p.name, p.category_id, p.price, p.currency_code,
         img.url,
         (select u.label from public.product_sell_units su join public.product_units u on u.id = su.unit_id
          where su.product_id = p.id and su.conversion_to_base = 1 order by su.is_default desc limit 1),
         private.storefront_availability(p_site_id, p.id)
  from public.products p
  left join public.product_images img on img.product_id = p.id
  where p.site_id = p_site_id
    and p.status = 'active'
    and private.storefront_visible(p_site_id)
    and (p_category_id is null or p.category_id = p_category_id)
    and (nullif(btrim(coalesce(p_search, '')), '') is null
         or p.name ilike '%' || replace(replace(replace(left(btrim(p_search), 80), '\', '\\'), '%', '\%'), '_', '\_') || '%')
  order by p.name
  limit least(greatest(coalesce(p_limit, 48), 1), 100)
  offset greatest(coalesce(p_offset, 0), 0);
$function$;

create or replace function public.storefront_product(p_site_id uuid, p_slug text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  select jsonb_build_object(
    'id', p.id, 'slug', p.slug, 'name', p.name, 'category_id', p.category_id,
    'category_name', (select c.name from public.product_categories c where c.id = p.category_id and c.is_active),
    'price', p.price, 'currency_code', p.currency_code, 'description', p.description,
    'attributes', coalesce(p.attributes, '{}'::jsonb), 'image_url', img.url,
    'unit_label', (select u.label from public.product_sell_units su join public.product_units u on u.id = su.unit_id
                   where su.product_id = p.id and su.conversion_to_base = 1 order by su.is_default desc limit 1),
    'availability', private.storefront_availability(p_site_id, p.id)
  )
  from public.products p
  left join public.product_images img on img.product_id = p.id
  where p.site_id = p_site_id and p.slug = p_slug and p.status = 'active' and private.storefront_visible(p_site_id);
$function$;

revoke all on function public.storefront_shop(uuid) from public;
revoke all on function public.storefront_categories(uuid) from public;
revoke all on function public.storefront_products(uuid, uuid, text, integer, integer) from public;
revoke all on function public.storefront_product(uuid, text) from public;
grant execute on function public.storefront_shop(uuid) to anon, authenticated;
grant execute on function public.storefront_categories(uuid) to anon, authenticated;
grant execute on function public.storefront_products(uuid, uuid, text, integer, integer) to anon, authenticated;
grant execute on function public.storefront_product(uuid, text) to anon, authenticated;


-- -----------------------------------------------------------------------------
-- d) Publication (propriétaire seulement, confirmation explicite)
-- -----------------------------------------------------------------------------
create or replace function public.set_storefront_published(p_site_id uuid, p_publish boolean, p_confirm_name text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_site public.sites%rowtype;
  v_owner uuid;
begin
  if v_uid is null then
    raise exception 'Connexion requise.' using errcode = '42501';
  end if;
  select s.* into v_site from public.sites s where s.id = p_site_id for update;
  if not found then
    raise exception 'Boutique introuvable.' using errcode = '22023';
  end if;
  select w.owner_id into v_owner from public.workspaces w where w.id = v_site.workspace_id;
  if v_owner is distinct from v_uid then
    raise exception 'Publication réservée au propriétaire de la boutique.' using errcode = '42501';
  end if;
  if p_publish is null then
    raise exception 'Action manquante.' using errcode = '22023';
  end if;
  if btrim(coalesce(p_confirm_name, '')) <> btrim(v_site.name) then
    raise exception 'Confirmation incorrecte : saisissez exactement le nom de la boutique.' using errcode = '22023';
  end if;
  if v_site.status = 'archived' then
    raise exception 'Boutique archivée : publication impossible.' using errcode = '22023';
  end if;
  if (v_site.status = 'published') = p_publish then
    return jsonb_build_object('site_id', p_site_id, 'status', v_site.status, 'changed', false);
  end if;

  update public.sites
  set status = case when p_publish then 'published' else 'draft' end,
      published_at = case when p_publish then coalesce(published_at, now()) else published_at end
  where id = p_site_id;
  insert into public.storefront_publication_events (site_id, actor_user_id, action)
  values (p_site_id, v_uid, case when p_publish then 'publish' else 'unpublish' end);

  return jsonb_build_object('site_id', p_site_id, 'status', case when p_publish then 'published' else 'draft' end, 'changed', true);
end;
$function$;

revoke all on function public.set_storefront_published(uuid, boolean, text) from public, anon;
grant execute on function public.set_storefront_published(uuid, boolean, text) to authenticated;


-- -----------------------------------------------------------------------------
-- e) Photo d'un produit
-- -----------------------------------------------------------------------------
create or replace function public.set_product_image(p_product_id uuid, p_url text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_site uuid;
  v_url text := nullif(btrim(coalesce(p_url, '')), '');
begin
  if v_uid is null then
    raise exception 'Connexion requise.' using errcode = '42501';
  end if;
  select p.site_id into v_site from public.products p where p.id = p_product_id;
  if v_site is null then
    raise exception 'Produit introuvable.' using errcode = '22023';
  end if;
  if coalesce(private.staff_role(v_site), '') not in ('owner', 'manager') then
    raise exception 'Photo réservée au propriétaire et au gérant.' using errcode = '42501';
  end if;
  if v_url is null then
    delete from public.product_images where product_id = p_product_id;
    return jsonb_build_object('product_id', p_product_id, 'url', null);
  end if;
  if v_url !~ '^https://[^\s]+$' or char_length(v_url) > 500 then
    raise exception 'Adresse de photo invalide : https:// obligatoire, 500 caractères au plus.' using errcode = '22023';
  end if;
  insert into public.product_images (product_id, site_id, url, updated_by)
  values (p_product_id, v_site, v_url, v_uid)
  on conflict (product_id) do update set url = excluded.url, updated_at = now(), updated_by = excluded.updated_by;
  return jsonb_build_object('product_id', p_product_id, 'url', v_url);
end;
$function$;

revoke all on function public.set_product_image(uuid, text) from public, anon;
grant execute on function public.set_product_image(uuid, text) to authenticated;
