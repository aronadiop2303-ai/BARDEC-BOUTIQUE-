import { roundMoney } from './money'

export type Margin = {
  /** Marge par unité, en devise. */
  amount: number
  /** Taux de marge sur le prix de vente (0,25 = 25 %). null si le prix est nul. */
  rateOnPrice: number | null
  /** Taux de marque sur le coût (coefficient − 1). null si le coût est nul. */
  markupOnCost: number | null
}

/**
 * Marge unitaire. Renvoie null tant que le coût est inconnu : la base n'a pas encore
 * de prix d'achat ni de coût moyen (jalon Q2). Ne jamais inventer un coût.
 */
export function computeMargin(price: number, cost: number | null | undefined, currency?: string): Margin | null {
  if (cost === null || cost === undefined || !Number.isFinite(cost) || cost < 0) return null
  const amount = roundMoney(price - cost, currency)
  return {
    amount,
    rateOnPrice: price > 0 ? amount / price : null,
    markupOnCost: cost > 0 ? amount / cost : null,
  }
}

const percent = new Intl.NumberFormat('fr-FR', { style: 'percent', maximumFractionDigits: 1 })

export function formatRate(rate: number | null): string {
  return rate === null ? '—' : percent.format(rate).replace(/[  ]/g, ' ')
}
