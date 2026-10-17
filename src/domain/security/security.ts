import { csvCell } from '../import/csv'

/** Libellés des actions du journal d'audit (public.audit_log). Une action inconnue est affichée telle quelle. */
export const AUDIT_ACTION_LABELS: Record<string, string> = {
  invite: 'Invitation d’un membre',
  role_change: 'Changement de rôle',
  deactivate: 'Désactivation d’un membre',
  reactivate: 'Réactivation d’un membre',
  import_succeeded: 'Import de produits réussi',
  import_failed: 'Import de produits refusé',
  publish: 'Publication de la boutique en ligne',
  unpublish: 'Dépublication de la boutique en ligne',
  expense: 'Dépense de caisse',
  cash_in: 'Apport en caisse',
  cash_out: 'Retrait de caisse',
  deposit: 'Dépôt en banque',
  refund_cash: 'Remboursement en espèces',
  initial_stock: 'Inventaire initial',
  restock: 'Entrée de stock',
  adjustment: 'Ajustement de stock',
  damage: 'Perte / casse',
  return: 'Retour en stock (annulation)',
  void_sale: 'Annulation de vente',
  receive_purchase: 'Réception fournisseur',
  supplier_payment: 'Règlement fournisseur',
  credit_sale: 'Vente à crédit',
  payment: 'Versement client',
  credit_limit_override: 'Dépassement de plafond autorisé',
}

export const auditLabel = (action: string) => AUDIT_ACTION_LABELS[action] ?? action

/** Résumé lisible d'un user-agent : « Chrome sur Android », « Safari sur iPhone »… (indicatif). */
export function describeUserAgent(ua: string | null | undefined): string {
  if (!ua) return 'Appareil inconnu'
  const os = /Android/i.test(ua) ? 'Android' : /iPhone|iPad|iPod/i.test(ua) ? 'iPhone / iPad' : /Windows/i.test(ua) ? 'Windows'
    : /Mac OS X|Macintosh/i.test(ua) ? 'macOS' : /Linux/i.test(ua) ? 'Linux' : 'système inconnu'
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\/|Opera/.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox'
    : /Chrome\/|CriOS\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Navigateur'
  return `${browser} sur ${os}`
}

/** Une table exportée (tableau d'objets) en CSV : colonnes = union des clés, objets imbriqués en JSON. */
export function tableToCsv(rows: Record<string, unknown>[]): string {
  const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))]
  const cell = (value: unknown) => {
    if (value === null || value === undefined) return ''
    const text = typeof value === 'object' ? JSON.stringify(value) : String(value)
    return csvCell(text, ';')
  }
  const lines = [columns.map((c) => csvCell(c, ';')).join(';'), ...rows.map((row) => columns.map((c) => cell(row[c])).join(';'))]
  return String.fromCharCode(0xfeff) + lines.join('\r\n') + '\r\n'
}

export type ExportPayload = {
  format: string
  version: number
  site_id: string
  exported_at: string
  row_limit_per_table: number
  truncated_tables: string[]
  tables: Record<string, Record<string, unknown>[]>
}

export function exportSummary(payload: ExportPayload): { table: string; rows: number; truncated: boolean }[] {
  return Object.entries(payload.tables)
    .map(([table, rows]) => ({ table, rows: rows.length, truncated: payload.truncated_tables.includes(table) }))
    .sort((a, b) => a.table.localeCompare(b.table))
}
