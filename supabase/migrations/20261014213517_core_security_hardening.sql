-- =============================================================================
-- Durcissement de sécurité du socle : garde de publication et réduction des droits
-- =============================================================================
-- STATUT : NON TESTÉE tant que supabase/tests/core_security_hardening.test.sql
-- n'a pas été exécuté sur une base locale jetable. NE PAS APPLIQUER sans accord écrit.
--
-- OBJECTIF
--   a) Seuls le propriétaire, un admin ou un publisher peuvent mettre un site en ligne
--      (status = 'published'). Aujourd'hui, un éditeur le peut via UPDATE.
--   b) Retirer à anon et authenticated des droits de table inutiles et dangereux
--      (TRUNCATE ignore RLS ; TRIGGER et REFERENCES n'ont aucun usage côté API),
--      et retirer à anon toute écriture sur le socle (profils, espaces, sites, pages).
--   c) Aucune donnée existante n'est modifiée (aucun UPDATE/DELETE de lignes).
--
-- IMPACTS
--   - Un éditeur qui tente d'insérer un site publié, ou de passer un site en published,
--     reçoit l'erreur 42501 « Publication refusée ». Les autres modifications restent permises.
--   - published_at est désormais géré par la base pour les appels authentifiés :
--     renseigné à la première publication, non modifiable directement par le client.
--   - Un site déjà publié peut toujours être modifié par un éditeur (nom, thème…) ;
--     seul le passage À l'état published est contrôlé.
--   - anon garde SELECT partout où il l'avait (RLS limite aux sites/pages publiés) et garde
--     INSERT sur business_inquiries (formulaire de contact invité, seule politique d'écriture
--     anon vérifiée le 2026-10-14 via pg_policies). Aucun autre parcours invité n'existe.
--   - Les tables créées plus tard par le rôle postgres n'accorderont plus TRUNCATE,
--     TRIGGER, REFERENCES à anon/authenticated. Limite : les privilèges par défaut du rôle
--     supabase_admin ne peuvent pas être modifiés depuis une migration (rôle réservé).
--
-- RETOUR ARRIÈRE (à exécuter dans une seule transaction)
--   drop trigger if exists sites_publication_guard on public.sites;
--   drop function if exists private.enforce_site_publication();
--   grant truncate, trigger, references on all tables in schema public to anon, authenticated;
--   grant insert, update, delete on public.profiles, public.workspaces,
--     public.workspace_memberships, public.sites, public.site_pages to anon;
--   alter default privileges for role postgres in schema public
--     grant truncate, trigger, references on tables to anon, authenticated;
--   Remarque : ce retour rétablit des droits trop larges ; préférer une correction ciblée.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- a) Garde de publication sur public.sites
-- -----------------------------------------------------------------------------
-- SECURITY INVOKER : la fonction s'exécute avec le rôle de l'appelant, ce qui permet
-- de savoir qui écrit (current_user = anon, authenticated, postgres, service_role…).
--
-- Choix pour les appels sans utilisateur (auth.uid() est null) :
--   - anon (ou authenticated sans identité) : TOUJOURS refusé. anon n'a de toute façon
--     ni droit d'écriture ni politique d'écriture sur sites ; ce refus est une seconde barrière.
--   - rôles serveur (postgres dans l'éditeur SQL, service_role, supabase_admin) : autorisé.
--     Ces rôles contournent déjà RLS et sont réservés à l'administration ; les bloquer
--     empêcherait toute opération de maintenance sans apporter de sécurité réelle.
--     Conséquence à connaître : une future fonction SECURITY DEFINER appartenant à postgres
--     qui écrirait dans sites contournerait cette garde ; elle devra faire son propre contrôle.
create or replace function private.enforce_site_publication()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_is_publishing boolean;
begin
  -- Mise en ligne = insertion directement publiée, passage d'un autre statut à published,
  -- ou déplacement d'un site publié vers un autre espace (le droit doit y être vérifié).
  v_is_publishing := new.status = 'published' and (
    tg_op = 'INSERT'
    or old.status is distinct from 'published'
    or old.workspace_id is distinct from new.workspace_id
  );

  if v_uid is null then
    if current_user in ('anon', 'authenticated') then
      if v_is_publishing then
        raise exception 'Publication refusée : utilisateur non identifié.'
          using errcode = '42501';
      end if;
      return new;
    end if;
    -- Rôle serveur de confiance : on renseigne seulement la date de première publication.
    if v_is_publishing and new.published_at is null then
      new.published_at := coalesce(case when tg_op = 'UPDATE' then old.published_at end, now());
    end if;
    return new;
  end if;

  -- Utilisateur identifié : published_at n'est jamais fixé par le client.
  new.published_at := case when tg_op = 'UPDATE' then old.published_at end;

  if v_is_publishing then
    -- Le propriétaire passe quel que soit le tableau de rôles.
    if not private.has_workspace_access(new.workspace_id, array['admin', 'publisher']) then
      raise exception 'Publication refusée : seuls le propriétaire, un administrateur ou un publieur peuvent mettre un site en ligne.'
        using errcode = '42501';
    end if;
    new.published_at := coalesce(new.published_at, now());
  end if;

  return new;
end;
$function$;

revoke all on function private.enforce_site_publication() from public, anon, authenticated;

drop trigger if exists sites_publication_guard on public.sites;
create trigger sites_publication_guard
  before insert or update on public.sites
  for each row execute function private.enforce_site_publication();


-- -----------------------------------------------------------------------------
-- b) Réduction des droits de table
-- -----------------------------------------------------------------------------
-- TRUNCATE contourne RLS : aucun client de l'API ne doit pouvoir vider une table.
-- TRIGGER et REFERENCES ne servent à rien depuis l'API.
revoke truncate, trigger, references on all tables in schema public from anon, authenticated;

-- anon ne fait que lire les sites et pages publiés (RLS) : aucune écriture sur le socle.
revoke insert, update, delete on
  public.profiles,
  public.workspaces,
  public.workspace_memberships,
  public.sites,
  public.site_pages
from anon;

-- Tables futures créées par postgres (migrations) : pas de TRUNCATE/TRIGGER/REFERENCES.
alter default privileges for role postgres in schema public
  revoke truncate, trigger, references on tables from anon, authenticated;
