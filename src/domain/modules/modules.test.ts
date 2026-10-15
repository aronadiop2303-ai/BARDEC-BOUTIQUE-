import { describe, expect, it } from 'vitest'
import { permissionsFor } from '../../lib/store/permissions'
import { MODULE_CATALOG } from './catalog'
import { ROLE_PERMISSIONS } from './permissions'
import { buildNavigation, canActivate, missingTables, resolveDependencies, validateCatalog, type NavItem } from './registry'
import { DEPRECATED_TABLES, VERIFIED_TABLES } from './tables'
import type { ModuleManifest, StoreRole } from './types'

const mod = (key: string, dependsOn: string[] = [], extra: Partial<ModuleManifest> = {}): ModuleManifest => ({
  key, name: key, description: '', category: 'transversal', group: 'admin', status: 'available',
  dependsOn, requiredTables: [], requiredPermissions: ['catalog.read'],
  navigation: [{ id: key, label: key }], ...extra,
})

const ids = (items: NavItem[]): string[] => items.flatMap((item) => [item.id, ...ids(item.children)])
const ROLES: StoreRole[] = ['owner', 'admin', 'editor', 'publisher', 'viewer']

describe('catalogue réel', () => {
  it('est valide : aucune anomalie', () => {
    expect(validateCatalog()).toEqual([])
  })

  it('a des clés uniques au format de module_catalog', () => {
    const keys = MODULE_CATALOG.map((m) => m.key)
    expect(new Set(keys).size).toBe(keys.length)
    for (const key of keys) expect(key).toMatch(/^[a-z][a-z0-9_]*$/)
  })

  it('déclare les 17 modules transversaux et métiers, et les 9 entrées ERP quincaillerie', () => {
    const erp = MODULE_CATALOG.filter((m) => m.group === 'erp')
    expect(erp).toHaveLength(9)
    expect(erp.every((m) => m.sectorKey === 'hardware_building')).toBe(true)
    expect(MODULE_CATALOG.filter((m) => m.group !== 'erp')).toHaveLength(17)
    const names = MODULE_CATALOG.map((m) => m.name)
    for (const name of ['Ressources humaines', 'Utilisateurs & Rôles', 'Multi-sites', 'Secrétariat', 'Trésorerie', 'Facturation',
      'Dépenses & Fournisseurs', 'Contacts', 'Communication', 'Support & SAV', 'Réservations', 'Logistique & Flotte',
      'Pédagogique', 'Projets & Chantiers', 'Copilote IA', 'Workflows', 'Analytique']) {
      expect(names).toContain(name)
    }
  })

  it('ne marque « available » que le Catalogue et les Stocks', () => {
    expect(MODULE_CATALOG.filter((m) => m.status === 'available').map((m) => m.key).sort()).toEqual(['hw_catalog', 'hw_stock'])
    expect(MODULE_CATALOG.find((m) => m.key === 'hw_stock')?.limitations?.length).toBeGreaterThan(0)
  })

  it('porte la sous-barre Catalogue avec seulement Produits et Catégories livrés', () => {
    const catalog = MODULE_CATALOG.find((m) => m.key === 'hw_catalog')!
    const children = catalog.navigation[0].children ?? []
    expect(children.map((c) => c.label)).toEqual(['Produits', 'Catégories', 'Unités & Conditionnements', 'Tarifs professionnels',
      'Codes-barres EAN', 'Fiches techniques', 'Promotions', 'Produits associés'])
    expect(children.filter((c) => (c.status ?? 'available') === 'available').map((c) => c.label)).toEqual(['Produits', 'Catégories'])
  })

  it('requiredTables : modules livrés entièrement sur des tables vérifiées, aucune table écartée', () => {
    const verified = new Set<string>(VERIFIED_TABLES)
    for (const module of MODULE_CATALOG) {
      for (const table of module.requiredTables) expect(DEPRECATED_TABLES as readonly string[]).not.toContain(table)
      if (module.status === 'available') expect(module.requiredTables.filter((t) => !verified.has(t))).toEqual([])
    }
    expect(missingTables(MODULE_CATALOG.find((m) => m.key === 'hw_purchasing')!)).toEqual(['purchase_orders', 'purchase_order_items'])
  })

  it('les permissions par rôle suivent la matrice de l’espace de gestion', () => {
    for (const role of ROLES) {
      expect(ROLE_PERMISSIONS[role].includes('catalog.write')).toBe(permissionsFor(role).editCatalog)
      expect(ROLE_PERMISSIONS[role].includes('settings.manage')).toBe(permissionsFor(role).configure)
    }
  })
})

