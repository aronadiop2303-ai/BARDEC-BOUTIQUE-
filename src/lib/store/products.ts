import type { SupabaseClient } from '@supabase/supabase-js'
import { parseMoney } from '../../domain/hardware/money'
import { findDuplicateTier, validatePriceTier, type PriceTier } from '../../domain/hardware/pricing'
import { baseSellUnit, validateSellUnit, type SellUnit } from '../../domain/hardware/units'
import { isUniqueViolation, toError, type DbError } from '../errors'
import { slugify, withSuffix } from '../slugify'
import { checkBarcode, normalizeBarcode } from '../../domain/barcode/barcode'

export type ProductStatus = 'draft' | 'active' | 'archived'

/** Colonnes de public.products lues par la liste. */
export type ProductRow = {
  id: string
  category_id: string | null
  name: string
  slug: string
  status: ProductStatus
  price: number
  currency_code: string
  sku: string | null
  barcode: string | null
  track_inventory: boolean
  updated_at: string
}

export type ProductDetail = ProductRow & {
  description: string | null
  attributes: Record<string, string>
  sellUnits: (SellUnit & { id: string })[]
  tiers: (PriceTier & { id: string })[]
  compatibilities: Compatibility[]
  service: ServiceProfile | null
}

export const RELATION_TYPES = {
  compatible_with: 'Compatible avec',
  replacement_for: 'Remplace / équivalent de',
  accessory_for: 'Accessoire de',
  required_with: 'Nécessaire avec',
  not_compatible_with: 'Incompatible avec',
} as const
export type RelationType = keyof typeof RELATION_TYPES

export type Compatibility = {
  id?: string
  compatible_product_id: string
  compatible_product_name?: string
  relation_type: RelationType
  notes: string | null
}

export type ServiceProfile = {
  id?: string
  warranty_duration_days: number | null
  warranty_terms: string | null
  return_window_days: number | null
}

export const STATUS_LABELS: Record<ProductStatus, string> = { draft: 'Brouillon', active: 'Actif', archived: 'Archivé' }

const LIST_COLUMNS = 'id,category_id,name,slug,status,price,currency_code,sku,barcode,track_inventory,updated_at'
const DETAIL_COLUMNS = `${LIST_COLUMNS},description,attributes`

export type ProductQuery = {
  search?: string
  /** Famille et ses sous-familles. Vide = toutes. */
  categoryIds?: string[]
  /** 'current' = brouillons et actifs (par défaut). */
  status?: ProductStatus | 'current' | 'all'
  page?: number
  pageSize?: number
}

