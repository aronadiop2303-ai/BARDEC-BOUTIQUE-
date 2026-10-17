import { legacyToEffective, type EffectiveRole } from '../../domain/team/roles'
import type { StoreRole } from './access'

/**
 * Matrice de permissions de l'espace de gestion, par rôle métier (private.staff_role, lot C).
 * L'interface s'y conforme ; la protection réelle est la base (RLS et fonctions SECURITY DEFINER).
 * Les anciens rôles de membre sont traduits : admin → gérant, editor → vendeur, publisher/viewer → lecture.
 */
export type StorePermissions = {
  /** Assistant de configuration, profil boutique, emplacements, modules, réglages des documents. */
  configure: boolean
  /** Créer et modifier produits, familles, unités de vente, paliers, compatibilités. */
  editCatalog: boolean
  /** Archiver ou restaurer un produit. */
  archiveProducts: boolean
  /** Saisir des mouvements de stock (public.record_stock_movement). */
  writeStock: boolean
  /** Voir le stock. */
  viewStock: boolean
  /** Accéder à la caisse (sessions, ventes, historique). */
  accessPos: boolean
  /** Encaisser une vente (public.record_sale). */
  sell: boolean
  /** Annuler une vente (public.void_sale). */
  voidSales: boolean
  /** Importer des produits (public.import_products). */
  importProducts: boolean
  /** Voir les prix d'achat et les marges. */
  viewCosts: boolean
  /** Gérer l'équipe (inviter, changer de rôle, désactiver). */
  manageTeam: boolean
  /** Voir « Mes livraisons ». */
  deliveries: boolean
  /** Voir l'aperçu de la boutique en ligne. */
  previewStorefront: boolean
  /** Publier ou dépublier la boutique en ligne : PROPRIÉTAIRE SEULEMENT (lot D). */
  publish: boolean
  /** Mouvements de caisse manuels (vendeur : petites dépenses seulement, plafond en base). */
  cashMovements: boolean
}

const NONE: StorePermissions = {
  configure: false, editCatalog: false, archiveProducts: false, writeStock: false, viewStock: false, accessPos: false,
  sell: false, voidSales: false, importProducts: false, viewCosts: false, manageTeam: false, deliveries: false,
  previewStorefront: false, publish: false, cashMovements: false,
}

const MATRIX: Record<EffectiveRole, StorePermissions> = {
  owner: { ...NONE, configure: true, editCatalog: true, archiveProducts: true, writeStock: true, viewStock: true, accessPos: true, sell: true, voidSales: true, importProducts: true, viewCosts: true, manageTeam: true, previewStorefront: true, publish: true, cashMovements: true },
  manager: { ...NONE, configure: true, editCatalog: true, archiveProducts: true, writeStock: true, viewStock: true, accessPos: true, sell: true, voidSales: true, importProducts: true, viewCosts: true, manageTeam: true, previewStorefront: true, cashMovements: true },
  cashier: { ...NONE, viewStock: true, accessPos: true, sell: true, cashMovements: true },
  stock_keeper: { ...NONE, writeStock: true, viewStock: true },
  driver: { ...NONE, deliveries: true },
  viewer: { ...NONE, viewStock: true, accessPos: true },
}

const LEGACY: StoreRole[] = ['owner', 'admin', 'editor', 'publisher', 'viewer']

export function permissionsFor(role: StoreRole | EffectiveRole): StorePermissions {
  const effective = LEGACY.includes(role as StoreRole) && role !== 'viewer' ? legacyToEffective(role as StoreRole) : (role as EffectiveRole)
  return { ...(MATRIX[effective] ?? NONE) }
}

export const ROLE_LABELS: Record<StoreRole, string> = {
  owner: 'Propriétaire',
  admin: 'Gérant (admin)',
  editor: 'Vendeur (editor)',
  publisher: 'Publieur',
  viewer: 'Lecture seule',
}
