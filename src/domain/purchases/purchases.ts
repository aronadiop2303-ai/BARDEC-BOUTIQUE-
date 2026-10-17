/**
 * Achats : mêmes règles que la base (create_purchase_order, receive_purchase), pour l'aperçu et les contrôles avant
 * envoi. Le coût moyen réellement enregistré est calculé par la base.
 */

/** Coût moyen pondéré en unité de base, arrondi à 2 décimales (identique à receive_purchase). */
export function weightedAverageCost(stockBefore: number, costBefore: number | null, receivedBase: number, receivedCostBase: number): number {
  const value = costBefore === null || stockBefore <= 0
    ? receivedCostBase
    : (stockBefore * costBefore + receivedBase * receivedCostBase) / (stockBefore + receivedBase)
  return Math.round(value * 100) / 100
}

export type PurchaseLineDraft = { productId: string; productName: string; quantity: string; unitCost: string; decimals: number }

const parse = (text: string) => {
  const trimmed = text.replace(/\s/g, '').replace(',', '.')
  if (trimmed === '') return NaN
  return Number(trimmed)
}

const decimalsOf = (value: number) => {
  const text = String(value)
  if (text.includes('e-')) return Number(text.split('e-')[1])
  return text.includes('.') ? text.split('.')[1].length : 0
}

/** Lignes prêtes à envoyer et total indicatif (le total enregistré est celui de la base), ou message d'erreur. */
export function buildPurchaseLines(drafts: PurchaseLineDraft[]):
  | { ok: true; lines: { product_id: string; quantity: number; unit_cost: number }[]; indicativeTotal: number }
  | { ok: false; message: string } {
  if (drafts.length === 0) return { ok: false, message: 'Ajoutez au moins un produit.' }
  if (drafts.length > 200) return { ok: false, message: '200 lignes au plus.' }
  const lines: { product_id: string; quantity: number; unit_cost: number }[] = []
  let total = 0
  for (const d of drafts) {
    const quantity = parse(d.quantity)
    const cost = parse(d.unitCost)
    if (!Number.isFinite(quantity) || quantity <= 0) return { ok: false, message: `« ${d.productName} » : quantité invalide.` }
    if (decimalsOf(quantity) > d.decimals) return { ok: false, message: `« ${d.productName} » : ${d.decimals} décimale(s) au plus.` }
    if (!Number.isInteger(cost) || cost < 0) return { ok: false, message: `« ${d.productName} » : coût d’achat entier positif ou nul attendu.` }
    lines.push({ product_id: d.productId, quantity, unit_cost: cost })
    total += Math.round(quantity * cost)
  }
  return { ok: true, lines, indicativeTotal: total }
}

export type ReceivableLine = {
  line_id: string
  product_id: string
  product_name: string
  unit_label: string | null
  decimal_places: number
  quantity_ordered: number
  quantity_received: number
  quantity_remaining: number
}

export function buildReceiptLines(available: ReceivableLine[], quantities: Record<string, string>, locationId: string):
  | { ok: true; lines: { line_id: string; quantity: number; location_id: string }[] }
  | { ok: false; message: string } {
  if (!locationId) return { ok: false, message: 'Choisissez l’emplacement de réception.' }
  const lines: { line_id: string; quantity: number; location_id: string }[] = []
  for (const line of available) {
    const text = quantities[line.line_id] ?? ''
    if (text.trim() === '') continue
    const quantity = parse(text)
    if (!Number.isFinite(quantity) || quantity < 0) return { ok: false, message: `« ${line.product_name} » : quantité invalide.` }
    if (quantity === 0) continue
    if (decimalsOf(quantity) > line.decimal_places) return { ok: false, message: `« ${line.product_name} » : ${line.decimal_places} décimale(s) au plus.` }
    if (quantity > line.quantity_remaining + 1e-9) return { ok: false, message: `« ${line.product_name} » : au plus ${line.quantity_remaining} restant à recevoir.` }
    lines.push({ line_id: line.line_id, quantity, location_id: locationId })
  }
  if (lines.length === 0) return { ok: false, message: 'Indiquez au moins une quantité reçue.' }
  return { ok: true, lines }
}

export const PO_STATUS_LABELS: Record<string, string> = {
  ordered: 'Commandé',
  partially_received: 'Reçu en partie',
  received: 'Reçu',
  cancelled: 'Annulé',
}

export const SUPPLIER_PAYMENT_LABELS: Record<string, string> = {
  cash: 'Espèces (caisse ouverte)',
  wave: 'Wave (enregistrement manuel)',
  orange_money: 'Orange Money (enregistrement manuel)',
  card: 'Carte (enregistrement manuel)',
  bank_transfer: 'Virement (enregistrement manuel)',
}
