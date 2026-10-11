# Architecture de la plateforme BARDEC-BOUTIQUE

## 1. Mission
BARDEC-BOUTIQUE est une plateforme multi-sites permettant de créer, personnaliser, publier et découvrir des sites web adaptés à différents métiers. Ce n'est pas uniquement une boutique en ligne.

Le produit comprend trois surfaces complémentaires :
- **Studio** : espace authentifié pour créer et gérer plusieurs sites.
- **Sites publiés** : sites publics ou non répertoriés, isolés les uns des autres.
- **BARDEC Découverte** : annuaire facultatif des sites dont le propriétaire a explicitement autorisé la visibilité publique.

Le code de cette branche est une fondation initiale. Une fonctionnalité documentée n'est pas considérée comme implémentée tant qu'elle n'existe pas dans le code et n'a pas été vérifiée.

## 2. Principes d'architecture
- **Multi-tenant par conception** : chaque site possède un identifiant stable et des données séparées.
- **Séparation des responsabilités** : contenu, thème, modules métier, publication et annuaire restent distincts.
- **Modules remplaçables** : paiements, e-mails, stockage, hébergement et domaines sont intégrés derrière des contrats documentés.
- **Sécurité côté serveur** : l'interface ne constitue jamais une frontière d'autorisation.
- **Progressivité** : commencer par les sites vitrines et les formulaires avant les paiements, les données scolaires ou les modules complexes.
- **Portabilité** : éviter de lier le modèle métier à un seul fournisseur d'hébergement.
- **Consentement** : un site n'est pas ajouté automatiquement à l'annuaire public.

## 3. Surfaces fonctionnelles
### Studio
- Tableau de bord et gestion des sites.
- Création depuis un modèle.
- Pages, navigation, blocs, logo, couleurs et contenus.
- Aperçu avant publication.
- Publication et gestion de versions.
- Gestion des membres et permissions à ajouter après la première tranche.

### Site publié
- Rendu à partir d'une configuration validée.
- Identité visuelle, pages et navigation propres au site.
- Formulaires et médias selon les autorisations configurées.
- Visibilité publique, non répertoriée ou privée selon les capacités effectivement implémentées.

### BARDEC Découverte
- Indexer uniquement les sites explicitement publics.
- Recherche par nom, catégorie et services déclarés.
- Permettre au propriétaire de retirer sa fiche.
- Prévoir signalement et modération avant une ouverture publique à grande échelle.

## 4. Modèle conceptuel initial
- **Workspace** : espace de travail d'un utilisateur ou d'une organisation.
- **Site** : site géré dans un workspace.
- **SiteVersion** : instantané versionné de la configuration publiée.
- **Page** : page appartenant à un site.
- **Block** : élément de contenu autorisé dans une page.
- **Theme** : couleurs, typographie, logo et règles visuelles.
- **Domain** : domaine ou sous-domaine lié à un site après vérification.
- **DirectoryListing** : fiche de découverte publique créée avec consentement.
- **Membership / Permission** : appartenance à un workspace et droits associés.

Ce modèle est conceptuel : aucune table ou migration de base de données n'est réputée exister tant qu'elle n'a pas été créée et vérifiée.

## 5. Architecture logique cible
```text
Navigateur
   |
   +--> Studio (authentification, édition, aperçu)
   |
   +--> Rendu des sites publiés
   |
   +--> BARDEC Découverte
             |
             v
       API / services serveur
             |
      +------+-------+---------+
      |              |         |
  PostgreSQL      Stockage   Adaptateurs
  + RLS si        médias     domaines/e-mail
  backend choisi              /hébergement
```

Le choix final du framework, de l'hébergement et du backend doit être confirmé après vérification des comptes et environnements autorisés. Ne pas connecter un projet Supabase existant ni lancer de migration sans inspection et autorisation explicites.

## 6. Sécurité et exploitation
- Authentifier côté serveur toutes les actions privées.
- Vérifier l'appartenance et les permissions pour chaque site et chaque workspace.
- Ne jamais exposer de secret serveur dans le navigateur.
- Valider et assainir les contenus, URLs, médias et formulaires.
- Limiter la taille et le type des fichiers téléversés.
- Journaliser les actions sensibles sans secrets ni données personnelles superflues.
- Tester les accès inter-sites et les permissions avant le déploiement.
- Vérifier la propriété d'un domaine avant son association et son activation HTTPS.
- Prévoir sauvegardes et restauration avant d'héberger des données importantes.

## 7. Ordre de livraison
1. Socle du Studio et démonstration locale sans dépendance à un backend existant.
2. Modèle de données, authentification et isolation après choix du backend.
3. Création de sites, éditeur de blocs et aperçu.
4. Publication sur sous-domaine géré.
5. Annuaire avec consentement, signalement et retrait.
6. Domaines personnalisés, sauvegardes et modules métier.
7. IA d'assistance et catalogue d'extensions après sécurisation du socle.

## 8. Hors périmètre initial
- Remplacer BARDEC ou fusionner ses autres applications.
- Gérer directement des fonds ou créer un portefeuille financier.
- Activer automatiquement des paiements ou modules réglementés.
- Publier des sites générés par IA sans validation du propriétaire.
- Affirmer qu'un site, domaine, paiement ou déploiement est opérationnel sans vérification.
