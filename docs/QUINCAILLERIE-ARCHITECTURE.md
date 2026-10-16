# Quincaillerie — architecture métier et technique

> Document vivant. Dernière mise à jour : **15 octobre 2026** (jalon Q1).
> Statuts : **Fait** (code + tests automatiques), **Non testé en réel** (jamais exécuté contre la base réelle depuis le navigateur), **À faire**, **Bloqué** (impossible sans migration).
> Aucune conformité fiscale n'est revendiquée : TVA, mentions et numérotation légale des factures sont à valider avec un comptable.

## 1. Vision

Le propriétaire ouvre sa carte de site « Quincaillerie » et arrive dans un **espace de gestion** : catalogue, stock, ventes, caisse, clients, crédits, fournisseurs, devis, documents, rapports, équipe. La vitrine publique vient plus tard (Q7). Interface en français, utilisable sur téléphone. Devise par défaut : **XOF** (FCFA, sans décimale). Taxes paramétrables, jamais codées en dur.

## 2. Domaine métier

### 2.1 Familles de départ (modifiables, cochées à la configuration)

| Famille | Exemples |
|---|---|
| Gros œuvre et matériaux | ciment, fer à béton, treillis soudé, sable/gravier (m³, tonne, voyage), parpaings, briques, hourdis, fil de ligature, tôles et bacs, bois, carrelage et colle |
| Plomberie | tuyaux PVC/PEHD, raccords, robinetterie, sanitaires, chauffe-eau, réservoirs, pompes, colle PVC, téflon |
| Électricité | câbles et fils (mètre, rouleau), disjoncteurs, prises, tableaux, gaines, LED, rallonges, solaire |
| Outillage | manuel, électroportatif, mesure, échelles, brouettes, pelles, truelles |
| Quincaillerie du bâtiment | serrures, cadenas, charnières, poignées, portails, visserie (kg, boîte, pièce), équerres, chaînes |
| Peinture et finition | peintures, vernis, enduits, pinceaux, rouleaux, diluants, mastics |
| Sécurité (EPI) | casques, gants, bottes, lunettes, masques, extincteurs |
| Jardin et agriculture | arrosage, tuyaux, grillage, outils |
| Soudure et consommables | électrodes, disques à tronçonner et à meuler |
| Divers | bâches, cordes, sacs, bidons |

Attributs (non bloquants, dans `products.attributes`) : marque, référence fabricant, dimension/diamètre, longueur, matière, norme, tension/puissance, couleur, origine.

### 2.2 Unités et conversions

Unités de départ : pièce, paire, boîte, carton, paquet, sac, kg, tonne, mètre, rouleau, litre, bidon, m², m³, voyage (`product_units`, par boutique).

- **Unité de base** d'un produit : par convention, l'unité de vente dont `conversion_to_base = 1` (aucune colonne dédiée dans `products` : lacune mineure, à formaliser en Q2).
- **Unités de vente** (`product_sell_units`) : conversion vers la base, minimum de vente, pas de quantité. Ex. rouleau de 100 m vendu au mètre (base = mètre, rouleau = 100) ; carton de 12 vendu à la pièce (base = pièce, carton = 12).
- Quantités décimales limitées par `product_units.decimal_places` (0 à 3).

### 2.3 Prix

- `products.price` = prix de vente **par unité de base**.
- Paliers (`price_tiers`) par unité et quantité minimale (détail, demi-gros, gros), avec validité facultative. Palier sans unité = unité de base.
- Prix d'achat et coût moyen : **absents** (lacune a) → marge non calculable en base. Jalon Q2.
- Remises encadrées par permission : Q3 (fonction de vente).

### 2.4 Stock

Multi-emplacements (`stock_locations`), seuils, inventaire, pertes, lots, réservations, alertes. **Source de vérité : le registre `inventory_movements`** (quantités numériques). `products.inventory_quantity` (entier) n'est pas utilisé par le Studio : il ne peut pas porter 12,5 m ou 0,75 t.

### 2.5 Ventes, clients, crédit, achats, caisse, documents, rapports

Décrits dans le cahier des charges (sections 3.6 à 3.14). Caisse : uniquement `cash_register_*`.

**Ventes et caisse (Q3) : code écrit ; migration des ventes appliquée le 16/10/2026, non testée en exécution ; verrouillage de la caisse non appliqué.**

