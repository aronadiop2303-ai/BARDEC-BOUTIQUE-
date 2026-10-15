# Sécurité, confidentialité et confiance

## Principes
- Zero trust : aucune donnée du client, aucun rôle local et aucun identifiant de ressource ne sont fiables par défaut.
- Autorisation côté serveur pour chaque lecture ou écriture sensible.
- Moindre privilège pour utilisateurs, fonctions, clés, collaborateurs et environnements.
- Séparer développement, staging et production ; ne pas copier les données personnelles de production dans les environnements de test.
- Ne jamais committer de secrets, tokens, clés privées, fichiers `.env` ou exports de données.

## Supabase / PostgreSQL (si confirmé)
- Activer RLS sur toutes les tables exposées au client.
- Écrire des politiques positives et testées : acheteur limité à ses propres données ; vendeur limité aux boutiques où il est membre ; accès support/admin via permissions explicites et audit.
- La clé `service_role` reste exclusivement côté serveur, jamais dans Expo, le navigateur ou une variable `EXPO_PUBLIC_*`.
- Restreindre Storage par chemin, type MIME, taille et permissions ; éviter les liens publics pour documents sensibles.
- Utiliser des migrations versionnées et relues. Inspecter le schéma et les politiques actuelles avant toute modification.

## Paiements et commandes
- Vérifier la signature du webhook, l’identité du fournisseur, le montant, la devise et la référence de commande.
- Traiter les webhooks de façon idempotente ; conserver les identifiants d’événements externes.
- Ne pas stocker les données de carte bancaire. Utiliser une page ou un SDK hébergé par un fournisseur conforme.
- Calculer le total et réserver le stock côté serveur dans une transaction cohérente.
- Journaliser les changements de statut sans enregistrer de secrets ni données de paiement sensibles.

## Données personnelles
- Collecter le minimum nécessaire et documenter finalités, durée de conservation, accès et suppression.
- Restreindre les adresses, téléphones, preuves de livraison et pièces de litige.
- Prévoir export/suppression selon les obligations applicables, sauvegardes et procédure d’incident.
- Vérifier les obligations sénégalaises de protection des données et les obligations régionales/internationales applicables avec un conseil compétent avant lancement.

## Contrôles avant déploiement
- Tests d’accès inter-utilisateurs et inter-boutiques.
- Tests RLS et Storage automatisés.
- Validation d’entrée côté serveur, protections XSS/CSRF selon l’architecture, limites de débit et anti-abus.
- Analyse des dépendances et secrets, revue des permissions GitHub/Vercel/Supabase.
- Sauvegarde vérifiée et procédure de restauration testée.
- Journaux d’audit pour changement de rôle, publication, prix, remboursement et actions d’administration.
- Aucune migration ou mise en production sans revue et approbation explicites.

## Durcissement appliqué
- `20261015231406_core_security_hardening` : **appliquée le 16/10/2026, non testée sur base locale ; vérifiée en lecture seule.**
  - Ajoute une garde de publication : le trigger `sites_publication_guard` sur `public.sites` et la fonction `private.enforce_site_publication()`.
  - Retire TRUNCATE, TRIGGER et REFERENCES à `anon` et `authenticated` : 228 droits avant, 0 après.
  - Retire à `anon` toute écriture (INSERT, UPDATE, DELETE) sur `profiles`, `workspaces`, `workspace_memberships`, `sites` et `site_pages` : 15 droits avant, 0 après.
  - `anon` garde INSERT sur `business_inquiries`.
  - Le comportement du trigger lors d'une vraie écriture n'a pas été vérifié : aucun test d'écriture n'a été fait sur la base réelle.
  - Retour arrière : bloc en tête du fichier de migration, à exécuter seulement avec l'accord écrit du propriétaire.
