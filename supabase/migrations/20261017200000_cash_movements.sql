-- =============================================================================
-- Mouvements de caisse manuels (lot E) : dépense, apport, retrait, dépôt banque — ADDITIVE
-- =============================================================================
-- STATUT : PRÉPARÉE, NON APPLIQUÉE, NON TESTÉE EN EXÉCUTION.
-- Nature : uniquement de nouveaux objets (1 table avec RLS activée, 2 fonctions, 1 index). Aucun objet, politique
-- ou droit existant n'est modifié. cash_session_summary et close_cash_session ne sont PAS réécrites : elles
-- comptent déjà cash_in en entrée et expense, cash_out, deposit en sortie
-- (attendu = fond + ventes espèces − remboursements + apports − dépenses − retraits − dépôts).
--
-- PRÉREQUIS : pos_cash_lockdown (aucune écriture directe sur cash_register_movements), team_accounts
-- (private.staff_role). Le bloc 0 vérifie aussi que la contrainte de movement_type accepte les 4 types.
--
-- CONTENU
--   a) public.cash_movement_details : motif structuré et référence de justificatif d'un mouvement manuel
--      (cash_register_movements n'a pas de colonne pour le justificatif ; la table existante n'est pas modifiée).
--      Lecture : comme le mouvement (RLS existante de cash_register_movements, via la jointure). Aucune écriture directe.
--   b) public.record_cash_movement(site, session, type, montant, motif, justificatif) : SECURITY DEFINER.
--   c) public.cash_session_breakdown(session) : totaux par type de mouvement, calculés par la base, pour le rapport X/Z.
--
-- RÈGLES DE record_cash_movement
--   - Types : expense (dépense), cash_in (apport), cash_out (retrait), deposit (dépôt banque).
--   - Propriétaire et gérant : tous les types. Vendeur : expense seulement, montant ≤
--     sites.settings->pos->cashier_max_expense_amount (0 par défaut : aucune dépense). Autres rôles : refusés (42501).
--   - Session de la boutique, ouverte (verrou de ligne). Montant > 0, arrondi à la devise (entier en XOF).
--   - Motif obligatoire (3 à 300 caractères) ; justificatif facultatif (100 caractères au plus).
--   - Sortie (expense, cash_out, deposit) refusée si les espèces attendues deviendraient négatives (23514).
--   - Audit : ligne cash_register_movements (acteur, type, montant, motif) + détails (acteur, justificatif, date).
--
-- RETOUR ARRIÈRE (une seule transaction, uniquement si aucun mouvement manuel n'a été enregistré)
--   drop function if exists public.cash_session_breakdown(uuid);
--   drop function if exists public.record_cash_movement(uuid, uuid, text, numeric, text, text);
--   drop table if exists public.cash_movement_details;
-- =============================================================================

do $prereq$
declare
  v_def text;
begin
  if to_regprocedure('private.staff_role(uuid)') is null or to_regprocedure('public.open_cash_session(uuid,numeric,text,text)') is null then
    raise exception 'Prérequis manquant : appliquer d''abord pos_cash_lockdown et team_accounts.';
  end if;
  select string_agg(pg_get_constraintdef(c.oid), ' ') into v_def
  from pg_constraint c
  where c.conrelid = 'public.cash_register_movements'::regclass and c.contype = 'c';
  if v_def is not null and (position('expense' in v_def) = 0 or position('cash_in' in v_def) = 0
     or position('cash_out' in v_def) = 0 or position('deposit' in v_def) = 0) then
    raise exception 'La contrainte de cash_register_movements.movement_type n''accepte pas les 4 types : %', v_def;
  end if;
end;
$prereq$;


-- -----------------------------------------------------------------------------
-- a) Détails des mouvements manuels
-- -----------------------------------------------------------------------------
create table public.cash_movement_details (
  movement_id uuid primary key references public.cash_register_movements(id) on delete cascade,
  site_id uuid not null references public.sites(id) on delete cascade,
  session_id uuid not null references public.cash_register_sessions(id) on delete cascade,
  receipt_ref text constraint cash_movement_details_receipt_check check (receipt_ref is null or char_length(receipt_ref) <= 100),
  recorded_by uuid references auth.users(id) on delete set null,
  recorded_role text,
  created_at timestamptz not null default now()
);

create index cash_movement_details_session_idx on public.cash_movement_details (session_id);
alter table public.cash_movement_details enable row level security;
revoke all on public.cash_movement_details from anon, authenticated;

-- Visible quand le mouvement l'est (la RLS de cash_register_movements s'applique dans la sous-requête).
create policy cash_movement_details_follow_movement on public.cash_movement_details
  for select to authenticated
  using (exists (select 1 from public.cash_register_movements m where m.id = cash_movement_details.movement_id));
grant select on public.cash_movement_details to authenticated;


