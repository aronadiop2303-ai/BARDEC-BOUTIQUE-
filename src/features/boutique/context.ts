import type { SupabaseClient } from '@supabase/supabase-js'
import type { EffectiveRole } from '../../domain/team/roles'
import type { StoreAccess } from '../../lib/store/access'
import type { StorePermissions } from '../../lib/store/permissions'

/** Contexte commun à tous les écrans de l'espace de gestion. */
export type BoutiqueContext = {
  client: SupabaseClient
  userId: string
  siteId: string
  access: StoreAccess
  can: StorePermissions
  /** Rôle métier effectif (private.staff_role) ; absent = déduit de access.role. */
  staffRole?: EffectiveRole
}
