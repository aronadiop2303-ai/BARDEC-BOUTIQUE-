import { stockStatus, type StockStatus } from '../hardware/stock'
import { roundTo, type SellUnit, type Unit } from '../hardware/units'

/**
 * Règles des mouvements manuels de stock, identiques à public.record_stock_movement.
 * Elles servent l'affichage et la validation avant envoi ; la base refait tous les contrôles.
 */

/** Tous les types de public.inventory_movements (contrainte inventory_movements_movement_type_check). */
export type MovementType = 'initial_stock' | 'sale' | 'restock' | 'return' | 'adjustment' | 'damage' | 'reservation' | 'release'

/** Types saisis à la main ; les autres sont écrits par les fonctions de vente. */
export type ManualMovementType = 'initial_stock' | 'restock' | 'adjustment' | 'damage'

export const MANUAL_MOVEMENT_TYPES: ManualMovementType[] = ['restock', 'initial_stock', 'adjustment', 'damage']

export const MOVEMENT_LABELS: Record<MovementType, string> = {
  initial_stock: 'Inventaire initial',
  sale: 'Vente',
  restock: 'Entrée de stock',
  return: 'Retour / annulation',
  adjustment: 'Ajustement',
  damage: 'Perte / casse',
  reservation: 'Réservation',
  release: 'Libération',
}

export function isManualMovementType(value: string): value is ManualMovementType {
  return (MANUAL_MOVEMENT_TYPES as string[]).includes(value)
}

/** Motif obligatoire pour les mouvements qui corrigent ou retirent du stock. */
export function reasonRequired(type: ManualMovementType): boolean {
  return type === 'adjustment' || type === 'damage'
}

/** Quantité saisie (« 12,5 ») → nombre ; NaN si invalide. */
export function parseQuantityInput(text: string): number {
  const cleaned = text.replace(/\s/g, '').replace(',', '.')
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return NaN
  return Number(cleaned)
}

const decimalsOf = (value: number) => {
  const text = String(Math.abs(roundTo(value, 6)))
  if (text.includes('e-')) return Number(text.split('e-')[1])
  return text.includes('.') ? text.split('.')[1].length : 0
}

/** Variation en unité de base : quantité × conversion, négative pour une perte. */
export function toBaseDelta(type: ManualMovementType, quantity: number, sellUnit: Pick<SellUnit, 'conversion_to_base'>): number {
  const delta = roundTo(quantity * sellUnit.conversion_to_base, 6)
  return type === 'damage' ? -delta : delta
}

export type MovementInput = {
  type: ManualMovementType
  quantity: number
  sellUnit: Pick<SellUnit, 'conversion_to_base'>
  unit: Pick<Unit, 'label' | 'decimal_places'>
  reason: string
  /** Stock actuel de l'emplacement, en unité de base. */
  available: number
  /** products.allow_backorder ou réglage pos.allow_negative_stock. */
  allowNegative?: boolean
  /** Le produit a déjà des mouvements à cet emplacement (inventaire initial interdit). */
  hasMovements?: boolean
}

export type MovementCheck =
  | { ok: true; delta: number; stockAfter: number; statusAfter: StockStatus }
  | { ok: false; message: string }

export function checkMovement(input: MovementInput): MovementCheck {
  const { type, quantity, unit } = input
  if (!Number.isFinite(quantity) || quantity === 0) return { ok: false, message: 'La quantité ne peut pas être nulle.' }
  if (type !== 'adjustment' && quantity < 0) return { ok: false, message: 'La quantité doit être positive pour ce type de mouvement.' }
  if (decimalsOf(quantity) > unit.decimal_places) {
    return {
      ok: false,
      message: unit.decimal_places === 0
        ? `L’unité « ${unit.label} » se compte uniquement en nombre entier.`
        : `L’unité « ${unit.label} » accepte au plus ${unit.decimal_places} décimale(s).`,
    }
  }
  const reason = input.reason.trim()
  if (reasonRequired(type) && reason.length < 3) return { ok: false, message: 'Le motif est obligatoire (3 caractères au moins).' }
  if (reason.length > 500) return { ok: false, message: 'Motif trop long (500 caractères au plus).' }
  if (type === 'initial_stock' && input.hasMovements) {
    return { ok: false, message: 'Inventaire initial impossible : ce produit a déjà des mouvements à cet emplacement. Utilisez un ajustement.' }
  }
  const delta = toBaseDelta(type, quantity, input.sellUnit)
  const stockAfter = roundTo(input.available + delta, 6)
  if (delta < 0 && stockAfter < 0 && !input.allowNegative) {
    return { ok: false, message: `Stock insuffisant : ${input.available} disponible(s) à cet emplacement.` }
  }
  return { ok: true, delta, stockAfter, statusAfter: stockStatus(stockAfter, { tracked: true }) }
}
