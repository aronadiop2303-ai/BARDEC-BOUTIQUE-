import type { SupabaseClient } from '@supabase/supabase-js'
import type { PriceTier } from '../../domain/hardware/pricing'
import type { SellUnit } from '../../domain/hardware/units'
import type { PaymentInput } from '../../domain/pos/payments'
import { isReceiptSnapshot, type ReceiptSnapshot } from '../../domain/pos/receipt'
import type { OrderDiscount } from '../../domain/pos/sale'
import type { Breakdown, ManualCashType } from '../../domain/pos/cashMovements'
import type { Disposition, RefundMethod, ReturnableLine } from '../../domain/pos/returns'
import { isUniqueViolation, toError, type DbError } from '../errors'
import { sanitizeSearch } from './products'

/**
 * Accès aux ventes en caisse. Toute écriture de vente passe par les fonctions SQL de la migration
 * pos_sales_foundation (record_sale, void_sale, close_cash_session) : les montants sont recalculés par la base.
 * Ouverture de caisse : fonction open_cash_session (migration pos_cash_lockdown) ; tant qu'elle n'existe pas,
 * insertion directe, encore autorisée par la RLS actuelle de cash_register_sessions.
 */

/** Codes renvoyés quand la fonction ou la table de la migration n'existe pas encore. */
const NOT_INSTALLED = new Set(['PGRST202', 'PGRST205', '42P01', '42883'])

export class PosNotInstalledError extends Error {
  constructor() {
    super('Les ventes en caisse ne sont pas encore activées : la migration pos_sales_foundation n’est pas appliquée à la base.')
  }
}

/** Messages des fonctions SQL : déjà rédigés en français pour la caisse, on les affiche tels quels. */
function rpcError(error: DbError): Error {
  if (error.code && NOT_INSTALLED.has(error.code)) return new PosNotInstalledError()
  if (error.code && ['42501', '22023', '23514', 'P0001'].includes(error.code)) return Object.assign(new Error(error.message), { code: error.code })
  return toError(error)
}

/** Détecte la présence de la migration (table document_counters). */
export async function isPosInstalled(client: SupabaseClient): Promise<boolean> {
  const { error } = await client.from('document_counters').select('site_id', { head: true, count: 'exact' }).limit(1)
  if (!error) return true
  if (error.code && NOT_INSTALLED.has(error.code)) return false
  throw toError(error)
}

// ── Session de caisse ────────────────────────────────────────────────────────

export type CashSession = {
  id: string
  register_name: string
  status: string
  opening_cash: number
  opened_at: string
  opened_by: string
}

export async function getOpenSession(client: SupabaseClient, siteId: string): Promise<CashSession | null> {
  const { data, error } = await client.from('cash_register_sessions')
    .select('id,register_name,status,opening_cash,opened_at,opened_by')
    .eq('site_id', siteId).eq('status', 'open').order('opened_at', { ascending: false }).limit(1).maybeSingle()
  if (error) throw toError(error)
  return data ? { ...(data as CashSession), opening_cash: Number((data as CashSession).opening_cash) } : null
}

export async function openSession(client: SupabaseClient, siteId: string, userId: string, openingCash: number, note: string): Promise<void> {
  if (!Number.isInteger(openingCash) || openingCash < 0) throw new Error('Le fond de caisse doit être un montant entier positif ou nul.')
  const viaFunction = await client.rpc('open_cash_session', { p_site_id: siteId, p_opening_cash: openingCash, p_note: note.trim() || null })
  if (!viaFunction.error) return
  if (viaFunction.error.code === '23505') throw new Error('Une caisse est déjà ouverte pour cette boutique.')
  if (!['PGRST202', '42883'].includes(viaFunction.error.code ?? '')) throw rpcError(viaFunction.error)
  const { error } = await client.from('cash_register_sessions').insert({
    site_id: siteId, opened_by: userId, opening_cash: openingCash, opening_note: note.trim() || null,
  })
  if (isUniqueViolation(error)) throw new Error('Une caisse est déjà ouverte pour cette boutique.')
  if (error) throw toError(error)
}

