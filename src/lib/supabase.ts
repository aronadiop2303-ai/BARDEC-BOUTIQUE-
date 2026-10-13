import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL?.trim()
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim()

/** Vrai uniquement si les deux variables publiques sont renseignées. */
export const isSupabaseConfigured = Boolean(url && publishableKey)

/** Message lisible si les variables sont présentes mais inutilisables (ex. URL invalide). */
export let supabaseInitError: string | null = null

function buildClient(): SupabaseClient | null {
  if (!isSupabaseConfigured) return null
  try {
    return createClient(url as string, publishableKey as string, {
      auth: { persistSession: true, autoRefreshToken: true },
    })
  } catch (error) {
    // Ne jamais faire planter toute l'application (page blanche) pour une variable mal saisie.
    supabaseInitError =
      error instanceof Error
        ? `Configuration Supabase invalide (${error.message}). Vérifiez VITE_SUPABASE_URL dans .env.local.`
        : 'Configuration Supabase invalide. Vérifiez .env.local.'
    return null
  }
}

/**
 * Client Supabase côté navigateur. N'utilise QUE la clé publique : l'accès aux données
 * est contrôlé par les politiques RLS, jamais par le secret du client.
 * Retourne null si l'environnement n'est pas configuré ou invalide.
 */
export const supabase: SupabaseClient | null = buildClient()
