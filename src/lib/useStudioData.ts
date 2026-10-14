import { useCallback, useEffect, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { ensureProfile } from './auth'
import { createSite, listSites, type NewSite, type SiteRow } from './sites'
import { getOrCreateWorkspace, type Workspace } from './workspaces'

export type StudioDataState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; workspace: Workspace; sites: SiteRow[] }

const messageOf = (error: unknown) => (error instanceof Error ? error.message : 'Erreur inconnue')

/**
 * Données réelles d'un utilisateur connecté : profil (créé au besoin), espace (créé au besoin)
 * et sites de cet espace.
 */
export function useStudioData(client: SupabaseClient, userId: string) {
  const [state, setState] = useState<StudioDataState>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    setState({ status: 'loading' })
    ;(async () => {
      await ensureProfile(client, userId)
      const workspace = await getOrCreateWorkspace(client, userId)
      const sites = await listSites(client, workspace.id)
      if (!cancelled) setState({ status: 'ready', workspace, sites })
    })().catch((error: unknown) => {
      if (!cancelled) setState({ status: 'error', message: messageOf(error) })
    })
    return () => {
      cancelled = true
    }
  }, [client, userId, attempt])

  const retry = useCallback(() => setAttempt((n) => n + 1), [])

  /** Enregistre un brouillon dans l'espace courant et l'ajoute en tête de liste. */
  const addSite = useCallback(async (site: Omit<NewSite, 'workspaceId'>): Promise<SiteRow> => {
    if (state.status !== 'ready') throw new Error('Votre espace n’est pas encore chargé.')
    const created = await createSite(client, { ...site, workspaceId: state.workspace.id })
    setState((current) => (current.status === 'ready' ? { ...current, sites: [created, ...current.sites] } : current))
    return created
  }, [client, state])

  return { state, retry, addSite }
}
