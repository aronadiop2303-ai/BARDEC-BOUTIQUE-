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

## Prototype Studio

Interface React + TypeScript + Vite :
- tableau de bord de démonstration ;
- **parcours guidé « Créer un site »** : domaine → sous-domaine → spécialité → nom, alimenté par le catalogue d'activités de Supabase (table `site_categories`, lecture seule). L'utilisateur peut s'arrêter à n'importe quel niveau ou partir de zéro (« Personnalisé ») ;
- les brouillons créés restent conservés uniquement dans l'état de la page.

**Limites importantes :** les 3 sites affichés au départ sont des données de démonstration. Il n'y a pas encore de compte réel, d'authentification, de sauvegarde en base, d'éditeur de pages, d'application des modèles, de publication, d'hébergement, de domaines ni d'annuaire connecté. Seule la **lecture** du catalogue d'activités est connectée à Supabase ; si les variables d'environnement manquent ou si la lecture échoue, le parcours l'indique et propose un projet personnalisé (aucune donnée de remplacement n'est inventée).

## Démarrer en local

Prérequis : Node.js LTS et npm.

```bash
npm install
cp .env.example .env.local   # puis renseigner VITE_SUPABASE_PUBLISHABLE_KEY
npm run dev
```

Sans `.env.local`, le Studio démarre mais le catalogue d'activités n'est pas connecté.

Vérifications de projet :

```bash
npm test
npm run typecheck
npm run build
```

## Architecture et sécurité

- [Vision et architecture produit](docs/PLATFORM-VISION.md)
- [Architecture technique](docs/ARCHITECTURE.md)
- [Sécurité et confidentialité](docs/SECURITY.md)
- [Feuille de route](docs/ROADMAP.md)
- [Base de données](docs/DATABASE.md)
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
