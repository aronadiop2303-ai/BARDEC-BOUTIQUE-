# Hébergement de la boutique en ligne (Vercel)

**Rien n'a été déployé ni configuré.** Aucune modification de la configuration de production.

## Ce qui est prêt dans le code

- Application Vite statique (`npm run build` → `dist/`). Routage par **hash** (`#/vitrine/<siteId>`) : aucune règle de réécriture n'est nécessaire, toute page sert `index.html`.
- La vitrine fonctionne **sans connexion** avec la clé publique (`VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`) et ne lit que les fonctions `storefront_*`. Aucun secret dans le navigateur (`grep service_role dist/` vide).
- Pas de `vercel.json` dans le dépôt : les réglages par défaut de Vercel pour Vite suffisent (commande `npm run build`, dossier `dist`).

## Ce qui n'est pas vérifiable d'ici

- Je n'ai pas accès au tableau de bord Vercel : je ne sais pas si le dépôt GitHub est relié à un projet Vercel, ni son nom.
- Si le dépôt est relié, **chaque branche poussée reçoit déjà un déploiement d'aperçu** automatique, à une adresse de la forme
  `https://<projet>-git-feat-public-storefront-<équipe>.vercel.app/#/vitrine/<siteId>`.
  Un aperçu n'affiche une boutique que si elle est publiée (ou au propriétaire/gérant connecté), et seulement une fois la migration appliquée.

## Avant une mise en ligne (décisions du propriétaire)

1. Appliquer `20261017180000_public_storefront` (additive), puis décider de `20261017180100_storefront_anon_lockdown`.
2. Ajouter l'adresse de production aux URL autorisées de Supabase Auth (configuration : autorisation requise).
3. Nom de domaine : non traité (table des domaines prévue plus tard).
4. Publier la boutique depuis « Boutique en ligne » (propriétaire, confirmation explicite).
