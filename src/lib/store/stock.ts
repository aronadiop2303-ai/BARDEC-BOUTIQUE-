import type { SupabaseClient } from '@supabase/supabase-js'
import { aggregateStock, type MovementRow, type StockLevel } from '../../domain/hardware/stock'
import { toError } from '../errors'

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