export type SessionSummary = {
  session_id: string
  register_name: string
  status: string
  opened_at: string
  closed_at: string | null
  currency: string
  opening_cash: number
  cash_in: number
  cash_out: number
  corrections_excluded: number
  expected_cash: number
  counted_cash: number | null
  discrepancy: number | null
  by_method: Record<string, { count: number; amount: number }>
  sales_count: number
  voided_count: number
}

export async function sessionSummary(client: SupabaseClient, sessionId: string): Promise<SessionSummary> {
  const { data, error } = await client.rpc('cash_session_summary', { p_session_id: sessionId })
  if (error) throw rpcError(error)
  return data as SessionSummary
}

export async function closeSession(client: SupabaseClient, sessionId: string, countedCash: number, note: string): Promise<SessionSummary> {
  if (!Number.isInteger(countedCash) || countedCash < 0) throw new Error('Le montant compté doit être un entier positif ou nul.')
  const { data, error } = await client.rpc('close_cash_session', { p_session_id: sessionId, p_counted_cash: countedCash, p_note: note.trim() || null })
  if (error) throw rpcError(error)
  return data as SessionSummary
}

// ── Produits vendables ───────────────────────────────────────────────────────

export type SaleProduct = {
  id: string
  name: string
  sku: string | null
  barcode: string | null
  price: number
  currency_code: string
  track_inventory: boolean
  sellUnits: (SellUnit & { id: string })[]
  tiers: PriceTier[]
}

/** Recherche par nom, référence ou code-barres exact ; le code-barres exact passe en tête. */
export async function searchSaleProducts(client: SupabaseClient, siteId: string, text: string): Promise<SaleProduct[]> {
  const term = sanitizeSearch(text)
  if (!term) return []
  const { data, error } = await client.from('products')
    .select('id,name,sku,barcode,price,currency_code,track_inventory')
    .eq('site_id', siteId).eq('status', 'active')
    .or(`name.ilike.*${term}*,sku.ilike.*${term}*,barcode.eq.${term}`)
    .order('name').limit(20)
  if (error) throw toError(error)
  const rows = (data ?? []) as Omit<SaleProduct, 'sellUnits' | 'tiers'>[]
  if (rows.length === 0) return []
  const ids = rows.map((r) => r.id)
  const [units, tiers] = await Promise.all([
    client.from('product_sell_units').select('id,product_id,unit_id,conversion_to_base,is_default,min_sale_quantity,quantity_step').in('product_id', ids),
    client.from('price_tiers').select('product_id,unit_id,min_quantity,unit_price,valid_from,valid_until').in('product_id', ids).is('variant_id', null),
  ])
  if (units.error) throw toError(units.error)
  if (tiers.error) throw toError(tiers.error)
  const num = (v: unknown) => Number(v)
  const products = rows.map((row) => ({
    ...row,
    price: num(row.price),
    sellUnits: ((units.data ?? []) as (SellUnit & { id: string; product_id: string })[])
      .filter((u) => u.product_id === row.id)
      .map((u) => ({ id: u.id, unit_id: u.unit_id, conversion_to_base: num(u.conversion_to_base), is_default: u.is_default, min_sale_quantity: num(u.min_sale_quantity), quantity_step: num(u.quantity_step) })),
    tiers: ((tiers.data ?? []) as (PriceTier & { product_id: string })[])
      .filter((t) => t.product_id === row.id)
      .map((t) => ({ unit_id: t.unit_id, min_quantity: num(t.min_quantity), unit_price: num(t.unit_price), valid_from: t.valid_from, valid_until: t.valid_until })),
  }))
  return products.sort((a, b) => Number(b.barcode === term) - Number(a.barcode === term))
}

/**
 * Réglages de caisse lus pour l'affichage (sites.settings.pos) : limite de remise et plafond de dépense du vendeur.
 * La base applique elle-même ces limites.
 */
export async function getPosSettings(client: SupabaseClient, siteId: string): Promise<{ editorMaxDiscountPercent: unknown; cashierMaxExpense: unknown; cashierMaxReturn: unknown }> {
  const { data, error } = await client.from('sites').select('settings').eq('id', siteId).maybeSingle()
  if (error) throw toError(error)
  const settings = (data as { settings?: { pos?: { editor_max_discount_percent?: unknown; cashier_max_expense_amount?: unknown; cashier_max_return_amount?: unknown } } } | null)?.settings
  return {
    editorMaxDiscountPercent: settings?.pos?.editor_max_discount_percent ?? 0,
    cashierMaxExpense: settings?.pos?.cashier_max_expense_amount ?? 0,
    cashierMaxReturn: settings?.pos?.cashier_max_return_amount ?? 0,
  }
}