-- -----------------------------------------------------------------------------
-- b) Enregistrement
-- -----------------------------------------------------------------------------
create or replace function public.record_cash_movement(
  p_site_id uuid,
  p_session_id uuid,
  p_movement_type text,
  p_amount numeric,
  p_reason text,
  p_receipt_ref text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_session public.cash_register_sessions%rowtype;
  v_site public.sites%rowtype;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_ref text := nullif(btrim(coalesce(p_receipt_ref, '')), '');
  v_decimals integer;
  v_cap numeric;
  v_expected numeric;
  v_movement_id uuid;
begin
  if v_uid is null then
    raise exception 'Connexion requise.' using errcode = '42501';
  end if;
  v_role := private.staff_role(p_site_id);
  if v_role is null or v_role not in ('owner', 'manager', 'cashier') then
    raise exception 'Mouvement de caisse refusé pour votre rôle.' using errcode = '42501';
  end if;
  if p_movement_type is null or p_movement_type not in ('expense', 'cash_in', 'cash_out', 'deposit') then
    raise exception 'Type de mouvement inconnu : %.', coalesce(p_movement_type, '(vide)') using errcode = '22023';
  end if;

  select * into v_session from public.cash_register_sessions where id = p_session_id and site_id = p_site_id for update;
  if not found then
    raise exception 'Session de caisse introuvable pour cette boutique.' using errcode = '22023';
  end if;
  if v_session.status <> 'open' then
    raise exception 'La session de caisse est fermée : ouvrez une caisse pour enregistrer un mouvement.' using errcode = '22023';
  end if;

  v_decimals := case when v_session.currency_code = 'XOF' then 0 else 2 end;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Le montant doit être supérieur à zéro.' using errcode = '22023';
  end if;
  if p_amount <> round(p_amount, v_decimals) then
    raise exception 'Montant invalide : % décimale(s) au plus en %.', v_decimals, v_session.currency_code using errcode = '22023';
  end if;
  if v_reason is null or char_length(v_reason) < 3 or char_length(v_reason) > 300 then
    raise exception 'Le motif est obligatoire (3 à 300 caractères).' using errcode = '22023';
  end if;
  if v_ref is not null and char_length(v_ref) > 100 then
    raise exception 'Référence de justificatif trop longue (100 caractères au plus).' using errcode = '22023';
  end if;

  if v_role = 'cashier' then
    if p_movement_type <> 'expense' then
      raise exception 'Un vendeur ne peut enregistrer que des petites dépenses.' using errcode = '42501';
    end if;
    select * into v_site from public.sites where id = p_site_id;
    v_cap := greatest(coalesce((v_site.settings -> 'pos' ->> 'cashier_max_expense_amount')::numeric, 0), 0);
    if p_amount > v_cap then
      raise exception 'Dépense supérieure au plafond autorisé pour un vendeur (% %).', v_cap, v_session.currency_code using errcode = '42501';
    end if;
  end if;

  if p_movement_type in ('expense', 'cash_out', 'deposit') then
    v_expected := (public.cash_session_summary(p_session_id) ->> 'expected_cash')::numeric;
    if v_expected - p_amount < 0 then
      raise exception 'Espèces insuffisantes en caisse : % % attendus, sortie de %.', v_expected, v_session.currency_code, p_amount
        using errcode = '23514';
    end if;
  end if;

  insert into public.cash_register_movements (site_id, session_id, actor_user_id, movement_type, amount, currency_code, reason)
  values (p_site_id, p_session_id, v_uid, p_movement_type, p_amount, v_session.currency_code, v_reason)
  returning id into v_movement_id;
  insert into public.cash_movement_details (movement_id, site_id, session_id, receipt_ref, recorded_by, recorded_role)
  values (v_movement_id, p_site_id, p_session_id, v_ref, v_uid, v_role);

  return jsonb_build_object(
    'movement_id', v_movement_id,
    'movement_type', p_movement_type,
    'amount', p_amount,
    'expected_cash', (public.cash_session_summary(p_session_id) ->> 'expected_cash')::numeric
  );
end;
$function$;

revoke all on function public.record_cash_movement(uuid, uuid, text, numeric, text, text) from public, anon;
grant execute on function public.record_cash_movement(uuid, uuid, text, numeric, text, text) to authenticated;


-- -----------------------------------------------------------------------------
-- c) Ventilation par type (rapport X/Z) : montants calculés par la base
-- -----------------------------------------------------------------------------
create or replace function public.cash_session_breakdown(p_session_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_session public.cash_register_sessions%rowtype;
  v_result jsonb;
begin
  select * into v_session from public.cash_register_sessions where id = p_session_id;
  if not found or coalesce(private.staff_role(v_session.site_id), '') not in ('owner', 'manager', 'cashier', 'viewer') then
    raise exception 'Session de caisse introuvable.' using errcode = '22023';
  end if;
  select coalesce(jsonb_object_agg(movement_type, jsonb_build_object('count', n, 'amount', total)), '{}'::jsonb) into v_result
  from (
    select movement_type, count(*) as n, sum(amount) as total
    from public.cash_register_movements where session_id = p_session_id
    group by movement_type
  ) t;
  return v_result;
end;
$function$;

revoke all on function public.cash_session_breakdown(uuid) from public, anon;
grant execute on function public.cash_session_breakdown(uuid) to authenticated;
