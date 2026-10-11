# Architecture BARDEC-BOUTIQUE

## 1. Mission et limites
BARDEC-BOUTIQUE est l’espace transactionnel de commerce : catalogue, recherche, fiches produit, panier, commande, suivi, gestion vendeur et service après-vente. Il complète BARDEC et ne remplace pas la plateforme principale, BARDEC WORKSPACE, BARDEC CORE ou BARDEC FOND.

### Hors périmètre de cette première version
- Créer une nouvelle super-app ou modifier les autres dépôts.
- Détenir directement des fonds ou créer un portefeuille financier sans analyse réglementaire.
- Créer un système de crédit, d’investissement ou de titres financiers.
- Déclarer un paiement réussi à partir d’une capture d’écran ou d’un simple retour du navigateur.
- Inventer des tables, clés, endpoints ou secrets qui n’ont pas été vérifiés.

## 2. Acteurs et permissions
| Rôle | Capacités principales |
|---|---|
| Visiteur | Parcourir les produits et boutiques publiés |
| Acheteur | Panier, commande, adresses, suivi et demandes de support |
| Vendeur | Profil boutique, produits, stock, prix, préparation et suivi des commandes de sa boutique |
| Point relais (intégration éventuelle) | Réception et remise de colis assignés, preuve de remise |
| Support / Contrôleur | Examiner les incidents autorisés, litiges et traces d’audit |
| Administrateur | Configuration et modération selon permissions explicitement attribuées |

Les rôles visibles dans l’interface ne sont jamais une preuve d’autorisation. Chaque opération doit être vérifiée côté serveur, sur l’identité, la ressource et la permission.

## 3. Modules
1. **Storefront** — accueil, catégories, recherche, filtres, boutiques, fiches produits.
2. **Catalogue** — variantes, médias, prix, disponibilité et statut de publication.
3. **Inventaire** — quantité disponible, réservations temporaires et prévention des ventes au-delà du stock.
4. **Panier et checkout** — calcul serveur des prix, frais, promotions et totaux.
5. **Commandes** — machine à états, historique, annulation encadrée et notifications.
6. **Paiements** — interface fournisseur interchangeable, références externes et webhooks idempotents.
7. **Livraison / retrait** — modes de livraison configurables, suivi et preuve de remise.
8. **Espace vendeur** — produits, commandes, stocks, performances et profil de boutique.
9. **Support et litiges** — demandes, pièces justificatives avec accès restreint, résolution tracée.
10. **Administration** — modération, catégories, vendeurs, paramètres et audit.
11. **Notifications** — in-app, e-mail/SMS/WhatsApp uniquement via fournisseurs autorisés et consentements requis.
12. **Observabilité** — logs structurés sans secrets, métriques, alertes et suivi des erreurs.

## 4. Architecture logique
```text
Client Web / Mobile
        |
        v
UI + validation ergonomique (non fiable)
        |
        v
Services applicatifs / Edge Functions
        |             |
        v             v
PostgreSQL/RLS    Adaptateurs externes
                  ├─ Paiement
                  ├─ Livraison
                  └─ Notifications
        |
        v
Audit, métriques et événements métier
```

Le client ne décide jamais des prix finaux, des droits, du stock final, du statut de paiement ou du statut de livraison. Le backend est l’autorité.

## 5. Modèle de données cible
Ce modèle est une proposition à confronter au schéma existant avant toute migration.

- `profiles` : identité applicative minimale, liée à l’identifiant Auth.
- `shops` : propriétaire, nom, slug, statut, coordonnées publiques et paramètres.
- `shop_members` : membres d’une boutique et permissions.
- `categories` : catégories et hiérarchie.
- `products` : boutique, titre, description, statut, marque éventuelle.
- `product_variants` : SKU, options et prix de vente.
- `product_media` : chemins Storage et métadonnées.
- `inventory` : quantité disponible et seuil d’alerte.
- `carts`, `cart_items` : panier utilisateur et lignes.
- `orders`, `order_items` : commande, instantané de prix, quantités et adresse de livraison minimisée.
- `payments` : fournisseur, référence externe, montant, devise et statut vérifié.
- `shipments`, `delivery_events` : transporteur, suivi et preuves restreintes.
- `returns`, `support_tickets`, `disputes` : après-vente.
- `notifications` : statut de livraison des notifications.
- `audit_logs` : acteur, action, cible, date et métadonnées minimisées.

Montants en unités monétaires entières (par exemple XOF), jamais en nombres flottants. Enregistrer la devise explicitement. Les prix de commande sont des instantanés immuables ; les modifications du catalogue ne réécrivent pas l’historique.

## 6. Cycle de vie des commandes
États de départ possibles : `draft` → `pending_payment` → `paid` → `confirmed` → `preparing` → `ready_for_dispatch` → `shipped` → `delivered`.

États alternatifs encadrés : `payment_failed`, `cancelled`, `return_requested`, `returned`, `refund_pending`, `refunded`, `disputed`.

Toutes les transitions doivent être validées côté serveur, autorisées selon le rôle et la transition précédente, enregistrées et idempotentes. Les remboursements ne doivent jamais être déduits du seul état du frontend.

## 7. API / contrats
Organiser les opérations autour de cas d’usage : catalogue public, panier, checkout, commandes de l’acheteur, commandes du vendeur, webhook paiement, expédition et support. Chaque endpoint doit définir schéma d’entrée/sortie, authentification, autorisation, limites de débit, codes d’erreur et idempotence.

Les intégrations avec BARDEC existant doivent passer par des contrats documentés et versionnés. Ne pas importer directement les tables internes d’un autre projet sans autorisation et revue.

## 8. Recherche et performance
Démarrer avec les index PostgreSQL adaptés aux catégories, statuts, slugs, boutique et dates de commande. Ajouter la recherche plein texte avant d’introduire un moteur externe. Paginer côté serveur, limiter les images et éviter les requêtes N+1.

## 9. Internationalisation et contexte local
- Première devise envisagée : XOF, à confirmer au niveau commercial.
- Français d’abord ; prévoir les chaînes traduisibles et l’ajout ultérieur du wolof et d’autres langues.
- Configurer zones de livraison, frais, disponibilité des paiements et règles fiscales selon les partenaires et la réglementation applicable.
- Ne jamais présumer qu’un prestataire de paiement ou de livraison est disponible sans validation contractuelle.
