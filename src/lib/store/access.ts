import type { SupabaseClient } from '@supabase/supabase-js'
import { toError } from '../errors'

export type StoreRole = 'owner' | 'admin' | 'editor' | 'publisher' | 'viewer'

export type StoreSite = {
  id: string
  workspace_id: string
  name: string
  slug: string
  site_type: string
  status: string
  category_id: string | null
}

export type StoreAccess = {
  site: StoreSite
  workspace: { id: string; name: string; owner_id: string }
  role: StoreRole
  /** Boutique de quincaillerie : catégorie « quincaillerie » ou module hardware_building actif. */
  isHardware: boolean
}

export type AccessResult =
  | { status: 'ok'; access: StoreAccess }
  | { status: 'not-found' }
  | { status: 'forbidden' }

export const HARDWARE_CATEGORY_SLUG = 'quincaillerie'
export const HARDWARE_MODULE_KEY = 'hardware_building'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MEMBER_ROLES: StoreRole[] = ['admin', 'editor', 'publisher', 'viewer']

/**
 * Détermine si l'utilisateur peut gérer ce site et avec quel rôle.
 * Un site publié est lisible par tout utilisateur connecté (RLS) : l'accès à la gestion exige
 * en plus que l'ESPACE soit lisible, c'est-à-dire être propriétaire ou membre.
 * Cette vérification sert l'affichage ; la protection réelle reste la RLS de chaque table.
 */
export async function loadStoreAccess(client: SupabaseClient, siteId: string, userId: string): Promise<AccessResult> {
  if (!UUID.test(siteId)) return { status: 'not-found' }

  const site = await client.from('sites').select('id,workspace_id,name,slug,site_type,status,category_id')
    .eq('id', siteId).maybeSingle()
  if (site.error) throw toError(site.error)
  if (!site.data) return { status: 'not-found' }
  const storeSite = site.data as StoreSite

  const workspace = await client.from('workspaces').select('id,name,owner_id')
    .eq('id', storeSite.workspace_id).maybeSingle()
  if (workspace.error) throw toError(workspace.error)
  if (!workspace.data) return { status: 'forbidden' }
  const ws = workspace.data as StoreAccess['workspace']

  let role: StoreRole | null = ws.owner_id === userId ? 'owner' : null
  if (!role) {
    const membership = await client.from('workspace_memberships').select('role')
      .eq('workspace_id', ws.id).eq('user_id', userId).maybeSingle()
    if (membership.error) throw toError(membership.error)
    const memberRole = (membership.data as { role: string } | null)?.role
    role = MEMBER_ROLES.includes(memberRole as StoreRole) ? (memberRole as StoreRole) : null
  }
  if (!role) return { status: 'forbidden' }

  return { status: 'ok', access: { site: storeSite, workspace: ws, role, isHardware: await isHardwareSite(client, storeSite) } }
}

async function isHardwareSite(client: SupabaseClient, site: StoreSite): Promise<boolean> {
  if (site.category_id) {
    const category = await client.from('site_categories').select('slug').eq('id', site.category_id).maybeSingle()
    if (category.error) throw toError(category.error)
    if ((category.data as { slug: string } | null)?.slug === HARDWARE_CATEGORY_SLUG) return true
  }
  const modules = await client.from('site_commerce_modules').select('module_key')
    .eq('site_id', site.id).eq('module_key', HARDWARE_MODULE_KEY).eq('is_enabled', true)
  if (modules.error) throw toError(modules.error)
  return (modules.data ?? []).length > 0
}
