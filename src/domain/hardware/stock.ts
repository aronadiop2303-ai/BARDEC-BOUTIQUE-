import { roundTo } from './units'

/** Ligne du registre public.inventory_movements (colonnes utiles au calcul). */
export type MovementRow = {
  product_id: string | null
  stock_location_id: string | null
  quantity_delta: number | string
}

export type StockLevel = {
  productId: string
  /** null = mouvement sans emplacement. */
  locationId: string | null
  quantity: number
}

/**
 * Niveau de stock = somme des mouvements par (produit, emplacement), en unité de base.
 * Les réservations (Q2) seront comptées à part ; ici tout mouvement est additionné.
 * PostgREST renvoie parfois le type numeric en texte : il est converti ici.
 */
export function aggregateStock(rows: MovementRow[]): StockLevel[] {
  const totals = new Map<string, StockLevel>()
  for (const row of rows) {
    if (!row.product_id) continue
    const delta = Number(row.quantity_delta)
    if (!Number.isFinite(delta)) continue
    const key = `${row.product_id}|${row.stock_location_id ?? ''}`
    const current = totals.get(key) ?? { productId: row.product_id, locationId: row.stock_location_id, quantity: 0 }
    current.quantity = roundTo(current.quantity + delta, 6)
    totals.set(key, current)
  }
  return [...totals.values()]
}

/** Total d'un produit, tous emplacements confondus. */
export function totalForProduct(levels: StockLevel[], productId: string): number {
  return roundTo(levels.filter((level) => level.productId === productId).reduce((sum, level) => sum + level.quantity, 0), 6)
}

export type StockStatus = 'untracked' | 'negative' | 'out' | 'low' | 'ok'

/**
 * Statut d'un niveau de stock. Le seuil minimum n'existe pas encore en base (Q2) :
 * sans seuil, on ne distingue que rupture / disponible.
 */
export function stockStatus(quantity: number, options: { tracked: boolean; minimum?: number | null }): StockStatus {
  if (!options.tracked) return 'untracked'
  if (quantity < 0) return 'negative'
  if (quantity === 0) return 'out'
  if (options.minimum !== null && options.minimum !== undefined && quantity <= options.minimum) return 'low'
  return 'ok'
}

export const STOCK_STATUS_LABELS: Record<StockStatus, string> = {
  untracked: 'Non suivi',
  negative: 'Négatif (à vérifier)',
  out: 'Rupture',
  low: 'Stock bas',
  ok: 'Disponible',
}
