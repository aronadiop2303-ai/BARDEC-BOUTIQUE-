import type { SupabaseClient } from '@supabase/supabase-js'
import type { Granularity } from '../../domain/reports/reports'
import { toError } from '../errors'

/** Rapports et alertes (migration alerts_reports) : tous les montants sont calculés par la base. */

const NOT_INSTALLED = new Set(['PGRST202', 'PGRST205', '42P01', '42883'])

export class ReportsNotInstalledError extends Error {
  constructor() {
    super('Les rapports ne sont pas encore activés : la migration alerts_reports n’est pas appliquée à la base.')
  }
}

function fail(error: { code?: string; message: string }): never {
  if (error.code && NOT_INSTALLED.has(error.code)) throw new ReportsNotInstalledError()
  if (error.code && ['42501', '22023'].includes(error.code)) throw Object.assign(new Error(error.message), { code: error.code })
  throw toError(error)
}

const nums = <T extends Record<string, unknown>>(row: T, keys: (keyof T)[]): T => {
  const copy = { ...row }
  for (const key of keys) copy[key] = Number(row[key]) as T[keyof T]
  return copy
}

export type SalesRow = { period: string; sales_count: number; gross_total: number; returns_total: number; net_total: number }
export type TopProduct = { product_id: string; product_name: string; unit_label: string | null; quantity_sold: number; quantity_returned: number; revenue: number }
export type SellerRow = { cashier_id: string | null; cashier_name: string; sales_count: number; total: number }
export type Margin = { cost_basis: string; revenue_with_cost: number; cost: number; margin: number; revenue_without_cost: number; products_without_cost: number }
export type RestockRow = { product_id: string; product_name: string; sku: string | null; unit_label: string | null; stock: number; min_quantity: number; suggested_quantity: number }

export async function salesReport(client: SupabaseClient, siteId: string, from: string, to: string, granularity: Granularity): Promise<SalesRow[]> {
  const { data, error } = await client.rpc('sales_report', { p_site_id: siteId, p_from: from, p_to: to, p_granularity: granularity })
  if (error) fail(error)
  return ((data ?? []) as SalesRow[]).map((r) => nums(r, ['sales_count', 'gross_total', 'returns_total', 'net_total']))
}

export async function topProducts(client: SupabaseClient, siteId: string, from: string, to: string): Promise<TopProduct[]> {
  const { data, error } = await client.rpc('top_products', { p_site_id: siteId, p_from: from, p_to: to, p_limit: 20 })
  if (error) fail(error)
  return ((data ?? []) as TopProduct[]).map((r) => nums(r, ['quantity_sold', 'quantity_returned', 'revenue']))
}

export async function salesBySeller(client: SupabaseClient, siteId: string, from: string, to: string): Promise<SellerRow[]> {
  const { data, error } = await client.rpc('sales_by_seller', { p_site_id: siteId, p_from: from, p_to: to })
  if (error) fail(error)
  return ((data ?? []) as SellerRow[]).map((r) => nums(r, ['sales_count', 'total']))
}

export async function marginReport(client: SupabaseClient, siteId: string, from: string, to: string): Promise<Margin> {
  const { data, error } = await client.rpc('margin_report', { p_site_id: siteId, p_from: from, p_to: to })
  if (error) fail(error)
  return nums(data as Margin, ['revenue_with_cost', 'cost', 'margin', 'revenue_without_cost', 'products_without_cost'])
}

export async function restockList(client: SupabaseClient, siteId: string): Promise<RestockRow[]> {
  const { data, error } = await client.rpc('restock_list', { p_site_id: siteId })
  if (error) fail(error)
  return ((data ?? []) as RestockRow[]).map((r) => nums(r, ['stock', 'min_quantity', 'suggested_quantity']))
}

export async function setStockThreshold(client: SupabaseClient, productId: string, min: number | null, reorder: number | null): Promise<void> {
  const { error } = await client.rpc('set_stock_threshold', { p_product_id: productId, p_min_quantity: min, p_reorder_quantity: reorder })
  if (error) fail(error)
}

export function downloadCsv(filename: string, content: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
