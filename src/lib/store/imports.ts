import type { SupabaseClient } from '@supabase/supabase-js'
import type { ImportSourceId } from '../../domain/import/sources'
import type { ExistingProduct, ImportMode, ImportRowPayload, LocationRef, UnitRef } from '../../domain/import/validate'
import { toError } from '../errors'

/**
 * Import de produits. L'écriture passe UNIQUEMENT par public.import_products (migration product_import) :
 * une seule transaction, rôles propriétaire et admin, journal d'import. Tant que la migration n'est pas
 * appliquée, l'écran le dit et n'écrit rien.
 */

const NOT_INSTALLED = new Set(['PGRST202', 'PGRST205', '42P01', '42883'])

export class ImportNotInstalledError extends Error {
  constructor() {
    super('L’import de produits n’est pas encore activé : la migration product_import n’est pas appliquée à la base.')
  }
}

/** Détecte la migration par la présence du journal d'import. */
export async function isImportInstalled(client: SupabaseClient): Promise<boolean> {
  const { error } = await client.from('product_import_runs').select('id', { head: true, count: 'exact' }).limit(1)
  if (!error) return true
  if (error.code && NOT_INSTALLED.has(error.code)) return false
  throw toError(error)
}

const PAGE = 1000
const MAX_EXISTING = 20000

/** Unités, emplacements et produits existants (SKU, code-barres) nécessaires à l'aperçu. */
export async function loadImportContext(client: SupabaseClient, siteId: string): Promise<{
  units: UnitRef[]
  locations: LocationRef[]
  existing: ExistingProduct[]
}> {
  const [units, locations] = await Promise.all([
    client.from('product_units').select('id,code,label,decimal_places').eq('site_id', siteId).order('label'),
    client.from('stock_locations').select('id,name,is_active').eq('site_id', siteId).order('created_at'),
  ])
  if (units.error) throw toError(units.error)
  if (locations.error) throw toError(locations.error)
  const existing: ExistingProduct[] = []
  for (let from = 0; from < MAX_EXISTING; from += PAGE) {
    const { data, error } = await client.from('products').select('id,name,sku,barcode')
      .eq('site_id', siteId).order('id').range(from, from + PAGE - 1)
    if (error) throw toError(error)
    const rows = (data ?? []) as ExistingProduct[]
    existing.push(...rows)
    if (rows.length < PAGE) break
  }
  return { units: (units.data ?? []) as UnitRef[], locations: (locations.data ?? []) as LocationRef[], existing }
}

export type ImportResult = {
  import_id: string
  status: 'succeeded' | 'failed'
  row_count: number
  created: number
  updated: number
  stock_movements: number
  errors: { line: number | null; message: string }[]
}

export async function runImport(
  client: SupabaseClient,
  siteId: string,
  rows: ImportRowPayload[],
  mode: ImportMode,
  source: ImportSourceId,
): Promise<ImportResult> {
  // Champs résolus par la base elle-même : action et product_id ne sont pas envoyés.
  const payload = rows.map(({ action: _action, product_id: _id, ...row }) => row)
  const { data, error } = await client.rpc('import_products', { p_site_id: siteId, p_rows: payload, p_mode: mode, p_source: source })
  if (error) {
    if (error.code && NOT_INSTALLED.has(error.code)) throw new ImportNotInstalledError()
    if (error.code && ['42501', '22023'].includes(error.code)) throw Object.assign(new Error(error.message), { code: error.code })
    throw toError(error)
  }
  return data as ImportResult
}

export type ImportRun = {
  id: string
  created_at: string
  source: ImportSourceId
  mode: ImportMode
  row_count: number
  created_count: number
  updated_count: number
  stock_movement_count: number
  status: 'succeeded' | 'failed'
}

export async function listImportRuns(client: SupabaseClient, siteId: string): Promise<ImportRun[]> {
  const { data, error } = await client.from('product_import_runs')
    .select('id,created_at,source,mode,row_count,created_count,updated_count,stock_movement_count,status')
    .eq('site_id', siteId).order('created_at', { ascending: false }).limit(10)
  if (error) throw toError(error)
  return (data ?? []) as ImportRun[]
}
