-- =============================================================================
-- Clients et crédit (lot F, partie 1/2) : fiche client, vente à crédit, versements, relevé, impayés — ADDITIVE
-- =============================================================================
-- STATUT : PRÉPARÉE, NON APPLIQUÉE, NON TESTÉE EN EXÉCUTION.
-- Nature : uniquement de nouveaux objets (2 tables avec RLS activée, fonctions, index). record_sale n'est PAS
-- modifiée : record_credit_sale contrôle le client et le plafond, puis appelle record_sale (même transaction).
-- LIMITE tant que la partie 2/2 (20261017220100_credit_sale_guard, autorisation requise) n'est pas appliquée :
-- record_sale accepte encore un paiement « credit » appelé directement, sans fiche client ni plafond.
--
-- PRÉREQUIS : pos_sales_foundation, team_accounts (private.staff_role), cash_movements (mouvements de caisse).
--
-- CHOIX
--   - Table store_customers (clients de comptoir d'UNE boutique). La table cible de orders.customer_id n'est pas
--     versionnée dans ce dépôt : elle n'est ni lue ni modifiée.
--   - Le solde dû vient du grand livre customer_ledger (débit : vente à crédit ; crédit : versement). Les
--     paiements « credit » de payment_transactions restent 'pending' (non modifiés).
--   - Ancienneté : les versements soldent les ventes les plus anciennes d'abord (FIFO) ; l'ancienneté est l'âge,
--     en jours (Africa/Dakar), de la plus ancienne vente non soldée.
--   - Plafond (credit_limit, 0 par défaut) : une vente à crédit qui porterait le solde au-delà est refusée, sauf
--     autorisation d'un propriétaire ou gérant connecté qui saisit un motif (tracé dans le grand livre). Un vendeur
--     ne peut pas dépasser le plafond.
--   - Pas de relance automatique (ni SMS, ni e-mail).
--
-- DROITS
--   Lecture (clients, grand livre) : propriétaire, gérant, vendeur de la boutique ; magasinier, livreur, autres
--   boutiques : rien. Aucune écriture directe : fonctions SECURITY DEFINER.
--   save_customer : propriétaire, gérant, vendeur ; seuls propriétaire et gérant fixent le plafond.
--   record_credit_sale, record_customer_payment : propriétaire, gérant, vendeur.
--
-- RETOUR ARRIÈRE (une seule transaction, uniquement si aucune vente à crédit n'a été enregistrée)
--   drop function if exists public.customer_receivables(uuid);
--   drop function if exists public.customer_statement(uuid, uuid);
--   drop function if exists public.record_customer_payment(uuid, uuid, numeric, text, uuid, text, text);
--   drop function if exists public.record_credit_sale(uuid, uuid, uuid, jsonb, jsonb, jsonb, text);
--   drop function if exists public.save_customer(uuid, uuid, text, text, text, numeric, boolean);
--   drop function if exists private.customer_balance(uuid);
--   drop table if exists public.customer_ledger;
--   drop table if exists public.store_customers;
-- =============================================================================

do $prereq$
begin
  if to_regprocedure('private.staff_role(uuid)') is null
     or to_regprocedure('public.record_sale(uuid,uuid,jsonb,jsonb,jsonb,jsonb)') is null
     or to_regprocedure('public.record_cash_movement(uuid,uuid,text,numeric,text,text)') is null then
    raise exception 'Prérequis manquant : appliquer d''abord pos_sales_foundation, team_accounts et cash_movements.';
  end if;
end;
$prereq$;


-- -----------------------------------------------------------------------------
-- a) Clients
-- -----------------------------------------------------------------------------
create table public.store_customers (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.sites(id) on delete cascade,
  name text not null constraint store_customers_name_check check (char_length(btrim(name)) between 1 and 120),
  phone text constraint store_customers_phone_check check (phone is null or char_length(phone) between 3 and 40),
  address text constraint store_customers_address_check check (address is null or char_length(address) <= 300),
  credit_limit numeric(14,2) not null default 0 constraint store_customers_credit_limit_check check (credit_limit >= 0),
  is_active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index store_customers_site_name_idx on public.store_customers (site_id, lower(name));
create unique index store_customers_site_phone_idx on public.store_customers (site_id, phone) where phone is not null;

alter table public.store_customers enable row level security;
revoke all on public.store_customers from anon, authenticated;
create policy store_customers_staff_read on public.store_customers
  for select to authenticated
  using (coalesce(private.staff_role(site_id), '') in ('owner', 'manager', 'cashier'));
grant select on public.store_customers to authenticated;


-- -----------------------------------------------------------------------------
-- b) Grand livre client
-- -----------------------------------------------------------------------------
create table public.customer_ledger (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.sites(id) on delete cascade,
  customer_id uuid not null references public.store_customers(id) on delete restrict,
  entry_type text not null constraint customer_ledger_type_check check (entry_type in ('credit_sale', 'payment')),
  amount numeric(14,2) not null constraint customer_ledger_amount_check check (amount > 0),
  order_id uuid references public.orders(id) on delete restrict,
  document_number text,
  payment_method text constraint customer_ledger_method_check check (payment_method is null or payment_method in ('cash', 'wave', 'orange_money', 'card')),
  cash_movement_id uuid references public.cash_register_movements(id) on delete restrict,
  reference text constraint customer_ledger_reference_check check (reference is null or char_length(reference) <= 100),
  note text constraint customer_ledger_note_check check (note is null or char_length(note) <= 300),
  override_reason text constraint customer_ledger_override_check check (override_reason is null or char_length(override_reason) between 3 and 300),
  recorded_by uuid references auth.users(id) on delete set null,
  recorded_role text,
  created_at timestamptz not null default now(),
  constraint customer_ledger_shape_check check (
    (entry_type = 'credit_sale' and order_id is not null and payment_method is null)
    or (entry_type = 'payment' and order_id is null and payment_method is not null)
  )
);

create index customer_ledger_customer_idx on public.customer_ledger (customer_id, created_at);
create index customer_ledger_site_idx on public.customer_ledger (site_id, created_at);

alter table public.customer_ledger enable row level security;
revoke all on public.customer_ledger from anon, authenticated;
create policy customer_ledger_staff_read on public.customer_ledger
  for select to authenticated
  using (coalesce(private.staff_role(site_id), '') in ('owner', 'manager', 'cashier'));
grant select on public.customer_ledger to authenticated;


-- -----------------------------------------------------------------------------
-- c) Solde
-- -----------------------------------------------------------------------------
create or replace function private.customer_balance(p_customer_id uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $function$
  select coalesce(sum(case when entry_type = 'credit_sale' then amount else -amount end), 0)
  from public.customer_ledger where customer_id = p_customer_id;
$function$;

revoke all on function private.customer_balance(uuid) from public, anon, authenticated;


-- -----------------------------------------------------------------------------
-- d) Fiche client (création, modification)
-- -----------------------------------------------------------------------------
-- p_customer_id null : création. p_credit_limit null : plafond inchangé (0 à la création).
create or replace function public.save_customer(
  p_site_id uuid,
  p_customer_id uuid,
  p_name text,
  p_phone text,
  p_address text,
  p_credit_limit numeric default null,
  p_is_active boolean default true
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_role text := private.staff_role(p_site_id);
  v_name text := nullif(btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g')), '');
  v_phone text := nullif(btrim(coalesce(p_phone, '')), '');
  v_address text := nullif(btrim(coalesce(p_address, '')), '');
  v_existing public.store_customers%rowtype;
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'Connexion requise.' using errcode = '42501';
  end if;
  if v_role is null or v_role not in ('owner', 'manager', 'cashier') then
    raise exception 'Fiche client réservée au propriétaire, au gérant et aux vendeurs.' using errcode = '42501';
  end if;
  if v_name is null or char_length(v_name) > 120 then
    raise exception 'Nom du client obligatoire (120 caractères au plus).' using errcode = '22023';
  end if;
  if v_phone is not null and char_length(v_phone) not between 3 and 40 then
    raise exception 'Téléphone invalide.' using errcode = '22023';
  end if;
  if v_address is not null and char_length(v_address) > 300 then
    raise exception 'Adresse trop longue (300 caractères au plus).' using errcode = '22023';
  end if;
  if p_credit_limit is not null then
    if v_role not in ('owner', 'manager') then
      raise exception 'Seuls le propriétaire et le gérant fixent le plafond de crédit.' using errcode = '42501';
    end if;
    if p_credit_limit < 0 or p_credit_limit <> round(p_credit_limit, 0) then
      raise exception 'Plafond de crédit invalide : montant entier positif ou nul.' using errcode = '22023';
    end if;
  end if;

  begin
    if p_customer_id is null then
      insert into public.store_customers (site_id, name, phone, address, credit_limit, created_by)
      values (p_site_id, v_name, v_phone, v_address, coalesce(p_credit_limit, 0), v_uid)
      returning id into v_id;
    else
      select * into v_existing from public.store_customers where id = p_customer_id and site_id = p_site_id for update;
      if not found then
        raise exception 'Client introuvable dans cette boutique.' using errcode = '22023';
      end if;
      if coalesce(p_is_active, true) = false and v_role not in ('owner', 'manager') then
        raise exception 'Seuls le propriétaire et le gérant désactivent un client.' using errcode = '42501';
      end if;
      update public.store_customers set
        name = v_name, phone = v_phone, address = v_address,
        credit_limit = coalesce(p_credit_limit, credit_limit),
        is_active = coalesce(p_is_active, is_active),
        updated_at = now()
      where id = p_customer_id
      returning id into v_id;
    end if;
  exception when unique_violation then
    raise exception 'Un client de la boutique a déjà ce numéro de téléphone.' using errcode = '23505';
  end;
  return v_id;
end;
$function$;

revoke all on function public.save_customer(uuid, uuid, text, text, text, numeric, boolean) from public, anon;
grant execute on function public.save_customer(uuid, uuid, text, text, text, numeric, boolean) to authenticated;


-- -----------------------------------------------------------------------------
-- e) Vente à crédit : contrôle du client et du plafond, puis record_sale
-- -----------------------------------------------------------------------------
-- p_payments doit contenir au moins un paiement « credit » (paiement partiel ou nul : le reste est le crédit).
-- p_override_reason : motif d'un propriétaire ou gérant pour dépasser le plafond.
create or replace function public.record_credit_sale(
  p_site_id uuid,
  p_cash_session_id uuid,
  p_customer_id uuid,
  p_lines jsonb,
  p_payments jsonb,
  p_discount jsonb default '{}'::jsonb,
  p_override_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_role text := private.staff_role(p_site_id);
  v_customer public.store_customers%rowtype;
  v_credit numeric := 0;
  v_balance numeric;
  v_override text := nullif(btrim(coalesce(p_override_reason, '')), '');
  v_payment jsonb;
  v_sale jsonb;
begin
  if v_uid is null then
    raise exception 'Connexion requise.' using errcode = '42501';
  end if;
  if v_role is null or v_role not in ('owner', 'manager', 'cashier') then
    raise exception 'Vente à crédit refusée pour votre rôle.' using errcode = '42501';
  end if;

  select * into v_customer from public.store_customers where id = p_customer_id and site_id = p_site_id for update;
  if not found then
    raise exception 'Client introuvable dans cette boutique.' using errcode = '22023';
  end if;
  if not v_customer.is_active then
    raise exception 'Ce client est désactivé : aucune vente à crédit.' using errcode = '22023';
  end if;

  if jsonb_typeof(p_payments) is distinct from 'array' then
    raise exception 'Paiements invalides.' using errcode = '22023';
  end if;
  for v_payment in select value from jsonb_array_elements(p_payments) loop
    if v_payment ->> 'method' = 'credit' then
      if jsonb_typeof(v_payment -> 'amount') <> 'number' or (v_payment ->> 'amount')::numeric <= 0 then
        raise exception 'Montant à crédit invalide.' using errcode = '22023';
      end if;
      v_credit := v_credit + (v_payment ->> 'amount')::numeric;
    end if;
  end loop;
  if v_credit <= 0 then
    raise exception 'Aucun montant à crédit : utilisez l''encaissement normal.' using errcode = '22023';
  end if;

  v_balance := private.customer_balance(v_customer.id);
  if v_balance + v_credit > v_customer.credit_limit then
    if v_role not in ('owner', 'manager') then
      raise exception 'Plafond de crédit dépassé (solde % + % > plafond %) : autorisation du gérant nécessaire.',
        v_balance, v_credit, v_customer.credit_limit using errcode = '42501';
    end if;
    if v_override is null or char_length(v_override) < 3 or char_length(v_override) > 300 then
      raise exception 'Plafond de crédit dépassé : motif d''autorisation obligatoire (3 à 300 caractères).' using errcode = '22023';
    end if;
  else
    v_override := null;
  end if;

  -- Autorise le paiement « credit » dans record_sale pour CETTE transaction (contrôle de la partie 2/2).
  perform set_config('app.credit_sale', 'on', true);
  v_sale := public.record_sale(
    p_site_id, p_cash_session_id, p_lines, p_payments,
    jsonb_build_object('name', v_customer.name, 'phone', v_customer.phone),
    coalesce(p_discount, '{}'::jsonb)
  );
  perform set_config('app.credit_sale', '', true);

  insert into public.customer_ledger (site_id, customer_id, entry_type, amount, order_id, document_number, override_reason, recorded_by, recorded_role)
  values (p_site_id, v_customer.id, 'credit_sale', v_credit, (v_sale ->> 'order_id')::uuid, v_sale ->> 'document_number', v_override, v_uid, v_role);

  return v_sale || jsonb_build_object(
    'customer_id', v_customer.id,
    'credit_amount', v_credit,
    'customer_balance', v_balance + v_credit,
    'credit_limit', v_customer.credit_limit,
    'limit_overridden', v_override is not null
  );
end;
$function$;

revoke all on function public.record_credit_sale(uuid, uuid, uuid, jsonb, jsonb, jsonb, text) from public, anon;
grant execute on function public.record_credit_sale(uuid, uuid, uuid, jsonb, jsonb, jsonb, text) to authenticated;


-- -----------------------------------------------------------------------------
-- f) Versement d'un client
-- -----------------------------------------------------------------------------
-- Espèces : session de caisse ouverte obligatoire, mouvement cash_in inscrit (compté dans l'attendu X/Z).
-- Autres moyens : enregistrement manuel, aucun paiement réel exécuté.
create or replace function public.record_customer_payment(
  p_site_id uuid,
  p_customer_id uuid,
  p_amount numeric,
  p_method text,
  p_cash_session_id uuid default null,
  p_reference text default null,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_role text := private.staff_role(p_site_id);
  v_customer public.store_customers%rowtype;
  v_session public.cash_register_sessions%rowtype;
  v_balance numeric;
  v_reference text := nullif(btrim(coalesce(p_reference, '')), '');
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_movement uuid;
  v_entry uuid;
begin
  if v_uid is null then
    raise exception 'Connexion requise.' using errcode = '42501';
  end if;
  if v_role is null or v_role not in ('owner', 'manager', 'cashier') then
    raise exception 'Versement refusé pour votre rôle.' using errcode = '42501';
  end if;
  if p_method is null or p_method not in ('cash', 'wave', 'orange_money', 'card') then
    raise exception 'Moyen de paiement inconnu : %.', coalesce(p_method, '(vide)') using errcode = '22023';
  end if;
  if p_amount is null or p_amount <= 0 or p_amount <> round(p_amount, 0) then
    raise exception 'Montant invalide : entier supérieur à zéro.' using errcode = '22023';
  end if;
  if char_length(coalesce(v_reference, '')) > 100 or char_length(coalesce(v_note, '')) > 300 then
    raise exception 'Référence (100) ou note (300) trop longue.' using errcode = '22023';
  end if;

  select * into v_customer from public.store_customers where id = p_customer_id and site_id = p_site_id for update;
  if not found then
    raise exception 'Client introuvable dans cette boutique.' using errcode = '22023';
  end if;
  v_balance := private.customer_balance(v_customer.id);
  if p_amount > v_balance then
    raise exception 'Versement supérieur au solde dû (% XOF).', v_balance using errcode = '22023';
  end if;

  if p_method = 'cash' then
    select * into v_session from public.cash_register_sessions
    where id = p_cash_session_id and site_id = p_site_id for update;
    if not found or v_session.status <> 'open' then
      raise exception 'Versement en espèces : une caisse ouverte de la boutique est obligatoire.' using errcode = '22023';
    end if;
    insert into public.cash_register_movements (site_id, session_id, actor_user_id, movement_type, amount, currency_code, reason)
    values (p_site_id, v_session.id, v_uid, 'cash_in', p_amount, v_session.currency_code, left('Versement client ' || v_customer.name, 300))
    returning id into v_movement;
    insert into public.cash_movement_details (movement_id, site_id, session_id, receipt_ref, recorded_by, recorded_role)
    values (v_movement, p_site_id, v_session.id, v_reference, v_uid, v_role);
  end if;

  insert into public.customer_ledger (site_id, customer_id, entry_type, amount, payment_method, cash_movement_id, reference, note, recorded_by, recorded_role)
  values (p_site_id, v_customer.id, 'payment', p_amount, p_method, v_movement, v_reference, v_note, v_uid, v_role)
  returning id into v_entry;

  return jsonb_build_object('entry_id', v_entry, 'customer_id', v_customer.id, 'amount', p_amount, 'balance', v_balance - p_amount);
end;
$function$;

revoke all on function public.record_customer_payment(uuid, uuid, numeric, text, uuid, text, text) from public, anon;
grant execute on function public.record_customer_payment(uuid, uuid, numeric, text, uuid, text, text) to authenticated;


-- -----------------------------------------------------------------------------
-- g) Relevé client (solde progressif calculé par la base)
-- -----------------------------------------------------------------------------
create or replace function public.customer_statement(p_site_id uuid, p_customer_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_customer public.store_customers%rowtype;
  v_entries jsonb;
begin
  if coalesce(private.staff_role(p_site_id), '') not in ('owner', 'manager', 'cashier') then
    raise exception 'Relevé réservé au propriétaire, au gérant et aux vendeurs.' using errcode = '42501';
  end if;
  select * into v_customer from public.store_customers where id = p_customer_id and site_id = p_site_id;
  if not found then
    raise exception 'Client introuvable dans cette boutique.' using errcode = '22023';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'date', created_at, 'type', entry_type, 'document_number', document_number, 'method', payment_method,
    'reference', reference, 'note', note, 'override_reason', override_reason,
    'debit', case when entry_type = 'credit_sale' then amount else 0 end,
    'credit', case when entry_type = 'payment' then amount else 0 end,
    'balance', running
  ) order by created_at, id), '[]'::jsonb) into v_entries
  from (
    select l.*, sum(case when entry_type = 'credit_sale' then amount else -amount end) over (order by created_at, id) as running
    from public.customer_ledger l where l.customer_id = p_customer_id
  ) t;
  return jsonb_build_object(
    'customer', jsonb_build_object('id', v_customer.id, 'name', v_customer.name, 'phone', v_customer.phone,
                                   'address', v_customer.address, 'credit_limit', v_customer.credit_limit),
    'entries', v_entries,
    'balance', private.customer_balance(v_customer.id),
    'generated_at', now()
  );