// ── Vente ────────────────────────────────────────────────────────────────────

/** Ligne envoyée à la base : aucun prix, seulement le produit, l'unité, la quantité et la remise de ligne. */
export type SaleLineRequest = { product_id: string; unit_id: string; quantity: number; discount?: number }

export type SaleRequest = {
  siteId: string
  sessionId: string
  lines: SaleLineRequest[]
  payments: PaymentInput[]
  customer: { name?: string; phone?: string }
  /** Remise globale, ou seulement le motif quand il n'y a que des remises de ligne. */
  discount: OrderDiscount | { reason: string }
}

export type SaleResult = {
  order_id: string
  document_id: string
  document_number: string
  grand_total: number
  change_given: number
  snapshot: ReceiptSnapshot
}

export async function recordSale(client: SupabaseClient, request: SaleRequest): Promise<SaleResult> {
  const { data, error } = await client.rpc('record_sale', {
    p_site_id: request.siteId,
    p_cash_session_id: request.sessionId,
    p_lines: request.lines,
    p_payments: request.payments,
    p_customer: { name: request.customer.name?.trim() || null, phone: request.customer.phone?.trim() || null },
    p_discount: request.discount ?? {},
  })
  if (error) throw rpcError(error)
  return data as SaleResult
}

export type VoidResult = {
  order_id: string
  stock_movements_reversed: number
  documents_voided: number
  cash_refund: number
  cash_refund_recorded: boolean
  cash_session_closed: boolean
}

export async function voidSale(client: SupabaseClient, orderId: string, reason: string): Promise<VoidResult> {
  if (reason.trim().length < 3) throw new Error('Le motif d’annulation est obligatoire (3 caractères au moins).')
  const { data, error } = await client.rpc('void_sale', { p_order_id: orderId, p_reason: reason.trim() })
  if (error) throw rpcError(error)
  return data as VoidResult
}

// ── Historique ───────────────────────────────────────────────────────────────

export type SaleDocument = {
  id: string
  /** 'receipt' (ticket de vente) ou 'credit_note' (avoir d'un retour). */
  document_type: 'receipt' | 'credit_note'
  order_id: string | null
  document_number: string
  status: 'draft' | 'issued' | 'void'
  total_amount: number
  issued_at: string
  void_reason: string | null
  snapshot: ReceiptSnapshot | null
}

export type SalesFilter = {
  /** Début inclus et fin exclue, instants ISO (voir domain/pos/history.dayRange). */
  from: string
  to: string
  /** Numéro ou partie de numéro, déjà normalisé (lettres, chiffres, tirets). */
  number?: string
}

export const SALES_HISTORY_LIMIT = 200

/** Tickets et avoirs de la période, du plus récent au plus ancien ; recherche facultative par numéro. */
export async function listSales(client: SupabaseClient, siteId: string, filter: SalesFilter): Promise<SaleDocument[]> {
  let query = client.from('store_documents')
    .select('id,document_type,order_id,document_number,status,total_amount,issued_at,void_reason,content_snapshot')
    .eq('site_id', siteId).in('document_type', ['receipt', 'credit_note'])
    .gte('issued_at', filter.from).lt('issued_at', filter.to)
  const number = filter.number?.replace(/[^A-Z0-9-]/g, '')
  if (number) query = query.ilike('document_number', `%${number}%`)
  const { data, error } = await query.order('issued_at', { ascending: false }).limit(SALES_HISTORY_LIMIT)
  if (error) throw toError(error)
  return ((data ?? []) as (Omit<SaleDocument, 'snapshot'> & { content_snapshot: unknown })[]).map(({ content_snapshot, ...row }) => ({
    ...row,
    total_amount: Number(row.total_amount),
    snapshot: isReceiptSnapshot(content_snapshot) ? content_snapshot : null,
  }))
}

// ── Mouvements de caisse manuels (migration cash_movements) ─────────────────

