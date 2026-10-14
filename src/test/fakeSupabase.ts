import type { SupabaseClient } from '@supabase/supabase-js'

export type FakeResult = { data?: unknown; error?: { code?: string; message: string } | null; count?: number }
export type RecordedQuery = { table: string; ops: Array<[string, unknown[]]> }

/**
 * Faux client Supabase pour les tests : chaque requête attendue (await) consomme
 * la prochaine réponse de la file. Toutes les requêtes sont journalisées.
 */
export function fakeSupabase(responses: FakeResult[]) {
  const queue = [...responses]
  const queries: RecordedQuery[] = []

  function builder(table: string) {
    const query: RecordedQuery = { table, ops: [] }
    queries.push(query)
    const target: Record<string, unknown> = {}
    const proxy: Record<string, unknown> = new Proxy(target, {
      get(_t, prop: string) {
        if (prop === 'then') {
          const next = queue.shift()
          if (!next) throw new Error(`Réponse manquante pour la requête sur « ${table} »`)
          const result = { data: next.data ?? null, error: next.error ?? null, count: next.count ?? null }
          return (resolve: (value: unknown) => unknown) => resolve(result)
        }
        return (...args: unknown[]) => {
          query.ops.push([prop, args])
          return proxy
        }
      },
    })
    return proxy
  }

  const client = { from: (table: string) => builder(table) } as unknown as SupabaseClient
  const op = (query: RecordedQuery, name: string) => query.ops.find(([n]) => n === name)?.[1]
  return { client, queries, op, remaining: () => queue.length }
}
