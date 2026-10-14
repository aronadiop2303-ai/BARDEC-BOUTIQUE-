import { roundMoney } from './money'

/** Palier de prix (public.price_tiers). unit_id null = unité de base du produit. */
export type PriceTier = {
  id?: string
  unit_id: string | null
  min_quantity: number
  unit_price: number
  valid_from: string | null
  valid_until: string | null
}

const isValidAt = (tier: PriceTier, at: Date) =>
  (!tier.valid_from || new Date(tier.valid_from) <= at) && (!tier.valid_until || at < new Date(tier.valid_until))

/**
 * Palier applicable : parmi les paliers valides à la date donnée et de la même unité,
 * celui dont la quantité minimale est la plus haute sans dépasser la quantité demandée.
 */
export function pickPriceTier(
  tiers: PriceTier[],
  unitId: string | null,
  quantity: number,
  at: Date = new Date(),
): PriceTier | null {
  let best: PriceTier | null = null
  for (const tier of tiers) {
    if (tier.unit_id !== unitId || !isValidAt(tier, at) || tier.min_quantity > quantity) continue
    if (!best || tier.min_quantity > best.min_quantity) best = tier
  }
  return best
}

/**
 * Prix unitaire INDICATIF dans une unité de vente : palier de cette unité si un palier s'applique,
 * sinon prix de base × conversion. Affichage seulement : la base recalculera les montants de vente (Q3).
 */
export function indicativeUnitPrice(args: {
  basePrice: number
  conversionToBase: number
  tiers: PriceTier[]
  unitId: string | null
  quantity: number
  at?: Date
  currency?: string
}): { unitPrice: number; tier: PriceTier | null } {
  const tier = pickPriceTier(args.tiers, args.unitId, args.quantity, args.at)
  const unitPrice = tier ? tier.unit_price : args.basePrice * args.conversionToBase
  return { unitPrice: roundMoney(unitPrice, args.currency), tier }
}

/** Libellé du palier selon son rang : détail, demi-gros, gros, puis « palier n ». */
export function tierLabel(rank: number): string {
  return ['Détail', 'Demi-gros', 'Gros'][rank] ?? `Palier ${rank + 1}`
}

/** Valide un palier avant enregistrement (mêmes règles que les contraintes SQL). */
export function validatePriceTier(tier: Pick<PriceTier, 'min_quantity' | 'unit_price' | 'valid_from' | 'valid_until'>): string | null {
  if (!(tier.min_quantity > 0)) return 'La quantité minimale du palier doit être supérieure à zéro.'
  if (!(tier.unit_price >= 0) || !Number.isFinite(tier.unit_price)) return 'Le prix du palier doit être positif.'
  if (tier.valid_from && tier.valid_until && new Date(tier.valid_until) <= new Date(tier.valid_from)) {
    return 'La fin de validité doit être postérieure au début.'
  }
  return null
}

/** Signale deux paliers identiques (même unité et même quantité minimale) : le choix serait ambigu. */
export function findDuplicateTier(tiers: Pick<PriceTier, 'unit_id' | 'min_quantity'>[]): number | null {
  const seen = new Set<string>()
  for (let i = 0; i < tiers.length; i += 1) {
    const key = `${tiers[i].unit_id ?? 'base'}|${tiers[i].min_quantity}`
    if (seen.has(key)) return i
    seen.add(key)
  }
  return null
}
