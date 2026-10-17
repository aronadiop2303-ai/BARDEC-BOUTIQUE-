import type { SupabaseClient } from '@supabase/supabase-js'
import type { StoreCategory } from '../domain/storefront/storefront'
import { toError } from './errors'

/**
 * Lecture publique de la vitrine : UNIQUEMENT par les fonctions storefront_* (migration public_storefront).
 * Aucune lecture de table brute. Un site non publié renvoie null / [] (sauf aperçu du propriétaire ou gérant connecté).
 */

const NOT_INSTALLED = new Set(['PGRST202', 'PGRST205', '42P01', '42883'])

export class StorefrontNotInstalledError extends Error {
  constructor() {
    super('La boutique en ligne n’est pas encore activée sur ce service.')
  }
}

function fail(error: { code?: string; message: string }): never {
  if (error.code && NOT_INSTALLED.has(error.code)) throw new StorefrontNotInstalledError()
  throw toError(error)
}

export type StoreShop = {
  id: string
  name: string
  phone: string | null
  whatsapp: string | null
  email: string | null
  address: string | null
  city: string | null
  opening_hours: string | null
  currency: string
  published: boolean
}

export type StoreProduct = {
  id: string
  slug: string
  name: string
  category_id: string | null
  price: number
  currency_code: string
  image_url: string | null
  unit_label: string | null
  availability: string
}

export type StoreProductDetail = StoreProduct & {
  category_name: string | null
  description: string | null
  attributes: Record<string, string>
}

export async function getShop(client: SupabaseClient, siteId: string): Promise<StoreShop | null> {
  const { data, error } = await client.rpc('storefront_shop', { p_site_id: siteId })
  if (error) fail(error)
  return (data as StoreShop | null) ?? null
}

export async function getCategories(client: SupabaseClient, siteId: string): Promise<StoreCategory[]> {
  const { data, error } = await client.rpc('storefront_categories', { p_site_id: siteId })
  if (error) fail(error)
  return ((data ?? []) as StoreCategory[]).map((c) => ({ ...c, product_count: Number(c.product_count) }))
}

export const PAGE_SIZE = 24

export async function getProducts(
  client: SupabaseClient, siteId: string, options: { categoryId?: string | null; search?: string; page?: number } = {},
): Promise<StoreProduct[]> {
  const { data, error } = await client.rpc('storefront_products', {
    p_site_id: siteId,
    p_category_id: options.categoryId ?? null,
    p_search: options.search?.trim() || null,
    p_limit: PAGE_SIZE,
    p_offset: (options.page ?? 0) * PAGE_SIZE,
  })
  if (error) fail(error)
  return ((data ?? []) as StoreProduct[]).map((p) => ({ ...p, price: Number(p.price) }))
}

export async function getProduct(client: SupabaseClient, siteId: string, slug: string): Promise<StoreProductDetail | null> {
  const { data, error } = await client.rpc('storefront_product', { p_site_id: siteId, p_slug: slug })
  if (error) fail(error)
  const product = data as StoreProductDetail | null
  return product ? { ...product, price: Number(product.price), attributes: product.attributes ?? {} } : null
}

// ── Publication (espace de gestion) ─────────────────────────────────────────

export async function setPublished(client: SupabaseClient, siteId: string, publish: boolean, confirmName: string): Promise<{ status: string; changed: boolean }> {
  const { data, error } = await client.rpc('set_storefront_published', { p_site_id: siteId, p_publish: publish, p_confirm_name: confirmName })
  if (error) {
    if (error.code && NOT_INSTALLED.has(error.code)) throw new StorefrontNotInstalledError()
    throw Object.assign(new Error(error.message), { code: error.code })
  }
  return data as { status: string; changed: boolean }
}

export async function setProductImage(client: SupabaseClient, productId: string, url: string): Promise<void> {
  const { error } = await client.rpc('set_product_image', { p_product_id: productId, p_url: url.trim() || null })
  if (error) {
    if (error.code && NOT_INSTALLED.has(error.code)) throw new StorefrontNotInstalledError()
    throw Object.assign(new Error(error.message), { code: error.code })
  }
}

/** Adresse publique de la vitrine (routage par hash : aucune règle de réécriture côté hébergeur). */
export function storefrontUrl(siteId: string, origin = typeof window !== 'undefined' ? window.location.origin : ''): string {
  return `${origin}/#/vitrine/${encodeURIComponent(siteId)}`
}
