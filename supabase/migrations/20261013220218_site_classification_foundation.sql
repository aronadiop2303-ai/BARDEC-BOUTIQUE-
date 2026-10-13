-- BARDEC-BOUTIQUE — socle de classification des activités
-- Secteur (niveau 1) > Sous-secteur (niveau 2) > Spécialité (niveau 3), modèles, registre de modules.
--
-- Principes :
--   * Migration additive : aucune table existante n'est supprimée, aucune donnée n'est perdue.
--   * Une seule table hiérarchique (site_categories) remplace les trois tables proposées
--     (business_domains / business_subdomains / business_specialties).
--   * Le registre de modules métier remplace la contrainte CHECK figée de
--     site_commerce_modules.module_key (mêmes 13 clés, aucune valeur perdue).
--   * Le catalogue est en lecture seule pour anon/authenticated : seules les migrations
--     et le rôle service_role le modifient.
--
-- Vocabulaire : « secteur » = domaine d'activité. « domaine web » (DNS) est un autre concept,
-- qui aura sa propre table plus tard.

-- ---------------------------------------------------------------------------
-- 1. Catégories hiérarchiques (secteur > sous-secteur > spécialité)
-- ---------------------------------------------------------------------------
create table public.site_categories (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid references public.site_categories(id) on delete restrict,
  level smallint not null check (level between 1 and 3),
  slug text not null check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  name text not null check (char_length(btrim(name)) between 1 and 120),
  description text,
  default_site_type text check (default_site_type in (
    'business','store','portfolio','school','real_estate','services',
    'association','media','landing_page','other'
  )),
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint site_categories_root_level_check check ((parent_id is null) = (level = 1)),
  constraint site_categories_not_self_parent check (parent_id is distinct from id),
  constraint site_categories_parent_slug_key unique nulls not distinct (parent_id, slug)
);

create index site_categories_parent_id_idx on public.site_categories (parent_id);

-- Garantit que chaque niveau est exactement le niveau du parent + 1 (empêche aussi les cycles).
create or replace function private.check_site_category_level()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_parent_level smallint;
begin
  if new.parent_id is not null then
    select c.level into v_parent_level
    from public.site_categories c
    where c.id = new.parent_id;

    if v_parent_level is null or new.level <> v_parent_level + 1 then
      raise exception 'site_categories: le niveau % est incompatible avec le parent', new.level
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function private.check_site_category_level() from public, anon, authenticated;

create trigger site_categories_check_level
  before insert or update of parent_id, level on public.site_categories
  for each row execute function private.check_site_category_level();