describe('resolveDependencies', () => {
  it('ordonne chaque module après ses dépendances transitives', () => {
    const result = resolveDependencies(['c'], [mod('a'), mod('b', ['a']), mod('c', ['b', 'a'])])
    expect(result).toEqual({ ok: true, order: ['a', 'b', 'c'] })
  })

  it('détecte un cycle et le décrit', () => {
    const result = resolveDependencies(['a'], [mod('a', ['b']), mod('b', ['c']), mod('c', ['a'])])
    expect(result).toEqual({ ok: false, error: 'cycle', cycle: ['a', 'b', 'c', 'a'] })
  })

  it('refuse une dépendance inconnue', () => {
    expect(resolveDependencies(['a'], [mod('a', ['fantome'])])).toEqual({ ok: false, error: 'unknown', key: 'fantome' })
  })

  it('résout le catalogue réel sans cycle', () => {
    const result = resolveDependencies(MODULE_CATALOG.map((m) => m.key))
    expect(result.ok).toBe(true)
  })
})

describe('canActivate', () => {
  it('refuse un module « soon », même avec ses dépendances actives', () => {
    expect(canActivate('hw_pos', ['hw_catalog', 'hw_stock'])).toEqual({ ok: false, reason: 'soon' })
    expect(canActivate('ai_copilot', [])).toEqual({ ok: false, reason: 'soon' })
  })

  it('refuse une dépendance manquante et la nomme', () => {
    expect(canActivate('hw_stock', [])).toEqual({ ok: false, reason: 'missing-dependencies', missing: ['hw_catalog'] })
    const catalog = [mod('a'), mod('b', ['a']), mod('c', ['b'])]
    expect(canActivate('c', ['b'], catalog)).toEqual({ ok: false, reason: 'missing-dependencies', missing: ['a'] })
  })

  it('refuse un module pris dans un cycle', () => {
    const result = canActivate('a', ['a', 'b'], [mod('a', ['b']), mod('b', ['a'])])
    expect(result).toMatchObject({ ok: false, reason: 'cycle' })
  })

  it('refuse un module inconnu', () => {
    expect(canActivate('inexistant', [])).toEqual({ ok: false, reason: 'unknown', key: 'inexistant' })
  })

  it('accepte le Catalogue seul, puis les Stocks une fois le Catalogue actif', () => {
    expect(canActivate('hw_catalog', [])).toEqual({ ok: true })
    expect(canActivate('hw_stock', ['hw_catalog'])).toEqual({ ok: true })
  })
})

