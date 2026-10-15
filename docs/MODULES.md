# Registre des modules

Source de vérité : `src/domain/modules/` (`types.ts`, `catalog.ts`, `registry.ts`, `permissions.ts`, `tables.ts`), testé par `modules.test.ts`.
Dernière mise à jour : 16/10/2026.

## 1. Ce que le registre est, et n'est pas

- Le registre décrit les **modules fonctionnels** : leurs dépendances, leurs tables, leurs permissions et leur navigation. C'est du code typé et des fonctions pures, testées. Il n'écrit rien en base.
- La table `module_catalog` en base recense autre chose : les **secteurs commerce** (`hardware_building`, `general_retail`… 13 lignes). `site_commerce_modules.module_key` y est rattachée par clé étrangère.
- Un module sectoriel du registre pointe vers son secteur par `sectorKey` : les 9 modules ERP quincaillerie pointent vers `hardware_building`.
- **Aucune migration** n'est préparée dans cette branche (voir §6).

## 2. Catégories et groupes

| Catégorie | Sens |
|---|---|
| `transversal` | Utile à tout type d'activité (contacts, trésorerie, RH…) |
| `sectoral` | Propre à un métier (ERP quincaillerie, pédagogie) |

| Groupe | Modules |
|---|---|
| `admin` | Utilisateurs & Rôles, Ressources humaines, Multi-sites, Secrétariat |
| `finance` | Trésorerie, Facturation, Dépenses & Fournisseurs |
| `crm` | Contacts, Communication, Support & SAV, Réservations |
| `vertical` | Logistique & Flotte, Pédagogique (sectoriel), Projets & Chantiers |
| `intelligence` | Copilote IA, Workflows, Analytique |
| `erp` | 9 entrées ERP quincaillerie (§4) |

## 3. Règles de statut

1. `available` = **réellement livré** : un écran existe, il fonctionne et il est testé. Aujourd'hui : **Catalogue** et **Stocks** (partiel), et rien d'autre.
2. `soon` = prévu. Un module `soon` n'est **jamais activable** (`canActivate` le refuse) et n'apparaît pas dans le menu.
3. Une entrée de navigation peut avoir son propre statut. Les entrées `soon` d'un module livré s'affichent **inactives**, sans faux contenu.
4. Un module livré :
   - ne dépend que de modules livrés ;
   - n'utilise que des tables **vérifiées en base** (`VERIFIED_TABLES`, relevé du 16/10/2026).
5. Aucun module, livré ou non, ne dépend d'une table écartée : `stores`, `cash_sessions`, `cash_movements` (dettes connues). Les seules tables de caisse utilisées sont `cash_register_*`, et la seule table de boutique est `sites`.
6. Les clés suivent le format `^[a-z][a-z0-9_]*$`, comme `module_catalog_key_check` en base.
7. `validateCatalog()` vérifie toutes ces règles, plus l'unicité des clés, des entrées de navigation et des réglages, l'absence de cycle et de dépendance inconnue. Les tests exigent une liste d'anomalies **vide**.

Les **permissions** (`permissions.ts`) pilotent seulement l'affichage. La protection réelle reste la RLS ou une fonction SQL. La matrice rôle → permissions suit `permissionsFor` de l'espace de gestion : catalogue et réglages sont réservés à owner et admin, et un test vérifie cet accord.

## 4. ERP quincaillerie

| Clé | Module | Statut | Jalon | Dépend de |
|---|---|---|---|---|
| `hw_catalog` | Catalogue | **available** | Q1 | — |
| `hw_stock` | Stocks | **available (partiel)** | Q1 | hw_catalog |
| `hw_pos` | Ventes et caisse | soon | Q3 | hw_catalog, hw_stock |
| `hw_customers` | Clients et crédit | soon | Q4 | hw_pos, contacts |
| `hw_purchasing` | Achats | soon | Q4 | hw_stock, expenses_suppliers |
| `hw_quotes` | Devis et documents | soon | Q5 | hw_catalog, hw_customers, invoicing |
| `hw_delivery` | Livraisons | soon | Q5 | hw_pos |
| `hw_reports` | Rapports et alertes | soon | Q6 | hw_pos, analytics |
| `hw_online_store` | Vitrine en ligne | soon | Q7 | hw_catalog, hw_stock |

