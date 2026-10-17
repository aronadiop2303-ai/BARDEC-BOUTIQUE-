import type { SupabaseClient } from '@supabase/supabase-js'
import type { EffectiveRole, StaffRole } from '../../domain/team/roles'
import { toError } from '../errors'

/**
 * Équipe d'une boutique (migration team_accounts). Écritures uniquement par fonctions SQL
 * (set_staff_role, set_staff_active) et par l'Edge Function invite-staff (clé service_role côté serveur).
 */

const NOT_INSTALLED = new Set(['PGRST202', 'PGRST205', '42P01', '42883'])

export class TeamNotInstalledError extends Error {
  constructor() {
    super('La gestion d’équipe n’est pas encore activée : la migration team_accounts n’est pas appliquée à la base.')
  }
}

function rpcError(error: { code?: string; message: string }): Error {
  if (error.code && NOT_INSTALLED.has(error.code)) return new TeamNotInstalledError()
  if (error.code && ['42501', '22023', '23505'].includes(error.code)) return Object.assign(new Error(error.message), { code: error.code })
  return toError(error)
}

const EFFECTIVE: EffectiveRole[] = ['owner', 'manager', 'cashier', 'stock_keeper', 'driver', 'viewer']

/**
 * Rôle effectif de l'utilisateur sur la boutique (private.staff_role).
 * 'not-installed' si la migration est absente : l'appelant retombe sur l'ancien rôle de membre.
 * null : aucun rôle (désactivé).
 */
export async function getStaffRole(client: SupabaseClient, siteId: string): Promise<EffectiveRole | null | 'not-installed'> {
  const { data, error } = await client.rpc('current_staff_role', { p_site_id: siteId })
  if (error) {
    if (error.code && NOT_INSTALLED.has(error.code)) return 'not-installed'
    throw toError(error)
  }
  return EFFECTIVE.includes(data as EffectiveRole) ? (data as EffectiveRole) : null
}

export type StaffMember = {
  user_id: string
  email: string | null
  display_name: string | null
  staff_role: EffectiveRole
  is_active: boolean
  invited_by_name: string | null
  created_at: string
  last_sign_in_at: string | null
}

export async function listStaff(client: SupabaseClient, siteId: string): Promise<StaffMember[]> {
  const { data, error } = await client.rpc('list_site_staff', { p_site_id: siteId })
  if (error) throw rpcError(error)
  return (data ?? []) as StaffMember[]
}

export async function setStaffRole(client: SupabaseClient, siteId: string, userId: string, role: StaffRole): Promise<void> {
  const { error } = await client.rpc('set_staff_role', { p_site_id: siteId, p_user_id: userId, p_staff_role: role })
  if (error) throw rpcError(error)
}

export async function setStaffActive(client: SupabaseClient, siteId: string, userId: string, active: boolean, reason: string): Promise<void> {
  const { error } = await client.rpc('set_staff_active', { p_site_id: siteId, p_user_id: userId, p_active: active, p_reason: reason.trim() || null })
  if (error) throw rpcError(error)
}

export type InviteResult = { user_id: string; existing_account: boolean; email_sent: boolean; action_link: string | null }

/** Appelle l'Edge Function invite-staff avec le jeton de l'utilisateur (aucune clé secrète côté navigateur). */
export async function inviteStaff(client: SupabaseClient, siteId: string, email: string, role: StaffRole): Promise<InviteResult> {
  const { data, error } = await client.functions.invoke('invite-staff', { body: { site_id: siteId, email, staff_role: role } })
  if (error) {
    const context = (error as { context?: Response }).context
    let message = ''
    if (context && typeof context.json === 'function') {
      try { message = ((await context.json()) as { error?: string }).error ?? '' } catch { message = '' }
    }
    if (!message && (context?.status === 404 || /Failed to send|not found/i.test(error.message))) {
      message = 'L’invitation n’est pas encore disponible : la fonction invite-staff n’est pas déployée.'
    }
    throw new Error(message || 'Invitation impossible.')
  }
  return data as InviteResult
}

/** Message WhatsApp prêt à envoyer avec le lien d'invitation (wa.me, sans numéro : l'utilisateur choisit le contact). */
export function whatsappInviteUrl(shopName: string, link: string): string {
  const text = `Bonjour, vous êtes invité(e) à rejoindre l’équipe de ${shopName}. Ouvrez ce lien personnel (ne le partagez pas) : ${link}`
  return `https://wa.me/?text=${encodeURIComponent(text)}`
}
