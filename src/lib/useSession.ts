import { useEffect, useState } from 'react'
import type { Session, SupabaseClient } from '@supabase/supabase-js'

export type SessionState =
  | { status: 'unconfigured' }
  | { status: 'loading' }
  | { status: 'signed-out' }
  | { status: 'signed-in'; session: Session }

const fromSession = (session: Session | null): SessionState =>
  session ? { status: 'signed-in', session } : { status: 'signed-out' }

/** Suit la session Supabase (restaurée au démarrage, puis mise à jour à chaque événement). */
export function useSession(client: SupabaseClient | null): SessionState {
  const [state, setState] = useState<SessionState>(() => (client ? { status: 'loading' } : { status: 'unconfigured' }))

  useEffect(() => {
    if (!client) return
    let cancelled = false

    client.auth.getSession().then(({ data }) => {
      if (!cancelled) setState(fromSession(data.session))
    }).catch(() => {
      if (!cancelled) setState({ status: 'signed-out' })
    })

    const { data } = client.auth.onAuthStateChange((_event, session) => {
      if (!cancelled) setState(fromSession(session))
    })

    return () => {
      cancelled = true
      data.subscription.unsubscribe()
    }
  }, [client])

  return state
}