end;
$function$;

revoke all on function public.customer_statement(uuid, uuid) from public, anon;
grant execute on function public.customer_statement(uuid, uuid) to authenticated;


-- -----------------------------------------------------------------------------
-- h) Impayés avec ancienneté (FIFO)
-- -----------------------------------------------------------------------------
create or replace function public.customer_receivables(p_site_id uuid)
returns table (customer_id uuid, name text, phone text, credit_limit numeric, balance numeric, oldest_unpaid_at timestamptz, days_outstanding integer)
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_customer record;
  v_paid numeric;
  v_sale record;
  v_oldest timestamptz;
begin
  if coalesce(private.staff_role(p_site_id), '') not in ('owner', 'manager', 'cashier') then
    raise exception 'Impayés réservés au propriétaire, au gérant et aux vendeurs.' using errcode = '42501';
  end if;
  for v_customer in
    select c.id, c.name, c.phone, c.credit_limit, private.customer_balance(c.id) as balance
    from public.store_customers c where c.site_id = p_site_id
  loop
    continue when v_customer.balance <= 0;
    select coalesce(sum(l.amount), 0) into v_paid from public.customer_ledger l
    where l.customer_id = v_customer.id and l.entry_type = 'payment';
    v_oldest := null;
    for v_sale in
      select l.created_at, l.amount from public.customer_ledger l
      where l.customer_id = v_customer.id and l.entry_type = 'credit_sale' order by l.created_at, l.id
    loop
      if v_paid >= v_sale.amount then
        v_paid := v_paid - v_sale.amount;
      else
        v_oldest := v_sale.created_at;
        exit;
      end if;
    end loop;
    customer_id := v_customer.id;
    name := v_customer.name;
    phone := v_customer.phone;
    credit_limit := v_customer.credit_limit;
    balance := v_customer.balance;
    oldest_unpaid_at := v_oldest;
    days_outstanding := case when v_oldest is null then 0
      else ((now() at time zone 'Africa/Dakar')::date - (v_oldest at time zone 'Africa/Dakar')::date) end;
    return next;
  end loop;
end;
$function$;

revoke all on function public.customer_receivables(uuid) from public, anon;
grant execute on function public.customer_receivables(uuid) to authenticated;
