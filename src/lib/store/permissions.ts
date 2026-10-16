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
  /** Saisir des mouvements de stock (public.record_stock_movement : propriétaire et admin). */
  writeStock: boolean
  /** Encaisser une vente (public.record_sale : propriétaire, admin, editor). */
  sell: boolean
  /** Annuler une vente (public.void_sale : propriétaire et admin). */
  voidSales: boolean
}

export function permissionsFor(role: StoreRole): StorePermissions {
  const manager = role === 'owner' || role === 'admin'
  return {
    configure: manager,
    editCatalog: manager,
    archiveProducts: manager,
    writeStock: manager,
    sell: manager || role === 'editor',
    voidSales: manager,
  }
}

export const ROLE_LABELS: Record<StoreRole, string> = {
  owner: 'Propriétaire',
  admin: 'Gérant (admin)',
  editor: 'Vendeur (editor)',
  publisher: 'Publieur',
  viewer: 'Lecture seule',
}
