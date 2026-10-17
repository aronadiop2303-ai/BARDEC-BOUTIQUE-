import type { SupabaseClient } from '@supabase/supabase-js'
import type { SaleLineRequest, SaleResult } from './pos'
import type { PaymentInput } from '../../domain/pos/payments'
import type { OrderDiscount } from '../../domain/pos/sale'
import { toError } from '../errors'
import { sanitizeSearch } from './products'

/**
 * Clients et crédit (migration customers_credit). Écritures uniquement par fonctions SQL ; soldes, relevé et
 * ancienneté calculés par la base.
 */

const NOT_INSTALLED = new Set(['PGRST202', 'PGRST205', '42P01', '42883'])

export class CustomersNotInstalledError extends Error {
  constructor() {
    super('Les fiches clients ne sont pas encore activées : la migration customers_credit n’est pas appliquée à la base.')
  }
}

function fail(error: { code?: string; message: string }): never {
  if (error.code && NOT_INSTALLED.has(error.code)) throw new CustomersNotInstalledError()
  if (error.code && ['42501', '22023', '23505', '23514'].includes(error.code)) throw Object.assign(new Error(error.message), { code: error.code })
  throw toError(error)
}

export type Customer = {
  id: string
  name: string
  phone: string | null
  address: string | null
  credit_limit: number
  is_active: boolean
}

export async function listCustomers(client: SupabaseClient, siteId: string, search = ''): Promise<Customer[]> {
  let query = client.from('store_customers').select('id,name,phone,address,credit_limit,is_active').eq('site_id', siteId)
  const term = sanitizeSearch(search)
  if (term) query = query.or(`name.ilike.*${term}*,phone.ilike.*${term}*`)
  const { data, error } = await query.order('name').limit(100)
  if (error) fail(error)
  return ((data ?? []) as Customer[]).map((c) => ({ ...c, credit_limit: Number(c.credit_limit) }))
}

export async function saveCustomer(
  client: SupabaseClient, siteId: string,
  input: { id: string | null; name: string; phone: string; address: string; creditLimit: number | null; isActive?: boolean },
): Promise<string> {
  const { data, error } = await client.rpc('save_customer', {
    p_site_id: siteId,
    p_customer_id: input.id,
    p_name: input.name.trim(),
    p_phone: input.phone.trim() || null,
    p_address: input.address.trim() || null,
    p_credit_limit: input.creditLimit,
    p_is_active: input.isActive ?? true,
  })
  if (error) fail(error)
  return data as string
}

export type Receivable = {
  customer_id: string
  name: string
  phone: string | null
  credit_limit: number
  balance: number
  oldest_unpaid_at: string | null
  days_outstanding: number
}

export async function listReceivables(client: SupabaseClient, siteId: string): Promise<Receivable[]> {
  const { data, error } = await client.rpc('customer_receivables', { p_site_id: siteId })
  if (error) fail(error)
  return ((data ?? []) as Receivable[]).map((r) => ({ ...r, balance: Number(r.balance), credit_limit: Number(r.credit_limit), days_outstanding: Number(r.days_outstanding) }))
    .sort((a, b) => b.days_outstanding - a.days_outstanding || b.balance - a.balance)
}

export type StatementEntry = {
  date: string
  type: 'credit_sale' | 'payment'
  document_number: string | null
  method: string | null
  reference: string | null
  note: string | null
  override_reason: string | null
  debit: number
  credit: number
  balance: number
}

export type Statement = {
  customer: { id: string; name: string; phone: string | null; address: string | null; credit_limit: number }
  entries: StatementEntry[]
  balance: number
  generated_at: string
}

export async function getStatement(client: SupabaseClient, siteId: string, customerId: string): Promise<Statement> {
  const { data, error } = await client.rpc('customer_statement', { p_site_id: siteId, p_customer_id: customerId })
  if (error) fail(error)
  const statement = data as Statement
  return {
    ...statement,
    balance: Number(statement.balance),
    customer: { ...statement.customer, credit_limit: Number(statement.customer.credit_limit) },
    entries: statement.entries.map((e) => ({ ...e, debit: Number(e.debit), credit: Number(e.credit), balance: Number(e.balance) })),
  }
}

export async function recordCustomerPayment(
  client: SupabaseClient, siteId: string,
  input: { customerId: string; amount: number; method: 'cash' | 'wave' | 'orange_money' | 'card'; sessionId: string | null; reference: string; note: string },
): Promise<{ balance: number }> {
  const { data, error } = await client.rpc('record_customer_payment', {
    p_site_id: siteId,
    p_customer_id: input.customerId,
    p_amount: input.amount,
    p_method: input.method,
    p_cash_session_id: input.sessionId,
    p_reference: input.reference.trim() || null,
    p_note: input.note.trim() || null,
  })
  if (error) fail(error)
  return { balance: Number((data as { balance: number }).balance) }
}

export type CreditSaleResult = SaleResult & { customer_id: string; credit_amount: number; customer_balance: number; credit_limit: number; limit_overridden: boolean }

/** Vente à crédit : la base contrôle la fiche et le plafond, puis enregistre la vente par record_sale. */
export async function recordCreditSale(
  client: SupabaseClient,
  input: { siteId: string; sessionId: string; customerId: string; lines: SaleLineRequest[]; payments: PaymentInput[]; discount: OrderDiscount | { reason: string } | null; overrideReason: string },
): Promise<CreditSaleResult> {
  const { data, error } = await client.rpc('record_credit_sale', {
    p_site_id: input.siteId,
    p_cash_session_id: input.sessionId,
    p_customer_id: input.customerId,
    p_lines: input.lines,
    p_payments: input.payments,
    p_discount: input.discount ?? {},
    p_override_reason: input.overrideReason.trim() || null,
  })
  if (error) fail(error)
  return data as CreditSaleResult
}

/** Solde actuel d'un client (0 s'il n'a aucun impayé), lu dans les impayés calculés par la base. */
export async function customerBalance(client: SupabaseClient, siteId: string, customerId: string): Promise<number> {
  const rows = await listReceivables(client, siteId)
  return rows.find((r) => r.customer_id === customerId)?.balance ?? 0
}
