import type { SupabaseClient } from '@supabase/supabase-js'
import type { ReceivableLine } from '../../domain/purchases/purchases'
import { toError } from '../errors'

/**
 * Fournisseurs et achats (migration suppliers_purchases). Écritures par fonctions SQL. Les coûts ne sont lus que
 * par le propriétaire et le gérant (RLS) ; le magasinier utilise receivable_* (sans coût ni montant).
 */

const NOT_INSTALLED = new Set(['PGRST202', 'PGRST205', '42P01', '42883'])

export class PurchasesNotInstalledError extends Error {
  constructor() {
    super('Les achats ne sont pas encore activés : la migration suppliers_purchases n’est pas appliquée à la base.')
  }
}

function fail(error: { code?: string; message: string }): never {
  if (error.code && NOT_INSTALLED.has(error.code)) throw new PurchasesNotInstalledError()
  if (error.code && ['42501', '22023', '23505', '23514'].includes(error.code)) throw Object.assign(new Error(error.message), { code: error.code })
  throw toError(error)
}

export type Supplier = { id: string; name: string; phone: string | null; address: string | null; notes: string | null; is_active: boolean }

export async function listSuppliers(client: SupabaseClient, siteId: string): Promise<Supplier[]> {
  const { data, error } = await client.from('suppliers').select('id,name,phone,address,notes,is_active').eq('site_id', siteId).order('name')
  if (error) fail(error)
  return (data ?? []) as Supplier[]
}

export async function saveSupplier(client: SupabaseClient, siteId: string, input: Omit<Supplier, 'id'> & { id: string | null }): Promise<string> {
  const { data, error } = await client.rpc('save_supplier', {
    p_site_id: siteId, p_supplier_id: input.id, p_name: input.name.trim(), p_phone: input.phone?.trim() || null,
    p_address: input.address?.trim() || null, p_notes: input.notes?.trim() || null, p_is_active: input.is_active,
  })
  if (error) fail(error)
  return data as string
}

export type PurchaseOrder = {
  id: string
  number: string
  status: string
  total_amount: number
  created_at: string
  note: string | null
  supplier_id: string
  supplier: { name: string } | null
  lines: { id: string; product_name: string; unit_label: string | null; quantity: number; received_quantity: number; unit_cost: number }[]
}

/** Bons de commande avec lignes et coûts : propriétaire et gérant seulement (RLS). */
export async function listPurchaseOrders(client: SupabaseClient, siteId: string): Promise<PurchaseOrder[]> {
  const { data, error } = await client.from('purchase_orders')
    .select('id,number,status,total_amount,created_at,note,supplier_id,supplier:suppliers(name),lines:purchase_order_lines(id,product_name,unit_label,quantity,received_quantity,unit_cost)')
    .eq('site_id', siteId).order('created_at', { ascending: false }).limit(100)
  if (error) fail(error)
  return ((data ?? []) as unknown as PurchaseOrder[]).map((po) => ({
    ...po,
    total_amount: Number(po.total_amount),
    lines: (po.lines ?? []).map((l) => ({ ...l, quantity: Number(l.quantity), received_quantity: Number(l.received_quantity), unit_cost: Number(l.unit_cost) })),
  }))
}

export async function createPurchaseOrder(
  client: SupabaseClient, siteId: string, supplierId: string, lines: { product_id: string; quantity: number; unit_cost: number }[], note: string,
): Promise<{ number: string; total_amount: number }> {
  const { data, error } = await client.rpc('create_purchase_order', { p_site_id: siteId, p_supplier_id: supplierId, p_lines: lines, p_note: note.trim() || null })
  if (error) fail(error)
  return data as { number: string; total_amount: number }
}

export async function cancelPurchaseOrder(client: SupabaseClient, poId: string, reason: string): Promise<void> {
  const { error } = await client.rpc('cancel_purchase_order', { p_purchase_order_id: poId, p_reason: reason.trim() })
  if (error) fail(error)
}

export type ReceivableOrder = { purchase_order_id: string; number: string; supplier_name: string; status: string; created_at: string }

export async function listReceivableOrders(client: SupabaseClient, siteId: string): Promise<ReceivableOrder[]> {
  const { data, error } = await client.rpc('receivable_purchase_orders', { p_site_id: siteId })
  if (error) fail(error)
  return (data ?? []) as ReceivableOrder[]
}

export async function listReceivableLines(client: SupabaseClient, poId: string): Promise<ReceivableLine[]> {
  const { data, error } = await client.rpc('receivable_purchase_lines', { p_purchase_order_id: poId })
  if (error) fail(error)
  return ((data ?? []) as ReceivableLine[]).map((l) => ({
    ...l, decimal_places: Number(l.decimal_places), quantity_ordered: Number(l.quantity_ordered),
    quantity_received: Number(l.quantity_received), quantity_remaining: Number(l.quantity_remaining),
  }))
}

export async function receivePurchase(client: SupabaseClient, poId: string, lines: { line_id: string; quantity: number; location_id: string }[], note: string): Promise<{ status: string; lines_received: number }> {
  const { data, error } = await client.rpc('receive_purchase', { p_purchase_order_id: poId, p_lines: lines, p_note: note.trim() || null })
  if (error) fail(error)
  return data as { status: string; lines_received: number }
}

export type SupplierBalance = { supplier_id: string; name: string; phone: string | null; balance: number; purchases_total: number; payments_total: number }

export async function listSupplierBalances(client: SupabaseClient, siteId: string): Promise<SupplierBalance[]> {
  const { data, error } = await client.rpc('supplier_balances', { p_site_id: siteId })
  if (error) fail(error)
  return ((data ?? []) as SupplierBalance[]).map((b) => ({ ...b, balance: Number(b.balance), purchases_total: Number(b.purchases_total), payments_total: Number(b.payments_total) }))
}

export async function recordSupplierPayment(
  client: SupabaseClient, siteId: string,
  input: { supplierId: string; amount: number; method: string; sessionId: string | null; reference: string; note: string },
): Promise<{ balance: number }> {
  const { data, error } = await client.rpc('record_supplier_payment', {
    p_site_id: siteId, p_supplier_id: input.supplierId, p_amount: input.amount, p_method: input.method,
    p_cash_session_id: input.sessionId, p_reference: input.reference.trim() || null, p_note: input.note.trim() || null,
  })
  if (error) fail(error)
  return { balance: Number((data as { balance: number }).balance) }
}
