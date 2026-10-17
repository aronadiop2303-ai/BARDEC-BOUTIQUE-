import { csvCell, type Delimiter } from './csv'
import { FIELD_LABELS, IMPORT_FIELDS } from './mapping'

const BOM = String.fromCharCode(0xfeff)

/** En-têtes du modèle : reconnus automatiquement par suggestMapping. */
export const TEMPLATE_HEADERS = ['Nom', 'SKU', 'Code-barres', 'Catégorie', 'Unité', 'Prix de vente', 'Prix d’achat', 'Stock initial', 'Emplacement']

const EXAMPLES = [
  ['Marteau de coffreur 500 g', 'MAR-500', '6001234567890', 'Outillage', 'u', '5000', '3500', '12', 'Magasin'],
  ['Câble rigide 2,5 mm²', 'CAB-25', '', 'Électricité', 'm', '400', '250', '150,5', 'Magasin'],
]

/**
 * Modèle CSV téléchargeable : UTF-8 avec marque d'ordre (Excel reconnaît les accents), séparateur « ; »
 * par défaut (Excel en français), virgule décimale dans l'exemple. Les lignes d'exemple sont à remplacer.
 */
export function csvTemplate(delimiter: Delimiter = ';'): string {
  const lines = [TEMPLATE_HEADERS, ...EXAMPLES].map((row) => row.map((cell) => csvCell(cell, delimiter)).join(delimiter))
  return BOM + lines.join('\r\n') + '\r\n'
}

/** Aide affichée sous le modèle, dans l'ordre des colonnes. */
export const TEMPLATE_HELP = IMPORT_FIELDS.map((field) => FIELD_LABELS[field])
