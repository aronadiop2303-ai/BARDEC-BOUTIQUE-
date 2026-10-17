import type { EffectiveRole } from '../team/roles'

/**
 * Mouvements de caisse manuels (public.record_cash_movement). Ces règles servent à refuser tôt et à afficher
 * les bons choix ; la base les applique elle-même (rôle, plafond, session ouverte, espèces suffisantes).
 */

export const MANUAL_CASH_TYPES = ['expense', 'cash_in', 'cash_out', 'deposit'] as const
export type ManualCashType = (typeof MANUAL_CASH_TYPES)[number]

/** Tous les types du registre, y compris ceux écrits par les ventes. */
export const CASH_MOVEMENT_LABELS: Record<string, string> = {
  sale_cash: 'Ventes en espèces',
  refund_cash: 'Remboursements',
  expense: 'Dépenses',
  cash_in: 'Apports',
  cash_out: 'Retraits',
  withdrawal: 'Retraits (ancien type)',
  deposit: 'Dépôts en banque',
  correction: 'Corrections (hors attendu)',
}

/** Sens dans l'attendu de caisse, identique à cash_session_summary ; correction : exclue (0). */
export const CASH_DIRECTION: Record<string, 1 | -1 | 0> = {
  sale_cash: 1, cash_in: 1,
  refund_cash: -1, expense: -1, cash_out: -1, withdrawal: -1, deposit: -1,
  correction: 0,
}

export function allowedCashTypes(role: EffectiveRole | null): ManualCashType[] {
  if (role === 'owner' || role === 'manager') return [...MANUAL_CASH_TYPES]
  if (role === 'cashier') return ['expense']
  return []
}

export type CashMovementInput = { type: ManualCashType; amount: number; reason: string; receiptRef: string }

/** Contrôle avant envoi. `expectedCash` : espèces attendues lues dans le rapport X ; `cashierCap` : plafond du vendeur. */
export function checkCashMovement(
  input: CashMovementInput,
  context: { role: EffectiveRole | null; cashierCap: number; expectedCash: number | null; currency?: string },
): string | null {
  if (!allowedCashTypes(context.role).includes(input.type)) {
    return context.role === 'cashier' ? 'Un vendeur ne peut enregistrer que des petites dépenses.' : 'Mouvement de caisse non autorisé pour votre rôle.'
  }
  if (!Number.isFinite(input.amount) || input.amount <= 0) return 'Le montant doit être supérieur à zéro.'
  if ((context.currency ?? 'XOF') === 'XOF' && !Number.isInteger(input.amount)) return 'Montant entier en FCFA attendu.'
  const reason = input.reason.trim()
  if (reason.length < 3 || reason.length > 300) return 'Le motif est obligatoire (3 à 300 caractères).'
  if (input.receiptRef.trim().length > 100) return 'Référence de justificatif trop longue (100 caractères au plus).'
  if (context.role === 'cashier' && input.amount > context.cashierCap) {
    return context.cashierCap > 0
      ? `Dépense supérieure au plafond autorisé pour un vendeur (${context.cashierCap}).`
      : 'Aucune dépense n’est autorisée aux vendeurs (plafond à 0 dans les réglages de caisse).'
  }
  if (CASH_DIRECTION[input.type] === -1 && context.expectedCash !== null && context.expectedCash - input.amount < 0) {
    return 'Espèces insuffisantes en caisse pour cette sortie.'
  }
  return null
}

/** Plafond des dépenses du vendeur (sites.settings.pos.cashier_max_expense_amount) ; invalide ou absent → 0. */
export function cashierExpenseCap(value: unknown): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  return Number.isFinite(n) && n > 0 ? n : 0
}

export type Breakdown = Record<string, { count: number; amount: number }>

/** Lignes de ventilation dans un ordre stable (types connus d'abord), montants tels que renvoyés par la base. */
export function breakdownRows(breakdown: Breakdown): { type: string; label: string; count: number; amount: number; direction: 1 | -1 | 0 }[] {
  const order = Object.keys(CASH_MOVEMENT_LABELS)
  return Object.entries(breakdown)
    .sort(([a], [b]) => (order.indexOf(a) === -1 ? 99 : order.indexOf(a)) - (order.indexOf(b) === -1 ? 99 : order.indexOf(b)))
    .map(([type, value]) => ({
      type,
      label: CASH_MOVEMENT_LABELS[type] ?? type,
      count: Number(value.count),
      amount: Number(value.amount),
      direction: CASH_DIRECTION[type] ?? 0,
    }))
}
