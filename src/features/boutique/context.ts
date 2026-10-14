import type { SupabaseClient } from '@supabase/supabase-js'
import type { StoreAccess } from '../../lib/store/access'
import type { StorePermissions } from '../../lib/store/permissions'

/** Contexte commun à tous les écrans de l'espace de gestion. */
export type BoutiqueContext = {
  client: SupabaseClient
  userId: string
  siteId: string
  access: StoreAccess
  can: StorePermissions
}
