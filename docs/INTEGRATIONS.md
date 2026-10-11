# Contrats d’intégration

## Règle de base
BARDEC-BOUTIQUE doit rester autonome dans son déploiement et pouvoir remplacer ses fournisseurs. Une intégration n’est active que lorsque son endpoint, son propriétaire, ses autorisations, son contrat et son environnement ont été vérifiés.

## BARDEC principal
- Usage : lien de navigation, découverte de produits ou échanges de données explicitement autorisés.
- Échange : API versionnée ou événements documentés, jamais une dépendance cachée à des tables internes.
- Identité : ne pas supposer que les sessions ou JWT sont interchangeables ; documenter le mécanisme retenu.
- Échec : prévoir timeout, reprise bornée et message utilisateur clair.

## Paiement
Définir un adaptateur interne avec opérations de création de paiement, vérification de statut, réception d’événement et remboursement si autorisé. Les secrets sont côté serveur uniquement. Le fournisseur doit confirmer par écrit les conditions de service et la disponibilité locale.

## Livraison
Définir création d’expédition, estimation, suivi, annulation et preuve de remise. Les statuts du transporteur sont des entrées externes à valider ; garder un historique de leurs transitions.

## Notifications
Chaque canal doit être facultatif, remplaçable et soumis aux consentements et règles applicables. Une panne de notification ne doit pas annuler une commande déjà enregistrée.

## Observabilité
Utiliser un identifiant de corrélation par opération ; journaliser le résultat et le fournisseur sans inclure de secrets, tokens, données de carte ou contenu personnel superflu.

## Checklist d’activation d’un fournisseur
- [ ] Responsable et contrat identifiés.
- [ ] Disponibilité territoriale, frais, limites et conformité vérifiés.
- [ ] Secrets stockés dans le gestionnaire approprié.
- [ ] Webhooks authentifiés et idempotents.
- [ ] Environnement sandbox testé.
- [ ] Timeouts, reprises, alertes et procédure de désactivation testés.
