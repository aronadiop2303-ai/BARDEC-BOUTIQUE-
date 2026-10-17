import type { EffectiveRole } from '../team/roles'

/**
 * Retours partiels (public.record_return). Le montant remboursé est calculé par la base ; l'aperçu ci-dessous
 * multiplie seulement le prix unitaire remboursable renvoyé par returnable_lines, et la base a le dernier mot.
 */

export type ReturnableLine = {
  order_item_id: string
  product_id: string | null
  product_name: string
  unit_label: string | null
  decimal_places: number
  quantity_sold: number
  quantity_returned: number
  quantity_returnable: number
  unit_refund: number
}

export type Disposition = 'restock' | 'damage'
export type RefundMethod = 'cash' | 'wave' | 'orange_money' | 'card'

export const DISPOSITION_LABELS: Record<Disposition, string> = { restock: 'Remis en stock', damage: 'Casse (non remis en stock)' }
export const REFUND_LABELS: Record<RefundMethod, string> = {
  cash: 'Espèces (caisse ouverte)',
  wave: 'Wave (enregistrement manuel)',
  orange_money: 'Orange Money (enregistrement manuel)',
  card: 'Carte (enregistrement manuel)',
}

export type ReturnDraftLine = { order_item_id: string; quantity: string; disposition: Disposition }

const decimalsOf = (value: number) => {
  const text = String(value)
  if (text.includes('e-')) return Number(text.split('e-')[1])
  return text.includes('.') ? text.split('.')[1].length : 0
}

export const parseQuantityInput = (text: string) => {
  const trimmed = text.replace(',', '.').trim()
  if (trimmed === '') return 0
  const value = Number(trimmed)
  return Number.isFinite(value) ? value : NaN
}

/** Lignes à envoyer (quantité > 0) ou message d'erreur. */
export function buildReturnLines(
  available: ReturnableLine[],
  draft: ReturnDraftLine[],
): { ok: true; lines: { order_item_id: string; quantity: number; disposition: Disposition }[]; preview: number } | { ok: false; message: string } {
  const byId = new Map(available.map((l) => [l.order_item_id, l]))
  const lines: { order_item_id: string; quantity: number; disposition: Disposition }[] = []
  let preview = 0
  for (const entry of draft) {
    const line = byId.get(entry.order_item_id)
    if (!line) return { ok: false, message: 'Ligne inconnue.' }
    const quantity = parseQuantityInput(entry.quantity)
    if (Number.isNaN(quantity) || quantity < 0) return { ok: false, message: `« ${line.product_name} » : quantité invalide.` }
    if (quantity === 0) continue
    if (decimalsOf(quantity) > line.decimal_places) {
      return { ok: false, message: `« ${line.product_name} » : ${line.decimal_places} décimale(s) au plus.` }
    }
    if (quantity > line.quantity_returnable + 1e-9) {
      return { ok: false, message: `« ${line.product_name} » : au plus ${line.quantity_returnable} à retourner (vendu ${line.quantity_sold}, déjà retourné ${line.quantity_returned}).` }
    }
    lines.push({ order_item_id: line.order_item_id, quantity, disposition: entry.disposition })
    preview += Math.round(line.unit_refund * quantity)
  }
  if (lines.length === 0) return { ok: false, message: 'Indiquez au moins une quantité à retourner.' }
  return { ok: true, lines, preview }
}

export function checkReturnReason(reason: string): string | null {
  const value = reason.trim()
  return value.length < 3 || value.length > 500 ? 'Le motif du retour est obligatoire (3 à 500 caractères).' : null
}

/** Plafond de retour d'un vendeur (sites.settings.pos.cashier_max_return_amount) ; propriétaire et gérant : sans plafond. */
export function returnAllowed(role: EffectiveRole | null, amount: number, cashierCap: number): string | null {
  if (role === 'owner' || role === 'manager') return null
  if (role !== 'cashier') return 'Retour non autorisé pour votre rôle.'
  if (amount > cashierCap) {
    return cashierCap > 0
      ? `Retour supérieur au plafond autorisé pour un vendeur (${cashierCap}) : faites-le valider par le gérant.`
      : 'Aucun retour n’est autorisé aux vendeurs (plafond à 0 dans les réglages de caisse).'
  }
  return null
}
