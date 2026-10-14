import { useCallback, useEffect, useRef, useState, type DependencyList } from 'react'

export type AsyncState<T> =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: T }

/** Charge une donnée asynchrone ; ignore les réponses périmées quand les dépendances changent. */
export function useAsync<T>(load: () => Promise<T>, deps: DependencyList): AsyncState<T> & { reload: () => void } {
  const [state, setState] = useState<AsyncState<T>>({ status: 'loading' })
  const [tick, setTick] = useState(0)
  const loadRef = useRef(load)
  loadRef.current = load

  useEffect(() => {
    let cancelled = false
    setState((current) => (current.status === 'ready' ? current : { status: 'loading' }))
    loadRef.current()
      .then((data) => { if (!cancelled) setState({ status: 'ready', data }) })
      .catch((error: unknown) => {
        if (!cancelled) setState({ status: 'error', message: error instanceof Error ? error.message : 'Erreur inconnue' })
      })
    return () => { cancelled = true }
  }, [...deps, tick])

  const reload = useCallback(() => setTick((n) => n + 1), [])
  return { ...state, reload }
}

/** Valeur retardée (anti-rebond) : utile pour la recherche, une requête par pause de frappe. */
export function useDebounced<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(timer)
  }, [value, delay])
  return debounced
}
