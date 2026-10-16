import { useEffect, useState } from 'react'

/**
 * Routage par hash (#/boutique/<siteId>/<section>/<id>).
 * Choix : aucune dépendance supplémentaire, et fonctionne sur tout hébergement statique
 * sans règle de réécriture côté serveur.
 */
export type BoutiqueSection = 'tableau-de-bord' | 'produits' | 'familles' | 'stock' | 'ventes' | 'parametres'

export type Route =
  | { name: 'home' }
  | { name: 'boutique'; siteId: string; section: BoutiqueSection; itemId: string | null }
  | { name: 'site'; siteId: string }

const SECTIONS: BoutiqueSection[] = ['tableau-de-bord', 'produits', 'familles', 'stock', 'ventes', 'parametres']

export function parseRoute(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent)
  if (parts[0] === 'boutique' && parts[1]) {
    const section = SECTIONS.includes(parts[2] as BoutiqueSection) ? (parts[2] as BoutiqueSection) : 'tableau-de-bord'
    return { name: 'boutique', siteId: parts[1], section, itemId: section === 'produits' ? parts[3] ?? null : null }
  }
  if (parts[0] === 'site' && parts[1]) return { name: 'site', siteId: parts[1] }
  return { name: 'home' }
}

export function boutiquePath(siteId: string, section: BoutiqueSection = 'tableau-de-bord', itemId?: string): string {
  return `#/boutique/${encodeURIComponent(siteId)}/${section}${itemId ? `/${encodeURIComponent(itemId)}` : ''}`
}

export function navigate(path: string): void {
  window.location.hash = path.startsWith('#') ? path.slice(1) : path
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseRoute(window.location.hash))
  useEffect(() => {
    const onChange = () => {
      setRoute(parseRoute(window.location.hash))
      window.scrollTo?.(0, 0)
    }
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  return route
}
