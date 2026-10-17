import { normalizeLabel, type ImportField, type MappedRow } from './mapping'

/**
 * Validation ligne par ligne avant import. La base revalide tout (public.import_products) :
 * cette étape sert l'aperçu (erreurs en rouge, doublons) et n'est pas une protection.
 */

export const MAX_IMPORT_ROWS = 1000

/** create : toute référence ou tout code-barres déjà connu est une erreur. upsert : un SKU connu met à jour le produit. */
export type ImportMode = 'create' | 'upsert'

export type UnitRef = { id: string; code: string; label: string; decimal_places: number }
export type LocationRef = { id: string; name: string; is_active: boolean }
export type ExistingProduct = { id: string; name: string; sku: string | null; barcode: string | null }

export type ImportContext = {
  mode: ImportMode
  units: UnitRef[]
  locations: LocationRef[]
  existing: ExistingProduct[]
  /** Code d'unité utilisé quand la colonne Unité est vide ou absente (« u » par défaut). */
  defaultUnitCode?: string
}

/** Ligne prête à envoyer à la base : aucun champ calculé, uniquement des valeurs saisies et résolues. */
export type ImportRowPayload = {
  line: number
  action: 'create' | 'update'
  product_id: string | null
  name: string
  sku: string | null
  barcode: string | null
  category: string | null
  unit_id: string | null
  price: number
  cost: number | null
  initial_stock: number | null
  location_id: string | null
}

export type PreviewRow = {
  line: number
  values: Record<ImportField, string>
  errors: string[]
  warnings: string[]
  payload: ImportRowPayload | null
}

export type ImportPreview = { rows: PreviewRow[]; validCount: number; errorCount: number; tooMany: boolean }

/**
 * Nombre saisi en français ou en anglais : « 12,5 », « 12.5 », « 1 234,50 », « 1.234,50 », « 1,234.50 ».
 * Plusieurs séparateurs identiques (« 1.234.567 ») = séparateurs de milliers. « FCFA » et espaces ignorés.
 * null si vide, NaN si illisible.
 */
export function parseDecimal(text: string): number | null {
  const cleaned = text.replace(/\s/g, '').replace(/(fcfa|xof|cfa)$/i, '')
  if (cleaned === '') return null
  let normalized = cleaned
  const dots = (cleaned.match(/\./g) ?? []).length
  const commas = (cleaned.match(/,/g) ?? []).length
  if (dots > 0 && commas > 0) {
    const decimal = cleaned.lastIndexOf('.') > cleaned.lastIndexOf(',') ? '.' : ','
    const thousands = decimal === '.' ? ',' : '.'
    normalized = cleaned.split(thousands).join('').replace(decimal, '.')
  } else if (dots > 1 || commas > 1) {
    normalized = cleaned.replace(/[.,]/g, '')
  } else {
    normalized = cleaned.replace(',', '.')
  }
  return /^-?\d+(\.\d+)?$/.test(normalized) ? Number(normalized) : NaN
}

const decimalsOf = (value: number) => {
  const text = String(value)
  if (text.includes('e-')) return Number(text.split('e-')[1])
  return text.includes('.') ? text.split('.')[1].length : 0
}

const MAX_TEXT = { name: 180, sku: 64, barcode: 64, category: 120 } as const

function money(label: string, text: string, required: boolean, errors: string[]): number | null {
  const value = parseDecimal(text)
  if (value === null) {
    if (required) errors.push(`${label} obligatoire.`)
    return null
  }
  if (Number.isNaN(value)) { errors.push(`${label} illisible : « ${text} ».`); return null }
  if (value < 0) { errors.push(`${label} négatif : il doit être positif ou nul.`); return null }
  if (!Number.isInteger(value)) { errors.push(`${label} : montant entier en FCFA attendu (« ${text} »).`); return null }
  if (value > 1_000_000_000_000) { errors.push(`${label} trop élevé.`); return null }
  return value
}

