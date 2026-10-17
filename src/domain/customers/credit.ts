import type { EffectiveRole } from '../team/roles'

/**
 * Crédit client : règles d'affichage et de contrôle avant envoi. La base applique les mêmes règles
 * (record_credit_sale, record_customer_payment) et calcule soldes, relevé et ancienneté.
 */

export type CreditDecision =
  | { kind: 'ok' }
  | { kind: 'override'; excess: number }
  | { kind: 'blocked'; message: string }

/** Une vente à crédit qui porterait le solde au-delà du plafond exige un gérant ou le propriétaire, avec motif. */
export function creditDecision(balance: number, creditAmount: number, limit: number, role: EffectiveRole | null): CreditDecision {
  if (!(creditAmount > 0)) return { kind: 'blocked', message: 'Aucun montant à crédit.' }
  const after = balance + creditAmount
  if (after <= limit) return { kind: 'ok' }
  if (role === 'owner' || role === 'manager') return { kind: 'override', excess: after - limit }
  return { kind: 'blocked', message: 'Plafond de crédit dépassé : autorisation du gérant nécessaire.' }
}

export function checkOverrideReason(reason: string): string | null {
  const value = reason.trim()
  return value.length < 3 || value.length > 300 ? 'Motif d’autorisation obligatoire (3 à 300 caractères).' : null
}

export type CustomerDraft = { name: string; phone: string; address: string; creditLimit: string }

export function validateCustomer(draft: CustomerDraft, canSetLimit: boolean): string | null {
  const name = draft.name.trim()
  if (!name) return 'Le nom du client est obligatoire.'
  if (name.length > 120) return 'Nom trop long (120 caractères au plus).'
  const phone = draft.phone.trim()
  if (phone && (phone.length < 3 || phone.length > 40)) return 'Téléphone invalide.'
  if (draft.address.trim().length > 300) return 'Adresse trop longue (300 caractères au plus).'
  if (canSetLimit && draft.creditLimit.trim() !== '') {
    const limit = Number(draft.creditLimit.replace(/\s/g, ''))
    if (!Number.isInteger(limit) || limit < 0) return 'Plafond de crédit : montant entier positif ou nul.'
  }
  return null
}

export function checkPayment(amount: number, balance: number): string | null {
  if (!Number.isInteger(amount) || amount <= 0) return 'Montant invalide : entier supérieur à zéro.'
  if (amount > balance) return 'Versement supérieur au solde dû.'
  return null
}

/** Tranches d'ancienneté d'un impayé (jours depuis la plus ancienne vente non soldée, calculés par la base). */
export const AGING_BUCKETS = [
  { key: '0-30', label: '0 à 30 jours', max: 30 },
  { key: '31-60', label: '31 à 60 jours', max: 60 },
  { key: '61-90', label: '61 à 90 jours', max: 90 },
  { key: '90+', label: 'Plus de 90 jours', max: Infinity },
] as const

export type AgingKey = (typeof AGING_BUCKETS)[number]['key']

export function agingBucket(days: number): AgingKey {
  return (AGING_BUCKETS.find((b) => days <= b.max) ?? AGING_BUCKETS[AGING_BUCKETS.length - 1]).key
}

/** Regroupe les soldes (venant de la base) par tranche ; aucun montant n'est recalculé, seulement additionné pour l'en-tête. */
export function groupByAging<T extends { balance: number; days_outstanding: number }>(rows: T[]): Record<AgingKey, { count: number; total: number }> {
  const groups = Object.fromEntries(AGING_BUCKETS.map((b) => [b.key, { count: 0, total: 0 }])) as Record<AgingKey, { count: number; total: number }>
  for (const row of rows) {
    const g = groups[agingBucket(row.days_outstanding)]
    g.count += 1
    g.total += row.balance
  }
  return groups
}

export const LEDGER_LABELS: Record<string, string> = { credit_sale: 'Vente à crédit', payment: 'Versement' }
export const PAYMENT_METHOD_LABELS: Record<string, string> = {
  cash: 'Espèces',
  wave: 'Wave (enregistrement manuel)',
  orange_money: 'Orange Money (enregistrement manuel)',
  card: 'Carte (enregistrement manuel)',
}
