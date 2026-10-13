
create table if not exists public.cash_register_sessions (
 id uuid primary key default gen_random_uuid(), site_id uuid not null references public.sites(id) on delete cascade,
 opened_by uuid not null references auth.users(id) on delete restrict, closed_by uuid references auth.users(id) on delete set null,
 register_name text not null default 'Caisse principale', status text not null default 'open' check(status in ('open','closed','reconciled','disputed')),
 opening_cash numeric(14,2) not null default 0 check(opening_cash>=0), expected_cash numeric(14,2), counted_cash numeric(14,2), discrepancy numeric(14,2),
 currency_code text not null default 'XOF' check(currency_code ~ '^[A-Z]{3}$'), opening_note text, closing_note text,
 opened_at timestamptz not null default now(), closed_at timestamptz, reconciled_at timestamptz, created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(), check(closed_at is null or closed_at>=opened_at)
);
create table if not exists public.cash_register_movements (
 id uuid primary key default gen_random_uuid(), site_id uuid not null references public.sites(id) on delete cascade,
 session_id uuid not null references public.cash_register_sessions(id) on delete restrict,
 actor_user_id uuid references auth.users(id) on delete set null,
 movement_type text not null check(movement_type in ('sale_cash','refund_cash','expense','cash_in','cash_out','deposit','withdrawal','correction')),
 amount numeric(14,2) not null check(amount>0), currency_code text not null default 'XOF' check(currency_code ~ '^[A-Z]{3}$'),
 order_id uuid references public.orders(id) on delete set null, reason text, approved_by uuid references auth.users(id) on delete set null,
 created_at timestamptz not null default now()
);
create index if not exists cash_sessions_site_status_idx on public.cash_register_sessions(site_id,status,opened_at desc);
create index if not exists cash_movements_session_time_idx on public.cash_register_movements(session_id,created_at desc);
create index if not exists cash_movements_site_time_idx on public.cash_register_movements(site_id,created_at desc);
create index if not exists store_audit_site_time_idx on public.store_audit_events(site_id,created_at desc);
create index if not exists store_audit_entity_idx on public.store_audit_events(entity_type,entity_id,created_at desc);
create index if not exists store_audit_actor_idx on public.store_audit_events(site_id,actor_user_id,created_at desc);
create index if not exists store_alerts_site_status_time_idx on public.store_alerts(site_id,status,created_at desc);
create index if not exists store_alerts_severity_time_idx on public.store_alerts(site_id,severity,created_at desc);

alter table public.store_audit_events enable row level security;
alter table public.store_alerts enable row level security;
alter table public.cash_register_sessions enable row level security;
alter table public.cash_register_movements enable row level security;

drop policy if exists store_audit_owner_read on public.store_audit_events;
create policy store_audit_owner_read on public.store_audit_events for select to authenticated using (
 exists(select 1 from public.sites s where s.id=store_audit_events.site_id and private.has_workspace_access(s.workspace_id,array['admin']::text[]))
);
drop policy if exists store_alerts_owner_read on public.store_alerts;
create policy store_alerts_owner_read on public.store_alerts for select to authenticated using (
 exists(select 1 from public.sites s where s.id=store_alerts.site_id and private.has_workspace_access(s.workspace_id,array['admin']::text[]))
);
drop policy if exists store_alerts_owner_update on public.store_alerts;
create policy store_alerts_owner_update on public.store_alerts for update to authenticated using (
 exists(select 1 from public.sites s where s.id=store_alerts.site_id and private.has_workspace_access(s.workspace_id,array['admin']::text[]))
) with check (
 exists(select 1 from public.sites s where s.id=store_alerts.site_id and private.has_workspace_access(s.workspace_id,array['admin']::text[]))
);
drop policy if exists cash_sessions_member_read on public.cash_register_sessions;
create policy cash_sessions_member_read on public.cash_register_sessions for select to authenticated using (
 exists(select 1 from public.sites s where s.id=cash_register_sessions.site_id and private.has_workspace_access(s.workspace_id,null::text[]))
);
drop policy if exists cash_sessions_member_insert on public.cash_register_sessions;
create policy cash_sessions_member_insert on public.cash_register_sessions for insert to authenticated with check (
 opened_by=auth.uid() and exists(select 1 from public.sites s where s.id=cash_register_sessions.site_id and private.has_workspace_access(s.workspace_id,array['admin','editor','publisher']::text[]))
);
drop policy if exists cash_sessions_owner_or_opener_update on public.cash_register_sessions;
create policy cash_sessions_owner_or_opener_update on public.cash_register_sessions for update to authenticated using (
 opened_by=auth.uid() or exists(select 1 from public.sites s where s.id=cash_register_sessions.site_id and private.has_workspace_access(s.workspace_id,array['admin']::text[]))
) with check (
 opened_by=auth.uid() or exists(select 1 from public.sites s where s.id=cash_register_sessions.site_id and private.has_workspace_access(s.workspace_id,array['admin']::text[]))
);
drop policy if exists cash_movements_member_read on public.cash_register_movements;
create policy cash_movements_member_read on public.cash_register_movements for select to authenticated using (
 exists(select 1 from public.sites s where s.id=cash_register_movements.site_id and private.has_workspace_access(s.workspace_id,null::text[]))
);
drop policy if exists cash_movements_member_insert on public.cash_register_movements;
create policy cash_movements_member_insert on public.cash_register_movements for insert to authenticated with check (
 actor_user_id=auth.uid() and exists(select 1 from public.sites s where s.id=cash_register_movements.site_id and private.has_workspace_access(s.workspace_id,array['admin','editor','publisher']::text[]))
);

