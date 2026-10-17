# Recommandations : 2FA, SMTP dédié, sauvegardes

**Rien n'a été modifié dans la configuration.** Je n'ai **pas** accès au tableau de bord Supabase depuis ce poste : je ne connais ni le plan actuel du projet `ofuhoaznckpuqbuswoaj`, ni ses réglages. Ce qui suit vient de ma connaissance générale de Supabase (à la date de mes informations) et doit être **vérifié dans le tableau de bord** : Organization › Billing pour le plan, Authentication › Settings pour l'Auth, Database › Backups pour les sauvegardes.

## 1. Double authentification (2FA)

| Où | Ce qui existe en général | Recommandation |
|---|---|---|
| Comptes du **tableau de bord Supabase** (vous, collaborateurs) | MFA par application (TOTP) sur le compte supabase.com, et règle d'organisation « MFA obligatoire » selon le plan | **À activer en priorité** : un accès au tableau de bord donne accès à toutes les données et à la clé service_role. |
| Comptes **GitHub et Vercel** | 2FA disponible gratuitement | À activer : ils permettent de modifier le code et le déploiement. |
| Comptes **utilisateurs de l'application** (propriétaire, gérant, vendeurs) | Supabase Auth gère le MFA par application TOTP. Le MFA par SMS dépend du plan et d'un fournisseur SMS. | À prévoir pour le propriétaire et le gérant : écran d'inscription du facteur, puis exigence `aal2` dans les fonctions sensibles (annulation, export, équipe). **Non développé** : c'est une décision et un lot à part. |

## 2. SMTP dédié

- Sans SMTP dédié, le service d'e-mails par défaut de Supabase est fortement limité (quelques messages par heure) et, à ma connaissance, réservé aux adresses des membres de l'équipe du projet. Il ne convient pas à la production.
- Ce qui marche **sans** SMTP dédié dans le code livré : invitation d'équipe par **lien à transmettre soi-même** (lot C), connexion par mot de passe des comptes existants.
- Ce qui ne marche **pas** sans SMTP dédié : e-mail d'invitation, réinitialisation de mot de passe par e-mail vers une adresse quelconque, e-mails de confirmation.
- Recommandation : un fournisseur transactionnel (Brevo, Resend, Postmark, Amazon SES…) avec un domaine vérifié (SPF, DKIM), configuré dans Authentication › SMTP. C'est une **modification de configuration** : autorisation écrite requise.

## 3. Sauvegardes

| Plan (en général) | Sauvegardes |
|---|---|
| Gratuit | Pas de sauvegarde restaurable depuis le tableau de bord à ma connaissance ; un projet inactif peut être mis en pause. |
| Pro et supérieurs | Sauvegardes quotidiennes conservées plusieurs jours ; restauration à un instant précis (PITR) en option payante. |

Recommandations, quel que soit le plan :

1. **Export de la boutique** (lot K, `Données et sécurité › Export`) : le propriétaire télécharge régulièrement le JSON complet et le range hors ligne. Ce n'est pas une sauvegarde de la base (pas de restauration automatique), mais une copie lisible des données métier.
2. **Sauvegarde logique** par un administrateur, avec la chaîne de connexion (jamais dans le dépôt) : `supabase db dump --data-only` ou `pg_dump`, sur un poste de confiance, fichiers chiffrés.
3. **Tester une restauration** sur un projet jetable avant d'en avoir besoin.
4. Avant toute migration non additive : sauvegarde, puis application.

## 4. Autres points relevés pendant ces lots

- `published_sites_anon_select` expose toutes les colonnes des sites publiés à anon (dont `settings`, `theme`) : à resserrer.
- `products_public_read` expose toutes les colonnes des produits publiés à anon : correctif préparé (`20261017180100_storefront_anon_lockdown`, autorisation requise).
- Anciennes écritures directes du catalogue encore permises au rôle `editor` par la RLS (voir `docs/TEAM-RLS-AUDIT.md`).
