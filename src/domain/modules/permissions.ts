import type { Permission, StoreRole } from './types'

const READ: Permission[] = ['catalog.read', 'stock.read']

const MANAGER: Permission[] = [
  ...READ, 'catalog.write', 'stock.write', 'settings.manage',
  'sales.read', 'sales.write', 'customers.read', 'customers.write',
  'purchasing.read', 'purchasing.write', 'documents.read', 'documents.write',
  'delivery.read', 'delivery.write', 'reports.read', 'online_store.manage',
  'hr.manage', 'users.manage', 'sites.manage', 'secretariat.use',
  'finance.read', 'finance.write', 'contacts.read', 'contacts.write',
  'communication.send', 'support.use', 'bookings.manage', 'logistics.manage',
  'education.manage', 'projects.manage', 'ai.use', 'workflows.manage', 'analytics.read',
]

/**
 * Matrice cible rôle → permissions fonctionnelles (affichage uniquement).
 * Cohérente avec permissionsFor (src/lib/store/permissions.ts) : catalogue et réglages réservés à owner/admin.
 * stock.write figure dans la matrice cible, mais aucune entrée qui l'exige n'est livrée (écriture du registre : Q2).
 */
export const ROLE_PERMISSIONS: Record<StoreRole, readonly Permission[]> = {
  owner: MANAGER,
  admin: MANAGER,
  editor: [
    ...READ, 'sales.read', 'sales.write', 'customers.read', 'customers.write',
    'documents.read', 'documents.write', 'delivery.read', 'contacts.read', 'contacts.write',
    'support.use', 'bookings.manage', 'ai.use',
  ],
  publisher: [...READ, 'online_store.manage', 'communication.send', 'contacts.read'],
  viewer: READ,
}

export function hasPermission(role: StoreRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission)
}
