import { useEffect, useState } from 'react'

/**
 * Routage par hash (#/boutique/<siteId>/<section>/<id>).
 * Choix : aucune dépendance supplémentaire, et fonctionne sur tout hébergement statique
 * sans règle de réécriture côté serveur.
 */
export type BoutiqueSection = 'tableau-de-bord' | 'produits' | 'familles' | 'stock' | 'ventes' | 'equipe' | 'livraisons' | 'site-public' | 'parametres'

export type Route =
  | { name: 'home' }
  | { name: 'boutique'; siteId: string; section: BoutiqueSection; itemId: string | null }
  | { name: 'site'; siteId: string }
  /** Vitrine publique, sans connexion : #/vitrine/<siteId>[/famille/<id> | /produit/<slug>]. */
  | { name: 'storefront'; siteId: string; view: 'home' | 'category' | 'product'; param: string | null }

const SECTIONS: BoutiqueSection[] = ['tableau-de-bord', 'produits', 'familles', 'stock', 'ventes', 'equipe', 'livraisons', 'site-public', 'parametres']

export function parseRoute(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent)
  if (parts[0] === 'boutique' && parts[1]) {
    const section = SECTIONS.includes(parts[2] as BoutiqueSection) ? (parts[2] as BoutiqueSection) : 'tableau-de-bord'
    return { name: 'boutique', siteId: parts[1], section, itemId: section === 'produits' ? parts[3] ?? null : null }
  }
  if (parts[0] === 'site' && parts[1]) return { name: 'site', siteId: parts[1] }
  if (parts[0] === 'vitrine' && parts[1]) {
    if (parts[2] === 'famille' && parts[3]) return { name: 'storefront', siteId: parts[1], view: 'category', param: parts[3] }
    if (parts[2] === 'produit' && parts[3]) return { name: 'storefront', siteId: parts[1], view: 'product', param: parts[3] }
    return { name: 'storefront', siteId: parts[1], view: 'home', param: null }
  }
  return { name: 'home' }
}

export function boutiquePath(siteId: string, section: BoutiqueSection = 'tableau-de-bord', itemId?: string): string {
  return `#/boutique/${encodeURIComponent(siteId)}/${section}${itemId ? `/${encodeURIComponent(itemId)}` : ''}`
}

export function storefrontPath(siteId: string, view: 'home' | 'category' | 'product' = 'home', param?: string): string {
  const base = `#/vitrine/${encodeURIComponent(siteId)}`
  if (view === 'category' && param) return `${base}/famille/${encodeURIComponent(param)}`
  if (view === 'product' && param) return `${base}/produit/${encodeURIComponent(param)}`
  return base
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
