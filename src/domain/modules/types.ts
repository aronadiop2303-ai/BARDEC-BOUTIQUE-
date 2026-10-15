import type { StoreRole } from '../../lib/store/access'

export type ModuleCategory = 'transversal' | 'sectoral'
export type ModuleGroup = 'admin' | 'finance' | 'crm' | 'vertical' | 'intelligence' | 'erp'
/** 'available' : réellement livré et utilisable. 'soon' : prévu, jamais activable. */
export type ModuleStatus = 'available' | 'soon'

/**
 * Permissions fonctionnelles. Union fermée : une faute de frappe dans le catalogue est une erreur de compilation.
 * Elles pilotent l'affichage seulement ; la protection réelle reste la RLS ou une fonction SQL.
 */
export type Permission =
  | 'catalog.read' | 'catalog.write'
  | 'stock.read' | 'stock.write'
  | 'settings.manage'
  | 'sales.read' | 'sales.write'
  | 'customers.read' | 'customers.write'
  | 'purchasing.read' | 'purchasing.write'
  | 'documents.read' | 'documents.write'
  | 'delivery.read' | 'delivery.write'
  | 'reports.read'
  | 'online_store.manage'
  | 'hr.manage' | 'users.manage' | 'sites.manage' | 'secretariat.use'
  | 'finance.read' | 'finance.write'
  | 'contacts.read' | 'contacts.write'
  | 'communication.send' | 'support.use' | 'bookings.manage'
  | 'logistics.manage' | 'education.manage' | 'projects.manage'
  | 'ai.use' | 'workflows.manage' | 'analytics.read'

export type NavEntry = {
  /** Identifiant unique dans tout le catalogue, par ex. « catalogue.produits ». */
  id: string
  label: string
  /** Statut propre de l'entrée : une entrée 'soon' s'affiche inactive, sans faux contenu. Défaut : statut du module. */
  status?: ModuleStatus
  /** Permission requise pour voir l'entrée, en plus de celles du module. */
  permission?: Permission
  /** Précision affichable (« conditionnements saisis dans la fiche produit », etc.). */
  note?: string
  children?: NavEntry[]
}

export type SettingsField =
  | { key: string; label: string; type: 'boolean'; default: boolean }
  | { key: string; label: string; type: 'number'; default: number; min?: number; max?: number }
  | { key: string; label: string; type: 'text'; default: string; maxLength?: number }
  | { key: string; label: string; type: 'select'; default: string; options: { value: string; label: string }[] }

export type ModuleManifest = {
  /** Même format que module_catalog.key en base : ^[a-z][a-z0-9_]*$ */
  key: string
  name: string
  description: string
  category: ModuleCategory
  group: ModuleGroup
  status: ModuleStatus
  dependsOn: string[]
  /** Tables nécessaires. Celles absentes de VERIFIED_TABLES restent à créer (docs/MODULES.md). */
  requiredTables: string[]
  /** Toutes requises pour voir le module. */
  requiredPermissions: Permission[]
  navigation: NavEntry[]
  settingsSchema?: SettingsField[]
  /** Module sectoriel : clé du secteur dans module_catalog (table de la base). */
  sectorKey?: string
  /** Jalon de livraison prévu (Q2…Q7) ou livré. */
  milestone?: string
  /** Limites connues d'un module livré partiellement. */
  limitations?: string[]
}

export type { StoreRole }