create or replace function private.capture_store_audit_event()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare v_site_id uuid; v_actor uuid; v_old jsonb; v_new jsonb; v_entity_id uuid; v_event text; v_summary text;
begin
 if TG_OP='DELETE' then v_old:=to_jsonb(OLD); else v_old:=null; end if;
 if TG_OP in ('INSERT','UPDATE') then v_new:=to_jsonb(NEW); else v_new:=null; end if;
 if TG_OP='DELETE' then v_entity_id:=nullif(v_old->>'id','')::uuid; v_site_id:=nullif(v_old->>'site_id','')::uuid;
 else v_entity_id:=nullif(v_new->>'id','')::uuid; v_site_id:=nullif(v_new->>'site_id','')::uuid; end if;
 if v_site_id is null and TG_TABLE_NAME='product_variants' then
  select p.site_id into v_site_id from public.products p where p.id=coalesce(nullif(v_new->>'product_id','')::uuid,nullif(v_old->>'product_id','')::uuid);
 end if;
 if v_site_id is null and TG_TABLE_NAME='payment_transactions' then
  select o.site_id into v_site_id from public.orders o where o.id=coalesce(nullif(v_new->>'order_id','')::uuid,nullif(v_old->>'order_id','')::uuid);
 end if;
 if v_site_id is null and TG_TABLE_NAME='shipments' then
  select o.site_id into v_site_id from public.orders o where o.id=coalesce(nullif(v_new->>'order_id','')::uuid,nullif(v_old->>'order_id','')::uuid);
 end if;
 if v_site_id is null then return coalesce(NEW,OLD); end if;
 v_actor:=auth.uid(); v_event:=lower(TG_OP); v_summary:=TG_TABLE_NAME||' '||v_event;
 insert into public.store_audit_events(site_id,actor_user_id,event_type,entity_type,entity_id,summary,before_data,after_data,source)
 values(v_site_id,v_actor,v_event,TG_TABLE_NAME,v_entity_id,v_summary,
  case when v_old is null then null else v_old-'provider_payload'-'shipping_address'-'billing_address'-'customer_email'-'customer_phone' end,
  case when v_new is null then null else v_new-'provider_payload'-'shipping_address'-'billing_address'-'customer_email'-'customer_phone' end,
  'database_trigger');
 return coalesce(NEW,OLD);
end;
$$;
revoke all on function private.capture_store_audit_event() from public,anon,authenticated;
drop trigger if exists audit_products on public.products;
create trigger audit_products after insert or update or delete on public.products for each row execute function private.capture_store_audit_event();
drop trigger if exists audit_product_variants on public.product_variants;
create trigger audit_product_variants after insert or update or delete on public.product_variants for each row execute function private.capture_store_audit_event();
drop trigger if exists audit_inventory_movements on public.inventory_movements;
create trigger audit_inventory_movements after insert or update or delete on public.inventory_movements for each row execute function private.capture_store_audit_event();
drop trigger if exists audit_orders on public.orders;
create trigger audit_orders after insert or update or delete on public.orders for each row execute function private.capture_store_audit_event();
drop trigger if exists audit_payment_transactions on public.payment_transactions;
create trigger audit_payment_transactions after insert or update or delete on public.payment_transactions for each row execute function private.capture_store_audit_event();
drop trigger if exists audit_quotes on public.quotes;
create trigger audit_quotes after insert or update or delete on public.quotes for each row execute function private.capture_store_audit_event();
drop trigger if exists audit_stock_locations on public.stock_locations;
create trigger audit_stock_locations after insert or update or delete on public.stock_locations for each row execute function private.capture_store_audit_event();
drop trigger if exists audit_product_batches on public.product_batches;
create trigger audit_product_batches after insert or update or delete on public.product_batches for each row execute function private.capture_store_audit_event();

create or replace function private.emit_store_alert(
 p_site_id uuid,p_alert_type text,p_severity text,p_title text,p_message text,
 p_entity_type text default null,p_entity_id uuid default null,p_metadata jsonb default '{}'::jsonb
) returns uuid language plpgsql security definer set search_path=''
as $$
declare v_id uuid;
begin
 insert into public.store_alerts(site_id,alert_type,severity,title,message,entity_type,entity_id,metadata)
 values(p_site_id,p_alert_type,p_severity,p_title,p_message,p_entity_type,p_entity_id,coalesce(p_metadata,'{}'::jsonb))
 returning id into v_id;
 return v_id;
end;
$$;
revoke all on function private.emit_store_alert(uuid,text,text,text,text,text,uuid,jsonb) from public,anon,authenticated;
