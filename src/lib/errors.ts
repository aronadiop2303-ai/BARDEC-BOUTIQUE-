/** Erreur renvoyée par PostgREST / supabase-js (seuls les champs utiles). */
export type DbError = { code?: string; message: string }

/** Violation de contrainte d'unicité Postgres. */
export const UNIQUE_VIOLATION = '23505'

export function isUniqueViolation(error: DbError | null | undefined): boolean {
  return error?.code === UNIQUE_VIOLATION
}

/** Message lisible en français pour une erreur de base de données ou de réseau. */
export function frenchDbMessage(error: DbError): string {
  if (error.code === '42501') return 'Action refusée par les règles de sécurité de votre espace.'
  if (error.code === UNIQUE_VIOLATION) return 'Cet identifiant est déjà utilisé.'
  if (/failed to fetch|network/i.test(error.message)) {
    return 'Connexion au serveur impossible. Vérifiez votre connexion Internet.'
  }
  return `Erreur du serveur : ${error.message}`
}

/** Convertit une erreur supabase-js en Error JavaScript au message français. */
export function toError(error: DbError): Error {
  return Object.assign(new Error(frenchDbMessage(error)), { code: error.code })
}
