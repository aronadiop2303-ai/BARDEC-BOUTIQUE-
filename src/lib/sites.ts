import type { SupabaseClient } from '@supabase/supabase-js'
import { isUniqueViolation, toError } from './errors'
import { slugify, withSuffix } from './slugify'

export const SITE_TYPES = [
  'business', 'store', 'portfolio', 'school', 'real_estate',
  'services', 'association', 'media', 'landing_page', 'other',
] as const
export type SiteType = (typeof SITE_TYPES)[number]
export type SiteStatus = 'draft' | 'published' | 'archived'

/** Colonnes de public.sites lues par le Studio (jamais theme/settings ici). */
export type SiteRow = {
  id: string
  workspace_id: string
  name: string
  slug: string
  site_type: SiteType
  status: SiteStatus
  category_id: string | null
  template_id: string | null
  published_at: string | null
  created_at: string
  updated_at: string
}

export type NewSite = {
  workspaceId: string
  name: string
  /** Dernier nœud du chemin choisi, null pour un projet « Personnalisé ». */
  categoryId: string | null
  siteType: string
}

const COLUMNS = 'id,workspace_id,name,slug,site_type,status,category_id,template_id,published_at,created_at,updated_at'
const MAX_ATTEMPTS = 5

const isSiteType = (value: string): value is SiteType => (SITE_TYPES as readonly string[]).includes(value)

export async function listSites(client: SupabaseClient, workspaceId: string): Promise<SiteRow[]> {
  const { data, error } = await client.from('sites').select(COLUMNS)
    .eq('workspace_id', workspaceId).order('updated_at', { ascending: false })
  if (error) throw toError(error)
  return (data ?? []) as SiteRow[]
}

/**
 * Enregistre un site, TOUJOURS en brouillon : le Studio ne publie jamais de lui-même.
 * Slug unique par espace : le nom « slugifié », puis avec un suffixe aléatoire en cas de conflit.
 */
export async function createSite(client: SupabaseClient, site: NewSite): Promise<SiteRow> {
  const name = site.name.trim()
  if (!name) throw new Error('Le nom du site est obligatoire.')
  const base = slugify(name)

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const { data, error } = await client.from('sites').insert({
      workspace_id: site.workspaceId,
      name,
      slug: attempt === 1 ? base : withSuffix(base),
      status: 'draft',
      site_type: isSiteType(site.siteType) ? site.siteType : 'business',
      category_id: site.categoryId,
      template_id: null,
    }).select(COLUMNS).single()

    if (isUniqueViolation(error)) continue
    if (error) throw toError(error)
    return data as SiteRow
  }
  throw new Error('Impossible de trouver une adresse libre pour ce site. Essayez un autre nom.')
}
