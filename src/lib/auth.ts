import type { Session, SupabaseClient } from '@supabase/supabase-js'
import { toError } from './errors'

export type AuthOutcome =
  | { ok: true; session: Session | null; message?: string }
  | { ok: false; message: string }

type AuthErrorLike = { code?: string; message: string; status?: number }

const AUTH_MESSAGES: Record<string, string> = {
  invalid_credentials: 'E-mail ou mot de passe incorrect.',
  email_not_confirmed: 'Adresse e-mail non confirmée : ouvrez le lien reçu par e-mail, puis reconnectez-vous.',
  user_already_exists: 'Un compte existe déjà avec cette adresse. Connectez-vous.',
  email_exists: 'Un compte existe déjà avec cette adresse. Connectez-vous.',
  weak_password: 'Mot de passe trop faible. Utilisez au moins 8 caractères.',
  email_address_invalid: 'Adresse e-mail invalide.',
  validation_failed: 'Adresse e-mail ou mot de passe invalide.',
  signup_disabled: 'Les inscriptions sont actuellement fermées.',
  over_email_send_rate_limit: 'Trop d’e-mails envoyés. Réessayez dans quelques minutes.',
  over_request_rate_limit: 'Trop de tentatives. Réessayez dans quelques minutes.',
}

export function frenchAuthMessage(error: AuthErrorLike): string {
  if (error.code && AUTH_MESSAGES[error.code]) return AUTH_MESSAGES[error.code]
  if (/invalid login credentials/i.test(error.message)) return AUTH_MESSAGES.invalid_credentials
  if (/email not confirmed/i.test(error.message)) return AUTH_MESSAGES.email_not_confirmed
  if (/failed to fetch|network/i.test(error.message)) {
    return 'Connexion au serveur impossible. Vérifiez votre connexion Internet.'
  }
  return `Erreur d’authentification : ${error.message}`
}

export const CONFIRMATION_PENDING_MESSAGE =
  'Compte créé. Confirmez votre adresse avec le lien reçu par e-mail, puis connectez-vous.'

export async function signUp(client: SupabaseClient, email: string, password: string): Promise<AuthOutcome> {
  const { data, error } = await client.auth.signUp({
    email: email.trim(),
    password,
    options: { emailRedirectTo: window.location.origin },
  })
  if (error) return { ok: false, message: frenchAuthMessage(error) }
  // Si la confirmation par e-mail est activée, aucune session n'est ouverte tout de suite.
  if (!data.session) return { ok: true, session: null, message: CONFIRMATION_PENDING_MESSAGE }
  return { ok: true, session: data.session }
}

export async function signIn(client: SupabaseClient, email: string, password: string): Promise<AuthOutcome> {
  const { data, error } = await client.auth.signInWithPassword({ email: email.trim(), password })
  if (error) return { ok: false, message: frenchAuthMessage(error) }
  return { ok: true, session: data.session }
}

export async function signOut(client: SupabaseClient): Promise<AuthOutcome> {
  const { error } = await client.auth.signOut()
  if (error) return { ok: false, message: frenchAuthMessage(error) }
  return { ok: true, session: null }
}

/**
 * Crée le profil s'il n'existe pas (aucun trigger ne le fait à l'inscription).
 * ON CONFLICT DO NOTHING : un profil existant (nom, avatar) n'est jamais écrasé.
 */
export async function ensureProfile(client: SupabaseClient, userId: string): Promise<void> {
  const { error } = await client
    .from('profiles')
    .upsert({ user_id: userId }, { onConflict: 'user_id', ignoreDuplicates: true })
  if (error) throw toError(error)
}
