import { useEffect, useState } from 'react'
import { fetchCategoryTree, type CategoryNode } from './catalog'
import { isSupabaseConfigured, supabase } from './supabase'

export type CategoriesState =
  | { status: 'loading'; tree: CategoryNode[] }
  | { status: 'ready'; tree: CategoryNode[] }
  | { status: 'unconfigured'; tree: CategoryNode[] }
  | { status: 'error'; tree: CategoryNode[]; message: string }

/** Charge le catalogue d'activités une seule fois au démarrage du Studio. */
export function useCategories(): CategoriesState {
  const [state, setState] = useState<CategoriesState>(
    isSupabaseConfigured ? { status: 'loading', tree: [] } : { status: 'unconfigured', tree: [] },
  )

  useEffect(() => {
    if (!supabase) return
    let cancelled = false
    fetchCategoryTree(supabase)
      .then((tree) => {
        if (!cancelled) setState({ status: 'ready', tree })
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState({ status: 'error', tree: [], message: error instanceof Error ? error.message : 'Erreur inconnue' })
        }
      })
    return () => {
      cancelled = true
    }
  }, [])

  return state
}
