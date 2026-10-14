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

## Comptes, espaces et sites depuis le Studio (branche `feat/auth-and-workspaces`)

État : code et tests avec client simulé. **Non testé contre la base réelle.**

- **Profil** : aucun trigger ne le crée à l'inscription. Le Studio fait `upsert … on conflict (user_id) do nothing` à chaque connexion (politique `profile_insert_self`) ; un profil existant n'est jamais écrasé.
- **Espace** : le Studio cherche l'espace possédé (`owner_id = auth.uid()`), sinon un espace dont l'utilisateur est membre, sinon crée « Mon espace » avec un slug global `mon-espace-xxxx` (nouvel essai sur `23505`). Le propriétaire n'a **pas** de ligne dans `workspace_memberships`.
- **Pas d'INSERT … RETURNING sur `workspaces`** : la politique SELECT passe par `private.has_workspace_access`, fonction STABLE qui ne voit pas la ligne insérée dans la même instruction. Le Studio génère l'`id`, insère, puis relit (supposé d'après le fonctionnement de Postgres, à confirmer en réel).
- **Sites** : `status` toujours `'draft'`, `template_id` null, `category_id` = dernier nœud du parcours (null pour « Personnalisé »), slug unique par espace (nom puis nom + suffixe sur `23505`). Le Studio ne lit jamais `theme` ni `settings`.

## Garde de publication et droits (migration `20261014213517_core_security_hardening`)

**NON TESTÉE, NON APPLIQUÉE.** Branche `chore/core-security-hardening`, test : `supabase/tests/core_security_hardening.test.sql` (base locale jetable uniquement).

- **Garde** : déclencheur `sites_publication_guard` (BEFORE INSERT OR UPDATE) → `private.enforce_site_publication()` (SECURITY INVOKER, `search_path` vide). Passer à `published` (insertion, changement de statut ou changement d'espace d'un site publié) exige propriétaire, `admin` ou `publisher`. Erreur `42501` « Publication refusée… ».
- **`published_at`** : fixé par la base à la première publication, conservé ensuite ; un utilisateur connecté ne peut pas le modifier directement.
- **Sans utilisateur** (`auth.uid()` null) : `anon`/`authenticated` refusés pour publier ; rôles serveur (`postgres`, `service_role`) autorisés, car ils contournent déjà RLS. Une future fonction SECURITY DEFINER qui écrirait dans `sites` devra faire son propre contrôle.
- **Droits** : `TRUNCATE`, `TRIGGER`, `REFERENCES` retirés à `anon` et `authenticated` sur toutes les tables `public` ; `INSERT/UPDATE/DELETE` retirés à `anon` sur `profiles`, `workspaces`, `workspace_memberships`, `sites`, `site_pages`. Privilèges par défaut du rôle `postgres` alignés pour les tables futures (ceux de `supabase_admin` ne sont pas modifiables par migration).
- **Parcours invité conservé** : seule politique d'écriture `anon` trouvée (lecture de `pg_policies`, 14/10/2026) : `business_inquiries.inquiries_public_insert`. Son `INSERT` n'est pas touché.
- **Limites** : un éditeur peut encore modifier un site déjà publié et le dépublier ; la lecture anonyme expose toujours toutes les colonnes des sites publiés.

## Points connus à traiter (non corrigés)

1. **Tables en double** : `cash_sessions` / `cash_movements` et `cash_register_sessions` / `cash_register_movements` (mêmes rôles, colonnes différentes) ; `stores` semble doublonner `sites` (RLS activé, aucune politique).
2. **Droits par défaut larges** : `anon` et `authenticated` détiennent tous les privilèges (dont `TRUNCATE`, `TRIGGER`, `REFERENCES`) sur les tables plus anciennes comme `sites`. Seules les politiques RLS protègent l'écriture, ce qui est le comportement Supabase par défaut mais mérite un durcissement. Correctif préparé (voir ci-dessus), non appliqué.
3. **Lecture anonyme de `sites`** : la politique `published_sites_anon_select` expose toutes les colonnes des sites publiés (dont `settings` et `theme`).
4. **Performance** : 36 clés étrangères sans index (hors nouvelles tables), 7 politiques à réécrire avec `(select auth.uid())`.
5. **Migrations antérieures** : les 18 migrations sont importées sur la branche `chore/import-supabase-migrations`, pas encore fusionnée.

## Hors périmètre de cette migration

Domaines web et DNS, versions de sites publiés, extensions, intégrations, réseaux multi-établissements, marché de modèles. Voir `docs/ROADMAP.md`.
