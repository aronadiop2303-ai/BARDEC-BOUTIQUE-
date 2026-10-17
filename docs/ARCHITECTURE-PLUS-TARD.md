# Notes d'architecture : sujets prévus plus tard (non codés)

Ces trois sujets ne sont **pas** développés. Ce sont des notes pour préparer les décisions.

## 1. Devis, factures, bons de livraison

**Déjà prêt** : `document_counters` et `private.next_document_number` connaissent les types `quote` (DEVIS), `invoice` (FACT), `delivery_note` (BL), `credit_note` (AVOIR, utilisé par les retours) ; `store_documents` conserve un instantané figé (`content_snapshot`) relu à l'impression.

**Proposition**
- Devis : table `quotes` (client, lignes, validité, statut brouillon / envoyé / accepté / expiré), numéro DEVIS au passage à « envoyé », instantané figé. Conversion en vente par `record_sale` (prix relus en base : le devis affiche un prix, la vente recalcule ; écart à signaler).
- Facture : document `invoice` créé depuis une vente (ou un ensemble de ventes à crédit d'un client), sans recalcul, numérotation continue sans trou. **Fiscalité** : aucune TVA calculée aujourd'hui ; une facture conforme au Sénégal exige des mentions et un traitement de la TVA à valider avec un comptable avant tout développement.
- Bon de livraison : document `delivery_note` lié à une vente ; il pourra alimenter le module livraison (rôle `driver` prévu au lot C).
- Impression : même composant que les tickets (A4).

## 2. Mode hors ligne

**Contrainte** : la vente doit rester juste (stock, numérotation sans trou, prix de la base) alors que la base est la source de vérité.

**Proposition**
- PWA (service worker) : application et catalogue en cache ; consultation hors ligne.
- Ventes hors ligne : file locale (IndexedDB) de ventes **en attente**, chacune avec une clé d'idempotence, sans numéro définitif. Ticket provisoire « EN ATTENTE DE SYNCHRONISATION ».
- À la reconnexion : `record_sale` rejoue chaque vente avec sa clé (fonction à rendre idempotente) ; le numéro TICKET définitif est attribué par la base ; les refus (stock, prix) sont présentés au gérant.
- Risques : survente si plusieurs caisses vendent hors ligne ; prix périmés ; ticket provisoire à réimprimer. À valider avant de coder.

## 3. Multi-boutiques

**Existant** : un espace (`workspaces`) contient plusieurs sites ; les rôles métier sont **par boutique** (`site_staff`, lot C). Limite connue (option 1) : l'adhésion `viewer` donne la lecture du catalogue de toutes les boutiques de l'espace.

**Proposition**
- RLS par boutique sur toutes les tables (option 2 du lot C) avant d'ouvrir plusieurs boutiques à des équipes différentes.
- Transferts de stock entre boutiques : fonction `transfer_stock` (sortie dans A, entrée dans B, même transaction, pièce de transfert numérotée).
- Catalogue partagé optionnel (modèle produit au niveau de l'espace, prix et stock par boutique).
- Rapports consolidés pour le propriétaire (somme des rapports par boutique, calculée en base).
