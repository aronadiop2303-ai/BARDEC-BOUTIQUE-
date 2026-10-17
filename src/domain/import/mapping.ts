import type { RawTable } from './table'

/** Champs d'import d'un produit, dans l'ordre du modèle CSV. */
export const IMPORT_FIELDS = ['name', 'sku', 'barcode', 'category', 'unit', 'price', 'cost', 'initial_stock', 'location'] as const
export type ImportField = (typeof IMPORT_FIELDS)[number]

export const FIELD_LABELS: Record<ImportField, string> = {
  name: 'Nom',
  sku: 'SKU (référence)',
  barcode: 'Code-barres',
  category: 'Catégorie',
  unit: 'Unité',
  price: 'Prix de vente',
  cost: 'Prix d’achat',
  initial_stock: 'Stock initial',
  location: 'Emplacement',
}

export const REQUIRED_FIELDS: ImportField[] = ['name', 'price']

/** Correspondance colonne → champ : index de colonne, ou null si le champ n'est pas importé. */
export type ColumnMapping = Record<ImportField, number | null>

/** Minuscules, sans accents ni ponctuation : « Prix d'achat (FCFA) » → « prix d achat fcfa ». */
export function normalizeLabel(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

const SYNONYMS: Record<ImportField, string[]> = {
  name: ['nom', 'designation', 'libelle', 'produit', 'article', 'name', 'nom du produit'],
  sku: ['sku', 'reference', 'ref', 'code article', 'code produit', 'code interne'],
  barcode: ['code barres', 'code barre', 'codebarre', 'ean', 'ean13', 'gtin', 'barcode', 'upc'],
  category: ['categorie', 'famille', 'rayon', 'category', 'groupe'],
  unit: ['unite', 'unite de vente', 'unite de base', 'unit', 'u m', 'um'],
  price: ['prix de vente', 'prix', 'prix vente', 'pv', 'prix unitaire', 'tarif', 'price', 'prix ttc'],
  cost: ['prix d achat', 'prix achat', 'pa', 'cout', 'cout d achat', 'cost', 'prix de revient'],
  initial_stock: ['stock initial', 'stock', 'quantite', 'qte', 'quantite en stock', 'qty', 'inventaire'],
  location: ['emplacement', 'depot', 'magasin', 'location', 'lieu'],
}

/**
 * Propose un mapping à partir des en-têtes : correspondance exacte d'un synonyme d'abord,
 * puis en-tête qui commence par un synonyme. Une colonne n'est attribuée qu'une fois.
 */
export function suggestMapping(headers: string[]): ColumnMapping {
  const normalized = headers.map(normalizeLabel)
  const mapping = Object.fromEntries(IMPORT_FIELDS.map((f) => [f, null])) as ColumnMapping
  const used = new Set<number>()
  const assign = (match: (header: string, synonym: string) => boolean) => {
    for (const field of IMPORT_FIELDS) {
      if (mapping[field] !== null) continue
      const index = normalized.findIndex((h, i) => !used.has(i) && SYNONYMS[field].some((s) => match(h, s)))
      if (index >= 0) { mapping[field] = index; used.add(index) }
    }
  }
  assign((h, s) => h === s)
  assign((h, s) => h.startsWith(`${s} `))
  return mapping
}

export function missingRequired(mapping: ColumnMapping): ImportField[] {
  return REQUIRED_FIELDS.filter((field) => mapping[field] === null)
}

/** Deux champs ne peuvent pas lire la même colonne. */
export function duplicateColumns(mapping: ColumnMapping): number[] {
  const seen = new Map<number, number>()
  for (const index of Object.values(mapping)) if (index !== null) seen.set(index, (seen.get(index) ?? 0) + 1)
  return [...seen].filter(([, n]) => n > 1).map(([i]) => i)
}

/** Ligne source mappée : valeurs texte par champ, numéro de ligne dans la source. */
export type MappedRow = { line: number; values: Record<ImportField, string> }

export function applyMapping(table: RawTable, mapping: ColumnMapping): MappedRow[] {
  return table.rows.map((row, index) => ({
    line: table.lines[index] ?? index + 2,
    values: Object.fromEntries(IMPORT_FIELDS.map((f) => [f, mapping[f] === null ? '' : (row[mapping[f] as number] ?? '').trim()])) as Record<ImportField, string>,
  }))
}
