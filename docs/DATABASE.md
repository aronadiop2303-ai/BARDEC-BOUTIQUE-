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

## Ventes en caisse (migration `20261016014204_pos_sales_foundation`)

**Statut : appliquée le 16/10/2026 sur le projet réel (version `20261016014204`), sur autorisation écrite du propriétaire. Non testée en exécution : aucune vente n'a été enregistrée et le test SQL n'a jamais tourné. Vérifiée en lecture seule.**

- **Vérifié après application (lecture seule)** :
  - le SQL enregistré est identique au fichier (MD5 `bc634c63…`) ;
  - les 4 fonctions publiques sont exécutables par `authenticated`, pas par `anon` ni `public` ; `private.site_role` et `private.next_document_number` ne sont pas exécutables par `authenticated` ;
  - `order_items.line_total` est `numeric(14,2)` non générée, défaut 0, et `quantity` est `numeric(14,3)` ;
  - `orders.customer_id` et `customer_phone` sont facultatifs ;
  - `document_counters` existe, avec RLS active et `SELECT` seul pour `authenticated` ;
  - l'index `cash_register_sessions_one_open` est présent ;
  - commandes, lignes et documents : toujours 0 ligne.
- **Non vérifié** : le comportement réel de `record_sale`, `void_sale` et des rapports X et Z, la numérotation et l'impression.

- **Prérequis** : `fix_store_audit_trigger_columns`, **appliquée le 16/10/2026** (version `20261016004129`, branche `fix/store-audit-trigger`). La migration vérifie ce prérequis et s'arrête s'il manque.
- **`orders`** :
  - `customer_id` et `customer_phone` deviennent facultatifs ;
  - nouvelles colonnes : `sales_channel` (`pos`, `online`, `quote`), `cashier_id`, `cash_session_id` (obligatoire si `pos`), `amount_tendered`, `change_given`, `payment_summary` et `discount_details` (remise tracée : montant, motif, auteur, rôle, limite).
- **`order_items`** :
  - `line_total` était une colonne calculée (`quantity::numeric * unit_price`). Elle bloquait le changement de type (erreur 0A000, vérifié en lecture seule). Elle est supprimée puis recréée en colonne normale `numeric(14,2) not null default 0` (≥ 0), écrite par `record_sale` : brut moins remise de ligne. La migration s'arrête si la table n'est pas vide.
  - `quantity` devient `numeric(14,3)`, de 0 exclu à 999 999.
  - Ajouts : `unit_id`, `unit_label`, `line_discount`, `cost_price_snapshot` (toujours vide : aucun prix d'achat en base).
- **`payment_transactions`** :
  - ajout de `payment_method` (`cash`, `wave`, `orange_money`, `card`, `credit`) ;
  - fournisseurs manuels ajoutés à la contrainte : `manual_cash`, `manual_wave`, `manual_orange_money`, `manual_card`, `store_credit`.
- **`cash_register_sessions`** : une seule session ouverte par site et par caisse (index unique partiel).
- **`document_counters`** et **`private.next_document_number`** :
  - numéro continu par site, par type et par année, au format `TICKET-2026-000001` ;
  - un verrou de ligne empêche les doublons, et l'incrément est annulé avec la transaction : pas de trou.
- **Fonctions** (SECURITY DEFINER, `search_path` vide, exécution retirée à `public` et `anon`, accordée à `authenticated`) :
  - `record_sale` : propriétaire, admin ou editor.
    - Elle relit les prix (palier, sinon prix × conversion) et ignore tout prix envoyé par le client.
    - Elle contrôle le stock par emplacement (refus sauf `allow_backorder` ou `settings.pos.allow_negative_stock`).
    - Remise : 100 % pour propriétaire et admin ; `settings.pos.editor_max_discount_percent` pour un editor (0 par défaut), avec motif obligatoire.
    - Elle écrit commande, lignes, sorties de stock, paiements manuels, mouvement de caisse (espèces nettes) et reçu avec instantané complet, dans une seule transaction.
  - `void_sale` : propriétaire ou admin, motif obligatoire.
    - Elle crée les mouvements de stock inverses, marque les paiements remboursés ou annulés et la commande `cancelled`, et marque le document `void` sans jamais le supprimer.
    - Le remboursement en espèces n'est inscrit que si la session d'origine est encore ouverte.
  - `cash_session_summary` (X) : réservée aux membres.
  - `close_cash_session` (Z) : propriétaire, admin ou personne qui a ouvert la caisse. Elle calcule l'attendu et l'écart. Les `correction` sont exclues et rapportées à part.
- **Test** `supabase/tests/pos_sales_foundation.test.sql` (ROLLBACK, « NE JAMAIS EXÉCUTER SUR LE PROJET RÉEL ») : **jamais exécuté**.
- **Non traité** :
  - TVA : aucun calcul ;
  - avoirs et factures numérotées : Q5 ;
  - crédit client avec solde et plafond : Q4 ;
  - coût et marge : Q2.
  - La RLS actuelle permet encore à un membre (publisher compris) d'insérer des `cash_register_movements` et à la personne qui a ouvert la caisse de modifier sa session directement. Le correctif est préparé séparément (section suivante).

## Verrouillage de la caisse (migration `20261016011818_pos_cash_lockdown`)

**Statut : préparée, NON TESTÉE, NON APPLIQUÉE.** Elle exige `pos_sales_foundation` et s'arrête sinon.

- **Suppression** de `cash_movements_member_insert`, `cash_sessions_member_insert` et `cash_sessions_owner_or_opener_update`. Les politiques de lecture sont conservées et la RLS reste active.
- **Retrait** de INSERT, UPDATE et DELETE sur `cash_register_movements` et `cash_register_sessions` à `anon` et `authenticated`.
- **Nouvelle fonction** `public.open_cash_session(site, fond, nom, note)` : propriétaire, admin ou editor ; fond arrondi et positif ; une seule session ouverte par caisse.
- **Écritures restantes**, toutes par fonctions : `record_sale`, `void_sale`, `close_cash_session`. Plus aucun mouvement manuel (dépense, apport, retrait) n'est possible tant qu'aucune fonction dédiée n'existe.
- **Interface** : elle appelle `open_cash_session` et, tant que la fonction n'existe pas, revient à l'insertion directe encore permise.
- **Test** `supabase/tests/pos_cash_lockdown.test.sql` : jamais exécuté.

## Points connus à traiter (non corrigés)

1. **Tables en double** : `cash_sessions` / `cash_movements` et `cash_register_sessions` / `cash_register_movements` (mêmes rôles, colonnes différentes) ; `stores` semble doublonner `sites` (RLS activé, aucune politique).
2. **Droits par défaut larges** : `anon` et `authenticated` détiennent tous les privilèges (dont `TRUNCATE`, `TRIGGER`, `REFERENCES`) sur les tables plus anciennes comme `sites`. Seules les politiques RLS protègent l'écriture, ce qui est le comportement Supabase par défaut mais mérite un durcissement. Correctif préparé (voir ci-dessus), non appliqué.
3. **Lecture anonyme de `sites`** : la politique `published_sites_anon_select` expose toutes les colonnes des sites publiés (dont `settings` et `theme`).
4. **Performance** : 36 clés étrangères sans index (hors nouvelles tables), 7 politiques à réécrire avec `(select auth.uid())`.
5. **Migrations antérieures** : les 18 migrations sont importées sur la branche `chore/import-supabase-migrations`, pas encore fusionnée.

## Hors périmètre de cette migration

Domaines web et DNS, versions de sites publiés, extensions, intégrations, réseaux multi-établissements, marché de modèles. Voir `docs/ROADMAP.md`.