describe('buildNavigation', () => {
  it('affiche les modules actifs et livrés, avec les entrées « soon » inactives', () => {
    const nav = buildNavigation(['hw_catalog', 'hw_stock', 'hw_pos'], 'owner')
    expect(nav.map((i) => i.id)).toEqual(['catalogue', 'stock'])
    const produits = nav[0].children.find((c) => c.id === 'catalogue.produits')
    const promotions = nav[0].children.find((c) => c.id === 'catalogue.promotions')
    expect(produits?.status).toBe('available')
    expect(promotions?.status).toBe('soon')
  })

  it('filtre les entrées selon le rôle', () => {
    const owner = ids(buildNavigation(['hw_catalog', 'hw_stock'], 'owner'))
    const viewer = ids(buildNavigation(['hw_catalog', 'hw_stock'], 'viewer'))
    expect(owner).toContain('catalogue.tarifs-pro')
    expect(owner).toContain('stock.inventaires')
    expect(viewer).toContain('catalogue.produits')
    expect(viewer).toContain('stock.niveaux')
    expect(viewer).not.toContain('catalogue.tarifs-pro')
    expect(viewer).not.toContain('catalogue.promotions')
    expect(viewer).not.toContain('stock.inventaires')
  })

  it('masque un module dont le rôle n’a pas la permission requise', () => {
    const catalog = [mod('a'), mod('b', [], { requiredPermissions: ['settings.manage'] })]
    expect(buildNavigation(['a', 'b'], 'admin', catalog).map((i) => i.id)).toEqual(['a', 'b'])
    expect(buildNavigation(['a', 'b'], 'editor', catalog).map((i) => i.id)).toEqual(['a'])
  })

  it('n’affiche pas un module actif dont une dépendance est inactive', () => {
    expect(buildNavigation(['hw_stock'], 'owner')).toEqual([])
  })

  it('n’affiche rien sans module actif', () => {
    for (const role of ROLES) expect(buildNavigation([], role)).toEqual([])
  })
})

describe('validateCatalog', () => {
  const codes = (catalog: ModuleManifest[], tables: string[] = ['products']) => validateCatalog(catalog, tables).map((i) => i.code)

  it('signale les clés en double ou mal formées', () => {
    expect(codes([mod('a'), mod('a', [], { navigation: [{ id: 'a2', label: 'x' }] })])).toEqual(['duplicate-key'])
    expect(codes([mod('Mauvaise-Cle')])).toEqual(['invalid-key'])
  })

  it('signale dépendances inconnues, auto-dépendances et cycles (une seule fois par cycle)', () => {
    expect(codes([mod('a', ['zzz'])])).toEqual(['unknown-dependency'])
    expect(codes([mod('a', ['a'])])).toEqual(['self-dependency', 'cycle'])
    expect(codes([mod('a', ['b']), mod('b', ['a'])])).toEqual(['cycle'])
  })

  it('signale un module livré qui dépend d’un module non livré', () => {
    expect(codes([mod('a', ['b']), mod('b', [], { status: 'soon' })])).toEqual(['available-depends-on-soon'])
  })

  it('exige des tables vérifiées pour un module livré seulement, et refuse toute table écartée', () => {
    expect(codes([mod('a', [], { requiredTables: ['products', 'a_creer'] })])).toEqual(['unverified-table'])
    expect(codes([mod('a', [], { status: 'soon', requiredTables: ['a_creer'] })])).toEqual([])
    expect(codes([mod('a', [], { status: 'soon', requiredTables: ['stores'] })])).toEqual(['deprecated-table'])
    expect(codes([mod('a', [], { requiredTables: ['cash_sessions'] })])).toEqual(['deprecated-table'])
  })

  it('signale navigation vide, entrées en double, entrée livrée dans un module « soon », réglages en double', () => {
    expect(codes([mod('a', [], { navigation: [] })])).toEqual(['empty-navigation'])
    expect(codes([mod('a'), mod('b', [], { navigation: [{ id: 'a', label: 'x' }] })])).toEqual(['duplicate-nav-id'])
    expect(codes([mod('a', [], { status: 'soon', navigation: [{ id: 'a', label: 'x', status: 'available' }] })])).toEqual(['available-entry-in-soon-module'])
    const field = { key: 'k', label: 'K', type: 'boolean' as const, default: false }
    expect(codes([mod('a', [], { settingsSchema: [field, field] })])).toEqual(['duplicate-setting'])
  })

  it('signale un module sans permission requise', () => {
    expect(codes([mod('a', [], { requiredPermissions: [] })])).toEqual(['missing-permissions'])
  })
})
