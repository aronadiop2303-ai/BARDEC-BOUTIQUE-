/**
 * Instantané figé d'un document de vente (store_documents.content_snapshot, version 1),
 * écrit par public.record_sale. L'impression le lit tel quel : aucune valeur n'est recalculée,
 * et l'état courant des produits n'est jamais consulté.
 */
export type ReceiptSnapshot = {
  version: number
  /** original_number : ticket d'origine d'un avoir (credit_note). */
  document: { type: string; number: string; issued_at: string; original_number?: string | null }
  shop: { name: string; legal_name?: string | null; address?: string | null; city?: string | null; phone?: string | null; email?: string | null }
  settings: {
    paper?: 'thermal_58mm' | 'thermal_80mm' | 'a4'
    footer_text?: string | null
    legal_details?: Record<string, unknown>
    show_cashier_name?: boolean
    show_customer_details?: boolean
  }
  cashier: { id?: string | null; name?: string | null }
  customer: { name?: string | null; phone?: string | null } | null
  lines: {
    name: string
    sku?: string | null
    quantity: number
    unit_label?: string | null
    unit_price: number
    line_discount: number
    line_total: number
    /** Avoir : 'restock' (remis en stock) ou 'damage' (casse). */
    disposition?: 'restock' | 'damage'
  }[]
  totals: { subtotal: number; discount_total: number; tax_total: number; grand_total: number; currency: string }
  discount?: { reason?: string | null } | null
  payments: { method: string; label: string; amount: number; reference?: string | null }[]
  cash: { tendered: number; change: number }
  /** Avoir : motif du retour et ticket d'origine. */
  return?: { reason?: string | null; original_number?: string | null } | null
}

/** Libellés des identifiants légaux connus ; une clé inconnue est affichée telle quelle. */
const LEGAL_LABELS: Record<string, string> = {
  ninea: 'NINEA',
  rccm: 'RCCM',
  vat_number: 'N° TVA',
  tax_id: 'Identifiant fiscal',
  address: 'Siège',
}

/**
 * Mentions légales renseignées par le propriétaire, dans l'ordre de saisie, sans les valeurs vides.
 * La mention TVA n'apparaît que si elle est renseignée.
 */
export function legalMentions(details: Record<string, unknown> | undefined): { label: string; value: string }[] {
  if (!details) return []
  return Object.entries(details)
    .filter(([, value]) => (typeof value === 'string' && value.trim() !== '') || typeof value === 'number')
    .map(([key, value]) => ({ label: LEGAL_LABELS[key] ?? key, value: String(value).trim() }))
}

export function isReceiptSnapshot(value: unknown): value is ReceiptSnapshot {
  const v = value as ReceiptSnapshot | null
  return !!v && typeof v === 'object' && !!v.document?.number && Array.isArray(v.lines) && !!v.totals && Array.isArray(v.payments)
}
