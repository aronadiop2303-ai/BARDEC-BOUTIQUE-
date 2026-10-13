# BARDEC-BOUTIQUE — Vision, architecture cible et progression

> **Document vivant.** Dernière mise à jour : **14 octobre 2026**.
> Ce fichier dit ce que BARDEC-BOUTIQUE veut devenir **et** où il en est réellement. Il doit être mis à jour à chaque jalon.
> Règle : une fonctionnalité n'est marquée « Fait » que si elle existe dans le code ou la base **et** a été vérifiée.

## Sommaire

1. [En une phrase](#1-en-une-phrase)
2. [Place dans l'écosystème BARDEC](#2-place-dans-lécosystème-bardec)
3. [Principes directeurs](#3-principes-directeurs)
4. [Architecture cible en couches](#4-architecture-cible-en-couches)
5. [La classification des activités](#5-la-classification-des-activités)
6. [Parcours utilisateur cible](#6-parcours-utilisateur-cible)
7. [Premier cas métier : la quincaillerie](#7-premier-cas-métier--la-quincaillerie)
8. [Copilote IA et intégrations](#8-copilote-ia-et-intégrations)
9. [Sécurité](#9-sécurité)
10. [Progression réelle](#10-progression-réelle)
11. [Jalons et critères d'acceptation](#11-jalons-et-critères-dacceptation)
12. [Décisions prises](#12-décisions-prises)
13. [Risques et dettes connues](#13-risques-et-dettes-connues)
14. [Ce qui est volontairement repoussé](#14-ce-qui-est-volontairement-repoussé)
15. [Règles pour les contributeurs et les assistants IA](#15-règles-pour-les-contributeurs-et-les-assistants-ia)

---

## 1. En une phrase

BARDEC-BOUTIQUE doit devenir un **moteur universel** qui permet à une personne, une entreprise, une école, une association ou un réseau de **créer, gérer et publier** ses sites et espaces numériques, à partir d'un domaine d'activité, de modèles et de modules, **sans reconstruire une application pour chaque métier**.

> Un moteur commun, plusieurs domaines métier, des modules réutilisables, des sites indépendants.

La **quincaillerie** est le premier cas approfondi. Elle ne doit jamais devenir la limite de la plateforme.

## 2. Place dans l'écosystème BARDEC

BARDEC est un écosystème numérique conçu d'abord pour le Sénégal, puis pour l'Afrique de l'Ouest.

| Élément | Rôle | Dans ce dépôt ? |
|---|---|---|
| **BARDEC-BOUTIQUE** | Création, gestion et publication de sites et d'espaces numériques | **Oui** |
| BARDEC (application principale) | Plateforme commerciale mobile | Non |
| BARDEC Core / Workspace / Projets / Fond | Services partagés, espace de travail, projets, financement | Non |
| ABFINI / OMNI | Vision d'assistance par intelligence artificielle | Non |

Règle : **ne pas mélanger** ces projets. Une connexion n'est ajoutée que si elle a une utilité démontrée, via une interface documentée (voir [INTEGRATIONS.md](INTEGRATIONS.md)).

## 3. Principes directeurs

1. **Auditer avant de construire.** Aucune table ni fonction n'est créée sans vérifier qu'elle n'existe pas déjà sous un autre nom.
2. **Une source de vérité par concept.** Pas de tables en double.
3. **Des données, pas du code figé.** Secteurs, spécialités, modèles et modules sont des lignes administrables, pas des branches codées en dur.
4. **Monolithe modulaire d'abord.** Pas de microservices tant qu'un besoin mesuré ne le justifie.
5. **Sécurité fondatrice.** Isolation entre organisations, RLS, autorisations vérifiées côté serveur.
6. **Humain dans la boucle.** L'IA propose ; elle ne publie jamais seule.
7. **Honnêteté d'état.** Ce qui est simulé est écrit comme simulé.
8. **Léger et accessible.** Utilisable sur téléphone et connexions limitées, coûts d'infrastructure maîtrisés.
9. **Changements additifs et traçables.** Migrations versionnées, jamais de modification manuelle du schéma distant.

## 4. Architecture cible en couches

| Couche | Contenu | État |
|---|---|---|
| **A. Identité et organisations** | Utilisateurs, profils, espaces de travail, membres, rôles, invitations | Schéma présent, **non connecté** |
| **B. Catalogue des domaines métier** | Classification secteur › sous-secteur › spécialité, versionnable et administrable | **Fait** (base) / partiel (Studio) |
| **C. Moteur de sites** | Sites, pages, sections, thèmes, médias, versions, aperçu, SEO | Schéma partiel (`sites`, `site_pages`), **moteur absent** |
| **D. Registre de modules** | Catalogue de modules, dépendances, activation par site | Partiel (13 modules métier) |
| **E. Studio de création** | Tableau de bord, création guidée, éditeur, médias, membres, publication | Prototype + création guidée |
| **F. Publication et hébergement** | Sous-domaines, domaines personnalisés, HTTPS, déploiements, retour arrière | **Absent** |

Le détail technique est dans [ARCHITECTURE.md](ARCHITECTURE.md) et [DATABASE.md](DATABASE.md). Tout est construit sur la pile **React 18 + TypeScript + Vite + Supabase (PostgreSQL, Auth, Storage)**, avec un déploiement envisagé sur Vercel (non vérifié).

## 5. La classification des activités

Hiérarchie souple, **à trois niveaux** dans la base actuelle :

```text
Secteur  →  Sous-secteur  →  Spécialité        (puis : modèle → modules → extensions → intégrations → sites déployés)
Commerce →  Magasin       →  Quincaillerie
Éducation → Établissement →  École privée
Immobilier → Agence       →  Location immobilière
Entreprises → Services    →  Entreprise de réparation
```

Ces exemples sont déjà en base. Une spécialité doit pouvoir exister dans plusieurs contextes (une quincaillerie peut avoir un magasin physique **et** un canal en ligne) ; la structure ne doit donc pas devenir rigide.

**Familles de secteurs à préparer** (données configurables, à ajouter progressivement) : Commerce · Éducation · Immobilier · Entreprises et services · Santé et bien-être (soumis à la réglementation) · Création et médias · Restauration et hôtellerie · Transport et logistique · Associations et communautés · Événements · Agriculture et élevage · Projets et innovation.

> Priorité : disposer du **système** pour gérer et parcourir ces secteurs. Cela ne signifie pas que les modules métier de chaque secteur existent.

## 6. Parcours utilisateur cible

| # | Étape | État |
|---|---|---|
| 1 | Choisir le type de projet | À faire |
| 2 | Choisir un domaine | **Fait** (lit le catalogue réel) |
| 3 | Choisir un sous-domaine | **Fait** |
| 4 | Choisir une spécialité | **Fait** |
| 5 | Choisir un modèle ou partir de zéro | Partiel (« Personnalisé » ; modèles non appliqués) |
| 6 | Choisir les modules | À faire |
| 7 | Nom du projet et identité visuelle | Partiel (nom seulement) |
| 8 | Configurer pages et contenu | À faire |
| 9 | Paramètres métier | À faire |
| 10 | Prévisualiser et tester | À faire |
| 11 | Valider la publication | À faire |

Le parcours doit rester **adaptatif** : qui veut un site vitrine ne configure ni panier ni stock. Domaine, spécialité, modèle et modules doivent rester modifiables plus tard, avec contrôles de compatibilité et sans perte de données métier.

## 7. Premier cas métier : la quincaillerie

Objectif : valider l'architecture sur un cas exigeant, par étapes.

| Bloc | Contenu visé | Base de données | Interface |
|---|---|---|---|
| Catalogue | Catégories, références, EAN, marque, dimensions, unités et conditionnements, prix par unité | Tables présentes | À faire |
| Stock | Quantités, seuils, mouvements, plusieurs dépôts | Tables présentes | À faire |
| Vente | Panier, commandes, calcul serveur des prix, livraison, retrait | Tables présentes | À faire |
| Devis professionnels | Demande, lignes, versions, validité, conversion en commande | Tables présentes | À faire |
| Espace professionnel | Entreprise, tarifs spécifiques, chantiers, historique | Partiel | À faire |
| Services magasin | Location, découpe, SAV | À étudier | À faire |

**Ordre** : catalogue → stock → commandes → devis. Paiements, location et fonctions réglementées viennent après, avec contrôles et tests dédiés. Un prix au carton ne doit jamais être confondu avec un prix à l'unité.

## 8. Copilote IA et intégrations

**Copilote** : comprendre le besoin, recommander secteur et spécialité, proposer des modules, générer un **brouillon** éditable, repérer des incohérences, expliquer les problèmes.
Garde-fous : actions structurées et limitées (pas d'accès SQL libre), modifications importantes présentées avant application, publication et paiements toujours validés par un humain, fournisseurs d'IA remplaçables, clés côté serveur.

**Intégrations** (paiement, livraison, e-mail, SMS, comptabilité, webhooks) : chacune déclare ses capacités, permissions, secrets et état. Les secrets restent côté serveur. Aucun bouton « Connecté » sans intégration réelle.

> Aucun de ces éléments n'est construit. Ils viennent **après** un socle fiable.

## 9. Sécurité

La plateforme est **multi-organisations** : le cloisonnement est une exigence de base.

- RLS activé sur toutes les tables exposées, avec politiques testées (pas seulement présentes).
- Rôles vérifiés côté serveur ; jamais déduits d'un rôle envoyé par le navigateur.
- Clé `service_role` jamais dans le frontend ; le navigateur n'utilise que la clé publique.
- Catalogue (secteurs, modèles, modules) en **lecture seule** pour l'API.
- Pas d'exécution de code fourni par un utilisateur dans le moteur principal.

Tests d'isolation à écrire avant tout usage réel : lecture inter-organisations refusée, action réservée au propriétaire refusée, site public sans fuite de données privées, activation de module sans contournement des permissions, `workspace_id` jamais cru sur parole, perte immédiate des droits d'un membre retiré. Détails : [SECURITY.md](SECURITY.md).

## 10. Progression réelle

### 10.1 État par domaine (14 octobre 2026)

| Domaine | État | Preuve / limite |
|---|---|---|
| Audit du dépôt et de la base | **Fait** | Rapport du 13/10/2026 |
| Prototype Studio (React/Vite/TS) | **Fait** | Typecheck et build OK ; données de démonstration |
| Schéma de base (42 tables, RLS activé partout) | **Partiel** | Créé le 11/10 ; **politiques non auditées en détail**, tables vides, aucun test d'isolation |
| Classification des activités | **Fait** (base) | 12 catégories, 13 modules ; vérifié : lecture anonyme OK, écriture refusée, contraintes OK |
| Création guidée dans le Studio | **Partiel** | 18 tests automatiques OK ; lecture réelle depuis le navigateur **à vérifier** ; brouillons non enregistrés |
| Authentification et espaces de travail | **À faire** | Tables présentes, rien de connecté |
| Sauvegarde réelle des sites | **À faire** | Dépend de l'authentification |
| Éditeur de pages, médias | **À faire** | |
| Application des modèles | **À faire** | 1 modèle pilote **inactif** |
| Publication, sous-domaines, domaines | **À faire** | Aucune table ni code |
| Annuaire « Découverte » | **À faire** | Bouton affiché, non fonctionnel |
| Modules commerce (catalogue, stock, commandes, devis) | **Schéma seulement** | Aucune interface, aucun test fonctionnel |
| Copilote IA, automatisations, intégrations | **À faire** | |
| Migrations versionnées dans Git | **Partiel** | 1 sur 18 importée (`supabase db pull` à faire) |
| Intégration continue | **Partiel** | Typecheck et build ; **tests non branchés** |

### 10.2 Journal

| Date | Étape | Résultat |
|---|---|---|
| 11/10/2026 | Création du projet Supabase et de 17 migrations (schéma commerce, supervision, documents) | Fait, hors dépôt Git |
| 13/10/2026 | Audit complet du dépôt et de la base | Prototype sans backend ; base en avance sur le code ; doublons identifiés |
| 13/10/2026 | Migration `site_classification_foundation` | Appliquée et vérifiée |
| 14/10/2026 | Parcours guidé « Créer un site » + tests | Publié, branche `feat/guided-site-creation` |
| 14/10/2026 | Ce document | — |

### 10.3 Légende

**Fait** : existe et vérifié. **Partiel** : existe mais incomplet ou partiellement vérifié. **Schéma seulement** : tables présentes, aucune fonction ni interface. **À faire** : n'existe pas.

## 11. Jalons et critères d'acceptation

| Jalon | Objectif | Critère d'acceptation | État |
|---|---|---|---|
| **M0 — Socle fiable** | Dépôt et base alignés | Les 18 migrations sont dans Git ; `npm test`, typecheck et build passent en CI ; doublons de caisse et `stores` traités ; politiques RLS relues | **En cours** |
| **M1 — Comptes et espaces** | Un utilisateur s'inscrit et possède un espace | Inscription, connexion, création d'espace réelles ; tests d'isolation entre deux espaces | À faire |
| **M2 — Sites enregistrés** | Créer et retrouver un site | Un site créé via le parcours guidé est enregistré (catégorie et modèle liés), visible seulement de ses membres | À faire |
| **M3 — Éditeur de base** | Modifier pages et thème | Pages, sections, brouillons, aperçu mobile/ordinateur, sauvegarde | À faire |
| **M4 — Publication** | Un site réellement accessible | Publication validée par un humain sur un **sous-domaine** réellement joignable ; version publiée ; retour arrière | À faire |
| **M5 — Quincaillerie pilote** | Catalogue, stock, commandes, devis | Un commerçant gère un catalogue et reçoit une commande ou un devis de bout en bout | À faire |
| **M6 — Annuaire** | Découverte avec consentement | Fiche créée **avec consentement**, retrait possible, signalement | À faire |
| **M7 — Extension** | Domaines personnalisés, autres secteurs, copilote IA | Chacun évalué séparément avant démarrage | À faire |

Un jalon n'est « terminé » que lorsque tous ses critères sont vérifiés.

## 12. Décisions prises

| Date | Décision | Raison |
|---|---|---|
| 13/10/2026 | Une seule table hiérarchique `site_categories` plutôt que trois tables | Moins de jointures et de doublons ; un niveau de plus ne demande pas de nouvelle table |
| 13/10/2026 | Transformer la contrainte figée de `site_commerce_modules.module_key` en registre `module_catalog` | Une source de vérité ; ajouter un module ne modifie plus le schéma |
| 13/10/2026 | Migrations **additives** uniquement | Aucune perte de données |
| 13/10/2026 | Catalogue en lecture seule pour l'API | Seules les migrations et le rôle serveur le modifient |
| 14/10/2026 | Aucune donnée de secours inventée si le catalogue est indisponible | Respecter « une source de vérité » ; le Studio l'indique et propose un projet personnalisé |
| 14/10/2026 | Les migrations distantes exigent désormais une autorisation explicite | Règle de la mission fondatrice |
| 14/10/2026 | Vocabulaire : « **secteur** » = domaine d'activité ; « **domaine web** » = adresse DNS | Éviter une confusion durable dans le code et les tables |

## 13. Risques et dettes connues

**Critiques**
- Les politiques RLS existent mais n'ont pas été auditées en profondeur ni testées entre organisations.
- 17 migrations sur 18 ne sont pas dans Git : le schéma ne peut pas être reconstruit à partir du dépôt.

**Importants**
- Tables en double : `cash_sessions`/`cash_movements` et `cash_register_sessions`/`cash_register_movements` ; `stores` semble doubler `sites`.
- Droits par défaut très larges pour `anon` et `authenticated` sur les anciennes tables (y compris `TRUNCATE`) ; seule RLS protège l'écriture.
- La lecture anonyme de `sites` expose toutes les colonnes des sites publiés (dont `settings`).
- Aucune intégration continue des tests ; le Studio pèse 398 ko (bibliothèque Supabase), à alléger si besoin.

**À surveiller**
- Paiements, conservation de fonds et financement : activités possiblement réglementées au Sénégal et dans l'UEMOA, à examiner séparément avant toute mise en œuvre.
- Le déploiement Vercel et la gestion automatique des domaines n'ont pas été vérifiés : ne pas les promettre avant test.

## 14. Ce qui est volontairement repoussé

Marché d'extensions et de modèles, plateforme ouverte aux développeurs, réseaux de franchises, recherche sémantique, automatisations avancées, copilote IA complet, modules métier autres que le commerce. Ils n'ont aucune valeur tant qu'un utilisateur ne peut pas créer, enregistrer et publier un site.

## 15. Règles pour les contributeurs et les assistants IA

1. Lire ce document, [ARCHITECTURE.md](ARCHITECTURE.md), [DATABASE.md](DATABASE.md) et [SECURITY.md](SECURITY.md) avant de modifier quoi que ce soit.
2. Inspecter l'existant (code **et** schéma réel) avant de créer une table ou une fonction.
3. Ne jamais désactiver RLS pour contourner une erreur.
4. Ne pas appliquer de migration distante sans autorisation explicite ; préparer d'abord le fichier SQL dans `supabase/migrations/`.
5. Aucun secret dans le dépôt : seules des variables **publiques** (`VITE_*`) vont dans le navigateur.
6. Petits changements, tests et vérifications avant fusion ; ne jamais forcer un push ni modifier `main` directement.
7. Mettre à jour la section 10 de ce document dès qu'un état change, sans cocher ce qui n'est pas vérifié.
8. Ne jamais déclarer terminée une fonction simulée ou non testée.

---

*Documents liés : [Vision produit](PLATFORM-VISION.md) · [Architecture](ARCHITECTURE.md) · [Base de données](DATABASE.md) · [Sécurité](SECURITY.md) · [Feuille de route](ROADMAP.md) · [Intégrations](INTEGRATIONS.md)*
