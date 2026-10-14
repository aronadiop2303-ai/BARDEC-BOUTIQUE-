import type { SupabaseClient } from '@supabase/supabase-js'
import { STARTER_FAMILIES, STARTER_LOCATIONS, STARTER_UNITS } from '../../domain/hardware/starter'
import { DEFAULT_CURRENCY } from '../../domain/hardware/money'
import { toError } from '../errors'
import { HARDWARE_MODULE_KEY } from './access'

/** Colonnes de public.business_profiles utilisées par le Studio. */
export type BusinessProfile = {
  id?: string
  site_id: string
  public_name: string
  phone: string | null
  whatsapp: string | null
  address: string | null
  city: string | null
  opening_hours: { text?: string }
  currency_code: string
}

export type ProfileInput = {
  public_name: string
  phone: string
  whatsapp: string
  address: string
  city: string
  hours: string
}

export type SetupStatus = {
  profile: BusinessProfile | null
  moduleEnabled: boolean
  documentSettings: boolean
  locationCount: number
  /** Vrai si les quatre éléments indispensables existent. */
  complete: boolean
}

const PROFILE_COLUMNS = 'id,site_id,public_name,phone,whatsapp,address,city,opening_hours,currency_code'

export async function getSetupStatus(client: SupabaseClient, siteId: string): Promise<SetupStatus> {
  const [profile, modules, documents, locations] = await Promise.all([
    client.from('business_profiles').select(PROFILE_COLUMNS).eq('site_id', siteId).maybeSingle(),
    client.from('site_commerce_modules').select('module_key,is_enabled').eq('site_id', siteId).eq('module_key', HARDWARE_MODULE_KEY),
    client.from('store_document_settings').select('id').eq('site_id', siteId).maybeSingle(),
    client.from('stock_locations').select('id').eq('site_id', siteId),
  ])
  for (const result of [profile, modules, documents, locations]) if (result.error) throw toError(result.error)

  const moduleEnabled = ((modules.data ?? []) as { is_enabled: boolean }[]).some((row) => row.is_enabled)
  const status = {
    profile: (profile.data as BusinessProfile | null) ?? null,
    moduleEnabled,
    documentSettings: Boolean(documents.data),
    locationCount: (locations.data ?? []).length,
  }
  return { ...status, complete: Boolean(status.profile) && moduleEnabled && status.documentSettings && status.locationCount > 0 }
}

const clean = (value: string) => value.trim() || null

export function validateProfile(input: ProfileInput): string | null {
  const name = input.public_name.trim()
  if (!name) return 'Le nom public de la boutique est obligatoire.'
  if (name.length > 180) return 'Le nom public ne doit pas dépasser 180 caractères.'
  for (const phone of [input.phone, input.whatsapp]) {
    if (phone.trim() && !/^\+?[0-9 ().-]{6,20}$/.test(phone.trim())) return 'Numéro de téléphone invalide (chiffres, espaces, + autorisés).'
  }
  return null
}

/** Crée ou met à jour le profil public (un seul par site : contrainte UNIQUE(site_id)). */
export async function saveBusinessProfile(client: SupabaseClient, siteId: string, input: ProfileInput): Promise<void> {
  const problem = validateProfile(input)
  if (problem) throw new Error(problem)
  const { error } = await client.from('business_profiles').upsert({
    site_id: siteId,
    public_name: input.public_name.trim(),
    phone: clean(input.phone),
    whatsapp: clean(input.whatsapp),
    address: clean(input.address),
    city: clean(input.city),
    opening_hours: input.hours.trim() ? { text: input.hours.trim() } : {},
    currency_code: DEFAULT_CURRENCY,
  }, { onConflict: 'site_id' })
  if (error) throw toError(error)
}

export type SetupInput = {
  profile: ProfileInput
  /** Clés de STARTER_LOCATIONS. */
  locations: string[]
  /** Slugs de STARTER_FAMILIES. */
  families: string[]
  /** Codes de STARTER_UNITS. */
  units: string[]
}

/**
 * Configuration initiale, IDEMPOTENTE : relancer ne crée aucun doublon.
 * - profil : upsert sur site_id ;
 * - emplacements : insérés seulement si aucun emplacement du même nom n'existe (pas de contrainte d'unicité en base) ;
 * - familles et unités : ON CONFLICT DO NOTHING (un renommage fait par l'utilisateur n'est jamais écrasé) ;
 * - module hardware_building : upsert, réactivé s'il était désactivé ;
 * - réglages des documents : créés une seule fois.
 * Nécessite le rôle propriétaire ou admin (RLS des modules et des réglages de documents).
 */
export async function runSetup(client: SupabaseClient, siteId: string, userId: string, input: SetupInput): Promise<void> {
  if (input.locations.length === 0) throw new Error('Choisissez au moins un emplacement de stock.')
  await saveBusinessProfile(client, siteId, input.profile)

  const existing = await client.from('stock_locations').select('name').eq('site_id', siteId)
  if (existing.error) throw toError(existing.error)
  const taken = new Set(((existing.data ?? []) as { name: string }[]).map((row) => row.name.trim().toLowerCase()))
  const newLocations = STARTER_LOCATIONS
    .filter((location) => input.locations.includes(location.key) && !taken.has(location.name.toLowerCase()))
    .map((location) => ({ site_id: siteId, name: location.name, location_type: location.location_type }))
  if (newLocations.length > 0) {
    const { error } = await client.from('stock_locations').insert(newLocations)
    if (error) throw toError(error)
  }

  const families = STARTER_FAMILIES
    .map((family, index) => ({ ...family, sort_order: index }))
    .filter((family) => input.families.includes(family.slug))
    .map((family) => ({ site_id: siteId, slug: family.slug, name: family.name, description: family.description, sort_order: family.sort_order }))
  if (families.length > 0) {
    const { error } = await client.from('product_categories').upsert(families, { onConflict: 'site_id,slug', ignoreDuplicates: true })
    if (error) throw toError(error)
  }

  const units = STARTER_UNITS.filter((unit) => input.units.includes(unit.code)).map((unit) => ({ site_id: siteId, ...unit }))
  if (units.length > 0) {
    const { error } = await client.from('product_units').upsert(units, { onConflict: 'site_id,code', ignoreDuplicates: true })
    if (error) throw toError(error)
  }

  const moduleResult = await client.from('site_commerce_modules')
    .upsert({ site_id: siteId, module_key: HARDWARE_MODULE_KEY, is_enabled: true }, { onConflict: 'site_id,module_key' })
  if (moduleResult.error) throw toError(moduleResult.error)

  const documents = await client.from('store_document_settings')
    .upsert({ site_id: siteId, default_paper: 'thermal_80mm', updated_by: userId }, { onConflict: 'site_id', ignoreDuplicates: true })
  if (documents.error) throw toError(documents.error)
}
