import { roundMoney } from '../hardware/money'
import { pickPriceTier, type PriceTier } from '../hardware/pricing'
import { checkQuantity, roundTo, toBaseQuantity, type SellUnit, type Unit } from '../hardware/units'

/**
 * Calculs de vente INDICATIFS pour l'écran de caisse : ils reproduisent les règles de public.record_sale
 * pour afficher le panier. La base recalcule tout à partir des prix enregistrés ; ces montants ne lui
 * sont jamais envoyés.
 */

export type SaleLineInput = {
  basePrice: number
  sellUnit: SellUnit
  unit: Pick<Unit, 'label' | 'decimal_places'>
  tiers: PriceTier[]
  quantity: number
  lineDiscount?: number
  currency?: string
  at?: Date
}

export type SaleLine = {
  quantity: number
  baseQuantity: number
  unitPrice: number
  tier: PriceTier | null
  gross: number
  lineDiscount: number
  total: number
}

export type LineResult = { ok: true; line: SaleLine } | { ok: false; message: string }

/** Palier de l'unité de vente ; un palier sans unité vaut pour l'unité de base (conversion 1). */
function tierFor(input: SaleLineInput): PriceTier | null {
  const own = pickPriceTier(input.tiers, input.sellUnit.unit_id, input.quantity, input.at)
  const generic = input.sellUnit.conversion_to_base === 1 ? pickPriceTier(input.tiers, null, input.quantity, input.at) : null
  if (own && generic) return own.min_quantity >= generic.min_quantity ? own : generic
  return own ?? generic
}

export function computeSaleLine(input: SaleLineInput): LineResult {
  const check = checkQuantity(input.quantity, input.sellUnit, input.unit)
  if (!check.ok) return check
  const currency = input.currency ?? 'XOF'
  const tier = tierFor(input)
  const unitPrice = tier ? tier.unit_price : input.basePrice * input.sellUnit.conversion_to_base
  const gross = roundMoney(roundTo(input.quantity * unitPrice, 6), currency)
  const lineDiscount = input.lineDiscount ?? 0
  if (!(lineDiscount >= 0) || lineDiscount > gross || roundMoney(lineDiscount, currency) !== lineDiscount) {
    return { ok: false, message: 'Remise de ligne invalide.' }
  }
  return {
    ok: true,
    line: {
      quantity: input.quantity,
      baseQuantity: toBaseQuantity(input.quantity, input.sellUnit),
      unitPrice,
      tier,
      gross,
      lineDiscount,
      total: gross - lineDiscount,
    },
  }
}

export type OrderDiscount = { type: 'amount' | 'percent'; value: number; reason: string } | null

export type Totals = {
  subtotal: number
  lineDiscounts: number
  orderDiscount: number
  discountTotal: number
  grandTotal: number
}

export type TotalsResult = { ok: true; totals: Totals } | { ok: false; message: string }

/** Totaux du panier, remise globale comprise, avec les mêmes refus que la base. */
export function computeTotals(lines: Pick<SaleLine, 'gross' | 'lineDiscount'>[], discount: OrderDiscount, currency = 'XOF'): TotalsResult {
  const subtotal = lines.reduce((sum, line) => sum + line.gross, 0)
  const lineDiscounts = lines.reduce((sum, line) => sum + line.lineDiscount, 0)
  const payable = subtotal - lineDiscounts
  let orderDiscount = 0
  if (discount) {
    if (!(discount.value >= 0)) return { ok: false, message: 'Remise invalide.' }
    if (discount.type === 'percent') {
      if (discount.value > 100) return { ok: false, message: 'Remise invalide : plus de 100 %.' }
      orderDiscount = roundMoney((payable * discount.value) / 100, currency)
    } else {
      if (roundMoney(discount.value, currency) !== discount.value) return { ok: false, message: 'Remise invalide : montant non arrondi.' }
      orderDiscount = discount.value
    }
    if (orderDiscount > payable) return { ok: false, message: 'Remise supérieure au montant à payer.' }
  }
  const discountTotal = lineDiscounts + orderDiscount
  return { ok: true, totals: { subtotal, lineDiscounts, orderDiscount, discountTotal, grandTotal: subtotal - discountTotal } }
}

/** Limite de remise par rôle : 100 % pour propriétaire et admin, réglage du site pour un vendeur (0 par défaut). */
export function maxDiscountPercent(role: string, editorLimit: unknown): number {
  if (role === 'owner' || role === 'admin') return 100
  if (role !== 'editor') return 0
  const limit = Number(editorLimit ?? 0)
  return Number.isFinite(limit) ? Math.min(Math.max(limit, 0), 100) : 0
}

/** Contrôle d'affichage de la remise ; la base refait ce contrôle. */
export function checkDiscount(totals: Totals, limitPercent: number, reason: string): string | null {
  if (totals.discountTotal <= 0) return null
  if (reason.trim().length < 3) return 'Le motif de la remise est obligatoire.'
  if (totals.discountTotal * 100 > limitPercent * totals.subtotal) return `Remise refusée : la limite de votre rôle est de ${limitPercent} %.`
  return null
}
