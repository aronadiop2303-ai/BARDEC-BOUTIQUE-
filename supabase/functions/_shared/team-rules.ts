/**
 * Règles d'équipe, sans dépendance : partagées par l'Edge Function invite-staff (Deno) et l'interface (Vite).
 * La base applique les mêmes règles (public.staff_register_invitation, set_staff_role, set_staff_active) :
 * ce fichier sert à refuser tôt et à afficher les bons choix, il ne remplace pas la base.
 */

export const STAFF_ROLES = ['manager', 'cashier', 'stock_keeper', 'driver'] as const
export type StaffRole = (typeof STAFF_ROLES)[number]

/** Rôle effectif sur une boutique (private.staff_role) ; viewer = ancien rôle de membre publisher ou viewer. */
export type EffectiveRole = 'owner' | StaffRole | 'viewer'

export const isStaffRole = (value: unknown): value is StaffRole => STAFF_ROLES.includes(value as StaffRole)

/** Le propriétaire attribue tous les rôles d'équipe ; un gérant attribue vendeur, magasinier, livreur. */
export function canAssignRole(caller: EffectiveRole | null, target: StaffRole): boolean {
  if (caller === 'owner') return true
  if (caller === 'manager') return target !== 'manager'
  return false
}

/**
 * Peut-on modifier (rôle, désactivation) le membre `targetId` ?
 * Jamais soi-même, jamais le propriétaire ; un gérant ne touche pas à un autre gérant.
 */
export function canManageMember(
  caller: EffectiveRole | null,
  callerId: string,
  targetId: string,
  targetRole: EffectiveRole,
): boolean {
  if (!caller || callerId === targetId || targetRole === 'owner') return false
  if (caller === 'owner') return true
  return caller === 'manager' && targetRole !== 'manager'
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

export function normalizeEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const email = value.trim().toLowerCase()
  return email.length <= 254 && EMAIL.test(email) ? email : null
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type InviteRequest = { site_id: string; email: string; staff_role: StaffRole }

export function validateInviteRequest(body: unknown): { ok: true; value: InviteRequest } | { ok: false; message: string } {
  const b = (body ?? {}) as Record<string, unknown>
  if (typeof b.site_id !== 'string' || !UUID.test(b.site_id)) return { ok: false, message: 'Boutique invalide.' }
  const email = normalizeEmail(b.email)
  if (!email) return { ok: false, message: 'Adresse e-mail invalide.' }
  if (!isStaffRole(b.staff_role)) return { ok: false, message: 'Rôle invalide.' }
  return { ok: true, value: { site_id: b.site_id, email, staff_role: b.staff_role } }
}