/** Retire les caractères qui ont un sens dans la syntaxe de filtre PostgREST. */
export function sanitizeSearch(text: string): string {
  return text.replace(/[,()*%\\:"'.]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80)
}

/** Liste paginée côté serveur : recherche par nom, référence ou code-barres exact. */
export async function listProducts(client: SupabaseClient, siteId: string, query: ProductQuery = {}): Promise<{ rows: ProductRow[]; total: number }> {
  const pageSize = query.pageSize ?? 20
  const page = Math.max(0, query.page ?? 0)
  let request = client.from('products').select(LIST_COLUMNS, { count: 'exact' }).eq('site_id', siteId)

  const status = query.status ?? 'current'
  if (status === 'current') request = request.in('status', ['draft', 'active'])
  else if (status !== 'all') request = request.eq('status', status)

  if (query.categoryIds && query.categoryIds.length > 0) request = request.in('category_id', query.categoryIds)

  const term = sanitizeSearch(query.search ?? '')
  if (term) request = request.or(`name.ilike.*${term}*,sku.ilike.*${term}*,barcode.eq.${term}`)

  const { data, error, count } = await request.order('name').range(page * pageSize, page * pageSize + pageSize - 1)
  if (error) throw toError(error)
  return { rows: (data ?? []) as ProductRow[], total: count ?? 0 }
}

export async function getProduct(client: SupabaseClient, siteId: string, id: string): Promise<ProductDetail | null> {
  const product = await client.from('products').select(DETAIL_COLUMNS).eq('site_id', siteId).eq('id', id).maybeSingle()
  if (product.error) throw toError(product.error)
  if (!product.data) return null

  const [sellUnits, tiers, compat, service] = await Promise.all([
    client.from('product_sell_units').select('id,unit_id,conversion_to_base,is_default,min_sale_quantity,quantity_step').eq('product_id', id),
    client.from('price_tiers').select('id,unit_id,min_quantity,unit_price,valid_from,valid_until').eq('product_id', id).is('variant_id', null).order('min_quantity'),
    client.from('product_compatibilities').select('id,compatible_product_id,relation_type,notes').eq('product_id', id),
    client.from('product_service_profiles').select('id,warranty_duration_days,warranty_terms,return_window_days').eq('product_id', id).is('variant_id', null).limit(1),
  ])
  for (const result of [sellUnits, tiers, compat, service]) if (result.error) throw toError(result.error)

  const compatibilities = (compat.data ?? []) as Compatibility[]
  if (compatibilities.length > 0) {
    const names = await client.from('products').select('id,name').in('id', compatibilities.map((c) => c.compatible_product_id))
    if (names.error) throw toError(names.error)
    const byId = new Map(((names.data ?? []) as { id: string; name: string }[]).map((row) => [row.id, row.name]))
    for (const item of compatibilities) item.compatible_product_name = byId.get(item.compatible_product_id) ?? 'Produit inaccessible'
  }

  const num = (value: unknown) => Number(value)
  const detail = product.data as ProductDetail
  return {
    ...detail,
    price: num(detail.price),
    attributes: (detail.attributes ?? {}) as Record<string, string>,
    sellUnits: ((sellUnits.data ?? []) as ProductDetail['sellUnits']).map((u) => ({
      ...u, conversion_to_base: num(u.conversion_to_base), min_sale_quantity: num(u.min_sale_quantity), quantity_step: num(u.quantity_step),
    })),
    tiers: ((tiers.data ?? []) as ProductDetail['tiers']).map((t) => ({ ...t, min_quantity: num(t.min_quantity), unit_price: num(t.unit_price) })),
    compatibilities,
    service: ((service.data ?? []) as ServiceProfile[])[0] ?? null,
  }
}

/** Saisie de la fiche produit (valeurs telles que saisies, validées par validateProductDraft). */
export type ProductDraft = {
  name: string
  sku: string
  barcode: string
  categoryId: string | null
  status: ProductStatus
  price: string
  description: string
  trackInventory: boolean
  attributes: Record<string, string>
  sellUnits: (SellUnit & { id?: string })[]
  tiers: (PriceTier & { id?: string })[]
  compatibilities: Compatibility[]
  service: ServiceProfile
}

export function validateProductDraft(draft: ProductDraft): string | null {
  const name = draft.name.trim()
  if (!name) return 'Le nom du produit est obligatoire.'
  if (name.length > 180) return 'Le nom du produit ne doit pas dépasser 180 caractères.'
  if (parseMoney(draft.price) === null) return 'Prix de vente invalide : saisissez un montant entier en FCFA.'
  const barcode = normalizeBarcode(draft.barcode)
  if (barcode) {
    const check = checkBarcode(barcode)
    if (!check.ok) return check.message
  }
  if (draft.sellUnits.length === 0) return 'Ajoutez au moins une unité de vente (l’unité de base, conversion = 1).'
  if (!baseSellUnit(draft.sellUnits)) return 'Une seule unité de vente doit avoir une conversion égale à 1 : c’est l’unité de base.'
  if (new Set(draft.sellUnits.map((u) => u.unit_id)).size !== draft.sellUnits.length) return 'Chaque unité de vente ne peut apparaître qu’une fois.'
  if (draft.sellUnits.filter((u) => u.is_default).length > 1) return 'Une seule unité de vente peut être l’unité par défaut.'
  for (const unit of draft.sellUnits) {
    const problem = validateSellUnit(unit)
    if (problem) return problem
  }
  const sellUnitIds = new Set(draft.sellUnits.map((u) => u.unit_id))
  for (const tier of draft.tiers) {
    const problem = validatePriceTier(tier)
    if (problem) return problem
    if (tier.unit_id && !sellUnitIds.has(tier.unit_id)) return 'Un palier de prix utilise une unité qui n’est pas une unité de vente du produit.'
  }
  if (findDuplicateTier(draft.tiers) !== null) return 'Deux paliers ont la même unité et la même quantité minimale.'
  if (new Set(draft.compatibilities.map((c) => `${c.compatible_product_id}|${c.relation_type}`)).size !== draft.compatibilities.length) {
    return 'Une même relation de compatibilité est saisie deux fois.'
  }
  for (const days of [draft.service.warranty_duration_days, draft.service.return_window_days]) {
    if (days !== null && (!Number.isInteger(days) || days < 0)) return 'Les durées de garantie et de retour sont des nombres de jours positifs.'
  }
  return null
}

function productError(error: DbError): Error {
  if (isUniqueViolation(error) && /sku/i.test(error.message)) return new Error('Cette référence (SKU) est déjà utilisée par un autre produit.')
  if (isUniqueViolation(error) && /barcode/i.test(error.message)) return new Error('Ce code-barres est déjà utilisé par un autre produit de la boutique.')
  return toError(error)
}

const clean = (value: string) => value.trim() || null

/** Synchronise des lignes enfants : supprime celles retirées, met à jour les existantes, insère les nouvelles. */
async function syncChildren<T extends { id?: string }>(
  client: SupabaseClient,
  table: string,
  existingIds: string[],
  rows: T[],
  toRecord: (row: T) => Record<string, unknown>,
): Promise<void> {
  const keep = new Set(rows.filter((row) => row.id).map((row) => row.id as string))
  const removed = existingIds.filter((id) => !keep.has(id))
  if (removed.length > 0) {
    const { error } = await client.from(table).delete().in('id', removed)
    if (error) throw toError(error)
  }
  for (const row of rows.filter((r) => r.id && existingIds.includes(r.id))) {
    const { error } = await client.from(table).update(toRecord(row)).eq('id', row.id as string)
    if (error) throw toError(error)
  }
  const added = rows.filter((row) => !row.id || !existingIds.includes(row.id)).map(toRecord)
  if (added.length > 0) {
    const { error } = await client.from(table).insert(added)
    if (error) throw toError(error)
  }
}

/**
 * Enregistre la fiche produit et ses lignes liées.
 * Limite connue : plusieurs requêtes successives, sans transaction. En cas d'échec au milieu,
 * le produit est enregistré mais certaines lignes liées peuvent manquer (message affiché, relancer corrige).
 * Une fonction SQL transactionnelle est prévue avec la gestion du stock (Q2).
 */
export async function saveProduct(
  client: SupabaseClient,
  siteId: string,
  draft: ProductDraft,
  original: ProductDetail | null,
): Promise<string> {
  const problem = validateProductDraft(draft)
  if (problem) throw new Error(problem)

  const record = {
    name: draft.name.trim(),
    sku: clean(draft.sku),
    barcode: normalizeBarcode(draft.barcode) || null,
    category_id: draft.categoryId,
    status: draft.status,
    price: parseMoney(draft.price) as number,
    description: clean(draft.description),
    track_inventory: draft.trackInventory,
    attributes: Object.fromEntries(Object.entries(draft.attributes).map(([k, v]) => [k, v.trim()]).filter(([, v]) => v)),
  }

  let productId = original?.id
  if (productId) {
    const { error } = await client.from('products').update(record).eq('id', productId).eq('site_id', siteId)
    if (error) throw productError(error)
  } else {
    const base = slugify(record.name, 'produit')
    for (let attempt = 1; attempt <= 5 && !productId; attempt += 1) {
      const { data, error } = await client.from('products')
        .insert({ ...record, site_id: siteId, slug: attempt === 1 ? base : withSuffix(base), product_type: 'physical' })
        .select('id').single()
      if (isUniqueViolation(error) && !/sku/i.test(error?.message ?? '')) continue
      if (error) throw productError(error)
      productId = (data as { id: string }).id
    }
    if (!productId) throw new Error('Impossible de trouver une adresse libre pour ce produit. Essayez un autre nom.')
  }

  const id = productId
  await syncChildren(client, 'product_sell_units', original?.sellUnits.map((u) => u.id) ?? [], draft.sellUnits, (u) => ({
    site_id: siteId, product_id: id, unit_id: u.unit_id, conversion_to_base: u.conversion_to_base,
    min_sale_quantity: u.min_sale_quantity, quantity_step: u.quantity_step, is_default: u.is_default,
  }))
  await syncChildren(client, 'price_tiers', original?.tiers.map((t) => t.id) ?? [], draft.tiers, (t) => ({
    site_id: siteId, product_id: id, unit_id: t.unit_id, min_quantity: t.min_quantity, unit_price: t.unit_price,
    valid_from: t.valid_from, valid_until: t.valid_until,
  }))
  await syncChildren(client, 'product_compatibilities', original?.compatibilities.map((c) => c.id as string) ?? [], draft.compatibilities, (c) => ({
    site_id: siteId, product_id: id, compatible_product_id: c.compatible_product_id, relation_type: c.relation_type, notes: c.notes,
  }))

  const service = draft.service
  const hasService = service.warranty_duration_days !== null || service.return_window_days !== null || Boolean(service.warranty_terms?.trim())
  const serviceRecord = {
    warranty_duration_days: service.warranty_duration_days,
    warranty_terms: service.warranty_terms?.trim() || null,
    return_window_days: service.return_window_days,
  }
  if (original?.service?.id) {
    const { error } = await client.from('product_service_profiles').update(serviceRecord).eq('id', original.service.id)
    if (error) throw toError(error)
  } else if (hasService) {
    const { error } = await client.from('product_service_profiles').insert({ ...serviceRecord, site_id: siteId, product_id: id })
    if (error) throw toError(error)
  }
  return id
}

/** Archiver plutôt que supprimer : le produit reste dans l'historique (ventes, mouvements). */
export async function setProductStatus(client: SupabaseClient, siteId: string, id: string, status: ProductStatus): Promise<void> {
  const { error } = await client.from('products').update({ status }).eq('id', id).eq('site_id', siteId)
  if (error) throw toError(error)
}

/** Recherche courte pour choisir un produit compatible. */
export async function searchProducts(client: SupabaseClient, siteId: string, text: string, excludeId?: string): Promise<{ id: string; name: string }[]> {
  const term = sanitizeSearch(text)
  if (!term) return []
  let request = client.from('products').select('id,name').eq('site_id', siteId).neq('status', 'archived')
    .or(`name.ilike.*${term}*,sku.ilike.*${term}*`)
  if (excludeId) request = request.neq('id', excludeId)
  const { data, error } = await request.order('name').limit(8)
  if (error) throw toError(error)
  return (data ?? []) as { id: string; name: string }[]
}
