import type { StoreRole } from '../../lib/store/access'
import type { EffectiveRole, StaffRole } from '../../../supabase/functions/_shared/team-rules'

export {
  canAssignRole, canManageMember, isStaffRole, normalizeEmail, STAFF_ROLES, validateInviteRequest,
  type EffectiveRole, type StaffRole,
} from '../../../supabase/functions/_shared/team-rules'

export const STAFF_ROLE_LABELS: Record<EffectiveRole, string> = {
  owner: 'Propriétaire',
  manager: 'Gérant',
  cashier: 'Vendeur / Comptoir',
  stock_keeper: 'Magasinier',
  driver: 'Livreur / Chauffeur',
  viewer: 'Lecture seule',
}

export const STAFF_ROLE_HINTS: Record<StaffRole, string> = {
  manager: 'Tout, sauf retirer le propriétaire et nommer un autre gérant.',
  cashier: 'Ouvre la caisse, encaisse, réimprime ses tickets. Ni annulation, ni prix d’achat ; remise plafonnée.',
  stock_keeper: 'Stock : entrées, ajustements avec motif, inventaire. Pas de caisse, pas de prix d’achat.',
  driver: 'Voit uniquement les livraisons qui lui sont assignées (module livraison à venir).',
}

/**
 * Rôle effectif quand la base ne fournit pas encore private.staff_role (migration team_accounts absente) :
 * même traduction que la fonction SQL pour les anciens rôles de membre.
 */
export function legacyToEffective(role: StoreRole): EffectiveRole {
  if (role === 'owner') return 'owner'
  if (role === 'admin') return 'manager'
  if (role === 'editor') return 'cashier'
  return 'viewer'
}