export type CashMovement = {
  id: string
  movement_type: string
  amount: number
  reason: string | null
  created_at: string
  actor_user_id: string | null
  receipt_ref: string | null
}

export async function recordCashMovement(
  client: SupabaseClient,
  input: { siteId: string; sessionId: string; type: ManualCashType; amount: number; reason: string; receiptRef: string },
): Promise<{ movement_id: string; expected_cash: number }> {
  const { data, error } = await client.rpc('record_cash_movement', {
    p_site_id: input.siteId,
    p_session_id: input.sessionId,
    p_movement_type: input.type,
    p_amount: input.amount,
    p_reason: input.reason.trim(),
    p_receipt_ref: input.receiptRef.trim() || null,
  })
  if (error) throw rpcError(error)
  return data as { movement_id: string; expected_cash: number }
}

/** Mouvements de la session, du plus récent au plus ancien, avec la référence du justificatif s'il y en a une. */
export async function listSessionMovements(client: SupabaseClient, sessionId: string): Promise<CashMovement[]> {
  const { data, error } = await client.from('cash_register_movements')
    .select('id,movement_type,amount,reason,created_at,actor_user_id,cash_movement_details(receipt_ref)')
    .eq('session_id', sessionId).order('created_at', { ascending: false }).limit(200)
  if (error) {
    if (error.code && NOT_INSTALLED.has(error.code)) throw new PosNotInstalledError()
    // Relation absente (migration cash_movements non appliquée) : relecture sans les détails.
    if (error.code === 'PGRST200') {
      const plain = await client.from('cash_register_movements').select('id,movement_type,amount,reason,created_at,actor_user_id')
        .eq('session_id', sessionId).order('created_at', { ascending: false }).limit(200)
      if (plain.error) throw toError(plain.error)
      return ((plain.data ?? []) as Omit<CashMovement, 'receipt_ref'>[]).map((m) => ({ ...m, amount: Number(m.amount), receipt_ref: null }))
    }
    throw toError(error)
  }
  type Row = Omit<CashMovement, 'receipt_ref'> & { cash_movement_details: { receipt_ref: string | null } | { receipt_ref: string | null }[] | null }
  return ((data ?? []) as Row[]).map(({ cash_movement_details: details, ...m }) => ({
    ...m,
    amount: Number(m.amount),
    receipt_ref: (Array.isArray(details) ? details[0]?.receipt_ref : details?.receipt_ref) ?? null,
  }))
}

/** Totaux par type calculés par la base ; null si la fonction n'existe pas encore. */
export async function sessionBreakdown(client: SupabaseClient, sessionId: string): Promise<Breakdown | null> {
  const { data, error } = await client.rpc('cash_session_breakdown', { p_session_id: sessionId })
  if (error) {
    if (error.code && NOT_INSTALLED.has(error.code)) return null
    throw rpcError(error)
  }
  return (data ?? {}) as Breakdown
}

// ── Retours (migration sale_returns) ────────────────────────────────────────

export async function getReturnableLines(client: SupabaseClient, orderId: string): Promise<ReturnableLine[]> {
  const { data, error } = await client.rpc('returnable_lines', { p_order_id: orderId })
  if (error) throw rpcError(error)
  return ((data ?? []) as ReturnableLine[]).map((l) => ({
    ...l,
    decimal_places: Number(l.decimal_places),
    quantity_sold: Number(l.quantity_sold),
    quantity_returned: Number(l.quantity_returned),
    quantity_returnable: Number(l.quantity_returnable),
    unit_refund: Number(l.unit_refund),
  }))
}

export type ReturnResult = { return_id: string; document_number: string; refund_amount: number; refund_method: RefundMethod; snapshot: ReceiptSnapshot }

export async function recordReturn(
  client: SupabaseClient,
  input: { siteId: string; orderId: string; lines: { order_item_id: string; quantity: number; disposition: Disposition }[]; reason: string; method: RefundMethod; sessionId: string | null },
): Promise<ReturnResult> {
  const { data, error } = await client.rpc('record_return', {
    p_site_id: input.siteId,
    p_order_id: input.orderId,
    p_lines: input.lines,
    p_reason: input.reason.trim(),
    p_refund_method: input.method,
    p_cash_session_id: input.sessionId,
  })
  if (error) throw rpcError(error)
  return data as ReturnResult
}
