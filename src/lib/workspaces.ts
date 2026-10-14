import type { SupabaseClient } from '@supabase/supabase-js'
import { isUniqueViolation, toError } from './errors'
import { slugify, withSuffix } from './slugify'

/** Colonnes de public.workspaces lues par le Studio. */
export type Workspace = {
  id: string
  owner_id: string
  name: string
  slug: string
}

const COLUMNS = 'id,owner_id,name,slug'
const DEFAULT_NAME = 'Mon espace'
const MAX_ATTEMPTS = 5

/**
 * Espace de l'utilisateur : celui qu'il possède en priorité, sinon le premier dont il est membre.
 * RLS ne renvoie que les espaces accessibles (propriétaire ou membre).
 */
export async function findWorkspace(client: SupabaseClient, userId: string): Promise<Workspace | null> {
  const owned = await client.from('workspaces').select(COLUMNS)
    .eq('owner_id', userId).order('created_at').limit(1)
  if (owned.error) throw toError(owned.error)
  if (owned.data && owned.data.length > 0) return owned.data[0] as Workspace

  const shared = await client.from('workspaces').select(COLUMNS).order('created_at').limit(1)
  if (shared.error) throw toError(shared.error)
  return (shared.data?.[0] as Workspace | undefined) ?? null
}

/**
 * Crée « Mon espace » avec un slug global unique (slugify + suffixe aléatoire).
 * L'identifiant est généré ici et la ligne relue ensuite : un INSERT … RETURNING échouerait,
 * car la politique SELECT passe par une fonction qui ne voit pas encore la ligne insérée.
 */
export async function createWorkspace(client: SupabaseClient, userId: string): Promise<Workspace> {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const workspace: Workspace = {
      id: crypto.randomUUID(),
      owner_id: userId,
      name: DEFAULT_NAME,
      slug: withSuffix(slugify(DEFAULT_NAME)),
    }
    const { error } = await client.from('workspaces').insert(workspace)
    if (isUniqueViolation(error)) continue
    if (error) throw toError(error)

    const { data, error: readError } = await client.from('workspaces').select(COLUMNS).eq('id', workspace.id).single()
    if (readError) throw toError(readError)
    return data as Workspace
  }
  throw new Error('Impossible de créer votre espace : identifiant déjà pris. Réessayez.')
}

// Évite de créer deux espaces quand l'initialisation est lancée deux fois en parallèle
// (React StrictMode, onglets multiples dans la même page).
const pending = new Map<string, Promise<Workspace>>()

export function getOrCreateWorkspace(client: SupabaseClient, userId: string): Promise<Workspace> {
  const inFlight = pending.get(userId)
  if (inFlight) return inFlight
  const promise = (async () => (await findWorkspace(client, userId)) ?? createWorkspace(client, userId))()
    .finally(() => pending.delete(userId))
  pending.set(userId, promise)
  return promise
}