export function validateImport(rows: MappedRow[], context: ImportContext): ImportPreview {
  const unitKey = new Map<string, UnitRef>()
  for (const unit of context.units) {
    unitKey.set(normalizeLabel(unit.label), unit)
    unitKey.set(normalizeLabel(unit.code), unit)
  }
  const defaultUnit = unitKey.get(normalizeLabel(context.defaultUnitCode ?? 'u')) ?? null
  const activeLocations = context.locations.filter((l) => l.is_active)
  const locationKey = new Map(activeLocations.map((l) => [normalizeLabel(l.name), l]))
  const existingBySku = new Map(context.existing.filter((p) => p.sku).map((p) => [(p.sku as string).toLowerCase(), p]))
  const existingByBarcode = new Map(context.existing.filter((p) => p.barcode).map((p) => [p.barcode as string, p]))

  // Doublons dans le fichier : lignes par SKU (insensible à la casse) et par code-barres.
  const skuLines = new Map<string, number[]>()
  const barcodeLines = new Map<string, number[]>()
  for (const row of rows) {
    const sku = row.values.sku.trim().toLowerCase()
    const barcode = row.values.barcode.trim()
    if (sku) skuLines.set(sku, [...(skuLines.get(sku) ?? []), row.line])
    if (barcode) barcodeLines.set(barcode, [...(barcodeLines.get(barcode) ?? []), row.line])
  }

  const preview = rows.map((row): PreviewRow => {
    const v = row.values
    const errors: string[] = []
    const warnings: string[] = []

    const name = v.name.replace(/\s+/g, ' ').trim()
    if (!name) errors.push('Nom obligatoire.')
    else if (name.length > MAX_TEXT.name) errors.push(`Nom trop long (${MAX_TEXT.name} caractères au plus).`)

    const sku = v.sku.trim() || null
    if (sku && sku.length > MAX_TEXT.sku) errors.push(`SKU trop long (${MAX_TEXT.sku} caractères au plus).`)
    const barcode = v.barcode.replace(/\s/g, '') || null
    if (barcode && barcode.length > MAX_TEXT.barcode) errors.push(`Code-barres trop long (${MAX_TEXT.barcode} caractères au plus).`)
    const category = v.category.replace(/\s+/g, ' ').trim() || null
    if (category && category.length > MAX_TEXT.category) errors.push(`Catégorie trop longue (${MAX_TEXT.category} caractères au plus).`)

    if (sku) {
      const lines = skuLines.get(sku.toLowerCase()) ?? []
      if (lines.length > 1) errors.push(`SKU « ${sku} » en double dans le fichier (lignes ${lines.join(', ')}).`)
    }
    if (barcode) {
      const lines = barcodeLines.get(barcode) ?? []
      if (lines.length > 1) errors.push(`Code-barres « ${barcode} » en double dans le fichier (lignes ${lines.join(', ')}).`)
    }

    let action: ImportRowPayload['action'] = 'create'
    let productId: string | null = null
    const known = sku ? existingBySku.get(sku.toLowerCase()) : undefined
    if (known && context.mode === 'create') errors.push(`SKU « ${sku} » déjà utilisé par « ${known.name} ».`)
    if (known && context.mode === 'upsert') { action = 'update'; productId = known.id }
    if (barcode) {
      const owner = existingByBarcode.get(barcode)
      if (owner && owner.id !== productId) errors.push(`Code-barres « ${barcode} » déjà utilisé par « ${owner.name} ».`)
    }

    let unit: UnitRef | null = null
    if (v.unit.trim()) {
      unit = unitKey.get(normalizeLabel(v.unit)) ?? null
      if (!unit) errors.push(`Unité inconnue : « ${v.unit} ». Unités de la boutique : ${context.units.map((u) => u.code).join(', ') || 'aucune'}.`)
    } else if (action === 'create') {
      unit = defaultUnit
      if (!unit) errors.push('Unité obligatoire : aucune unité par défaut (« u ») dans la boutique.')
    }
    if (action === 'update' && v.unit.trim()) warnings.push('Produit existant : son unité n’est pas modifiée par l’import.')

    const price = money('Prix de vente', v.price, true, errors)
    const cost = money('Prix d’achat', v.cost, false, errors)
    if (price !== null && cost !== null && cost > price) warnings.push('Prix d’achat supérieur au prix de vente.')

    let stock: number | null = null
    const stockValue = parseDecimal(v.initial_stock)
    if (stockValue !== null) {
      if (Number.isNaN(stockValue)) errors.push(`Stock initial illisible : « ${v.initial_stock} ».`)
      else if (stockValue < 0) errors.push('Stock initial négatif.')
      else if (unit && decimalsOf(stockValue) > unit.decimal_places) {
        errors.push(unit.decimal_places === 0
          ? `Stock initial : nombre entier attendu pour l’unité « ${unit.label} ».`
          : `Stock initial : ${unit.decimal_places} décimale(s) au plus pour l’unité « ${unit.label} ».`)
      } else if (stockValue > 0) stock = stockValue
    }
    if (stock !== null && action === 'update') {
      errors.push('Stock initial impossible pour un produit existant : utilisez un ajustement de stock.')
      stock = null
    }

    let location: LocationRef | null = null
    if (stock !== null) {
      if (v.location.trim()) {
        location = locationKey.get(normalizeLabel(v.location)) ?? null
        if (!location) errors.push(`Emplacement inconnu ou désactivé : « ${v.location} ».`)
      } else {
        location = activeLocations[0] ?? null
        if (location) warnings.push(`Stock placé dans l’emplacement par défaut « ${location.name} ».`)
        else errors.push('Aucun emplacement actif pour recevoir le stock initial.')
      }
    }

    const payload: ImportRowPayload | null = errors.length > 0 || price === null ? null : {
      line: row.line,
      action,
      product_id: productId,
      name,
      sku,
      barcode,
      category,
      unit_id: action === 'create' ? unit?.id ?? null : null,
      price,
      cost,
      initial_stock: stock,
      location_id: location?.id ?? null,
    }
    return { line: row.line, values: v, errors, warnings, payload }
  })

  const errorCount = preview.filter((r) => r.errors.length > 0).length
  return { rows: preview, validCount: preview.length - errorCount, errorCount, tooMany: preview.length > MAX_IMPORT_ROWS }
}