create trigger set_updated_at
  before update on public.site_categories
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 2. Registre des modules métier (remplace la liste figée de site_commerce_modules)
-- ---------------------------------------------------------------------------
create table public.module_catalog (
  key text primary key check (key ~ '^[a-z][a-z0-9_]*$'),
  name text not null check (char_length(btrim(name)) between 1 and 120),
  description text,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger set_updated_at
  before update on public.module_catalog
  for each row execute function public.set_updated_at();

-- Les 13 clés existantes de site_commerce_modules_module_key_check, à l'identique.
insert into public.module_catalog (key, name, sort_order) values
  ('general_retail',         'Commerce général',                           10),
  ('hardware_building',      'Quincaillerie et matériaux de construction', 20),
  ('wholesale',              'Commerce de gros et distribution',           30),
  ('grocery_fresh',          'Alimentation et épicerie',                   40),
  ('fashion',                'Vêtements, chaussures et accessoires',       50),
  ('electronics_appliances', 'Électronique et électroménager',             60),
  ('furniture_home',         'Meubles et équipements de maison',           70),
  ('automotive_parts',       'Pièces automobiles',                         80),
  ('beauty_care',            'Beauté et hygiène',                          90),
  ('professional_equipment', 'Équipements professionnels',                100),
  ('restaurant',             'Restaurants et restauration',               110),
  ('rental',                 'Location de biens et d''équipements',       120),
  ('booking',                'Réservation de services et de rendez-vous', 130);

-- Remplacement de la contrainte CHECK par une clé étrangère (la table est vide au moment de la migration).
alter table public.site_commerce_modules
  drop constraint site_commerce_modules_module_key_check;

alter table public.site_commerce_modules
  add constraint site_commerce_modules_module_key_fkey
  foreign key (module_key) references public.module_catalog (key)
  on update cascade on delete restrict;

create index site_commerce_modules_module_key_idx on public.site_commerce_modules (module_key);

-- ---------------------------------------------------------------------------
-- 3. Modèles de sites, classés par catégorie
-- ---------------------------------------------------------------------------
create table public.site_templates (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.site_categories(id) on delete restrict,
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  name text not null check (char_length(btrim(name)) between 1 and 160),
  description text,
  site_type text not null check (site_type in (
    'business','store','portfolio','school','real_estate','services',
    'association','media','landing_page','other'
  )),
  version integer not null default 1 check (version >= 1),
  default_pages jsonb not null default '[]'::jsonb check (jsonb_typeof(default_pages) = 'array'),
  default_theme jsonb not null default '{}'::jsonb check (jsonb_typeof(default_theme) = 'object'),
  -- Un modèle reste inactif tant que le Studio ne sait pas l'appliquer.
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index site_templates_category_id_idx on public.site_templates (category_id);

create trigger set_updated_at
  before update on public.site_templates
  for each row execute function public.set_updated_at();

create table public.template_modules (
  template_id uuid not null references public.site_templates(id) on delete cascade,
  module_key text not null references public.module_catalog(key) on update cascade on delete restrict,
  is_default boolean not null default true,
  primary key (template_id, module_key)
);

create index template_modules_module_key_idx on public.template_modules (module_key);

-- ---------------------------------------------------------------------------
-- 4. Rattachement des sites existants à la classification (colonnes optionnelles)
-- ---------------------------------------------------------------------------
alter table public.sites
  add column category_id uuid references public.site_categories(id) on delete set null,
  add column template_id uuid references public.site_templates(id) on delete set null;

create index sites_category_id_idx on public.sites (category_id);
create index sites_template_id_idx on public.sites (template_id);

-- ---------------------------------------------------------------------------
-- 5. Sécurité : lecture seule du catalogue, aucune écriture depuis l'API
-- ---------------------------------------------------------------------------
alter table public.site_categories enable row level security;
alter table public.module_catalog  enable row level security;
alter table public.site_templates  enable row level security;
alter table public.template_modules enable row level security;

revoke all on table
  public.site_categories, public.module_catalog,
  public.site_templates, public.template_modules
from anon, authenticated;

grant select on table
  public.site_categories, public.module_catalog,
  public.site_templates, public.template_modules
to anon, authenticated;

create policy site_categories_public_read on public.site_categories
  for select to anon, authenticated using (is_active);

create policy module_catalog_public_read on public.module_catalog
  for select to anon, authenticated using (is_active);

create policy site_templates_public_read on public.site_templates
  for select to anon, authenticated using (is_active);

create policy template_modules_public_read on public.template_modules
  for select to anon, authenticated
  using (exists (
    select 1 from public.site_templates t
    where t.id = template_modules.template_id and t.is_active
  ));

-- ---------------------------------------------------------------------------
-- 6. Données de référence : exemples de la vision, quincaillerie comme cas pilote
-- ---------------------------------------------------------------------------
insert into public.site_categories (parent_id, level, slug, name, description, default_site_type, sort_order) values
  (null, 1, 'commerce',    'Commerce',    'Vente de produits, en magasin ou en ligne.',             'store',       10),
  (null, 1, 'education',   'Éducation',   'Écoles, centres de formation et services éducatifs.',    'school',      20),
  (null, 1, 'immobilier',  'Immobilier',  'Agences, annonces et gestion de biens.',                 'real_estate', 30),
  (null, 1, 'entreprises', 'Entreprises', 'Prestataires et entreprises de services.',               'business',    40);

insert into public.site_categories (parent_id, level, slug, name, default_site_type, sort_order)
select p.id, 2, v.slug, v.name, v.site_type, 10
from (values
  ('commerce',    'magasin',       'Magasin',       'store'),
  ('education',   'etablissement', 'Établissement', 'school'),
  ('immobilier',  'agence',        'Agence',        'real_estate'),
  ('entreprises', 'services',      'Services',      'services')
) as v(parent_slug, slug, name, site_type)
join public.site_categories p on p.slug = v.parent_slug and p.level = 1;

insert into public.site_categories (parent_id, level, slug, name, default_site_type, sort_order)
select p.id, 3, v.slug, v.name, v.site_type, 10
from (values
  ('magasin',       'quincaillerie',            'Quincaillerie',            'store'),
  ('etablissement', 'ecole-privee',             'École privée',             'school'),
  ('agence',        'location-immobiliere',     'Location immobilière',     'real_estate'),
  ('services',      'entreprise-de-reparation', 'Entreprise de réparation','services')
) as v(parent_slug, slug, name, site_type)
join public.site_categories p on p.slug = v.parent_slug and p.level = 2;

-- Modèle pilote : inactif jusqu'à ce que le Studio sache l'appliquer.
insert into public.site_templates (category_id, slug, name, description, site_type, default_pages, is_active)
select c.id, 'quincaillerie-de-quartier', 'Quincaillerie de quartier',
       'Modèle pilote : catalogue technique, demande de devis et contact.',
       'store',
       '[{"slug":"accueil","title":"Accueil"},{"slug":"catalogue","title":"Catalogue"},{"slug":"devis","title":"Demande de devis"},{"slug":"contact","title":"Contact"}]'::jsonb,
       false
from public.site_categories c
where c.slug = 'quincaillerie' and c.level = 3;

insert into public.template_modules (template_id, module_key)
select t.id, 'hardware_building'
from public.site_templates t
where t.slug = 'quincaillerie-de-quartier';

-- ---------------------------------------------------------------------------
-- 7. Documentation dans le schéma
-- ---------------------------------------------------------------------------
comment on table public.site_categories is 'Classification hiérarchique des activités : secteur > sous-secteur > spécialité. Catalogue en lecture seule via l''API.';
comment on table public.module_catalog is 'Registre des modules métier activables par site (référencé par site_commerce_modules et template_modules).';
comment on table public.site_templates is 'Modèles de sites classés par catégorie. Un modèle est inactif tant que le Studio ne sait pas l''appliquer.';
comment on table public.template_modules is 'Modules proposés par défaut pour chaque modèle.';
comment on column public.sites.category_id is 'Catégorie d''activité choisie à la création du site (optionnelle).';
comment on column public.sites.template_id is 'Modèle utilisé à la création du site (optionnel).';
