import type { SupabaseClient } from '@supabase/supabase-js'
import type { ExportPayload } from '../../domain/security/security'
import { toError } from '../errors'

/** Données et sécurité (migration data_security) : export, journal d'audit, sessions de l'utilisateur. */

const NOT_INSTALLED = new Set(['PGRST202', 'PGRST205', '42P01', '42883'])

export class SecurityNotInstalledError extends Error {
  constructor() {
    super('Cette fonction n’est pas encore activée : la migration data_security n’est pas appliquée à la base.')
  }
}

function fail(error: { code?: string; message: string }): never {
  if (error.code && NOT_INSTALLED.has(error.code)) throw new SecurityNotInstalledError()
  if (error.code === '42501') throw Object.assign(new Error(error.message), { code: error.code })
  throw toError(error)
}

export async function exportSiteData(client: SupabaseClient, siteId: string): Promise<ExportPayload> {
  const { data, error } = await client.rpc('export_site_data', { p_site_id: siteId })
  if (error) fail(error)
  return data as ExportPayload
}

export type AuditEntry = { occurred_at: string; actor_name: string | null; category: string; action: string; reference: string | null; amount: number | null }

export async function auditLog(client: SupabaseClient, siteId: string, before: string | null): Promise<AuditEntry[]> {
  const { data, error } = await client.rpc('audit_log', { p_site_id: siteId, p_before: before, p_limit: 100 })
  if (error) fail(error)
  return ((data ?? []) as AuditEntry[]).map((e) => ({ ...e, amount: e.amount === null ? null : Number(e.amount) }))
}

export type AuthSession = { session_id: string; created_at: string; last_activity_at: string; user_agent: string | null; ip: string | null }

export async function mySessions(client: SupabaseClient): Promise<AuthSession[]> {
  const { data, error } = await client.rpc('my_auth_sessions')
  if (error) fail(error)
  return (data ?? []) as AuthSession[]
}

/** Déconnecte toutes les AUTRES sessions de l'utilisateur (API officielle Auth, portée « others »). */
export async function signOutOtherSessions(client: SupabaseClient): Promise<void> {
  const { error } = await client.auth.signOut({ scope: 'others' })
  if (error) throw toError(error)
}

export function downloadText(filename: string, content: string, type: string): void {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
