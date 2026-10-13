
create table if not exists public.store_audit_events (
 id uuid primary key default gen_random_uuid(),
 site_id uuid not null references public.sites(id) on delete cascade,
 actor_user_id uuid references auth.users(id) on delete set null,
 actor_label text,
 event_key text not null check (char_length(trim(event_key)) between 1 and 120),
 entity_type text not null check (char_length(trim(entity_type)) between 1 and 80),
 entity_id uuid,
 severity text not null default 'info' check (severity in ('info','notice','warning','critical')),
 summary text not null check (char_length(trim(summary)) between 1 and 500),
 details jsonb not null default '{}'::jsonb,
 source text not null default 'app' check (source in ('app','pos','automation','integration','system')),
 occurred_at timestamptz not null default now(),
 created_at timestamptz not null default now()
);
create index if not exists store_audit_events_site_time_idx on public.store_audit_events(site_id, occurred_at desc);
create index if not exists store_audit_events_site_severity_time_idx on public.store_audit_events(site_id, severity, occurred_at desc);
create index if not exists store_audit_events_entity_idx on public.store_audit_events(site_id, entity_type, entity_id, occurred_at desc);

create table if not exists public.store_alerts (
 id uuid primary key default gen_random_uuid(),
 site_id uuid not null references public.sites(id) on delete cascade,
 alert_key text not null check (char_length(trim(alert_key)) between 1 and 120),
 severity text not null default 'warning' check (severity in ('notice','warning','critical')),
 title text not null check (char_length(trim(title)) between 1 and 180),
 message text not null check (char_length(trim(message)) between 1 and 2000),
 related_entity_type text,
 related_entity_id uuid,
 status text not null default 'open' check (status in ('open','acknowledged','resolved','dismissed')),
 assigned_to uuid references auth.users(id) on delete set null,
 created_at timestamptz not null default now(),
 acknowledged_at timestamptz,
 resolved_at timestamptz,
 resolution_note text,
 metadata jsonb not null default '{}'::jsonb
);
create index if not exists store_alerts_open_site_idx on public.store_alerts(site_id, severity, created_at desc) where status='open';

create table if not exists public.cash_sessions (
 id uuid primary key default gen_random_uuid(),
 site_id uuid not null references public.sites(id) on delete cascade,
 opened_by uuid references auth.users(id) on delete set null,
 closed_by uuid references auth.users(id) on delete set null,
 register_label text,
 status text not null default 'open' check (status in ('open','closed','reconciled','disputed')),
 currency_code text not null default 'XOF' check (currency_code ~ '^[A-Z]{3}$'),
 opening_amount numeric(14,2) not null default 0 check (opening_amount>=0),
 expected_amount numeric(14,2),
 counted_amount numeric(14,2),
 variance_amount numeric(14,2),
 opened_at timestamptz not null default now(),
 closed_at timestamptz,
 reconciliation_note text,
 created_at timestamptz not null default now(),
 check (closed_at is null or closed_at>=opened_at)
);
create index if not exists cash_sessions_site_opened_idx on public.cash_sessions(site_id, opened_at desc);

create table if not exists public.cash_movements (
 id uuid primary key default gen_random_uuid(),
 site_id uuid not null references public.sites(id) on delete cascade,
 cash_session_id uuid references public.cash_sessions(id) on delete restrict,
 actor_user_id uuid references auth.users(id) on delete set null,
 movement_type text not null check (movement_type in ('sale','refund','cash_in','cash_out','expense','deposit','withdrawal','adjustment')),
 amount numeric(14,2) not null check (amount>0),
 currency_code text not null default 'XOF' check (currency_code ~ '^[A-Z]{3}$'),
 reference_type text,
 reference_id uuid,
 reason text,
 occurred_at timestamptz not null default now(),
 created_at timestamptz not null default now()
);
create index if not exists cash_movements_site_time_idx on public.cash_movements(site_id, occurred_at desc);
create index if not exists cash_movements_session_idx on public.cash_movements(cash_session_id, occurred_at desc);

alter table public.store_audit_events enable row level security;
alter table public.store_alerts enable row level security;
alter table public.cash_sessions enable row level security;
alter table public.cash_movements enable row level security;

create policy store_audit_events_owner_read on public.store_audit_events
 for select to authenticated using (
  exists (select 1 from public.sites s where s.id=store_audit_events.site_id and private.has_workspace_access(s.workspace_id,array['admin']::text[]))
 );
create policy store_alerts_owner_read on public.store_alerts
 for select to authenticated using (
  exists (select 1 from public.sites s where s.id=store_alerts.site_id and private.has_workspace_access(s.workspace_id,array['admin']::text[]))
 );
create policy cash_sessions_owner_read on public.cash_sessions
 for select to authenticated using (
  exists (select 1 from public.sites s where s.id=cash_sessions.site_id and private.has_workspace_access(s.workspace_id,array['admin']::text[]))
 );
create policy cash_movements_owner_read on public.cash_movements
 for select to authenticated using (
  exists (select 1 from public.sites s where s.id=cash_movements.site_id and private.has_workspace_access(s.workspace_id,array['admin']::text[]))
 );