- **Migration** `supabase/migrations/20261016014204_pos_sales_foundation.sql`, **appliquée le 16/10/2026, non testée en exécution** :
  - vente comptoir sans client, quantités numériques ;
  - numérotation `TICKET-AAAA-000001` sans trou ;
  - fonctions `record_sale`, `void_sale`, `cash_session_summary` (X) et `close_cash_session` (Z).
  - Elle exige `fix_store_audit_trigger_columns`, appliquée le 16/10/2026 (version `20261016004129`).
  - `order_items.line_total` passe de colonne calculée à colonne normale (brut moins remise de ligne).
- **Verrouillage de la caisse** `20261016011818_pos_cash_lockdown.sql` (préparé, non testé, non appliqué) : plus d'écriture directe ; ouverture par `open_cash_session`.
- **Test SQL** `supabase/tests/pos_sales_foundation.test.sql` : jamais exécuté (Docker indisponible).
- **Domaine** `src/domain/pos/` : calcul de ligne, totaux, remises par rôle, monnaie à rendre, numérotation, mentions légales. Tests Vitest OK.
- **Écran** « Ventes et caisse » (`PosPage.tsx`) :
  - ouverture de caisse, rapport X et clôture Z ;
  - panier en quantités fractionnaires, paiements multiples, encaissement par `record_sale` ;
  - historique du jour, réimpression et annulation (admin).
  - Tout est désactivé, avec un message, tant que la migration est absente.
- **Impression** (`Receipt.tsx`) : ticket 80 mm (72 mm imprimables, police à chasse fixe) et reçu A4, depuis `content_snapshot` seulement.
- **Paiements** : Wave, Orange Money et carte sont des enregistrements **manuels**. Aucun paiement réel n'est exécuté.
- **Taxes** : aucune TVA calculée (`tax_total = 0`). Aucune conformité fiscale n'est revendiquée.

Clients, crédit, achats, documents A4 numérotés (factures, avoirs) et rapports restent **À faire** (Q4 à Q6).

## 3. Lacunes vérifiées (lecture du schéma réel, 14–15/10/2026)

| # | Lacune | Effet | Jalon |
|---|---|---|---|
| a | Pas de prix d'achat ni de coût moyen | Aucune marge | Q2 : non traité. Une colonne `products.cost_price` serait lisible par `anon` (politique `products_public_read`) ; table séparée proposée |
| b | Pas de clients, plafond, solde, paiement partiel | Pas de crédit client | Q4 |
| c | Pas de fournisseurs, bons de commande, réceptions | Pas d'achats | Q4 |
| d | `orders.customer_id` et `customer_phone` obligatoires ; pas de canal ni de vendeur | Vente comptoir anonyme impossible | Q3 : traité par `pos_sales_foundation` (non appliquée) |
| e | Pas de vue ni de fonction « niveau de stock » ; `inventory_movements` en lecture seule pour les clients | Stock consultable (agrégé par le Studio) ; saisie par `record_stock_movement`, **préparée, non appliquée** | Q2 : fonction préparée ; vue de niveau à faire |
| f | Pas de numérotation sans trou, pas de retours, pas de dépenses catégorisées | Documents et avoirs impossibles | Q3 : numérotation et annulation préparées (non appliquées) ; avoirs et dépenses : Q5 |
| g | Rôles : ni caissier, ni vendeur, ni magasinier, ni gérant | Matrice réduite aux 4 rôles | Q6 |
| h | Pas de colonne « unité de base » sur `products` | Convention `conversion_to_base = 1` | Q2 |
| i | `stock_locations` sans unicité du nom | L'assistant vérifie avant d'insérer (course possible entre deux onglets) | Q2 |

## 4. Écritures permises aujourd'hui (pg_policies, 15/10/2026)

| Table | Écriture | Rôles autorisés (le propriétaire passe toujours) |
|---|---|---|
| business_profiles | Permise | insert/update : admin, editor ; delete : admin |
| stock_locations | Permise | admin, editor |
| product_categories | Permise | insert/update : admin, editor ; delete : admin |
| product_units, product_sell_units, price_tiers | Permise | admin, editor |
| products | Permise | insert : admin, editor ; update : admin, editor, publisher ; delete : admin |
| product_compatibilities, product_service_profiles | Permise | admin, editor |
| site_commerce_modules, store_document_settings | Permise | admin seulement |
| inventory_movements | **Bloquée** | lecture seule pour tous les membres |