> Les 7 entrées autres que Catalogue et Stocks sont **déduites des jalons Q3 à Q7** (`docs/QUINCAILLERIE-ARCHITECTURE.md` §8) : **à valider**.

**Sous-barre Catalogue**

| Entrée | Statut | Précision |
|---|---|---|
| Produits | available | |
| Catégories | available | Écran « Familles » |
| Unités & Conditionnements | soon | Les conditionnements se saisissent déjà dans la fiche produit |
| Tarifs professionnels | soon | Seuls les paliers par quantité existent. Visible par owner/admin uniquement |
| Codes-barres EAN | soon | Champ libre dans la fiche produit, sans contrôle EAN ni lecture |
| Fiches techniques | soon | |
| Promotions | soon | Visible par owner/admin uniquement |
| Produits associés | soon | La table `product_compatibilities` existe, mais aucun écran |

**Limites des Stocks** :
- consultation seule, aucune écriture permise sur `inventory_movements` ;
- calcul côté client limité à 5000 mouvements ;
- ni seuils ni alertes.

## 5. Module → tables

« À créer » = absente de la base vérifiée le 16/10/2026. Les noms des tables à créer sont des **propositions**, rien n'est décidé.

| Module | Tables existantes | À créer |
|---|---|---|
| hw_catalog | products, product_categories, product_units, product_sell_units, price_tiers, product_compatibilities, business_profiles, site_commerce_modules | — |
| hw_stock | stock_locations, inventory_movements, products | — (en plus : fonction d'écriture et vue de niveau, Q2) |
| hw_pos | cash_register_sessions, cash_register_movements, orders, order_items, payment_transactions, store_documents | — (fonctions SQL de vente, Q3) |
| hw_customers | customer_addresses | customer_accounts, customer_credit_entries |
| hw_purchasing | inventory_movements | purchase_orders, purchase_order_items |
| hw_quotes | quotes, quote_items, store_documents, store_document_settings | — |
| hw_delivery | shipments, orders | — |
| hw_reports | store_alerts, store_audit_events, orders, inventory_movements | — |
| hw_online_store | sites, site_pages, carts, cart_items, orders, business_inquiries | — |
| users_roles | workspaces, workspace_memberships, profiles | — (écran d'invitation à faire) |
| hr | — | employees, employment_contracts, leave_requests |
| multi_site | workspaces, sites | — |
| secretariat | — | correspondence_log, admin_tasks |
| treasury | — | treasury_accounts, treasury_entries |
| invoicing | store_document_settings | invoices, invoice_items |
| expenses_suppliers | — | suppliers, expenses |
| contacts | — | contacts |
| communication | — | message_campaigns, message_log |
| support | business_inquiries | support_tickets |
| bookings | — | bookings, booking_resources |
| logistics_fleet | — | vehicles, delivery_routes |
| education | — | students, classes, enrollments |
| projects_worksites | — | projects, project_tasks |
| ai_copilot | — | ai_conversations |
| workflows | — | workflow_definitions, workflow_runs |
| analytics | — | — (lit les tables des autres modules) |

Une table existante n'est pas une fonction livrée : il faut vérifier, avant chaque livraison, ses politiques RLS et ses droits d'écriture (`pg_policies`).

## 6. Ce qui reste à créer ou à décider

1. **Persistance de l'activation.** Rien n'enregistre en base quels modules fonctionnels sont actifs sur un site. Deux options, **à décider** :
   - (a) une nouvelle table `site_modules (site_id, module_key, is_enabled, settings)` avec RLS owner/admin et un contrôle des dépendances par la base ;
   - (b) étendre `module_catalog` avec `category`, `status` et `depends_on`. C'est déconseillé : on mélangerait secteurs et modules fonctionnels sous une même clé étrangère.

   Tant que ce choix n'est pas fait, aucune migration n'est rédigée. L'activation côté interface reste un contrôle d'affichage.
2. **Brancher `buildNavigation` sur le menu de l'espace boutique** (`BoutiqueLayout`). Le menu actuel est encore codé en dur. À faire dans une branche séparée.
3. Les tables listées « à créer » au §5, module par module, chacune avec sa migration, son test SQL sur base locale et l'accord écrit du propriétaire.
4. Mettre à jour `VERIFIED_TABLES` après chaque migration appliquée et vérifiée.
