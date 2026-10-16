import { formatMoney, roundMoney } from '../hardware/money'

export type PaymentMethod = 'cash' | 'wave' | 'orange_money' | 'card' | 'credit'

export const PAYMENT_METHODS: PaymentMethod[] = ['cash', 'wave', 'orange_money', 'card', 'credit']

/** Wave, Orange Money et carte sont des ENREGISTREMENTS MANUELS : aucun paiement réel n'est exécuté. */
export const PAYMENT_LABELS: Record<PaymentMethod, string> = {
  cash: 'Espèces',
  wave: 'Wave (manuel)',
  orange_money: 'Orange Money (manuel)',
  card: 'Carte (manuel)',
  credit: 'Crédit client',
}

export type PaymentInput = { method: PaymentMethod; amount: number; reference?: string }

export type PaymentCheck =
  | { ok: true; tendered: number; change: number; cashNet: number; nonCash: number }
  | { ok: false; message: string }

/**
 * Règles de public.record_sale : montants positifs arrondis ; hors espèces, la somme ne dépasse pas le total ;
 * les espèces couvrent le reste et l'excédent est rendu. Un crédit exige le nom ou le téléphone du client.
 */
export function checkPayments(
  total: number,
  payments: PaymentInput[],
  options: { currency?: string; hasCustomer?: boolean } = {},
): PaymentCheck {
  const currency = options.currency ?? 'XOF'
  if (payments.length > 10) return { ok: false, message: 'Dix paiements au plus.' }
  let cash = 0
  let nonCash = 0
  for (const payment of payments) {
    if (!PAYMENT_METHODS.includes(payment.method)) return { ok: false, message: 'Moyen de paiement inconnu.' }
    if (!(payment.amount > 0) || roundMoney(payment.amount, currency) !== payment.amount) {
      return { ok: false, message: `Montant invalide pour ${PAYMENT_LABELS[payment.method]}.` }
    }
    if (payment.method === 'cash') cash += payment.amount
    else nonCash += payment.amount
  }
  if (payments.some((p) => p.method === 'credit') && !options.hasCustomer) {
    return { ok: false, message: 'Une vente à crédit exige le nom ou le téléphone du client.' }
  }
  if (nonCash > total) return { ok: false, message: 'Les paiements hors espèces dépassent le total à payer.' }
  const change = cash - (total - nonCash)
  if (change < 0) return { ok: false, message: `Paiement insuffisant : il manque ${formatMoney(-change, currency)}.` }
  return { ok: true, tendered: cash, change, cashNet: cash - change, nonCash }
}
