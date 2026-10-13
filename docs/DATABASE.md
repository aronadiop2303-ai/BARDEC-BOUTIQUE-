# Base de données BARDEC-BOUTIQUE

Projet Supabase : `ofuhoaznckpuqbuswoaj` (nom : BARDEC-BOUTIQUE, région eu-west-3).
Dernière vérification : 14 octobre 2026.

## Vocabulaire

- **Secteur** : domaine d'activité (Commerce, Éducation…). Ne pas confondre avec le **domaine web** (adresse DNS), qui aura sa propre table.
- **Catégorie** : un nœud de la classification, à l'un des 3 niveaux : secteur, sous-secteur, spécialité.
- **Module métier** : fonction activable par site (ex. `hardware_building`).

## Classification des activités (migration `20261013220218`)

| Table | Rôle |
|---|---|
| `site_categories` | Arbre secteur > sous-secteur > spécialité. Colonne `level` (1 à 3), `parent_id`. Un déclencheur impose `level = niveau du parent + 1`. |
| `module_catalog` | Registre des 13 modules métier. Remplace l'ancienne contrainte CHECK de `site_commerce_modules.module_key` (mêmes clés). |
| `site_templates` | Modèles de sites, rattachés à une catégorie. `is_active = false` tant que le Studio ne sait pas les appliquer. |
| `template_modules` | Modules proposés par défaut pour chaque modèle. |
| `sites.category_id`, `sites.template_id` | Colonnes optionnelles reliant un site à sa catégorie et à son modèle. |

Données de référence : 4 secteurs, 4 sous-secteurs, 4 spécialités (Commerce > Magasin > Quincaillerie, Éducation > Établissement > École privée, Immobilier > Agence > Location immobilière, Entreprises > Services > Entreprise de réparation), 13 modules, 1 modèle pilote inactif (`quincaillerie-de-quartier`).

### Sécurité

- RLS activé sur les 4 nouvelles tables.
- `anon` et `authenticated` : lecture seule des lignes actives. Aucune écriture depuis l'API ; le catalogue se modifie par migration ou avec la clé `service_role`.
- Vérifié le 14/10/2026 : lecture anonyme OK (12 catégories, 13 modules, 0 modèle actif), écriture anonyme refusée, saut de niveau refusé, doublon de slug refusé, module inconnu refusé.

### Ajouter un élément

- Nouveau module : `insert into public.module_catalog (key, name)` — aucune modification de schéma.
- Nouvelle spécialité : insérer une ligne `site_categories` avec `level = 3` et le `parent_id` d'un sous-secteur.
- Nouveau modèle : insérer dans `site_templates` puis `template_modules`.

## Points connus à traiter (non corrigés)

1. **Tables en double** : `cash_sessions` / `cash_movements` et `cash_register_sessions` / `cash_register_movements` (mêmes rôles, colonnes différentes) ; `stores` semble doublonner `sites` (RLS activé, aucune politique).
2. **Droits par défaut larges** : `anon` et `authenticated` détiennent tous les privilèges (dont `TRUNCATE`, `TRIGGER`, `REFERENCES`) sur les tables plus anciennes comme `sites`. Seules les politiques RLS protègent l'écriture, ce qui est le comportement Supabase par défaut mais mérite un durcissement.
3. **Lecture anonyme de `sites`** : la politique `published_sites_anon_select` expose toutes les colonnes des sites publiés (dont `settings` et `theme`).
4. **Performance** : 36 clés étrangères sans index (hors nouvelles tables), 7 politiques à réécrire avec `(select auth.uid())`.
5. **Migrations antérieures** : seule la migration `20261013220218` est versionnée dans ce dépôt ; les 17 précédentes restent à importer (`supabase db pull`).

## Hors périmètre de cette migration

Domaines web et DNS, versions de sites publiés, extensions, intégrations, réseaux multi-établissements, marché de modèles. Voir `docs/ROADMAP.md`.
