# BARDEC-BOUTIQUE

**Architecture fondatrice — version 1.0**

BARDEC-BOUTIQUE est le module boutique et commerce de l’écosystème BARDEC. Il permet aux clients de découvrir des produits, aux vendeurs de gérer leurs catalogues et commandes, et aux équipes habilitées de superviser les opérations. Le lancement cible d’abord le Sénégal, avec une conception extensible à l’Afrique de l’Ouest.

> Ce dépôt définit l’architecture et les règles de conception. Il ne prétend pas que les fonctionnalités sont déjà implémentées ou déployées.

## Principes non négociables
- **Périmètre isolé :** construire uniquement BARDEC-BOUTIQUE. Ne pas modifier les autres projets de l’écosystème.
- **Réutiliser avant de reconstruire :** intégrer BARDEC existant via des contrats API explicites, sans copier sa logique métier ni supposer que ses tables existent.
- **Sécurité par défaut :** contrôle serveur, moindre privilège, validation des entrées et politiques RLS lorsque Supabase est utilisé.
- **Paiements vérifiables :** un retour navigateur ne prouve jamais un paiement. Seuls les webhooks authentifiés et vérifiés font évoluer l’état financier.
- **Mobile-first et réseau instable :** interfaces légères, états de chargement/erreur clairs, reprise après coupure. Les opérations critiques restent confirmées par le serveur.
- **Traçabilité :** événements métier, journal d’audit pour les actions sensibles et identifiants de corrélation.
- **Composants remplaçables :** fournisseurs de paiement, livraison, stockage et notifications derrière des adaptateurs.

## Stack cible
- Frontend : Expo + React Native + TypeScript, avec Expo Web si adapté au dépôt.
- Backend : Supabase (PostgreSQL, Auth, Storage, Edge Functions Deno/TypeScript), sous réserve de vérification de l’environnement réel.
- Déploiement web : Vercel si le projet est configuré pour cela.
- CI : GitHub Actions, vérifications de type, lint, tests et contrôles de sécurité.
- Application mobile : EAS/Expo, dans une phase ultérieure si le web est prioritaire.

**Ne pas installer, migrer ou déployer** avant d’avoir inspecté les fichiers, les branches, les secrets, les intégrations et le schéma réellement disponibles.

## Documentation
- [Architecture fonctionnelle et technique](docs/ARCHITECTURE.md)
- [Sécurité et données](docs/SECURITY.md)
- [Feuille de route](docs/ROADMAP.md)
- [Contrats d’intégration](docs/INTEGRATIONS.md)

## Statut
Architecture initiale. Les choix techniques sont des cibles à valider contre le contenu réel du dépôt et l’environnement BARDEC autorisé.
