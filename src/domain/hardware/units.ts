/** Unité de mesure d'une boutique (public.product_units). */
export type Unit = {
  id: string
  code: string
  label: string
  dimension: 'count' | 'mass' | 'length' | 'volume' | 'area' | 'time' | 'other'
  decimal_places: number
}

/** Unité de vente d'un produit (public.product_sell_units). */
export type SellUnit = {
  unit_id: string
  conversion_to_base: number
  min_sale_quantity: number
  quantity_step: number
  is_default: boolean
}

/** Tolérance de calcul : évite que 0.1 + 0.2 fasse échouer une validation. */
const EPSILON = 1e-9

export function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals
  return Math.round((value + Math.sign(value) * EPSILON) * factor) / factor
}

/** Quantité en unité de vente → quantité en unité de base (ex. 2 rouleaux de 100 m → 200 m). */
export function toBaseQuantity(quantity: number, sellUnit: Pick<SellUnit, 'conversion_to_base'>): number {
  return roundTo(quantity * sellUnit.conversion_to_base, 6)
}

/** Quantité en unité de base → quantité dans l'unité de vente (ex. 250 m → 2,5 rouleaux). */
export function fromBaseQuantity(baseQuantity: number, sellUnit: Pick<SellUnit, 'conversion_to_base'>): number {
  return roundTo(baseQuantity / sellUnit.conversion_to_base, 6)
}

/**
 * Unité de base d'un produit : par convention, l'unité de vente dont la conversion vaut 1
 * (la table products n'a pas de colonne dédiée). null si aucune, ou si plusieurs sont ambiguës.
 */
export function baseSellUnit<T extends Pick<SellUnit, 'conversion_to_base'>>(sellUnits: T[]): T | null {
  const bases = sellUnits.filter((unit) => Math.abs(unit.conversion_to_base - 1) < EPSILON)
  return bases.length === 1 ? bases[0] : null
}

export type QuantityCheck = { ok: true; quantity: number } | { ok: false; message: string }

const countDecimals = (value: number) => {
  const text = String(value)
  if (text.includes('e-')) return Number(text.split('e-')[1])
  return text.includes('.') ? text.split('.')[1].length : 0
}

const isMultipleOf = (value: number, step: number) => {
  const ratio = value / step
  return Math.abs(ratio - Math.round(ratio)) < 1e-6
}

/**
 * Vérifie une quantité saisie pour une unité de vente : positive, décimales permises par l'unité,
 * au moins le minimum de vente, et multiple du pas (ex. pas de 0,5 m : 2,5 m OK, 2,3 m refusé).
 */
export function checkQuantity(
  quantity: number,
  sellUnit: Pick<SellUnit, 'min_sale_quantity' | 'quantity_step'>,
  unit: Pick<Unit, 'label' | 'decimal_places'>,
): QuantityCheck {
  if (!Number.isFinite(quantity) || quantity <= 0) return { ok: false, message: 'La quantité doit être supérieure à zéro.' }
  if (countDecimals(roundTo(quantity, 6)) > unit.decimal_places) {
    return {
      ok: false,
      message: unit.decimal_places === 0
        ? `L’unité « ${unit.label} » se vend uniquement en nombre entier.`
        : `L’unité « ${unit.label} » accepte au plus ${unit.decimal_places} décimale(s).`,
    }
  }
  if (quantity + EPSILON < sellUnit.min_sale_quantity) {
    return { ok: false, message: `Minimum de vente : ${formatQuantity(sellUnit.min_sale_quantity)} ${unit.label}.` }
  }
  if (!isMultipleOf(quantity, sellUnit.quantity_step)) {
    return { ok: false, message: `La quantité doit être un multiple de ${formatQuantity(sellUnit.quantity_step)} ${unit.label}.` }
  }
  return { ok: true, quantity }
}

/** Valide une unité de vente avant enregistrement (mêmes règles que les contraintes SQL). */
export function validateSellUnit(sellUnit: Pick<SellUnit, 'conversion_to_base' | 'min_sale_quantity' | 'quantity_step'>): string | null {
  if (!(sellUnit.conversion_to_base > 0)) return 'La conversion vers l’unité de base doit être supérieure à zéro.'
  if (!(sellUnit.min_sale_quantity > 0)) return 'Le minimum de vente doit être supérieur à zéro.'
  if (!(sellUnit.quantity_step > 0)) return 'Le pas de quantité doit être supérieur à zéro.'
  return null
}

const quantityFormat = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 3 })

/** 2.5 → « 2,5 » ; 1000 → « 1 000 ». */
export function formatQuantity(quantity: number): string {
  return quantityFormat.format(quantity).replace(/[  ]/g, ' ')
}