## 5. Matrice de permissions

| Action | Propriétaire | admin (gérant) | editor (vendeur) | publisher | viewer |
|---|---|---|---|---|---|
| Ouvrir l'espace de gestion | ✓ | ✓ | ✓ | ✓ | ✓ (lecture) |
| Configurer la boutique (assistant, modules, documents) | ✓ | ✓ | — | — | — |
| Modifier le catalogue (produits, familles, unités, prix) | ✓ | ✓ | **cible : lecture** | — | — |
| Archiver un produit | ✓ | ✓ | — | — | — |
| Saisir du stock (entrée, inventaire initial, ajustement, perte) | ✓ | ✓ | — | — | — |
| Ventes, clients | Q3/Q4 | Q3/Q4 | Q3/Q4 | — | — |
| Supprimer la boutique | ✓ | — | — | — | — |

**Écart connu :** la RLS actuelle permet encore à `editor` d'écrire le catalogue (produits, familles, unités, prix, compatibilités) et à `publisher` de modifier un produit. Le Studio masque ces actions (cible), mais **la base ne l'interdit pas encore** : une migration de resserrement est à décider (proposée en Q6, ou plus tôt sur décision du propriétaire).

## 6. Flux cibles

```text
VENTE COMPTOIR (Q3)
caisse ouverte ─► panier (unités, paliers recalculés par la base)
               ─► finaliser_vente(id_idempotence)   [1 transaction SQL]
                    ├─ commande + lignes (totaux recalculés)
                    ├─ inventory_movements « sale » (par emplacement)
                    ├─ paiements (multiples, partiels)
                    ├─ cash_register_movements
                    ├─ numéro de document (séquence sans trou par boutique et type)
                    └─ store_audit_events

STOCK (Q2)
réception / inventaire / perte ─► fonction d'écriture ─► inventory_movements
niveau = Σ quantity_delta par (produit, emplacement)  ─► alertes (seuil, rupture, dormant)

CRÉDIT CLIENT (Q4)
vente à crédit ─► écriture « débit » au registre client
remboursement  ─► écriture « crédit » (jamais de solde modifié à la main)
solde = Σ écritures ; plafond vérifié par la base
```

## 7. Architecture technique

- **Routage par hash** (`#/boutique/<siteId>/<section>`) : aucune nouvelle dépendance, fonctionne sur tout hébergement statique sans règle de réécriture.
- `src/domain/hardware/` : logique pure testée (conversions, paliers, marge, XOF, statut de stock, agrégation du registre).
- `src/lib/store/` : accès aux données, un module par ressource, client Supabase injecté, erreurs en français.
- `src/features/boutique/` : écrans de l'espace de gestion.
- Garde d'accès : site lisible **et** espace lisible (propriétaire ou membre) ; une boutique publiée lisible par tous ne donne pas accès à la gestion.
- Écritures du catalogue : requêtes directes protégées par RLS. Écritures sensibles (stock, ventes, documents, crédit) : fonctions SQL à partir de Q2.

## 8. État des jalons

| Jalon | Contenu | État |
|---|---|---|
| **Q1** | Espace de gestion, configuration, catalogue, consultation du stock | **Code fait, tests automatiques OK, non testé en réel** |
| Q2 | Stock complet + prix d'achat/coût | **Saisie du stock : code et tests Vitest faits ; migration `stock_entries_foundation` préparée, non testée, non appliquée.** Coût d'achat, seuils et vue de niveau : à faire |
| Q3 | Caisse et ventes comptoir | **Code et tests Vitest faits ; `pos_sales_foundation` appliquée le 16/10/2026, non testée en exécution ; `pos_cash_lockdown` préparée, non appliquée** |
| Q4 | Clients, crédit, fournisseurs, achats | À faire (migration requise) |
| Q5 | Devis, factures, bons de livraison, avoirs | À faire |
| Q6 | Rapports, alertes, rôles fins, audit | À faire |
| Q7 | Vitrine publique | À faire (après la migration de sécurité) |
