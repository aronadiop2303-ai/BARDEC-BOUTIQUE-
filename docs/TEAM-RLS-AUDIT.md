# Équipe : audit des politiques RLS (lot C, option 1)

**État : préparé, non appliqué, non testé en exécution.** Les politiques réelles (`pg_policies`) n'ont **pas** pu être relues depuis ce poste : aucun accès administrateur à la base. L'audit ci-dessous s'appuie sur `docs/QUINCAILLERIE-ARCHITECTURE.md` §4 (lecture de `pg_policies` du 15/10/2026) et sur les migrations versionnées.

## Requête à exécuter en lecture seule avant d'appliquer la partie 2/2

```sql
select tablename, policyname, permissive, roles, cmd, qual, with_check
from pg_policies where schemaname = 'public' order by tablename, policyname;
```

## Principe (option 1)

- Une invitation crée une adhésion `viewer` à l'**espace** (si la personne n'en a pas) : la RLS existante lui donne la lecture des tables couvertes par `private.has_workspace_access`.
- Les droits d'**écriture** passent tous par des fonctions SECURITY DEFINER, qui contrôlent `private.staff_role` (partie 2/2).
- Les tables **sensibles** reçoivent des politiques **RESTRICTIVE** (ajoutées, aucune politique existante supprimée ni modifiée).

## Tables et effet du rôle

| Table | Lecture actuelle (membres de l'espace) | Restriction ajoutée (partie 2/2) |
|---|---|---|
| products, product_categories, product_units, product_sell_units, price_tiers, stock_locations, business_profiles | tous les membres | aucune (catalogue lisible par toute l'équipe) |
| inventory_movements | tous les membres | livreur exclu |
| store_documents | tous les membres | vendeur : seulement les documents qu'il a émis ; magasinier et livreur exclus |
| orders, order_items, payment_transactions | tous les membres | vendeur : seulement ses ventes ; magasinier et livreur exclus |
| cash_register_sessions, cash_register_movements | tous les membres | magasinier et livreur exclus |
| product_costs, product_import_runs | admin et propriétaire | propriétaire et gérant (via staff_role) |
| site_staff, team_audit_events (nouvelles) | — | soi-même ; propriétaire et gérant |

## Écarts connus, non couverts

- **Multi-boutiques** : l'adhésion `viewer` ouvre la lecture du catalogue de **toutes** les boutiques de l'espace (limite acceptée de l'option 1).
- **Écritures directes encore permises par la RLS existante** (§4) : `editor` peut écrire le catalogue (products, familles, unités, prix). Un vendeur invité reçoit `viewer` (aucune écriture) ; un ancien `editor` garde cet écart tant qu'il n'est pas resserré (migration à décider).
- `order_items.cost_price_snapshot` : colonne de coût figé, aujourd'hui jamais renseignée par `record_sale`. Si elle l'est un jour (lot H), il faudra la masquer au vendeur.
- Tables non listées ici (clients, livraisons, pages du site) : à auditer avec la requête ci-dessus.

## Diff des fonctions réécrites (partie 2/2)

Généré depuis les définitions versionnées. À comparer avec `pg_get_functiondef` avant application.

```diff
--- a/public.record_sale
+++ b/public.record_sale
@@ -70,4 +70,4 @@
 
-  v_role := private.site_role(p_site_id);
-  if v_role is null or v_role not in ('owner', 'admin', 'editor') then
+  v_role := private.staff_role(p_site_id);
+  if v_role is null or v_role not in ('owner', 'manager', 'cashier') then
     raise exception 'Vente refusée : seuls le propriétaire, un administrateur ou un vendeur peuvent encaisser.'
@@ -113,3 +113,3 @@
   v_max_discount_pct := case
-    when v_role in ('owner', 'admin') then 100
+    when v_role in ('owner', 'manager') then 100
     else least(greatest(coalesce((v_site.settings -> 'pos' ->> 'editor_max_discount_percent')::numeric, 0), 0), 100)

--- a/public.void_sale
+++ b/public.void_sale
@@ -26,4 +26,4 @@
 
-  v_role := private.site_role(v_order.site_id);
-  if v_role is null or v_role not in ('owner', 'admin') then
+  v_role := private.staff_role(v_order.site_id);
+  if v_role is null or v_role not in ('owner', 'manager') then
     raise exception 'Annulation refusée : réservée au propriétaire et aux administrateurs.' using errcode = '42501';

--- a/public.cash_session_summary
+++ b/public.cash_session_summary
@@ -17,3 +17,3 @@
   select * into v_session from public.cash_register_sessions where id = p_session_id;
-  if not found or private.site_role(v_session.site_id) is null then
+  if not found or coalesce(private.staff_role(v_session.site_id), '') not in ('owner', 'manager', 'cashier', 'viewer') then
     raise exception 'Session de caisse introuvable.' using errcode = '22023';

--- a/public.close_cash_session
+++ b/public.close_cash_session
@@ -21,4 +21,4 @@
   end if;
-  v_role := private.site_role(v_session.site_id);
-  if v_role is null or not (v_role in ('owner', 'admin') or (v_session.opened_by = v_uid and v_role in ('editor', 'publisher'))) then
+  v_role := private.staff_role(v_session.site_id);
+  if v_role is null or not (v_role in ('owner', 'manager') or (v_session.opened_by = v_uid and v_role = 'cashier')) then
     raise exception 'Clôture refusée : réservée au propriétaire, aux administrateurs et à la personne qui a ouvert la caisse.'

--- a/public.open_cash_session
+++ b/public.open_cash_session
@@ -22,4 +22,4 @@
 
-  v_role := private.site_role(p_site_id);
-  if v_role is null or v_role not in ('owner', 'admin', 'editor') then
+  v_role := private.staff_role(p_site_id);
+  if v_role is null or v_role not in ('owner', 'manager', 'cashier') then
     raise exception 'Ouverture refusée : seuls le propriétaire, un administrateur ou un vendeur ouvrent la caisse.'

--- a/public.record_stock_movement
+++ b/public.record_stock_movement
@@ -31,5 +31,5 @@
 
-  v_role := private.site_role(p_site_id);
-  if v_role is null or v_role not in ('owner', 'admin') then
-    raise exception 'Mouvement de stock refusé : réservé au propriétaire et aux administrateurs.' using errcode = '42501';
+  v_role := private.staff_role(p_site_id);
+  if v_role is null or v_role not in ('owner', 'manager', 'stock_keeper') then
+    raise exception 'Mouvement de stock refusé : réservé au propriétaire, au gérant et au magasinier.' using errcode = '42501';
   end if;

--- a/public.import_products
+++ b/public.import_products
@@ -44,5 +44,5 @@
   end if;
-  v_role := private.site_role(p_site_id);
-  if v_role is null or v_role not in ('owner', 'admin') then
-    raise exception 'Import refusé : réservé au propriétaire et aux administrateurs.' using errcode = '42501';
+  v_role := private.staff_role(p_site_id);
+  if v_role is null or v_role not in ('owner', 'manager') then
+    raise exception 'Import refusé : réservé au propriétaire et au gérant.' using errcode = '42501';
   end if;
```
