import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL?.trim()
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim()

/** Vrai uniquement si les deux variables publiques sont renseignées. */
export const isSupabaseConfigured = Boolean(url && publishableKey)

/**
 * Client Supabase côté navigateur. N'utilise QUE la clé publique : l'accès aux données
 * est contrôlé par les politiques RLS, jamais par le secret du client.
 * Retourne null si l'environnement n'est pas configuré.
 */
export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(url as string, publishableKey as string, {
      auth: { persistSession: true, autoRefreshToken: true },
    })
  : null
