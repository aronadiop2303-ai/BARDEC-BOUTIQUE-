# BARDEC-BOUTIQUE

**La plateforme pour créer, personnaliser, publier, héberger et découvrir des sites web personnalisés.**

BARDEC-BOUTIQUE est un constructeur multi-sites destiné aux particuliers, commerçants, écoles, entreprises, associations, professionnels de l'immobilier, prestataires de services, créateurs et porteurs de projets.

## Vision

Une infrastructure commune permet à chacun de créer un site adapté à son activité, de le personnaliser, de le préparer à la publication puis, s'il le souhaite, de le rendre visible dans un annuaire public.

Exemples : site vitrine, boutique, site d'école, immobilier, services, portfolio, média, association ou projet personnalisé.

## Expérience produit

1. **Créer** — choisir un type de site et un modèle.
2. **Personnaliser** — identité visuelle, pages, navigation, blocs et contenus.
3. **Prévisualiser** — vérifier le rendu avant toute publication.
4. **Publier** — d'abord sur un sous-domaine contrôlé, puis sur un domaine personnalisé après vérification technique.
5. **Découvrir** — permettre au propriétaire de choisir si sa fiche doit apparaître dans l'annuaire BARDEC Découverte.

## Prototype Studio — branche `feat/studio-mvp-foundation`

Cette branche pose une première interface React + TypeScript + Vite :
- tableau de bord de démonstration ;
- exemples de sites et recherche locale ;
- fenêtre de création avec choix de modèles ;
- création de brouillons conservée uniquement dans l'état de la page.

**Limites importantes :** l'interface est un prototype local. Elle n'inclut pas encore de compte réel, de base de données, de sauvegarde persistante, d'éditeur de pages, de publication, d'hébergement de sites, de domaines, ni d'annuaire connecté. Les sites et compteurs affichés sont des données de démonstration. Aucun backend ni projet externe n'est connecté.

## Démarrer en local

Prérequis : Node.js LTS et npm.

```bash
npm install
npm run dev
```

Vérifications de projet :

```bash
npm run typecheck
npm run build
```

## Architecture et sécurité

- [Vision et architecture produit](docs/PLATFORM-VISION.md)
- [Architecture technique](docs/ARCHITECTURE.md)
- [Sécurité et confidentialité](docs/SECURITY.md)
- [Feuille de route](docs/ROADMAP.md)
- [Contrats d'intégration](docs/INTEGRATIONS.md)

## Principes fondateurs

- Isolation stricte des données, utilisateurs, médias et permissions de chaque site.
- Les autorisations sont vérifiées côté serveur, jamais uniquement dans l'interface.
- Les domaines personnalisés exigent une vérification de propriété et une configuration HTTPS.
- L'annuaire n'inclut que les sites dont le propriétaire a choisi la visibilité publique.
- Les modules métier sont indépendants et remplaçables.
- Les paiements et fonctions réglementées ne seront pas activés sans validation technique et conformité adaptée.

## Statut

Le cadrage produit et un prototype d'interface sont présents dans cette branche. Le constructeur fonctionnel, le backend, l'éditeur, la publication et l'hébergement restent à implémenter et à tester. Ne pas cocher une fonctionnalité dans la feuille de route avant sa vérification réelle.
