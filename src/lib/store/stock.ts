import type { SupabaseClient } from '@supabase/supabase-js'
import { aggregateStock, type MovementRow, type StockLevel } from '../../domain/hardware/stock'
import type { ManualMovementType, MovementType } from '../../domain/stock/movements'
import { toError, type DbError } from '../errors'

export type LocationType = 'store' | 'warehouse' | 'shop_floor' | 'vehicle' | 'consignment' | 'other'

export type StockLocation = {
  id: string
  name: string
  location_type: LocationType
  address: string | null
  is_active: boolean
}

export const LOCATION_TYPE_LABELS: Record<LocationType, string> = {
  store: 'Magasin',
  warehouse: 'Dépôt',
  shop_floor: 'Surface de vente',
  vehicle: 'Chantier / véhicule',
  consignment: 'Dépôt-vente',
  other: 'Autre',
}

export async function listLocations(client: SupabaseClient, siteId: string): Promise<StockLocation[]> {
  const { data, error } = await client.from('stock_locations').select('id,name,location_type,address,is_active')
    .eq('site_id', siteId).order('created_at')
  if (error) throw toError(error)
  return (data ?? []) as StockLocation[]
}

export async function createLocation(client: SupabaseClient, siteId: string, input: { name: string; location_type: LocationType }): Promise<void> {
  const name = input.name.trim()
  if (!name) throw new Error('Le nom de l’emplacement est obligatoire.')
  const existing = await listLocations(client, siteId)
  if (existing.some((location) => location.name.trim().toLowerCase() === name.toLowerCase())) {
    throw new Error('Un emplacement porte déjà ce nom.')
  }
  const { error } = await client.from('stock_locations').insert({ site_id: siteId, name, location_type: input.location_type })
  if (error) throw toError(error)
}

/** Pas de suppression : un emplacement se désactive (le registre de stock peut y faire référence). */
export async function setLocationActive(client: SupabaseClient, siteId: string, id: string, isActive: boolean): Promise<void> {
  const { error } = await client.from('stock_locations').update({ is_active: isActive }).eq('id', id).eq('site_id', siteId)
  if (error) throw toError(error)
}

/** Nombre maximal de mouvements lus en une fois ; au-delà, l'écran signale que le calcul est partiel. */
export const MOVEMENT_LIMIT = 5000

/**
 * Niveaux de stock des produits demandés, calculés à partir du registre inventory_movements
 * (source de vérité). Aucune vue SQL n'existe encore : l'agrégation est faite ici (Q2 : vue ou fonction).
 */
export async function loadStockLevels(
  client: SupabaseClient,
  siteId: string,
  productIds: string[],
): Promise<{ levels: StockLevel[]; truncated: boolean }> {
  if (productIds.length === 0) return { levels: [], truncated: false }
  const { data, error } = await client.from('inventory_movements').select('product_id,stock_location_id,quantity_delta')
    .eq('site_id', siteId).in('product_id', productIds).order('created_at').limit(MOVEMENT_LIMIT)
  if (error) throw toError(error)
  const rows = (data ?? []) as MovementRow[]
  return { levels: aggregateStock(rows), truncated: rows.length >= MOVEMENT_LIMIT }
}

/** Nombre total de mouvements enregistrés pour la boutique (tableau de bord). */
export async function countMovements(client: SupabaseClient, siteId: string): Promise<number> {
  const { count, error } = await client.from('inventory_movements').select('id', { count: 'exact', head: true }).eq('site_id', siteId)
  if (error) throw toError(error)
  return count ?? 0
}

// ── Mouvements manuels (migration stock_entries_foundation) ──────────────────

const NOT_INSTALLED = new Set(['PGRST202', '42883'])

/** Vrai si la fonction public.record_stock_movement est en base (sonde sans effet stock_entries_version). */
export async function stockEntriesAvailable(client: SupabaseClient): Promise<boolean> {
  const { error } = await client.rpc('stock_entries_version')
  if (!error) return true
  if (error.code && NOT_INSTALLED.has(error.code)) return false
  throw toError(error)
}

/** Messages de la fonction SQL, rédigés en français : affichés tels quels. */
function movementError(error: DbError): Error {
  if (error.code && NOT_INSTALLED.has(error.code)) return new Error('Disponible après la mise à jour de la base.')
  if (error.code && ['42501', '22023', '23514'].includes(error.code)) return Object.assign(new Error(error.message), { code: error.code })
  return toError(error)
}

export type MovementRequest = {
  siteId: string
  productId: string
  locationId: string
  type: ManualMovementType
  quantity: number
  unitId: string
  reason: string
}

export type MovementResult = { movement_id: string; quantity_delta: number; stock_before: number; stock_after: number; unit_label: string }

export async function recordStockMovement(client: SupabaseClient, request: MovementRequest): Promise<MovementResult> {
  const { data, error } = await client.rpc('record_stock_movement', {
    p_site_id: request.siteId,
    p_product_id: request.productId,
    p_location_id: request.locationId,
    p_movement_type: request.type,
    p_quantity: request.quantity,
    p_unit_id: request.unitId,
    p_reason: request.reason.trim() || null,
  })
  if (error) throw movementError(error)
  return data as MovementResult
}

export type MovementHistoryRow = {
  id: string
  movement_type: MovementType
  quantity_delta: number
  unit_quantity: number | null
  unit_id: string | null
  stock_location_id: string | null
  reason: string | null
  reference_type: string | null
  created_at: string
}

/** Derniers mouvements d'un produit (lecture permise aux membres par la RLS). */
export async function listProductMovements(client: SupabaseClient, siteId: string, productId: string, limit = 50): Promise<MovementHistoryRow[]> {
  const { data, error } = await client.from('inventory_movements')
    .select('id,movement_type,quantity_delta,unit_quantity,unit_id,stock_location_id,reason,reference_type,created_at')
    .eq('site_id', siteId).eq('product_id', productId).order('created_at', { ascending: false }).limit(limit)
  if (error) throw toError(error)
  return ((data ?? []) as MovementHistoryRow[]).map((row) => ({
    ...row,
    quantity_delta: Number(row.quantity_delta),
    unit_quantity: row.unit_quantity === null ? null : Number(row.unit_quantity),
  }))
}
