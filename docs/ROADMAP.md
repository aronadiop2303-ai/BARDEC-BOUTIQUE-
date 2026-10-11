# Feuille de route

## Phase 0 — Inspection et cadrage
- [ ] Inspecter dépôt, branches, fichiers, workflows, variables et dépendances existantes.
- [ ] Confirmer framework, version Node, gestionnaire de paquets, conventions et commandes de test.
- [ ] Cartographier les projets Supabase/Vercel autorisés ; lire le schéma et les politiques sans modification.
- [ ] Établir la frontière entre BARDEC-BOUTIQUE et BARDEC principal.
- [ ] Rédiger les contrats d’intégration et critères d’acceptation.

**Livrable :** rapport d’état réel et plan de travail approuvé.

## Phase 1 — Socle MVP
- [ ] Navigation responsive et identité visuelle cohérente avec BARDEC.
- [ ] Catalogue public, catégories, recherche, fiche produit et boutiques.
- [ ] Authentification et profils minimaux.
- [ ] Espace vendeur : boutique, produits, images, prix et stock.
- [ ] Politiques d’accès et tests RLS.
- [ ] CI avec lint, typecheck et tests.

**Critère de sortie :** visiteur peut découvrir le catalogue ; vendeur autorisé peut gérer uniquement sa boutique ; accès non autorisés bloqués.

## Phase 2 — Commande
- [ ] Panier et calcul des totaux côté serveur.
- [ ] Réservation de stock transactionnelle.
- [ ] Commandes et historique par utilisateur.
- [ ] Notifications d’état sans exposer de données sensibles.
- [ ] Tests de concurrence et de double soumission.

**Critère de sortie :** les totaux et états sont cohérents même lors de requêtes répétées ou simultanées.

## Phase 3 — Paiement et livraison
- [ ] Choisir un prestataire après vérification disponibilité, frais, conformité et contrat.
- [ ] Adapter l’intégration via interface fournisseur.
- [ ] Webhooks signés, idempotence et rapprochement.
- [ ] Suivi livraison/retrait et preuve de remise à accès restreint.
- [ ] Annulation, retour, remboursement et litiges avec règles explicites.

**Critère de sortie :** aucun statut financier n’est accepté sur simple signal du client.

## Phase 4 — Pilote contrôlé
- [ ] Tests fonctionnels, sécurité, accessibilité, performance et réseau faible.
- [ ] Données et comptes de test ; procédure de support.
- [ ] Pilote limité à une zone et à des vendeurs vérifiés.
- [ ] Monitoring, sauvegardes et procédure de rollback.
- [ ] Revue des obligations légales et contractuelles.

## Phase 5 — Évolution
- [ ] PWA/mobile selon les retours réels.
- [ ] Points relais, achats groupés, promotions et multi-vendeurs selon besoin validé.
- [ ] Analytique agrégée, fidélité et recommandations avec consentement.
- [ ] Internationalisation et extension géographique progressive.

Les cases ne seront cochées qu’après vérification effective ; la présence de ce document ne signifie pas que ces fonctions sont développées.
