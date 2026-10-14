import type { StoreRole } from './access'

/**
 * Matrice de permissions de l'espace de gestion (docs/QUINCAILLERIE-ARCHITECTURE.md §5).
 * L'interface s'y conforme ; la protection réelle est la RLS.
 * Écart connu : la RLS permet encore à editor d'écrire le catalogue (resserrement à décider).
 */
export type StorePermissions = {
  /** Assistant de configuration, profil boutique, emplacements, modules, réglages des documents. */
  configure: boolean
  /** Créer et modifier produits, familles, unités de vente, paliers, compatibilités. */
  editCatalog: boolean
  /** Archiver ou restaurer un produit. */
  archiveProducts: boolean
  /** Saisir des mouvements de stock : impossible tant qu'aucune fonction SQL n'existe (Q2). */
  writeStock: boolean
}

export function permissionsFor(role: StoreRole): StorePermissions {
  const manager = role === 'owner' || role === 'admin'
  return {
    configure: manager,
    editCatalog: manager,
    archiveProducts: manager,
    writeStock: false,
  }
}

export const ROLE_LABELS: Record<StoreRole, string> = {
  owner: 'Propriétaire',
  admin: 'Gérant (admin)',
  editor: 'Vendeur (editor)',
  publisher: 'Publieur',
  viewer: 'Lecture seule',
}
