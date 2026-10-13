
create table if not exists public.store_document_settings (
 id uuid primary key default gen_random_uuid(),
 site_id uuid not null unique references public.sites(id) on delete cascade,
 receipt_enabled boolean not null default true,
 invoice_enabled boolean not null default true,
 quote_enabled boolean not null default true,
 default_paper text not null default 'thermal_80mm' check(default_paper in ('thermal_58mm','thermal_80mm','a4')),
 show_logo boolean not null default true,
 show_customer_details boolean not null default true,
 show_cashier_name boolean not null default true,
 footer_text text,
 legal_details jsonb not null default '{}'::jsonb,
 updated_by uuid references auth.users(id) on delete set null,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create table if not exists public.store_documents (
 id uuid primary key default gen_random_uuid(),
 site_id uuid not null references public.sites(id) on delete cascade,
 order_id uuid references public.orders(id) on delete restrict,
 quote_id uuid references public.quotes(id) on delete restrict,
 document_type text not null check(document_type in ('receipt','invoice','credit_note','quote','delivery_note')),
 document_number text not null,
 status text not null default 'issued' check(status in ('draft','issued','void')),
 currency_code text not null default 'XOF' check(currency_code ~ '^[A-Z]{3}$'),
 total_amount numeric(14,2) not null default 0 check(total_amount>=0),
 content_snapshot jsonb not null default '{}'::jsonb,
 issued_by uuid references auth.users(id) on delete set null,
 issued_at timestamptz not null default now(),
 voided_at timestamptz,
 void_reason text,
 created_at timestamptz not null default now(),
 unique(site_id,document_type,document_number),
 check((order_id is not null)::int + (quote_id is not null)::int <= 1)
);
create index if not exists store_documents_site_issued_idx on public.store_documents(site_id,issued_at desc);
create index if not exists store_documents_order_idx on public.store_documents(order_id) where order_id is not null;
create index if not exists store_documents_quote_idx on public.store_documents(quote_id) where quote_id is not null;
alter table public.store_document_settings enable row level security;
alter table public.store_documents enable row level security;

create policy store_document_settings_member_read on public.store_document_settings for select to authenticated using (
 exists(select 1 from public.sites s where s.id=store_document_settings.site_id and private.has_workspace_access(s.workspace_id,null::text[]))
);
create policy store_document_settings_admin_write on public.store_document_settings for all to authenticated using (
 exists(select 1 from public.sites s where s.id=store_document_settings.site_id and private.has_workspace_access(s.workspace_id,array['admin']::text[]))
) with check (
 exists(select 1 from public.sites s where s.id=store_document_settings.site_id and private.has_workspace_access(s.workspace_id,array['admin']::text[]))
);
create policy store_documents_member_read on public.store_documents for select to authenticated using (
 exists(select 1 from public.sites s where s.id=store_documents.site_id and private.has_workspace_access(s.workspace_id,null::text[]))
);
