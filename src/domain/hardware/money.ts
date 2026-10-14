/** Devise par défaut des boutiques : franc CFA BCEAO, sans décimale. */
export const DEFAULT_CURRENCY = 'XOF'

const formatters = new Map<string, Intl.NumberFormat>()

function formatterFor(currency: string): Intl.NumberFormat {
  let formatter = formatters.get(currency)
  if (!formatter) {
    formatter = new Intl.NumberFormat('fr-FR', {
      maximumFractionDigits: currency === 'XOF' ? 0 : 2,
      minimumFractionDigits: 0,
    })
    formatters.set(currency, formatter)
  }
  return formatter
}

/** Espaces insécables (fines ou normales) remplacés par une espace simple, plus lisible et testable. */
const normalizeSpaces = (text: string) => text.replace(/[  ]/g, ' ')

/** 12500 → « 12 500 FCFA ». Le XOF n'a pas de décimale : le montant est arrondi à l'unité. */
export function formatMoney(amount: number, currency = DEFAULT_CURRENCY): string {
  const value = currency === 'XOF' ? Math.round(amount) : amount
  const label = currency === 'XOF' ? 'FCFA' : currency
  return `${normalizeSpaces(formatterFor(currency).format(value === 0 ? 0 : value))} ${label}`
}

/** Arrondi d'un montant à la précision de la devise (XOF : entier). */
export function roundMoney(amount: number, currency = DEFAULT_CURRENCY): number {
  if (currency === 'XOF') return Math.round(amount)
  return Math.round(amount * 100) / 100
}

/**
 * Lit un montant saisi (« 12 500 », « 12500 FCFA »). Renvoie null si invalide ou négatif.
 * En XOF, une valeur décimale est refusée plutôt qu'arrondie en silence.
 */
export function parseMoney(input: string, currency = DEFAULT_CURRENCY): number | null {
  const cleaned = normalizeSpaces(input).replace(/fcfa|xof/gi, '').replace(/\s/g, '').replace(',', '.')
  if (cleaned === '' || !/^\d+(\.\d+)?$/.test(cleaned)) return null
  const value = Number(cleaned)
  if (currency === 'XOF' && !Number.isInteger(value)) return null
  return value
}
