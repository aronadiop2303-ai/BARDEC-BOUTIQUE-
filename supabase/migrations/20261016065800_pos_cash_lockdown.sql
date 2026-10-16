-- =============================================================================
-- Caisse : plus aucune écriture directe, tout passe par des fonctions SQL contrôlées
-- =============================================================================
-- STATUT : APPLIQUÉE le 16/10/2026 sur le projet réel (version 20261016065800), sur autorisation écrite du
-- propriétaire ; non testée en exécution (open_cash_session jamais appelée, test SQL jamais exécuté).
-- Vérifiée en lecture seule. Le SQL appliqué est celui de ce fichier avant la mise à jour de ces lignes
-- d'en-tête (empreinte MD5 identique, fins de ligne LF).
--
-- PRÉREQUIS : pos_sales_foundation appliquée (private.site_role, close_cash_session, index d'unicité
-- cash_register_sessions_one_open). Le bloc 0 le vérifie et s'arrête sinon.
--
-- PROBLÈME (pg_policies, lecture seule, 16/10/2026)
--   - cash_movements_member_insert : tout membre admin, editor ou publisher (et le propriétaire) peut insérer
--     directement n'importe quel mouvement de caisse (espèces entrées, sorties, corrections), sans vente.
--   - cash_sessions_owner_or_opener_update : la personne qui a ouvert la caisse (ou un admin) peut modifier
--     directement sa session : montant d'ouverture, espèces attendues ou comptées, écart, statut.
--   - cash_sessions_member_insert : ouverture directe, y compris par un publisher.
--
-- CORRECTIF
--   - Suppression de ces trois politiques. Les politiques de LECTURE sont conservées. La RLS reste active.
--   - Retrait des droits INSERT, UPDATE, DELETE sur les deux tables à anon et authenticated (seconde barrière).
--   - Ouverture de caisse par public.open_cash_session : propriétaire, admin ou editor (les mêmes rôles que
--     record_sale) ; fond de caisse positif, arrondi à la devise ; une seule session ouverte par caisse.
--   - Écritures restantes, toutes par fonctions SECURITY DEFINER : record_sale (vente en espèces),
--     void_sale (remboursement), close_cash_session (clôture Z).
--   - Conséquence : plus aucun mouvement manuel (dépense, apport, retrait) n'est possible tant qu'aucune
--     fonction dédiée n'existe. C'est voulu : à concevoir avec validation et motif.
--
-- RETOUR ARRIÈRE (une seule transaction) : recrée les politiques à l'identique de leur définition du 16/10/2026.
--   drop function if exists public.open_cash_session(uuid, numeric, text, text);
--   grant insert, update, delete on public.cash_register_movements, public.cash_register_sessions to authenticated;
--   create policy cash_movements_member_insert on public.cash_register_movements for insert to authenticated
--     with check ((actor_user_id = auth.uid()) and (exists (select 1 from public.sites s
--       where s.id = cash_register_movements.site_id
--         and private.has_workspace_access(s.workspace_id, array['admin'::text, 'editor'::text, 'publisher'::text]))));
--   create policy cash_sessions_member_insert on public.cash_register_sessions for insert to authenticated
--     with check ((opened_by = auth.uid()) and (exists (select 1 from public.sites s
--       where s.id = cash_register_sessions.site_id
--         and private.has_workspace_access(s.workspace_id, array['admin'::text, 'editor'::text, 'publisher'::text]))));
--   create policy cash_sessions_owner_or_opener_update on public.cash_register_sessions for update to authenticated
--     using ((opened_by = auth.uid()) or (exists (select 1 from public.sites s
--       where s.id = cash_register_sessions.site_id and private.has_workspace_access(s.workspace_id, array['admin'::text]))))
--     with check ((opened_by = auth.uid()) or (exists (select 1 from public.sites s
--       where s.id = cash_register_sessions.site_id and private.has_workspace_access(s.workspace_id, array['admin'::text]))));
--   anon détient aujourd'hui aussi INSERT, UPDATE, DELETE sur ces tables (sans politique, donc sans effet) ;
--   le retour arrière ne les rétablit pas.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 0) Prérequis : fondation des ventes appliquée
-- -----------------------------------------------------------------------------
do $prereq$
begin
  if to_regprocedure('private.site_role(uuid)') is null
     or to_regprocedure('public.close_cash_session(uuid,numeric,text)') is null
     or to_regclass('public.cash_register_sessions_one_open') is null then
    raise exception 'Prérequis manquant : appliquer d''abord la migration pos_sales_foundation.';
  end if;
end;
$prereq$;


-- -----------------------------------------------------------------------------
-- 1) Fin des écritures directes
-- -----------------------------------------------------------------------------
drop policy if exists cash_movements_member_insert on public.cash_register_movements;
drop policy if exists cash_sessions_member_insert on public.cash_register_sessions;
drop policy if exists cash_sessions_owner_or_opener_update on public.cash_register_sessions;

revoke insert, update, delete on public.cash_register_movements, public.cash_register_sessions from anon, authenticated;


-- -----------------------------------------------------------------------------
-- 2) Ouverture de caisse contrôlée
-- -----------------------------------------------------------------------------
create or replace function public.open_cash_session(
  p_site_id uuid,
  p_opening_cash numeric,
  p_register_name text default 'Caisse principale',
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_currency text;
  v_name text := btrim(coalesce(p_register_name, ''));
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'Connexion requise.' using errcode = '42501';
  end if;

  v_role := private.site_role(p_site_id);
  if v_role is null or v_role not in ('owner', 'admin', 'editor') then
    raise exception 'Ouverture refusée : seuls le propriétaire, un administrateur ou un vendeur ouvrent la caisse.'
      using errcode = '42501';
  end if;

  select coalesce(bp.currency_code, 'XOF') into v_currency from public.business_profiles bp where bp.site_id = p_site_id;
  v_currency := coalesce(v_currency, 'XOF');

  if p_opening_cash is null or p_opening_cash < 0
     or p_opening_cash <> round(p_opening_cash, case when v_currency = 'XOF' then 0 else 2 end) then
    raise exception 'Fond de caisse invalide.' using errcode = '22023';
  end if;
  if char_length(v_name) not between 1 and 80 then
    raise exception 'Nom de caisse invalide (1 à 80 caractères).' using errcode = '22023';
  end if;

  begin
    insert into public.cash_register_sessions (site_id, opened_by, register_name, status, opening_cash, currency_code, opening_note)
    values (p_site_id, v_uid, v_name, 'open', p_opening_cash, v_currency, nullif(left(btrim(coalesce(p_note, '')), 1000), ''))
    returning id into v_id;
  exception when unique_violation then
    raise exception 'Une caisse « % » est déjà ouverte pour cette boutique.', v_name using errcode = '23505';
  end;

  return v_id;
end;
$function$;

revoke all on function public.open_cash_session(uuid, numeric, text, text) from public, anon;
grant execute on function public.open_cash_session(uuid, numeric, text, text) to authenticated;
